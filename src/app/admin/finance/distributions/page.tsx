'use client'

import { useState } from 'react'
import { 
  Banknote, History, CheckCircle2, AlertCircle, 
  Loader2, ArrowRight, DollarSign, Filter 
} from 'lucide-react'
import { useDistributions } from '@/hooks/useDistributions'

export default function DistributionsPage() {
  const { properties, history, loading, processing, runBatchDistribution } = useDistributions()
  const [selected, setSelected] = useState<string[]>([])

  // Helper: Select All Logic
  const handleSelectAll = () => {
    if (selected.length === properties.length) setSelected([])
    else setSelected(properties.filter(p => p.status === 'Ready').map(p => p.id))
  }

  // Calculate Totals for Selection
  const totalSelected = properties
    .filter(p => selected.includes(p.id))
    .reduce((acc, curr) => acc + curr.available_distribution, 0)

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Owner <span className="text-emerald-600">Distributions</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {properties.filter(p => p.status === 'Ready').length} Payouts Ready • ACH Batch Processing
          </p>
        </div>

        {/* BATCH ACTION CARD */}
        <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl flex items-center gap-8 min-w-[320px]">
           <div>
              <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">Batch Total</p>
              <h2 className="text-3xl font-black italic tracking-tighter">${totalSelected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
           </div>
           <button 
             onClick={() => runBatchDistribution(selected)}
             disabled={processing || selected.length === 0}
             className="w-14 h-14 bg-emerald-500 hover:bg-emerald-400 text-white rounded-2xl flex items-center justify-center transition-all disabled:opacity-50 disabled:bg-slate-700"
           >
             {processing ? <Loader2 className="animate-spin" /> : <ArrowRight size={24} />}
           </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* MAIN TABLE */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
           <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <button 
                onClick={handleSelectAll}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900"
              >
                {selected.length === properties.length ? 'Deselect All' : 'Select Eligible'}
              </button>
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                 <Filter size={12} /> Filter: Ready Only
              </div>
           </div>

           {loading ? (
             <div className="py-20 text-center"><Loader2 className="animate-spin text-emerald-500 mx-auto" /></div>
           ) : (
             <table className="w-full text-left">
               <thead className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-white">
                 <tr>
                   <th className="px-6 py-4 w-10"></th>
                   <th className="px-6 py-4">Asset</th>
                   <th className="px-6 py-4">Cash Position</th>
                   <th className="px-6 py-4 text-right">Payout</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                 {properties.map(p => (
                   <tr key={p.id} className={`hover:bg-slate-50/80 transition-colors ${selected.includes(p.id) ? 'bg-blue-50/30' : ''}`}>
                     <td className="px-6 py-4">
                        <input 
                          type="checkbox" 
                          checked={selected.includes(p.id)}
                          disabled={p.status === 'Low Funds'}
                          onChange={(e) => {
                             if(e.target.checked) setSelected([...selected, p.id])
                             else setSelected(selected.filter(id => id !== p.id))
                          }}
                          className="w-5 h-5 rounded-lg border-slate-300 text-emerald-600 focus:ring-emerald-500 rounded focus:ring-2"
                        />
                     </td>
                     <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase">{p.owner_name}</div>
                     </td>
                     <td className="px-6 py-4">
                        <div className="font-mono text-xs font-bold text-slate-600">${p.cash_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Min. Reserve: ${p.reserve_requirement}</div>
                     </td>
                     <td className="px-6 py-4 text-right">
                        {p.status === 'Ready' ? (
                           <span className="font-black italic text-emerald-600 text-lg">${p.available_distribution.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        ) : (
                           <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-amber-500 bg-amber-50 px-2 py-1 rounded-full">
                              <AlertCircle size={10} /> Low Funds
                           </span>
                        )}
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           )}
        </div>

        {/* SIDEBAR: HISTORY */}
        <div className="space-y-6">
           <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
              <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-6 flex items-center gap-2">
                 <History size={14} /> Recent Batches
              </h3>
              <div className="space-y-6">
                 {history.length === 0 && <p className="text-slate-400 text-xs italic">No recent distributions.</p>}
                 {history.map((log) => (
                    <div key={log.id} className="flex gap-4 items-start">
                       <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={18} />
                       </div>
                       <div>
                          <p className="text-xs font-black text-slate-900 uppercase">{log.property_name}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-1">{log.owner_name} • {new Date(log.created_at).toLocaleDateString()}</p>
                       </div>
                       <div className="ml-auto font-mono text-xs font-bold text-emerald-600">
                          ${log.amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                       </div>
                    </div>
                 ))}
              </div>
           </div>

           <div className="p-8 bg-blue-50 border border-blue-100 rounded-[2.5rem]">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                 <Banknote size={24} />
              </div>
              <h4 className="font-black text-blue-900 uppercase text-sm mb-2">ACH Settlement Info</h4>
              <p className="text-xs text-blue-800 leading-relaxed font-medium">
                 Batches initiated before <strong>2:00 PM PST</strong> will arrive in owner accounts by the next business day.
              </p>
           </div>
        </div>

      </div>
    </div>
  )
}