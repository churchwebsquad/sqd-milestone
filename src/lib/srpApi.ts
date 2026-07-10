/**
 * Tiny fetch wrapper for /api/srp/* endpoints (Vercel) and Supabase Edge Functions.
 *
 * start-transcription and start-clipcutter are Duane's Supabase edge functions;
 * all other SRP endpoints stay on Vercel API routes.
 */

// Edge functions that live on Supabase (not Vercel)
const EDGE_FUNCTION_PATHS = new Set(['start-transcription', 'start-clipcutter', 'submit-to-clickup', 'save-clip-template'])

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export interface SrpApiOptions {
  /** Optional AbortSignal so the caller can cancel in-flight requests
   *  on unmount or step change. */
  signal?: AbortSignal
  /** Auth token forwarded to Supabase edge functions */
  authToken?: string
}

export async function callSrpApi<T = unknown>(
  path: string,
  body: unknown,
  opts: SrpApiOptions = {},
): Promise<T> {
  const slug = path.replace(/^\/+/, '').replace(/^api\/srp\//, '')
  let url: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (EDGE_FUNCTION_PATHS.has(slug)) {
    url = `${SUPABASE_URL}/functions/v1/srp-${slug}`
    if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`
    else headers['apikey'] = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  } else {
    url = path.startsWith('/api/') ? path : `/api/srp/${slug}`
  }
  let r: Response
  try {
    r = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body ?? {}),
      signal:  opts.signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new Error(`Network error calling ${url}: ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // Both success and known-error endpoints return JSON. If we hit a
  // non-JSON body that's an upstream issue worth surfacing verbatim.
  let parsed: unknown
  const text = await r.text()
  try { parsed = JSON.parse(text) }
  catch { throw new Error(`${url} returned non-JSON (${r.status}): ${text.slice(0, 200)}`) }

  if (!r.ok) {
    const errObj = parsed as { error?: string; details?: unknown; error_code?: string }
    const msg = errObj?.error ?? `${url} failed with ${r.status}`
    const err = new Error(msg) as Error & { status?: number; errorCode?: string; details?: unknown }
    err.status    = r.status
    err.errorCode = errObj?.error_code
    err.details   = errObj?.details
    throw err
  }

  return parsed as T
}
