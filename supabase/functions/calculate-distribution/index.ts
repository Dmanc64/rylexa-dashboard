import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Only Admin and Property Manager can calculate distributions
    await requireRole(req, ['Admin', 'Property Manager'])

    // Initialize Supabase Admin Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body (expects a propertyId or 'all')
    const { propertyId } = await req.json()

    // Fetch real financial data from distribution_summary view
    let query = supabaseClient
      .from('distribution_summary')
      .select('property_id, property_name, total_income, total_expenses, net_balance')

    if (propertyId !== 'all') {
      query = query.eq('property_id', propertyId)
    }

    const { data: summaries, error: summaryError } = await query

    if (summaryError) throw summaryError

    const results = (summaries ?? []).map((row: any) => {
      const income = Number(row.total_income) || 0
      const expenses = Number(row.total_expenses) || 0
      const netDistribution = income - expenses

      return {
        property_id: row.property_id,
        property_name: row.property_name,
        income,
        expenses,
        distribution_amount: netDistribution > 0 ? netDistribution : 0
      }
    })

    // Record the results in 'system_activity'
    await supabaseClient.from('system_activity').insert({
      event_type: 'DISTRIBUTION',
      title: 'Distribution Calculated',
      description: `Calculated distributions for ${results.length} properties.`,
      actor_name: 'Finance Admin'
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Distribution calculation complete',
        data: results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    const status = error.message?.includes('Authorization') || error.message?.includes('token') || error.message?.includes('Access denied') ? 401 : 400
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status
      }
    )
  }
})
