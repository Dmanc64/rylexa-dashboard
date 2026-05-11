'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, Plus, CalendarClock, Loader2, AlertCircle,
  Play, Pause, Trash2, History, Zap, FileText, FileSpreadsheet,
  Mail, Clock, CheckCircle2, XCircle, MoreVertical, X,
} from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { REPORT_TYPE_OPTIONS, type ReportType } from '@/hooks/useReports'
import {
  useScheduledReports,
  useScheduleRuns,
  useScheduleMutations,
  FREQUENCY_OPTIONS,
  DATE_RANGE_OPTIONS,
  TIMEZONE_OPTIONS,
  DAY_OF_WEEK_OPTIONS,
  type ReportSchedule,
  type CreateSchedulePayload,
  type ScheduleRecipient,
  type ScheduleFrequency,
  type DateRangeType,
} from '@/hooks/useScheduledReports'
import { supabase } from '@/lib/supabaseClient'
import { useQuery } from '@tanstack/react-query'
import AccessibleModal from '@/components/AccessibleModal'

export default function ScheduledReportsPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const { data: schedules, isLoading } = useScheduledReports()
  const mutations = useScheduleMutations()

  const [showModal, setShowModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ReportSchedule | null>(null)
  const [historyScheduleId, setHistoryScheduleId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Feature flags
  if (flagsLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    )
  }

  if (!isEnabled('reports') || !isEnabled('scheduled_reports')) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">Scheduled Report Delivery is currently disabled.</p>
        <p className="text-slate-400 text-xs">Enable the &quot;scheduled_reports&quot; feature flag in Settings.</p>
      </div>
    )
  }

  const handleEdit = (s: ReportSchedule) => {
    setEditingSchedule(s)
    setShowModal(true)
    setOpenMenuId(null)
  }

  const handleDelete = (id: string) => {
    if (confirm('Delete this schedule? All execution history will also be removed.')) {
      mutations.deleteSchedule.mutate(id)
    }
    setOpenMenuId(null)
  }

  const handleRunNow = (id: string) => {
    mutations.triggerNow.mutate(id)
    setOpenMenuId(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      <div className="max-w-[1400px] mx-auto">

        {/* HEADER */}
        <div className="mb-2">
          <Link href="/admin/reports" className="inline-flex items-center gap-1 text-slate-400 hover:text-blue-600 text-xs font-bold uppercase tracking-widest transition-colors mb-4">
            <ChevronLeft size={14} /> Report Center
          </Link>
        </div>
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Automation</p>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Scheduled <span className="text-blue-600">Reports</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {schedules?.length || 0} Schedule{(schedules?.length || 0) !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => { setEditingSchedule(null); setShowModal(true) }}
            className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all shadow-lg active:scale-95"
          >
            <Plus size={16} /> New Schedule
          </button>
        </div>

        {/* CONTENT */}
        {isLoading ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-20 text-center">
            <Loader2 size={32} className="animate-spin mx-auto text-blue-500 mb-3" />
            <p className="text-slate-400 font-bold text-sm">Loading schedules...</p>
          </div>
        ) : !schedules || schedules.length === 0 ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-20 text-center">
            <CalendarClock size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 font-bold text-lg mb-2">No Scheduled Reports</p>
            <p className="text-slate-400 text-sm mb-6">Automate report generation and delivery to your inbox.</p>
            <button
              onClick={() => { setEditingSchedule(null); setShowModal(true) }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all"
            >
              <Plus size={16} /> Create Your First Schedule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map(s => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onEdit={() => handleEdit(s)}
                onDelete={() => handleDelete(s.id)}
                onRunNow={() => handleRunNow(s.id)}
                onToggle={(active) => mutations.toggleSchedule.mutate({ id: s.id, is_active: active })}
                onHistory={() => setHistoryScheduleId(historyScheduleId === s.id ? null : s.id)}
                historyOpen={historyScheduleId === s.id}
                menuOpen={openMenuId === s.id}
                onMenuToggle={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                runningTrigger={mutations.triggerNow.isPending}
              />
            ))}
          </div>
        )}

        {/* CREATE/EDIT MODAL */}
        <ScheduleModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); setEditingSchedule(null) }}
          schedule={editingSchedule}
          onCreate={(p) => mutations.createSchedule.mutateAsync(p).then(() => { setShowModal(false); setEditingSchedule(null) })}
          onUpdate={(id, p) => mutations.updateSchedule.mutateAsync({ id, ...p }).then(() => { setShowModal(false); setEditingSchedule(null) })}
          saving={mutations.createSchedule.isPending || mutations.updateSchedule.isPending}
        />
      </div>
    </div>
  )
}

