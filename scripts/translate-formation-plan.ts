#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Translate a formation-plan JSON into a human-readable markdown
 * summary PLUS a sidecar content-import.json with the actual partner
 * content shaped for AI-assisted population of the WP records.
 *
 * Goals (per Ashley's audit feedback):
 *   - Surface the ACF field structures inline so the dev can register
 *     fields without re-reading the raw plan JSON.
 *   - Include sample content rows under each field group so the dev
 *     can see WHAT they're building against, not just shape names.
 *   - Route open questions by owner (Strategist for content decisions,
 *     McNeel for implementation), with an empty "Answer" line each so
 *     the strategist can actually type their answer back in.
 *   - Emit a separate content-import.json the dev's AI assistant can
 *     consume to seed WP records after the CPTs/Options page exist.
 *
 * Usage:
 *   tsx scripts/translate-formation-plan.ts <path-to-json>
 */
import { readFileSync, writeFileSync } from 'node:fs'

interface AcfField {
  key: string
  name: string
  label: string
  type: string
  required?: boolean
  sub_fields?: AcfField[]
  taxonomy?: string
}

interface AcfFieldGroup {
  key: string
  title: string
  fields: AcfField[]
  location: Array<Array<{ param: string; operator: string; value: string }>>
  _source_section_ids?: string[]
  _content_rows?: Array<Record<string, unknown>>
}

interface WpObject {
  id: string
  kind: string
  slug?: string
  on_page_slug?: string
  external_system?: string | null
  display_mode?: string
  rationale?: string
  open_questions?: string[]
  confidence?: string
  labels?: { singular: string; plural: string }
  registration_args?: {
    public: boolean
    publicly_queryable: boolean
    has_archive: boolean
    show_ui: boolean
    show_in_menu: boolean
    show_in_rest: boolean
    show_in_nav_menus: boolean
    exclude_from_search: boolean
    supports: string[]
    menu_icon: string | null
    rewrite: { slug: string; with_front: boolean } | null
  }
  taxonomies?: Array<{ slug: string; labels: { singular: string; plural: string }; hierarchical: boolean }>
  single_template?: { enabled: boolean; rationale: string | null }
  archive?: { enabled: boolean; rendered_via_query_loop_on: string | null; rationale: string | null }
  headless?: boolean
  seeded_from_project_columns?: string[]
  field_group_refs?: string[]
  field_group_ref?: string
}

interface Classification {
  id: string
  page_slug: string
  section_role: string | null
  item_label: string
  structure: string
  signals: Record<string, unknown>
  rationale: string
  open_questions: string[]
  confidence: string
  cpt_subroutine_ref: string | null
}

interface Plan {
  schema_version: number
  _meta: {
    generated_at: string
    generated_by: string
    input_fingerprint: string
    counts: {
      classifications: number
      wp_objects: number
      acf_field_groups: number
      open_questions: number
      low_confidence: number
    }
  }
  layer_1_classifications: Classification[]
  layer_2_wp_objects: WpObject[]
  layer_3_acf_field_groups: AcfFieldGroup[]
}

// ── Open question routing ──────────────────────────────────────────
//
// "McNeel can speak into HOW to display, but the content decisions
// rest with the strategist." So we tag each question by owner based
// on what it's asking.

type QuestionOwner = 'Strategist' | 'McNeel'

function ownerForQuestion(q: string): QuestionOwner {
  const lower = q.toLowerCase()
  if (lower.includes('bricks') ||
      lower.includes('flexible content') ||
      lower.includes('nestable') ||
      lower.includes('template variant') ||
      lower.includes('field type') ||
      lower.includes('implementation')) {
    return 'McNeel'
  }
  // CPT existence, single-template need, archive vs query loop,
  // taxonomies, content modeling, multi-campus structure — all
  // STRATEGY (content) decisions.
  return 'Strategist'
}

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: tsx scripts/translate-formation-plan.ts <path-to-json>')
    process.exit(1)
  }
  const plan = JSON.parse(readFileSync(inputPath, 'utf8')) as Plan
  const mdOutPath = inputPath.replace(/\.json$/, '.md')
  const contentOutPath = inputPath.replace(/\.json$/, '.content-import.json')

  writeFileSync(mdOutPath, render(plan, inputPath))
  writeFileSync(contentOutPath, JSON.stringify(buildContentImport(plan), null, 2))
  console.log(`Wrote ${mdOutPath}`)
  console.log(`Wrote ${contentOutPath}`)
}

