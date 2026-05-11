'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'
import {
  Zap, Loader2, CheckCircle, Calendar, DollarSign, Clock,
  AlertTriangle, RotateCcw, ChevronLeft, Home, Droplets,
  Settings, Save, ToggleLeft, ToggleRight, Percent, Hash
} from 'lucide-react'
import Link from 'next/link'
import { useBillingSettings, type BillingSettingsUpdate } from '@/hooks/useBillingSettings'

type BillingRun = {
  id: string
  run_date: string
  run_type: string
  triggered_by: string
  rent_charges_count: number
  utility_charges_count: number
  late_fees_count: number
  status: string
  error_details: string | null
  created_at: string
}

export default function BillingManagementPage() {
  const [runs, setRuns] = useState<BillingRun[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  // Settings hook
  const { settings, loading: settingsLoading, saving, saveSettings } = useBillingSettings()

  // Local settings form state (initialized from hook)
  const [settingsForm, setSettingsForm] = useState({
    grace_period_days: 5,
    late_fee_type: 'flat' as 'flat' | 'percent',
    late_fee_amount: 50,
    auto_post_rent: true,
    auto_post_utilities: false,
    auto_late_fees: true,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Sync local form when settings load
  useEffect(() => {
    if (settings) {
      setSettingsForm({
        grace_period_days: settings.grace_period_days,
        late_fee_type: settings.late_fee_type,
        late_fee_amount: settings.late_fee_amount,
        auto_post_rent: settings.auto_post_rent,
        auto_post_utilities: settings.auto_post_utilities,
        auto_late_fees: settings.auto_late_fees,
      })
    }
  }, [settings])

  // Form state
  const [operations, setOperations] = useState({
    rent: true,
    utilities: true,
    late_fees: false,
  })
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0])

  const fetchRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from('billing_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) console.error('Failed to fetch billing runs:', error.message)
    if (data) setRuns(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  const handleRunBilling = async () => {
    const selectedOps = Object.entries(operations)
      .filter(([, v]) => v)
      .map(([k]) => k === 'late_fees' ? 'late_fees' : k)

    if (selectedOps.length === 0) {
      toast.error('Select at least one billing operation.')
      return
    }

    setRunning(true)

    try {
      const { data: result, error } = await supabase.functions.invoke('run-billing', {
        body: { operations: selectedOps, target_date: targetDate },
      })

      if (error) {
        let msg = error.message || 'Billing run failed.'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        toast.error(msg)
      } else {
        const parts: string[] = []
        if (result.rent_charges > 0) parts.push(`${result.rent_charges} rent charge(s)`)
        if (result.utility_charges > 0) parts.push(`${result.utility_charges} utility charge(s)`)
        if (result.late_fees > 0) parts.push(`${result.late_fees} late fee(s)`)

        if (parts.length > 0) {
          toast.success(`Billing complete: ${parts.join(', ')} posted.`)
        } else {
          toast.info('Billing run completed — no new charges to post (already up to date).')
        }

        fetchRuns()
      }
    } catch (err) {
      toast.error('Network error: ' + (err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const handleSaveSettings = async () => {
    const result = await saveSettings(settingsForm as BillingSettingsUpdate)
    if (result?.error) {
      toast.error('Failed to save settings: ' + result.error.message)
    } else {
      toast.success('Billing settings saved.')
      setSettingsOpen(false)
    }
  }

  const formatRunType = (type: string) => {
    const map: Record<string, string> = {
      rent: 'Rent',
      utility: 'Utilities',
      late_fee: 'Late Fees',
      full: 'Full Cycle',
      'rent,utilities': 'Rent + Utilities',
      'rent,utilities,late_fees': 'Full Billing',
    }
    return map[type] || type
  }

  // Dynamic late fee description
  const lateFeeDesc = settings
    ? settings.late_fee_type === 'flat'
      ? `$${settings.late_fee_amount} flat fee`
      : `${settings.late_fee_amount}% of balance`
    : '$50 flat fee'
  const graceDesc = settings ? `${settings.grace_period_days + 1}-day+ grace` : '6-day grace'

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 animate-in fade-in">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <Link href="/admin/finance" className="text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-emerald-600 transition-colors flex items-center gap-1 mb-3">
            <ChevronLeft size={14} /> Finance Dashboard
          </Link>
          <h1 className="text-4xl font-black italic uppercase text-slate-900">
            Billing <span className="text-emerald-600">Engine</span>
          </h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">
            Post Rent, Utilities & Late Fees
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            settingsOpen
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Settings size={16} />
          {settingsOpen ? 'Close Settings' : 'Billing Settings'}
        </button>
      </div>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-top-2">
          <div className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-slate-100 text-slate-600 rounded-2xl flex items-center justify-center">
                <Settings size={22} />
              </div>
              <div>
                <h2 className="text-xl font-black italic uppercase text-slate-900">Billing Settings</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Global Default Configuration
                </p>
              </div>
            </div>

            {settingsLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left: Late Fee Config */}
                <div className="space-y-5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Late Fee Configuration</p>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Grace Period (days after due date)</label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={settingsForm.grace_period_days}
                      onChange={e => setSettingsForm(p => ({ ...p, grace_period_days: Number(e.target.value) }))}
                      className="w-full p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      Late fees apply after day {settingsForm.grace_period_days} of each month
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">Fee Type</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setSettingsForm(p => ({ ...p, late_fee_type: 'flat' }))}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                          settingsForm.late_fee_type === 'flat'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <DollarSign size={16} />
                        Flat Fee
                      </button>
                      <button
                        onClick={() => setSettingsForm(p => ({ ...p, late_fee_type: 'percent' }))}
                        className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                          settingsForm.late_fee_type === 'percent'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <Percent size={16} />
                        % of Balance
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      {settingsForm.late_fee_type === 'flat' ? 'Fee Amount ($)' : 'Fee Percentage (%)'}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                        {settingsForm.late_fee_type === 'flat' ? '$' : '%'}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={settingsForm.late_fee_type === 'flat' ? 1 : 0.5}
                        value={settingsForm.late_fee_amount}
                        onChange={e => setSettingsForm(p => ({ ...p, late_fee_amount: Number(e.target.value) }))}
                        className="w-full p-3 pl-8 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Automation Toggles */}
                <div className="space-y-5">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Automation</p>

                  <button
                    onClick={() => setSettingsForm(p => ({ ...p, auto_post_rent: !p.auto_post_rent }))}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Home size={18} className="text-slate-500" />
                      <div className="text-left">
                        <p className="font-bold text-sm text-slate-900">Auto-Post Rent</p>
                        <p className="text-[10px] text-slate-400 font-bold">Automatically post rent on the 1st</p>
                      </div>
                    </div>
                    {settingsForm.auto_post_rent ? (
                      <ToggleRight size={28} className="text-emerald-500" />
                    ) : (
                      <ToggleLeft size={28} className="text-slate-300" />
                    )}
                  </button>

                  <button
                    onClick={() => setSettingsForm(p => ({ ...p, auto_post_utilities: !p.auto_post_utilities }))}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Droplets size={18} className="text-slate-500" />
                      <div className="text-left">
                        <p className="font-bold text-sm text-slate-900">Auto-Post Utilities</p>
                        <p className="text-[10px] text-slate-400 font-bold">Automatically post utility charges monthly</p>
                      </div>
                    </div>
                    {settingsForm.auto_post_utilities ? (
                      <ToggleRight size={28} className="text-emerald-500" />
                    ) : (
                      <ToggleLeft size={28} className="text-slate-300" />
                    )}
                  </button>

                  <button
                    onClick={() => setSettingsForm(p => ({ ...p, auto_late_fees: !p.auto_late_fees }))}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={18} className="text-slate-500" />
                      <div className="text-left">
                        <p className="font-bold text-sm text-slate-900">Auto-Apply Late Fees</p>
                        <p className="text-[10px] text-slate-400 font-bold">Automatically apply fees after grace period</p>
                      </div>
                    </div>
                    {settingsForm.auto_late_fees ? (
                      <ToggleRight size={28} className="text-emerald-500" />
                    ) : (
                      <ToggleLeft size={28} className="text-slate-300" />
                    )}
                  </button>

                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="w-full py-3 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs disabled:opacity-50 mt-4"
                  >
                    {saving ? (
                      <><Loader2 className="animate-spin" size={16} /> Saving...</>
                    ) : (
                      <><Save size={16} /> Save Settings</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Run Billing Panel */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <Zap size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black italic uppercase text-slate-900">Run Billing Now</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Manual Billing Execution
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Operations */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                Operations
              </label>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:border-emerald-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={operations.rent}
                    onChange={e => setOperations(p => ({ ...p, rent: e.target.checked }))}
                    className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <Home size={18} className="text-slate-500" />
                  <div>
                    <p className="font-bold text-sm text-slate-900">Rent Charges</p>
                    <p className="text-[10px] text-slate-400 font-bold">Post monthly rent for all active leases</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:border-orange-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={operations.utilities}
                    onChange={e => setOperations(p => ({ ...p, utilities: e.target.checked }))}
                    className="w-5 h-5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                  />
                  <Droplets size={18} className="text-slate-500" />
                  <div>
                    <p className="font-bold text-sm text-slate-900">Utility Fees</p>
                    <p className="text-[10px] text-slate-400 font-bold">Post utility charges for leases with fees &gt; $0</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:border-red-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={operations.late_fees}
                    onChange={e => setOperations(p => ({ ...p, late_fees: e.target.checked }))}
                    className="w-5 h-5 rounded border-slate-300 text-red-600 focus:ring-red-500"
                  />
                  <AlertTriangle size={18} className="text-slate-500" />
                  <div>
                    <p className="font-bold text-sm text-slate-900">Late Fees</p>
                    <p className="text-[10px] text-slate-400 font-bold">{lateFeeDesc} for tenants with outstanding balance ({graceDesc})</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Target Date & Run */}
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                  Billing Date
                </label>
                <div className="flex items-center gap-3">
                  <Calendar size={18} className="text-slate-400" />
                  <input
                    type="date"
                    value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                    className="flex-1 p-3 border border-slate-200 rounded-xl bg-white font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-2">
                  Charges are posted for the month of this date. Idempotent — safe to re-run.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs text-blue-800 font-bold">
                  <strong>How it works:</strong> Rent & utility charges are posted on the 1st. Late fees apply after {settings?.grace_period_days ?? 5}-day grace period for tenants with any outstanding balance. All operations are idempotent — duplicate charges are never created.
                </p>
              </div>

              <button
                onClick={handleRunBilling}
                disabled={running}
                className="w-full py-4 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-xl uppercase tracking-widest text-xs disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Running Billing...
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    Execute Billing Run
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Billing History */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
              <Clock size={18} />
            </div>
            <div>
              <h3 className="text-xl font-black italic uppercase text-slate-900">Run History</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Last 20 Billing Executions
              </p>
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); fetchRuns() }}
            className="text-slate-400 hover:text-emerald-600 transition-colors"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading history...</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="mx-auto mb-3 text-slate-300" size={32} />
            <p className="text-slate-400 font-bold text-sm">No billing runs yet</p>
            <p className="text-slate-300 text-xs mt-1">Execute your first billing run above</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-4">Date</th>
                <th className="px-8 py-4">Type</th>
                <th className="px-8 py-4">Rent</th>
                <th className="px-8 py-4">Utilities</th>
                <th className="px-8 py-4">Late Fees</th>
                <th className="px-8 py-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {runs.map(run => (
                <tr key={run.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5">
                    <div className="font-bold text-sm text-slate-900">
                      {new Date(run.run_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {new Date(run.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">
                      {formatRunType(run.run_type)}
                    </span>
                  </td>
                  <td className="px-8 py-5">
                    {run.rent_charges_count > 0 ? (
                      <span className="font-bold text-emerald-600">{run.rent_charges_count}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    {run.utility_charges_count > 0 ? (
                      <span className="font-bold text-orange-600">{run.utility_charges_count}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    {run.late_fees_count > 0 ? (
                      <span className="font-bold text-red-600">{run.late_fees_count}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                      run.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-600'
                        : run.status === 'failed'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-amber-50 text-amber-600'
                    }`}>
                      {run.status === 'completed' && <CheckCircle size={12} />}
                      {run.status === 'failed' && <AlertTriangle size={12} />}
                      {run.status}
                    </span>
                    {run.error_details && (
                      <p className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate" title={run.error_details}>
                        {run.error_details}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
