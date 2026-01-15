import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/functions/alpacaWebSocket' });

app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET;
const ALPACA_BASE_URL = "https://paper-api.alpaca.markets";

// Check for Alpaca credentials
if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
  console.warn('⚠️  WARNING: ALPACA_API_KEY and ALPACA_API_SECRET environment variables are not set!');
  console.warn('   Live trading features will not work. Set these in a .env file or environment.');
}

// ============ BOT LOGIC (Copied exactly from frontend) ============
function initBotState(params) {
  return {
    momentum: 0,
    prevMomentum: 0,
    prevMid: null,
    state: 'IDLE',
    dipStartTick: null,
    dipStartMomentum: null,
    position: null,
    velocityHistory: [],
    unchangedTicks: 0,
    peakMomentum: 0,
    historicalPeakPrice: 0,
    positionSize: 0,
    hasPartialExited: false,
    params
  };
}

function processTickForBot(botState, tick) {
  const { mid, spread, bid, ask } = tick;
  const {
    minDipTicks = 5,
    stallVelocityThreshold = 0.12,
    stopLossMomentumDrop = 3,
    profitMomentumRise = 4,
    maxSpreadForEntry = 0.05,
    minMomentumForSpike = 5,
    consolidationTicks = 4,
    minDipMomentumDrop = 3
  } = botState.params;
  
  let action = null;
  let tradeInfo = null;
  
  // Calculate delta from previous mid
  let delta = 0;
  if (botState.prevMid !== null) {
    delta = mid - botState.prevMid;
  }
  
  // Store previous momentum before updating
  botState.prevMomentum = botState.momentum;
  
  // Update momentum counter: +1 for up tick, -1 for down tick
  if (delta > 0.003) {
    botState.momentum += 1;
    botState.unchangedTicks = 0;
    if (botState.momentum > botState.peakMomentum) {
      botState.peakMomentum = botState.momentum;
    }
  } else if (delta < -0.003) {
    botState.momentum -= 1;
    botState.unchangedTicks = 0;
  } else {
    botState.unchangedTicks += 1;
  }

  // Track highest price reached
  if (mid > botState.historicalPeakPrice) {
    botState.historicalPeakPrice = mid;
  }
  
  // Calculate velocity
  const momentumDelta = botState.momentum - botState.prevMomentum;
  botState.velocityHistory.push(momentumDelta);
  if (botState.velocityHistory.length > 5) {
    botState.velocityHistory.shift();
  }
  
  const avgVelocity = botState.velocityHistory.reduce((a, b) => a + b, 0) / 
                      (botState.velocityHistory.length || 1);
  
  // Check if price hasn't flushed
  const notFlushed = botState.historicalPeakPrice > 0 && 
                     mid > (botState.historicalPeakPrice * 0.5);
  
  // Consolidation detection
  if (botState.unchangedTicks >= consolidationTicks && botState.state !== 'HOLDING') {
    botState.momentum = 0;
    botState.prevMomentum = 0;
    botState.peakMomentum = 0;

    if (notFlushed) {
      botState.state = 'BUILDING_UP';
    } else {
      botState.state = 'IDLE';
      botState.historicalPeakPrice = 0;
    }

    botState.dipStartTick = null;
    botState.dipStartMomentum = null;
  }
  
  // STATE MACHINE
  if (botState.state === 'IDLE') {
    if (botState.momentum >= minMomentumForSpike) {
      botState.state = 'BUILDING_UP';
    }
  }
  else if (botState.state === 'BUILDING_UP') {
    if ((botState.momentum < botState.prevMomentum && botState.momentum >= 0) || 
        (botState.momentum < 0 && notFlushed)) {
      botState.state = 'DIPPING';
      botState.dipStartTick = tick.tick;
      botState.dipStartMomentum = botState.prevMomentum || botState.peakMomentum;
    }
  }
  else if (botState.state === 'DIPPING') {
    const dipDuration = tick.tick - botState.dipStartTick;
    const momentumDropped = botState.dipStartMomentum - botState.momentum;
    
    const isSlowing = Math.abs(avgVelocity) < stallVelocityThreshold;
    const droppedEnough = momentumDropped >= minDipMomentumDrop;
    const dipLongEnough = dipDuration >= minDipTicks;
    const spreadOk = spread <= maxSpreadForEntry;
    
    // BUY when: dip has gone down enough, for long enough time, and is now stalling
    if (dipLongEnough && droppedEnough && isSlowing && spreadOk && !botState.position) {
      botState.position = {
        entryTick: tick.tick,
        entryPrice: ask,
        entryMid: mid,
        entryMomentum: botState.momentum
      };
      botState.positionSize = 1.0;
      botState.hasPartialExited = false;
      action = 'BUY';
      tradeInfo = {
        type: 'BUY',
        tick: tick.tick,
        price: ask,
        time: tick.time,
        momentum: botState.momentum
      };
      botState.state = 'HOLDING';
    }
    
    // If momentum goes back up significantly, exit dipping state without buying
    if (botState.momentum > botState.prevMomentum && momentumDropped < 1) {
      if (notFlushed) {
        botState.state = 'BUILDING_UP';
      } else {
        botState.state = 'IDLE';
        botState.historicalPeakPrice = 0;
      }
      botState.dipStartTick = null;
      botState.dipStartMomentum = null;
    }
  }
  else if (botState.state === 'HOLDING' && botState.position) {
    const momentumSinceEntry = botState.momentum - botState.position.entryMomentum;
    const pnl = mid - botState.position.entryMid;
    const pnlPercent = (pnl / botState.position.entryMid) * 100;

    let shouldSell = false;
    let isPartialExit = false;
    let reason = '';

    // EXIT 1: Profit stall
    if (momentumSinceEntry >= profitMomentumRise && Math.abs(avgVelocity) < stallVelocityThreshold) {
      shouldSell = true;
      reason = 'PROFIT_STALL';
      if (botState.params.usePartialExits && !botState.hasPartialExited && botState.positionSize === 1.0) {
        isPartialExit = true;
      }
    }
    // EXIT 2: Drop after partial
    else if (botState.hasPartialExited && botState.positionSize === 0.5) {
      if (botState.velocityHistory.length >= 2) {
        const recentVelocities = botState.velocityHistory.slice(-2);
        const sustainedDrop = recentVelocities.every(v => v < -0.3);
        if (sustainedDrop && momentumSinceEntry < -1) {
          shouldSell = true;
          reason = 'DROP_AFTER_PARTIAL';
        }
      }
    }
    // EXIT 3: Sustained drop
    else if (botState.velocityHistory.length >= 2) {
      const recentVelocities = botState.velocityHistory.slice(-2);
      const sustainedDrop = recentVelocities.every(v => v < -0.3);
      if (sustainedDrop && momentumSinceEntry < -1) {
        shouldSell = true;
        reason = 'SUSTAINED_DROP';
      }
    }
    // EXIT 4: Stop loss
    if (momentumSinceEntry < -stopLossMomentumDrop) {
      shouldSell = true;
      reason = 'STOP_LOSS';
    }

    if (shouldSell) {
      const exitPrice = bid;
      const sizeExited = isPartialExit ? 0.5 : botState.positionSize;
      const profit = (exitPrice - botState.position.entryPrice) * sizeExited;
      action = 'SELL';
      tradeInfo = {
        type: 'SELL',
        tick: tick.tick,
        price: exitPrice,
        time: tick.time,
        profit,
        profitPercent: pnlPercent.toFixed(2),
        reason,
        momentum: botState.momentum,
        size: isPartialExit ? '50%' : (botState.positionSize === 0.5 ? '50%' : '100%')
      };

      if (isPartialExit) {
        botState.positionSize = 0.5;
        botState.hasPartialExited = true;
        botState.position.entryMomentum = botState.momentum;
      } else {
        botState.position = null;
        botState.positionSize = 0;
        botState.hasPartialExited = false;

        if (reason === 'STOP_LOSS' || reason === 'SUSTAINED_DROP' || reason === 'DROP_AFTER_PARTIAL') {
          if (notFlushed) {
            botState.state = 'BUILDING_UP';
          } else {
            botState.state = 'IDLE';
            botState.momentum = 0;
            botState.prevMomentum = 0;
            botState.peakMomentum = 0;
            botState.historicalPeakPrice = 0;
          }
        } else {
          botState.state = 'IDLE';
          botState.momentum = 0;
          botState.prevMomentum = 0;
          botState.peakMomentum = 0;
          botState.historicalPeakPrice = 0;
        }
        botState.dipStartTick = null;
        botState.dipStartMomentum = null;
      }
    }
  }
  
  botState.prevMid = mid;
  
  return {
    botState,
    action,
    tradeInfo,
    debugInfo: {
      momentum: botState.momentum,
      velocity: avgVelocity.toFixed(3),
      state: botState.state,
      unchangedTicks: botState.unchangedTicks
    }
  };
}
// ============ END BOT LOGIC ============

