/**
 * Vercel Serverless Function — /api/web/agents/orchestrate
 *
 * The Director-driven orchestrator. Single endpoint, multiple actions:
 *
 *   action=run_drafts   — page_briefs (if missing) + page_drafts (parallel)
 *   action=critique     — director critique on current drafts
 *   action=iterate      — apply directives from latest critique:
 *                         re-run flagged page_drafts, then re-critique.
 *                         Loops up to maxLoops times or until directives
 *                         empty or verdict=approved.
 *   action=route        — director route on user feedback; returns dispatch
 *   action=apply        — execute a dispatch (re-run the named stage)
 *   action=commit       — page-bind every page_draft to web_pages + web_sections
 *   action=status       — return engine_state without mutating
 *
 * Engine state lives in roadmap_state.engine_state. Each action updates
 * status + phase + last_action_at + counters. The UI polls /status or
 * triggers actions directly.
 *
 * Calls child agents over HTTP using the same VERCEL_URL the request
 * arrived on. Auth: passes the strategist's JWT through to children.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const MAX_LOOPS = 3
const PAGE_DRAFT_CONCURRENCY = 4
/** Audit → fix → audit cap. After this many fix attempts, the loop
 *  halts even if gaps remain — the strategist resolves the residual
 *  via manual Revise feedback or by approving with known gaps. */
const SITEMAP_AUDIT_MAX_LOOPS = 2

