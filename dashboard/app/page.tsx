"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Area, AreaChart } from "recharts";
import { protocolColors, protocols } from "@/lib/constants";
import { Activity, TrendingUp, DollarSign, Clock, Zap, Database, Shield, BarChart3 } from "lucide-react";

// Import data from data folder
import performanceData from "@/data/performance-metrics.json";
import efficiencyData from "@/data/efficiency-metrics.json";
import timeSeriesData from "@/data/time-series-data.json";

export default function Home() {
  // Transform data for charts
  const throughputData = performanceData.throughput.data;
  const tpsData = performanceData.tps.data;
  const costData = performanceData.costPerMB.data;
  const latencyData = performanceData.latency.data;
  
  // Radar chart data for efficiency comparison
  const radarData = protocols.map(protocol => {
    const throughput = performanceData.throughput.data.find(d => d.protocol === protocol)?.value || 0;
    const tps = performanceData.tps.data.find(d => d.protocol === protocol)?.value || 0;
    const cost = performanceData.costPerMB.data.find(d => d.protocol === protocol)?.value || 0;
    const latency = performanceData.latency.data.find(d => d.protocol === protocol)?.value || 0;
    
    return {
      protocol,
      throughput: Math.round((throughput / 40) * 100), // Normalize to 100
      tps: Math.round((tps / 5000) * 100),
      cost: Math.round((1 - cost / 0.005) * 100), // Invert (lower is better)
      latency: Math.round((1 - latency / 25) * 100), // Invert (lower is better)
    };
  });

  // Time series for trends
  const trendData = timeSeriesData.timestamps.map((date, i) => ({
    date: date.split('-')[2], // Just day
    Polkadot: timeSeriesData.throughputOverTime.polkadot[i],
    Celestia: timeSeriesData.throughputOverTime.celestia[i],
    Espresso: timeSeriesData.throughputOverTime.espresso[i],
    NEAR: timeSeriesData.throughputOverTime.near[i],
    Avail: timeSeriesData.throughputOverTime.avail[i],
  })).slice(-15); // Last 15 days

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Header with Gradient */}
      <div className="border-b border-zinc-800 bg-gradient-to-r from-black via-zinc-900 to-black relative overflow-hidden">
        {/* Animated background gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 animate-pulse opacity-50" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
                <h1 className="text-4xl font-bold">
                  <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                    DAx
                  </span>
                  <span className="text-zinc-400 text-2xl ml-2">by Chainscore</span>
                </h1>
              </div>
              <p className="text-zinc-400 text-sm">
                Real-time Data Availability Protocol Analytics & Benchmarking
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="text-xs text-zinc-500">Active Protocols</div>
                <div className="text-xl font-bold text-white">5</div>
              </div>
              <div className="px-4 py-2 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="text-xs text-zinc-500">Data Points</div>
                <div className="text-xl font-bold text-white">150K+</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Metrics Overview - Enhanced Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="bg-gradient-to-br from-blue-950/50 to-blue-900/30 border-blue-800/50 backdrop-blur-sm hover:border-blue-600/50 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-200">Best Throughput</CardTitle>
              <Activity className="h-5 w-5 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-100">
                {throughputData.find(d => d.protocol === "Avail")?.value} <span className="text-lg text-blue-400">MB/s</span>
              </div>
              <p className="text-xs text-blue-300 mt-2 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Avail leads performance
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-950/50 to-purple-900/30 border-purple-800/50 backdrop-blur-sm hover:border-purple-600/50 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-purple-200">Highest TPS</CardTitle>
              <Zap className="h-5 w-5 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-100">
                {tpsData.find(d => d.protocol === "Avail")?.value.toLocaleString()}
              </div>
              <p className="text-xs text-purple-300 mt-2">Transactions per second</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-950/50 to-green-900/30 border-green-800/50 backdrop-blur-sm hover:border-green-600/50 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-200">Lowest Cost</CardTitle>
              <DollarSign className="h-5 w-5 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-100">
                ${costData.find(d => d.protocol === "Avail")?.value}
              </div>
              <p className="text-xs text-green-300 mt-2">Per MB (Avail)</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-950/50 to-orange-900/30 border-orange-800/50 backdrop-blur-sm hover:border-orange-600/50 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-orange-200">Fastest Latency</CardTitle>
              <Clock className="h-5 w-5 text-orange-400" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-100">
                {latencyData.find(d => d.protocol === "NEAR")?.value}<span className="text-lg text-orange-400">s</span>
              </div>
              <p className="text-xs text-orange-300 mt-2">NEAR block finality</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Throughput Comparison */}
          <Card className="bg-zinc-950/50 border-zinc-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Throughput Comparison</CardTitle>
              <CardDescription className="text-zinc-400">Maximum data transmission rates (MB/s)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={throughputData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="protocol" stroke="#71717a" />
                  <YAxis stroke="#71717a" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #3f3f46',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {throughputData.map((entry, index) => (
                      <Bar key={`bar-${index}`} fill={protocolColors[entry.protocol as keyof typeof protocolColors]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cost per MB */}
          <Card className="bg-zinc-950/50 border-zinc-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Cost Efficiency</CardTitle>
              <CardDescription className="text-zinc-400">Cost per megabyte (USD/MB)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="protocol" stroke="#71717a" />
                  <YAxis stroke="#71717a" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #3f3f46',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {costData.map((entry, index) => (
                      <Bar key={`bar-${index}`} fill={protocolColors[entry.protocol as keyof typeof protocolColors]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Performance Radar & Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Performance Radar */}
          <Card className="bg-zinc-950/50 border-zinc-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Multi-Metric Performance</CardTitle>
              <CardDescription className="text-zinc-400">Normalized comparison across key metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#3f3f46" />
                  <PolarAngleAxis dataKey="protocol" stroke="#71717a" tick={{ fill: '#a1a1aa' }} />
                  <PolarRadiusAxis stroke="#71717a" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #3f3f46',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Radar name="Throughput" dataKey="throughput" stroke={protocolColors.Polkadot} fill={protocolColors.Polkadot} fillOpacity={0.5} />
                  <Radar name="TPS" dataKey="tps" stroke={protocolColors.Celestia} fill={protocolColors.Celestia} fillOpacity={0.5} />
                  <Radar name="Cost" dataKey="cost" stroke={protocolColors.NEAR} fill={protocolColors.NEAR} fillOpacity={0.5} />
                  <Radar name="Latency" dataKey="latency" stroke={protocolColors.Avail} fill={protocolColors.Avail} fillOpacity={0.5} />
                  <Legend wrapperStyle={{ color: '#fff' }} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Throughput Trends */}
          <Card className="bg-zinc-950/50 border-zinc-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Throughput Trends (15 Days)</CardTitle>
              <CardDescription className="text-zinc-400">Performance over time (MB/s)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={trendData}>
                  <defs>
                    {protocols.map(protocol => (
                      <linearGradient key={protocol} id={`color${protocol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={protocolColors[protocol]} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={protocolColors[protocol]} stopOpacity={0}/>
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#a1a1aa' }} />
                  <YAxis stroke="#71717a" tick={{ fill: '#a1a1aa' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#18181b', 
                      border: '1px solid #3f3f46',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Legend wrapperStyle={{ color: '#fff' }} />
                  {protocols.map(protocol => (
                    <Area 
                      key={protocol}
                      type="monotone" 
                      dataKey={protocol} 
                      stroke={protocolColors[protocol]} 
                      strokeWidth={2}
                      fillOpacity={1}
                      fill={`url(#color${protocol})`}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Protocol Cards */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-2">
            <Database className="h-6 w-6 text-blue-400" />
            Protocol Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {protocols.map(protocol => {
              const perf = performanceData.throughput.data.find(d => d.protocol === protocol);
              const efficiency = efficiencyData.latencyEfficiency.data.find(d => d.protocol === protocol);
              
              return (
                <Card 
                  key={protocol} 
                  className="bg-zinc-950/50 border-zinc-800 hover:border-zinc-700 transition-all duration-300 group hover:transform hover:scale-105"
                  style={{ borderLeftWidth: '3px', borderLeftColor: protocolColors[protocol] }}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <div 
                        className="w-3 h-3 rounded-full animate-pulse" 
                        style={{ backgroundColor: protocolColors[protocol] }} 
                      />
                      {protocol}
                    </CardTitle>
                    <CardDescription className="text-zinc-400">
                      <span 
                        className="px-2 py-1 rounded text-xs font-semibold"
                        style={{ 
                          backgroundColor: `${protocolColors[protocol]}20`,
                          color: protocolColors[protocol]
                        }}
                      >
                        {efficiency?.rating || 'N/A'}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-zinc-400">Throughput:</span>
                        <span className="font-semibold text-white">{perf?.value} MB/s</span>
                      </div>
                      <div className="w-full bg-zinc-800 rounded-full h-2">
                        <div 
                          className="h-2 rounded-full transition-all duration-500"
                          style={{ 
                            width: `${(perf?.value || 0) / 40 * 100}%`,
                            backgroundColor: protocolColors[protocol]
                          }}
                        />
                      </div>
                      
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Latency:</span>
                        <span className="font-semibold text-white">
                          {performanceData.latency.data.find(d => d.protocol === protocol)?.value}s
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Cost/MB:</span>
                        <span className="font-semibold text-green-400">
                          ${performanceData.costPerMB.data.find(d => d.protocol === protocol)?.value}
                        </span>
                      </div>
                      
                      <div className="pt-3 border-t border-zinc-800 flex justify-between text-sm">
                        <span className="text-zinc-400">Performance:</span>
                        <span className="font-semibold" style={{ color: protocolColors[protocol] }}>
                          {efficiency?.percentile}th percentile
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-8 border-t border-zinc-800">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-zinc-500" />
            <p className="text-sm text-zinc-500">
              Data based on 30-day benchmarking period • Last updated: {performanceData.metadata.generatedAt}
            </p>
          </div>
          <p className="text-sm text-zinc-600 flex items-center justify-center gap-2">
            <span className="font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              DAx
            </span>
            <span>by</span>
            <span className="font-semibold text-zinc-400">Chainscore Labs</span>
            <span className="text-zinc-700">•</span>
            <span className="text-zinc-600">DA Protocol Research</span>
          </p>
        </div>
      </div>
    </main>
  );
}

