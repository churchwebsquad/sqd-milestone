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
  DiscoverySection,
  WpObject,
  WpObjectCpt,
  WpObjectOptionsPage,
  WpObjectRepeater,
} from './types'

// ─── Open-question owner routing ──────────────────────────────────────

export type QuestionOwner = 'Strategist' | 'Developer'

/** Decides who needs to answer a given open question. The developer
 *  answers implementation/display questions; everything else falls
 *  to the strategist (content decisions). */
export function ownerForQuestion(q: string): QuestionOwner {
  const lower = q.toLowerCase()
  if (lower.includes('bricks') ||
      lower.includes('flexible content') ||
      lower.includes('nestable') ||
      lower.includes('template variant') ||
      lower.includes('field type') ||
      lower.includes('implementation')) {
    return 'Developer'
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

  // ── Partner intent for events / sermons / groups ────────────────
  // The partner's Content Collection answers regardless of whether
  // any section currently binds to them. Dev knows what to build for
  // even when the layout's missing a section.
  renderPartnerIntent(plan, lines)

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

/** "What's sitting here to be organized" — section-anchored discovery
 *  view, grouped by page. Each section gets its own row showing
 *  heading, item count, schema, sample names, and target hint. This
 *  is the framing the strategist + dev actually use: per-section
 *  semantic labels ("Pastors", "Ministry Leaders", "Elders", "Board")
 *  rather than per-CPT roll-ups. The analyzer's CPT-grouped
 *  suggestion is the implementation-side reference at the bottom. */
function renderConceptsFound(plan: ContentModelPlan, lines: string[]) {
  const ds = plan.discovery_sections ?? []
  const options = plan.layer_2_wp_objects.filter((o): o is WpObjectOptionsPage => o.kind === 'options_page')
  if (ds.length === 0 && options.length === 0) return

  lines.push(`## What's sitting here to be organized`)
  lines.push(``)
  lines.push(`Sections grouped by page, with the section's heading as the label. Each row shows what's there (item count, schema, sample names) and a target hint. **Discovery framing** — read this to know what you're modelling. The analyzer's suggested CPT / Options structure is in the "Recommended model" section below as a reference; disagree freely.`)
  lines.push(``)

  // Group discovery sections by page
  const byPage = new Map<string, DiscoverySection[]>()
  for (const s of ds) {
    const list = byPage.get(s.page_slug) ?? []
    list.push(s)
    byPage.set(s.page_slug, list)
  }
  // Sort pages by section count (richest first) for scanability
  const pagesSorted = [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [pageSlug, sections] of pagesSorted) {
    const pageName = sections[0]?.page_name ?? pageSlug
    lines.push(`### ${pageName} \`/${pageSlug}\``)
    lines.push(``)
    for (const s of sections) {
      renderDiscoverySection(s, plan, lines)
    }
  }

  // Site-wide globals as a top-level concept (separate from per-page sections)
  for (const opt of options) {
    const group = findGroupForObject(plan, opt)
    const row = group?._content_rows?.[0] ?? {}
    const filled = Object.entries(row).filter(([k, v]) => !k.startsWith('_') && v != null && String(v).trim() !== '')
    lines.push(`### Site-wide globals (not page-specific)`)
    lines.push(``)
    lines.push(`Single-source content reused across pages (church name, contact, service times, social links, etc.). Edited once, propagates everywhere.`)
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

const TARGET_HINT_LABEL: Record<DiscoverySection['target_hint'], string> = {
  'individual-page': 'individual detail page per item',
  'flat-list':       'flat list, no individual pages',
  'embed':           'embedded from a third-party system',
  'external':        'linked out to a third-party system',
  'mailto':          'mailto contact, no individual page',
  'unknown':         'strategist confirms',
}

function renderDiscoverySection(s: DiscoverySection, plan: ContentModelPlan, lines: string[]) {
  // Pull the suggested CPT for context (if any) so the strategist
  // sees the analyzer's recommendation as a hint, not a directive.
  const suggestedCpt = s.cpt_subroutine_ref
    ? plan.layer_2_wp_objects.find(o => o.id === s.cpt_subroutine_ref) ?? null
    : null
  const cptHint = suggestedCpt?.kind === 'custom_post_type'
    ? ` — *analyzer suggests CPT \`${suggestedCpt.slug}\`*`
    : ''

  // Bullet-hierarchy framing matching the user's Arvada-style example —
  // one top-level bullet per section, sub-bullets for the details.
  lines.push(``)
  lines.push(`- **${s.heading}**${cptHint}`)
  lines.push(`  - ${s.item_count} item${s.item_count === 1 ? '' : 's'}`)
  if (s.schema.length > 0) {
    lines.push(`  - schema: ${s.schema.map(k => `\`${k}\``).join(', ')}`)
  }
  lines.push(`  - target: ${TARGET_HINT_LABEL[s.target_hint]}`)
  if (s.section_role) {
    lines.push(`  - section role: \`${s.section_role}\``)
  }
  // Sample record — first item with every schema field + actual
  // value. The bit the dev actually scans to understand the shape
  // of one real instance of this content.
  if (s.sample_record) {
    const lines2 = renderSampleRecord(s.sample_record, s.schema)
    if (lines2.length > 0) {
      lines.push(`  - sample (first record):`)
      for (const l of lines2) lines.push(`    - ${l}`)
    }
  }
  // List of additional record names so the dev sees the partner's
  // own vocabulary across the rest of the items.
  if (s.sample_names.length > 1 && s.item_count > 1) {
    const restNames = s.sample_names.slice(1)
    lines.push(`  - other items: ${restNames.map(n => `*${n}*`).join(' · ')}${s.item_count > s.sample_names.length ? ` *(+${s.item_count - s.sample_names.length} more)*` : ''}`)
  }
  // Partner-supplied context for events / sermons / groups sections.
  // This is what makes the section actually buildable — embed source,
  // filter needs, format, frustration with the current system, etc.
  if (s.partner_context) {
    renderPartnerContext(s.partner_context, lines)
  }
}

/** Top-level summary of the partner's intent for events / sermons /
 *  groups. Pulled from the analyzer's WpObjectCpt rows for each kind
 *  — which carry the verbatim Content Collection answers regardless
 *  of whether a section is bound to them. Surfaces here so the dev
 *  sees "the partner said events embed from Church Center" even
 *  when the events page itself hasn't been built yet. */
function renderPartnerIntent(plan: ContentModelPlan, lines: string[]) {
  const cpts = plan.layer_2_wp_objects.filter((o): o is WpObjectCpt => o.kind === 'custom_post_type')
  const events  = cpts.find(c => c.slug === 'event')
  const sermons = cpts.find(c => c.slug === 'sermon')
  const groups  = cpts.find(c => c.slug === 'group')
  const blocks: Array<{ label: string; cpt: WpObjectCpt }> = []
  if (events  && events._content_collection_answers)  blocks.push({ label: 'Events',  cpt: events  })
  if (sermons && sermons._content_collection_answers) blocks.push({ label: 'Sermons', cpt: sermons })
  if (groups  && groups._content_collection_answers)  blocks.push({ label: 'Groups',  cpt: groups  })
  if (blocks.length === 0) return

  lines.push(`## Partner intent — events / sermons / groups`)
  lines.push(``)
  lines.push(`Verbatim partner answers from the Content Collection form. Surfaces here even if no section on the site has been bound to these concepts yet — the dev knows what the partner expects when they get to events / sermons / groups.`)
  lines.push(``)
  for (const { label, cpt } of blocks) {
    const cca = cpt._content_collection_answers!
    const filled = cca.fields.filter(({ value }) => value != null && String(value).trim() !== '' && String(value).trim() !== '-')
    if (filled.length === 0) continue
    lines.push(`### ${label}`)
    lines.push(``)
    for (const { label: fl, value } of filled) {
      lines.push(`- ${fl}: ${formatAnswerValue(value)}`)
    }
    lines.push(``)
  }
}

/** Render the sample record as bullet lines. One line per schema
 *  field, value HTML-stripped + truncated. Schema order preserved so
 *  the dev reads in template order, not whatever order the underlying
 *  object happened to iterate. Skips fields the projection produced
 *  as null/empty so the sample doesn't bloat with `(blank)` noise. */
function renderSampleRecord(record: Record<string, unknown>, schema: string[]): string[] {
  const out: string[] = []
  // Collect ALL keys we want to display: schema fields PLUS any
  // suffixed siblings the projection produced (cta_label, cta_url,
  // cta_kind) that derive from a schema field.
  const display = new Set<string>(schema)
  for (const k of Object.keys(record)) {
    for (const s of schema) {
      if (k.startsWith(`${s}_`)) display.add(k)
    }
  }
  // Preserve schema order first, then any extra suffixed keys grouped
  // under their parent.
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const s of schema) {
    if (display.has(s) && !seen.has(s)) { ordered.push(s); seen.add(s) }
    // Then any *_label / *_url / *_kind siblings produced from this
    // field by the projection.
    for (const k of Object.keys(record)) {
      if (!seen.has(k) && (k === `${s}_label` || k === `${s}_url` || k === `${s}_kind`)) {
        ordered.push(k); seen.add(k)
      }
    }
  }
  for (const k of ordered) {
    const v = record[k]
    const formatted = formatSampleValue(v)
    if (formatted === '*(blank)*' && !schema.includes(k)) continue   // skip auxiliary blanks
    out.push(`*${k}*: ${formatted}`)
  }
  return out
}

function formatSampleValue(v: unknown): string {
  if (v == null) return '*(blank)*'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) {
    if (v.length === 0) return '*(empty array)*'
    return `[${v.length} items: ${v.slice(0, 2).map(x => formatSampleValue(x)).join(', ')}${v.length > 2 ? '…' : ''}]`
  }
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return `\`${s.length > 80 ? s.slice(0, 77) + '…' : s}\``
  }
  const s = String(v).trim()
  if (!s) return '*(blank)*'
  // Strip HTML tags so the markdown sample reads as plain text.
  const stripped = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  // URL detection — render as inline link.
  if (/^https?:\/\//i.test(stripped)) {
    return `[${truncate(stripped, 80)}](${stripped})`
  }
  if (stripped.startsWith('mailto:') || stripped.startsWith('tel:')) {
    return `\`${stripped}\``
  }
  // Long text → truncate with hint about original length.
  if (stripped.length > 200) {
    return `"${stripped.slice(0, 197)}…" *(${stripped.length} chars total)*`
  }
  return `"${stripped}"`
}

