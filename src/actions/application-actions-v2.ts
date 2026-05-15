'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS / TYPES
// ────────────────────────────────────────────────────────────────────────────

const APPLICANT_TYPES = ['Financially Responsible', 'Co-Signer', 'Other Applicant'] as const
const COAPPLICANT_TYPES = ['Co-Signer', 'Other Applicant'] as const
const ADDRESS_KINDS = ['current', 'previous'] as const
const SUFFIXES = ['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'] as const
const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.'] as const

type ApplicantType = typeof APPLICANT_TYPES[number]
type CoApplicantType = typeof COAPPLICANT_TYPES[number]
type AddressKind = typeof ADDRESS_KINDS[number]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/** Public application URL for co-applicant invite emails. */
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rylexapm.fly.dev'

// Payload shape applicants send from the wizard at every step. Every field is
// optional — only the keys present in a given save get written. Child arrays
// use "replace on save" semantics (delete then insert) since the wizard step
// holds the full list locally.
export type ApplicationDraftPayload = {
  // Identity
  salutation?: string | null
  legal_first_name?: string | null
  middle_name?: string | null
  no_middle_name_certified?: boolean | null
  suffix?: string | null
  last_name?: string | null
  applicant_type?: ApplicantType | null
  company_name?: string | null
  use_company_as_display_name?: boolean | null

  // Move-in
  desired_move_in?: string | null    // YYYY-MM-DD
  unit_id?: string | null

  // Personal IDs (PLAINTEXT input — server encrypts before storing)
  ssn_plaintext?: string | null      // full SSN/ITIN; encrypted before DB
  gov_id_plaintext?: string | null
  gov_id_issuing_state?: string | null
  date_of_birth?: string | null

  // Employment
  employer?: string | null
  employer_phone?: string | null
  employer_address?: string | null
  employer_address_2?: string | null
  position_held?: string | null
  years_worked?: number | null
  supervisor_name?: string | null
  supervisor_title?: string | null
  supervisor_email?: string | null
  monthly_salary?: number | null

  // Screening questions
  q_delinquent_payment?: boolean | null
  q_felony_conviction?: boolean | null
  q_sued_landlord?: boolean | null
  q_water_filled_furniture?: boolean | null
  q_smoker?: boolean | null

  // Notes
  notes?: string | null

  // Child arrays (replace-on-save when present)
  phones?: Array<{ label?: string; phone_number: string; is_primary?: boolean }>
  emails?: Array<{ email: string; is_primary?: boolean }>
  addresses?: Array<{
    kind: AddressKind
    street_1?: string; street_2?: string; city?: string; state?: string
    postal_code?: string; country?: string
    occupancy_type?: string
    resided_from?: string; resided_to?: string
    monthly_payment?: number
    landlord_name?: string; landlord_phone?: string; landlord_email?: string
    reason_for_leaving?: string
  }>
  dependents?: Array<{ first_name: string; last_name: string; date_of_birth?: string; relationship?: string }>
  pets?: Array<{ name?: string; type_breed?: string; weight_lbs?: number; age_years?: number }>
  bank_accounts?: Array<{ bank_name: string; account_type?: string; account_last4?: string; balance?: number }>
  credit_cards?: Array<{ issuer?: string; balance?: number }>
  additional_income?: Array<{ source?: string; monthly_amount?: number }>
  emergency_contacts?: Array<{ name?: string; address?: string; phone?: string; email?: string; relationship?: string }>
}


// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

/** Service-role client. Bypasses RLS — only used inside server actions. */
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** Encryption key from env. Throws if missing — better to fail loudly. */
function getPiiKey(): string {
  const k = process.env.APPLICATION_PII_ENCRYPTION_KEY
  if (!k) throw new Error('APPLICATION_PII_ENCRYPTION_KEY not configured')
  return k
}

