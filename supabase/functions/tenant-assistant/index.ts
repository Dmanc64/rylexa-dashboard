import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import {
  type Intent,
  type IntentResult,
  assembleContext,
  formatContextForPrompt,
} from "../_shared/context-builder.ts"

/**
 * tenant-assistant — Enhanced AI assistant for tenants with RAG pipeline.
 *
 * Pipeline:
 *   User Message → Intent Detection → Data Retrieval → Lease RAG (if needed)
 *   → Context Builder → AI Prompt → Structured Response
 *
 * Supports:
 *   - Lease document Q&A via vector search (RAG)
 *   - Account balance and payment history
 *   - Rent due dates with late fee info
 *   - Maintenance request creation and status
 *   - Property policy lookups
 *   - Actionable responses (create work orders)
 */

// --- INTENT DETECTION ---

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a residential property management tenant assistant chatbot.

Classify the tenant's message into exactly ONE of these intents:

1. "lease_question" — Asking about lease terms, clauses, conditions, rules within the lease (e.g., pets, guests, subletting, early termination, break lease, lease renewal, move-out notice).

2. "account_balance" — Asking about current balance, amount owed, or outstanding charges (e.g., "what do I owe?", "what's my balance?").

3. "payment_history" — Asking about past payments, payment records, or receipts (e.g., "did you receive my payment?", "show my payment history").

4. "rent_due_date" — Asking specifically when rent is due, the due date, or late fees for late payment (e.g., "when is rent due?", "what happens if I pay late?").

5. "maintenance_status" — Asking about the status of an existing maintenance/repair request (e.g., "what's the status of my repair?", "any update on my work order?").

6. "maintenance_request" — Reporting something broken, damaged, or requesting a repair (e.g., "my toilet is clogged", "the AC isn't working", "there's a leak").

7. "property_policy" — Asking about building rules, property policies, amenities, parking, trash, quiet hours, or community guidelines (e.g., "can I have a pet?", "where do I park?", "what are the quiet hours?").

8. "general_question" — Anything that doesn't fit the above categories.

9. "greeting" — Short greetings, thanks, or acknowledgements (6 words or fewer, e.g., "hi", "hello", "thanks").

Return a JSON object with:
- "intent": one of the above intent strings
- "confidence": integer 0-100
- "keywords": array of 1-3 key terms from the message relevant to data retrieval`

async function detectIntentAI(message: string): Promise<IntentResult> {
  const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      temperature: 0.05,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI intent error (${response.status}): ${errText.substring(0, 300)}`)
  }

  const data = await response.json()
  const rawText = data.choices?.[0]?.message?.content
  if (!rawText) throw new Error('OpenAI returned no content for intent detection')

  const result: IntentResult = JSON.parse(rawText)

  const validIntents: Intent[] = [
    'lease_question', 'account_balance', 'payment_history', 'rent_due_date',
    'maintenance_status', 'maintenance_request', 'property_policy',
    'general_question', 'greeting'
  ]
  if (!validIntents.includes(result.intent)) {
    result.intent = 'general_question'
  }

  return result
}

// --- FALLBACK INTENT DETECTION (regex-based) ---

