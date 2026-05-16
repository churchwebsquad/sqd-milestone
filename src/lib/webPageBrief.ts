/**
 * Page Brief importer — Stage 4 equivalent.
 *
 * Cowork produces a structured JSON brief per page (see
 * references/page-brief-schema.md). This module:
 *   1. Validates the brief shape
 *   2. Resolves {{snippet}} tokens against the project's snippet library
 *   3. Surfaces unresolved snippets + [NEEDS INPUT:] placeholders
 *   4. Detects content_assignments coverage (master list vs per-section)
 *   5. Renders each section's `fields` object into HTML for a freehand
 *      web_section (MVP — template family fitting lands in step 2)
 *   6. Creates / updates the web_pages row + web_sections rows
 *
 * Subsequent steps will:
 *   - Match each section's `suggested_template_family` to actual Brixies
 *     templates and let the strategist pick a variant
 *   - Surface unmapped fields as an "Overflow content" panel per section
 *   - Run an AI fact-check pass against the content collection
 */

import { supabase } from './supabase'
import { loadEditorSnippets, type WMSnippetOption } from './webSnippets'
import type { StrategyWebProject } from '../types/database'

// ── Brief shape ──────────────────────────────────────────────────────

export interface PageBrief {
  page_slug: string
  page_title: string
  phase?: '1' | '2' | 'nav-only' | 'global' | string
  page_purpose?: string
  siblings?: string[]
  content_assignments?: string[]
  voice_notes_global?: Record<string, unknown>
  persona_focus?: Record<string, unknown>
  hero?: BriefHero
  sections?: BriefSection[]
  cs_flags?: BriefCSFlags
  snippets_used?: string[]
  snippets_proposed_new?: Array<{ key: string; value: string; rationale?: string }>
  touch_level?: 'light' | 'medium' | 'heavy'
  [k: string]: unknown
}

export interface BriefHero {
  tagline?: string
  h1?: string
  body?: string
  primary_cta?: BriefCTA
  secondary_cta?: BriefCTA
  [k: string]: unknown
}

/** A section in the brief. Two shapes are tolerated:
 *
 *   1. Cowork's flat shape (preferred going forward):
 *      { id, template_family, h, content, intro, steps, closer,
 *        cta, primary_cta, ... }
 *
 *   2. Legacy nested shape (kept for backwards-compatibility):
 *      { section_id, suggested_template_family, fields: { … } }
 *
 *  Use the `sectionId()`, `sectionFamily()`, `sectionFields()`
 *  accessors instead of reading these directly — they handle both.
 */
export interface BriefSection {
  // Identifier — either key is accepted
  section_id?: string
  id?: string
  // Template family hint — either key is accepted
  suggested_template_family?: string
  template_family?: string

  purpose?: string
  content_items?: string[]
  voice_notes?: string
  // When present, fields are nested here (legacy shape). Otherwise the
  // top-level keys (h, content, intro, steps, closer, cta, etc.) are
  // treated as the field bag — sectionFields() does the unification.
  fields?: Record<string, unknown>

  [k: string]: unknown
}

/** Meta keys never treated as content fields by sectionFields(). */
const BRIEF_SECTION_META_KEYS: ReadonlySet<string> = new Set([
  'id', 'section_id',
  'template_family', 'suggested_template_family',
  'purpose', 'voice_notes', 'content_items', 'persona_focus',
  'fields',
])

/** Stable section identifier — reads `section_id` or `id`. */
export function sectionId(s: BriefSection): string {
  if (typeof s.section_id === 'string' && s.section_id) return s.section_id
  if (typeof s.id === 'string' && s.id) return s.id
  return ''
}

/** Template family hint — reads `suggested_template_family` or
 *  `template_family`. Empty string when neither is set. */
export function sectionFamily(s: BriefSection): string {
  if (typeof s.suggested_template_family === 'string' && s.suggested_template_family) {
    return s.suggested_template_family
  }
  if (typeof s.template_family === 'string' && s.template_family) {
    return s.template_family
  }
  return ''
}

/** Content fields — either the nested `fields` object (legacy) or every
 *  non-meta top-level key on the section (cowork's flat shape). */
