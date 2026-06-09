/**
 * Vercel Serverless Function — /api/web/agents/apply-audit-to-nav
 *
 * Targeted, additive alternative to draft-sitemap when the goal is
 * "push these specific audit gaps into the sitemap" rather than
 * "redraft the whole sitemap." The model outputs a STRUCTURED LIST OF
 * EDITS — not a new sitemap — and this handler applies each edit
 * deterministically. That makes the behavior predictable: pages can
 * only be added, header nav entries can only be added, and existing
 * pages/labels/structure are untouched unless an edit explicitly
 * targets them.
 *
 * Edit kinds (v1 — covers the common audit gap types):
 *   - add_page          → append a new entry to stage_2.pages
 *   - add_header_entry  → add a top-level header_nav item (page or group)
 *   - add_footer_entry  → add an item to a footer_nav section (creates
 *                         the section if needed)
 *
 * Each edit carries an `audit_finding_ref` (topic_key / identity gap
 * label / header category) so the resulting stage_2._meta.audit_apply
 * record names exactly which gaps were addressed.
 *
 * Invalidates stage_2_5 so the next workspace render auto-re-runs the
 * coverage audit against the new sitemap.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

export const maxDuration = 180

const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 8000

const EDIT_TOOL = {
  description: 'Submit a list of additive edits that push specific coverage-audit findings into the sitemap. Existing pages, labels, and nav structure are preserved.',
  input_schema: {
    type: 'object',
    required: ['edits', 'summary'],
    properties: {
      edits: {
        type: 'array',
        description: 'Ordered list of additive edits to apply to the sitemap.',
        items: {
          type: 'object',
          required: ['kind', 'audit_finding_ref', 'rationale'],
          properties: {
            kind: {
              type: 'string',
              enum: ['add_page', 'add_header_entry', 'add_footer_entry'],
            },
            audit_finding_ref: {
              type: 'string',
              description: 'topic_key, identity gap label, or header_completeness category that this edit addresses. Used in the audit_apply log.',
            },
            rationale: {
              type: 'string',
              description: 'One sentence: why this edit closes the audit finding.',
            },
            // add_page payload
            page: {
              type: 'object',
              description: 'Required when kind=add_page.',
              required: ['name', 'slug', 'phase', 'page_type', 'strategic_purpose', 'rationale', 'density'],
              properties: {
                name:              { type: 'string' },
                slug:              { type: 'string' },
                nav_label:         { type: 'string' },
                phase:             { type: 'string', enum: ['1', '2', 'nav-only', 'global'] },
                parent_slug:       { type: ['string', 'null'] },
                page_type:         { type: 'string', enum: ['content', 'chrome', 'functional'] },
                strategic_purpose: { type: 'string' },
                rationale:         { type: 'string' },
                content_sources:   { type: 'array', items: { type: 'string' } },
                density:           { type: 'string', enum: ['high', 'medium', 'low'] },
              },
            },
            // add_header_entry payload
            header_entry: {
              type: 'object',
              description: 'Required when kind=add_header_entry.',
              required: ['label', 'kind'],
              properties: {
                label: { type: 'string' },
                kind:  { type: 'string', enum: ['page', 'group'] },
                slug:  { type: 'string', description: 'Required when kind=page.' },
                rationale: { type: 'string' },
                intent_type: {
                  type: 'string',
                  enum: ['commitment_pathway','current_state','audience_pages',
                         'identity_trust','media_archive','giving_conversion',
                         'mandatory_visitor','misc'],
                },
                grouping_rationale: { type: 'string' },
                children: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['label', 'kind'],
                    properties: {
                      label: { type: 'string' },
                      kind:  { type: 'string', enum: ['page', 'group'] },
                      slug:  { type: 'string' },
                    },
                  },
                },
              },
            },
            // add_footer_entry payload
            footer_section_label: { type: 'string', description: 'Required when kind=add_footer_entry. The footer section to add to; created if missing.' },
            footer_item: {
              type: 'object',
              description: 'Required when kind=add_footer_entry.',
              required: ['label'],
              properties: {
                label: { type: 'string' },
                slug:  { type: 'string' },
                url:   { type: 'string' },
              },
            },
          },
        },
      },
      summary: {
        type: 'string',
        description: 'One paragraph: what was added and why. Surfaced in the workspace.',
      },
      skipped_findings: {
        type: 'array',
        description: 'Audit findings the model decided not to apply (e.g., already covered, too vague to act on). Each item carries finding_ref + reason.',
        items: {
          type: 'object',
          required: ['finding_ref', 'reason'],
          properties: {
            finding_ref: { type: 'string' },
            reason:      { type: 'string' },
          },
        },
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are a sitemap surgeon. Your job is to take a coverage audit and produce a list of ADDITIVE edits that close the flagged gaps.',
  '',
  'Rules:',
  '- ONLY add. Never rename, remove, or restructure existing pages or nav items.',
  '- One edit per audit finding. Group multiple findings into a single edit ONLY if they describe the same missing destination.',
  '- Prefer add_page for "topic has no home" gaps. Prefer add_header_entry for "missing nav category" gaps from header_completeness_audit. Prefer add_footer_entry for utility/secondary content that doesn\'t deserve header space.',
  '- For add_page, pick a slug that doesn\'t collide with existing slugs. If a similar slug exists, suffix with -2 or use a more specific name.',
  '- For add_header_entry with kind=group, populate children with at least one page entry.',
  '- If a finding is already covered by an existing page/anchor (the model can tell from rationale + page list), skip it and explain in skipped_findings.',
  '- If a finding is too vague to act on (e.g., "improve voice across the site"), skip it.',
  '- Density: high for hub pages, medium for standard content pages, low for utility/chrome pages.',
  '- Phase: "1" for must-launch, "2" for post-launch enhancement, "nav-only" for pages that just need a nav entry, "global" for chrome (footer-only pages).',
].join('\n')

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey     = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, roadmap_state').eq('id', projectId).maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const state    = (project.roadmap_state ?? {}) as Record<string, any>
  const sitemap  = state.stage_2 as Record<string, any> | undefined
  const audit    = state.stage_2_5 as Record<string, any> | undefined
  if (!sitemap) return res.status(400).json({ error: 'No sitemap (stage_2) to update.' })
  if (!audit) return res.status(400).json({ error: 'No coverage audit (stage_2_5) to apply. Run the audit first.' })

  const slimSitemap = {
    pages:       (sitemap.pages       ?? []).map((p: any) => ({ name: p.name, slug: p.slug, nav_label: p.nav_label, page_type: p.page_type, phase: p.phase })),
    header_nav:  sitemap.header_nav   ?? [],
    footer_nav:  sitemap.footer_nav   ?? [],
  }
  const slimAudit = {
    gaps:                      audit.gaps ?? [],
    identity_gaps:             audit.identity_gaps ?? [],
    header_completeness_audit: (audit.header_completeness_audit ?? []).filter((h: any) => !h.has_visible_entry && h.severity !== 'low'),
  }

  const userText = [
    '# Current sitemap (pages + nav, slimmed)',
    '```json',
    JSON.stringify(slimSitemap, null, 2),
    '```',
    '',
    '# Coverage-audit findings to address',
    '```json',
    JSON.stringify(slimAudit, null, 2),
    '```',
    '',
    'Produce a list of additive edits that close every actionable finding above. Skip findings that are already covered or too vague.',
  ].join('\n')

  let toolInput: Record<string, any> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_nav_edits: tool({
          description: EDIT_TOOL.description,
          inputSchema: jsonSchema(EDIT_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_nav_edits' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_nav_edits') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input as Record<string, any>
  } catch (err: any) {
    console.error('[apply-audit-to-nav] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  if (!toolInput || !Array.isArray(toolInput.edits)) {
    return res.status(502).json({ error: 'Agent returned no edits.' })
  }

  // ── Apply edits deterministically ─────────────────────────────────
  const nextSitemap: Record<string, any> = JSON.parse(JSON.stringify(sitemap))
  if (!Array.isArray(nextSitemap.pages))      nextSitemap.pages = []
  if (!Array.isArray(nextSitemap.header_nav)) nextSitemap.header_nav = []
  if (!Array.isArray(nextSitemap.footer_nav)) nextSitemap.footer_nav = []

  const existingSlugs = new Set<string>(nextSitemap.pages.map((p: any) => String(p?.slug ?? '')).filter(Boolean))
  const applied: Array<{ kind: string; ref: string; detail: string }> = []
  const rejected: Array<{ kind: string; ref: string; reason: string }> = []

  for (const edit of toolInput.edits as any[]) {
    const ref = String(edit?.audit_finding_ref ?? '(unspecified)')
    if (edit.kind === 'add_page') {
      const page = edit.page
      if (!page?.slug) { rejected.push({ kind: 'add_page', ref, reason: 'missing page.slug' }); continue }
      if (existingSlugs.has(page.slug)) {
        rejected.push({ kind: 'add_page', ref, reason: `slug "${page.slug}" already exists` })
        continue
      }
      nextSitemap.pages.push({
        ...page,
        rationale: page.rationale ?? `Added from coverage audit: ${edit.rationale}`,
      })
      existingSlugs.add(page.slug)
      applied.push({ kind: 'add_page', ref, detail: `+ page "${page.name}" (/${page.slug})` })
    } else if (edit.kind === 'add_header_entry') {
      const entry = edit.header_entry
      if (!entry?.label) { rejected.push({ kind: 'add_header_entry', ref, reason: 'missing header_entry.label' }); continue }
      const dupe = (nextSitemap.header_nav as any[]).some(e => String(e?.label).toLowerCase() === String(entry.label).toLowerCase())
      if (dupe) {
        rejected.push({ kind: 'add_header_entry', ref, reason: `header label "${entry.label}" already exists` })
        continue
      }
      nextSitemap.header_nav.push(entry)
      applied.push({ kind: 'add_header_entry', ref, detail: `+ header "${entry.label}"` })
    } else if (edit.kind === 'add_footer_entry') {
      const sectionLabel = String(edit.footer_section_label ?? '').trim()
      const item = edit.footer_item
      if (!sectionLabel || !item?.label) { rejected.push({ kind: 'add_footer_entry', ref, reason: 'missing section_label or footer_item.label' }); continue }
      let section = (nextSitemap.footer_nav as any[]).find(s => String(s?.section_label).toLowerCase() === sectionLabel.toLowerCase())
      if (!section) {
        section = { section_label: sectionLabel, items: [] }
        nextSitemap.footer_nav.push(section)
      }
      if (!Array.isArray(section.items)) section.items = []
      const dupe = (section.items as any[]).some((it: any) => String(it?.label).toLowerCase() === String(item.label).toLowerCase())
      if (dupe) {
        rejected.push({ kind: 'add_footer_entry', ref, reason: `footer item "${item.label}" already in "${sectionLabel}"` })
        continue
      }
      section.items.push(item)
      applied.push({ kind: 'add_footer_entry', ref, detail: `+ footer "${item.label}" in "${sectionLabel}"` })
    } else {
      rejected.push({ kind: String(edit?.kind ?? '?'), ref, reason: 'unknown edit kind' })
    }
  }

  // Update meta + invalidate audit (so the next mount re-runs sitemap-coverage).
  const nowIso = new Date().toISOString()
  const prevMeta = (sitemap._meta ?? {}) as Record<string, any>
  nextSitemap._meta = {
    ...prevMeta,
    // Adding pages/nav entries is a structural change — revert to draft
    // so the strategist re-approves after reviewing what landed.
    status: 'draft',
    generated_at: nowIso,
    audit_apply: {
      applied_at:      nowIso,
      applied_count:   applied.length,
      rejected_count:  rejected.length,
      summary:         String(toolInput.summary ?? ''),
      applied,
      rejected,
      skipped_findings: Array.isArray(toolInput.skipped_findings) ? toolInput.skipped_findings : [],
      usage,
    },
  }

  const nextState: Record<string, any> = { ...state, stage_2: nextSitemap }
  // Drop the audit so the workspace auto-reruns sitemap-coverage on next render.
  delete nextState.stage_2_5

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: nextState }).eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    applied_count:  applied.length,
    rejected_count: rejected.length,
    applied,
    rejected,
    summary: String(toolInput.summary ?? ''),
    skipped_findings: Array.isArray(toolInput.skipped_findings) ? toolInput.skipped_findings : [],
  })
}
