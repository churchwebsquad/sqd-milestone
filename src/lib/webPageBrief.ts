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

export interface BriefSection {
  section_id: string
  purpose?: string
  suggested_template_family?: string
  content_items?: string[]
  voice_notes?: string
  fields?: Record<string, unknown>
  [k: string]: unknown
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
}

/**
 * Import a brief. Creates the web_pages row if a page with this slug
 * doesn't exist on the project; updates the brief if it does.
 * Replaces all existing sections on the page (MVP behavior — Step 2
 * will add section-level merge).
 */
export async function importBrief(
  brief: PageBrief,
  project: StrategyWebProject,
  options: {
    addProposedSnippets?: boolean
  } = {},
): Promise<{ result?: ImportResult; error?: string }> {
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

  // Render each section as a freehand block. Step 2 swaps in Brixies
  // template fitting; for MVP every section is freehand-with-resolved-body.
  const snippetOptions = await loadEditorSnippets(project)
  const snippetMap = new Map<string, { value: string; label?: string }>(
    snippetOptions.map(o => [o.token, { value: o.resolvedValue, label: o.label }]),
  )

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

  return {
    result: {
      page_id: pageId,
      created,
      sections_created: order,
      sections_replaced: existingSectionCount ?? 0,
      snippets_added,
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

function renderSection(section: BriefSection, snippets: SnippetMap): string {
  const parts: string[] = []
  const fields = (section.fields ?? {}) as Record<string, unknown>

  // Body copy only — section purpose + suggested_template_family + voice_notes
  // live on the section's `notes` field, not in the rendered body.

  // Heading
  const h = typeof fields.h === 'string' ? fields.h : ''
  if (h) parts.push(`<h2>${resolveSnippetsAsChips(h, snippets)}</h2>`)

  // Intro / description / body — different briefs use different field names
  const intro = typeof fields.intro === 'string' ? fields.intro : ''
  const body = typeof fields.body === 'string' ? fields.body : ''
  const desc = typeof fields.d === 'string' ? fields.d : ''
  for (const text of [intro, body, desc].filter(Boolean)) {
    parts.push(`<p>${resolveSnippetsAsChips(text, snippets)}</p>`)
  }

  // Secondary line — Brixies-template-overflow content. Renders as a
  // plain paragraph for now; Step 2's overflow panel will offer the
  // strategist a proper resolution (different template, move, drop, etc.)
  const secondary = typeof fields.secondary === 'string' ? fields.secondary : ''
  if (secondary) {
    parts.push(`<p>${resolveSnippetsAsChips(secondary, snippets)}</p>`)
  }

  // Steps (Process Sections shape)
  const steps = Array.isArray(fields.steps) ? fields.steps : []
  if (steps.length > 0) {
    for (const step of steps as Array<Record<string, unknown>>) {
      const h3 = typeof step.h3 === 'string' ? step.h3 : ''
      const stepBody = typeof step.body === 'string' ? step.body : ''
      if (h3) parts.push(`<h3>${resolveSnippetsAsChips(h3, snippets)}</h3>`)
      if (stepBody) parts.push(`<p>${resolveSnippetsAsChips(stepBody, snippets)}</p>`)
      const ctaInline = step.cta_inline as BriefCTA | undefined
      if (ctaInline) parts.push(renderCTA(ctaInline, snippets))
    }
  }

  // FAQs (FAQ shape — { q, a })
  const faqs = Array.isArray(fields.faqs) ? fields.faqs : []
  if (faqs.length > 0) {
    for (const faq of faqs as Array<Record<string, unknown>>) {
      const q = typeof faq.q === 'string' ? faq.q : ''
      const a = typeof faq.a === 'string' ? faq.a : ''
      if (q) parts.push(`<p><strong>${resolveSnippetsAsChips(q, snippets)}</strong></p>`)
      if (a) parts.push(`<p>${resolveSnippetsAsChips(a, snippets)}</p>`)
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
  if (section.section_id) lines.push(`Section ID: ${section.section_id}`)
  if (section.purpose) lines.push(`Purpose: ${section.purpose}`)
  if (section.suggested_template_family) {
    lines.push(`Suggested template family: ${section.suggested_template_family}`)
  }
  if (Array.isArray(section.content_items) && section.content_items.length > 0) {
    lines.push(`Content items: ${section.content_items.join(' · ')}`)
  }
  if (section.voice_notes) lines.push(`Voice notes: ${section.voice_notes}`)
  return lines.join('\n')
}

// Re-export for the modal to render unresolved-snippet chips, etc.
export type { WMSnippetOption }