type Action =
  | 'run_drafts' | 'run_briefs' | 'draft_one_page' | 'critique' | 'iterate'
  | 'route' | 'apply' | 'commit' | 'status'
  | 'approve_sitemap' | 'unlock_sitemap' | 'revise_sitemap' | 'run_coverage_audit'
  | 'export_state' | 'import_state' | 'draft_sitemap_with_audit'
  | 'reset_engine_state' | 'run_synthesize' | 'apply_audit_to_nav'
  | 'rename_sitemap_page' | 'cancel_run' | 'restructure_sections'
  | 'suggest_bind_for_page' | 'override_bind_template'
  | 'reorg_section_for_template' | 'list_compatible_templates' | 'run_normalize'
  // New cascade actions (content-collection-first refactor):
  | 'run_acf_organizer' | 'run_ministry_model' | 'run_strategist'
  | 'run_page_outline_for_page' | 'draft_page_until_resolved'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const action: Action = (req.body?.action as Action) ?? 'status'
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const baseUrl = resolveBaseUrl(req)

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const engineState = (roadmapState.engine_state ?? {}) as Record<string, any>

  try {
    if (action === 'status') {
      return res.status(200).json({ ok: true, engine_state: engineState })
    }

    if (action === 'restructure_sections') {
      // One action covers two related operations the strategist runs
      // on a page draft:
      //   mode='swap'        — change ONE section's archetype, re-derive
      //                        its copy to fit the new slot shape.
      //   mode='consolidate' — merge N sections into a single new
      //                        section of the target archetype (e.g.
      //                        3 image_text_split → 1 cards_grid).
      // Both are implemented as a page-draft re-run with a carefully
      // worded feedback note that pins WHICH sections to change and
      // explicitly tells the writer to preserve everything else.
      // The page-draft agent already supports this via its `feedback`
      // param + "previous draft to refine" handling.
      const pageSlug = typeof req.body?.pageSlug === 'string' ? req.body.pageSlug : null
      const targetArchetype = typeof req.body?.targetArchetype === 'string' ? req.body.targetArchetype.trim() : ''
      const mode = req.body?.mode === 'consolidate' ? 'consolidate' : 'swap'
      const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
      const rawIxs = Array.isArray(req.body?.sectionIxs) ? req.body.sectionIxs : []
      const sectionIxs = rawIxs.filter((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0) as number[]
      if (!pageSlug || sectionIxs.length === 0 || !targetArchetype) {
        return res.status(400).json({ error: 'pageSlug, sectionIxs (non-empty array of integers), and targetArchetype required' })
      }
      if (mode === 'consolidate' && sectionIxs.length < 2) {
        return res.status(400).json({ error: 'consolidate mode requires at least 2 sections to merge' })
      }
      const ixList = [...new Set(sectionIxs)].sort((a, b) => a - b).join(', ')
      const note = mode === 'consolidate'
        ? `CONSOLIDATE — combine sections [${ixList}] (zero-indexed in the current draft) into ONE new section using archetype "${targetArchetype}". Merge their content + atoms_used into the new section's slot shape. PRESERVE all OTHER sections byte-for-byte; only sections ${ixList} should be removed and replaced with the single merged result.${instruction ? ` Strategist note: ${instruction}` : ''}`
        : `SWAP ARCHETYPE — change section ${ixList} (zero-indexed in the current draft) to archetype "${targetArchetype}". Re-derive the copy to fit the new archetype's slot shape while preserving the section's content intent (same heading topic, same atoms_used where compatible). PRESERVE all OTHER sections byte-for-byte; only section ${ixList} should change.${instruction ? ` Strategist note: ${instruction}` : ''}`
      const result = await callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug, feedback: note })
      return res.status(200).json({ ok: true, mode, target_archetype: targetArchetype, section_ixs: sectionIxs, result })
    }

    if (action === 'run_synthesize') {
      // Stage 1 — strategy synthesis from intake. Either a fresh draft
      // (no redoContext) or a redo driven by strategist feedback.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await callAgent(baseUrl, jwt, 'extract-strategy',
        note ? { projectId, redoContext: note } : { projectId })
      return res.status(200).json({ ok: true, stage_1: result })
    }

    if (action === 'run_normalize') {
      // Stage 0 — atomize intake into content_atoms + church_facts.
      // Same orchestrate-wrapper pattern as run_synthesize so the
      // Copy Engine workspace can trigger Stage 0 re-runs without
      // sending the user to the Pipeline tab. Redo notes pass through
      // to the agent's strategist-redo path.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await callAgent(baseUrl, jwt, 'normalize-intake',
        note ? { projectId, redoContext: note } : { projectId })
      return res.status(200).json({ ok: true, stage_0: result })
    }

    if (action === 'run_acf_organizer') {
      // Refactor wave — runs after extract-strategy, before sitemap.
      // Decides which CPT modules the partner needs + pre-populates
      // partner-supplied records. Output conforms to dev-side
      // INTAKE.schema.json. Writes roadmap_state.acf_plan.
      const result = await callAgent(baseUrl, jwt, 'acf-content-organizer', { projectId })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'run_ministry_model') {
      // Refactor wave — runs after extract-strategy. Classifies the
      // church into attractional / discipleship / missional. Strategist
      // override survives auto re-runs. Writes roadmap_state.ministry_model.
      const result = await callAgent(baseUrl, jwt, 'determine-ministry-model', { projectId })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'run_strategist') {
      // Refactor wave — runs after ministry_model + acf_plan, BEFORE
      // sitemap drafting. Builds the strategic scaffolding the sitemap
      // pivots on (siteflow, persona journeys, key info to highlight,
      // page elevations). Writes roadmap_state.site_strategy.
      const result = await callAgent(baseUrl, jwt, 'strategist', { projectId })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'run_page_outline_for_page') {
      // Refactor wave — per page. Builds the section-by-section
      // blueprint that page-draft reads. Replaces page-briefs in the
      // new cascade. Writes roadmap_state.page_outlines[<slug>].
      const pageSlug = typeof req.body?.pageSlug === 'string' ? req.body.pageSlug : null
      if (!pageSlug) return res.status(400).json({ error: 'pageSlug required for run_page_outline_for_page' })
      const result = await callAgent(baseUrl, jwt, 'page-outlines', { projectId, pageSlug })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'draft_page_until_resolved') {
      // Refactor wave — drafts ONE page, then auto-retries any
      // sections that came back with issues (truncation, atom-
      // resolution failure, validation flags, fabricated atom IDs).
      // Caps at 3 attempts before surfacing to user. No half-done
      // pages reach Gate 2.
      const pageSlug = typeof req.body?.pageSlug === 'string' ? req.body.pageSlug : null
      if (!pageSlug) return res.status(400).json({ error: 'pageSlug required for draft_page_until_resolved' })
      const result = await draftPageUntilResolved({ sb, baseUrl, jwt, projectId, pageSlug })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'apply_audit_to_nav') {
      // Targeted additive sitemap surgery — apply the current audit's
      // findings as add_page / add_header_entry / add_footer_entry
      // edits. Does NOT redraft existing pages, labels, or structure.
      const result = await callAgent(baseUrl, jwt, 'apply-audit-to-nav', { projectId })
      // Re-run coverage so the strategist sees the updated audit immediately.
      try { await callAgent(baseUrl, jwt, 'sitemap-coverage', { projectId }) }
      catch (e: any) { console.error('[apply_audit_to_nav] post-edit coverage failed (non-fatal):', e?.message) }
      return res.status(200).json({ ok: true, audit_apply: result })
    }

    if (action === 'rename_sitemap_page') {
      // Deterministic rename — no LLM call. Updates page.name +
      // optional nav_label + optional slug across pages[] and the
      // nav trees. Skipped: footer_nav (uses labels not bound to
      // page slugs, edit-via-Revise instead).
      const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim() : ''
      const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : null
      const newNavLabel = typeof req.body?.newNavLabel === 'string' ? req.body.newNavLabel.trim() : null
      const newSlug = typeof req.body?.newSlug === 'string' ? req.body.newSlug.trim() : null
      if (!slug) return res.status(400).json({ error: 'slug required' })
      if (newName == null && newNavLabel == null && newSlug == null) {
        return res.status(400).json({ error: 'At least one of newName, newNavLabel, newSlug required' })
      }
      const stage2 = roadmapState.stage_2 as Record<string, any> | undefined
      if (!stage2) return res.status(400).json({ error: 'No sitemap (stage_2) to edit.' })
      const result = renameSitemapPage(stage2, { slug, newName, newNavLabel, newSlug })
      if (!result.found) return res.status(404).json({ error: `Page with slug "${slug}" not found.` })

      const nowIso = new Date().toISOString()
      const prevMeta = (stage2._meta ?? {}) as Record<string, any>
      result.sitemap._meta = {
        ...prevMeta,
        // Inline label edits keep the sitemap APPROVED if it was approved —
        // these are cosmetic / non-structural. Slug changes invalidate
        // approval because downstream stages key off slugs.
        status: newSlug ? 'draft' : (prevMeta.status ?? 'draft'),
        last_inline_edit_at: nowIso,
        last_inline_edit_by: userData.user.email ?? userData.user.id,
      }
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, stage_2: result.sitemap },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, page: result.updatedPage, nav_updates: result.navUpdates })
    }

    if (action === 'cancel_run') {
      // Cooperative cancellation. Two effects, written in one update:
      //   1. cancel_requested = true — observed by in-flight long
      //      helpers (draftSitemapWithAuditLoop, runDrafts, runIterate,
      //      runCommit) at their next sub-step boundary; the helper
      //      throws CancelledError and writes the canonical cancelled
      //      state on its way out.
      //   2. status = 'cancelled' (and cancelled_at) — written
      //      immediately so the workspace's auto-cascade useEffects
      //      stop re-firing right away, even if no long helper is
      //      currently running (e.g. user clicked Stop during a
      //      single-agent call like run_synthesize that can't be
      //      cancelled mid-call but whose downstream cascade should
      //      still be blocked).
      const now = new Date().toISOString()
      await sb.from('strategy_web_projects').update({
        roadmap_state: {
          ...roadmapState,
          engine_state: {
            ...engineState,
            cancel_requested:     true,
            cancel_requested_at:  now,
            status:               'cancelled',
            cancelled_at:         now,
            last_action_at:       now,
          },
        },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, cancel_requested: true })
    }

    if (action === 'reset_engine_state') {
      // Recovery action — clears engine_state so the strategist can
      // restart a stuck workflow without losing their sitemap, briefs,
      // or drafts. Used by the workspace when the engine has been in
      // an in-progress status (briefing/drafting/etc.) past the point
      // a real run would have finished, indicating the agent call
      // crashed mid-flight.
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, engine_state: {} },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, engine_state: {} })
    }

    if (action === 'revise_sitemap') {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      if (!note) return res.status(400).json({ error: 'note (feedback) required for revise_sitemap' })
      const result = await draftSitemapWithAuditLoop({ sb, baseUrl, jwt, projectId, initialContext: note })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'draft_sitemap_with_audit') {
      // Explicit invocation of the audit-loop sub-step. Same as the
      // path the apply(stage='sitemap') + revise_sitemap actions take
      // under the hood; exposed as a top-level action for clients that
      // want to trigger the loop without going through dispatch / route.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await draftSitemapWithAuditLoop({ sb, baseUrl, jwt, projectId, initialContext: note || undefined })
      return res.status(200).json({ ok: true, ...result })
    }

    if (action === 'export_state') {
      // scope: 'full' (everything) | 'sitemap' (sitemap+audit only) |
      // 'copy' (drafts+briefs+audit+voice+snippets, no sitemap).
      const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'full'
      const result = await callAgent(baseUrl, jwt, 'export-state', { projectId, scope })
      return res.status(200).json({ ok: true, export: result })
    }

    if (action === 'import_state') {
      const document = typeof req.body?.document === 'string' ? req.body.document : ''
      if (!document) return res.status(400).json({ error: 'document required for import_state' })
      const result = await callAgent(baseUrl, jwt, 'import-state', { projectId, document })
      return res.status(200).json({ ok: true, import: result })
    }

    if (action === 'run_coverage_audit') {
      // Stage 2.5 — checks every Stage 0 topic against the Stage 2
      // sitemap. Strategist sees results at Gate 1 BEFORE approving
      // the sitemap. Auto-triggered by the client after sitemap revise
      // + on workspace mount when no audit exists yet.
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      const result = await callAgent(baseUrl, jwt, 'sitemap-coverage',
        note ? { projectId, redoContext: note } : { projectId })
      return res.status(200).json({ ok: true, coverage: result })
    }

    if (action === 'approve_sitemap' || action === 'unlock_sitemap') {
      const stage2 = (roadmapState.stage_2 ?? {}) as Record<string, any>
      if (!stage2 || Object.keys(stage2).length === 0) {
        return res.status(400).json({ error: 'No stage_2 (sitemap) to approve' })
      }
      const stage2Meta = (stage2._meta ?? {}) as Record<string, any>
      const next = action === 'approve_sitemap'
        ? { ...stage2Meta, status: 'approved', approved_at: new Date().toISOString(), approved_by: userData.user.id }
        : { ...stage2Meta, status: 'draft', unlocked_at: new Date().toISOString() }
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...roadmapState, stage_2: { ...stage2, _meta: next } },
      }).eq('id', projectId)
      return res.status(200).json({ ok: true, sitemap_status: next.status })
    }

    if (action === 'run_drafts') {
      // Legacy single-shot run_drafts (briefs + all drafts in one
      // Vercel invocation). Kept for back-compat callers but the
      // client should prefer the split run_briefs + draft_one_page
      // flow below — single-shot blows the 300s function timeout
      // on projects with 15+ pages (page-briefs ~60s + 15 page
      // drafts at ~20s each = 360s, over the cap).
      const updated = await runDrafts({ sb, projectId, jwt, baseUrl, roadmapState, engineState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    // run_briefs removed in the content-collection-first refactor.
    // The replacement is the page-outlines per-page action
    // (run_page_outline_for_page) which produces a richer blueprint
    // (atom UUIDs + treatment signals + flow_role) than the legacy
    // brief and was the path the user explicitly asked for. The old
    // run_briefs action called the page-briefs agent file which is
    // also deleted in this commit — no back-compat shim per user
    // direction ("No backward compat shim — the existing 3886-style
    // briefs get rebuilt").

    if (action === 'list_compatible_templates') {
      // Returns the candidate Brixies templates for one section's
      // archetype — used by the per-section swap UI to populate its
      // dropdown. Matches the same archetype → family map the
      // suggest_bind_for_page action uses, so the swap picker offers
      // exactly the variants the engine considered.
      const archetype = typeof req.body?.archetype === 'string' ? req.body.archetype : null
      if (!archetype) return res.status(400).json({ error: 'archetype required' })
      const ARCHETYPE_TO_FAMILY: Record<string, string[]> = {
        hero:                ['Hero Section'],
        tagline_band:        ['Hero Section', 'Banner Section'],
        two_up:              ['Feature Section'],
        three_up:            ['Feature Section'],
        cards_grid:          ['Feature Section', 'Card'],
        featured_card:       ['Feature Section'],
        image_text_split:    ['Feature Section', 'Content Section'],
        accordion:           ['FAQ Section', 'Content Section'],
        cta_band:            ['CTA Section'],
        testimonial_block:   ['Testimonial Section', 'Content Section'],
        stat_block:          ['Stats Section', 'Content Section'],
        steps_row:           ['Process Section'],
        contact_band:        ['CTA Section', 'Footer'],
        footer_cta:          ['CTA Section'],
        intro_paragraph:     ['Intro Section', 'Content Section'],
        rich_body:           ['Content Section'],
      }
      const families = ARCHETYPE_TO_FAMILY[archetype] ?? ['Content Section']
      const { data: templates } = await sb.from('web_content_templates')
        .select('id, layer_name, family')
        .in('family', families)
        .order('family', { ascending: true })
        .order('layer_name', { ascending: true })
      return res.status(200).json({
        ok: true,
        archetype,
        families,
        templates: templates ?? [],
      })
    }

    if (action === 'override_bind_template') {
      // Strategist picked a different template for a specific section
      // at Gate 2. Persist the override on roadmap_state.page_bind_
      // suggestions[slug].user_overrides — keyed by section_ix so a
      // per-section pick survives across re-runs of suggest_bind_for_
      // page. The override takes precedence at commit time.
      const pageSlug  = typeof req.body?.pageSlug   === 'string' ? req.body.pageSlug   : null
      const sectionIx = typeof req.body?.sectionIx  === 'number' ? req.body.sectionIx  : null
      const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : null
      if (!pageSlug || sectionIx === null || !templateId) {
        return res.status(400).json({ error: 'pageSlug, sectionIx, and templateId required' })
      }
      // Verify the template actually exists so we don't store dangling refs.
      const { data: tpl } = await sb.from('web_content_templates')
        .select('id, layer_name, family').eq('id', templateId).maybeSingle()
      if (!tpl) return res.status(404).json({ error: `Template "${templateId}" not found` })

      const { data: cur } = await sb.from('strategy_web_projects')
        .select('roadmap_state').eq('id', projectId).maybeSingle()
      const curState = (cur?.roadmap_state ?? {}) as Record<string, any>
      const allSuggestions = (curState.page_bind_suggestions ?? {}) as Record<string, any>
      const pageSuggestion = allSuggestions[pageSlug] ?? { sections: [], user_overrides: {} }
      const nextOverrides = { ...(pageSuggestion.user_overrides ?? {}), [String(sectionIx)]: templateId }
      const nextSuggestion = { ...pageSuggestion, user_overrides: nextOverrides }
      await sb.from('strategy_web_projects').update({
        roadmap_state: {
          ...curState,
          page_bind_suggestions: { ...allSuggestions, [pageSlug]: nextSuggestion },
        },
      }).eq('id', projectId)
      return res.status(200).json({
        ok: true,
        page_slug: pageSlug,
        section_ix: sectionIx,
        template: { id: tpl.id, layer_name: tpl.layer_name, family: tpl.family },
      })
    }

    if (action === 'reorg_section_for_template') {
      // AI adapt — when the strategist swaps to a template whose slot
      // shape is materially different from the section's current
      // archetype (e.g. heading+description → heading + 4 cards),
      // call the reorg agent to redistribute copy into the new shape.
      // Optional step the user invokes from the swap dropdown when
      // they want the AI to do the heavy lift; deterministic field
      // mapping handles the easy cases at commit time without it.
      const pageSlug    = typeof req.body?.pageSlug    === 'string' ? req.body.pageSlug    : null
      const sectionIx   = typeof req.body?.sectionIx   === 'number' ? req.body.sectionIx   : null
      const templateId  = typeof req.body?.templateId  === 'string' ? req.body.templateId.trim() : null
      const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
      if (!pageSlug || sectionIx === null || !templateId) {
        return res.status(400).json({ error: 'pageSlug, sectionIx, and templateId required' })
      }
      const result = await callAgent(baseUrl, jwt, 'reorg-section-for-template', {
        projectId, pageSlug, sectionIx, templateId, instruction,
      })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'suggest_bind_for_page') {
      // Pre-bind preview step that runs AFTER iterate but BEFORE
      // Gate 2 lands. For each section in the page draft, picks a
      // Brixies template by archetype → family mapping. This is
      // intentionally DETERMINISTIC (no LLM) so the cascade can
      // afford to run it per-page without hitting Vercel timeouts
      // or burning tokens. The strategist sees the picks at Gate 2
      // and can swap any of them; the actual web_sections rows
      // aren't written until Commit.
      const pageSlug = typeof req.body?.pageSlug === 'string' ? req.body.pageSlug : null
      if (!pageSlug) return res.status(400).json({ error: 'pageSlug required for suggest_bind_for_page' })
      await bailIfCancelled(sb, projectId)

      const draft = (roadmapState.page_drafts ?? {})[pageSlug] as { sections?: any[] } | undefined
      if (!draft || !Array.isArray(draft.sections)) {
        return res.status(404).json({ error: `No draft found for page "${pageSlug}".` })
      }

      // Map page-draft archetypes → Brixies template families. Multiple
      // archetypes can route to the same family — the bind picks
      // narrow it further by structure flags downstream (cards count,
      // has_image, etc.) when we add a smart ranker.
      const ARCHETYPE_TO_FAMILY: Record<string, string[]> = {
        hero:                ['Hero Section'],
        tagline_band:        ['Hero Section', 'Banner Section'],
        two_up:              ['Feature Section'],
        three_up:            ['Feature Section'],
        cards_grid:          ['Feature Section', 'Card'],
        featured_card:       ['Feature Section'],
        image_text_split:    ['Feature Section', 'Content Section'],
        accordion:           ['FAQ Section', 'Content Section'],
        cta_band:            ['CTA Section'],
        testimonial_block:   ['Testimonial Section', 'Content Section'],
        stat_block:          ['Stats Section', 'Content Section'],
        steps_row:           ['Process Section'],
        contact_band:        ['CTA Section', 'Footer'],
        footer_cta:          ['CTA Section'],
        intro_paragraph:     ['Intro Section', 'Content Section'],
        rich_body:           ['Content Section'],
      }

      const sections = draft.sections
      // Pull every candidate template family in one round-trip.
      const familiesNeeded = new Set<string>()
      for (const s of sections) {
        const arc = String((s as any)?.archetype ?? '')
        const fams = ARCHETYPE_TO_FAMILY[arc] ?? ['Content Section']
        for (const f of fams) familiesNeeded.add(f)
      }
      const { data: templatesRaw } = await sb.from('web_content_templates')
        .select('id, layer_name, family')
        .in('family', [...familiesNeeded])
      const templatesByFamily = new Map<string, Array<{ id: string; layer_name: string }>>()
      for (const t of (templatesRaw ?? [])) {
        const arr = templatesByFamily.get(t.family) ?? []
        arr.push({ id: t.id, layer_name: t.layer_name })
        templatesByFamily.set(t.family, arr)
      }

      // Pick a template per section. Track usage on this page so we
      // don't pick the same variant twice in a row (cohesion via
      // rotation — narrow but effective for v1).
      const usedOnThisPage = new Set<string>()
      const sectionPicks: Array<{
        section_ix:           number
        archetype:            string
        chosen_template_id:   string | null
        chosen_layer_name:    string | null
        candidate_families:   string[]
        candidate_count:      number
        rationale:            string
      }> = []
      sections.forEach((s, ix) => {
        const archetype = String((s as any)?.archetype ?? '')
        const fams = ARCHETYPE_TO_FAMILY[archetype] ?? ['Content Section']
        let chosen: { id: string; layer_name: string } | null = null
        for (const fam of fams) {
          const candidates = (templatesByFamily.get(fam) ?? []).filter(t => !usedOnThisPage.has(t.id))
          if (candidates.length > 0) {
            chosen = candidates[0]
            break
          }
        }
        // Final fallback — accept a re-use rather than emit null.
        if (!chosen) {
          for (const fam of fams) {
            const candidates = templatesByFamily.get(fam) ?? []
            if (candidates.length > 0) { chosen = candidates[0]; break }
          }
        }
        if (chosen) usedOnThisPage.add(chosen.id)
        const totalCandidates = fams.reduce((acc, f) => acc + (templatesByFamily.get(f)?.length ?? 0), 0)
        sectionPicks.push({
          section_ix:         ix,
          archetype,
          chosen_template_id: chosen?.id ?? null,
          chosen_layer_name:  chosen?.layer_name ?? null,
          candidate_families: fams,
          candidate_count:    totalCandidates,
          rationale: chosen
            ? `${archetype} → ${chosen.layer_name} (family: ${fams[0]}, ${totalCandidates} candidate${totalCandidates === 1 ? '' : 's'})`
            : `${archetype} → no compatible template found in family ${fams.join(' / ')}. Strategist will need to pick manually at Gate 2 or expand the template library.`,
        })
      })

      // Persist on roadmap_state.page_bind_suggestions[slug]. We DON'T
      // touch web_pages/web_sections — those land on Commit. This is
      // purely a preview the user can swap before locking in.
      const { data: cur } = await sb.from('strategy_web_projects')
        .select('roadmap_state').eq('id', projectId).maybeSingle()
      const curState = (cur?.roadmap_state ?? {}) as Record<string, any>
      const prev = (curState.page_bind_suggestions ?? {}) as Record<string, any>
      const next = {
        ...prev,
        [pageSlug]: {
          sections: sectionPicks,
          generated_at: new Date().toISOString(),
          // Preserve any user_overrides the strategist already set —
          // those take precedence at commit time.
          user_overrides: prev[pageSlug]?.user_overrides ?? {},
        },
      }
      await sb.from('strategy_web_projects').update({
        roadmap_state: { ...curState, page_bind_suggestions: next },
      }).eq('id', projectId)

      return res.status(200).json({
        ok: true, page_slug: pageSlug,
        suggestions: sectionPicks,
        missing_count: sectionPicks.filter(p => !p.chosen_template_id).length,
      })
    }

    if (action === 'draft_one_page') {
      // Phase 2 of the split drafting flow. Drafts ONE page. Client
      // iterates the slugs returned by run_briefs and calls this
      // action per slug, with whatever client-side concurrency the
      // user's browser can tolerate (typically 3-4 parallel fetches).
      const pageSlug = typeof req.body?.pageSlug === 'string' ? req.body.pageSlug : null
      if (!pageSlug) return res.status(400).json({ error: 'pageSlug required for draft_one_page' })
      await bailIfCancelled(sb, projectId)
      const result = await callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug })
      // Increment the pages_drafted counter atomically — re-read DB
      // since other in-flight draft_one_page calls may have bumped
      // it between our read and write.
      const { data: cur } = await sb.from('strategy_web_projects')
        .select('roadmap_state').eq('id', projectId).maybeSingle()
      const curState = (cur?.roadmap_state ?? {}) as Record<string, any>
      const curEng = (curState.engine_state ?? {}) as Record<string, any>
      const drafted = (typeof curEng.pages_drafted === 'number' ? curEng.pages_drafted : 0) + 1
      await writeEngineState(sb, projectId, {
        ...curEng, status: 'drafting', current_phase: 'page_drafts',
        pages_drafted: drafted,
        last_action_at: new Date().toISOString(),
      })
      return res.status(200).json({ ok: true, slug: pageSlug, pages_drafted: drafted, result })
    }

    if (action === 'critique') {
      const updated = await runCritique({ sb, projectId, jwt, baseUrl, roadmapState, engineState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    if (action === 'iterate') {
      const maxLoops = typeof req.body?.maxLoops === 'number' ? req.body.maxLoops : MAX_LOOPS
      const updated = await runIterate({ sb, projectId, jwt, baseUrl, maxLoops })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    if (action === 'route') {
      const feedback = typeof req.body?.user_feedback === 'string' ? req.body.user_feedback.trim() : ''
      if (!feedback) return res.status(400).json({ error: 'user_feedback required for route' })
      const route = await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'route', user_feedback: feedback })
      return res.status(200).json({ ok: true, route })
    }

    if (action === 'apply') {
      const dispatch = req.body?.dispatch
      if (!dispatch || typeof dispatch !== 'object') {
        return res.status(400).json({ error: 'dispatch object required for apply' })
      }
      const result = await applyDispatch({ sb, baseUrl, jwt, projectId, dispatch })
      return res.status(200).json({ ok: true, result })
    }

    if (action === 'commit') {
      const updated = await runCommit({ sb, projectId, jwt, baseUrl, roadmapState })
      return res.status(200).json({ ok: true, engine_state: updated })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error('[orchestrate] error:', err?.message)
    await writeEngineState(sb, projectId, { ...engineState, status: 'error', last_error: err?.message ?? 'unknown', last_action_at: new Date().toISOString() })
    return res.status(500).json({ error: err?.message ?? 'orchestrate failed' })
  }
}

// ── Actions ───────────────────────────────────────────────────────────

async function runDrafts(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>; engineState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, roadmapState } = ctx
  const stage1 = roadmapState.stage_1
  const stage2 = roadmapState.stage_2
  if (!stage1 || !stage2) throw new Error('Synthesize + Sitemap must be complete before run_drafts')

  try {
    await clearCancelledMarker(sb, projectId)
    await bailIfCancelled(sb, projectId)
    await writeEngineState(sb, projectId, { ...ctx.engineState, status: 'briefing', current_phase: 'page_briefs', last_action_at: new Date().toISOString() })

    // Run page_briefs unconditionally on each run_drafts — briefs are
    // cheap to regenerate and ensure draft inputs are fresh.
    await callAgent(baseUrl, jwt, 'page-briefs', { projectId })
    await bailIfCancelled(sb, projectId)

    const { data: refreshed } = await sb.from('strategy_web_projects')
      .select('roadmap_state').eq('id', projectId).maybeSingle()
    const refreshedState = (refreshed?.roadmap_state ?? {}) as Record<string, any>
    const briefs = refreshedState.page_briefs ?? {}
    const slugs = Object.keys(briefs).filter(k => k !== '_meta')

    await writeEngineState(sb, projectId, {
      ...ctx.engineState,
      status: 'drafting',
      current_phase: 'page_drafts',
      pages_total: slugs.length,
      pages_drafted: 0,
      last_action_at: new Date().toISOString(),
    })

    // Drafts in parallel, capped at PAGE_DRAFT_CONCURRENCY. Cancellation
    // checked between chunks — once a chunk starts, its in-flight agent
    // calls finish (Vercel functions can't be killed mid-call), but the
    // NEXT chunk won't start.
    let drafted = 0
    for (let i = 0; i < slugs.length; i += PAGE_DRAFT_CONCURRENCY) {
      await bailIfCancelled(sb, projectId)
      const chunk = slugs.slice(i, i + PAGE_DRAFT_CONCURRENCY)
      await Promise.all(chunk.map(async slug => {
        await callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug })
        drafted += 1
      }))
      await writeEngineState(sb, projectId, {
        ...ctx.engineState,
        status: 'drafting',
        current_phase: 'page_drafts',
        pages_total: slugs.length,
        pages_drafted: drafted,
        last_action_at: new Date().toISOString(),
      })
    }

    const finalState = {
      ...ctx.engineState,
      status: 'drafts_ready',
      current_phase: 'awaiting_critique',
      pages_total: slugs.length,
      pages_drafted: drafted,
      last_action_at: new Date().toISOString(),
    }
    await writeEngineState(sb, projectId, finalState)
    return finalState
  } catch (e: any) {
    if (e instanceof CancelledError) {
      await writeCancelledState(sb, projectId, { current_phase: 'cancelled_during_drafts' })
      return { status: 'cancelled', cancelled_at: new Date().toISOString() }
    }
    throw e
  }
}

