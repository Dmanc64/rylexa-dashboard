'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// Only these roles can be assigned via this action
const ALLOWED_ROLES = ['Admin', 'Property Manager', 'Accounting', 'Maintenance', 'Vendor', 'Tenant', 'Owner'] as const
type AllowedRole = typeof ALLOWED_ROLES[number]

export async function createStaffUser(formData: FormData) {
  // ── 1. AUTHENTICATE THE CALLER FROM SESSION ──
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
    return { success: false, message: 'Unauthorized: You must be logged in.' }
  }

  // ── 2. VERIFY CALLER IS AN ADMIN ──
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
    return { success: false, message: 'Forbidden: Only Admins can create new users.' }
  }

  // ── 3. VALIDATE INPUT ──
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string
  const role = formData.get('role') as string
  const leaseId = formData.get('leaseId') as string | null

  // Email validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, message: 'Invalid email address.' }
  }

  // Password strength: minimum 8 characters
  if (!password || password.length < 8) {
    return { success: false, message: 'Password must be at least 8 characters.' }
  }

  // Full name validation
  if (!fullName || fullName.trim().length < 2 || fullName.length > 100) {
    return { success: false, message: 'Full name must be between 2 and 100 characters.' }
  }

  // Role whitelist validation
  if (!role || !ALLOWED_ROLES.includes(role as AllowedRole)) {
    return { success: false, message: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` }
  }

  // Tenant must have a lease assigned
  if (role === 'Tenant' && !leaseId) {
    return { success: false, message: 'Tenant accounts must be linked to a lease.' }
  }

  // ── 4. CLEAN UP STALE DATA ──
  // If a user was previously deleted and re-added with the same email,
  // there may be orphaned profile rows. Remove them before creating.
  // Look up existing auth user by email to check for stale/orphaned profiles.
  const { data: { users: existingUsers } } = await supabaseAdmin.auth.admin.listUsers()
  const staleUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase())

  if (staleUser) {
    const { data: staleProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', staleUser.id)
      .maybeSingle()

    if (staleProfile) {
      await supabaseAdmin.from('profiles').delete().eq('id', staleProfile.id)
    }
    // Also delete the stale auth user so createUser below succeeds
    await supabaseAdmin.auth.admin.deleteUser(staleUser.id)
  }

  // ── 5. CREATE THE USER IN AUTH SYSTEM ──
  const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  })

  if (createError) {
    return { success: false, message: createError.message }
  }

  if (!authData.user) {
    return { success: false, message: 'User creation failed.' }
  }

  // ── 6. ASSIGN ROLE IN PROFILES TABLE ──
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      email: email.toLowerCase(),
      full_name: fullName.trim(),
      role: role
    })

  if (profileError) {
    // If profile creation fails, we should clean up the auth user
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return { success: false, message: 'Profile creation failed: ' + profileError.message }
  }

  // ── 7. LINK LEASE FOR TENANT ACCOUNTS ──
  if (role === 'Tenant' && leaseId) {
    // Verify the lease exists, is active, and not already linked
    const { data: targetLease, error: leaseLookupError } = await supabaseAdmin
      .from('leases')
      .select('id, user_id, status')
      .eq('id', leaseId)
      .single()

    if (leaseLookupError || !targetLease) {
      return { success: true, message: `Tenant account created but lease not found (${leaseId}). Link the lease manually.` }
    }
    if (targetLease.user_id) {
      return { success: true, message: `Tenant account created but lease is already linked to another user. Link a different lease manually.` }
    }
    if (targetLease.status !== 'Active') {
      return { success: true, message: `Tenant account created but lease status is "${targetLease.status}" (not Active). Link an active lease manually.` }
    }

    const { error: leaseError } = await supabaseAdmin
      .from('leases')
      .update({ user_id: authData.user.id })
      .eq('id', leaseId)
      .is('user_id', null)

    if (leaseError) {
      return { success: true, message: `Tenant account created but lease linking failed: ${leaseError.message}. Link the lease manually.` }
    }
  }

  // ── 8. REFRESH THE ADMIN PAGE ──
  revalidatePath('/admin/settings/users')
  return { success: true, message: `Successfully created ${role}: ${email}` }
}
