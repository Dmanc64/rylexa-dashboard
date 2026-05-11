'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ── HELPERS ──

/** Authenticate the caller and verify they are Admin or Property Manager. */
async function getVerifiedManagement() {
  const cookieStore = await cookies()

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set() {},
        remove() {},
      },
    }
  )

  const { data: { user: caller }, error: authError } = await supabaseAuth.auth.getUser()

  if (authError || !caller) {
    return { error: 'Unauthorized: You must be logged in.' }
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', caller.id)
    .single()

  if (!callerProfile || !['Admin', 'Property Manager'].includes(callerProfile.role)) {
    return { error: 'Forbidden: Only Admins and Property Managers can process applications.' }
  }

  return { supabaseAdmin, callerId: caller.id, callerName: callerProfile.full_name }
}

/** Lease details provided from the Tenant Build Modal */
export type LeaseDetails = {
  rent: number
  deposit: number
  proratedRent?: number
  utilityFee?: number
  startDate: string
  endDate?: string
  existingTenantId?: string
}

/**
 * Process an application — approve or deny.
 * On approval with leaseDetails: creates/reuses tenant, creates lease with real values, marks unit Occupied.
 * On denial: just updates the application status.
 */
export async function processApplication(
  applicationId: string,
  action: 'Approved' | 'Denied',
  leaseDetails?: LeaseDetails
): Promise<{ success: boolean; message: string }> {
  const result = await getVerifiedManagement()
  if ('error' in result) return { success: false, message: result.error as string }
  const { supabaseAdmin } = result

  // 1. Fetch the application
  const { data: app, error: fetchError } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('id', applicationId)
    .single()

  if (fetchError || !app) {
    return { success: false, message: 'Application not found.' }
  }

  // Pending and Preapproved are both valid starting states — a PM can jump
  // straight from intake to approval, or go through the CRM handoff first.
  // Remember the original status so we can restore it cleanly on a failure
  // midway through tenant/lease creation.
  const originalStatus: 'Pending' | 'Preapproved' | string = app.status
  if (originalStatus !== 'Pending' && originalStatus !== 'Preapproved') {
    return { success: false, message: `Application already ${String(originalStatus).toLowerCase()}.` }
  }

  // 2. Update application status
  const { error: updateError } = await supabaseAdmin
    .from('applications')
    .update({ status: action })
    .eq('id', applicationId)

  if (updateError) {
    return { success: false, message: `Failed to update application: ${updateError.message}` }
  }

  // 3. If denied, we're done
  if (action === 'Denied') {
    return { success: true, message: `Application for ${app.first_name} ${app.last_name} denied.` }
  }

  // 4. On approval — resolve or create tenant
  const fullName = `${app.first_name} ${app.last_name}`.trim()
  let tenantId: string

  if (leaseDetails?.existingTenantId) {
    // Verify the tenant actually exists before reactivating
    const { data: existingTenant, error: lookupError } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('id', leaseDetails.existingTenantId)
      .single()

    if (lookupError || !existingTenant) {
      await supabaseAdmin.from('applications').update({ status: originalStatus }).eq('id', applicationId)
      return { success: false, message: 'Existing tenant not found. Cannot reactivate.' }
    }

    // Reuse existing tenant — update their status to Active
    const { error: reactivateError } = await supabaseAdmin
      .from('tenants')
      .update({ status: 'Active' })
      .eq('id', leaseDetails.existingTenantId)

    if (reactivateError) {
      await supabaseAdmin.from('applications').update({ status: originalStatus }).eq('id', applicationId)
      return { success: false, message: `Failed to reactivate tenant: ${reactivateError.message}` }
    }

    tenantId = leaseDetails.existingTenantId
  } else {
    // Create new tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        first_name: app.first_name,
        last_name: app.last_name,
        full_name: fullName,
        email: app.email,
        phone: app.phone,
        status: 'Active',
      })
      .select('id')
      .single()

    if (tenantError) {
      await supabaseAdmin.from('applications').update({ status: originalStatus }).eq('id', applicationId)
      return { success: false, message: `Failed to create tenant: ${tenantError.message}` }
    }

    tenantId = tenant.id
  }

  // 5. Create lease with provided details (or fallback defaults)
  if (app.unit_id) {
    const { error: leaseError } = await supabaseAdmin
      .from('leases')
      .insert({
        tenant_id: tenantId,
        unit_id: app.unit_id,
        rent_amount: leaseDetails?.rent ?? 0,
        security_deposit: leaseDetails?.deposit ?? 0,
        prorated_rent: leaseDetails?.proratedRent ?? null,
        utility_fee: leaseDetails?.utilityFee ?? 0,
        start_date: leaseDetails?.startDate ?? new Date().toISOString().split('T')[0],
        end_date: leaseDetails?.endDate || null,
        status: 'Active',
      })

    if (leaseError) {
      return {
        success: true,
        message: `Tenant ${fullName} ready but lease creation failed: ${leaseError.message}. Create lease manually.`,
      }
    }

    // 6. Mark unit as Occupied
    await supabaseAdmin
      .from('units')
      .update({ status: 'Occupied' })
      .eq('id', app.unit_id)
  }

  // 7. If this application was preapproved and has a linked lead in the CRM,
  //    advance that lead to stage='Leased' so the pipeline closes cleanly.
  //    Best-effort — never fail the approval if CRM bookkeeping hiccups.
  const { data: linkedLead } = await supabaseAdmin
    .from('leads')
    .select('id, stage')
    .eq('application_id', applicationId)
    .maybeSingle()

  if (linkedLead && linkedLead.stage !== 'Leased') {
    await supabaseAdmin
      .from('leads')
      .update({ stage: 'Leased' })
      .eq('id', linkedLead.id)
    await supabaseAdmin.from('lead_activities').insert({
      lead_id: linkedLead.id,
      activity_type: 'stage_change',
      description: `Advanced to Leased — lease created for ${fullName}.`,
    })
  }

  const reusedLabel = leaseDetails?.existingTenantId ? ' (returning tenant)' : ''
  return {
    success: true,
    message: `Application approved! Lease created for ${fullName}${reusedLabel}.`,
  }
}