function detectIntentFallback(message: string): IntentResult {
  const msg = message.toLowerCase().trim()
  const words = msg.split(/\s+/)

  // Greetings (short messages only)
  const greetingPatterns = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|sup|yo|howdy)\b/,
    /^(thanks|thank you|thx|ty)\b/,
    /^(ok|okay|cool|great|got it|sure|alright|no|nope|bye|goodbye)\b/,
  ]
  if (greetingPatterns.some(p => p.test(msg)) && words.length <= 6) {
    return { intent: 'greeting', confidence: 90, keywords: [] }
  }

  // Maintenance request: problem + fixture
  const problemWords = [
    'broken', 'broke', 'damage', 'leak', 'leaking', 'clogged', 'backed up',
    'overflowing', 'not working', 'stopped working', 'cracked', 'stuck',
    'no hot water', 'no heat', 'no ac', 'no power', 'mold', 'pest',
    'roach', 'mouse', 'mice', 'rat', 'ants', 'bugs', 'flood', 'smell',
  ]
  const fixtureWords = [
    'sink', 'toilet', 'shower', 'bathtub', 'faucet', 'drain', 'pipe',
    'water heater', 'heater', 'furnace', 'thermostat', 'ac', 'hvac',
    'door', 'lock', 'window', 'dishwasher', 'disposal', 'stove', 'oven',
    'refrigerator', 'fridge', 'washer', 'dryer', 'outlet', 'light',
    'ceiling fan', 'wall', 'ceiling', 'floor', 'garage', 'elevator',
    'smoke detector', 'alarm',
  ]
  const hasProblem = problemWords.some(w => msg.includes(w))
  const hasFixture = fixtureWords.some(w => msg.includes(w))
  const directRepair = /\b(repair|maintenance request|work order|fix it|needs? (to be )?(repaired|fixed|replaced))\b/.test(msg)
  if ((hasProblem && hasFixture) || (hasProblem && directRepair) || directRepair) {
    return { intent: 'maintenance_request', confidence: 80, keywords: [] }
  }

  // Maintenance status
  if (/\b(status|update|progress|repair.*(status|update)|work order.*(status|update)|ticket.*(status|update))\b/.test(msg)) {
    return { intent: 'maintenance_status', confidence: 80, keywords: [] }
  }

  // Account balance
  if (['balance', 'owe', 'amount due', 'what do i owe', 'outstanding'].some(kw => msg.includes(kw))) {
    return { intent: 'account_balance', confidence: 85, keywords: [] }
  }

  // Payment history
  if (['payment history', 'payment record', 'did you receive my payment', 'paid', 'receipt'].some(kw => msg.includes(kw))) {
    return { intent: 'payment_history', confidence: 80, keywords: [] }
  }

  // Rent due date
  if (/\b(when.*(rent|due)|rent.*(due|date)|late fee|pay.*late|late.*pay)\b/.test(msg)) {
    return { intent: 'rent_due_date', confidence: 85, keywords: [] }
  }

  // Property policy
  const policyKeywords = [
    'pet', 'pets', 'dog', 'cat', 'parking', 'park', 'guest', 'visitor',
    'quiet hours', 'noise', 'trash', 'recycling', 'smoking', 'pool',
    'gym', 'amenity', 'amenities', 'laundry', 'rules',
  ]
  if (policyKeywords.some(kw => msg.includes(kw))) {
    return { intent: 'property_policy', confidence: 75, keywords: policyKeywords.filter(kw => msg.includes(kw)) }
  }

  // Lease question
  const leaseKeywords = [
    'lease', 'move out', 'move-out', 'end date', 'expir', 'renew',
    'contract', 'vacate', 'break lease', 'early termination', 'notice',
    'subletting', 'sublet',
  ]
  if (leaseKeywords.some(kw => msg.includes(kw))) {
    return { intent: 'lease_question', confidence: 80, keywords: leaseKeywords.filter(kw => msg.includes(kw)) }
  }

  return { intent: 'general_question', confidence: 50, keywords: [] }
}

// --- AI RESPONSE GENERATION ---

const SYSTEM_PROMPT = `You are the Rylexa AI Assistant, a helpful and friendly tenant assistant for a residential property management company.

## Your Role
- Help tenants with questions about their lease, rent, maintenance, and property policies
- Use the provided context data to give accurate, specific answers
- Be concise, clear, and professional

## Response Rules
1. **Prioritize accuracy**: Only state facts that are supported by the provided context data
2. **Lease questions**: Quote or reference specific lease clauses when available. If no relevant clause is found, say so clearly
3. **Financial data**: NEVER invent or estimate financial figures. Only use the exact numbers provided in the context
4. **Unavailable information**: When information is not available in the context, clearly state that and suggest contacting the property management office
5. **No legal advice**: Do not interpret lease terms as legal advice. Suggest consulting with the leasing office or an attorney for legal questions
6. **Maintenance requests**: When a tenant reports an issue, confirm what you understood and offer to create a maintenance request
7. **Actionable responses**: When you can help the tenant take action (e.g., create a maintenance request), include a clear call-to-action

## Response Format
Structure your responses as:
1. **Direct answer** to the question
2. **Supporting details** or explanation (if needed)
3. **Relevant excerpt** from lease or policy (if applicable, format as a blockquote)
4. **Suggested next step** (if applicable)

Use markdown formatting for readability (bold, bullets, blockquotes).
Keep responses concise — aim for 2-4 short paragraphs maximum.
Do not repeat information the tenant already knows.`

