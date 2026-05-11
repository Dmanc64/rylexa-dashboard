'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { 
  CheckCircle2, XCircle, Clock, Receipt, 
  AlertCircle, Eye, Loader2, Hammer, 
  DollarSign, ArrowRight, ShieldCheck 
} from 'lucide-react'

export default function ManagerApprovalDashboard() {
  const [loading, setLoading] = useState(true)
  const [pendingLogs, setPendingLogs] = useState<any[]>([])

  useEffect(() => {
    fetchPendingLogs()
  }, [])

  async function fetchPendingLogs() {
    setLoading(true)
    // Fetch logs that haven't been posted to the ledger yet
    const { data, error } = await supabase
      .from('maintenance_logs')
      .select(`
        *,
        units (name, properties (name, city)),
        work_orders (title)
      `)
      .eq('status', 'Pending')

    if (error) console.error('Failed to fetch pending logs:', error.message)
    if (data) setPendingLogs(data)
    setLoading(false)
  }

  const handleApproval = async (logId: string, approved: boolean) => {
    const status = approved ? 'Approved' : 'Rejected'
    const { error } = await supabase
      .from('maintenance_logs')
      .update({ status })
      .eq('id', logId)

    if (!error) {
      setPendingLogs(prev => prev.filter(log => log.id !== logId))
      // Logic for posting to ledger would trigger here via Supabase Hook
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic">Approval Queue</h1>
            <p className="text-slate-500 font-medium">Review employee labor and material receipts.</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">
            <ShieldCheck size={14} /> Audit Trail Active
          </div>
        </header>

        {/* STATS OVERVIEW */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <StatCard title="Pending Approvals" value={pendingLogs.length} color="text-slate-900" />
           <StatCard title="Total Labor Value" value="$1,240.50" color="text-blue-600" />
           <StatCard title="Unposted Receipts" value="5" color="text-emerald-600" />
        </div>

        {/* APPROVAL FEED */}
        <div className="space-y-4">
           {loading ? (
             <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
           ) : pendingLogs.length === 0 ? (
             <div className="bg-white p-20 rounded-3xl border border-slate-200 text-center text-slate-400 italic shadow-sm">
                Queue clear. All labor and materials are currently posted.
             </div>
           ) : (
             pendingLogs.map((log) => (
               <div key={log.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                 <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex gap-5 items-start">
                       <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500 shrink-0">
                          {log.hours_worked ? <Clock size={24} /> : <Receipt size={24} />}
                       </div>
                       <div>
                          <div className="flex items-center gap-2 mb-1">
                             <h3 className="font-bold text-lg">{log.work_orders?.title}</h3>
                             <span className="text-[10px] font-black uppercase bg-slate-900 text-white px-2 py-0.5 rounded-md">
                                {log.units?.properties?.city}
                             </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium italic">
                             {log.units?.properties?.name} • Unit {log.units?.name}
                          </p>
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 px-6 border-x border-slate-50">
                       <div>
                          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Labor Logged</p>
                          <p className="font-black text-slate-900">{log.hours_worked} Hours</p>
                       </div>
                       <div>
                          <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Est. Cost</p>
                          <p className="font-black text-blue-600">${(log.hours_worked * 35).toFixed(2)}</p>
                       </div>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                       <button 
                        onClick={() => handleApproval(log.id, false)}
                        className="flex-1 md:flex-none p-4 text-red-500 bg-red-50 hover:bg-red-100 rounded-2xl transition-colors"
                       >
                          <XCircle size={20} />
                       </button>
                       <button 
                        onClick={() => handleApproval(log.id, true)}
                        className="flex-1 md:flex-none px-6 py-4 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-500 shadow-lg shadow-emerald-900/10 flex items-center gap-2 transition-all"
                       >
                          <CheckCircle2 size={20} /> APPROVE
                       </button>
                    </div>
                 </div>
               </div>
             ))
           )}
        </div>

        {/* RECEIPT PREVIEW (IF MATERIAL LOG) */}
        <div className="p-6 bg-blue-900 rounded-3xl text-white shadow-xl flex justify-between items-center relative overflow-hidden group cursor-pointer">
           <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
              <Receipt size={80} />
           </div>
           <div className="flex items-center gap-4 relative z-10">
              <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                 <AlertCircle size={24} className="text-blue-300" />
              </div>
              <div>
                 <h4 className="font-bold">Pending Receipt Review</h4>
                 <p className="text-blue-300 text-xs">AI has detected 3 receipts from Home Depot that require manual verification.</p>
              </div>
           </div>
           <button className="relative z-10 px-6 py-3 bg-white text-blue-900 font-black rounded-xl text-xs uppercase tracking-widest hover:bg-blue-50 transition-colors shadow-lg">
              View Receipts
           </button>
        </div>

      </div>
    </div>
  )
}

function StatCard({ title, value, color }: any) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
       <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">{title}</p>
       <div className={`text-3xl font-black ${color}`}>{value}</div>
    </div>
  )
}