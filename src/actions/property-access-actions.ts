'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

const ACCESS_LEVELS = ['Property Manager', 'Accounting', 'Owner'] as const
const PERMISSION_TIERS = ['full', 'read'] as const

type AccessLevel = typeof ACCESS_LEVELS[number]
type PermissionTier = typeof PERMISSION_TIERS[number]

/**
 * Tier consistency rules — must match the CHECK constraint in migration 069:
 *   Property Manager → tier MUST be 'full'
 *   Owner            → tier MUST be 'read'
 *   Accounting       → tier MAY be 'full' or 'read'
 */
function defaultTierFor(level: AccessLevel): PermissionTier {
  if (level === 'Property Manager') return 'full'
  if (level === 'Owner') return 'read'
  return 'full' // Accounting default
}

function validateTierForLevel(level: AccessLevel, tier: PermissionTier): string | null {
  if (level === 'Property Manager' && tier !== 'full') {
    return 'Property Manager grants must be tier "full".'
  }
  if (level === 'Owner' && tier !== 'read') {
    return 'Owner grants must be tier "read".'
  }
  if (level === 'Accounting' && tier !== 'full' && tier !== 'read') {
    return 'Accounting tier must be "full" or "read".'
  }
  return null
}


// ────────────────────────────────────────────────────────────────────────────
// AUTH HELPER (mirrors manage-user.ts pattern)
// ────────────────────────────────────────────────────────────────────────────

async function getVerifiedAdmin() {
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
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'Admin') {
    return { error: 'Forbidden: Only Admins can manage property access.' }
  }

  return { supabaseAdmin, callerId: caller.id }
}


// ────────────────────────────────────────────────────────────────────────────
// GRANT — single (user, property, level)
// ────────────────────────────────────────────────────────────────────────────