async function runCritique(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>; engineState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl } = ctx
  await writeEngineState(sb, projectId, { ...ctx.engineState, status: 'critiquing', current_phase: 'director_critique', last_action_at: new Date().toISOString() })

  const critique = await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'critique' })
  const verdict = critique?.critique?.overall_verdict ?? 'unknown'
  const directiveCount = Array.isArray(critique?.critique?.directives) ? critique.critique.directives.length : 0

  const next = {
    ...ctx.engineState,
    status: verdict === 'approved' ? 'ready_for_review' : 'needs_iteration',
    current_phase: verdict === 'approved' ? 'awaiting_final_review' : 'iterate',
    last_verdict: verdict,
    last_directive_count: directiveCount,
    last_action_at: new Date().toISOString(),
  }
  await writeEngineState(sb, projectId, next)
  return next
}

async function runIterate(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string; maxLoops: number
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, maxLoops } = ctx

  try {
  await clearCancelledMarker(sb, projectId)
  for (let loop = 0; loop < maxLoops; loop++) {
    await bailIfCancelled(sb, projectId)
    const { data: current } = await sb.from('strategy_web_projects')
      .select('roadmap_state').eq('id', projectId).maybeSingle()
    const state = (current?.roadmap_state ?? {}) as Record<string, any>
    const eng = (state.engine_state ?? {}) as Record<string, any>
    const critique = state.director_critique
    const directives = Array.isArray(critique?.directives) ? critique.directives : []

    if (!directives.length) {
      const done = { ...eng, status: 'ready_for_review', current_phase: 'awaiting_final_review', last_action_at: new Date().toISOString() }
      await writeEngineState(sb, projectId, done)
      return done
    }

    await writeEngineState(sb, projectId, {
      ...eng,
      status: 'iterating',
      current_phase: 'applying_directives',
      loop_count: (eng.loop_count ?? 0) + 1,
      last_action_at: new Date().toISOString(),
    })

    // Route each directive to the cheapest agent that can resolve it.
    // fix_kind is the director's explicit signal; stage_to_rerun is
    // the legacy fallback for older critiques that pre-date fix_kind.
    //
    //   slot_edit       → slot-edit agent (one slot)
    //   page_redraft    → page-draft   (whole page)
    //   brief_update    → page-briefs  (re-allocate atoms/persona)
    //   sitemap_redraft → draft-sitemap with audit loop
    //   synthesize_rework → extract-strategy
    //
    // Slot edits parallelize freely (narrow context, fast). Page
    // redrafts cap at PAGE_DRAFT_CONCURRENCY to avoid hammering the
    // gateway.
    const inferFixKind = (d: any): string => {
      if (typeof d?.fix_kind === 'string' && d.fix_kind) return d.fix_kind
      // Legacy directives without fix_kind — map from stage_to_rerun.
      const s = String(d?.stage_to_rerun ?? '')
      if (s === 'single_slot') return 'slot_edit'
      if (s === 'page_draft')  return 'page_redraft'
      if (s === 'page_briefs') return 'brief_update'
      if (s === 'sitemap')     return 'sitemap_redraft'
      if (s === 'synthesize')  return 'synthesize_rework'
      return 'page_redraft'
    }

    const slotEditDirectives = directives.filter((d: any) =>
      inferFixKind(d) === 'slot_edit' && d?.page_slug && d.page_slug !== '*' && d?.slot_locator)
    const pageRedraftDirectives = directives.filter((d: any) =>
      inferFixKind(d) === 'page_redraft' && d?.page_slug && d.page_slug !== '*')
    const otherDirectives = directives.filter((d: any) => {
      const k = inferFixKind(d)
      return k !== 'slot_edit' && k !== 'page_redraft'
    })

    // Slot edits in parallel (no cap — they're narrow + fast).
    if (slotEditDirectives.length > 0) {
      await Promise.all(slotEditDirectives.map((d: any) =>
        callAgent(baseUrl, jwt, 'slot-edit', {
          projectId,
          pageSlug:    d.page_slug,
          sectionIx:   d.slot_locator?.section_ix,
          slotKey:     d.slot_locator?.slot_key,
          instruction: d.note ?? '',
        }).catch((e: any) => {
          // Swallow individual slot-edit failures so one bad locator
          // doesn't kill the whole iterate loop.
          console.error('[iterate.slot-edit] failed for', d.page_slug, d.slot_locator, e?.message)
        })
      ))
    }

    // Page redrafts capped.
    for (let i = 0; i < pageRedraftDirectives.length; i += PAGE_DRAFT_CONCURRENCY) {
      const chunk = pageRedraftDirectives.slice(i, i + PAGE_DRAFT_CONCURRENCY)
      await Promise.all(chunk.map((d: any) =>
        callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: d.page_slug, feedback: d.note ?? '' })
      ))
    }

    // Everything else (brief_update / sitemap_redraft / synthesize_rework) via dispatch.
    for (const d of otherDirectives) {
      // Translate fix_kind back to stage_to_rerun for the legacy dispatcher.
      const kind = inferFixKind(d)
      const stage =
        kind === 'brief_update'       ? 'page_briefs' :
        kind === 'sitemap_redraft'    ? 'sitemap'     :
        kind === 'synthesize_rework'  ? 'synthesize'  :
        String(d.stage_to_rerun ?? '')
      await applyDispatch({ sb, baseUrl, jwt, projectId,
        dispatch: { stage_to_rerun: stage, page_slug: d.page_slug, note: d.note },
      })
    }

    // Re-critique
    await callAgent(baseUrl, jwt, 'director', { projectId, mode: 'critique' })
  }

  const { data: final } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const eng = ((final?.roadmap_state ?? {}).engine_state ?? {}) as Record<string, any>
  const out = { ...eng, status: 'ready_for_review', current_phase: 'awaiting_final_review', max_loops_hit: true, last_action_at: new Date().toISOString() }
  await writeEngineState(sb, projectId, out)
  return out
  } catch (e: any) {
    if (e instanceof CancelledError) {
      await writeCancelledState(sb, projectId, { current_phase: 'cancelled_during_iterate' })
      return { status: 'cancelled', cancelled_at: new Date().toISOString() }
    }
    throw e
  }
}

