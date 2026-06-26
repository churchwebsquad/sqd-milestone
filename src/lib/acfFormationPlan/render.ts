// Pure render functions for the formation plan. Both the CLI
// (`scripts/translate-formation-plan.ts`) and the in-app
// DevHandoffWorkspace panel call into these so the markdown + JSON
// exports are byte-identical between the two surfaces.
//
// No Node-only deps — safe to import from React.

import type {
  AcfField,
  AcfFieldGroup,
  ContentModelPlan,
  WpObject,
  WpObjectCpt,
  WpObjectOptionsPage,
  WpObjectRepeater,
} from './types'

// ─── Open-question owner routing ──────────────────────────────────────

export type QuestionOwner = 'Strategist' | 'McNeel'

/** Decides who needs to answer a given open question. McNeel answers
 *  implementation/display questions; everything else falls to the
 *  strategist (content decisions). */
export function ownerForQuestion(q: string): QuestionOwner {
  const lower = q.toLowerCase()
  if (lower.includes('bricks') ||
      lower.includes('flexible content') ||
      lower.includes('nestable') ||
      lower.includes('template variant') ||
      lower.includes('field type') ||
      lower.includes('implementation')) {
    return 'McNeel'
  }
  return 'Strategist'
}

/** Stable id for an open question — used to persist answers
 *  separately from the plan (so recomputing doesn't wipe answers).
 *  Hash of the question text only, since the text is the natural key
 *  (same text → same answer, even if it fires from different sources). */
export function openQuestionId(text: string): string {
  const normalized = text.trim().toLowerCase()
  let h = 0
  for (let i = 0; i < normalized.length; i++) {
    h = (h * 31 + normalized.charCodeAt(i)) | 0
  }
  return `q_${(h >>> 0).toString(36)}`
}

export interface AggregatedQuestion {
  id:     string
  text:   string
  owner:  QuestionOwner
  /** Where this question fires from (page/item label or wp_object id). */
  sources: string[]
}

/** Walks the whole plan, collects every open_question once (deduped
 *  by text), tags owner, lists sources. Used by both the markdown
 *  renderer and the in-app answer UI. */
export function aggregateOpenQuestions(plan: ContentModelPlan): AggregatedQuestion[] {
  const map = new Map<string, AggregatedQuestion>()
  const add = (text: string, source: string) => {
    const t = text.trim()
    if (!t) return
    const id = openQuestionId(t)
    const e = map.get(id) ?? { id, text: t, owner: ownerForQuestion(t), sources: [] }
    if (!e.sources.includes(source)) e.sources.push(source)
    map.set(id, e)
  }
  for (const c of plan.layer_1_classifications) {
    for (const q of c.open_questions) add(q, `${c.page_slug}/${c.item_label}`)
  }
  for (const o of plan.layer_2_wp_objects) {
    const qs = (o as { open_questions?: string[] }).open_questions
    if (qs) for (const q of qs) add(q, o.id)
  }
  return [...map.values()]
}

// ─── Content-import JSON (sidecar for AI ingest) ──────────────────────

export interface ContentImportShape {
  schema_version: 1
  generated_at: string
  options_pages: Array<{ slug: string; fields: AcfField[]; record: Record<string, unknown> | null }>
  custom_post_types: Array<{ slug: string; fields: AcfField[]; records: Array<Record<string, unknown>> }>
  repeaters: Array<{ on_page_slug: string; field_group_key: string; fields: AcfField[]; rows: Array<Record<string, unknown>> }>
}

function findGroupForObject(plan: ContentModelPlan, o: WpObject): AcfFieldGroup | null {
  return plan.layer_3_acf_field_groups.find(g =>
    g.location.some(or => or.some(rule =>
      (rule.param === 'options_page'  && o.kind === 'options_page'    && rule.value === (o as WpObjectOptionsPage).slug) ||
      (rule.param === 'post_type'     && o.kind === 'custom_post_type' && rule.value === (o as WpObjectCpt).slug) ||
      (rule.param === 'page_template' && o.kind === 'repeater'         && rule.value === `page-${(o as WpObjectRepeater).on_page_slug}.php`)
    ))
  ) ?? null
}

