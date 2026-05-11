'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, Save, Play, Pause,
  Trash2, Zap, Clock, Wrench, CalendarX, Hand
} from 'lucide-react'
import Link from 'next/link'
import {
  useWorkflowDetail,
  useWorkflowMutations,
  TRIGGER_LABELS,
  type TriggerType,
  type StepType,
} from '@/hooks/useWorkflows'
import { useProperties } from '@/hooks/useProperties'
import WorkflowStepEditor from '@/components/WorkflowStepEditor'
import WorkflowRunHistory from '@/components/WorkflowRunHistory'

const TRIGGER_DESCRIPTIONS: Record<TriggerType, string> = {
  balance_overdue: 'Triggers when a tenant balance is overdue by N days',
  lease_expiring: 'Triggers N days before a lease expires',
  work_order_created: 'Triggers when a new work order is submitted',
  move_out_scheduled: 'Triggers N days before a scheduled move-out',
  manual: 'Triggered manually by an admin on a specific entity',
}

export default function WorkflowBuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workflowId = params.id as string

  const { workflow, steps, loading } = useWorkflowDetail(workflowId)
  const { properties } = useProperties()
  const {
    updateWorkflow,
    deleteWorkflow,
    toggleWorkflow,
    addStep,
    updateStep,
    removeStep,
  } = useWorkflowMutations()

  const [activeTab, setActiveTab] = useState<'builder' | 'history'>('builder')

  // Local editing state (debounce-friendly)
  const [editName, setEditName] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState<string | null>(null)

  const name = editName ?? workflow?.name ?? ''
  const description = editDesc ?? workflow?.description ?? ''

  const handleSaveConfig = () => {
    if (!workflow) return
    updateWorkflow.mutate({
      id: workflow.id,
      name: editName ?? workflow.name,
      description: editDesc ?? workflow.description,
    })
    setEditName(null)
    setEditDesc(null)
  }

  const handleTriggerTypeChange = (triggerType: TriggerType) => {
    if (!workflow) return
    updateWorkflow.mutate({ id: workflow.id, trigger_type: triggerType, trigger_config: {} })
  }

  const handleTriggerConfigChange = (key: string, value: unknown) => {
    if (!workflow) return
    updateWorkflow.mutate({
      id: workflow.id,
      trigger_config: { ...workflow.trigger_config, [key]: value },
    })
  }

  const handlePropertyChange = (propertyId: string | null) => {
    if (!workflow) return
    updateWorkflow.mutate({ id: workflow.id, property_id: propertyId })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500">Workflow not found.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Back + header */}
        <div className="flex items-center gap-4">
          <Link
            href="/admin/settings/workflows"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-white transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">{workflow.name}</h1>
            <p className="text-sm text-slate-500">{workflow.description || 'No description'}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => toggleWorkflow.mutate({ id: workflow.id, is_active: !workflow.is_active })}
              className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
                workflow.is_active
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {workflow.is_active ? <Play size={14} /> : <Pause size={14} />}
              {workflow.is_active ? 'Active' : 'Paused'}
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this workflow?')) {
                  deleteWorkflow.mutate(workflow.id)
                  router.push('/admin/settings/workflows')
                }
              }}
              className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-200 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('builder')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'builder' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Builder
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Run History
          </button>
        </div>

        {activeTab === 'builder' && (
          <div className="space-y-6">
            {/* Configuration card */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6 space-y-6">
              <h2 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Configuration</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Property</label>
                  <select
                    value={workflow.property_id || ''}
                    onChange={(e) => handlePropertyChange(e.target.value || null)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-medium text-sm"
                  >
                    <option value="">Global (all properties)</option>
                    {(properties || []).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none text-sm"
                />
              </div>

              {/* Trigger config */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Trigger Type</label>
                  <select
                    value={workflow.trigger_type}
                    onChange={(e) => handleTriggerTypeChange(e.target.value as TriggerType)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-medium text-sm"
                  >
                    {(Object.entries(TRIGGER_LABELS) as [TriggerType, string][]).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400">{TRIGGER_DESCRIPTIONS[workflow.trigger_type]}</p>
                </div>

                {/* Trigger-specific config */}
                {workflow.trigger_type === 'balance_overdue' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Days Overdue</label>
                    <input
                      type="number"
                      min={1}
                      value={(workflow.trigger_config?.days_overdue as number) || 5}
                      onChange={(e) => handleTriggerConfigChange('days_overdue', Number(e.target.value))}
                      className="w-32 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                    />
                  </div>
                )}

                {workflow.trigger_type === 'lease_expiring' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Days Before Expiry</label>
                    <input
                      type="number"
                      min={1}
                      value={(workflow.trigger_config?.days_before_expiry as number) || 90}
                      onChange={(e) => handleTriggerConfigChange('days_before_expiry', Number(e.target.value))}
                      className="w-32 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                    />
                  </div>
                )}

                {workflow.trigger_type === 'move_out_scheduled' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Days Before Move-Out</label>
                    <input
                      type="number"
                      min={1}
                      value={(workflow.trigger_config?.days_before_moveout as number) || 14}
                      onChange={(e) => handleTriggerConfigChange('days_before_moveout', Number(e.target.value))}
                      className="w-32 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Save button */}
              {(editName !== null || editDesc !== null) && (
                <button
                  onClick={handleSaveConfig}
                  disabled={updateWorkflow.isPending}
                  className="px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all flex items-center gap-2"
                >
                  {updateWorkflow.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Save Changes
                </button>
              )}
            </div>

            {/* Steps card */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6 space-y-4">
              <h2 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Workflow Steps</h2>

              <WorkflowStepEditor
                steps={steps}
                onAdd={(stepOrder, stepType, stepConfig, delayMinutes) => {
                  addStep.mutate({
                    workflow_id: workflowId,
                    step_order: stepOrder,
                    step_type: stepType,
                    step_config: stepConfig,
                    delay_minutes: delayMinutes,
                  })
                }}
                onUpdate={(id, changes) => {
                  updateStep.mutate({ id, ...changes })
                }}
                onRemove={(id, wfId, order) => {
                  removeStep.mutate({ id, workflow_id: wfId, step_order: order })
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6 space-y-4">
            <h2 className="font-black uppercase tracking-widest text-[10px] text-slate-400">Execution History</h2>
            <WorkflowRunHistory workflowId={workflowId} />
          </div>
        )}
      </div>
    </div>
  )
}