export async function grantPropertyAccess(params: {
  userId: string
  propertyId: string
  accessLevel: AccessLevel
  permissionTier?: PermissionTier   // defaults from level if omitted
  expiresAt?: string | null         // ISO timestamp; null = no expiry
  notes?: string | null
}) {
  const { userId, propertyId, accessLevel, expiresAt = null, notes = null } = params
  const permissionTier = params.permissionTier ?? defaultTierFor(accessLevel)

  if (!ACCESS_LEVELS.includes(accessLevel)) {
    return { success: false, message: `Invalid access_level: ${accessLevel}` }
  }
  const tierError = validateTierForLevel(accessLevel, permissionTier)
  if (tierError) return { success: false, message: tierError }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin, callerId } = result

  // Verify the target user actually has the matching role on their profile
  // (e.g., don't grant 'Property Manager' access to a user whose role is 'Tenant')
  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, is_active')
    .eq('id', userId)
    .single()

  if (!targetProfile) {
    return { success: false, message: 'Target user not found.' }
  }
  if (targetProfile.is_active === false) {
    return { success: false, message: 'Target user is disabled.' }
  }
  if (targetProfile.role !== accessLevel) {
    return {
      success: false,
      message: `User ${targetProfile.full_name || userId} has role "${targetProfile.role}" — cannot grant "${accessLevel}" access. Change their role first.`,
    }
  }

  // Verify the property exists
  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .single()

  if (!property) {
    return { success: false, message: 'Property not found.' }
  }

  const { error: insertError } = await supabaseAdmin
    .from('property_access')
    .insert({
      user_id: userId,
      property_id: propertyId,
      access_level: accessLevel,
      permission_tier: permissionTier,
      granted_by: callerId,
      expires_at: expiresAt,
      notes,
    })

  if (insertError) {
    // Likely unique-constraint hit if the grant already exists
    if (insertError.code === '23505') {
      return {
        success: false,
        message: `${targetProfile.full_name || userId} already has "${accessLevel}" access on ${property.name}.`,
      }
    }
    return { success: false, message: 'Grant failed: ' + insertError.message }
  }

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'PROPERTY_ACCESS',
    title: 'Property access granted',
    description: `${targetProfile.full_name || userId} granted "${accessLevel}/${permissionTier}" on ${property.name}`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access')
  revalidatePath('/admin/settings/users')
  return {
    success: true,
    message: `Granted ${accessLevel} (${permissionTier}) to ${targetProfile.full_name || userId} on ${property.name}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// REVOKE — by access row id
// ────────────────────────────────────────────────────────────────────────────

export async function revokePropertyAccess(accessId: string) {
  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin } = result

  // Delete the row and return what was removed in one round-trip.
  // If no row matched, .single() returns an error and we report "already revoked."
  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from('property_access')
    .delete()
    .eq('id', accessId)
    .select('id, access_level, permission_tier, user_id, property_id')
    .single()

  if (deleteError || !deleted) {
    if (deleteError && deleteError.code !== 'PGRST116') {
      return { success: false, message: 'Revoke failed: ' + deleteError.message }
    }
    return { success: false, message: 'Access grant not found (already revoked?).' }
  }

  // Look up names separately for the audit log + toast message
  const [{ data: profile }, { data: property }] = await Promise.all([
    supabaseAdmin.from('profiles').select('full_name').eq('id', deleted.user_id).single(),
    supabaseAdmin.from('properties').select('name').eq('id', deleted.property_id).single(),
  ])

  const userName     = profile?.full_name ?? deleted.user_id
  const propertyName = property?.name     ?? deleted.property_id

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'PROPERTY_ACCESS',
    title: 'Property access revoked',
    description: `${userName} lost "${deleted.access_level}/${deleted.permission_tier}" on ${propertyName}`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access')
  revalidatePath('/admin/settings/users')
  return {
    success: true,
    message: `Revoked ${deleted.access_level} access from ${userName} on ${propertyName}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// BULK GRANT — one user, many properties, same level
// ────────────────────────────────────────────────────────────────────────────

export async function bulkGrantPropertyAccess(params: {
  userId: string
  propertyIds: string[]
  accessLevel: AccessLevel
  permissionTier?: PermissionTier
}) {
  const { userId, propertyIds, accessLevel } = params
  const permissionTier = params.permissionTier ?? defaultTierFor(accessLevel)

  if (!ACCESS_LEVELS.includes(accessLevel)) {
    return { success: false, message: `Invalid access_level: ${accessLevel}` }
  }
  const tierError = validateTierForLevel(accessLevel, permissionTier)
  if (tierError) return { success: false, message: tierError }
  if (!propertyIds.length) {
    return { success: false, message: 'No properties selected.' }
  }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin, callerId } = result

  // Verify target user
  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, is_active')
    .eq('id', userId)
    .single()

  if (!targetProfile) return { success: false, message: 'Target user not found.' }
  if (targetProfile.is_active === false) return { success: false, message: 'Target user is disabled.' }
  if (targetProfile.role !== accessLevel) {
    return {
      success: false,
      message: `User has role "${targetProfile.role}" — cannot grant "${accessLevel}" access.`,
    }
  }

  // Build rows, idempotent via upsert on the unique key
  const rows = propertyIds.map((propertyId) => ({
    user_id: userId,
    property_id: propertyId,
    access_level: accessLevel,
    permission_tier: permissionTier,
    granted_by: callerId,
  }))

  const { error: upsertError, count } = await supabaseAdmin
    .from('property_access')
    .upsert(rows, {
      onConflict: 'property_id,user_id,access_level',
      ignoreDuplicates: true,
      count: 'exact',
    })

  if (upsertError) {
    return { success: false, message: 'Bulk grant failed: ' + upsertError.message }
  }

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'PROPERTY_ACCESS',
    title: 'Bulk property access granted',
    description: `${targetProfile.full_name || userId} granted "${accessLevel}/${permissionTier}" on ${propertyIds.length} properties`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access')
  return {
    success: true,
    message: `Granted ${accessLevel} on ${count ?? propertyIds.length} properties to ${targetProfile.full_name || userId}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// BULK REVOKE — one user, many properties (any level)
// ────────────────────────────────────────────────────────────────────────────

export async function bulkRevokePropertyAccess(params: {
  userId: string
  propertyIds: string[]
}) {
  const { userId, propertyIds } = params

  if (!propertyIds.length) {
    return { success: false, message: 'No properties selected.' }
  }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin } = result

  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()

  const { error: deleteError, count } = await supabaseAdmin
    .from('property_access')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .in('property_id', propertyIds)

  if (deleteError) {
    return { success: false, message: 'Bulk revoke failed: ' + deleteError.message }
  }

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'PROPERTY_ACCESS',
    title: 'Bulk property access revoked',
    description: `${targetProfile?.full_name || userId} lost access on ${count ?? propertyIds.length} properties`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access')
  return {
    success: true,
    message: `Revoked ${count ?? 0} access grants for ${targetProfile?.full_name || 'user'}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// LIST — for a user (used by the admin UI)
// ────────────────────────────────────────────────────────────────────────────

export async function listAccessForUser(userId: string) {
  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error, data: null }
  const { supabaseAdmin } = result

  const { data, error } = await supabaseAdmin
    .from('property_access')
    .select('id, property_id, access_level, permission_tier, granted_at, expires_at, notes, properties:property_id(id, name, city)')
    .eq('user_id', userId)
    .order('granted_at', { ascending: false })

  if (error) {
    return { success: false, message: error.message, data: null }
  }

  return { success: true, message: 'OK', data }
}


// ────────────────────────────────────────────────────────────────────────────
// LIST — for a property (used to see who has access to a given property)
// ────────────────────────────────────────────────────────────────────────────

export async function listAccessForProperty(propertyId: string) {
  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error, data: null }
  const { supabaseAdmin } = result

  const { data, error } = await supabaseAdmin
    .from('property_access')
    .select('id, user_id, access_level, permission_tier, granted_at, expires_at, notes, profiles:user_id(id, full_name, email, role)')
    .eq('property_id', propertyId)
    .order('granted_at', { ascending: false })

  if (error) {
    return { success: false, message: error.message, data: null }
  }

  return { success: true, message: 'OK', data }
}
