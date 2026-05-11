'use client'

import { useState, useEffect } from 'react'
import {
  UserPlus, Loader2, Building2, Home, Mail, Phone,
  Calendar, Bed, DollarSign, StickyNote
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import {
  useLeads, useLeadActivities,
  LEAD_SOURCE_OPTIONS,
  type CreateLeadPayload,
} from '@/hooks/useLeadsCRM'

type PropertyOption = { id: string; name: string }
type UnitOption = { id: string; name: string }

interface NewLeadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (leadId: string) => void
}

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  source: '',
  interested_property_id: '',
  interested_unit_id: '',
  desired_move_in: '',
  desired_bedrooms: '',
  budget_max: '',
  notes: '',
}

export default function NewLeadModal({ isOpen, onClose, onSuccess }: NewLeadModalProps) {
  const { createLead, creating } = useLeads()
  const { addActivity } = useLeadActivities(null)

  const [form, setForm] = useState(emptyForm)

  // ── Property / Unit selects ──
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [loadingProps, setLoadingProps] = useState(false)
  const [loadingUnits, setLoadingUnits] = useState(false)

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm)
      setUnits([])
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
    if (!form.interested_property_id) { setUnits([]); return }
    let cancelled = false
    async function load() {
      setLoadingUnits(true)
      // Only show units the lead could actually move into. Status='Vacant'
      // is the base filter; units that are "Occupied" but with a known
      // availability_date in the future (notice-given) are also shown.
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('units')
        .select('id, name, status, availability_date')
        .eq('property_id', form.interested_property_id)
        .or(`status.eq.Vacant,availability_date.gte.${today}`)
        .order('name')
      if (!cancelled && data) setUnits(data)
      if (!cancelled) setLoadingUnits(false)
    }
    load()
    return () => { cancelled = true }
  }, [form.interested_property_id])

  const handleChange = (field: string, value: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      // Clear unit when property changes
      if (field === 'interested_property_id') {
        next.interested_unit_id = ''
      }
      return next
    })
  }

  const handleSubmit = async () => {
    // Validation
    if (!form.first_name.trim()) {
      toast.error('First name is required')
      return
    }
    if (!form.last_name.trim()) {
      toast.error('Last name is required')
      return
    }
    if (!form.email.trim()) {
      toast.error('Email is required')
      return
    }
    if (!form.source) {
      toast.error('Please select a lead source')
      return
    }

    const budgetMax = form.budget_max.trim() ? parseFloat(form.budget_max) : undefined
    if (form.budget_max.trim() && (isNaN(budgetMax!) || budgetMax! < 0)) {
      toast.error('Please enter a valid budget amount')
      return
    }

    const desiredBedrooms = form.desired_bedrooms.trim() ? parseInt(form.desired_bedrooms, 10) : undefined
    if (form.desired_bedrooms.trim() && (isNaN(desiredBedrooms!) || desiredBedrooms! < 0)) {
      toast.error('Please enter a valid bedroom count')
      return
    }

    const payload: CreateLeadPayload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      source: form.source,
      interested_property_id: form.interested_property_id || undefined,
      interested_unit_id: form.interested_unit_id || undefined,
      desired_move_in: form.desired_move_in || undefined,
      desired_bedrooms: desiredBedrooms,
      budget_max: budgetMax,
      notes: form.notes.trim() || undefined,
    }

    try {
      const created = await createLead(payload)

      // Auto-create activity if notes were provided
      if (form.notes.trim() && created?.id) {
        try {
          await addActivity({
            leadId: created.id,
            type: 'note',
            description: form.notes.trim(),
          })
        } catch {
          // Non-critical — note creation failure shouldn't block lead creation
        }
      }

      onSuccess(created?.id ?? '')
    } catch {
      // Error handled by hook
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="New Lead"
      subtitle="Add a prospective tenant to the pipeline"
      size="max-w-2xl"
      headerBg="bg-emerald-50"
      headerTextColor="text-emerald-900"
      closeBtnColor="text-emerald-400"
    >
      <div className="p-6 space-y-6">

        {/* Name */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.first_name}
              onChange={(e) => handleChange('first_name', e.target.value)}
              placeholder="John"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.last_name}
              onChange={(e) => handleChange('last_name', e.target.value)}
              placeholder="Doe"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        {/* Email & Phone */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="john@example.com"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Phone
            </label>
            <div className="relative">
              <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
        </div>

        {/* Source */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Lead Source <span className="text-red-500">*</span>
          </label>
          <select
            value={form.source}
            onChange={(e) => handleChange('source', e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white appearance-none cursor-pointer"
          >
            <option value="">Select source...</option>
            {LEAD_SOURCE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Property & Unit */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Interested Property
            </label>
            <div className="relative">
              <Building2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={form.interested_property_id}
                onChange={(e) => handleChange('interested_property_id', e.target.value)}
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
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Interested Unit
            </label>
            <div className="relative">
              <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={form.interested_unit_id}
                onChange={(e) => handleChange('interested_unit_id', e.target.value)}
                disabled={!form.interested_property_id || loadingUnits}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
              >
                <option value="">
                  {!form.interested_property_id ? 'Select property first...' : loadingUnits ? 'Loading...' : 'Select unit...'}
                </option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {loadingUnits && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />}
            </div>
          </div>
        </div>

        {/* Move-in / Bedrooms / Budget */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Desired Move-In
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={form.desired_move_in}
                onChange={(e) => handleChange('desired_move_in', e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Bedrooms
            </label>
            <div className="relative">
              <Bed size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="0"
                value={form.desired_bedrooms}
                onChange={(e) => handleChange('desired_bedrooms', e.target.value)}
                placeholder="2"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Budget Max
            </label>
            <div className="relative">
              <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="0"
                step="50"
                value={form.budget_max}
                onChange={(e) => handleChange('budget_max', e.target.value)}
                placeholder="1500"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Notes
          </label>
          <div className="relative">
            <StickyNote size={16} className="absolute left-4 top-3.5 text-slate-400" />
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={3}
              placeholder="Initial contact notes, preferences, etc..."
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Notes will also be added as the first activity on the lead timeline.
          </p>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={creating}
          className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Creating Lead...
            </>
          ) : (
            <>
              <UserPlus size={16} />
              Create Lead
            </>
          )}
        </button>
      </div>
    </AccessibleModal>
  )
}
