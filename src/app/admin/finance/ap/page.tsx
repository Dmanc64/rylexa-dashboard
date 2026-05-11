'use client'

import { useState, useMemo } from 'react'
import {
  Receipt, Plus, Search, Filter, Loader2, ArrowLeft,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Ban,
  FileText, ExternalLink, BookOpen, Calendar, Building2,
  ShieldCheck, CreditCard, XCircle, Pencil, Printer, CheckSquare, Square,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useAccountsPayable,
  useAPAging,
  BILL_STATUS_OPTIONS,
  type Bill,
  type BillFilters,
} from '@/hooks/useAccountsPayable'
import { useVendors } from '@/hooks/useVendors'
import NewBillModal from '@/components/NewBillModal'
import PayBillModal from '@/components/PayBillModal'
import EditBillModal from '@/components/EditBillModal'
import PrintCheckModal from '@/components/PrintCheckModal'

// ── Formatting helpers ──

function fmtCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function agingLabel(bucket: string) {
  const map: Record<string, { label: string; color: string }> = {
    current: { label: 'Current', color: 'bg-emerald-50 text-emerald-700' },
    '1_30': { label: '1-30 d', color: 'bg-blue-50 text-blue-700' },
    '31_60': { label: '31-60 d', color: 'bg-amber-50 text-amber-700' },
    '61_90': { label: '61-90 d', color: 'bg-orange-50 text-orange-700' },
    '90_plus': { label: '90+ d', color: 'bg-red-50 text-red-700' },
  }
  return map[bucket] || { label: bucket, color: 'bg-slate-50 text-slate-600' }
}

function statusBadge(status: string) {
  const opt = BILL_STATUS_OPTIONS.find((o) => o.value === status)
  return opt ? opt.color : 'bg-slate-100 text-slate-600'
}

// ────────────────────────────────────────────

