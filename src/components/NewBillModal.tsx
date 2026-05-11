'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Save, Loader2, Receipt, Building2, FileText,
  DollarSign, Calendar, Upload, X, AlertTriangle, Sparkles, CheckCircle2,
} from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { useAccountsPayable } from '@/hooks/useAccountsPayable'
import { useGLAccounts } from '@/hooks/useAccountsPayable'
import { useVendors } from '@/hooks/useVendors'
import { useProperties } from '@/hooks/useProperties'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newBillId: string) => void
}

const CATEGORIES = [
  'Maintenance & Repairs',
  'Utilities',
  'Insurance',
  'Property Tax',
  'Management Fees',
  'Landscaping',
  'Cleaning',
  'Legal & Professional',
  'Supplies',
  'Capital Improvements',
  'Other',
]

type LineItem = {
  description?: string
  quantity?: number | null
  unit_price?: number | null
  amount?: number
}

type OcrPayload = {
  vendor_name?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  due_date?: string | null
  amount?: number | null
  currency?: string | null
  line_items?: LineItem[]
  suggested_category?: string | null
  summary?: string | null
  confidence?: number | null
  model?: string
  file_path?: string
  bucket?: string
}

// Bills default to today's creation date for Due Date. The user can overwrite
// from the invoice's stated due date or the AI scan — this just avoids an
// empty required field on the happy path.
const todayIso = () => new Date().toISOString().slice(0, 10)

const makeEmptyForm = () => ({
  vendor_id: '',
  property_id: '',
  invoice_number: '',
  amount: '',
  due_date: todayIso(),
  category: '',
  gl_account_id: '',
  description: '',
  notes: '',
})

const emptyForm = makeEmptyForm()

