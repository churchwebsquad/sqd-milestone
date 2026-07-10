/**
 * SitemapFeedbackPage — /web/:projectId/sitemap-feedback
 *
 * Staff-side dedicated view of a partner's content strategy feedback
 * (sitemap review). Renders once the partner has clicked "Share Sitemap
 * Review Feedback" and the review's status has flipped to
 * `partner_reviewed`. Entry points:
 *   - Content Engine → Step 6 "View partner feedback" button
 *   - #am-pm-web Slack notification's "View partner feedback" button
 *
 * Layout:
 *   Header      — church name + submitted-by + submitted-at
 *   Two columns —
 *     Left  (2/3): partner_edit_requests grouped by section_id, each
 *                  row shows the comment, suggested change, and the
 *                  original review content for that section side-by-side.
 *     Right (1/3): a ready-to-paste cowork prompt containing every
 *                  feedback item in a shape the plan-site-strategy
 *                  cowork skill can consume, plus a "mark all resolved
 *                  & approve" action once the strategist has applied
 *                  the edits.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  loadSiteStrategy,
  loadSitemapReview,
  saveSitemapReview,
  approveReview,
  startNextRound,
  type SitemapReview,
  type SiteStrategyBlob,
  type PartnerEditRequest,
} from '../../lib/sitemapReview'
// Inlined at build time so a fresh cowork session with zero project
// context has the entire revise-site-strategy contract in the paste.
// Vite's ?raw suffix reads the file as a string at bundle time.
import reviseSiteStrategySkill from '../../../cowork-skills/revise-site-strategy/SKILL.md?raw'

interface ProjectSummary {
  id:          string
  member:      number | null
  name:        string | null
  church_name: string | null
}

/** Group edit requests by section_id so multiple notes on the same
 *  section render together. Preserves the order the partner left them
 *  within each section. */
function groupBySection(reqs: PartnerEditRequest[]): Array<{ section_id: string; section_label: string; items: PartnerEditRequest[] }> {
  const map = new Map<string, { section_id: string; section_label: string; items: PartnerEditRequest[] }>()
  for (const r of reqs) {
    const key = r.section_id
    if (!map.has(key)) map.set(key, { section_id: key, section_label: r.section_label, items: [] })
    map.get(key)!.items.push(r)
  }
  return [...map.values()]
}

/** Render the original review content for a section, so the strategist
 *  sees exactly what the partner was looking at when they left their
 *  note. Falls back to a compact "n/a" pill when the section id doesn't
 *  match a known slot on the review (e.g. legacy section id from an
 *  older schema version).
 *
 *  Post-2026-07 refactor: page-level facts (name, purpose, audience,
 *  funnel) come from `siteStrategy.pages`; review-owned annotations
 *  (what_changed, why_change, strategic_alignment) come from
 *  `review.page_annotations`. */
function contextForSection(
  review: SitemapReview,
  siteStrategy: SiteStrategyBlob | null,
  sectionId: string,
): { label: string; body: string | null } {
  // page-<slug> → look up the page from site_strategy + annotations
  if (sectionId.startsWith('page-')) {
    const slug = sectionId.slice(5)
    const strategyPg = (siteStrategy?.pages ?? []).find(p => p.slug === slug)
    const ann = review.page_annotations?.[slug]
    if (strategyPg || ann) {
      const lines = [
        strategyPg?.purpose ? `Purpose: ${strategyPg.purpose}` : null,
        strategyPg?.primary_audience ? `Audience: ${strategyPg.primary_audience}` : null,
        strategyPg?.primary_funnel ? `Funnel: ${strategyPg.primary_funnel}` : null,
        ann?.what_changed ? `What changed: ${ann.what_changed}` : null,
        ann?.why_change ? `Why change: ${ann.why_change}` : null,
        ann?.strategic_alignment ? `Strategic alignment: ${ann.strategic_alignment}` : null,
      ].filter(Boolean)
      return {
        label: `Page: ${strategyPg?.name ?? slug}`,
        body: lines.length > 0 ? lines.join('\n') : null,
      }
    }
    return { label: `Page: ${slug}`, body: null }
  }
  if (sectionId === 'intro') {
    return { label: 'Introduction', body: review.intro ? `${review.intro.headline}\n\n${review.intro.body}` : null }
  }
  if (sectionId === 'executive-summary' || sectionId === 'what-changed') {
    return { label: 'Executive summary / what changed', body: review.executive_summary ?? null }
  }
  if (sectionId === 'why' || sectionId === 'navigation-strategy') {
    return { label: 'Navigation strategy', body: review.navigation_strategy ?? null }
  }
  if (sectionId === 'nav-primary') {
    const nav = siteStrategy?.nav?.primary ?? []
    const labels = nav.map(item => typeof item === 'string' ? item : (item.label ?? item.slug ?? '')).filter(Boolean)
    return { label: 'Primary nav', body: labels.join(' · ') || null }
  }
  if (sectionId === 'nav-secondary') {
    const nav = siteStrategy?.nav?.secondary ?? []
    const labels = nav.map(item => typeof item === 'string' ? item : (item.label ?? item.slug ?? '')).filter(Boolean)
    return { label: 'Secondary nav', body: labels.join(' · ') || null }
  }
  if (sectionId === 'footer') {
    return { label: 'Footer', body: review.footer_info ? JSON.stringify(review.footer_info, null, 2) : null }
  }
  if (sectionId === 'hubs') {
    return { label: 'Persona hubs', body: (review.persona_postures ?? []).map(p => `${p.persona_name}: ${p.goal ?? ''}`).join('\n') || null }
  }
  return { label: sectionId, body: null }
}

