import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { verifyAuth } from "../_shared/auth.ts"
import { callGemini } from "../_shared/gemini.ts"
import { getRoutesForRole, findRoute, buildRouteContext, findModalAction } from "./route-map.ts"

/**
 * app-assistant — AI navigation & task execution agent for all portals.
 *
 * Pipeline:
 *   Request { message, currentPath, history }
 *   → verifyAuth (JWT + role)
 *   → Greeting fast-path (no AI call)
 *   → Intent classification via Gemini
 *   → Route matching + context assembly
 *   → AI response generation via Gemini
 *   → Structured response with navigation actions
 */

// --- Types ---

interface AssistantRequest {
  message: string
  currentPath?: string
  history?: { role: 'user' | 'assistant'; text: string }[]
}

type Intent =
  | 'navigate'
  | 'explain_feature'
  | 'how_to'
  | 'current_page_help'
  | 'execute_action'
  | 'greeting'
  | 'general'

interface IntentResult {
  intent: Intent
  confidence: number
  keywords: string[]
  targetPage?: string
}

interface AssistantActionItem {
  type: 'navigate' | 'open_modal'
  path?: string
  modalId?: string
  label: string
}

interface AssistantResponse {
  reply: string
  type: 'navigation' | 'explanation' | 'how_to' | 'action' | 'greeting' | 'general'
  intent: string
  actions?: AssistantActionItem[]
  suggestedFollowups?: string[]
}

// --- Greeting fast-path ---

