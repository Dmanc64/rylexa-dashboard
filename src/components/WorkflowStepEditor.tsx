'use client'

import { useState, useEffect } from 'react'
import {
  MessageSquare, Mail, Wrench, RefreshCw, HardHat,
  DollarSign, ClipboardList, Clock, GitBranch,
  ChevronDown, ChevronUp, Trash2, GripVertical, Plus
} from 'lucide-react'
import type { StepType, WorkflowStep } from '@/hooks/useWorkflows'
import { STEP_TYPE_LABELS } from '@/hooks/useWorkflows'

const STEP_ICONS: Record<StepType, typeof MessageSquare> = {
  send_sms: MessageSquare,
  send_email: Mail,
  create_work_order: Wrench,
  update_status: RefreshCw,
  assign_vendor: HardHat,
  add_charge: DollarSign,
  create_task: ClipboardList,
  wait: Clock,
  condition: GitBranch,
}

const STEP_COLORS: Record<StepType, string> = {
  send_sms: 'bg-green-100 text-green-700',
  send_email: 'bg-blue-100 text-blue-700',
  create_work_order: 'bg-orange-100 text-orange-700',
  update_status: 'bg-cyan-100 text-cyan-700',
  assign_vendor: 'bg-amber-100 text-amber-700',
  add_charge: 'bg-red-100 text-red-700',
  create_task: 'bg-purple-100 text-purple-700',
  wait: 'bg-slate-100 text-slate-600',
  condition: 'bg-indigo-100 text-indigo-700',
}

