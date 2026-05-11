import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // CRITICAL: Only Admins can list all users in the system
    await requireRole(req, ['Admin'])

    // Create Supabase Client with service role (required for auth.admin.listUsers)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse pagination params from URL query string
    const url = new URL(req.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '50', 10) || 50))

    const { data: { users }, error } = await supabaseClient.auth.admin.listUsers({ page, perPage })

    if (error) throw error

    return new Response(JSON.stringify({ users, page, perPage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    const status = error.message?.includes('Authorization') || error.message?.includes('token') || error.message?.includes('Access denied') ? 401 : 400
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })
  }
})