export default function AccountsPayablePage() {
  const { isEnabled } = useFeatureFlags()
  const apEnabled = isEnabled('accounts_payable')

  // ── Filters ──
  const [filterStatus, setFilterStatus] = useState('')
  const [filterVendor, setFilterVendor] = useState('')
  const [search, setSearch] = useState('')

  const filters: BillFilters = {
    status: filterStatus || undefined,
    vendor_id: filterVendor || undefined,
  }

  const { bills, loading, approveBill, voidBill } = useAccountsPayable(filters)
  const { summary, loading: agingLoading } = useAPAging()
  const { vendors } = useVendors()

  // ── Selected bill ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = bills.find((b) => b.id === selectedId) || null

  // ── Modals ──
  const [isNewOpen, setIsNewOpen] = useState(false)
  const [isPayOpen, setIsPayOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isPrintCheckOpen, setIsPrintCheckOpen] = useState(false)
  const [printCheckBills, setPrintCheckBills] = useState<Bill[]>([])
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set())

  const toggleBatch = (id: string) => {
    setBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearBatch = () => setBatchIds(new Set())

  const openPrintCheck = (billsForCheck: Bill[]) => {
    if (billsForCheck.length === 0) return
    const firstVendor = billsForCheck[0].vendor_id
    if (!billsForCheck.every((b) => b.vendor_id === firstVendor)) {
      toast.error('All selected bills must be the same vendor')
      return
    }
    if (!billsForCheck.every((b) => b.status === 'Approved')) {
      toast.error('Only Approved bills can be paid by check')
      return
    }
    setPrintCheckBills(billsForCheck)
    setIsPrintCheckOpen(true)
  }

  const batchBills = bills.filter((b) => batchIds.has(b.id))
  const batchVendorIds = new Set(batchBills.map((b) => b.vendor_id))
  const batchSameVendor = batchVendorIds.size <= 1
  const batchTotal = batchBills.reduce((s, b) => s + Number(b.amount), 0)

  // ── Client-side search filter ──
  const filteredBills = useMemo(() => {
    if (!search.trim()) return bills
    const q = search.toLowerCase()
    return bills.filter(
      (b) =>
        (b.vendor_name || '').toLowerCase().includes(q) ||
        (b.invoice_number || '').toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q)
    )
  }, [bills, search])

  // ── Feature flag gate ──
  if (!apEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <Receipt size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-black text-slate-900 italic">Accounts Payable</h2>
          <p className="text-slate-500 text-sm mt-2">
            This feature is not enabled. Enable the <strong>accounts_payable</strong> flag in Settings to activate.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 animate-in fade-in">

      {/* HEADER */}
      <div className="bg-white border-b border-slate-200 px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-end gap-4">
          <div>
            <Link
              href="/admin/finance"
              className="text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-emerald-600 transition-colors flex items-center gap-1 mb-3"
            >
              <ArrowLeft size={14} /> Finance Dashboard
            </Link>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Accounts <span className="text-emerald-600">Payable</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {filteredBills.length} Bill{filteredBills.length !== 1 ? 's' : ''} &bull; Vendor Invoice Management
            </p>
          </div>
          <button
            onClick={() => setIsNewOpen(true)}
            className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg hover:-translate-y-1"
          >
            <Plus size={16} /> New Bill
          </button>
        </div>
      </div>

      {/* AGING SUMMARY CARDS */}
      <div className="px-6 md:px-10 pt-6">
        <div className="max-w-[1600px] mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {agingLoading ? (
            <div className="col-span-full py-8 text-center">
              <Loader2 className="animate-spin mx-auto text-emerald-500" size={24} />
            </div>
          ) : (
            <>
              <AgingCard icon={DollarSign} label="Total Outstanding" value={fmtCurrency(summary.total_outstanding)} color="text-slate-900" bg="bg-white" />
              <AgingCard icon={CheckCircle2} label="Current" value={fmtCurrency(summary.current)} color="text-emerald-600" bg="bg-emerald-50" />
              <AgingCard icon={Clock} label="1-30 Days" value={fmtCurrency(summary['1_30'])} color="text-blue-600" bg="bg-blue-50" />
              <AgingCard icon={AlertTriangle} label="31-60 Days" value={fmtCurrency(summary['31_60'])} color="text-amber-600" bg="bg-amber-50" />
              <AgingCard icon={AlertTriangle} label="61-90 Days" value={fmtCurrency(summary['61_90'])} color="text-orange-600" bg="bg-orange-50" />
              <AgingCard icon={Ban} label="90+ Days" value={fmtCurrency(summary['90_plus'])} color="text-red-600" bg="bg-red-50" />
            </>
          )}
        </div>
      </div>

      {/* CONTROLS BAR */}
      <div className="px-6 md:px-10 pt-6">
        <div className="max-w-[1600px] mx-auto bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2">
          <div className="relative min-w-[180px]">
            <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Statuses</option>
              {BILL_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="relative min-w-[200px]">
            <Building2 className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={filterVendor}
              onChange={(e) => setFilterVendor(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Vendors</option>
              {vendors
                .filter((v) => !v.do_not_use)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.company_name || v.contact_name || 'Unnamed'}
                  </option>
                ))}
            </select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor, invoice #, or description..."
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex gap-6" style={{ minHeight: 'calc(100vh - 420px)' }}>

          {/* LEFT: BILL LIST */}
          <div className="w-full md:w-[400px] shrink-0 space-y-3 overflow-y-auto max-h-[calc(100vh-420px)] pr-2">
            {/* Batch action bar — shows when Approved bills are multi-selected */}
            {batchIds.size > 0 && (
              <div className={`sticky top-0 z-20 p-3 rounded-2xl border shadow-lg flex items-center gap-3 ${
                batchSameVendor
                  ? 'bg-emerald-50 border-emerald-300'
                  : 'bg-red-50 border-red-300'
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-slate-900">
                    {batchIds.size} selected · {fmtCurrency(batchTotal)}
                  </p>
                  {!batchSameVendor && (
                    <p className="text-[10px] font-bold text-red-700">
                      Different vendors — deselect to fix
                    </p>
                  )}
                </div>
                <button
                  onClick={() => openPrintCheck(batchBills)}
                  disabled={!batchSameVendor}
                  className="px-3 py-2 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-emerald-600 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Printer size={12} /> Batch Check
                </button>
                <button
                  onClick={clearBatch}
                  className="p-2 text-slate-400 hover:text-slate-900 transition-colors"
                  title="Clear selection"
                >
                  <XCircle size={14} />
                </button>
              </div>
            )}
            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="animate-spin mx-auto text-emerald-600 mb-4" size={32} />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Bills...</p>
              </div>
            ) : filteredBills.length === 0 ? (
              <div className="py-20 text-center">
                <Receipt size={48} className="text-slate-300 mx-auto mb-4" />
                <p className="text-slate-400 font-bold text-sm">
                  {search || filterStatus || filterVendor ? 'No bills match your filters' : 'No bills yet'}
                </p>
                {!search && !filterStatus && !filterVendor && (
                  <p className="text-slate-400 text-xs mt-1">Create your first bill to get started.</p>
                )}
              </div>
            ) : (
              filteredBills.map((bill) => {
                const isActive = selectedId === bill.id
                const isBatchable = bill.status === 'Approved'
                const isChecked = batchIds.has(bill.id)
                return (
                  <div
                    key={bill.id}
                    className={`
                      relative rounded-2xl border transition-all
                      ${isActive
                        ? 'bg-emerald-50 border-emerald-300 shadow-lg shadow-emerald-900/5'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }
                    `}
                  >
                    {isBatchable && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleBatch(bill.id) }}
                        aria-label={isChecked ? 'Deselect from batch' : 'Select for batch'}
                        className="absolute top-3 right-3 z-10 p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                      >
                        {isChecked ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(bill.id)}
                      className="w-full text-left p-4"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2 pr-6">
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${statusBadge(bill.status)}`}>
                          {bill.status}
                        </span>
                        {bill.status !== 'Paid' && bill.status !== 'Void' && (
                          <AgingBucketBadge dueDate={bill.due_date} />
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {bill.vendor_name || 'Unknown Vendor'}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 truncate">
                        {bill.invoice_number ? `INV #${bill.invoice_number}` : bill.description}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-lg font-black text-slate-900">
                          {fmtCurrency(bill.amount)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          Due {fmtDate(bill.due_date)}
                        </span>
                      </div>
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* RIGHT: DETAIL PANEL */}
          <div className="flex-1 min-w-0 hidden md:block">
            {!selected ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Receipt size={64} className="text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-400 font-bold text-sm">Select a bill to view details</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm max-h-[calc(100vh-420px)] overflow-y-auto">

                {/* Detail Header */}
                <div className="bg-slate-50 border-b border-slate-200 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-black text-slate-900">
                          {selected.vendor_name || 'Unknown Vendor'}
                        </h2>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${statusBadge(selected.status)}`}>
                          {selected.status}
                        </span>
                      </div>
                      {selected.invoice_number && (
                        <p className="text-xs font-bold text-slate-400">
                          Invoice #{selected.invoice_number}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400 font-bold flex-wrap">
                        {selected.property_name && (
                          <span>
                            Property: <span className="text-slate-600">{selected.property_name}</span>
                          </span>
                        )}
                        <span>
                          Created: <span className="text-slate-600">{fmtDate(selected.created_at.split('T')[0])}</span>
                        </span>
                        <span>
                          Due: <span className="text-slate-600">{fmtDate(selected.due_date)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-3xl font-black text-slate-900">{fmtCurrency(selected.amount)}</p>
                    </div>
                  </div>
                </div>

                {/* Bill Details Body */}
                <div className="p-6 space-y-6">

                  {/* Description & Category */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        Description
                      </label>
                      <p className="text-sm text-slate-700 font-medium">
                        {selected.description || <span className="text-slate-300 italic">No description</span>}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        Category
                      </label>
                      <p className="text-sm text-slate-700 font-medium">{selected.category || '---'}</p>
                    </div>
                  </div>

                  {/* GL Account & Notes */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        GL Account
                      </label>
                      <p className="text-sm text-slate-700 font-medium">
                        {selected.gl_account_name || <span className="text-slate-300 italic">Not assigned</span>}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        Notes
                      </label>
                      <p className="text-sm text-slate-700 font-medium">
                        {selected.notes || <span className="text-slate-300 italic">No notes</span>}
                      </p>
                    </div>
                  </div>

                  {/* File Link */}
                  {selected.file_url && (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                        Attached File
                      </label>
                      <a
                        href={selected.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 transition-all"
                      >
                        <FileText size={14} />
                        {selected.file_name || 'View File'}
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  )}

                  {/* Approval & Payment Info */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      <BookOpen size={12} /> Audit Trail
                    </label>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 font-bold">Approved By:</span>{' '}
                        <span className="text-slate-700 font-medium">
                          {selected.approved_by || <span className="text-slate-300">---</span>}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Approved At:</span>{' '}
                        <span className="text-slate-700 font-medium">
                          {selected.approved_at
                            ? new Date(selected.approved_at).toLocaleDateString()
                            : <span className="text-slate-300">---</span>}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Paid At:</span>{' '}
                        <span className="text-slate-700 font-medium">
                          {selected.paid_at
                            ? new Date(selected.paid_at).toLocaleDateString()
                            : <span className="text-slate-300">---</span>}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 font-bold">Payment Ref:</span>{' '}
                        <span className="text-slate-700 font-medium">
                          {selected.paid_reference || <span className="text-slate-300">---</span>}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* GL Posting Status */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GL Status:</span>
                    {selected.ledger_committed ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 size={12} /> Committed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 border border-slate-200">
                        <Clock size={12} /> Pending
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Bar */}
                <div className="px-6 pb-6 flex flex-wrap gap-2">
                  {/* Edit Button — only for Draft / Pending Approval (pre-ledger-commit) */}
                  {(selected.status === 'Draft' || selected.status === 'Pending Approval') && (
                    <button
                      onClick={() => setIsEditOpen(true)}
                      className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-1.5"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                  )}

                  {/* Approve Button */}
                  {selected.status === 'Pending Approval' && (
                    <button
                      onClick={() => {
                        approveBill.mutate(selected.id)
                      }}
                      disabled={approveBill.isPending}
                      className="px-5 py-2.5 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-1.5 shadow-lg disabled:opacity-50"
                    >
                      {approveBill.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={14} />
                      )}
                      Approve Bill
                    </button>
                  )}

                  {/* Pay Button */}
                  {selected.status === 'Approved' && (
                    <button
                      onClick={() => setIsPayOpen(true)}
                      className="px-5 py-2.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-1.5 shadow-lg"
                    >
                      <CreditCard size={14} /> Record Payment
                    </button>
                  )}

                  {/* Pay by Check */}
                  {selected.status === 'Approved' && (
                    <button
                      onClick={() => openPrintCheck([selected])}
                      className="px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-emerald-50 transition-all flex items-center gap-1.5"
                    >
                      <Printer size={14} /> Pay by Check
                    </button>
                  )}

                  {/* Void Button */}
                  {selected.status !== 'Void' && selected.status !== 'Paid' && (
                    <button
                      onClick={() => {
                        if (!window.confirm('Are you sure you want to void this bill? This cannot be undone.')) return
                        voidBill.mutate(selected.id)
                      }}
                      disabled={voidBill.isPending}
                      className="px-5 py-2.5 bg-white border border-red-200 text-red-600 font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-red-50 transition-all flex items-center gap-1.5 ml-auto disabled:opacity-50"
                    >
                      {voidBill.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <XCircle size={14} />
                      )}
                      Void Bill
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODALS */}
      <NewBillModal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onSuccess={(newId) => {
          setIsNewOpen(false)
          setSelectedId(newId)
        }}
      />

      {selected && (
        <PayBillModal
          isOpen={isPayOpen}
          onClose={() => setIsPayOpen(false)}
          bill={selected}
          onSuccess={() => {
            setIsPayOpen(false)
          }}
        />
      )}

      <EditBillModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        bill={selected}
        onSuccess={() => setIsEditOpen(false)}
      />

      <PrintCheckModal
        isOpen={isPrintCheckOpen}
        onClose={() => setIsPrintCheckOpen(false)}
        bills={printCheckBills}
        onSuccess={() => {
          setIsPrintCheckOpen(false)
          clearBatch()
        }}
      />
    </div>
  )
}

// ── Aging Summary Card ──
function AgingCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: any
  label: string
  value: string
  color: string
  bg: string
}) {
  return (
    <div className={`${bg} border border-slate-200 rounded-2xl p-5 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-2xl font-black italic ${color}`}>{value}</p>
    </div>
  )
}

// ── Aging Bucket Badge (computed from due_date) ──
function AgingBucketBadge({ dueDate }: { dueDate: string }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))

  let bucket: string
  if (diff <= 0) bucket = 'current'
  else if (diff <= 30) bucket = '1_30'
  else if (diff <= 60) bucket = '31_60'
  else if (diff <= 90) bucket = '61_90'
  else bucket = '90_plus'

  const { label, color } = agingLabel(bucket)

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${color}`}>
      {label}
    </span>
  )
}
