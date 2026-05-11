/**
 * Shared Gemini API client for Rylexa edge functions.
 *
 * Provides a typed, reusable wrapper around the Google Gemini REST API
 * with structured JSON output. Used by tenant-assistant, triage-work-order,
 * and categorize-transactions.
 *
 * The analyze-lease function uses its own inline Gemini call because it
 * requires multimodal (PDF) input which has a different request shape.
 */

const GEMINI_API_KEY = (Deno.env.get('GEMINI_API_KEY') ?? '').trim()
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiOptions {
  /** Model to use. Defaults to 'gemini-2.0-flash' */
  model?: string
  /** System-level instructions that define the AI's behavior */
  systemPrompt: string
  /** The user's input to classify/process */
  userPrompt: string
  /** Temperature for response randomness. Defaults to 0.1 (deterministic) */
  temperature?: number
}

/**
 * Call Google Gemini API and return parsed JSON of type T.
 *
 * Uses `responseMimeType: 'application/json'` so Gemini returns
 * valid JSON directly — no regex stripping of markdown fences needed.
 *
 * @throws Error if API key is missing, API returns non-200, or response cannot be parsed
 */
export async function callGemini<T>(options: GeminiOptions): Promise<T> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const model = options.model || 'gemini-2.0-flash'
  const temperature = options.temperature ?? 0.1
  const url = `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`

  const body = {
    system_instruction: {
      parts: [{ text: options.systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: options.userPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errorText}`)
  }

  const result = await response.json()

  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('Gemini returned no candidates. Check API key quota or content safety filters.')
  }

  const rawText = result.candidates[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new Error('Gemini response missing text content')
  }

  try {
    return JSON.parse(rawText) as T
  } catch {
    // Fallback: try stripping markdown fences if responseMimeType wasn't honored
    const cleaned = rawText.replace(/```json\s*|```\s*/g, '').trim()
    return JSON.parse(cleaned) as T
  }
}
