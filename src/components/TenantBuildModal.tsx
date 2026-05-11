'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { CheckCircle, Loader2, UserCheck, AlertCircle, Building2, Home, DollarSign, Calendar, ShieldCheck, ShieldAlert } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { Application } from '@/hooks/useApplications'
import { processApplication } from '@/actions/application-actions'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  application: Application | null
}

type UnitInfo = {
  name: string
  market_rent: number | null
}

type ExistingTenant = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  status: string
}

export default function TenantBuildModal({ isOpen, onClose, onSuccess, application }: Props) {
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null)
  const [propertyName, setPropertyName] = useState('')
  const [existingTenant, setExistingTenant] = useState<ExistingTenant | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  const [formData, setFormData] = useState({
    rent: '',
    deposit: '',
    prorated_rent: '',
    utility_fee: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: ''
  })

  // Fetch unit info, property name, and check for existing tenant when modal opens
  useEffect(() => {
    if (!isOpen || !application) return

    setFetching(true)
    setExistingTenant(null)

    const fetchData = async () => {
      // Fetch unit details (name + market_rent) using the unit_id from the application
      const { data: appData } = await supabase
        .from('applications')
        .select('unit_id, property_id')
        .eq('id', application.id)
        .single()

      if (appData?.unit_id) {
        const { data: unit } = await supabase
          .from('units')
          .select('name, market_rent')
          .eq('id', appData.unit_id)
          .single()

        if (unit) {
          setUnitInfo(unit)
          // Pre-fill rent and deposit with market_rent
          if (unit.market_rent) {
            setFormData(prev => ({ ...prev, rent: String(unit.market_rent), deposit: String(unit.market_rent) }))
          }
        }
      }

      if (appData?.property_id) {
        const { data: prop } = await supabase
          .from('properties')
          .select('name')
          .eq('id', appData.property_id)
          .single()

        if (prop) setPropertyName(prop.name)
      }

      // Check for existing tenant by email
      if (application.email) {
        const { data: tenants } = await supabase
          .from('tenants')
          .select('id, first_name, last_name, email, status')
          .eq('email', application.email)
          .limit(1)

        if (tenants && tenants.length > 0) {
          setExistingTenant(tenants[0])
        }
      }

      setFetching(false)
    }

    // Reset form BEFORE fetching so async pre-fill (market_rent) is not overwritten
    setFormData({
      rent: '',
      deposit: '',
      prorated_rent: '',
      utility_fee: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: ''
    })

    fetchData()
  }, [isOpen, application])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!application) return

    setLoading(true)

    try {
      const result = await processApplication(application.id, 'Approved', {
        rent: Number(formData.rent),
        deposit: Number(formData.deposit) || 0,
        proratedRent: Number(formData.prorated_rent) || undefined,
        utilityFee: Number(formData.utility_fee) || 0,
        startDate: formData.start_date,
        endDate: formData.end_date || undefined,
        existingTenantId: existingTenant?.id
      })

      if (!result.success) {
        toast.error(result.message)
      } else {
        toast.success(result.message)
        onSuccess()
        onClose()
      }
    } catch (error) {
      toast.error('Error: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  if (!application) return null

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Tenant Build" subtitle="Approve & Configure Lease" size="max-w-2xl" headerBg="bg-slate-900" closeBtnColor="text-slate-400" headerTextColor="text-white">
        {fetching ? (
          <div className="py-16 text-center">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading Unit Details...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-6">

            {/* Screening Summary Banner */}
            {application.screening_status === 'Screened' && application.screening_score != null && (
              <div className={`border rounded-xl p-4 flex items-start gap-3 ${
                application.screening_score >= 70
                  ? 'bg-emerald-50 border-emerald-200'
                  : application.screening_score >= 50
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <ShieldCheck className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  application.screening_score >= 70 ? 'text-emerald-600' :
                  application.screening_score >= 50 ? 'text-amber-600' : 'text-red-600'
                }`} />
                <div>
                  <p className={`font-bold text-sm ${
                    application.screening_score >= 70 ? 'text-emerald-900' :
                    application.screening_score >= 50 ? 'text-amber-900' : 'text-red-900'
                  }`}>
                    Screening Score: {application.screening_score}/100 — {
                      application.screening_score >= 70 ? 'Approve Recommended' :
                      application.screening_score >= 50 ? 'Review Recommended' : 'Deny Recommended'
                    }
                  </p>
                  {application.screening_notes && (
                    <p className="text-xs mt-1 text-slate-600">Notes: {application.screening_notes}</p>
                  )}
                </div>
              </div>
            )}
            {application.screening_status === 'Waived' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-900 text-sm">Screening Waived</p>
                  <p className="text-amber-700 text-xs mt-1">Management bypassed screening for this applicant.</p>
                </div>
              </div>
            )}

            {/* Existing Tenant Banner */}
            {existingTenant && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <UserCheck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-blue-900 text-sm">Returning Tenant Detected</p>
                  <p className="text-blue-700 text-xs mt-1">
                    <strong>{existingTenant.first_name} {existingTenant.last_name}</strong> already exists in the system
                    (Status: {existingTenant.status}). Their existing record will be reused.
                  </p>
                </div>
              </div>
            )}

            {/* Applicant Info — Read Only */}
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-6">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Applicant Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase">Full Name</span>
                  <span className="font-black text-slate-900 italic text-lg">{application.first_name} {application.last_name}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase">Email</span>
                  <span className="font-bold text-slate-700">{application.email}</span>
                </div>
              </div>
            </div>

            {/* Property & Unit Info — Read Only */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-slate-400" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Property</span>
                </div>
                <p className="font-bold text-slate-900">{propertyName || application.property_name}</p>
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Home className="w-4 h-4 text-slate-400" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit</span>
                </div>
                <p className="font-bold text-slate-900">{unitInfo?.name || application.unit_name}</p>
              </div>
            </div>

            {/* Base Rent Reference */}
            {unitInfo?.market_rent && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                <div>
                  <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Market Rent Reference</span>
                  <p className="font-black text-emerald-700 text-lg italic">${unitInfo.market_rent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</p>
                </div>
              </div>
            )}

            {/* Editable Lease Terms */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">
                Lease Configuration
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Monthly Rent ($) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    value={formData.rent}
                    onChange={e => setFormData({ ...formData, rent: e.target.value })}
                    placeholder="e.g. 1500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Security Deposit ($)</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    value={formData.deposit}
                    onChange={e => setFormData({ ...formData, deposit: e.target.value })}
                    placeholder="e.g. 1500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Monthly Utility Fee ($) <span className="text-slate-400 text-[10px]">(water, trash, etc. — 0 if not applicable)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                    value={formData.utility_fee}
                    onChange={e => setFormData({ ...formData, utility_fee: e.target.value })}
                    placeholder="e.g. 150 — charged monthly on the 1st"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Prorated 1st Month Rent ($) <span className="text-slate-400 text-[10px]">(leave blank if full month)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    value={formData.prorated_rent}
                    onChange={e => setFormData({ ...formData, prorated_rent: e.target.value })}
                    placeholder="e.g. 750 — only if 1st month is partial"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    value={formData.start_date}
                    onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    End Date <span className="text-slate-400 text-[10px]">(blank = month-to-month)</span>
                  </label>
                  <input
                    type="date"
                    className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    value={formData.end_date}
                    onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-xl hover:border-slate-400 hover:text-slate-600 transition-all uppercase tracking-widest text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-[2] py-4 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-xl uppercase tracking-widest text-xs"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <CheckCircle size={18} />
                )}
                {loading ? 'Processing...' : 'Approve & Create Tenant'}
              </button>
            </div>
          </form>
        )}
    </AccessibleModal>
  )
}
