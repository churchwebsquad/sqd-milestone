/**
 * Snippets importer — bulk-loads the project's global merge fields
 * AND its custom snippets from a single JSON payload.
 *
 * Wipe-on-import semantics: every existing non-archived custom
 * snippet on the project is archived before the import inserts its
 * own rows. Globals are upserted column-by-column. The modal warns
 * the user before commit so they understand the JSON IS the new
 * state.
 *
 * JSON shape:
 *   {
 *     "globals": {
 *       "church_name": "Riverwood Chapel",
 *       "phone": "(330) 555-0101",
 *       ...
 *       "social_tiktok_url": null
 *     },
 *     "snippets": [
 *       { "token": "...", "label": "...", "expansion": "...",
 *         "description": "...", "tags": ["..."] }
 *     ]
 *   }
 *
 * Both top-level keys are optional individually; the importer no-ops
 * any side that's missing or empty.
 */

import { supabase } from './supabase'
import type { StrategyWebProject, WebProjectSnippet } from '../types/database'

// ── Format ──────────────────────────────────────────────────────────

/** The 16 global merge-field columns importable from `globals`. Each
 *  is a plain text column on strategy_web_projects. */
export const IMPORTABLE_GLOBAL_KEYS = [
  'church_name', 'church_short_name', 'address', 'city_state',
  'phone', 'email', 'denomination', 'pastor_name',
  // primary_service_time intentionally dropped — service times live
  // exclusively on all_service_times now.
  'all_service_times',
  'social_facebook_url', 'social_instagram_url', 'social_youtube_url',
  'social_tiktok_url', 'social_twitter_url', 'social_linkedin_url',
] as const

export type ImportableGlobalKey = typeof IMPORTABLE_GLOBAL_KEYS[number]

export interface SnippetImportEntry {
  token:        string
  label?:       string
  expansion:    string
  description?: string
  tags?:        string[]
  /** Defaults to 'manual'. */
  source?:      WebProjectSnippet['source']
}

export interface SnippetsImportPayload {
  globals?:  Partial<Record<ImportableGlobalKey, string | null>>
  snippets?: SnippetImportEntry[]
}

// ── Detection ───────────────────────────────────────────────────────

/** True when the parsed JSON looks like a snippets import. Either
 *  side may be missing, but at least ONE must be present + shaped
 *  correctly. */
export function isSnippetsImportPayload(parsed: unknown): parsed is SnippetsImportPayload {
  if (!parsed || typeof parsed !== 'object') return false
  const obj = parsed as Record<string, unknown>
  const hasGlobals  = obj.globals  != null && typeof obj.globals  === 'object'
  const hasSnippets = Array.isArray(obj.snippets)
  return hasGlobals || hasSnippets
}

// ── Validation ──────────────────────────────────────────────────────

export interface SnippetsImportIssue {
  severity: 'error' | 'warning' | 'info'
  scope:    string
  message:  string
}

export interface SnippetsImportPlan {
  valid:                  boolean
  issues:                 SnippetsImportIssue[]
  globalsToUpdate:        Array<{ key: ImportableGlobalKey; from: string; to: string | null }>
  snippetsToInsert:       SnippetImportEntry[]
  /** Existing custom snippets that would be archived (token + label). */
  snippetsToWipe:         Array<{ id: string; token: string; label: string }>
  /** Unique tokens after normalization. Surfaced when the import
   *  contains duplicate tokens within itself. */
  duplicateTokensInInput: string[]
}

const TOKEN_RE = /^[a-z][a-z0-9_]*$/

