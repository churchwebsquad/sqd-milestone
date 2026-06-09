/**
 * Vercel Serverless Function — /api/web/agents/import-state
 *
 * Inverse of /api/web/agents/export-state. Parses a markdown-formatted
 * export document (or a partial one), validates each JSON block, and
 * applies changes to the project's roadmap_state.
 *
 * Parsing strategy: deliberately tolerant. The strategist (or an AI
 * conversation refining the doc) may have:
 *   - Reformatted prose around the JSON blocks
 *   - Skipped sections they didn't change
 *   - Added comments
 *
 * The parser anchors on the three section headers (## Sitemap, ## Page
 * Briefs, ## Page Drafts) and extracts the FIRST ```json ... ```
 * block under each one. Missing sections are treated as "no change."
 *
 * Validation:
 *   - Format version must be srp-engine-export-v* (allows future v2)
 *   - Project ID must match the target projectId (prevents accidental
 *     cross-project pastes)
 *   - JSON blocks must be parseable
 *   - Page slugs across sitemap / briefs / drafts must be consistent
 *     (warning only — don't reject, since legacy drafts may have stale
 *     slugs and the strategist can clean them up)
 *
 * Auto-side-effects:
 *   - If sitemap changed: clear stage_2._meta.status (forces re-approval)
 *     and queue a coverage audit re-run.
 *   - If drafts changed: bump the engine_state to signal critique stale.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const SUPPORTED_FORMATS = new Set(['srp-engine-export-v1'])

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const document  = typeof req.body?.document  === 'string' ? req.body.document  : null
  if (!projectId) return res.status(400).json({ error: 'projectId required' })
  if (!document)  return res.status(400).json({ error: 'document required (paste the export markdown)' })

  // ── Validate header metadata ───────────────────────────────────────
  const metadata = parseMetadata(document)
  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    return res.status(400).json({
      error: `Unsupported format. Document declared "${metadata.format ?? '(none)'}", expected one of: ${[...SUPPORTED_FORMATS].join(', ')}.`,
      hint:  'Make sure you pasted the full document including the "**Format**: …" line in the metadata header.',
    })
  }
  if (metadata.projectId && metadata.projectId !== projectId) {
    return res.status(400).json({
      error: `Project ID mismatch. Document is for project ${metadata.projectId} but you're importing into ${projectId}.`,
      hint:  'Make sure you exported from the same project you\'re importing into.',
    })
  }

  // ── Parse JSON sections (tolerant) ─────────────────────────────────
  const parsed = parseSections(document)
  const errors: string[] = []
  let sitemapData: any | null = null
  let briefsData: any | null = null
  let draftsData: any | null = null

  if (parsed.sitemap) {
    try { sitemapData = JSON.parse(parsed.sitemap) }
    catch (e: any) { errors.push(`Sitemap JSON is invalid: ${e?.message ?? 'parse error'}`) }
  }
  if (parsed.briefs) {
    try { briefsData = JSON.parse(parsed.briefs) }
    catch (e: any) { errors.push(`Page Briefs JSON is invalid: ${e?.message ?? 'parse error'}`) }
  }
  if (parsed.drafts) {
    try { draftsData = JSON.parse(parsed.drafts) }
    catch (e: any) { errors.push(`Page Drafts JSON is invalid: ${e?.message ?? 'parse error'}`) }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Import failed — one or more JSON blocks could not be parsed.',
      details: errors,
      hint:    'Open the document in a JSON-aware editor and check for missing commas / unclosed braces / smart quotes.',
    })
  }

  if (!sitemapData && !briefsData && !draftsData) {
    return res.status(400).json({
      error: 'No editable sections found in the document.',
      hint:  'The importer looks for ```json blocks under "## Sitemap", "## Page Briefs", and "## Page Drafts" headers. None were found.',
    })
  }

  // ── Slug consistency check (warnings only) ─────────────────────────
  const warnings: string[] = []
  if (sitemapData && briefsData) {
    const sitemapSlugs = new Set<string>(
      (Array.isArray(sitemapData?.pages) ? sitemapData.pages : [])
        .map((p: any) => String(p?.slug ?? '')).filter(Boolean)
    )
    const briefSlugs = new Set<string>(Object.keys(briefsData))
    for (const s of briefSlugs) {
      if (!sitemapSlugs.has(s)) {
        warnings.push(`Brief slug "${s}" not found in sitemap pages — orphaned brief.`)
      }
    }
  }
  if (briefsData && draftsData) {
    const briefSlugs = new Set<string>(Object.keys(briefsData))
    for (const s of Object.keys(draftsData)) {
      if (!briefSlugs.has(s)) {
        warnings.push(`Draft slug "${s}" not found in page briefs — orphaned draft.`)
      }
    }
  }

  // ── Apply changes ──────────────────────────────────────────────────
  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, roadmap_state').eq('id', projectId).maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const currentState = (project.roadmap_state ?? {}) as Record<string, any>
  const nowIso = new Date().toISOString()
  const nextState: Record<string, any> = { ...currentState }
  const changes: { sitemap: boolean; briefs: string[]; drafts: string[] } = {
    sitemap: false, briefs: [], drafts: [],
  }

  if (sitemapData) {
    nextState.stage_2 = {
      ...sitemapData,
      _meta: {
        ...((currentState.stage_2 ?? {})._meta ?? {}),
        // Imported sitemaps land as drafts — require re-approval.
        status: 'draft',
        generated_at: nowIso,
        last_import_at: nowIso,
        last_import_by: userData.user.email ?? userData.user.id,
      },
    }
    // Invalidate the coverage audit since the sitemap changed.
    if (nextState.stage_2_5) {
      delete nextState.stage_2_5
    }
    changes.sitemap = true
  }

  if (briefsData) {
    const existingBriefsMeta = (currentState.page_briefs ?? {})._meta ?? {}
    nextState.page_briefs = {
      ...briefsData,
      _meta: {
        ...existingBriefsMeta,
        generated_at: nowIso,
        last_import_at: nowIso,
        last_import_by: userData.user.email ?? userData.user.id,
      },
    }
    changes.briefs = Object.keys(briefsData)
  }

  if (draftsData) {
    nextState.page_drafts = {
      ...draftsData,
      _meta: {
        ...((currentState.page_drafts ?? {})._meta ?? {}),
        last_import_at: nowIso,
        last_import_by: userData.user.email ?? userData.user.id,
      },
    }
    changes.drafts = Object.keys(draftsData)
    // Mark the director critique as stale — drafts changed.
    if (nextState.director_critique) {
      nextState.director_critique = {
        ...nextState.director_critique,
        _meta: {
          ...((nextState.director_critique._meta ?? {})),
          stale_reason: 'imported_drafts',
        },
      }
    }
  }

  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: nextState })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    format_version: metadata.format,
    changes,
    warnings,
    next_steps: deriveNextSteps(changes),
  })
}

// ── Document parser ────────────────────────────────────────────────────

interface ParsedMetadata {
  format:     string | null
  projectId:  string | null
}

function parseMetadata(document: string): ParsedMetadata {
  // Look for lines like "- **Format**: srp-engine-export-v1" and
  // "- **Project ID**: `<uuid>`" in the first ~1500 chars.
  const head = document.slice(0, 2000)
  const formatMatch = head.match(/[*_]{1,2}Format[*_]{1,2}\s*:?\s*`?([A-Za-z0-9._-]+)`?/i)
  const projectIdMatch = head.match(/[*_]{1,2}Project ID[*_]{1,2}\s*:?\s*`?([A-Fa-f0-9-]{20,})`?/i)
  return {
    format:    formatMatch?.[1]    ?? null,
    projectId: projectIdMatch?.[1] ?? null,
  }
}

interface ParsedSections {
  sitemap: string | null
  briefs:  string | null
  drafts:  string | null
}

function parseSections(document: string): ParsedSections {
  // Locate the three section headers (case-insensitive). For each, find
  // the first ```json fenced block AFTER the header and BEFORE the next
  // ## header. Tolerant of additional prose around the blocks.
  return {
    sitemap: extractJsonBlockUnderHeader(document, /^##\s*Sitemap\b/im),
    briefs:  extractJsonBlockUnderHeader(document, /^##\s*Page Briefs\b/im),
    drafts:  extractJsonBlockUnderHeader(document, /^##\s*Page Drafts\b/im),
  }
}

function extractJsonBlockUnderHeader(document: string, headerRe: RegExp): string | null {
  const headerMatch = headerRe.exec(document)
  if (!headerMatch) return null
  const startIx = headerMatch.index + headerMatch[0].length
  // Find the next ## header (or end of doc) — search window ends there
  const remainder = document.slice(startIx)
  const nextHeader = /^##\s+/m.exec(remainder)
  const windowEnd = nextHeader ? nextHeader.index : remainder.length
  const sectionText = remainder.slice(0, windowEnd)
  // Extract first ```json block
  const blockMatch = /```json\s*\n([\s\S]*?)\n```/m.exec(sectionText)
  if (!blockMatch) return null
  return blockMatch[1]
}

function deriveNextSteps(changes: { sitemap: boolean; briefs: string[]; drafts: string[] }): string[] {
  const out: string[] = []
  if (changes.sitemap) {
    out.push('Sitemap re-approval required — Gate 1 will show as "draft".')
    out.push('Coverage audit was invalidated; it will auto-run on the next Gate 1 open.')
  }
  if (changes.briefs.length > 0) {
    out.push(`${changes.briefs.length} page brief${changes.briefs.length === 1 ? '' : 's'} updated — drafts referencing them are still valid but you may want to re-run Run drafts to regenerate copy from the new briefs.`)
  }
  if (changes.drafts.length > 0) {
    out.push(`${changes.drafts.length} page draft${changes.drafts.length === 1 ? '' : 's'} updated — Director critique flagged as stale; re-run Critique before Commit.`)
  }
  return out
}