async function applyDispatch(ctx: {
  sb: any; baseUrl: string; jwt: string; projectId: string; dispatch: any
}): Promise<unknown> {
  const { baseUrl, jwt, projectId, dispatch } = ctx
  const stage = String(dispatch?.stage_to_rerun ?? '')
  const note = String(dispatch?.note ?? '')

  if (stage === 'synthesize') {
    return callAgent(baseUrl, jwt, 'extract-strategy', { projectId, redoContext: note })
  }
  if (stage === 'sitemap') {
    // Treat audit as a non-skippable sub-step of stage 2. The loop
    // drafts the sitemap, audits, and (up to SITEMAP_AUDIT_MAX_LOOPS
    // times) feeds the audit's gap findings back as redoContext so
    // the sitemap can self-correct. If the loop terminates without
    // the audit recommending proceed, _meta.audit_loop_status is set
    // to 'needs_human' so the workspace can warn the strategist.
    return draftSitemapWithAuditLoop({ sb: ctx.sb, baseUrl, jwt, projectId, initialContext: note || undefined })
  }
  if (stage === 'page_briefs') {
    return callAgent(baseUrl, jwt, 'page-briefs', { projectId, redoContext: note })
  }
  if (stage === 'page_draft') {
    const slug = dispatch?.page_slug
    if (!slug) throw new Error('page_draft dispatch requires page_slug')
    return callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug, feedback: note })
  }
  if (stage === 'single_slot') {
    const slug      = dispatch?.page_slug
    const sectionIx = typeof dispatch?.section_ix === 'number' ? dispatch.section_ix : null
    const slotKey   = typeof dispatch?.slot_key   === 'string' ? dispatch.slot_key   : null
    if (!slug) throw new Error('single_slot dispatch requires page_slug')
    if (sectionIx !== null && slotKey) {
      // Real single-slot rewrite via the slot-edit agent.
      return callAgent(baseUrl, jwt, 'slot-edit', {
        projectId, pageSlug: slug, sectionIx, slotKey, instruction: note,
      })
    }
    // Locator missing — fall back to a narrow page_draft re-run so
    // the request still lands SOMEWHERE rather than erroring.
    const focused = `Targeted rewrite. Section index ${dispatch?.section_ix ?? '?'}, slot ${dispatch?.slot_key ?? '?'}. ${note}`
    return callAgent(baseUrl, jwt, 'page-draft', { projectId, pageSlug: slug, feedback: focused })
  }
  if (stage === 'none') {
    return { ok: true, skipped: true }
  }
  throw new Error(`Unknown stage_to_rerun: ${stage}`)
}

