/**
 * Shared context builder for the Tenant AI Assistant.
 *
 * Assembles structured context (tenant data, lease clauses, policies,
 * maintenance requests) based on detected intent. Only fetches data
 * relevant to the intent to minimize token usage.
 *
 * Used by: tenant-assistant edge function
 */

import { generateEmbedding } from "./embeddings.ts"

// --- TYPES ---

export type Intent =
  | 'lease_question'
  | 'account_balance'
  | 'payment_history'
  | 'rent_due_date'
  | 'maintenance_status'
  | 'maintenance_request'
  | 'property_policy'
  | 'general_question'
  | 'greeting'

export interface TenantContext {
  tenant_name: string
  unit_number: string
  property_name: string
  property_id: string
  monthly_rent: number | null
  account_balance: number | null
  next_rent_due_date: string | null
  lease_start_date: string | null
  lease_end_date: string | null
  lease_status: string | null
  lease_id: string | null
}

export interface MaintenanceRequest {
  id: string
  title: string
  description: string
  status: string
  priority: string
  category: string | null
  created_at: string
  vendor_name: string | null
}

export interface AssembledContext {
  tenant_data: TenantContext
  lease_clauses: { content: string; section_title: string | null; similarity: number }[]
  property_policies: { category: string; title: string; content: string }[]
  maintenance_requests: MaintenanceRequest[]
  payment_history: { amount: number; date: string; description: string; type: string }[]
  _errors: string[]
}

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

8. "general_question" — Anything that doesn't fit the above (e.g., greetings, thanks, general inquiries).

9. "greeting" — Short greetings, thanks, or acknowledgements (6 words or fewer, e.g., "hi", "hello", "thanks").

