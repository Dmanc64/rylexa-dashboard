'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, AlertTriangle, CheckCircle, GraduationCap, Loader2 } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { supabase } from '@/lib/supabaseClient'
import {
  useComplianceMutations,
  AMI_PERCENTAGE_OPTIONS,
  type CertificationType,
  type StudentStatus,
  type HouseholdMemberInput,
} from '@/hooks/useCompliance'

type Props = {
  isOpen: boolean
  onClose: () => void
}

type LeaseOption = {
  id: string
  tenant_id: string
  tenant_name: string
  property_name: string
  unit_name: string
  rent_amount: number
  ami_percentage: number | null
  max_gross_rent: number | null
  is_restricted: boolean
}

const EMPTY_MEMBER: HouseholdMemberInput = {
  first_name: '',
  last_name: '',
  relationship: 'Head of Household',
  is_full_time_student: false,
  annual_income: 0,
  income_source: '',
}

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function IncomeCertificationModal({ isOpen, onClose }: Props) {
  const { createCertification } = useComplianceMutations()

  // ── Lease selection ──
  const [leases, setLeases] = useState<LeaseOption[]>([])
  const [loadingLeases, setLoadingLeases] = useState(false)
  const [selectedLeaseId, setSelectedLeaseId] = useState('')

  // ── Form fields ──
  const [certType, setCertType] = useState<CertificationType>('Initial')
  const [certDate, setCertDate] = useState(new Date().toISOString().split('T')[0])
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [members, setMembers] = useState<HouseholdMemberInput[]>([{ ...EMPTY_MEMBER }])

  const selectedLease = leases.find((l) => l.id === selectedLeaseId)
  const totalIncome = members.reduce((s, m) => s + (Number(m.annual_income) || 0), 0)
  const allStudents = members.length > 0 && members.every((m) => m.is_full_time_student)
  const someStudents = members.some((m) => m.is_full_time_student)

  const [studentExemption, setStudentExemption] = useState<'exempt' | 'ineligible' | ''>('')

  const studentStatus: StudentStatus = allStudents
    ? (studentExemption === 'exempt' ? 'All-Exempt' : studentExemption === 'ineligible' ? 'All-Ineligible' : 'None')
    : someStudents ? 'Partial' : 'None'

  // Load leases with restricted unit info
  const loadLeases = useCallback(async () => {
    setLoadingLeases(true)
    const { data } = await supabase
      .from('leases')
      .select(`
        id, tenant_id, rent_amount, status,
        tenants ( first_name, last_name ),
        units ( name, ami_percentage, max_gross_rent, is_restricted, properties ( name ) )
      `)
      .eq('status', 'Active')
      .order('created_at', { ascending: false })

    setLeases(
      (data ?? []).map((l: any) => ({
        id: l.id,
        tenant_id: l.tenant_id,
        tenant_name: `${l.tenants?.first_name || ''} ${l.tenants?.last_name || ''}`.trim(),
        property_name: l.units?.properties?.name || '',
        unit_name: l.units?.name || '',
        rent_amount: l.rent_amount,
        ami_percentage: l.units?.ami_percentage,
        max_gross_rent: l.units?.max_gross_rent,
        is_restricted: l.units?.is_restricted || false,
      }))
    )
    setLoadingLeases(false)
  }, [])

  useEffect(() => {
    if (isOpen) loadLeases()
  }, [isOpen, loadLeases])

  // Auto-fill first member from selected lease
  useEffect(() => {
    if (selectedLease && members.length === 1 && !members[0].first_name) {
      const [first, ...rest] = selectedLease.tenant_name.split(' ')
      setMembers([{
        ...EMPTY_MEMBER,
        first_name: first || '',
        last_name: rest.join(' ') || '',
        relationship: 'Head of Household',
      }])
    }
  }, [selectedLeaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──
  const addMember = () => setMembers([...members, { ...EMPTY_MEMBER, relationship: 'Other' }])
  const removeMember = (idx: number) => setMembers(members.filter((_, i) => i !== idx))
  const updateMember = (idx: number, field: keyof HouseholdMemberInput, value: any) => {
    setMembers(members.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  const handleSubmit = async () => {
    if (!selectedLease) return
    await createCertification.mutateAsync({
      tenant_id: selectedLease.tenant_id,
      lease_id: selectedLease.id,
      certification_date: certDate,
      effective_date: effectiveDate,
      annual_income: totalIncome,
      household_size: members.length,
      ami_percentage: selectedLease.ami_percentage || 60,
      certification_type: certType,
      notes: notes || undefined,
      student_status: studentStatus,
      household_members: members,
    })
    resetForm()
    onClose()
  }

  const resetForm = () => {
    setSelectedLeaseId('')
    setCertType('Initial')
    setCertDate(new Date().toISOString().split('T')[0])
    setEffectiveDate(new Date().toISOString().split('T')[0])
    setNotes('')
    setMembers([{ ...EMPTY_MEMBER }])
    setStudentExemption('')
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Income Certification"
      subtitle="Record tenant income for affordable housing compliance"
      size="max-w-2xl"
      headerBg="bg-indigo-50"
      headerTextColor="text-indigo-900"
    >
      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* ── Lease Selector ── */}
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
            Select Lease
          </label>
          {loadingLeases ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
              <Loader2 size={14} className="animate-spin" /> Loading leases...
            </div>
          ) : (
            <select
              value={selectedLeaseId}
              onChange={(e) => setSelectedLeaseId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="">Choose a lease...</option>
              {leases.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.tenant_name} — {l.property_name}, {l.unit_name}
                  {l.is_restricted ? ` (${l.ami_percentage}% AMI)` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedLease && (
          <>
            {/* ── Lease Info Banner ── */}
            {selectedLease.is_restricted && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
                <span className="font-bold text-indigo-700">Restricted Unit</span>
                <span className="text-indigo-600 ml-2">
                  {selectedLease.ami_percentage}% AMI
                  {selectedLease.max_gross_rent ? ` | Max Rent: ${currencyFmt.format(selectedLease.max_gross_rent)}` : ''}
                </span>
              </div>
            )}

            {/* ── Cert Type + Dates ── */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Type
                </label>
                <select
                  value={certType}
                  onChange={(e) => setCertType(e.target.value as CertificationType)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
                >
                  <option value="Initial">Initial</option>
                  <option value="Annual">Annual</option>
                  <option value="Interim">Interim</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                  Certification Date
                </label>
                <input
                  type="date"
                  value={certDate}
                  onChange={(e) => setCertDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
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
            </div>

            {/* ── Household Members ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Household Members ({members.length})
                </label>
                <button
                  onClick={addMember}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-800"
                >
                  <Plus size={12} /> Add Member
                </button>
              </div>

              <div className="space-y-3">
                {members.map((member, idx) => (
                  <div key={idx} className="bg-slate-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">
                        Member {idx + 1} {idx === 0 ? '(Head of Household)' : ''}
                      </span>
                      {idx > 0 && (
                        <button onClick={() => removeMember(idx)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder="First name"
                        value={member.first_name}
                        onChange={(e) => updateMember(idx, 'first_name', e.target.value)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
                      />
                      <input
                        placeholder="Last name"
                        value={member.last_name}
                        onChange={(e) => updateMember(idx, 'last_name', e.target.value)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={member.relationship}
                        onChange={(e) => updateMember(idx, 'relationship', e.target.value)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white"
                      >
                        <option>Head of Household</option>
                        <option>Spouse</option>
                        <option>Child</option>
                        <option>Other</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Annual income"
                        value={member.annual_income || ''}
                        onChange={(e) => updateMember(idx, 'annual_income', parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
                      />
                      <input
                        placeholder="Income source"
                        value={member.income_source || ''}
                        onChange={(e) => updateMember(idx, 'income_source', e.target.value)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={member.is_full_time_student}
                        onChange={(e) => updateMember(idx, 'is_full_time_student', e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <GraduationCap size={14} />
                      Full-time student
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Income Summary + AMI Check ── */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Total Household Income
                </span>
                <span className="text-lg font-black text-slate-900">
                  {currencyFmt.format(totalIncome)}/yr
                </span>
              </div>

              {selectedLease.ami_percentage && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">
                    {selectedLease.ami_percentage}% AMI Unit
                  </span>
                  {/* Simplified check — in a real impl this would look up ami_limits table */}
                  <span className="ml-auto flex items-center gap-1 text-xs font-bold">
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span className="text-emerald-700">Income recorded</span>
                  </span>
                </div>
              )}

              {/* Student rule warning */}
              {allStudents && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-sm mb-2">
                    <AlertTriangle size={16} />
                    All household members are full-time students
                  </div>
                  <p className="text-xs text-amber-600 mb-2">
                    Under LIHTC rules, all-student households are generally ineligible unless an exemption applies
                    (job training, TANF, single parent, married filing jointly).
                  </p>
                  <select
                    value={studentExemption}
                    onChange={(e) => setStudentExemption(e.target.value as any)}
                    className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-sm bg-white"
                  >
                    <option value="">Select status...</option>
                    <option value="exempt">Exempt (qualifies for exception)</option>
                    <option value="ineligible">Ineligible (no exception applies)</option>
                  </select>
                </div>
              )}
            </div>

            {/* ── Notes ── */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes about this certification..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
              />
            </div>

            {/* ── Submit ── */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => { resetForm(); onClose() }}
                className="px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={
                  createCertification.isPending ||
                  !selectedLeaseId ||
                  members.length === 0 ||
                  !members[0].first_name ||
                  (allStudents && !studentExemption)
                }
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {createCertification.isPending && <Loader2 size={14} className="animate-spin" />}
                Create Certification
              </button>
            </div>
          </>
        )}
      </div>
    </AccessibleModal>
  )
}
