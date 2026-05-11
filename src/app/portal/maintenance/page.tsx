'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  Wrench, AlertTriangle, CheckCircle2,
  ArrowLeft, Loader2, Camera,
  MessageSquare, Info, X
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const MAX_FILES = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

export default function TenantRepairRequest() {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form State
  const [category, setCategory] = useState('General')
  const [urgency, setUrgency] = useState('Low')
  const [description, setDescription] = useState('')
  const [permission, setPermission] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Clean up all blob URLs on unmount
  useEffect(() => {
    return () => {
      photoUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [photoUrls])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles: File[] = []

    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`${file.name}: Unsupported format. Use JPEG, PNG, or WebP.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: File too large. Maximum 10MB.`)
        continue
      }
      validFiles.push(file)
    }

    const total = photos.length + validFiles.length
    if (total > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} photos allowed.`)
      validFiles.splice(MAX_FILES - photos.length)
    }

    // Create blob URLs for new files
    const newUrls = validFiles.map(f => URL.createObjectURL(f))
    setPhotos(prev => [...prev, ...validFiles])
    setPhotoUrls(prev => [...prev, ...newUrls])
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoUrls[index])
    setPhotos(prev => prev.filter((_, i) => i !== index))
    setPhotoUrls(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Session expired. Please log in again.")

      // Look up tenant + unit via the lease FK chain
      const { data: lease } = await supabase
        .from('leases')
        .select('id, tenant_id, unit_id')
        .eq('user_id', user.id)
        .eq('status', 'Active')
        .limit(1)
        .maybeSingle()

      // Insert work order
      const { data: workOrder, error: insertError } = await supabase
        .from('work_orders')
        .insert({
          title: `${category} Repair Request`,
          description: `${description}${permission ? '\n[Permission to enter if not home]' : ''}`,
          status: 'Open',
          priority: urgency === 'High' ? 'High' : urgency === 'Medium' ? 'Medium' : 'Low',
          unit_id: lease?.unit_id || null,
          tenant_id: lease?.tenant_id || null,
          requester_id: user.id,
        })
        .select('id')
        .single()

      if (insertError) throw insertError

      // Upload photos if any
      if (photos.length > 0 && workOrder) {
        setUploadingPhotos(true)

        for (const file of photos) {
          const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
          const uniqueId = crypto.randomUUID()
          const filePath = `${workOrder.id}/${uniqueId}.${ext}`

          const { error: uploadErr } = await supabase.storage
            .from('maintenance-images')
            .upload(filePath, file, { contentType: file.type })

          if (uploadErr) {
            console.error('Photo upload failed:', uploadErr.message)
            continue
          }

          await supabase.from('work_order_images').insert({
            work_order_id: workOrder.id,
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            uploaded_by: user.id,
          })
        }

        setUploadingPhotos(false)
      }

      setSuccess(true)
      setDescription('')
      photoUrls.forEach(url => URL.revokeObjectURL(url))
      setPhotos([])
      setPhotoUrls([])
    } catch (err: any) {
      setError(err.message || "Failed to submit request.")
    } finally {
      setLoading(false)
      setUploadingPhotos(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">

      {/* MINIMALIST HEADER */}
      <header className="flex items-center gap-4">
        <Link href="/portal" className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-black italic text-slate-900 uppercase tracking-tighter">Repair Request</h1>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Resident Support</p>
        </div>
      </header>

      {/* EMERGENCY DISCLAIMER */}
      <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex items-start gap-4 shadow-xl shadow-slate-200">
        <AlertTriangle className="text-emerald-500 shrink-0" size={24} />
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">Emergency Service</p>
          <p className="text-xs font-medium leading-relaxed opacity-80">
            For fire, flood, or life-threatening emergencies, please call <span className="text-white font-black underline">911</span> immediately.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* CATEGORY SELECTION */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Issue Category</label>
          <div className="grid grid-cols-3 gap-3">
            {['Plumbing', 'Electrical', 'General'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                  category === cat
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* URGENCY */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Urgency Level</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'Low', label: 'Low', color: 'border-slate-500 bg-slate-50 text-slate-700' },
              { key: 'Medium', label: 'Medium', color: 'border-amber-500 bg-amber-50 text-amber-700' },
              { key: 'High', label: 'Urgent', color: 'border-red-500 bg-red-50 text-red-700' },
            ].map(u => (
              <button
                key={u.key}
                type="button"
                onClick={() => setUrgency(u.key)}
                className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                  urgency === u.key ? u.color : 'border-slate-100 bg-white text-slate-400 hover:border-slate-200'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* DESCRIPTION */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">What is happening?</label>
          <div className="relative">
            <MessageSquare className="absolute left-5 top-6 text-slate-300" size={18} />
            <textarea
              required
              rows={5}
              placeholder="Describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full pl-12 pr-6 py-6 bg-white border-2 border-slate-100 rounded-[2.5rem] font-bold text-slate-900 focus:border-emerald-500 outline-none transition-all resize-none shadow-sm"
            />
          </div>
        </div>

        {/* PHOTO UPLOAD */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">
            Photos <span className="text-slate-300">({photos.length}/{MAX_FILES})</span>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Photo Previews */}
          {photos.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              {photos.map((photo, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-slate-200 group">
                  <img
                    src={photoUrls[idx]}
                    alt={photo.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload Area */}
          {photos.length < MAX_FILES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] p-8 text-center space-y-2 group hover:bg-white hover:border-emerald-300 transition-all cursor-pointer"
            >
              <Camera className="mx-auto text-slate-300 group-hover:text-emerald-500 transition-colors" size={32} />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Tap to Upload Photos
              </p>
              <p className="text-[9px] text-slate-300">JPEG, PNG, WebP — Max 10MB each</p>
            </button>
          )}
        </div>

        {/* PERMISSION TO ENTER */}
        <div
          onClick={() => setPermission(!permission)}
          className="flex items-center gap-4 p-5 bg-white border-2 border-slate-100 rounded-2xl cursor-pointer hover:border-emerald-200 transition-all"
        >
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${
            permission ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200'
          }`}>
            {permission && <CheckCircle2 size={14} />}
          </div>
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Permission to enter if not home</p>
        </div>

        {/* SUBMIT */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-6 bg-slate-900 text-white font-black rounded-[2.5rem] shadow-2xl hover:bg-emerald-600 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Wrench size={20} />}
          {loading ? (uploadingPhotos ? 'UPLOADING PHOTOS...' : 'SENDING...') : 'SUBMIT REQUEST'}
        </button>

        {success && (
          <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-[2rem] flex flex-col items-center gap-2 text-emerald-700 animate-in zoom-in text-center">
            <CheckCircle2 size={32} />
            <p className="font-black text-sm uppercase italic tracking-tighter leading-none">Request Received</p>
            <p className="text-[10px] font-bold opacity-75">Management has been notified of the issue.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 p-6 rounded-[2rem] flex items-center gap-4 text-red-700">
            <Info size={24} />
            <p className="font-bold text-sm italic">{error}</p>
          </div>
        )}
      </form>
    </div>
  )
}
