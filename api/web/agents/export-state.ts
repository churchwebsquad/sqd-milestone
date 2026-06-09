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
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('id, name, member, roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const state = (project.roadmap_state ?? {}) as Record<string, any>
  const sitemap = state.stage_2 ?? null
  const briefs  = stripMetaKey(state.page_briefs ?? {})
  const drafts  = stripMetaKey(state.page_drafts ?? {})

  const document = renderExportDocument({
    projectName: project.name as string | null,
    member:      project.member as number | null,
    projectId:   project.id as string,
    exportedAt:  new Date().toISOString(),
    exportedBy:  userData.user.email ?? userData.user.id,
    sitemap,
    briefs,
    drafts,
  })

  const safeName = String(project.name ?? `project-${project.id}`)
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
  const filename = `${safeName}-copy-engine-${new Date().toISOString().slice(0, 10)}.md`

  return res.status(200).json({
    ok: true,
    document,
    filename,
    format_version: FORMAT_VERSION,
    sections: {
      sitemap_present: !!sitemap,
      briefs_count:    Object.keys(briefs).length,
      drafts_count:    Object.keys(drafts).length,
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
  sitemap:     any
  briefs:      Record<string, any>
  drafts:      Record<string, any>
}): string {
  const sitemapBlock = input.sitemap
    ? '```json\n' + JSON.stringify(input.sitemap, null, 2) + '\n```'
    : '_(no sitemap drafted yet)_'

  const briefsBlock = Object.keys(input.briefs).length > 0
    ? '```json\n' + JSON.stringify(input.briefs, null, 2) + '\n```'
    : '_(no page briefs yet — run the engine\'s "Run drafts" action to generate them)_'

  const draftsBlock = Object.keys(input.drafts).length > 0
    ? '```json\n' + JSON.stringify(input.drafts, null, 2) + '\n```'
    : '_(no page drafts yet)_'

  return [
    `# Copy Engine Export`,
    ``,
    `- **Project**: ${input.projectName ?? '(unnamed)'}`,
    `- **Member**: ${input.member ?? '—'}`,
    `- **Project ID**: \`${input.projectId}\``,
    `- **Exported**: ${input.exportedAt}`,
    `- **Exported by**: ${input.exportedBy}`,
    `- **Format**: ${FORMAT_VERSION}`,
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
    `- The coverage audit (Stage 2.5) — auto-recomputed after sitemap changes.`,
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
    `---`,
    ``,
    `_End of export. Paste the entire document (including the metadata`,
    `header at top) back into Copy Engine → Import to apply changes._`,
    ``,
  ].join('\n')
}
