/**
 * Shared CORS configuration for all Rylexa edge functions.
 *
 * ALLOWED_ORIGINS restricts which domains can call these functions from a browser.
 * Requests from unlisted origins will be rejected at the preflight stage.
 *
 * For webhook-triggered functions (notify-manager, notify-tenant, apply-late-fees),
 * CORS is irrelevant (no browser involved), but we still export helpers for consistency.
 */

const PRODUCTION_ORIGINS: string[] = [
  'https://rylexa.com',
  'https://www.rylexa.com',
  'https://rylexapm.fly.dev',
  'https://lxblmqwdzeajsfbhnvss.supabase.co',
]

const DEV_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://localhost:3001',
]

const ALLOWED_ORIGINS: string[] = Deno.env.get('ENVIRONMENT') === 'production'
  ? PRODUCTION_ORIGINS
  : [...PRODUCTION_ORIGINS, ...DEV_ORIGINS]

/**
 * Returns CORS headers scoped to the request's origin, or rejects unknown origins.
 * If the origin is not in the allow-list, returns headers without Access-Control-Allow-Origin,
 * which causes the browser to block the response.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }

  return headers
}

/** Standard preflight response for OPTIONS requests */
export function handleCorsPreFlight(req: Request): Response {
  return new Response('ok', { headers: getCorsHeaders(req) })
}
