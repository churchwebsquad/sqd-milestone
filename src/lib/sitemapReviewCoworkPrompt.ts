/**
 * Cowork prompt builder for applying partner feedback on a
 * sitemap_review. Produces a self-contained Markdown block a strategist
 * can paste into a fresh Claude Code session with zero project context
 * and have it run end-to-end — names the Supabase project, inlines the
 * full revise-site-strategy skill, provides exact load + persist SQL,
 * and lists the partner-feedback note IDs so the "resolve" step is
 * unambiguous.
 *
 * Extracted from SitemapFeedbackPage.tsx so both the standalone page
 * (soon-to-be embed wrapper) and the composer can render the same
 * prompt.
 */
import type { PartnerEditRequest, SitemapReview } from './sitemapReview'
// Inlined at build time so a fresh cowork session with zero project
// context has the entire revise-site-strategy contract in the paste.
// Vite's ?raw suffix reads the file as a string at bundle time.
import reviseSiteStrategySkill from '../../cowork-skills/revise-site-strategy/SKILL.md?raw'

/** Group edit requests by section_id so multiple notes on the same
 *  section render together. Preserves the order the partner left them
 *  within each section. */
export function groupBySection(
  reqs: PartnerEditRequest[],
): Array<{ section_id: string; section_label: string; items: PartnerEditRequest[] }> {
  const map = new Map<string, { section_id: string; section_label: string; items: PartnerEditRequest[] }>()
  for (const r of reqs) {
    const key = r.section_id
    if (!map.has(key)) map.set(key, { section_id: key, section_label: r.section_label, items: [] })
    map.get(key)!.items.push(r)
  }
  return [...map.values()]
}

