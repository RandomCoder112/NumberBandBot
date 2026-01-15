import React, { useState, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine } from 'recharts';

// Generate realistic small-cap tape data
function generateTapeData(basePrice = 4.20, durationSeconds = 60, ticksPerSecond = 8) {
  const ticks = [];
  const totalTicks = durationSeconds * ticksPerSecond;
  let price = basePrice;
  let spread = 0.08;
  
  // Pattern phases: sideways -> spike up -> dip -> stall -> bounce -> consolidate
  const phases = [
    { name: 'sideways', duration: 0.1, trend: 0, volatility: 0.02 },
    { name: 'spike_up', duration: 0.25, trend: 0.015, volatility: 0.04 },
    { name: 'dip', duration: 0.15, trend: -0.008, volatility: 0.03 },
    { name: 'stall', duration: 0.08, trend: 0, volatility: 0.005 },
    { name: 'bounce', duration: 0.12, trend: 0.012, volatility: 0.035 },
    { name: 'mini_dip', duration: 0.08, trend: -0.005, volatility: 0.02 },
    { name: 'stall2', duration: 0.06, trend: 0, volatility: 0.004 },
    { name: 'final_push', duration: 0.16, trend: 0.01, volatility: 0.03 },
  ];
  
  let currentTick = 0;
  let phaseStart = 0;
  
  for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
    const phase = phases[phaseIdx];
    const phaseEnd = phaseStart + Math.floor(totalTicks * phase.duration);
    
    while (currentTick < phaseEnd && currentTick < totalTicks) {
      // Add micro noise and trend
      const noise = (Math.random() - 0.5) * phase.volatility;
      const trendMove = phase.trend * (1 + (Math.random() - 0.5) * 0.5);
      price = Math.max(1, price + trendMove + noise);
      
      // Spread varies - tighter during stalls, wider during volatility
      if (phase.name.includes('stall')) {
        spread = 0.01 + Math.random() * 0.02;
      } else if (phase.name === 'spike_up' || phase.name === 'bounce') {
        spread = 0.05 + Math.random() * 0.15;
      } else {
        spread = 0.03 + Math.random() * 0.08;
      }
      
      const halfSpread = spread / 2;
      const bid = Math.round((price - halfSpread) * 100) / 100;
      const ask = Math.round((price + halfSpread) * 100) / 100;
      const mid = (bid + ask) / 2;
      
      // Volume varies by phase
      let volume = Math.floor(Math.random() * 500) + 100;
      if (phase.name === 'spike_up') volume *= 3;
      if (phase.name === 'bounce' || phase.name === 'final_push') volume *= 2;
      
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

// Bot logic - Number Theory Band
function runBotLogic(ticks, params) {
  const {
    minDipTicks = 4,
    stallVelocityThreshold = 0.15,
    stopLossTicks = 3,
    profitTargetPercent = 0.8,
    maxSpreadForEntry = 0.06,
    minMomentumForDip = 3
  } = params;
  
  const trades = [];
  const states = [];
  
  let momentum = 0;
  let prevMid = null;
  let state = 'IDLE';
  let dipStartTick = null;
  let position = null;
  let velocityHistory = [];
  
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const { mid, spread, bid, ask } = tick;
    
    // Calculate delta
    let delta = 0;
    if (prevMid !== null) {
      delta = mid - prevMid;
    }
    
    // Update momentum counter
    if (delta > 0.005) {
      momentum += 1;
    } else if (delta < -0.005) {
      momentum -= 1;
    }
    
    // Calculate velocity (rate of change)
    const velocity = delta;
    velocityHistory.push(velocity);
    if (velocityHistory.length > 5) velocityHistory.shift();
    
    const avgVelocity = velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length;
    
    // Check for consolidation (reset)
    let isConsolidating = velocityHistory.length >= 3 && 
      velocityHistory.every(v => Math.abs(v) < 0.01);
    
    if (isConsolidating && state !== 'HOLDING') {
      momentum = 0;
      state = 'IDLE';
      dipStartTick = null;
    }
    
    // State machine
    let action = null;
    
    if (state === 'IDLE') {
      if (momentum > minMomentumForDip) {
        state = 'BUILDING_UP';
      }
    } 
    else if (state === 'BUILDING_UP') {
      if (delta < -0.005) {
        state = 'DIPPING';
        dipStartTick = i;
      }
    } 
    else if (state === 'DIPPING') {
      const dipDuration = i - dipStartTick;
      const isSlowing = Math.abs(avgVelocity) < stallVelocityThreshold;
      const spreadOk = spread <= maxSpreadForEntry;
      
      if (dipDuration >= minDipTicks && isSlowing && spreadOk && !position) {
        // BUY
        position = { entryTick: i, entryPrice: ask, entryMid: mid };
        action = 'BUY';
        state = 'HOLDING';
        trades.push({
          type: 'BUY',
          tick: i,
          price: ask,
          time: tick.time
        });
      }
    } 
    else if (state === 'HOLDING' && position) {
      const pnlPercent = ((mid - position.entryMid) / position.entryMid) * 100;
      const ticksHeld = i - position.entryTick;
      
      // Exit conditions
      let shouldSell = false;
      let reason = '';
      
      // Profit target with slowdown
      if (pnlPercent > profitTargetPercent && avgVelocity < 0.01) {
        shouldSell = true;
        reason = 'PROFIT';
      }
      // Stop loss - price dropping
      else if (delta < -0.02 && ticksHeld > 1) {
        shouldSell = true;
        reason = 'STOP_QUICK';
      }
      // Stop loss - continued drop
      else if (pnlPercent < -0.5 && ticksHeld >= stopLossTicks) {
        shouldSell = true;
        reason = 'STOP_LOSS';
      }
      
      if (shouldSell) {
        action = 'SELL';
        const exitPrice = bid;
        const profit = exitPrice - position.entryPrice;
        trades.push({
          type: 'SELL',
          tick: i,
          price: exitPrice,
          time: tick.time,
          profit,
          profitPercent: ((exitPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2),
          reason
        });
        position = null;
        state = 'IDLE';
        momentum = 0;
        dipStartTick = null;
      }
    }
    
    states.push({
      tick: i,
      time: tick.time,
      mid,
      momentum,
      state,
      velocity: avgVelocity.toFixed(4),
      action,
      phase: tick.phase
    });
    
    prevMid = mid;
  }
  
  return { trades, states };
}

export default function HyperscalpSimulator() {
  const [tapeData, setTapeData] = useState(null);
  const [botResult, setBotResult] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  
  // Bot parameters
  const [params, setParams] = useState({
    minDipTicks: 4,
    stallVelocityThreshold: 0.15,
    stopLossTicks: 3,
    profitTargetPercent: 0.8,
    maxSpreadForEntry: 0.06,
    minMomentumForDip: 3
  });
  
  const runSimulation = useCallback(() => {
    setIsRunning(true);
    
    // Generate new tape data
    const tape = generateTapeData(4.20, 60, 10);
    setTapeData(tape);
    
    // Run bot logic
    const result = runBotLogic(tape, params);
    setBotResult(result);
    
    setIsRunning(false);
  }, [params]);
  
  // Prepare chart data
  const chartData = tapeData?.map((tick, idx) => {
    const stateInfo = botResult?.states[idx];
    const trade = botResult?.trades.find(t => t.tick === idx);
    
    return {
      tick: idx,
      time: parseFloat(tick.time),
      price: tick.mid,
      bid: tick.bid,
      ask: tick.ask,
      spread: tick.spread,
      momentum: stateInfo?.momentum || 0,
      state: stateInfo?.state,
      action: trade?.type,
      phase: tick.phase
    };
  });
  
  const buyTrades = botResult?.trades.filter(t => t.type === 'BUY') || [];
  const sellTrades = botResult?.trades.filter(t => t.type === 'SELL') || [];
  
  // Calculate totals
  const totalPnL = sellTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const winTrades = sellTrades.filter(t => t.profit > 0).length;
  const lossTrades = sellTrades.filter(t => t.profit <= 0).length;
  
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Hyperscalp Simulator</h1>
            <p className="text-gray-500 mt-1">Number Theory Band Strategy Test</p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={runSimulation}
              disabled={isRunning}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-6"
            >
              {isRunning ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Simulation
            </Button>
          </div>
        </div>
        
        {/* Parameters */}
        <Card className="bg-[#12121a] border-gray-800 p-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Bot Parameters</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
            <div>
              <Label className="text-gray-400 text-xs">Min Dip Ticks</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.minDipTicks]}
                  onValueChange={([v]) => setParams(p => ({...p, minDipTicks: v}))}
                  min={1} max={10} step={1}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">{params.minDipTicks}</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Stall Velocity</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.stallVelocityThreshold * 100]}
                  onValueChange={([v]) => setParams(p => ({...p, stallVelocityThreshold: v/100}))}
                  min={5} max={50} step={5}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">{params.stallVelocityThreshold}</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Stop Loss Ticks</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.stopLossTicks]}
                  onValueChange={([v]) => setParams(p => ({...p, stopLossTicks: v}))}
                  min={1} max={10} step={1}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">{params.stopLossTicks}</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Profit Target %</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.profitTargetPercent * 10]}
                  onValueChange={([v]) => setParams(p => ({...p, profitTargetPercent: v/10}))}
                  min={2} max={30} step={1}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">{params.profitTargetPercent}%</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Max Spread Entry</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.maxSpreadForEntry * 100]}
                  onValueChange={([v]) => setParams(p => ({...p, maxSpreadForEntry: v/100}))}
                  min={1} max={20} step={1}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">${params.maxSpreadForEntry}</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-400 text-xs">Min Momentum</Label>
              <div className="flex items-center gap-2 mt-2">
                <Slider
                  value={[params.minMomentumForDip]}
                  onValueChange={([v]) => setParams(p => ({...p, minMomentumForDip: v}))}
                  min={1} max={10} step={1}
                  className="flex-1"
                />
                <span className="text-emerald-400 font-mono w-8">{params.minMomentumForDip}</span>
              </div>
            </div>
          </div>
        </Card>
        
        {/* Chart */}
        {chartData && (
          <Card className="bg-[#12121a] border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Price Action</h3>
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  BUY
                </span>
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  SELL
                </span>
              </div>
            </div>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                  <XAxis 
                    dataKey="time" 
                    stroke="#374151"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={(v) => `${v}s`}
                  />
                  <YAxis 
                    domain={['auto', 'auto']}
                    stroke="#374151"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={(v) => `$${v.toFixed(2)}`}
                  />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: '#1f1f2e', 
                      border: '1px solid #374151',
                      borderRadius: '8px'
                    }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(value, name) => {
                      if (name === 'price') return [`$${value.toFixed(3)}`, 'Mid Price'];
                      if (name === 'momentum') return [value, 'Momentum'];
                      return [value, name];
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    dot={false}
                  />
                  {/* Buy markers */}
                  {buyTrades.map((trade, idx) => (
                    <ReferenceDot
                      key={`buy-${idx}`}
                      x={chartData[trade.tick]?.time}
                      y={chartData[trade.tick]?.price}
                      r={8}
                      fill="#10b981"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ))}
                  {/* Sell markers */}
                  {sellTrades.map((trade, idx) => (
                    <ReferenceDot
                      key={`sell-${idx}`}
                      x={chartData[trade.tick]?.time}
                      y={chartData[trade.tick]?.price}
                      r={8}
                      fill="#ef4444"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
        
        {/* Momentum Chart */}
        {chartData && (
          <Card className="bg-[#12121a] border-gray-800 p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Momentum Counter</h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                  <XAxis 
                    dataKey="time" 
                    stroke="#374151"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={(v) => `${v}s`}
                  />
                  <YAxis 
                    stroke="#374151"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                  />
                  <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: '#1f1f2e', 
                      border: '1px solid #374151',
                      borderRadius: '8px'
                    }}
                  />
                  <Line 
                    type="stepAfter" 
                    dataKey="momentum" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
        
        {/* Stats & Trade Log */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Stats */}
          <Card className="bg-[#12121a] border-gray-800 p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Performance</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Total P&L</span>
                <span className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${totalPnL.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Trades</span>
                <span className="text-xl font-semibold text-white">{sellTrades.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Win Rate</span>
                <span className="text-xl font-semibold text-emerald-400">
                  {sellTrades.length > 0 ? ((winTrades / sellTrades.length) * 100).toFixed(0) : 0}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-800">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-400 font-semibold">{winTrades} Wins</span>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-red-400 font-semibold">{lossTrades} Losses</span>
                </div>
              </div>
            </div>
          </Card>
          
          {/* Trade Log */}
          <Card className="bg-[#12121a] border-gray-800 p-6 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Trade Log</h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {botResult?.trades.length === 0 && (
                <p className="text-gray-600 text-center py-8">No trades executed in this simulation</p>
              )}
              {botResult?.trades.map((trade, idx) => (
                <div 
                  key={idx}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    trade.type === 'BUY' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20' 
                      : 'bg-red-500/10 border border-red-500/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${trade.type === 'BUY' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    <span className={`font-semibold ${trade.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.type}
                    </span>
                    <span className="text-gray-400">@ ${trade.price.toFixed(3)}</span>
                    <span className="text-gray-600 text-sm">t={trade.time}s</span>
                  </div>
                  {trade.profit !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className={`font-mono ${trade.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trade.profit >= 0 ? '+' : ''}{trade.profitPercent}%
                      </span>
                      <span className="text-gray-600 text-xs">({trade.reason})</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
        
        {/* Info */}
        <Card className="bg-[#12121a] border-gray-800 p-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">How It Works</h3>
          <p className="text-gray-500 text-sm leading-relaxed">
            This simulates your <span className="text-emerald-400">Number Theory Band</span> strategy. The bot tracks a momentum counter that increments on up-ticks and decrements on down-ticks. 
            After momentum builds positive, it watches for dips. When the dip slows down (velocity approaches zero) and the spread is tight, it buys. 
            It sells on profit target with slowdown, or cuts immediately if price drops after entry. Adjust parameters above and run multiple simulations to tune.
          </p>
        </Card>
      </div>
    </div>
  );
}