function normalizeToken(t: string): string {
  return t.toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

export async function validateSnippetsImport(
  payload: SnippetsImportPayload,
  project: StrategyWebProject,
): Promise<SnippetsImportPlan> {
  const issues: SnippetsImportIssue[] = []

  // ── Globals ──────────────────────────────────────
  const globalsToUpdate: SnippetsImportPlan['globalsToUpdate'] = []
  if (payload.globals && typeof payload.globals === 'object') {
    for (const [k, v] of Object.entries(payload.globals)) {
      if (!(IMPORTABLE_GLOBAL_KEYS as readonly string[]).includes(k)) {
        issues.push({
          severity: 'warning',
          scope:    `globals.${k}`,
          message:  `"${k}" is not a global merge field — ignored. Allowed: ${IMPORTABLE_GLOBAL_KEYS.join(', ')}.`,
        })
        continue
      }
      const key = k as ImportableGlobalKey
      const fromRaw = (project as Record<string, unknown>)[key]
      const from = typeof fromRaw === 'string' ? fromRaw : ''
      const to   = v == null ? null : String(v)
      // Skip rows that wouldn't change anything.
      const same = (from || '') === (to || '')
      if (!same) globalsToUpdate.push({ key, from, to })
    }
  }

  // ── Snippets ─────────────────────────────────────
  const snippetsToInsert: SnippetImportEntry[] = []
  const seenTokens = new Set<string>()
  const duplicateTokensInInput = new Set<string>()
  for (const [i, raw] of (payload.snippets ?? []).entries()) {
    if (!raw || typeof raw !== 'object') {
      issues.push({ severity: 'error', scope: `snippets[${i}]`, message: 'Each snippet must be an object.' })
      continue
    }
    if (typeof raw.token !== 'string' || !raw.token.trim()) {
      issues.push({ severity: 'error', scope: `snippets[${i}]`, message: 'Missing required "token".' })
      continue
    }
    if (typeof raw.expansion !== 'string') {
      issues.push({ severity: 'error', scope: `snippets[${i}].token=${raw.token}`, message: 'Missing required "expansion".' })
      continue
    }
    const token = normalizeToken(raw.token)
    if (!TOKEN_RE.test(token)) {
      issues.push({
        severity: 'error',
        scope:    `snippets[${i}].token=${raw.token}`,
        message:  'Token must start with a letter and contain only lowercase letters, numbers, and underscores.',
      })
      continue
    }
    if (token !== raw.token) {
      issues.push({
        severity: 'info',
        scope:    `snippets[${i}].token`,
        message:  `"${raw.token}" normalized to "${token}".`,
      })
    }
    if (seenTokens.has(token)) {
      duplicateTokensInInput.add(token)
      issues.push({
        severity: 'error',
        scope:    `snippets[${i}].token=${token}`,
        message:  `Duplicate token "${token}" appears more than once in the import.`,
      })
      continue
    }
    seenTokens.add(token)
    snippetsToInsert.push({
      token,
      label:       (typeof raw.label === 'string' && raw.label.trim()) ? raw.label.trim() : token,
      expansion:   raw.expansion,
      description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined,
      tags:        Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string') : undefined,
      source:      raw.source && ['manual', 'ai_suggested', 'extracted_from_intake'].includes(raw.source)
                     ? raw.source
                     : 'manual',
    })
  }

  // ── Wipe set ────────────────────────────────────
  const { data: existingRows, error: exErr } = await supabase
    .from('web_project_snippets')
    .select('id, token, label')
    .eq('web_project_id', project.id)
    .eq('archived', false)
  if (exErr) {
    issues.push({ severity: 'error', scope: 'existing-snippets', message: `Couldn't read existing snippets: ${exErr.message}` })
  }
  const snippetsToWipe = ((existingRows ?? []) as Array<{ id: string; token: string; label: string }>)

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    globalsToUpdate,
    snippetsToInsert,
    snippetsToWipe,
    duplicateTokensInInput: Array.from(duplicateTokensInInput),
  }
}

// ── Import ──────────────────────────────────────────────────────────

export interface SnippetsImportResult {
  globalsUpdated:   number
  snippetsArchived: number
  snippetsInserted: number
}

export async function importSnippets(
  payload: SnippetsImportPayload,
  project: StrategyWebProject,
): Promise<{ result?: SnippetsImportResult; error?: string }> {
  // Re-validate at write time to keep the import idempotent. (The
  // wipe set in particular may have changed since the modal previewed.)
  const plan = await validateSnippetsImport(payload, project)
  if (!plan.valid) {
    return { error: `${plan.issues.filter(i => i.severity === 'error').length} validation error(s); please re-validate.` }
  }

  // ── Globals ──────────────────────────────────────
  let globalsUpdated = 0
  if (plan.globalsToUpdate.length > 0) {
    const patch: Record<string, string | null> = {}
    for (const g of plan.globalsToUpdate) patch[g.key] = g.to
    const { error: upErr } = await supabase
      .from('strategy_web_projects')
      .update(patch)
      .eq('id', project.id)
    if (upErr) return { error: `globals update failed: ${upErr.message}` }
    globalsUpdated = plan.globalsToUpdate.length
  }

  // ── Wipe existing custom snippets ────────────────
  let snippetsArchived = 0
  if (plan.snippetsToWipe.length > 0) {
    const ids = plan.snippetsToWipe.map(s => s.id)
    const { error: wipeErr } = await supabase
      .from('web_project_snippets')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .in('id', ids)
    if (wipeErr) return { error: `archive existing failed: ${wipeErr.message}` }
    snippetsArchived = ids.length
  }

  // ── Insert new ──────────────────────────────────
  let snippetsInserted = 0
  if (plan.snippetsToInsert.length > 0) {
    const rows = plan.snippetsToInsert.map(s => ({
      web_project_id: project.id,
      token:          s.token,
      label:          s.label ?? s.token,
      expansion:      s.expansion,
      description:    s.description ?? null,
      tags:           s.tags ?? [],
      source:         s.source ?? 'manual',
      archived:       false,
    }))
    const { error: insErr, data: inserted } = await supabase
      .from('web_project_snippets')
      .insert(rows as never)
      .select('id')
    if (insErr) return { error: `snippet insert failed: ${insErr.message}` }
    snippetsInserted = ((inserted ?? []) as Array<{ id: string }>).length
  }

  return {
    result: { globalsUpdated, snippetsArchived, snippetsInserted },
  }
}
