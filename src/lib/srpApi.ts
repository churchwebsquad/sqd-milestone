/**
 * Tiny fetch wrapper for /api/srp/* endpoints.
 *
 * Every SRP endpoint accepts a JSON POST body and returns a JSON object.
 * The helper centralizes the boilerplate (Content-Type, error message
 * shape, JSON parse) so step components stay focused on UX.
 */

export interface SrpApiOptions {
  /** Optional AbortSignal so the caller can cancel in-flight requests
   *  on unmount or step change. */
  signal?: AbortSignal
}

export async function callSrpApi<T = unknown>(
  path: string,
  body: unknown,
  opts: SrpApiOptions = {},
): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api/srp/${path.replace(/^\/+/, '')}`
  let r: Response
  try {
    r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
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
