'use client'

import { useState } from 'react'
import {
  Loader2, ChevronDown, ChevronUp, XCircle,
  CheckCircle2, Clock, AlertTriangle, SkipForward, Play
} from 'lucide-react'
import {
  useWorkflowRuns,
  useWorkflowStepRuns,
  useWorkflowMutations,
  type WorkflowRun,
  type WorkflowRunStatus,
  type StepRunStatus,
  STEP_TYPE_LABELS,
  type StepType,
} from '@/hooks/useWorkflows'

const RUN_STATUS_STYLES: Record<WorkflowRunStatus, { bg: string; icon: typeof CheckCircle2 }> = {
  running: { bg: 'bg-blue-100 text-blue-700', icon: Play },
  completed: { bg: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed: { bg: 'bg-red-100 text-red-700', icon: AlertTriangle },
  cancelled: { bg: 'bg-slate-100 text-slate-500', icon: XCircle },
}

const STEP_STATUS_STYLES: Record<StepRunStatus, string> = {
  pending: 'bg-slate-100 text-slate-500',
  scheduled: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-400',
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'In progress'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function RunStepDetail({ runId }: { runId: string }) {
  const { stepRuns, loading } = useWorkflowStepRuns(runId)

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 px-6 text-slate-400">
        <Loader2 className="animate-spin" size={14} />
        <span className="text-xs">Loading steps...</span>
      </div>
    )
  }

  return (
    <div className="px-6 pb-4">
      <div className="border-l-2 border-slate-200 ml-4 space-y-0">
        {stepRuns.map((sr) => (
          <div key={sr.id} className="relative pl-6 py-2">
            {/* Timeline dot */}
            <div className={`absolute left-[-5px] top-3.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              sr.status === 'completed' ? 'bg-emerald-500' :
              sr.status === 'failed' ? 'bg-red-500' :
              sr.status === 'running' ? 'bg-blue-500' :
              sr.status === 'scheduled' ? 'bg-yellow-500' :
              sr.status === 'skipped' ? 'bg-slate-300' :
              'bg-slate-300'
            }`} />

            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400">#{sr.step_order}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STEP_STATUS_STYLES[sr.status]}`}>
                    {sr.status}
                  </span>
                </div>

                {sr.scheduled_for && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Scheduled: {formatDate(sr.scheduled_for)}
                    {sr.started_at && ` → Started: ${formatDate(sr.started_at)}`}
                    {sr.completed_at && ` → Done: ${formatDate(sr.completed_at)}`}
                  </p>
                )}

                {sr.result && (
                  <p className="text-xs text-slate-600 mt-1 font-mono bg-slate-50 px-2 py-1 rounded">
                    {JSON.stringify(sr.result, null, 0).substring(0, 120)}
                  </p>
                )}

                {sr.error_message && (
                  <p className="text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded">
                    {sr.error_message}
                    {sr.retry_count > 0 && <span className="text-red-400 ml-2">(retried {sr.retry_count}x)</span>}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type RunHistoryProps = {
  workflowId: string
}

export default function WorkflowRunHistory({ workflowId }: RunHistoryProps) {
  const { runs, loading } = useWorkflowRuns(workflowId)
  const { cancelRun } = useWorkflowMutations()
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-blue-500" size={24} />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="mx-auto text-slate-300 mb-3" size={40} />
        <p className="text-sm text-slate-400">No runs yet. Activate the workflow to start.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const style = RUN_STATUS_STYLES[run.status]
        const StatusIcon = style.icon
        const isExpanded = expandedRun === run.id

        return (
          <div key={run.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => setExpandedRun(isExpanded ? null : run.id)}
            >
              <StatusIcon size={16} className={style.bg.includes('emerald') ? 'text-emerald-600' : style.bg.includes('red') ? 'text-red-600' : style.bg.includes('blue') ? 'text-blue-600' : 'text-slate-400'} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${style.bg}`}>
                    {run.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    {run.trigger_entity_type} • Step {run.current_step_order}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Started: {formatDate(run.started_at)}
                  {run.completed_at && ` • Duration: ${formatDuration(run.started_at, run.completed_at)}`}
                </p>
              </div>

              {run.status === 'running' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    cancelRun.mutate(run.id)
                  }}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase text-red-600 bg-red-50 rounded-full hover:bg-red-100 transition-colors"
                >
                  Cancel
                </button>
              )}

              {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
            </div>

            {isExpanded && <RunStepDetail runId={run.id} />}
          </div>
        )
      })}
    </div>
  )
}
