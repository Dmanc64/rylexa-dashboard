'use client'

import { useState, useMemo } from 'react'
import {
  RotateCcw, Plus, LayoutTemplate, Loader2,
  Building2, Calendar, DollarSign, Clock, CheckCircle2,
  ChevronRight, Wrench, X, Check, AlertCircle,
  BarChart3, ArrowRight, Hammer, Ban
} from 'lucide-react'
import { toast } from 'sonner'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useProperties } from '@/hooks/useProperties'
import {
  useUnitTurns,
  useTurnTasks,
  useTurnSummary,
  useTurnTemplates,
  TURN_STATUS_OPTIONS,
  TASK_CATEGORY_OPTIONS,
  TASK_STATUS_OPTIONS,
  type UnitTurn,
  type TurnTask,
  type TurnFilters,
} from '@/hooks/useUnitTurns'
import NewTurnModal from '@/components/NewTurnModal'
import TurnTemplateModal from '@/components/TurnTemplateModal'

// ── Helpers ──────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function getCategoryColor(category: string): string {
  return TASK_CATEGORY_OPTIONS.find(c => c.value === category)?.color ?? 'bg-gray-100 text-gray-700'
}

function getStatusColor(status: string): string {
  return TURN_STATUS_OPTIONS.find(s => s.value === status)?.color ?? 'bg-slate-100 text-slate-600'
}

// ── Page Component ───────────────────────────────────────

