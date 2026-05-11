'use client'

import { useState, useEffect } from 'react'
import { Save, Loader2, UserPlus, Building2, Phone, Mail, DollarSign, ShieldCheck, AlertTriangle, MapPin } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { useVendors, type Vendor } from '@/hooks/useVendors'

type Props = {
  isOpen: boolean
  onClose: () => void
  vendor: Vendor | null // null = create mode, populated = edit mode
}

const DEFAULT_TRADES = [
  'Plumbing', 'Electrical', 'HVAC', 'General Maintenance',
  'Landscaping', 'Painting', 'Roofing', 'Cleaning',
  'Pest Control', 'Appliance Repair', 'Carpentry', 'Locksmith'
]

const PAYMENT_TYPES = ['Check', 'ACH', 'Venmo', 'Zelle', 'Other']

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

const emptyForm = {
  company_name: '',
  contact_name: '',
  email: '',
  phone: '',
  trade_type: '',
  custom_trade: '',
  payment_type: '',
  is_1099: false,
  do_not_use: false,
  insurance_exp: '',
  hourly_rate: '',
  tax_id: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
}

export default function VendorFormModal({ isOpen, onClose, vendor }: Props) {
  const { trades, createVendor, updateVendor, saving } = useVendors()
  const [form, setForm] = useState(emptyForm)

  const isEdit = vendor !== null

  // Merge dynamic trades from DB with defaults (deduped, sorted)
  const allTrades = Array.from(new Set([...DEFAULT_TRADES, ...trades])).sort()

  // Pre-fill form when opening in edit mode, reset for create mode
  useEffect(() => {
    if (!isOpen) return

    if (vendor) {
      const tradeIsCustom = vendor.trade_type && !allTrades.includes(vendor.trade_type)
      setForm({
        company_name: vendor.company_name || '',
        contact_name: vendor.contact_name || '',
        email: vendor.email || '',
        phone: vendor.phone || '',
        trade_type: tradeIsCustom ? '__other__' : (vendor.trade_type || ''),
        custom_trade: tradeIsCustom ? (vendor.trade_type || '') : '',
        payment_type: vendor.payment_type || '',
        is_1099: vendor.is_1099 ?? false,
        do_not_use: vendor.do_not_use ?? false,
        insurance_exp: vendor.insurance_exp || '',
        hourly_rate: vendor.hourly_rate != null ? String(vendor.hourly_rate) : '',
        tax_id: vendor.tax_id || '',
        address_street: vendor.address_street || '',
        address_city: vendor.address_city || '',
        address_state: vendor.address_state || '',
        address_zip: vendor.address_zip || '',
      })
    } else {
      setForm(emptyForm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, vendor])

  const handleChange = (field: string, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    // Validation
    if (!form.company_name.trim() && !form.contact_name.trim()) {
      toast.error('Please provide a company name or contact name')
      return
    }
    if (!form.email.trim()) {
      toast.error('Email is required for vendor portal access')
      return
    }

    const resolvedTrade = form.trade_type === '__other__' ? form.custom_trade.trim() : form.trade_type.trim()
    const hourlyRate = form.hourly_rate.trim() ? Math.round(parseFloat(form.hourly_rate) * 100) / 100 : null

    if (form.hourly_rate.trim() && (isNaN(hourlyRate!) || hourlyRate! < 0)) {
      toast.error('Please enter a valid hourly rate')
      return
    }

    const payload = {
      company_name: form.company_name.trim() || null,
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      trade_type: resolvedTrade || null,
      payment_type: form.payment_type.trim() || null,
      is_1099: form.is_1099,
      do_not_use: form.do_not_use,
      insurance_exp: form.insurance_exp || undefined,
      hourly_rate: hourlyRate,
      tax_id: form.tax_id.trim() || null,
      address_street: form.address_street.trim() || null,
      address_city: form.address_city.trim() || null,
      address_state: form.address_state.trim() || null,
      address_zip: form.address_zip.trim() || null,
    }

    try {
      if (isEdit) {
        await updateVendor({ id: vendor.id, ...payload })
      } else {
        await createVendor(payload as any)
      }
      onClose()
    } catch {
      // Error toasts handled by the hook
    }
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit Vendor' : 'Onboard Vendor'} subtitle={isEdit ? 'Update vendor information' : 'Add a new contractor to the network'} size="max-w-2xl">
        {/* Scrollable Body */}
        <div className="p-8 space-y-8">

          {/* Section 1: Company Info */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <Building2 size={12} /> Company Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Company Name</label>
                <input
                  type="text"
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  placeholder="e.g. Ace Plumbing LLC"
                  value={form.company_name}
                  onChange={(e) => handleChange('company_name', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contact Person</label>
                <input
                  type="text"
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  placeholder="e.g. John Smith"
                  value={form.contact_name}
                  onChange={(e) => handleChange('contact_name', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Trade / Specialty</label>
              <select
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer"
                value={form.trade_type}
                onChange={(e) => handleChange('trade_type', e.target.value)}
              >
                <option value="">Select a trade...</option>
                {allTrades.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="__other__">Other (custom)...</option>
              </select>
              {form.trade_type === '__other__' && (
                <input
                  type="text"
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all mt-2"
                  placeholder="Enter custom trade type..."
                  value={form.custom_trade}
                  onChange={(e) => handleChange('custom_trade', e.target.value)}
                  autoFocus
                />
              )}
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
                    placeholder="vendor@example.com"
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

          {/* Section 3: Financials & Compliance */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <DollarSign size={12} /> Financials & Compliance
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Hourly Rate</label>
                <div className="relative">
                  <span className="absolute left-4 top-4 text-sm font-black text-slate-400">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full p-4 pl-8 pr-14 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                    placeholder="0.00"
                    value={form.hourly_rate}
                    onChange={(e) => handleChange('hourly_rate', e.target.value)}
                  />
                  <span className="absolute right-4 top-4 text-sm font-bold text-slate-400">/hr</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Payment Method</label>
                <select
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all appearance-none cursor-pointer"
                  value={form.payment_type}
                  onChange={(e) => handleChange('payment_type', e.target.value)}
                >
                  <option value="">Select method...</option>
                  {PAYMENT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Insurance Expiration</label>
              <input
                type="date"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                value={form.insurance_exp}
                onChange={(e) => handleChange('insurance_exp', e.target.value)}
              />
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <label className="flex items-center gap-4 p-4 bg-purple-50 border border-purple-100 rounded-2xl cursor-pointer hover:bg-purple-100/80 transition-colors">
                <input
                  type="checkbox"
                  checked={form.is_1099}
                  onChange={(e) => handleChange('is_1099', e.target.checked)}
                  className="w-5 h-5 rounded-lg border-2 border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
                <div>
                  <div className="text-sm font-black text-purple-900 flex items-center gap-1.5">
                    <ShieldCheck size={14} /> 1099 On File
                  </div>
                  <div className="text-[10px] text-purple-500 font-bold">Tax documentation received</div>
                </div>
              </label>

              <label className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-colors border
                ${form.do_not_use ? 'bg-red-50 border-red-200 hover:bg-red-100/80' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}
              `}>
                <input
                  type="checkbox"
                  checked={form.do_not_use}
                  onChange={(e) => handleChange('do_not_use', e.target.checked)}
                  className="w-5 h-5 rounded-lg border-2 border-red-300 text-red-600 focus:ring-red-500 cursor-pointer"
                />
                <div>
                  <div className={`text-sm font-black flex items-center gap-1.5 ${form.do_not_use ? 'text-red-700' : 'text-slate-600'}`}>
                    <AlertTriangle size={14} /> Do Not Use
                  </div>
                  <div className={`text-[10px] font-bold ${form.do_not_use ? 'text-red-500' : 'text-slate-400'}`}>
                    Suspend vendor from assignments
                  </div>
                </div>
              </label>
            </div>

            {/* Tax & Address (shown when 1099 checked) */}
            {form.is_1099 && (
              <div className="space-y-4 pt-4 border-t border-purple-100">
                <h4 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-2">
                  <MapPin size={12} /> Tax & Mailing Address
                </h4>

                {!form.tax_id.trim() && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[10px] font-bold text-amber-700">
                    <AlertTriangle size={12} /> Tax ID (EIN) is required for 1099 generation
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tax ID (EIN)</label>
                  <input
                    type="text"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all font-mono"
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
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
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
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                      placeholder="Reno"
                      value={form.address_city}
                      onChange={(e) => handleChange('address_city', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">State</label>
                    <select
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all appearance-none cursor-pointer"
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
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                      placeholder="89501"
                      maxLength={10}
                      value={form.address_zip}
                      onChange={(e) => handleChange('address_zip', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
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
            {isEdit ? 'Save Changes' : 'Onboard Vendor'}
          </button>
        </div>
    </AccessibleModal>
  )
}
