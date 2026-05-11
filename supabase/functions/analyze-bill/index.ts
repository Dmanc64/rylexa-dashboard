import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"

/**
 * analyze-bill — OpenAI-powered AP invoice OCR.
 *
 * POST body: { file_path: string, bucket?: string }
 *   file_path — path within the storage bucket (default "documents")
 *   bucket    — storage bucket name, defaults to "documents"
 *
 * Flow:
 *   1. Download the invoice (PDF or image) from Supabase Storage
 *   2. Send to OpenAI GPT-4o Mini with structured JSON instructions
 *   3. Parse vendor_name, invoice_number, invoice_date, due_date, amount,
 *      line_items[], suggested_category, summary, confidence
 *   4. Log the AI_AUDIT event to system_activity
 *
 * Returns the extracted payload as-is so the client can pre-fill the bill
 * form and persist it on the bills row via ocr_extracted_fields.
 */

// Must match the CATEGORIES constant in src/components/NewBillModal.tsx.
const BILL_CATEGORIES = [
  'Maintenance & Repairs',
  'Utilities',
  'Insurance',
  'Property Tax',
  'Management Fees',
  'Landscaping',
  'Cleaning',
  'Legal & Professional',
  'Supplies',
  'Capital Improvements',
  'Other',
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    await requireRole(req, ['Admin', 'Property Manager', 'Accounting'])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const file_path: string | undefined = body?.file_path
    const bucket: string = body?.bucket || 'documents'
    if (!file_path) throw new Error('file_path is required')

    // Rate limit AI_AUDIT events: max 30/hr across the org.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('system_activity')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'AI_AUDIT')
      .gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= 30) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Max 30 AI extractions per hour.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from(bucket)
      .download(file_path)

    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`)

    const arrayBuffer = await fileData.arrayBuffer()
    const base64File = base64Encode(new Uint8Array(arrayBuffer))

    const filename = file_path.split('/').pop() || 'invoice'
    const ext = (filename.split('.').pop() || '').toLowerCase()

    // Choose the right OpenAI content block per file type. GPT-4o Mini accepts
    // PDFs via type:"file" and raster images via type:"image_url" with data URLs.
    let contentBlock: Record<string, unknown>
    if (ext === 'pdf') {
      contentBlock = {
        type: 'file',
        file: {
          filename,
          file_data: `data:application/pdf;base64,${base64File}`,
        },
      }
    } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      const mime = ext === 'jpg' ? 'jpeg' : ext
      contentBlock = {
        type: 'image_url',
        image_url: {
          url: `data:image/${mime};base64,${base64File}`,
        },
      }
    } else {
      throw new Error(`Unsupported file type: .${ext}. Expected pdf, jpg, jpeg, png, or webp.`)
    }

    const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured')

    const systemPrompt = [
      'You are an accounts-payable assistant that extracts structured data from vendor invoices.',
      'Return ONLY a JSON object with the following shape:',
      '{',
      '  "vendor_name": string,              // company issuing the invoice',
      '  "invoice_number": string | null,    // invoice/reference number',
      '  "invoice_date": string | null,      // ISO date (YYYY-MM-DD) when the invoice was issued',
      '  "due_date": string | null,          // ISO date when payment is due',
      '  "amount": number,                   // grand total due, no currency symbol, number only',
      '  "currency": string | null,          // ISO 4217, e.g. "USD"',
      '  "line_items": [ { "description": string, "quantity": number | null, "unit_price": number | null, "amount": number } ],',
      '  "suggested_category": string,       // one of the allowed categories listed below',
      '  "summary": string,                  // one-sentence plain-English description of the work or goods',
      '  "confidence": number                // 0.00–1.00, your overall confidence in this extraction',
      '}',
      '',
      `Allowed categories (pick the single best fit): ${BILL_CATEGORIES.map((c) => `"${c}"`).join(', ')}.`,
      'If a field is not present on the document, return null (not an empty string). Never invent a value.',
      'Amounts must be plain numbers (e.g. 1234.56), never strings or formatted text.',
      'Dates must be ISO (YYYY-MM-DD). If the invoice shows only "Net 30" or similar, compute due_date from invoice_date when possible; otherwise return null.',
    ].join('\n')

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              contentBlock,
              {
                type: 'text',
                text: 'Extract the invoice fields per the schema. Return only the JSON object.',
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

    const extracted = JSON.parse(content)

    // Coerce suggested_category to a known value; default to "Other" if the
    // model returns something unexpected.
    if (!BILL_CATEGORIES.includes(extracted.suggested_category)) {
      extracted.suggested_category = 'Other'
    }

    // Coerce confidence into [0, 1].
    const rawConfidence = Number(extracted.confidence)
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : null
    extracted.confidence = confidence

    await supabase.from('system_activity').insert({
      event_type: 'AI_AUDIT',
      title: 'Invoice OCR Processed',
      description: `Extracted ${extracted.vendor_name ?? 'unknown vendor'} — ${extracted.amount ?? '?'} from ${file_path}`,
      actor_name: 'GPT-4o Mini',
    })

    return new Response(
      JSON.stringify({
        ...extracted,
        model: 'gpt-4o-mini',
        file_path,
        bucket,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    console.error('analyze-bill error:', message)
    const status = /Authorization|token|Access denied/i.test(message) ? 401 : 400
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })
  }
})
