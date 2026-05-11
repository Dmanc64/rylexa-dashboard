'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, DollarSign,
  PieChart, ArrowUpRight, ArrowRight,
  Activity, Loader2, Banknote, Calculator, FileText, Wrench, Zap, BarChart3, Landmark
} from 'lucide-react'
import { useFinancials, type DateView, type DateRange } from '@/hooks/useFinancials'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function FinanceDashboard() {
  const [view, setView] = useState<DateView>('YTD')
  const [customRange, setCustomRange] = useState<DateRange>({ start: '', end: '' })
  const { metrics, aggregate, maintenanceExpenses, loading } = useFinancials(view, customRange)
  const { isEnabled } = useFeatureFlags()

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Financial <span className="text-emerald-600">Performance</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            Portfolio P&L • {view === 'Custom' && customRange.start ? `${customRange.start} — ${customRange.end}` : `${view} To Date`}
          </p>
        </div>
        
        <div className="flex flex-col items-end gap-2">
            <div className="bg-white p-1 rounded-xl border border-slate-200 flex shadow-sm">
              {(['Month', 'Quarter', 'YTD', 'Custom'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                    view === v ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {view === 'Custom' && (
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-1">
                <input
                  type="date"
                  value={customRange.start}
                  onChange={e => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                  className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-[10px] font-black text-slate-300 uppercase">to</span>
                <input
                  type="date"
                  value={customRange.end}
                  onChange={e => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                  className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}
        </div>
      </div>

      {/* QUICK ACTIONS ROW */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
         <ActionCard
            title="Billing"
            desc="Rent, Utilities & Late Fees"
            icon={<Zap size={24} />}
            href="/admin/finance/billing"
            color="bg-emerald-600"
         />
         <ActionCard
            title="Statements"
            desc="Tenant Billing History"
            icon={<Calculator size={24} />}
            href="/admin/finance/statements"
            color="bg-amber-600"
         />
         <ActionCard
            title="Distributions"
            desc="Process Owner Payouts"
            icon={<Banknote size={24} />}
            href="/admin/finance/distributions"
            color="bg-indigo-600"
         />
         <ActionCard
            title="Reconciliation"
            desc="Match Bank Transactions"
            icon={<Activity size={24} />}
            href="/admin/finance/reconcile"
            color="bg-slate-700"
         />
         <ActionCard
            title="Payroll Export"
            desc="Hours & Contractor Logs"
            icon={<FileText size={24} />}
            href="/admin/finance/payroll"
            color="bg-blue-600"
         />
         {isEnabled('budgeting') && (
           <ActionCard
             title="Budgets"
             desc="Budget vs Actuals & Forecasting"
             icon={<BarChart3 size={24} />}
             href="/admin/finance/budgets"
             color="bg-violet-600"
           />
         )}
         {isEnabled('tax_forms') && (
           <ActionCard
             title="Tax Forms"
             desc="1099-NEC & 1099-MISC Generation"
             icon={<FileText size={24} />}
             href="/admin/finance/tax-forms"
             color="bg-rose-600"
           />
         )}
         {isEnabled('accounts_payable') && (
           <ActionCard
             title="Accounts Payable"
             desc="Vendor Bills & AP Aging"
             icon={<FileText size={24} />}
             href="/admin/finance/ap"
             color="bg-orange-600"
           />
         )}
         {isEnabled('check_printing') && (
           <ActionCard
             title="Bank Accounts"
             desc="Check Printing Setup"
             icon={<Landmark size={24} />}
             href="/admin/finance/bank-accounts"
             color="bg-teal-600"
           />
         )}
      </div>

      {/* KPI CARDS */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
         <KPICard
            label="Total Revenue"
            value={aggregate.income}
            loading={loading}
            icon={<DollarSign size={20} />}
         />
         <KPICard
            label="Total Expenses"
            value={aggregate.expenses}
            loading={loading}
            icon={<TrendingDown size={20} />}
         />
         <KPICard
            label="Net Operating Income"
            value={aggregate.noi}
            loading={loading}
            icon={<TrendingUp size={20} />}
         />
         <KPICard
            label="Profit Margin"
            value={aggregate.margin}
            loading={loading}
            isPercent={true}
            icon={<PieChart size={20} />}
         />
      </div>

      {/* ASSET PERFORMANCE TABLE */}
      <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
         <div className="p-8 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-xl font-black italic uppercase text-slate-900">Asset Breakdown</h3>
            <Link href="/admin/reports?report=ar_aging" className="text-[10px] font-black uppercase text-slate-400 hover:text-emerald-600 flex items-center gap-1">
               View Full Report <ArrowRight size={14} />
            </Link>
         </div>
         
         {loading ? (
            <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-emerald-500" /></div>
         ) : (
            <table className="w-full text-left">
               <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                     <th className="px-8 py-5">Property</th>
                     <th className="px-8 py-5">Income</th>
                     <th className="px-8 py-5">Expenses</th>
                     <th className="px-8 py-5">NOI</th>
                     <th className="px-8 py-5 text-right">Margin</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {metrics.map(m => (
                     <tr key={m.property_id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-5">
                           <div className="font-bold text-slate-900">{m.property_name}</div>
                        </td>
                        <td className="px-8 py-5 font-mono text-sm text-slate-600">
                           ${fmt(m.total_income)}
                        </td>
                        <td className="px-8 py-5 font-mono text-sm text-slate-600">
                           ${fmt(m.total_expenses)}
                        </td>
                        <td className="px-8 py-5 font-mono text-sm font-bold text-emerald-600">
                           ${fmt(m.net_operating_income)}
                        </td>
                        <td className="px-8 py-5 text-right">
                           <span className={`inline-block px-3 py-1 rounded-lg text-[10px] font-black ${m.margin > 60 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                              {m.margin.toFixed(1)}%
                           </span>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         )}
      </div>
      {/* RECENT MAINTENANCE EXPENSES */}
      {maintenanceExpenses.length > 0 && (
        <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mt-10">
          <div className="p-8 border-b border-slate-100 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 text-red-500 rounded-xl flex items-center justify-center">
                <Wrench size={18} />
              </div>
              <div>
                <h3 className="text-xl font-black italic uppercase text-slate-900">Maintenance Expenses</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {maintenanceExpenses.length} Committed to Ledger
                </p>
              </div>
            </div>
          </div>

          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-8 py-4">Date</th>
                <th className="px-8 py-4">Work Order</th>
                <th className="px-8 py-4">Vendor</th>
                <th className="px-8 py-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {maintenanceExpenses.map(exp => (
                <tr key={exp.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-4 text-sm font-bold text-slate-500">
                    {new Date(exp.date).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-4">
                    <div className="font-bold text-sm text-slate-900">{exp.work_order_title || 'Work Order'}</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">{exp.description}</div>
                  </td>
                  <td className="px-8 py-4 text-sm font-bold text-slate-600">
                    {exp.vendor_name || 'No Vendor'}
                  </td>
                  <td className="px-8 py-4 text-right">
                    <span className="font-mono text-sm font-bold text-red-600">
                      -${fmt(exp.amount)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// --- SUB COMPONENTS ---

function ActionCard({ title, desc, icon, href, color }: any) {
    return (
        <Link href={href} className="group">
            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex items-center gap-5">
                <div className={`w-14 h-14 ${color} text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                    {icon}
                </div>
                <div>
                    <h3 className="text-lg font-black italic text-slate-900 uppercase">{title}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{desc}</p>
                </div>
                <ArrowUpRight className="ml-auto text-slate-200 group-hover:text-slate-900 transition-colors" />
            </div>
        </Link>
    )
}

function KPICard({ label, value, loading, trend, isPositive, icon, isPercent }: any) {
    return (
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
            <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-slate-50 text-slate-900 rounded-xl">{icon}</div>
                {trend && (
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      {trend}
                  </div>
                )}
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
            {loading ? (
                <div className="h-10 w-32 bg-slate-100 rounded-lg animate-pulse" />
            ) : (
                <h2 className="text-4xl font-black italic text-slate-900 tracking-tighter">
                    {isPercent ? '' : '$'}{isPercent ? (value ?? 0).toFixed(1) : fmt(value ?? 0)}{isPercent ? '%' : ''}
                </h2>
            )}
        </div>
    )
}