export function buildContentImport(plan: ContentModelPlan): ContentImportShape {
  const options: ContentImportShape['options_pages'] = []
  const cpts:    ContentImportShape['custom_post_types'] = []
  const reps:    ContentImportShape['repeaters'] = []
  for (const o of plan.layer_2_wp_objects) {
    const group = findGroupForObject(plan, o)
    if (!group) continue
    if (o.kind === 'options_page') {
      options.push({ slug: o.slug, fields: group.fields, record: group._content_rows?.[0] ?? null })
    } else if (o.kind === 'custom_post_type') {
      cpts.push({ slug: o.slug, fields: group.fields, records: group._content_rows ?? [] })
    } else if (o.kind === 'repeater') {
      reps.push({
        on_page_slug:    o.on_page_slug,
        field_group_key: group.key,
        fields:          group.fields,
        rows:            group._content_rows ?? [],
      })
    }
  }
  return {
    schema_version: 1,
    generated_at:   plan._meta.generated_at,
    options_pages:  options,
    custom_post_types: cpts,
    repeaters:      reps,
  }
}

// ─── ACF JSON Sync export (strips internal markers) ───────────────────

function stripPrivateAcf(field: unknown): unknown {
  if (field == null || typeof field !== 'object') return field
  const f = field as Record<string, unknown>
  const { _source: _s, _cta_analysis: _c, ...rest } = f
  const out: Record<string, unknown> = { ...rest }
  if (Array.isArray(f.sub_fields)) {
    out.sub_fields = (f.sub_fields as unknown[]).map(stripPrivateAcf)
  }
  return out
}

/** ACF JSON Sync compatible export: array of field groups with the
 *  private hint markers stripped. Drop into wp-content/acf-json/ or
 *  paste into ACF Pro's Tools > Import Field Groups. */
export function toAcfJsonSync(plan: ContentModelPlan): unknown[] {
  return plan.layer_3_acf_field_groups.map(g => {
    const { _source_section_ids: _ssi, _content_rows: _cr, ...rest } = g
    return { ...rest, fields: rest.fields.map(stripPrivateAcf) }
  })
}

// ─── Markdown renderer ────────────────────────────────────────────────

export interface RenderMarkdownOpts {
  /** Optional source-file hint shown in the doc header. */
  sourceHint?: string
  /** Map of question-id → answer text. Renders next to each question
   *  in the open-questions section instead of an empty line. Both the
   *  CLI and the in-app downloader can pass answers when they're
   *  available; the CLI passes nothing and gets empty lines. */
  answers?: Record<string, string>
}

