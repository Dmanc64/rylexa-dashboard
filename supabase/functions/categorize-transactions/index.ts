import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"
import { callGemini } from "../_shared/gemini.ts"

/**
 * categorize-transactions — Gemini-powered batch transaction categorization.
 *
 * Fetches up to 50 pending transactions without AI categorization,
 * sends them to Gemini in batches of 10, then updates each transaction
 * with the AI-assigned category and confidence score.
 *
 * Falls back to the categorize_pending_transactions() RPC if Gemini fails.
 *
 * Returns: { count: number } — number of transactions categorized
 */

const CATEGORIZE_SYSTEM_PROMPT = `You are a transaction categorizer for a residential property management company.

Given a list of financial transactions (each with an id, description, amount, and type), categorize each one.

Categories (choose ONE per transaction):
- "Rent" — tenant rent payments or rent charges
- "Security Deposit" — security deposit collection or refund
- "Maintenance" — repair costs, service calls, parts, labor
- "Insurance" — property insurance premiums or claims
- "Utilities" — water, electric, gas, sewer, trash
- "Taxes" — property taxes, assessments
- "Mortgage" — mortgage payments, principal, interest
- "Late Fee" — late payment fees, penalties
- "Vendor Payment" — payments to contractors/vendors for services
- "Uncategorized" — cannot determine with reasonable confidence

Return a JSON array of objects, one per transaction:
[{ "id": "transaction_uuid", "category": "one of the above", "confidence": 30-99 }]

Rules:
- Higher confidence (80+) when description clearly matches a category
- Lower confidence (30-60) when ambiguous or generic descriptions
- Credit type with amounts matching typical rent = likely "Rent"
- Debit type with repair/service keywords = likely "Maintenance"`

type CategorizeResult = {
  id: string
  category: string
  confidence: number
}[]

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Admin, Property Manager, or Accounting only
    await requireRole(req, ['Admin', 'Property Manager', 'Accounting'])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('value')
      .eq('key', 'ai_transaction_categorization')
      .single()

    if (!flag?.value) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'Feature disabled', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch pending transactions that haven't been AI-categorized yet
    const { data: transactions, error: txnError } = await supabase
      .from('transactions')
      .select('id, description, amount, type')
      .is('ai_confidence', null)
      .eq('status', 'Pending')
      .order('created_at', { ascending: false })
      .limit(50)

    if (txnError) throw txnError

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ count: 0, message: 'No pending transactions to categorize' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let totalCategorized = 0

    try {
      // Process in batches of 10 to stay within token limits
      const BATCH_SIZE = 10
      for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        const batch = transactions.slice(i, i + BATCH_SIZE)

        const batchInput = batch.map(t => ({
          id: t.id,
          description: t.description || 'No description',
          amount: Math.abs(t.amount || 0),
          type: t.type || 'Unknown',
        }))

        const results = await callGemini<CategorizeResult>({
          systemPrompt: CATEGORIZE_SYSTEM_PROMPT,
          userPrompt: JSON.stringify(batchInput),
          temperature: 0.1,
        })

        // Process each categorized transaction
        for (const result of results) {
          const txn = batch.find(t => t.id === result.id)
          if (!txn) continue

          // Attempt lease/vendor matching based on category
          let matchLeaseId: string | null = null
          let matchVendorId: string | null = null

          if (result.category === 'Rent') {
            // Try to match active lease by amount
            const { data: matchedLease } = await supabase
              .from('leases')
              .select('id')
              .eq('status', 'Active')
              .eq('rent_amount', Math.abs(txn.amount || 0))
              .limit(1)
              .maybeSingle()

            if (matchedLease) {
              matchLeaseId = matchedLease.id
              // Boost confidence if we found a matching lease
              result.confidence = Math.min(result.confidence + 10, 99)
            }
          } else if (result.category === 'Maintenance' || result.category === 'Vendor Payment') {
            // Try to match vendor by amount within recent work orders
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
            const { data: matchedWO } = await supabase
              .from('work_orders')
              .select('vendor_id')
              .eq('cost', Math.abs(txn.amount || 0))
              .not('vendor_id', 'is', null)
              .gte('created_at', sixtyDaysAgo)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            if (matchedWO) {
              matchVendorId = matchedWO.vendor_id
              result.confidence = Math.min(result.confidence + 8, 99)
            }
          }

          // Update the transaction
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              ai_category: result.category,
              ai_confidence: result.confidence,
              ai_match_lease_id: matchLeaseId,
              ai_match_vendor_id: matchVendorId,
            })
            .eq('id', result.id)

          if (!updateError) totalCategorized++
        }
      }
    } catch (geminiError) {
      // Gemini failed — fall back to the rules-based RPC
      console.warn('Gemini categorization failed, falling back to RPC:', geminiError)
      const { data: rpcCount, error: rpcError } = await supabase.rpc('categorize_pending_transactions')
      if (rpcError) throw rpcError

      return new Response(
        JSON.stringify({ count: rpcCount || 0, fallback: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log the categorization event
    await supabase.from('system_activity').insert({
      event_type: 'AI_CATEGORIZATION',
      title: 'AI Transaction Categorization',
      description: `Categorized ${totalCategorized} pending transactions via Gemini.`,
      actor_name: 'Gemini 2.0 Flash',
    })

    return new Response(
      JSON.stringify({ count: totalCategorized }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const msg = error.message || 'Unknown error'
    const status = msg.includes('Authorization') || msg.includes('token') || msg.includes('Access denied') ? 401 : 400
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
