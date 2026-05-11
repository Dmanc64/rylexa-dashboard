'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Users, Download, CheckCircle2,
  Clock, Loader2, DollarSign, MapPin, Search
} from 'lucide-react'
import { usePayroll } from '@/hooks/usePayroll'

export default function PayrollPage() {
  const { entries, totals, loading, exporting, approveRun, exportRun } = usePayroll()
  const [filter, setFilter] = useState('All')
  
  // 1. ADD SEARCH STATE TO FIX INPUT ERROR
  const [search, setSearch] = useState('')

  // Filter Logic: Matches Status AND Search Term
  const filteredData = entries.filter(e => {
    const matchesStatus = filter === 'All' || e.status === filter
    const matchesSearch = 
      (e.name || '').toLowerCase().includes(search.toLowerCase()) || 
      (e.region || '').toLowerCase().includes(search.toLowerCase())
    
    return matchesStatus && matchesSearch
  })

  // Handle Export Interaction
  const handleExport = async () => {
    const success = await exportRun()
    if (success) toast.success("Payroll CSV downloaded successfully.")
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Payroll <span className="text-emerald-600">Export</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            Period: Feb 1 - Feb 15, 2026 • {entries.length} Payees
          </p>
        </div>

        <div className="flex gap-3">
           <button 
             onClick={approveRun}
             className="px-6 py-3 bg-white border border-slate-200 text-slate-900 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm"
           >
              <CheckCircle2 size={16} /> Approve All
           </button>
           <button 
             onClick={handleExport}
             disabled={exporting}
             className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
           >
              {exporting ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
              {exporting ? 'Generating...' : 'Export CSV'}
           </button>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Liability</p>
               <h3 className="text-3xl font-black italic text-slate-900">${totals.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
            </div>
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
               <DollarSign size={24} />
            </div>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Hours Logged</p>
               <h3 className="text-3xl font-black italic text-slate-900">{totals.hours.toFixed(1)}</h3>
            </div>
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
               <Clock size={24} />
            </div>
         </div>
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Active Payees</p>
               <h3 className="text-3xl font-black italic text-slate-900">{totals.count}</h3>
            </div>
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
               <Users size={24} />
            </div>
         </div>
      </div>

      {/* SEARCH & FILTERS */}
      <div className="max-w-7xl mx-auto mb-6 bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2">
         {/* Filter Buttons */}
         <div className="flex bg-slate-50 p-1 rounded-xl gap-1 overflow-x-auto">
            {['All', 'Pending', 'Approved', 'Paid'].map(f => (
               <button 
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                     filter === f ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
                  }`}
               >
                  {f}
               </button>
            ))}
         </div>
         
         {/* 2. CORRECTLY WIRED INPUT FIELD */}
         <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input 
               type="text"
               placeholder="Search payee..." 
               value={search} // Controlled value
               onChange={(e) => setSearch(e.target.value)} // Required handler
               className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
            />
         </div>
      </div>

      {/* MAIN TABLE */}
      <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
         {loading ? (
            <div className="py-20 text-center"><Loader2 className="animate-spin text-emerald-500 mx-auto" /></div>
         ) : (
            <table className="w-full text-left">
               <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <tr>
                     <th className="px-8 py-5">Payee</th>
                     <th className="px-8 py-5">Role & Type</th>
                     <th className="px-8 py-5">Hours / Rate</th>
                     <th className="px-8 py-5">Region</th>
                     <th className="px-8 py-5 text-right">Payout</th>
                     <th className="px-8 py-5 text-right">Status</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {filteredData.map(e => (
                     <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-5">
                           <div className="font-bold text-slate-900 text-sm">{e.name}</div>
                           <div className="text-[9px] font-mono text-slate-400">ID: {e.id.padStart(4, '0')}</div>
                        </td>
                        <td className="px-8 py-5">
                           <span className={`inline-block px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider mb-1 ${
                              e.role === 'Vendor' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                           }`}>
                              {e.role}
                           </span>
                           <div className="text-xs font-bold text-slate-500">{e.type}</div>
                        </td>
                        <td className="px-8 py-5">
                           <div className="font-medium text-slate-900">{e.hours_logged} hrs</div>
                           <div className="text-xs text-slate-400">@ ${e.rate}/hr</div>
                        </td>
                        <td className="px-8 py-5">
                           <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                              <MapPin size={12} /> {e.region}
                           </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                           <div className="font-black text-slate-900 text-lg">${e.total_payout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </td>
                        <td className="px-8 py-5 text-right">
                           <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                              e.status === 'Paid' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                              e.status === 'Approved' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                              'bg-amber-50 text-amber-600 border-amber-100'
                           }`}>
                              {e.status}
                           </span>
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