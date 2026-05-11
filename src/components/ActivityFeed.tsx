'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  Sparkles, DollarSign, Wrench, CheckCircle2,
  Clock, User, ShieldCheck, ArrowRight, XCircle, UserPlus
} from 'lucide-react'

type Activity = {
  id: string
  event_type: string
  title: string
  description: string
  actor_name: string
  created_at: string
}

export default function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchActivity() {
      setLoading(true)
      const { data } = await supabase
        .from('system_activity')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      if (!cancelled && data) setActivities(data as Activity[])
      if (!cancelled) setLoading(false)
    }

    fetchActivity()

    // REAL-TIME SUBSCRIPTION: Enterprise-grade live updates
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'system_activity'
      }, (payload) => {
        if (!cancelled) {
          setActivities(prev => [payload.new as Activity, ...prev].slice(0, 10))
        }
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  const getIcon = (type: string) => {
    switch(type) {
      case 'AI_TICKET': return <Sparkles className="text-blue-500" size={16} />
      case 'LEDGER_UPDATE': return <DollarSign className="text-green-500" size={16} />
      case 'VENDOR_COMPLETED': return <CheckCircle2 className="text-emerald-500" size={16} />
      case 'VENDOR_ASSIGNED': return <UserPlus className="text-indigo-500" size={16} />
      case 'VENDOR_ACCEPTED': return <CheckCircle2 className="text-blue-500" size={16} />
      case 'VENDOR_REJECTED': return <XCircle className="text-red-500" size={16} />
      case 'TENANT_REPAIR_UPDATE': return <Wrench className="text-orange-500" size={16} />
      default: return <ShieldCheck className="text-slate-400" size={16} />
    }
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <h3 className="font-black text-slate-900 tracking-tight flex items-center gap-2">
           <Clock size={18} className="text-slate-400" /> Live Activity Feed
        </h3>
        <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase">Live</span>
      </div>

      <div className="flex-1 overflow-y-auto" aria-live="polite" aria-relevant="additions">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Synchronizing feed...</div>
        ) : activities.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm italic">No recent activity detected.</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {activities.map((item) => (
              <div key={item.id} className="p-5 hover:bg-slate-50 transition-colors group">
                <div className="flex gap-4">
                  <div className="mt-1 w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all">
                    {getIcon(item.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <p className="text-sm font-bold text-slate-900 truncate">{item.title}</p>
                      <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap ml-2">
                        {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">{item.description}</p>
                    <div className="mt-2 flex items-center gap-2">
                       <div className="w-4 h-4 bg-slate-200 rounded-full flex items-center justify-center">
                          <User size={10} className="text-slate-500" />
                       </div>
                       <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{item.actor_name}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="p-4 bg-slate-50 border-t border-slate-100 text-[10px] font-black uppercase text-slate-400 hover:text-slate-900 transition-colors flex items-center justify-center gap-2 group">
        View Full Audit Log <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
      </button>
    </div>
  )
}