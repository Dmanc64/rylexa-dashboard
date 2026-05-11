/**
 * Local test script for tenant-assistant edge function.
 * Signs in as the test tenant user and calls the function.
 *
 * Usage: node test-assistant.mjs "what is the pet policy?"
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load .env.local — secrets must come from env, never be hardcoded here.
dotenv.config({ path: '.env.local' })

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY         = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Missing env vars. Run from project root with .env.local present.')
  console.error('  NEXT_PUBLIC_SUPABASE_URL:        ', SUPABASE_URL     ? 'OK' : 'MISSING')
  console.error('  SUPABASE_SERVICE_ROLE_KEY:       ', SERVICE_ROLE_KEY ? 'OK' : 'MISSING')
  console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY:   ', ANON_KEY         ? 'OK' : 'MISSING')
  process.exit(1)
}

// Test tenant: Dan Lasoni (vf@rylexa.com)
const TEST_USER_EMAIL = 'vf@rylexa.com'
const TEST_TENANT_ID = 'ac84e562-5e71-43b3-b41b-74fcc9bc28c0'
const TEST_UNIT_ID = 'a48fa0ce-34d7-4ef0-8d26-f998140e68c9'

const message = process.argv[2] || 'what is the pet policy?'

async function main() {
  console.log(`\n--- Testing tenant-assistant ---`)
  console.log(`Message: "${message}"\n`)

  // Use admin client to generate a magic link and extract the token
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Generate a magic link to get an access token for the test user
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_USER_EMAIL,
  })

  if (linkError) {
    console.error('Failed to generate link:', linkError.message)
    process.exit(1)
  }

  // The hashed_token from generateLink can be used to verify the OTP
  const { data: verifyData, error: verifyError } = await admin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  })

  if (verifyError) {
    console.error('Failed to verify OTP:', verifyError.message)
    process.exit(1)
  }

  const accessToken = verifyData.session.access_token
  console.log(`Got access token for ${TEST_USER_EMAIL} (${verifyData.user.id})`)

  // Call the edge function
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await userClient.functions.invoke('tenant-assistant', {
    body: {
      tenant_id: TEST_TENANT_ID,
      unit_id: TEST_UNIT_ID,
      message,
    },
  })

  if (error) {
    console.error('\n--- ERROR ---')
    console.error('Error:', error.message)
    try {
      const ctx = error.context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        console.error('Body:', JSON.stringify(body, null, 2))
      }
    } catch {}
    process.exit(1)
  }

  console.log('\n--- RESPONSE ---')
  console.log(JSON.stringify(data, null, 2))

  console.log('\n--- SUMMARY ---')
  console.log(`Intent: ${data.intent}`)
  console.log(`AI Method: ${data._debug?.ai_method}`)
  console.log(`AI Error: ${data._debug?.ai_error || 'none'}`)
  console.log(`Lease ID: ${data._debug?.lease_id}`)
  console.log(`Lease Clauses: ${data._debug?.lease_clauses_count}`)
  console.log(`Policies: ${data._debug?.policies_count}`)
  console.log(`Context Length: ${data._debug?.context_length}`)
  console.log(`\nReply preview: ${data.reply?.substring(0, 200)}...`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

// Also test the RAG pipeline directly
async function testRAG() {
  console.log(`\n--- Testing RAG pipeline directly ---`)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Step 1: Generate embedding via OpenAI
  const OPENAI_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_KEY) {
    console.log('No OPENAI_API_KEY in local env. Testing RPC with existing chunk embedding instead...')

    // Use an existing embedding from the DB to test the RPC
    const { data: chunk, error: chunkErr } = await admin
      .from('lease_document_chunks')
      .select('id, section_title, embedding')
      .eq('lease_id', 'c72ff391-d053-47aa-bb92-79c4fe0dabfa')
      .limit(1)
      .single()

    if (chunkErr) {
      console.error('Failed to fetch chunk:', chunkErr.message)
      return
    }

    console.log(`Using embedding from chunk: "${chunk.section_title}" (id=${chunk.id})`)
    console.log(`Embedding type: ${typeof chunk.embedding}, length: ${typeof chunk.embedding === 'string' ? chunk.embedding.length : 'N/A'}`)

    // Call the RPC with this embedding
    const { data: matches, error: rpcErr } = await admin.rpc('match_lease_chunks', {
      query_embedding: typeof chunk.embedding === 'string' ? chunk.embedding : JSON.stringify(chunk.embedding),
      match_lease_id: 'c72ff391-d053-47aa-bb92-79c4fe0dabfa',
      match_threshold: 0.5,
      match_count: 5,
    })

    if (rpcErr) {
      console.error('RPC error:', rpcErr.message)
      console.error('RPC error details:', JSON.stringify(rpcErr))
      return
    }

    console.log(`RPC returned ${matches?.length || 0} results:`)
    matches?.forEach((m, i) => {
      console.log(`  ${i+1}. "${m.section_title}" (similarity: ${m.similarity?.toFixed(4)})`)
    })
    return
  }
}

testRAG().catch(err => console.error('RAG test error:', err))
