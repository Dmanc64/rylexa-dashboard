'use client'

import { useState, Fragment } from 'react'
import {
  Gavel, Plus, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, Calendar, Phone, User, Building2,
  FileText, X, Scale,
} from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useEvictions,
  type EvictionCase,
  type EvictionStatus,
  type NoticeType,
  type CreateEvictionInput,
} from '@/hooks/useEvictions'

// ── Constants ──

const STATUSES: EvictionStatus[] = [
  'Notice Served',
  'Filed',
  'Hearing Scheduled',
  'Judgment',
  'Completed',
  'Dismissed',
]

const NOTICE_TYPES: NoticeType[] = [
  '3-Day Pay or Quit',
  '30-Day Notice',
  '60-Day Notice',
  'Lease Violation',
  'Other',
]

type FilterTab = 'All' | EvictionStatus | 'Active'

const FILTER_TABS: FilterTab[] = [
  'All',
  'Notice Served',
  'Filed',
  'Hearing Scheduled',
  'Judgment',
  'Active',
]

const STATUS_BADGE: Record<EvictionStatus, string> = {
  'Notice Served': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Filed': 'bg-orange-50 text-orange-700 border-orange-200',
  'Hearing Scheduled': 'bg-blue-50 text-blue-700 border-blue-200',
  'Judgment': 'bg-purple-50 text-purple-700 border-purple-200',
  'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Dismissed': 'bg-slate-50 text-slate-600 border-slate-200',
}