type FilledByAi = Partial<Record<keyof typeof emptyForm, boolean>>

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export default function NewBillModal({ isOpen, onClose, onSuccess }: Props) {
  const { createBill } = useAccountsPayable()
  const { data: glAccounts, isLoading: glLoading } = useGLAccounts()
  const { vendors, loading: vendorsLoading } = useVendors()
  const { properties, loading: propertiesLoading } = useProperties()

  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [ocr, setOcr] = useState<OcrPayload | null>(null)
  const [ocrStoragePath, setOcrStoragePath] = useState<string | null>(null)
  const [filledByAi, setFilledByAi] = useState<FilledByAi>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(makeEmptyForm())
      setFile(null)
      setUploading(false)
      setSubmitting(false)
      setScanning(false)
      setOcr(null)
      setOcrStoragePath(null)
      setFilledByAi({})
    }
  }, [isOpen])

  const handleChange = (field: keyof typeof emptyForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // Once the user edits an AI-filled field, stop marking it as AI-filled.
    setFilledByAi((prev) => (prev[field] ? { ...prev, [field]: false } : prev))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(f.type)) {
      toast.error('Only PDF, JPEG, PNG, and WebP files are supported')
      return
    }

    if (f.size > 10 * 1024 * 1024) {
      toast.error('File size must be under 10MB')
      return
    }

    setFile(f)
    // Replacing the file invalidates any prior scan.
    setOcr(null)
    setOcrStoragePath(null)
  }

  const handleRemoveFile = () => {
    setFile(null)
    setOcr(null)
    setOcrStoragePath(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const fuzzyMatchVendorId = (vendorName: string | null | undefined): string | null => {
    if (!vendorName) return null
    const target = normalize(vendorName)
    if (!target) return null

    const active = vendors.filter((v) => !v.do_not_use)
    // Exact normalized match on company_name or contact_name.
    const exact = active.find((v) => {
      const cn = normalize(v.company_name || '')
      const co = normalize(v.contact_name || '')
      return (cn && cn === target) || (co && co === target)
    })
    if (exact) return exact.id

    // Substring match either direction.
    const partial = active.find((v) => {
      const cn = normalize(v.company_name || '')
      const co = normalize(v.contact_name || '')
      return (
        (cn && (cn.includes(target) || target.includes(cn))) ||
        (co && (co.includes(target) || target.includes(co)))
      )
    })
    return partial?.id ?? null
  }

  const handleScan = async () => {
    if (!file) return
    setScanning(true)

    // Upload to storage first so the edge function can read it. Reuse the
    // same path for the final bill record so we don't double-upload.
    let storagePath = ocrStoragePath
    try {
      if (!storagePath) {
        const ext = file.name.split('.').pop() || 'pdf'
        storagePath = `bills/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, file, {
            contentType: file.type,
            upsert: false,
          })

        if (uploadError) {
          toast.error('Upload for AI scan failed: ' + uploadError.message)
          setScanning(false)
          return
        }
        setOcrStoragePath(storagePath)
      }

      const { data, error } = await supabase.functions.invoke('analyze-bill', {
        body: { file_path: storagePath, bucket: 'documents' },
      })

      if (error || (data as { error?: string })?.error) {
        const msg = error?.message || (data as { error?: string })?.error || 'AI scan failed'
        toast.error(msg)
        setScanning(false)
        return
      }

      const extracted = data as OcrPayload
      setOcr(extracted)

      // Pre-fill any form fields that are currently empty. Don't clobber
      // values the user has already typed.
      const next = { ...form }
      const filled: FilledByAi = {}

      const vendorId = fuzzyMatchVendorId(extracted.vendor_name)
      if (!next.vendor_id && vendorId) {
        next.vendor_id = vendorId
        filled.vendor_id = true
      }
      if (!next.invoice_number && extracted.invoice_number) {
        next.invoice_number = extracted.invoice_number
        filled.invoice_number = true
      }
      if (!next.amount && typeof extracted.amount === 'number') {
        next.amount = String(extracted.amount)
        filled.amount = true
      }
      if (!next.due_date && extracted.due_date) {
        next.due_date = extracted.due_date
        filled.due_date = true
      }
      if (
        !next.category &&
        extracted.suggested_category &&
        CATEGORIES.includes(extracted.suggested_category)
      ) {
        next.category = extracted.suggested_category
        filled.category = true
      }
      if (!next.description && extracted.summary) {
        const lines = (extracted.line_items ?? [])
          .map((li) => {
            const desc = (li.description || '').trim()
            if (!desc) return null
            return typeof li.amount === 'number' ? `- ${desc} ($${li.amount.toFixed(2)})` : `- ${desc}`
          })
          .filter(Boolean) as string[]
        next.description = lines.length
          ? `${extracted.summary}\n\n${lines.join('\n')}`
          : extracted.summary
        filled.description = true
      }

      setForm(next)
      setFilledByAi(filled)

      if (!vendorId && extracted.vendor_name) {
        toast.warning(
          `Couldn't match "${extracted.vendor_name}" to an existing vendor. Please select manually.`
        )
      } else {
        toast.success('Invoice scanned — review the pre-filled fields below.')
      }
    } catch (err) {
      toast.error('AI scan failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
    }
  }

  const handleSubmit = async () => {
    if (!form.vendor_id) {
      toast.error('Please select a vendor')
      return
    }
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    if (!form.due_date) {
      toast.error('Please set a due date')
      return
    }
    if (!form.category) {
      toast.error('Please select a category')
      return
    }
    if (!form.description.trim()) {
      toast.error('Please enter a description')
      return
    }

    setSubmitting(true)

    try {
      let fileUrl: string | null = null
      let fileName: string | null = null
      let storagePath: string | null = ocrStoragePath

      if (file) {
        // If the user already ran the scan, the file is uploaded — reuse it.
        if (!storagePath) {
          setUploading(true)
          const ext = file.name.split('.').pop() || 'pdf'
          storagePath = `bills/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(storagePath, file, {
              contentType: file.type,
              upsert: false,
            })

          if (uploadError) {
            toast.error('File upload failed: ' + uploadError.message)
            setSubmitting(false)
            setUploading(false)
            return
          }
          setUploading(false)
        }

        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(storagePath!)

        fileUrl = urlData.publicUrl
        fileName = file.name
      }

      const hasOcr = ocr !== null
      const ocrReviewed = hasOcr && Object.values(filledByAi).every((v) => v === false)

      const newId = await createBill.mutateAsync({
        vendor_id: form.vendor_id,
        property_id: form.property_id || null,
        invoice_number: form.invoice_number.trim() || null,
        description: form.description.trim(),
        amount: Number(form.amount),
        due_date: form.due_date,
        category: form.category,
        gl_account_id: form.gl_account_id || null,
        status: 'Pending Approval',
        file_url: fileUrl,
        file_name: fileName,
        notes: form.notes.trim() || null,
        ocr_extracted_fields: hasOcr ? (ocr as unknown as Record<string, unknown>) : null,
        ocr_confidence: ocr?.confidence ?? null,
        ocr_model: ocr?.model ?? null,
        ocr_processed_at: hasOcr ? new Date().toISOString() : null,
        ocr_reviewed: ocrReviewed,
      })

      onSuccess(newId)
    } catch {
      // Error toast is handled by the hook
    } finally {
      setSubmitting(false)
      setUploading(false)
    }
  }

  const activeVendors = useMemo(() => vendors.filter((v) => !v.do_not_use), [vendors])
  const isLoading = vendorsLoading || propertiesLoading || glLoading

  const aiRing = (field: keyof typeof emptyForm) =>
    filledByAi[field]
      ? 'ring-2 ring-violet-300 bg-violet-50/60 border-violet-200'
      : 'bg-slate-50 border-slate-200'

  const confidencePct = typeof ocr?.confidence === 'number'
    ? Math.round(ocr.confidence * 100)
    : null

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="New Bill"
      subtitle="Create a vendor invoice for approval"
      size="max-w-2xl"
    >
      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="animate-spin mx-auto text-emerald-500 mb-3" size={28} />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading form data...</p>
        </div>
      ) : (
        <>
          {/* Scrollable Body */}
          <div className="p-8 space-y-8">

            {/* Section 0: AI Scan (only visible when a file is attached) */}
            {file && (
              <div className="space-y-3 p-4 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-violet-600" />
                    <h3 className="text-[10px] font-black text-violet-700 uppercase tracking-[0.2em]">
                      Smart Bill Entry
                    </h3>
                    {ocr && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-black uppercase tracking-wider">
                        <CheckCircle2 size={10} />
                        Scanned{confidencePct !== null ? ` · ${confidencePct}%` : ''}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleScan}
                    disabled={scanning}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50 transition-all shadow"
                  >
                    {scanning ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Scanning…
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        {ocr ? 'Re-scan' : 'Scan with AI'}
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  {ocr
                    ? 'Fields highlighted below were pre-filled from the invoice. Review and edit before submitting — editing a field clears its AI highlight.'
                    : 'Let AI read the invoice and pre-fill vendor, amount, due date, category, and a description.'}
                </p>
                {ocr?.vendor_name && !form.vendor_id && (
                  <p className="text-[11px] text-amber-700 font-bold">
                    Detected vendor: <span className="font-black">{ocr.vendor_name}</span> — not found in your vendor list.
                  </p>
                )}
              </div>
            )}

            {/* Section 1: Vendor & Property */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <Building2 size={12} /> Vendor & Property
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Vendor <span className="text-red-400">*</span>
                    {filledByAi.vendor_id && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                  </label>
                  <select
                    value={form.vendor_id}
                    onChange={(e) => handleChange('vendor_id', e.target.value)}
                    className={`w-full p-4 ${aiRing('vendor_id')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer`}
                  >
                    <option value="">Select vendor...</option>
                    {activeVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.company_name || v.contact_name || 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Property
                  </label>
                  <select
                    value={form.property_id}
                    onChange={(e) => handleChange('property_id', e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer"
                  >
                    <option value="">All Properties</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Invoice Details */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <Receipt size={12} /> Invoice Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Invoice Number
                    {filledByAi.invoice_number && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                  </label>
                  <input
                    type="text"
                    value={form.invoice_number}
                    onChange={(e) => handleChange('invoice_number', e.target.value)}
                    placeholder="e.g. INV-2024-001"
                    className={`w-full p-4 ${aiRing('invoice_number')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Amount <span className="text-red-400">*</span>
                    {filledByAi.amount && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-sm font-black text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => handleChange('amount', e.target.value)}
                      placeholder="0.00"
                      className={`w-full p-4 pl-8 ${aiRing('amount')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Due Date <span className="text-red-400">*</span>
                    {filledByAi.due_date && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-4 h-4 w-4 text-slate-300 pointer-events-none" />
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={(e) => handleChange('due_date', e.target.value)}
                      className={`w-full p-4 pl-10 ${aiRing('due_date')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all`}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Category <span className="text-red-400">*</span>
                    {filledByAi.category && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => handleChange('category', e.target.value)}
                    className={`w-full p-4 ${aiRing('category')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none cursor-pointer`}
                  >
                    <option value="">Select category...</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: GL Account & Description */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <DollarSign size={12} /> Accounting & Description
              </h3>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  GL Expense Account
                </label>
                <select
                  value={form.gl_account_id}
                  onChange={(e) => handleChange('gl_account_id', e.target.value)}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="">Select GL account...</option>
                  {(glAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Description <span className="text-red-400">*</span>
                  {filledByAi.description && <Sparkles size={10} className="inline ml-1 text-violet-500" />}
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Describe the work performed or goods received..."
                  rows={3}
                  className={`w-full p-4 ${aiRing('description')} border rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Internal notes (optional)..."
                  rows={2}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none"
                />
              </div>
            </div>

            {/* Section 4: File Upload */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <FileText size={12} /> Invoice Attachment
              </h3>
              {file ? (
                <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <FileText size={18} className="text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold">
                      {(file.size / 1024).toFixed(0)} KB &bull; {file.type.split('/')[1]?.toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={handleRemoveFile}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">
                  <Upload size={24} className="text-slate-300 mb-2" />
                  <span className="text-xs font-bold text-slate-500">
                    Drop invoice PDF or image here, or click to browse
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold mt-1">
                    PDF, JPEG, PNG, WebP &bull; Max 10MB
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                  />
                </label>
              )}
            </div>

            {/* Info Banner */}
            <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <AlertTriangle size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 font-bold">
                This bill will be created with <strong>Pending Approval</strong> status. An administrator must approve it before payment can be recorded.
              </p>
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
              disabled={submitting}
              className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Creating...'}
                </>
              ) : (
                <>
                  <Save size={16} /> Create Bill
                </>
              )}
            </button>
          </div>
        </>
      )}
    </AccessibleModal>
  )
}
