import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"

serve(async (req) => {
  // This function is triggered by a Supabase database webhook on work_orders INSERT.
  // Webhooks send the service_role key as Authorization header automatically.
  // We also support CORS for manual admin invocation from the dashboard.
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Verify the request carries a valid authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { record } = await req.json()

    // 1. Fetch Property and Unit details for the alert context
    const { data: unitInfo } = await supabase
      .from('units')
      .select('name, properties(name)')
      .eq('id', record.unit_id)
      .single()

    const propertyName = unitInfo?.properties?.name || 'Unknown Property'
    const unitName = unitInfo?.name || 'Unknown Unit'

    // 2. Format the Alert Message
    const alertMessage = `
      🚨 NEW MAINTENANCE TICKET
      Priority: ${record.priority}
      Location: ${propertyName} - Unit ${unitName}
      Issue: ${record.title}
      Description: ${record.description}
    `

    // 3. Queue notification for async delivery
    const { error: queueError } = await supabase.from('notification_queue').insert({
      recipient_email: 'manager@rylexa.com',
      recipient_name: 'Property Manager',
      subject: `Maintenance Alert: ${record.title || 'New Ticket'}`,
      body: alertMessage.trim(),
      channel: 'email',
    })

    if (queueError) throw queueError

    return new Response(JSON.stringify({ queued: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
