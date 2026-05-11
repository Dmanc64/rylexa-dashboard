'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Printer, Loader2, Landmark, Receipt, AlertTriangle,
  CheckCircle2, ExternalLink, Calendar,
} from 'lucide-react'
import Link from 'next/link'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'
import { useBankAccounts } from '@/hooks/useBankAccounts'
import { useChecks } from '@/hooks/useChecks'
import type { Bill } from '@/hooks/useAccountsPayable'

type Props = {
  isOpen: boolean
  onClose: () => void
  /** Approved bills all belonging to the same vendor. */
  bills: Bill[]
  onSuccess?: () => void
}

const USD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function PrintCheckModal({ isOpen, onClose, bills, onSuccess }: Props) {
  const { accounts, loading: banksLoading } = useBankAccounts(true)
  const { generateCheck } = useChecks()

  const [bankAccountId, setBankAccountId] = useState('')
  const [checkDate, setCheckDate] = useState(todayIso())
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Seed memo from bills and auto-select sole bank account on open.
  useEffect(() => {
    if (!isOpen) return
    setCheckDate(todayIso())
    const invoiceRefs = bills
      .map((b) => (b.invoice_number ? `#${b.invoice_number}` : b.id.slice(0, 8)))
      .join(', ')
    setMemo(`Payment for invoice${bills.length > 1 ? 's' : ''}: ${invoiceRefs}`.slice(0, 200))
    if (accounts.length === 1) setBankAccountId(accounts[0].id)
  }, [isOpen, bills, accounts])

  const vendorName = bills[0]?.vendor_name ?? 'Unknown vendor'
  const totalAmount = useMemo(
    () => bills.reduce((sum, b) => sum + Number(b.amount), 0),
    [bills],
  )
  const selectedBank = accounts.find((a) => a.id === bankAccountId) ?? null
  const sameVendor = bills.every((b) => b.vendor_id === bills[0]?.vendor_id)
  const allApproved = bills.every((b) => b.status === 'Approved')

  const canSubmit =
    !submitting &&
    bills.length > 0 &&
    sameVendor &&
    allApproved &&
    !!bankAccountId &&
    !!selectedBank?.gl_cash_account_id

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await generateCheck.mutateAsync({
        bill_ids: bills.map((b) => b.id),
        bank_account_id: bankAccountId,
        memo: memo.trim() || undefined,
        check_date: checkDate,
      })
      // Open the PDF in a new tab so the user can print immediately.
      window.open(result.pdf_url, '_blank', 'noopener,noreferrer')
      onSuccess?.()
      onClose()
    } catch {
      // toast handled in hook
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={bills.length > 1 ? 'Print Check (Batch)' : 'Print Check'}
      subtitle={`${vendorName} · ${USD(totalAmount)} · ${bills.length} invoice${bills.length > 1 ? 's' : ''}`}
      size="max-w-2xl"
    >
      <div className="p-8 space-y-6">
        {/* Guardrails */}
        {!sameVendor && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 font-bold">
              Selected bills belong to different vendors. Each check must be one vendor — close and re-select.
            </p>
          </div>
        )}
        {!allApproved && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 font-bold">
              One or more selected bills are not yet Approved.
            </p>
          </div>
        )}
        {accounts.length === 0 && !banksLoading && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-amber-900 font-bold">
              <p className="mb-1">No bank accounts configured.</p>
              <Link
                href="/admin/finance/bank-accounts"
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
              >
                Create one <ExternalLink size={10} />
              </Link>
            </div>
          </div>
        )}

        {/* Bank account */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
            <Landmark size={10} /> Pay From <span className="text-red-400">*</span>
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            disabled={banksLoading || accounts.length === 0}
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer disabled:opacity-60"
          >
            <option value="">Select bank account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · Next check #{a.next_check_number}
              </option>
            ))}
          </select>
          {selectedBank && !selectedBank.gl_cash_account_id && (
            <p className="text-[11px] text-red-600 font-bold ml-1">
              This bank account has no GL cash account set. Edit it before printing.
            </p>
          )}
        </div>

        {/* Check date + memo */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
              <Calendar size={10} /> Check Date
            </label>
            <input
              type="date"
              value={checkDate}
              onChange={(e) => setCheckDate(e.target.value)}
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Memo</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={200}
              placeholder="Optional"
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>
        </div>

        {/* Bills summary */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
            <Receipt size={10} /> Invoices on this check
          </h3>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
            {bills.map((b) => (
              <div key={b.id} className="flex items-center justify-between p-4 bg-white">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {b.invoice_number ? `#${b.invoice_number}` : b.id.slice(0, 8)}
                    <span className="text-slate-400 font-medium"> · {b.description}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold">Due {b.due_date}</p>
                </div>
                <p className="text-sm font-black text-slate-900 tabular-nums">{USD(Number(b.amount))}</p>
              </div>
            ))}
            <div className="flex items-center justify-between p-4 bg-slate-50">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</p>
              <p className="text-base font-black text-emerald-600 tabular-nums">{USD(totalAmount)}</p>
            </div>
          </div>
        </div>

        {/* MICR reminder */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 font-bold">
            After printing, verify the MICR line is centered correctly on the check stock before mailing.
            The PDF opens in a new tab — use your browser&apos;s print dialog.
          </p>
        </div>
      </div>

      <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
        <button
          onClick={onClose}
          className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <><Loader2 className="animate-spin w-4 h-4" /> Generating...</>
          ) : (
            <><Printer size={16} /> Generate & Print</>
          )}
        </button>
      </div>
    </AccessibleModal>
  )
}