Return a JSON object with:
- "intent": one of the above intent strings
- "confidence": integer 0-100
- "keywords": array of 1-3 key terms from the message relevant to data retrieval`

export interface IntentResult {
  intent: Intent
  confidence: number
  keywords: string[]
}

// --- CONTEXT FETCHING ---

/**
 * Fetch core tenant data: name, unit, property, lease info, balance.
 */
export async function fetchTenantData(
  supabase: any,
  userId: string,
  tenantId: string,
  unitId: string
): Promise<TenantContext> {
  // Fetch tenant name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('first_name, last_name')
    .eq('id', tenantId)
    .single()

  // Fetch unit + property
  const { data: unit } = await supabase
    .from('units')
    .select('id, name, property_id, properties ( id, name )')
    .eq('id', unitId)
    .single()

  // Fetch active lease
  const { data: lease } = await supabase
    .from('leases')
    .select('id, rent_amount, start_date, end_date, status')
    .eq('user_id', userId)
    .eq('status', 'Active')
    .limit(1)
    .maybeSingle()

  // Fetch balance from ledger
  let accountBalance: number | null = null
  if (tenantId) {
    const { data: ledger } = await supabase
      .from('ledger_entries')
      .select('debit, credit, journal_entries!inner(reference_id)')
      .eq('journal_entries.reference_id', tenantId)

    if (ledger) {
      const debits = ledger.reduce((sum: number, e: any) => sum + Number(e.debit), 0)
      const credits = ledger.reduce((sum: number, e: any) => sum + Number(e.credit), 0)
      accountBalance = debits - credits
    }
  }

  // Calculate next rent due date
  let nextRentDue: string | null = null
  if (lease) {
    // Fetch billing settings for the property
    const propertyId = (unit as any)?.properties?.id || (unit as any)?.property_id
    const { data: billing } = await supabase
      .from('billing_settings')
      .select('rent_due_day, grace_period_days, late_fee_type, late_fee_amount')
      .eq('property_id', propertyId)
      .maybeSingle()

    const dueDay = billing?.rent_due_day || 1
    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay)
    nextRentDue = (now > thisMonth
      ? new Date(now.getFullYear(), now.getMonth() + 1, dueDay)
      : thisMonth
    ).toISOString().split('T')[0]
  }

  return {
    tenant_name: tenant ? `${tenant.first_name} ${tenant.last_name}`.trim() : 'Tenant',
    unit_number: (unit as any)?.name || 'Unknown',
    property_name: (unit as any)?.properties?.name || 'Unknown Property',
    property_id: (unit as any)?.properties?.id || (unit as any)?.property_id || '',
    monthly_rent: lease ? Number(lease.rent_amount) : null,
    account_balance: accountBalance,
    next_rent_due_date: nextRentDue,
    lease_start_date: lease?.start_date || null,
    lease_end_date: lease?.end_date || null,
    lease_status: lease?.status || null,
    lease_id: lease?.id || null,
  }
}

/**
 * RAG: Retrieve relevant lease document chunks via vector similarity search.
 */
export async function fetchLeaseClauses(
  supabase: any,
  leaseId: string,
  query: string,
  matchCount = 5,
  matchThreshold = 0.4
): Promise<{ content: string; section_title: string | null; similarity: number }[]> {
  console.log(`[RAG] Generating embedding for query: "${query.substring(0, 80)}"`)
  const queryEmbedding = await generateEmbedding(query)
  console.log(`[RAG] Embedding generated, length=${queryEmbedding.length}`)

  const { data, error } = await supabase.rpc('match_lease_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_lease_id: leaseId,
    match_threshold: matchThreshold,
    match_count: matchCount,
  })

  if (error) {
    throw new Error(`RPC match_lease_chunks failed: ${error.message}`)
  }

  console.log(`[RAG] Found ${data?.length || 0} matching chunks (threshold=${matchThreshold})`)
  return data || []
}

/**
 * Fetch property policies relevant to the query.
 * Filters by category keywords when possible.
 */
export async function fetchPropertyPolicies(
  supabase: any,
  propertyId: string,
  keywords: string[] = []
): Promise<{ category: string; title: string; content: string }[]> {
  // Map common keywords to policy categories
  const categoryMap: Record<string, string> = {
    pet: 'pet_policy', pets: 'pet_policy', dog: 'pet_policy', cat: 'pet_policy', animal: 'pet_policy',
    park: 'parking', parking: 'parking', car: 'parking', vehicle: 'parking',
    guest: 'guest_policy', guests: 'guest_policy', visitor: 'guest_policy', visitors: 'guest_policy',
    noise: 'noise_quiet_hours', quiet: 'noise_quiet_hours', loud: 'noise_quiet_hours', hours: 'noise_quiet_hours',
    trash: 'trash_recycling', garbage: 'trash_recycling', recycling: 'trash_recycling', recycle: 'trash_recycling',
    maintenance: 'maintenance_procedures', repair: 'maintenance_procedures',
    move: 'move_in_out', 'move-in': 'move_in_out', 'move-out': 'move_in_out', moving: 'move_in_out',
    amenity: 'amenities', amenities: 'amenities', pool: 'amenities', gym: 'amenities', laundry: 'amenities',
    insurance: 'insurance', renters: 'insurance',
    smoke: 'smoking', smoking: 'smoking', vape: 'smoking',
  }

  // Determine which categories to fetch
  const targetCategories = new Set<string>()
  for (const kw of keywords) {
    const lower = kw.toLowerCase()
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (lower.includes(key)) targetCategories.add(cat)
    }
  }

  let query = supabase
    .from('property_policies')
    .select('category, title, content')
    .eq('property_id', propertyId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (targetCategories.size > 0) {
    query = query.in('category', Array.from(targetCategories))
  }

  // Limit to 5 policies max to control token usage
  query = query.limit(5)

  const { data, error } = await query

  if (error) {
    console.error('Policy fetch error:', error.message)
    return []
  }

  return data || []
}

/**
 * Fetch tenant's maintenance requests (recent, open/in-progress).
 */
export async function fetchMaintenanceRequests(
  supabase: any,
  tenantId: string,
  unitId: string
): Promise<MaintenanceRequest[]> {
  const { data, error } = await supabase
    .from('work_orders')
    .select(`
      id, title, description, status, priority, category, created_at,
      vendors ( company_name )
    `)
    .or(`tenant_id.eq.${tenantId},unit_id.eq.${unitId}`)
    .in('status', ['Open', 'Assigned', 'In Progress', 'On Hold'])
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Maintenance fetch error:', error.message)
    return []
  }

  return (data || []).map((wo: any) => ({
    id: wo.id,
    title: wo.title,
    description: wo.description,
    status: wo.status,
    priority: wo.priority,
    category: wo.category,
    created_at: wo.created_at,
    vendor_name: wo.vendors?.company_name || null,
  }))
}

/**
 * Fetch recent payment history for the tenant.
 */
export async function fetchPaymentHistory(
  supabase: any,
  leaseId: string
): Promise<{ amount: number; date: string; description: string; type: string }[]> {
  const { data, error } = await supabase
    .from('accounting')
    .select('amount, created_at, description, type')
    .eq('lease_id', leaseId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Payment history fetch error:', error.message)
    return []
  }

  return (data || []).map((p: any) => ({
    amount: Number(p.amount),
    date: p.created_at,
    description: p.description || p.type,
    type: p.type,
  }))
}

/**
 * Assemble the full AI context based on detected intent.
 * Only fetches data relevant to the intent to minimize tokens.
 */
export async function assembleContext(
  supabase: any,
  userId: string,
  tenantId: string,
  unitId: string,
  intent: Intent,
  message: string,
  keywords: string[] = []
): Promise<AssembledContext> {
  // Always fetch tenant data (it's small and always useful)
  const tenantData = await fetchTenantData(supabase, userId, tenantId, unitId)

  const context: AssembledContext = {
    tenant_data: tenantData,
    lease_clauses: [],
    property_policies: [],
    maintenance_requests: [],
    payment_history: [],
    _errors: [],
  }

  // Fetch data based on intent
  switch (intent) {
    case 'lease_question':
      // RAG: retrieve relevant lease clauses
      if (tenantData.lease_id) {
        try {
          context.lease_clauses = await fetchLeaseClauses(supabase, tenantData.lease_id, message)
        } catch (e) { context._errors.push(`RAG(lease): ${e.message}`) }
      }
      // Also check policies if the question overlaps (e.g., "can I have a pet?" could be lease OR policy)
      if (tenantData.property_id) {
        context.property_policies = await fetchPropertyPolicies(supabase, tenantData.property_id, keywords)
      }
      break

    case 'account_balance':
    case 'rent_due_date':
      // Balance is already in tenant_data; also fetch recent payments for context
      if (tenantData.lease_id) {
        context.payment_history = await fetchPaymentHistory(supabase, tenantData.lease_id)
      }
      break

    case 'payment_history':
      if (tenantData.lease_id) {
        context.payment_history = await fetchPaymentHistory(supabase, tenantData.lease_id)
      }
      break

    case 'maintenance_status':
      context.maintenance_requests = await fetchMaintenanceRequests(supabase, tenantId, unitId)
      break

    case 'maintenance_request':
      // Fetch existing requests to check for duplicates
      context.maintenance_requests = await fetchMaintenanceRequests(supabase, tenantId, unitId)
      break

    case 'property_policy':
      if (tenantData.property_id) {
        context.property_policies = await fetchPropertyPolicies(supabase, tenantData.property_id, keywords)
      }
      // Also search lease for related clauses
      if (tenantData.lease_id) {
        try {
          context.lease_clauses = await fetchLeaseClauses(supabase, tenantData.lease_id, message, 3, 0.4)
        } catch (e) { context._errors.push(`RAG(policy): ${e.message}`) }
      }
      break

    case 'general_question':
      // Broad search — try policies and lease
      if (tenantData.property_id) {
        context.property_policies = await fetchPropertyPolicies(supabase, tenantData.property_id, keywords)
      }
      if (tenantData.lease_id) {
        try {
          context.lease_clauses = await fetchLeaseClauses(supabase, tenantData.lease_id, message, 3, 0.4)
        } catch (e) { context._errors.push(`RAG(general): ${e.message}`) }
      }
      break
  }

  return context
}

/**
 * Format assembled context into a structured string for the AI system prompt.
 */
export function formatContextForPrompt(context: AssembledContext): string {
  const parts: string[] = []

  // Tenant data
  const td = context.tenant_data
  parts.push(`## Tenant Information
