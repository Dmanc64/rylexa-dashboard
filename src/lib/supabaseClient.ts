import { createBrowserClient } from '@supabase/ssr'

// Single shared browser client instance for all client components
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * Get a fresh, non-expired session for edge function calls.
 *
 * `supabase.auth.getSession()` returns cached data from localStorage
 * and may hand back an expired access_token, causing 401s from edge
 * functions that have `verify_jwt: true`.
 *
 * This helper calls `getUser()` first (which validates the token
 * server-side and triggers an auto-refresh if expired), then reads
 * the now-refreshed session from the store.
 *
 * Returns `null` if the user is not authenticated.
 */
export async function getFreshSession() {
  // getUser() forces a server round-trip and triggers token refresh
  const { error: userError } = await supabase.auth.getUser()
  if (userError) return null

  const { data: { session } } = await supabase.auth.getSession()
  return session
}