export function sectionFields(s: BriefSection): Record<string, unknown> {
  if (s.fields && typeof s.fields === 'object' && !Array.isArray(s.fields)) {
    return s.fields as Record<string, unknown>
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(s)) {
    if (BRIEF_SECTION_META_KEYS.has(k)) continue
    out[k] = (s as Record<string, unknown>)[k]
  }
  return out
}

export interface BriefCTA {
  label?: string
  target?: string
  [k: string]: unknown
}

export interface BriefCSFlags {
  hard_blockers?: string[]
  soft_assumptions?: string[]
  design_flags?: string[]
}

// ── Validation result ────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  scope: string  // e.g., "hero" or "section: what-to-expect"
  message: string
}

export interface BriefValidationReport {
  valid: boolean
  issues: ValidationIssue[]
  /** {{tokens}} the brief uses */
  snippets_referenced: string[]
  /** Tokens referenced but not in the project's snippet library yet */
  snippets_missing: string[]
  /** Subset of snippets_missing that cowork proposed as new snippets —
   *  these resolve automatically when "add on import" is checked. */
  snippets_resolvable_via_proposed: string[]
  /** Subset of snippets_missing with no proposed-new entry — these need
   *  the strategist to add them manually after import (or fix the brief). */
  snippets_unresolved: string[]
  /** Proposed-new snippets to optionally add to the library */
  snippets_to_add: Array<{ key: string; value: string; rationale?: string }>
  /** [NEEDS INPUT: ...] placeholders detected — non-blocking, must
   *  be resolved before publish */
  needs_input: Array<{ scope: string; label: string }>
  /** content_assignments vs section content_items coverage gaps */
  coverage_orphans: string[]
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Validate a brief WITHOUT writing anything. Used by the import modal
 * to show a preview before the strategist commits.
 */
export async function validateBrief(
  brief: PageBrief,
  project: StrategyWebProject,
): Promise<BriefValidationReport> {
  const issues: ValidationIssue[] = []

  if (!brief.page_slug) issues.push({ severity: 'error', scope: 'root', message: 'page_slug is required' })
  if (!brief.page_title) issues.push({ severity: 'error', scope: 'root', message: 'page_title is required' })
  if (!brief.sections || !Array.isArray(brief.sections)) {
    issues.push({ severity: 'warning', scope: 'root', message: 'No sections in brief — page will be created empty' })
  }

  const snippetOptions = await loadEditorSnippets(project)
  const knownTokens = new Set(snippetOptions.map(o => o.token))

  const { referenced, missing, needs_input } = scanForTokensAndInputs(brief, knownTokens)
  const snippets_to_add = brief.snippets_proposed_new ?? []

  // Tokens cowork proposed as new — these resolve on import (with the
  // "add to library" checkbox on). Strip the {{ }} wrapper if present.
  const proposedTokens = new Set(
    snippets_to_add
      .map(s => (s.key ?? '').replace(/^\{\{|\}\}$/g, '').trim())
      .filter(Boolean),
  )

  const snippets_resolvable_via_proposed = missing.filter(t => proposedTokens.has(t))
  const snippets_unresolved = missing.filter(t => !proposedTokens.has(t))

  // Coverage check — every content_assignments item should appear in
  // at least one section's content_items.
  const masterAssignments = new Set((brief.content_assignments ?? []).map(s => s.trim()))
  const claimedItems = new Set<string>()
  for (const section of brief.sections ?? []) {
    for (const item of section.content_items ?? []) {
      claimedItems.add(item.trim())
    }
  }
  const coverage_orphans: string[] = []
  for (const item of masterAssignments) {
    // Allow loose-match: an assignment "Sunday service time (10:15am)"
    // is covered by a content_item "Sunday service time".
    const claimed = [...claimedItems].some(c =>
      item.toLowerCase().startsWith(c.toLowerCase()) ||
      c.toLowerCase().startsWith(item.toLowerCase().split('(')[0].trim()),
    )
    if (!claimed) coverage_orphans.push(item)
  }
  if (coverage_orphans.length > 0) {
    issues.push({
      severity: 'warning',
      scope: 'coverage',
      message: `${coverage_orphans.length} content_assignments item(s) not claimed by any section`,
    })
  }

  if (snippets_resolvable_via_proposed.length > 0) {
    issues.push({
      severity: 'info',
      scope: 'snippets',
      message: `${snippets_resolvable_via_proposed.length} missing snippet(s) will resolve when imported (cowork proposed them)`,
    })
  }
  if (snippets_unresolved.length > 0) {
    issues.push({
      severity: 'warning',
      scope: 'snippets',
      message: `${snippets_unresolved.length} missing snippet(s) — page will import, but {{tokens}} render as literals until you add the snippet to the library or fix the brief`,
    })
  }
  if (needs_input.length > 0) {
    issues.push({
      severity: 'warning',
      scope: 'needs_input',
      message: `${needs_input.length} [NEEDS INPUT: ...] placeholder(s) — non-blocking, but must be resolved before the page goes live`,
    })
  }

  return {
    valid: !issues.some(i => i.severity === 'error'),
    issues,
    snippets_referenced: [...referenced],
    snippets_missing: missing,
    snippets_resolvable_via_proposed,
    snippets_unresolved,
    snippets_to_add,
    needs_input,
    coverage_orphans,
  }
}

export interface ImportResult {
  page_id: string
  created: boolean      // true = new page, false = updated existing
  sections_created: number
  sections_replaced: number
  snippets_added: number
  /** Auto-bind summary produced by autoBindPageSections() after the
   *  freehand sections are inserted. Null when the import did not
   *  attempt auto-bind (no brief sections, e.g.). */
  auto_bind: import('./webAutoBind').PageAutoBindResult | null
}

/** Multi-page bundle — cowork can emit several pages in one payload
 *  wrapped under `pages: [...]`. Top-level `phase` (and any other
 *  meta fields) act as defaults inherited by each child page when the
 *  child doesn't set its own. */
export interface PageBriefBundle {
  member_id?: string
  site?: string
  phase?: string
  pages: PageBrief[]
  [k: string]: unknown
}

/** True when the parsed JSON looks like a multi-page bundle. */
export function isPageBriefBundle(parsed: unknown): parsed is PageBriefBundle {
  return typeof parsed === 'object'
    && parsed !== null
    && Array.isArray((parsed as PageBriefBundle).pages)
    && (parsed as PageBriefBundle).pages.length > 0
}

export interface BundleImportResult {
  results: Array<{ page_slug: string; page_title: string; result?: ImportResult; error?: string }>
  total: number
  succeeded: number
  failed: number
}

/** Import every page in a multi-page bundle sequentially. Inherits the
 *  bundle's top-level phase when a page doesn't set its own. Failures
 *  in one page don't stop the rest. */
export async function importBundle(
  bundle: PageBriefBundle,
  project: StrategyWebProject,
  options: { addProposedSnippets?: boolean } = {},
  onProgress?: (done: number, total: number, currentPageTitle: string) => void,
): Promise<BundleImportResult> {
  const results: BundleImportResult['results'] = []
  const total = bundle.pages.length
  for (let i = 0; i < total; i++) {
    const page = { ...bundle.pages[i] }
    // Inherit bundle-level phase when the page doesn't carry one.
    if (!page.phase && bundle.phase) page.phase = bundle.phase
    onProgress?.(i, total, page.page_title ?? page.page_slug ?? `Page ${i + 1}`)
    const { result, error } = await importBrief(page, project, options)
    results.push({
      page_slug: page.page_slug ?? '',
      page_title: page.page_title ?? '',
      result,
      error,
    })
  }
  onProgress?.(total, total, '')
  const succeeded = results.filter(r => r.result && !r.error).length
  return {
    results,
    total,
    succeeded,
    failed: total - succeeded,
  }
}

/**
 * Import a brief. Creates the web_pages row if a page with this slug
 * doesn't exist on the project; updates the brief if it does.
 * Replaces all existing sections on the page (MVP behavior — Step 2
 * will add section-level merge).
 */
export async function importBrief(
  briefIn: PageBrief,
  project: StrategyWebProject,
  options: {
    addProposedSnippets?: boolean
  } = {},
): Promise<{ result?: ImportResult; error?: string }> {
  // Working copy of the brief — the auto-tokenize pass below mutates it.
  let brief: PageBrief = briefIn
  // Find existing page
  const { data: existingPage } = await supabase
    .from('web_pages')
    .select('id, slug, sort_order')
    .eq('web_project_id', project.id)
    .eq('slug', brief.page_slug)
    .eq('archived', false)
    .maybeSingle()

  let pageId: string
  let created = false

  if (existingPage) {
    pageId = (existingPage as { id: string }).id
    const { error: updateErr } = await supabase
      .from('web_pages')
      .update({
        name: brief.page_title,
        phase: brief.phase ?? '1',
        brief: brief as Record<string, unknown>,
        brief_imported_at: new Date().toISOString(),
      })
      .eq('id', pageId)
    if (updateErr) return { error: `Failed to update page: ${updateErr.message}` }
  } else {
    // Compute sort_order: highest in this project + 1
    const { data: maxRow } = await supabase
      .from('web_pages')
      .select('sort_order')
      .eq('web_project_id', project.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const sort_order = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1

    const { data: newPage, error: createErr } = await supabase
      .from('web_pages')
      .insert({
        web_project_id: project.id,
        name: brief.page_title,
        slug: brief.page_slug,
        phase: brief.phase ?? '1',
        sort_order,
        brief: brief as Record<string, unknown>,
        brief_imported_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (createErr || !newPage) {
      return { error: `Failed to create page: ${createErr?.message ?? 'unknown'}` }
    }
    pageId = (newPage as { id: string }).id
    created = true
  }

  // Add proposed snippets if requested
  let snippets_added = 0
  if (options.addProposedSnippets && brief.snippets_proposed_new?.length) {
    for (const snip of brief.snippets_proposed_new) {
      const token = (snip.key ?? '').replace(/^\{\{|\}\}$/g, '').trim()
      if (!token) continue
      const { error } = await supabase
        .from('web_project_snippets')
        .upsert(
          {
            web_project_id: project.id,
            token,
            label: snip.rationale?.slice(0, 80) ?? token,
            expansion: snip.value ?? '',
            source: 'manual',
          },
          { onConflict: 'web_project_id,token' },
        )
      if (!error) snippets_added++
    }
  }

  // Replace all existing sections on this page with the fresh import.
  // Step 2 will do per-section merge; for MVP this is fine.
  const { count: existingSectionCount } = await supabase
    .from('web_sections')
    .select('id', { count: 'exact', head: true })
    .eq('web_page_id', pageId)
  await supabase.from('web_sections').delete().eq('web_page_id', pageId)

  // Load snippet map first so we can both tokenize the brief AND resolve
  // chips when rendering.
  const snippetOptions = await loadEditorSnippets(project)
  const snippetMap = new Map<string, { value: string; label?: string }>(
    snippetOptions.map(o => [o.token, { value: o.resolvedValue, label: o.label }]),
  )

  // Auto-tokenize: scan brief for the project's known snippet values and
  // promote them to {{tokens}}. Lets cowork emit literal "Riverwood" /
  // "Sundays at 7:45..." everywhere and we promote them so the chip
  // system handles re-resolution.
  const tokenized = tokenizeKnownSnippets(brief, snippetMap)
  brief = tokenized.brief

  const sections = brief.sections ?? []
  let order = 0

  // Hero gets section index 0 if present
  if (brief.hero) {
    const heroBody = renderHero(brief.hero, snippetMap)
    await supabase.from('web_sections').insert({
      web_page_id: pageId,
      content_template_id: null,  // freehand
      field_values: { body: heroBody },
      notes: 'Imported hero block from page brief',
      sort_order: order++,
    })
  }

  for (const section of sections) {
    const body = renderSection(section, snippetMap)
    await supabase.from('web_sections').insert({
      web_page_id: pageId,
      content_template_id: null,
      field_values: { body },
      // Stash the brief-side context here so the strategist can see
      // cowork's intent without it polluting the rendered copy.
      notes: buildSectionNotes(section),
      sort_order: order++,
    })
  }

  // Auto-bind: upgrade every freshly-inserted freehand section to a
  // Brixies template binding. Curated library wins; global catalog
  // ranking is the fallback. Field values fill in from the brief's
  // structured `fields` + body HTML via composeBind.
  let auto_bind: import('./webAutoBind').PageAutoBindResult | null = null
  if (order > 0) {
    const { autoBindPageSections } = await import('./webAutoBind')
    try {
      auto_bind = await autoBindPageSections(pageId, brief, project)
    } catch (e) {
      // Auto-bind failures should not fail the whole import — the
      // sections are still on the page as freehand and can be bound
      // manually from the page editor.
      console.error('[importBrief] auto-bind failed:', e)
      auto_bind = null
    }
  }

  return {
    result: {
      page_id: pageId,
      created,
      sections_created: order,
      sections_replaced: existingSectionCount ?? 0,
      snippets_added,
      auto_bind,
    },
  }
}

// ── Token + needs-input scanning ─────────────────────────────────────

const SNIPPET_RX = /\{\{([a-z0-9_-]+)\}\}/gi
const NEEDS_INPUT_RX = /\[NEEDS INPUT:\s*([^\]]+)\]/gi

function scanForTokensAndInputs(
  brief: PageBrief,
  knownTokens: Set<string>,
): {
  referenced: Set<string>
  missing: string[]
  needs_input: Array<{ scope: string; label: string }>
} {
  const referenced = new Set<string>()
  const needs_input: Array<{ scope: string; label: string }> = []

  const walk = (value: unknown, scope: string) => {
    if (typeof value === 'string') {
      let m: RegExpExecArray | null
      SNIPPET_RX.lastIndex = 0
      while ((m = SNIPPET_RX.exec(value)) !== null) referenced.add(m[1])
      NEEDS_INPUT_RX.lastIndex = 0
      while ((m = NEEDS_INPUT_RX.exec(value)) !== null) {
        needs_input.push({ scope, label: m[1].trim() })
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${scope}[${i}]`))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k.startsWith('_')) continue  // skip _voice_note etc.
        walk(v, scope ? `${scope}.${k}` : k)
      }
    }
  }
  walk(brief, '')

  const missing = [...referenced].filter(t => !knownTokens.has(t))
  return { referenced, missing, needs_input }
}

// ── Section rendering (MVP — freehand HTML with snippet chips) ───────

type SnippetEntry = { value: string; label?: string }
type SnippetMap = Map<string, SnippetEntry>

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Replace {{token}} markers with SnippetNode-compatible chip HTML.
 * The TipTap editor parses these into snippet atoms preserving the
 * link to the snippet library. When a snippet has no value (empty
 * or missing), the chip renders as a visible "{{token}}" placeholder
 * via SnippetNode's fallback, so the strategist sees exactly which
 * snippet still needs filling.
 *
 * Use only for BODY content. URL/href/target values need plain-text
 * resolution — use resolveSnippetsPlain for those.
 */
function resolveSnippetsAsChips(text: string, snippets: SnippetMap): string {
  // First escape the surrounding HTML, then re-inject chips for tokens.
  // Order matters: scan the raw text for tokens, then escape between.
  let out = ''
  let last = 0
  for (const match of text.matchAll(SNIPPET_RX)) {
    const m = match[0]
    const token = match[1]
    const start = match.index ?? 0
    out += escapeHtml(text.slice(last, start))
    const entry = snippets.get(token)
    const value = entry?.value ?? ''
    const label = entry?.label ?? ''
    const isEmpty = !value
    // SnippetNode's renderHTML falls back to "{{token}}" when text is
    // empty, but to drive a distinct visual ("this needs filling"),
    // we explicitly include the token text and set data-empty=true.
    // CSS in index.css styles data-empty chips with a warning color.
    const displayText = isEmpty ? `{{${token}}}` : value
    const titleNote = isEmpty
      ? `Snippet: {{${token}}} (empty — fill in the snippet library so this page resolves automatically)`
      : `Snippet: {{${token}}}${label ? ` (${label})` : ''}`
    const attrs = [
      `data-snippet="${escapeAttr(token)}"`,
      'class="wm-snippet"',
      isEmpty ? 'data-empty="true"' : '',
      label ? `data-snippet-label="${escapeAttr(label)}"` : '',
      `title="${escapeAttr(titleNote)}"`,
    ].filter(Boolean).join(' ')
    out += `<span ${attrs}>${escapeHtml(displayText)}</span>`
    last = start + m.length
  }
  out += escapeHtml(text.slice(last))
  return out
}

/**
 * Resolve {{token}} markers as plain text — for URL targets, attribute
 * values, anything that can't carry inline HTML. Empty/missing snippets
 * fall back to the literal "{{token}}" string so URLs don't silently
 * resolve to nothing.
 */
function resolveSnippetsPlain(text: string, snippets: SnippetMap): string {
  return text.replace(SNIPPET_RX, (full, token) => {
    const entry = snippets.get(token)
    if (!entry || !entry.value) return full // keep literal so it's recoverable
    return entry.value
  })
}

function renderCTA(cta: BriefCTA | undefined, snippets: SnippetMap): string {
  if (!cta?.label) return ''
  // Label uses chips (it's display copy). Target stays plain (it's a URL).
  const label = resolveSnippetsAsChips(cta.label, snippets)
  const target = cta.target ? escapeAttr(resolveSnippetsPlain(cta.target, snippets)) : '#'
  return `<p><a href="${target}"><strong>${label} →</strong></a></p>`
}

function renderHero(hero: BriefHero, snippets: SnippetMap): string {
  const parts: string[] = []
  // Tagline (eyebrow) + H1 + body + CTAs only — no meta annotations.
  // resolveSnippetsAsChips already escapes the surrounding HTML.
  if (hero.tagline) parts.push(`<p><strong>${resolveSnippetsAsChips(hero.tagline, snippets)}</strong></p>`)
  if (hero.h1) parts.push(`<h1>${resolveSnippetsAsChips(hero.h1, snippets)}</h1>`)
  if (hero.body) parts.push(`<p>${resolveSnippetsAsChips(hero.body, snippets)}</p>`)
  if (hero.primary_cta) parts.push(renderCTA(hero.primary_cta, snippets))
  if (hero.secondary_cta) parts.push(renderCTA(hero.secondary_cta, snippets))
  return parts.join('\n')
}

/** First non-empty string value among `obj[keys[i]]`. */
function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

/** Walk every string in a brief and replace occurrences of the project's
 *  known snippet values with their corresponding {{token}}. Lets cowork
 *  emit literal "Riverwood" everywhere; we promote it to {{church_short_name}}
 *  at import so the snippet chip system handles re-resolution downstream.
 *
 *  Skip rules:
 *    - Values shorter than 3 chars (avoid matching "we", "us", etc.)
 *    - Values that are already inside {{tokens}} or `<a href>` URLs
 *    - URL target / href / mailto fields — only body text gets rewritten
 *
 *  Done as a pre-import pass on the brief object so the rendered HTML
 *  has tokens in place when renderSection runs. */
export function tokenizeKnownSnippets(
  brief: PageBrief,
  snippetMap: ReadonlyMap<string, { value: string; label?: string }>,
): { brief: PageBrief; replacements: number } {
  // Build value → token list, sorted longest first so we don't replace
  // "Riverwood" inside "Riverwood Chapel" prematurely.
  const tokensByValue: Array<{ token: string; value: string; valueRx: RegExp }> = []
  for (const [token, entry] of snippetMap.entries()) {
    const v = entry.value?.trim()
    if (!v || v.length < 3) continue
    // Word-boundary on both sides when value starts/ends with alphanumeric;
    // for values like "Sundays at 7:45" the boundary is on whichever side
    // is alphanumeric.
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const startBoundary = /^[a-z0-9]/i.test(v) ? '\\b' : '(?<![a-z0-9])'
    const endBoundary = /[a-z0-9]$/i.test(v) ? '\\b' : '(?![a-z0-9])'
    tokensByValue.push({
      token,
      value: v,
      valueRx: new RegExp(`${startBoundary}${escaped}${endBoundary}`, 'g'),
    })
  }
  tokensByValue.sort((a, b) => b.value.length - a.value.length)

  if (tokensByValue.length === 0) {
    return { brief, replacements: 0 }
  }

  // Don't touch already-tokenized regions {{xxx}} OR URL-y strings —
  // we identify those upstream and skip them. Body fields only.
  const URL_KEYS = new Set(['target', 'url', 'href', 'src'])

  let replacements = 0
  const walk = (val: unknown, parentKey: string): unknown => {
    if (typeof val === 'string') {
      if (URL_KEYS.has(parentKey)) return val
      let next = val
      for (const { token, valueRx } of tokensByValue) {
        // Split around existing {{tokens}} to avoid touching them.
        const segments = next.split(/(\{\{[a-z0-9_-]+\}\})/gi)
        for (let i = 0; i < segments.length; i++) {
          if (i % 2 === 1) continue // odd index = token capture
          const before = segments[i]
          const after = before.replace(valueRx, () => {
            replacements++
            return `{{${token}}}`
          })
          segments[i] = after
        }
        next = segments.join('')
      }
      return next
    }
    if (Array.isArray(val)) {
      return val.map(v => walk(v, parentKey))
    }
    if (typeof val === 'object' && val !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = walk(v, k)
      }
      return out
    }
    return val
  }
  const updated = walk(brief, '') as PageBrief
  return { brief: updated, replacements }
}

/** Split brief prose into paragraphs at blank-line boundaries. */
function renderProseToParas(text: string, snippets: SnippetMap): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${resolveSnippetsAsChips(p, snippets)}</p>`)
}

function renderSection(section: BriefSection, snippets: SnippetMap): string {
  const parts: string[] = []
  const fields = sectionFields(section)

  // Body copy only — section purpose + suggested_template_family + voice_notes
  // live on the section's `notes` field, not in the rendered body.

  // Heading — 'h' (cowork) or 'heading' (legacy)
  const h = firstString(fields, ['h', 'heading'])
  if (h) parts.push(`<h2>${resolveSnippetsAsChips(h, snippets)}</h2>`)

  // Intro — Process-shaped sections have a separate `intro` field before
  // the steps array. Single paragraph.
  const intro = firstString(fields, ['intro'])
  if (intro) parts.push(`<p>${resolveSnippetsAsChips(intro, snippets)}</p>`)

  // Body — cowork's `content` (multi-paragraph) or legacy `body`/`d`/`description`.
  // Multi-paragraph bodies split on blank lines.
  const body = firstString(fields, ['content', 'body', 'description', 'd'])
  if (body) parts.push(...renderProseToParas(body, snippets))

  // Legacy 'secondary' line (single paragraph).
  const secondary = firstString(fields, ['secondary'])
  if (secondary) parts.push(`<p>${resolveSnippetsAsChips(secondary, snippets)}</p>`)

  // Steps (Process Sections shape)
  const steps = Array.isArray(fields.steps) ? fields.steps : []
  if (steps.length > 0) {
    for (const step of steps as Array<Record<string, unknown>>) {
      const sh = firstString(step, ['h3', 'h', 'heading'])
      const sb = firstString(step, ['content', 'body', 'description', 'd'])
      if (sh) parts.push(`<h3>${resolveSnippetsAsChips(sh, snippets)}</h3>`)
      if (sb) parts.push(...renderProseToParas(sb, snippets))
      // Step CTA — cowork uses 'inline_cta', legacy uses 'cta_inline'. Either flies.
      const stepCta = (step.inline_cta ?? step.cta_inline ?? step.cta) as BriefCTA | undefined
      if (stepCta) parts.push(renderCTA(stepCta, snippets))
    }
  }

  // Closer — Process Sections final paragraph after the steps.
  const closer = firstString(fields, ['closer'])
  if (closer) parts.push(`<p>${resolveSnippetsAsChips(closer, snippets)}</p>`)

  // FAQs (FAQ shape — { q, a })
  const faqs = Array.isArray(fields.faqs) ? fields.faqs : []
  if (faqs.length > 0) {
    for (const faq of faqs as Array<Record<string, unknown>>) {
      const q = firstString(faq, ['q', 'question'])
      const a = firstString(faq, ['a', 'answer', 'body', 'content'])
      if (q) parts.push(`<p><strong>${resolveSnippetsAsChips(q, snippets)}</strong></p>`)
      if (a) parts.push(...renderProseToParas(a, snippets))
    }
  }

  // CTAs — either single .cta or primary/secondary pair
  const cta = fields.cta as BriefCTA | undefined
  const primaryCta = fields.primary_cta as BriefCTA | undefined
  const secondaryCta = fields.secondary_cta as BriefCTA | undefined
  if (cta) parts.push(renderCTA(cta, snippets))
  if (primaryCta) parts.push(renderCTA(primaryCta, snippets))
  if (secondaryCta) parts.push(renderCTA(secondaryCta, snippets))

  return parts.join('\n')
}

// ── Snippet chip auto-refresh (called from PagesWorkspace at load) ───

/**
 * Walk an HTML body (saved from a prior import or edit) and refresh
 * every snippet chip's inner text + data-empty attribute against the
 * current snippet library. Idempotent.
 *
 * Why this exists: chips bake their resolved value into the HTML when
 * stored. When a strategist later fills in a previously-empty snippet
 * in the library, existing pages reference the OLD (empty) value
 * unless we refresh. This function is called when each section's body
 * is loaded for display so the chips always reflect the current
 * library state without requiring a re-import.
 */
export function refreshSnippetChips(
  html: string,
  snippets: ReadonlyArray<WMSnippetOption>,
): string {
  if (!html || !html.includes('data-snippet')) return html
  const map = new Map<string, WMSnippetOption>(snippets.map(s => [s.token, s]))
  // DOMParser available in the browser; the importer runs server-side
  // but this refresh runs on the client at load time.
  if (typeof DOMParser === 'undefined') return html
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html')
  const chips = doc.querySelectorAll('span[data-snippet]')
  chips.forEach((chip) => {
    const token = chip.getAttribute('data-snippet')
    if (!token) return
    const entry = map.get(token)
    const value = entry?.resolvedValue ?? ''
    const isEmpty = !value
    chip.textContent = isEmpty ? `{{${token}}}` : value
    if (isEmpty) chip.setAttribute('data-empty', 'true')
    else chip.removeAttribute('data-empty')
    if (entry?.label) chip.setAttribute('data-snippet-label', entry.label)
    chip.setAttribute(
      'title',
      isEmpty
        ? `Snippet: {{${token}}} (empty — fill in the snippet library so this page resolves automatically)`
        : `Snippet: {{${token}}}${entry?.label ? ` (${entry.label})` : ''}`,
    )
    chip.setAttribute('class', 'wm-snippet')
  })
  // Strip the wrapper div we added.
  return doc.body.firstElementChild?.innerHTML ?? html
}

/**
 * Pack brief-side context for a section into a single readable string
 * stored on `web_sections.notes`. Keeps cowork's intent accessible
 * without leaking it into the rendered body copy. The Pages workspace
 * can surface this as a sidebar / dropdown / hover later.
 */
function buildSectionNotes(section: BriefSection): string {
  const lines: string[] = []
  const id = sectionId(section)
  if (id) lines.push(`Section ID: ${id}`)
  if (section.purpose) lines.push(`Purpose: ${section.purpose}`)
  const family = sectionFamily(section)
  if (family) lines.push(`Suggested template family: ${family}`)
  if (Array.isArray(section.content_items) && section.content_items.length > 0) {
    lines.push(`Content items: ${section.content_items.join(' · ')}`)
  }
  if (section.voice_notes) lines.push(`Voice notes: ${section.voice_notes}`)
  return lines.join('\n')
}

/**
 * Pull the brief-side "Suggested template family: …" hint out of a
 * web_sections.notes blob. The importer stashes it via buildSectionNotes;
 * the Pages workspace uses it to pre-filter the catalog when the
 * strategist binds a freehand section to a Brixies template.
 *
 * Returns null if the notes don't carry a suggested family (e.g.
 * sections authored without a brief).
 */
export function extractSuggestedFamily(notes: string | null | undefined): string | null {
  if (!notes) return null
  const match = notes.match(/^\s*Suggested template family:\s*(.+)$/im)
  return match ? match[1].trim() : null
}

// Re-export for the modal to render unresolved-snippet chips, etc.
export type { WMSnippetOption }