/** Validate UUID format. Defends against junk values reaching the DB. */
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/** Extract last 4 digits from an SSN/ITIN. Accepts "XXX-XX-1234" or "XXXXX1234". */
function extractLast4(s: string): string | null {
  const digits = s.replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

/** Find the application row matching this draft token (or null). */
async function lookupDraft(supabaseAdmin: ReturnType<typeof getAdminClient>, draftToken: string) {
  if (!isValidUuid(draftToken)) return null
  const { data } = await supabaseAdmin
    .from('applications')
    .select('id, submitted_at, draft_token, unit_id')
    .eq('draft_token', draftToken)
    .maybeSingle()
  return data
}

/** Find the co-applicant row matching this portal token (or null). */
async function lookupCoApplicant(supabaseAdmin: ReturnType<typeof getAdminClient>, portalToken: string) {
  if (!isValidUuid(portalToken)) return null
  const { data } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, application_id, status, email, full_name, applicant_type, portal_token')
    .eq('portal_token', portalToken)
    .maybeSingle()
  return data
}

/** Whitelist of scalar columns on `applications` that the wizard can write. */
const SCALAR_FIELDS: ReadonlyArray<keyof ApplicationDraftPayload> = [
  'salutation', 'middle_name', 'no_middle_name_certified', 'suffix',
  'applicant_type', 'company_name', 'use_company_as_display_name',
  'desired_move_in', 'unit_id', 'gov_id_issuing_state', 'date_of_birth',
  'employer', 'employer_phone', 'employer_address', 'employer_address_2',
  'position_held', 'years_worked', 'supervisor_name', 'supervisor_title',
  'supervisor_email', 'monthly_salary',
  'q_delinquent_payment', 'q_felony_conviction', 'q_sued_landlord',
  'q_water_filled_furniture', 'q_smoker',
  'notes', 'last_name',
] as const

/** Build the column-update object for the applications table from a payload. */
function buildScalarUpdates(payload: ApplicationDraftPayload): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  // legal_first_name → first_name (existing column)
  if (payload.legal_first_name !== undefined) updates.first_name = payload.legal_first_name
  // Whitelisted fields — pass through if present
  for (const f of SCALAR_FIELDS) {
    if (payload[f] !== undefined) updates[f as string] = payload[f]
  }
  return updates
}

/** Optional validation — return error string or null. */
function validatePayload(p: ApplicationDraftPayload): string | null {
  if (p.applicant_type !== undefined && p.applicant_type !== null && !APPLICANT_TYPES.includes(p.applicant_type)) {
    return `Invalid applicant_type: ${p.applicant_type}`
  }
  if (p.suffix !== undefined && p.suffix !== null && !SUFFIXES.includes(p.suffix as typeof SUFFIXES[number])) {
    return `Invalid suffix: ${p.suffix}`
  }
  if (p.salutation !== undefined && p.salutation !== null && !SALUTATIONS.includes(p.salutation as typeof SALUTATIONS[number])) {
    return `Invalid salutation: ${p.salutation}`
  }
  if (p.addresses) {
    for (const a of p.addresses) {
      if (!ADDRESS_KINDS.includes(a.kind)) return `Invalid address kind: ${a.kind}`
      if (a.resided_from && a.resided_to && a.resided_to < a.resided_from) {
        return 'Address resided_to must be on or after resided_from'
      }
    }
  }
  if (p.bank_accounts) {
    for (const b of p.bank_accounts) {
      if (b.account_last4 && !/^[0-9]{4}$/.test(b.account_last4)) {
        return `Bank account last4 must be exactly 4 digits, got "${b.account_last4}"`
      }
    }
  }
  return null
}


// ────────────────────────────────────────────────────────────────────────────
// 1. CREATE DRAFT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a new draft application. Called when the applicant lands on the
 * wizard (or picks a unit). Returns the application id and a draft_token
 * the client can use to save progress and resume later.
 */
