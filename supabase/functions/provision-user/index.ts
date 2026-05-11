import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // CRITICAL: Only Admins can create new users
    await requireRole(req, ['Admin'])

    // 1. Initialize Supabase with Service Role Key (Admin Privileges)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // 2. Parse request body
    const { email, password, role } = await req.json()

    if (!email || !password || !role) {
      throw new Error('Missing required fields: email, password, or role')
    }

    // 3. Validate role is a known value
    const validRoles = ['Admin', 'Property Manager', 'Accounting', 'Maintenance', 'Vendor', 'Tenant']
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`)
    }

    // 4. Enforce minimum password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }

    // 5. Create User via Admin API
    // This automatically confirms the email and sets the metadata
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { role: role }, // For the Frontend UI
      app_metadata: { role: role }   // For the Middleware Security
    })

    if (error) throw error

    // 6. Create corresponding profile row (required by middleware + RLS)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: data.user.id,
        email: email,
        full_name: email.split('@')[0],
        role: role,
        is_active: true,
      })

    if (profileError) {
      // Rollback: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(data.user.id)
      throw new Error('Profile creation failed: ' + profileError.message)
    }

    return new Response(
      JSON.stringify({ message: `User ${email} created successfully with role ${role}` }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    const status = error.message?.includes('Authorization') || error.message?.includes('token') || error.message?.includes('Access denied') ? 401 : 400
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status
      }
    )
  }
})