const GREETING_PATTERNS = /^(hi|hello|hey|howdy|good\s*(morning|afternoon|evening)|thanks|thank\s*you|yo|sup|what's\s*up)[\s!?.]*$/i

function isGreeting(message: string): boolean {
  return message.trim().split(/\s+/).length <= 6 && GREETING_PATTERNS.test(message.trim())
}

function getGreetingResponse(role: string): AssistantResponse {
  const roleGreetings: Record<string, string> = {
    'Admin': "Hello! I'm your Rylexa navigation assistant. I can help you find any page, explain features, or guide you through tasks like creating work orders, running billing, or managing vendors. What would you like to do?",
    'Property Manager': "Hello! I'm your Rylexa navigation assistant. I can help you find pages, explain features, or walk you through tasks like lease management, maintenance, and financial operations. How can I help?",
    'Accounting': "Hello! I'm your Rylexa navigation assistant. I can help you navigate finance pages, explain features like reconciliation and billing, or guide you through accounting workflows. What do you need?",
    'Maintenance': "Hello! I'm your Rylexa navigation assistant. I can help you find work orders, explain maintenance features, or guide you through updating tickets. What can I help with?",
    'Vendor': "Hello! I'm your Rylexa navigation assistant. I can help you find your jobs, log work, check bids, or manage your availability. What do you need?",
    'Owner': "Hello! I'm your Rylexa navigation assistant. I can help you find your properties, distributions, financial statements, and more. What would you like to know?",
    'Tenant': "Hello! I'm your Rylexa navigation assistant. I can help you find pages for payments, repairs, documents, and more. How can I help?",
  }

  return {
    reply: roleGreetings[role] || roleGreetings['Tenant'],
    type: 'greeting',
    intent: 'greeting',
    suggestedFollowups: [
      'What can I do on this page?',
      'Show me all available pages',
      'How do I get started?',
    ],
  }
}

// --- Intent Classification ---

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a property management web application navigation assistant.

Classify the user's message into exactly ONE of these intents:

1. "navigate" — User wants to find or go to a specific page (e.g., "where is finance?", "take me to leases", "show me vendors").

2. "explain_feature" — User wants to understand what a page or feature does (e.g., "what does reconciliation do?", "explain the AR agent").

3. "how_to" — User wants step-by-step instructions for a task (e.g., "how do I create a work order?", "how do I run billing?").

4. "current_page_help" — User wants help with their current page (e.g., "what can I do here?", "help me with this page", "what is this?").

5. "execute_action" — User wants to perform a specific action right now (e.g., "open the new lease form", "go to finance and create a bill").

6. "greeting" — Short greetings or acknowledgements (e.g., "hi", "thanks").

7. "general" — Anything that doesn't fit the above categories.

Return a JSON object with:
- "intent": one of the above intent strings
- "confidence": integer 0-100
- "keywords": array of 1-3 key terms relevant to page/feature matching
- "targetPage": optional string — the page name the user seems to want (e.g., "finance", "work orders")`

async function classifyIntent(message: string): Promise<IntentResult> {
  try {
    return await callGemini<IntentResult>({
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userPrompt: message,
      temperature: 0.05,
    })
  } catch (err) {
    console.error('Intent classification failed, using fallback:', err)
    return fallbackIntentDetection(message)
  }
}

function fallbackIntentDetection(message: string): IntentResult {
  const lower = message.toLowerCase()

  if (/where\s*(is|are|do\s*i\s*find)|take\s*me\s*to|go\s*to|show\s*me|navigate/i.test(lower)) {
    return { intent: 'navigate', confidence: 70, keywords: lower.split(/\s+/).slice(-3) }
  }
  if (/what\s*(does|is|are)\s*(the|a)?/i.test(lower) && /page|feature|section|tool/i.test(lower)) {
    return { intent: 'explain_feature', confidence: 65, keywords: lower.split(/\s+/).slice(-3) }
  }
  if (/how\s*(do\s*i|to|can\s*i)/i.test(lower)) {
    return { intent: 'how_to', confidence: 70, keywords: lower.split(/\s+/).slice(-3) }
  }
  if (/what\s*can\s*i\s*do\s*here|this\s*page|help\s*(me\s*)?(with\s*)?this/i.test(lower)) {
    return { intent: 'current_page_help', confidence: 75, keywords: [] }
  }
  if (/open|create|start|run|launch|add\s*a|new\s/i.test(lower)) {
    return { intent: 'execute_action', confidence: 60, keywords: lower.split(/\s+/).slice(-3) }
  }

  return { intent: 'general', confidence: 50, keywords: lower.split(/\s+/).slice(0, 3) }
}

// --- Response Generation ---

function buildSystemPrompt(role: string, currentPath: string | undefined): string {
  const routeContext = buildRouteContext(role)
  const currentPage = currentPath ? findRoute(currentPath) : undefined

  let prompt = `You are Rylexa Navigator, an AI assistant for the Rylexa property management web application.
Your job is to help users find pages, understand features, and complete tasks within the application.

## User Context
- Role: ${role}
- Current Page: ${currentPage ? `${currentPage.name} (${currentPage.path})` : 'Unknown'}

## Available Pages for This User
${routeContext}

## Instructions
1. Be concise and helpful. Use markdown formatting (bold, bullets).
2. When suggesting pages, ALWAYS include the exact path so the system can create navigation buttons.
3. For "how to" questions, provide numbered steps referencing specific pages.
4. For "current page help", describe what the user can do on their current page.
5. If a user asks about a page they don't have access to, explain they don't have permission and suggest alternatives.
6. Never make up features that don't exist in the route map above.
7. When referencing a page, format it as: **Page Name** (\`/path\`)
8. When a user wants to perform a task (create, add, open, start), use the "open_modal" action type with the correct page path and modalId from the Actions listed for that page.
9. For multi-step tasks, first navigate to the right page, then open the modal. Combine both in one response with an open_modal action.

## Response Format
Return a JSON object with:
- "reply": string — Your response in markdown format
- "type": one of "navigation", "explanation", "how_to", "action", "general"
- "actions": array of action objects. Two types are supported:
  - Navigation: { "type": "navigate", "path": "/exact/path", "label": "Button Label" }
  - Open Modal: { "type": "open_modal", "path": "/page/path", "modalId": "modal-id", "label": "Button Label" }
  When a user wants to perform a task (like "create a work order"), use open_modal with the correct path AND modalId. The system will navigate to the page first, then open the modal. Only use modalIds listed in the Actions section of the Available Pages.
- "suggestedFollowups": array of 2-3 follow-up questions the user might ask`

  if (currentPage) {
    prompt += `\n\n## Current Page Details
- Name: ${currentPage.name}
- Description: ${currentPage.description}
- Features: ${currentPage.features.join('; ')}
- Related Pages: ${currentPage.relatedRoutes.join(', ')}`
    if (currentPage.modals?.length) {
      prompt += `\n- Available Actions: ${currentPage.modals.map(m => `${m.label} [modalId: ${m.modalId}] — ${m.description}`).join('; ')}`
    }
  }

  return prompt
}

async function generateResponse(
  message: string,
  intent: IntentResult,
  role: string,
  currentPath: string | undefined,
  history: { role: 'user' | 'assistant'; text: string }[],
): Promise<AssistantResponse> {
  const systemPrompt = buildSystemPrompt(role, currentPath)

  // Build conversation context (last 4 exchanges max)
  const recentHistory = history.slice(-8)
  const conversationContext = recentHistory.length > 0
    ? '\n\nRecent conversation:\n' + recentHistory.map(m => `${m.role}: ${m.text}`).join('\n')
    : ''

  const userPrompt = `${message}${conversationContext}\n\n(Detected intent: ${intent.intent}, keywords: ${intent.keywords.join(', ')})`

  try {
    const result = await callGemini<AssistantResponse>({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
    })

    // Validate actions — only allow paths the user's role can access
    const validRoutes = getRoutesForRole(role)
    if (result.actions) {
      result.actions = result.actions.filter(a => {
        if (a.type === 'navigate') {
          return validRoutes.some(r => r.path === a.path)
        }
        if (a.type === 'open_modal') {
          const route = validRoutes.find(r => r.path === a.path)
          return route?.modals?.some(m => m.modalId === a.modalId)
        }
        return false
      })
    }

    result.intent = intent.intent
    return result
  } catch (err) {
    console.error('Response generation failed:', err)
    return buildFallbackResponse(intent, role, currentPath)
  }
}

function buildFallbackResponse(
  intent: IntentResult,
  role: string,
  currentPath: string | undefined,
): AssistantResponse {
  const routes = getRoutesForRole(role)
  const currentPage = currentPath ? findRoute(currentPath) : undefined

  if (intent.intent === 'current_page_help' && currentPage) {
    return {
      reply: `You're on **${currentPage.name}**.\n\n${currentPage.description}\n\n**What you can do here:**\n${currentPage.features.map(f => `- ${f}`).join('\n')}`,
      type: 'explanation',
      intent: intent.intent,
      actions: currentPage.relatedRoutes
        .map(p => {
          const route = findRoute(p)
          return route ? { type: 'navigate' as const, path: p, label: route.name } : null
        })
        .filter((a): a is AssistantActionItem => a !== null),
    }
  }

  // Try to match a modal action for execute_action intent
  if (intent.intent === 'execute_action' && intent.keywords.length > 0) {
    const match = findModalAction(role, intent.keywords)
    if (match) {
      return {
        reply: `I can help you with that! Click below to **${match.modal.label.toLowerCase()}**.`,
        type: 'action',
        intent: intent.intent,
        actions: [
          { type: 'open_modal', path: match.route.path, modalId: match.modal.modalId, label: match.modal.label },
        ],
        suggestedFollowups: ['What else can I do here?', 'Show me all available pages'],
      }
    }
  }

  // Try keyword matching against route map
  if (intent.keywords.length > 0) {
    const matches = routes.filter(r =>
      intent.keywords.some(k =>
        r.keywords.some(rk => rk.includes(k.toLowerCase())) ||
        r.name.toLowerCase().includes(k.toLowerCase())
      )
    ).slice(0, 3)

    if (matches.length > 0) {
      return {
        reply: `Here are some pages that might help:\n\n${matches.map(m => `- **${m.name}** (\`${m.path}\`): ${m.description}`).join('\n')}`,
        type: 'navigation',
        intent: intent.intent,
        actions: matches.map(m => ({ type: 'navigate' as const, path: m.path, label: m.name })),
      }
    }
  }

  return {
    reply: "I'm not sure what you're looking for. Could you try rephrasing? You can ask me things like:\n- \"Where do I find leases?\"\n- \"How do I create a work order?\"\n- \"What can I do on this page?\"",
    type: 'general',
    intent: intent.intent,
    suggestedFollowups: [
      'Show me all available pages',
      'What can I do here?',
      'How do I get started?',
    ],
  }
}

// --- Main Handler ---

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req)
  }

  try {
    // Authenticate
    const { user, role } = await verifyAuth(req)

    // Parse request body
    const body: AssistantRequest = await req.json()
    const { message, currentPath, history = [] } = body

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fast-path for greetings
    if (isGreeting(message)) {
      const response = getGreetingResponse(role)
      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle "show all pages" directly
    if (/show\s*(me\s*)?(all|every)\s*(available\s*)?(pages?|sections?|features?)/i.test(message.trim())) {
      const routes = getRoutesForRole(role)
      const grouped = new Map<string, typeof routes>()
      for (const r of routes) {
        const portal = r.portal
        if (!grouped.has(portal)) grouped.set(portal, [])
        grouped.get(portal)!.push(r)
      }

      let reply = '**Here are all the pages available to you:**\n\n'
      for (const [portal, portalRoutes] of grouped) {
        const portalName = portal === 'admin' ? 'Admin Portal'
          : portal === 'portal' ? 'Tenant Portal'
          : portal === 'vendor-portal' ? 'Vendor Portal'
          : 'Owner Portal'
        reply += `### ${portalName}\n`
        reply += portalRoutes.map(r => `- **${r.name}** (\`${r.path}\`): ${r.description}`).join('\n')
        reply += '\n\n'
      }

      return new Response(
        JSON.stringify({
          reply,
          type: 'navigation',
          intent: 'navigate',
          actions: routes.slice(0, 3).map(r => ({ type: 'navigate' as const, path: r.path, label: r.name })),
          suggestedFollowups: ['Tell me about a specific page', 'What can I do here?'],
        } satisfies AssistantResponse),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Classify intent
    const intent = await classifyIntent(message)

    // Generate AI response
    const response = await generateResponse(message, intent, role, currentPath, history)

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Internal server error'
    const status = errorMessage.includes('Authorization') || errorMessage.includes('token') ? 401 : 500

    console.error('app-assistant error:', errorMessage)

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