/** Compose a self-contained cowork prompt the strategist can paste
 *  into a fresh Claude Code session with zero project context and
 *  have it run end-to-end. The prompt names the Supabase project,
 *  inlines the full revise-site-strategy skill, provides the exact
 *  load + persist SQL, and lists the partner-feedback note IDs so
 *  the "resolve" step is unambiguous. */
function buildCoworkPrompt(review: SitemapReview, projectId: string, churchName: string | null): string {
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
  lines.push('The strategist will re-open `/web/' + projectId + '/sitemap-feedback` and confirm the batch is resolved. Then they hit "Mark all resolved & approve" in the composer if they\'re happy.')

  return lines.join('\n')
}

export default function SitemapFeedbackPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [review, setReview]   = useState<SitemapReview | null>(null)
  const [siteStrategy, setSiteStrategy] = useState<SiteStrategyBlob | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)

  const reload = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    const [projRes, rev, strategy] = await Promise.all([
      supabase.from('strategy_web_projects').select('id, member, name, church_name').eq('id', projectId).maybeSingle<ProjectSummary>(),
      loadSitemapReview(supabase, projectId),
      loadSiteStrategy(supabase, projectId),
    ])
    if (projRes.error) setError(projRes.error.message)
    setProject(projRes.data ?? null)
    setReview(rev)
    setSiteStrategy(strategy)
    setLoading(false)
  }, [projectId])

  
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload() }, [reload])

  const openReqs = useMemo(
    () => review ? (review.partner_edit_requests ?? []).filter(r => r.status === 'open') : [],
    [review],
  )
  const groups = useMemo(() => groupBySection(openReqs), [openReqs])

  const prompt = useMemo(
    () => review ? buildCoworkPrompt(review, projectId ?? '', project?.church_name ?? null) : '',
    [review, projectId, project?.church_name],
  )

  const copyPrompt = useCallback(async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Could not copy — select the text and copy manually.')
    }
  }, [prompt])

  const markOneResolved = useCallback(async (id: string) => {
    if (!review || !projectId) return
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).map(r =>
        r.id === id ? { ...r, status: 'resolved' as const } : r,
      ),
    }
    setSaving(true)
    const res = await saveSitemapReview(supabase, projectId, next)
    setSaving(false)
    if (res.ok) {
      setReview(next)
    } else {
      setError(res.error)
    }
  }, [review, projectId])

  const markAllResolvedAndApprove = useCallback(async () => {
    if (!review || !projectId) return
    if (!confirm('Mark every partner note resolved and approve the sitemap as canonical? Downstream tools will read from it.')) return
    const withResolved: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).map(r => ({ ...r, status: 'resolved' as const })),
    }
    const approved = approveReview(withResolved, 'staff')
    setSaving(true)
    const res = await saveSitemapReview(supabase, projectId, approved)
    setSaving(false)
    if (res.ok) setReview(approved)
    else setError(res.error)
  }, [review, projectId])

  const startNextRoundHere = useCallback(async () => {
    if (!review || !projectId) return
    if (!confirm(`Start Round ${(review.round_number ?? 1) + 1}? The current round's partner feedback and drafted state get snapshotted into round history, then the review resets to draft so you can iterate. Nothing gets deleted.`)) return
    const next = startNextRound(review, { siteStrategyGeneratedAt: siteStrategy?._meta?.generated_at })
    setSaving(true)
    const res = await saveSitemapReview(supabase, projectId, next)
    setSaving(false)
    if (res.ok) setReview(next)
    else setError(res.error)
  }, [review, projectId, siteStrategy])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8 flex items-center gap-2 text-wm-text-muted text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading partner feedback…
      </div>
    )
  }

  if (error && !review) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-wm-danger">{error}</p>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="text-wm-accent underline text-sm">Back to Content Engine</Link>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-3">
        <h1 className="text-lg font-semibold text-wm-text">No content strategy review yet</h1>
        <p className="text-wm-text-muted text-[13px]">
          There isn't a content strategy review for this project yet, so there's nothing to review. Head back to the Content Engine, run Step 6, and use <strong>Create content strategy review</strong> to draft one.
        </p>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="inline-flex items-center gap-1 text-wm-accent text-[13px] font-semibold hover:underline">
          <ArrowLeft size={13} /> Back to Content Engine
        </Link>
      </div>
    )
  }

  const submittedAt = review.partner_reviewed_at
    ? new Date(review.partner_reviewed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null
  const isApproved = review.status === 'approved'
  const hasOverall = !!review.partner_notes?.trim()

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <Link to={`/web/${projectId ?? ''}?tab=cowork`} className="inline-flex items-center gap-1 text-wm-text-muted hover:text-wm-text text-[12px]">
          <ArrowLeft size={12} /> Back to Content Engine
        </Link>
        <h1 className="text-2xl font-semibold text-wm-text mt-2">
          {project?.church_name ?? 'Partner'} content strategy feedback
        </h1>
        <p className="text-wm-text-muted text-[13px] mt-1">
          {review.partner_reviewed_by
            ? <>Submitted by <strong className="text-wm-text">{review.partner_reviewed_by}</strong></>
            : 'Submitted by the partner'}
          {submittedAt && <> · {submittedAt}</>}
          {isApproved && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-wm-success-bg text-wm-success">
              <Check size={10} /> Approved as canonical
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feedback list */}
        <section className="lg:col-span-2 space-y-4">
          {hasOverall && (
            <article className="rounded-xl border border-wm-border bg-wm-bg-elevated p-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2">Overall notes</p>
              <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-wm-text">{review.partner_notes}</p>
            </article>
          )}

          {groups.length === 0 && !hasOverall && (
            <article className="rounded-xl border border-wm-border bg-wm-bg-elevated p-6 text-center">
              <p className="text-wm-text font-medium">No open partner notes.</p>
              <p className="text-wm-text-muted text-[12px] mt-1">
                Everything on this review has already been resolved. If the partner needs to send more, they can come back to their review portal.
              </p>
            </article>
          )}

          {groups.map(group => {
            const context = contextForSection(review, siteStrategy, group.section_id)
            return (
              <article key={group.section_id} className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden">
                <header className="px-4 py-3 border-b border-wm-border flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">{group.section_label}</p>
                    <p className="text-[11px] text-wm-text-muted font-mono mt-0.5">{group.section_id}</p>
                  </div>
                  <span className="text-[11px] text-wm-text-muted shrink-0">
                    {group.items.length} note{group.items.length === 1 ? '' : 's'}
                  </span>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                  <div className="space-y-3">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Partner said</p>
                    <ul className="space-y-3">
                      {group.items.map(r => (
                        <li key={r.id} className="rounded-md border border-wm-border bg-wm-bg p-3">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <span className="text-[12px] font-semibold text-wm-text">{r.author_name || 'Partner'}</span>
                            <span className="text-[10.5px] text-wm-text-subtle">
                              {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[13px] text-wm-text whitespace-pre-wrap leading-snug">{r.comment}</p>
                          {r.suggested_change && (
                            <div className="mt-2 pt-2 border-t border-dashed border-wm-border">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-wm-accent-strong mb-0.5">Suggested change</p>
                              <p className="text-[12.5px] text-wm-text whitespace-pre-wrap leading-snug">{r.suggested_change}</p>
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void markOneResolved(r.id)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
                          >
                            <Check size={11} /> Mark resolved
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">What the partner was looking at</p>
                    {context.body ? (
                      <pre className="whitespace-pre-wrap text-[12.5px] text-wm-text bg-wm-bg rounded-md border border-wm-border p-3 leading-snug">{context.body}</pre>
                    ) : (
                      <p className="text-[12px] text-wm-text-muted italic">No matching section content found on the current draft, this note likely references a page or section that has since been renamed or removed.</p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </section>

        {/* Cowork prompt */}
        <aside className="lg:col-span-1">
          <div className="rounded-xl border border-wm-border bg-wm-bg-elevated overflow-hidden lg:sticky lg:top-6">
            <header className="px-4 py-3 border-b border-wm-border">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Ready-to-paste cowork prompt</p>
              <p className="text-[11px] text-wm-text-muted mt-1">
                Copy this and paste into a plan-site-strategy Cowork session to apply the feedback.
              </p>
            </header>
            <textarea
              readOnly
              value={prompt}
              className="w-full text-[11.5px] font-mono text-wm-text bg-wm-bg leading-snug px-4 py-3 border-b border-wm-border outline-none resize-y min-h-[240px]"
            />
            <div className="p-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void copyPrompt()}
                disabled={!prompt}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-md bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover disabled:opacity-50"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
              {!isApproved && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void startNextRoundHere()}
                    disabled={saving || review.status !== 'partner_reviewed'}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-wm-accent-strong text-white hover:bg-wm-accent disabled:opacity-50"
                    title="Snapshot this round's feedback and open Round N+1 as a new draft in the composer."
                  >
                    {saving ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
                    Start next round →
                  </button>
                  <button
                    type="button"
                    onClick={() => void markAllResolvedAndApprove()}
                    disabled={saving}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-wm-success/50 text-wm-success hover:bg-wm-success-bg disabled:opacity-50"
                    title="Mark every note resolved and lock the sitemap as canonical for downstream tools."
                  >
                    Mark all resolved &amp; approve
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