function formatDate(d: string | null | undefined) {
  if (!d) return '\u2014'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Page Component ──

export default function EvictionCaseManagerPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const evictionEnabled = isEnabled('eviction_management')

  const [activeTab, setActiveTab] = useState<FilterTab>('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCase, setEditingCase] = useState<EvictionCase | null>(null)

  // Map filter tab to hook param
  const statusFilter = activeTab === 'All' ? undefined : (activeTab as EvictionStatus | 'Active')
  const { evictions, loading, createEviction, creating, updateEviction, updating, updateStatus, updatingStatus } = useEvictions(statusFilter)

  // ── Feature flag gate ──
  if (flagsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    )
  }

  if (!evictionEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <Gavel size={48} className="mb-4" />
        <p className="text-lg font-semibold">Eviction Management is not enabled</p>
        <p className="text-sm mt-1">Enable the &ldquo;eviction_management&rdquo; feature flag in Settings to use this module.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Gavel size={24} className="text-emerald-600" />
            Eviction Case Manager
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track and manage eviction proceedings across all properties
          </p>
        </div>
        <button
          onClick={() => { setEditingCase(null); setModalOpen(true) }}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          <Plus size={14} />
          New Case
        </button>
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-full transition-colors ${
              activeTab === tab
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Cases List ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      ) : evictions.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-[2.5rem] border border-slate-200">
          <Scale size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium">No eviction cases found</p>
          <p className="text-sm text-slate-400 mt-1">
            {activeTab !== 'All'
              ? `No cases with status "${activeTab}"`
              : 'Click "New Case" to create your first eviction case'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden">
          {/* Table Header */}
          <div className="hidden lg:grid grid-cols-[1fr_1fr_0.7fr_0.8fr_0.8fr_0.6fr_2.5rem] gap-4 px-6 py-3 border-b border-slate-100">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tenant</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Property / Unit</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notice Type</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Key Date</span>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Court #</span>
            <span />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {evictions.map((ec) => {
              const isExpanded = expandedId === ec.id
              // Determine the most relevant date to display
              const keyDate = ec.hearing_date || ec.court_date || ec.filed_date || ec.notice_served_date

              return (
                <Fragment key={ec.id}>
                  {/* Summary Row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : ec.id)}
                    className="w-full text-left grid grid-cols-1 lg:grid-cols-[1fr_1fr_0.7fr_0.8fr_0.8fr_0.6fr_2.5rem] gap-2 lg:gap-4 px-6 py-4 hover:bg-slate-50 transition-colors items-center"
                  >
                    {/* Tenant */}
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-slate-400 shrink-0 hidden lg:block" />
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {ec.tenant_first_name} {ec.tenant_last_name}
                      </span>
                    </div>

                    {/* Property / Unit */}
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-slate-400 shrink-0 hidden lg:block" />
                      <span className="text-sm text-slate-700 truncate">
                        {ec.property_name}
                        <span className="text-slate-400"> / {ec.unit_name}</span>
                      </span>
                    </div>

                    {/* Status Badge */}
                    <div>
                      <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full border ${STATUS_BADGE[ec.status]}`}>
                        {ec.status}
                      </span>
                    </div>

                    {/* Notice Type */}
                    <div className="text-sm text-slate-600 truncate">
                      {ec.notice_type || '\u2014'}
                    </div>

                    {/* Key Date */}
                    <div className="flex items-center gap-1 text-sm text-slate-600">
                      <Calendar size={12} className="text-slate-400 shrink-0 hidden lg:block" />
                      {formatDate(keyDate)}
                    </div>

                    {/* Court # */}
                    <div className="text-sm text-slate-500 font-mono truncate">
                      {ec.court_case_number || '\u2014'}
                    </div>

                    {/* Chevron */}
                    <div className="hidden lg:flex justify-end">
                      {isExpanded
                        ? <ChevronUp size={16} className="text-slate-400" />
                        : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </button>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="bg-slate-50 px-6 py-5 border-t border-slate-100">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                        <DetailItem label="Reason" value={ec.reason} />
                        <DetailItem label="Notice Type" value={ec.notice_type} />
                        <DetailItem label="Notice Served" value={formatDate(ec.notice_served_date)} />
                        <DetailItem label="Filed Date" value={formatDate(ec.filed_date)} />
                        <DetailItem label="Court Date" value={formatDate(ec.court_date)} />
                        <DetailItem label="Hearing Date" value={formatDate(ec.hearing_date)} />
                        <DetailItem label="Court Case #" value={ec.court_case_number} />
                        <DetailItem label="Outcome" value={ec.outcome} />
                        <DetailItem
                          label="Judgment Amount"
                          value={ec.judgment_amount != null ? `$${Number(ec.judgment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}
                        />
                        <DetailItem label="Attorney" value={ec.attorney_name} />
                        <DetailItem label="Attorney Phone" value={ec.attorney_phone} icon={<Phone size={12} />} />
                        <DetailItem label="Created" value={formatDate(ec.created_at?.split('T')[0])} />
                      </div>

                      {ec.notes && (
                        <div className="mt-4">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</span>
                          <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{ec.notes}</p>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-2 mt-5">
                        <button
                          onClick={() => { setEditingCase(ec); setModalOpen(true) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-white transition-colors"
                        >
                          <FileText size={12} />
                          Edit Case
                        </button>

                        {/* Quick status transitions */}
                        {ec.status === 'Notice Served' && (
                          <StatusButton
                            label="Mark as Filed"
                            targetStatus="Filed"
                            caseId={ec.id}
                            onUpdate={updateStatus}
                            isPending={updatingStatus}
                          />
                        )}
                        {ec.status === 'Filed' && (
                          <StatusButton
                            label="Schedule Hearing"
                            targetStatus="Hearing Scheduled"
                            caseId={ec.id}
                            onUpdate={updateStatus}
                            isPending={updatingStatus}
                          />
                        )}
                        {ec.status === 'Hearing Scheduled' && (
                          <StatusButton
                            label="Record Judgment"
                            targetStatus="Judgment"
                            caseId={ec.id}
                            onUpdate={updateStatus}
                            isPending={updatingStatus}
                          />
                        )}
                        {ec.status !== 'Completed' && ec.status !== 'Dismissed' && (
                          <>
                            <StatusButton
                              label="Complete"
                              targetStatus="Completed"
                              caseId={ec.id}
                              onUpdate={updateStatus}
                              isPending={updatingStatus}
                              accent="emerald"
                            />
                            <StatusButton
                              label="Dismiss"
                              targetStatus="Dismissed"
                              caseId={ec.id}
                              onUpdate={updateStatus}
                              isPending={updatingStatus}
                              accent="slate"
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>
      )}

      {/* ── New / Edit Modal ── */}
      <EvictionModal
        isOpen={modalOpen}
        editingCase={editingCase}
        onClose={() => { setModalOpen(false); setEditingCase(null) }}
        onCreate={createEviction}
        onUpdate={updateEviction}
        creating={creating}
        updating={updating}
      />
    </div>
  )
}

// ── Sub-components ──

function DetailItem({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <p className="text-sm text-slate-700 mt-0.5 flex items-center gap-1">
        {icon}
        {value || '\u2014'}
      </p>
    </div>
  )
}

function StatusButton({
  label,
  targetStatus,
  caseId,
  onUpdate,
  isPending,
  accent = 'indigo',
}: {
  label: string
  targetStatus: EvictionStatus
  caseId: string
  onUpdate: (args: { id: string; status: EvictionStatus }) => Promise<any>
  isPending: boolean
  accent?: 'indigo' | 'emerald' | 'slate'
}) {
  const colors: Record<string, string> = {
    indigo: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
    emerald: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
    slate: 'border-slate-200 text-slate-600 hover:bg-slate-100',
  }
  return (
    <button
      onClick={() => onUpdate({ id: caseId, status: targetStatus })}
      disabled={isPending}
      className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-full border transition-colors disabled:opacity-50 ${colors[accent]}`}
    >
      {isPending && <Loader2 size={12} className="animate-spin" />}
      {label}
    </button>
  )
}

// ── Modal ──

function EvictionModal({
  isOpen,
  editingCase,
  onClose,
  onCreate,
  onUpdate,
  creating,
  updating,
}: {
  isOpen: boolean
  editingCase: EvictionCase | null
  onClose: () => void
  onCreate: (input: CreateEvictionInput) => Promise<any>
  onUpdate: (input: { id: string } & Partial<CreateEvictionInput>) => Promise<any>
  creating: boolean
  updating: boolean
}) {
  const isEdit = editingCase !== null

  const [form, setForm] = useState<CreateEvictionInput>(() => getDefaults(editingCase))

  // Reset form when modal opens/changes
  // Using key approach: parent re-mounts via isOpen + editingCase
  // But since we track state, sync manually:
  const [prevCase, setPrevCase] = useState<EvictionCase | null>(null)
  if (editingCase !== prevCase) {
    setPrevCase(editingCase)
    setForm(getDefaults(editingCase))
  }

  function getDefaults(ec: EvictionCase | null): CreateEvictionInput {
    if (ec) {
      return {
        lease_id: ec.lease_id || undefined,
        tenant_id: ec.tenant_id || undefined,
        property_id: ec.property_id || undefined,
        unit_id: ec.unit_id || undefined,
        status: ec.status,
        reason: ec.reason || undefined,
        notice_type: ec.notice_type || undefined,
        notice_served_date: ec.notice_served_date || undefined,
        filed_date: ec.filed_date || undefined,
        court_case_number: ec.court_case_number || undefined,
        court_date: ec.court_date || undefined,
        hearing_date: ec.hearing_date || undefined,
        outcome: ec.outcome || undefined,
        judgment_amount: ec.judgment_amount ?? undefined,
        notes: ec.notes || undefined,
        attorney_name: ec.attorney_name || undefined,
        attorney_phone: ec.attorney_phone || undefined,
      }
    }
    return { status: 'Notice Served' }
  }

  function update(field: keyof CreateEvictionInput, value: any) {
    setForm((prev) => ({ ...prev, [field]: value || undefined }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (isEdit && editingCase) {
        await onUpdate({ id: editingCase.id, ...form })
      } else {
        await onCreate(form)
      }
      onClose()
    } catch {
      // Error toasts handled in the hook
    }
  }

  if (!isOpen) return null

  const busy = creating || updating

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-[2.5rem] px-8 pt-8 pb-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
            <Gavel size={20} className="text-emerald-600" />
            {isEdit ? 'Edit Eviction Case' : 'New Eviction Case'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
          {/* IDs Section */}
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
              Case References
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Property ID" value={form.property_id} onChange={(v) => update('property_id', v)} placeholder="Property UUID" />
              <FormField label="Unit ID" value={form.unit_id} onChange={(v) => update('unit_id', v)} placeholder="Unit UUID" />
              <FormField label="Tenant ID" value={form.tenant_id} onChange={(v) => update('tenant_id', v)} placeholder="Tenant UUID" />
              <FormField label="Lease ID" value={form.lease_id} onChange={(v) => update('lease_id', v)} placeholder="Lease UUID" />
            </div>
          </div>

          {/* Case Details */}
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
              Case Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => update('status', e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Notice Type</label>
                <select
                  value={form.notice_type || ''}
                  onChange={(e) => update('notice_type', e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="">Select notice type</option>
                  {NOTICE_TYPES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <FormField label="Reason" value={form.reason} onChange={(v) => update('reason', v)} placeholder="Reason for eviction" />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
              Key Dates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Notice Served" value={form.notice_served_date} onChange={(v) => update('notice_served_date', v)} type="date" />
              <FormField label="Filed Date" value={form.filed_date} onChange={(v) => update('filed_date', v)} type="date" />
              <FormField label="Court Date" value={form.court_date} onChange={(v) => update('court_date', v)} type="date" />
              <FormField label="Hearing Date" value={form.hearing_date} onChange={(v) => update('hearing_date', v)} type="date" />
            </div>
          </div>

          {/* Court & Legal */}
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
              Court & Legal
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Court Case Number" value={form.court_case_number} onChange={(v) => update('court_case_number', v)} placeholder="e.g. CV-2026-12345" />
              <FormField label="Outcome" value={form.outcome} onChange={(v) => update('outcome', v)} placeholder="Case outcome" />
              <FormField
                label="Judgment Amount"
                value={form.judgment_amount != null ? String(form.judgment_amount) : ''}
                onChange={(v) => update('judgment_amount', v ? Number(v) : undefined)}
                type="number"
                placeholder="0.00"
              />
              <FormField label="Attorney Name" value={form.attorney_name} onChange={(v) => update('attorney_name', v)} placeholder="Attorney full name" />
              <FormField label="Attorney Phone" value={form.attorney_phone} onChange={(v) => update('attorney_phone', v)} placeholder="(555) 555-5555" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Notes</label>
            <textarea
              value={form.notes || ''}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              placeholder="Additional notes..."
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string | undefined
  onChange: (val: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
      />
    </div>
  )
}
