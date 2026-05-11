'use client'

import { useState, useEffect, useRef } from 'react'
import { Save, Loader2, Upload, Trash2, ImageIcon } from 'lucide-react'
import Image from 'next/image'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { uploadPropertyImage, removePropertyImage } from '@/actions/property-actions'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/upload-utils'

type Props = {
  isOpen: boolean
  onClose: () => void
  property: any
  onImageUpdated?: () => void
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

export default function PropertyEditModal({ isOpen, onClose, property, onImageUpdated }: Props) {
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    name: '',
    address: '',
    street: '',
    suite: '',
    city: '',
    state: '',
    zip: '',
    standard_utility_fee: '',
    insurance_required: false,
    min_liability_amount: '',
  })

  useEffect(() => {
    if (!isOpen || !property) return
    setPreviewUrl(property.image_url || null)
    setForm({
      name: property.name || '',
      address: property.address || '',
      street: property.street || '',
      suite: property.suite || '',
      city: property.city || '',
      state: property.state || '',
      zip: property.zip || '',
      standard_utility_fee: property.standard_utility_fee != null ? String(property.standard_utility_fee) : '0',
      insurance_required: property.insurance_required ?? false,
      min_liability_amount: property.min_liability_amount != null ? String(property.min_liability_amount) : '100000',
    })
  }, [isOpen, property])

  const handleChange = (field: string, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Use JPEG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File too large. Maximum 10MB.')
      return
    }

    setUploading(true)
    const fd = new FormData()
    fd.append('propertyId', property.id)
    fd.append('image', file)

    const result = await uploadPropertyImage(fd)
    setUploading(false)

    if (result.success) {
      setPreviewUrl(result.imageUrl!)
      toast.success('Property image uploaded')
      onImageUpdated?.()
    } else {
      toast.error(result.message)
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleImageRemove = async () => {
    setUploading(true)
    const result = await removePropertyImage(property.id)
    setUploading(false)

    if (result.success) {
      setPreviewUrl(null)
      toast.success('Image removed')
      onImageUpdated?.()
    } else {
      toast.error(result.message)
    }
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Property name is required')
      return
    }

    setSaving(true)
    const { error } = await supabase
      .from('properties')
      .update({
        name: form.name.trim(),
        address: form.address.trim() || null,
        street: form.street.trim() || null,
        suite: form.suite.trim() || null,
        city: form.city.trim() || null,
        state: form.state || null,
        zip: form.zip.trim() || null,
        standard_utility_fee: form.standard_utility_fee ? Number(form.standard_utility_fee) : 0,
        insurance_required: form.insurance_required,
        min_liability_amount: form.min_liability_amount ? Number(form.min_liability_amount) : null,
      })
      .eq('id', property.id)

    setSaving(false)

    if (error) {
      toast.error('Failed to update: ' + error.message)
    } else {
      toast.success('Property updated')
      onClose()
    }
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Edit Property" size="max-w-2xl">
      <div className="p-6 space-y-6">

        {/* Property Image */}
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Property Photo</label>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div className="relative w-32 h-24 bg-slate-100 rounded-2xl overflow-hidden shrink-0 border border-slate-200">
              {previewUrl ? (
                <Image src={previewUrl} alt={form.name || 'Property'} fill className="object-cover" sizes="128px" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-300">
                  <ImageIcon size={28} />
                </div>
              )}
            </div>
            {/* Upload / Remove Buttons */}
            <div className="flex flex-col gap-2 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {previewUrl ? 'Replace' : 'Upload'}
              </button>
              {previewUrl && (
                <button
                  type="button"
                  onClick={handleImageRemove}
                  disabled={uploading}
                  className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <Trash2 size={12} /> Remove
                </button>
              )}
              <p className="text-[9px] text-slate-400 font-medium">JPEG, PNG, or WebP. Max 10MB.</p>
            </div>
          </div>
        </div>

        {/* Property Name */}
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Property Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => handleChange('name', e.target.value)}
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        {/* Address Fields */}
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Address</label>
          <input
            type="text"
            placeholder="Street address"
            value={form.address}
            onChange={e => handleChange('address', e.target.value)}
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 mb-3"
          />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              placeholder="Street"
              value={form.street}
              onChange={e => handleChange('street', e.target.value)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <input
              type="text"
              placeholder="Suite / Unit"
              value={form.suite}
              onChange={e => handleChange('suite', e.target.value)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="City"
              value={form.city}
              onChange={e => handleChange('city', e.target.value)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <select
              value={form.state}
              onChange={e => handleChange('state', e.target.value)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 appearance-none cursor-pointer"
            >
              <option value="">State</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              placeholder="ZIP"
              value={form.zip}
              onChange={e => handleChange('zip', e.target.value)}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        {/* Utility Fee */}
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Standard Monthly Utility Fee</label>
          <div className="relative">
            <span className="absolute left-3 top-3.5 text-slate-400 font-bold text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.standard_utility_fee}
              onChange={e => handleChange('standard_utility_fee', e.target.value)}
              className="w-full pl-7 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Insurance */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Insurance Required</label>
            <button
              type="button"
              onClick={() => handleChange('insurance_required', !form.insurance_required)}
              className={`w-full p-3 rounded-xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                form.insurance_required
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-100 bg-white text-slate-400'
              }`}
            >
              {form.insurance_required ? 'Yes — Required' : 'No'}
            </button>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Min Liability Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-3.5 text-slate-400 font-bold text-sm">$</span>
              <input
                type="number"
                min="0"
                value={form.min_liability_amount}
                onChange={e => handleChange('min_liability_amount', e.target.value)}
                className="w-full pl-7 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 text-slate-500 hover:bg-slate-50 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
