'use client'

import { useState, useEffect } from 'react'
import {
  Save, Loader2, Receipt, Building2, DollarSign, Calendar, AlertTriangle,
} from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { useAccountsPayable, useGLAccounts, type Bill } from '@/hooks/useAccountsPayable'
import { useVendors } from '@/hooks/useVendors'
import { useProperties } from '@/hooks/useProperties'

type Props = {
  isOpen: boolean
  onClose: () => void
  bill: Bill | null
  onSuccess: () => void
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

const EDITABLE_STATUSES = new Set(['Draft', 'Pending Approval'])

export default function EditBillModal({ isOpen, onClose, bill, onSuccess }: Props) {
  const { updateBill } = useAccountsPayable()
  const { data: glAccounts, isLoading: glLoading } = useGLAccounts()
  const { vendors, loading: vendorsLoading } = useVendors()
  const { properties, loading: propertiesLoading } = useProperties()

  const [form, setForm] = useState({
    vendor_id: '',
    property_id: '',
    invoice_number: '',
    amount: '',
    due_date: '',
    category: '',
    gl_account_id: '',
    description: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && bill) {
      setForm({
        vendor_id: bill.vendor_id ?? '',
        property_id: bill.property_id ?? '',
        invoice_number: bill.invoice_number ?? '',
        amount: bill.amount != null ? String(bill.amount) : '',
        due_date: bill.due_date ?? '',
        category: bill.category ?? '',
        gl_account_id: bill.gl_account_id ?? '',
        description: bill.description ?? '',
        notes: bill.notes ?? '',
      })
      setSubmitting(false)
    }
  }, [isOpen, bill])

  if (!bill) return null

  const isLocked = !EDITABLE_STATUSES.has(bill.status)

  const handleChange = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = async () => {
    if (!form.vendor_id) return toast.error('Please select a vendor')
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      return toast.error('Please enter a valid amount')
    }
    if (!form.due_date) return toast.error('Please set a due date')
    if (!form.category) return toast.error('Please select a category')
    if (!form.description.trim()) return toast.error('Please enter a description')

    setSubmitting(true)
    try {
      await updateBill.mutateAsync({
        id: bill.id,
        updates: {
          vendor_id: form.vendor_id,
          property_id: form.property_id || null,
          invoice_number: form.invoice_number.trim() || null,
          description: form.description.trim(),
          amount: Number(form.amount),
          due_date: form.due_date,
          category: form.category,
          gl_account_id: form.gl_account_id || null,
          notes: form.notes.trim() || null,
        },
      })
      onSuccess()
    } catch {
      // toast handled in hook
    } finally {
      setSubmitting(false)
    }
  }

  const activeVendors = vendors.filter((v) => !v.do_not_use)
  const isLoading = vendorsLoading || propertiesLoading || glLoading

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Bill"
      subtitle={`${bill.vendor_name ?? 'Vendor'}${bill.invoice_number ? ` · #${bill.invoice_number}` : ''}`}
      size="max-w-2xl"
    >
      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="animate-spin mx-auto text-emerald-500 mb-3" size={28} />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading form data...</p>
        </div>
      ) : (
        <>
          <div className="p-8 space-y-8">
            {isLocked && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-bold">
                  This bill is <strong>{bill.status}</strong> and has been committed to the general ledger.
                  Editing amount or GL account would desync your books. Void this bill and create a new one instead.
                </p>
              </div>
            )}

            {/* Vendor & Property */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <Building2 size={12} /> Vendor & Property
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Vendor <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={form.vendor_id}
                    onChange={(e) => handleChange('vendor_id', e.target.value)}
                    disabled={isLocked}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
                    disabled={isLocked}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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

            {/* Invoice Details */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <Receipt size={12} /> Invoice Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Invoice Number</label>
                  <input
                    type="text"
                    value={form.invoice_number}
                    onChange={(e) => handleChange('invoice_number', e.target.value)}
                    disabled={isLocked}
                    placeholder="e.g. INV-2024-001"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Amount <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-4 text-sm font-black text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => handleChange('amount', e.target.value)}
                      disabled={isLocked}
                      placeholder="0.00"
                      className="w-full p-4 pl-8 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Due Date <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-4 h-4 w-4 text-slate-300 pointer-events-none" />
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={(e) => handleChange('due_date', e.target.value)}
                      disabled={isLocked}
                      className="w-full p-4 pl-10 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Category <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => handleChange('category', e.target.value)}
                    disabled={isLocked}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">Select category...</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Accounting & Description */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] flex items-center gap-2">
                <DollarSign size={12} /> Accounting & Description
              </h3>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">GL Expense Account</label>
                <select
                  value={form.gl_account_id}
                  onChange={(e) => handleChange('gl_account_id', e.target.value)}
                  disabled={isLocked}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">Select GL account...</option>
                  {(glAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  disabled={isLocked}
                  rows={3}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  disabled={isLocked}
                  rows={2}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
            <button
              onClick={onClose}
              className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
            >
              {isLocked ? 'Close' : 'Cancel'}
            </button>
            {!isLocked && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 className="animate-spin w-4 h-4" /> Saving...</>
                ) : (
                  <><Save size={16} /> Save Changes</>
                )}
              </button>
            )}
          </div>
        </>
      )}
    </AccessibleModal>
  )
}