// ── Sidecar content-import.json — handed to dev's AI ────────────────

function buildContentImport(plan: Plan) {
  // Shape per WP object:
  //   options: { fields: [...], record: {...} }
  //   cpt:     { fields: [...], records: [...] }
  //   repeater (per page): { page, fields: [...], rows: [...] }
  const options:  Array<{ slug: string; fields: AcfField[]; record: Record<string, unknown> | null }> = []
  const cpts:     Array<{ slug: string; fields: AcfField[]; records: Array<Record<string, unknown>> }> = []
  const reps:    Array<{ on_page_slug: string; field_group_key: string; fields: AcfField[]; rows: Array<Record<string, unknown>> }> = []

  for (const o of plan.layer_2_wp_objects) {
    const group = plan.layer_3_acf_field_groups.find(g =>
      g.location.some(or => or.some(rule =>
        (rule.param === 'options_page' && o.kind === 'options_page' && rule.value === o.slug) ||
        (rule.param === 'post_type'   && o.kind === 'custom_post_type' && rule.value === o.slug) ||
        (rule.param === 'page_template' && o.kind === 'repeater' && rule.value === `page-${o.on_page_slug}.php`)
      ))
    )
    if (!group) continue
    if (o.kind === 'options_page') {
      options.push({ slug: o.slug!, fields: group.fields, record: group._content_rows?.[0] ?? null })
    } else if (o.kind === 'custom_post_type') {
      cpts.push({ slug: o.slug!, fields: group.fields, records: group._content_rows ?? [] })
    } else if (o.kind === 'repeater') {
      reps.push({
        on_page_slug:    o.on_page_slug!,
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

// ── Markdown rendering ─────────────────────────────────────────────

function render(plan: Plan, sourcePath: string): string {
  const lines: string[] = []
  const m = plan._meta

  lines.push(`# Formation Plan — Dev Handoff`)
  lines.push(``)
  lines.push(`*Translated from* \`${sourcePath.split('/').pop()}\``)
  lines.push(`*Generated* ${new Date(m.generated_at).toLocaleString()} *fingerprint* \`${m.input_fingerprint}\``)
  lines.push(``)
  lines.push(`## How to use this doc`)
  lines.push(``)
  lines.push(`1. **Open questions section first** — strategist answers the content questions; McNeel answers the implementation ones. Don't start building until they're filled in.`)
  lines.push(`2. **Build the WP objects** (CPTs + Options page) using the registration args in each "WordPress object" section. Then add the ACF field groups using the structures shown.`)
  lines.push(`3. **Populate the content** using the sidecar \`<filename>.content-import.json\` — each WP object has a matching block with records ready to seed via your AI assistant or wp-cli.`)
  lines.push(``)
  lines.push(`## At a glance`)
  lines.push(``)
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|------:|`)
  lines.push(`| Classifications (one per piece of content) | ${m.counts.classifications} |`)
  lines.push(`| WordPress objects (CPTs + Options + Repeaters) | ${m.counts.wp_objects} |`)
  lines.push(`| ACF field groups | ${m.counts.acf_field_groups} |`)
  lines.push(`| Open questions (need an answer before build) | ${m.counts.open_questions} |`)
  lines.push(`| Low-confidence classifications | ${m.counts.low_confidence} |`)
  lines.push(``)

  // ── Open Questions section — at the top so they're not missed ────
  renderOpenQuestions(plan, lines)

  // ── WordPress objects + ACF field groups ───────────────────────
  lines.push(`## WordPress objects to register`)
  lines.push(``)
  const cpts    = plan.layer_2_wp_objects.filter(o => o.kind === 'custom_post_type')
  const options = plan.layer_2_wp_objects.filter(o => o.kind === 'options_page')
  const reps    = plan.layer_2_wp_objects.filter(o => o.kind === 'repeater')
  const exts    = plan.layer_2_wp_objects.filter(o => o.kind === 'external')

  if (cpts.length > 0) {
    lines.push(`### Custom Post Types (${cpts.length})`)
    lines.push(``)
    for (const cpt of cpts) {
      renderCpt(cpt, findGroupForCpt(plan, cpt), lines)
    }
  }
  if (options.length > 0) {
    lines.push(`### Global Settings / Options Page (${options.length})`)
    lines.push(``)
    for (const o of options) {
      renderOptions(o, findGroupForOptions(plan, o), lines)
    }
  }
  if (exts.length > 0) {
    lines.push(`### External / managed in third-party system (${exts.length})`)
    lines.push(``)
    lines.push(`Partner answered "external" / "embed" / "contact" on these — no WordPress CPT needed.`)
    lines.push(``)
    for (const e of exts) {
      lines.push(`- **${e.id}** — display mode \`${e.display_mode}\`${e.rationale ? ` — ${e.rationale}` : ''}`)
    }
    lines.push(``)
  }
  if (reps.length > 0) {
    renderRepeaters(reps, plan, lines)
  }

  lines.push(`---`)
  lines.push(`*Regenerate: \`tsx scripts/translate-formation-plan.ts ${sourcePath}\`*`)
  lines.push(``)
  return lines.join('\n')
}

function renderOpenQuestions(plan: Plan, lines: string[]) {
  // Collect every open question once, deduped by text, with the WP-
  // object or page slug source attached.
  const collected = new Map<string, { sources: Set<string>; owner: QuestionOwner }>()
  for (const c of plan.layer_1_classifications) {
    for (const q of c.open_questions) {
      const key = q.trim()
      const e = collected.get(key) ?? { sources: new Set<string>(), owner: ownerForQuestion(q) }
      e.sources.add(`${c.page_slug}/${c.item_label}`)
      collected.set(key, e)
    }
  }
  for (const o of plan.layer_2_wp_objects) {
    const qs = (o as { open_questions?: string[] }).open_questions
    if (!qs) continue
    for (const q of qs) {
      const key = q.trim()
      const e = collected.get(key) ?? { sources: new Set<string>(), owner: ownerForQuestion(q) }
      e.sources.add(o.id)
      collected.set(key, e)
    }
  }
  if (collected.size === 0) return

  const byOwner = { Strategist: [] as Array<[string, Set<string>]>, McNeel: [] as Array<[string, Set<string>]> }
  for (const [q, e] of collected) byOwner[e.owner].push([q, e.sources])

  lines.push(`## Open questions — answer before building`)
  lines.push(``)
  lines.push(`Each question has an empty **Answer** line. The owner writes the decision back in, then the dev unblocks.`)
  lines.push(``)
  if (byOwner.Strategist.length > 0) {
    lines.push(`### For the Strategist (${byOwner.Strategist.length})`)
    lines.push(``)
    lines.push(`Content / modelling decisions — what the site should HAVE, not how it's wired.`)
    lines.push(``)
    let i = 1
    for (const [q, sources] of byOwner.Strategist) {
      lines.push(`**Q${i}.** ${q}`)
      lines.push(``)
      lines.push(`- *Affects:* ${[...sources].slice(0, 6).map(s => `\`${s}\``).join(', ')}${sources.size > 6 ? ` (+${sources.size - 6} more)` : ''}`)
      lines.push(`- **Answer:** ___________________________________________________________`)
      lines.push(``)
      i++
    }
  }
  if (byOwner.McNeel.length > 0) {
    lines.push(`### For McNeel (${byOwner.McNeel.length})`)
    lines.push(``)
    lines.push(`Implementation decisions — how to wire what the strategist's already decided.`)
    lines.push(``)
    let i = 1
    for (const [q, sources] of byOwner.McNeel) {
      lines.push(`**Q${i}.** ${q}`)
      lines.push(``)
      lines.push(`- *Affects:* ${[...sources].slice(0, 6).map(s => `\`${s}\``).join(', ')}${sources.size > 6 ? ` (+${sources.size - 6} more)` : ''}`)
      lines.push(`- **Answer:** ___________________________________________________________`)
      lines.push(``)
      i++
    }
  }
}

function findGroupForCpt(plan: Plan, cpt: WpObject): AcfFieldGroup | null {
  return plan.layer_3_acf_field_groups.find(g =>
    g.location.some(or => or.some(rule => rule.param === 'post_type' && rule.value === cpt.slug))
  ) ?? null
}

function findGroupForOptions(plan: Plan, opt: WpObject): AcfFieldGroup | null {
  return plan.layer_3_acf_field_groups.find(g =>
    g.location.some(or => or.some(rule => rule.param === 'options_page' && rule.value === opt.slug))
  ) ?? null
}

function renderCpt(cpt: WpObject, group: AcfFieldGroup | null, lines: string[]) {
  const r = cpt.registration_args!
  const single   = cpt.single_template?.enabled ? '✅ yes' : '❌ no'
  const archive  = cpt.archive?.enabled ? '✅ yes' : '❌ no'
  const headless = cpt.headless ? ' 🔒 **headless**' : ''
  lines.push(`#### \`${cpt.slug}\` — ${cpt.labels?.singular} / ${cpt.labels?.plural}${headless}`)
  lines.push(``)
  lines.push(`**Registration**`)
  lines.push(``)
  lines.push(`- Single detail page: ${single}${cpt.single_template?.rationale ? ` — ${cpt.single_template.rationale}` : ''}`)
  lines.push(`- Archive page: ${archive}${cpt.archive?.rendered_via_query_loop_on ? ` (rendered via query loop on \`${cpt.archive.rendered_via_query_loop_on}\`)` : ''}`)
  lines.push(`- Public: ${r.public ? 'yes' : 'no'} · Queryable: ${r.publicly_queryable ? 'yes' : 'no'} · REST: ${r.show_in_rest ? 'yes' : 'no'} · In nav menus: ${r.show_in_nav_menus ? 'yes' : 'no'} · In search: ${r.exclude_from_search ? 'no (excluded)' : 'yes'}`)
  lines.push(`- Supports: ${r.supports.join(', ')}`)
  if (r.rewrite) lines.push(`- URL slug: \`/${r.rewrite.slug}/\``)
  if (r.menu_icon) lines.push(`- Menu icon: \`${r.menu_icon}\``)
  if (cpt.taxonomies && cpt.taxonomies.length > 0) {
    lines.push(`- Taxonomies:`)
    for (const t of cpt.taxonomies) {
      lines.push(`  - \`${t.slug}\` — ${t.labels.singular} / ${t.labels.plural} (${t.hierarchical ? 'hierarchical' : 'flat'})`)
    }
  }
  lines.push(``)
  if (group) {
    renderFieldGroup(group, lines, { recordsLabel: 'Existing records to seed' })
  }
}

function renderOptions(opt: WpObject, group: AcfFieldGroup | null, lines: string[]) {
  lines.push(`#### \`${opt.slug}\` — ${opt.labels?.singular ?? 'Global Site Settings'}`)
  lines.push(``)
  lines.push(`One editable surface for site-wide content. Bind references from any template here.`)
  lines.push(``)
  if (group) {
    renderFieldGroup(group, lines, { recordsLabel: 'Current global values' })
  }
}

function renderRepeaters(reps: WpObject[], plan: Plan, lines: string[]) {
  lines.push(`### Page-scoped Repeater field groups (${reps.length})`)
  lines.push(``)
  lines.push(`One ACF repeater field per (page, content piece). Bound to a Bricks page template; populate via the sidecar \`.content-import.json\`.`)
  lines.push(``)
  // Group by page slug for readability
  const byPage = new Map<string, WpObject[]>()
  for (const r of reps) {
    const slug = r.on_page_slug ?? 'unknown'
    const list = byPage.get(slug) ?? []
    list.push(r)
    byPage.set(slug, list)
  }
  for (const [page, items] of [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`#### Page: \`/${page}\` — ${items.length} repeater${items.length === 1 ? '' : 's'}`)
    lines.push(``)
    for (const r of items) {
      const group = plan.layer_3_acf_field_groups.find(g => g.key === r.field_group_ref?.replace(/^acf\./, 'acf.repeater_'))
      const label = r.field_group_ref?.replace(/^acf\./, '').replace(/^.*?_/, '') ?? r.id
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
  for (const f of g.fields) {
    renderField(f, lines, 1)
  }
  lines.push(``)
  const rows = g._content_rows ?? []

  // CTA route summary — counts by destination type. McNeel needs to
  // know that e.g. a sermon button goes to YouTube vs an internal page,
  // or that a careers button targets a PDF, before choosing the right
  // Bricks variant / button styling.
  renderCtaRouteSummary(rows, lines)

  if (rows.length === 0) {
    lines.push(`**${opts.recordsLabel}:** *(none extracted)*`)
    lines.push(``)
    return
  }
  lines.push(`**${opts.recordsLabel}** — ${rows.length} record${rows.length === 1 ? '' : 's'} (full data in \`.content-import.json\`)`)
  lines.push(``)
  // Preview first 3 rows
  const preview = rows.slice(0, 3)
  for (const row of preview) {
    lines.push(`<details><summary>${summarizeRow(row)}</summary>`)
    lines.push(``)
    lines.push('```json')
    lines.push(JSON.stringify(row, null, 2))
    lines.push('```')
    lines.push(`</details>`)
    lines.push(``)
  }
  if (rows.length > preview.length) {
    lines.push(`*(${rows.length - preview.length} more in the sidecar JSON)*`)
    lines.push(``)
  }
}

interface CtaRoute {
  field: string
  url: string
  route_type: string
  hint: string
}

function renderCtaRouteSummary(rows: Array<Record<string, unknown>>, lines: string[]) {
  const all: CtaRoute[] = []
  for (const row of rows) {
    const ctas = row._cta_routes as CtaRoute[] | undefined
    if (Array.isArray(ctas)) all.push(...ctas)
  }
  if (all.length === 0) return

  const byType = new Map<string, CtaRoute[]>()
  for (const c of all) {
    const list = byType.get(c.route_type) ?? []
    list.push(c)
    byType.set(c.route_type, list)
  }
  const labelFor: Record<string, string> = {
    'internal-page':   '→ internal page (slug like `/sermons`)',
    'internal-anchor': '→ anchor on same page',
    'youtube':         '→ YouTube',
    'vimeo':           '→ Vimeo',
    'church-center':   '→ Church Center / Planning Center / CCB',
    'social':          '→ social profile',
    'file':            '→ file download (PDF / doc / etc.)',
    'form':            '→ application or signup form',
    'mailto':          '→ email (mailto:)',
    'tel':             '→ phone (tel:)',
    'external':        '→ external page',
    'unset':           '→ no URL set',
  }
  lines.push(`**CTA / button routing** — ${all.length} destination${all.length === 1 ? '' : 's'} across this group:`)
  lines.push(``)
  const ordered = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [type, list] of ordered) {
    const sampleUrls = [...new Set(list.map(c => c.url))].slice(0, 3)
    lines.push(`- **${list.length}** ${labelFor[type] ?? type} — e.g. ${sampleUrls.map(u => `\`${truncate(u, 60)}\``).join(', ')}`)
  }
  lines.push(``)
}

function renderField(f: AcfField, lines: string[], indent: number) {
  const pad = '  '.repeat(indent)
  const taxNote = f.taxonomy ? ` → \`${f.taxonomy}\`` : ''
  lines.push(`${pad}- \`${f.name}\` (${f.type}${f.required ? ', required' : ''})${taxNote} — *${f.label}*`)
  if (f.sub_fields && f.sub_fields.length > 0) {
    for (const sf of f.sub_fields) renderField(sf, lines, indent + 1)
  }
}

function summarizeRow(row: Record<string, unknown>): string {
  // Prefer a "name"-like field for the summary, else fall back to
  // the first non-empty string value.
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

main()
