/**
 * Shared authentication helpers for Rylexa edge functions.
 *
 * verifyAuth() extracts and verifies the JWT from the Authorization header,
 * then fetches the user's role from profiles. Returns the authenticated user
 * and their role, or throws with a descriptive error.
 *
 * Usage:
 *   const { user, role } = await verifyAuth(req)
 *   // user = Supabase User object
 *   // role = 'Admin' | 'Property Manager' | 'Accounting' | 'Maintenance' | 'Vendor' | 'Tenant'
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export interface AuthResult {
  user: { id: string; email?: string }
  role: string
}

/**
 * Verify the JWT in the Authorization header and return user + role.
 * Throws an error if the token is missing, invalid, or the user has no profile.
 */
export async function verifyAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Error('Missing Authorization header')
  }

  const token = authHeader.replace('Bearer ', '')

  // Create a client using the user's JWT (not service role) to verify identity
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )

  const { data: { user }, error } = await supabaseAuth.auth.getUser(token)
  if (error || !user) {
    throw new Error('Invalid or expired authentication token')
  }

  // Fetch role from profiles table
  const { data: profile, error: profileError } = await supabaseAuth
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Error('User profile not found')
  }

  return {
    user: { id: user.id, email: user.email },
    role: profile.role,
  }
}

/**
 * Require the user to have one of the specified roles.
 * Throws if the user's role is not in the allowed list.
 */
export async function requireRole(req: Request, allowedRoles: string[]): Promise<AuthResult> {
  const auth = await verifyAuth(req)

  if (!allowedRoles.includes(auth.role)) {
    throw new Error(`Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${auth.role}`)
  }

  return auth
}
