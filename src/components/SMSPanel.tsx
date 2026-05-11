'use client'

import { useState } from 'react'
import {
  MessageSquare, Send, Clock, AlertCircle, CheckCircle2,
  XCircle, Search, Loader2, RefreshCw, Phone
} from 'lucide-react'
import { useSMSLog, useSMSStats, useProcessSMSQueue, type SMSStatus } from '@/hooks/useSMS'
import ComposeSMSModal from './ComposeSMSModal'

export default function SMSPanel() {
  const [statusFilter, setStatusFilter] = useState<SMSStatus | ''>('')
  const [search, setSearch] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)

  const { data: stats, isLoading: statsLoading } = useSMSStats()
  const { data: logs = [], isLoading: logsLoading } = useSMSLog({
    status: statusFilter || undefined,
    search: search || undefined,
  })
  const processQueue = useProcessSMSQueue()

  const statusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-wider">
            <CheckCircle2 size={12} /> Sent
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 text-[9px] font-black uppercase tracking-wider">
            <Clock size={12} /> Pending
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-[9px] font-black uppercase tracking-wider">
            <XCircle size={12} /> Failed
          </span>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* HEADER */}
      <div className="p-6 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase">SMS Center</p>
            <h2 className="text-2xl font-black italic tracking-tighter">Text Messages</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => processQueue.mutate()}
              disabled={processQueue.isPending}
              className="p-3 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-all active:scale-95 shadow-sm disabled:opacity-50"
              title="Process pending SMS queue"
            >
              {processQueue.isPending ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            </button>
            <button
              onClick={() => setComposeOpen(true)}
              className="px-5 py-3 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all active:scale-95 shadow-md flex items-center gap-2 font-black text-[10px] uppercase tracking-widest"
            >
              <Send size={14} /> Send SMS
            </button>
          </div>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Sent Today" value={stats?.sent_today ?? 0} color="text-emerald-600" bg="bg-emerald-50" loading={statsLoading} />
          <StatCard label="Pending" value={stats?.pending ?? 0} color="text-amber-600" bg="bg-amber-50" loading={statsLoading} />
          <StatCard label="Failed" value={stats?.failed ?? 0} color="text-red-600" bg="bg-red-50" loading={statsLoading} />
          <StatCard label="All Time" value={stats?.total ?? 0} color="text-slate-600" bg="bg-slate-50" loading={statsLoading} />
        </div>
      </div>

      {/* FILTERS */}
      <div className="px-6 py-3 border-b border-slate-100 bg-white flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or message..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['', 'sent', 'pending', 'failed'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s as SMSStatus | '')}
              className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                statusFilter === s
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* SMS LOG */}
      <div className="flex-1 overflow-y-auto bg-white">
        {logsLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="animate-spin mx-auto text-emerald-500" size={24} />
            <p className="text-slate-400 text-xs mt-2">Loading SMS log...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center">
            <Phone size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-400 font-bold text-sm">No SMS messages</p>
            <p className="text-slate-400 text-xs mt-1">Send your first text message with the button above</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {logs.map(sms => (
              <div key={sms.id} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-black text-sm text-slate-900">
                        {sms.recipient_name || 'Unknown'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {sms.recipient_phone}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 truncate">{sms.body}</p>
                    {sms.error_message && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={12} /> {sms.error_message}
                      </p>
                    )}
                    {sms.sms_sid && (
                      <p className="text-[10px] text-slate-400 font-mono mt-1">SID: {sms.sms_sid}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {statusBadge(sms.status)}
                    <p className="text-[10px] text-slate-400 mt-1">
                      {new Date(sms.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* COMPOSE MODAL */}
      <ComposeSMSModal isOpen={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  )
}

function StatCard({ label, value, color, bg, loading }: {
  label: string; value: number; color: string; bg: string; loading: boolean
}) {
  return (
    <div className={`${bg} rounded-xl p-4 border border-black/5`}>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      {loading ? (
        <div className="h-7 w-12 bg-slate-200 animate-pulse rounded" />
      ) : (
        <p className={`text-2xl font-black italic ${color}`}>{value.toLocaleString()}</p>
      )}
    </div>
  )
}