const INTENT_HINTS: Record<string, string> = {
  lease_question: 'The tenant is asking about their lease. Prioritize lease clause excerpts in your response.',
  account_balance: 'The tenant is asking about their account balance. Use exact figures from the data.',
  payment_history: 'The tenant is asking about payment history. List recent transactions clearly.',
  rent_due_date: 'The tenant is asking about when rent is due or late fees. Be specific with dates and amounts.',
  maintenance_status: 'The tenant is asking about maintenance request status. Summarize each open request.',
  maintenance_request: 'The tenant is reporting a maintenance issue. Acknowledge the issue and confirm you will create a work order.',
  property_policy: 'The tenant is asking about property rules/policies. Quote the relevant lease clause or policy if available.',
  general_question: 'Answer based on available context. If the question cannot be answered, offer to help with lease, balance, maintenance, or policy questions.',
}

/**
 * Generate AI response using OpenAI GPT-4o-mini in plain text mode.
 */
async function generateAIResponse(
  message: string,
  contextStr: string,
  intent: Intent
): Promise<string> {
  const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')

  const systemPrompt = `${SYSTEM_PROMPT}

## Intent
${INTENT_HINTS[intent] || 'Respond helpfully based on available context.'}

## Context Data
${contextStr}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errText.substring(0, 300)}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI returned no response text')

  return text
}

// --- ACTIONS ---

async function createMaintenanceRequest(
  supabase: any,
  userId: string,
  tenantId: string,
  unitId: string,
  message: string,
  tenantName: string,
  location: string
): Promise<{ ticketId: string } | { duplicate: string }> {
  // Duplicate prevention (2-minute window)
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data: recentTickets } = await supabase
    .from('work_orders')
    .select('id')
    .eq('unit_id', unitId)
    .eq('status', 'Open')
    .gte('created_at', twoMinutesAgo)
    .ilike('title', 'AI Generated:%')
    .limit(1)

  if (recentTickets && recentTickets.length > 0) {
    return { duplicate: recentTickets[0].id }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single()

  const isEmergency = /\b(flood|flooding|fire|smoke|gas leak|no heat|no power|sewage)\b/i.test(message)

  const { data: ticket, error } = await supabase
    .from('work_orders')
    .insert({
      unit_id: unitId,
      tenant_id: tenantId,
      requester_id: profile?.id || userId,
      location: location,
      title: `AI Generated: ${message.substring(0, 50)}...`,
      description: `Reported by ${tenantName} (${location}):\n\n${message}`,
      priority: isEmergency ? 'Emergency' : 'Normal',
      status: 'Open',
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create work order: ${error.message}`)

  return { ticketId: ticket.id }
}

