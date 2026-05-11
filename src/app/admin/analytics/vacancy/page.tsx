'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import {
  TrendingDown, TrendingUp, AlertTriangle, Map,
  Calendar, ArrowRight, Loader2, Sparkles, Building2,
  RefreshCcw, Megaphone // Icon for MTM rolling leases
} from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'

export default function VacancyPredictor() {
  const [loading, setLoading] = useState(true)
  const [predictions, setPredictions] = useState<any[]>([])
  const { isEnabled } = useFeatureFlags()

  useEffect(() => {
    async function getVacancyData() {
      setLoading(true)
      
      // LOGIC: 45-60 Day Window
      // We calculate the date range for 45 and 60 days from today
      const date45 = new Date(); date45.setDate(date45.getDate() + 45);
      const date60 = new Date(); date60.setDate(date60.getDate() + 60);
      
      const { data } = await supabase
        .from('leases')
        .select(`
          id, 
          end_date, 
          is_month_to_month,
          units (name, properties (name, city))
        `)
        // Filter: Either lease ends in 45-60 days OR it is Month-to-Month
        .or(`and(end_date.gte.${date45.toISOString()},end_date.lte.${date60.toISOString()}),is_month_to_month.eq.true`)
      
      if (data) {
        const enriched = data.map((l: any) => ({
          ...l,
          // MTM logic: If MTM, risk is based on market volatility, otherwise based on end_date
          risk: l.is_month_to_month ? 'Rolling' : 'High',
          action: l.is_month_to_month ? 'Send Intent Check' : 'Start Marketing'
        }))
        setPredictions(enriched)
      }
      setLoading(false)
    }
    getVacancyData()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-10">
        
        <header className="flex justify-between items-end">
          <div>
            <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-blue-600 rounded-lg text-white"><Sparkles size={16} /></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">45-60 Day Horizon</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight italic">Vacancy Forecaster</h1>
            <p className="text-slate-500 font-medium uppercase text-xs tracking-widest mt-1">Reno & Carson City Portfolio</p>
          </div>
          <div className="flex gap-4">
             <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-400">Expiring Leases</p>
                <p className="text-2xl font-black text-slate-900">{predictions.filter(p => !p.is_month_to_month).length}</p>
             </div>
             <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-400">MTM Rolling Risk</p>
                <p className="text-2xl font-black text-orange-500">{predictions.filter(p => p.is_month_to_month).length}</p>
             </div>
          </div>
        </header>

        {/* PREDICTION LIST */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                        <th className="px-8 py-5">Property / Unit</th>
                        <th className="px-8 py-5">Lease Type</th>
                        <th className="px-8 py-5">Status / End Date</th>
                        <th className="px-8 py-5 text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={4} className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></td></tr>
                    ) : predictions.map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-8 py-5">
                                <div className="font-bold text-slate-900">{p.units?.properties?.name ?? 'Unknown'}</div>
                                <div className="text-xs text-slate-400 font-bold uppercase">{p.units?.properties?.city ?? ''} • Unit {p.units?.name ?? ''}</div>
                            </td>
                            <td className="px-8 py-5">
                                {p.is_month_to_month ? (
                                    <span className="flex items-center gap-1.5 text-[10px] font-black text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full w-fit">
                                        <RefreshCcw size={12} /> MTM ROLLING
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-[10px] font-black text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full w-fit">
                                        <Calendar size={12} /> FIXED TERM
                                    </span>
                                )}
                            </td>
                            <td className="px-8 py-5">
                                <div className="text-sm font-bold text-slate-700">
                                    {p.is_month_to_month ? 'No End Date' : new Date(p.end_date).toLocaleDateString()}
                                </div>
                                <div className={`text-[10px] font-black uppercase tracking-tighter ${p.risk === 'Rolling' ? 'text-orange-400' : 'text-red-500'}`}>
                                    {p.risk} Vacancy Risk
                                </div>
                            </td>
                            <td className="px-8 py-5 text-right">
                                {p.action === 'Start Marketing' && isEnabled('listing_syndication') ? (
                                  <Link
                                    href="/admin/listings/syndication?create=true"
                                    className="px-5 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase rounded-xl hover:bg-blue-600 transition-all flex items-center gap-2 ml-auto shadow-md w-fit"
                                  >
                                    <Megaphone size={14} /> Start Marketing <ArrowRight size={14} />
                                  </Link>
                                ) : (
                                  <button className="px-5 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase rounded-xl hover:bg-blue-600 transition-all flex items-center gap-2 ml-auto shadow-md">
                                    {p.action} <ArrowRight size={14} />
                                  </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  )
}