export function renderPlanAsMarkdown(plan: ContentModelPlan, opts: RenderMarkdownOpts = {}): string {
  const lines: string[] = []
  const m = plan._meta
  const sourceLine = opts.sourceHint ? `*Translated from* \`${opts.sourceHint}\`\n` : ''

  lines.push(`# Formation Plan — Dev Handoff`)
  lines.push(``)
  if (sourceLine) lines.push(sourceLine.trimEnd())
  lines.push(`*Generated* ${new Date(m.generated_at).toLocaleString()} *fingerprint* \`${m.input_fingerprint}\``)
  lines.push(``)
  lines.push(`## How to use this doc`)
  lines.push(``)
  lines.push(`1. **Open questions first** — strategist + McNeel decide the open content/implementation questions. Don't start modelling until they're answered.`)
  lines.push(`2. **Read "What's sitting here to be organized"** — this is the partner content the analyzer found, grouped by concept. You decide how to model it. The analyzer's suggested CPT / Options / Repeater structure is at the end as a reference, not a directive.`)
  lines.push(`3. **Populate the content** using the sidecar \`<filename>.content-import.json\` — each modelled object has a matching block with records ready to seed via your AI assistant or wp-cli.`)
  lines.push(``)
  lines.push(`## At a glance`)
  lines.push(``)
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|------:|`)
  lines.push(`| Classifications (one per piece of content) | ${m.counts.classifications} |`)
  lines.push(`| WordPress objects suggested | ${m.counts.wp_objects} |`)
  lines.push(`| ACF field groups suggested | ${m.counts.acf_field_groups} |`)
  lines.push(`| Open questions (need an answer before build) | ${m.counts.open_questions} |`)
  lines.push(`| Low-confidence classifications | ${m.counts.low_confidence} |`)
  lines.push(``)

  renderOpenQuestions(plan, lines, opts.answers ?? {})

  // ── Discovery section — what was found, grouped by concept ──────
  renderConceptsFound(plan, lines)

  // ── Repeated patterns across pages — bulletin buttons etc. ──────
  renderRepeatedPatterns(plan, lines)

  // ── Analyzer's recommendation (review + adjust) ─────────────────
  // The same data, framed as "here's a suggested model." Dev consults
  // this AFTER they've decided what they want to build; it's a
  // reference, not a starting point.
  lines.push(`## Analyzer's recommended model (review + adjust)`)
  lines.push(``)
  lines.push(`Suggested WordPress objects + ACF field groups for the content found above. **This is a starting point — disagree freely.** Registration args, taxonomy slugs, ACF field types: all editable. The sidecar \`.content-import.json\` matches this shape; if you change the model, you'll re-shape the import to match.`)
  lines.push(``)
  const cpts    = plan.layer_2_wp_objects.filter((o): o is WpObjectCpt          => o.kind === 'custom_post_type')
  const options = plan.layer_2_wp_objects.filter((o): o is WpObjectOptionsPage  => o.kind === 'options_page')
  const reps    = plan.layer_2_wp_objects.filter((o): o is WpObjectRepeater     => o.kind === 'repeater')
  const exts    = plan.layer_2_wp_objects.filter(o => o.kind === 'external')

  if (cpts.length > 0) {
    lines.push(`### Suggested Custom Post Types (${cpts.length})`)
    lines.push(``)
    for (const cpt of cpts) renderCpt(cpt, findGroupForObject(plan, cpt), lines)
  }
  if (options.length > 0) {
    lines.push(`### Suggested Global Settings / Options Page (${options.length})`)
    lines.push(``)
    for (const o of options) renderOptions(o, findGroupForObject(plan, o), lines)
  }
  if (exts.length > 0) {
    lines.push(`### Managed in a third-party system (${exts.length})`)
    lines.push(``)
    lines.push(`Partner answered "external" / "embed" / "contact" on these — no local CPT created.`)
    lines.push(``)
    for (const e of exts) {
      const ext = e as Extract<WpObject, { kind: 'external' }>
      lines.push(`- **${ext.id}** — display mode \`${ext.display_mode}\`${ext.rationale ? ` — ${ext.rationale}` : ''}`)
    }
    lines.push(``)
  }
  if (reps.length > 0) renderRepeaters(reps, plan, lines)

  lines.push(`---`)
  lines.push(`*Plan stored at \`strategy_web_projects.roadmap_state.content_model_plan\`.*`)
  lines.push(``)
  return lines.join('\n')
}

// ─── Discovery-first rendering ────────────────────────────────────────

/** Humanize a CPT slug into a display label. "event" → "Events";
 *  "staff" → "Staff"; "career" → "Careers"; etc. Falls back to
 *  Title-Case + 's' for unknown slugs. */
function conceptLabelForSlug(slug: string): string {
  const known: Record<string, string> = {
    staff:  'Staff',
    event:  'Events',
    sermon: 'Sermons',
    group:  'Groups',
    career: 'Careers',
    post:   'Blog Posts',
  }
  if (known[slug]) return known[slug]
  const cap = slug.charAt(0).toUpperCase() + slug.slice(1)
  return cap.endsWith('s') ? cap : `${cap}s`
}

/** "What's sitting here to be organized" — concept-grouped discovery
 *  view. Leads with what was found, not what to build. Designed so
 *  McNeel can scan, disagree with placement decisions, and form his
 *  own model before reading the analyzer's suggestion. */
