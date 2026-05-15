'use client'

/**
 * Multi-step rental application wizard.
 *
 * Architecture:
 *  - Single `state` object mirrors ApplicationDraftPayload from
 *    application-actions-v2.ts. Each step reads/writes its slice.
 *  - Auto-save fires 1.2s after the last edit, calling saveDraft().
 *  - "Save & Continue" on each step forces an immediate save then advances.
 *  - File uploads in step 11 call uploadAttachment via FormData.
 *  - Co-applicants in step 12 use addCoApplicantToDraft / removeCoApplicantFromDraft
 *    (no email is sent until the final submit).
 *  - Submission calls submitApplication, which fires invite emails for any
 *    co-applicants not yet invited.
 *
 * Validation is permissive: required fields are flagged on Review, but
 * applicants can advance freely between steps to save partial drafts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  saveDraft,
  uploadAttachment,
  submitApplication,
  addCoApplicantToDraft,
  removeCoApplicantFromDraft,
  deleteAttachmentFromDraft,
} from '@/actions/application-actions-v2'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Home,
  User,
  Phone as PhoneIcon,
  MapPin,
  CreditCard,
  Briefcase,
  Users,
  HelpCircle,
  Paperclip,
  FileText,
  Building2,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

type Phone = { label?: string; phone_number: string; is_primary?: boolean }
type Email = { email: string; is_primary?: boolean }
type Address = {
  kind: 'current' | 'previous'
  street_1?: string; street_2?: string; city?: string; state?: string
  postal_code?: string; country?: string
  occupancy_type?: string
  resided_from?: string; resided_to?: string
  monthly_payment?: number
  landlord_name?: string; landlord_phone?: string; landlord_email?: string
  reason_for_leaving?: string
}
type Dependent = { first_name: string; last_name: string; date_of_birth?: string; relationship?: string }
type Pet = { name?: string; type_breed?: string; weight_lbs?: number; age_years?: number }
type BankAccount = { bank_name: string; account_type?: string; account_last4?: string; balance?: number }
type CreditCard = { issuer?: string; balance?: number }
type AdditionalIncome = { source?: string; monthly_amount?: number }
type EmergencyContact = { name?: string; address?: string; phone?: string; email?: string; relationship?: string }
type CoApplicant = {
  id: string
  full_name: string
  email: string
  applicant_type: 'Co-Signer' | 'Other Applicant'
  status?: string | null
  invite_sent_at?: string | null
  submitted_at?: string | null
}
type Attachment = {
  id: string
  file_name: string
  file_path: string
  file_size?: number | null
  mime_type?: string | null
  label?: string | null
  uploaded_at: string
}

type WizardState = {
  // Identity
  salutation: string
  legal_first_name: string
  middle_name: string
  no_middle_name_certified: boolean
  suffix: string
  last_name: string
  applicant_type: 'Financially Responsible' | 'Co-Signer' | 'Other Applicant' | ''
  company_name: string
  use_company_as_display_name: boolean

  // Move-in
  desired_move_in: string
  unit_id: string

  // Personal
  date_of_birth: string
  ssn_plaintext: string         // local only; encrypted server-side
  ssn_on_file: boolean          // hydrated from server; true if already stored
  gov_id_plaintext: string
  gov_id_on_file: boolean
  gov_id_issuing_state: string

  // Employment
  employer: string
  employer_phone: string
  employer_address: string
  employer_address_2: string
  position_held: string
  years_worked: number | ''
  supervisor_name: string
  supervisor_title: string
  supervisor_email: string
  monthly_salary: number | ''

  // Screening
  q_delinquent_payment: boolean | null
  q_felony_conviction: boolean | null
  q_sued_landlord: boolean | null
  q_water_filled_furniture: boolean | null
  q_smoker: boolean | null

  // Notes
  notes: string

  // Child arrays
  phones: Phone[]
  emails: Email[]
  addresses: Address[]
  dependents: Dependent[]
  pets: Pet[]
  bank_accounts: BankAccount[]
  credit_cards: CreditCard[]
  additional_income: AdditionalIncome[]
  emergency_contacts: EmergencyContact[]
  coapplicants: CoApplicant[]
  attachments: Attachment[]
}

type InitialState = {
  application: Record<string, unknown> & { id: string; ssn_on_file: boolean; gov_id_on_file: boolean }
  phones: unknown[]
  emails: unknown[]
  addresses: unknown[]
  dependents: unknown[]
  pets: unknown[]
  bank_accounts: unknown[]
  credit_cards: unknown[]
  additional_income: unknown[]
  emergency_contacts: unknown[]
  coapplicants: unknown[]
  attachments: unknown[]
}

type Props = { draftToken: string; initialState: InitialState }

type UnitOption = {
  id: string
  name: string | null
  property_name: string | null
  market_rent: number | null
  bedroom_count: number | null
  bathrooms: number | null
  sqft: number | null
  availability_date: string | null
}

// ────────────────────────────────────────────────────────────────────────────
// HYDRATION
// ────────────────────────────────────────────────────────────────────────────

function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}
function b(v: unknown): boolean {
  return Boolean(v)
}
function bn(v: unknown): boolean | null {
  if (v === null || v === undefined) return null
  return Boolean(v)
}
function n(v: unknown): number | '' {
  if (v === null || v === undefined || v === '') return ''
  const x = Number(v)
  return Number.isFinite(x) ? x : ''
}

function hydrate(init: InitialState): WizardState {
  const a = init.application
  return {
    salutation: s(a.salutation),
    legal_first_name: s(a.first_name),
    middle_name: s(a.middle_name),
    no_middle_name_certified: b(a.no_middle_name_certified),
    suffix: s(a.suffix),
    last_name: s(a.last_name),
    applicant_type: (a.applicant_type as WizardState['applicant_type']) || '',
    company_name: s(a.company_name),
    use_company_as_display_name: b(a.use_company_as_display_name),
    desired_move_in: s(a.desired_move_in),
    unit_id: s(a.unit_id),
    date_of_birth: s(a.date_of_birth),
    ssn_plaintext: '',
    ssn_on_file: b(a.ssn_on_file),
    gov_id_plaintext: '',
    gov_id_on_file: b(a.gov_id_on_file),
    gov_id_issuing_state: s(a.gov_id_issuing_state),
    employer: s(a.employer),
    employer_phone: s(a.employer_phone),
    employer_address: s(a.employer_address),
    employer_address_2: s(a.employer_address_2),
    position_held: s(a.position_held),
    years_worked: n(a.years_worked),
    supervisor_name: s(a.supervisor_name),
    supervisor_title: s(a.supervisor_title),
    supervisor_email: s(a.supervisor_email),
    monthly_salary: n(a.monthly_salary),
    q_delinquent_payment: bn(a.q_delinquent_payment),
    q_felony_conviction: bn(a.q_felony_conviction),
    q_sued_landlord: bn(a.q_sued_landlord),
    q_water_filled_furniture: bn(a.q_water_filled_furniture),
    q_smoker: bn(a.q_smoker),
    notes: s(a.notes),
    phones: (init.phones as Phone[]) ?? [],
    emails: (init.emails as Email[]) ?? [],
    addresses: (init.addresses as Address[]) ?? [],
    dependents: (init.dependents as Dependent[]) ?? [],
    pets: (init.pets as Pet[]) ?? [],
    bank_accounts: (init.bank_accounts as BankAccount[]) ?? [],
    credit_cards: (init.credit_cards as CreditCard[]) ?? [],
    additional_income: (init.additional_income as AdditionalIncome[]) ?? [],
    emergency_contacts: (init.emergency_contacts as EmergencyContact[]) ?? [],
    coapplicants: (init.coapplicants as CoApplicant[]) ?? [],
    attachments: (init.attachments as Attachment[]) ?? [],
  }
}

/**
 * Convert wizard state into the payload shape the server action expects.
 * Strips empty strings → null on the scalar fields so we don't overwrite
 * server defaults with junk.
 */
