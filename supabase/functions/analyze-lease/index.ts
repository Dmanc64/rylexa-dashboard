import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

/**
 * analyze-lease — OpenAI-powered lease document analysis.
 *
 * Accepts { file_path } in POST body (path within the "leases" storage bucket).
 * 1. Downloads the PDF from Supabase Storage
 * 2. Sends it to OpenAI GPT-4o Mini via Chat Completions (native PDF support)
 * 3. Extracts monthly_rent, security_deposit, and lease_end_date
 * 4. Logs the event to system_activity
 *
 * Returns: { monthly_rent, security_deposit, lease_end_date, rent_amount, confidence_score }
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Only Admin and Property Manager can analyze lease documents
    await requireRole(req, ['Admin', 'Property Manager'])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { file_path } = await req.json()
    if (!file_path) throw new Error('file_path is required')

    // Rate limiting: max 10 AI_AUDIT events per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('system_activity')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'AI_AUDIT')
      .gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= 10) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Max 10 lease analyses per hour.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 429,
      })
    }

    // 1. Download the lease PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('leases')
      .download(file_path)

    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`)

    // 2. Base64 encode the PDF for OpenAI
    const arrayBuffer = await fileData.arrayBuffer()
    const base64File = base64Encode(new Uint8Array(arrayBuffer))

    const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

    // 3. Send PDF to OpenAI Chat Completions API (native PDF support via type: "file")
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a lease document analyzer. Extract the requested data and return it as a JSON object. Be precise with numbers and dates.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: {
                  filename: file_path.split('/').pop() || 'lease.pdf',
                  file_data: `data:application/pdf;base64,${base64File}`,
                },
              },
              {
                type: 'text',
                text: 'Extract the following details from this lease agreement and return them as a JSON object:\n- monthly_rent (number, no dollar sign)\n- security_deposit (number, no dollar sign)\n- lease_end_date (ISO date string, e.g. "2025-12-31")\n\nReturn ONLY a valid JSON object.',
              },
            ],
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!aiResponse.ok) {
      const errBody = await aiResponse.text()
      throw new Error(`OpenAI API error (${aiResponse.status}): ${errBody.substring(0, 300)}`)
    }

    const result = await aiResponse.json()
    const content = result.choices?.[0]?.message?.content
    if (!content) throw new Error('OpenAI returned no content')

    const extractedData = JSON.parse(content)

    // 4. Log the event in our Activity Feed
    await supabase.from('system_activity').insert({
      event_type: 'AI_AUDIT',
      title: 'Lease Intelligence Processed',
      description: `Extracted Rent: $${extractedData.monthly_rent} from ${file_path}`,
      actor_name: 'GPT-4o Mini',
    })

    return new Response(JSON.stringify({
      ...extractedData,
      rent_amount: extractedData.monthly_rent,
      confidence_score: 1.0,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('analyze-lease error:', error.message)
    const status = error.message?.includes('Authorization') || error.message?.includes('token') || error.message?.includes('Access denied') ? 401 : 400
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })
  }
})
