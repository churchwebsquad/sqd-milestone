/**
 * Vercel Serverless Function — /api/web/cowork/page-context-bundle
 *
 * Pre-packages every read the per-page cowork sessions (steps 8/9/10
 * — outline-page, draft-page, critique-page) need into one JSON file
 * the strategist downloads + attaches to Claude Desktop. The session
 * reads from the attached file in-context; MCP usage collapses to
 * per-page WRITES only.
 *
 * Why: even with v71's single-RPC consolidation per page, the cowork
 * session was running 3-5 MCP approvals per page (RPC fetch +
 * byte-size check + md5 + ::jsonb cast + write) — plus a wave of
 * ad-hoc SELECTs when the RPC's topic-based fact ref resolver
 * returned null. At 20+ min/page × 10 pages × 3 rounds, the
 * strategist was burning a full day on tool approvals.
 *
 *   GET /api/web/cowork/page-context-bundle?project_id=<uuid>
 *   → 200 application/json (Content-Disposition: attachment)
 *
 * Bundle shape:
 *   - sitemap_pages, stage_1, ministry_model, strategic_goals_approved,
 *     canonical_templates (slot specs only), prior_handoff_notes
 *   - allocations_by_page         — page_slug → CoworkPageAllocation
 *   - build_directives_by_page    — page-specific + 'site_wide' merged
 *   - atoms_pool / facts_pool     — { by_id, by_topic } for ref resolution
 *   - crawl_topics_pool.by_key    — topic_key → trimmed row (10 passages
 *                                    × 600 chars each, with `truncated`)
 *
 * The facts_pool.by_topic index fixes the live bug where allocation
 * plans emit topic-based fact refs (`service_times`, `kids`); the
 * cowork session can now resolve both forms in-context.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export const maxDuration = 30

const PASSAGES_PER_TOPIC_CAP = 10
const PASSAGE_CHAR_CAP       = 600

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'missing_env' })

  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null
  if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(projectId)) {
    return res.status(400).json({ error: 'project_id required (uuid)' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Parallel load. The bundle is read-only, so a fan-out is safe.
  const [projRes, atomsRes, factsRes, topicsRes, templatesRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, roadmap_state, member, notion_database_id, notion_database_url')
      .eq('id', projectId)
      .maybeSingle(),
    sb.from('content_atoms')
      .select('id, topic, body, status, source_kind, source_ref, verbatim, confidence')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
    sb.from('church_facts')
      .select('id, topic, data, status, source_kind, source_ref')
      .eq('web_project_id', projectId)
      .in('status', ['approved', 'draft']),
    sb.from('web_project_topics')
      .select('topic_key, topic_label, topic_group, coverage_status, passages, items')
      .eq('web_project_id', projectId),
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (projRes.error)      return res.status(500).json({ error: `project load failed: ${projRes.error.message}` })
  if (!projRes.data)      return res.status(404).json({ error: 'project not found' })
  if (atomsRes.error)     return res.status(500).json({ error: `atoms load failed: ${atomsRes.error.message}` })
  if (factsRes.error)     return res.status(500).json({ error: `facts load failed: ${factsRes.error.message}` })
  if (topicsRes.error)    return res.status(500).json({ error: `topics load failed: ${topicsRes.error.message}` })
  if (templatesRes.error) return res.status(500).json({ error: `templates load failed: ${templatesRes.error.message}` })

  // Partner row for the filename slug — keyed via the project's `member`.
  // Fetched after the main load (depends on projRes.data.member).
  const member = (projRes.data as any).member as number | null
  const partnerRes = member != null
    ? await sb.from('strategy_account_progress').select('church_name').eq('member', member).maybeSingle()
    : { data: null, error: null }

  // Notion-audit branch: when notion_database_id is set, fetch every
  // page in the database with its body rendered to markdown via the
  // strategy-notion edge function. The audit-external-copy skill
  // reads notion_pages_by_slug from the bundle in-context (no MCP
  // round-trips per page). Failure is tolerated — the bundle ships
  // without the Notion section and the skill falls back to standard
  // generation, surfacing the error in notion_load_error.
  const notionDbId = (projRes.data as any).notion_database_id as string | null
  const notionDbUrl = (projRes.data as any).notion_database_url as string | null
  let notionPagesBySlug: Record<string, unknown> | null = null
  let notionLoadError: string | null = null
  if (notionDbId) {
    try {
      const { data: notionRes, error: notionErr } = await sb.functions.invoke(
        'strategy-notion',
        { body: { op: 'list-database-pages-with-content', databaseId: notionDbId } },
      )
      if (notionErr) throw new Error(notionErr.message)
      const pages = (notionRes as { pages?: Array<Record<string, any>> })?.pages ?? []
      notionPagesBySlug = {}
      for (const p of pages) {
        if (typeof p.slug === 'string') notionPagesBySlug[p.slug] = p
      }
      // OVERRIDE sitemap_pages with the Notion DB pages when audit
      // branch is on. The Notion DB IS the IA — the partner already
      // decided what pages exist. nav_order is the Notion sort order
      // (we walk the DB in returned order; Notion's default sort is
      // by create time, which the strategist can reorder in Notion
      // and the bundle re-fetches on next download).
      sitemapPages = pages
        .filter(p => typeof p.slug === 'string' && p.slug)
        .map((p, i) => ({
          slug:            String(p.slug),
          name:            String(p.title ?? p.slug),
          nav_order:       i,                      // Notion order = nav order
          nav_strategy:    null,                   // not modeled in Notion side
          primary_persona: null,                   // ditto
        }))
    } catch (e) {
      notionLoadError = e instanceof Error ? e.message : 'Notion load failed'
    }
  }

  const state = (projRes.data.roadmap_state ?? {}) as Record<string, any>

  // ── Sitemap, stage_1, ministry_model, handoff notes, strategic goals
  // Default branch: sitemap comes from roadmap_state.site_strategy.pages
  // (the output of plan-site-strategy). For the audit branch we'll
  // OVERRIDE this further down — the Notion DB pages ARE the sitemap.
  let sitemapPages = Array.isArray(state.site_strategy?.pages)
    ? (state.site_strategy.pages as Array<Record<string, any>>).map(p => ({
        slug:            String(p.slug ?? ''),
        name:            String(p.name ?? ''),
        nav_order:       typeof p.nav_order === 'number' ? p.nav_order : null,
        nav_strategy:    p.nav_strategy ?? null,
        primary_persona: p.primary_audience ?? null,
      })).sort((a, b) =>
        (a.nav_order ?? 9999) - (b.nav_order ?? 9999) || a.slug.localeCompare(b.slug),
      )
    : []

  const strategicGoalsApproved: Record<string, Record<string, unknown>> = {}
  const sgRoot = state.strategic_goals
  if (sgRoot && typeof sgRoot === 'object') {
    for (const cat of [
      'goals_and_vision', 'voice_and_tone', 'content_and_allocation',
      'display_and_technical', 'inspiration_and_notes',
    ]) {
      const bucket = (sgRoot as any)[cat]
      if (!bucket || typeof bucket !== 'object') continue
      const approved: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(bucket)) {
        if (v && typeof v === 'object' && (v as any).status === 'approved') {
          approved[k] = v
        }
      }
      if (Object.keys(approved).length > 0) strategicGoalsApproved[cat] = approved
    }
  }

  // ── Canonical templates: slot specs only
  const tplManifest = (templatesRes.data?.manifest ?? {}) as Record<string, any>
  const tplSlotsOnly: Record<string, { cowork_writable_slots: unknown }> = {}
  if (tplManifest.page_section_templates && typeof tplManifest.page_section_templates === 'object') {
    for (const [key, val] of Object.entries(tplManifest.page_section_templates as Record<string, any>)) {
      tplSlotsOnly[key] = { cowork_writable_slots: val.cowork_writable_slots ?? null }
    }
  }

  // ── Allocations by page + build directives merged per page
  const allocationsByPage: Record<string, unknown> = {}
  const allocations = Array.isArray(state.page_allocation_plan?.allocations)
    ? state.page_allocation_plan.allocations as Array<Record<string, any>>
    : []
  for (const a of allocations) {
    const slug = a.page_slug ?? a.slug
    if (typeof slug === 'string') allocationsByPage[slug] = a
  }

  const buildDirectives = Array.isArray(state.page_allocation_plan?.build_directives)
    ? state.page_allocation_plan.build_directives as Array<Record<string, any>>
    : []
  const buildDirectivesByPage: Record<string, unknown[]> = {}
  for (const page of sitemapPages) {
    buildDirectivesByPage[page.slug] = buildDirectives.filter(d =>
      d.applies_to === page.slug || d.applies_to === 'site_wide',
    )
  }

  // ── Atoms pool (by_id + by_topic)
  const atoms = (atomsRes.data ?? []) as Array<Record<string, any>>
  const atomsById: Record<string, unknown> = {}
  const atomsByTopic: Record<string, string[]> = {}
  for (const row of atoms) {
    const id = String(row.id)
    atomsById[id] = row
    const topic = String(row.topic ?? '')
    if (topic) {
      (atomsByTopic[topic] ??= []).push(id)
    }
  }

  // ── Facts pool (by_id + by_topic — the bug fix)
  const facts = (factsRes.data ?? []) as Array<Record<string, any>>
  const factsById: Record<string, unknown> = {}
  const factsByTopic: Record<string, string[]> = {}
  for (const row of facts) {
    const id = String(row.id)
    factsById[id] = row
    const topic = String(row.topic ?? '')
    if (topic) {
      (factsByTopic[topic] ??= []).push(id)
    }
  }

  // ── Crawl topics pool — passages capped to keep the bundle compact
  const topics = (topicsRes.data ?? []) as Array<Record<string, any>>
  const crawlByKey: Record<string, unknown> = {}
  for (const t of topics) {
    const passages = Array.isArray(t.passages) ? t.passages as unknown[] : []
    const truncated = passages.length > PASSAGES_PER_TOPIC_CAP
    const capped = passages.slice(0, PASSAGES_PER_TOPIC_CAP).map(p => {
      if (typeof p === 'string') return p.slice(0, PASSAGE_CHAR_CAP)
      if (p && typeof p === 'object') {
        const rec = p as Record<string, unknown>
        const text = typeof rec.text === 'string' ? rec.text.slice(0, PASSAGE_CHAR_CAP) : rec.text
        return { ...rec, text }
      }
      return p
    })
    crawlByKey[String(t.topic_key)] = {
      topic_label:        t.topic_label ?? null,
      topic_group:        t.topic_group ?? null,
      coverage_status:    t.coverage_status ?? null,
      passages:           capped,
      passages_total:     passages.length,
      passages_truncated: truncated,
      items:              Array.isArray(t.items) ? t.items : [],
    }
  }

  // ── Handoff notes — three steps' worth so one bundle covers 8/9/10
  const priorHandoffNotes = {
    site_strategy:        state.site_strategy?._meta?.handoff_note ?? null,
    page_allocation_plan: state.page_allocation_plan?._meta?.handoff_note ?? null,
    page_outlines:        state.page_outlines?._meta?.handoff_note ?? null,
  }

  // ── Partner slug for the filename
  const churchName = (partnerRes.data as any)?.church_name as string | undefined
  const partnerSlug = churchName
    ? churchName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    : projectId.slice(0, 8)

  const bundle = {
    project_id:    projectId,
    generated_at:  new Date().toISOString(),
    generated_for: 'all' as const,

    // Notion-audit branch metadata — present only when the project
    // has notion_database_id set. When `notion_pages_by_slug` is
    // populated, the cowork pipeline takes the audit-external-copy
    // path; the skill matches sitemap pages to Notion pages by slug
    // and scores existing copy against the 5 axes + canonical
    // template slot vocab. Pages with no Notion match auto-route
    // to supplemental-page-authoring.
    notion_audit_branch: notionDbId
      ? {
          database_id:        notionDbId,
          database_url:       notionDbUrl,
          pages_by_slug:      notionPagesBySlug,
          load_error:         notionLoadError,
        }
      : null,

    sitemap_pages:            sitemapPages,
    stage_1:                  state.stage_1 ?? null,
    ministry_model:           state.ministry_model ?? null,
    strategic_goals_approved: strategicGoalsApproved,
    canonical_templates: {
      version:                 templatesRes.data?.version ?? null,
      page_section_templates:  tplSlotsOnly,
    },
    prior_handoff_notes:      priorHandoffNotes,

    allocations_by_page:      allocationsByPage,
    build_directives_by_page: buildDirectivesByPage,

    atoms_pool: {
      by_id:    atomsById,
      by_topic: atomsByTopic,
    },
    facts_pool: {
      by_id:    factsById,
      by_topic: factsByTopic,
    },
    crawl_topics_pool: {
      by_key: crawlByKey,
    },
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="cowork-pipeline.${partnerSlug}.project-bundle.json"`,
  )
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).send(JSON.stringify(bundle, null, 2))
}