function renderPartnerContext(ctx: NonNullable<DiscoverySection['partner_context']>, lines: string[]) {
  if (ctx.display_preference)   lines.push(`  - display preference: \`${ctx.display_preference}\``)
  if (ctx.display_format)       lines.push(`  - display format: ${ctx.display_format}`)
  if (ctx.external_url) {
    const label = ctx.display_preference === 'embed' || ctx.display_preference === 'external'
      ? 'embed / external source'
      : 'partner-provided sample URL'
    lines.push(`  - ${label}: [${truncate(ctx.external_url, 80)}](${ctx.external_url})`)
  }
  if (ctx.playlist_url)         lines.push(`  - YouTube playlist: [${truncate(ctx.playlist_url, 80)}](${ctx.playlist_url})`)
  if (ctx.archive_features && ctx.archive_features.length > 0) {
    lines.push(`  - archive features wanted: ${ctx.archive_features.map(f => `\`${f}\``).join(', ')}`)
  }
  if (ctx.source_of_truth)      lines.push(`  - partner's current system: ${ctx.source_of_truth}`)
  if (ctx.frustration && ctx.frustration.trim() !== '-') {
    lines.push(`  - partner note: ${ctx.frustration}`)
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
  const developer  = all.filter(q => q.owner === 'Developer')

  lines.push(`## Open questions — answer before building`)
  lines.push(``)
  lines.push(`Each question has an **Answer** line. The owner writes their decision back in; once filled in, the dev unblocks.`)
  lines.push(``)
  if (strategist.length > 0) {
    lines.push(`### For the Strategist (${strategist.length})`)
    lines.push(``)
    lines.push(`Content decisions — what the site should HAVE.`)
    lines.push(``)
    strategist.forEach((q, i) => renderQuestion(`Q${i + 1}`, q, lines, answers))
  }
  if (developer.length > 0) {
    lines.push(`### For the Developer (${developer.length})`)
    lines.push(``)
    lines.push(`Implementation decisions — how to wire what the strategist's already decided.`)
    lines.push(``)
    developer.forEach((q, i) => renderQuestion(`Q${i + 1}`, q, lines, answers))
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
