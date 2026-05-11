"use client";

import React from 'react';
import { 
  Building2, Home, AlertCircle, DollarSign, 
  TrendingUp, Users, Search, Bell 
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';

// --- GHOST DATA (Hyper-Realistic for Rylexa) ---
const PORTFOLIO_DATA = [
  { name: 'Downtown Tower (Comm)', occupancy: 88, revenue: 125000, type: 'Commercial' },
  { name: 'Sunset Heights (Res)', occupancy: 96, revenue: 42000, type: 'Residential' },
  { name: 'Rylexa Ind. Park', occupancy: 100, revenue: 85000, type: 'Industrial' },
];

const RECENT_ALERTS = [
  { id: 1, title: 'HVAC Failure - Suite 404', property: 'Downtown Tower', type: 'critical', time: '14m ago' },
  { id: 2, title: 'Rent Past Due - Unit 12B', property: 'Sunset Heights', type: 'warning', time: '2h ago' },
  { id: 3, title: 'Lease Renewal Signed', property: 'Rylexa Ind. Park', type: 'success', time: '4h ago' },
];

const COLORS = ['#1e3a8a', '#10b981', '#6366f1']; // Rylexa Corporate Colors

export default function ExecutiveDashboard() {
  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      
      {/* 1. SIDEBAR NAVIGATION */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
          <span className="text-xl font-bold text-white tracking-tight">RYLEXA<span className="text-blue-500">.OS</span></span>
        </div>
        <nav className="flex-1 py-6 space-y-1">
          <NavItem icon={<TrendingUp size={20} />} label="Dashboard" active />
          <NavItem icon={<Building2 size={20} />} label="Commercial Props" />
          <NavItem icon={<Home size={20} />} label="Residential Props" />
          <div className="pt-6 pb-2 px-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Finance</div>
          <NavItem icon={<DollarSign size={20} />} label="Accounting" />
          <NavItem icon={<Users size={20} />} label="Tenants & Leases" />
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">RM</div>
            <div className="text-sm">
              <div className="text-white">Rylexa Admin</div>
              <div className="text-xs text-slate-500">Principal View</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col">
        
        {/* TOP HEADER */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <div className="flex items-center gap-4 text-slate-500 bg-slate-100 px-4 py-2 rounded-lg w-96">
            <Search size={18} />
            <input type="text" placeholder="Search properties, tenants, or invoices..." className="bg-transparent border-none outline-none text-sm w-full" />
          </div>
          <div className="flex items-center gap-6">
            <button className="relative text-slate-500 hover:text-slate-700">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        {/* DASHBOARD CONTENT */}
        <div className="p-8 overflow-y-auto">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Portfolio Overview</h1>
              <p className="text-slate-500 mt-1">Real-time metrics across Commercial & Residential assets.</p>
            </div>
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-50">Export Report</button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 shadow-sm">Add Property</button>
            </div>
          </div>

          {/* KPI METRICS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <KpiCard label="Total Revenue (MTD)" value="$252,000" trend="+12% vs last month" trendUp />
            <KpiCard label="Occupancy Rate" value="94.2%" trend="-1.5% due to Downtown Reno" trendUp={false} />
            <KpiCard label="Open Maintenance" value="8 Active" trend="2 Emergency" neutral />
            <KpiCard label="Arrears (>30 Days)" value="$12,450" trend="Commercial Tenant 104" trendUp={false} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* CHART: REVENUE MIX */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-semibold mb-6">Revenue Mix by Asset</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={PORTFOLIO_DATA}>
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value/1000}k`} />
                    <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]} barSize={50}>
                      {PORTFOLIO_DATA.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CRITICAL ALERTS FEED */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Live Alerts</h3>
                <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full">3 New</span>
              </div>
              <div className="space-y-4">
                {RECENT_ALERTS.map((alert) => (
                  <div key={alert.id} className="flex gap-4 p-3 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-100 cursor-pointer">
                    <div className={`mt-1 ${alert.type === 'critical' ? 'text-red-500' : alert.type === 'warning' ? 'text-amber-500' : 'text-green-500'}`}>
                      <AlertCircle size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800">{alert.title}</h4>
                      <div className="text-xs text-slate-500 mt-1">{alert.property} • {alert.time}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-6 py-2 text-sm text-blue-600 font-medium hover:text-blue-700 border border-blue-100 rounded hover:bg-blue-50 transition-colors">
                View All Notifications
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

// --- SUB-COMPONENTS ---
function NavItem({ icon, label, active = false }: { icon: any, label: string, active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-6 py-3 cursor-pointer border-l-4 transition-colors ${active ? 'bg-slate-800 border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}>
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function KpiCard({ label, value, trend, trendUp, neutral = false }: any) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-slate-500 text-sm font-medium mb-2">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mb-2">{value}</div>
      <div className={`text-xs font-medium flex items-center gap-1 ${neutral ? 'text-slate-500' : trendUp ? 'text-green-600' : 'text-red-600'}`}>
        {neutral ? '•' : trendUp ? '↑' : '↓'} {trend}
      </div>
    </div>
  );
}