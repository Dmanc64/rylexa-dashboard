'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useTenantLedger } from '@/hooks/useTenantLedger'
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Home,
  Calendar,
  User,
  FileText,
  Loader2,
  AlertCircle,
  MapPin,
  Briefcase,
  StickyNote,
  History,
} from 'lucide-react'

type Tenant = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  status: string | null
  birthdate: string | null
  mailing_address_1: string | null
  mailing_address_2: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  company_name: string | null
  tenant_type: string | null
  notes: string | null
  pets: string | null
  tags: string | null
  created_at: string
}

type LeaseRow = {
  id: string
  rent_amount: number | null
  security_deposit: number | null
  start_date: string | null
  end_date: string | null
  status: string | null
  prorated_rent: number | null
  utility_fee: number | null
  tenant_portion: number | null
  subsidy_amount: number | null
  units:
    | {
        id: string
        name: string | null
        properties: { id: string; name: string | null } | null
      }
    | null
}

const formatCurrency = (n: number | null | undefined) => {
  const v = Number(n) || 0
  const sign = v < 0 ? '-' : ''
  return (
    sign +
    '$' +
    Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

const formatDate = (d: string | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return d
  }
}

const statusColor = (status: string | null) => {
  switch (status) {
    case 'Active':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'Past':
      return 'bg-slate-100 text-slate-600 border-slate-200'
    case 'Lead':
      return 'bg-amber-100 text-amber-700 border-amber-200'
    default:
      return 'bg-slate-100 text-slate-500 border-slate-200'
  }
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [leases, setLeases] = useState<LeaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function fetchAll() {
      setLoading(true)
      setNotFound(false)

      const { data: tData, error: tErr } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (cancelled) return

      if (tErr || !tData) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setTenant(tData as Tenant)

      const { data: lData } = await supabase
        .from('leases')
        .select(
          `id, rent_amount, security_deposit, start_date, end_date, status,
           prorated_rent, utility_fee, tenant_portion, subsidy_amount,
           units ( id, name, properties ( id, name ) )`
        )
        .eq('tenant_id', id)
        .order('start_date', { ascending: false })

      if (cancelled) return
      setLeases((lData as any) ?? [])
      setLoading(false)
    }

    fetchAll()
    return () => {
      cancelled = true
    }
  }, [id])

  const activeLease =
    leases.find((l) => l.status === 'Active') ?? leases[0] ?? null

  const { entries, balance, loading: ledgerLoading } = useTenantLedger(
    activeLease?.id
  )

  // ─────────────────────────────────────────────────────────────
  // Loading / not-found states
  // ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <Loader2 className="animate-spin text-emerald-500 mx-auto mb-4" size={32} />
          <p className="text-slate-400 text-sm font-medium">Loading resident...</p>
        </div>
      </div>
    )
  }

  if (notFound || !tenant) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Residents
        </Link>
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={32} />
          </div>
          <h3 className="text-xl font-black italic uppercase text-slate-900">
            Resident Not Found
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-2 max-w-md mx-auto">
            We couldn&apos;t find a resident with id <code className="text-slate-600">{id}</code>.
            They may have been removed, or you may not have access.
          </p>
        </div>
      </div>
    )
  }

  const fullName =
    [tenant.first_name, tenant.last_name].filter(Boolean).join(' ').trim() ||
    'Unnamed Resident'
  const propertyName = activeLease?.units?.properties?.name ?? null
  const unitName = activeLease?.units?.name ?? null
  const recentEntries = (entries ?? []).slice(0, 10)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-in fade-in">

      {/* Back link */}
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Residents
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-2">
            Resident Profile
          </p>
          <h1 className="text-4xl font-black italic uppercase text-slate-900">
            {fullName}
          </h1>
          <div className="flex items-center gap-3 mt-3">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${statusColor(
                tenant.status
              )}`}
            >
              {tenant.status ?? 'Unknown'}
            </span>
            {tenant.tenant_type && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {tenant.tenant_type}
              </span>
            )}
            {tenant.company_name && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <Briefcase size={12} /> {tenant.company_name}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {activeLease && (
            <Link href={`/admin/leases?lease=${activeLease.id}`}>
              <button className="px-5 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2">
                <FileText size={14} /> View Full Ledger
              </button>
            </Link>
          )}
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column: Contact + Personal */}
        <div className="lg:col-span-1 space-y-6">

          {/* Contact card */}
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Contact
            </h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                  <Mail size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Email
                  </p>
                  <p className="text-sm font-bold text-slate-900 break-all">
                    {tenant.email && tenant.email !== 'nan' ? tenant.email : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                  <Phone size={14} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Phone
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {tenant.phone || '—'}
                  </p>
                </div>
              </div>
              {(tenant.mailing_address_1 || tenant.mailing_city) && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                    <MapPin size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Mailing Address
                    </p>
                    <p className="text-sm font-bold text-slate-900">
                      {tenant.mailing_address_1}
                      {tenant.mailing_address_2 ? `, ${tenant.mailing_address_2}` : ''}
                    </p>
                    <p className="text-sm font-medium text-slate-600">
                      {[tenant.mailing_city, tenant.mailing_state, tenant.mailing_zip]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Personal info card */}
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Personal
            </h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                  <Calendar size={14} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Date of Birth
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {formatDate(tenant.birthdate)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center flex-shrink-0">
                  <User size={14} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    On File Since
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {formatDate(tenant.created_at)}
                  </p>
                </div>
              </div>
              {tenant.pets && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Pets
                  </p>
                  <p className="text-sm font-bold text-slate-900">{tenant.pets}</p>
                </div>
              )}
              {tenant.tags && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Tags
                  </p>
                  <p className="text-sm font-bold text-slate-900">{tenant.tags}</p>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {tenant.notes && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-3">
              <div className="flex items-center gap-2">
                <StickyNote size={14} className="text-slate-400" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Notes
                </h2>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {tenant.notes}
              </p>
            </div>
          )}
        </div>

        {/* Right column: Lease + Ledger */}
        <div className="lg:col-span-2 space-y-6">

          {/* Active lease card */}
          {activeLease ? (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {activeLease.status === 'Active' ? 'Active Lease' : 'Most Recent Lease'}
                </h2>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                    activeLease.status === 'Active'
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {activeLease.status ?? 'Unknown'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    <Building2 size={11} /> Property
                  </div>
                  <p className="text-sm font-black text-slate-900">
                    {propertyName ?? '—'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    <Home size={11} /> Unit
                  </div>
                  <p className="text-sm font-black text-slate-900">
                    {unitName ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Monthly Rent
                  </p>
                  <p className="text-sm font-black text-slate-900 font-mono">
                    {formatCurrency(activeLease.rent_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Current Balance
                  </p>
                  <p
                    className={`text-sm font-black font-mono ${
                      (balance ?? 0) > 0
                        ? 'text-amber-600'
                        : (balance ?? 0) < 0
                        ? 'text-emerald-600'
                        : 'text-slate-900'
                    }`}
                  >
                    {ledgerLoading ? '...' : formatCurrency(balance)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Term
                  </p>
                  <p className="text-xs font-bold text-slate-700">
                    {formatDate(activeLease.start_date)} → {formatDate(activeLease.end_date)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Deposit
                  </p>
                  <p className="text-xs font-bold text-slate-700 font-mono">
                    {formatCurrency(activeLease.security_deposit)}
                  </p>
                </div>
                {(activeLease.utility_fee ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Utility Fee
                    </p>
                    <p className="text-xs font-bold text-slate-700 font-mono">
                      {formatCurrency(activeLease.utility_fee)}
                    </p>
                  </div>
                )}
                {(activeLease.subsidy_amount ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Subsidy
                    </p>
                    <p className="text-xs font-bold text-slate-700 font-mono">
                      {formatCurrency(activeLease.subsidy_amount)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8 text-center">
              <p className="text-slate-400 text-sm font-medium">
                No leases on record for this resident.
              </p>
            </div>
          )}

          {/* Recent ledger */}
          {activeLease && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Recent Activity
                </h2>
                <Link
                  href={`/admin/leases?lease=${activeLease.id}`}
                  className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700"
                >
                  View All →
                </Link>
              </div>
              {ledgerLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="animate-spin text-emerald-500 mx-auto" size={20} />
                </div>
              ) : recentEntries.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400 font-medium">
                  No ledger entries yet.
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Description</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {recentEntries.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 text-xs font-bold text-slate-700">
                          {formatDate(e.created_at)}
                        </td>
                        <td className="px-6 py-3 text-xs font-bold text-slate-900">
                          {e.type}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-600 max-w-xs truncate">
                          {e.description}
                        </td>
                        <td
                          className={`px-6 py-3 text-xs font-bold text-right font-mono ${
                            e.type === 'Payment' || e.type === 'Credit'
                              ? 'text-emerald-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {formatCurrency(e.amount)}
                        </td>
                        <td className="px-6 py-3 text-xs font-bold text-right font-mono text-slate-700">
                          {formatCurrency(e.running_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Lease history (if more than one) */}
          {leases.length > 1 && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                <History size={14} className="text-slate-400" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Lease History
                </h2>
              </div>
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-6 py-3">Property / Unit</th>
                    <th className="px-6 py-3">Term</th>
                    <th className="px-6 py-3">Rent</th>
                    <th className="px-6 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {leases.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3">
                        <p className="text-xs font-black text-slate-900">
                          {l.units?.properties?.name ?? '—'}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          Unit {l.units?.name ?? '—'}
                        </p>
                      </td>
                      <td className="px-6 py-3 text-xs font-bold text-slate-700">
                        {formatDate(l.start_date)} → {formatDate(l.end_date)}
                      </td>
                      <td className="px-6 py-3 text-xs font-bold font-mono text-slate-700">
                        {formatCurrency(l.rent_amount)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                            l.status === 'Active'
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {l.status ?? 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