function toPayload(state: WizardState) {
  const nullIfEmpty = (v: string) => (v.trim() === '' ? null : v)
  const numOrNull = (v: number | '') => (v === '' ? null : v)

  return {
    salutation: nullIfEmpty(state.salutation),
    legal_first_name: nullIfEmpty(state.legal_first_name),
    middle_name: nullIfEmpty(state.middle_name),
    no_middle_name_certified: state.no_middle_name_certified,
    suffix: nullIfEmpty(state.suffix),
    last_name: nullIfEmpty(state.last_name),
    applicant_type: state.applicant_type || null,
    company_name: nullIfEmpty(state.company_name),
    use_company_as_display_name: state.use_company_as_display_name,
    desired_move_in: nullIfEmpty(state.desired_move_in),
    unit_id: nullIfEmpty(state.unit_id),
    date_of_birth: nullIfEmpty(state.date_of_birth),
    // SSN / gov ID are only sent when user actually re-entered them
    ssn_plaintext: state.ssn_plaintext ? state.ssn_plaintext : undefined,
    gov_id_plaintext: state.gov_id_plaintext ? state.gov_id_plaintext : undefined,
    gov_id_issuing_state: nullIfEmpty(state.gov_id_issuing_state),
    employer: nullIfEmpty(state.employer),
    employer_phone: nullIfEmpty(state.employer_phone),
    employer_address: nullIfEmpty(state.employer_address),
    employer_address_2: nullIfEmpty(state.employer_address_2),
    position_held: nullIfEmpty(state.position_held),
    years_worked: numOrNull(state.years_worked),
    supervisor_name: nullIfEmpty(state.supervisor_name),
    supervisor_title: nullIfEmpty(state.supervisor_title),
    supervisor_email: nullIfEmpty(state.supervisor_email),
    monthly_salary: numOrNull(state.monthly_salary),
    q_delinquent_payment: state.q_delinquent_payment,
    q_felony_conviction: state.q_felony_conviction,
    q_sued_landlord: state.q_sued_landlord,
    q_water_filled_furniture: state.q_water_filled_furniture,
    q_smoker: state.q_smoker,
    notes: nullIfEmpty(state.notes),
    phones: state.phones,
    emails: state.emails,
    addresses: state.addresses,
    dependents: state.dependents,
    pets: state.pets,
    bank_accounts: state.bank_accounts,
    credit_cards: state.credit_cards,
    additional_income: state.additional_income,
    emergency_contacts: state.emergency_contacts,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP CATALOG
// ────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1,  title: 'Welcome',        sub: 'Pick a unit',                 icon: Home },
  { id: 2,  title: 'Identity',       sub: 'Who is applying',             icon: User },
  { id: 3,  title: 'Contact',        sub: 'How to reach you',            icon: PhoneIcon },
  { id: 4,  title: 'Residential',    sub: 'Where you live & lived',      icon: MapPin },
  { id: 5,  title: 'Personal',       sub: 'DOB, SSN, gov ID',            icon: User },
  { id: 6,  title: 'Financial',      sub: 'Banks & cards',               icon: CreditCard },
  { id: 7,  title: 'Income',         sub: 'Employment + extras',         icon: Briefcase },
  { id: 8,  title: 'Household',      sub: 'Dependents & pets',           icon: Users },
  { id: 9,  title: 'Emergency',      sub: 'Who to contact',              icon: PhoneIcon },
  { id: 10, title: 'Screening',      sub: 'Yes / no questions',          icon: HelpCircle },
  { id: 11, title: 'Attachments',    sub: 'Notes + documents',           icon: Paperclip },
  { id: 12, title: 'Co-Applicants',  sub: 'Roommates & co-signers',      icon: Users },
  { id: 13, title: 'Review',         sub: 'Submit your application',     icon: FileText },
] as const

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────

export function ApplicationWizard({ draftToken, initialState }: Props) {
  const [state, setState] = useState<WizardState>(() => hydrate(initialState))
  const [step, setStep] = useState<number>(1)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const submittedAtFromServer = initialState.application?.submitted_at as string | null | undefined
  const isAlreadySubmitted = !!submittedAtFromServer

  // Debounced auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const doSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    const result = await saveDraft(draftToken, toPayload(state))
    setSaving(false)
    if (result.success) {
      setSavedAt(new Date())
      dirty.current = false
    } else {
      setSaveError(result.message ?? 'Could not save')
    }
    return result.success
  }, [draftToken, state])

  // Schedule auto-save when state changes
  useEffect(() => {
    if (isAlreadySubmitted) return
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void doSave()
    }, 1200)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // doSave depends on state, so this fires on every state change as desired
  }, [state, doSave, isAlreadySubmitted])

  const advance = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (dirty.current) {
      const ok = await doSave()
      if (!ok) return
    }
    setStep((s) => Math.min(STEPS.length, s + 1))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const back = () => {
    setStep((s) => Math.max(1, s - 1))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const goto = (n: number) => {
    setStep(Math.max(1, Math.min(STEPS.length, n)))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const validationIssues = useMemo(() => validate(state), [state])

  const handleSubmit = async () => {
    if (validationIssues.length > 0) return
    setSubmitting(true)
    if (dirty.current) {
      const ok = await doSave()
      if (!ok) {
        setSubmitting(false)
        return
      }
    }
    const result = await submitApplication(draftToken)
    setSubmitting(false)
    if (result.success) {
      setSubmitted(result.submitted_at ?? new Date().toISOString())
    } else {
      setSaveError(result.message ?? 'Could not submit')
    }
  }

  // ── Already submitted: short confirmation ──
  if (isAlreadySubmitted || submitted) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 max-w-lg text-center">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-3xl font-black italic uppercase text-slate-900">
            Application Submitted
          </h1>
          <p className="text-slate-500 text-sm mt-3">
            Thank you. We&apos;ve received your application and will be in touch soon.
            {state.coapplicants.length > 0 && (
              <>
                {' '}Your co-applicants will receive their own invitation emails shortly.
              </>
            )}
          </p>
        </div>
      </main>
    )
  }

  // ── Active wizard ──
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">

        {/* Top bar */}
        <header className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-4 md:p-6 mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">
              Rental Application
            </p>
            <h1 className="text-xl md:text-2xl font-black italic uppercase text-slate-900">
              Step {step} of {STEPS.length} <span className="text-emerald-600">/</span> {STEPS[step - 1].title}
            </h1>
          </div>
          <SaveStatus saving={saving} savedAt={savedAt} error={saveError} />
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Sidebar nav */}
          <aside className="lg:col-span-1">
            <nav className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-3 sticky top-4">
              {STEPS.map((s) => {
                const Icon = s.icon
                const active = step === s.id
                const done = step > s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => goto(s.id)}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : done
                        ? 'text-emerald-700 hover:bg-emerald-50'
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        active
                          ? 'bg-white/15 text-white'
                          : done
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {done ? <Check size={14} /> : <Icon size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-widest leading-tight">
                        {s.title}
                      </p>
                      <p className={`text-[10px] font-medium leading-tight ${active ? 'text-white/60' : 'text-slate-400'}`}>
                        {s.sub}
                      </p>
                    </div>
                  </button>
                )
              })}
            </nav>
            <p className="text-[10px] text-slate-400 font-medium mt-3 px-3">
              Your progress is saved automatically. Bookmark this URL to resume later.
            </p>
          </aside>

          {/* Main panel */}
          <section className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-6 md:p-8">
              {step === 1  && <Step1 state={state} setState={setState} />}
              {step === 2  && <Step2 state={state} setState={setState} />}
              {step === 3  && <Step3 state={state} setState={setState} />}
              {step === 4  && <Step4 state={state} setState={setState} />}
              {step === 5  && <Step5 state={state} setState={setState} />}
              {step === 6  && <Step6 state={state} setState={setState} />}
              {step === 7  && <Step7 state={state} setState={setState} />}
              {step === 8  && <Step8 state={state} setState={setState} />}
              {step === 9  && <Step9 state={state} setState={setState} />}
              {step === 10 && <Step10 state={state} setState={setState} />}
              {step === 11 && <Step11 state={state} setState={setState} draftToken={draftToken} />}
              {step === 12 && <Step12 state={state} setState={setState} draftToken={draftToken} />}
              {step === 13 && (
                <Step13
                  state={state}
                  issues={validationIssues}
                  onJump={goto}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                />
              )}
            </div>

            {/* Step nav buttons */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={back}
                disabled={step === 1}
                className="px-5 py-3 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <ChevronLeft size={14} /> Back
              </button>
              {step < STEPS.length && (
                <button
                  onClick={advance}
                  disabled={saving}
                  className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  Save & Continue <ChevronRight size={14} />
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// VALIDATION (permissive — only Review step checks)
// ────────────────────────────────────────────────────────────────────────────

function validate(state: WizardState): Array<{ step: number; message: string }> {
  const issues: Array<{ step: number; message: string }> = []
  if (!state.unit_id) issues.push({ step: 1, message: 'Pick a unit to apply for.' })
  if (!state.legal_first_name.trim()) issues.push({ step: 2, message: 'Legal first name is required.' })
  if (!state.last_name.trim()) issues.push({ step: 2, message: 'Last name is required.' })
  if (!state.applicant_type) issues.push({ step: 2, message: 'Select an applicant type.' })
  const hasEmail = state.emails.some((e) => e.email.trim().length > 0)
  if (!hasEmail) issues.push({ step: 3, message: 'At least one email address is required.' })
  return issues
}

// ────────────────────────────────────────────────────────────────────────────
// SHARED UI BITS
// ────────────────────────────────────────────────────────────────────────────

type SetState = React.Dispatch<React.SetStateAction<WizardState>>

function StepHeader({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="mb-6 pb-4 border-b border-slate-100">
      <h2 className="text-2xl font-black italic uppercase text-slate-900">{title}</h2>
      {blurb && <p className="text-slate-500 text-sm mt-2">{blurb}</p>}
    </div>
  )
}

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string
  children: React.ReactNode
  hint?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
        {label} {required && <span className="text-amber-600">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </label>
  )
}

const inputCls =
  'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all'

function SaveStatus({ saving, savedAt, error }: { saving: boolean; savedAt: Date | null; error: string | null }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-amber-600">
        <AlertCircle size={14} /> Couldn&apos;t save — {error}
      </div>
    )
  }
  if (saving) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Saving...
      </div>
    )
  }
  if (savedAt) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-emerald-600">
        <CheckCircle2 size={14} /> Saved {timeSince(savedAt)}
      </div>
    )
  }
  return null
}

