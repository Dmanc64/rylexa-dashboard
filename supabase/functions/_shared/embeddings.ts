/**
 * Shared OpenAI embeddings client for Rylexa edge functions.
 *
 * Provides a reusable wrapper around the OpenAI Embeddings API
 * using text-embedding-3-small (1536 dimensions).
 *
 * Used by: ingest-lease-document, tenant-assistant
 */

const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
const EMBEDDINGS_MODEL = 'text-embedding-3-small'
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

/**
 * Generate an embedding vector for a single text string.
 * Returns a 1536-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const response = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDINGS_MODEL,
      input: text,
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`OpenAI Embeddings API error (${response.status}): ${errBody.substring(0, 300)}`)
  }

  const result = await response.json()
  return result.data[0].embedding
}

/**
 * Generate embeddings for multiple text strings in a single API call.
 * Returns an array of 1536-dimensional float arrays, one per input.
 *
 * OpenAI supports batching up to ~8000 tokens per request.
 * For large batches, this function automatically chunks into groups of 100.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  if (texts.length === 0) return []

  const BATCH_SIZE = 100
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)

    const response = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDINGS_MODEL,
        input: batch,
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`OpenAI Embeddings API error (${response.status}): ${errBody.substring(0, 300)}`)
    }

    const result = await response.json()
    // OpenAI returns embeddings sorted by index
    const sorted = result.data.sort((a: any, b: any) => a.index - b.index)
    allEmbeddings.push(...sorted.map((d: any) => d.embedding))
  }

  return allEmbeddings
}

/**
 * Rough token count estimate (4 chars ≈ 1 token for English text).
 * Used for chunk size management.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
