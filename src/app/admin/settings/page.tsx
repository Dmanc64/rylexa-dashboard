'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  Bell, ShieldCheck, DollarSign,
  Save, CheckCircle2, AlertCircle, Loader2, Sparkles, Shield, ChevronRight, ScrollText, GitBranch,
  Users, KeyRound, Building2
} from 'lucide-react'
import Link from 'next/link'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'

const DEFAULT_CONFIG = {
  lateFee: 50,
  gracePeriod: 5,
  autoAlerts: true,
  qbSync: true
}

const flagLabels: Record<string, string> = {
  ai_maintenance_triage: 'Maintenance Triage AI',
  ai_lease_renewal_scoring: 'Lease Renewal Scoring',
  ai_transaction_categorization: 'Transaction Categorization AI',
}

export default function GlobalSettingsPage() {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const { flags, loading: flagsLoading, toggleFlag, toggling } = useFeatureFlags()

  // Load saved config on mount
  useEffect(() => {
    async function loadConfig() {
      const { data } = await supabase
        .from('system_activity')
        .select('description')
        .eq('event_type', 'SETTINGS')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data?.description) {
        try {
          const parsed = JSON.parse(data.description)
          setConfig({ ...DEFAULT_CONFIG, ...parsed })
        } catch {
          // Use defaults if parse fails
        }
      }
      setLoading(false)
    }
    loadConfig()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const { error } = await supabase.from('system_activity').insert({
      event_type: 'SETTINGS',
      title: 'System configuration updated',
      description: JSON.stringify(config),
      actor_name: 'Admin'
    })

    if (error) {
      toast.error('Failed to save settings: ' + error.message)
    } else {
      toast.success('Settings saved successfully')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-3xl mx-auto space-y-8">

        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic text-slate-900">System Rules</h1>
            <p className="text-slate-500 font-medium">Configure Rylexa.OS automation and financial thresholds.</p>
          </div>
        </header>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="p-8 space-y-10">

            {/* ACCESS & PERMISSIONS SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <KeyRound className="text-emerald-600" />
                <h3 className="font-black uppercase tracking-widest text-sm">Access &amp; Permissions</h3>
              </div>

              <div className="space-y-3">
                <Link
                  href="/admin/settings/users"
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Users size={18} className="text-slate-400 group-hover:text-emerald-600" />
                    <div>
                      <p className="font-bold text-slate-800 group-hover:text-emerald-700">User Management</p>
                      <p className="text-xs text-slate-400 group-hover:text-emerald-500">Create staff accounts, change roles, reset passwords, disable users.</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-300 group-hover:text-emerald-500" />
                </Link>

                <Link
                  href="/admin/settings/access"
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <ShieldCheck size={18} className="text-slate-400 group-hover:text-emerald-600" />
                    <div>
                      <p className="font-bold text-slate-800 group-hover:text-emerald-700">Property Access</p>
                      <p className="text-xs text-slate-400 group-hover:text-emerald-500">Assign Property Managers, Accounting, and Owners to specific properties.</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-300 group-hover:text-emerald-500" />
                </Link>

                <Link
                  href="/admin/settings/access/owners"
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Building2 size={18} className="text-slate-400 group-hover:text-emerald-600" />
                    <div>
                      <p className="font-bold text-slate-800 group-hover:text-emerald-700">Owner Portal Access</p>
                      <p className="text-xs text-slate-400 group-hover:text-emerald-500">Link auth users to owner entities so they can see those entities&apos; properties.</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-300 group-hover:text-emerald-500" />
                </Link>

                <Link
                  href="/admin/settings/scoring"
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles size={18} className="text-slate-400 group-hover:text-emerald-600" />
                    <div>
                      <p className="font-bold text-slate-800 group-hover:text-emerald-700">Application Scoring Weights</p>
                      <p className="text-xs text-slate-400 group-hover:text-emerald-500">Tune how much each factor (income, employment, screening flags, etc.) contributes to the 0&ndash;100 applicant score.</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-300 group-hover:text-emerald-500" />
                </Link>
              </div>
            </section>

            {/* FINANCIAL AUTOMATION SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <DollarSign className="text-blue-600" />
                <h3 className="font-black uppercase tracking-widest text-sm">Rent Collection Rules</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Late Fee Amount ($)</label>
                  <input
                    type="number"
                    value={config.lateFee}
                    onChange={(e) => setConfig({...config, lateFee: Number(e.target.value)})}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Grace Period (Days)</label>
                  <input
                    type="number"
                    value={config.gracePeriod}
                    onChange={(e) => setConfig({...config, gracePeriod: Number(e.target.value)})}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none font-bold"
                  />
                </div>
              </div>
            </section>

            {/* NOTIFICATION SETTINGS */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <Bell className="text-orange-500" />
                <h3 className="font-black uppercase tracking-widest text-sm">Automated Notifications</h3>
              </div>

              <div className="space-y-4">
                <Toggle
                  label="Tenant Late Fee Alerts"
                  desc="Automatically notify tenants when a late fee is applied to their ledger."
                  enabled={config.autoAlerts}
                  onClick={() => setConfig({...config, autoAlerts: !config.autoAlerts})}
                />
                <Toggle
                  label="QuickBooks Live Sync"
                  desc="Push all Rylexa ledger entries to QuickBooks Online in real-time."
                  enabled={config.qbSync}
                  onClick={() => setConfig({...config, qbSync: !config.qbSync})}
                />
              </div>
            </section>

            {/* AI FEATURES SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <Sparkles className="text-violet-500" />
                <h3 className="font-black uppercase tracking-widest text-sm">AI & Automation</h3>
              </div>

              {flagsLoading ? (
                <div className="flex items-center gap-3 py-4 text-slate-400">
                  <Loader2 className="animate-spin" size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">Loading flags...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {flags.map((flag) => (
                    <Toggle
                      key={flag.key}
                      label={flagLabels[flag.key] || flag.key}
                      desc={flag.description || ''}
                      enabled={flag.value}
                      onClick={() => toggleFlag(flag.key, !flag.value)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* WORKFLOW AUTOMATION SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <GitBranch className="text-emerald-500" />
                <h3 className="font-black uppercase tracking-widest text-sm">Workflow Automation</h3>
              </div>

              <Link
                href="/admin/settings/workflows"
                className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-all group"
              >
                <div>
                  <p className="font-bold text-slate-800 group-hover:text-blue-700">Automated Workflows</p>
                  <p className="text-xs text-slate-400 group-hover:text-blue-500">Configure multi-step automated sequences for collections, lease renewals, move-outs, and work order routing.</p>
                </div>
                <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500" />
              </Link>
            </section>

            {/* TENANT AI ASSISTANT SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <Shield className="text-purple-500" />
                <h3 className="font-black uppercase tracking-widest text-sm">Tenant AI Assistant</h3>
              </div>

              <Link
                href="/admin/settings/policies"
                className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-all group"
              >
                <div>
                  <p className="font-bold text-slate-800 group-hover:text-blue-700">Property Policies</p>
                  <p className="text-xs text-slate-400 group-hover:text-blue-500">Manage rules the AI assistant uses to answer tenant questions (pet policy, parking, quiet hours, etc.)</p>
                </div>
                <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500" />
              </Link>
            </section>

            {/* AUDIT TRAIL SECTION */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <ScrollText className="text-cyan-500" />
                <h3 className="font-black uppercase tracking-widest text-sm">Audit Trail</h3>
              </div>

              <Link
                href="/admin/settings/audit-log"
                className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-all group"
              >
                <div>
                  <p className="font-bold text-slate-800 group-hover:text-blue-700">System Audit Log</p>
                  <p className="text-xs text-slate-400 group-hover:text-blue-500">View every change across the system — who changed what, when, and the before/after values.</p>
                </div>
                <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500" />
              </Link>
            </section>

          </div>

          <div className="p-8 bg-slate-900 flex justify-between items-center">
             <div className="flex items-center gap-3 text-white/50">
                <ShieldCheck size={20} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Encryption: AES-256</span>
             </div>
             <button
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
             >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {saving ? 'SAVING...' : 'SAVE CONFIGURATION'}
             </button>
          </div>
        </div>

        <div className="p-6 bg-amber-50 rounded-2xl border border-amber-100 flex gap-4">
           <AlertCircle className="text-amber-600 shrink-0" />
           <p className="text-xs text-amber-800 font-medium leading-relaxed">
             <strong>Warning:</strong> Changes to the Grace Period will take effect on the next billing cycle. Existing late fees will not be retroactively modified.
           </p>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, desc, enabled, onClick }: any) {
  return (
    <div className="flex items-center justify-between py-2">
       <div>
          <p className="font-bold text-slate-800">{label}</p>
          <p className="text-xs text-slate-400">{desc}</p>
       </div>
       <button
        onClick={onClick}
        className={`w-14 h-8 rounded-full transition-all relative ${enabled ? 'bg-blue-600' : 'bg-slate-200'}`}
       >
          <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${enabled ? 'left-7 shadow-sm' : 'left-1'}`}></div>
       </button>
    </div>
  )
}
