'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Save, Loader2, AlertTriangle, Info } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import { useComplianceMutations, type CreateInsurancePolicyPayload } from '@/hooks/useCompliance'

type Props = {
  isOpen: boolean
  onClose: () => void
}

type LeaseOption = {
  lease_id: string
  tenant_id: string
  tenant_name: string
  unit_name: string
  property_id: string
  property_name: string
  min_liability: number
}

export default function InsurancePolicyModal({ isOpen, onClose }: Props) {
  const { createInsurancePolicy } = useComplianceMutations()

  const [leases, setLeases] = useState<LeaseOption[]>([])
  const [loadingLeases, setLoadingLeases] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [selectedLeaseId, setSelectedLeaseId] = useState('')
  const [carrier, setCarrier] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [coverageAmount, setCoverageAmount] = useState<number | ''>('')
  const [liabilityAmount, setLiabilityAmount] = useState<number | ''>('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [notes, setNotes] = useState('')

  const selectedLease = leases.find(l => l.lease_id === selectedLeaseId)

  const loadLeases = useCallback(async () => {
    setLoadingLeases(true)
    // Get active leases on insurance-required properties
    const { data, error } = await supabase
      .from('leases')
      .select(`
        id,
        tenant_id,
        tenants ( first_name, last_name ),
        units ( name, property_id, properties ( name, insurance_required, min_liability_amount ) )
      `)
      .eq('status', 'Active')
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Failed to load leases')
      setLoadingLeases(false)
      return
    }

    const mapped: LeaseOption[] = (data ?? [])
      .filter((l: any) => l.units?.properties?.insurance_required)
      .map((l: any) => ({
        lease_id: l.id,
        tenant_id: l.tenant_id,
        tenant_name: `${l.tenants?.first_name ?? ''} ${l.tenants?.last_name ?? ''}`.trim(),
        unit_name: l.units?.name ?? '',
        property_id: l.units?.property_id ?? '',
        property_name: l.units?.properties?.name ?? '',
        min_liability: l.units?.properties?.min_liability_amount ?? 100000,
      }))

    setLeases(mapped)
    setLoadingLeases(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadLeases()
      // Reset form
      setSelectedLeaseId('')
      setCarrier('')
      setPolicyNumber('')
      setCoverageAmount('')
      setLiabilityAmount('')
      setEffectiveDate('')
      setExpirationDate('')
      setNotes('')
    }
  }, [isOpen, loadLeases])

  const liabilityBelowMin = selectedLease
    && typeof liabilityAmount === 'number'
    && liabilityAmount < selectedLease.min_liability

  const canSubmit =
    selectedLeaseId &&
    carrier.trim() &&
    policyNumber.trim() &&
    typeof coverageAmount === 'number' && coverageAmount > 0 &&
    typeof liabilityAmount === 'number' && liabilityAmount > 0 &&
    effectiveDate &&
    expirationDate &&
    expirationDate > effectiveDate

  const handleSubmit = async () => {
    if (!canSubmit || !selectedLease) return
    setSaving(true)
    try {
      const payload: CreateInsurancePolicyPayload = {
        tenant_id: selectedLease.tenant_id,
        lease_id: selectedLease.lease_id,
        property_id: selectedLease.property_id,
        carrier: carrier.trim(),
        policy_number: policyNumber.trim(),
        coverage_amount: coverageAmount as number,
        liability_amount: liabilityAmount as number,
        effective_date: effectiveDate,
        expiration_date: expirationDate,
        notes: notes.trim() || undefined,
      }
      await createInsurancePolicy.mutateAsync(payload)
      onClose()
    } catch {
      // Error toast handled by mutation
    } finally {
      setSaving(false)
    }
  }

  const currFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Insurance Policy"
      subtitle="Track a tenant's renters insurance for compliance"
      size="max-w-2xl"
      headerBg="bg-emerald-50"
      headerTextColor="text-emerald-900"
    >
      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Lease Selector */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
            Lease (Insurance-Required Properties)
          </label>
          {loadingLeases ? (
            <div className="flex items-center gap-2 py-3 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Loading leases...
            </div>
          ) : leases.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">
              No insurance-required properties configured. Use &ldquo;Configure Properties&rdquo; first.
            </p>
          ) : (
            <select
              value={selectedLeaseId}
              onChange={(e) => setSelectedLeaseId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="">Choose a lease...</option>
              {leases.map(l => (
                <option key={l.lease_id} value={l.lease_id}>
                  {l.tenant_name} — {l.property_name} / {l.unit_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Property requirement info */}
        {selectedLease && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
            <Info size={14} />
            {selectedLease.property_name} requires min. {currFmt.format(selectedLease.min_liability)} liability coverage
          </div>
        )}

        {selectedLeaseId && (
          <>
            {/* Carrier & Policy Number */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Insurance Carrier
                </label>
                <input
                  type="text"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="e.g. State Farm, Lemonade"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Policy Number
                </label>
                <input
                  type="text"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  placeholder="Policy #"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* Coverage & Liability */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Coverage Amount ($)
                </label>
                <input
                  type="number"
                  value={coverageAmount}
                  onChange={(e) => setCoverageAmount(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Personal property coverage"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  min={0}
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Liability Amount ($)
                </label>
                <input
                  type="number"
                  value={liabilityAmount}
                  onChange={(e) => setLiabilityAmount(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Liability coverage"
                  className={`w-full border rounded-xl px-3 py-2 text-sm ${
                    liabilityBelowMin ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                  }`}
                  min={0}
                />
                {liabilityBelowMin && (
                  <p className="text-[10px] text-amber-600 font-bold mt-1 flex items-center gap-1">
                    <AlertTriangle size={10} /> Below {currFmt.format(selectedLease!.min_liability)} minimum
                  </p>
                )}
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Effective Date
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Expiration Date
                </label>
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className={`w-full border rounded-xl px-3 py-2 text-sm ${
                    expirationDate && effectiveDate && expirationDate <= effectiveDate
                      ? 'border-red-400 bg-red-50' : 'border-slate-200'
                  }`}
                />
                {expirationDate && effectiveDate && expirationDate <= effectiveDate && (
                  <p className="text-[10px] text-red-600 font-bold mt-1">Must be after effective date</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Additional notes..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
              />
            </div>

            {/* Document reminder */}
            <div className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
              <ShieldCheck size={12} className="inline mr-1 -mt-0.5" />
              Upload the insurance certificate via <strong>Documents</strong> after recording.
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Record Policy
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
