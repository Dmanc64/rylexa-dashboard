'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Landmark, Plus, Loader2, ArrowLeft, Pencil, Ban,
  CheckCircle2, AlertTriangle, Save, X, Shield,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import { useBankAccounts, type BankAccount, type BankAccountInput } from '@/hooks/useBankAccounts'

type AssetAccount = { id: string; code: string; name: string }

const blankForm: Omit<BankAccountInput, 'is_active'> = {
  name: '',
  bank_name: '',
  routing_number: '',
  account_number: '',
  starting_check_number: 1001,
  gl_cash_account_id: null,
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  postal_code: '',
  fractional_routing: '',
}

export default function BankAccountsPage() {
  const { accounts, loading, createAccount, updateAccount, deactivateAccount } = useBankAccounts()

  const [cashAccounts, setCashAccounts] = useState<AssetAccount[]>([])
  const [cashLoading, setCashLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('id, code, name, account_type')
        .eq('account_type', 'Asset')
        .order('code')
      if (cancelled) return
      if (error) {
        toast.error('Failed to load cash accounts: ' + error.message)
      } else {
        setCashAccounts((data ?? []) as AssetAccount[])
      }
      setCashLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [form, setForm] = useState(blankForm)
  const [submitting, setSubmitting] = useState(false)

  const openNew = () => {
    setEditing(null)
    setForm(blankForm)
    setIsModalOpen(true)
  }

  const openEdit = (acct: BankAccount) => {
    setEditing(acct)
    setForm({
      name: acct.name,
      bank_name: acct.bank_name ?? '',
      routing_number: acct.routing_number,
      account_number: acct.account_number,
      starting_check_number: acct.starting_check_number,
      gl_cash_account_id: acct.gl_cash_account_id,
      address_line1: acct.address_line1 ?? '',
      address_line2: acct.address_line2 ?? '',
      city: acct.city ?? '',
      state: acct.state ?? '',
      postal_code: acct.postal_code ?? '',
      fractional_routing: acct.fractional_routing ?? '',
    })
    setIsModalOpen(true)
  }

  const handleChange = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async () => {
    if (!form.name.trim()) return toast.error('Account name is required')
    if (!/^[0-9]{9}$/.test(form.routing_number)) {
      return toast.error('Routing number must be exactly 9 digits')
    }
    if (!form.account_number.trim()) return toast.error('Account number is required')
    if (!form.starting_check_number || form.starting_check_number < 1) {
      return toast.error('Starting check number must be positive')
    }
    if (!form.gl_cash_account_id) return toast.error('GL cash account is required')

    setSubmitting(true)
    try {
      if (editing) {
        await updateAccount.mutateAsync({
          id: editing.id,
          updates: {
            name: form.name.trim(),
            bank_name: form.bank_name?.trim() || null,
            routing_number: form.routing_number,
            account_number: form.account_number.trim(),
            gl_cash_account_id: form.gl_cash_account_id,
            address_line1: form.address_line1?.trim() || null,
            address_line2: form.address_line2?.trim() || null,
            city: form.city?.trim() || null,
            state: form.state?.trim() || null,
            postal_code: form.postal_code?.trim() || null,
            fractional_routing: form.fractional_routing?.trim() || null,
          },
        })
      } else {
        await createAccount.mutateAsync({
          ...form,
          name: form.name.trim(),
          bank_name: form.bank_name?.trim() || null,
          account_number: form.account_number.trim(),
          address_line1: form.address_line1?.trim() || null,
          address_line2: form.address_line2?.trim() || null,
          city: form.city?.trim() || null,
          state: form.state?.trim() || null,
          postal_code: form.postal_code?.trim() || null,
          fractional_routing: form.fractional_routing?.trim() || null,
          is_active: true,
        })
      }
      setIsModalOpen(false)
    } catch {
      // toast in hook
    } finally {
      setSubmitting(false)
    }
  }

  const cashAcctById = useMemo(
    () => new Map(cashAccounts.map((a) => [a.id, a])),
    [cashAccounts],
  )

  const mask = (s: string) => {
    if (!s) return ''
    const last = s.slice(-4)
    return '••••' + last
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/admin/finance"
            className="inline-flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-900 transition-colors mb-3"
          >
            <ArrowLeft size={12} /> Finance Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">
                BANK <span className="text-emerald-600">ACCOUNTS</span>
              </h1>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">
                {accounts.length} ACCOUNT{accounts.length === 1 ? '' : 'S'} · CHECK-PRINTING SETUP
              </p>
            </div>
            <button
              onClick={openNew}
              className="px-5 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg"
            >
              <Plus size={14} /> New Bank Account
            </button>
          </div>
        </div>

        {/* Blank-MICR warning banner */}
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
          <Shield size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-amber-900 font-bold leading-relaxed">
            <p className="mb-1">
              <strong>Blank-check stock setup:</strong> You print the full check face (bank info, MICR line, payee, amount) on blank check stock with MICR toner.
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-800 font-medium">
              <li>Load a MICR-toner cartridge before printing production checks.</li>
              <li>Before paying real vendors, print 3–5 test checks and take them to your bank teller to verify the MICR line scans correctly.</li>
              <li>Upload your licensed E-13B MICR TTF to storage and set <code className="bg-amber-100 px-1 rounded">MICR_FONT_URL</code> in edge-function secrets. Without it, checks use a Courier fallback that is visually correct but NOT bank-scannable.</li>
            </ul>
          </div>
        </div>

        {/* Accounts list */}
        {loading ? (
          <div className="py-20 text-center">
            <Loader2 className="animate-spin mx-auto text-emerald-500 mb-3" size={28} />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-2xl border border-slate-200">
            <Landmark size={36} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 font-bold mb-2">No bank accounts yet</p>
            <p className="text-xs text-slate-400">Add one to start printing checks for approved bills.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {accounts.map((acct) => {
              const cash = acct.gl_cash_account_id ? cashAcctById.get(acct.gl_cash_account_id) : null
              return (
                <div
                  key={acct.id}
                  className={
                    'p-5 bg-white rounded-2xl border shadow-sm transition-all ' +
                    (acct.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60')
                  }
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Landmark size={14} className="text-emerald-600" />
                        <h3 className="text-base font-black text-slate-900">{acct.name}</h3>
                        {!acct.is_active && (
                          <span className="text-[9px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full uppercase">
                            Inactive
                          </span>
                        )}
                      </div>
                      {acct.bank_name && <p className="text-xs text-slate-500 font-bold">{acct.bank_name}</p>}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(acct)}
                        className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      {acct.is_active && (
                        <button
                          onClick={() => {
                            if (confirm(`Deactivate "${acct.name}"? You can't print new checks from it after this.`)) {
                              deactivateAccount.mutate(acct.id)
                            }
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Deactivate"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Routing</p>
                      <p className="font-mono font-bold text-slate-800">{acct.routing_number}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Account</p>
                      <p className="font-mono font-bold text-slate-800">{mask(acct.account_number)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Next Check #</p>
                      <p className="font-bold text-emerald-600 tabular-nums">{acct.next_check_number}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">GL Cash Acct</p>
                      <p className="font-bold text-slate-800">
                        {cash ? `${cash.code} · ${cash.name}` : <span className="text-red-500">Missing</span>}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <AccessibleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'Edit Bank Account' : 'New Bank Account'}
        subtitle={editing ? `Updating ${editing.name}` : 'Add a bank account for check printing'}
        size="max-w-2xl"
      >
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Account Name *" helper='e.g. "Chase Operating"'>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="form-input"
              />
            </FormField>
            <FormField label="Bank Name" helper="Displayed on the check header">
              <input
                type="text"
                value={form.bank_name ?? ''}
                onChange={(e) => handleChange('bank_name', e.target.value)}
                placeholder="JPMorgan Chase"
                className="form-input"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Routing Number *" helper="9 digits, ABA routing">
              <input
                type="text"
                inputMode="numeric"
                maxLength={9}
                value={form.routing_number}
                onChange={(e) => handleChange('routing_number', e.target.value.replace(/\D/g, ''))}
                placeholder="123456789"
                className="form-input font-mono"
              />
            </FormField>
            <FormField label="Account Number *">
              <input
                type="text"
                value={form.account_number}
                onChange={(e) => handleChange('account_number', e.target.value)}
                className="form-input font-mono"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Starting Check # *"
              helper={editing ? 'Cannot be changed after creation' : 'First check number to issue'}
            >
              <input
                type="number"
                min={1}
                value={form.starting_check_number}
                disabled={!!editing}
                onChange={(e) => handleChange('starting_check_number', Number(e.target.value))}
                className="form-input disabled:opacity-60"
              />
            </FormField>
            <FormField label="Fractional Routing" helper='e.g. "14-1234/1210"'>
              <input
                type="text"
                value={form.fractional_routing ?? ''}
                onChange={(e) => handleChange('fractional_routing', e.target.value)}
                className="form-input"
              />
            </FormField>
          </div>

          <FormField label="GL Cash Account *" helper="Asset account this check draws from">
            <select
              value={form.gl_cash_account_id ?? ''}
              onChange={(e) => handleChange('gl_cash_account_id', e.target.value || null)}
              disabled={cashLoading}
              className="form-input appearance-none"
            >
              <option value="">Select cash account...</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </FormField>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              Bank Address (prints on check header)
            </h3>
            <FormField label="Address Line 1">
              <input
                type="text"
                value={form.address_line1 ?? ''}
                onChange={(e) => handleChange('address_line1', e.target.value)}
                className="form-input"
              />
            </FormField>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="City">
                <input
                  type="text"
                  value={form.city ?? ''}
                  onChange={(e) => handleChange('city', e.target.value)}
                  className="form-input"
                />
              </FormField>
              <FormField label="State">
                <input
                  type="text"
                  maxLength={2}
                  value={form.state ?? ''}
                  onChange={(e) => handleChange('state', e.target.value.toUpperCase())}
                  className="form-input uppercase"
                />
              </FormField>
              <FormField label="ZIP">
                <input
                  type="text"
                  value={form.postal_code ?? ''}
                  onChange={(e) => handleChange('postal_code', e.target.value)}
                  className="form-input"
                />
              </FormField>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
          <button
            onClick={() => setIsModalOpen(false)}
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
              <><Loader2 className="animate-spin w-4 h-4" /> Saving...</>
            ) : (
              <><Save size={16} /> {editing ? 'Save Changes' : 'Create Account'}</>
            )}
          </button>
        </div>
      </AccessibleModal>

      <style jsx>{`
        .form-input {
          width: 100%;
          padding: 1rem;
          background: rgb(248 250 252);
          border: 1px solid rgb(226 232 240);
          border-radius: 1rem;
          font-weight: 700;
          font-size: 0.875rem;
          outline: none;
          transition: all 0.15s;
        }
        .form-input:focus {
          box-shadow: 0 0 0 2px rgb(16 185 129 / 50%);
        }
      `}</style>
    </div>
  )
}

function FormField({
  label,
  helper,
  children,
}: {
  label: string
  helper?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">
        {label}
      </label>
      {children}
      {helper && <p className="text-[10px] text-slate-400 ml-1">{helper}</p>}
    </div>
  )
}
