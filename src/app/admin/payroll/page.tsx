'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { 
  FileSpreadsheet, Download, Calendar, 
  Users, MapPin, ArrowRight, Loader2, 
  CheckCircle2, Printer, Wallet
} from 'lucide-react'

export default function PayrollExportPage() {
  const [exporting, setExporting] = useState(false)
  const [dateRange, setDateRange] = useState({ start: '2026-01-01', end: '2026-01-15' })

  const handleExport = () => {
    setExporting(true)
    // Simulate generation of the Payroll CSV/PDF
    setTimeout(() => {
      setExporting(false)
      toast.success("Payroll Export for Reno & Carson City teams generated successfully.")
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic">Payroll Export</h1>
            <p className="text-slate-500 font-medium">Generate labor cost summaries for the Rylexa Field Team.</p>
          </div>
          <div className="flex items-center gap-3">
             <button className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-900 transition-all">
                <Printer size={20} />
             </button>
             <div className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <Wallet size={14} className="text-blue-400" /> System: Paid Tier
             </div>
          </div>
        </header>

        {/* EXPORT CONFIGURATION */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-slate-50">
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                   <Calendar size={12} /> Start Date
                </label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                />
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                   <Calendar size={12} /> End Date
                </label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                />
             </div>
             <div className="flex items-end">
                <button 
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg hover:bg-blue-500 transition-all flex items-center justify-center gap-2"
                >
                  {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet size={18} />}
                  GENERATE EXPORT
                </button>
             </div>
          </div>

          <div className="p-8 bg-slate-50/50 space-y-6">
             <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Users size={16} /> Regional Breakdown
             </h3>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <RegionTotal city="Reno" hours="142.5" cost="4,987.50" />
                <RegionTotal city="Carson City" hours="58.25" cost="2,038.75" />
             </div>
          </div>
        </div>

        {/* RECENT EXPORTS TABLE */}
        <div className="space-y-4">
           <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
              <Download size={16} /> Export History
           </h3>
           <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-left">
                 <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                       <th className="px-8 py-4">Period</th>
                       <th className="px-8 py-4">Total Labor</th>
                       <th className="px-8 py-4">Generated By</th>
                       <th className="px-8 py-4 text-right">Action</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                    <tr className="hover:bg-slate-50 transition-colors">
                       <td className="px-8 py-5">
                          <div className="font-bold text-slate-900">Jan 01 - Jan 15, 2026</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Reno / Carson City Combined</div>
                       </td>
                       <td className="px-8 py-5">
                          <div className="font-black text-blue-600">$7,026.25</div>
                       </td>
                       <td className="px-8 py-5">
                          <div className="text-xs font-bold text-slate-600">Admin_Dan</div>
                       </td>
                       <td className="px-8 py-5 text-right">
                          <button className="text-slate-300 hover:text-slate-900"><Download size={18} /></button>
                       </td>
                    </tr>
                 </tbody>
              </table>
           </div>
        </div>
      </div>
    </div>
  )
}

function RegionTotal({ city, hours, cost }: any) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
       <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center">
             <MapPin size={20} />
          </div>
          <div>
             <p className="text-lg font-bold leading-tight">{city}</p>
             <p className="text-xs text-slate-400 font-medium">{hours} Hours Logged</p>
          </div>
       </div>
       <div className="text-right">
          <p className="text-xl font-black text-slate-900">${cost}</p>
       </div>
    </div>
  )
}