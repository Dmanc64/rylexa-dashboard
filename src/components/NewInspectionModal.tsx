'use client'

import { useState, useEffect } from 'react'
import {
  Building2, Home, ClipboardCheck, Calendar,
  Loader2, Plus, X, ChevronRight, ChevronLeft,
  Check
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import {
  DEFAULT_INSPECTION_AREAS,
  INSPECTION_TYPE_OPTIONS,
  type InspectionType,
  type CreateInspectionPayload,
} from '@/hooks/useInspections'

interface NewInspectionModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (payload: CreateInspectionPayload) => Promise<string>
  creating: boolean
}

type PropertyOption = { id: string; name: string }
type UnitOption = { id: string; name: string }
type LeaseOption = { id: string; label: string }

export default function NewInspectionModal({
  isOpen,
  onClose,
  onCreate,
  creating,
}: NewInspectionModalProps) {
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 fields
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [leases, setLeases] = useState<LeaseOption[]>([])
  const [loadingProps, setLoadingProps] = useState(false)
  const [loadingUnits, setLoadingUnits] = useState(false)

  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [selectedLeaseId, setSelectedLeaseId] = useState('')
  const [inspectionType, setInspectionType] = useState<InspectionType>('move_in')
  const [scheduledDate, setScheduledDate] = useState('')

  // Step 2 fields
  const [selectedAreas, setSelectedAreas] = useState<string[]>([...DEFAULT_INSPECTION_AREAS])
  const [customArea, setCustomArea] = useState('')

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setSelectedPropertyId('')
      setSelectedUnitId('')
      setSelectedLeaseId('')
      setInspectionType('move_in')
      setScheduledDate('')
      setSelectedAreas([...DEFAULT_INSPECTION_AREAS])
      setCustomArea('')
      setUnits([])
      setLeases([])
    }
  }, [isOpen])

  // Fetch properties on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setLoadingProps(true)
      const { data } = await supabase
        .from('properties')
        .select('id, name')
        .order('name')
      if (!cancelled && data) setProperties(data)
      if (!cancelled) setLoadingProps(false)
    }
    load()
    return () => { cancelled = true }
  }, [isOpen])

  // Fetch units when property changes
  useEffect(() => {
    if (!selectedPropertyId) { setUnits([]); setSelectedUnitId(''); setLeases([]); return }
    let cancelled = false
    async function load() {
      setLoadingUnits(true)
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

  // Fetch active lease when unit changes
  useEffect(() => {
    if (!selectedUnitId) { setLeases([]); setSelectedLeaseId(''); return }
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('lease_details_view')
        .select('lease_id, tenant_name, status')
        .eq('unit_id', selectedUnitId)
        .eq('status', 'Active')
      if (!cancelled && data) {
        const opts = data.map((l: any) => ({
          id: l.lease_id,
          label: l.tenant_name || 'Active Lease',
        }))
        setLeases(opts)
        // Auto-select if only one active lease
        if (opts.length === 1) setSelectedLeaseId(opts[0].id)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedUnitId])

  const toggleArea = (area: string) => {
    setSelectedAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    )
  }

  const addCustomArea = () => {
    const name = customArea.trim()
    if (!name) return
    if (selectedAreas.includes(name)) { toast.error('Area already exists'); return }
    setSelectedAreas(prev => [...prev, name])
    setCustomArea('')
  }

  const handleSubmit = async () => {
    if (!selectedUnitId) { toast.error('Please select a unit'); return }
    if (selectedAreas.length === 0) { toast.error('Please select at least one area'); return }

    try {
      await onCreate({
        unit_id: selectedUnitId,
        lease_id: selectedLeaseId || undefined,
        inspection_type: inspectionType,
        scheduled_date: scheduledDate || undefined,
        areas: selectedAreas,
      })
      onClose()
    } catch {
      // Error handled by hook
    }
  }

  const canProceedToStep2 = !!selectedUnitId

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 1 ? 'New Inspection' : 'Configure Areas'}
      subtitle={step === 1 ? 'Select unit and inspection type' : 'Choose rooms and areas to inspect'}
      size="max-w-2xl"
      headerBg="bg-emerald-50"
      headerTextColor="text-emerald-900"
      closeBtnColor="text-emerald-400"
    >
      {step === 1 ? (
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
                onChange={(e) => { setSelectedPropertyId(e.target.value); setSelectedUnitId(''); setSelectedLeaseId('') }}
                disabled={loadingProps}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">{loadingProps ? 'Loading...' : 'Select property...'}</option>
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
                onChange={(e) => { setSelectedUnitId(e.target.value); setSelectedLeaseId('') }}
                disabled={!selectedPropertyId || loadingUnits}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">
                  {!selectedPropertyId ? 'Select property first...' : loadingUnits ? 'Loading...' : 'Select unit...'}
                </option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {loadingUnits && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />}
            </div>
          </div>

          {/* Lease (auto-populated, optional) */}
          {leases.length > 0 && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Linked Lease
              </label>
              <select
                value={selectedLeaseId}
                onChange={(e) => setSelectedLeaseId(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white appearance-none cursor-pointer"
              >
                <option value="">No lease linked</option>
                {leases.map(l => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Inspection Type */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Inspection Type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {INSPECTION_TYPE_OPTIONS.map(opt => {
                const isActive = inspectionType === opt.value
                const colorMap: Record<string, string> = {
                  emerald: isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-600 hover:border-emerald-300',
                  red: isActive ? 'bg-red-600 text-white border-red-600' : 'border-slate-200 text-slate-600 hover:border-red-300',
                  blue: isActive ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300',
                  violet: isActive ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-600 hover:border-violet-300',
                }
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setInspectionType(opt.value)}
                    className={`px-4 py-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all ${colorMap[opt.color] || ''}`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Scheduled Date (optional) */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Scheduled Date <span className="text-slate-300">(optional)</span>
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Leave empty to start the inspection immediately.
            </p>
          </div>

          {/* Next Button */}
          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={!canProceedToStep2}
            className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Configure Areas <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <div className="p-6 space-y-6">

          {/* Back link */}
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <ChevronLeft size={14} /> Back to Details
          </button>

          {/* Area Checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Areas to Inspect
              </label>
              <span className="text-[10px] font-bold text-emerald-600">
                {selectedAreas.length} selected
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
              {/* Default areas */}
              {DEFAULT_INSPECTION_AREAS.map(area => {
                const isSelected = selectedAreas.includes(area)
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleArea(area)}
                    className={`
                      flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-left
                      ${isSelected
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }
                    `}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'
                    }`}>
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                    <span className="truncate">{area}</span>
                  </button>
                )
              })}

              {/* Custom areas (ones not in defaults) */}
              {selectedAreas
                .filter(a => !DEFAULT_INSPECTION_AREAS.includes(a))
                .map(area => (
                  <div
                    key={area}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border bg-blue-50 border-blue-300 text-blue-700 text-xs font-bold"
                  >
                    <div className="w-4 h-4 rounded bg-blue-600 border-blue-600 flex items-center justify-center shrink-0">
                      <Check size={10} className="text-white" />
                    </div>
                    <span className="truncate flex-1">{area}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAreas(prev => prev.filter(a => a !== area))}
                      className="p-0.5 text-blue-400 hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
            </div>
          </div>

          {/* Add Custom Area */}
          <div className="flex gap-2">
            <input
              type="text"
              value={customArea}
              onChange={(e) => setCustomArea(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomArea() }}}
              placeholder="Add custom area..."
              className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <button
              type="button"
              onClick={addCustomArea}
              disabled={!customArea.trim()}
              className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 transition-colors font-bold text-xs disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedAreas([...DEFAULT_INSPECTION_AREAS])}
              className="text-[10px] font-bold text-emerald-600 hover:underline"
            >
              Select All Defaults
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => setSelectedAreas([])}
              className="text-[10px] font-bold text-slate-400 hover:underline"
            >
              Clear All
            </button>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={creating || selectedAreas.length === 0}
            className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <ClipboardCheck size={16} />
                Create Inspection
              </>
            )}
          </button>
        </div>
      )}
    </AccessibleModal>
  )
}
