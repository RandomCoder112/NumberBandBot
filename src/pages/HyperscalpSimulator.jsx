import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Play, Pause, RotateCcw, HelpCircle, TrendingUp, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import { base44 } from "@/api/base44Client";

// Generate realistic small-cap tape data
function generateTapeData(basePrice = 4.20, durationSeconds = 90, ticksPerSecond = 12, options = {}) {
  const {
    suddenDips = false,
    randomization = 1.0,
    volatilityMultiplier = 1.0,
    maxPriceRange = 5.0,
    momentumSpeed = 1.0
  } = options;
  
  const ticks = [];
  const totalTicks = durationSeconds * ticksPerSecond;
  let price = basePrice;
  let spread = 0.08;
  
  // Pattern: sideways -> spike up -> dip -> stall -> bounce -> dip -> stall -> push
  const basePhases = [
    { name: 'sideways', duration: 0.10, trend: 0, volatility: 0.035 },
    { name: 'spike_up', duration: 0.15, trend: 0.018, volatility: 0.065 },
    { name: 'dip', duration: 0.15, trend: -0.015, volatility: 0.050 },
    { name: 'stall', duration: 0.08, trend: 0, volatility: 0.008 },
    { name: 'bounce', duration: 0.12, trend: 0.016, volatility: 0.055 },
    { name: 'mini_dip', duration: 0.12, trend: -0.010, volatility: 0.042 },
    { name: 'stall2', duration: 0.08, trend: 0, volatility: 0.010 },
    { name: 'final_push', duration: 0.10, trend: 0.014, volatility: 0.050 },
    { name: 'final_dip', duration: 0.10, trend: -0.012, volatility: 0.045 },
  ];
  
  // Apply randomization to phase durations
  const phases = basePhases.map(phase => ({
    ...phase,
    duration: phase.duration * (1 + (Math.random() - 0.5) * 0.3 * randomization),
    volatility: phase.volatility * volatilityMultiplier
  }));
  
  let currentTick = 0;
  let phaseStart = 0;
  
  for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
    const phase = phases[phaseIdx];
    const phaseEnd = phaseStart + Math.floor(totalTicks * phase.duration);
    
    while (currentTick < phaseEnd && currentTick < totalTicks) {
      // Add occasional fast spikes (small-cap chaos)
      const isFastMove = Math.random() < (0.08 * randomization);
      const fastMultiplier = isFastMove ? (Math.random() < 0.5 ? 2.5 : -1.8) : 1;
      
      // Sudden dips: if enabled, increase chance of sharp drops
      const isSuddenDip = suddenDips && phase.name.includes('dip') && Math.random() < 0.15;
      const dipMultiplier = isSuddenDip ? -2.5 : 1;
      
      const noise = (Math.random() - 0.5) * phase.volatility * (isFastMove ? 1.5 : 1);
      let trendMove = phase.trend * (1 + (Math.random() - 0.5) * 0.8 * randomization) * fastMultiplier * dipMultiplier * momentumSpeed;
      
      // Dampen downward moves when price is elevated to prevent deep drops
      const priceAboveBase = price - basePrice;
      if (priceAboveBase > 0.3 && trendMove < 0) {
        // Reduce downward momentum proportionally to how high we are
        const dampening = 1 - (priceAboveBase / (maxPriceRange > 0 ? maxPriceRange : 10)) * 0.7;
        trendMove *= Math.max(0.2, dampening);
      }
      
      let newPrice = price + trendMove + noise;
      
      // Constrain price within range if maxPriceRange is set
      if (maxPriceRange > 0) {
        const minPrice = basePrice - maxPriceRange;
        const maxPrice = basePrice + maxPriceRange;
        newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));
      }
      
      price = Math.max(1, newPrice);
      
      if (phase.name.includes('stall')) {
        spread = 0.01 + Math.random() * 0.025;
      } else if (phase.name === 'spike_up' || phase.name === 'bounce') {
        spread = 0.06 + Math.random() * 0.18;
      } else {
        spread = 0.03 + Math.random() * 0.12;
      }
      
      const halfSpread = spread / 2;
      const bid = Math.round((price - halfSpread) * 100) / 100;
      const ask = Math.round((price + halfSpread) * 100) / 100;
      const mid = (bid + ask) / 2;
      
      let volume = Math.floor(Math.random() * 600) + 150;
      if (phase.name === 'spike_up') volume *= (3 + Math.random() * 2);
      if (phase.name === 'bounce' || phase.name === 'final_push') volume *= (2 + Math.random() * 1.5);
      if (isFastMove) volume *= 1.8;
      
      ticks.push({
        tick: currentTick,
        time: (currentTick / ticksPerSecond).toFixed(2),
        bid,
        ask,
        mid,
        spread: Math.round(spread * 100) / 100,
        volume,
        phase: phase.name
      });
      
      currentTick++;
    }
    phaseStart = phaseEnd;
  }
  
  return ticks;
}