type StepEditorProps = {
  steps: WorkflowStep[]
  onAdd: (step_order: number, step_type: StepType, step_config: Record<string, unknown>, delay_minutes: number) => void
  onUpdate: (id: string, changes: Partial<WorkflowStep>) => void
  onRemove: (id: string, workflow_id: string, step_order: number) => void
  disabled?: boolean
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return 'Immediately'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours`
  return `${Math.round(minutes / 1440)} days`
}

function StepConfigSummary({ step }: { step: WorkflowStep }) {
  const c = step.step_config
  switch (step.step_type) {
    case 'send_sms':
      return <span>Template: {(c.template_slug as string) || 'custom'}{c.recipient === 'vendor' ? ' (to vendor)' : ''}</span>
    case 'send_email':
      return <span>Subject: {(c.subject as string) || '—'}</span>
    case 'create_work_order':
      return <span>Title: {(c.title as string) || '—'}</span>
    case 'update_status':
      return <span>Set status to: {(c.status as string) || '—'}</span>
    case 'assign_vendor':
      return <span>Match by trade type{c.use_ai_triage ? ' (AI triage)' : ''}</span>
    case 'add_charge':
      return <span>{c.use_billing_settings ? 'Use billing settings' : `$${c.amount || 0}`} — {(c.charge_type as string) || 'Late Fee'}</span>
    case 'create_task':
      return <span>{(c.title as string) || 'Task'} → {(c.assignee_role as string) || 'PM'}</span>
    case 'wait':
      return <span>Wait {formatDelay(step.delay_minutes)}</span>
    case 'condition':
      return <span>If {(c.check as string)} {(c.operator as string) || '='} {String(c.expected)}</span>
    default:
      return <span>—</span>
  }
}

function StepConfigForm({
  step,
  onChange,
}: {
  step: WorkflowStep
  onChange: (changes: Partial<WorkflowStep>) => void
}) {
  const c = step.step_config
  const updateConfig = (key: string, value: unknown) => {
    onChange({ step_config: { ...c, [key]: value } })
  }

  const inputClass = "w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none"
  const labelClass = "text-[10px] font-black uppercase text-slate-400 tracking-widest"

  return (
    <div className="space-y-4 pt-4 border-t border-slate-100">
      {/* Delay input (shared across all types except first step) */}
      <div className="space-y-1">
        <label className={labelClass}>Delay Before This Step</label>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={
              step.delay_minutes >= 1440
                ? Math.round(step.delay_minutes / 1440)
                : step.delay_minutes >= 60
                ? Math.round(step.delay_minutes / 60)
                : step.delay_minutes
            }
            onChange={(e) => {
              const val = Number(e.target.value)
              const unit = step.delay_minutes >= 1440 ? 1440 : step.delay_minutes >= 60 ? 60 : 1
              onChange({ delay_minutes: val * unit })
            }}
            className={`${inputClass} w-24`}
          />
          <select
            value={step.delay_minutes >= 1440 ? 'days' : step.delay_minutes >= 60 ? 'hours' : 'minutes'}
            onChange={(e) => {
              const raw = step.delay_minutes
              const currentUnit = raw >= 1440 ? 1440 : raw >= 60 ? 60 : 1
              const currentVal = Math.round(raw / currentUnit)
              const newUnit = e.target.value === 'days' ? 1440 : e.target.value === 'hours' ? 60 : 1
              onChange({ delay_minutes: currentVal * newUnit })
            }}
            className={`${inputClass} w-28`}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </div>

      {/* Type-specific config */}
      {step.step_type === 'send_sms' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>SMS Template Slug</label>
            <input
              type="text"
              value={(c.template_slug as string) || ''}
              onChange={(e) => updateConfig('template_slug', e.target.value)}
              placeholder="rent_reminder"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Recipient</label>
            <select
              value={(c.recipient as string) || 'tenant'}
              onChange={(e) => updateConfig('recipient', e.target.value)}
              className={inputClass}
            >
              <option value="tenant">Tenant</option>
              <option value="vendor">Vendor</option>
              <option value="manager">Manager</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'send_email' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Subject</label>
            <input
              type="text"
              value={(c.subject as string) || ''}
              onChange={(e) => updateConfig('subject', e.target.value)}
              placeholder="Lease Renewal Offer"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Template Name</label>
            <input
              type="text"
              value={(c.template as string) || ''}
              onChange={(e) => updateConfig('template', e.target.value)}
              placeholder="renewal_offer"
              className={inputClass}
            />
          </div>
        </>
      )}

      {step.step_type === 'create_work_order' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Work Order Title</label>
            <input
              type="text"
              value={(c.title as string) || ''}
              onChange={(e) => updateConfig('title', e.target.value)}
              placeholder="Unit turn - {{unit_name}}"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Priority</label>
            <select
              value={(c.priority as string) || 'Medium'}
              onChange={(e) => updateConfig('priority', e.target.value)}
              className={inputClass}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Emergency">Emergency</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!c.use_turn_template}
              onChange={(e) => updateConfig('use_turn_template', e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">Use unit turn template</span>
          </label>
        </>
      )}

      {step.step_type === 'add_charge' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Charge Type</label>
            <input
              type="text"
              value={(c.charge_type as string) || 'Late Fee'}
              onChange={(e) => updateConfig('charge_type', e.target.value)}
              className={inputClass}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!c.use_billing_settings}
              onChange={(e) => updateConfig('use_billing_settings', e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">Use billing settings for amount</span>
          </label>
          {!c.use_billing_settings && (
            <div className="space-y-1">
              <label className={labelClass}>Amount ($)</label>
              <input
                type="number"
                min={0}
                value={(c.amount as number) || 0}
                onChange={(e) => updateConfig('amount', Number(e.target.value))}
                className={inputClass}
              />
            </div>
          )}
        </>
      )}

      {step.step_type === 'create_task' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Task Title</label>
            <input
              type="text"
              value={(c.title as string) || ''}
              onChange={(e) => updateConfig('title', e.target.value)}
              placeholder="Follow up on unsigned renewal"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Assign To Role</label>
            <select
              value={(c.assignee_role as string) || 'Property Manager'}
              onChange={(e) => updateConfig('assignee_role', e.target.value)}
              className={inputClass}
            >
              <option value="Admin">Admin</option>
              <option value="Property Manager">Property Manager</option>
              <option value="Accounting">Accounting</option>
              <option value="Maintenance">Maintenance</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'assign_vendor' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!c.use_ai_triage}
              onChange={(e) => updateConfig('use_ai_triage', e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="font-medium text-slate-700">Use AI triage for vendor matching</span>
          </label>
        </>
      )}

      {step.step_type === 'condition' && (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Check Field</label>
            <input
              type="text"
              value={(c.check as string) || ''}
              onChange={(e) => updateConfig('check', e.target.value)}
              placeholder="work_order_status"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Expected Value</label>
            <input
              type="text"
              value={String(c.expected ?? '')}
              onChange={(e) => updateConfig('expected', e.target.value)}
              placeholder="Assigned"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>If Condition Met</label>
            <select
              value={(c.action_if_match as string) || 'skip_next'}
              onChange={(e) => updateConfig('action_if_match', e.target.value)}
              className={inputClass}
            >
              <option value="skip_next">Skip next step</option>
              <option value="continue">Continue normally</option>
            </select>
          </div>
        </>
      )}

      {step.step_type === 'update_status' && (
        <div className="space-y-1">
          <label className={labelClass}>New Status</label>
          <input
            type="text"
            value={(c.status as string) || ''}
            onChange={(e) => updateConfig('status', e.target.value)}
            placeholder="Completed"
            className={inputClass}
          />
        </div>
      )}
    </div>
  )
}

export default function WorkflowStepEditor({ steps, onAdd, onUpdate, onRemove, disabled }: StepEditorProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [addingAtOrder, setAddingAtOrder] = useState<number | null>(null)
  const [newStepType, setNewStepType] = useState<StepType>('send_sms')

  const handleAddStep = () => {
    if (addingAtOrder === null) return
    onAdd(addingAtOrder, newStepType, {}, 0)
    setAddingAtOrder(null)
  }

  return (
    <div className="space-y-1">
      {steps.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400 mb-4">No steps configured. Add your first step.</p>
          <button
            onClick={() => setAddingAtOrder(1)}
            disabled={disabled}
            className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl text-sm hover:bg-blue-500 transition-all"
          >
            <Plus size={14} className="inline mr-1" />
            Add First Step
          </button>
        </div>
      )}

      {steps.map((step, idx) => {
        const Icon = STEP_ICONS[step.step_type]
        const isExpanded = expandedStep === step.id
        return (
          <div key={step.id}>
            {/* Delay indicator between steps */}
            {idx > 0 && step.delay_minutes > 0 && (
              <div className="flex items-center gap-2 py-2 px-8">
                <div className="flex-1 border-t border-dashed border-slate-200" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
                  <Clock size={10} className="inline mr-1" />
                  Wait {formatDelay(step.delay_minutes)}
                </span>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
            )}

            {/* Step card */}
            <div className={`border rounded-2xl transition-all ${isExpanded ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'}`}>
              <div
                className="flex items-center gap-3 p-4 cursor-pointer"
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
              >
                <GripVertical size={14} className="text-slate-300 shrink-0" />
                <div className={`p-2 rounded-xl ${STEP_COLORS[step.step_type]}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400">STEP {step.step_order}</span>
                    <span className="font-bold text-sm text-slate-800">{STEP_TYPE_LABELS[step.step_type]}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    <StepConfigSummary step={step} />
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(step.id, step.workflow_id, step.step_order)
                  }}
                  disabled={disabled}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </div>

              {isExpanded && (
                <div className="px-4 pb-4">
                  <StepConfigForm
                    step={step}
                    onChange={(changes) => onUpdate(step.id, changes)}
                  />
                </div>
              )}
            </div>

            {/* Add step button after each step */}
            <div className="flex justify-center py-1">
              <button
                onClick={() => setAddingAtOrder(step.step_order + 1)}
                disabled={disabled}
                className="p-1 text-slate-300 hover:text-blue-500 transition-colors"
                title="Add step here"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )
      })}

      {/* Add step modal */}
      {addingAtOrder !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
            <h3 className="font-black text-lg">Add Step</h3>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Step Type</label>
              <select
                value={newStepType}
                onChange={(e) => setNewStepType(e.target.value as StepType)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-600 outline-none font-medium"
              >
                {(Object.entries(STEP_TYPE_LABELS) as [StepType, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleAddStep}
                className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-all"
              >
                Add
              </button>
              <button
                onClick={() => setAddingAtOrder(null)}
                className="px-4 py-3 text-slate-500 font-bold rounded-2xl hover:bg-slate-100 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