/** Stage 2 sub-step: draft sitemap → audit → if gaps, redraft with
 *  the audit's findings as redoContext → re-audit. Loop terminates on:
 *    - audit recommends `proceed_to_stage_3` (success path)
 *    - loop count reaches SITEMAP_AUDIT_MAX_LOOPS (needs_human path)
 *    - the coverage agent itself errors (audit_failed — surfaced but
 *      not fatal; the sitemap still landed and the strategist can
 *      review manually)
 *
 *  Persists loop telemetry to stage_2._meta.audit_loop so the workspace
 *  can show the strategist what just happened (how many iterations,
 *  whether the audit terminated cleanly, residual gap count). */
async function draftSitemapWithAuditLoop(ctx: {
  sb: any; baseUrl: string; jwt: string; projectId: string; initialContext?: string
}): Promise<{
  sitemap: any
  audit: any
  audit_loop: {
    status: 'proceeded' | 'needs_human' | 'audit_failed' | 'cancelled'
    iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
    residual_gap_count: number
    message: string
  }
}> {
  const { sb, baseUrl, jwt, projectId, initialContext } = ctx
  let loopContext = initialContext ?? ''
  let lastSitemap: any = null
  let lastAuditResponse: any = null
  let lastAuditOutput: any = null

  // Outer try wraps the whole loop so a mid-step CancelledError can
  // exit cleanly with a partial-but-consistent result. Whatever
  // sub-steps completed (sitemap drafted, audit run) stay in the DB;
  // we just don't proceed to the next sub-step.
  try {
    // Clear any prior cancelled marker so a successful retry doesn't
    // leave engine_state stuck at 'cancelled'. The auto-cascade
    // useEffects on the workspace look at this status — leaving it
    // stale would block legitimate downstream auto-cascades.
    await clearCancelledMarker(sb, projectId)
  const iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }> = []

  for (let loop = 0; loop <= SITEMAP_AUDIT_MAX_LOOPS; loop++) {
    await bailIfCancelled(sb, projectId)
    lastSitemap = await callAgent(baseUrl, jwt, 'draft-sitemap',
      loopContext ? { projectId, redoContext: loopContext } : { projectId })

    await bailIfCancelled(sb, projectId)
    try {
      lastAuditResponse = await callAgent(baseUrl, jwt, 'sitemap-coverage', { projectId })
      lastAuditOutput = lastAuditResponse?.output ?? lastAuditResponse
    } catch (e: any) {
      console.error('[draftSitemapWithAuditLoop] coverage failed:', e?.message)
      const auditLoop = {
        status: 'audit_failed' as const,
        iterations,
        residual_gap_count: 0,
        message: `Sitemap drafted but audit could not run (${e?.message ?? 'unknown error'}). Review manually before approving.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: null, audit_loop: auditLoop }
    }

    const recommended = String(lastAuditOutput?.recommended_action ?? '')
    const gapsCount = Array.isArray(lastAuditOutput?.gaps) ? lastAuditOutput.gaps.length : 0
    const identityGapsCount = Array.isArray(lastAuditOutput?.identity_gaps) ? lastAuditOutput.identity_gaps.length : 0
    const totalGaps = gapsCount + identityGapsCount
    iterations.push({ loop, gaps_count: totalGaps, recommended_action: recommended })

    if (recommended === 'proceed_to_stage_3') {
      const auditLoop = {
        status: 'proceeded' as const,
        iterations,
        residual_gap_count: totalGaps,
        message: loop === 0
          ? 'Initial sitemap cleared the coverage audit on the first pass.'
          : `Sitemap cleared the coverage audit after ${loop} fix-loop${loop === 1 ? '' : 's'}.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: auditLoop }
    }

    if (loop >= SITEMAP_AUDIT_MAX_LOOPS) {
      const auditLoop = {
        status: 'needs_human' as const,
        iterations,
        residual_gap_count: totalGaps,
        message: `Audit still flagging ${totalGaps} gap${totalGaps === 1 ? '' : 's'} after ${SITEMAP_AUDIT_MAX_LOOPS} auto-fix attempt${SITEMAP_AUDIT_MAX_LOOPS === 1 ? '' : 's'}. Review the audit findings and either revise the sitemap manually or approve with the residual gaps acknowledged.`,
      }
      await persistAuditLoopMeta(sb, projectId, auditLoop)
      return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: auditLoop }
    }

    loopContext = composeAuditContext(lastAuditOutput, loopContext, loop + 1)
  }

  // Unreachable — every branch above returns. Defensive fallback.
  const fallback = {
    status: 'needs_human' as const,
    iterations,
    residual_gap_count: 0,
    message: 'Audit loop exited unexpectedly. Review state manually.',
  }
  await persistAuditLoopMeta(sb, projectId, fallback)
  return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: fallback }
  } catch (e: any) {
    if (e instanceof CancelledError) {
      const cancelled = {
        status: 'cancelled' as const,
        iterations: [] as Array<{ loop: number; gaps_count: number; recommended_action: string }>,
        residual_gap_count: 0,
        message: 'Sitemap draft cancelled by user. Any sub-step that already completed (a sitemap draft, an audit run) stays in place — re-run when ready.',
      }
      await persistAuditLoopMeta(sb, projectId, cancelled)
      await writeCancelledState(sb, projectId)
      return { sitemap: lastSitemap, audit: lastAuditResponse, audit_loop: cancelled }
    }
    throw e
  }
}

