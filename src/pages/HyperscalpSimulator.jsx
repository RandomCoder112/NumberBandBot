import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, Pause, RotateCcw, TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';

// Generate realistic small-cap tape data
function generateTapeData(basePrice = 4.20, durationSeconds = 60, ticksPerSecond = 10) {
  const ticks = [];
  const totalTicks = durationSeconds * ticksPerSecond;
  let price = basePrice;
  let spread = 0.08;
  
  // Pattern: sideways -> spike up -> dip -> stall -> bounce -> dip -> stall -> push
  const phases = [
    { name: 'sideways', duration: 0.08, trend: 0, volatility: 0.035 },
    { name: 'spike_up', duration: 0.22, trend: 0.025, volatility: 0.075 },
    { name: 'dip', duration: 0.12, trend: -0.018, volatility: 0.055 },
    { name: 'stall', duration: 0.06, trend: 0, volatility: 0.008 },
    { name: 'bounce', duration: 0.15, trend: 0.020, volatility: 0.065 },
    { name: 'mini_dip', duration: 0.10, trend: -0.012, volatility: 0.045 },
    { name: 'stall2', duration: 0.05, trend: 0, volatility: 0.010 },
    { name: 'final_push', duration: 0.12, trend: 0.018, volatility: 0.058 },
    { name: 'final_dip', duration: 0.10, trend: -0.014, volatility: 0.050 },
  ];
  
  let currentTick = 0;
  let phaseStart = 0;
  
  for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
    const phase = phases[phaseIdx];
    const phaseEnd = phaseStart + Math.floor(totalTicks * phase.duration);
    
    while (currentTick < phaseEnd && currentTick < totalTicks) {
      // Add occasional fast spikes (small-cap chaos)
      const isFastMove = Math.random() < 0.08;
      const fastMultiplier = isFastMove ? (Math.random() < 0.5 ? 2.5 : -1.8) : 1;
      
      const noise = (Math.random() - 0.5) * phase.volatility * (isFastMove ? 1.5 : 1);
      const trendMove = phase.trend * (1 + (Math.random() - 0.5) * 0.8) * fastMultiplier;
      price = Math.max(1, price + trendMove + noise);
      
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
    historicalPeakMomentum: 0,
    surgeStartPrice: null, // Track price when momentum surge started
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
  
  // Calculate velocity (rate of change in momentum) - THE SPEED
  const momentumDelta = botState.momentum - botState.prevMomentum;
  
  botState.velocityHistory.push(momentumDelta);
  if (botState.velocityHistory.length > 5) {
    botState.velocityHistory.shift();
  }
  
  // Calculate average velocity (for smoothing) - how fast the NUMBER is changing
  const avgVelocity = botState.velocityHistory.reduce((a, b) => a + b, 0) / 
                      (botState.velocityHistory.length || 1);
  
  // Consolidation detection: Reset momentum to 0 if price unchanged for several ticks
  if (botState.unchangedTicks >= consolidationTicks && botState.state !== 'HOLDING') {
    // Save historical peak before resetting
    if (botState.peakMomentum > botState.historicalPeakMomentum) {
      botState.historicalPeakMomentum = botState.peakMomentum;
    }
    
    botState.momentum = 0;
    botState.prevMomentum = 0;
    botState.peakMomentum = 0;
    
    // If historical momentum was strong, keep watching for dips
    if (botState.historicalPeakMomentum >= minMomentumForSpike) {
      botState.state = 'BUILDING_UP';
    } else {
      botState.state = 'IDLE';
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
    // "when that number is starting to go down this is a dip"
    // OR if momentum already negative but historical data shows strong surge (50%+ of peak)
    const hasStrongHistory = botState.historicalPeakMomentum > 0 && 
                             Math.abs(botState.momentum) >= (botState.historicalPeakMomentum * 0.5);
    
    if ((botState.momentum < botState.prevMomentum && botState.momentum >= 0) || 
        (botState.momentum < 0 && hasStrongHistory)) {
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
      botState.state = 'IDLE';
      botState.dipStartTick = null;
      botState.dipStartMomentum = null;
    }
  }
  else if (botState.state === 'HOLDING' && botState.position) {
    const momentumSinceEntry = botState.momentum - botState.position.entryMomentum;
    const pnl = mid - botState.position.entryMid;
    const pnlPercent = (pnl / botState.position.entryMid) * 100;
    
    let shouldSell = false;
    let reason = '';
    
    // EXIT 1: "sell into the number going up and stopping a bit"
    // Number went up after entry, now velocity is slowing/stopping
    if (momentumSinceEntry >= profitMomentumRise && Math.abs(avgVelocity) < stallVelocityThreshold) {
      shouldSell = true;
      reason = 'PROFIT_STALL';
    }
    // EXIT 2: "give it some room" - don't exit immediately, wait for sustained drop
    // Check if momentum has been consistently dropping (2+ ticks down)
    else if (botState.velocityHistory.length >= 2) {
      const recentVelocities = botState.velocityHistory.slice(-2);
      const sustainedDrop = recentVelocities.every(v => v < -0.3);
      if (sustainedDrop && momentumSinceEntry < -1) {
        shouldSell = true;
        reason = 'SUSTAINED_DROP';
      }
    }
    // EXIT 3: "if the number is going down more then some miliseconds after entry"
    // Momentum has dropped significantly from entry point - stop loss
    if (momentumSinceEntry < -stopLossMomentumDrop) {
      shouldSell = true;
      reason = 'STOP_LOSS';
    }
    
    if (shouldSell) {
      const exitPrice = bid;
      const profit = exitPrice - botState.position.entryPrice;
      action = 'SELL';
      tradeInfo = {
        type: 'SELL',
        tick: tick.tick,
        price: exitPrice,
        time: tick.time,
        profit,
        profitPercent: pnlPercent.toFixed(2),
        reason,
        momentum: botState.momentum
      };
      
      // After exit, look for next entry opportunity
      botState.position = null;
      if (reason === 'STOP_LOSS' || reason === 'SUSTAINED_DROP') {
        // Check if historical momentum was strong enough to keep looking
        const stillStrong = botState.historicalPeakMomentum >= minMomentumForSpike;
        if (stillStrong) {
          // Still dipping, look for next consolidation/entry
          botState.state = 'BUILDING_UP';
        } else {
          botState.state = 'IDLE';
          botState.momentum = 0;
          botState.prevMomentum = 0;
          botState.peakMomentum = 0;
          botState.historicalPeakMomentum = 0;
        }
      } else {
        // Profit taken, reset
        botState.state = 'IDLE';
        botState.momentum = 0;
        botState.prevMomentum = 0;
        botState.peakMomentum = 0;
        botState.historicalPeakMomentum = 0;
      }
      botState.dipStartTick = null;
      botState.dipStartMomentum = null;
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
  const [tapeData, setTapeData] = useState(null);
  const [currentTick, setCurrentTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(50); // ms per tick
  const [trades, setTrades] = useState([]);
  const [currentState, setCurrentState] = useState(null);
  
  const botStateRef = useRef(null);
  const animationRef = useRef(null);
  
  const [params, setParams] = useState({
    minDipTicks: 5,
    stallVelocityThreshold: 0.12,
    stopLossMomentumDrop: 3,
    profitMomentumRise: 4,
    maxSpreadForEntry: 0.05,
    minMomentumForSpike: 5,
    consolidationTicks: 4,
    minDipMomentumDrop: 3
  });
  
  const generateNewTape = useCallback(() => {
    const tape = generateTapeData(4.20, 60, 10);
    setTapeData(tape);
    setCurrentTick(0);
    setTrades([]);
    setIsPlaying(false);
    botStateRef.current = initBotState(params);
  }, [params]);
  
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
    botStateRef.current = initBotState(params);
  };
  
  // Prepare visible chart data
  const visibleData = tapeData?.slice(0, currentTick + 1).map((tick, idx) => ({
    tick: idx,
    time: parseFloat(tick.time),
    price: tick.mid,
    bid: tick.bid,
    ask: tick.ask
  })) || [];
  
  const buyTrades = trades.filter(t => t.type === 'BUY');
  const sellTrades = trades.filter(t => t.type === 'SELL');
  
  const totalPnL = sellTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const winTrades = sellTrades.filter(t => t.profit > 0).length;
  const lossTrades = sellTrades.filter(t => t.profit <= 0).length;
  const winRate = sellTrades.length > 0 ? (winTrades / sellTrades.length * 100).toFixed(0) : 0;
  
  const currentPrice = tapeData?.[currentTick]?.mid || 0;
  const progress = tapeData ? (currentTick / tapeData.length * 100).toFixed(0) : 0;
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4">
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Number Theory Band
            </h1>
            <p className="text-slate-500 text-sm mt-1">Hyperscalp Strategy Simulator</p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={togglePlayPause}
              className={`${isPlaying ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'} px-6`}
            >
              {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              {isPlaying ? 'Pause' : currentTick === 0 ? 'Start' : 'Resume'}
            </Button>
            <Button onClick={reset} variant="outline" className="border-slate-700">
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button onClick={generateNewTape} variant="outline" className="border-slate-700">
              New Tape
            </Button>
          </div>
        </div>
        
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
        <div className="grid grid-cols-5 gap-3">
          <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
            <div className="text-xs text-slate-400 mb-1">Current Price</div>
            <div className="text-2xl font-bold text-emerald-400">${currentPrice.toFixed(3)}</div>
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
        
        {/* Chart */}
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
                <Tooltip
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
        
        {/* Parameters */}
        <Card className="bg-slate-800/80 border-slate-700 p-4 backdrop-blur">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Bot Parameters</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-slate-400 text-xs">Min Dip Ticks</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.minDipTicks]}
                  onValueChange={([v]) => setParams(p => ({...p, minDipTicks: v}))}
                  min={2} max={12} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.minDipTicks}</span>
              </div>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Stall Velocity</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.stallVelocityThreshold * 100]}
                  onValueChange={([v]) => setParams(p => ({...p, stallVelocityThreshold: v/100}))}
                  min={5} max={30} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-9">{params.stallVelocityThreshold.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Stop Loss Drop</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.stopLossMomentumDrop]}
                  onValueChange={([v]) => setParams(p => ({...p, stopLossMomentumDrop: v}))}
                  min={1} max={8} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.stopLossMomentumDrop}</span>
              </div>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Profit Rise</Label>
              <div className="flex items-center gap-2 mt-1">
                <Slider
                  value={[params.profitMomentumRise]}
                  onValueChange={([v]) => setParams(p => ({...p, profitMomentumRise: v}))}
                  min={2} max={10} step={1}
                  className="flex-1"
                  disabled={isPlaying}
                />
                <span className="text-emerald-400 font-mono text-sm w-6">{params.profitMomentumRise}</span>
              </div>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Speed (ms/tick)</Label>
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
  );
}