function renderConceptsFound(plan: ContentModelPlan, lines: string[]) {
  const cpts    = plan.layer_2_wp_objects.filter((o): o is WpObjectCpt         => o.kind === 'custom_post_type')
  const options = plan.layer_2_wp_objects.filter((o): o is WpObjectOptionsPage => o.kind === 'options_page')
  if (cpts.length === 0 && options.length === 0) return

  lines.push(`## What's sitting here to be organized`)
  lines.push(``)
  lines.push(`Grouped by concept. The analyzer's job here is to **show you what's there**, not to decide how it should be modelled. Each concept lists the records found, where they live on the site, and the data points carried per record. The analyzer's suggested WordPress structure for each concept is in the "Recommended model" section at the bottom.`)
  lines.push(``)

  // CPT concepts — these are the per-content-type groupings
  for (const cpt of cpts) {
    const group = findGroupForObject(plan, cpt)
    const rows = group?._content_rows ?? []
    const sourcePages = new Set<string>()
    const sourceSectionCount = group?._source_section_ids?.length ?? 0
    // Walk classifications to recover the pages this concept appears on
    for (const c of plan.layer_1_classifications) {
      if (c.cpt_subroutine_ref === cpt.id) sourcePages.add(c.page_slug)
    }
    const pageList = [...sourcePages]
    lines.push(`### ${conceptLabelForSlug(cpt.slug)}`)
    lines.push(``)
    if (rows.length === 0) {
      lines.push(`*No records extracted yet — the content for this concept may still be in template placeholder state, or the listing sections haven't been bound. Confirm with the strategist.*`)
      lines.push(``)
      continue
    }
    lines.push(`**${rows.length} record${rows.length === 1 ? '' : 's'} found** across ${pageList.length} page${pageList.length === 1 ? '' : 's'}${sourceSectionCount > 0 ? ` (${sourceSectionCount} section${sourceSectionCount === 1 ? '' : 's'})` : ''}.`)
    lines.push(``)
    if (pageList.length > 0) {
      lines.push(`**Pages:** ${pageList.slice(0, 8).map(p => `\`/${p}\``).join(', ')}${pageList.length > 8 ? ` (+${pageList.length - 8} more)` : ''}`)
      lines.push(``)
    }
    // Distinct field names observed across records (excluding internal markers)
    const fieldsSeen = new Set<string>()
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (k.startsWith('_')) continue
        fieldsSeen.add(k)
      }
    }
    if (fieldsSeen.size > 0) {
      lines.push(`**Data points per record:** ${[...fieldsSeen].map(f => `\`${f}\``).join(' · ')}`)
      lines.push(``)
    }
    // Partner form answers — surface here so it's part of the
    // discovery, not buried in the "suggested model" section.
    if (cpt._content_collection_answers) {
      const filled = cpt._content_collection_answers.fields.filter(({ value }) => value != null && String(value).trim() !== '' && String(value).trim() !== '-')
      if (filled.length > 0) {
        lines.push(`**Partner Content Collection answers:**`)
        lines.push(``)
        for (const { label, value } of filled) {
          lines.push(`- *${label}*: ${formatAnswerValue(value)}`)
        }
        lines.push(``)
      }
    }
    // Sample records — pull human-readable summaries (names) not raw JSON
    const sampleNames = rows.slice(0, 5).map(summarizeRow).filter(s => s !== 'Record (no name)')
    if (sampleNames.length > 0) {
      lines.push(`**Sample:** ${sampleNames.map(n => `*${n}*`).join(' · ')}${rows.length > sampleNames.length ? ` (+${rows.length - sampleNames.length} more in the sidecar import JSON)` : ''}`)
      lines.push(``)
    }
    lines.push(`*Decide how to model this. The analyzer's suggestion is in [Recommended model](#analyzers-recommended-model-review--adjust) below; full record data + ACF field shape is in the sidecar \`.content-import.json\`.*`)
    lines.push(``)
  }

  // Options page = site-wide globals concept
  for (const opt of options) {
    const group = findGroupForObject(plan, opt)
    const row = group?._content_rows?.[0] ?? {}
    const filled = Object.entries(row).filter(([k, v]) => !k.startsWith('_') && v != null && String(v).trim() !== '')
    lines.push(`### Site-wide globals`)
    lines.push(``)
    lines.push(`Single-source content that appears in multiple places on the site (church name, contact, service times, social links, etc.). Edited once, propagates everywhere.`)
    lines.push(``)
    if (filled.length === 0) {
      lines.push(`*No global values filled in yet — confirm with the strategist if any of these are intentional.*`)
      lines.push(``)
    } else {
      lines.push(`**${filled.length} value${filled.length === 1 ? '' : 's'} filled in.**`)
      lines.push(``)
      for (const [k, v] of filled.slice(0, 15)) {
        lines.push(`- *${k}*: ${formatAnswerValue(v)}`)
      }
      if (filled.length > 15) lines.push(`- *(+${filled.length - 15} more in the sidecar JSON)*`)
      lines.push(``)
    }
  }
}