- Name: ${td.tenant_name}
- Unit: ${td.unit_number} at ${td.property_name}
- Monthly Rent: ${td.monthly_rent !== null ? `$${td.monthly_rent.toFixed(2)}` : 'Not available'}
- Current Balance: ${td.account_balance !== null ? `$${td.account_balance.toFixed(2)}` : 'Not available'}
- Next Rent Due: ${td.next_rent_due_date || 'Not available'}
- Lease Start: ${td.lease_start_date || 'Not available'}
- Lease End: ${td.lease_end_date || 'Not available'}
- Lease Status: ${td.lease_status || 'Not available'}`)

  // Lease clauses (RAG results)
  if (context.lease_clauses.length > 0) {
    parts.push(`\n## Relevant Lease Clauses`)
    for (const clause of context.lease_clauses) {
      const header = clause.section_title ? `### ${clause.section_title}` : '### Lease Excerpt'
      parts.push(`${header}\n${clause.content}`)
    }
  }

  // Property policies
  if (context.property_policies.length > 0) {
    parts.push(`\n## Property Policies`)
    for (const policy of context.property_policies) {
      parts.push(`### ${policy.title}\n${policy.content}`)
    }
  }

  // Maintenance requests
  if (context.maintenance_requests.length > 0) {
    parts.push(`\n## Open Maintenance Requests`)
    for (const req of context.maintenance_requests) {
      const date = new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      parts.push(`- **${req.title}** (${req.status}, ${req.priority}) — submitted ${date}${req.vendor_name ? `, assigned to ${req.vendor_name}` : ''}`)
    }
  }

  // Payment history
  if (context.payment_history.length > 0) {
    parts.push(`\n## Recent Account Activity`)
    for (const p of context.payment_history.slice(0, 5)) {
      const date = new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const sign = p.type === 'Payment' || p.type === 'Credit' ? '-' : '+'
      parts.push(`- ${date}: ${p.description} — ${sign}$${Math.abs(p.amount).toFixed(2)}`)
    }
  }

  return parts.join('\n')
}