export default function UnitTurnBoardPage() {
  const { isEnabled } = useFeatureFlags()
  const turnsEnabled = isEnabled('unit_turns')

  // ── Filters ──
  const [filterPropertyId, setFilterPropertyId] = useState('')
  const filters: TurnFilters = {
    property_id: filterPropertyId || undefined,
  }

  // ── Data ──
  const { properties, loading: loadingProperties } = useProperties()
  const { turns, loading: loadingTurns, completeTurn, completing, cancelTurn, cancelling } = useUnitTurns(filters)
  const { summary, loading: loadingSummary } = useTurnSummary()

  // ── Selected turn for detail panel ──
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const selectedTurn = turns.find(t => t.id === selectedTurnId) ?? null

  const { tasks, loading: loadingTasks, addTask, adding, completeTask: completeTaskMutation, completing: completingTask, updateTask, updating: updatingTask, createWorkOrder, creatingWorkOrder } = useTurnTasks(selectedTurnId)

  // ── Modals ──
  const [isNewTurnOpen, setIsNewTurnOpen] = useState(false)
  const [isTemplateOpen, setIsTemplateOpen] = useState(false)

  // ── Inline add task ──
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskCategory, setNewTaskCategory] = useState('General')

  // ── Board columns ──
  const pendingTurns = useMemo(() => turns.filter(t => t.status === 'Pending'), [turns])
  const inProgressTurns = useMemo(() => turns.filter(t => t.status === 'In Progress'), [turns])
  const completedTurns = useMemo(() => turns.filter(t => t.status === 'Completed'), [turns])

  // ── KPI aggregates across all properties ──
  const kpis = useMemo(() => {
    const activeTurns = summary.reduce((sum, s) => sum + s.active_turns, 0)
    const avgDaysArr = summary.filter(s => s.avg_turn_days !== null).map(s => s.avg_turn_days!)
    const avgCostArr = summary.filter(s => s.avg_turn_cost !== null).map(s => s.avg_turn_cost!)
    const completedThisMonth = summary.reduce((sum, s) => sum + s.completed_this_month, 0)
    return {
      activeTurns,
      avgDays: avgDaysArr.length > 0 ? Math.round(avgDaysArr.reduce((a, b) => a + b, 0) / avgDaysArr.length) : 0,
      avgCost: avgCostArr.length > 0 ? Math.round(avgCostArr.reduce((a, b) => a + b, 0) / avgCostArr.length) : 0,
      completedThisMonth,
    }
  }, [summary])

  // ── Task helpers ──
  const allTasksDone = tasks.length > 0 && tasks.every(t => t.status === 'Completed' || t.status === 'Skipped')
  const completedTaskCount = tasks.filter(t => t.status === 'Completed' || t.status === 'Skipped').length

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !selectedTurnId) return
    try {
      await addTask({
        turn_id: selectedTurnId,
        title: newTaskTitle.trim(),
        category: newTaskCategory,
        sort_order: tasks.length,
      })
      setNewTaskTitle('')
      setNewTaskCategory('General')
    } catch {
      // handled by hook
    }
  }

  const handleToggleTaskComplete = async (task: TurnTask) => {
    if (task.status === 'Completed') {
      await updateTask({ id: task.id, status: 'Pending' })
    } else {
      await completeTaskMutation(task.id)
    }
  }

  const cycleTaskStatus = async (task: TurnTask) => {
    const order = ['Pending', 'In Progress', 'Completed']
    const idx = order.indexOf(task.status)
    const next = order[(idx + 1) % order.length]
    if (next === 'Completed') {
      await completeTaskMutation(task.id)
    } else {
      await updateTask({ id: task.id, status: next })
    }
  }

  const handleCompleteTurn = async () => {
    if (!selectedTurnId) return
    try {
      await completeTurn(selectedTurnId)
      setSelectedTurnId(null)
    } catch {
      // handled by hook
    }
  }

  const handleCancelTurn = async () => {
    if (!selectedTurnId) return
    try {
      await cancelTurn(selectedTurnId)
      setSelectedTurnId(null)
    } catch {
      // handled by hook
    }
  }

  const handleCreateWorkOrder = async (taskId: string) => {
    try {
      await createWorkOrder(taskId)
    } catch {
      // handled by hook
    }
  }

  // ── Feature flag gate ──
  if (!turnsEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <RotateCcw size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-black text-slate-900 italic">Unit Turn Board</h2>
          <p className="text-slate-500 text-sm mt-2">
            This feature is not enabled. Enable the <strong>unit_turns</strong> flag in Settings to activate.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 animate-in fade-in">

      {/* ── HEADER ── */}
      <div className="bg-white border-b border-slate-200 px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase">Unit Turn Board</h1>
            <p className="text-slate-500 font-medium text-sm mt-1">Track unit make-readies from move-out to rent-ready.</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Property Filter */}
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={filterPropertyId}
                onChange={(e) => { setFilterPropertyId(e.target.value); setSelectedTurnId(null) }}
                disabled={loadingProperties}
                className="pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">All Properties</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setIsTemplateOpen(true)}
              className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <LayoutTemplate size={14} /> Templates
            </button>

            <button
              onClick={() => setIsNewTurnOpen(true)}
              className="px-5 py-2.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg"
            >
              <Plus size={14} /> New Turn
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 md:px-10 py-8 space-y-8">

        {/* ── KPI CARDS ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Active Turns"
            value={loadingSummary ? '...' : String(kpis.activeTurns)}
            icon={<RotateCcw size={18} />}
            color="text-blue-600"
          />
          <KpiCard
            label="Avg Turn Days"
            value={loadingSummary ? '...' : `${kpis.avgDays}d`}
            icon={<Clock size={18} />}
            color="text-amber-600"
          />
          <KpiCard
            label="Avg Turn Cost"
            value={loadingSummary ? '...' : formatCurrency(kpis.avgCost)}
            icon={<DollarSign size={18} />}
            color="text-emerald-600"
          />
          <KpiCard
            label="Completed This Month"
            value={loadingSummary ? '...' : String(kpis.completedThisMonth)}
            icon={<CheckCircle2 size={18} />}
            color="text-violet-600"
          />
        </div>

        {/* ── BOARD + DETAIL PANEL ── */}
        <div className="flex gap-6 min-h-[600px]">

          {/* Board Columns */}
          <div className={`flex-1 grid grid-cols-3 gap-4 transition-all ${selectedTurn ? 'max-w-[60%]' : ''}`}>

            {/* Pending Column */}
            <BoardColumn
              title="Pending"
              count={pendingTurns.length}
              color="bg-slate-500"
              loading={loadingTurns}
            >
              {pendingTurns.map(turn => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  isSelected={turn.id === selectedTurnId}
                  onClick={() => setSelectedTurnId(turn.id === selectedTurnId ? null : turn.id)}
                />
              ))}
            </BoardColumn>

            {/* In Progress Column */}
            <BoardColumn
              title="In Progress"
              count={inProgressTurns.length}
              color="bg-blue-500"
              loading={loadingTurns}
            >
              {inProgressTurns.map(turn => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  isSelected={turn.id === selectedTurnId}
                  onClick={() => setSelectedTurnId(turn.id === selectedTurnId ? null : turn.id)}
                />
              ))}
            </BoardColumn>

            {/* Completed Column */}
            <BoardColumn
              title="Completed"
              count={completedTurns.length}
              color="bg-emerald-500"
              loading={loadingTurns}
            >
              {completedTurns.map(turn => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  isSelected={turn.id === selectedTurnId}
                  onClick={() => setSelectedTurnId(turn.id === selectedTurnId ? null : turn.id)}
                />
              ))}
            </BoardColumn>
          </div>

          {/* ── DETAIL PANEL ── */}
          {selectedTurn && (
            <div className="w-[40%] min-w-[380px] bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col animate-in slide-in-from-right-4 duration-200">

              {/* Detail Header */}
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-start justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-black text-lg">{selectedTurn.unit_name}</h3>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${getStatusColor(selectedTurn.status)}`}>
                      {selectedTurn.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{selectedTurn.property_name}</p>
                </div>
                <button
                  onClick={() => setSelectedTurnId(null)}
                  className="text-slate-400 hover:bg-slate-200 p-2 rounded-xl transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Detail Body (scrollable) */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {/* Turn Meta */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Move-Out Date</p>
                    <p className="text-sm font-bold">{new Date(selectedTurn.move_out_date).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Days Since Move-Out</p>
                    <p className="text-sm font-bold">{daysSince(selectedTurn.move_out_date)}d</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Target Ready Date</p>
                    <p className="text-sm font-bold">
                      {selectedTurn.target_ready_date
                        ? new Date(selectedTurn.target_ready_date).toLocaleDateString()
                        : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Est. Cost</p>
                    <p className="text-sm font-bold text-emerald-600">{formatCurrency(selectedTurn.total_estimated_cost)}</p>
                  </div>
                </div>

                {selectedTurn.notes && (
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1">Notes</p>
                    <p className="text-sm text-slate-700 italic">{selectedTurn.notes}</p>
                  </div>
                )}

                {/* Task Progress */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Task Progress
                    </p>
                    <span className="text-[10px] font-bold text-slate-500">
                      {completedTaskCount}/{tasks.length}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: tasks.length > 0 ? `${(completedTaskCount / tasks.length) * 100}%` : '0%' }}
                    />
                  </div>
                </div>

                {/* Task Checklist */}
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tasks</p>

                  {loadingTasks ? (
                    <div className="py-8 flex justify-center">
                      <Loader2 size={20} className="animate-spin text-slate-400" />
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-sm italic">
                      No tasks yet. Add one below.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {tasks.map(task => (
                        <div
                          key={task.id}
                          className={`rounded-xl border p-3 transition-all ${
                            task.status === 'Completed'
                              ? 'bg-emerald-50/50 border-emerald-100'
                              : task.status === 'Skipped'
                              ? 'bg-slate-50 border-slate-100 opacity-60'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Checkbox */}
                            <button
                              onClick={() => handleToggleTaskComplete(task)}
                              disabled={completingTask || updatingTask}
                              className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                task.status === 'Completed'
                                  ? 'bg-emerald-600 border-emerald-600'
                                  : 'border-slate-300 hover:border-emerald-400'
                              }`}
                            >
                              {task.status === 'Completed' && <Check size={12} className="text-white" />}
                            </button>

                            <div className="flex-1 min-w-0">
                              {/* Task title + category */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-sm font-bold ${task.status === 'Completed' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                  {task.title}
                                </span>
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${getCategoryColor(task.category)}`}>
                                  {task.category}
                                </span>
                              </div>

                              {/* Task details row */}
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                {task.vendor_name && (
                                  <span className="text-[10px] text-slate-500 font-medium">
                                    {task.vendor_name}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400 font-medium">
                                  Est: {formatCurrency(task.estimated_cost)}
                                </span>
                                {task.actual_cost > 0 && (
                                  <span className="text-[10px] text-emerald-600 font-bold">
                                    Act: {formatCurrency(task.actual_cost)}
                                  </span>
                                )}

                                {/* Status cycle button */}
                                <button
                                  onClick={() => cycleTaskStatus(task)}
                                  disabled={updatingTask || completingTask}
                                  className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                                    task.status === 'Pending'
                                      ? 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600'
                                      : task.status === 'In Progress'
                                      ? 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600'
                                      : 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-slate-50 hover:border-slate-200 hover:text-slate-500'
                                  }`}
                                >
                                  {task.status}
                                </button>
                              </div>
                            </div>

                            {/* Create WO button */}
                            {!task.work_order_id && task.status !== 'Completed' && task.status !== 'Skipped' && (
                              <button
                                onClick={() => handleCreateWorkOrder(task.id)}
                                disabled={creatingWorkOrder}
                                title="Create Work Order"
                                className="mt-0.5 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors shrink-0"
                              >
                                {creatingWorkOrder ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Wrench size={14} />
                                )}
                              </button>
                            )}
                            {task.work_order_id && (
                              <span className="mt-0.5 text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                                WO
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline Add Task */}
                  {selectedTurn.status !== 'Completed' && selectedTurn.status !== 'Cancelled' && (
                    <div className="flex gap-2 mt-3">
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTask() } }}
                        placeholder="Add a task..."
                        className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <select
                        value={newTaskCategory}
                        onChange={(e) => setNewTaskCategory(e.target.value)}
                        className="px-2 py-2 border border-slate-200 rounded-xl text-[10px] font-bold outline-none bg-white appearance-none cursor-pointer"
                      >
                        {TASK_CATEGORY_OPTIONS.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleAddTask}
                        disabled={adding || !newTaskTitle.trim()}
                        className="px-3 py-2 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50"
                      >
                        {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Detail Footer Actions */}
              {selectedTurn.status !== 'Completed' && selectedTurn.status !== 'Cancelled' && (
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleCancelTurn}
                    disabled={cancelling}
                    className="px-4 py-2.5 text-red-500 font-black text-[10px] uppercase tracking-widest hover:bg-red-50 rounded-xl transition-colors flex items-center gap-2"
                  >
                    {cancelling ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                    Cancel Turn
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleCompleteTurn}
                    disabled={completing || !allTasksDone}
                    title={!allTasksDone ? 'Complete all tasks first' : 'Mark turn as completed'}
                    className="px-6 py-2.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {completing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Complete Turn
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}
      <NewTurnModal
        isOpen={isNewTurnOpen}
        onClose={() => setIsNewTurnOpen(false)}
      />

      <TurnTemplateModal
        isOpen={isTemplateOpen}
        onClose={() => setIsTemplateOpen(false)}
      />
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <div className={`${color}`}>{icon}</div>
      </div>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
    </div>
  )
}

function BoardColumn({
  title,
  count,
  color,
  loading,
  children,
}: {
  title: string
  count: number
  color: string
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">{title}</h3>
        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="flex-1 space-y-3 min-h-[200px]">
        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 size={20} className="animate-spin text-slate-300" />
          </div>
        ) : count === 0 ? (
          <div className="py-12 text-center">
            <p className="text-xs text-slate-400 italic">No turns</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function TurnCard({
  turn,
  isSelected,
  onClick,
}: {
  turn: UnitTurn
  isSelected: boolean
  onClick: () => void
}) {
  const taskCount = turn.tasks?.length ?? 0
  const doneCount = turn.tasks?.filter(t => t.status === 'Completed' || t.status === 'Skipped').length ?? 0
  const progress = taskCount > 0 ? (doneCount / taskCount) * 100 : 0
  const days = daysSince(turn.move_out_date)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-2xl border transition-all ${
        isSelected
          ? 'bg-blue-50 border-blue-300 shadow-md ring-2 ring-blue-200'
          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-bold text-sm">{turn.unit_name}</p>
          <p className="text-[10px] text-slate-500 font-medium">{turn.property_name}</p>
        </div>
        <ChevronRight size={14} className="text-slate-400 mt-0.5 shrink-0" />
      </div>

      <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium mb-2.5">
        <span className="flex items-center gap-1">
          <Calendar size={10} />
          {new Date(turn.move_out_date).toLocaleDateString()}
        </span>
        <span className={`font-bold ${days > 14 ? 'text-red-500' : days > 7 ? 'text-amber-500' : 'text-slate-500'}`}>
          {days}d
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400 font-medium">{doneCount}/{taskCount} tasks</span>
        <span className="font-bold text-emerald-600">{formatCurrency(turn.total_estimated_cost)}</span>
      </div>
    </button>
  )
}