// ─── Repeated patterns across pages ───────────────────────────────────

/** Aggregates CTA destinations across pages, flagging field names
 *  that appear on 3+ pages. The classic example: a "bulletin button"
 *  that fires on every page with a different URL — when McNeel sees
 *  this, he can decide whether to make it a global setting or a
 *  per-page repeater. */
function renderRepeatedPatterns(plan: ContentModelPlan, lines: string[]) {
  interface CtaSighting {
    field:      string
    page_slug:  string
    url:        string
    route_type: string
  }
  const sightings: CtaSighting[] = []
  for (const g of plan.layer_3_acf_field_groups) {
    const rows = g._content_rows ?? []
    // Recover page slug from the field group's location rule. For
    // repeaters we can derive it; for CPTs + Options the location
    // isn't page-scoped — skip.
    const pageRule = g.location.find(or => or.some(r => r.param === 'page_template'))
    if (!pageRule) continue
    const pageTemplateValue = pageRule.find(r => r.param === 'page_template')?.value ?? ''
    const pageSlug = pageTemplateValue.replace(/^page-/, '').replace(/\.php$/, '')
    for (const row of rows) {
      const ctas = row._cta_routes as Array<{ field: string; url: string; route_type: string }> | undefined
      if (!Array.isArray(ctas)) continue
      for (const c of ctas) {
        // Normalize the field name to its last segment so e.g.
        // "buttons[0].contact_url" matches "contact_url" on another page.
        const lastSeg = c.field.split(/[.\[\]]/).filter(Boolean).pop() ?? c.field
        const normalized = lastSeg.endsWith('_url') ? lastSeg.replace(/_url$/, '') : lastSeg
        sightings.push({ field: normalized, page_slug: pageSlug, url: c.url, route_type: c.route_type })
      }
    }
  }
  if (sightings.length === 0) return

  // Group by normalized field name
  const byField = new Map<string, CtaSighting[]>()
  for (const s of sightings) {
    const list = byField.get(s.field) ?? []
    list.push(s)
    byField.set(s.field, list)
  }
  // Only surface patterns that appear on 3+ distinct pages — those are
  // the candidates for a global setting or a project-wide repeater.
  const patterns = [...byField.entries()]
    .map(([field, list]) => {
      const pages = new Set(list.map(s => s.page_slug))
      const urls  = new Set(list.map(s => s.url))
      return { field, list, pages, urls }
    })
    .filter(p => p.pages.size >= 3)
    .sort((a, b) => b.pages.size - a.pages.size)
  if (patterns.length === 0) return

  lines.push(`## Repeated patterns across pages`)
  lines.push(``)
  lines.push(`CTAs / buttons / values the analyzer found firing on **3+ pages**. These are candidates for site-wide globals (one editable surface, propagates everywhere) or project-scoped repeaters (one editable list, referenced by multiple page templates). When a button changes frequently — e.g. a weekly bulletin link — globalizing it saves the editor from chasing it across every page.`)
  lines.push(``)
  for (const p of patterns) {
    const sameUrl   = p.urls.size === 1
    const dominantRoute = [...new Map(p.list.map(s => [s.route_type, (p.list.filter(x => x.route_type === s.route_type).length)])).entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    lines.push(`### \`${p.field}\` — appears on ${p.pages.size} pages`)
    lines.push(``)
    lines.push(`- **Pages:** ${[...p.pages].slice(0, 8).map(s => `\`/${s}\``).join(', ')}${p.pages.size > 8 ? ` (+${p.pages.size - 8} more)` : ''}`)
    lines.push(`- **Destination type${p.urls.size > 1 ? 's' : ''}:** ${dominantRoute ?? 'mixed'}${sameUrl ? ' (same URL everywhere)' : ` (${p.urls.size} distinct URLs)`}`)
    if (sameUrl) {
      const onlyUrl = [...p.urls][0]
      lines.push(`- **URL:** \`${truncate(onlyUrl, 100)}\``)
      lines.push(`- *Same URL on every page → strong candidate for a site-wide global. One ACF Options field instead of duplicating across page templates.*`)
    } else {
      const sampleUrls = [...p.urls].slice(0, 3)
      lines.push(`- **Sample URLs:** ${sampleUrls.map(u => `\`${truncate(u, 60)}\``).join(' · ')}`)
      lines.push(`- *Different URLs per page → could be a project-wide repeater (one editable list, page templates pick which entry) OR genuinely per-page if each page has unique intent. Strategist confirms.*`)
    }
    lines.push(``)
  }
}

function renderOpenQuestions(plan: ContentModelPlan, lines: string[], answers: Record<string, string>) {
  const all = aggregateOpenQuestions(plan)
  if (all.length === 0) return
  const strategist = all.filter(q => q.owner === 'Strategist')
  const mcneel     = all.filter(q => q.owner === 'McNeel')

  lines.push(`## Open questions — answer before building`)
  lines.push(``)
  lines.push(`Each question has an **Answer** line. The owner writes their decision back in; once filled in, the dev unblocks.`)
  lines.push(``)
  if (strategist.length > 0) {
    lines.push(`### For the Strategist (${strategist.length})`)
    lines.push(``)
    lines.push(`Content / modelling decisions — what the site should HAVE, not how it's wired.`)
    lines.push(``)
    strategist.forEach((q, i) => renderQuestion(`Q${i + 1}`, q, lines, answers))
  }
  if (mcneel.length > 0) {
    lines.push(`### For McNeel (${mcneel.length})`)
    lines.push(``)
    lines.push(`Implementation decisions — how to wire what the strategist's already decided.`)
    lines.push(``)
    mcneel.forEach((q, i) => renderQuestion(`Q${i + 1}`, q, lines, answers))
  }
}

