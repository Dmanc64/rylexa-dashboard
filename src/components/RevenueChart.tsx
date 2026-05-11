'use client'

import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts'

export default function RevenueChart({ data }: { data: any[] }) {
  // Fallback if data is empty (prevents white screen)
  const chartData = data && data.length > 0 ? data : [
    { month: 'Jan', income: 0, expense: 0 }
  ]

  return (
    // FIX: 'min-h-0' and 'min-w-0' prevents flexbox overflow issues
    <div className="h-full w-full bg-white p-4 rounded-xl flex flex-col min-h-0 min-w-0">
      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 shrink-0">
          Net Operating Income (YTD)
      </h3>
      
      {/* FIX: explicit height calc or flex-1 is required. 
        Using flex-1 with min-h-0 guarantees it takes available space.
      */}
      <div className="flex-1 min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
                dataKey="month" 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#94a3b8', fontSize: 12}} 
                dy={10}
            />
            <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{fill: '#94a3b8', fontSize: 12}} 
                tickFormatter={(value) => `$${value / 1000}k`}
            />
            <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                // NEW (Working):
                formatter={(value: number | undefined) => [`$${(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Revenue']}
            />
            <Area 
                type="monotone" 
                dataKey="income" 
                stroke="#3b82f6" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorIncome)" 
                activeDot={{ r: 6, strokeWidth: 0 }}
            />
            </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}