'use client'

import { useState } from 'react'
import { FileText, Plus, Search, Loader2, Calendar, DollarSign, Filter, Sparkles, AlertTriangle, ShieldCheck, Download, Send, Clock, CheckCircle2, XCircle, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { usePermissions } from '@/hooks/usePermissions'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useLeases, type LeaseDetail } from '@/hooks/useLeases'
import { useRenewalScores, type RenewalScore } from '@/hooks/useRenewalScores'
import { useLeaseRenewals } from '@/hooks/useLeaseRenewals'
import { useLeaseSignatures } from '@/hooks/useLeaseSignatures'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import NewLeaseModal from '@/components/NewLeaseModal'
import EditLeaseModal from '@/components/EditLeaseModal'
import EndLeaseModal from '@/components/EndLeaseModal'
import RenewalOfferModal from '@/components/RenewalOfferModal'
import SendForSigningModal from '@/components/SendForSigningModal'

export default function LeasesPage() {
  const [selectedProperty, setSelectedProperty] = useState('All Properties')
  const { leases, properties, loading, refresh } = useLeases(selectedProperty)
  const { scores, loading: scoresLoading, scoring, runScoring } = useRenewalScores()
  const { pendingForLease, renewalForLease, withdrawOffer, withdrawing, refresh: refreshRenewals } = useLeaseRenewals()
  const { signatureForLease, voidSignature, voiding, downloadSignedPdf, refresh: refreshSignatures } = useLeaseSignatures()
  const { isEnabled } = useFeatureFlags()
  const { can: hasPermission } = usePermissions()
  const canEditLeases = hasPermission('leases', 'edit')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Active')
  const [showNewLease, setShowNewLease] = useState(false)
  const [showRenewals, setShowRenewals] = useState(false)

  // Build a quick lookup: lease_id → renewal score
  const scoreMap = new Map(scores.map((s) => [s.lease_id, s]))
  const [editLease, setEditLease] = useState<LeaseDetail | null>(null)
  const [endLease, setEndLease] = useState<LeaseDetail | null>(null)
  const [offerTarget, setOfferTarget] = useState<RenewalScore | null>(null)
  const [signingTarget, setSigningTarget] = useState<LeaseDetail | null>(null)
  const [generatingLeaseId, setGeneratingLeaseId] = useState<string | null>(null)

  // Generate Lease PDF
  const handleGenerateLease = async (leaseId: string) => {
    setGeneratingLeaseId(leaseId)
    try {
      const { data: blob, error } = await supabase.functions.invoke('generate-lease', {
        body: { lease_id: leaseId },
      })

      if (error) {
        let msg = 'Failed to generate lease'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        toast.error(msg)
        return
      }

      // Download the PDF
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'lease.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Lease agreement downloaded')
    } catch (err: any) {
      toast.error('Error: ' + (err.message || 'Unknown error'))
    } finally {
      setGeneratingLeaseId(null)
    }
  }

  const filtered = leases.filter((l: LeaseDetail) => {
    const matchesSearch =
      !search ||
      `${l.first_name} ${l.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      l.unit_name?.toLowerCase().includes(search.toLowerCase())

    const matchesStatus = statusFilter === 'All' || l.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in">

      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-4xl font-black italic uppercase text-slate-900">
            Lease <span className="text-blue-600">Ledger</span>
          </h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">
            {leases.length} Contract{leases.length !== 1 ? 's' : ''} Loaded
          </p>
        </div>
        <div className="flex gap-3">
          {canEditLeases && isEnabled('ai_lease_renewal_scoring') && (
            <button
              onClick={() => setShowRenewals(!showRenewals)}
              className={`px-6 py-3 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg ${
                showRenewals
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : 'bg-white border border-slate-200 text-violet-600 hover:border-violet-300'
              }`}
            >
              <Sparkles size={16} /> Renewal Risk
              {scores.filter((s) => s.risk_level === 'High').length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[8px]">
                  {scores.filter((s) => s.risk_level === 'High').length}
                </span>
              )}
            </button>
          )}
          {canEditLeases && (
            <button
              onClick={() => setShowNewLease(true)}
              className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all flex items-center gap-2 shadow-lg"
            >
              <Plus size={16} /> New Contract
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by tenant name or unit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
        <select
          value={selectedProperty}
          onChange={(e) => setSelectedProperty(e.target.value)}
          className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option>All Properties</option>
          {properties.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {['All', 'Active', 'Expired'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                statusFilter === s
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* RENEWAL RISK PANEL */}
      {showRenewals && (
        <div className="bg-white rounded-[2.5rem] border border-violet-200 shadow-sm p-8 space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Sparkles className="text-violet-500" size={20} />
              <h2 className="text-lg font-black italic uppercase text-slate-900">
                Lease Renewal <span className="text-violet-600">Risk Scores</span>
              </h2>
            </div>
            <button
              onClick={() => runScoring()}
              disabled={scoring}
              className="px-5 py-2 bg-violet-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-500 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {scoring ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {scoring ? 'Scoring...' : 'Run Scoring'}
            </button>
          </div>

          {scoresLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-violet-400" size={24} />
            </div>
          ) : scores.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8 font-medium">
              No scores yet. Click "Run Scoring" to analyze leases expiring within 90 days.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {scores.map((s) => (
                <div
                  key={s.id}
                  className={`p-5 rounded-2xl border ${
                    s.risk_level === 'High'
                      ? 'border-red-200 bg-red-50'
                      : s.risk_level === 'Medium'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-emerald-200 bg-emerald-50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{s.tenant_name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">
                        {s.property_name} — {s.unit_name}
                      </p>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase ${
                      s.risk_level === 'High'
                        ? 'bg-red-100 text-red-600'
                        : s.risk_level === 'Medium'
                        ? 'bg-amber-100 text-amber-600'
                        : 'bg-emerald-100 text-emerald-600'
                    }`}>
                      {s.risk_level === 'High' ? <AlertTriangle size={10} /> : <ShieldCheck size={10} />}
                      {s.risk_level}
                    </div>
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Score</p>
                      <p className={`text-2xl font-black italic ${
                        s.score >= 70 ? 'text-emerald-600' : s.score >= 40 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {s.score}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Expires</p>
                      <p className="text-sm font-bold text-slate-700">
                        {s.end_date ? new Date(s.end_date).toLocaleDateString() : '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Rent</p>
                      <p className="text-sm font-bold text-slate-700">
                        ${s.rent_amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}
                      </p>
                    </div>
                  </div>

                  {/* Factor details */}
                  <div className="mt-3 pt-3 border-t border-slate-200/50 grid grid-cols-2 gap-2 text-[9px] font-bold text-slate-500 uppercase">
                    <span>Tenure: {s.factors.tenure_months}mo</span>
                    <span>Days left: {s.factors.days_to_expiry}</span>
                    <span>Paid: {s.factors.paid_transactions}/{s.factors.total_transactions}</span>
                    <span>vs Avg: {((s.factors.rent_vs_avg_ratio - 1) * 100).toFixed(0)}%</span>
                    {(s.factors as any).maintenance_complaints > 0 && (
                      <span className="text-red-500">Complaints: {(s.factors as any).maintenance_complaints}</span>
                    )}
                  </div>

                  {/* AI Recommendation */}
                  {s.recommended_action && (
                    <div className="mt-3 pt-3 border-t border-slate-200/50">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">AI Recommendation</p>
                      <p className="text-[10px] font-medium text-slate-600 mb-2">{s.recommendation}</p>
                      <span className={`inline-block px-2 py-1 rounded-lg text-[9px] font-black uppercase ${
                        s.recommended_action === 'Auto-Renew' ? 'bg-emerald-100 text-emerald-700' :
                        s.recommended_action === 'Offer Incentive' ? 'bg-blue-100 text-blue-700' :
                        s.recommended_action === 'Schedule Meeting' ? 'bg-amber-100 text-amber-700' :
                        s.recommended_action === 'Prepare Turnover' ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {s.recommended_action}
                      </span>
                    </div>
                  )}

                  {/* Renewal Action Buttons */}
                  {isEnabled('lease_renewals') && (
                    <div className="mt-3 pt-3 border-t border-slate-200/50">
                      {(() => {
                        const pending = pendingForLease(s.lease_id)
                        const latest = renewalForLease(s.lease_id)
                        if (pending) {
                          return (
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-violet-100 text-violet-600">
                                <Clock size={10} /> Offer Pending
                              </span>
                              <button
                                onClick={() => withdrawOffer({ renewal_id: pending.id })}
                                disabled={withdrawing}
                                className="px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                              >
                                <XCircle size={10} /> Withdraw
                              </button>
                            </div>
                          )
                        }
                        if (latest?.status === 'Accepted') {
                          return (
                            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase bg-emerald-100 text-emerald-600">
                              <CheckCircle2 size={10} /> Renewed
                            </span>
                          )
                        }
                        return (
                          <button
                            onClick={() => setOfferTarget(s)}
                            className="w-full px-3 py-2 text-[9px] font-black uppercase tracking-widest bg-violet-600 text-white rounded-xl hover:bg-violet-500 transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Send size={10} /> Send Renewal Offer
                          </button>
                        )
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading.leases || loading.filters ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <Loader2 className="animate-spin text-blue-500 mx-auto mb-4" size={32} />
          <p className="text-slate-400 text-sm font-medium">Loading lease ledger...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 italic uppercase">
            {search || statusFilter !== 'All' ? 'No Matching Leases' : 'No Leases Found'}
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-2">
            {search || statusFilter !== 'All'
              ? 'Try adjusting your search or filter.'
              : 'Click "New Contract" to create the first lease.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5">Tenant</th>
                <th className="px-8 py-5">Property / Unit</th>
                <th className="px-8 py-5">Rent</th>
                <th className="px-8 py-5">End Date</th>
                <th className="px-8 py-5 text-right">Status</th>
                <th className="px-8 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((lease) => (
                <tr key={lease.lease_id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-8 py-6">
                    <p className="font-black text-slate-900">{lease.first_name} {lease.last_name}</p>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-sm font-bold text-slate-700">{lease.property_name}</p>
                    <p className="text-xs text-slate-400">{lease.unit_name}</p>
                    {lease.is_restricted && (
                      <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200">
                        <ShieldCheck size={8} />
                        {lease.ami_percentage ? `${lease.ami_percentage}% AMI` : 'Restricted'}
                      </span>
                    )}
                    {lease.insurance_required && (() => {
                      const s = lease.insurance_status
                      const exp = lease.insurance_expiration
                      const daysLeft = exp ? Math.ceil((new Date(exp + 'T00:00:00').getTime() - Date.now()) / 86400000) : null
                      return (
                        <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-full border ${
                          s === 'Active'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : s === 'Pending Review'
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-red-50 text-red-600 border-red-200'
                        }`}>
                          <ShieldCheck size={8} />
                          {s === 'Active' ? 'Insured' : s === 'Pending Review' ? 'Ins. Pending' : 'No Insurance'}
                          {s === 'Active' && daysLeft != null && daysLeft <= 30 && (
                            <span className="text-amber-600 ml-0.5">({daysLeft}d)</span>
                          )}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-1 font-black text-slate-900">
                      <DollarSign size={14} className="text-slate-400" />
                      {lease.rent_amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}
                    </div>
                    {lease.is_restricted && lease.max_gross_rent != null && (() => {
                      const maxNet = lease.max_gross_rent - (lease.utility_allowance ?? 0)
                      const overLimit = (lease.rent_amount ?? 0) > maxNet
                      return (
                        <div className="mt-1 space-y-0.5">
                          <p className={`text-[9px] font-bold ${overLimit ? 'text-red-600' : 'text-slate-400'}`}>
                            {overLimit && <AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" />}
                            Max: ${maxNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{lease.utility_allowance ? ` (−$${lease.utility_allowance} util)` : ''}
                          </p>
                          {lease.subsidy_amount != null && lease.subsidy_amount > 0 && (
                            <p className="text-[9px] text-slate-400">
                              Subsidy: ${lease.subsidy_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{lease.subsidy_source ? ` (${lease.subsidy_source})` : ''}
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-1 text-sm text-slate-600">
                      <Calendar size={14} className="text-slate-400" />
                      {lease.end_date ? new Date(lease.end_date).toLocaleDateString() : 'M2M'}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                      lease.status === 'Active'
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {lease.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex gap-2 justify-end flex-wrap">
                      {/* Generate Lease PDF — always available */}
                      <button
                        onClick={() => handleGenerateLease(lease.lease_id)}
                        disabled={generatingLeaseId === lease.lease_id}
                        className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                        title="Download Lease Agreement"
                      >
                        {generatingLeaseId === lease.lease_id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        Lease
                      </button>
                      {/* E-Sign status & actions (active leases only) */}
                      {lease.status === 'Active' && isEnabled('lease_esign') && (() => {
                        const sig = signatureForLease(lease.lease_id)
                        if (sig?.status === 'Signed') {
                          return (
                            <button
                              onClick={() => downloadSignedPdf(sig)}
                              className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1"
                              title="Download Signed Lease"
                            >
                              <CheckCircle2 size={12} /> Signed
                            </button>
                          )
                        }
                        if (sig?.status === 'Pending') {
                          return (
                            <div className="flex items-center gap-1">
                              <span className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 rounded-lg flex items-center gap-1">
                                <Clock size={10} /> Awaiting
                              </span>
                              <button
                                onClick={() => voidSignature({ signature_id: sig.id })}
                                disabled={voiding}
                                className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Void signing request"
                              >
                                <XCircle size={12} />
                              </button>
                            </div>
                          )
                        }
                        return (
                          <button
                            onClick={() => setSigningTarget(lease)}
                            className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1"
                            title="Send for electronic signing"
                          >
                            <PenLine size={12} /> E-Sign
                          </button>
                        )
                      })()}
                      {canEditLeases && lease.status === 'Active' && (
                        <>
                          <button
                            onClick={() => setEditLease(lease)}
                            className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEndLease(lease)}
                            className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            End
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <NewLeaseModal
        isOpen={showNewLease}
        onClose={() => setShowNewLease(false)}
        onSuccess={() => { setShowNewLease(false); refresh() }}
      />
      <EditLeaseModal
        isOpen={!!editLease}
        onClose={() => setEditLease(null)}
        onSuccess={() => { setEditLease(null); refresh() }}
        lease={editLease}
      />
      <EndLeaseModal
        isOpen={!!endLease}
        onClose={() => setEndLease(null)}
        onSuccess={() => { setEndLease(null); refresh() }}
        leaseId={endLease?.lease_id || ''}
        tenantName={endLease ? `${endLease.first_name} ${endLease.last_name}` : ''}
        unitName={endLease?.unit_name || ''}
      />
      <RenewalOfferModal
        isOpen={!!offerTarget}
        onClose={() => setOfferTarget(null)}
        onSuccess={() => { setOfferTarget(null); refreshRenewals() }}
        score={offerTarget}
      />
      <SendForSigningModal
        isOpen={!!signingTarget}
        onClose={() => setSigningTarget(null)}
        onSuccess={() => { setSigningTarget(null); refreshSignatures() }}
        lease={signingTarget}
      />
    </div>
  )
}
