/**
 * Vercel Serverless Function — /api/web/agents/export-state
 *
 * Bundles the current Copy Engine state (sitemap + page briefs + page
 * drafts) into a single markdown document the strategist can:
 *
 *   1. Save locally
 *   2. Paste into another AI conversation (Claude, ChatGPT, etc.) for
 *      refinement
 *   3. Paste back into the app via /api/web/agents/import-state
 *
 * The format is deliberately mixed: human-readable headers + explicit
 * editing instructions + JSON code blocks. An AI conversation can edit
 * either the JSON OR the prose; the importer is JSON-block-targeted
 * so prose tweaks don't poison the round-trip.
 *
 * Format version: srp-engine-export-v1.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

const FORMAT_VERSION = 'srp-engine-export-v1'

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
  // Scope controls which sections land in the markdown. Default is
  // 'full' (everything) for back-compat. 'sitemap' = just sitemap +
  // coverage audit (lightweight, for nav-focused AI conversations).
  // 'copy' = drafts + briefs + audit + voice/persona/SEO from
  // Stage 1 + snippets table (everything a copywriting conversation
  // needs).
  const rawScope = typeof req.body?.scope === 'string' ? req.body.scope : 'full'
  const scope: 'full' | 'sitemap' | 'copy' = rawScope === 'sitemap' || rawScope === 'copy' ? rawScope : 'full'
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, name, member, roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const state    = (project.roadmap_state ?? {}) as Record<string, any>
  const sitemap  = scope === 'copy' ? null : (state.stage_2 ?? null)
  const coverage = state.stage_2_5 ?? null    // included in all scopes — useful context
  const briefs   = scope === 'sitemap' ? {} : stripMetaKey(state.page_briefs ?? {})
  const drafts   = scope === 'sitemap' ? {} : stripMetaKey(state.page_drafts ?? {})
  const stage1   = scope === 'sitemap' ? null : (state.stage_1 ?? null)

  // Snippets — included for 'copy' and 'full' scopes so an external
  // AI editing the draft sees which tokens are available + their
  // current expansions, and can reference them in revisions.
  let snippets: Array<{ token: string; expansion: string }> = []
  if (scope !== 'sitemap') {
    try {
      const { data: sn } = await sb.from('web_project_snippets')
        .select('token, expansion').eq('web_project_id', projectId).eq('archived', false)
      if (Array.isArray(sn)) {
        snippets = sn
          .filter((r: any) => typeof r?.token === 'string' && typeof r?.expansion === 'string' && r.expansion)
          .map((r: any) => ({ token: r.token, expansion: r.expansion }))
      }
    } catch { /* non-fatal */ }
  }

  const document = renderExportDocument({
    projectName: project.name as string | null,
    member:      project.member as number | null,
    projectId:   project.id as string,
    exportedAt:  new Date().toISOString(),
    exportedBy:  userData.user.email ?? userData.user.id,
    scope,
    sitemap,
    coverage,
    briefs,
    drafts,
    stage1,
    snippets,
  })

  const safeName = String(project.name ?? `project-${project.id}`)
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
  const scopeSuffix = scope === 'full' ? 'copy-engine' : scope
  const filename = `${safeName}-${scopeSuffix}-${new Date().toISOString().slice(0, 10)}.md`

  return res.status(200).json({
    ok: true,
    document,
    filename,
    format_version: FORMAT_VERSION,
    scope,
    sections: {
      sitemap_present:  !!sitemap,
      coverage_present: !!coverage,
      stage1_present:   !!stage1,
      briefs_count:     Object.keys(briefs).length,
      drafts_count:     Object.keys(drafts).length,
      snippets_count:   snippets.length,
    },
  })
}

/** Strip the `_meta` housekeeping key from any record-keyed-by-slug
 *  store before exporting. _meta carries the agent run telemetry —
 *  not useful for the strategist to edit, and confusing if exposed. */
function stripMetaKey(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_meta') continue
    out[k] = v
  }
  return out
}