function renderQuestion(label: string, q: AggregatedQuestion, lines: string[], answers: Record<string, string>) {
  lines.push(`**${label}.** ${q.text}`)
  lines.push(``)
  const sample = q.sources.slice(0, 6).map(s => `\`${s}\``).join(', ')
  const moreSrc = q.sources.length > 6 ? ` (+${q.sources.length - 6} more)` : ''
  lines.push(`- *Affects:* ${sample}${moreSrc}`)
  const a = answers[q.id]?.trim()
  if (a) {
    lines.push(`- **Answer:** ${a.replace(/\n+/g, ' ')}`)
  } else {
    lines.push(`- **Answer:** ___________________________________________________________`)
  }
  lines.push(``)
}

function renderCpt(cpt: WpObjectCpt, group: AcfFieldGroup | null, lines: string[]) {
  const r = cpt.registration_args
  const single   = cpt.single_template.enabled ? '✅ yes' : '❌ no'
  const archive  = cpt.archive.enabled ? '✅ yes' : '❌ no'
  const headless = cpt.headless ? ' 🔒 **headless**' : ''
  lines.push(`#### \`${cpt.slug}\` — ${cpt.labels.singular} / ${cpt.labels.plural}${headless}`)
  lines.push(``)
  lines.push(`**Registration**`)
  lines.push(``)
  lines.push(`- Single detail page: ${single}${cpt.single_template.rationale ? ` — ${cpt.single_template.rationale}` : ''}`)
  lines.push(`- Archive page: ${archive}${cpt.archive.rendered_via_query_loop_on ? ` (rendered via query loop on \`${cpt.archive.rendered_via_query_loop_on}\`)` : ''}`)
  lines.push(`- Public: ${r.public ? 'yes' : 'no'} · Queryable: ${r.publicly_queryable ? 'yes' : 'no'} · REST: ${r.show_in_rest ? 'yes' : 'no'} · In nav menus: ${r.show_in_nav_menus ? 'yes' : 'no'} · In search: ${r.exclude_from_search ? 'no (excluded)' : 'yes'}`)
  lines.push(`- Supports: ${r.supports.join(', ')}`)
  if (r.rewrite) lines.push(`- URL slug: \`/${r.rewrite.slug}/\``)
  if (r.menu_icon) lines.push(`- Menu icon: \`${r.menu_icon}\``)
  if (cpt.taxonomies.length > 0) {
    lines.push(`- Taxonomies:`)
    for (const t of cpt.taxonomies) {
      lines.push(`  - \`${t.slug}\` — ${t.labels.singular} / ${t.labels.plural} (${t.hierarchical ? 'hierarchical' : 'flat'})`)
    }
  }
  lines.push(``)
  renderContentCollectionAnswers(cpt._content_collection_answers, lines)
  if (group) renderFieldGroup(group, lines, { recordsLabel: 'Existing records to seed' })
}

