'use client'

import { useState } from 'react'
import {
  RefreshCw, Plus, X, Loader2, Calendar, Wrench,
  ToggleLeft, ToggleRight, ChevronDown, Trash2, Zap,
} from 'lucide-react'
import {
  useRecurringMaintenance,
  FREQUENCY_OPTIONS,
  PRIORITY_OPTIONS,
  getFrequencyColor,
  getFrequencyLabel,
  getPriorityColor,
  type RecurringFrequency,
  type RecurringPriority,
} from '@/hooks/useRecurringMaintenance'

// ── Frequency badge ────────────────────────────────────────

const FREQ_BADGE_CLASSES: Record<string, string> = {
  violet: 'bg-violet-50 text-violet-600',
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  orange: 'bg-orange-50 text-orange-600',
  slate: 'bg-slate-100 text-slate-600',
}

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
}

function FrequencyBadge({ frequency }: { frequency: string }) {
  const color = getFrequencyColor(frequency)
  const label = getFrequencyLabel(frequency)
  const classes = FREQ_BADGE_CLASSES[color] || FREQ_BADGE_CLASSES.slate

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${classes}`}>
      <Calendar size={10} /> {label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = getPriorityColor(priority)
  const classes = PRIORITY_BADGE_CLASSES[color] || PRIORITY_BADGE_CLASSES.slate

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${classes}`}>
      {priority}
    </span>
  )
}

// ── Inline create form ─────────────────────────────────────

type FormState = {
  title: string
  description: string
  property_id: string
  frequency: RecurringFrequency
  priority: RecurringPriority
  next_due_date: string
  category: string
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  property_id: '',
  frequency: 'monthly',
  priority: 'Normal',
  next_due_date: '',
  category: '',
}

function CreateTaskForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (form: FormState) => void
  onCancel: () => void
  submitting: boolean
}) {
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    next_due_date: new Date().toISOString().split('T')[0],
  })

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const canSubmit = form.title.trim() && form.property_id.trim() && form.next_due_date

  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Wrench size={14} className="text-emerald-500" /> New Recurring Task
        </h3>
        <button
          onClick={onCancel}
          className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <X size={16} className="text-slate-400" />
        </button>
      </div>

      {/* Title */}
      <div>
        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
          Title *
        </label>
        <input
          type="text"
          value={form.title}
          onChange={e => update('title', e.target.value)}
          placeholder="e.g., HVAC Filter Replacement"
          className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={e => update('description', e.target.value)}
          rows={2}
          placeholder="Detailed description of the recurring task..."
          className="w-full p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
        />
      </div>

      {/* Property + Category row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Property ID *
          </label>
          <input
            type="text"
            value={form.property_id}
            onChange={e => update('property_id', e.target.value)}
            placeholder="Property UUID or name"
            className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Category
          </label>
          <input
            type="text"
            value={form.category}
            onChange={e => update('category', e.target.value)}
            placeholder="e.g., HVAC, Plumbing"
            className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Frequency + Priority + Start Date row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Frequency *
          </label>
          <div className="relative">
            <select
              value={form.frequency}
              onChange={e => update('frequency', e.target.value as RecurringFrequency)}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none bg-white pr-8"
            >
              {FREQUENCY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Priority *
          </label>
          <div className="relative">
            <select
              value={form.priority}
              onChange={e => update('priority', e.target.value as RecurringPriority)}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none bg-white pr-8"
            >
              {PRIORITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
            Start Date *
          </label>
          <input
            type="date"
            value={form.next_due_date}
            onChange={e => update('next_due_date', e.target.value)}
            className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={() => onSubmit(form)}
          disabled={!canSubmit || submitting}
          className="flex-1 py-3 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Creating...
            </>
          ) : (
            <>
              <Plus size={16} /> Create Recurring Task
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-5 py-3 bg-white border border-slate-200 text-slate-600 font-black rounded-xl hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────

export default function RecurringMaintenancePanel() {
  const {
    tasks,
    loading,
    createTask,
    creating,
    toggleActive,
    toggling,
    generateNow,
    generating,
    deleteTask,
    deleting,
  } = useRecurringMaintenance()

  const [showForm, setShowForm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleCreate = async (form: FormState) => {
    await createTask({
      title: form.title.trim(),
      description: form.description || null,
      property_id: form.property_id.trim(),
      frequency: form.frequency,
      priority: form.priority,
      next_due_date: form.next_due_date,
      category: form.category || null,
    })
    setShowForm(false)
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    await toggleActive({ id, is_active: !currentActive })
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteTask(id)
    } finally {
      setDeletingId(null)
    }
  }

  const handleGenerate = async () => {
    await generateNow()
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const isOverdue = (dateStr: string) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(dateStr + 'T00:00:00')
    return due < today
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* HEADER */}
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase">
              Automated Scheduling
            </p>
            <h2 className="text-2xl font-black italic tracking-tighter">
              Recurring Maintenance
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-all active:scale-95 shadow-sm disabled:opacity-50 flex items-center gap-2 font-black text-[10px] uppercase tracking-widest"
              title="Generate due work orders now"
            >
              {generating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              Generate Now
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-5 py-3 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all active:scale-95 shadow-md flex items-center gap-2 font-black text-[10px] uppercase tracking-widest"
            >
              {showForm ? <X size={14} /> : <Plus size={14} />}
              {showForm ? 'Close' : 'Add Task'}
            </button>
          </div>
        </div>
      </div>

      {/* INLINE FORM */}
      {showForm && (
        <div className="p-6 border-b border-slate-100">
          <CreateTaskForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            submitting={creating}
          />
        </div>
      )}

      {/* TASK LIST */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-10 text-center">
            <Loader2 className="animate-spin mx-auto text-emerald-500" size={24} />
            <p className="text-slate-400 text-xs mt-2">Loading recurring tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-10 text-center">
            <RefreshCw size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-400 font-bold text-sm">No recurring tasks</p>
            <p className="text-slate-400 text-xs mt-1">
              Create your first recurring maintenance task to automate work order generation.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Task
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Property
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Frequency
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Priority
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Next Due
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Vendor
                </th>
                <th className="text-center px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Active
                </th>
                <th className="text-center px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tasks.map(task => (
                <tr
                  key={task.id}
                  className={`hover:bg-slate-50 transition-colors ${
                    !task.is_active ? 'opacity-50' : ''
                  }`}
                >
                  {/* Title + description */}
                  <td className="px-6 py-4">
                    <p className="font-black text-slate-900 text-sm">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">
                        {task.description}
                      </p>
                    )}
                    {task.category && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded bg-slate-100 text-[9px] font-bold text-slate-500 uppercase">
                        {task.category}
                      </span>
                    )}
                  </td>

                  {/* Property */}
                  <td className="px-4 py-4">
                    <p className="font-bold text-slate-700 text-sm">{task.property_name}</p>
                    {task.unit_name && (
                      <p className="text-[10px] text-slate-400 mt-0.5">Unit: {task.unit_name}</p>
                    )}
                  </td>

                  {/* Frequency */}
                  <td className="px-4 py-4">
                    <FrequencyBadge frequency={task.frequency} />
                  </td>

                  {/* Priority */}
                  <td className="px-4 py-4">
                    <PriorityBadge priority={task.priority} />
                  </td>

                  {/* Next Due */}
                  <td className="px-4 py-4">
                    <p className={`font-bold text-sm ${
                      task.is_active && isOverdue(task.next_due_date)
                        ? 'text-red-600'
                        : 'text-slate-700'
                    }`}>
                      {formatDate(task.next_due_date)}
                    </p>
                    {task.is_active && isOverdue(task.next_due_date) && (
                      <p className="text-[9px] font-black text-red-500 uppercase tracking-wider mt-0.5">
                        Overdue
                      </p>
                    )}
                    {task.last_generated_at && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Last: {formatDate(task.last_generated_at.split('T')[0])}
                      </p>
                    )}
                  </td>

                  {/* Vendor */}
                  <td className="px-4 py-4">
                    <p className="text-sm text-slate-600">
                      {task.vendor_name || <span className="text-slate-300 italic">Unassigned</span>}
                    </p>
                  </td>

                  {/* Active toggle */}
                  <td className="px-4 py-4 text-center">
                    <button
                      onClick={() => handleToggle(task.id, task.is_active)}
                      disabled={toggling}
                      className="inline-flex items-center justify-center transition-colors hover:opacity-80 disabled:opacity-50"
                      title={task.is_active ? 'Pause task' : 'Activate task'}
                    >
                      {task.is_active ? (
                        <ToggleRight size={28} className="text-emerald-500" />
                      ) : (
                        <ToggleLeft size={28} className="text-slate-300" />
                      )}
                    </button>
                  </td>

                  {/* Delete */}
                  <td className="px-4 py-4 text-center">
                    <button
                      onClick={() => handleDelete(task.id)}
                      disabled={deleting && deletingId === task.id}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50"
                      title="Delete recurring task"
                    >
                      {deleting && deletingId === task.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* FOOTER STATS */}
      {!loading && tasks.length > 0 && (
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex gap-4">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {tasks.filter(t => t.is_active).length} Active
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {tasks.filter(t => !t.is_active).length} Paused
            </span>
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
              {tasks.filter(t => t.is_active && isOverdue(t.next_due_date)).length} Overdue
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-400">
            {tasks.length} total task{tasks.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
