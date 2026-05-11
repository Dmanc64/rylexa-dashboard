import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Only Admin and Property Manager can assign assets
    await requireRole(req, ['Admin', 'Property Manager'])

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId, propertyId, unitId } = await req.json()

    // 1. Update Auth User Metadata
    // This allows the Tenant Portal to instantly know which property they live in
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { user_metadata: { property_id: propertyId, unit_id: unitId } }
    )
    if (authError) throw authError

    // 2. Link to Database Tables
    // We check the user's role first to see if they go in 'tenants' or 'vendors'
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId)
    const role = user?.user?.app_metadata?.role

    if (role === 'Tenant') {
      const { error: tenantError } = await supabaseAdmin
        .from('tenants')
        .upsert({
          auth_id: userId,
          unit_id: unitId,
          // We assume email is the unique identifier for mapping
          email: user?.user?.email
        }, { onConflict: 'email' })

      if (tenantError) throw tenantError
    }

    // 3. Log System Activity
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'ASSET_ASSIGNMENT',
      title: 'New Asset Link Created',
      description: `User ${user?.user?.email} linked to Property ${propertyId}`,
      actor_name: 'System Admin'
    })

    return new Response(JSON.stringify({ message: "Assignment synchronized." }), {
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