function renderContentCollectionAnswers(cca: WpObjectCpt['_content_collection_answers'] | undefined, lines: string[]) {
  if (!cca) return
  lines.push(`**Partner content-collection answers (${cca.content_kind})**`)
  lines.push(``)
  lines.push(`Verbatim from the partner's Content Collection form — gives the dev context for WHY this CPT looks the way it does.`)
  lines.push(``)
  lines.push(`| Field | Partner's answer |`)
  lines.push(`|-------|------------------|`)
  for (const { label, value } of cca.fields) {
    lines.push(`| ${label} | ${formatAnswerValue(value)} |`)
  }
  lines.push(``)
}

function formatAnswerValue(v: unknown): string {
  if (v == null) return '*(not answered)*'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length === 0 ? '*(empty)*' : v.map(x => `\`${String(x)}\``).join(', ')
  const s = String(v).trim()
  if (!s || s === '-') return '*(not answered)*'
  if (/^https?:\/\//i.test(s)) return `[${truncate(s, 80)}](${s})`
  if (s.includes('\n')) return s.replace(/\|/g, '\\|').replace(/\n+/g, '<br>')
  return s.replace(/\|/g, '\\|')
}

function renderOptions(opt: WpObjectOptionsPage, group: AcfFieldGroup | null, lines: string[]) {
  lines.push(`#### \`${opt.slug}\` — ${opt.menu_title}`)
  lines.push(``)
  lines.push(`One editable surface for site-wide content. Bind references from any template here.`)
  lines.push(``)
  if (group) renderFieldGroup(group, lines, { recordsLabel: 'Current global values' })
}

function renderRepeaters(reps: WpObjectRepeater[], plan: ContentModelPlan, lines: string[]) {
  lines.push(`### Page-scoped Repeater field groups (${reps.length})`)
  lines.push(``)
  lines.push(`One ACF repeater field per (page, content piece). Bound to a Bricks page template; populate via the sidecar \`.content-import.json\`.`)
  lines.push(``)
  const byPage = new Map<string, WpObjectRepeater[]>()
  for (const r of reps) {
    const list = byPage.get(r.on_page_slug) ?? []
    list.push(r)
    byPage.set(r.on_page_slug, list)
  }
  for (const [page, items] of [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`#### Page: \`/${page}\` — ${items.length} repeater${items.length === 1 ? '' : 's'}`)
    lines.push(``)
    for (const r of items) {
      const group = plan.layer_3_acf_field_groups.find(g => g.key === r.field_group_ref.replace(/^acf\./, 'acf.repeater_'))
      const label = r.field_group_ref.replace(/^acf\./, '').replace(/^.*?_/, '')
      lines.push(`##### Repeater: \`${label}\``)
      lines.push(``)
      if (group) renderFieldGroup(group, lines, { recordsLabel: 'Existing rows' })
    }
  }
}

function renderFieldGroup(g: AcfFieldGroup, lines: string[], opts: { recordsLabel: string }) {
  lines.push(`**ACF field group**`)
  lines.push(``)
  lines.push(`- Key: \`${g.key}\``)
  if (g.fields.length === 0) {
    lines.push(`- *No fields detected — likely a referenced-template group with no inline sub-fields. Confirm with strategist if a custom field set is needed.*`)
    lines.push(``)
    return
  }
  lines.push(`- Fields:`)
  for (const f of g.fields) renderField(f, lines, 1)
  lines.push(``)
  const rows = g._content_rows ?? []
  renderCtaRouteSummary(rows, lines)
  if (rows.length === 0) {
    lines.push(`**${opts.recordsLabel}:** *(none extracted)*`)
    lines.push(``)
    return
  }
  lines.push(`**${opts.recordsLabel}** — ${rows.length} record${rows.length === 1 ? '' : 's'} (full data in \`.content-import.json\`)`)
  lines.push(``)
  for (const row of rows.slice(0, 3)) {
    lines.push(`<details><summary>${summarizeRow(row)}</summary>`)
    lines.push(``)
    lines.push('```json')
    lines.push(JSON.stringify(row, null, 2))
    lines.push('```')
    lines.push(`</details>`)
    lines.push(``)
  }
  if (rows.length > 3) {
    lines.push(`*(${rows.length - 3} more in the sidecar JSON)*`)
    lines.push(``)
  }
}

function renderField(f: AcfField, lines: string[], indent: number) {
  const pad = '  '.repeat(indent)
  const taxNote = f.taxonomy ? ` → \`${f.taxonomy}\`` : ''
  const promoMark = f._cta_analysis?.type_promoted ? ' 🔁 **route-promoted**' : ''
  lines.push(`${pad}- \`${f.name}\` (${f.type}${f.required ? ', required' : ''})${taxNote} — *${f.label}*${promoMark}`)
  const ca = f._cta_analysis
  if (ca) {
    const breakdown = Object.entries(ca.by_route_type)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([t, n]) => `${n} ${t}`)
      .join(', ')
    if (ca.type_promoted) {
      lines.push(`${pad}  - 🔁 *Promoted from URL to \`${ca.recommended_acf_type}\` — ${ca.reason}*`)
    } else {
      lines.push(`${pad}  - *${ca.total_records} CTA${ca.total_records === 1 ? '' : 's'} observed (${breakdown}). Kept as ACF \`${ca.recommended_acf_type}\` — ${ca.reason}*`)
    }
  }
  if (f.sub_fields && f.sub_fields.length > 0) {
    for (const sf of f.sub_fields) renderField(sf, lines, indent + 1)
  }
}