function renderExportDocument(input: {
  projectName: string | null
  member:      number | null
  projectId:   string
  exportedAt:  string
  exportedBy:  string
  scope:       'full' | 'sitemap' | 'copy'
  sitemap:     any
  coverage:    any
  briefs:      Record<string, any>
  drafts:      Record<string, any>
  stage1:      any
  snippets:    Array<{ token: string; expansion: string }>
}): string {
  const sitemapBlock = input.sitemap
    ? '```json\n' + JSON.stringify(input.sitemap, null, 2) + '\n```'
    : '_(no sitemap drafted yet)_'

  // Coverage audit is read-only context for the external AI conversation —
  // the importer ignores any "## Coverage Audit" section so refining the
  // audit in-conversation has no side-effect on import. Strip _meta so
  // model usage telemetry doesn't leak into the editing surface.
  const coverageForExport = input.coverage
    ? Object.fromEntries(Object.entries(input.coverage as Record<string, any>).filter(([k]) => k !== '_meta'))
    : null
  const coverageBlock = coverageForExport
    ? '```json\n' + JSON.stringify(coverageForExport, null, 2) + '\n```'
    : '_(no coverage audit yet — runs automatically when a sitemap exists)_'

  const briefsBlock = Object.keys(input.briefs).length > 0
    ? '```json\n' + JSON.stringify(input.briefs, null, 2) + '\n```'
    : '_(no page briefs yet — run the engine\'s "Run drafts" action to generate them)_'

  const draftsBlock = Object.keys(input.drafts).length > 0
    ? '```json\n' + JSON.stringify(input.drafts, null, 2) + '\n```'
    : '_(no page drafts yet)_'

  // Strategic context for the copy scope — voice, persona, x-factor,
  // SEO targets. Slim to keep token cost down while giving the
  // copywriting conversation everything it needs to stay on-voice.
  const stage1ForExport = input.stage1 ? {
    audience:              (input.stage1 as any).audience,
    voice_characteristics: (input.stage1 as any).voice_characteristics,
    voice_exemplars:       (input.stage1 as any).voice_exemplars,
    voice_anti_exemplars:  (input.stage1 as any).voice_anti_exemplars,
    personas:              (input.stage1 as any).personas,
    x_factor:              (input.stage1 as any).x_factor,
    project_goals:         (input.stage1 as any).project_goals,
    seo_aeo_geo_targets:   (input.stage1 as any).seo_aeo_geo_targets,
    topic_coverage_plan:   (input.stage1 as any).topic_coverage_plan,
  } : null
  const stage1Block = stage1ForExport
    ? '```json\n' + JSON.stringify(stage1ForExport, null, 2) + '\n```'
    : '_(no strategy synthesis yet)_'

  const snippetsBlock = input.snippets.length > 0
    ? '```json\n' + JSON.stringify(input.snippets, null, 2) + '\n```'
    : '_(no project snippets defined)_'

  const scopeTitle =
    input.scope === 'sitemap' ? 'Sitemap Export'
    : input.scope === 'copy'  ? 'Copy Export'
    :                           'Copy Engine Export'

  // What's editable + included depends on scope.
  const editableSection: string[] = []
  const tail: string[] = []

  if (input.scope === 'sitemap') {
    editableSection.push(
      `## Sitemap`,
      ``,
      `Stage 2 output: page list, nav structure, vocabulary decisions, and`,
      `strategic context. Re-importing this document under Copy Engine →`,
      `Import updates the sitemap and re-runs the coverage audit.`,
      ``,
      sitemapBlock,
      ``,
      `---`,
      ``,
      `## Coverage Audit (read-only)`,
      ``,
      `Stage 2.5 output. Included so the AI conversation can see which`,
      `coverage gaps the audit flagged when refining the sitemap. The`,
      `importer ignores this section.`,
      ``,
      coverageBlock,
      ``,
    )
  } else if (input.scope === 'copy') {
    editableSection.push(
      `## Strategic Context (read-only)`,
      ``,
      `Stage 1 output — voice exemplars, personas, x-factor, SEO targets.`,
      `Provided so the AI conversation can keep edits on-voice. The`,
      `importer ignores this section; voice/persona changes belong in`,
      `Stage 1, not here.`,
      ``,
      stage1Block,
      ``,
      `---`,
      ``,
      `## Snippets (read-only)`,
      ``,
      `Project merge-field snippets. When the copy needs to reference one of`,
      `these values, use the \`{{token}}\` form rather than typing the literal —`,
      `the Brixies render pipeline expands tokens at view time, so changing`,
      `the snippet propagates everywhere. The importer ignores this section.`,
      ``,
      snippetsBlock,
      ``,
      `---`,
      ``,
      `## Coverage Audit (read-only)`,
      ``,
      coverageBlock,
      ``,
      `---`,
      ``,
      `## Page Briefs`,
      ``,
      `One brief per page slug. The brief is the input to the Page Draft`,
      `agent — refining \`voice_exemplars_to_imitate\` here changes how`,
      `the next draft reads.`,
      ``,
      briefsBlock,
      ``,
      `---`,
      ``,
      `## Page Drafts`,
      ``,
      `One draft per page slug. The actual copy. Edit \`copy.heading\` /`,
      `\`copy.description\` / \`copy.cta\` / \`copy.cards[]\` / etc. Use the`,
      `\`{{token}}\` form for any value that appears in the Snippets section.`,
      ``,
      draftsBlock,
      ``,
    )
  } else {
    // 'full' — original layout (sitemap + briefs + drafts + coverage)
    editableSection.push(
      `## Sitemap`,
      ``,
      `Stage 2 output: page list, nav structure, vocabulary decisions, and`,
      `strategic context. Edits here propagate downstream — every page slug`,
      `you add / remove / rename must also exist (or not) in the briefs and`,
      `drafts blocks below.`,
      ``,
      sitemapBlock,
      ``,
      `---`,
      ``,
      `## Coverage Audit (read-only)`,
      ``,
      `Stage 2.5 output. Included so the AI conversation can see which`,
      `coverage gaps the audit flagged when refining the sitemap. The`,
      `importer ignores this section.`,
      ``,
      coverageBlock,
      ``,
      `---`,
      ``,
      `## Page Briefs`,
      ``,
      `One brief per page slug. The brief is the input to the Page Draft agent`,
      `— refining \`voice_exemplars_to_imitate\` here is the surest way to`,
      `change how the page reads when the next draft runs.`,
      ``,
      briefsBlock,
      ``,
      `---`,
      ``,
      `## Page Drafts`,
      ``,
      `One draft per page slug. The actual copy that lands on the page. After`,
      `editing here + importing, the next \`Commit to pages\` action will write`,
      `these to \`web_pages\` + \`web_sections\`.`,
      ``,
      draftsBlock,
      ``,
    )
  }

  tail.push(
    `---`,
    ``,
    `_End of export. Paste the entire document (including the metadata`,
    `header at top) back into Copy Engine → Import to apply changes._`,
    ``,
  )

  return [
    `# ${scopeTitle}`,
    ``,
    `- **Project**: ${input.projectName ?? '(unnamed)'}`,
    `- **Member**: ${input.member ?? '—'}`,
    `- **Project ID**: \`${input.projectId}\``,
    `- **Exported**: ${input.exportedAt}`,
    `- **Exported by**: ${input.exportedBy}`,
    `- **Format**: ${FORMAT_VERSION}`,
    `- **Scope**: ${input.scope}`,
    ``,
    `---`,
    ``,
    `## Instructions for editing`,
    ``,
    `This document is the current state of the Copy Engine for this project.`,
    `You can open it in any text editor or paste it into a Claude / ChatGPT`,
    `conversation, refine the JSON blocks below, and paste the entire result`,
    `back into the app under **Copy Engine → Import**.`,
    ``,
    `**What's editable:**`,
    `- **Sitemap**: pages[], header_nav, footer_nav, vocabulary_decisions,`,
    `  strategic context, AEO keywords. The full draft-sitemap output.`,
    `- **Page briefs**: per-page \`page_job\`, \`persona_focus\`,`,
    `  \`voice_exemplars_to_imitate\`, \`voice_anti_exemplars_to_avoid\`,`,
    `  \`atoms_assigned[]\`, \`reference_atoms[]\`, \`section_targets\`,`,
    `  \`aeo_geo_targets\`.`,
    `- **Page drafts**: per-page \`sections[]\` with \`archetype\`, \`copy\`,`,
    `  \`atoms_used\`, \`voice_notes\`. Each section's archetype must be one of:`,
    `  \`hero\`, \`tagline_band\`, \`two_up\`, \`three_up\`, \`cards_grid\`,`,
    `  \`featured_card\`, \`image_text_split\`, \`accordion\`, \`cta_band\`,`,
    `  \`testimonial_block\`, \`stat_block\`, \`steps_row\`, \`contact_band\`,`,
    `  \`footer_cta\`, \`intro_paragraph\`, \`rich_body\`.`,
    ``,
    `**What you must NOT change:**`,
    `- The metadata block above (Project, Member, Project ID, Format) — the`,
    `  importer reads Project ID + Format to validate the import target.`,
    `- The three section headers below (\`## Sitemap\`, \`## Page Briefs\`,`,
    `  \`## Page Drafts\`) — the parser locates JSON blocks by these headers.`,
    `- The page slugs across sitemap → briefs → drafts must stay consistent.`,
    `  If you rename a page in the sitemap, rename it in briefs + drafts too.`,
    ``,
    `**What's NOT in this export:**`,
    `- Content atoms / church facts (Stage 0) — those live on \`content_atoms\``,
    `  and \`church_facts\` tables and aren't roundtripped through here.`,
    `- Director critique results — auto-recomputed after draft changes.`,
    `- Engine state (last verdict, loop counts) — runtime telemetry only.`,
    ``,
    `**After import, the engine will:**`,
    `- Detect which sections changed (sitemap / briefs / drafts).`,
    `- Update \`roadmap_state\` in the database.`,
    `- If sitemap changed: the coverage audit is auto-rerun.`,
    `- If drafts changed: the Director critique becomes stale and you'll be`,
    `  prompted to re-run it.`,
    ``,
    `---`,
    ``,
    ...editableSection,
    ...tail,
  ].join('\n')
}
