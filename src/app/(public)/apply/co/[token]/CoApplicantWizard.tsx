'use client'

/**
 * Co-applicant portal wizard.
 *
 * 6 steps:
 *  1. Welcome — confirm identity, capture phone
 *  2. Personal — DOB, SSN, gov ID, current address
 *  3. Employment — employer, salary, supervisor
 *  4. Screening — 5 yes/no
 *  5. Attachments — drag-drop + notes
 *  6. Review & submit
 *
 * Auto-save 1.2s after last edit, plus immediate save on each Continue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  saveCoApplicantDraft,
  submitCoApplicant,
  uploadCoApplicantAttachment,
  deleteCoApplicantAttachment,
  type CoApplicantDraftPayload,
} from '@/actions/application-actions-v2'
import {
  Check, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Upload, Paperclip, Trash2,
  User, MapPin, Briefcase, HelpCircle, FileText,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

type CoApplicantInitial = {
  id: string
  application_id: string
  full_name: string
  email: string
  applicant_type: 'Co-Signer' | 'Other Applicant'
  status: string
  submitted_at: string | null
  invite_sent_at: string | null
  phone: string | null
  date_of_birth: string | null
  ssn_last_4: string | null
  ssn_on_file: boolean
  gov_id_issuing_state: string | null
  gov_id_on_file: boolean
  current_street_1: string | null
  current_street_2: string | null
  current_city: string | null
  current_state: string | null
  current_postal_code: string | null
  current_occupancy_type: string | null
  current_monthly_payment: number | null
  current_landlord_name: string | null
  current_landlord_phone: string | null
  employer: string | null
  employer_phone: string | null
  position_held: string | null
  years_worked: number | null
  monthly_salary: number | null
  supervisor_name: string | null
  supervisor_email: string | null
  q_delinquent_payment: boolean | null
  q_felony_conviction: boolean | null
  q_sued_landlord: boolean | null
  q_water_filled_furniture: boolean | null
  q_smoker: boolean | null
  notes: string | null
}

type ParentApplication = {
  id: string
  primary_first_name: string | null
  primary_last_name: string | null
  desired_move_in: string | null
  submitted_at: string | null
  unit_name: string | null
  property_name: string | null
} | null

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
  full_name: string
  email: string
  phone: string
  date_of_birth: string
  ssn_plaintext: string
  ssn_on_file: boolean
  gov_id_plaintext: string
  gov_id_on_file: boolean
  gov_id_issuing_state: string
  current_street_1: string
  current_street_2: string
  current_city: string
  current_state: string
  current_postal_code: string
  current_occupancy_type: string
  current_monthly_payment: number | ''
  current_landlord_name: string
  current_landlord_phone: string
  employer: string
  employer_phone: string
  position_held: string
  years_worked: number | ''
  monthly_salary: number | ''
  supervisor_name: string
  supervisor_email: string
  q_delinquent_payment: boolean | null
  q_felony_conviction: boolean | null
  q_sued_landlord: boolean | null
  q_water_filled_furniture: boolean | null
  q_smoker: boolean | null
  notes: string
}

type Props = {
  portalToken: string
  coapplicant: CoApplicantInitial
  parentApplication: ParentApplication
  initialAttachments: Attachment[]
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function s(v: unknown): string { return v === null || v === undefined ? '' : String(v) }
function bn(v: unknown): boolean | null { return v === null || v === undefined ? null : Boolean(v) }
function n(v: unknown): number | '' {
  if (v === null || v === undefined || v === '') return ''
  const x = Number(v); return Number.isFinite(x) ? x : ''
}

function hydrate(co: CoApplicantInitial): WizardState {
  return {
    full_name: s(co.full_name),
    email: s(co.email),
    phone: s(co.phone),
    date_of_birth: s(co.date_of_birth),
    ssn_plaintext: '',
    ssn_on_file: co.ssn_on_file,
    gov_id_plaintext: '',
    gov_id_on_file: co.gov_id_on_file,
    gov_id_issuing_state: s(co.gov_id_issuing_state),
    current_street_1: s(co.current_street_1),
    current_street_2: s(co.current_street_2),
    current_city: s(co.current_city),
    current_state: s(co.current_state),
    current_postal_code: s(co.current_postal_code),
    current_occupancy_type: s(co.current_occupancy_type),
    current_monthly_payment: n(co.current_monthly_payment),
    current_landlord_name: s(co.current_landlord_name),
    current_landlord_phone: s(co.current_landlord_phone),
    employer: s(co.employer),
    employer_phone: s(co.employer_phone),
    position_held: s(co.position_held),
    years_worked: n(co.years_worked),
    monthly_salary: n(co.monthly_salary),
    supervisor_name: s(co.supervisor_name),
    supervisor_email: s(co.supervisor_email),
    q_delinquent_payment: bn(co.q_delinquent_payment),
    q_felony_conviction: bn(co.q_felony_conviction),
    q_sued_landlord: bn(co.q_sued_landlord),
    q_water_filled_furniture: bn(co.q_water_filled_furniture),
    q_smoker: bn(co.q_smoker),
    notes: s(co.notes),
  }
}

function toPayload(state: WizardState): CoApplicantDraftPayload {
  const ne = (v: string) => (v.trim() === '' ? null : v)
  const num = (v: number | '') => (v === '' ? null : v)
  return {
    full_name: ne(state.full_name),
    email: ne(state.email),
    phone: ne(state.phone),
    date_of_birth: ne(state.date_of_birth),
    ssn_plaintext: state.ssn_plaintext ? state.ssn_plaintext : undefined,
    gov_id_plaintext: state.gov_id_plaintext ? state.gov_id_plaintext : undefined,
    gov_id_issuing_state: ne(state.gov_id_issuing_state),
    current_street_1: ne(state.current_street_1),
    current_street_2: ne(state.current_street_2),
    current_city: ne(state.current_city),
    current_state: ne(state.current_state),
    current_postal_code: ne(state.current_postal_code),
    current_occupancy_type: ne(state.current_occupancy_type),
    current_monthly_payment: num(state.current_monthly_payment),
    current_landlord_name: ne(state.current_landlord_name),
    current_landlord_phone: ne(state.current_landlord_phone),
    employer: ne(state.employer),
    employer_phone: ne(state.employer_phone),
    position_held: ne(state.position_held),
    years_worked: num(state.years_worked),
    monthly_salary: num(state.monthly_salary),
    supervisor_name: ne(state.supervisor_name),
    supervisor_email: ne(state.supervisor_email),
    q_delinquent_payment: state.q_delinquent_payment,
    q_felony_conviction: state.q_felony_conviction,
    q_sued_landlord: state.q_sued_landlord,
    q_water_filled_furniture: state.q_water_filled_furniture,
    q_smoker: state.q_smoker,
    notes: ne(state.notes),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP CATALOG
// ────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'Welcome',     sub: 'Confirm who you are',     icon: User },
  { id: 2, title: 'Personal',    sub: 'DOB, IDs, address',       icon: MapPin },
  { id: 3, title: 'Employment',  sub: 'Income & employer',       icon: Briefcase },
  { id: 4, title: 'Screening',   sub: 'Five quick questions',    icon: HelpCircle },
  { id: 5, title: 'Documents',   sub: 'Files & notes',           icon: Paperclip },
  { id: 6, title: 'Review',      sub: 'Submit your portion',     icon: FileText },
] as const

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────

export function CoApplicantWizard({
  portalToken,
  coapplicant,
  parentApplication,
  initialAttachments,
}: Props) {
  const [state, setState] = useState<WizardState>(() => hydrate(coapplicant))
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments)
  const [step, setStep] = useState<number>(1)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const isAlreadySubmitted = !!coapplicant.submitted_at

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const doSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    const result = await saveCoApplicantDraft(portalToken, toPayload(state))
    setSaving(false)
    if (result.success) {
      setSavedAt(new Date())
      dirty.current = false
    } else {
      setSaveError(result.message ?? 'Could not save')
    }
    return result.success
  }, [portalToken, state])

  useEffect(() => {
    if (isAlreadySubmitted) return
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void doSave() }, 1200)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [state, doSave, isAlreadySubmitted])

  const advance = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (dirty.current) { const ok = await doSave(); if (!ok) return }
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
      if (!ok) { setSubmitting(false); return }
    }
    const result = await submitCoApplicant(portalToken)
    setSubmitting(false)
    if (result.success) setSubmitted(result.submitted_at ?? new Date().toISOString())
    else setSaveError(result.message ?? 'Could not submit')
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
            Thanks, {coapplicant.full_name.split(' ')[0]}!
          </h1>
          <p className="text-slate-500 text-sm mt-3">
            Your portion of the application has been submitted. We&apos;ll be in touch as the review progresses.
          </p>
        </div>
      </main>
    )
  }

  const primaryName =
    [parentApplication?.primary_first_name, parentApplication?.primary_last_name].filter(Boolean).join(' ') ||
    'the applicant'

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 md:p-6">

        {/* Top bar */}
        <header className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-4 md:p-6 mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">
              Co-Applicant Portal
            </p>
            <h1 className="text-xl md:text-2xl font-black italic uppercase text-slate-900 truncate">
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
                      active ? 'bg-slate-900 text-white'
                      : done ? 'text-emerald-700 hover:bg-emerald-50'
                      : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        active ? 'bg-white/15 text-white'
                        : done ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {done ? <Check size={14} /> : <Icon size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-widest leading-tight">{s.title}</p>
                      <p className={`text-[10px] font-medium leading-tight ${active ? 'text-white/60' : 'text-slate-400'}`}>{s.sub}</p>
                    </div>
                  </button>
                )
              })}
            </nav>
            <p className="text-[10px] text-slate-400 font-medium mt-3 px-3">
              Your progress is saved automatically. You can come back to this URL later.
            </p>
          </aside>

          {/* Main panel */}
          <section className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm p-6 md:p-8">
              {step === 1 && (
                <Step1
                  state={state}
                  setState={setState}
                  coapplicant={coapplicant}
                  parentApplication={parentApplication}
                  primaryName={primaryName}
                />
              )}
              {step === 2 && <Step2 state={state} setState={setState} />}
              {step === 3 && <Step3 state={state} setState={setState} />}
              {step === 4 && <Step4 state={state} setState={setState} />}
              {step === 5 && (
                <Step5
                  state={state}
                  setState={setState}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  portalToken={portalToken}
                />
              )}
              {step === 6 && (
                <Step6
                  state={state}
                  attachments={attachments}
                  primaryName={primaryName}
                  issues={validationIssues}
                  onJump={goto}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                />
              )}
            </div>

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
  if (!state.full_name.trim()) issues.push({ step: 1, message: 'Your name is required.' })
  if (!state.email.trim()) issues.push({ step: 1, message: 'Your email is required.' })
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
  return `${Math.floor(min / 60)}h ago`
}

function YesNoToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
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

// ────────────────────────────────────────────────────────────────────────────
// STEP 1 — WELCOME / IDENTITY
// ────────────────────────────────────────────────────────────────────────────

function Step1({
  state,
  setState,
  coapplicant,
  parentApplication,
  primaryName,
}: {
  state: WizardState
  setState: SetState
  coapplicant: CoApplicantInitial
  parentApplication: ParentApplication
  primaryName: string
}) {
  return (
    <>
      <StepHeader
        title={`Hi, ${coapplicant.full_name.split(' ')[0] || 'there'}`}
        blurb={`You've been listed as a ${coapplicant.applicant_type.toLowerCase()} on ${primaryName}'s rental application${parentApplication?.property_name ? ` for ${parentApplication.property_name}${parentApplication.unit_name ? ` — Unit ${parentApplication.unit_name}` : ''}` : ''}.`}
      />

      <div className="bg-slate-50 rounded-xl p-4 mb-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Application Details</p>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">Primary Applicant</dt>
          <dd className="font-bold text-slate-900">{primaryName}</dd>
          {parentApplication?.property_name && (
            <>
              <dt className="text-slate-500">Property</dt>
              <dd className="font-bold text-slate-900">{parentApplication.property_name} — Unit {parentApplication.unit_name}</dd>
            </>
          )}
          {parentApplication?.desired_move_in && (
            <>
              <dt className="text-slate-500">Desired Move-In</dt>
              <dd className="font-bold text-slate-900">{parentApplication.desired_move_in}</dd>
            </>
          )}
          <dt className="text-slate-500">Your Role</dt>
          <dd className="font-bold text-slate-900">{coapplicant.applicant_type}</dd>
        </dl>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Your Full Name" required>
          <input
            type="text"
            value={state.full_name}
            onChange={(e) => setState((p) => ({ ...p, full_name: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="Your Email" required>
          <input
            type="email"
            value={state.email}
            onChange={(e) => setState((p) => ({ ...p, email: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="Your Phone">
          <input
            type="tel"
            value={state.phone}
            onChange={(e) => setState((p) => ({ ...p, phone: e.target.value }))}
            placeholder="(555) 555-5555"
            className={inputCls}
          />
        </Field>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — PERSONAL & ADDRESS
// ────────────────────────────────────────────────────────────────────────────

function Step2({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader
        title="Personal & Address"
        blurb="SSN/ITIN and gov ID are optional but help speed up screening. They're encrypted before being stored — only the last 4 of your SSN is ever shown back."
      />

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Identity</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Date of Birth">
          <input
            type="date"
            value={state.date_of_birth}
            onChange={(e) => setState((p) => ({ ...p, date_of_birth: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="SSN / ITIN" hint="9 digits. Format flexible.">
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

      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 mt-8">Current Address</h3>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-8">
          <Field label="Street Address">
            <input type="text" value={state.current_street_1} onChange={(e) => setState((p) => ({ ...p, current_street_1: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="col-span-12 md:col-span-4">
          <Field label="Apt / Unit">
            <input type="text" value={state.current_street_2} onChange={(e) => setState((p) => ({ ...p, current_street_2: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="col-span-6 md:col-span-5">
          <Field label="City">
            <input type="text" value={state.current_city} onChange={(e) => setState((p) => ({ ...p, current_city: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="col-span-3">
          <Field label="State">
            <input type="text" value={state.current_state} onChange={(e) => setState((p) => ({ ...p, current_state: e.target.value }))} className={inputCls} maxLength={2} />
          </Field>
        </div>
        <div className="col-span-3 md:col-span-4">
          <Field label="ZIP">
            <input type="text" value={state.current_postal_code} onChange={(e) => setState((p) => ({ ...p, current_postal_code: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="col-span-6 md:col-span-4">
          <Field label="Occupancy Type">
            <select value={state.current_occupancy_type} onChange={(e) => setState((p) => ({ ...p, current_occupancy_type: e.target.value }))} className={inputCls}>
              <option value="">—</option>
              {['Rent', 'Own', 'Family', 'Other'].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        </div>
        <div className="col-span-6 md:col-span-4">
          <Field label="Monthly Payment">
            <input
              type="number"
              value={state.current_monthly_payment}
              onChange={(e) => setState((p) => ({ ...p, current_monthly_payment: e.target.value === '' ? '' : Number(e.target.value) }))}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="col-span-12 md:col-span-6">
          <Field label="Landlord Name">
            <input type="text" value={state.current_landlord_name} onChange={(e) => setState((p) => ({ ...p, current_landlord_name: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="col-span-12 md:col-span-6">
          <Field label="Landlord Phone">
            <input type="tel" value={state.current_landlord_phone} onChange={(e) => setState((p) => ({ ...p, current_landlord_phone: e.target.value }))} className={inputCls} />
          </Field>
        </div>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3 — EMPLOYMENT
// ────────────────────────────────────────────────────────────────────────────

function Step3({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Employment" blurb="Tell us where you work and what you earn." />
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
        <Field label="Monthly Salary">
          <input
            type="number"
            value={state.monthly_salary}
            onChange={(e) => setState((p) => ({ ...p, monthly_salary: e.target.value === '' ? '' : Number(e.target.value) }))}
            className={inputCls}
          />
        </Field>
        <Field label="Supervisor Name">
          <input type="text" value={state.supervisor_name} onChange={(e) => setState((p) => ({ ...p, supervisor_name: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Supervisor Email">
          <input type="email" value={state.supervisor_email} onChange={(e) => setState((p) => ({ ...p, supervisor_email: e.target.value }))} className={inputCls} />
        </Field>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 4 — SCREENING
// ────────────────────────────────────────────────────────────────────────────

type ScreeningField =
  | 'q_delinquent_payment'
  | 'q_felony_conviction'
  | 'q_sued_landlord'
  | 'q_water_filled_furniture'
  | 'q_smoker'

function ScreeningQuestion({
  label, field, state, setState,
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

function Step4({ state, setState }: { state: WizardState; setState: SetState }) {
  return (
    <>
      <StepHeader title="Screening Questions" blurb="Honest answers help us place you. A 'yes' isn't automatically disqualifying." />
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
// STEP 5 — DOCUMENTS & NOTES
// ────────────────────────────────────────────────────────────────────────────

function Step5({
  state, setState, attachments, setAttachments, portalToken,
}: {
  state: WizardState
  setState: SetState
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  portalToken: string
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadError(null)
    setUploading(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('portal_token', portalToken)
      fd.append('file', file)
      if (label.trim()) fd.append('label', label.trim())
      const r = await uploadCoApplicantAttachment(fd)
      if (r.success && r.attachment) {
        setAttachments((prev) => [...prev, r.attachment as Attachment])
      } else {
        setUploadError(r.message ?? 'Upload failed')
        break
      }
    }
    setUploading(false)
    setLabel('')
  }

  const onDelete = async (id: string) => {
    const r = await deleteCoApplicantAttachment({ portal_token: portalToken, attachment_id: id })
    if (r.success) {
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    } else {
      setUploadError(r.message ?? 'Delete failed')
    }
  }

  return (
    <>
      <StepHeader title="Documents & Notes" blurb="Upload proof of income, ID copies, or anything else you'd like us to see. Add notes if you want to add context." />

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

        {attachments.length > 0 && (
          <ul className="mt-4 space-y-2">
            {attachments.map((a) => (
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
// STEP 6 — REVIEW & SUBMIT
// ────────────────────────────────────────────────────────────────────────────

function Step6({
  state, attachments, primaryName, issues, onJump, onSubmit, submitting,
}: {
  state: WizardState
  attachments: Attachment[]
  primaryName: string
  issues: Array<{ step: number; message: string }>
  onJump: (n: number) => void
  onSubmit: () => void
  submitting: boolean
}) {
  return (
    <>
      <StepHeader title="Review & Submit" blurb={`Review your portion before you submit it. ${primaryName}'s application will be reviewed together with yours.`} />

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
        <ReviewRow step={1} title="Identity" onJump={onJump}>
          {state.full_name || <em className="text-amber-600">No name set</em>} · {state.email || <em className="text-amber-600">No email</em>}{state.phone && ` · ${state.phone}`}
        </ReviewRow>
        <ReviewRow step={2} title="Personal & Address" onJump={onJump}>
          {state.date_of_birth ? `DOB ${state.date_of_birth}` : 'No DOB'} ·{' '}
          {state.ssn_on_file || state.ssn_plaintext ? 'SSN on file' : 'No SSN'} ·{' '}
          {state.current_city ? `${state.current_city}, ${state.current_state}` : 'No address'}
        </ReviewRow>
        <ReviewRow step={3} title="Employment" onJump={onJump}>
          {state.employer || 'No employer'}
          {state.monthly_salary !== '' && ` · $${Number(state.monthly_salary).toLocaleString()}/mo`}
        </ReviewRow>
        <ReviewRow step={4} title="Screening" onJump={onJump}>
          {[state.q_delinquent_payment, state.q_felony_conviction, state.q_sued_landlord, state.q_water_filled_furniture, state.q_smoker].filter((q) => q !== null).length} of 5 answered
        </ReviewRow>
        <ReviewRow step={5} title="Documents" onJump={onJump}>
          {attachments.length} file{attachments.length === 1 ? '' : 's'}{state.notes ? ' · notes added' : ''}
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
            <>Submit My Portion <Check size={16} /></>
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
  step, title, children, onJump,
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
