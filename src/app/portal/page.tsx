"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { CreditCard, Wrench, FileText, CheckCircle, AlertCircle, X, Loader2, Lock, ShieldCheck, Sparkles, FolderOpen, ClipboardCheck, MessageSquare, Camera, PenLine, Repeat, Trash2, Plus, History, Star } from 'lucide-react';
import RenewalAcceptModal from '@/components/RenewalAcceptModal';
import LeaseSignModal from '@/components/LeaseSignModal';
import SaveCardModal from '@/components/SaveCardModal';
import AutopaySettingsModal from '@/components/AutopaySettingsModal';
import StripeProvider from '@/components/StripeProvider';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useTenantLedger } from '@/hooks/useTenantLedger';
import { usePaymentHistory, useSavedCards, useAutopaySettings } from '@/hooks/usePayments';

// --- TYPES ---
type PortalData = {
  tenant: { id: string; first_name: string; last_name: string }
  unit: { id: string; name: string; property_name: string }
  lease: { id: string; rent_amount: number; end_date: string }
  recent_payments: { amount: number; date: string; description: string; status: string }[]
  open_tickets_count: number
}

type RepairUpdate = {
  id: string
  title: string
  description: string
  created_at: string
}

type PendingRenewal = {
  id: string
  lease_id: string
  proposed_rent: number
  proposed_end_date: string
  notes: string | null
  offer_pdf_path: string | null
  current_rent: number
  current_end_date: string
  property_name: string
  unit_name: string
}