/** Format coverage-audit findings as a structured natural-language
 *  note the draft-sitemap agent consumes as `redoContext`. Keeps
 *  prior strategist feedback in scope so an explicit ask doesn't
 *  get washed out by auto-fix items. */
function composeAuditContext(audit: any, prevContext: string, nextLoop: number): string {
  const lines: string[] = []
  lines.push(`# Audit fix-loop ${nextLoop} of ${SITEMAP_AUDIT_MAX_LOOPS}`)
  lines.push('')
  lines.push('The previous sitemap draft was evaluated by the coverage audit. Address the following findings in this redraft — fix the gaps, keep what already worked.')
  lines.push('')

  const gaps = Array.isArray(audit?.gaps) ? audit.gaps : []
  if (gaps.length > 0) {
    lines.push('## Topic gaps')
    for (const g of gaps.slice(0, 12)) {
      lines.push(`- **${g.topic_label ?? g.topic_key}** (${g.importance ?? 'medium'}): ${g.why_a_gap}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const identityGaps = Array.isArray(audit?.identity_gaps) ? audit.identity_gaps : []
  if (identityGaps.length > 0) {
    lines.push('## Identity gaps (x-factor / project goals / persona needs)')
    for (const g of identityGaps.slice(0, 8)) {
      lines.push(`- **${g.label}** (${g.kind}): ${g.why_a_gap}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const headerGaps = (Array.isArray(audit?.header_completeness_audit) ? audit.header_completeness_audit : [])
    .filter((h: any) => h && !h.has_visible_entry && h.severity !== 'low')
  if (headerGaps.length > 0) {
    lines.push('## Missing header nav categories')
    for (const h of headerGaps.slice(0, 6)) {
      lines.push(`- **${h.category}** (${h.severity}): ${h.rationale}`)
      if (h.suggested_fix) lines.push(`  Suggested fix: ${h.suggested_fix}`)
    }
    lines.push('')
  }

  const groupingIssues = (Array.isArray(audit?.grouping_audit) ? audit.grouping_audit : [])
    .filter((g: any) => g && g.issue !== 'clean' && g.severity !== 'low')
  if (groupingIssues.length > 0) {
    lines.push('## Nav grouping issues')
    for (const g of groupingIssues.slice(0, 6)) {
      lines.push(`- **${g.nav_path}** → ${g.parent_label} (${g.issue}, ${g.severity}): ${g.rationale}`)
      if (g.suggested_fix) lines.push(`  Suggested fix: ${g.suggested_fix}`)
    }
    lines.push('')
  }

  const voiceIssues = (Array.isArray(audit?.voice_audit) ? audit.voice_audit : [])
    .filter((v: any) => v && v.severity !== 'low')
  if (voiceIssues.length > 0) {
    lines.push('## Voice / label fixes')
    for (const v of voiceIssues.slice(0, 10)) {
      lines.push(`- "${v.current_label}" → "${v.suggested_label}" (${v.issue}, ${v.severity})`)
    }
    lines.push('')
  }

  if (prevContext) {
    lines.push('---')
    lines.push('## Strategist note from this revision (preserve)')
    lines.push(prevContext)
  }

  return lines.join('\n')
}

/** Stamp the audit-loop telemetry onto stage_2._meta.audit_loop so the
 *  UI can render the loop's outcome without recomputing it from scratch. */
async function persistAuditLoopMeta(sb: any, projectId: string, auditLoop: {
  status: string; iterations: Array<{ loop: number; gaps_count: number; recommended_action: string }>
  residual_gap_count: number; message: string
}): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  const stage2 = (state.stage_2 ?? {}) as Record<string, any>
  const stage2Meta = (stage2._meta ?? {}) as Record<string, any>
  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...state,
      stage_2: {
        ...stage2,
        _meta: {
          ...stage2Meta,
          audit_loop: { ...auditLoop, completed_at: new Date().toISOString() },
        },
      },
    },
  }).eq('id', projectId)
}

