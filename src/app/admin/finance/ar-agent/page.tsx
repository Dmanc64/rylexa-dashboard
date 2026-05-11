'use client'

import { useState } from 'react'
import {
  Bot, Play, Pause, AlertTriangle, DollarSign,
  Mail, FileWarning, Loader2, ArrowLeft,
  CheckCircle2, Clock, TrendingUp
} from 'lucide-react'
import Link from 'next/link'
import { useARAgent, type ARAction } from '@/hooks/useARAgent'

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  REMINDER_1: { label: 'Reminder 1', color: 'text-blue-600', bg: 'bg-blue-50' },
  REMINDER_2: { label: 'Reminder 2', color: 'text-blue-700', bg: 'bg-blue-100' },
  REMINDER_3: { label: 'Final Reminder', color: 'text-amber-600', bg: 'bg-amber-50' },
  LATE_FEE: { label: 'Late Fee', color: 'text-orange-600', bg: 'bg-orange-50' },
  DEMAND_LETTER: { label: 'Demand Letter', color: 'text-red-600', bg: 'bg-red-50' },
  ESCALATION: { label: 'Escalation', color: 'text-red-800', bg: 'bg-red-100' },
}

export default function ARAgentPage() {
  const { actions, stats, loading, running, runWorkflow, pauseTenant } = useARAgent()
  const [filter, setFilter] = useState<string>('all')

  // Group actions by tenant for timeline view
  const tenantMap = new Map<string, ARAction[]>()
  actions.forEach((a) => {
    const key = a.tenant_id
    if (!tenantMap.has(key)) tenantMap.set(key, [])
    tenantMap.get(key)!.push(a)
  })

  const filteredActions = filter === 'all'
    ? actions
    : actions.filter((a) => a.action_type === filter)

  const currentMonth = new Date().toISOString().slice(0, 7)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in duration-700">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Bot className="text-emerald-500" size={28} />
            <h1 className="text-4xl font-black tracking-tight text-slate-900 italic uppercase leading-none">
              AR <span className="text-emerald-600">Agent</span>
            </h1>
          </div>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] uppercase">
            Autonomous Accounts Receivable Collection Workflow
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/admin/finance" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-[10px] uppercase tracking-widest transition-colors">
            <ArrowLeft size={16} /> Finance
          </Link>
          <button
            onClick={() => runWorkflow()}
            disabled={running}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-500 transition-colors disabled:opacity-50 shadow-lg"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running ? 'Running...' : 'Run AR Workflow'}
          </button>
        </div>
      </div>

      {/* STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={TrendingUp} label="Total Actions" value={stats.totalActions} color="text-slate-600" bg="bg-white" />
        <StatCard icon={Mail} label="Reminders" value={stats.reminders} color="text-blue-600" bg="bg-blue-50" />
        <StatCard icon={DollarSign} label="Late Fees" value={stats.lateFees} color="text-orange-600" bg="bg-orange-50" />
        <StatCard icon={FileWarning} label="Demand Letters" value={stats.demandLetters} color="text-red-600" bg="bg-red-50" />
        <StatCard icon={AlertTriangle} label="Escalations" value={stats.escalations} color="text-red-800" bg="bg-red-100" />
        <StatCard icon={Pause} label="Paused" value={stats.paused} color="text-slate-500" bg="bg-slate-100" />
      </div>

      {/* FILTER TABS */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'REMINDER_1', 'REMINDER_2', 'REMINDER_3', 'LATE_FEE', 'DEMAND_LETTER', 'ESCALATION'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === f
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-400'
            }`}
          >
            {f === 'all' ? 'All' : ACTION_LABELS[f]?.label || f}
          </button>
        ))}
      </div>

      {/* ACTIONS TABLE */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      ) : filteredActions.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-[3rem] border border-slate-200 text-slate-400 italic text-sm font-bold">
          No AR actions yet. Enable the feature flag and run the workflow to begin automated collections.
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Tenant</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Month</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredActions.map((action) => {
                const style = ACTION_LABELS[action.action_type] || { label: action.action_type, color: 'text-slate-600', bg: 'bg-slate-50' }
                return (
                  <tr key={action.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-sm text-slate-900">{action.tenant_name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">{action.tenant_email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase ${style.bg} ${style.color}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-700">{action.month}</td>
                    <td className="px-6 py-4 text-sm font-black text-slate-900">
                      {action.amount_owed ? `$${Number(action.amount_owed).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`flex items-center gap-1 text-[9px] font-black uppercase ${
                        action.status === 'completed' ? 'text-emerald-600' :
                        action.status === 'paused' ? 'text-amber-600' : 'text-slate-400'
                      }`}>
                        {action.status === 'completed' ? <CheckCircle2 size={10} /> :
                         action.status === 'paused' ? <Pause size={10} /> : <Clock size={10} />}
                        {action.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-[10px] font-bold text-slate-400">
                      {new Date(action.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {action.status === 'completed' && action.month === currentMonth && (
                        <button
                          onClick={() => pauseTenant(action.tenant_id, action.month)}
                          className="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[9px] font-black uppercase hover:bg-amber-200 transition-colors"
                        >
                          Pause
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, bg }: {
  icon: any; label: string; value: number; color: string; bg: string
}) {
  return (
    <div className={`${bg} border border-slate-200 rounded-2xl p-5 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-2xl font-black italic ${color}`}>{value}</p>
    </div>
  )
}
