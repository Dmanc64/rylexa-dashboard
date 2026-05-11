'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2, Save, Loader2 } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  useComplianceMutations,
  PROGRAM_TYPE_OPTIONS,
  AMI_PERCENTAGE_OPTIONS,
  type ProgramType,
} from '@/hooks/useCompliance'

type Props = {
  isOpen: boolean
  onClose: () => void
  initialPropertyId?: string | null
}

type PropertyRow = {
  id: string
  name: string
  is_affordable: boolean
  program_types: string[]
  insurance_required: boolean
  min_liability_amount: number | null
}

type UnitRow = {
  id: string
  name: string
  status: string
  market_rent: number | null
  bedroom_count: number | null
  ami_percentage: number | null
  max_gross_rent: number | null
  utility_allowance: number | null
  is_restricted: boolean
}

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function PropertyAffordabilityModal({ isOpen, onClose, initialPropertyId }: Props) {
  const { updatePropertyProgram, updateUnitAffordability, bulkUpdateUnits } = useComplianceMutations()

  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [selectedPropId, setSelectedPropId] = useState('')
  const [units, setUnits] = useState<UnitRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Property form
  const [isAffordable, setIsAffordable] = useState(false)
  const [programTypes, setProgramTypes] = useState<string[]>([])
  const [insuranceRequired, setInsuranceRequired] = useState(false)
  const [minLiability, setMinLiability] = useState<number | ''>(100000)

  // Bulk action states
  const [bulkAmi, setBulkAmi] = useState<number | ''>('')
  const [bulkUtility, setBulkUtility] = useState<number | ''>('')

  const loadProperties = useCallback(async () => {
    const { data } = await supabase
      .from('properties')
      .select('id, name, is_affordable, program_types, insurance_required, min_liability_amount')
      .order('name')
    setProperties(data ?? [])
  }, [])

  const loadUnits = useCallback(async (propId: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('units')
      .select('id, name, status, market_rent, bedroom_count, ami_percentage, max_gross_rent, utility_allowance, is_restricted')
      .eq('property_id', propId)
      .order('name')
    setUnits(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadProperties()
      if (initialPropertyId) {
        setSelectedPropId(initialPropertyId)
      }
    }
  }, [isOpen, initialPropertyId, loadProperties])

  useEffect(() => {
    if (selectedPropId) {
      loadUnits(selectedPropId)
      const prop = properties.find((p) => p.id === selectedPropId)
      if (prop) {
        setIsAffordable(prop.is_affordable)
        setProgramTypes(prop.program_types || [])
        setInsuranceRequired(prop.insurance_required ?? false)
        setMinLiability(prop.min_liability_amount ?? 100000)
      }
    } else {
      setUnits([])
    }
  }, [selectedPropId, properties, loadUnits])

  const toggleProgram = (pt: string) => {
    setProgramTypes((prev) =>
      prev.includes(pt) ? prev.filter((t) => t !== pt) : [...prev, pt]
    )
  }

  const updateUnit = (unitId: string, field: keyof UnitRow, value: any) => {
    setUnits((prev) =>
      prev.map((u) => u.id === unitId ? { ...u, [field]: value } : u)
    )
  }

  const applyBulkAmi = () => {
    if (bulkAmi === '') return
    setUnits((prev) =>
      prev.map((u) => ({ ...u, ami_percentage: Number(bulkAmi), is_restricted: true }))
    )
  }

  const applyBulkUtility = () => {
    if (bulkUtility === '') return
    setUnits((prev) =>
      prev.map((u) => ({ ...u, utility_allowance: Number(bulkUtility) }))
    )
  }

  const handleSave = async () => {
    if (!selectedPropId) return
    setSaving(true)
    try {
      // Save property settings
      await updatePropertyProgram.mutateAsync({
        propertyId: selectedPropId,
        is_affordable: isAffordable,
        program_types: programTypes,
        insurance_required: insuranceRequired,
        min_liability_amount: insuranceRequired ? (typeof minLiability === 'number' ? minLiability : 100000) : null,
      })

      // Save each unit
      for (const unit of units) {
        await updateUnitAffordability.mutateAsync({
          unitId: unit.id,
          bedroom_count: unit.bedroom_count,
          ami_percentage: unit.ami_percentage,
          max_gross_rent: unit.max_gross_rent,
          utility_allowance: unit.utility_allowance,
          is_restricted: unit.is_restricted,
        })
      }

      toast.success('Property and unit settings saved')
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Property Compliance Settings"
      subtitle="Configure affordable housing programs, insurance, and unit restrictions"
      size="max-w-2xl"
      headerBg="bg-indigo-50"
      headerTextColor="text-indigo-900"
    >
      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* ── Property Selector ── */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
            Property
          </label>
          <select
            value={selectedPropId}
            onChange={(e) => setSelectedPropId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="">Choose a property...</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_affordable ? '(Affordable)' : ''}{p.insurance_required ? ' (Ins. Required)' : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedPropId && (
          <>
            {/* ── Affordable Toggle ── */}
            <button
              type="button"
              onClick={() => setIsAffordable(!isAffordable)}
              className="flex items-center gap-3 bg-slate-50 rounded-xl p-4 w-full text-left cursor-pointer"
            >
              <div className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${isAffordable ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAffordable ? 'translate-x-5' : ''}`} />
              </div>
              <div>
                <span className="text-sm font-bold text-slate-900">Affordable Housing Property</span>
                <p className="text-xs text-slate-500">Enable compliance tracking for this property</p>
              </div>
            </button>

            {/* ── Program Types ── */}
            {isAffordable && (
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                  Program Types
                </label>
                <div className="flex flex-wrap gap-2">
                  {PROGRAM_TYPE_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => toggleProgram(value)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-full border transition-colors ${
                        programTypes.includes(value)
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-200'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Bulk Actions ── */}
            {isAffordable && (
              <div className="bg-slate-50 rounded-xl p-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                  Bulk Apply to All Units
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={bulkAmi}
                    onChange={(e) => setBulkAmi(e.target.value ? Number(e.target.value) : '')}
                    className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="">AMI %...</option>
                    {AMI_PERCENTAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={applyBulkAmi}
                    disabled={bulkAmi === ''}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Apply AMI
                  </button>
                  <span className="text-slate-300">|</span>
                  <input
                    type="number"
                    placeholder="Utility $"
                    value={bulkUtility}
                    onChange={(e) => setBulkUtility(e.target.value ? Number(e.target.value) : '')}
                    className="w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                  <button
                    onClick={applyBulkUtility}
                    disabled={bulkUtility === ''}
                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Apply Utility
                  </button>
                </div>
              </div>
            )}

            {/* ── Units Table ── */}
            {isAffordable && (
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                  Units ({units.length})
                </label>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin text-slate-400" size={24} />
                  </div>
                ) : units.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No units found for this property</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-slate-500">Unit</th>
                          <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-slate-500">BR</th>
                          <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-slate-500">AMI %</th>
                          <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-slate-500">Max Rent</th>
                          <th className="px-3 py-2 text-left font-black uppercase tracking-widest text-slate-500">Utility</th>
                          <th className="px-3 py-2 text-center font-black uppercase tracking-widest text-slate-500">Restricted</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {units.map((unit) => (
                          <tr key={unit.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-900">{unit.name}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                max={10}
                                value={unit.bedroom_count ?? ''}
                                onChange={(e) => updateUnit(unit.id, 'bedroom_count', e.target.value ? Number(e.target.value) : null)}
                                className="w-12 border border-slate-200 rounded px-1.5 py-1 text-center"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={unit.ami_percentage ?? ''}
                                onChange={(e) => updateUnit(unit.id, 'ami_percentage', e.target.value ? Number(e.target.value) : null)}
                                className="border border-slate-200 rounded px-1.5 py-1 bg-white"
                              >
                                <option value="">—</option>
                                {AMI_PERCENTAGE_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>{o.value}%</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={unit.max_gross_rent ?? ''}
                                onChange={(e) => updateUnit(unit.id, 'max_gross_rent', e.target.value ? Number(e.target.value) : null)}
                                className="w-20 border border-slate-200 rounded px-1.5 py-1"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                value={unit.utility_allowance ?? ''}
                                onChange={(e) => updateUnit(unit.id, 'utility_allowance', e.target.value ? Number(e.target.value) : null)}
                                className="w-16 border border-slate-200 rounded px-1.5 py-1"
                                placeholder="$"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={unit.is_restricted}
                                onChange={(e) => updateUnit(unit.id, 'is_restricted', e.target.checked)}
                                className="rounded border-slate-300"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Insurance Requirement ── */}
            <div className="border-t border-slate-200 pt-5 mt-2">
              <button
                type="button"
                onClick={() => setInsuranceRequired(!insuranceRequired)}
                className="flex items-center gap-3 bg-slate-50 rounded-xl p-4 w-full text-left cursor-pointer"
              >
                <div className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${insuranceRequired ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${insuranceRequired ? 'translate-x-5' : ''}`} />
                </div>
                <div>
                  <span className="text-sm font-bold text-slate-900">Require Renters Insurance</span>
                  <p className="text-xs text-slate-500">Tenants must provide proof of insurance</p>
                </div>
              </button>

              {insuranceRequired && (
                <div className="mt-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                    Minimum Liability ($)
                  </label>
                  <input
                    type="number"
                    value={minLiability}
                    onChange={(e) => setMinLiability(e.target.value ? Number(e.target.value) : '')}
                    placeholder="100000"
                    className="w-40 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Industry standard: $100,000</p>
                </div>
              )}
            </div>

            {/* ── Save ── */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Settings
              </button>
            </div>
          </>
        )}
      </div>
    </AccessibleModal>
  )
}
