import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"
import { callGemini } from "../_shared/gemini.ts"

/**
 * triage-work-order — Gemini-powered maintenance work order classification.
 *
 * Accepts { work_order_id } in POST body.
 * 1. Checks the ai_maintenance_triage feature flag
 * 2. Calls Gemini 2.0 Flash to classify category + priority
 * 3. Matches a suggested vendor by trade_type
 * 4. Falls back to the existing triage_work_order() RPC if Gemini fails
 *
 * Returns: { category, ai_priority, ai_confidence, suggested_vendor_id }
 */

const TRIAGE_SYSTEM_PROMPT = `You are a maintenance work order classifier for a residential property management company.

Given a work order title and description, classify it into exactly ONE category and assign a priority level.

Categories (choose ONE):
- "Plumbing" — pipes, drains, toilets, sinks, faucets, water heaters, leaks, clogs, sewer
- "Electrical" — outlets, switches, breakers, wiring, power outages, lights, circuits, sparks
- "HVAC" — heating, air conditioning, furnace, thermostat, ventilation, no heat, no cool
- "Appliance" — refrigerator, stove, oven, dishwasher, washer, dryer, microwave, garbage disposal
- "Structural" — doors, windows, walls, ceiling, floor, roof, cracks, foundation, drywall
- "Pest Control" — roaches, mice, rats, ants, bugs, termites, bees, rodents, insects
- "Landscaping" — lawn, trees, shrubs, garden, fence, gate, parking lot, snow, ice, gutters
- "Safety" — fire, smoke, carbon monoxide, gas leak, flood, sewage backup, security
- "General Maintenance" — anything that doesn't clearly fit the above categories

Priority levels:
- "Emergency" — immediate safety risk, no water/heat/power, flooding, fire, gas leak
- "High" — significant impact on habitability but not immediately dangerous (e.g., no hot water, broken AC in summer, sewage smell)
- "Normal" — standard maintenance issue (most items)
- "Low" — cosmetic or minor convenience issues

Return a JSON object with:
- "category": one of the categories above
- "priority": one of "Emergency", "High", "Normal", "Low"
- "confidence": integer 60-99 representing classification confidence`

type TriageResult = {
  category: string
  priority: string
  confidence: number
}

// Map AI categories to vendor trade_type search keywords
const CATEGORY_TO_TRADE: Record<string, string> = {
  'Plumbing': 'Plumbing',
  'Electrical': 'Electrical',
  'HVAC': 'HVAC',
  'Appliance': 'Appliances',
  'Structural': 'Repairs and Maintenance',
  'Pest Control': 'Pest Control',
  'Landscaping': 'Landscaping',
  'Safety': 'Fire',
  'General Maintenance': 'Handyperson',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Admin or Property Manager only
    await requireRole(req, ['Admin', 'Property Manager'])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { work_order_id } = await req.json()
    if (!work_order_id) throw new Error('work_order_id is required')

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('value')
      .eq('key', 'ai_maintenance_triage')
      .single()

    if (!flag?.value) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'Feature disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch the work order
    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .select('title, description')
      .eq('id', work_order_id)
      .single()

    if (woError || !workOrder) throw new Error('Work order not found: ' + work_order_id)

    let category: string
    let aiPriority: string
    let aiConfidence: number
    let suggestedVendorId: string | null = null

    try {
      // Call Gemini for classification
      const result = await callGemini<TriageResult>({
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt: `Title: ${workOrder.title}\nDescription: ${workOrder.description || 'No description provided'}`,
        temperature: 0.1,
      })

      category = result.category
      aiPriority = result.priority
      aiConfidence = result.confidence
    } catch (geminiError) {
      // Gemini failed — fall back to the rules-based RPC
      console.warn('Gemini triage failed, falling back to RPC:', geminiError)
      const { data: rpcResult, error: rpcError } = await supabase.rpc('triage_work_order', {
        p_work_order_id: work_order_id,
      })
      if (rpcError) throw rpcError

      // RPC returns the result AND updates the DB, so we can return directly
      return new Response(JSON.stringify(rpcResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Vendor matching: rank vendors whose trade_type matches the classified
    // category, ordered by performance. We query the vendor_performance_summary
    // view (migration 039) which already filters out do_not_use=true vendors
    // and aggregates rating + completion counts.
    //
    // Order: highest avg_rating first (nulls last so unrated vendors don't
    // win by accident), then most completed jobs as a tiebreaker so a
    // vendor with a long track record beats a one-job-wonder with a perfect
    // score.
    const tradeKeyword = CATEGORY_TO_TRADE[category] || category
    const { data: matchedVendors } = await supabase
      .from('vendor_performance_summary')
      .select('vendor_id, avg_rating, total_completed_jobs')
      .ilike('trade_type', `%${tradeKeyword}%`)
      .order('avg_rating', { ascending: false, nullsFirst: false })
      .order('total_completed_jobs', { ascending: false })
      .limit(1)

    if (matchedVendors && matchedVendors.length > 0) {
      suggestedVendorId = matchedVendors[0].vendor_id
    }

    // Update the work order with triage results
    const { error: updateError } = await supabase
      .from('work_orders')
      .update({
        category,
        ai_priority: aiPriority,
        ai_confidence: aiConfidence,
        ai_suggested_vendor_id: suggestedVendorId,
      })
      .eq('id', work_order_id)

    if (updateError) throw updateError

    // Log the triage event
    await supabase.from('system_activity').insert({
      event_type: 'AI_TICKET',
      title: 'AI Maintenance Triage',
      description: `Classified as ${category} (${aiConfidence}% confidence, ${aiPriority} priority)`,
      actor_name: 'Gemini 2.0 Flash',
    })

    const responseData = {
      category,
      ai_priority: aiPriority,
      ai_confidence: aiConfidence,
      suggested_vendor_id: suggestedVendorId,
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    const msg = error.message || 'Unknown error'
    const status = msg.includes('Authorization') || msg.includes('token') || msg.includes('Access denied') ? 401 : 400
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
