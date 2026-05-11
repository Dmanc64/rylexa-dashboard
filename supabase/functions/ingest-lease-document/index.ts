import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"
import { requireRole } from "../_shared/auth.ts"
import { generateEmbeddings, estimateTokens } from "../_shared/embeddings.ts"

/**
 * ingest-lease-document — Lease document RAG ingestion pipeline.
 *
 * 1. Downloads lease PDF from Supabase Storage
 * 2. Extracts full text using OpenAI GPT-4o Mini (native PDF support)
 * 3. Splits text into semantic chunks (~500 tokens each)
 * 4. Generates embeddings for each chunk (text-embedding-3-small)
 * 5. Stores chunks + embeddings in lease_document_chunks table
 *
 * POST body: { lease_id, file_path, document_id? }
 * - lease_id: UUID of the lease
 * - file_path: path within the "leases" or "documents" storage bucket
 * - document_id: optional UUID from the documents table
 *
 * Returns: { chunks_created, message }
 */

// --- TEXT EXTRACTION ---

const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()

async function extractTextFromPDF(base64File: string, fileName: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
          content: `You are a lease document text extractor. Extract ALL text content from this lease document, preserving the structure.

Rules:
- Preserve section headings (e.g., "Section 5: Pet Policy")
- Preserve numbered clauses and sub-clauses
- Preserve paragraph breaks
- Include all financial terms, dates, and conditions
- Do NOT summarize — extract the full verbatim text
- Mark section headings with "## " prefix for easy parsing
- If a section has a clear title, start it with "## Section Title"`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: fileName,
                file_data: `data:application/pdf;base64,${base64File}`,
              },
            },
            {
              type: 'text',
              text: 'Extract all text from this lease document, preserving structure and section headings.',
            },
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 16000,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`OpenAI text extraction error (${response.status}): ${errBody.substring(0, 300)}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned no content for text extraction')

  return content
}

// --- CHUNKING ---

interface Chunk {
  content: string
  sectionTitle: string | null
  index: number
  tokenCount: number
}

/**
 * Split extracted lease text into semantic chunks.
 * Strategy: split by section headings first, then by paragraph if sections are too large.
 * Target chunk size: ~500 tokens with 50-token overlap.
 */
function chunkLeaseText(text: string, targetTokens = 500, overlapTokens = 50): Chunk[] {
  const chunks: Chunk[] = []
  let chunkIndex = 0

  // Split by section headings (## prefix)
  const sections = text.split(/(?=^## )/m)

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    // Extract section title
    const titleMatch = trimmed.match(/^## (.+?)(?:\n|$)/)
    const sectionTitle = titleMatch ? titleMatch[1].trim() : null
    const sectionBody = titleMatch ? trimmed.slice(titleMatch[0].length).trim() : trimmed

    const tokens = estimateTokens(sectionBody)

    if (tokens <= targetTokens) {
      // Section fits in one chunk
      chunks.push({
        content: sectionTitle ? `${sectionTitle}\n\n${sectionBody}` : sectionBody,
        sectionTitle,
        index: chunkIndex++,
        tokenCount: tokens,
      })
    } else {
      // Split large sections by paragraphs
      const paragraphs = sectionBody.split(/\n\n+/)
      let currentChunk = sectionTitle ? `${sectionTitle}\n\n` : ''
      let currentTokens = estimateTokens(currentChunk)

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para)

        if (currentTokens + paraTokens > targetTokens && currentChunk.trim()) {
          // Save current chunk
          chunks.push({
            content: currentChunk.trim(),
            sectionTitle,
            index: chunkIndex++,
            tokenCount: currentTokens,
          })

          // Start new chunk with overlap — include last sentence of previous chunk
          const lastSentences = currentChunk.trim().split(/[.!?]\s+/).slice(-2).join('. ')
          const overlap = lastSentences.length > 10 ? lastSentences + '.\n\n' : ''
          currentChunk = (sectionTitle ? `${sectionTitle} (continued)\n\n` : '') + overlap + para + '\n\n'
          currentTokens = estimateTokens(currentChunk)
        } else {
          currentChunk += para + '\n\n'
          currentTokens += paraTokens
        }
      }

      // Don't forget the last chunk
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          sectionTitle,
          index: chunkIndex++,
          tokenCount: estimateTokens(currentChunk),
        })
      }
    }
  }

  // If no sections were found (no ## headings), chunk by paragraphs
  if (chunks.length === 0) {
    const paragraphs = text.split(/\n\n+/)
    let currentChunk = ''
    let currentTokens = 0

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para)

      if (currentTokens + paraTokens > targetTokens && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          sectionTitle: null,
          index: chunkIndex++,
          tokenCount: currentTokens,
        })
        currentChunk = para + '\n\n'
        currentTokens = paraTokens
      } else {
        currentChunk += para + '\n\n'
        currentTokens += paraTokens
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        sectionTitle: null,
        index: chunkIndex++,
        tokenCount: estimateTokens(currentChunk),
      })
    }
  }

  return chunks
}

// --- MAIN HANDLER ---

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Only Admin and Property Manager can ingest lease documents
    await requireRole(req, ['Admin', 'Property Manager'])

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { lease_id, file_path, document_id, bucket = 'leases' } = await req.json()
    if (!lease_id) throw new Error('lease_id is required')
    if (!file_path) throw new Error('file_path is required')

    // Verify lease exists
    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .select('id, unit_id')
      .eq('id', lease_id)
      .single()

    if (leaseError || !lease) throw new Error('Lease not found')

    // Delete existing chunks for this lease (re-ingestion)
    await supabase
      .from('lease_document_chunks')
      .delete()
      .eq('lease_id', lease_id)

    // 1. Download the lease PDF
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from(bucket)
      .download(file_path)

    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`)

    // 2. Extract text from PDF
    const arrayBuffer = await fileData.arrayBuffer()
    const base64File = base64Encode(new Uint8Array(arrayBuffer))
    const fileName = file_path.split('/').pop() || 'lease.pdf'

    const extractedText = await extractTextFromPDF(base64File, fileName)

    if (!extractedText || extractedText.length < 50) {
      throw new Error('Could not extract meaningful text from lease document')
    }

    // 3. Chunk the text
    const chunks = chunkLeaseText(extractedText)

    if (chunks.length === 0) {
      throw new Error('No chunks generated from lease text')
    }

    // 4. Generate embeddings for all chunks
    const chunkTexts = chunks.map(c => c.content)
    const embeddings = await generateEmbeddings(chunkTexts)

    // 5. Store chunks + embeddings in database
    const rows = chunks.map((chunk, i) => ({
      lease_id,
      document_id: document_id || null,
      chunk_index: chunk.index,
      content: chunk.content,
      section_title: chunk.sectionTitle,
      embedding: JSON.stringify(embeddings[i]),
      token_count: chunk.tokenCount,
      metadata: {
        file_path,
        bucket,
        extracted_at: new Date().toISOString(),
      },
    }))

    const { error: insertError } = await supabase
      .from('lease_document_chunks')
      .insert(rows)

    if (insertError) throw new Error(`Failed to store chunks: ${insertError.message}`)

    // 6. Log the event
    await supabase.from('system_activity').insert({
      event_type: 'AI_AUDIT',
      title: 'Lease Document Ingested for AI',
      description: `Ingested ${chunks.length} chunks from ${fileName} for lease ${lease_id.slice(0, 8)}`,
      actor_name: 'Lease RAG Pipeline',
      related_entity_id: lease_id,
    })

    return new Response(
      JSON.stringify({
        chunks_created: chunks.length,
        total_tokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
        message: `Successfully ingested ${chunks.length} chunks from lease document.`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('ingest-lease-document error:', error.message)
    const status = error.message?.includes('Authorization') || error.message?.includes('token') || error.message?.includes('Access denied') ? 401 : 400
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })
  }
})