interface CtaRouteRow { field: string; url: string; route_type: string; hint: string }

function renderCtaRouteSummary(rows: Array<Record<string, unknown>>, lines: string[]) {
  const all: CtaRouteRow[] = []
  for (const row of rows) {
    const ctas = row._cta_routes as CtaRouteRow[] | undefined
    if (Array.isArray(ctas)) all.push(...ctas)
  }
  if (all.length === 0) return
  const byType = new Map<string, CtaRouteRow[]>()
  for (const c of all) {
    const list = byType.get(c.route_type) ?? []
    list.push(c)
    byType.set(c.route_type, list)
  }
  const labelFor: Record<string, string> = {
    'internal-page':   '→ internal page',
    'internal-anchor': '→ anchor on same page',
    'youtube':         '→ YouTube',
    'vimeo':           '→ Vimeo',
    'church-center':   '→ Church Center / Planning Center / CCB',
    'social':          '→ social profile',
    'file':            '→ file download',
    'form':            '→ application or signup form',
    'mailto':          '→ email (mailto:)',
    'tel':             '→ phone (tel:)',
    'external':        '→ external page',
    'unset':           '→ no URL set',
  }
  lines.push(`**CTA / button routing** — ${all.length} destination${all.length === 1 ? '' : 's'} across this group:`)
  lines.push(``)
  for (const [type, list] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sampleUrls = [...new Set(list.map(c => c.url))].slice(0, 3)
    lines.push(`- **${list.length}** ${labelFor[type] ?? type} — e.g. ${sampleUrls.map(u => `\`${truncate(u, 60)}\``).join(', ')}`)
  }
  lines.push(``)
}

function summarizeRow(row: Record<string, unknown>): string {
  const namey = ['title', 'name', 'heading', 'primary_heading', 'label', 'item_heading']
    .map(k => row[k])
    .find(v => typeof v === 'string' && (v as string).trim().length > 0) as string | undefined
  if (namey) return truncate(stripHtml(namey), 80)
  for (const v of Object.values(row)) {
    if (typeof v === 'string' && v.trim().length > 0) return truncate(stripHtml(v), 80)
  }
  return 'Record (no name)'
}

function stripHtml(s: string): string { return s.replace(/<[^>]*>/g, '').trim() }
function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }
