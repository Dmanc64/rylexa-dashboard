'use client'

import { useState, useEffect } from 'react'
import {
  FileText, Loader2, Download, Ban, CheckCircle2,
  ChevronDown, ChevronUp, Save, AlertTriangle,
  Building2, Send, Sparkles, ArrowLeft
} from 'lucide-react'
import Link from 'next/link'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useVendorPayments,
  useOwnerDistributions,
  useTaxForms,
  usePayerSettings,
  useTaxFormMutations,
  FILING_THRESHOLD,
  TAX_FORM_STATUS_OPTIONS,
  type PayerSettingsPayload,
  type VendorPaymentSummary,
  type OwnerDistributionSummary,
  type TaxForm1099,
} from '@/hooks/useTaxForms'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'

const currentYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i)

function maskTaxId(taxId: string | null): string {
  if (!taxId) return '—'
  if (taxId.length <= 4) return taxId
  return '***-**-' + taxId.slice(-4)
}

function formatCurrency(amount: number): string {
  return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TaxFormsPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const [selectedYear, setSelectedYear] = useState(currentYear - 1)
  const [activeTab, setActiveTab] = useState<'vendors' | 'owners'>('vendors')
  const [showPayerSettings, setShowPayerSettings] = useState(false)
  const [voidConfirmId, setVoidConfirmId] = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [batchGenerating, setBatchGenerating] = useState(false)

  const { data: vendorPayments, isLoading: loadingVendors } = useVendorPayments(selectedYear)
  const { data: ownerDistributions, isLoading: loadingOwners } = useOwnerDistributions(selectedYear)
  const { data: taxForms, isLoading: loadingForms } = useTaxForms(selectedYear)
  const { data: payerSettings, isLoading: loadingPayer } = usePayerSettings()
  const { generateForm, generateAllForms, voidForm, markSent, downloadForm, updatePayerSettings } = useTaxFormMutations()

  // Payer settings form state
  const [payerForm, setPayerForm] = useState<PayerSettingsPayload>({
    company_name: '',
    tax_id: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
  })
  // Load payer settings into form when data arrives
  useEffect(() => {
    if (payerSettings) {
      setPayerForm({
        company_name: payerSettings.company_name || '',
        tax_id: payerSettings.tax_id || '',
        address_street: payerSettings.address_street || '',
        address_city: payerSettings.address_city || '',
        address_state: payerSettings.address_state || '',
        address_zip: payerSettings.address_zip || '',
        contact_name: payerSettings.contact_name || '',
        contact_phone: payerSettings.contact_phone || '',
        contact_email: payerSettings.contact_email || '',
      })
    }
  }, [payerSettings])

  if (flagsLoading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
  if (!isEnabled('tax_forms')) return <div className="min-h-screen bg-slate-50 p-10"><p className="text-slate-500 font-bold">Tax Forms feature is not enabled.</p></div>

  // Filter eligible recipients
  const eligibleVendors = (vendorPayments ?? []).filter(v => v.is_1099 && v.total_paid >= FILING_THRESHOLD)
  const belowThresholdVendors = (vendorPayments ?? []).filter(v => v.is_1099 && v.total_paid < FILING_THRESHOLD)
  const eligibleOwners = (ownerDistributions ?? []).filter(o => o.total_distributed >= FILING_THRESHOLD)
  const belowThresholdOwners = (ownerDistributions ?? []).filter(o => o.total_distributed < FILING_THRESHOLD)

  // Map forms for quick lookup
  const formMap = new Map<string, TaxForm1099>()
  ;(taxForms ?? []).forEach(f => {
    formMap.set(`${f.recipient_type}-${f.recipient_id}`, f)
  })

  const getFormForRecipient = (type: 'vendor' | 'owner', id: string) => formMap.get(`${type}-${id}`)

  const handleSavePayerSettings = async () => {
    if (!payerForm.company_name.trim() || !payerForm.tax_id.trim()) {
      toast.error('Company name and Tax ID are required')
      return
    }
    await updatePayerSettings.mutateAsync(payerForm)
  }

  const handleGenerate = async (recipientType: 'vendor' | 'owner', recipientId: string) => {
    if (!payerSettings) {
      toast.error('Please configure payer settings first')
      setShowPayerSettings(true)
      return
    }
    setGenerating(recipientId)
    try {
      await generateForm.mutateAsync({
        tax_year: selectedYear,
        form_type: recipientType === 'vendor' ? '1099-NEC' : '1099-MISC',
        recipient_type: recipientType,
        recipient_id: recipientId,
      })
    } finally {
      setGenerating(null)
    }
  }

  const handleGenerateAll = async () => {
    if (!payerSettings) {
      toast.error('Please configure payer settings first')
      setShowPayerSettings(true)
      return
    }
    setBatchGenerating(true)
    try {
      await generateAllForms.mutateAsync({
        tax_year: selectedYear,
        vendors: eligibleVendors.map(v => ({ vendor_id: v.vendor_id })),
        owners: eligibleOwners.map(o => ({ owner_id: o.owner_id })),
      })
    } finally {
      setBatchGenerating(false)
    }
  }

  const handleDownload = async (storagePath: string) => {
    const url = await downloadForm(storagePath)
    if (url) window.open(url, '_blank')
  }

  const handleVoid = async () => {
    if (!voidConfirmId) return
    await voidForm.mutateAsync(voidConfirmId)
    setVoidConfirmId(null)
  }

  const loading = loadingVendors || loadingOwners || loadingForms || loadingPayer

  // Stats
  const totalEligible = eligibleVendors.length + eligibleOwners.length
  const totalGenerated = (taxForms ?? []).filter(f => f.status === 'generated' || f.status === 'sent').length
  const totalSent = (taxForms ?? []).filter(f => f.status === 'sent').length

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <Link href="/admin/finance" className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 flex items-center gap-1 mb-3">
              <ArrowLeft size={12} /> Finance
            </Link>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 bg-rose-600 rounded-lg text-white"><FileText size={16} /></div>
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-600">Year-End Tax Filing</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight italic">1099 Tax Forms</h1>
            <p className="text-slate-500 font-medium uppercase text-xs tracking-widest mt-1">
              {totalEligible} Eligible Recipients &middot; {totalGenerated} Generated &middot; {totalSent} Sent
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold shadow-sm"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={handleGenerateAll}
              disabled={batchGenerating || totalEligible === 0}
              className="px-6 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
            >
              {batchGenerating ? <Loader2 className="animate-spin w-4 h-4" /> : <Sparkles size={14} />}
              Generate All
            </button>
          </div>
        </header>

        {/* Payer Settings Warning */}
        {!loadingPayer && !payerSettings && (
          <div
            onClick={() => setShowPayerSettings(true)}
            className="p-5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 cursor-pointer hover:bg-amber-100 transition-colors"
          >
            <AlertTriangle className="text-amber-600" size={20} />
            <div>
              <p className="text-sm font-bold text-amber-800">Payer Settings Required</p>
              <p className="text-xs text-amber-600">Configure your company tax information before generating 1099 forms. Click to set up.</p>
            </div>
          </div>
        )}

        {/* Payer Settings Card */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowPayerSettings(!showPayerSettings)}
            className="w-full px-8 py-5 flex justify-between items-center hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Building2 size={18} className="text-slate-400" />
              <div className="text-left">
                <p className="text-sm font-bold text-slate-900">
                  {payerSettings ? payerSettings.company_name : 'Payer Settings'}
                </p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">
                  {payerSettings ? `EIN: ${maskTaxId(payerSettings.tax_id)}` : 'Not configured'}
                </p>
              </div>
            </div>
            {showPayerSettings ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </button>

          {showPayerSettings && (
            <div className="px-8 pb-6 pt-2 border-t border-slate-100 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Company Name *</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    placeholder="Rylexa Property Management"
                    value={payerForm.company_name}
                    onChange={(e) => setPayerForm(p => ({ ...p, company_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">EIN / Tax ID *</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                    placeholder="XX-XXXXXXX"
                    maxLength={10}
                    value={payerForm.tax_id}
                    onChange={(e) => setPayerForm(p => ({ ...p, tax_id: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Street Address</label>
                <input
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                  placeholder="123 Business Ave"
                  value={payerForm.address_street || ''}
                  onChange={(e) => setPayerForm(p => ({ ...p, address_street: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">City</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    placeholder="Reno"
                    value={payerForm.address_city || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, address_city: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">State</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    placeholder="NV"
                    maxLength={2}
                    value={payerForm.address_state || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, address_state: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ZIP</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    placeholder="89501"
                    maxLength={10}
                    value={payerForm.address_zip || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, address_zip: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact Name</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    value={payerForm.contact_name || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, contact_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    value={payerForm.contact_phone || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, contact_phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</label>
                  <input
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-rose-500"
                    value={payerForm.contact_email || ''}
                    onChange={(e) => setPayerForm(p => ({ ...p, contact_email: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSavePayerSettings}
                  disabled={updatePayerSettings.isPending}
                  className="px-6 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-600 transition-all flex items-center gap-2 shadow-md disabled:opacity-50"
                >
                  {updatePayerSettings.isPending ? <Loader2 className="animate-spin w-3 h-3" /> : <Save size={14} />}
                  Save Payer Settings
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(['vendors', 'owners'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-600'
              }`}
            >
              {tab === 'vendors' ? `Vendors (1099-NEC) · ${eligibleVendors.length}` : `Owners (1099-MISC) · ${eligibleOwners.length}`}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-8 py-5">Recipient</th>
                <th className="px-8 py-5">Tax ID</th>
                <th className="px-8 py-5 text-right">Amount</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-rose-600" /></td></tr>
              ) : activeTab === 'vendors' ? (
                <>
                  {eligibleVendors.length === 0 && belowThresholdVendors.length === 0 && (
                    <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold text-sm">No vendor payments found for {selectedYear}</td></tr>
                  )}
                  {eligibleVendors.map(v => {
                    const form = getFormForRecipient('vendor', v.vendor_id)
                    return (
                      <VendorRow
                        key={v.vendor_id}
                        vendor={v}
                        form={form}
                        generating={generating === v.vendor_id}
                        onGenerate={() => handleGenerate('vendor', v.vendor_id)}
                        onDownload={() => form?.storage_path && handleDownload(form.storage_path)}
                        onVoid={() => form && setVoidConfirmId(form.id)}
                        onMarkSent={() => form && markSent.mutate(form.id)}
                      />
                    )
                  })}
                  {belowThresholdVendors.map(v => (
                    <tr key={v.vendor_id} className="opacity-40">
                      <td className="px-8 py-4">
                        <div className="font-bold text-slate-500 text-sm">{v.company_name || v.contact_name || 'Unknown'}</div>
                      </td>
                      <td className="px-8 py-4 text-sm font-mono text-slate-400">{maskTaxId(v.tax_id)}</td>
                      <td className="px-8 py-4 text-right text-sm font-bold text-slate-400">{formatCurrency(v.total_paid)}</td>
                      <td className="px-8 py-4">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">Below $600</span>
                      </td>
                      <td className="px-8 py-4" />
                    </tr>
                  ))}
                </>
              ) : (
                <>
                  {eligibleOwners.length === 0 && belowThresholdOwners.length === 0 && (
                    <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold text-sm">No owner distributions found for {selectedYear}</td></tr>
                  )}
                  {eligibleOwners.map(o => {
                    const form = getFormForRecipient('owner', o.owner_id)
                    return (
                      <OwnerRow
                        key={o.owner_id}
                        owner={o}
                        form={form}
                        generating={generating === o.owner_id}
                        onGenerate={() => handleGenerate('owner', o.owner_id)}
                        onDownload={() => form?.storage_path && handleDownload(form.storage_path)}
                        onVoid={() => form && setVoidConfirmId(form.id)}
                        onMarkSent={() => form && markSent.mutate(form.id)}
                      />
                    )
                  })}
                  {belowThresholdOwners.map(o => (
                    <tr key={o.owner_id} className="opacity-40">
                      <td className="px-8 py-4">
                        <div className="font-bold text-slate-500 text-sm">{o.full_name}</div>
                        {o.company_name && <div className="text-[10px] text-slate-400 font-bold">{o.company_name}</div>}
                      </td>
                      <td className="px-8 py-4 text-sm font-mono text-slate-400">{maskTaxId(o.tax_id)}</td>
                      <td className="px-8 py-4 text-right text-sm font-bold text-slate-400">{formatCurrency(o.total_distributed)}</td>
                      <td className="px-8 py-4">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">Below $600</span>
                      </td>
                      <td className="px-8 py-4" />
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Void Confirmation Modal */}
      <AccessibleModal isOpen={!!voidConfirmId} onClose={() => setVoidConfirmId(null)} title="Void Form" subtitle="This action cannot be undone" size="max-w-md">
        <div className="p-8 space-y-6">
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
            <Ban className="text-red-600" size={20} />
            <p className="text-sm font-bold text-red-800">Are you sure you want to void this 1099 form? The recipient will need a corrected form.</p>
          </div>
          <div className="flex justify-end gap-4">
            <button onClick={() => setVoidConfirmId(null)} className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900">
              Cancel
            </button>
            <button
              onClick={handleVoid}
              disabled={voidForm.isPending}
              className="px-6 py-3 bg-red-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {voidForm.isPending ? <Loader2 className="animate-spin w-4 h-4" /> : <Ban size={14} />}
              Void Form
            </button>
          </div>
        </div>
      </AccessibleModal>
    </div>
  )
}

// ── Row Components ──

function VendorRow({ vendor, form, generating, onGenerate, onDownload, onVoid, onMarkSent }: {
  vendor: VendorPaymentSummary
  form: TaxForm1099 | undefined
  generating: boolean
  onGenerate: () => void
  onDownload: () => void
  onVoid: () => void
  onMarkSent: () => void
}) {
  const statusOption = form ? TAX_FORM_STATUS_OPTIONS.find(s => s.value === form.status) : null

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-8 py-4">
        <div className="font-bold text-slate-900 text-sm">{vendor.company_name || vendor.contact_name || 'Unknown'}</div>
        {vendor.company_name && vendor.contact_name && (
          <div className="text-[10px] text-slate-400 font-bold">{vendor.contact_name}</div>
        )}
        {!vendor.tax_id && (
          <div className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-0.5">
            <AlertTriangle size={10} /> Missing Tax ID
          </div>
        )}
      </td>
      <td className="px-8 py-4 text-sm font-mono text-slate-600">{maskTaxId(vendor.tax_id)}</td>
      <td className="px-8 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(vendor.total_paid)}</td>
      <td className="px-8 py-4">
        {statusOption ? (
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${statusOption.color}`}>
            {statusOption.label}
          </span>
        ) : (
          <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">Eligible</span>
        )}
      </td>
      <td className="px-8 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          {!form || form.status === 'voided' ? (
            <button
              onClick={onGenerate}
              disabled={generating}
              className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase rounded-lg hover:bg-rose-600 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {generating ? <Loader2 className="animate-spin w-3 h-3" /> : <FileText size={12} />}
              Generate
            </button>
          ) : (
            <>
              {form.storage_path && (
                <button onClick={onDownload} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Download">
                  <Download size={14} />
                </button>
              )}
              {form.status === 'generated' && (
                <button onClick={onMarkSent} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Mark Sent">
                  <Send size={14} />
                </button>
              )}
              <button onClick={onVoid} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Void">
                <Ban size={14} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

function OwnerRow({ owner, form, generating, onGenerate, onDownload, onVoid, onMarkSent }: {
  owner: OwnerDistributionSummary
  form: TaxForm1099 | undefined
  generating: boolean
  onGenerate: () => void
  onDownload: () => void
  onVoid: () => void
  onMarkSent: () => void
}) {
  const statusOption = form ? TAX_FORM_STATUS_OPTIONS.find(s => s.value === form.status) : null

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-8 py-4">
        <div className="font-bold text-slate-900 text-sm">{owner.full_name}</div>
        {owner.company_name && <div className="text-[10px] text-slate-400 font-bold">{owner.company_name}</div>}
        {!owner.tax_id && (
          <div className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-0.5">
            <AlertTriangle size={10} /> Missing Tax ID
          </div>
        )}
      </td>
      <td className="px-8 py-4 text-sm font-mono text-slate-600">{maskTaxId(owner.tax_id)}</td>
      <td className="px-8 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(owner.total_distributed)}</td>
      <td className="px-8 py-4">
        {statusOption ? (
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${statusOption.color}`}>
            {statusOption.label}
          </span>
        ) : (
          <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">Eligible</span>
        )}
      </td>
      <td className="px-8 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          {!form || form.status === 'voided' ? (
            <button
              onClick={onGenerate}
              disabled={generating}
              className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase rounded-lg hover:bg-rose-600 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {generating ? <Loader2 className="animate-spin w-3 h-3" /> : <FileText size={12} />}
              Generate
            </button>
          ) : (
            <>
              {form.storage_path && (
                <button onClick={onDownload} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors" title="Download">
                  <Download size={14} />
                </button>
              )}
              {form.status === 'generated' && (
                <button onClick={onMarkSent} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors" title="Mark Sent">
                  <Send size={14} />
                </button>
              )}
              <button onClick={onVoid} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors" title="Void">
                <Ban size={14} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
