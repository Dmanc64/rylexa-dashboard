'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Banknote, Loader2, CheckCircle, Clock, AlertCircle } from 'lucide-react'

type Distribution = {
  id: string
  property_name: string
  amount: number
  status: string
  period_start: string | null
  period_end: string | null
  notes: string | null
  processed_at: string | null
  created_at: string
}

export default function OwnerDistributionsPage() {
  const router = useRouter()
  const [distributions, setDistributions] = useState<Distribution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDistributions() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Fetch all owner entities the user belongs to (multi-entity model)
      const { data: memberships } = await supabase
        .from('owner_entity_members')
        .select('owner_id')
        .eq('user_id', user.id)

      const ownerIds = (memberships ?? []).map((m: any) => m.owner_id)
      if (ownerIds.length === 0) { setLoading(false); return }

      const { data } = await supabase
        .from('distributions')
        .select('id, amount, status, period_start, period_end, notes, processed_at, created_at, properties(name)')
        .in('owner_id', ownerIds)
        .order('created_at', { ascending: false })

      setDistributions((data ?? []).map((d: any) => ({
        id: d.id,
        property_name: d.properties?.name || 'Unknown',
        amount: Number(d.amount),
        status: d.status,
        period_start: d.period_start,
        period_end: d.period_end,
        notes: d.notes,
        processed_at: d.processed_at,
        created_at: d.created_at,
      })))
      setLoading(false)
    }
    fetchDistributions()
  }, [router])

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading Distributions...</p>
      </div>
    )
  }

  const totalCompleted = distributions
    .filter(d => d.status === 'Completed')
    .reduce((sum, d) => sum + d.amount, 0)
  const totalPending = distributions
    .filter(d => d.status === 'Pending' || d.status === 'Processing')
    .reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-10">
        <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Owner Portal</p>
        <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
          Distribution <span className="text-emerald-600">History</span>
        </h1>
      </div>

      {/* SUMMARY CARDS */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Banknote size={16} className="text-slate-400" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Payouts</p>
          </div>
          <p className="text-3xl font-black italic tracking-tighter text-slate-900">{distributions.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-emerald-500" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Completed</p>
          </div>
          <p className="text-3xl font-black italic tracking-tighter text-emerald-600">${totalCompleted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-amber-500" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pending</p>
          </div>
          <p className="text-3xl font-black italic tracking-tighter text-amber-500">${totalPending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* DISTRIBUTIONS TABLE */}
      {distributions.length === 0 ? (
        <div className="max-w-6xl mx-auto py-20 text-center">
          <Banknote size={48} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">No distributions have been processed yet</p>
          <p className="text-slate-300 text-xs mt-1">Distributions will appear here when your property manager processes them</p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5">Date</th>
                <th className="px-8 py-5">Property</th>
                <th className="px-8 py-5">Period</th>
                <th className="px-8 py-5 text-right">Amount</th>
                <th className="px-8 py-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {distributions.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 text-xs font-bold text-slate-500">
                    {new Date(d.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-8 py-5 text-sm font-bold text-slate-700">{d.property_name}</td>
                  <td className="px-8 py-5 text-xs font-bold text-slate-400">
                    {d.period_end ? new Date(d.period_end).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-8 py-5 text-right text-sm font-black text-emerald-600">
                    ${d.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                      d.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' :
                      d.status === 'Pending' ? 'bg-amber-50 text-amber-600' :
                      d.status === 'Processing' ? 'bg-blue-50 text-blue-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                      {d.status === 'Completed' && <CheckCircle size={10} />}
                      {d.status === 'Pending' && <Clock size={10} />}
                      {d.status === 'Failed' && <AlertCircle size={10} />}
                      {d.status}
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
