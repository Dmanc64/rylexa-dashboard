'use client'

import { useState, useCallback } from 'react'
import {
  FileText,
  Plus,
  Loader2,
  Trash2,
  Star,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Save,
  X,
  ToggleLeft,
  ToggleRight,
  Lock,
  Globe,
  PawPrint,
  Car,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useLeaseTemplates,
  type LeaseTemplate,
  type LeaseClause,
  type LeaseTemplateContent,
} from '@/hooks/useLeaseTemplates'

// ── Default empty content ──────────────────────────────────

const emptyContent: LeaseTemplateContent = {
  clauses: [],
  pet_addendum: false,
  parking_addendum: false,
  utility_responsibility: 'tenant',
}

const emptyClause: LeaseClause = { title: '', body: '', required: false }

// ── Utility Labels ─────────────────────────────────────────

const utilityOptions: { value: LeaseTemplateContent['utility_responsibility']; label: string }[] = [
  { value: 'tenant', label: 'Tenant' },
  { value: 'landlord', label: 'Landlord' },
  { value: 'split', label: 'Split' },
]

// ── Page ───────────────────────────────────────────────────

export default function LeaseTemplatesPage() {
  const { isEnabled } = useFeatureFlags()
  const {
    templates,
    loading,
    createTemplate,
    creating,
    updateTemplate,
    updating,
    deleteTemplate,
    deleting,
    setDefault,
    settingDefault,
  } = useLeaseTemplates()

  // Edit / create state
  const [editing, setEditing] = useState<LeaseTemplate | null>(null)
  const [isNew, setIsNew] = useState(false)

  // Form fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [propertyScope, setPropertyScope] = useState('')
  const [content, setContent] = useState<LeaseTemplateContent>(emptyContent)

  // ── Feature flag gate ────────────────────────────────────

  if (!isEnabled('lease_templates')) {
    return (
      <div className="max-w-7xl mx-auto p-6 animate-in fade-in">
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 italic uppercase">
            Feature Not Enabled
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-2">
            Lease template management is not currently enabled. Contact your administrator to activate this feature.
          </p>
        </div>
      </div>
    )
  }

  // ── Helpers ──────────────────────────────────────────────

  function openCreate() {
    setIsNew(true)
    setName('')
    setDescription('')
    setPropertyScope('')
    setContent({ ...emptyContent, clauses: [] })
    setEditing({} as LeaseTemplate) // truthy sentinel
  }

  function openEdit(template: LeaseTemplate) {
    setIsNew(false)
    setName(template.name)
    setDescription(template.description ?? '')
    setPropertyScope(template.property_id ?? '')
    setContent({
      clauses: template.content?.clauses?.map((c) => ({ ...c })) ?? [],
      pet_addendum: template.content?.pet_addendum ?? false,
      parking_addendum: template.content?.parking_addendum ?? false,
      utility_responsibility: template.content?.utility_responsibility ?? 'tenant',
    })
    setEditing(template)
  }

  function closeEditor() {
    setEditing(null)
    setIsNew(false)
  }

  // ── Clause operations ────────────────────────────────────

  function addClause() {
    setContent((prev) => ({
      ...prev,
      clauses: [...prev.clauses, { ...emptyClause }],
    }))
  }

  function removeClause(index: number) {
    setContent((prev) => ({
      ...prev,
      clauses: prev.clauses.filter((_, i) => i !== index),
    }))
  }

  function updateClause(index: number, field: keyof LeaseClause, value: string | boolean) {
    setContent((prev) => ({
      ...prev,
      clauses: prev.clauses.map((c, i) =>
        i === index ? { ...c, [field]: value } : c
      ),
    }))
  }

  function moveClause(index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= content.clauses.length) return
    setContent((prev) => {
      const next = [...prev.clauses]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, clauses: next }
    })
  }

  // ── Save ─────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Template name is required')
      return
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      property_id: propertyScope.trim() || null,
      content,
    }

    try {
      if (isNew) {
        await createTemplate(payload)
      } else if (editing?.id) {
        await updateTemplate({ id: editing.id, ...payload })
      }
      closeEditor()
    } catch {
      // errors handled by mutation callbacks
    }
  }

  // ── Delete ───────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this template?')) return
    try {
      await deleteTemplate(id)
      if (editing?.id === id) closeEditor()
    } catch {
      // errors handled by mutation callbacks
    }
  }

  // ── Set Default ──────────────────────────────────────────

  async function handleSetDefault(id: string) {
    try {
      await setDefault(id)
    } catch {
      // errors handled by mutation callbacks
    }
  }

  const saving = creating || updating

  // ── Editor View ──────────────────────────────────────────

  if (editing) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={closeEditor}
              className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={20} className="text-slate-500" />
            </button>
            <div>
              <h1 className="text-3xl font-black italic uppercase text-slate-900">
                {isNew ? 'New' : 'Edit'} <span className="text-emerald-600">Template</span>
              </h1>
              <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">
                {isNew ? 'Create a new lease template' : `Editing: ${editing.name}`}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={closeEditor}
              className="px-5 py-3 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              <X size={14} /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-3 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>

        {/* Basic Info */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">
            Template Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Template Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Residential Lease"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                Property Scope
              </label>
              <input
                type="text"
                value={propertyScope}
                onChange={(e) => setPropertyScope(e.target.value)}
                placeholder="Property ID or leave blank for Global"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
              <p className="text-[10px] text-slate-400 mt-1 font-medium">
                Leave empty to make this a global template available to all properties.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template..."
              rows={2}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none"
            />
          </div>
        </div>

        {/* Clauses */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Clauses ({content.clauses.length})
            </h2>
            <button
              onClick={addClause}
              className="px-5 py-2 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2"
            >
              <Plus size={14} /> Add Clause
            </button>
          </div>

          {content.clauses.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-400 font-medium">
                No clauses added yet. Click "Add Clause" to start building the template.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {content.clauses.map((clause, index) => (
                <div
                  key={index}
                  className="border border-slate-200 rounded-2xl p-5 space-y-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                        Clause {index + 1} Title
                      </label>
                      <input
                        type="text"
                        value={clause.title}
                        onChange={(e) => updateClause(index, 'title', e.target.value)}
                        placeholder="e.g. Security Deposit"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      />
                    </div>
                    <div className="flex items-center gap-1 pt-6">
                      <button
                        onClick={() => moveClause(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp size={16} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => moveClause(index, 'down')}
                        disabled={index === content.clauses.length - 1}
                        className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown size={16} className="text-slate-500" />
                      </button>
                      <button
                        onClick={() => removeClause(index)}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Remove clause"
                      >
                        <Trash2 size={16} className="text-red-400 hover:text-red-600" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                      Body
                    </label>
                    <textarea
                      value={clause.body}
                      onChange={(e) => updateClause(index, 'body', e.target.value)}
                      placeholder="Enter the clause text..."
                      rows={4}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateClause(index, 'required', !clause.required)}
                      className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-colors"
                    >
                      {clause.required ? (
                        <ToggleRight size={20} className="text-emerald-600" />
                      ) : (
                        <ToggleLeft size={20} className="text-slate-400" />
                      )}
                      <span className={clause.required ? 'text-emerald-600' : 'text-slate-400'}>
                        Required
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Addendums & Utility */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">
            Addendums & Utilities
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Pet Addendum */}
            <button
              onClick={() =>
                setContent((prev) => ({ ...prev, pet_addendum: !prev.pet_addendum }))
              }
              className={`flex items-center gap-4 p-5 rounded-2xl border transition-all text-left ${
                content.pet_addendum
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <PawPrint
                size={24}
                className={content.pet_addendum ? 'text-emerald-600' : 'text-slate-400'}
              />
              <div>
                <p className="text-sm font-black text-slate-900">Pet Addendum</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                  {content.pet_addendum ? 'Included' : 'Not included'}
                </p>
              </div>
            </button>

            {/* Parking Addendum */}
            <button
              onClick={() =>
                setContent((prev) => ({ ...prev, parking_addendum: !prev.parking_addendum }))
              }
              className={`flex items-center gap-4 p-5 rounded-2xl border transition-all text-left ${
                content.parking_addendum
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <Car
                size={24}
                className={content.parking_addendum ? 'text-emerald-600' : 'text-slate-400'}
              />
              <div>
                <p className="text-sm font-black text-slate-900">Parking Addendum</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                  {content.parking_addendum ? 'Included' : 'Not included'}
                </p>
              </div>
            </button>

            {/* Utility Responsibility */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center gap-3 mb-3">
                <Zap size={24} className="text-slate-400" />
                <div>
                  <p className="text-sm font-black text-slate-900">Utility Responsibility</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                    Who pays utilities
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {utilityOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      setContent((prev) => ({ ...prev, utility_responsibility: opt.value }))
                    }
                    className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      content.utility_responsibility === opt.value
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Set as Default (edit mode only) */}
        {!isNew && editing?.id && !editing.is_default && (
          <div className="flex justify-end">
            <button
              onClick={() => handleSetDefault(editing.id)}
              disabled={settingDefault}
              className="px-6 py-3 bg-white border border-amber-300 text-amber-700 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-amber-50 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {settingDefault ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Star size={14} />
              )}
              Set as Default Template
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── List View ────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-4xl font-black italic uppercase text-slate-900">
            Lease <span className="text-emerald-600">Templates</span>
          </h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">
            {templates.length} Template{templates.length !== 1 ? 's' : ''} Available
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-6 py-3 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg"
        >
          <Plus size={16} /> Create Template
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <Loader2 className="animate-spin text-emerald-500 mx-auto mb-4" size={32} />
          <p className="text-slate-400 text-sm font-medium">Loading templates...</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 italic uppercase">
            No Templates Yet
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-2">
            Click "Create Template" to build your first lease template.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <div
              key={template.id}
              onClick={() => openEdit(template)}
              className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group"
            >
              {/* Title Row */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-black text-slate-900 truncate">
                    {template.name}
                  </h3>
                  {template.description && (
                    <p className="text-sm text-slate-500 font-medium mt-1 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
                {template.is_default && (
                  <span className="flex-shrink-0 ml-3 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 text-[9px] font-black uppercase tracking-widest border border-amber-200">
                    <Star size={10} /> Default
                  </span>
                )}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Clauses
                  </p>
                  <p className="text-xl font-black text-slate-900 mt-0.5">
                    {template.content?.clauses?.length ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Scope
                  </p>
                  <p className="text-sm font-bold text-slate-700 mt-1 flex items-center gap-1.5">
                    {template.property_name ? (
                      <>
                        <FileText size={12} className="text-slate-400" />
                        {template.property_name}
                      </>
                    ) : (
                      <>
                        <Globe size={12} className="text-emerald-500" />
                        Global
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Addendum badges */}
              <div className="flex flex-wrap gap-2 mb-5">
                {template.content?.pet_addendum && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-600 text-[9px] font-black uppercase tracking-widest border border-violet-200">
                    <PawPrint size={10} /> Pet
                  </span>
                )}
                {template.content?.parking_addendum && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-600 text-[9px] font-black uppercase tracking-widest border border-blue-200">
                    <Car size={10} /> Parking
                  </span>
                )}
                <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-slate-500 text-[9px] font-black uppercase tracking-widest border border-slate-200">
                  <Zap size={10} /> Utilities: {template.content?.utility_responsibility ?? 'tenant'}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 font-medium">
                  Updated {new Date(template.updated_at).toLocaleDateString()}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(template.id)
                  }}
                  disabled={deleting}
                  className="p-2 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Delete template"
                >
                  <Trash2 size={16} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