// ── Schedule Card ──
function ScheduleCard({
  schedule: s, onEdit, onDelete, onRunNow, onToggle, onHistory, historyOpen, menuOpen, onMenuToggle, runningTrigger,
}: {
  schedule: ReportSchedule; onEdit: () => void; onDelete: () => void; onRunNow: () => void
  onToggle: (active: boolean) => void; onHistory: () => void; historyOpen: boolean
  menuOpen: boolean; onMenuToggle: () => void; runningTrigger: boolean
}) {
  const reportOpt = REPORT_TYPE_OPTIONS.find(o => o.value === s.report_type)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 flex items-center gap-4">
        {/* Icon */}
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${s.format === 'pdf' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {s.format === 'pdf' ? <FileText size={20} /> : <FileSpreadsheet size={20} />}
        </div>

        {/* Name & meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-black text-slate-900 truncate">{s.name}</h3>
            {!s.is_active && (
              <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-slate-100 text-slate-400 border border-slate-200">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className={`px-2 py-0.5 rounded-lg border ${reportOpt?.color || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              {reportOpt?.label || s.report_type}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {s.frequency === 'daily' ? 'Daily' : s.frequency === 'weekly' ? `Weekly (${DAY_OF_WEEK_OPTIONS.find(d => d.value === s.day_of_week)?.label || 'Mon'})` : `Monthly (Day ${s.day_of_month || 1})`}
            </span>
            <span className="flex items-center gap-1">
              <Mail size={10} />
              {s.recipients?.length || 0} recipient{(s.recipients?.length || 0) !== 1 ? 's' : ''}
            </span>
            <span>{s.format.toUpperCase()}</span>
          </div>
        </div>

        {/* Next/Last run */}
        <div className="text-right shrink-0 hidden md:block">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Next Run</p>
          <p className="text-xs font-bold text-slate-700">
            {s.is_active && s.next_run_at ? new Date(s.next_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
          </p>
        </div>

        {/* Toggle */}
        <button
          type="button"
          onClick={() => onToggle(!s.is_active)}
          className="shrink-0"
          title={s.is_active ? 'Pause schedule' : 'Activate schedule'}
        >
          <div className={`relative w-11 h-6 rounded-full transition-colors ${s.is_active ? 'bg-emerald-500' : 'bg-slate-200'}`}>
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.is_active ? 'translate-x-5' : ''}`} />
          </div>
        </button>

        {/* Actions menu */}
        <div className="relative shrink-0">
          <button onClick={onMenuToggle} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <MoreVertical size={16} className="text-slate-400" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 bg-white border border-slate-200 rounded-xl shadow-xl z-20 w-44 py-1">
              <button onClick={onEdit} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 transition-colors">
                Edit Schedule
              </button>
              <button onClick={onRunNow} disabled={runningTrigger} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-40">
                <Zap size={14} className="text-amber-500" /> Run Now
              </button>
              <button onClick={onHistory} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2">
                <History size={14} className="text-blue-500" /> History
              </button>
              <hr className="my-1 border-slate-100" />
              <button onClick={onDelete} className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* History panel */}
      {historyOpen && <HistoryPanel scheduleId={s.id} />}
    </div>
  )
}

// ── History Panel ──
function HistoryPanel({ scheduleId }: { scheduleId: string }) {
  const { data: runs, isLoading } = useScheduleRuns(scheduleId)

  if (isLoading) {
    return (
      <div className="px-5 pb-5 pt-0">
        <div className="bg-slate-50 rounded-xl p-6 text-center">
          <Loader2 size={20} className="animate-spin mx-auto text-blue-500" />
        </div>
      </div>
    )
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="px-5 pb-5 pt-0">
        <div className="bg-slate-50 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm font-medium">No execution history yet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-5 pb-5 pt-0">
      <div className="bg-slate-50 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Started</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
              <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Rows</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Duration</th>
              <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {runs.map(run => {
              const duration = run.completed_at && run.started_at
                ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                : null
              return (
                <tr key={run.id}>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-600">
                    {new Date(run.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5">
                    {run.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 size={10} /> Completed
                      </span>
                    ) : run.status === 'failed' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-red-50 text-red-700 border border-red-200">
                        <XCircle size={10} /> Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">
                        <Loader2 size={10} className="animate-spin" /> Running
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-bold text-slate-700 text-right">{run.row_count ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{duration !== null ? `${duration}s` : '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">
                    {run.error_details || (run.recipients_sent?.length ? `Sent to ${run.recipients_sent.length} recipient(s)` : '—')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Schedule Modal ──
function ScheduleModal({
  isOpen, onClose, schedule, onCreate, onUpdate, saving,
}: {
  isOpen: boolean; onClose: () => void; schedule: ReportSchedule | null
  onCreate: (p: CreateSchedulePayload) => Promise<void>
  onUpdate: (id: string, p: Partial<CreateSchedulePayload>) => Promise<void>
  saving: boolean
}) {
  const isEdit = !!schedule
  const [name, setName] = useState(schedule?.name || '')
  const [reportType, setReportType] = useState<ReportType>(schedule?.report_type || 'rent_roll')
  const [format, setFormat] = useState<'pdf' | 'csv'>(schedule?.format || 'pdf')
  const [propertyId, setPropertyId] = useState(schedule?.filters?.propertyId || '')
  const [dateRangeType, setDateRangeType] = useState<DateRangeType>(schedule?.filters?.dateRangeType as DateRangeType || 'current_month')
  const [dateFrom, setDateFrom] = useState(schedule?.filters?.dateFrom || '')
  const [dateTo, setDateTo] = useState(schedule?.filters?.dateTo || '')
  const [ownerId, setOwnerId] = useState(schedule?.filters?.ownerId || '')
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule?.frequency || 'weekly')
  const [dayOfWeek, setDayOfWeek] = useState(schedule?.day_of_week ?? 1)
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.day_of_month ?? 1)
  const [timeOfDay, setTimeOfDay] = useState(schedule?.time_of_day?.substring(0, 5) || '08:00')
  const [timezone, setTimezone] = useState(schedule?.timezone || 'America/Los_Angeles')
  const [recipients, setRecipients] = useState<ScheduleRecipient[]>(
    schedule?.recipients?.length ? schedule.recipients : [{ email: '', name: '' }]
  )

  // Reset form when modal opens with different schedule
  React.useEffect(() => {
    if (isOpen) {
      setName(schedule?.name || '')
      setReportType(schedule?.report_type || 'rent_roll')
      setFormat(schedule?.format || 'pdf')
      setPropertyId(schedule?.filters?.propertyId || '')
      setDateRangeType(schedule?.filters?.dateRangeType as DateRangeType || 'current_month')
      setDateFrom(schedule?.filters?.dateFrom || '')
      setDateTo(schedule?.filters?.dateTo || '')
      setOwnerId(schedule?.filters?.ownerId || '')
      setFrequency(schedule?.frequency || 'weekly')
      setDayOfWeek(schedule?.day_of_week ?? 1)
      setDayOfMonth(schedule?.day_of_month ?? 1)
      setTimeOfDay(schedule?.time_of_day?.substring(0, 5) || '08:00')
      setTimezone(schedule?.timezone || 'America/Los_Angeles')
      setRecipients(schedule?.recipients?.length ? schedule.recipients : [{ email: '', name: '' }])
    }
  }, [isOpen, schedule])

  // Property options
  const { data: properties } = useQuery({
    queryKey: ['schedule-properties'],
    queryFn: async () => {
      const { data } = await supabase.from('properties').select('id, name').order('name')
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

  // Owner options
  const { data: owners } = useQuery({
    queryKey: ['schedule-owners'],
    queryFn: async () => {
      const { data } = await supabase.from('owners').select('id, full_name').order('full_name')
      return data ?? []
    },
    enabled: reportType === 'owner_statement',
    staleTime: 5 * 60_000,
  })

  const addRecipient = () => setRecipients([...recipients, { email: '', name: '' }])
  const removeRecipient = (i: number) => setRecipients(recipients.filter((_, idx) => idx !== i))
  const updateRecipient = (i: number, field: 'email' | 'name', val: string) => {
    const updated = [...recipients]
    updated[i] = { ...updated[i], [field]: val }
    setRecipients(updated)
  }

  const validRecipients = recipients.filter(r => r.email.includes('@'))
  const canSave = name.trim() && validRecipients.length > 0

  const handleSave = async () => {
    const payload: CreateSchedulePayload = {
      name: name.trim(),
      report_type: reportType,
      format,
      filters: {
        propertyId: propertyId || undefined,
        dateRangeType,
        dateFrom: dateRangeType === 'custom' ? dateFrom : undefined,
        dateTo: dateRangeType === 'custom' ? dateTo : undefined,
        ownerId: reportType === 'owner_statement' ? (ownerId || undefined) : undefined,
      },
      frequency,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      day_of_month: frequency === 'monthly' ? dayOfMonth : null,
      time_of_day: timeOfDay,
      timezone,
      recipients: validRecipients,
    }

    if (isEdit && schedule) {
      await onUpdate(schedule.id, payload)
    } else {
      await onCreate(payload)
    }
  }

  const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5'
  const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500'
  const selectCls = `${inputCls} appearance-none`

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Schedule' : 'New Scheduled Report'}
      subtitle="Configure automated report generation and delivery"
      size="max-w-2xl"
    >
      <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Name */}
        <div>
          <label className={labelCls}>Schedule Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Weekly Rent Roll for Owners" className={inputCls} />
        </div>

        {/* Report Type + Format */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Report Type</label>
            <select value={reportType} onChange={e => setReportType(e.target.value as ReportType)} className={selectCls}>
              {REPORT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Format</label>
            <div className="flex gap-2 mt-0.5">
              {(['pdf', 'csv'] as const).map(f => (
                <button key={f} type="button" onClick={() => setFormat(f)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${format === f ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                  {f === 'pdf' ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filters</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Property</label>
              <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className={selectCls}>
                <option value="">All Properties</option>
                {properties?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date Range</label>
              <select value={dateRangeType} onChange={e => setDateRangeType(e.target.value as DateRangeType)} className={selectCls}>
                {DATE_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {dateRangeType === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}
          {reportType === 'owner_statement' && (
            <div>
              <label className={labelCls}>Owner</label>
              <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={selectCls}>
                <option value="">All Owners</option>
                {owners?.map((o: any) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Schedule</p>
          <div className="flex gap-2">
            {FREQUENCY_OPTIONS.map(f => (
              <button key={f.value} type="button" onClick={() => setFrequency(f.value)}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${frequency === f.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {frequency === 'weekly' && (
              <div>
                <label className={labelCls}>Day of Week</label>
                <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))} className={selectCls}>
                  {DAY_OF_WEEK_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}
            {frequency === 'monthly' && (
              <div>
                <label className={labelCls}>Day of Month</label>
                <select value={dayOfMonth} onChange={e => setDayOfMonth(Number(e.target.value))} className={selectCls}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Time</label>
              <input type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={selectCls}>
                {TIMEZONE_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Recipients */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recipients</p>
            <button type="button" onClick={addRecipient} className="text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors">
              + Add Recipient
            </button>
          </div>
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="email" value={r.email} onChange={e => updateRecipient(i, 'email', e.target.value)}
                placeholder="email@example.com" className={`${inputCls} flex-1`} />
              <input type="text" value={r.name || ''} onChange={e => updateRecipient(i, 'name', e.target.value)}
                placeholder="Name (optional)" className={`${inputCls} w-40`} />
              {recipients.length > 1 && (
                <button type="button" onClick={() => removeRecipient(i)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all disabled:opacity-40"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Save Changes' : 'Create Schedule'}
        </button>
      </div>
    </AccessibleModal>
  )
}
