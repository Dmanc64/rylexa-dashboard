'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  GitBranch, Plus, Loader2, Play, Pause,
  Trash2, Pencil, AlertCircle, Zap, Clock,
  FileText, Wrench, CalendarX, Hand
} from 'lucide-react'
import { useWorkflows, useWorkflowMutations, TRIGGER_LABELS, type TriggerType, type Workflow } from '@/hooks/useWorkflows'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useProperties } from '@/hooks/useProperties'
import Link from 'next/link'

const TRIGGER_ICONS: Record<TriggerType, typeof Zap> = {
  balance_overdue: Zap,
  lease_expiring: Clock,
  work_order_created: Wrench,
  move_out_scheduled: CalendarX,
  manual: Hand,
}

const TRIGGER_COLORS: Record<TriggerType, string> = {
  balance_overdue: 'bg-red-100 text-red-700',
  lease_expiring: 'bg-amber-100 text-amber-700',
  work_order_created: 'bg-blue-100 text-blue-700',
  move_out_scheduled: 'bg-purple-100 text-purple-700',
  manual: 'bg-slate-100 text-slate-700',
}

export default function WorkflowsPage() {
  const router = useRouter()
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)

  const { workflows, loading } = useWorkflows(propertyFilter)
  const { isEnabled } = useFeatureFlags()
  const { properties } = useProperties()
  const { toggleWorkflow, deleteWorkflow, createFromTemplate, createWorkflow } = useWorkflowMutations()

  const templates = workflows.filter(w => w.is_template)
  const userWorkflows = workflows.filter(w => !w.is_template)

  const featureEnabled = isEnabled('workflow_automation')

  const handleCreateBlank = async () => {
    const id = await createWorkflow.mutateAsync({
      name: 'New Workflow',
      trigger_type: 'manual',
      property_id: propertyFilter,
    })
    router.push(`/admin/settings/workflows/${id}`)
  }

  const handleUseTemplate = async (templateId: string) => {
    const id = await createFromTemplate.mutateAsync({
      templateId,
      property_id: propertyFilter,
    })
    setShowTemplateModal(false)
    router.push(`/admin/settings/workflows/${id}`)
  }

  const formatTimeAgo = (date: string | null) => {
    if (!date) return '—'
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic text-slate-900">Workflow Automation</h1>
            <p className="text-slate-500 font-medium">Configure multi-step automated sequences for collections, renewals, move-outs, and routing.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-5 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg"
            >
              <Plus size={18} />
              Create Workflow
            </button>
          </div>
        </header>

        {/* Feature flag warning */}
        {!featureEnabled && (
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex gap-3 items-start">
            <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold text-amber-800 text-sm">Workflow automation is disabled</p>
              <p className="text-xs text-amber-700 mt-1">
                Enable it in <Link href="/admin/settings" className="underline font-bold">System Settings</Link> → AI & Automation to start running workflows.
              </p>
            </div>
          </div>
        )}

        {/* Property filter */}
        <div className="flex items-center gap-4">
          <select
            value={propertyFilter || ''}
            onChange={(e) => setPropertyFilter(e.target.value || null)}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-600 outline-none"
          >
            <option value="">All Properties (Global)</option>
            {(properties || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Workflows table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          {userWorkflows.length === 0 ? (
            <div className="p-12 text-center">
              <GitBranch className="mx-auto text-slate-300 mb-4" size={48} />
              <h3 className="text-lg font-bold text-slate-600 mb-2">No workflows yet</h3>
              <p className="text-sm text-slate-400 mb-6">Create your first workflow from a template or start from scratch.</p>
              <button
                onClick={() => setShowTemplateModal(true)}
                className="px-5 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all"
              >
                <Plus size={16} className="inline mr-2" />
                Create Workflow
              </button>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-4 py-4">Trigger</th>
                  <th className="px-4 py-4">Property</th>
                  <th className="px-4 py-4 text-center">Steps</th>
                  <th className="px-4 py-4 text-center">Runs</th>
                  <th className="px-4 py-4">Last Run</th>
                  <th className="px-4 py-4 text-center">Status</th>
                  <th className="px-4 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userWorkflows.map((wf) => {
                  const TriggerIcon = TRIGGER_ICONS[wf.trigger_type] || Zap
                  return (
                    <tr
                      key={wf.id}
                      className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/settings/workflows/${wf.id}`}
                          className="font-bold text-slate-800 hover:text-blue-600 transition-colors"
                        >
                          {wf.name}
                        </Link>
                        {wf.description && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{wf.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${TRIGGER_COLORS[wf.trigger_type]}`}>
                          <TriggerIcon size={12} />
                          {TRIGGER_LABELS[wf.trigger_type]}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {wf.property_name || <span className="text-slate-400 italic">Global</span>}
                      </td>
                      <td className="px-4 py-4 text-center text-sm font-bold text-slate-700">
                        {wf.step_count}
                      </td>
                      <td className="px-4 py-4 text-center text-sm font-bold text-slate-700">
                        {wf.run_count}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-500">
                        {formatTimeAgo(wf.last_run_at ?? null)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => toggleWorkflow.mutate({ id: wf.id, is_active: !wf.is_active })}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            wf.is_active
                              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {wf.is_active ? <Play size={10} /> : <Pause size={10} />}
                          {wf.is_active ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/admin/settings/workflows/${wf.id}`}
                            className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            <Pencil size={14} />
                          </Link>
                          <button
                            onClick={() => {
                              if (confirm('Delete this workflow? This cannot be undone.')) {
                                deleteWorkflow.mutate(wf.id)
                              }
                            }}
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Template modal */}
        {showTemplateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-xl font-black tracking-tight">Create Workflow</h2>
                <p className="text-sm text-slate-500 mt-1">Start from a template or create a blank workflow.</p>
              </div>

              <div className="p-6 space-y-3 max-h-80 overflow-y-auto">
                {templates.map((t) => {
                  const TriggerIcon = TRIGGER_ICONS[t.trigger_type] || Zap
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleUseTemplate(t.id)}
                      disabled={createFromTemplate.isPending}
                      className="w-full text-left p-4 rounded-2xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${TRIGGER_COLORS[t.trigger_type]}`}>
                          <TriggerIcon size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-slate-800 group-hover:text-blue-700">{t.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{t.description}</p>
                        </div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                          {t.step_count} steps
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="p-6 border-t border-slate-100 flex gap-3">
                <button
                  onClick={handleCreateBlank}
                  disabled={createWorkflow.isPending}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                >
                  <FileText size={16} />
                  Start Blank
                </button>
                <button
                  onClick={() => setShowTemplateModal(false)}
                  className="px-6 py-3 text-slate-500 font-bold rounded-2xl hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
