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
// 0. PUBLIC: LIST VACANT UNITS FOR THE WIZARD
// ────────────────────────────────────────────────────────────────────────────

/**
 * Public, no-auth listing of vacant units for the /apply wizard's unit
 * picker. The `units` table has RLS that requires `authenticated`, so the
 * browser anon client gets 0 rows back. This action runs server-side with
 * the service role and returns only the safe display fields.
 *
 * Intentionally returns a sanitized projection — no internal IDs beyond
 * what the wizard needs, no compliance/affordability internals.
 */
export type PublicVacantUnit = {
  id: string
  name: string | null
  market_rent: number | null
  bedroom_count: number | null
  bathrooms: number | null
  sqft: number | null
  availability_date: string | null
  property_name: string | null
}

export async function getPublicVacantUnits(): Promise<{
  success: true
  units: PublicVacantUnit[]
} | {
  success: false
  message: string
}> {
  const supabaseAdmin = getAdminClient()

  const { data, error } = await supabaseAdmin
    .from('units')
    .select('id, name, market_rent, bedroom_count, bathrooms, sqft, availability_date, properties(name)')
    .eq('status', 'Vacant')
    .order('availability_date', { ascending: true, nullsFirst: false })
    .limit(1000)

  if (error) {
    return { success: false, message: 'Could not load units: ' + error.message }
  }

  const units: PublicVacantUnit[] = ((data ?? []) as unknown[]).map((row) => {
    const u = row as {
      id: string
      name: string | null
      market_rent: number | null
      bedroom_count: number | null
      bathrooms: number | null
      sqft: number | null
      availability_date: string | null
      properties: { name: string | null } | Array<{ name: string | null }> | null
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

  return { success: true, units }
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
  // status='Pending' (not 'Submitted') so the new app shows up in the existing
  // admin pipeline's default filter without needing a UI change. The actual
  // "this app has been submitted" signal is `submitted_at IS NOT NULL`.
  const { error: updErr } = await supabaseAdmin
    .from('applications')
    .update({ submitted_at: now, status: 'Pending' })
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


// ────────────────────────────────────────────────────────────────────────────
// 5b. ADD CO-APPLICANT TO DRAFT (no email)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Add a co-applicant row to a draft application WITHOUT sending an invite.
 * The invite email is queued until the primary applicant submits the
 * application — submitApplication() will sweep up any rows with
 * invite_sent_at IS NULL and send them then.
 *
 * Used by the multi-step wizard so applicants can add/remove co-applicants
 * freely before deciding to submit.
 */
export async function addCoApplicantToDraft(params: {
  draft_token: string
  full_name: string
  email: string
  applicant_type: CoApplicantType
}) {
  const supabaseAdmin = getAdminClient()

  if (!params.full_name || !params.email) return { success: false, message: 'Name and email are required.' }
  if (!COAPPLICANT_TYPES.includes(params.applicant_type)) {
    return { success: false, message: `Invalid applicant_type: ${params.applicant_type}` }
  }

  const draft = await lookupDraft(supabaseAdmin, params.draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }
  if (draft.submitted_at) return { success: false, message: 'Application already submitted; cannot add co-applicants.' }

  const { data: row, error: insErr } = await supabaseAdmin
    .from('application_coapplicants')
    .insert({
      application_id: draft.id,
      full_name: params.full_name,
      email: params.email.toLowerCase(),
      applicant_type: params.applicant_type,
    })
    .select('id, full_name, email, applicant_type, status, invite_sent_at, submitted_at')
    .single()

  if (insErr || !row) return { success: false, message: 'Could not add co-applicant: ' + (insErr?.message ?? 'unknown') }

  return { success: true, coapplicant: row }
}


// ────────────────────────────────────────────────────────────────────────────
// 5c. REMOVE CO-APPLICANT FROM DRAFT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Remove a co-applicant from a draft. Only permitted if the parent app is
 * still a draft (not submitted) AND the co-applicant hasn't already been
 * invited. Prevents the primary from yanking a co-applicant who has
 * already received the email.
 */
export async function removeCoApplicantFromDraft(params: {
  draft_token: string
  coapplicant_id: string
}) {
  const supabaseAdmin = getAdminClient()

  if (!isValidUuid(params.coapplicant_id)) return { success: false, message: 'Invalid co-applicant id.' }
  const draft = await lookupDraft(supabaseAdmin, params.draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }
  if (draft.submitted_at) return { success: false, message: 'Application already submitted; cannot remove co-applicants.' }

  const { data: co } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, invite_sent_at, application_id')
    .eq('id', params.coapplicant_id)
    .maybeSingle()

  if (!co || co.application_id !== draft.id) {
    return { success: false, message: 'Co-applicant not found on this application.' }
  }
  if (co.invite_sent_at) {
    return { success: false, message: 'This co-applicant has already been invited and cannot be removed.' }
  }

  const { error: delErr } = await supabaseAdmin
    .from('application_coapplicants')
    .delete()
    .eq('id', params.coapplicant_id)

  if (delErr) return { success: false, message: 'Could not remove co-applicant: ' + delErr.message }
  return { success: true }
}


// ────────────────────────────────────────────────────────────────────────────
// 5d. DELETE ATTACHMENT FROM DRAFT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Remove an attachment from a draft application. Removes both the storage
 * object and the metadata row.
 */
export async function deleteAttachmentFromDraft(params: {
  draft_token: string
  attachment_id: string
}) {
  const supabaseAdmin = getAdminClient()

  if (!isValidUuid(params.attachment_id)) return { success: false, message: 'Invalid attachment id.' }
  const draft = await lookupDraft(supabaseAdmin, params.draft_token)
  if (!draft) return { success: false, message: 'Invalid or expired draft.' }
  if (draft.submitted_at) return { success: false, message: 'Application already submitted; cannot remove files.' }

  const { data: meta } = await supabaseAdmin
    .from('application_attachments')
    .select('id, file_path, application_id')
    .eq('id', params.attachment_id)
    .maybeSingle()

  if (!meta || meta.application_id !== draft.id) {
    return { success: false, message: 'Attachment not found on this application.' }
  }

  // Best-effort storage delete (the metadata is the source of truth for listings;
  // an orphan storage object is recoverable via housekeeping).
  await supabaseAdmin.storage.from('application-attachments').remove([meta.file_path]).catch(() => {})

  const { error: delErr } = await supabaseAdmin
    .from('application_attachments')
    .delete()
    .eq('id', params.attachment_id)

  if (delErr) return { success: false, message: 'Could not delete attachment: ' + delErr.message }
  return { success: true }
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

// ────────────────────────────────────────────────────────────────────────────
// 8. SAVE CO-APPLICANT DRAFT (per-step or full)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Payload the co-applicant portal sends. All fields optional — only what's
 * present gets written. SSN/gov-ID are accepted as plaintext and encrypted
 * server-side using the same pgcrypto key as the primary applicant.
 */
export type CoApplicantDraftPayload = {
  // Identity (read-only from invite; allow edit for typos)
  full_name?: string | null
  email?: string | null

  // Contact
  phone?: string | null

  // Personal IDs (PLAINTEXT input — server encrypts before storing)
  date_of_birth?: string | null
  ssn_plaintext?: string | null
  gov_id_plaintext?: string | null
  gov_id_issuing_state?: string | null

  // Current address
  current_street_1?: string | null
  current_street_2?: string | null
  current_city?: string | null
  current_state?: string | null
  current_postal_code?: string | null
  current_occupancy_type?: string | null
  current_monthly_payment?: number | null
  current_landlord_name?: string | null
  current_landlord_phone?: string | null

  // Employment
  employer?: string | null
  employer_phone?: string | null
  position_held?: string | null
  years_worked?: number | null
  monthly_salary?: number | null
  supervisor_name?: string | null
  supervisor_email?: string | null

  // Screening
  q_delinquent_payment?: boolean | null
  q_felony_conviction?: boolean | null
  q_sued_landlord?: boolean | null
  q_water_filled_furniture?: boolean | null
  q_smoker?: boolean | null

  // Notes
  notes?: string | null
}

const COAPPLICANT_SCALAR_FIELDS: ReadonlyArray<keyof CoApplicantDraftPayload> = [
  'full_name', 'email', 'phone',
  'date_of_birth', 'gov_id_issuing_state',
  'current_street_1', 'current_street_2', 'current_city', 'current_state',
  'current_postal_code', 'current_occupancy_type', 'current_monthly_payment',
  'current_landlord_name', 'current_landlord_phone',
  'employer', 'employer_phone', 'position_held', 'years_worked',
  'monthly_salary', 'supervisor_name', 'supervisor_email',
  'q_delinquent_payment', 'q_felony_conviction', 'q_sued_landlord',
  'q_water_filled_furniture', 'q_smoker',
  'notes',
] as const

/**
 * Save partial co-applicant data via their portal_token.
 * Rejects if the co-applicant has already submitted (`submitted_at IS NOT NULL`)
 * or if the parent application has been submitted then locked.
 */
export async function saveCoApplicantDraft(
  portal_token: string,
  payload: CoApplicantDraftPayload
) {
  const supabaseAdmin = getAdminClient()

  const co = await lookupCoApplicant(supabaseAdmin, portal_token)
  if (!co) return { success: false, message: 'Invalid or expired link.' }

  // Pull submitted_at + email lowercase normalization
  const { data: full } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, application_id, submitted_at')
    .eq('id', co.id)
    .single()
  if (!full) return { success: false, message: 'Co-applicant not found.' }
  if (full.submitted_at) {
    return { success: false, message: 'You have already submitted your portion.' }
  }

  // Build scalar updates
  const updates: Record<string, unknown> = {}
  for (const f of COAPPLICANT_SCALAR_FIELDS) {
    if (payload[f] !== undefined) updates[f as string] = payload[f]
  }
  // Lowercase email if updated
  if (typeof updates.email === 'string') updates.email = (updates.email as string).toLowerCase()

  // PII fields
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

  // Promote status from "Invited" to "Started" on first save
  // (getApplicationByCoApplicantToken already does this on landing, but be safe).
  // Don't downgrade an already-Started row.
  // The `status` column check constraint allows: Invited, Started, Submitted, Declined.
  // No-op if status is already Started/Submitted/Declined.
  // Doing it inline keeps us to one UPDATE round-trip.

  if (Object.keys(updates).length === 0) {
    return { success: true, message: 'Nothing to save.' }
  }

  const { error } = await supabaseAdmin
    .from('application_coapplicants')
    .update(updates)
    .eq('id', co.id)
  if (error) return { success: false, message: 'Could not save: ' + error.message }

  return { success: true, message: 'Saved.' }
}


// ────────────────────────────────────────────────────────────────────────────
// 9. SUBMIT CO-APPLICANT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark a co-applicant's portion as submitted. Idempotent.
 */
export async function submitCoApplicant(portal_token: string) {
  const supabaseAdmin = getAdminClient()

  const co = await lookupCoApplicant(supabaseAdmin, portal_token)
  if (!co) return { success: false, message: 'Invalid or expired link.' }

  const { data: full } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, submitted_at')
    .eq('id', co.id)
    .single()
  if (!full) return { success: false, message: 'Co-applicant not found.' }

  if (full.submitted_at) {
    return { success: true, message: 'Already submitted.', submitted_at: full.submitted_at }
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('application_coapplicants')
    .update({ submitted_at: now, status: 'Submitted' })
    .eq('id', co.id)

  if (error) return { success: false, message: 'Submit failed: ' + error.message }
  return { success: true, message: 'Submitted.', submitted_at: now }
}


// ────────────────────────────────────────────────────────────────────────────
// 10. UPLOAD CO-APPLICANT ATTACHMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * File upload for a co-applicant. Same bucket and metadata table as the
 * primary applicant; the metadata row records which co-applicant uploaded
 * it via `coapplicant_id`.
 *
 * FormData entries expected:
 *   - portal_token: string
 *   - file: File
 *   - label: string (optional)
 */
export async function uploadCoApplicantAttachment(formData: FormData) {
  const supabaseAdmin = getAdminClient()

  const token = formData.get('portal_token') as string | null
  const file  = formData.get('file') as File | null
  const label = (formData.get('label') as string | null) ?? null

  if (!token || !file) return { success: false, message: 'Missing portal_token or file.' }

  const co = await lookupCoApplicant(supabaseAdmin, token)
  if (!co) return { success: false, message: 'Invalid or expired link.' }

  const { data: full } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, application_id, submitted_at')
    .eq('id', co.id)
    .single()
  if (!full) return { success: false, message: 'Co-applicant not found.' }
  if (full.submitted_at) {
    return { success: false, message: 'Already submitted; cannot add files.' }
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, message: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 10MB.` }
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { success: false, message: `File type ${file.type || 'unknown'} not allowed.` }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80)
  const stamp    = Date.now().toString(36)
  const rand     = Math.random().toString(36).slice(2, 8)
  // Path: {application_id}/coapplicant-{coapplicant_id}/{ts}-{rand}-name
  const path     = `${full.application_id}/coapplicant-${full.id}/${stamp}-${rand}-${safeName}`

  const { error: upErr } = await supabaseAdmin.storage
    .from('application-attachments')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (upErr) return { success: false, message: 'Upload failed: ' + upErr.message }

  const { data: meta, error: insErr } = await supabaseAdmin
    .from('application_attachments')
    .insert({
      application_id: full.application_id,
      coapplicant_id: full.id,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type,
      label,
    })
    .select('id, file_name, file_path, file_size, mime_type, label, uploaded_at')
    .single()

  if (insErr) {
    await supabaseAdmin.storage.from('application-attachments').remove([path]).catch(() => {})
    return { success: false, message: 'Metadata save failed: ' + insErr.message }
  }

  return { success: true, attachment: meta }
}


// ────────────────────────────────────────────────────────────────────────────
// 11. DELETE CO-APPLICANT ATTACHMENT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Remove an attachment uploaded by this co-applicant. Only allowed if it
 * was theirs (coapplicant_id matches) and they haven't submitted yet.
 */
export async function deleteCoApplicantAttachment(params: {
  portal_token: string
  attachment_id: string
}) {
  const supabaseAdmin = getAdminClient()

  if (!isValidUuid(params.attachment_id)) return { success: false, message: 'Invalid attachment id.' }
  const co = await lookupCoApplicant(supabaseAdmin, params.portal_token)
  if (!co) return { success: false, message: 'Invalid or expired link.' }

  const { data: full } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, submitted_at')
    .eq('id', co.id)
    .single()
  if (!full) return { success: false, message: 'Co-applicant not found.' }
  if (full.submitted_at) return { success: false, message: 'Already submitted; cannot remove files.' }

  const { data: meta } = await supabaseAdmin
    .from('application_attachments')
    .select('id, file_path, coapplicant_id')
    .eq('id', params.attachment_id)
    .maybeSingle()

  if (!meta || meta.coapplicant_id !== co.id) {
    return { success: false, message: 'Attachment not found.' }
  }

  await supabaseAdmin.storage.from('application-attachments').remove([meta.file_path]).catch(() => {})
  const { error } = await supabaseAdmin
    .from('application_attachments')
    .delete()
    .eq('id', params.attachment_id)
  if (error) return { success: false, message: 'Could not delete: ' + error.message }
  return { success: true }
}


// ────────────────────────────────────────────────────────────────────────────
// 12. FETCH CO-APPLICANT FULL DATA (for resume)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the co-applicant's own data + parent application info, used by
 * the portal wizard to hydrate on load and on resume.
 *
 * Unlike `getApplicationByCoApplicantToken` (which is intentionally minimal),
 * this returns the full co-applicant row + their attachments so the wizard
 * can render a true resume experience.
 */
export async function getCoApplicantFull(portal_token: string) {
  const supabaseAdmin = getAdminClient()

  const co = await lookupCoApplicant(supabaseAdmin, portal_token)
  if (!co) return { success: false as const, message: 'Invalid or expired link.' }

  // Promote Invited → Started on first landing
  if (co.status === 'Invited') {
    await supabaseAdmin
      .from('application_coapplicants')
      .update({ status: 'Started' })
      .eq('id', co.id)
  }

  // Fetch full row (no encrypted bytea blobs)
  const { data: full } = await supabaseAdmin
    .from('application_coapplicants')
    .select(`
      id, application_id, full_name, email, applicant_type, status,
      submitted_at, invite_sent_at, phone,
      date_of_birth, ssn_last_4, gov_id_issuing_state,
      current_street_1, current_street_2, current_city, current_state,
      current_postal_code, current_occupancy_type, current_monthly_payment,
      current_landlord_name, current_landlord_phone,
      employer, employer_phone, position_held, years_worked,
      monthly_salary, supervisor_name, supervisor_email,
      q_delinquent_payment, q_felony_conviction, q_sued_landlord,
      q_water_filled_furniture, q_smoker, notes
    `)
    .eq('id', co.id)
    .single()

  if (!full) return { success: false as const, message: 'Co-applicant not found.' }

  // Parent app basics: unit name + property name + primary applicant name
  const { data: parent } = await supabaseAdmin
    .from('applications')
    .select(`
      id, first_name, last_name, desired_move_in, submitted_at,
      units ( name, properties ( name ) )
    `)
    .eq('id', full.application_id)
    .single()

  const parentUnits = parent && (parent as { units?: unknown }).units
  const unitRow = Array.isArray(parentUnits) ? parentUnits[0] : parentUnits
  const propRow = unitRow && (unitRow as { properties?: unknown }).properties
  const propObj = Array.isArray(propRow) ? propRow[0] : propRow

  // Attachments uploaded by this co-applicant
  const { data: attachments } = await supabaseAdmin
    .from('application_attachments')
    .select('id, file_name, file_path, file_size, mime_type, label, uploaded_at')
    .eq('coapplicant_id', full.id)
    .order('uploaded_at')

  return {
    success: true as const,
    coapplicant: {
      ...full,
      ssn_on_file: !!full.ssn_last_4,
      gov_id_on_file: !!full.gov_id_issuing_state,
    },
    parent_application: parent ? {
      id: (parent as { id: string }).id,
      primary_first_name: (parent as { first_name: string | null }).first_name,
      primary_last_name: (parent as { last_name: string | null }).last_name,
      desired_move_in: (parent as { desired_move_in: string | null }).desired_move_in,
      submitted_at: (parent as { submitted_at: string | null }).submitted_at,
      unit_name: (unitRow as { name?: string | null } | null)?.name ?? null,
      property_name: (propObj as { name?: string | null } | null)?.name ?? null,
    } : null,
    attachments: attachments ?? [],
  }
}


/** Verify the caller is logged in as an Admin (cookie-based). */
async function verifyAdminSession(): Promise<boolean> {
  const role = await getCallerRole()
  return role === 'Admin'
}

/** Verify the caller is an Admin or Property Manager. Used for review actions. */
async function verifyReviewerSession(): Promise<boolean> {
  const role = await getCallerRole()
  return role === 'Admin' || role === 'Property Manager'
}

/** Look up the caller's role from the cookie session. Null if not logged in. */
async function getCallerRole(): Promise<string | null> {
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
  if (!user) return null

  const supabaseAdmin = getAdminClient()
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return profile?.role ?? null
}


// ────────────────────────────────────────────────────────────────────────────
// 13. ADMIN: FETCH FULL APPLICATION FOR REVIEW
// ────────────────────────────────────────────────────────────────────────────

/**
 * Admin-side fetch returning the full v2 application data including all
 * child arrays, co-applicants (with their data), and attachments. Used
 * by the /admin/applications/[id] review page.
 *
 * Auth: Admin or Property Manager.
 */
export async function getApplicationForAdmin(application_id: string) {
  if (!isValidUuid(application_id)) return { success: false as const, message: 'Invalid application id.' }

  const isReviewer = await verifyReviewerSession()
  if (!isReviewer) return { success: false as const, message: 'Forbidden.' }

  const supabaseAdmin = getAdminClient()

  // Application scalar fields + the legacy flat-schema fields kept for
  // backwards compat with applications submitted before v2.
  const { data: app } = await supabaseAdmin
    .from('applications')
    .select(`
      id, unit_id, status, created_at, submitted_at, draft_email,
      first_name, middle_name, last_name, salutation, suffix,
      no_middle_name_certified, applicant_type,
      company_name, use_company_as_display_name,
      desired_move_in, date_of_birth,
      ssn_last_4, gov_id_issuing_state,
      employer, employer_phone, employer_address, employer_address_2,
      position_held, years_worked, supervisor_name, supervisor_title, supervisor_email,
      monthly_salary, income, annual_income,
      q_delinquent_payment, q_felony_conviction, q_sued_landlord,
      q_water_filled_furniture, q_smoker,
      notes,
      email, phone,
      screening_score, screening_status,
      credit_score
    `)
    .eq('id', application_id)
    .maybeSingle()

  if (!app) return { success: false as const, message: 'Application not found.' }

  // Property + unit for header
  let unitName: string | null = null
  let propertyName: string | null = null
  if (app.unit_id) {
    const { data: u } = await supabaseAdmin
      .from('units')
      .select('name, properties(name)')
      .eq('id', app.unit_id)
      .maybeSingle()
    if (u) {
      unitName = (u as { name: string | null }).name
      const props = (u as { properties: unknown }).properties
      const propRow = Array.isArray(props) ? props[0] : props
      propertyName = (propRow as { name?: string | null } | null)?.name ?? null
    }
  }

  // Child arrays + attachments + co-applicants — fetched in parallel
  const [
    phones, emails, addresses, dependents, pets, banks, cards, addlIncome, emergency, coapps, attachments,
  ] = await Promise.all([
    supabaseAdmin.from('application_phones').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_emails').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_addresses').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_dependents').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_pets').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_bank_accounts').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_credit_cards').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_additional_income').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_emergency_contacts').select('*').eq('application_id', application_id).order('sort_order'),
    supabaseAdmin.from('application_coapplicants').select('*').eq('application_id', application_id).order('created_at'),
    supabaseAdmin.from('application_attachments').select('*').eq('application_id', application_id).order('uploaded_at'),
  ])

  return {
    success: true as const,
    application: {
      ...app,
      property_name: propertyName,
      unit_name: unitName,
    },
    phones: phones.data ?? [],
    emails: emails.data ?? [],
    addresses: addresses.data ?? [],
    dependents: dependents.data ?? [],
    pets: pets.data ?? [],
    bank_accounts: banks.data ?? [],
    credit_cards: cards.data ?? [],
    additional_income: addlIncome.data ?? [],
    emergency_contacts: emergency.data ?? [],
    coapplicants: coapps.data ?? [],
    attachments: attachments.data ?? [],
  }
}


// ────────────────────────────────────────────────────────────────────────────
// 14. ADMIN: SIGNED URL FOR ATTACHMENT DOWNLOAD
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a 5-minute signed URL for an attachment so admin/PM can download
 * a private bucket file. Doesn't expose the path itself.
 */
export async function getAttachmentSignedUrl(attachment_id: string) {
  if (!isValidUuid(attachment_id)) return { success: false as const, message: 'Invalid attachment id.' }
  const isReviewer = await verifyReviewerSession()
  if (!isReviewer) return { success: false as const, message: 'Forbidden.' }

  const supabaseAdmin = getAdminClient()
  const { data: meta } = await supabaseAdmin
    .from('application_attachments')
    .select('file_path, file_name')
    .eq('id', attachment_id)
    .maybeSingle()

  if (!meta) return { success: false as const, message: 'Attachment not found.' }

  const { data: signed, error } = await supabaseAdmin.storage
    .from('application-attachments')
    .createSignedUrl(meta.file_path, 300, { download: meta.file_name })

  if (error || !signed?.signedUrl) {
    return { success: false as const, message: error?.message ?? 'Could not create download link.' }
  }
  return { success: true as const, url: signed.signedUrl, file_name: meta.file_name }
}


// ────────────────────────────────────────────────────────────────────────────
// 15. ADMIN: RESEND CO-APPLICANT INVITE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Re-send the invite email to a co-applicant. Useful when the original
 * email bounced, was deleted, or never landed. Updates invite_sent_at on success.
 */
export async function resendCoApplicantInvite(coapplicant_id: string) {
  if (!isValidUuid(coapplicant_id)) return { success: false as const, message: 'Invalid co-applicant id.' }
  const isReviewer = await verifyReviewerSession()
  if (!isReviewer) return { success: false as const, message: 'Forbidden.' }

  const supabaseAdmin = getAdminClient()
  const { data: co } = await supabaseAdmin
    .from('application_coapplicants')
    .select('id, full_name, email, applicant_type, portal_token, submitted_at')
    .eq('id', coapplicant_id)
    .maybeSingle()

  if (!co) return { success: false as const, message: 'Co-applicant not found.' }
  if (co.submitted_at) {
    return { success: false as const, message: 'This co-applicant has already submitted their portion.' }
  }

  await sendCoApplicantInvite(supabaseAdmin, co)
  return { success: true as const }
}