async function runCommit(ctx: {
  sb: any; projectId: string; jwt: string; baseUrl: string
  roadmapState: Record<string, any>
}): Promise<Record<string, any>> {
  const { sb, projectId, jwt, baseUrl, roadmapState } = ctx
  const drafts = roadmapState.page_drafts ?? {}
  const slugs = Object.keys(drafts).filter(k => k !== '_meta')

  const engineState = (roadmapState.engine_state ?? {}) as Record<string, any>
  try {
    await clearCancelledMarker(sb, projectId)
    await bailIfCancelled(sb, projectId)
    await writeEngineState(sb, projectId, { ...engineState, status: 'committing', current_phase: 'page_bind', pages_committed: 0, pages_total: slugs.length, last_action_at: new Date().toISOString() })

    let committed = 0
    for (let i = 0; i < slugs.length; i += PAGE_DRAFT_CONCURRENCY) {
      await bailIfCancelled(sb, projectId)
      const chunk = slugs.slice(i, i + PAGE_DRAFT_CONCURRENCY)
      await Promise.all(chunk.map(async slug => {
        await callAgent(baseUrl, jwt, 'page-bind', { projectId, pageSlug: slug })
        committed += 1
      }))
      await writeEngineState(sb, projectId, { ...engineState, status: 'committing', current_phase: 'page_bind', pages_committed: committed, pages_total: slugs.length, last_action_at: new Date().toISOString() })
    }

    const done = { ...engineState, status: 'committed', current_phase: 'done', pages_committed: committed, pages_total: slugs.length, last_action_at: new Date().toISOString() }
    await writeEngineState(sb, projectId, done)
    return done
  } catch (e: any) {
    if (e instanceof CancelledError) {
      await writeCancelledState(sb, projectId, { current_phase: 'cancelled_during_commit' })
      return { status: 'cancelled', cancelled_at: new Date().toISOString() }
    }
    throw e
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Drafts one page, then auto-retries when the draft's _meta
 *  telemetry signals failure. No half-done pages reach Gate 2 —
 *  this loop is the enforcement layer for that contract.
 *
 *  Failure conditions (any one triggers retry):
 *   - sections_match === false (drafter produced fewer sections
 *     than the outline asked for)
 *   - atom_resolution_rate < 0.95 (≥5% of requested atoms didn't
 *     resolve — outline likely has fabricated atom_ids)
 *   - truncation_suspected === true (response cut mid-write)
 *   - validation.flags non-empty (em-dashes, heading length, etc.)
 *
 *  Retry strategy (capped at 3 attempts):
 *   1. Same model, with feedback naming the specific failure.
 *   2. Same model with lower temperature (model swap from Sonnet to
 *      Opus on the gateway side if available — falls through
 *      gracefully on env config).
 *   3. Final attempt with the unresolved sections as explicit
 *      feedback.
 *
 *  After 3 failed attempts, the page is marked `blocked_missing_input`
 *  and surfaced to the user with the specific gap named.
 */
async function draftPageUntilResolved(ctx: {
  sb: any; baseUrl: string; jwt: string; projectId: string; pageSlug: string
}): Promise<{ status: 'resolved' | 'blocked_missing_input'; attempts: number; final_draft_meta: any; problems?: string[] }> {
  const { sb, baseUrl, jwt, projectId, pageSlug } = ctx
  const MAX_ATTEMPTS = 3
  let attempt = 0
  let lastDraft: any = null
  let problems: string[] = []

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1
    await bailIfCancelled(sb, projectId)

    // Compose retry feedback when we have problems from a prior pass.
    const retryFeedback = problems.length === 0 ? '' : [
      `Previous attempt #${attempt - 1} failed the resolution contract.`,
      'Problems detected:',
      ...problems.map(p => `- ${p}`),
      '',
      'Re-draft this page addressing every problem above. Pay special attention to:',
      '- Matching the outline\'s section count (do not skip sections).',
      '- Using only atom_ids that the outline provided (do not invent IDs).',
      '- Avoiding em-dashes, heading length violations, and question-mark headings.',
      '- Producing copy that fits within MAX_OUTPUT_TOKENS (skip overly verbose body copy).',
    ].join('\n')

    await callAgent(baseUrl, jwt, 'page-draft',
      retryFeedback
        ? { projectId, pageSlug, feedback: retryFeedback }
        : { projectId, pageSlug })

    // Re-read the just-written draft from DB to check telemetry.
    const { data: cur } = await sb.from('strategy_web_projects')
      .select('roadmap_state').eq('id', projectId).maybeSingle()
    const state = (cur?.roadmap_state ?? {}) as Record<string, any>
    const draft = state.page_drafts?.[pageSlug]
    lastDraft = draft

    const m = (draft?._meta ?? {}) as Record<string, any>
    const flags = Array.isArray(draft?.validation?.flags) ? draft.validation.flags : []
    const problemsThisRound: string[] = []

    if (m.used_outline === true && m.sections_match === false) {
      problemsThisRound.push(`Section count mismatch: outline expected ${m.outline_sections}, draft produced ${m.drafted_sections}.`)
    }
    if (typeof m.atom_resolution_rate === 'number' && m.atom_resolution_rate < 0.95) {
      const missing = (m.atom_ids_requested ?? 0) - (m.atom_ids_resolved ?? 0)
      problemsThisRound.push(`Atom resolution rate ${Math.round(m.atom_resolution_rate * 100)}% — ${missing} atom_id(s) didn't resolve from content_atoms. The outline may contain fabricated UUIDs.`)
    }
    if (m.truncation_suspected === true) {
      problemsThisRound.push(`Draft response approached token cap (${m.truncation_pct}%). Output likely truncated.`)
    }
    if (flags.length > 0) {
      const structural = flags.filter((f: any) => f && typeof f === 'object' && f.kind)
      if (structural.length > 0) {
        problemsThisRound.push(`${structural.length} structural validation flag(s): ${structural.slice(0, 3).map((f: any) => `${f.kind}@section[${f.section_ix}].${f.field}`).join(', ')}${structural.length > 3 ? '…' : ''}.`)
      }
    }
    // Unresolved inputs the outline flagged — these block resolution
    // unless they're truly missing-from-intake (not auto-recoverable).
    const outline = state.page_outlines?.[pageSlug] as any | undefined
    const unresolved = Array.isArray(outline?.unresolved_inputs) ? outline.unresolved_inputs : []
    if (unresolved.length > 0 && attempt === MAX_ATTEMPTS) {
      // Final attempt: outline declared content genuinely missing.
      // Surface as blocked_missing_input.
      return {
        status: 'blocked_missing_input',
        attempts: attempt,
        final_draft_meta: m,
        problems: [
          ...problemsThisRound,
          ...unresolved.map((u: any) => `Outline flagged missing input: ${u.what} — ${u.why_needed}`),
        ],
      }
    }

    problems = problemsThisRound
    if (problems.length === 0) {
      return { status: 'resolved', attempts: attempt, final_draft_meta: m }
    }
  }

  return {
    status: 'blocked_missing_input',
    attempts: MAX_ATTEMPTS,
    final_draft_meta: lastDraft?._meta ?? null,
    problems,
  }
}

async function callAgent(baseUrl: string, jwt: string, agentName: string, body: Record<string, unknown>): Promise<any> {
  const url = `${baseUrl}/api/web/agents/${agentName}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!r.ok) {
    throw new Error(`agent ${agentName} failed (${r.status}): ${json?.error ?? text}`)
  }
  return json
}

/** Sentinel thrown by sub-step cancellation checks. Helpers catch it
 *  at the top of their try blocks and translate it into a clean
 *  cancelled-state write — no partial-state corruption. Errors that
 *  are NOT this sentinel keep propagating as normal. */
class CancelledError extends Error {
  constructor() { super('Run cancelled by user'); this.name = 'CancelledError' }
}

/** Re-reads engine_state from the DB and returns whether the user
 *  set cancel_requested while the current run was in flight. Cheap
 *  enough to call between sub-steps. Returns false on read error so
 *  a flaky DB read doesn't accidentally cancel work. */
async function isCancelRequested(sb: any, projectId: string): Promise<boolean> {
  try {
    const { data } = await sb.from('strategy_web_projects')
      .select('roadmap_state').eq('id', projectId).maybeSingle()
    return !!(((data?.roadmap_state ?? {}).engine_state ?? {}).cancel_requested)
  } catch { return false }
}

/** Throws CancelledError if the cancel_requested flag is set. */
async function bailIfCancelled(sb: any, projectId: string): Promise<void> {
  if (await isCancelRequested(sb, projectId)) throw new CancelledError()
}

/** Clears the cancelled marker from engine_state, if present. Called
 *  at the start of each long-running helper so a retry-after-cancel
 *  doesn't leave engine_state.status stuck at 'cancelled' after a
 *  successful new run. Preserves any other engine telemetry. */
async function clearCancelledMarker(sb: any, projectId: string): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  const eng = (state.engine_state ?? {}) as Record<string, any>
  if (eng.status !== 'cancelled' && !eng.cancelled_at && !eng.cancel_requested) return
  delete eng.cancel_requested
  delete eng.cancel_requested_at
  delete eng.cancelled_at
  if (eng.status === 'cancelled') eng.status = 'idle'
  await sb.from('strategy_web_projects').update({
    roadmap_state: { ...state, engine_state: eng },
  }).eq('id', projectId)
}

/** Write the canonical cancelled engine state. Clears the
 *  cancel_requested flag so the next action starts from a clean
 *  slate. Preserves any other engine_state telemetry the helper had
 *  accumulated (loop counts, pages_drafted, etc.). */
async function writeCancelledState(sb: any, projectId: string, ctxState: Record<string, any> = {}): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  const eng = { ...(state.engine_state ?? {}), ...ctxState }
  delete eng.cancel_requested
  delete eng.cancel_requested_at
  eng.status = 'cancelled'
  eng.cancelled_at = new Date().toISOString()
  eng.last_action_at = eng.cancelled_at
  await sb.from('strategy_web_projects').update({
    roadmap_state: { ...state, engine_state: eng },
  }).eq('id', projectId)
}

async function writeEngineState(sb: any, projectId: string, engineState: Record<string, any>): Promise<void> {
  const { data: current } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const state = (current?.roadmap_state ?? {}) as Record<string, any>
  await sb.from('strategy_web_projects').update({
    roadmap_state: { ...state, engine_state: engineState },
  }).eq('id', projectId)
}

/** Deterministic page rename — updates the matching page in
 *  stage_2.pages and any header_nav entry pointing at the same slug.
 *  Returns whether the page was found, the new sitemap, and a list
 *  of nav updates that landed (for telemetry). Pure function — no
 *  I/O, no LLM. */
function renameSitemapPage(
  stage2: Record<string, any>,
  edit: { slug: string; newName: string | null; newNavLabel: string | null; newSlug: string | null },
): { found: boolean; sitemap: Record<string, any>; updatedPage: Record<string, any> | null; navUpdates: string[] } {
  const next = JSON.parse(JSON.stringify(stage2)) as Record<string, any>
  const pages = Array.isArray(next.pages) ? next.pages : []
  const target = pages.find((p: any) => String(p?.slug ?? '') === edit.slug)
  if (!target) return { found: false, sitemap: next, updatedPage: null, navUpdates: [] }

  const navUpdates: string[] = []
  const oldSlug = String(target.slug)

  if (edit.newName != null && edit.newName.length > 0) target.name = edit.newName
  if (edit.newNavLabel != null) target.nav_label = edit.newNavLabel || undefined
  if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
    target.slug = edit.newSlug
    // Cascade slug change into parent_slug references.
    for (const p of pages) {
      if (p?.parent_slug === oldSlug) { p.parent_slug = edit.newSlug; navUpdates.push(`pages.${p.slug}.parent_slug → ${edit.newSlug}`) }
    }
  }

  // Header nav — update entries that point at the renamed slug.
  const walkNav = (entries: any[], path: string): void => {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue
      if (e.kind === 'page' && String(e.slug ?? '') === oldSlug) {
        if (edit.newNavLabel != null && edit.newNavLabel.length > 0) {
          e.label = edit.newNavLabel
          navUpdates.push(`${path} label → ${edit.newNavLabel}`)
        } else if (edit.newName != null && edit.newName.length > 0) {
          e.label = edit.newName
          navUpdates.push(`${path} label → ${edit.newName}`)
        }
        if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
          e.slug = edit.newSlug
          navUpdates.push(`${path} slug → ${edit.newSlug}`)
        }
      }
      if (Array.isArray(e.children)) walkNav(e.children, `${path} > ${e.label ?? '?'}`)
    }
  }
  if (Array.isArray(next.header_nav)) walkNav(next.header_nav, 'header_nav')
  // Footer items also carry slugs — same treatment.
  if (Array.isArray(next.footer_nav)) {
    for (const section of next.footer_nav) {
      if (!Array.isArray(section?.items)) continue
      for (const item of section.items) {
        if (!item || typeof item !== 'object') continue
        if (String(item.slug ?? '') !== oldSlug) continue
        if (edit.newNavLabel != null && edit.newNavLabel.length > 0) {
          item.label = edit.newNavLabel
          navUpdates.push(`footer ${section.section_label} label → ${edit.newNavLabel}`)
        } else if (edit.newName != null && edit.newName.length > 0) {
          item.label = edit.newName
          navUpdates.push(`footer ${section.section_label} label → ${edit.newName}`)
        }
        if (edit.newSlug != null && edit.newSlug.length > 0 && edit.newSlug !== oldSlug) {
          item.slug = edit.newSlug
          navUpdates.push(`footer ${section.section_label} slug → ${edit.newSlug}`)
        }
      }
    }
  }

  return { found: true, sitemap: next, updatedPage: target, navUpdates }
}

function resolveBaseUrl(req: any): string {
  // Prefer the request's own origin so internal calls land on the same
  // deployment. Falls back to VERCEL_URL / localhost.
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string)
  if (host) return `${proto}://${host}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