export async function createDraft(params: { unit_id?: string | null; draft_email?: string | null }) {
  const supabaseAdmin = getAdminClient()

  const insertPayload: Record<string, unknown> = { status: 'Draft' }
  if (params.unit_id && isValidUuid(params.unit_id)) insertPayload.unit_id = params.unit_id
  if (params.draft_email) insertPayload.draft_email = params.draft_email

  const { data, error } = await supabaseAdmin
    .from('applications')
    .insert(insertPayload)
    .select('id, draft_token')
    .single()

  if (error || !data) {
    return { success: false, message: 'Could not create application: ' + (error?.message ?? 'unknown') }
  }

  return {
    success: true,
    application_id: data.id as string,
    draft_token: data.draft_token as string,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// 2. SAVE DRAFT (per-step or full)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Save (partial) form data to an existing draft. Validates draft_token.
 * Rejects if the application has already been submitted.
 */
export async function saveDraft(draft_token: string, payload: ApplicationDraftPayload) {
  const supabaseAdmin = getAdminClient()

  const draft = await lookupDraft(supabaseAdmin, draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }
  if (draft.submitted_at) return { success: false, message: 'This application has already been submitted and cannot be modified.' }

  const validationError = validatePayload(payload)
  if (validationError) return { success: false, message: validationError }

  // Scalar column updates on applications
  const updates = buildScalarUpdates(payload)

  // PII fields: encrypt before storing
  if (payload.ssn_plaintext !== undefined) {
    if (payload.ssn_plaintext === null || payload.ssn_plaintext.trim() === '') {
      updates.ssn_encrypted = null
      updates.ssn_last_4 = null
    } else {
      const key = getPiiKey()
      const { data: encResult, error: encErr } = await supabaseAdmin.rpc('encrypt_pii', {
        p_plaintext: payload.ssn_plaintext,
        p_key: key,
      })
      if (encErr) return { success: false, message: 'Could not secure SSN: ' + encErr.message }
      updates.ssn_encrypted = encResult
      updates.ssn_last_4 = extractLast4(payload.ssn_plaintext)
    }
  }

  if (payload.gov_id_plaintext !== undefined) {
    if (payload.gov_id_plaintext === null || payload.gov_id_plaintext.trim() === '') {
      updates.gov_id_encrypted = null
    } else {
      const key = getPiiKey()
      const { data: encResult, error: encErr } = await supabaseAdmin.rpc('encrypt_pii', {
        p_plaintext: payload.gov_id_plaintext,
        p_key: key,
      })
      if (encErr) return { success: false, message: 'Could not secure government ID: ' + encErr.message }
      updates.gov_id_encrypted = encResult
    }
  }

  // Apply scalar updates if any
  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin
      .from('applications')
      .update(updates)
      .eq('id', draft.id)
    if (error) return { success: false, message: 'Could not save: ' + error.message }
  }

  // Child arrays — replace-on-save (delete existing, insert new) per provided list
  type ChildSpec = { key: keyof ApplicationDraftPayload; table: string }
  const childTables: ChildSpec[] = [
    { key: 'phones',              table: 'application_phones' },
    { key: 'emails',              table: 'application_emails' },
    { key: 'addresses',           table: 'application_addresses' },
    { key: 'dependents',          table: 'application_dependents' },
    { key: 'pets',                table: 'application_pets' },
    { key: 'bank_accounts',       table: 'application_bank_accounts' },
    { key: 'credit_cards',        table: 'application_credit_cards' },
    { key: 'additional_income',   table: 'application_additional_income' },
    { key: 'emergency_contacts',  table: 'application_emergency_contacts' },
  ]

  for (const { key, table } of childTables) {
    const rows = payload[key] as Array<Record<string, unknown>> | undefined
    if (rows === undefined) continue   // not provided this save → skip

    // Delete existing rows for this application
    const { error: delErr } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('application_id', draft.id)
    if (delErr) return { success: false, message: `Could not replace ${key}: ${delErr.message}` }

    if (rows.length === 0) continue   // empty array → already wiped, nothing to insert

    // Insert with sort_order based on array index
    const inserts = rows.map((r, i) => ({
      ...r,
      application_id: draft.id,
      sort_order: i,
    }))
    const { error: insErr } = await supabaseAdmin.from(table).insert(inserts)
    if (insErr) return { success: false, message: `Could not save ${key}: ${insErr.message}` }
  }

  return { success: true, message: 'Saved.' }
}


// ────────────────────────────────────────────────────────────────────────────
// 3. SUBMIT APPLICATION
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark the application as submitted. Idempotent — if already submitted,
 * returns success with the existing submitted_at.
 * After submission, sends invite emails to any co-applicants that haven't
 * been invited yet.
 */
export async function submitApplication(draft_token: string) {
  const supabaseAdmin = getAdminClient()

  const draft = await lookupDraft(supabaseAdmin, draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }

  if (draft.submitted_at) {
    return { success: true, message: 'Already submitted.', submitted_at: draft.submitted_at, application_id: draft.id }
  }

  const now = new Date().toISOString()
  const { error: updErr } = await supabaseAdmin
    .from('applications')
    .update({ submitted_at: now, status: 'Submitted' })
    .eq('id', draft.id)
  if (updErr) return { success: false, message: 'Submit failed: ' + updErr.message }

  // Send co-applicant invites for any not-yet-invited rows
  const { data: pending } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, full_name, email, applicant_type, portal_token')
    .eq('application_id', draft.id)
    .is('invite_sent_at', null)

  for (const co of pending ?? []) {
    await sendCoApplicantInvite(supabaseAdmin, co)
  }

  return { success: true, message: 'Application submitted.', submitted_at: now, application_id: draft.id }
}


// ────────────────────────────────────────────────────────────────────────────
// 4. UPLOAD ATTACHMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upload a file attachment to an application. Validates draft_token + file
 * size/type (extra defense layer beyond bucket settings). Writes file to
 * the `application-attachments` bucket and a metadata row.
 *
 * Server action signature: FormData (since file upload).
 * FormData entries expected:
 *   - draft_token: string
 *   - file: File
 *   - label: string (optional)
 */
export async function uploadAttachment(formData: FormData) {
  const supabaseAdmin = getAdminClient()

  const draftToken = formData.get('draft_token') as string | null
  const file       = formData.get('file') as File | null
  const label      = (formData.get('label') as string | null) ?? null

  if (!draftToken || !file) return { success: false, message: 'Missing draft_token or file.' }

  const draft = await lookupDraft(supabaseAdmin, draftToken)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }
  if (draft.submitted_at) return { success: false, message: 'Application already submitted; cannot add files.' }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, message: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 10MB.` }
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { success: false, message: `File type ${file.type || 'unknown'} not allowed. Use PDF, JPG, PNG, HEIC, DOC, or DOCX.` }
  }

  // Build storage path. Sanitize filename and prefix with timestamp + random
  // so two same-named uploads don't collide.
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80)
  const stamp    = Date.now().toString(36)
  const rand     = Math.random().toString(36).slice(2, 8)
  const path     = `${draft.id}/${stamp}-${rand}-${safeName}`

  const { error: upErr } = await supabaseAdmin.storage
    .from('application-attachments')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (upErr) return { success: false, message: 'Upload failed: ' + upErr.message }

  const { data: meta, error: insErr } = await supabaseAdmin
    .from('application_attachments')
    .insert({
      application_id: draft.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type,
      label,
    })
    .select('id, file_name, file_path, file_size, mime_type, label, uploaded_at')
    .single()

  if (insErr) {
    // Best-effort: try to roll back the storage upload
    await supabaseAdmin.storage.from('application-attachments').remove([path]).catch(() => {})
    return { success: false, message: 'Metadata save failed: ' + insErr.message }
  }

  return { success: true, attachment: meta }
}


// ────────────────────────────────────────────────────────────────────────────
// 5. INVITE CO-APPLICANT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Add a co-applicant to an application and email them a portal link.
 * Caller must provide a valid draft_token (primary applicant invoking) OR
 * be an admin (via server-session check below).
 */
export async function inviteCoApplicant(params: {
  draft_token?: string             // applicant-side flow
  application_id?: string          // admin-side flow (requires admin auth)
  full_name: string
  email: string
  applicant_type: CoApplicantType
}) {
  const supabaseAdmin = getAdminClient()

  if (!params.full_name || !params.email) return { success: false, message: 'Name and email are required.' }
  if (!COAPPLICANT_TYPES.includes(params.applicant_type)) {
    return { success: false, message: `Invalid applicant_type: ${params.applicant_type}` }
  }

  // Resolve application_id from either the draft_token or admin auth
  let applicationId: string | null = null

  if (params.draft_token) {
    const draft = await lookupDraft(supabaseAdmin, params.draft_token)
    if (!draft) return { success: false, message: 'Invalid or expired draft.' }
    applicationId = draft.id
  } else if (params.application_id) {
    // Admin path: verify caller is admin via cookie session
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return { success: false, message: 'Forbidden: must be admin or provide draft_token.' }
    if (!isValidUuid(params.application_id)) return { success: false, message: 'Invalid application_id.' }
    applicationId = params.application_id
  } else {
    return { success: false, message: 'Must provide draft_token or application_id.' }
  }

  // Create the co-applicant row
  const { data: row, error: insErr } = await supabaseAdmin
    .from('application_coapplicants')
    .insert({
      application_id: applicationId,
      full_name: params.full_name,
      email: params.email.toLowerCase(),
      applicant_type: params.applicant_type,
    })
    .select('id, full_name, email, applicant_type, portal_token')
    .single()

  if (insErr || !row) return { success: false, message: 'Could not create co-applicant: ' + (insErr?.message ?? 'unknown') }

  // Send the invite email (best-effort — log but don't fail the action if email fails)
  await sendCoApplicantInvite(supabaseAdmin, row)

  return { success: true, coapplicant: { id: row.id, email: row.email } }
}

/** Helper: send a co-applicant the magic-link email + update invite_sent_at. */
async function sendCoApplicantInvite(
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  co: { id: string; full_name: string; email: string; applicant_type: string; portal_token: string }
) {
  const portalUrl = `${APP_BASE_URL}/apply/co/${co.portal_token}`
  const subject = 'Rental Application — Action Required'
  const htmlBody = `
    <p>Hi ${escapeHtml(co.full_name)},</p>
    <p>You've been listed as a <strong>${escapeHtml(co.applicant_type)}</strong> on a rental application.
    To complete your portion of the application, click the link below:</p>
    <p><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#10b981;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Open your application section</a></p>
    <p>Or copy this URL: <code>${portalUrl}</code></p>
    <p>This link is unique to you — don't share it.</p>
    <p>— Rylexa Property Management</p>
  `

  try {
    await supabaseAdmin.functions.invoke('send-email', {
      body: { to: co.email, subject, html: htmlBody },
    })
    await supabaseAdmin
      .from('application_coapplicants')
      .update({ invite_sent_at: new Date().toISOString() })
      .eq('id', co.id)
  } catch (err) {
    console.error('Co-applicant invite email failed:', err)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  )
}


// ────────────────────────────────────────────────────────────────────────────
// 6. FETCH APPLICATION BY DRAFT TOKEN (for resume flow)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full application + child rows for a given draft_token.
 * SSN/gov-ID are NEVER returned in plaintext, even in resume — applicant
 * sees masked placeholder and re-enters if they want to change.
 */
export async function getApplicationByDraftToken(draft_token: string) {
  const supabaseAdmin = getAdminClient()

  const draft = await lookupDraft(supabaseAdmin, draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }

  return await fetchFullApplication(supabaseAdmin, draft.id)
}


// ────────────────────────────────────────────────────────────────────────────
// 7. FETCH APPLICATION BY CO-APPLICANT TOKEN
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the parent application's basic info + this co-applicant's own
 * row, for the co-applicant portal. Does NOT return other co-applicants
 * or sensitive PII of the primary.
 */
export async function getApplicationByCoApplicantToken(portal_token: string) {
  const supabaseAdmin = getAdminClient()

  const co = await lookupCoApplicant(supabaseAdmin, portal_token)
  if (!co) return { success: false, message: 'Invalid or expired link.' }

  // Mark as "Started" if it was "Invited"
  if (co.status === 'Invited') {
    await supabaseAdmin
      .from('application_coapplicants')
      .update({ status: 'Started' })
      .eq('id', co.id)
  }

  const { data: parentApp } = await supabaseAdmin
    .from('applications')
    .select('id, first_name, last_name, unit_id, desired_move_in')
    .eq('id', co.application_id)
    .single()

  return {
    success: true,
    coapplicant: {
      id: co.id,
      full_name: co.full_name,
      email: co.email,
      applicant_type: co.applicant_type,
      status: co.status === 'Invited' ? 'Started' : co.status,
    },
    primary_applicant: parentApp ? {
      first_name: parentApp.first_name,
      last_name: parentApp.last_name,
      unit_id: parentApp.unit_id,
      desired_move_in: parentApp.desired_move_in,
    } : null,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// HELPERS continued
// ────────────────────────────────────────────────────────────────────────────

/** Fetch the application + all child arrays. Used by resume + admin review. */
async function fetchFullApplication(supabaseAdmin: ReturnType<typeof getAdminClient>, applicationId: string) {
  // Application scalar fields (excluding raw encrypted blobs)
  const { data: app, error } = await supabaseAdmin
    .from('applications')
    .select(`
      id, unit_id, status, created_at, submitted_at, draft_email,
      salutation, first_name, middle_name, no_middle_name_certified, suffix, last_name,
      applicant_type, company_name, use_company_as_display_name,
      desired_move_in, date_of_birth,
      ssn_last_4, gov_id_issuing_state,
      employer, employer_phone, employer_address, employer_address_2,
      position_held, years_worked, supervisor_name, supervisor_title, supervisor_email,
      monthly_salary, income, annual_income,
      q_delinquent_payment, q_felony_conviction, q_sued_landlord,
      q_water_filled_furniture, q_smoker,
      notes
    `)
    .eq('id', applicationId)
    .single()

  if (error || !app) return { success: false, message: 'Application not found.' }

  // Child arrays — fetch in parallel
  const [
    phones, emails, addresses, dependents, pets, banks, cards, addlIncome, emergency, coapps, attachments,
  ] = await Promise.all([
    supabaseAdmin.from('application_phones').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_emails').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_addresses').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_dependents').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_pets').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_bank_accounts').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_credit_cards').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_additional_income').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_emergency_contacts').select('*').eq('application_id', applicationId).order('sort_order'),
    supabaseAdmin.from('application_coapplicants').select('id, full_name, email, applicant_type, status, invite_sent_at, submitted_at').eq('application_id', applicationId),
    supabaseAdmin.from('application_attachments').select('id, file_name, file_path, file_size, mime_type, label, uploaded_at').eq('application_id', applicationId),
  ])

  return {
    success: true,
    application: {
      ...app,
      ssn_on_file: !!app.ssn_last_4,    // placeholder boolean for client
      gov_id_on_file: !!app.gov_id_issuing_state,
    },
    phones:             phones.data ?? [],
    emails:             emails.data ?? [],
    addresses:          addresses.data ?? [],
    dependents:         dependents.data ?? [],
    pets:               pets.data ?? [],
    bank_accounts:      banks.data ?? [],
    credit_cards:       cards.data ?? [],
    additional_income:  addlIncome.data ?? [],
    emergency_contacts: emergency.data ?? [],
    coapplicants:       coapps.data ?? [],
    attachments:        attachments.data ?? [],
  }
}

/** Verify the caller is logged in as an Admin (cookie-based). */
async function verifyAdminSession(): Promise<boolean> {
  const cookieStore = await cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set() {}, remove() {},
      },
    }
  )

  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return false

  const supabaseAdmin = getAdminClient()
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role === 'Admin'
}
