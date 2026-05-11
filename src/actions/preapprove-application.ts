'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Move a Pending application into the Leasing CRM as a Lead.
 *
 * This is the "preapproved — keep warm" step between intake and full approval.
 * PM reviews the app, clicks Preapprove, and the applicant lands in the CRM
 * at stage='Applied' where the leasing team can log tours, contacts, notes,
 * etc. before deciding on a lease.
 *
 * Idempotent: the partial unique index ux_leads_application_id
 * (migration 066) guarantees at most one lead per application. A second
 * call returns success without creating a duplicate.
 */

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
    return { error: 'Forbidden: Only Admins and Property Managers can preapprove applications.' }
  }

  return { supabaseAdmin, callerId: caller.id, callerName: callerProfile.full_name }
}

export async function preapproveApplication(
  applicationId: string
): Promise<{ success: boolean; message: string; leadId?: string }> {
  const auth = await getVerifiedManagement()
  if ('error' in auth) return { success: false, message: auth.error as string }
  const { supabaseAdmin, callerId, callerName } = auth

  // 1. Fetch application + join units → property for CRM linking.
  const { data: app, error: fetchError } = await supabaseAdmin
    .from('applications')
    .select('id, first_name, last_name, email, phone, status, unit_id, units(property_id)')
    .eq('id', applicationId)
    .single()

  if (fetchError || !app) {
    return { success: false, message: 'Application not found.' }
  }

  if (app.status !== 'Pending') {
    return {
      success: false,
      message: `Application already ${String(app.status).toLowerCase()} — only Pending applications can be preapproved.`,
    }
  }

  // 2. If a lead already exists for this application, don't duplicate.
  //    (The partial unique index enforces this at the DB level too.)
  const { data: existingLead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle()

  if (existingLead) {
    // Still flip the status so the UI reflects reality.
    await supabaseAdmin
      .from('applications')
      .update({ status: 'Preapproved' })
      .eq('id', applicationId)
    return {
      success: true,
      message: 'Already preapproved — lead exists in CRM.',
      leadId: existingLead.id,
    }
  }

  // 3. Flip application status first so the list UI reacts immediately.
  const { error: statusError } = await supabaseAdmin
    .from('applications')
    .update({ status: 'Preapproved' })
    .eq('id', applicationId)

  if (statusError) {
    return { success: false, message: `Failed to update application: ${statusError.message}` }
  }

  // 4. Insert the lead at stage='New' so the leasing team walks it through
  //    the full pipeline (Contacted → Tour → ... → Leased). The original
  //    application is preserved via application_id and surfaced in the lead
  //    detail panel's "View Application" link.
  // deno-lint-ignore no-explicit-any — the units join is typed as an array/object depending on relation shape
  const propertyId = (app.units as any)?.property_id ?? null

  const { data: newLead, error: leadError } = await supabaseAdmin
    .from('leads')
    .insert({
      first_name: app.first_name,
      last_name: app.last_name,
      email: app.email,
      phone: app.phone,
      source: 'website', // applications come through /apply
      interested_unit_id: app.unit_id,
      interested_property_id: propertyId,
      stage: 'New',
      application_id: app.id,
      assigned_to: callerId, // the PM who preapproved owns the lead
      notes: `Preapproved from application on ${new Date().toLocaleDateString()} by ${callerName ?? 'PM'}.`,
    })
    .select('id')
    .single()

  if (leadError || !newLead) {
    // Roll back status change so a retry works cleanly.
    await supabaseAdmin
      .from('applications')
      .update({ status: 'Pending' })
      .eq('id', applicationId)
    return {
      success: false,
      message: `Failed to create lead: ${leadError?.message ?? 'unknown error'}`,
    }
  }

  // 5. Log the handoff in lead_activities so the CRM timeline starts with context.
  await supabaseAdmin.from('lead_activities').insert({
    lead_id: newLead.id,
    activity_type: 'application_received',
    description: `Preapproved from rental application by ${callerName ?? 'PM'}.`,
    created_by: callerId,
  })

  return {
    success: true,
    message: `Preapproved — ${app.first_name} ${app.last_name} is now in the Leasing CRM.`,
    leadId: newLead.id,
  }
}