// Store bot states per connection
const botStates = new Map();

// WebSocket handler for Alpaca stream with bot processing
wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ticker = url.searchParams.get('ticker');
  const paramsJson = url.searchParams.get('params');
  
  if (!ticker) {
    console.error('❌ WebSocket connection rejected: Missing ticker parameter');
    clientWs.close(1008, 'Missing ticker parameter');
    return;
  }

  // Parse bot parameters (defaults if not provided)
  let params = {
    minDipTicks: 5,
    stallVelocityThreshold: 0.12,
    stopLossMomentumDrop: 3,
    profitMomentumRise: 4,
    maxSpreadForEntry: 0.05,
    minMomentumForSpike: 5,
    consolidationTicks: 4,
    minDipMomentumDrop: 3,
    usePartialExits: false
  };
  
  if (paramsJson) {
    try {
      params = { ...params, ...JSON.parse(paramsJson) };
    } catch (e) {
      console.warn('Failed to parse params, using defaults');
    }
  }

  console.log(`\n📡 New WebSocket connection for ticker: ${ticker}`);
  console.log(`   Bot parameters:`, params);
  
  if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
    const errorMsg = 'Missing Alpaca credentials';
    console.error(`❌ ${errorMsg}`);
    clientWs.send(JSON.stringify({ type: 'error', message: errorMsg }));
    clientWs.close(1011, errorMsg);
    return;
  }

  // Initialize bot state
  const botState = initBotState(params);
  botStates.set(clientWs, botState);
  let tickCounter = 0;
  let lastState = 'IDLE';

  // Send status to client
  const sendToClient = (type, data) => {
    const message = { type, ...data };
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(message));
    }
  };

  // Connect to Alpaca WebSocket
  console.log(`   🔌 Connecting to Alpaca WebSocket...`);
  const alpacaWs = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  alpacaWs.on('open', () => {
    console.log(`   ✓ Connected to Alpaca, authenticating...`);
    sendToClient('status', { message: 'Connected to Alpaca, authenticating...' });
    
    alpacaWs.send(JSON.stringify({
      action: 'auth',
      key: ALPACA_API_KEY,
      secret: ALPACA_API_SECRET
    }));
  });

  alpacaWs.on('message', (data) => {
    try {
      const messages = JSON.parse(data.toString());
      
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (msg.msg === 'authenticated') {
            console.log(`   ✓ Authenticated with Alpaca`);
            console.log(`   📊 Subscribing to ${ticker}...`);
            sendToClient('status', { message: 'Authenticated with Alpaca' });
            
            alpacaWs.send(JSON.stringify({
              action: 'subscribe',
              quotes: [ticker],
              trades: [ticker]
            }));
          } else if (msg.T === 'q') {
            // Quote message - process through bot
            const mid = (msg.bp + msg.ap) / 2;
            const spread = msg.ap - msg.bp;
            
            const tick = {
              tick: tickCounter++,
              time: new Date().toISOString(),
              bid: msg.bp,
              ask: msg.ap,
              mid,
              spread,
              volume: (msg.bs || 0) + (msg.as || 0)
            };

            // Process tick through bot
            const result = processTickForBot(botState, tick);
            
            // Log state changes
            if (result.botState.state !== lastState) {
              console.log(`   🔄 State: ${lastState} → ${result.botState.state}`);
              sendToClient('stateChange', { 
                from: lastState, 
                to: result.botState.state 
              });
              lastState = result.botState.state;
            }

            // Log quote every 10 ticks
            if (tickCounter % 10 === 0) {
              console.log(`   💹 Quote [${msg.S}]: $${msg.bp} x $${msg.ap} (M:${result.debugInfo.momentum}, V:${result.debugInfo.velocity})`);
            }

            // Send processed tick data to client
            sendToClient('tick', {
              tick: tick,
              botState: {
                momentum: result.debugInfo.momentum,
                velocity: result.debugInfo.velocity,
                state: result.debugInfo.state,
                unchangedTicks: result.debugInfo.unchangedTicks,
                historicalPeakPrice: botState.historicalPeakPrice
              }
            });

            // Handle trade signals
            if (result.tradeInfo) {
              console.log(`   🎯 ${result.tradeInfo.type} signal at $${result.tradeInfo.price.toFixed(3)} (M=${result.tradeInfo.momentum})`);
              
              if (result.tradeInfo.type === 'BUY') {
                sendToClient('trade', result.tradeInfo);
              } else if (result.tradeInfo.type === 'SELL') {
                sendToClient('trade', result.tradeInfo);
              }
            }
          } else if (msg.T === 't') {
            // Trade message
            console.log(`   🏷️  Trade [${msg.S}]: $${msg.p} x ${msg.s} shares`);
          } else if (msg.T === 'subscription') {
            console.log(`   ✓ Subscription confirmed for ${ticker}`);
            sendToClient('status', { message: `Subscribed to ${ticker}` });
          } else if (msg.msg) {
            console.log(`   ℹ️  Alpaca status: ${msg.msg}`);
            sendToClient('status', { message: msg.msg });
          }
        }
      }
    } catch (err) {
      console.error(`   ❌ Parse error: ${err.message}`);
      sendToClient('error', { message: `Parse error: ${err.message}` });
    }
  });

  alpacaWs.on('error', (error) => {
    console.error(`   ❌ Alpaca WebSocket error:`, error.message);
    sendToClient('error', { message: 'Alpaca connection error' });
  });

  alpacaWs.on('close', (code, reason) => {
    console.log(`   🔌 Alpaca WebSocket closed: ${code} ${reason.toString()}`);
    sendToClient('status', { message: 'Alpaca disconnected' });
    botStates.delete(clientWs);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  clientWs.on('close', () => {
    console.log(`   🔌 Client WebSocket closed`);
    botStates.delete(clientWs);
    if (alpacaWs) {
      alpacaWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error(`   ❌ Client WebSocket error:`, error.message);
  });
});

// API endpoint for Alpaca trading operations
app.post('/api/functions/alpacaStream', async (req, res) => {
  const { action, ticker, quantity } = req.body;
  
  console.log(`\n📤 API Request: ${action} for ${ticker}`);
  
  if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
    console.error('❌ Missing Alpaca credentials');
    return res.status(500).json({ error: 'Missing Alpaca credentials' });
  }

  try {
    if (action === 'placeOrder') {
      console.log(`   📈 Placing BUY order: ${quantity} shares of ${ticker}`);
      const response = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: ticker,
          qty: quantity,
          side: 'buy',
          type: 'market',
          time_in_force: 'day'
        })
      });

      const order = await response.json();
      if (!response.ok) {
        console.error(`   ❌ Order failed:`, order);
        return res.status(response.status).json({ error: order.message || 'Order failed', details: order });
      }
      console.log(`   ✅ BUY order placed successfully:`, order.id);
      return res.json({ success: true, order });
    }

    if (action === 'closePosition') {
      console.log(`   📉 Placing SELL order: ${quantity} shares of ${ticker}`);
      const response = await fetch(`${ALPACA_BASE_URL}/v2/orders`, {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: ticker,
          qty: quantity,
          side: 'sell',
          type: 'market',
          time_in_force: 'day'
        })
      });

      const order = await response.json();
      if (!response.ok) {
        console.error(`   ❌ Order failed:`, order);
        return res.status(response.status).json({ error: order.message || 'Order failed', details: order });
      }
      console.log(`   ✅ SELL order placed successfully:`, order.id);
      return res.json({ success: true, order });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('\n🚀 Alpaca Bot Server started!');
  console.log(`   Port: ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/api/functions/alpacaWebSocket`);
  console.log(`   API: http://localhost:${PORT}/api/functions/alpacaStream`);
  if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
    console.log(`   ⚠️  Alpaca credentials not configured - set ALPACA_API_KEY and ALPACA_API_SECRET`);
  } else {
    console.log(`   ✓ Alpaca credentials configured`);
  }
  console.log('');
});
