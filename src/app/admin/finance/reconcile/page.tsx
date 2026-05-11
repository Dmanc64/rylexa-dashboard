'use client'

import { useState } from 'react'
import {
  ArrowRightLeft, CheckCircle2, AlertCircle,
  Loader2, Filter, Search, ShieldCheck, HelpCircle, Sparkles
} from 'lucide-react'
import { useReconciliation } from '@/hooks/useReconciliation'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'

export default function ReconciliationPage() {
  const {
    transactions, stats, loading, processing,
    reconcileTransaction, flagTransaction,
    runCategorization, categorizing
  } = useReconciliation()
  const { isEnabled } = useFeatureFlags()
  const [filter, setFilter] = useState('Pending')

  const filteredData = transactions.filter(t => filter === 'All' || t.status === filter)

  // Compute real match rate from data
  const realMatchRate = stats.total > 0
    ? ((stats.reconciled / stats.total) * 100).toFixed(1)
    : '0.0'

  // Compute unreconciled cash
  const unreconciledCash = transactions
    .filter((t) => t.status === 'Pending')
    .reduce((acc, t) => acc + t.amount, 0)

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Bank <span className="text-emerald-600">Reconciliation</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {stats.pending} Unmatched Transactions • AI Auto-Match Active
          </p>
        </div>

        <div className="flex gap-3 items-center">
          {isEnabled('ai_transaction_categorization') && (
            <button
              onClick={() => runCategorization()}
              disabled={categorizing}
              className="px-5 py-2 bg-violet-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-500 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {categorizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {categorizing ? 'Categorizing...' : 'AI Categorize'}
            </button>
          )}
          <div className="bg-white p-1 rounded-xl border border-slate-200 flex shadow-sm">
             {['Pending', 'Reconciled', 'Flagged', 'All'].map(f => (
               <button
                 key={f}
                 onClick={() => setFilter(f)}
                 className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                   filter === f ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
                 }`}
               >
                 {f}
               </button>
             ))}
          </div>
        </div>
      </div>

      {/* STATS ROW */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
         <div className="bg-emerald-600 p-6 rounded-[2rem] text-white shadow-lg relative overflow-hidden">
            <ShieldCheck className="absolute -right-4 -top-4 opacity-20 w-32 h-32" />
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200 mb-2">Auto-Match Rate</p>
            <h3 className="text-4xl font-black italic">{realMatchRate}%</h3>
            <p className="text-xs font-bold text-emerald-100 mt-2">
              {stats.reconciled} of {stats.total} reconciled.
            </p>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center">
             <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Unreconciled Cash</span>
                <AlertCircle size={16} className="text-amber-500" />
             </div>
             <h3 className="text-3xl font-black italic text-slate-900">${unreconciledCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center">
             <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Flagged for Review</span>
                <HelpCircle size={16} className="text-red-400" />
             </div>
             <h3 className="text-3xl font-black italic text-slate-900">{stats.flagged}</h3>
         </div>
      </div>

      {/* MAIN TABLE */}
      <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
         {loading ? (
            <div className="py-32 flex flex-col items-center justify-center gap-4">
               <Loader2 className="animate-spin text-emerald-500" size={40} />
               <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Scanning Bank Feed...</p>
            </div>
         ) : filteredData.length === 0 ? (
            <div className="py-20 text-center text-slate-400 font-bold italic uppercase">No {filter} Transactions Found</div>
         ) : (
            <table className="w-full text-left">
               <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                     <th className="px-8 py-5">Date</th>
                     <th className="px-8 py-5">Bank Feed Description</th>
                     <th className="px-8 py-5">Amount</th>
                     <th className="px-8 py-5">AI Suggestion</th>
                     <th className="px-8 py-5 text-right">Action</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {filteredData.map(tx => (
                     <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-5">
                           <div className="font-bold text-slate-900 text-sm">{new Date(tx.date).toLocaleDateString()}</div>
                           <div className="text-[9px] font-black text-slate-400 uppercase mt-0.5">ID: {tx.id.slice(0,6)}</div>
                        </td>
                        <td className="px-8 py-5">
                           <div className="font-medium text-slate-700">{tx.description}</div>
                           {tx.ai_category && (
                             <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-violet-50 text-violet-600">
                               <Sparkles size={8} /> {tx.ai_category}
                             </span>
                           )}
                        </td>
                        <td className="px-8 py-5">
                           <div className={`font-black text-lg italic ${tx.type === 'Credit' ? 'text-emerald-600' : 'text-slate-900'}`}>
                              {tx.type === 'Credit' ? '+' : '-'}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                           </div>
                        </td>
                        <td className="px-8 py-5">
                           {tx.status === 'Pending' ? (
                              <div className="flex items-center gap-3">
                                 <div className="relative w-10 h-10 flex items-center justify-center">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                       <path className="text-slate-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                       <path className="text-emerald-500" strokeDasharray={`${tx.ai_confidence}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                                    </svg>
                                    <span className="absolute text-[9px] font-bold text-emerald-600">{tx.ai_confidence}%</span>
                                 </div>
                                 <div>
                                    <p className="text-xs font-bold text-slate-900">{tx.suggested_match}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase">Confidence Score</p>
                                 </div>
                              </div>
                           ) : (
                              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${
                                 tx.status === 'Reconciled' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                              }`}>
                                 {tx.status}
                              </span>
                           )}
                        </td>
                        <td className="px-8 py-5 text-right">
                           {tx.status === 'Pending' && (
                              <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button
                                   onClick={() => flagTransaction(tx.id)}
                                   className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 hover:bg-amber-100 flex items-center justify-center transition-colors"
                                   title="Flag for Review"
                                 >
                                    <HelpCircle size={18} />
                                 </button>
                                 <button
                                   onClick={() => reconcileTransaction(tx.id)}
                                   disabled={processing === tx.id}
                                   className="w-10 h-10 rounded-xl bg-slate-900 text-white hover:bg-emerald-600 flex items-center justify-center transition-all shadow-md"
                                   title="Confirm Match"
                                 >
                                    {processing === tx.id ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                                 </button>
                              </div>
                           )}
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         )}
      </div>
    </div>
  )
}