export function buildCoworkPrompt(
  review: SitemapReview,
  projectId: string,
  churchName: string | null,
): string {
  const church = churchName ?? 'this partner'
  const openReqs = (review.partner_edit_requests ?? []).filter(r => r.status === 'open')
  const overallNotes = review.partner_notes?.trim() ?? ''
  const submittedAt = review.partner_reviewed_at ?? 'recently'
  const submittedBy = review.partner_reviewed_by ? ` by ${review.partner_reviewed_by}` : ''
  const noteIds = openReqs.map(r => `'${r.id}'`).join(', ') || `''`

  const lines: string[] = []

  // ── Preamble — orient a fresh session ──────────────────────────
  lines.push(`# Sitemap feedback ingest — ${church}`)
  lines.push('')
  lines.push('You are a fresh Claude Code session with zero project context. Everything you need is in this message — do not go hunting for other files. Read top-to-bottom, then execute the six steps at the bottom.')
  lines.push('')
  lines.push('## Environment')
  lines.push('')
  lines.push('- **App**: Squad Strategy (`sqd-milestone`) — the internal Church Media Squad tool for web strategy + copy + review.')
  lines.push('- **Supabase project**: `squad-data` (project_id `wttgwoxlezqoyzmesekt`). Use the Supabase MCP tools (`mcp__claude_ai_Supabase__execute_sql`, `mcp__claude_ai_Supabase__apply_migration`) to read + write.')
  lines.push('- **Row you are working on**: `strategy_web_projects` where `id = \'' + projectId + '\'` (church_name = "' + church + '"). Everything for this workflow lives inside the `roadmap_state` JSONB column on that row.')
  lines.push('- **Relevant JSONB paths**:')
  lines.push('    - `roadmap_state.site_strategy`   — the authored sitemap you are revising (pages, nav, persona_journeys, nav_presentation, report, _meta).')
  lines.push('    - `roadmap_state.sitemap_review`  — the partner-facing snapshot + partner\'s feedback (partner_edit_requests, partner_notes, status).')
  lines.push('    - `roadmap_state.strategic_goals` — the strategist-approved goals + voice + audience (read-only reference).')
  lines.push('    - `roadmap_state.stage_1` / `ministry_model` / `acf_plan` — upstream foundation artifacts (read-only reference).')
  lines.push('- **What "done" looks like**: `site_strategy` has your revised pages + nav with a bumped `_meta.generated_at`, every note in this feedback batch has `status: \'resolved\'` on `sitemap_review.partner_edit_requests`, and the strategist reloads the composer to see the fresh preview (which reads pages + nav straight from `site_strategy`).')
  lines.push('')

  // ── Step 1: load ───────────────────────────────────────────────
  lines.push('## Step 1 — Load current state')
  lines.push('')
  lines.push('Run this once via `mcp__claude_ai_Supabase__execute_sql`:')
  lines.push('')
  lines.push('```sql')
  lines.push('SELECT')
  lines.push('  roadmap_state->\'site_strategy\'   AS site_strategy,')
  lines.push('  roadmap_state->\'sitemap_review\'  AS sitemap_review,')
  lines.push('  roadmap_state->\'strategic_goals\' AS strategic_goals,')
  lines.push('  roadmap_state->\'stage_1\'         AS stage_1,')
  lines.push('  roadmap_state->\'ministry_model\'  AS ministry_model')
  lines.push('FROM strategy_web_projects')
  lines.push(`WHERE id = '${projectId}';`)
  lines.push('```')
  lines.push('')
  lines.push('If `site_strategy` is null or missing `_meta.generated_at`, stop and tell the strategist — this project isn\'t ready for a revise pass.')
  lines.push('')

  // ── Step 2: partner feedback (this batch) ──────────────────────
  lines.push('## Step 2 — The partner feedback you are applying')
  lines.push('')
  lines.push(`Submitted ${submittedAt}${submittedBy}. The note IDs you'll mark resolved in Step 5 are: ${noteIds}.`)
  lines.push('')

  if (overallNotes) {
    lines.push('### Overall notes')
    lines.push('')
    lines.push(overallNotes)
    lines.push('')
  }

  if (openReqs.length > 0) {
    lines.push('### Section notes')
    lines.push('')
    const grouped = groupBySection(openReqs)
    for (const group of grouped) {
      lines.push(`**${group.section_label}** (\`${group.section_id}\`)`)
      for (const r of group.items) {
        lines.push(`- (note id \`${r.id}\`) ${r.comment}${r.author_name ? ` — ${r.author_name}` : ''}`)
        if (r.suggested_change) lines.push(`  · Suggested change: ${r.suggested_change}`)
      }
      lines.push('')
    }
  }

  // ── Step 3: skill inline ───────────────────────────────────────
  lines.push('## Step 3 — The `revise-site-strategy` skill (INLINE, follow it verbatim)')
  lines.push('')
  lines.push('This is the load-bearing skill for this workflow. Follow every rule; it exists because past passes got things wrong. Ignore the frontmatter `allowed-tools` — you have Supabase MCP available regardless.')
  lines.push('')
  lines.push('<skill file="revise-site-strategy/SKILL.md">')
  lines.push(reviseSiteStrategySkill.trim())
  lines.push('</skill>')
  lines.push('')

  // ── Step 4: apply + persist ────────────────────────────────────
  lines.push('## Step 4 — Apply the changes + persist site_strategy')
  lines.push('')
  lines.push('Walk each partner note above and produce the revised `site_strategy` per the skill\'s contract. Ground rules that trip past sessions up:')
  lines.push('')
  lines.push('- **Architecture note (post-2026-07 refactor):** `site_strategy` is the single source of truth for pages + nav. The composer preview + partner portal read directly from `site_strategy` — there is NO compose step and NO stale review copy. Your write is visible immediately, no refresh needed.')
  lines.push('- **`sitemap_review` is additive only** — it holds `page_annotations[slug]` (sitemap_tag, what_changed, why_change, strategic_alignment), explainer paragraphs (intro, executive_summary, navigation_strategy), footer_info, presentation, nav_presentation, persona_postures, content_migrations, and partner feedback. DO NOT write page names or nav into `sitemap_review` — those keys have been removed from the schema.')
  lines.push('- **Do not change fields the partner did not ask about.** Leave strategist-authored fields (purpose, primary_audience, primary_funnel, nav_strategy, presentation.*, etc.) intact unless a note explicitly asks.')
  lines.push('- **Re-emit `site_strategy` end-to-end.** Every top-level key that existed before (`pages`, `nav`, `persona_journeys`, `pages_considered_dropped`, `report`, `nav_change_level`, `_meta`) must be present in the output.')
  lines.push('- **Nav-sweep on renames/removals.** Any page you rename or remove: purge stale slugs from `nav.primary`, `nav.secondary`, `nav.footer`, `nav.cta_only`, every `sitemap_review.nav_presentation.*` region (visible_top_level, header_ctas, megamenu_panels, standard_dropdowns, offcanvas_overlay) if that partner has one authored, `persona_journeys[].journey_arc/entry_points`, and any `sitemap_review.presentation.tiers` / `.congregations` if authored.')
  lines.push('- **`_meta.generated_at` bump.** Set `_meta.generated_at` to strictly newer than the value from Step 1, `_meta.revision_of` to the previous `generated_at`, `_meta.skill_name = \'revise-site-strategy\'`, `_meta.skill_version = \'1.0.0\'`. The composer no longer relies on this watermark for propagation (site_strategy is read live), but the audit trail matters — downstream steps (page allocation, outlines, drafts, critiques) watch this timestamp for stale detection.')
  lines.push('- **Walk the strategist through each edit before persisting** — pause after each proposed change for pushback. Persist ONCE at the end, not per-edit.')
  lines.push('')
  lines.push('For the write itself, use the skill\'s "chunked staging-table" pattern (§ Persist) — it\'s the only reliable path once `site_strategy` grows past ~8 KB. The four-step shape:')
  lines.push('')
  lines.push('```sql')
  lines.push('-- 1. Generate revised JSON locally + compute md5 of whole + each ~9KB chunk.')
  lines.push('-- 2. Stage:')
  lines.push('CREATE TEMP TABLE _staging_revise (ix int, body text);')
  lines.push('INSERT INTO _staging_revise VALUES (0, $dollar$<chunk 0 text>$dollar$);')
  lines.push('INSERT INTO _staging_revise VALUES (1, $dollar$<chunk 1 text>$dollar$);')
  lines.push('-- ... one INSERT per chunk')
  lines.push('')
  lines.push('-- 3. Assemble + verify + write, wrapped in IS NOT NULL so the ~300KB return payload')
  lines.push('--    doesn\'t blow the MCP output limit.')
  lines.push('WITH assembled AS (')
  lines.push('  SELECT string_agg(body, \'\' ORDER BY ix) AS body FROM _staging_revise')
  lines.push(')')
  lines.push('SELECT')
  lines.push('  CASE WHEN md5(body) = \'<LOCAL-MD5>\'')
  lines.push(`    THEN (roadmap_state_set('${projectId}'::uuid, ARRAY['site_strategy'], body::jsonb) IS NOT NULL)`)
  lines.push('    ELSE FALSE')
  lines.push('  END AS committed')
  lines.push('FROM assembled;')
  lines.push('')
  lines.push('-- 4. Drop the staging table.')
  lines.push('DROP TABLE _staging_revise;')
  lines.push('```')
  lines.push('')

  // ── Step 5: mark notes resolved ────────────────────────────────
  lines.push('## Step 5 — Mark this batch of partner notes resolved')
  lines.push('')
  lines.push('After Step 4\'s `committed = true` comes back, flip every note ID from this batch to `status: \'resolved\'`. Leaves the notes attached to the review so the audit trail survives; the composer just stops showing them as pending.')
  lines.push('')
  lines.push('```sql')
  lines.push('UPDATE strategy_web_projects')
  lines.push('SET roadmap_state = jsonb_set(')
  lines.push('  roadmap_state,')
  lines.push('  \'{sitemap_review,partner_edit_requests}\',')
  lines.push('  (')
  lines.push('    SELECT jsonb_agg(')
  lines.push(`      CASE WHEN r->>'id' IN (${noteIds})`)
  lines.push('        THEN r || \'{"status":"resolved"}\'::jsonb')
  lines.push('        ELSE r')
  lines.push('      END')
  lines.push('    )')
  lines.push('    FROM jsonb_array_elements(roadmap_state->\'sitemap_review\'->\'partner_edit_requests\') r')
  lines.push('  )')
  lines.push(`)  WHERE id = '${projectId}';`)
  lines.push('```')
  lines.push('')

  // ── Step 6: verify + hand back ─────────────────────────────────
  lines.push('## Step 6 — Verify + summarize for the strategist')
  lines.push('')
  lines.push('Confirm the write landed:')
  lines.push('')
  lines.push('```sql')
  lines.push('SELECT')
  lines.push('  roadmap_state->\'site_strategy\'->\'_meta\'->>\'generated_at\'    AS strategy_generated_at,')
  lines.push('  jsonb_array_length(roadmap_state->\'site_strategy\'->\'pages\')   AS strategy_page_count,')
  lines.push('  (SELECT jsonb_agg(p->>\'name\' ORDER BY (p->>\'nav_order\')::int NULLS LAST) FROM jsonb_array_elements(roadmap_state->\'site_strategy\'->\'pages\') p) AS strategy_page_names,')
  lines.push('  (SELECT COUNT(*) FROM jsonb_array_elements(roadmap_state->\'sitemap_review\'->\'partner_edit_requests\') r WHERE r->>\'status\' = \'open\') AS open_partner_notes')
  lines.push('FROM strategy_web_projects')
  lines.push(`WHERE id = '${projectId}';`)
  lines.push('```')
  lines.push('')
  lines.push('- `strategy_generated_at` must be strictly newer than the value from Step 1.')
  lines.push('- `strategy_page_names` should match the intended list after your edits.')
  lines.push('- `open_partner_notes` should be 0 (all this batch\'s notes resolved).')
  lines.push('')
  lines.push('Then tell the strategist:')
  lines.push('  1. What you changed, page-by-page (rename, add, drop, move, purpose edit).')
  lines.push('  2. Any partner note you did NOT apply, and why (e.g. contradicted an approved strategic_goal).')
  lines.push('  3. Any open question you couldn\'t resolve — surfaced verbatim so they can decide.')
  lines.push('')
  lines.push('The strategist will re-open the composer and confirm the batch is resolved. Then they hit "Mark all resolved & approve" if they\'re happy, or hit "Start next round" if they want to iterate again.')

  return lines.join('\n')
}
