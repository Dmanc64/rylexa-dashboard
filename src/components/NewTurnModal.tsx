'use client'

import { useState, useEffect } from 'react'
import {
  Building2, Home, Calendar, FileText,
  Loader2, RotateCcw, LayoutTemplate, Eye,
  DollarSign, ChevronRight
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import {
  useUnitTurns,
  useTurnTemplates,
  TASK_CATEGORY_OPTIONS,
  type TurnTemplate,
} from '@/hooks/useUnitTurns'

interface NewTurnModalProps {
  isOpen: boolean
  onClose: () => void
}

type PropertyOption = { id: string; name: string }
type UnitOption = { id: string; name: string }

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

export default function NewTurnModal({ isOpen, onClose }: NewTurnModalProps) {
  // ── Data hooks ──
  const { createTurnFromTemplate, creating } = useUnitTurns()
  const { templates, loading: loadingTemplates } = useTurnTemplates()

  // ── Local fetches for cascading selects ──
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [loadingProperties, setLoadingProperties] = useState(false)
  const [loadingUnits, setLoadingUnits] = useState(false)

  // ── Form state ──
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [moveOutDate, setMoveOutDate] = useState('')
  const [targetReadyDate, setTargetReadyDate] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [notes, setNotes] = useState('')

  // ── Reset on open ──
  useEffect(() => {
    if (isOpen) {
      setSelectedPropertyId('')
      setSelectedUnitId('')
      setMoveOutDate('')
      setTargetReadyDate('')
      setSelectedTemplateId('')
      setNotes('')
      setUnits([])
    }
  }, [isOpen])

  // ── Auto-select default template ──
  useEffect(() => {
    if (isOpen && templates.length > 0 && !selectedTemplateId) {
      const defaultTpl = templates.find(t => t.is_default)
      if (defaultTpl) setSelectedTemplateId(defaultTpl.id)
    }
  }, [isOpen, templates, selectedTemplateId])

  // ── Fetch properties on open ──
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

  // ── Fetch vacant units when property changes ──
  useEffect(() => {
    if (!selectedPropertyId) {
      setUnits([])
      setSelectedUnitId('')
      return
    }
    let cancelled = false
    async function load() {
      setLoadingUnits(true)
      // Fetch units that have no active lease (vacant)
      const { data } = await supabase
        .from('units')
        .select('id, name')
        .eq('property_id', selectedPropertyId)
        .order('name')
      if (!cancelled && data) setUnits(data)
      if (!cancelled) setLoadingUnits(false)
    }
    load()
    return () => { cancelled = true }
  }, [selectedPropertyId])

  // ── Selected template for preview ──
  const selectedTemplate: TurnTemplate | null = templates.find(t => t.id === selectedTemplateId) ?? null
  const templateTotalCost = selectedTemplate?.tasks?.reduce((sum, t) => sum + t.estimated_cost, 0) ?? 0

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedPropertyId) { toast.error('Please select a property'); return }
    if (!selectedUnitId) { toast.error('Please select a unit'); return }
    if (!moveOutDate) { toast.error('Please enter a move-out date'); return }
    if (!selectedTemplateId) { toast.error('Please select a template'); return }

    try {
      await createTurnFromTemplate({
        unit_id: selectedUnitId,
        property_id: selectedPropertyId,
        template_id: selectedTemplateId,
        move_out_date: moveOutDate,
        target_ready_date: targetReadyDate || undefined,
        notes: notes || undefined,
      })
      onClose()
    } catch {
      // handled by hook
    }
  }

  const canSubmit = selectedPropertyId && selectedUnitId && moveOutDate && selectedTemplateId

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="New Unit Turn"
      subtitle="Create a make-ready from a template"
      size="max-w-2xl"
    >
      <div className="p-6 space-y-6">

        {/* Property Select */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Property <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Building2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedPropertyId}
              onChange={(e) => { setSelectedPropertyId(e.target.value); setSelectedUnitId('') }}
              disabled={loadingProperties}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">{loadingProperties ? 'Loading...' : 'Select property...'}</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Unit Select */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Unit <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              disabled={!selectedPropertyId || loadingUnits}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">
                {!selectedPropertyId ? 'Select property first...' : loadingUnits ? 'Loading...' : 'Select unit...'}
              </option>
              {units.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {loadingUnits && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
          </div>
        </div>

        {/* Dates Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Move-Out Date <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={moveOutDate}
                onChange={(e) => setMoveOutDate(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Target Ready Date <span className="text-slate-300">(optional)</span>
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={targetReadyDate}
                onChange={(e) => setTargetReadyDate(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Template Select */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Template <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <LayoutTemplate size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              disabled={loadingTemplates}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">{loadingTemplates ? 'Loading...' : 'Select template...'}</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_default ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Template Task Preview */}
        {selectedTemplate && selectedTemplate.tasks.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-slate-400" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Template Preview
                </p>
              </div>
              <span className="text-[10px] font-bold text-slate-500">
                {selectedTemplate.tasks.length} tasks / {formatCurrency(templateTotalCost)}
              </span>
            </div>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {selectedTemplate.tasks
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((task, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-3 bg-white rounded-xl border border-slate-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold w-5">{i + 1}.</span>
                      <span className="text-xs font-bold text-slate-700">{task.title}</span>
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${getCategoryColor(task.category)}`}>
                        {task.category}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">
                      {formatCurrency(task.estimated_cost)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Notes <span className="text-slate-300">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special instructions for this turn..."
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 h-20 resize-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={creating || !canSubmit}
          className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <RotateCcw size={14} />
              Create Turn
            </>
          )}
        </button>
      </div>
    </AccessibleModal>
  )
}
