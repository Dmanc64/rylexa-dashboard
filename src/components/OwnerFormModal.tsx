'use client'

import { useState, useEffect } from 'react'
import { Save, Loader2, User, Building2, Mail, Phone, FileText, MapPin } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { useOwners, type Owner } from '@/hooks/useOwners'

type Props = {
  isOpen: boolean
  onClose: () => void
  owner: Owner | null // null = create mode, populated = edit mode
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

const emptyForm = {
  full_name: '',
  email: '',
  phone: '',
  company_name: '',
  notes: '',
  tax_id: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
}

export default function OwnerFormModal({ isOpen, onClose, owner }: Props) {
  const { createOwner, updateOwner, saving } = useOwners()
  const [form, setForm] = useState(emptyForm)

  const isEdit = owner !== null

  // Pre-fill form when opening in edit mode, reset for create mode
  useEffect(() => {
    if (!isOpen) return

    if (owner) {
      setForm({
        full_name: owner.full_name || '',
        email: owner.email || '',
        phone: owner.phone || '',
        company_name: owner.company_name || '',
        notes: owner.notes || '',
        tax_id: owner.tax_id || '',
        address_street: owner.address_street || '',
        address_city: owner.address_city || '',
        address_state: owner.address_state || '',
        address_zip: owner.address_zip || '',
      })
    } else {
      setForm(emptyForm)
    }
  }, [isOpen, owner])

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim()) {
      toast.error('Owner name is required')
      return
    }
    if (!form.email.trim()) {
      toast.error('Email is required')
      return
    }

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      company_name: form.company_name.trim() || null,
      notes: form.notes.trim() || null,
      user_id: owner?.user_id ?? null,
      tax_id: form.tax_id.trim() || null,
      address_street: form.address_street.trim() || null,
      address_city: form.address_city.trim() || null,
      address_state: form.address_state.trim() || null,
      address_zip: form.address_zip.trim() || null,
    }

    try {
      if (isEdit) {
        await updateOwner({ id: owner.id, ...payload })
      } else {
        await createOwner(payload)
      }
      onClose()
    } catch {
      // Error toasts handled by the hook
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Owner' : 'Add Owner'}
      subtitle={isEdit ? 'Update owner information' : 'Register a new property owner'}
      size="max-w-2xl"
    >
      {/* Body */}
      <div className="p-8 space-y-8">

        {/* Section 1: Owner Info */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
            <User size={12} /> Owner Information
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                placeholder="e.g. John Smith"
                value={form.full_name}
                onChange={(e) => handleChange('full_name', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Company / LLC</label>
              <div className="relative">
                <Building2 className="absolute left-4 top-4 h-4 w-4 text-slate-300" />
                <input
                  type="text"
                  className="w-full p-4 pl-10 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  placeholder="e.g. Smith Properties LLC"
                  value={form.company_name}
                  onChange={(e) => handleChange('company_name', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Contact Details */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
            <Mail size={12} /> Contact Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Email <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-4 h-4 w-4 text-slate-300" />
                <input
                  type="email"
                  required
                  className="w-full p-4 pl-10 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="owner@example.com"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone</label>
              <div className="relative">
                <Phone className="absolute left-4 top-4 h-4 w-4 text-slate-300" />
                <input
                  type="tel"
                  className="w-full p-4 pl-10 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="(555) 123-4567"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Tax Information */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] flex items-center gap-2">
            <MapPin size={12} /> Tax & Mailing Address
          </h3>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tax ID (EIN / SSN)</label>
            <input
              type="text"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all font-mono"
              placeholder="XX-XXXXXXX"
              maxLength={10}
              value={form.tax_id}
              onChange={(e) => handleChange('tax_id', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Street Address</label>
            <input
              type="text"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              placeholder="123 Main St"
              value={form.address_street}
              onChange={(e) => handleChange('address_street', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">City</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                placeholder="Reno"
                value={form.address_city}
                onChange={(e) => handleChange('address_city', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">State</label>
              <select
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
                value={form.address_state}
                onChange={(e) => handleChange('address_state', e.target.value)}
              >
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ZIP</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                placeholder="89501"
                maxLength={10}
                value={form.address_zip}
                onChange={(e) => handleChange('address_zip', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Section 4: Notes */}
        <div className="space-y-4">
          <h3 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-2">
            <FileText size={12} /> Notes
          </h3>
          <textarea
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none"
            rows={3}
            placeholder="Internal notes about this owner..."
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
        <button
          onClick={onClose}
          className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Save size={16} />}
          {isEdit ? 'Save Changes' : 'Add Owner'}
        </button>
      </div>
    </AccessibleModal>
  )
}
