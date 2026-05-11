'use client'

import { useState, useEffect } from 'react'
import {
  CreditCard, Loader2, AlertTriangle, DollarSign,
  FileText, Building2, CheckCircle2,
} from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { useAccountsPayable, type Bill } from '@/hooks/useAccountsPayable'

type Props = {
  isOpen: boolean
  onClose: () => void
  bill: Bill
  onSuccess: () => void
}

export default function PayBillModal({ isOpen, onClose, bill, onSuccess }: Props) {
  const { payBill } = useAccountsPayable()
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setReference('')
      setSubmitting(false)
    }
  }, [isOpen])

  const handleConfirm = async () => {
    if (!reference.trim()) {
      toast.error('Please enter a payment reference (check #, ACH ref, etc.)')
      return
    }

    setSubmitting(true)
    try {
      await payBill.mutateAsync({ billId: bill.id, reference: reference.trim() })
      onSuccess()
    } catch {
      // Error toast is handled by the hook
    } finally {
      setSubmitting(false)
    }
  }

  function fmtCurrency(n: number) {
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    })
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Payment"
      subtitle="Mark this bill as paid"
      size="max-w-md"
    >
      <div className="p-8 space-y-6">

        {/* Bill Summary Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <FileText size={12} /> Bill Summary
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={14} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">Vendor</span>
              </div>
              <span className="text-sm font-bold text-slate-900">
                {bill.vendor_name || 'Unknown Vendor'}
              </span>
            </div>

            {bill.invoice_number && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">Invoice #</span>
                </div>
                <span className="text-sm font-bold text-slate-900">{bill.invoice_number}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2">
                <DollarSign size={14} className="text-emerald-500" />
                <span className="text-xs font-bold text-slate-500">Amount</span>
              </div>
              <span className="text-2xl font-black text-slate-900">{fmtCurrency(bill.amount)}</span>
            </div>
          </div>
        </div>

        {/* Payment Reference */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
            Payment Reference <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <CreditCard className="absolute left-4 top-4 h-4 w-4 text-slate-300" />
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, ACH ref, wire ID..."
              className="w-full p-4 pl-10 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              autoFocus
            />
          </div>
          <p className="text-[10px] text-slate-400 font-bold ml-1">
            Enter the check number, ACH reference, wire transfer ID, or other payment identifier.
          </p>
        </div>

        {/* Warning Banner */}
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber-800 font-bold">
              This action will mark the bill as <strong>Paid</strong> and post the corresponding GL entries to your general ledger.
            </p>
            <p className="text-[10px] text-amber-600 font-bold mt-1">
              This cannot be easily undone. Please verify the payment details before confirming.
            </p>
          </div>
        </div>

        {/* GL Posting Indicator */}
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
          <p className="text-[10px] text-emerald-700 font-bold">
            General ledger entries will be committed automatically upon confirmation.
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
          onClick={handleConfirm}
          disabled={submitting || !reference.trim()}
          className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin w-4 h-4" /> Processing...
            </>
          ) : (
            <>
              <CreditCard size={16} /> Confirm Payment
            </>
          )}
        </button>
      </div>
    </AccessibleModal>
  )
}