// --- MAIN HANDLER ---

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // --- AUTH ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing Authorization header')

    const token = authHeader.replace('Bearer ', '')
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    )

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)
    if (authError || !user) throw new Error('Invalid or expired token')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { tenant_id, message, unit_id } = await req.json()
    console.log(`[DEBUG] user_id=${user.id}, tenant_id=${tenant_id}, unit_id=${unit_id}, message="${message}"`)

    // --- STEP 1: INTENT DETECTION ---
    let intentResult: IntentResult
    try {
      intentResult = await detectIntentAI(message)
      console.log(`[DEBUG] Intent (AI): ${intentResult.intent}, confidence=${intentResult.confidence}, keywords=${JSON.stringify(intentResult.keywords)}`)
    } catch (intentErr) {
      console.log(`[DEBUG] AI intent failed: ${intentErr.message}, using fallback`)
      intentResult = detectIntentFallback(message)
      console.log(`[DEBUG] Intent (fallback): ${intentResult.intent}`)
    }

    const { intent, keywords } = intentResult

    // --- GREETING (fast path, no context needed) ---
    if (intent === 'greeting') {
      return new Response(
        JSON.stringify({
          reply: "Hello! I'm your Rylexa AI Assistant. I can help you with:\n\n" +
            "\u2022 **Lease questions** \u2014 ask about your lease terms, pet policy, early termination, etc.\n" +
            "\u2022 **Balance & payments** \u2014 check what you owe or review payment history\n" +
            "\u2022 **Rent due dates** \u2014 find out when rent is due and late fee policies\n" +
            "\u2022 **Maintenance** \u2014 report an issue or check repair status\n" +
            "\u2022 **Property rules** \u2014 parking, noise, guest policies, and more\n\n" +
            "What can I help you with?",
          type: 'greeting',
          intent,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- STEP 2: ASSEMBLE CONTEXT ---
    let ragError = ''
    const context = await assembleContext(
      supabase, user.id, tenant_id, unit_id, intent, message, keywords
    )
    console.log(`[DEBUG] Context: lease_id=${context.tenant_data.lease_id}, property_id=${context.tenant_data.property_id}, lease_clauses=${context.lease_clauses.length}, policies=${context.property_policies.length}`)

    // If RAG should have returned results but didn't, note it for debugging
    if (context.lease_clauses.length === 0 && context.tenant_data.lease_id &&
        ['lease_question', 'property_policy', 'general_question'].includes(intent)) {
      ragError = 'RAG returned 0 clauses despite having a lease_id — embedding or RPC may have failed'
      console.warn(`[DEBUG] ${ragError}`)
    }

    // --- STEP 3: MAINTENANCE REQUEST ACTION ---
    if (intent === 'maintenance_request' && unit_id) {
      const location = `${context.tenant_data.property_name} - Unit ${context.tenant_data.unit_number}`
      const result = await createMaintenanceRequest(
        supabase, user.id, tenant_id, unit_id, message,
        context.tenant_data.tenant_name, location
      )

      if ('duplicate' in result) {
        return new Response(
          JSON.stringify({
            reply: `I've already logged a maintenance request for you recently (Ticket #${result.duplicate.slice(0, 6)}). A manager will review it shortly.\n\nIs there anything else I can help with?`,
            type: 'maintenance_exists',
            intent,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          reply: `I've created a maintenance request for you.\n\n` +
            `\u2022 **Ticket:** #${result.ticketId.slice(0, 6)}\n` +
            `\u2022 **Issue:** ${message.substring(0, 100)}\n` +
            `\u2022 **Location:** ${location}\n\n` +
            `A property manager will review this and assign a maintenance team. You'll receive updates as the request progresses.\n\n` +
            `Is there anything else you need?`,
          type: 'maintenance_created',
          intent,
          action: { type: 'maintenance_created', ticket_id: result.ticketId },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- STEP 4: GENERATE AI RESPONSE ---
    const contextStr = formatContextForPrompt(context)
    console.log(`[DEBUG] Context string length: ${contextStr.length}, lease_clauses: ${context.lease_clauses.length}`)
    let aiReply: string
    let _aiMethod = 'unknown'
    let _aiError = ''

    try {
      aiReply = await generateAIResponse(message, contextStr, intent)
      _aiMethod = 'openai'
    } catch (err) {
      _aiError = err.message
      console.error(`[DEBUG] OpenAI response failed: ${err.message}`)
      // Fallback: template-based responses
      aiReply = generateFallbackResponse(intent, context)
      _aiMethod = 'fallback'
    }

    // Determine response type for the frontend
    const typeMap: Record<Intent, string> = {
      lease_question: 'lease_info',
      account_balance: 'balance_inquiry',
      payment_history: 'payment_history',
      rent_due_date: 'rent_info',
      maintenance_status: 'maintenance_status',
      maintenance_request: 'maintenance_created',
      property_policy: 'policy_info',
      general_question: 'general',
      greeting: 'greeting',
    }

    return new Response(
      JSON.stringify({
        reply: aiReply,
        type: typeMap[intent] || 'general',
        intent,
        has_lease_context: context.lease_clauses.length > 0,
        has_policy_context: context.property_policies.length > 0,
        _debug: {
          ai_method: _aiMethod,
          ai_error: _aiError || null,
          rag_error: ragError || null,
          rag_errors: context._errors?.length ? context._errors : null,
          lease_id: context.tenant_data.lease_id,
          property_id: context.tenant_data.property_id,
          lease_clauses_count: context.lease_clauses.length,
          policies_count: context.property_policies.length,
          context_length: contextStr.length,
          intent_detected: intent,
          keywords,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const msg = error.message || 'Unknown error'
    const status = msg.includes('Authorization') || msg.includes('token') ? 401 : 400
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// --- FALLBACK TEMPLATE RESPONSES ---

function generateFallbackResponse(
  intent: Intent,
  context: { tenant_data: any; lease_clauses: any[]; property_policies: any[]; maintenance_requests: any[]; payment_history: any[] }
): string {
  const td = context.tenant_data

  switch (intent) {
    case 'account_balance':
      if (td.account_balance !== null) {
        return td.account_balance > 0
          ? `Your current outstanding balance is **$${td.account_balance.toFixed(2)}**.\n\nYou can pay this using the "Make Payment" button on your dashboard.`
          : `You're all caught up! Your balance is **$0.00**. No payments due at this time.`
      }
      return "I couldn't retrieve your balance right now. Please contact the property management office."

    case 'rent_due_date':
      if (td.monthly_rent && td.next_rent_due_date) {
        return `Your monthly rent of **$${td.monthly_rent.toFixed(2)}** is due on **${new Date(td.next_rent_due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}**.\n\nFor questions about late fees or payment methods, please contact the property management office.`
      }
      return "I couldn't find your rent details. Please contact the property management office."

    case 'lease_question':
      if (context.lease_clauses.length > 0) {
        const clauses = context.lease_clauses.map(c =>
          c.section_title ? `### ${c.section_title}\n${c.content}` : c.content
        ).join('\n\n')
        const leaseInfo = td.lease_end_date
          ? `**Lease End Date:** ${new Date(td.lease_end_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} | **Status:** ${td.lease_status || 'Active'}\n\n`
          : ''
        return `${leaseInfo}Here's what I found in your lease:\n\n${clauses}`
      }
      if (td.lease_end_date) {
        const endDate = new Date(td.lease_end_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        return `Here are your lease details:\n\n\u2022 **Monthly Rent:** $${td.monthly_rent?.toFixed(2) || 'N/A'}\n\u2022 **Lease End Date:** ${endDate}\n\u2022 **Status:** ${td.lease_status || 'Active'}\n\nFor detailed lease questions, please contact your property management office.`
      }
      return "I couldn't find an active lease on your account. Please contact the property management office."

    case 'maintenance_status':
      if (context.maintenance_requests.length > 0) {
        const list = context.maintenance_requests.map(r =>
          `\u2022 **${r.title}** — Status: ${r.status}, Priority: ${r.priority}`
        ).join('\n')
        return `Here are your open maintenance requests:\n\n${list}\n\nNeed to report a new issue? Just describe what's wrong.`
      }
      return "You don't have any open maintenance requests. If you need to report an issue, just describe what's wrong and I'll create a request for you."

    case 'payment_history':
      if (context.payment_history.length > 0) {
        const list = context.payment_history.slice(0, 5).map(p => {
          const date = new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          return `\u2022 ${date}: ${p.description} — $${Math.abs(p.amount).toFixed(2)}`
        }).join('\n')
        return `Here's your recent account activity:\n\n${list}\n\nFor a complete history, check the Statements section of your portal.`
      }
      return "No recent payment history found. Please contact the property management office for details."

    case 'property_policy':
      if (context.property_policies.length > 0) {
        const policies = context.property_policies.map(p =>
          `### ${p.title}\n${p.content}`
        ).join('\n\n')
        return `Here are the relevant property policies:\n\n${policies}`
      }
      // Fall back to lease clauses if no explicit policies exist
      if (context.lease_clauses.length > 0) {
        const clauses = context.lease_clauses.map(c =>
          c.section_title ? `### ${c.section_title}\n${c.content}` : c.content
        ).join('\n\n')
        return `Here's what I found in your lease document:\n\n${clauses}\n\nFor any additional policy questions, please contact the property management office.`
      }
      return "I don't have specific policy information available for that topic. Please contact the property management office for details."

    default:
      return "I'm not sure how to help with that. Here's what I can assist with:\n\n" +
        "\u2022 **Lease questions** \u2014 ask about terms, renewal, move-out\n" +
        "\u2022 **Balance & payments** \u2014 check what you owe\n" +
        "\u2022 **Maintenance** \u2014 report an issue or check status\n" +
        "\u2022 **Property rules** \u2014 parking, pets, quiet hours\n\n" +
        "For anything else, please contact your property management office."
  }
}
