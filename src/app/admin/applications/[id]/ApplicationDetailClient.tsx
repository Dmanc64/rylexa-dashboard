'use client'

/**
 * Admin/PM review screen for the v2 application schema.
 *
 * Renders every section of an application as a compact card:
 *   - Header: name, status, property/unit, top-line stats
 *   - Identity, Contact, Residential, Personal, Financial, Income,
 *     Household, Emergency, Screening, Notes, Attachments, Co-Applicants
 *
 * Actions:
 *   - Download attachment (signed URL, 5-min)
 *   - Resend co-applicant invite (re-fires the email)
 *
 * Approve / Deny / Preapprove actions intentionally stay on the existing
 * /admin/applications list page since they integrate with screening and
 * tenant-build flows that haven't moved to v2 yet.
 */

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, Download, Mail as MailIcon, RefreshCw, Loader2,
  User, Phone as PhoneIcon, MapPin, CreditCard, Briefcase, Users,
  HelpCircle, Paperclip, StickyNote, Calendar, Building2, Home,
  CheckCircle2, XCircle, MinusCircle,
} from 'lucide-react'
import {
  getAttachmentSignedUrl,
  resendCoApplicantInvite,
} from '@/actions/application-actions-v2'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

type Attachment = {
  id: string
  application_id: string
  coapplicant_id: string | null
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  label: string | null
  uploaded_at: string
}

type CoApplicant = {
  id: string
  full_name: string
  email: string
  phone: string | null
  applicant_type: string
  status: string
  invite_sent_at: string | null
  submitted_at: string | null
  date_of_birth: string | null
  ssn_last_4: string | null
  current_street_1: string | null
  current_city: string | null
  current_state: string | null
  employer: string | null
  monthly_salary: number | null
  q_delinquent_payment: boolean | null
  q_felony_conviction: boolean | null
  q_sued_landlord: boolean | null
  q_water_filled_furniture: boolean | null
  q_smoker: boolean | null
  notes: string | null
}

type ApplicationData = {
  application: {
    id: string
    unit_id: string | null
    status: string | null
    created_at: string
    submitted_at: string | null
    draft_email: string | null
    first_name: string | null
    middle_name: string | null
    last_name: string | null
    salutation: string | null
    suffix: string | null
    no_middle_name_certified: boolean | null
    applicant_type: string | null
    company_name: string | null
    use_company_as_display_name: boolean | null
    desired_move_in: string | null
    date_of_birth: string | null
    ssn_last_4: string | null
    gov_id_issuing_state: string | null
    employer: string | null
    employer_phone: string | null
    employer_address: string | null
    employer_address_2: string | null
    position_held: string | null
    years_worked: number | null
    supervisor_name: string | null
    supervisor_title: string | null
    supervisor_email: string | null
    monthly_salary: number | null
    income: number | null
    annual_income: number | null
    q_delinquent_payment: boolean | null
    q_felony_conviction: boolean | null
    q_sued_landlord: boolean | null
    q_water_filled_furniture: boolean | null
    q_smoker: boolean | null
    notes: string | null
    email: string | null
    phone: string | null
    screening_score: number | null
    screening_status: string | null
    credit_score: number | null
    property_name: string | null
    unit_name: string | null
  }
  phones: Array<{ label: string | null; phone_number: string; is_primary: boolean | null }>
  emails: Array<{ email: string; is_primary: boolean | null }>
  addresses: Array<{
    kind: string
    street_1: string | null; street_2: string | null
    city: string | null; state: string | null; postal_code: string | null
    occupancy_type: string | null
    resided_from: string | null; resided_to: string | null
    monthly_payment: number | null
    landlord_name: string | null; landlord_phone: string | null; landlord_email: string | null
    reason_for_leaving: string | null
  }>
  dependents: Array<{ first_name: string; last_name: string; date_of_birth: string | null; relationship: string | null }>
  pets: Array<{ name: string | null; type_breed: string | null; weight_lbs: number | null; age_years: number | null }>
  bank_accounts: Array<{ bank_name: string; account_type: string | null; account_last4: string | null; balance: number | null }>
  credit_cards: Array<{ issuer: string | null; balance: number | null }>
  additional_income: Array<{ source: string | null; monthly_amount: number | null }>
  emergency_contacts: Array<{ name: string | null; address: string | null; phone: string | null; email: string | null; relationship: string | null }>
  coapplicants: CoApplicant[]
  attachments: Attachment[]
}

