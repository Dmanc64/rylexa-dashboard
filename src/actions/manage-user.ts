'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ── HELPERS ──

/** Authenticate the caller and verify they are an Admin. Returns the admin Supabase client + caller ID. */
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
        persistSession: false
      }
    }
  )

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'Admin') {
    return { error: 'Forbidden: Only Admins can manage users.' }
  }

  return { supabaseAdmin, callerId: caller.id }
}


// ── UPDATE USER ROLE ──

export async function updateUserRole(targetUserId: string, newRole: string) {
  const VALID_ROLES = ['Admin', 'Property Manager', 'Accounting', 'Maintenance', 'Vendor', 'Tenant', 'Owner']

  if (!VALID_ROLES.includes(newRole)) {
    return { success: false, message: `Invalid role: ${newRole}` }
  }

  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin, callerId } = result

  if (targetUserId === callerId) {
    return { success: false, message: 'You cannot change your own role.' }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, role')
    .eq('id', targetUserId)
    .single()

  if (!profile) {
    return { success: false, message: 'User not found.' }
  }

  if (profile.role === newRole) {
    return { success: false, message: `User is already a ${newRole}.` }
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', targetUserId)

  if (updateError) {
    return { success: false, message: 'Role update failed: ' + updateError.message }
  }

  // Update Supabase Auth user_metadata so middleware picks up the new role
  await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
    user_metadata: { role: newRole }
  })

  await supabaseAdmin.from('system_activity').insert({
    event_type: 'USER_MANAGEMENT',
    title: 'Role changed',
    description: `${profile.full_name || targetUserId} role changed from ${profile.role} to ${newRole} by admin`,
    actor_name: 'Admin'
  })

  revalidatePath('/admin/settings/users')
  return {
    success: true,
    message: `${profile.full_name}'s role changed to ${newRole}.`
  }
}


// ── DISABLE / ENABLE USER ──

export async function disableStaffUser(targetUserId: string) {
  const result = await getVerifiedAdmin()
  if ('error' in result) return { success: false, message: result.error }
  const { supabaseAdmin, callerId } = result

  // Prevent self-disable
  if (targetUserId === callerId) {
    return { success: false, message: 'You cannot disable your own account.' }
  }

  // Check current state
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_active, full_name')
    .eq('id', targetUserId)
    .single()

  if (!profile) {
    return { success: false, message: 'User not found.' }
  }

  const isCurrentlyActive = profile.is_active !== false  // default true if null
  const newState = !isCurrentlyActive

  // 1. Ban or unban in Supabase Auth
  //    ban_duration: 'none' = unban, '876000h' = ~100 years = effectively permanent
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
    targetUserId,
    { ban_duration: newState ? 'none' : '876000h' }
  )

  if (authError) {
    return { success: false, message: 'Auth update failed: ' + authError.message }
  }

  // 2. Update profiles.is_active for UI
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: newState })
    .eq('id', targetUserId)

  if (profileError) {
    return { success: false, message: 'Profile update failed: ' + profileError.message }
  }

  // 3. Log to system_activity for audit trail
  await supabaseAdmin.from('system_activity').insert({
    event_type: 'USER_MANAGEMENT',
    title: newState ? 'User re-enabled' : 'User disabled',
    description: `${profile.full_name || targetUserId} was ${newState ? 'enabled' : 'disabled'} by admin`,
    actor_name: 'Admin'
  })

  revalidatePath('/admin/settings/users')
  return {
    success: true,
    message: newState
      ? `${profile.full_name} has been re-enabled.`
      : `${profile.full_name} has been disabled.`
  }
}


// ── RESET PASSWORD ──

export async function resetUserPassword(targetUserId: string) {
  try {
    const result = await getVerifiedAdmin()
    if ('error' in result) return { success: false, message: result.error }
    const { supabaseAdmin, callerId } = result

    // Look up target user
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, role')
      .eq('id', targetUserId)
      .single()

    if (!profile) {
      return { success: false, message: 'User not found.' }
    }

    // Generate a secure temporary password (16 chars: letters + digits + symbols)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
    let tempPassword = ''
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    for (const byte of array) {
      tempPassword += chars[byte % chars.length]
    }

    // 1. Update the password via admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      { password: tempPassword }
    )

    if (updateError) {
      return { success: false, message: 'Password reset failed: ' + updateError.message }
    }

    // 2. Sign the user out of all sessions so they must log in with the new password
    await supabaseAdmin.auth.admin.signOut(targetUserId, 'global')

    // 3. Audit log
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'USER_MANAGEMENT',
      title: 'Password reset',
      description: `${profile.full_name || targetUserId} (${profile.role}) had their password reset by admin`,
      actor_name: 'Admin'
    })

    return {
      success: true,
      message: `Password reset for ${profile.full_name}.`,
      tempPassword
    }
  } catch (err: any) {
    console.error('Reset password error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown error') }
  }
}


// ── DELETE USER ──

export async function deleteStaffUser(targetUserId: string) {
  try {
    const result = await getVerifiedAdmin()
    if ('error' in result) return { success: false, message: result.error }
    const { supabaseAdmin, callerId } = result

    // Prevent self-delete
    if (targetUserId === callerId) {
      return { success: false, message: 'You cannot delete your own account.' }
    }

    // Get user info for audit log before deleting
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, role')
      .eq('id', targetUserId)
      .single()

    const userName = profile?.full_name || 'Unknown User'
    const userRole = profile?.role || 'Unknown'

    // 1. Terminate all active sessions so the user's JWT is invalidated immediately.
    //    Without this, a deleted user's JWT remains valid until it expires (~1 hour),
    //    which causes stale-role routing if the user is re-created with a different role.
    await supabaseAdmin.auth.admin.signOut(targetUserId, 'global')

    // 2. Unlink any leases tied to this user (clear user_id so lease isn't orphaned)
    await supabaseAdmin
      .from('leases')
      .update({ user_id: null })
      .eq('user_id', targetUserId)

    // 3. Delete the profile record FIRST (before auth delete which may cascade)
    const { error: profileDeleteError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', targetUserId)

    if (profileDeleteError) {
      console.error('Profile delete error:', profileDeleteError)
      // Continue anyway — auth delete is the critical step
    }

    // 4. Delete from Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId)

    if (authError) {
      return { success: false, message: 'Failed to delete auth account: ' + authError.message }
    }

    // 5. Log to system_activity for audit trail
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'USER_MANAGEMENT',
      title: 'User account deleted',
      description: `${userName} (${userRole}) was permanently deleted by admin`,
      actor_name: 'Admin'
    })

    revalidatePath('/admin/settings/users')
    return { success: true, message: `${userName} has been permanently deleted.` }
  } catch (err: any) {
    console.error('Delete user error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown error') }
  }
}
