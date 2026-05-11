'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LayoutTemplate, Plus, Trash2, GripVertical,
  Loader2, Save, Pencil, ChevronLeft, Building2,
  DollarSign, X
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import {
  useTurnTemplates,
  TASK_CATEGORY_OPTIONS,
  type TurnTemplate,
} from '@/hooks/useUnitTurns'

interface TurnTemplateModalProps {
  isOpen: boolean
  onClose: () => void
  /** Pass a template to open in edit mode directly. */
  template?: TurnTemplate | null
}

type TemplateTask = {
  title: string
  category: string
  estimated_cost: number
  sort_order: number
}

type PropertyOption = { id: string; name: string }

function getCategoryColor(category: string): string {
  return TASK_CATEGORY_OPTIONS.find(c => c.value === category)?.color ?? 'bg-gray-100 text-gray-700'
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export default function TurnTemplateModal({ isOpen, onClose, template: editTemplate }: TurnTemplateModalProps) {
  const {
    templates,
    loading: loadingTemplates,
    createTemplate,
    creating,
    updateTemplate,
    updating,
    deleteTemplate,
    deleting,
  } = useTurnTemplates()

  // ── View modes ──
  type ViewMode = 'list' | 'form'
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [editingTemplate, setEditingTemplate] = useState<TurnTemplate | null>(null)

  // ── Properties for optional property scoping ──
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loadingProperties, setLoadingProperties] = useState(false)

  // ── Form state ──
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [tasks, setTasks] = useState<TemplateTask[]>([])

  // ── Drag state for reorder ──
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  // ── Reset / initialize on open ──
  useEffect(() => {
    if (isOpen) {
      if (editTemplate) {
        // Opened in direct edit mode
        openEditForm(editTemplate)
      } else {
        setViewMode('list')
        setEditingTemplate(null)
        resetForm()
      }
    }
  }, [isOpen, editTemplate])

  // ── Fetch properties ──
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setLoadingProperties(true)
      const { data } = await supabase
        .from('properties')
        .select('id, name')
        .order('name')
      if (!cancelled && data) setProperties(data)
      if (!cancelled) setLoadingProperties(false)
    }
    load()
    return () => { cancelled = true }
  }, [isOpen])

  function resetForm() {
    setName('')
    setDescription('')
    setPropertyId('')
    setTasks([])
  }

  function openEditForm(tpl: TurnTemplate) {
    setEditingTemplate(tpl)
    setName(tpl.name)
    setDescription(tpl.description ?? '')
    setPropertyId(tpl.property_id ?? '')
    setTasks(
      (tpl.tasks ?? [])
        .map((t, i) => ({ ...t, sort_order: t.sort_order ?? i }))
        .sort((a, b) => a.sort_order - b.sort_order)
    )
    setViewMode('form')
  }

  function openCreateForm() {
    setEditingTemplate(null)
    resetForm()
    setViewMode('form')
  }

  // ── Task management ──
  const addTask = () => {
    setTasks(prev => [
      ...prev,
      { title: '', category: 'General', estimated_cost: 0, sort_order: prev.length },
    ])
  }

  const removeTask = (index: number) => {
    setTasks(prev =>
      prev.filter((_, i) => i !== index).map((t, i) => ({ ...t, sort_order: i }))
    )
  }

  const updateTaskField = (index: number, field: keyof TemplateTask, value: string | number) => {
    setTasks(prev =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    )
  }

  // ── Drag & drop reorder ──
  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === targetIndex) return
    setTasks(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next.map((t, i) => ({ ...t, sort_order: i }))
    })
    setDragIndex(targetIndex)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
  }

  const totalEstimatedCost = tasks.reduce((sum, t) => sum + (t.estimated_cost || 0), 0)

  // ── Save handler ──
  const handleSave = async () => {
    if (!name.trim()) { toast.error('Template name is required'); return }
    if (tasks.length === 0) { toast.error('Add at least one task'); return }

    const emptyTasks = tasks.filter(t => !t.title.trim())
    if (emptyTasks.length > 0) { toast.error('All tasks must have a title'); return }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      property_id: propertyId || undefined,
      tasks: tasks.map((t, i) => ({
        title: t.title.trim(),
        category: t.category,
        estimated_cost: Number(t.estimated_cost) || 0,
        sort_order: i,
      })),
    }

    try {
      if (editingTemplate) {
        await updateTemplate({ id: editingTemplate.id, ...payload })
      } else {
        await createTemplate(payload)
      }
      setViewMode('list')
      setEditingTemplate(null)
      resetForm()
    } catch {
      // handled by hook
    }
  }

  // ── Delete handler ──
  const handleDelete = async (templateId: string) => {
    try {
      await deleteTemplate(templateId)
    } catch {
      // handled by hook
    }
  }

  const saving = creating || updating

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        viewMode === 'list'
          ? 'Turn Templates'
          : editingTemplate
          ? `Edit: ${editingTemplate.name}`
          : 'New Template'
      }
      subtitle={
        viewMode === 'list'
          ? 'Manage reusable make-ready task templates'
          : editingTemplate
          ? 'Update template details and tasks'
          : 'Build a reusable task checklist'
      }
      size="max-w-2xl"
    >
      {viewMode === 'list' ? (
        /* ── LIST VIEW ── */
        <div className="p-6 space-y-4">

          {/* Create button */}
          <button
            onClick={openCreateForm}
            className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:text-emerald-600 hover:border-emerald-300 transition-colors flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest"
          >
            <Plus size={16} /> Create New Template
          </button>

          {/* Template list */}
          {loadingTemplates ? (
            <div className="py-12 flex justify-center">
              <Loader2 size={24} className="animate-spin text-slate-300" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center">
              <LayoutTemplate size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm text-slate-400 italic">No templates yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(tpl => (
                <div
                  key={tpl.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-sm text-slate-800">{tpl.name}</h4>
                        {tpl.is_default && (
                          <span className="text-[9px] font-black uppercase bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                            Default
                          </span>
                        )}
                      </div>
                      {tpl.description && (
                        <p className="text-xs text-slate-500 mb-2 line-clamp-1">{tpl.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                        <span>{tpl.tasks?.length ?? 0} tasks</span>
                        <span>
                          {formatCurrency(tpl.tasks?.reduce((s, t) => s + t.estimated_cost, 0) ?? 0)}
                        </span>
                        {tpl.property_id && (
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">Property-specific</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button
                        onClick={() => openEditForm(tpl)}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit template"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(tpl.id)}
                        disabled={deleting}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete template"
                      >
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── FORM VIEW (create/edit) ── */
        <div className="p-6 space-y-6">

          {/* Back link */}
          {!editTemplate && (
            <button
              type="button"
              onClick={() => { setViewMode('list'); setEditingTemplate(null); resetForm() }}
              className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ChevronLeft size={14} /> Back to Templates
            </button>
          )}

          {/* Name */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Template Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Standard Make-Ready"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Description <span className="text-slate-300">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 h-16 resize-none"
            />
          </div>

          {/* Property Scope */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Property <span className="text-slate-300">(optional - leave empty for global)</span>
            </label>
            <div className="relative">
              <Building2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                disabled={loadingProperties}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">Global (all properties)</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Dynamic Task List ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Tasks <span className="text-red-500">*</span>
              </label>
              <span className="text-[10px] font-bold text-slate-500">
                {tasks.length} tasks / {formatCurrency(totalEstimatedCost)}
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                <p className="text-sm text-slate-400 italic">No tasks added yet.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {tasks.map((task, i) => (
                  <div
                    key={i}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-3 bg-white rounded-xl border transition-all ${
                      dragIndex === i ? 'border-blue-300 bg-blue-50 opacity-70' : 'border-slate-200'
                    }`}
                  >
                    {/* Drag Handle */}
                    <div className="cursor-grab text-slate-300 hover:text-slate-500 shrink-0">
                      <GripVertical size={16} />
                    </div>

                    {/* Task Title */}
                    <input
                      type="text"
                      value={task.title}
                      onChange={(e) => updateTaskField(i, 'title', e.target.value)}
                      placeholder="Task title..."
                      className="flex-1 min-w-0 px-2 py-1.5 border border-slate-100 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-200"
                    />

                    {/* Category */}
                    <select
                      value={task.category}
                      onChange={(e) => updateTaskField(i, 'category', e.target.value)}
                      className="px-2 py-1.5 border border-slate-100 rounded-lg text-[10px] font-bold outline-none bg-white appearance-none cursor-pointer w-24 shrink-0"
                    >
                      {TASK_CATEGORY_OPTIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>

                    {/* Estimated Cost */}
                    <div className="relative shrink-0 w-20">
                      <DollarSign size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        value={task.estimated_cost || ''}
                        onChange={(e) => updateTaskField(i, 'estimated_cost', Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full pl-6 pr-2 py-1.5 border border-slate-100 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 text-right"
                      />
                    </div>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeTask(i)}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Task Button */}
            <button
              type="button"
              onClick={addTask}
              className="w-full mt-3 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:text-emerald-600 hover:border-emerald-300 transition-colors flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest"
            >
              <Plus size={14} /> Add Task
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      {viewMode === 'form' && (
        <div className="px-6 py-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={() => {
              if (editTemplate) {
                onClose()
              } else {
                setViewMode('list')
                setEditingTemplate(null)
                resetForm()
              }
            }}
            className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={14} />
                {editingTemplate ? 'Update Template' : 'Save Template'}
              </>
            )}
          </button>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </AccessibleModal>
  )
}