function timeSince(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

function YesNoToggle({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
}) {
  return (
    <div className="inline-flex border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${
          value === true ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
        }`}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors border-l border-slate-200 ${
          value === false ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
        }`}
      >
        No
      </button>
    </div>
  )
}

function ListEditor<T>({
  items,
  blank,
  setItems,
  renderRow,
  addLabel,
  emptyLabel,
  minOne,
}: {
  items: T[]
  blank: () => T
  setItems: (items: T[]) => void
  renderRow: (item: T, idx: number, update: (patch: Partial<T>) => void) => React.ReactNode
  addLabel: string
  emptyLabel?: string
  minOne?: boolean
}) {
  return (
    <div className="space-y-3">
      {items.length === 0 && emptyLabel && (
        <p className="text-sm text-slate-400 italic">{emptyLabel}</p>
      )}
      {items.map((item, idx) => (
        <div key={idx} className="bg-slate-50 rounded-xl p-4 relative">
          {!(minOne && items.length <= 1) && (
            <button
              type="button"
              onClick={() => setItems(items.filter((_, i) => i !== idx))}
              className="absolute top-3 right-3 text-slate-400 hover:text-amber-600 transition-colors"
              aria-label="Remove"
            >
              <Trash2 size={14} />
            </button>
          )}
          {renderRow(item, idx, (patch) => {
            setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
          })}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems([...items, blank()])}
        className="px-4 py-2 bg-white border border-dashed border-slate-300 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-slate-50 hover:border-slate-400 flex items-center gap-2"
      >
        <Plus size={12} /> {addLabel}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 1 — UNIT SELECTION
// ────────────────────────────────────────────────────────────────────────────

function Step1({ state, setState }: { state: WizardState; setState: SetState }) {
  const [units, setUnits] = useState<UnitOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('units')
        .select('id, name, market_rent, bedroom_count, bathrooms, sqft, availability_date, properties(name)')
        .eq('status', 'Vacant')
        .order('availability_date', { ascending: true, nullsFirst: false })
        .limit(500)
      if (cancelled) return
      // PostgREST returns `properties` as either an object or array depending
      // on how it infers the relationship; normalize to a single name.
      setUnits(
        ((data ?? []) as unknown[]).map((row) => {
          const u = row as {
            id: string
            name: string | null
            market_rent: number | null
            bedroom_count: number | null
            bathrooms: number | null
            sqft: number | null
            availability_date: string | null
            properties:
              | { name: string | null }
              | Array<{ name: string | null }>
              | null
          }
          const prop = Array.isArray(u.properties) ? u.properties[0] : u.properties
          return {
            id: u.id,
            name: u.name,
            market_rent: u.market_rent,
            bedroom_count: u.bedroom_count,
            bathrooms: u.bathrooms,
            sqft: u.sqft,
            availability_date: u.availability_date,
            property_name: prop?.name ?? null,
          }
        })
      )
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return units
    const q = search.toLowerCase()
    return units.filter(
      (u) =>
        (u.property_name ?? '').toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q)
    )
  }, [units, search])

  const selected = units.find((u) => u.id === state.unit_id) ?? null

  return (
    <>
      <StepHeader title="Welcome" blurb="Pick the unit you're applying for and tell us when you'd like to move in." />

      <div className="space-y-6">
        {/* Selected unit pill */}
        {selected && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <Building2 size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Selected</p>
              <p className="text-base font-black text-slate-900">{selected.property_name} — Unit {selected.name}</p>
              <p className="text-xs text-slate-600 mt-1">
                {selected.bedroom_count != null && <>{selected.bedroom_count} bd · </>}
                {selected.bathrooms != null && <>{selected.bathrooms} ba · </>}
                {selected.sqft != null && <>{selected.sqft.toLocaleString()} sqft · </>}
                ${(selected.market_rent ?? 0).toLocaleString()}/mo
                {selected.availability_date && <> · Available {selected.availability_date}</>}
              </p>
            </div>
            <button
              onClick={() => setState((p) => ({ ...p, unit_id: '' }))}
              className="text-slate-400 hover:text-amber-600"
              aria-label="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Move-in date + email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Desired Move-in" required>
            <input
              type="date"
              value={state.desired_move_in}
              onChange={(e) => setState((p) => ({ ...p, desired_move_in: e.target.value }))}
              className={inputCls}
            />
          </Field>
        </div>

        {/* Unit picker */}
        {!selected && (
          <div>
            <Field label="Vacant Units">
              <input
                type="text"
                placeholder="Search by property or unit..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputCls}
              />
            </Field>
            <div className="mt-3 max-h-96 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {loading ? (
                <div className="p-6 text-center">
                  <Loader2 size={20} className="animate-spin text-emerald-500 mx-auto" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-400">No vacant units match.</div>
              ) : (
                filtered.slice(0, 200).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setState((p) => ({ ...p, unit_id: u.id }))}
                    className="w-full text-left p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-black text-slate-900 text-sm">
                        {u.property_name} — Unit {u.name}
                      </p>
                      <p className="font-mono font-black text-emerald-700 text-sm">
                        ${(u.market_rent ?? 0).toLocaleString()}/mo
                      </p>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {u.bedroom_count != null && <>{u.bedroom_count} bd · </>}
                      {u.bathrooms != null && <>{u.bathrooms} ba · </>}
                      {u.sqft != null && <>{u.sqft.toLocaleString()} sqft</>}
                      {u.availability_date && <> · Available {u.availability_date}</>}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — APPLICANT IDENTITY
// ────────────────────────────────────────────────────────────────────────────

function Step2({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Applicant Identity" blurb="Tell us who is applying. Names should match your government ID." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Salutation">
          <select
            value={state.salutation}
            onChange={(e) => setState((p) => ({ ...p, salutation: e.target.value }))}
            className={inputCls}
          >
            <option value="">—</option>
            {['Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.'].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Applicant Type" required>
          <select
            value={state.applicant_type}
            onChange={(e) =>
              setState((p) => ({ ...p, applicant_type: e.target.value as WizardState['applicant_type'] }))
            }
            className={inputCls}
          >
            <option value="">— Select —</option>
            {['Financially Responsible', 'Co-Signer', 'Other Applicant'].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Legal First Name" required>
          <input
            type="text"
            value={state.legal_first_name}
            onChange={(e) => setState((p) => ({ ...p, legal_first_name: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="Middle Name">
          <input
            type="text"
            value={state.middle_name}
            onChange={(e) =>
              setState((p) => ({ ...p, middle_name: e.target.value, no_middle_name_certified: false }))
            }
            disabled={state.no_middle_name_certified}
            className={inputCls + (state.no_middle_name_certified ? ' opacity-50' : '')}
          />
        </Field>
        <Field label="Last Name" required>
          <input
            type="text"
            value={state.last_name}
            onChange={(e) => setState((p) => ({ ...p, last_name: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="Suffix">
          <select
            value={state.suffix}
            onChange={(e) => setState((p) => ({ ...p, suffix: e.target.value }))}
            className={inputCls}
          >
            <option value="">—</option>
            {['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 mt-4 cursor-pointer">
        <input
          type="checkbox"
          checked={state.no_middle_name_certified}
          onChange={(e) =>
            setState((p) => ({
              ...p,
              no_middle_name_certified: e.target.checked,
              middle_name: e.target.checked ? '' : p.middle_name,
            }))
          }
          className="rounded"
        />
        <span className="text-sm text-slate-700">I certify I have no middle name.</span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100">
        <Field label="Company Name" hint="If applying as a business (LLC, etc.)">
          <input
            type="text"
            value={state.company_name}
            onChange={(e) => setState((p) => ({ ...p, company_name: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.use_company_as_display_name}
              onChange={(e) => setState((p) => ({ ...p, use_company_as_display_name: e.target.checked }))}
              disabled={!state.company_name.trim()}
              className="rounded"
            />
            <span className="text-sm text-slate-700">Use company name on lease</span>
          </label>
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3 — CONTACT INFO
// ────────────────────────────────────────────────────────────────────────────

function Step3({ state, setState }: { state: WizardState; setState: SetState }) {
  // Ensure at least one row each
  useEffect(() => {
    if (state.phones.length === 0) {
      setState((p) => ({ ...p, phones: [{ label: 'Mobile', phone_number: '', is_primary: true }] }))
    }
    if (state.emails.length === 0) {
      setState((p) => ({ ...p, emails: [{ email: '', is_primary: true }] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <StepHeader title="Contact Info" blurb="At least one phone and one email are required. Add as many as you'd like." />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Phone Numbers</h3>
      <ListEditor<Phone>
        items={state.phones}
        blank={() => ({ label: 'Mobile', phone_number: '', is_primary: false })}
        setItems={(phones) => setState((p) => ({ ...p, phones }))}
        addLabel="Add Phone"
        minOne
        renderRow={(item, idx, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-3">
              <Field label="Label">
                <select
                  value={item.label ?? ''}
                  onChange={(e) => upd({ label: e.target.value })}
                  className={inputCls}
                >
                  {['Mobile', 'Home', 'Work', 'Other'].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="col-span-6">
              <Field label="Number" required={idx === 0}>
                <input
                  type="tel"
                  value={item.phone_number}
                  onChange={(e) => upd({ phone_number: e.target.value })}
                  placeholder="(555) 555-5555"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="col-span-3 flex items-end pb-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                <input
                  type="radio"
                  name="primary_phone"
                  checked={!!item.is_primary}
                  onChange={() => {
                    setState((p) => ({
                      ...p,
                      phones: p.phones.map((ph, i) => ({ ...ph, is_primary: i === idx })),
                    }))
                  }}
                />
                Primary
              </label>
            </div>
          </div>
        )}
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 mt-8">Email Addresses</h3>
      <ListEditor<Email>
        items={state.emails}
        blank={() => ({ email: '', is_primary: false })}
        setItems={(emails) => setState((p) => ({ ...p, emails }))}
        addLabel="Add Email"
        minOne
        renderRow={(item, idx, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-9">
              <Field label="Email" required={idx === 0}>
                <input
                  type="email"
                  value={item.email}
                  onChange={(e) => upd({ email: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="col-span-3 flex items-end pb-1.5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                <input
                  type="radio"
                  name="primary_email"
                  checked={!!item.is_primary}
                  onChange={() => {
                    setState((p) => ({
                      ...p,
                      emails: p.emails.map((e, i) => ({ ...e, is_primary: i === idx })),
                    }))
                  }}
                />
                Primary
              </label>
            </div>
          </div>
        )}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 4 — RESIDENTIAL HISTORY
// ────────────────────────────────────────────────────────────────────────────

function Step4({ state, setState }: { state: WizardState; setState: SetState }) {
  const blankAddress = (kind: 'current' | 'previous'): Address => ({ kind })

  const current = state.addresses.filter((a) => a.kind === 'current')
  const previous = state.addresses.filter((a) => a.kind === 'previous')

  // Ensure at least one current address
  useEffect(() => {
    if (current.length === 0) {
      setState((p) => ({ ...p, addresses: [...p.addresses, blankAddress('current')] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setKindList = (kind: 'current' | 'previous', list: Address[]) => {
    setState((p) => ({
      ...p,
      addresses: [...p.addresses.filter((a) => a.kind !== kind), ...list],
    }))
  }

  return (
    <>
      <StepHeader title="Residential History" blurb="Tell us where you live now and, if helpful, where you've lived before." />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Current Address</h3>
      <ListEditor<Address>
        items={current}
        blank={() => blankAddress('current')}
        setItems={(items) => setKindList('current', items)}
        addLabel="Add Current Address"
        minOne
        renderRow={(addr, _idx, upd) => <AddressFields addr={addr} upd={upd} />}
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 mt-8">
        Previous Addresses (Optional)
      </h3>
      <ListEditor<Address>
        items={previous}
        blank={() => blankAddress('previous')}
        setItems={(items) => setKindList('previous', items)}
        addLabel="Add Previous Address"
        emptyLabel="No previous addresses listed."
        renderRow={(addr, _idx, upd) => <AddressFields addr={addr} upd={upd} />}
      />
    </>
  )
}

function AddressFields({ addr, upd }: { addr: Address; upd: (patch: Partial<Address>) => void }) {
  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 md:col-span-8">
        <Field label="Street Address">
          <input type="text" value={addr.street_1 ?? ''} onChange={(e) => upd({ street_1: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-12 md:col-span-4">
        <Field label="Apt / Unit">
          <input type="text" value={addr.street_2 ?? ''} onChange={(e) => upd({ street_2: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6 md:col-span-5">
        <Field label="City">
          <input type="text" value={addr.city ?? ''} onChange={(e) => upd({ city: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-3">
        <Field label="State">
          <input type="text" value={addr.state ?? ''} onChange={(e) => upd({ state: e.target.value })} className={inputCls} maxLength={2} />
        </Field>
      </div>
      <div className="col-span-3 md:col-span-4">
        <Field label="ZIP">
          <input type="text" value={addr.postal_code ?? ''} onChange={(e) => upd({ postal_code: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6 md:col-span-3">
        <Field label="Occupancy Type">
          <select value={addr.occupancy_type ?? ''} onChange={(e) => upd({ occupancy_type: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {['Rent', 'Own', 'Family', 'Other'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </div>
      <div className="col-span-6 md:col-span-3">
        <Field label="From">
          <input type="date" value={addr.resided_from ?? ''} onChange={(e) => upd({ resided_from: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6 md:col-span-3">
        <Field label="To" hint={addr.kind === 'current' ? 'Leave blank if you still live here' : undefined}>
          <input type="date" value={addr.resided_to ?? ''} onChange={(e) => upd({ resided_to: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6 md:col-span-3">
        <Field label="Monthly Payment">
          <input
            type="number"
            value={addr.monthly_payment ?? ''}
            onChange={(e) => upd({ monthly_payment: e.target.value === '' ? undefined : Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="col-span-12 md:col-span-6">
        <Field label="Landlord Name">
          <input type="text" value={addr.landlord_name ?? ''} onChange={(e) => upd({ landlord_name: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6">
        <Field label="Landlord Phone">
          <input type="tel" value={addr.landlord_phone ?? ''} onChange={(e) => upd({ landlord_phone: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="col-span-6">
        <Field label="Landlord Email">
          <input type="email" value={addr.landlord_email ?? ''} onChange={(e) => upd({ landlord_email: e.target.value })} className={inputCls} />
        </Field>
      </div>
      {addr.kind === 'previous' && (
        <div className="col-span-12">
          <Field label="Reason for Leaving">
            <input type="text" value={addr.reason_for_leaving ?? ''} onChange={(e) => upd({ reason_for_leaving: e.target.value })} className={inputCls} />
          </Field>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 5 — PERSONAL INFO
// ────────────────────────────────────────────────────────────────────────────

function Step5({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader
        title="Personal Info"
        blurb="SSN/ITIN is optional but speeds up screening. It's encrypted before being saved and only the last 4 digits are ever shown back to you."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Date of Birth">
          <input
            type="date"
            value={state.date_of_birth}
            onChange={(e) => setState((p) => ({ ...p, date_of_birth: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="SSN / ITIN" hint="9 digits. Format flexible. Optional.">
          <input
            type="text"
            placeholder={state.ssn_on_file ? '••• ••• XXXX  (on file)' : '123-45-6789'}
            value={state.ssn_plaintext}
            onChange={(e) => setState((p) => ({ ...p, ssn_plaintext: e.target.value }))}
            className={inputCls}
            autoComplete="off"
          />
        </Field>
        <Field label="Government ID Number" hint="Driver's license, passport, or state ID">
          <input
            type="text"
            placeholder={state.gov_id_on_file ? '(on file)' : ''}
            value={state.gov_id_plaintext}
            onChange={(e) => setState((p) => ({ ...p, gov_id_plaintext: e.target.value }))}
            className={inputCls}
            autoComplete="off"
          />
        </Field>
        <Field label="Issuing State">
          <input
            type="text"
            value={state.gov_id_issuing_state}
            onChange={(e) => setState((p) => ({ ...p, gov_id_issuing_state: e.target.value }))}
            className={inputCls}
            maxLength={2}
          />
        </Field>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 6 — FINANCIAL INFO
// ────────────────────────────────────────────────────────────────────────────

function Step6({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader
        title="Financial Info"
        blurb="We only store the bank name and last 4 digits of any account — never the full account number."
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Bank Accounts</h3>
      <ListEditor<BankAccount>
        items={state.bank_accounts}
        blank={() => ({ bank_name: '', account_type: 'Checking' })}
        setItems={(bank_accounts) => setState((p) => ({ ...p, bank_accounts }))}
        addLabel="Add Bank Account"
        emptyLabel="No bank accounts listed."
        renderRow={(b, _i, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-5">
              <Field label="Bank Name">
                <input type="text" value={b.bank_name} onChange={(e) => upd({ bank_name: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-3">
              <Field label="Account Type">
                <select value={b.account_type ?? ''} onChange={(e) => upd({ account_type: e.target.value })} className={inputCls}>
                  {['Checking', 'Savings', 'Money Market', 'Other'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </div>
            <div className="col-span-6 md:col-span-2">
              <Field label="Last 4" hint="4 digits">
                <input
                  type="text"
                  value={b.account_last4 ?? ''}
                  onChange={(e) => upd({ account_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={inputCls}
                  maxLength={4}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="col-span-12 md:col-span-2">
              <Field label="Balance">
                <input
                  type="number"
                  value={b.balance ?? ''}
                  onChange={(e) => upd({ balance: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        )}
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 mt-8">Credit Cards</h3>
      <ListEditor<CreditCard>
        items={state.credit_cards}
        blank={() => ({ issuer: '' })}
        setItems={(credit_cards) => setState((p) => ({ ...p, credit_cards }))}
        addLabel="Add Credit Card"
        emptyLabel="No credit cards listed."
        renderRow={(c, _i, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-8">
              <Field label="Issuer">
                <input type="text" value={c.issuer ?? ''} onChange={(e) => upd({ issuer: e.target.value })} className={inputCls} placeholder="Visa, Chase, etc." />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Current Balance">
                <input
                  type="number"
                  value={c.balance ?? ''}
                  onChange={(e) => upd({ balance: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        )}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 7 — INCOME & EMPLOYMENT
// ────────────────────────────────────────────────────────────────────────────

function Step7({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Income & Employment" blurb="Tell us about your current employer and any other income sources." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Employer">
          <input type="text" value={state.employer} onChange={(e) => setState((p) => ({ ...p, employer: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Position Held">
          <input type="text" value={state.position_held} onChange={(e) => setState((p) => ({ ...p, position_held: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Employer Phone">
          <input type="tel" value={state.employer_phone} onChange={(e) => setState((p) => ({ ...p, employer_phone: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Years at this Job">
          <input
            type="number"
            value={state.years_worked}
            onChange={(e) => setState((p) => ({ ...p, years_worked: e.target.value === '' ? '' : Number(e.target.value) }))}
            className={inputCls}
            step="0.5"
          />
        </Field>
        <Field label="Employer Address">
          <input type="text" value={state.employer_address} onChange={(e) => setState((p) => ({ ...p, employer_address: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Employer Address 2">
          <input type="text" value={state.employer_address_2} onChange={(e) => setState((p) => ({ ...p, employer_address_2: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Supervisor Name">
          <input type="text" value={state.supervisor_name} onChange={(e) => setState((p) => ({ ...p, supervisor_name: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Supervisor Title">
          <input type="text" value={state.supervisor_title} onChange={(e) => setState((p) => ({ ...p, supervisor_title: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Supervisor Email">
          <input type="email" value={state.supervisor_email} onChange={(e) => setState((p) => ({ ...p, supervisor_email: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Monthly Salary">
          <input
            type="number"
            value={state.monthly_salary}
            onChange={(e) => setState((p) => ({ ...p, monthly_salary: e.target.value === '' ? '' : Number(e.target.value) }))}
            className={inputCls}
          />
        </Field>
      </div>

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 mt-8">Additional Income (Optional)</h3>
      <ListEditor<AdditionalIncome>
        items={state.additional_income}
        blank={() => ({ source: '' })}
        setItems={(additional_income) => setState((p) => ({ ...p, additional_income }))}
        addLabel="Add Income Source"
        emptyLabel="No additional income listed."
        renderRow={(inc, _i, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-8">
              <Field label="Source">
                <input type="text" value={inc.source ?? ''} onChange={(e) => upd({ source: e.target.value })} className={inputCls} placeholder="Side gig, alimony, SSI, etc." />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Monthly Amount">
                <input
                  type="number"
                  value={inc.monthly_amount ?? ''}
                  onChange={(e) => upd({ monthly_amount: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        )}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 8 — HOUSEHOLD
// ────────────────────────────────────────────────────────────────────────────

function Step8({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Household" blurb="Tell us about anyone else who would live in the unit, including pets." />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Dependents</h3>
      <ListEditor<Dependent>
        items={state.dependents}
        blank={() => ({ first_name: '', last_name: '' })}
        setItems={(dependents) => setState((p) => ({ ...p, dependents }))}
        addLabel="Add Dependent"
        emptyLabel="No dependents listed."
        renderRow={(d, _i, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6 md:col-span-3">
              <Field label="First Name">
                <input type="text" value={d.first_name} onChange={(e) => upd({ first_name: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-3">
              <Field label="Last Name">
                <input type="text" value={d.last_name} onChange={(e) => upd({ last_name: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-3">
              <Field label="Date of Birth">
                <input type="date" value={d.date_of_birth ?? ''} onChange={(e) => upd({ date_of_birth: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-3">
              <Field label="Relationship">
                <input type="text" value={d.relationship ?? ''} onChange={(e) => upd({ relationship: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>
        )}
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 mt-8">Pets</h3>
      <ListEditor<Pet>
        items={state.pets}
        blank={() => ({})}
        setItems={(pets) => setState((p) => ({ ...p, pets }))}
        addLabel="Add Pet"
        emptyLabel="No pets listed."
        renderRow={(pet, _i, upd) => (
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6 md:col-span-4">
              <Field label="Name">
                <input type="text" value={pet.name ?? ''} onChange={(e) => upd({ name: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-4">
              <Field label="Type / Breed">
                <input type="text" value={pet.type_breed ?? ''} onChange={(e) => upd({ type_breed: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-2">
              <Field label="Weight (lbs)">
                <input
                  type="number"
                  value={pet.weight_lbs ?? ''}
                  onChange={(e) => upd({ weight_lbs: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="col-span-6 md:col-span-2">
              <Field label="Age (yrs)">
                <input
                  type="number"
                  value={pet.age_years ?? ''}
                  onChange={(e) => upd({ age_years: e.target.value === '' ? undefined : Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>
        )}
      />
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 9 — EMERGENCY CONTACT
// ────────────────────────────────────────────────────────────────────────────

function Step9({ state, setState }: { state: WizardState; setState: SetState }) {
  // Ensure a single row exists
  useEffect(() => {
    if (state.emergency_contacts.length === 0) {
      setState((p) => ({ ...p, emergency_contacts: [{}] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ec = state.emergency_contacts[0] ?? {}
  const upd = (patch: Partial<EmergencyContact>) =>
    setState((p) => ({ ...p, emergency_contacts: [{ ...(p.emergency_contacts[0] ?? {}), ...patch }] }))

  return (
    <>
      <StepHeader title="Emergency Contact" blurb="Someone we can reach if we can't reach you." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full Name">
          <input type="text" value={ec.name ?? ''} onChange={(e) => upd({ name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Relationship">
          <input type="text" value={ec.relationship ?? ''} onChange={(e) => upd({ relationship: e.target.value })} className={inputCls} placeholder="Parent, sibling, friend..." />
        </Field>
        <Field label="Phone">
          <input type="tel" value={ec.phone ?? ''} onChange={(e) => upd({ phone: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" value={ec.email ?? ''} onChange={(e) => upd({ email: e.target.value })} className={inputCls} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Address">
            <input type="text" value={ec.address ?? ''} onChange={(e) => upd({ address: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 10 — SCREENING QUESTIONS
// ────────────────────────────────────────────────────────────────────────────

type ScreeningField =
  | 'q_delinquent_payment'
  | 'q_felony_conviction'
  | 'q_sued_landlord'
  | 'q_water_filled_furniture'
  | 'q_smoker'

function ScreeningQuestion({
  label,
  field,
  state,
  setState,
}: {
  label: string
  field: ScreeningField
  state: WizardState
  setState: SetState
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-b-0">
      <p className="text-sm font-medium text-slate-700 flex-1">{label}</p>
      <YesNoToggle value={state[field]} onChange={(v) => setState((p) => ({ ...p, [field]: v }))} />
    </div>
  )
}

function Step10({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Screening Questions" blurb="Honest answers help us place you. A 'yes' isn't an automatic disqualification." />
      <div className="bg-slate-50 rounded-xl px-4">
        <ScreeningQuestion state={state} setState={setState} label="Have you ever been delinquent on a rent payment?" field="q_delinquent_payment" />
        <ScreeningQuestion state={state} setState={setState} label="Have you ever been convicted of a felony?" field="q_felony_conviction" />
        <ScreeningQuestion state={state} setState={setState} label="Have you ever been sued by a landlord?" field="q_sued_landlord" />
        <ScreeningQuestion state={state} setState={setState} label="Do you own a waterbed or any water-filled furniture?" field="q_water_filled_furniture" />
        <ScreeningQuestion state={state} setState={setState} label="Do you or anyone in your household smoke?" field="q_smoker" />
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 11 — NOTES & ATTACHMENTS
// ────────────────────────────────────────────────────────────────────────────

function Step11({ state, setState, draftToken }: { state: WizardState; setState: SetState; draftToken: string }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadError(null)
    setUploading(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('draft_token', draftToken)
      fd.append('file', file)
      if (label.trim()) fd.append('label', label.trim())
      const r = await uploadAttachment(fd)
      if (r.success && r.attachment) {
        setState((p) => ({ ...p, attachments: [...p.attachments, r.attachment as Attachment] }))
      } else {
        setUploadError(r.message ?? 'Upload failed')
        break
      }
    }
    setUploading(false)
    setLabel('')
  }

  const onDelete = async (id: string) => {
    const r = await deleteAttachmentFromDraft({ draft_token: draftToken, attachment_id: id })
    if (r.success) {
      setState((p) => ({ ...p, attachments: p.attachments.filter((a) => a.id !== id) }))
    } else {
      setUploadError(r.message ?? 'Delete failed')
    }
  }

  return (
    <>
      <StepHeader title="Notes & Attachments" blurb="Add proof of income, ID copies, pet records, or anything else you'd like us to see." />

      <Field label="Notes for the Property Manager">
        <textarea
          value={state.notes}
          onChange={(e) => setState((p) => ({ ...p, notes: e.target.value }))}
          className={inputCls + ' min-h-[120px]'}
          placeholder="Anything you'd like us to know..."
        />
      </Field>

      <div className="mt-6">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Documents</h3>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
          className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-emerald-300 transition-colors"
        >
          <Upload size={28} className="text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Drag files here or</p>
          <label className="mt-2 inline-block">
            <span className="px-4 py-2 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 cursor-pointer transition-colors inline-block">
              {uploading ? 'Uploading...' : 'Choose Files'}
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
              onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          <p className="text-[10px] text-slate-400 mt-3">PDF, JPG, PNG, HEIC, DOC, DOCX · Max 10MB each</p>

          <div className="mt-4 max-w-sm mx-auto">
            <input
              type="text"
              placeholder="Optional label for next upload (e.g. 'Paystub - Jan 2026')"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls + ' text-xs'}
            />
          </div>
        </div>

        {uploadError && (
          <p className="text-sm font-bold text-amber-600 mt-3 flex items-center gap-2">
            <AlertCircle size={14} /> {uploadError}
          </p>
        )}

        {state.attachments.length > 0 && (
          <ul className="mt-4 space-y-2">
            {state.attachments.map((a) => (
              <li key={a.id} className="bg-slate-50 rounded-lg px-4 py-3 flex items-center gap-3">
                <Paperclip size={14} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{a.file_name}</p>
                  <p className="text-[10px] text-slate-400">
                    {a.label ? `${a.label} · ` : ''}
                    {a.file_size ? `${Math.round((a.file_size ?? 0) / 1024)} KB` : ''}
                  </p>
                </div>
                <button onClick={() => void onDelete(a.id)} className="text-slate-400 hover:text-amber-600">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 12 — CO-APPLICANTS
// ────────────────────────────────────────────────────────────────────────────

function Step12({ state, setState, draftToken }: { state: WizardState; setState: SetState; draftToken: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [type, setType] = useState<'Co-Signer' | 'Other Applicant'>('Other Applicant')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const add = async () => {
    setErr(null)
    if (!name.trim() || !email.trim()) {
      setErr('Name and email are required.')
      return
    }
    setAdding(true)
    const r = await addCoApplicantToDraft({
      draft_token: draftToken,
      full_name: name.trim(),
      email: email.trim(),
      applicant_type: type,
    })
    setAdding(false)
    if (r.success && r.coapplicant) {
      setState((p) => ({ ...p, coapplicants: [...p.coapplicants, r.coapplicant as CoApplicant] }))
      setName(''); setEmail(''); setType('Other Applicant')
    } else {
      setErr(r.message ?? 'Could not add co-applicant')
    }
  }

  const remove = async (id: string) => {
    const r = await removeCoApplicantFromDraft({ draft_token: draftToken, coapplicant_id: id })
    if (r.success) {
      setState((p) => ({ ...p, coapplicants: p.coapplicants.filter((c) => c.id !== id) }))
    } else {
      setErr(r.message ?? 'Could not remove co-applicant')
    }
  }

  return (
    <>
      <StepHeader
        title="Co-Applicants"
        blurb="Add anyone else applying with you. They'll each receive their own email with a link to fill out their portion — sent after you submit your application."
      />

      {state.coapplicants.length > 0 && (
        <ul className="space-y-2 mb-6">
          {state.coapplicants.map((c) => (
            <li key={c.id} className="bg-slate-50 rounded-xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900">{c.full_name}</p>
                <p className="text-xs text-slate-500">{c.email} · {c.applicant_type}</p>
                {c.invite_sent_at && (
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mt-1">Invited</p>
                )}
              </div>
              {!c.invite_sent_at && (
                <button onClick={() => void remove(c.id)} className="text-slate-400 hover:text-amber-600" aria-label="Remove">
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="bg-slate-50 rounded-xl p-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Add Co-Applicant</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Full Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as 'Co-Signer' | 'Other Applicant')} className={inputCls}>
              <option value="Other Applicant">Other Applicant</option>
              <option value="Co-Signer">Co-Signer</option>
            </select>
          </Field>
        </div>
        <button
          onClick={add}
          disabled={adding}
          className="mt-3 px-4 py-2 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-emerald-600 disabled:opacity-60 flex items-center gap-2"
        >
          <Plus size={12} /> {adding ? 'Adding...' : 'Add Co-Applicant'}
        </button>
        {err && (
          <p className="text-sm font-bold text-amber-600 mt-3 flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </p>
        )}
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 13 — REVIEW & SUBMIT
// ────────────────────────────────────────────────────────────────────────────

function Step13({
  state,
  issues,
  onJump,
  onSubmit,
  submitting,
}: {
  state: WizardState
  issues: Array<{ step: number; message: string }>
  onJump: (n: number) => void
  onSubmit: () => void
  submitting: boolean
}) {
  return (
    <>
      <StepHeader title="Review & Submit" blurb="Check the summary below. Click any section to jump back and edit." />

      {issues.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-black text-amber-800 mb-2 flex items-center gap-2">
            <AlertCircle size={14} /> Before you submit
          </p>
          <ul className="space-y-1">
            {issues.map((it, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-center justify-between gap-3">
                <span>· {it.message}</span>
                <button onClick={() => onJump(it.step)} className="text-[10px] font-black uppercase tracking-widest text-amber-700 hover:text-amber-900 underline">
                  Fix
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <ReviewRow step={1} title="Unit & Move-In" onJump={onJump}>
          {state.unit_id ? 'Unit selected.' : <em className="text-amber-600">No unit selected.</em>}
          {state.desired_move_in ? ` · Move in ${state.desired_move_in}.` : ''}
        </ReviewRow>
        <ReviewRow step={2} title="Identity" onJump={onJump}>
          {[state.salutation, state.legal_first_name, state.middle_name, state.last_name, state.suffix].filter(Boolean).join(' ') || <em className="text-amber-600">Name not set.</em>}
          {state.applicant_type && ` · ${state.applicant_type}`}
          {state.company_name && ` · ${state.company_name}`}
        </ReviewRow>
        <ReviewRow step={3} title="Contact" onJump={onJump}>
          {state.phones.length} phone{state.phones.length === 1 ? '' : 's'} · {state.emails.length} email{state.emails.length === 1 ? '' : 's'}
        </ReviewRow>
        <ReviewRow step={4} title="Residential" onJump={onJump}>
          {state.addresses.filter((a) => a.kind === 'current').length} current · {state.addresses.filter((a) => a.kind === 'previous').length} previous
        </ReviewRow>
        <ReviewRow step={5} title="Personal" onJump={onJump}>
          {state.date_of_birth ? `DOB ${state.date_of_birth}` : 'No DOB'}{' · '}
          {state.ssn_on_file || state.ssn_plaintext ? 'SSN on file' : 'No SSN'}{' · '}
          {state.gov_id_on_file || state.gov_id_plaintext ? 'Gov ID on file' : 'No gov ID'}
        </ReviewRow>
        <ReviewRow step={6} title="Financial" onJump={onJump}>
          {state.bank_accounts.length} bank account{state.bank_accounts.length === 1 ? '' : 's'} · {state.credit_cards.length} credit card{state.credit_cards.length === 1 ? '' : 's'}
        </ReviewRow>
        <ReviewRow step={7} title="Income" onJump={onJump}>
          {state.employer || 'No employer'}
          {state.monthly_salary !== '' && ` · $${Number(state.monthly_salary).toLocaleString()}/mo`}
          {' · '}{state.additional_income.length} extra income source{state.additional_income.length === 1 ? '' : 's'}
        </ReviewRow>
        <ReviewRow step={8} title="Household" onJump={onJump}>
          {state.dependents.length} dependent{state.dependents.length === 1 ? '' : 's'} · {state.pets.length} pet{state.pets.length === 1 ? '' : 's'}
        </ReviewRow>
        <ReviewRow step={9} title="Emergency" onJump={onJump}>
          {state.emergency_contacts[0]?.name || <em className="text-slate-400">Not set</em>}
        </ReviewRow>
        <ReviewRow step={10} title="Screening" onJump={onJump}>
          {[state.q_delinquent_payment, state.q_felony_conviction, state.q_sued_landlord, state.q_water_filled_furniture, state.q_smoker].filter((q) => q !== null).length} of 5 answered
        </ReviewRow>
        <ReviewRow step={11} title="Attachments" onJump={onJump}>
          {state.attachments.length} file{state.attachments.length === 1 ? '' : 's'}{state.notes ? ' · notes added' : ''}
        </ReviewRow>
        <ReviewRow step={12} title="Co-Applicants" onJump={onJump}>
          {state.coapplicants.length} co-applicant{state.coapplicants.length === 1 ? '' : 's'}
        </ReviewRow>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-100">
        <button
          onClick={onSubmit}
          disabled={submitting || issues.length > 0}
          className="w-full px-6 py-4 bg-emerald-600 text-white font-black text-sm uppercase tracking-widest rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><Loader2 size={16} className="animate-spin" /> Submitting...</>
          ) : (
            <>Submit Application <Check size={16} /></>
          )}
        </button>
        {issues.length > 0 && (
          <p className="text-xs text-slate-500 text-center mt-2">
            Resolve the items above before submitting.
          </p>
        )}
      </div>
    </>
  )
}

function ReviewRow({
  step,
  title,
  children,
  onJump,
}: {
  step: number
  title: string
  children: React.ReactNode
  onJump: (n: number) => void
}) {
  return (
    <button
      onClick={() => onJump(step)}
      className="w-full text-left bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl p-4 flex items-center gap-4"
    >
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 w-6">{step}</span>
      <div className="flex-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
        <p className="text-sm font-bold text-slate-900 mt-0.5">{children}</p>
      </div>
      <ChevronRight size={14} className="text-slate-400" />
    </button>
  )
}