// ────────────────────────────────────────────────────────────────────────────
// FORMATTING HELPERS
// ────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n) || 0
  return '$' + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return d }
}
const fmtYesNo = (v: boolean | null | undefined) => v === true ? 'Yes' : v === false ? 'No' : '—'
const fmtBytes = (n: number | null | undefined) => {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const statusColor = (status: string | null) => {
  switch (status) {
    case 'Submitted':
    case 'Approved':  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'Preapproved': return 'bg-indigo-100 text-indigo-700 border-indigo-200'
    case 'Pending':   return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'Denied':
    case 'Declined':  return 'bg-red-100 text-red-700 border-red-200'
    case 'Draft':     return 'bg-slate-100 text-slate-500 border-slate-200'
    case 'Started':   return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'Invited':   return 'bg-slate-100 text-slate-600 border-slate-200'
    default:          return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────

export function ApplicationDetailClient({ data }: { data: ApplicationData }) {
  const a = data.application
  const fullName =
    [a.salutation, a.first_name, a.middle_name, a.last_name, a.suffix]
      .filter(Boolean).join(' ').trim() || 'Unnamed Applicant'

  // The application uses v2 schema if any of these are set
  const isV2 = !!(
    a.applicant_type || a.salutation || a.no_middle_name_certified ||
    data.phones.length || data.emails.length || data.addresses.length ||
    data.bank_accounts.length || data.coapplicants.length || data.attachments.length
  )

  const primaryAttachments = data.attachments.filter((x) => !x.coapplicant_id)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 animate-in fade-in">

      {/* Back link */}
      <Link
        href="/admin/applications"
        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Applications
      </Link>

      {/* Header */}
      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-2">
              Application Review {!isV2 && <span className="ml-2 text-amber-600">· Legacy schema</span>}
            </p>
            <h1 className="text-3xl font-black italic uppercase text-slate-900">{fullName}</h1>
            <div className="flex items-center flex-wrap gap-3 mt-3">
              <span className={`inline-flex items-center px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${statusColor(a.status)}`}>
                {a.status ?? 'Unknown'}
              </span>
              {a.applicant_type && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {a.applicant_type}
                </span>
              )}
              {a.property_name && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <Building2 size={12} /> {a.property_name}
                  {a.unit_name && <> — Unit {a.unit_name}</>}
                </span>
              )}
              {a.company_name && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <Briefcase size={12} /> {a.company_name}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {a.submitted_at ? 'Submitted' : 'Started'}
            </p>
            <p className="text-sm font-black text-slate-900">{fmtDate(a.submitted_at ?? a.created_at)}</p>
            {a.desired_move_in && (
              <p className="text-[10px] font-bold text-slate-500 mt-1">Move-in {fmtDate(a.desired_move_in)}</p>
            )}
          </div>
        </div>

        {/* Top-line stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
          <Stat label="Monthly Salary" value={fmtCurrency(a.monthly_salary ?? a.income)} />
          <Stat label="Additional Income" value={fmtCurrency(data.additional_income.reduce((s, x) => s + (Number(x.monthly_amount) || 0), 0))} />
          <Stat label="Credit Score" value={a.credit_score != null ? String(a.credit_score) : '—'} />
          <Stat label="Co-Applicants" value={String(data.coapplicants.length)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT — Identity, Contact, Personal */}
        <div className="space-y-6">

          <Section title="Identity" icon={User}>
            <KV label="Legal Name" value={fullName} />
            {a.applicant_type && <KV label="Applicant Type" value={a.applicant_type} />}
            {a.no_middle_name_certified && (
              <KV label="Middle Name" value="None (certified)" />
            )}
            {a.company_name && (
              <>
                <KV label="Company" value={a.company_name} />
                {a.use_company_as_display_name && (
                  <KV label="Display Name" value="Company name" />
                )}
              </>
            )}
          </Section>

          <Section title="Contact" icon={PhoneIcon}>
            {data.emails.length > 0 ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Emails</p>
                {data.emails.map((e, i) => (
                  <p key={i} className="text-sm font-bold text-slate-900 break-all">
                    {e.email}
                    {e.is_primary && <span className="ml-2 text-[10px] font-bold text-emerald-600">PRIMARY</span>}
                  </p>
                ))}
              </div>
            ) : a.email && a.email !== 'nan' && (
              <KV label="Email" value={a.email} />
            )}

            {data.phones.length > 0 ? (
              <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Phones</p>
                {data.phones.map((p, i) => (
                  <p key={i} className="text-sm font-bold text-slate-900">
                    {p.label && <span className="text-slate-500 mr-2">{p.label}:</span>}
                    {p.phone_number}
                    {p.is_primary && <span className="ml-2 text-[10px] font-bold text-emerald-600">PRIMARY</span>}
                  </p>
                ))}
              </div>
            ) : a.phone && (
              <KV label="Phone" value={a.phone} />
            )}
          </Section>

          <Section title="Personal" icon={Calendar}>
            <KV label="Date of Birth" value={fmtDate(a.date_of_birth)} />
            <KV label="SSN on file" value={a.ssn_last_4 ? `••• •• ${a.ssn_last_4}` : '—'} />
            <KV label="Gov ID State" value={a.gov_id_issuing_state ?? '—'} />
          </Section>

          {(data.emergency_contacts[0]) && (
            <Section title="Emergency Contact" icon={PhoneIcon}>
              <KV label="Name" value={data.emergency_contacts[0].name ?? '—'} />
              <KV label="Relationship" value={data.emergency_contacts[0].relationship ?? '—'} />
              <KV label="Phone" value={data.emergency_contacts[0].phone ?? '—'} />
              <KV label="Email" value={data.emergency_contacts[0].email ?? '—'} />
              <KV label="Address" value={data.emergency_contacts[0].address ?? '—'} />
            </Section>
          )}
        </div>

        {/* MIDDLE — Residential, Household, Screening */}
        <div className="space-y-6">

          <Section title="Residential History" icon={MapPin}>
            {data.addresses.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No addresses on file.</p>
            ) : (
              data.addresses.map((addr, i) => (
                <div key={i} className={`${i > 0 ? 'mt-4 pt-4 border-t border-slate-100' : ''}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-1">
                    {addr.kind === 'current' ? 'Current' : 'Previous'}
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {[addr.street_1, addr.street_2].filter(Boolean).join(', ') || '—'}
                  </p>
                  <p className="text-sm text-slate-600">
                    {[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    {addr.resided_from && (
                      <span className="text-slate-500">
                        {fmtDate(addr.resided_from)} → {fmtDate(addr.resided_to) || 'present'}
                      </span>
                    )}
                    {addr.monthly_payment != null && (
                      <span className="text-slate-500">{fmtCurrency(addr.monthly_payment)}/mo</span>
                    )}
                    {addr.occupancy_type && (
                      <span className="text-slate-500">{addr.occupancy_type}</span>
                    )}
                  </div>
                  {(addr.landlord_name || addr.landlord_phone) && (
                    <p className="text-xs text-slate-500 mt-1">
                      Landlord: {addr.landlord_name ?? '—'}{addr.landlord_phone && ` · ${addr.landlord_phone}`}
                    </p>
                  )}
                  {addr.reason_for_leaving && (
                    <p className="text-xs text-slate-500 mt-1">Reason: {addr.reason_for_leaving}</p>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section title="Household" icon={Users}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Dependents ({data.dependents.length})
              </p>
              {data.dependents.length === 0 ? (
                <p className="text-sm text-slate-400 italic">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.dependents.map((d, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-bold">{d.first_name} {d.last_name}</span>
                      {d.relationship && <span className="text-slate-500"> · {d.relationship}</span>}
                      {d.date_of_birth && <span className="text-slate-400"> · {fmtDate(d.date_of_birth)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Pets ({data.pets.length})
              </p>
              {data.pets.length === 0 ? (
                <p className="text-sm text-slate-400 italic">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.pets.map((p, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-bold">{p.name ?? 'Unnamed'}</span>
                      {p.type_breed && <span className="text-slate-500"> · {p.type_breed}</span>}
                      {p.weight_lbs != null && <span className="text-slate-400"> · {p.weight_lbs} lb</span>}
                      {p.age_years != null && <span className="text-slate-400"> · {p.age_years} yr</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Screening" icon={HelpCircle}>
            <ScreeningGrid app={a} />
          </Section>
        </div>

        {/* RIGHT — Financial, Income, Attachments */}
        <div className="space-y-6">

          <Section title="Financial" icon={CreditCard}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Bank Accounts ({data.bank_accounts.length})
              </p>
              {data.bank_accounts.length === 0 ? (
                <p className="text-sm text-slate-400 italic">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.bank_accounts.map((b, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-bold">{b.bank_name}</span>
                      {b.account_type && <span className="text-slate-500"> · {b.account_type}</span>}
                      {b.account_last4 && <span className="text-slate-400"> · ••{b.account_last4}</span>}
                      {b.balance != null && <span className="font-mono text-slate-700 ml-2">{fmtCurrency(b.balance)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Credit Cards ({data.credit_cards.length})
              </p>
              {data.credit_cards.length === 0 ? (
                <p className="text-sm text-slate-400 italic">None</p>
              ) : (
                <ul className="space-y-1">
                  {data.credit_cards.map((c, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-bold">{c.issuer ?? '—'}</span>
                      {c.balance != null && <span className="font-mono text-slate-700 ml-2">{fmtCurrency(c.balance)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Income & Employment" icon={Briefcase}>
            <KV label="Employer" value={a.employer ?? '—'} />
            {a.position_held && <KV label="Position" value={a.position_held} />}
            {a.years_worked != null && <KV label="Years" value={String(a.years_worked)} />}
            <KV label="Monthly Salary" value={fmtCurrency(a.monthly_salary ?? a.income)} />
            {a.employer_phone && <KV label="Employer Phone" value={a.employer_phone} />}
            {a.supervisor_name && <KV label="Supervisor" value={`${a.supervisor_name}${a.supervisor_title ? ` (${a.supervisor_title})` : ''}`} />}
            {a.supervisor_email && <KV label="Supervisor Email" value={a.supervisor_email} />}

            {data.additional_income.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  Additional Income ({data.additional_income.length})
                </p>
                <ul className="space-y-1">
                  {data.additional_income.map((inc, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className="font-bold">{inc.source ?? '—'}</span>
                      {inc.monthly_amount != null && <span className="font-mono ml-2">{fmtCurrency(inc.monthly_amount)}/mo</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <AttachmentsCard attachments={primaryAttachments} title="Primary Applicant Documents" />
        </div>
      </div>

      {/* CO-APPLICANTS — full-width row */}
      {data.coapplicants.length > 0 && (
        <CoApplicantsSection
          coapplicants={data.coapplicants}
          attachmentsByCoApp={data.attachments}
        />
      )}

      {/* NOTES — full-width row */}
      {a.notes && (
        <Section title="Notes" icon={StickyNote}>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{a.notes}</p>
        </Section>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ────────────────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
      <p className="text-xl font-black text-slate-900 italic font-mono">{value}</p>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center">
          <Icon size={14} />
        </div>
        <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-900 break-words">{value}</p>
    </div>
  )
}

function ScreeningGrid({ app }: { app: ApplicationData['application'] }) {
  const items: Array<{ label: string; value: boolean | null }> = [
    { label: 'Delinquent on rent', value: app.q_delinquent_payment },
    { label: 'Felony conviction', value: app.q_felony_conviction },
    { label: 'Sued by landlord', value: app.q_sued_landlord },
    { label: 'Water-filled furniture', value: app.q_water_filled_furniture },
    { label: 'Smoker', value: app.q_smoker },
  ]
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center justify-between text-sm">
          <span className="text-slate-700">{it.label}</span>
          <span className={`inline-flex items-center gap-1.5 font-bold ${
            it.value === true ? 'text-amber-600' : it.value === false ? 'text-emerald-600' : 'text-slate-400'
          }`}>
            {it.value === true ? <XCircle size={14} /> : it.value === false ? <CheckCircle2 size={14} /> : <MinusCircle size={14} />}
            {fmtYesNo(it.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AttachmentsCard({ attachments, title }: { attachments: Attachment[]; title: string }) {
  const [busy, setBusy] = useState<string | null>(null)

  const onDownload = async (id: string) => {
    setBusy(id)
    const r = await getAttachmentSignedUrl(id)
    setBusy(null)
    if (r.success && r.url) {
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } else {
      toast.error(r.message ?? 'Could not generate download link')
    }
  }

  return (
    <Section title={title} icon={Paperclip}>
      {attachments.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No documents uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li key={a.id} className="bg-slate-50 rounded-lg px-4 py-3 flex items-center gap-3">
              <Paperclip size={14} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{a.file_name}</p>
                <p className="text-[10px] text-slate-400">
                  {a.label ? `${a.label} · ` : ''}
                  {fmtBytes(a.file_size)}
                  {a.uploaded_at && ` · ${fmtDate(a.uploaded_at)}`}
                </p>
              </div>
              <button
                onClick={() => onDownload(a.id)}
                disabled={busy === a.id}
                className="text-slate-500 hover:text-emerald-600 disabled:opacity-50"
                aria-label="Download"
              >
                {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function CoApplicantsSection({
  coapplicants,
  attachmentsByCoApp,
}: {
  coapplicants: CoApplicant[]
  attachmentsByCoApp: Attachment[]
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const onResend = async (id: string) => {
    setBusyId(id)
    const r = await resendCoApplicantInvite(id)
    setBusyId(null)
    if (r.success) toast.success('Invite re-sent.')
    else toast.error(r.message ?? 'Could not resend invite')
  }

  return (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center">
          <Users size={14} />
        </div>
        <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Co-Applicants ({coapplicants.length})
        </h2>
      </div>

      <div className="space-y-4">
        {coapplicants.map((co) => {
          const coAttachments = attachmentsByCoApp.filter((x) => x.coapplicant_id === co.id)
          return (
            <div key={co.id} className="bg-slate-50 rounded-2xl p-5">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-black italic uppercase text-slate-900">{co.full_name}</h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${statusColor(co.status)}`}>
                      {co.status}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {co.applicant_type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {co.email} {co.phone && `· ${co.phone}`}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {co.invite_sent_at ? `Invited ${fmtDate(co.invite_sent_at)}` : 'Not yet invited'}
                    {co.submitted_at ? ` · Submitted ${fmtDate(co.submitted_at)}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {!co.submitted_at && (
                    <button
                      onClick={() => onResend(co.id)}
                      disabled={busyId === co.id}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {busyId === co.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {co.invite_sent_at ? 'Resend' : 'Send'} Invite
                    </button>
                  )}
                  {co.email && (
                    <a
                      href={`mailto:${co.email}`}
                      className="px-3 py-2 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-slate-100 flex items-center gap-1.5"
                    >
                      <MailIcon size={12} /> Email
                    </a>
                  )}
                </div>
              </div>

              {/* Co-applicant detail strip — only if they've started/submitted */}
              {co.status !== 'Invited' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-200/60">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">DOB</p>
                    <p className="text-sm font-bold text-slate-900">{fmtDate(co.date_of_birth)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">SSN</p>
                    <p className="text-sm font-bold text-slate-900">{co.ssn_last_4 ? `••• •• ${co.ssn_last_4}` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Employer</p>
                    <p className="text-sm font-bold text-slate-900">{co.employer ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Salary</p>
                    <p className="text-sm font-bold text-slate-900 font-mono">{fmtCurrency(co.monthly_salary)}</p>
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Address</p>
                    <p className="text-sm font-bold text-slate-900">
                      {[co.current_street_1, co.current_city, co.current_state].filter(Boolean).join(', ') || '—'}
                    </p>
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Screening</p>
                    <CoApplicantScreening co={co} />
                  </div>
                </div>
              )}

              {/* Co-applicant uploaded documents */}
              {coAttachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-200/60">
                  <CoAttachmentsList attachments={coAttachments} />
                </div>
              )}

              {co.notes && (
                <div className="mt-3 pt-3 border-t border-slate-200/60">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Notes</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{co.notes}</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CoApplicantScreening({ co }: { co: CoApplicant }) {
  const flags = [
    co.q_delinquent_payment && 'Delinquent',
    co.q_felony_conviction && 'Felony',
    co.q_sued_landlord && 'Sued',
    co.q_water_filled_furniture && 'Waterbed',
    co.q_smoker && 'Smoker',
  ].filter(Boolean) as string[]

  const answered = [
    co.q_delinquent_payment, co.q_felony_conviction, co.q_sued_landlord,
    co.q_water_filled_furniture, co.q_smoker,
  ].filter((q) => q !== null).length

  if (flags.length === 0) {
    return <p className="text-sm font-bold text-emerald-600">{answered}/5 answered · all clear</p>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest border border-amber-200">
          {f}
        </span>
      ))}
    </div>
  )
}

function CoAttachmentsList({ attachments }: { attachments: Attachment[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const onDownload = async (id: string) => {
    setBusy(id)
    const r = await getAttachmentSignedUrl(id)
    setBusy(null)
    if (r.success && r.url) {
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } else {
      toast.error(r.message ?? 'Could not generate download link')
    }
  }
  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
        <Paperclip size={11} /> {attachments.length} document{attachments.length === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="bg-white rounded-lg px-3 py-2 flex items-center gap-3 border border-slate-200/60">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{a.file_name}</p>
              <p className="text-[10px] text-slate-400">
                {a.label ? `${a.label} · ` : ''}
                {fmtBytes(a.file_size)}
              </p>
            </div>
            <button
              onClick={() => onDownload(a.id)}
              disabled={busy === a.id}
              className="text-slate-500 hover:text-emerald-600 disabled:opacity-50"
            >
              {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

// Unused but kept for symmetry — type-checker still wants the export not flagged
void Home