type PendingSignature = {
  id: string
  lease_id: string
  rent_amount: number
  start_date: string
  end_date: string | null
  property_name: string
  unit_name: string
}

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export default function TenantPortal() {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isLeaseDownloading, setIsLeaseDownloading] = useState(false)
  const [repairUpdates, setRepairUpdates] = useState<RepairUpdate[]>([])
  const [pendingRenewal, setPendingRenewal] = useState<PendingRenewal | null>(null)
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false)
  const [pendingSignature, setPendingSignature] = useState<PendingSignature | null>(null)
  const [isSignModalOpen, setIsSignModalOpen] = useState(false)
  const [insuranceInfo, setInsuranceInfo] = useState<{
    required: boolean
    min_liability: number
    policy: { carrier: string; policy_number: string; expiration_date: string; status: string; liability_amount: number } | null
  } | null>(null)

  const [showSaveCard, setShowSaveCard] = useState(false)
  const [showAutopay, setShowAutopay] = useState(false)
  const [portalTab, setPortalTab] = useState<'overview' | 'payments'>('overview')

  // Tenant ledger — fetch real balance for the active lease
  const { balance: tenantBalance, loading: balanceLoading, refresh: refreshLedger } = useTenantLedger(data?.lease?.id)

  // Payment management hooks
  const { data: savedCards, loading: cardsLoading, removeCard, setDefaultCard } = useSavedCards()
  const { data: autopaySettings } = useAutopaySettings(data?.lease?.id || '')
  const { data: paymentHistory, loading: historyLoading, refresh: refreshPayments } = usePaymentHistory(data?.lease?.id)

  const handleDownloadLease = async () => {
    if (!data?.lease?.id) { toast.error('No active lease found'); return }
    setIsLeaseDownloading(true)
    try {
      const { data: blob, error } = await supabase.functions.invoke('generate-lease', {
        body: { lease_id: data.lease.id },
      })

      if (error) {
        let msg = 'Failed to download lease'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        toast.error(msg)
        return
      }

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
      setIsLeaseDownloading(false)
    }
  }

  // --- 1. FETCH DATA ---
  useEffect(() => {
    async function loadPortal() {
      setLoading(true)

      // A. Get Logged In User
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // B. Find this tenant's lease — try user_id first, fall back to email match
        let lease: any = null
        let leaseError: any = null

        // Try 1: Direct user_id lookup (fast path for linked tenants)
        const { data: directLease, error: directErr } = await supabase
          .from('leases')
          .select(`
            id, rent_amount, start_date, end_date, status,
            tenants ( id, first_name, last_name, email ),
            units ( id, name, property_id, properties ( id, name ) )
          `)
          .eq('user_id', user.id)
          .eq('status', 'Active')
          .limit(1)
          .maybeSingle()

        if (directErr) console.error('Failed to fetch lease by user_id:', directErr.message)

        if (directLease) {
          lease = directLease
        } else if (user.email) {
          // Try 2: Email-based fallback — match auth user email to tenant email
          const { data: tenantRow } = await supabase
            .from('tenants')
            .select('id')
            .ilike('email', user.email)
            .limit(1)
            .maybeSingle()

          if (tenantRow) {
            const { data: emailLease, error: emailErr } = await supabase
              .from('leases')
              .select(`
                id, rent_amount, start_date, end_date, status,
                tenants ( id, first_name, last_name, email ),
                units ( id, name, property_id, properties ( id, name ) )
              `)
              .eq('tenant_id', tenantRow.id)
              .eq('status', 'Active')
              .limit(1)
              .maybeSingle()

            if (emailErr) console.error('Failed to fetch lease by email:', emailErr.message)
            leaseError = emailErr

            if (emailLease) {
              lease = emailLease
              // Auto-link user_id for future direct lookups
              await supabase.from('leases').update({ user_id: user.id }).eq('id', emailLease.id)
            }
          }
        }

        if (leaseError) console.error('Failed to fetch lease:', leaseError.message)

        if (lease) {
          const tenant = lease.tenants as any
          const unit = lease.units as any

          // C/D/F. Parallelize: payments + ticket count + work order IDs
          const [paymentsRes, ticketCountRes, workOrderIdsRes] = await Promise.all([
            supabase
              .from('accounting')
              .select('amount, created_at, description, status')
              .eq('lease_id', lease.id)
              .order('created_at', { ascending: false })
              .limit(6),
            supabase
              .from('work_orders')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenant?.id)
              .in('status', ['Open', 'In Progress']),
            tenant?.id
              ? supabase.from('work_orders').select('id').eq('tenant_id', tenant.id)
              : Promise.resolve({ data: null, error: null }),
          ])

          if (paymentsRes.error) console.error('Payments fetch error:', paymentsRes.error.message)
          if (ticketCountRes.error) console.error('Ticket count error:', ticketCountRes.error.message)

          // E. Build the PortalData object from FK joins
          setData({
            tenant: {
              id: tenant?.id || '',
              first_name: tenant?.first_name || user.user_metadata?.full_name?.split(' ')[0] || 'Resident',
              last_name: tenant?.last_name || ''
            },
            unit: {
              id: unit?.id || '',
              name: unit?.name || 'N/A',
              property_name: unit?.properties?.name || 'N/A'
            },
            lease: {
              id: lease.id,
              rent_amount: lease.rent_amount ?? 0,
              end_date: lease.end_date || ''
            },
            recent_payments: (paymentsRes.data || []).map(p => ({
              amount: p.amount,
              date: p.created_at,
              description: p.description || 'Payment',
              status: p.status || 'Posted'
            })),
            open_tickets_count: ticketCountRes.count || 0
          })

          // F2. Fetch pending renewal offer for this lease
          const { data: renewalData } = await supabase
            .from('lease_renewals')
            .select('id, lease_id, proposed_rent, proposed_end_date, notes, offer_pdf_path')
            .eq('lease_id', lease.id)
            .eq('status', 'Pending')
            .limit(1)
            .maybeSingle()

          if (renewalData && renewalData.proposed_rent != null && renewalData.proposed_end_date) {
            setPendingRenewal({
              id: renewalData.id,
              lease_id: renewalData.lease_id,
              proposed_rent: renewalData.proposed_rent,
              proposed_end_date: renewalData.proposed_end_date,
              notes: renewalData.notes,
              offer_pdf_path: renewalData.offer_pdf_path,
              current_rent: lease.rent_amount ?? 0,
              current_end_date: lease.end_date || '',
              property_name: unit?.properties?.name || 'Property',
              unit_name: unit?.name || 'N/A',
            })
          }

          // F3. Fetch pending e-signature for this lease
          const { data: sigData } = await supabase
            .from('lease_signatures')
            .select('id, lease_id')
            .eq('lease_id', lease.id)
            .eq('status', 'Pending')
            .limit(1)
            .maybeSingle()

          if (sigData) {
            setPendingSignature({
              id: sigData.id,
              lease_id: sigData.lease_id,
              rent_amount: lease.rent_amount ?? 0,
              start_date: lease.start_date || '',
              end_date: lease.end_date || null,
              property_name: unit?.properties?.name || 'Property',
              unit_name: unit?.name || 'N/A',
            })
          }

          // F4. Fetch insurance info for this lease (lookup by ID, not name)
          const propertyId = unit?.property_id ?? unit?.properties?.id
          const { data: propInsurance } = propertyId
            ? await supabase
                .from('properties')
                .select('insurance_required, min_liability_amount')
                .eq('id', propertyId)
                .limit(1)
                .maybeSingle()
            : { data: null }

          if (propInsurance?.insurance_required) {
            const { data: policyData } = await supabase
              .from('insurance_policies')
              .select('carrier, policy_number, expiration_date, status, liability_amount')
              .eq('lease_id', lease.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            setInsuranceInfo({
              required: true,
              min_liability: propInsurance.min_liability_amount ?? 100000,
              policy: policyData ?? null,
            })
          }

          // F. Fetch repair update notifications (second step — needs work order IDs)
          const tenantWorkOrders = workOrderIdsRes.data
          if (tenantWorkOrders && tenantWorkOrders.length > 0) {
            const workOrderIds = tenantWorkOrders.map((wo: any) => wo.id)
            const { data: notifications } = await supabase
              .from('system_activity')
              .select('id, title, description, created_at')
              .eq('event_type', 'TENANT_REPAIR_UPDATE')
              .in('related_entity_id', workOrderIds)
              .order('created_at', { ascending: false })
              .limit(5)

            if (notifications) setRepairUpdates(notifications)
          }
        } else {
          // Fallback: try the RPC for tenants without a user_id linked lease
          const { data: portalData } = await supabase.rpc('get_tenant_portal_data', { target_email: user.email })
          if (portalData) setData(portalData as PortalData)
        }
      }

      setLoading(false)
    }
    loadPortal()
  }, [])

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading Portal...</div>
  if (!data) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">Access Denied: Email not linked to an active lease.</div>

  return (
    <>
    <main className="max-w-md mx-auto p-6">
        
        {/* WELCOME */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Welcome, {data.tenant.first_name}</h1>
          <p className="text-slate-500 flex items-center gap-2">
            Unit {data.unit.name} • {data.unit.property_name}
          </p>
        </div>

        {/* TAB SWITCHER */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setPortalTab('overview')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors ${
              portalTab === 'overview'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setPortalTab('payments')}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors flex items-center gap-1.5 ${
              portalTab === 'payments'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <History size={14} />
            Payment History
          </button>
        </div>

        {portalTab === 'payments' ? (
          /* ── PAYMENT HISTORY TAB ── */
          <div>
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <History size={16} className="text-blue-500" />
              Payment History
            </h3>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="animate-spin mr-2" size={18} />
                Loading payments...
              </div>
            ) : paymentHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
                No payment history yet.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Amount</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Status</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Type</span>
                </div>
                {/* Table rows */}
                <div className="divide-y divide-slate-100">
                  {paymentHistory.map((pmt) => (
                    <div key={pmt.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-3 items-center hover:bg-slate-50 transition">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {new Date(pmt.created_at).toLocaleDateString()}
                        </div>
                        {pmt.card_brand && pmt.card_last4 && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {pmt.card_brand.charAt(0).toUpperCase() + pmt.card_brand.slice(1)} ···{pmt.card_last4}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900 text-right">
                        {currencyFormatter.format(pmt.amount)}
                      </div>
                      <div className="text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          pmt.status === 'succeeded' || pmt.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : pmt.status === 'pending' || pmt.status === 'Processing'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                        }`}>
                          {pmt.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className={`text-[10px] font-bold uppercase ${pmt.is_autopay ? 'text-blue-500' : 'text-slate-400'}`}>
                          {pmt.is_autopay ? 'Autopay' : 'One-time'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
        /* ── OVERVIEW TAB ── */
        <>

        {/* BALANCE CARD */}
        <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl mb-8 relative overflow-hidden">
          <div className="relative z-10">
            {balanceLoading ? (
              <>
                <div className="text-slate-400 text-sm font-medium mb-1">Loading balance...</div>
                <div className="text-4xl font-bold mb-6 opacity-40">
                  {currencyFormatter.format(data.lease.rent_amount)}
                </div>
              </>
            ) : tenantBalance > 0 ? (
              <>
                <div className="text-red-400 text-sm font-medium mb-1">Balance Due</div>
                <div className="text-4xl font-bold mb-6">
                  {currencyFormatter.format(tenantBalance)}
                </div>
              </>
            ) : tenantBalance === 0 ? (
              <>
                <div className="text-emerald-400 text-sm font-medium mb-1">All Caught Up!</div>
                <div className="text-4xl font-bold mb-6">$0.00</div>
              </>
            ) : (
              <>
                <div className="text-emerald-400 text-sm font-medium mb-1">Credit Balance</div>
                <div className="text-4xl font-bold mb-6">
                  {currencyFormatter.format(Math.abs(tenantBalance))}
                </div>
              </>
            )}
            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <CreditCard size={18} />
              Make Payment
            </button>
          </div>
          <div className="absolute -right-6 -bottom-12 bg-white/5 w-40 h-40 rounded-full blur-2xl"></div>
        </div>

        {/* SAVED CARDS SECTION */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <CreditCard size={16} className="text-blue-500" />
              Saved Cards
            </h3>
            <button
              onClick={() => setShowSaveCard(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <Plus size={12} />
              Add Card
            </button>
          </div>
          {cardsLoading ? (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <Loader2 className="animate-spin mr-2" size={16} />
              Loading cards...
            </div>
          ) : savedCards.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
              No saved cards yet. Add a card to enable faster payments.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {savedCards.map((card) => (
                <div key={card.id} className="p-4 flex items-center gap-3 hover:bg-slate-50 transition">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                    <CreditCard size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {card.card_brand ? card.card_brand.charAt(0).toUpperCase() + card.card_brand.slice(1) : 'Card'} ····{card.card_last4 || '????'}
                      </span>
                      {card.is_default && (
                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-black uppercase flex items-center gap-0.5">
                          <Star size={8} /> Default
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">
                      Exp {card.exp_month != null ? String(card.exp_month).padStart(2, '0') : '--'}/{card.exp_year ?? '--'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!card.is_default && (
                      <button
                        onClick={() => setDefaultCard(card.id)}
                        className="p-2 text-slate-400 hover:text-emerald-600 transition-colors"
                        title="Set as default"
                      >
                        <Star size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => removeCard(card.id)}
                      className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                      title="Remove card"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AUTOPAY STATUS CARD */}
        <div className="mb-8">
          {autopaySettings?.is_active ? (
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl border border-emerald-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="text-emerald-600" size={18} />
                  <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">Autopay</span>
                </div>
                <span className="px-2 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-black uppercase">
                  Active
                </span>
              </div>
              <div className="bg-white/80 rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Day of Month</span>
                  <span className="font-bold text-slate-900">{autopaySettings.day_of_month}{autopaySettings.day_of_month === 1 ? 'st' : autopaySettings.day_of_month === 2 ? 'nd' : autopaySettings.day_of_month === 3 ? 'rd' : 'th'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-bold text-slate-900">
                    {autopaySettings.amount_type === 'fixed' && autopaySettings.fixed_amount != null
                      ? currencyFormatter.format(autopaySettings.fixed_amount)
                      : 'Balance due'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowAutopay(true)}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Repeat size={14} />
                Manage Autopay
              </button>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Repeat className="text-slate-400" size={18} />
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Autopay</span>
              </div>
              <p className="text-sm text-slate-500">
                Set up automatic payments so you never miss a due date.
              </p>
              <button
                onClick={() => setShowAutopay(true)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Repeat size={14} />
                Enable Autopay
              </button>
            </div>
          )}
        </div>

        {/* RENEWAL OFFER CARD */}
        {pendingRenewal && (
          <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-2xl border border-violet-200 p-5 mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="text-violet-600" size={18} />
                <span className="text-xs font-black text-violet-600 uppercase tracking-widest">Lease Renewal</span>
              </div>
              <span className="px-2 py-0.5 bg-violet-600 text-white rounded-full text-[9px] font-black uppercase">
                Action Required
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">New Rent</span>
                <span className="text-lg font-black text-violet-900">
                  ${pendingRenewal.proposed_rent?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">New End Date</span>
                <span className="text-sm font-bold text-slate-700">
                  {pendingRenewal.proposed_end_date
                    ? new Date(pendingRenewal.proposed_end_date + 'T00:00:00').toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
              {pendingRenewal.notes && (
                <p className="text-xs text-slate-600 pt-1 border-t border-slate-100">
                  {pendingRenewal.notes}
                </p>
              )}
            </div>

            <button
              onClick={() => setIsRenewalModalOpen(true)}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <FileText size={16} />
              Review &amp; Accept
            </button>
          </div>
        )}

        {/* LEASE SIGNING CARD */}
        {pendingSignature && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl border border-blue-200 p-5 mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PenLine className="text-blue-600" size={18} />
                <span className="text-xs font-black text-blue-600 uppercase tracking-widest">Lease Signing</span>
              </div>
              <span className="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[9px] font-black uppercase">
                Action Required
              </span>
            </div>

            <div className="bg-white/80 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">Monthly Rent</span>
                <span className="text-lg font-black text-blue-900">
                  ${pendingSignature.rent_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-500">Lease Term</span>
                <span className="text-sm font-bold text-slate-700">
                  {pendingSignature.start_date
                    ? new Date(pendingSignature.start_date + 'T00:00:00').toLocaleDateString()
                    : 'N/A'}
                  {' — '}
                  {pendingSignature.end_date
                    ? new Date(pendingSignature.end_date + 'T00:00:00').toLocaleDateString()
                    : 'Month-to-Month'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsSignModalOpen(true)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <PenLine size={16} />
              Review &amp; Sign Lease
            </button>
          </div>
        )}

        {/* INSURANCE STATUS CARD */}
        {insuranceInfo?.required && (() => {
          const pol = insuranceInfo.policy
          const daysToExpiry = pol?.expiration_date
            ? Math.ceil((new Date(pol.expiration_date + 'T00:00:00').getTime() - Date.now()) / 86400000)
            : null

          if (!pol) {
            // No policy on file
            return (
              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl border border-red-200 p-5 mb-8 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-red-600" size={18} />
                  <span className="text-xs font-black text-red-600 uppercase tracking-widest">Insurance Required</span>
                </div>
                <p className="text-sm text-red-700">
                  Your property requires renters insurance. Please upload proof of insurance to stay compliant.
                </p>
                <Link
                  href="/portal/documents"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-red-500 transition-colors"
                >
                  <FolderOpen size={14} />
                  Upload Certificate
                </Link>
              </div>
            )
          }

          if (pol.status === 'Pending Review') {
            return (
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border border-amber-200 p-5 mb-8 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-amber-600" size={18} />
                  <span className="text-xs font-black text-amber-600 uppercase tracking-widest">Insurance Pending</span>
                </div>
                <div className="bg-white/80 rounded-xl p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Carrier</span><span className="font-bold">{pol.carrier}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Policy #</span><span className="font-bold">{pol.policy_number}</span></div>
                </div>
                <p className="text-xs text-amber-700">Your policy is being reviewed by management.</p>
              </div>
            )
          }

          // Active policy
          return (
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl border border-emerald-200 p-5 mb-8 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-emerald-600" size={18} />
                  <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">Insured</span>
                </div>
                {daysToExpiry != null && daysToExpiry <= 30 && (
                  <span className="px-2 py-0.5 bg-amber-500 text-white rounded-full text-[9px] font-black uppercase">
                    Expires in {daysToExpiry}d
                  </span>
                )}
              </div>
              <div className="bg-white/80 rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Carrier</span><span className="font-bold">{pol.carrier}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Policy #</span><span className="font-bold">{pol.policy_number}</span></div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Expires</span>
                  <span className="font-bold">
                    {new Date(pol.expiration_date + 'T00:00:00').toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ACTION GRID */}
        <div className="grid grid-cols-3 gap-4">

          {/* FIX ISSUE BUTTON */}
          <button
             onClick={() => setIsTicketModalOpen(true)}
             className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-orange-300 transition-colors flex flex-col items-center justify-center gap-3 relative group"
          >
            {data.open_tickets_count > 0 && (
                <div className="absolute top-3 right-3 bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {data.open_tickets_count} Active
                </div>
            )}
            <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <Wrench size={24} />
            </div>
            <span className="font-semibold text-sm text-slate-700">Request Repair</span>
          </button>

          <button
            onClick={handleDownloadLease}
            disabled={isLeaseDownloading || !data?.lease?.id}
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-blue-300 transition-colors flex flex-col items-center justify-center gap-3 group disabled:opacity-50"
          >
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              {isLeaseDownloading ? <Loader2 size={24} className="animate-spin" /> : <FileText size={24} />}
            </div>
            <span className="font-semibold text-sm text-slate-700">
              {isLeaseDownloading ? 'Downloading...' : 'Lease Docs'}
            </span>
          </button>

          <Link
            href="/portal/documents"
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-300 transition-colors flex flex-col items-center justify-center gap-3 group"
          >
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <FolderOpen size={24} />
            </div>
            <span className="font-semibold text-sm text-slate-700">Documents</span>
          </Link>

          <Link
            href="/portal/inspections"
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-violet-300 transition-colors flex flex-col items-center justify-center gap-3 group"
          >
            <div className="w-12 h-12 bg-violet-100 text-violet-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <ClipboardCheck size={24} />
            </div>
            <span className="font-semibold text-sm text-slate-700">Inspections</span>
          </Link>

          <Link
            href="/portal/messages"
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-300 transition-colors flex flex-col items-center justify-center gap-3 group"
          >
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <MessageSquare size={24} />
            </div>
            <span className="font-semibold text-sm text-slate-700">Messages</span>
          </Link>
        </div>

        {/* REPAIR UPDATES */}
        {repairUpdates.length > 0 && (
          <div className="mt-8">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Wrench size={16} className="text-orange-500" />
              Repair Updates
            </h3>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {repairUpdates.map((n) => (
                <div key={n.id} className="p-4 flex items-start gap-3">
                  <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{n.description}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RECENT PAYMENTS */}
        <div className="mt-8">
          <h3 className="font-bold text-slate-800 mb-4 flex items-center justify-between">
             Recent Payments
             <span className="text-xs font-normal text-slate-400">Last 6 entries</span>
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {data.recent_payments.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">No recent payments found.</div>
            ) : (
                data.recent_payments.map((tx, i) => (
                    <div key={i} className="p-4 flex justify-between items-center hover:bg-slate-50 transition">
                      <div>
                        <div className="font-medium text-sm text-slate-900">{tx.description || 'Payment'}</div>
                        <div className="text-xs text-slate-400">{new Date(tx.date).toLocaleDateString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm text-slate-900">
                             {/* Payments are outgoing for tenant, so negative visual */}
                            -{currencyFormatter.format(tx.amount)}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase">{tx.status}</div>
                      </div>
                    </div>
                ))
            )}
          </div>
        </div>

        </>
        )}

      </main>

      {/* QUICK TICKET MODAL */}
      <QuickTicketModal
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
        onSuccess={() => { window.location.reload() }}
        tenantName={data.tenant.first_name}
        tenantId={data.tenant.id}
        unitId={data.unit.id}
        unitName={data.unit.name}
      />

      {/* MAKE PAYMENT MODAL */}
      <MakePaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={() => { refreshLedger(); refreshPayments() }}
        rentAmount={data.lease.rent_amount}
        tenantName={`${data.tenant.first_name} ${data.tenant.last_name}`}
        leaseId={data.lease.id}
      />

      {/* RENEWAL ACCEPT MODAL */}
      <RenewalAcceptModal
        isOpen={isRenewalModalOpen}
        onClose={() => setIsRenewalModalOpen(false)}
        onAccepted={() => { window.location.reload() }}
        renewal={pendingRenewal}
        tenantName={`${data.tenant.first_name} ${data.tenant.last_name}`}
      />

      {/* LEASE SIGN MODAL */}
      <LeaseSignModal
        isOpen={isSignModalOpen}
        onClose={() => setIsSignModalOpen(false)}
        onSigned={() => { window.location.reload() }}
        signature={pendingSignature}
        tenantName={`${data.tenant.first_name} ${data.tenant.last_name}`}
      />

      {/* SAVE CARD MODAL */}
      <SaveCardModal isOpen={showSaveCard} onClose={() => setShowSaveCard(false)} />

      {/* AUTOPAY SETTINGS MODAL */}
      <AutopaySettingsModal isOpen={showAutopay} onClose={() => setShowAutopay(false)} leaseId={data?.lease?.id || ''} savedCards={savedCards || []} />
    </>
  );
}

// --- SUB-COMPONENT: Quick Maintenance Request ---
type QuickTicketModalProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  tenantName: string
  tenantId: string
  unitId: string
  unitName: string
}

function QuickTicketModal({ isOpen, onClose, onSuccess, tenantName, tenantId, unitId, unitName }: QuickTicketModalProps) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [photos, setPhotos] = useState<File[]>([])
    const [photoUrls, setPhotoUrls] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Reset state when modal opens/closes & clean up blob URLs
    useEffect(() => {
      if (isOpen) {
        setTitle('')
        setDescription('')
        setError(null)
        setLoading(false)
        setPhotos([])
        setPhotoUrls([])
      }
      return () => {
        photoUrls.forEach(url => URL.revokeObjectURL(url))
      }
    }, [isOpen])

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      const valid = files.filter(f =>
        ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 10 * 1024 * 1024
      )
      const newPhotos = [...photos, ...valid].slice(0, 3)
      setPhotos(newPhotos)
      // Create and track blob URLs for previews
      photoUrls.forEach(url => URL.revokeObjectURL(url))
      setPhotoUrls(newPhotos.map(f => URL.createObjectURL(f)))
      if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const removePhoto = (index: number) => {
      URL.revokeObjectURL(photoUrls[index])
      setPhotos(prev => prev.filter((_, i) => i !== index))
      setPhotoUrls(prev => prev.filter((_, i) => i !== index))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        // Get the authenticated user to set requester_id
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            setError('Session expired. Please log in again.')
            setLoading(false)
            return
        }

        // Insert into work_orders with all proper FK references
        // profiles.id = auth.users.id (1:1), so user.id is the requester_id
        const { data: workOrder, error: insertError } = await supabase
            .from('work_orders')
            .insert({
                title,
                description: description || title,
                priority: 'Normal',
                status: 'Open',
                unit_id: unitId,
                tenant_id: tenantId,
                requester_id: user.id,
            })
            .select('id')
            .single()

        if (insertError) {
            setError('Failed to submit: ' + insertError.message)
            setLoading(false)
            return
        }

        // Upload photos
        if (photos.length > 0 && workOrder) {
          for (const file of photos) {
            const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
            const filePath = `${workOrder.id}/${crypto.randomUUID()}.${ext}`
            const { error: upErr } = await supabase.storage
              .from('maintenance-images')
              .upload(filePath, file, { contentType: file.type })
            if (!upErr) {
              await supabase.from('work_order_images').insert({
                work_order_id: workOrder.id,
                file_path: filePath,
                file_name: file.name,
                file_size: file.size,
                uploaded_by: user.id,
              })
            }
          }
        }

        // Clean up blob URLs before clearing
        photoUrls.forEach(url => URL.revokeObjectURL(url))
        setPhotos([])
        setPhotoUrls([])
        setLoading(false)
        onSuccess()
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 animate-in slide-in-from-bottom duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-900">Request Repair</h2>
                    <button onClick={onClose} aria-label="Close"><X className="text-slate-400" /></button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-xl flex gap-3 items-start">
                        <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-800">
                            Hi <strong>{tenantName}</strong>, describing the issue clearly helps us fix <strong>Unit {unitName}</strong> faster.
                        </div>
                    </div>

                    <div>
                        <label htmlFor="ticket-title" className="block text-sm font-medium text-slate-700 mb-1">What&apos;s wrong?</label>
                        <input
                            id="ticket-title"
                            autoFocus
                            placeholder="e.g. Leaky faucet in bathroom"
                            className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="ticket-desc" className="block text-sm font-medium text-slate-700 mb-1">Details (optional)</label>
                        <textarea
                            id="ticket-desc"
                            placeholder="Any additional details about the issue..."
                            className="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 resize-none h-20"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>

                    {/* Photo Upload */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Photos <span className="text-slate-400 text-xs">({photos.length}/3)</span>
                      </label>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
                      {photos.length > 0 && (
                        <div className="flex gap-2 mb-2">
                          {photos.map((p, i) => (
                            <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-200 group">
                              <img src={photoUrls[i]} alt="" className="w-full h-full object-cover" />
                              <button type="button" onClick={() => removePhoto(i)} className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-100 transition">
                                <X size={8} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {photos.length < 3 && (
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-400 hover:border-blue-300 hover:text-blue-500 transition flex items-center justify-center gap-2">
                          <Camera size={16} /> Add Photos
                        </button>
                      )}
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs font-bold text-red-600">
                            {error}
                        </div>
                    )}

                    <button
                        disabled={loading}
                        className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : 'Submit Request'}
                    </button>
                </form>
            </div>
        </div>
    )
}

// --- SUB-COMPONENT: Make Payment Modal ---
type MakePaymentModalProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  rentAmount: number
  tenantName: string
  leaseId: string
}

function MakePaymentModal({ isOpen, onClose, onSuccess, rentAmount, tenantName, leaseId }: MakePaymentModalProps) {
  if (!isOpen) return null

  return (
    <StripeProvider>
      <PaymentForm
        onClose={onClose}
        onSuccess={onSuccess}
        rentAmount={rentAmount}
        tenantName={tenantName}
        leaseId={leaseId}
      />
    </StripeProvider>
  )
}

// Inner component that uses Stripe hooks (must be inside <Elements>)
function PaymentForm({
  onClose,
  onSuccess,
  rentAmount,
  tenantName,
  leaseId,
}: Omit<MakePaymentModalProps, 'isOpen'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState(String(rentAmount))
  const [resultData, setResultData] = useState<{ card_brand?: string; card_last4?: string; amount?: number } | null>(null)

  // Reset state when component mounts
  useEffect(() => {
    setAmount(String(rentAmount))
    setSuccess(false)
    setError(null)
  }, [rentAmount])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!stripe || !elements) {
      setError('Payment system is loading. Please wait a moment.')
      return
    }

    const numAmount = Number(amount)
    if (!amount || numAmount <= 0) {
      setError('Please enter a valid payment amount.')
      return
    }

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      setError('Card input not available. Please refresh and try again.')
      return
    }

    setLoading(true)

    try {
      // 1. Create a PaymentMethod from the card element
      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: { name: tenantName },
      })

      if (pmError || !paymentMethod) {
        setError(pmError?.message || 'Failed to process card details.')
        setLoading(false)
        return
      }

      // 2. Call the process-payment edge function
      const { data: body, error: fnError } = await supabase.functions.invoke('process-payment', {
        body: {
          lease_id: leaseId,
          amount: numAmount,
          payment_method_id: paymentMethod.id,
        },
      })

      if (fnError) {
        let msg = 'Payment failed'
        if (fnError instanceof FunctionsHttpError) {
          const errBody = await fnError.context.json().catch(() => null)
          msg = errBody?.error || errBody?.msg || msg
        } else {
          msg = fnError.message || msg
        }
        setError(msg)
        setLoading(false)
        return
      }

      // 3. Payment succeeded!
      setResultData({
        card_brand: body.card_brand,
        card_last4: body.card_last4,
        amount: numAmount,
      })
      setSuccess(true)

      // Auto-close after showing success
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 2500)
    } catch (err: any) {
      setError(err.message || 'Payment processing failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">

        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <CreditCard size={20} />
              Make Payment
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">Secure card payment powered by Stripe</p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="text-slate-400 hover:text-white transition-colors" size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-10 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">Payment Submitted!</h3>
            <p className="text-slate-500 text-sm">
              ${(resultData?.amount ?? Number(amount)).toLocaleString('en-US', { minimumFractionDigits: 2 })} payment is being processed.
            </p>
            {resultData?.card_brand && resultData?.card_last4 && (
              <p className="text-slate-400 text-xs mt-1">
                {resultData.card_brand.charAt(0).toUpperCase() + resultData.card_brand.slice(1)} ending in {resultData.card_last4}
              </p>
            )}
            <p className="text-slate-400 text-xs mt-2">You will receive a confirmation email shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Payment Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full pl-8 pr-4 py-3 border border-slate-300 rounded-xl text-lg font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Stripe Card Element */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Card Details</label>
              <div className="px-4 py-3.5 border border-slate-300 rounded-xl bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
                <CardElement
                  options={{
                    style: {
                      base: {
                        fontSize: '16px',
                        color: '#0f172a',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        '::placeholder': { color: '#94a3b8' },
                      },
                      invalid: { color: '#dc2626' },
                    },
                    hidePostalCode: false,
                  }}
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
                {error}
              </div>
            )}

            {/* Security Notice */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Lock size={14} />
              <span>Your payment info is encrypted and secure.</span>
              <ShieldCheck size={14} className="ml-auto text-emerald-500" />
            </div>

            <button
              type="submit"
              disabled={loading || !stripe}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Processing...
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Pay ${amount ? Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}