// NUMBER THEORY BAND BOT LOGIC - Exact implementation
// NUMBER THEORY BAND BOT LOGIC - Exact implementation
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
    historicalPeakPrice: 0, // Track highest price reached
    positionSize: 0, // Track position size: 0 = no position, 0.5 = half, 1.0 = full
    hasPartialExited: false, // Track if we already did a partial exit
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
    // Track peak momentum
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
  
  // Calculate velocity (rate of change in momentum) - THE SPEED
  const momentumDelta = botState.momentum - botState.prevMomentum;
  
  botState.velocityHistory.push(momentumDelta);
  if (botState.velocityHistory.length > 5) {
    botState.velocityHistory.shift();
  }
  
  // Calculate average velocity (for smoothing) - how fast the NUMBER is changing
  const avgVelocity = botState.velocityHistory.reduce((a, b) => a + b, 0) / 
                      (botState.velocityHistory.length || 1);
  
  // Check if price hasn't flushed (still above 50% of peak price)
  const notFlushed = botState.historicalPeakPrice > 0 && 
                     mid > (botState.historicalPeakPrice * 0.5);
  
  // Consolidation detection: Reset momentum to 0 if price unchanged for several ticks
  if (botState.unchangedTicks >= consolidationTicks && botState.state !== 'HOLDING') {
    botState.momentum = 0;
    botState.prevMomentum = 0;
    botState.peakMomentum = 0;

    // Keep watching for dips if price hasn't flushed
    if (notFlushed) {
      botState.state = 'BUILDING_UP';
    } else {
      // Price flushed down completely - now truly idle
      botState.state = 'IDLE';
      botState.historicalPeakPrice = 0;
    }

    botState.dipStartTick = null;
    botState.dipStartMomentum = null;
  }
  
  // STATE MACHINE
  if (botState.state === 'IDLE') {
    // Waiting for momentum to build positive (spike up)
    if (botState.momentum >= minMomentumForSpike) {
      botState.state = 'BUILDING_UP';
    }
  }
  else if (botState.state === 'BUILDING_UP') {
    // Spike detected, now watching for THE NUMBER to start going down
    // Watch for dip if momentum starts decreasing OR goes negative
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
    
    // "the bot will realize the speed of the dip is slowing down"
    // Speed = velocity = how fast the number is changing
    // Slowing down = velocity approaching 0 (was negative/decreasing, now near 0)
    const isSlowing = Math.abs(avgVelocity) < stallVelocityThreshold;
    
    // "after a good amount of miliseconds dropped in a good certain time"
    const droppedEnough = momentumDropped >= minDipMomentumDrop;
    const dipLongEnough = dipDuration >= minDipTicks;
    
    // Good fill condition
    const spreadOk = spread <= maxSpreadForEntry;
    
    // BUY when: dip has gone down enough, for long enough time, and is now stalling
    if (dipLongEnough && droppedEnough && isSlowing && spreadOk && !botState.position) {
      // BUY THE DIP
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
      // Go back to watching for dips if price hasn't flushed
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

    // EXIT 1: "sell into the number going up and stopping a bit"
    // Number went up after entry, now velocity is slowing/stopping
    if (momentumSinceEntry >= profitMomentumRise && Math.abs(avgVelocity) < stallVelocityThreshold) {
      shouldSell = true;
      reason = 'PROFIT_STALL';
      // If partial exits enabled and we haven't done one yet, only exit half
      if (botState.params.usePartialExits && !botState.hasPartialExited && botState.positionSize === 1.0) {
        isPartialExit = true;
      }
    }
    // EXIT 2: If we did partial exit, check if price drops after - exit remaining position
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
    // EXIT 3: "give it some room" - don't exit immediately, wait for sustained drop
    // Check if momentum has been consistently dropping (2+ ticks down)
    else if (botState.velocityHistory.length >= 2) {
      const recentVelocities = botState.velocityHistory.slice(-2);
      const sustainedDrop = recentVelocities.every(v => v < -0.3);
      if (sustainedDrop && momentumSinceEntry < -1) {
        shouldSell = true;
        reason = 'SUSTAINED_DROP';
      }
    }
    // EXIT 4: "if the number is going down more then some miliseconds after entry"
    // Momentum has dropped significantly from entry point - stop loss
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
        // Partial exit - keep half position
        botState.positionSize = 0.5;
        botState.hasPartialExited = true;
        // Stay in HOLDING state, update entry momentum for next exit calc
        botState.position.entryMomentum = botState.momentum;
      } else {
        // Full exit
        botState.position = null;
        botState.positionSize = 0;
        botState.hasPartialExited = false;

        if (reason === 'STOP_LOSS' || reason === 'SUSTAINED_DROP' || reason === 'DROP_AFTER_PARTIAL') {
          // If price hasn't flushed, immediately look for another dip
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
          // Profit taken, reset everything
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

export default function HyperscalpSimulator() {
  const [mode, setMode] = useState('simulator'); // 'simulator' or 'live'
  const [ticker, setTicker] = useState('AAPL');
  const [shareQty, setShareQty] = useState(100);
  const [botRunning, setBotRunning] = useState(false);
  
  const [tapeData, setTapeData] = useState(null);
  const [currentTick, setCurrentTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(50); // ms per tick
  const [trades, setTrades] = useState([]);
  const [currentState, setCurrentState] = useState(null);
  
  const botStateRef = useRef(null);
  const animationRef = useRef(null);
  const wsRef = useRef(null);
  const liveDataRef = useRef([]);
  
  const [params, setParams] = useState({
    minDipTicks: 5,
    stallVelocityThreshold: 0.12,
    stopLossMomentumDrop: 3,
    profitMomentumRise: 4,
    maxSpreadForEntry: 0.05,
    minMomentumForSpike: 5,
    consolidationTicks: 4,
    minDipMomentumDrop: 3,
    usePartialExits: false
  });
  
  const [tapeOptions, setTapeOptions] = useState({
    suddenDips: false,
    randomization: 1.0,
    volatilityMultiplier: 1.0,
    startingPrice: 4.20,
    maxPriceRange: 5.0, // Maximum price change from starting price
    momentumSpeed: 1.0 // Controls speed of momentum rise/fall
  });
  
  const generateNewTape = useCallback(() => {
    const tape = generateTapeData(tapeOptions.startingPrice, 90, 12, tapeOptions);
    setTapeData(tape);
    setCurrentTick(0);
    setTrades([]);
    setIsPlaying(false);
    botStateRef.current = initBotState(params);
  }, [params, tapeOptions]);
  
  useEffect(() => {
    generateNewTape();
  }, [generateNewTape]);
  
  useEffect(() => {
    if (isPlaying && tapeData && currentTick < tapeData.length) {
      animationRef.current = setTimeout(() => {
        const tick = tapeData[currentTick];
        const result = processTickForBot(botStateRef.current, tick);
        
        if (result.tradeInfo) {
          setTrades(prev => [...prev, result.tradeInfo]);
        }
        
        setCurrentState(result.debugInfo);
        setCurrentTick(prev => prev + 1);
      }, speed);
    } else if (currentTick >= (tapeData?.length || 0)) {
      setIsPlaying(false);
    }
    
    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [isPlaying, currentTick, tapeData, speed]);
  
  const togglePlayPause = () => {
    if (currentTick >= (tapeData?.length || 0)) {
      // Reset if finished
      setCurrentTick(0);
      setTrades([]);
      botStateRef.current = initBotState(params);
    }
    setIsPlaying(prev => !prev);
  };
  
  const reset = () => {
    setCurrentTick(0);
    setTrades([]);
    setIsPlaying(false);
    setBotRunning(false);
    botStateRef.current = initBotState(params);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    liveDataRef.current = [];
  };

  const startLiveMode = () => {
    if (!ticker || shareQty <= 0) return;

    setBotRunning(true);
    botStateRef.current = initBotState(params);
    liveDataRef.current = [];
    setTrades([]);

    // Connect to backend WebSocket proxy
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/functions/alpacaWebSocket?ticker=${ticker}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let lastBid = null;
    let lastAsk = null;
    let tickCounter = 0;

    ws.onopen = () => {
      console.log('Connected to live stream');
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'quote') {
        lastBid = data.bid;
        lastAsk = data.ask;

        const mid = (lastBid + lastAsk) / 2;
        const spread = lastAsk - lastBid;

        const tick = {
          tick: tickCounter++,
          time: new Date().toISOString(),
          bid: lastBid,
          ask: lastAsk,
          mid,
          spread,
          volume: data.bidSize + data.askSize
        };

        liveDataRef.current.push(tick);
        setTapeData([...liveDataRef.current]);

        // Process tick through bot
        const result = processTickForBot(botStateRef.current, tick);

        if (result.tradeInfo) {
          // Execute trade via Alpaca
          if (result.tradeInfo.type === 'BUY') {
            try {
              await base44.functions.invoke('alpacaStream', {
                action: 'placeOrder',
                ticker: ticker,
                quantity: shareQty
              });
            } catch (err) {
              console.error('Trade error:', err);
            }
          } else if (result.tradeInfo.type === 'SELL') {
            try {
              const size = result.tradeInfo.size === '50%' ? Math.floor(shareQty / 2) : shareQty;
              await base44.functions.invoke('alpacaStream', {
                action: 'closePosition',
                ticker: ticker,
                quantity: size
              });
            } catch (err) {
              console.error('Trade error:', err);
            }
          }

          setTrades(prev => [...prev, result.tradeInfo]);
        }

        setCurrentState(result.debugInfo);
        setCurrentTick(tickCounter);
      } else if (data.type === 'status') {
        console.log('Status:', data.message);
      } else if (data.type === 'error') {
        console.error('Stream error:', data.message);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setBotRunning(false);
    };

    ws.onclose = () => {
      setBotRunning(false);
    };
  };

  const stopLiveMode = () => {
    setBotRunning(false);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };
  
  // Prepare visible chart data
  const visibleData = tapeData?.slice(0, currentTick + 1).map((tick, idx) => ({
    tick: idx,
    time: parseFloat(tick.time),
    price: tick.mid,
    bid: tick.bid,
    ask: tick.ask
  })) || [];
  
  // Prepare tape display (last 15 ticks with direction)
  const recentTicks = tapeData?.slice(Math.max(0, currentTick - 14), currentTick + 1).map((tick, idx, arr) => {
    const prevTick = idx > 0 ? arr[idx - 1] : null;
    const direction = prevTick ? (tick.mid > prevTick.mid ? 'up' : tick.mid < prevTick.mid ? 'down' : 'flat') : 'flat';
    return { ...tick, direction };
  }).reverse() || [];
  
  const buyTrades = trades.filter(t => t.type === 'BUY');
  const sellTrades = trades.filter(t => t.type === 'SELL');
  
  const totalPnL = sellTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const winTrades = sellTrades.filter(t => t.profit > 0).length;
  const lossTrades = sellTrades.filter(t => t.profit <= 0).length;
  const winRate = sellTrades.length > 0 ? (winTrades / sellTrades.length * 100).toFixed(0) : 0;
  
  const currentPrice = tapeData?.[currentTick]?.mid || 0;
  const basePrice = tapeData?.[0]?.mid || 0;
  const priceChangePercent = basePrice ? (((currentPrice - basePrice) / basePrice) * 100).toFixed(2) : 0;
  const progress = tapeData ? (currentTick / tapeData.length * 100).toFixed(0) : 0;
  
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4">
        <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Number Theory Band
            </h1>
            <p className="text-slate-500 text-sm mt-1">Hyperscalp Strategy {mode === 'live' ? '- LIVE MODE' : 'Simulator'}</p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              <Label className="text-slate-400 text-xs">Mode:</Label>
              <Button 
                size="sm"
                onClick={() => { setMode('simulator'); reset(); }}
                className={`h-7 ${mode === 'simulator' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                Simulator
              </Button>
              <Button 
                size="sm"
                onClick={() => { setMode('live'); reset(); }}
                className={`h-7 ${mode === 'live' ? 'bg-cyan-600 hover:bg-cyan-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
              >
                Live
              </Button>
            </div>

            {mode === 'simulator' ? (
              <>
                <Button 
                  onClick={togglePlayPause}
                  className={`${isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'} px-6`}
                >
                  {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                  {isPlaying ? 'Pause' : currentTick === 0 ? 'Start' : 'Resume'}
                </Button>
                <Button onClick={reset} className="bg-slate-700 hover:bg-slate-600 text-slate-200 border-0">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
                <Button onClick={generateNewTape} className="bg-purple-600 hover:bg-purple-500 text-white border-0">
                  New Tape
                </Button>
              </>
            ) : (
              <>
                {!botRunning ? (
                  <Button 
                    onClick={startLiveMode}
                    className="bg-emerald-600 hover:bg-emerald-500 px-6"
                  >
                    <Activity className="w-4 h-4 mr-2" />
                    Start Bot
                  </Button>
                ) : (
                  <Button 
                    onClick={stopLiveMode}
                    className="bg-red-600 hover:bg-red-500 px-6"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    Stop Bot
                  </Button>
                )}
                <Button onClick={reset} className="bg-slate-700 hover:bg-slate-600 text-slate-200 border-0">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Live Mode Controls */}
        {mode === 'live' && (
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-400 text-xs mb-2 block">Ticker Symbol</Label>
                <Input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="bg-slate-900/50 border-slate-700 text-white"
                  disabled={botRunning}
                />
              </div>
              <div>
                <Label className="text-slate-400 text-xs mb-2 block">Share Quantity</Label>
                <Input
                  type="number"
                  value={shareQty}
                  onChange={(e) => setShareQty(parseInt(e.target.value) || 0)}
                  placeholder="100"
                  className="bg-slate-900/50 border-slate-700 text-white"
                  disabled={botRunning}
                />
              </div>
            </div>
            {botRunning && (
              <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                <Activity className="w-4 h-4 animate-pulse" />
                Bot is running on {ticker} with {shareQty} shares
              </div>
            )}
          </Card>
        )}
        
        {/* Progress Bar */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-slate-400">Progress: {progress}%</span>
            <span className="text-xs text-slate-400">Tick {currentTick} / {tapeData?.length || 0}</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
        
        {/* Live Stats Row */}
        <div className="grid grid-cols-7 gap-3">
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">Current Price</div>
            <div className="text-2xl font-bold text-emerald-400">${currentPrice.toFixed(3)}</div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">% from Base</div>
            <div className={`text-2xl font-bold ${
              priceChangePercent > 0 ? 'text-emerald-400' : 
              priceChangePercent < 0 ? 'text-red-400' : 'text-slate-400'
            }`}>
              {priceChangePercent > 0 ? '+' : ''}{priceChangePercent}%
            </div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">Momentum</div>
            <div className={`text-2xl font-bold ${
              currentState?.momentum > 0 ? 'text-emerald-400' : 
              currentState?.momentum < 0 ? 'text-red-400' : 'text-slate-400'
            }`}>
              {currentState?.momentum || 0}
            </div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">Peak Price</div>
            <div className="text-2xl font-bold text-purple-400">
              ${(botStateRef.current?.historicalPeakPrice || 0).toFixed(3)}
            </div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">State</div>
            <div className="text-sm font-semibold text-cyan-400">{currentState?.state || 'IDLE'}</div>
            <div className="text-xs text-slate-500 mt-1">v: {currentState?.velocity || '0.000'}</div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">P&L</div>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${totalPnL.toFixed(3)}
            </div>
          </Card>
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">Win Rate</div>
            <div className="text-2xl font-bold text-cyan-400">{winRate}%</div>
            <div className="text-xs text-slate-500 mt-1">{winTrades}W / {lossTrades}L</div>
          </Card>
        </div>
        
        {/* Chart and Tape */}
        <div className="grid grid-cols-[1fr_200px] gap-4">
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visibleData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <XAxis 
                  dataKey="time" 
                  stroke="#475569"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(v) => `${v}s`}
                />
                <YAxis 
                  domain={['auto', 'auto']}
                  stroke="#475569"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(v) => `$${v.toFixed(2)}`}
                />
                <RechartsTooltip
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #334155',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={false}
                />
                {buyTrades.map((trade, idx) => {
                  const dataPoint = visibleData.find(d => d.tick === trade.tick);
                  return dataPoint ? (
                    <ReferenceDot
                      key={`buy-${idx}`}
                      x={dataPoint.time}
                      y={dataPoint.price}
                      r={10}
                      fill="#10b981"
                      stroke="#fff"
                      strokeWidth={3}
                    />
                  ) : null;
                })}
                {sellTrades.map((trade, idx) => {
                  const dataPoint = visibleData.find(d => d.tick === trade.tick);
                  return dataPoint ? (
                    <ReferenceDot
                      key={`sell-${idx}`}
                      x={dataPoint.time}
                      y={dataPoint.price}
                      r={10}
                      fill="#ef4444"
                      stroke="#fff"
                      strokeWidth={3}
                    />
                  ) : null;
                })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      
      {/* Tape Display */}
      <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Live Tape</h3>
        <div className="space-y-1 h-[360px] overflow-y-auto">
          {recentTicks.map((tick, idx) => (
            <div 
              key={`tape-${tick.tick}`}
              className={`flex items-center justify-between px-2 py-1 rounded text-xs font-mono ${
                tick.direction === 'up' ? 'bg-emerald-500/20 text-emerald-400' :
                tick.direction === 'down' ? 'bg-red-500/20 text-red-400' :
                'bg-slate-700/30 text-slate-400'
              }`}
            >
              <span className="font-bold">${tick.mid.toFixed(3)}</span>
              <span className="text-[10px] text-slate-500">{tick.volume}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
        
        {/* Tape Generation Options - Only show in simulator mode */}
        {mode === 'simulator' && (
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Tape Generation</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Starting Price</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Base price at the start of the simulation</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[tapeOptions.startingPrice * 100]}
                  onValueChange={([v]) => setTapeOptions(p => ({...p, startingPrice: v/100}))}
                  min={100} max={2000} step={10}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-12">${(tapeOptions.startingPrice).toFixed(2)}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <Label className="text-slate-400 text-xs">Sudden Dips</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Add sharp random drops during dip phases</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  checked={tapeOptions.suddenDips}
                  onCheckedChange={(checked) => setTapeOptions(p => ({...p, suddenDips: checked}))}
                  disabled={isPlaying}
                />
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Randomization</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Controls variability in phase timing and moves</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[tapeOptions.randomization * 100]}
                  onValueChange={([v]) => setTapeOptions(p => ({...p, randomization: v/100}))}
                  min={0} max={200} step={10}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-10">{(tapeOptions.randomization * 100).toFixed(0)}%</span>
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Volatility</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Price movement intensity multiplier</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[tapeOptions.volatilityMultiplier * 100]}
                  onValueChange={([v]) => setTapeOptions(p => ({...p, volatilityMultiplier: v/100}))}
                  min={50} max={200} step={10}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-10">{(tapeOptions.volatilityMultiplier * 100).toFixed(0)}%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Price Range Limit</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Max price movement from start (0 = unlimited, parabolic)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[tapeOptions.maxPriceRange * 100]}
                  onValueChange={([v]) => setTapeOptions(p => ({...p, maxPriceRange: v/100}))}
                  min={0} max={500} step={10}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-12">{tapeOptions.maxPriceRange === 0 ? 'OFF' : `$${tapeOptions.maxPriceRange.toFixed(2)}`}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Momentum Speed</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Speed of price momentum rise and fall</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[tapeOptions.momentumSpeed * 100]}
                  onValueChange={([v]) => setTapeOptions(p => ({...p, momentumSpeed: v/100}))}
                  min={25} max={200} step={5}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-10">{(tapeOptions.momentumSpeed * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </Card>
        )}
        
        {/* Parameters */}
        <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Bot Parameters</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <Label className="text-slate-400 text-xs">Partial Exits</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Exit 50% on profit stall, keep rest until next stall or drop</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  checked={params.usePartialExits}
                  onCheckedChange={(checked) => setParams(p => ({...p, usePartialExits: checked}))}
                  disabled={isPlaying}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Min Dip Ticks</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Minimum time dip must last before entry</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.minDipTicks]}
                  onValueChange={([v]) => setParams(p => ({...p, minDipTicks: v}))}
                  min={2} max={20} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.minDipTicks}</span>
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Stall Velocity</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Max speed for detecting a stall (entry/exit signal)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.stallVelocityThreshold * 100]}
                  onValueChange={([v]) => setParams(p => ({...p, stallVelocityThreshold: v/100}))}
                  min={5} max={50} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-9">{params.stallVelocityThreshold.toFixed(2)}</span>
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Stop Loss Drop</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Momentum drop from entry to trigger stop loss</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.stopLossMomentumDrop]}
                  onValueChange={([v]) => setParams(p => ({...p, stopLossMomentumDrop: v}))}
                  min={1} max={15} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.stopLossMomentumDrop}</span>
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Profit Rise</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Momentum gain from entry to look for profit stall</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.profitMomentumRise]}
                  onValueChange={([v]) => setParams(p => ({...p, profitMomentumRise: v}))}
                  min={2} max={20} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.profitMomentumRise}</span>
              </div>
              </div>
              <div>
              <div className="flex items-center gap-1 mb-1">
                <Label className="text-slate-400 text-xs">Speed (ms/tick)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-slate-500 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Simulation playback speed</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[speed]}
                  onValueChange={([v]) => setSpeed(v)}
                  min={10} max={200} step={10}
                  className="flex-1"
                />
                <span className="text-cyan-400 font-mono text-sm w-10">{speed}ms</span>
              </div>
            </div>
          </div>
        </Card>
        
        {/* Trade Log */}
        <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Trade Log</h3>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {trades.length === 0 && (
              <p className="text-slate-600 text-center py-4 text-sm">No trades yet - waiting for signals...</p>
            )}
            {trades.slice().reverse().map((trade, idx) => (
              <div 
                key={trades.length - idx}
                className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                  trade.type === 'BUY' 
                    ? 'bg-emerald-500/10 border border-emerald-500/30' 
                    : 'bg-red-500/10 border border-red-500/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${trade.type === 'BUY' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                  <span className={`font-semibold ${trade.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trade.type}
                  </span>
                  <span className="text-slate-300">@ ${trade.price.toFixed(3)}</span>
                  <span className="text-slate-600 text-xs">t={trade.time}s</span>
                  <span className="text-slate-600 text-xs">M={trade.momentum}</span>
                </div>
                {trade.profit !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-semibold ${trade.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.profit >= 0 ? '+' : ''}{trade.profitPercent}%
                    </span>
                    {trade.size && <span className="text-cyan-400 text-xs font-semibold">{trade.size}</span>}
                    <span className="text-slate-500 text-xs">({trade.reason})</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
        
        {/* Info */}
        <Card className="bg-slate-800/50 border-slate-700/50 p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Number Theory Band Logic</h3>
          <p className="text-slate-500 text-xs leading-relaxed">
            <span className="text-emerald-400 font-semibold">Momentum counter</span>: +1 on up tick, -1 on down tick, resets to 0 on consolidation. 
            Bot waits for momentum to build (spike), then watches for dip. Buys when dip <span className="text-cyan-400">slows down</span> (velocity → 0) with tight spread. 
            Sells when momentum rises then stalls, or immediately if it drops after entry. Pure tick-based logic - no indicators.
          </p>
        </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}