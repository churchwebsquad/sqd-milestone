/**
 * Web Manager — client-side helpers for the AI agent pipeline.
 *
 * Each function POSTs to a Vercel API route, with the user's
 * Supabase access token in the Authorization header. The server
 * validates the JWT, then talks to Anthropic with the project-scoped
 * service role for DB reads/writes.
 */

import { supabase } from './supabase'

export interface ExtractStrategyResult {
  ok: true
  extraction: Record<string, unknown>
  usage?: { input_tokens?: number; output_tokens?: number }
  files_loaded: Array<{ category: string; filename: string }>
}

export interface ExtractStrategyError {
  error: string
  missing_sources?: string[]
  files_failed?: Array<{ category: string; filename: string; mime_type: string | null; error: string }>
  files_loaded_ok?: number
}

/**
 * Stage 1 — Strategy Extraction.
 *
 * Reads intake (DB rows + uploaded files) and synthesizes the
 * strategic foundation via Claude. On success the project's
 * roadmap_stage flips to 'strategy_done' and roadmap_state.stage_1
 * is populated. On error returns a structured error including which
 * files failed pre-flight or which sources are missing.
 *
 * `redoContext` is an optional free-text string — when the strategist
 * presses "Redo with changes", they describe what should differ.
 */
export async function extractStrategy(
  projectId: string,
  redoContext?: string,
): Promise<{ result?: ExtractStrategyResult; error?: ExtractStrategyError }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { error: { error: 'Not signed in.' } }

  const res = await fetch('/api/web/agents/extract-strategy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ projectId, redoContext: redoContext ?? '' }),
  })

  const contentType = res.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  if (!res.ok) {
    let body: ExtractStrategyError
    if (isJson) {
      try { body = await res.json() }
      catch { body = { error: `HTTP ${res.status}` } }
    } else {
      body = { error: `HTTP ${res.status} — endpoint returned ${contentType || 'no content-type'} (likely the SPA fallback; /api/* routes require \`vercel dev\` locally).` }
    }
    return { error: body }
  }

  if (!isJson) {
    return { error: { error: `Endpoint returned ${contentType || 'no content-type'} instead of JSON. If running locally, /api/* routes require \`vercel dev\` — plain \`vite\` won't serve them.` } }
  }

  const result = await res.json() as ExtractStrategyResult
  return { result }
}
