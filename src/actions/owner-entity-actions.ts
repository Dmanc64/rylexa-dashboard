'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

const MEMBER_ROLES = ['admin', 'viewer'] as const
type MemberRole = typeof MEMBER_ROLES[number]


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
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'Admin') {
    return { error: 'Forbidden: Only Admins can manage owner entities.' }
  }

  return { supabaseAdmin, callerId: caller.id }
}


// ────────────────────────────────────────────────────────────────────────────
// ADD OWNER MEMBER — link a user to an owner entity
// ────────────────────────────────────────────────────────────────────────────

export async function addOwnerMember(params: {
  ownerId: string
  userId: string
  memberRole: MemberRole
}) {
  const { ownerId, userId, memberRole } = params

  if (!MEMBER_ROLES.includes(memberRole)) {
    return { success: false, message: `Invalid member_role: ${memberRole}` }
  }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin, callerId } = result

  // Verify owner entity exists
  const { data: owner } = await supabaseAdmin
    .from('owners')
    .select('id, full_name')
    .eq('id', ownerId)
    .single()
  if (!owner) return { success: false, message: 'Owner entity not found.' }

  // Verify target user exists and is active
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('id', userId)
    .single()
  if (!profile) return { success: false, message: 'Target user not found.' }
  if (profile.is_active === false) {
    return { success: false, message: 'Target user is disabled.' }
  }

  const { error: insertError } = await supabaseAdmin
    .from('owner_entity_members')
    .insert({
      owner_id: ownerId,
      user_id: userId,
      member_role: memberRole,
      granted_by: callerId,
    })

  if (insertError) {
    if (insertError.code === '23505') {
      return {
        success: false,
        message: `${profile.full_name || profile.email} is already a member of ${owner.full_name}.`,
      }
    }
    return { success: false, message: 'Add member failed: ' + insertError.message }
  }

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'OWNER_ACCESS',
    title: 'Owner entity member added',
    description: `${profile.full_name || profile.email} added as ${memberRole} to ${owner.full_name}`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access/owners')
  return {
    success: true,
    message: `${profile.full_name || profile.email} added to ${owner.full_name} as ${memberRole}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// REMOVE OWNER MEMBER — by member row id
// ────────────────────────────────────────────────────────────────────────────

export async function removeOwnerMember(memberId: string) {
  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin } = result

  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from('owner_entity_members')
    .delete()
    .eq('id', memberId)
    .select('id, owner_id, user_id, member_role')
    .single()

  if (deleteError || !deleted) {
    if (deleteError && deleteError.code !== 'PGRST116') {
      return { success: false, message: 'Remove failed: ' + deleteError.message }
    }
    return { success: false, message: 'Member not found (already removed?).' }
  }

  const [{ data: profile }, { data: owner }] = await Promise.all([
    supabaseAdmin.from('profiles').select('full_name, email').eq('id', deleted.user_id).single(),
    supabaseAdmin.from('owners').select('full_name').eq('id', deleted.owner_id).single(),
  ])

  const userName  = profile?.full_name || profile?.email || deleted.user_id
  const ownerName = owner?.full_name || deleted.owner_id

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'OWNER_ACCESS',
    title: 'Owner entity member removed',
    description: `${userName} removed from ${ownerName}`,
    actor_name: 'Admin',
  })

  revalidatePath('/admin/settings/access/owners')
  return {
    success: true,
    message: `Removed ${userName} from ${ownerName}.`,
  }
}


// ────────────────────────────────────────────────────────────────────────────
// UPDATE MEMBER ROLE — toggle between admin and viewer
// ────────────────────────────────────────────────────────────────────────────

export async function updateOwnerMemberRole(params: {
  memberId: string
  memberRole: MemberRole
}) {
  const { memberId, memberRole } = params

  if (!MEMBER_ROLES.includes(memberRole)) {
    return { success: false, message: `Invalid member_role: ${memberRole}` }
  }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin } = result

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('owner_entity_members')
    .update({ member_role: memberRole })
    .eq('id', memberId)
    .select('id, owner_id, user_id')
    .single()

  if (updateError || !updated) {
    return { success: false, message: 'Update failed: ' + (updateError?.message ?? 'not found') }
  }

  revalidatePath('/admin/settings/access/owners')
  return { success: true, message: `Member role updated to ${memberRole}.` }
}
