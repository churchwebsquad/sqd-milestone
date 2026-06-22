/**
 * Vercel Serverless Function — /api/web/cowork/handoff-to-pages
 *
 * Ground-zero rebuild (commit lineage: plan file). Replaces the
 * earlier translator that hand-rolled uniform→Brixies mappings from
 * a flawed schema scan.
 *
 * NEW CONTRACT:
 *   1. The handoff ALWAYS pushes. No user-facing refusals.
 *   2. For each cowork section: translator emits a renderable
 *      field_values for the picked Brixies template + reports
 *      bind_quality ('perfect' | 'partial') + gaps[].
 *   3. cowork_slot_values is written bit-for-bit (durable source);
 *      field_values is derived (Brixies-shaped, re-derivable on
 *      template swap).
 *   4. Sections that aren't `perfect` push anyway; the Rich Content
 *      Companion side panel in PagesWorkspace gives the strategist
 *      a path forward (manual bind / variant swap / edit content).
 *      No "re-run cowork" failure mode.
 *   5. Gaps are logged to strategy_web_projects.handoff_refusal_log
 *      AND .claude/handoff-refusals.md (Claude-Code-only signal).
 *      Strategist is never notified; the assistant reads the log on
 *      the next session and fixes root causes so future handoffs
 *      produce `perfect` for the same shape.
 *   6. Telemetry: bind_quality distribution per project, perfect_rate.
 *      ≥0.90 = success; <0.90 = "implementation needs more work"
 *      Claude-Code-only flag (NOT shown to strategist).
 *
 * Translator details — composeFieldValuesForBrixies:
 *   - Reads strategy.cowork_templates v2.0.0 manifest per
 *     template_key. Manifest carries: uniform_to_brixies (with per-
 *     template button nesting + items multi-group split rules +
 *     palette refs), richtext_keys, required_slots, max_items.
 *   - Walks the 5 closed cowork slots (primary_heading, tagline,
 *     body, accent_body, items, buttons) + emits a Brixies-named
 *     field_values that matches the template's renderer contract
 *     verbatim (per the verified working examples in Phase 0 audit).
 *   - Wraps richtext-typed values in <p>…</p> if input isn't already
 *     HTML (renderer expects HTML strings for richtext slots).
 *   - For multi-group templates (accordion_faq): splits items
 *     alternating across two group fields.
 *   - For inverted templates (cta_callout): writes buttons into
 *     the schema's `image` field per verified working data.
 *   - Never writes a string to a known image field — designer
 *     placeholders remain.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { setRoadmapStateAtomic } from '../agents/_lib/roadmapStateMerge.js'

export const maxDuration = 60

// ── Types (mirror cowork artifact + manifest shapes) ──────────────

interface CoworkDraftSection {
  section_intent_id?: string
  template_key?:      string
  // Cowork's three historic emission shapes for slot data. The handoff
  // normalizes all three into a flat dict before binding (see
  // normalizeCoworkSlotValues). NEVER read these directly — use the
  // normalizer so SHAPE inconsistencies don't silently bind empty
  // templates (the bug that bricked Real Life Church + Arvada).
  slot_values?:       Record<string, unknown>   // audit-external-copy SKILL
  field_values?:      Record<string, unknown>   // draft-page SKILL (current)
  slots?:             Array<{
    slot: string
    text?: unknown
    value?: unknown
    provenance?: string
    source_refs?: string[]
  }>                                            // older from-scratch shape (Arvada)
  // Auxiliary fields older drafts use to express buttons/items
  // outside the main slot dict.
  cta_targets?:       Array<{ label: string; target: string }>
  /** Per-card array emitted as a root-level sibling by cowork's
   *  feature_card_carousel_proxy / cards_with_cta archetypes. Each
   *  entry uses {name, description, cta_label, cta_target} — the
   *  normalizer remaps them to canonical item subfields. */
  build_cards?:       Array<Record<string, unknown>>
  atoms_used?:        string[]
  facts_used?:        string[]
  crawl_topics_used?: string[]
  deferred_items?:    Array<Record<string, unknown>>
  deferred_atoms?:    Array<Record<string, unknown>>
  voice_notes?:       string | null
  actual_verbatim_ratio?: number | null
  _meta?: Record<string, any>
}

/** Normalize whatever shape the cowork draft emitted into a flat
 *  Record<slot, value> dict the translator can bind. Three shapes
 *  have shipped over the lifetime of the pipeline:
 *
 *    1. `slot_values: { primary_heading, body, buttons[], … }`
 *       — audit-external-copy SKILL (verbatim Notion ingest).
 *    2. `field_values: { primary_heading, body, buttons[], … }`
 *       — current draft-page SKILL (from-scratch authoring).
 *    3. `slots: [{slot: 'primary_heading', text: '…'}, …]`
 *       — older from-scratch shape (Arvada and similar). Buttons
 *       arrive separately via `cta_targets[]` so we splice them in.
 *
 *  Without this normalizer the handoff only read shape #1, which
 *  meant from-scratch projects bound to empty templates while
 *  audit-branch projects worked — a silent visual failure. */
/** Remap a `build_cards` entry's field names to the canonical item
 *  subfields the binder expects. Cowork emits build_cards in multiple
 *  shapes depending on archetype:
 *
 *    A. Canonical (ministry):  {name, description, cta_label, cta_target}
 *    B. Counselor:             {name, email, phone, location}
 *    C. Volunteer:             {role, team, cta_label, cta_target, description}
 *
 *  Without remap, B's email/phone/location were silently dropped; C's
 *  role/team never reached item_heading and the card rendered empty.
 *  This handler:
 *   • surfaces name → item_heading (fallback role for shape C)
 *   • surfaces description → item_body (or composes one from contact
 *     fields when only email/phone/location are present)
 *   • surfaces cta_label / cta_target → item_cta_label / item_cta_url
 *   • surfaces team → item_meta when present alongside role */
function remapBuildCard(card: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...card }

  // Heading: prefer existing → name → role
  if (!out.item_heading && !out.heading && !out.title) {
    if (out.name)      out.item_heading = out.name
    else if (out.role) out.item_heading = out.role
  }

  // Meta: team name lands here when present (volunteer cards)
  if (!out.item_meta && !out.meta && out.team) {
    out.item_meta = out.team
  }

  // Body: description as-is, or compose from contact fields for
  // counselor-shape cards. Lines stack vertically as plain HTML so
  // the rendered card has something to show even when description
  // is absent.
  if (!out.item_body && !out.body) {
    if (out.description) {
      out.item_body = out.description
    } else {
      const contactLines: string[] = []
      if (typeof out.email    === 'string' && out.email)    contactLines.push(`<p>${escapeHtml(out.email)}</p>`)
      if (typeof out.phone    === 'string' && out.phone)    contactLines.push(`<p>${escapeHtml(out.phone)}</p>`)
      if (typeof out.location === 'string' && out.location) contactLines.push(`<p>${escapeHtml(out.location)}</p>`)
      if (contactLines.length > 0) out.item_body = contactLines.join('\n')
    }
  }

  if (out.cta_label && !out.item_cta_label) {
    out.item_cta_label = out.cta_label
  }
  if (out.cta_target && !out.item_cta_url && !out.cta_url) {
    out.item_cta_url = out.cta_target
  }
  return out
}

function normalizeCoworkSlotValues(section: CoworkDraftSection): Record<string, unknown> {
  const raw: Record<string, unknown> = (() => {
    if (section.slot_values && typeof section.slot_values === 'object' && !Array.isArray(section.slot_values)) {
      return { ...section.slot_values }
    }
    if (section.field_values && typeof section.field_values === 'object' && !Array.isArray(section.field_values)) {
      return { ...section.field_values }
    }
    if (Array.isArray(section.slots)) {
      const out: Record<string, unknown> = {}
      // Pack pseudo-slot keys like `items[0]`, `items[1]`, `body[1]`
      // into proper arrays. Arvada-era cowork emits this shape — a
      // flat slots[] descriptor list where multi-row content uses
      // bracket-indexed names instead of a real array. Without the
      // packing, the translator looks for `slotValues.items` and
      // finds nothing (all 5 belief cards / 7 ministry items
      // silently dropped on Arvada Vineyard).
      const indexed = new Map<string, Map<number, unknown>>()
      for (const s of section.slots) {
        if (!s || typeof s !== 'object' || typeof s.slot !== 'string') continue
        const value = s.text ?? s.value ?? null
        if (s.slot === 'buttons') continue   // handled via cta_targets
        const m = s.slot.match(/^([a-z_]+)\[(\d+)\]$/i)
        if (m) {
          const [, name, idx] = m
          if (!indexed.has(name)) indexed.set(name, new Map())
          indexed.get(name)!.set(Number(idx), value)
        } else {
          out[s.slot] = value
        }
      }
      // Flush indexed pseudo-slots into proper arrays.
      for (const [name, byIdx] of indexed) {
        const arr: unknown[] = []
        const sortedKeys = [...byIdx.keys()].sort((a, b) => a - b)
        for (const k of sortedKeys) arr[k] = byIdx.get(k)
        const compact = arr.filter(v => v != null && v !== '')
        if (name === 'items') {
          // Items in this legacy shape are strings like
          // "Title: Body". The translator's splitConflatedItem
          // will split heading + body when binding.
          out.items = compact.map(v => ({ item_body: v }))
        } else if (name === 'body') {
          // body[0]/body[1] — concatenate as multi-paragraph body.
          out.body = compact.map(String).join('\n\n')
        } else {
          out[name] = compact
        }
      }
      // build_cards[] is the carousel-proxy archetype's sibling array
      // for per-card content. Same shape cowork emits in slot_values /
      // field_values, but as a root-level sibling here. Surface as
      // items[] so the binder sees them.
      if (Array.isArray(section.build_cards) && section.build_cards.length > 0 && !out.items) {
        out.items = section.build_cards.map(c =>
          remapBuildCard((c && typeof c === 'object') ? c as Record<string, unknown> : { item_body: String(c ?? '') }),
        )
      }

      // cta_targets[] carries every CTA the section author authored.
      // Some templates use them as TOP-LEVEL buttons; others use them
      // as per-item CTAs (one per card). Match by count:
      //   • N items + N cta_targets    → all per-item CTAs
      //   • N items + (N+1) cta_targets → first is primary button,
      //     rest are per-item
      //   • Otherwise                   → all top-level buttons
      if (Array.isArray(section.cta_targets) && section.cta_targets.length > 0) {
        const items = Array.isArray(out.items) ? out.items as Array<Record<string, unknown>> : []
        const ctas  = section.cta_targets
        if (items.length > 0 && (ctas.length === items.length || ctas.length === items.length + 1)) {
          const offset = ctas.length - items.length        // 0 or 1
          if (offset === 1) {
            out.buttons = [{
              label: ctas[0].label,
              url:   ctas[0].target,
              kind:  'primary' as const,
            }]
          }
          for (let i = 0; i < items.length; i++) {
            const cta = ctas[i + offset]
            if (!cta) continue
            items[i].item_cta_label = cta.label
            items[i].item_cta_url   = cta.target
          }
        } else {
          // Fall back to all-buttons mode.
          out.buttons = ctas.map((t, i) => ({
            label: t.label,
            url:   t.target,
            kind:  (i === 0 ? 'primary' : 'secondary') as 'primary' | 'secondary',
          }))
        }
      }
      return out
    }
    return {}
  })()
  // Canonicalize aliased keys onto the uniform vocabulary so the
  // persisted cowork_slot_values + the Rich Companion display the
  // canonical names. Without this, Rich Companion's ITEMS panel
  // shows count=0 because the data lives under `build_cards`.
  // Also remap each card's field names so the binder finds heading
  // and URL on entries that came via slot_values / field_values.
  if (Array.isArray(raw.build_cards) && !raw.items) {
    raw.items = (raw.build_cards as Array<unknown>).map(c =>
      remapBuildCard((c && typeof c === 'object') ? c as Record<string, unknown> : { item_body: String(c ?? '') }),
    )
    delete raw.build_cards
  }
  return raw
}

// ── Schema-driven binding contract ────────────────────────────────
// Per-template alias map derived from the Brixies fields[] schema.
// Single source of truth for "which Brixies field receives which
// cowork uniform slot". Replaces the per-template uniform_to_brixies
// block that used to live in the strategy.cowork_templates manifest.

interface BrixiesTemplate {
  id:     string
  fields: BrixiesFieldDef[] | null
  cowork_alias_map: CoworkAliasMap | null
}

interface BrixiesFieldDef {
  key:    string
  kind:   'slot' | 'group'
  type?:  string
  item_schema?: BrixiesFieldDef[]
  referenced_template_id?: string
  default_count?: number
}

interface NestedCtaAlias {
  in_group:    string
  label_field: string
  url_field?:  string
  nesting:     'flat' | 'contact'
}
interface ItemsAlias {
  field:     string
  subfields: {
    item_heading?:    string
    item_body?:       string
    item_meta?:       string
    item_cta_label?:  string | NestedCtaAlias
    item_cta_url?:    string
    item_image?:      string
  }
  referenced_template_id?: string
  max_items?: number
  /** When set, items distribute across two parallel groups
   *  (faq-section-10 accordion_left + accordion_right). */
  split?: { groups: string[]; rule: 'alternate' | 'halve' }
  /** When the row content lives nested inside another group
   *  (team-section-14: row_grid → card_team subfields). */
  inner_group_field?: string
  inner_group_default_count?: number
}

interface CoworkAliasMap {
  primary_heading?: string
  tagline?:         string
  body?:            string
  accent_body?:     string
  /** Video / embed slot. When cowork emits `embed_url` (iframe HTML
   *  or YouTube/Vimeo URL), the handoff writes it here. Added v82 for
   *  testimonial_video / content_video. */
  embed_url?:       string
  items?: ItemsAlias
  buttons?: {
    field:     string
    subfields: { label?: string; url?: string }
    nesting:   'flat' | 'contact' | 'cta_slot'
    max_items?: number
    is_slot?:  boolean
  }
}

interface ManifestEntry {
  template_id:           string
  cowork_writable_slots: Record<string, { max_chars?: number; max_items?: number; required?: boolean }>
  uniform_to_brixies: {
    tagline:         string | null
    primary_heading: string | null
    body:            string | null
    accent_body:     string | null
    buttons: null | {
      field:     string
      subfields: { label: string; url: string | null }
      nesting:   'flat' | 'contact'
    }
    items: null | {
      field?:    string                        // single-group templates
      subfields: { item_heading: string | null; item_body: string | null; item_meta: string | null }
      split:     null | { groups: string[]; rule: 'alternate' | 'halve' }
    }
  }
  richtext_keys:    string[]
  required_slots:   string[]
  verified:         boolean
  palette_ref?:     string | null
  notes?:           string
}

interface BindResult {
  field_values: Record<string, unknown>
  bind_quality: 'perfect' | 'partial'
  gaps:         Array<{ kind: string; severity: 'info' | 'warning' | 'blocker'; detail: string; slot?: string }>
  /** Cowork-emitted content that didn't have a binding home in the
   *  picked template. Surfaced on cowork_section_meta.dropped_content
   *  so the strategist can recover it without re-running cowork —
   *  typically because the template_key picked doesn't have an items
   *  group (e.g. feature_card_carousel_proxy → feature-section-6). */
  dropped_content?: Record<string, unknown>
}

// ── Translator ────────────────────────────────────────────────────

/** Wrap plain text in <p>...</p> if it isn't already HTML. Renderer
 *  expects HTML strings for richtext slots; cowork emits plain text
 *  for some slots and HTML for others. Normalize at bind time. */
function ensureHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Already-HTML detection: starts with a block tag.
  if (/^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(trimmed)) {
    return trimmed
  }
  // Multi-paragraph: split on double newline.
  const paras = trimmed.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean)
  if (paras.length > 1) {
    return paras.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
  }
  return `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isHtmlAlready(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(value.trim())
}

/** Wrap a bare YouTube / Vimeo URL in a responsive iframe so Brixies
 *  can render it. YouTube watch URLs and short URLs are normalized to
 *  the `/embed/<id>` path; Vimeo to `player.vimeo.com/video/<id>`.
 *  Anything else falls through as a plain link inside a <p>. */
function wrapVideoUrlAsIframe(url: string): string {
  const trimmed = url.trim()
  // YouTube — watch, share, shorts
  const yt = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i)
  if (yt) {
    const id = yt[1]
    return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${id}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
  }
  // Vimeo
  const vm = trimmed.match(/vimeo\.com\/(?:video\/)?(\d{6,})/i)
  if (vm) {
    const id = vm[1]
    return `<div class="video-embed"><iframe src="https://player.vimeo.com/video/${id}" title="Vimeo video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`
  }
  // Unknown host — leave the URL in an anchor; partner can swap to
  // an iframe later if needed.
  return `<p><a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a></p>`
}

/** Rescue-split for items where cowork conflated multiple fields
 *  into a single string. Returns a NEW object with the split applied;
 *  the input is untouched.
 *
 *  Two patterns survive this in real cowork output:
 *    1. `item_heading: "Thad Harless - Lead Pastor"`  — name + role
 *       split by ` - ` / ` – ` / ` | `. The right side becomes
 *       `item_meta` (the title/role subfield in feature_team templates).
 *    2. `item_body: "Connect in Love: Building genuine relationships..."`
 *       — heading + prose split by the FIRST `: ` when the prefix is
 *       under ~50 chars (looks like a label, not a sentence with a
 *       random colon mid-thought).
 *
 *  Splits ONLY when the destination field would otherwise be empty —
 *  if cowork emitted both heading + body cleanly, we never touch them.
 *  Also skip when the candidate split would leave one side empty.
 */
function splitConflatedItem(
  it: Record<string, unknown>,
  options?: { hasMetaDestination?: boolean },
): Record<string, unknown> {
  const out = { ...it }
  // When the destination template has no item_meta slot, Pattern 1's
  // "Name | Role" split silently destroys the right half. Better to
  // preserve the full heading verbatim. Arvada care/s5 counselor list:
  // "Ryan Ahlenius | Lumen Counseling" → split into name + org, but
  // card-193 has no item_meta destination, so the org disappeared.
  const hasMetaDestination = options?.hasMetaDestination !== false
  const rawH = typeof out.item_heading === 'string' ? out.item_heading
             : typeof out.heading === 'string'      ? out.heading
             : typeof out.title === 'string'        ? out.title
             : ''
  const rawB = typeof out.item_body === 'string' ? out.item_body
             : typeof out.body === 'string'      ? out.body
             : typeof out.description === 'string' ? out.description
             : ''
  const rawM = typeof out.item_meta === 'string' ? out.item_meta
             : typeof out.meta === 'string'      ? out.meta
             : ''

  // Pattern 1 — heading carries `Name - Role` and meta is empty.
  // Only applies when the destination template has a meta slot to
  // receive the right half; otherwise the split is destructive.
  if (rawH && !rawM && hasMetaDestination) {
    // Match ` - `, ` – `, ` — `, ` | ` — the canonical role-separator
    // shapes. Require spaces on both sides so we don't false-split
    // hyphenated names ("Mary-Kate") or punctuation-heavy content.
    const m = rawH.match(/^(.{2,80}?)\s+[-–—|]\s+(.{2,140})$/)
    if (m && m[1].trim() && m[2].trim()) {
      const left  = m[1].trim()
      const right = m[2].trim()
      // Refuse to split when the dash is INSIDE a parenthetical run:
      // `Real Life Kids (Birth - 5th Grade)` would otherwise lose the
      // closing paren. Count unbalanced parens on the left half;
      // if there's an unclosed `(`, the dash is inside an aside.
      const opens = (left.match(/\(/g) ?? []).length
      const closes = (left.match(/\)/g) ?? []).length
      const insideParen = opens > closes
      // Also refuse when the right half has parens or slashes — a
      // "role" segment (Lead Pastor, Worship Director) doesn't carry
      // those; if it does, the dash is probably mid-clause prose.
      const rightLooksLikeRole = !/[()/]/.test(right)
      if (!insideParen && rightLooksLikeRole) {
        out.item_heading = left
        out.item_meta    = right
      }
    }
  }

  // Pattern 2 — body carries `Label: Body` and heading is empty.
  if (rawB && !rawH) {
    // First `: ` only. The label half must be reasonably short
    // (<=50 chars) so we don't break a sentence whose subordinate
    // clause happens to contain a colon.
    const idx = rawB.indexOf(': ')
    if (idx > 0 && idx <= 50) {
      const left  = rawB.slice(0, idx).trim()
      const right = rawB.slice(idx + 2).trim()
      // Require the left side to NOT contain sentence punctuation
      // (that's how we know it's a label, not a clause).
      if (left && right && !/[.?!]/.test(left)) {
        out.item_heading = left
        out.item_body    = right
      }
    }
  }

  return out
}

// ── Schema-driven translator (v81+) ───────────────────────────────
//
// Source of truth: web_content_templates.cowork_alias_map (auto-
// derived by scripts/derive-cowork-aliases.ts from each Brixies
// template's fields[] schema). The legacy manifest-driven translator
// below (composeFieldValuesForBrixies) is retained only for refusal
// fallbacks; new sections bind through this path.

// Cowork archetypes that intend to emit per-card content. When one of
// these archetypes emits NO items, that's content loss worth flagging.
// Other archetypes (hero, content prose, cta) commonly land on
// templates that have an items group but the archetype itself never
// fills it — those don't warrant a warning.
const CARD_BEARING_ARCHETYPES = new Set([
  'cards_with_cta',
  'feature_card_carousel_proxy',
  'accordion_faq',
  'feature_team',
  'content_featured_a',
  'feature_grid',
  'testimonial_grid',
  'timeline_steps',
])

// Slot names the handoff knows how to bind. Anything outside this
// set that cowork emits gets surfaced as `noncanonical_slots_dropped`
// so the strategist can recover the content (Arvada home/s2 lost
// body_2/items_2, groups/s1 lost why/lead — all via this mechanism).
const CANONICAL_UNIFORM_SLOTS = new Set([
  'primary_heading',
  'tagline',
  'body',
  'accent_body',
  'items',
  'buttons',
  'embed_url',
  'build_cards',
])

function composeFromCoworkAliasMap(
  slotValues: Record<string, unknown>,
  brixies:    BrixiesTemplate,
  templateKey: string,
  requiredSlots: string[],
): BindResult {
  const fv: Record<string, unknown> = {}
  const gaps: BindResult['gaps'] = []
  const droppedContent: Record<string, unknown> = {}
  const map = brixies.cowork_alias_map

  if (!map) {
    gaps.push({
      kind: 'no_cowork_alias_map',
      severity: 'blocker',
      detail: `Brixies template '${brixies.id}' has no cowork_alias_map. Run scripts/derive-cowork-aliases.ts --apply to populate it.`,
    })
    return { field_values: {}, bind_quality: 'partial', gaps, dropped_content: { _raw: slotValues } }
  }

  // Compute richtext keys live from the schema rather than carrying a
  // separate list. Any top-level slot of type='richtext' is richtext;
  // group subfields handled inside the items branch.
  const richtextKeys = new Set<string>()
  for (const f of brixies.fields ?? []) {
    if (f.kind === 'slot' && f.type === 'richtext') richtextKeys.add(f.key)
  }

  // ── Scalars ────────────────────────────────────────────────────
  // `embed_url` is iframe HTML or a video URL; the template's
  // video_embed field is richtext-typed so the wrap-in-<p> path
  // would mangle iframe markup. The bind below treats embed_url
  // specially — it passes the value through verbatim when it
  // looks like HTML (starts with `<`), and wraps in a YouTube
  // embed when it's a bare URL.
  for (const uniformKey of ['tagline', 'primary_heading', 'body', 'accent_body', 'embed_url'] as const) {
    const v = slotValues[uniformKey]
    if (v == null || v === '') continue
    const dest = map[uniformKey]
    if (!dest) {
      // Stash unbindable scalar content so the strategist can
      // recover it (e.g. tagline emitted but feature-section-2 has
      // no tagline slot). The Pages workspace can surface this via
      // cowork_section_meta.dropped_content.
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted '${uniformKey}' but template '${brixies.id}' has no destination field`,
        slot: uniformKey,
      })
      droppedContent[uniformKey] = v
      continue
    }
    if (uniformKey === 'embed_url') {
      // Video / embed slot — pass iframe markup through verbatim;
      // expand bare YouTube / Vimeo URLs into a responsive iframe.
      const s = String(v).trim()
      if (s.startsWith('<')) {
        fv[dest] = s
      } else if (/^https?:\/\//i.test(s)) {
        fv[dest] = wrapVideoUrlAsIframe(s)
      } else {
        fv[dest] = s
      }
    } else if (richtextKeys.has(dest)) {
      fv[dest] = typeof v === 'string'
        ? (isHtmlAlready(v) ? v : ensureHtml(v))
        : ensureHtml(String(v))
    } else {
      fv[dest] = String(v)
    }
  }

  // ── Items ──────────────────────────────────────────────────────
  // Accept both canonical `items` and the legacy `build_cards` alias.
  const rawItems = Array.isArray(slotValues.items)      ? slotValues.items
                : Array.isArray(slotValues.build_cards) ? slotValues.build_cards
                                                        : null
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const items = rawItems as Array<Record<string, unknown>>
    if (!map.items) {
      // No items group on this template. Recover by folding the items
      // into the body as a definition-list-style HTML fragment so the
      // content survives the bind. This is the Arvada plan-a-visit/s2
      // case: manifest picked content_image_text_b for a section that
      // cowork emitted as paragraph + cards.
      if (map.body) {
        const folded = items.map(it => {
          // No meta destination on this fold path — body is the only target.
          const enriched = splitConflatedItem(it, { hasMetaDestination: false })
          const h = String(enriched.item_heading ?? enriched.heading ?? enriched.title ?? '').trim()
          const b = String(enriched.item_body ?? enriched.body ?? enriched.description ?? '').trim()
          const bodyHtml = b ? (isHtmlAlready(b) ? b : ensureHtml(b)) : ''
          if (h && bodyHtml) return `<p><strong>${escapeHtml(h)}</strong></p>\n${bodyHtml}`
          if (h)             return `<p><strong>${escapeHtml(h)}</strong></p>`
          return bodyHtml
        }).filter(Boolean).join('\n')
        const existingBody = typeof fv[map.body] === 'string' ? fv[map.body] as string : ''
        fv[map.body] = existingBody ? `${existingBody}\n${folded}` : folded
        gaps.push({
          kind: 'items_folded_into_body',
          severity: 'warning',
          detail: `Template '${brixies.id}' has no items group; folded ${items.length} item(s) into the body field. Consider repointing the manifest to a template with a cards group.`,
          slot: 'items',
        })
      } else {
        gaps.push({
          kind: 'uniform_slot_not_supported_by_template',
          severity: 'blocker',
          detail: `cowork emitted ${items.length} item(s) but template '${brixies.id}' (key '${templateKey}') has neither an items group nor a body field to fold into. Pick a template whose Brixies schema has a cards/items group.`,
          slot: 'items',
        })
      }
      droppedContent.items = items
    } else {
      const composeRow = (it: Record<string, unknown>): Record<string, unknown> => {
        const subs = map.items!.subfields
        // Pass the destination shape so splitConflatedItem doesn't
        // destroy "Name | Org" headings when the template has no
        // meta slot (e.g. card-193, used by feature-section-2 / -82).
        const enriched = splitConflatedItem(it, { hasMetaDestination: !!subs.item_meta })
        const row: Record<string, unknown> = {}
        if (subs.item_heading) {
          const v = enriched.item_heading ?? enriched.heading ?? enriched.title ?? ''
          row[subs.item_heading] = String(v)
        }
        if (subs.item_body) {
          const v = enriched.item_body ?? enriched.body ?? enriched.description ?? ''
          row[subs.item_body] = String(v)   // richtext handling on item subfields
            && (richtextSubfield(brixies, map.items!.field, subs.item_body, map.items!.inner_group_field)
                ? (isHtmlAlready(v) ? v : ensureHtml(String(v)))
                : String(v))
        }
        if (subs.item_meta) {
          const v = enriched.item_meta ?? enriched.meta ?? ''
          row[subs.item_meta] = String(v)
        }
        if (subs.item_cta_label) {
          const lbl = enriched.item_cta_label ?? enriched.cta_label ?? ''
          if (lbl) {
            const url = enriched.item_cta_url ?? enriched.cta_url ?? ''
            if (typeof subs.item_cta_label === 'object') {
              // Nested CTA: card-193 style, where the per-card button
              // lives one level deeper inside the card's own buttons
              // group. Write row.<in_group> = [{ <label_field>: { url, label } }]
              // (contact nesting) or [{ <label_field>: label, <url_field>: url }]
              // (flat nesting).
              const cta = subs.item_cta_label
              const entry = cta.nesting === 'contact'
                ? { [cta.label_field]: { url: String(url), label: String(lbl) } }
                : {
                    [cta.label_field]: String(lbl),
                    ...(cta.url_field ? { [cta.url_field]: String(url) } : {}),
                  }
              row[cta.in_group] = [entry]
            } else {
              // Flat CTA — typical Card variants pack url+label into
              // a single subfield like { url, label }.
              row[subs.item_cta_label] = subs.item_cta_url && subs.item_cta_url !== subs.item_cta_label
                ? String(lbl)
                : { url: String(url), label: String(lbl) }
              if (subs.item_cta_url && subs.item_cta_url !== subs.item_cta_label) {
                row[subs.item_cta_url] = String(url)
              }
            }
          }
        }
        if (subs.item_image) {
          const img = enriched.item_image
          if (img) row[subs.item_image] = img
        }
        // If the items live nested inside another group (e.g.
        // row_grid → card_team), wrap the row in that group's name.
        if (map.items!.inner_group_field) {
          return { [map.items!.inner_group_field]: [row] }
        }
        return row
      }

      const composedRows = items.map(composeRow)

      // Nested-group packing. Two distinct patterns share the same
      // `inner_group_field` shape; we disambiguate by presence of
      // `referenced_template_id`:
      //
      //   A. Referenced-template wrapper (feature-section-2 → card-193):
      //      Each outer item is its OWN instance of a referenced
      //      template whose content lives inside a wrapping group.
      //      Wrap EACH item individually: outer[] = [{ inner: [item] }, ...].
      //
      //   B. Visual-row wrapper (team-section-14: row_grid → card_team):
      //      The outer group is a visual wrapper; put ALL items into
      //      ONE outer row's inner array and let Bricks' grid CSS
      //      handle responsive wrapping. (Chunking by the template's
      //      seed count produced "3 + 3 + 1" team rows for a 7-person
      //      team — never the intent.)
      if (map.items.inner_group_field) {
        const innerField = map.items.inner_group_field
        const flatRows = composedRows.map(r => {
          // composeRow already wrapped each row in { [innerField]: [row] }.
          const inner = (r as Record<string, unknown>)[innerField]
          return Array.isArray(inner) ? (inner[0] as Record<string, unknown>) : r
        })
        // Pattern disambiguation by the inner group's seed count:
        //   default_count > 1 → outer is a VISUAL WRAPPER (team-section-14
        //   row_grid expects rows of 3 card_team members). Pack ALL
        //   items into ONE outer entry's inner array so Bricks' grid
        //   CSS handles responsive wrapping.
        //   default_count <= 1 (or set via referenced_template_id, which
        //   always implies 1-per-instance because each outer entry is a
        //   separate referenced-template instance) → ONE OUTER PER ITEM.
        //   content-section-89's column_list and feature-section-2's
        //   card (referencing card-193) both follow this rule.
        const isVisualRowWrapper =
          (map.items.inner_group_default_count ?? 1) > 1
          && !map.items.referenced_template_id
        if (map.items.split) {
          const [aKey, bKey] = map.items.split.groups
          const groupA: Array<Record<string, unknown>> = []
          const groupB: Array<Record<string, unknown>> = []
          if (map.items.split.rule === 'alternate') {
            flatRows.forEach((r, idx) => { (idx % 2 === 0 ? groupA : groupB).push(r) })
          } else {
            const half = Math.ceil(flatRows.length / 2)
            flatRows.slice(0, half).forEach(r => groupA.push(r))
            flatRows.slice(half).forEach(r => groupB.push(r))
          }
          if (isVisualRowWrapper) {
            fv[aKey] = [{ [innerField]: groupA }]
            fv[bKey] = [{ [innerField]: groupB }]
          } else {
            fv[aKey] = groupA.map(r => ({ [innerField]: [r] }))
            fv[bKey] = groupB.map(r => ({ [innerField]: [r] }))
          }
        } else if (isVisualRowWrapper) {
          // All items in one outer row (team-section-14 pattern).
          fv[map.items.field] = [{ [innerField]: flatRows }]
        } else {
          // One outer entry per item (default — column_list, card-193 ref).
          fv[map.items.field] = flatRows.map(r => ({ [innerField]: [r] }))
        }
      } else if (map.items.split) {
        // Distribute across two parallel groups (accordion_left + _right).
        const groupA: Array<Record<string, unknown>> = []
        const groupB: Array<Record<string, unknown>> = []
        const [aKey, bKey] = map.items.split.groups
        if (map.items.split.rule === 'alternate') {
          composedRows.forEach((r, idx) => { (idx % 2 === 0 ? groupA : groupB).push(r) })
        } else {
          const half = Math.ceil(composedRows.length / 2)
          composedRows.slice(0, half).forEach(r => groupA.push(r))
          composedRows.slice(half).forEach(r => groupB.push(r))
        }
        fv[aKey] = groupA
        fv[bKey] = groupB
      } else {
        fv[map.items.field] = composedRows
      }
      // No items_overflow warning — Bricks repeaters have no hard cap.
    }
  } else if (map.items && CARD_BEARING_ARCHETYPES.has(templateKey)) {
    // Cowork archetype is one that's MEANT to emit cards (e.g.
    // cards_with_cta, feature_card_carousel_proxy) but emitted none.
    // This was the Arvada Missions partners bug. We restrict the
    // warning to known card-bearing archetypes so hero/text sections
    // (which happen to use templates that ALSO have an items group
    // but don't intend to fill it) don't spam the audit.
    gaps.push({
      kind: 'items_expected_but_none_emitted',
      severity: 'warning',
      detail: `Cowork archetype '${templateKey}' is card-bearing but emitted no items. Template '${brixies.id}' has an items group ready to receive them.`,
      slot: 'items',
    })
  }

  // ── Buttons ────────────────────────────────────────────────────
  const rawButtons = Array.isArray(slotValues.buttons) ? slotValues.buttons : null
  if (Array.isArray(rawButtons) && rawButtons.length > 0) {
    const buttons = rawButtons as Array<Record<string, unknown>>
    if (!map.buttons) {
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted ${buttons.length} button(s) but template '${brixies.id}' has no buttons field in its alias map`,
        slot: 'buttons',
      })
      droppedContent.buttons = buttons
    } else {
      const composedButtons = buttons.map(b => {
        const label = String(b.label ?? '')
        const url   = String(b.url   ?? '')
        if (map.buttons!.nesting === 'contact') {
          // { contact: { url, label } } shape — same field key carries both
          return { [map.buttons!.subfields.label ?? 'contact']: { url, label } }
        }
        return {
          [map.buttons!.subfields.label ?? 'label']: label,
          [map.buttons!.subfields.url   ?? 'url']:   url,
        }
      })
      if (map.buttons.is_slot) {
        // Single CTA slot (e.g. cta-section-52). Write ONE button.
        fv[map.buttons.field] = { url: String(buttons[0].url ?? ''), label: String(buttons[0].label ?? '') }
      } else {
        fv[map.buttons.field] = composedButtons
      }
    }
  }

  // ── Required slots check ───────────────────────────────────────
  for (const reqKey of requiredSlots) {
    if (fv[reqKey] == null || fv[reqKey] === '') {
      gaps.push({
        kind: 'required_slot_missing',
        severity: 'blocker',
        detail: `template '${brixies.id}' requires '${reqKey}' but binding produced no value`,
        slot: reqKey,
      })
    }
  }

  // ── Noncanonical-slot sweep ────────────────────────────────────
  // Cowork sometimes emits slots that aren't in the canonical uniform
  // vocab (Arvada SKILL emitted body_2, items_2, why, lead, coffee_cta).
  // Without surfacing these, the strategist sees "perfect bind" while
  // content silently disappears. Stash them in dropped_content + emit
  // a single warning naming the affected slots.
  const noncanonicalSlots: string[] = []
  for (const key of Object.keys(slotValues)) {
    if (CANONICAL_UNIFORM_SLOTS.has(key)) continue
    if (key.startsWith('_')) continue   // skip metadata fields
    const v = slotValues[key]
    if (v == null || v === '') continue
    noncanonicalSlots.push(key)
    droppedContent[key] = v
  }
  if (noncanonicalSlots.length > 0) {
    const preview = noncanonicalSlots.slice(0, 6).join(', ')
    gaps.push({
      kind: 'noncanonical_slots_dropped',
      severity: 'warning',
      detail: `Cowork emitted ${noncanonicalSlots.length} slot(s) outside the canonical uniform vocab — ${preview}${noncanonicalSlots.length > 6 ? '…' : ''}. Content stashed in cowork_section_meta.dropped_content. Fix the cowork SKILL to emit canonical names (primary_heading / tagline / body / accent_body / items / buttons / embed_url) so the bind step can route them.`,
      slot: 'multiple',
    })
  }

  // Warnings are informational (content still bound, e.g. items folded
  // into body, items count exceeds the template's default repeater
  // count). Only blockers downgrade bind_quality.
  const bind_quality: 'perfect' | 'partial' =
    gaps.some(g => g.severity === 'blocker') ? 'partial' : 'perfect'

  return {
    field_values: fv,
    bind_quality,
    gaps,
    dropped_content: Object.keys(droppedContent).length > 0 ? droppedContent : undefined,
  }
}

/** Is the given subfield key richtext-typed inside the items group? */
function richtextSubfield(
  brixies: BrixiesTemplate, groupField: string, subKey: string,
  innerGroupField: string | undefined,
): boolean {
  if (!Array.isArray(brixies.fields)) return false
  const grp = brixies.fields.find(f => f.key === groupField && f.kind === 'group')
  if (!grp) return false
  const direct = grp.item_schema ?? []
  // Resolve inner group when applicable
  let schema: BrixiesFieldDef[] = direct
  if (innerGroupField) {
    const inner = direct.find(f => f.key === innerGroupField && f.kind === 'group')
    if (inner?.item_schema) schema = inner.item_schema
  }
  // Also resolve referenced_template_id implicitly (the bind-time
  // schema is the parent's; richtext detection on the parent is fine
  // because the parent stores the data inline).
  const sub = schema.find(f => f.key === subKey)
  return sub?.type === 'richtext'
}

/** Legacy translator (manifest-driven). Kept for the refusal fallback
 *  path + early audit-branch sections that still resolve to the
 *  manifest's uniform_to_brixies map. New bindings should route
 *  through composeFromCoworkAliasMap above. */
function composeFieldValuesForBrixies(
  slotValues: Record<string, unknown>,
  entry: ManifestEntry,
): BindResult {
  const fv: Record<string, unknown> = {}
  const gaps: BindResult['gaps'] = []
  const droppedContent: Record<string, unknown> = {}
  const map = entry.uniform_to_brixies
  const richtextKeys = new Set(entry.richtext_keys ?? [])

  // ── Scalars: tagline / primary_heading / body / accent_body ────
  for (const uniformKey of ['tagline', 'primary_heading', 'body', 'accent_body'] as const) {
    const brixiesKey = map[uniformKey]
    const coworkValue = slotValues[uniformKey]
    const hasCowork = coworkValue != null && coworkValue !== ''

    if (brixiesKey == null) {
      // Template has no slot for this uniform key. If cowork emitted
      // content here, that's content the picked template can't show
      // — a gap (but not blocking; strategist sees in the Rich
      // Companion + can swap templates).
      if (hasCowork) {
        gaps.push({
          kind: 'uniform_slot_not_supported_by_template',
          severity: 'warning',
          detail: `cowork emitted '${uniformKey}' but template '${entry.template_id}' has no slot for it; content stays in cowork_slot_values + visible in the Rich Companion`,
          slot: uniformKey,
        })
      }
      continue
    }

    if (!hasCowork) {
      // Cowork didn't fill it. If the slot is required by the template,
      // that's a gap. Don't write to field_values — let the renderer
      // use the Brixies designer placeholder.
      if (entry.required_slots.includes(brixiesKey)) {
        gaps.push({
          kind: 'required_slot_missing',
          severity: 'blocker',
          detail: `template '${entry.template_id}' requires '${brixiesKey}' but cowork did not emit '${uniformKey}'`,
          slot: brixiesKey,
        })
      }
      continue
    }

    // Write the value. Wrap as HTML if this brixies key is richtext.
    if (richtextKeys.has(brixiesKey)) {
      fv[brixiesKey] = isHtmlAlready(coworkValue) ? coworkValue : ensureHtml(coworkValue)
    } else {
      fv[brixiesKey] = String(coworkValue)
    }
  }

  // ── Buttons ────────────────────────────────────────────────────
  if (Array.isArray(slotValues.buttons) && slotValues.buttons.length > 0) {
    const coworkButtons = slotValues.buttons as Array<Record<string, unknown>>
    if (map.buttons == null) {
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted ${coworkButtons.length} button(s) but template '${entry.template_id}' has no button slot`,
        slot: 'buttons',
      })
    } else {
      const { field, subfields, nesting } = map.buttons
      const subL = subfields.label
      const subU = subfields.url
      // Compose the per-template button shape.
      const composed = coworkButtons.map(b => {
        // Cowork's standard shape: {label, url}. Tolerate the rare
        // {contact: "string"} shorthand by normalizing first.
        const label =
          typeof b.label === 'string' ? b.label :
          typeof b.text === 'string' ? b.text :
          typeof b.contact === 'string' ? b.contact :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).label === 'string'
            ? (b.contact as any).label : '')
        const url =
          typeof b.url === 'string' ? b.url :
          typeof b.href === 'string' ? b.href :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).url === 'string'
            ? (b.contact as any).url : '')
        if (!label) {
          gaps.push({
            kind: 'button_missing_label',
            severity: 'warning',
            detail: `button emitted with no label (url='${url}')`,
            slot: 'buttons',
          })
        }
        if (!url) {
          gaps.push({
            kind: 'button_missing_url',
            severity: 'warning',
            detail: `button emitted with no url (label='${label}')`,
            slot: 'buttons',
          })
        }
        if (nesting === 'contact') {
          // {contact: {label, url}} shape
          const inner: Record<string, unknown> = {}
          inner[subL] = label
          if (subU) inner[subU] = url
          return { contact: inner }
        }
        // 'flat' shape — {label, url}
        const row: Record<string, unknown> = {}
        row[subL] = label
        if (subU) row[subU] = url
        return row
      })
      fv[field] = composed
    }
  }

  // ── Items ──────────────────────────────────────────────────────
  // Accept both canonical `items` and the legacy `build_cards` alias —
  // older drafts (and the `feature_card_carousel_proxy` template family)
  // emit cards under `build_cards`. The translator treats them
  // identically. Without this alias the carousel content silently
  // dropped on Real Life's About page.
  const rawItems = Array.isArray(slotValues.items)        ? slotValues.items
                : Array.isArray(slotValues.build_cards)   ? slotValues.build_cards
                                                          : null
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const coworkItems = rawItems as Array<Record<string, unknown>>
    if (map.items == null) {
      // BLOCKER, not warning: the bind looks "successful" until you
      // open the page and the cards/items are gone. Raise loudly so
      // the refusal log + Pages workspace status show that this
      // section needs a different template_key. Stashing the dropped
      // content into the section_meta so the strategist can recover
      // it without re-running cowork.
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'blocker',
        detail: `cowork emitted ${coworkItems.length} item(s) but template '${entry.template_id}' has no items slot. Pick a template_key whose Brixies schema has a card/items group (e.g. feature-section-2/14/28/73). Dropped item content is preserved on the section meta so the strategist can recover it without re-running cowork.`,
        slot: 'items',
      })
      // Stash the unbindable content so the strategist can recover it.
      droppedContent.items = coworkItems
    } else {
      const { field: singleField, subfields, split } = map.items
      const subH = subfields.item_heading
      const subB = subfields.item_body
      const subM = subfields.item_meta

      const composeItem = (it: Record<string, unknown>): Record<string, unknown> => {
        // Rescue split — cowork sometimes packs `Name - Role` or
        // `Heading: Body` into ONE of item_heading / item_body, leaving
        // the other field empty. The renderer then shows a name with
        // a blank title underneath, which reads as broken on the
        // partner-facing layout. Detect the common shapes and split.
        // The rescue NEVER touches values that arrive already-split
        // (when both item_heading + item_body are populated).
        const enriched = splitConflatedItem(it, { hasMetaDestination: subM != null })
        const row: Record<string, unknown> = {}
        if (subH != null) {
          const v = enriched.item_heading ?? enriched.heading ?? enriched.title ?? ''
          row[subH] = String(v)
        }
        if (subB != null) {
          const v = enriched.item_body ?? enriched.body ?? enriched.description ?? ''
          row[subB] = richtextKeys.has(subB)
            ? (isHtmlAlready(v) ? v : ensureHtml(v))
            : String(v)
        }
        if (subM != null) {
          const v = enriched.item_meta ?? enriched.meta ?? ''
          row[subM] = String(v)
        }
        return row
      }

      if (split) {
        // Multi-group templates: distribute across two groups by rule.
        const groupA: Array<Record<string, unknown>> = []
        const groupB: Array<Record<string, unknown>> = []
        if (split.rule === 'alternate') {
          coworkItems.forEach((it, idx) => {
            const composed = composeItem(it)
            if (idx % 2 === 0) groupA.push(composed)
            else groupB.push(composed)
          })
        } else if (split.rule === 'halve') {
          const half = Math.ceil(coworkItems.length / 2)
          coworkItems.slice(0, half).forEach(it => groupA.push(composeItem(it)))
          coworkItems.slice(half).forEach(it => groupB.push(composeItem(it)))
        }
        fv[split.groups[0]] = groupA
        fv[split.groups[1]] = groupB
      } else if (singleField) {
        fv[singleField] = coworkItems.map(composeItem)
      } else {
        gaps.push({
          kind: 'items_field_unmapped',
          severity: 'blocker',
          detail: `template '${entry.template_id}' map declares items support but no field name + no split rule`,
          slot: 'items',
        })
      }

      // No items_overflow warning here either (legacy manifest path).
    }
  }

  // ── Required-slot final sweep (catch any we didn't write above) ─
  for (const reqKey of entry.required_slots) {
    if (fv[reqKey] == null || fv[reqKey] === '') {
      if (!gaps.some(g => g.kind === 'required_slot_missing' && g.slot === reqKey)) {
        gaps.push({
          kind: 'required_slot_missing',
          severity: 'blocker',
          detail: `template '${entry.template_id}' requires '${reqKey}' but no cowork slot mapped to it`,
          slot: reqKey,
        })
      }
    }
  }

  // Warnings are informational (content still bound, e.g. items folded
  // into body, items count exceeds the template's default repeater
  // count). Only blockers downgrade bind_quality.
  const bind_quality: 'perfect' | 'partial' =
    gaps.some(g => g.severity === 'blocker') ? 'partial' : 'perfect'

  return {
    field_values: fv,
    bind_quality,
    gaps,
    dropped_content: Object.keys(droppedContent).length > 0 ? droppedContent : undefined,
  }
}

// ── Handler ───────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

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

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const force     = req.body?.force === true
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Load everything ─────────────────────────────────────────────
  // The manifest is the picker-side resolution: template_key → template_id
  // + richtext_keys + required_slots. The actual translation contract
  // (which Brixies field receives which cowork uniform slot) lives on
  // web_content_templates.cowork_alias_map — one source of truth derived
  // from the Brixies schema itself (scripts/derive-cowork-aliases.ts).
  const [projRes, manifestRes, existingPagesRes, brixiesRes] = await Promise.all([
    sb.from('strategy_web_projects')
      .select('id, name, member, roadmap_state, notion_database_id, notion_database_url')
      .eq('id', projectId)
      .maybeSingle(),
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('web_pages')
      .select('id, slug, sort_order, phase, content_status, cowork_handoff_at')
      .eq('web_project_id', projectId)
      .eq('archived', false),
    sb.from('web_content_templates')
      .select('id, fields, cowork_alias_map')
      .eq('is_published', true),
  ])

  if (projRes.error || !projRes.data)     return res.status(404).json({ error: `project ${projectId} not found: ${projRes.error?.message}` })
  if (manifestRes.error || !manifestRes.data) return res.status(500).json({ error: `canonical templates manifest missing: ${manifestRes.error?.message}` })
  if (existingPagesRes.error)             return res.status(500).json({ error: `web_pages load failed: ${existingPagesRes.error.message}` })
  if (brixiesRes.error)                   return res.status(500).json({ error: `web_content_templates load failed: ${brixiesRes.error.message}` })

  const project   = projRes.data as any
  const manifest  = (manifestRes.data as any).manifest as { page_section_templates: Record<string, ManifestEntry> }
  const templates = manifest?.page_section_templates ?? {}
  const brixiesByTemplateId = new Map<string, BrixiesTemplate>(
    ((brixiesRes.data ?? []) as BrixiesTemplate[]).map(t => [t.id, t]),
  )
  const manifestVersion = (manifestRes.data as any).version as string
  const roadmap   = (project.roadmap_state ?? {}) as Record<string, any>

  const outlines    = (roadmap.page_outlines    ?? {}) as Record<string, any>
  const drafts      = (roadmap.page_drafts      ?? {}) as Record<string, any>
  const critiques   = (roadmap.page_critiques   ?? {}) as Record<string, any>
  // Audit branch (v77): per-page partner-written metadata (verbatim
  // # SEO block + page-final ## GAPS FLAGGED bullets) and the project-
  // wide global_footer extracted from the Notion Type=Footer row or a
  // ## GLOBAL FOOTER block on the homepage. Both shapes are open jsonb
  // — the SKILL writes the verbatim source + parsed structure; the
  // handoff reads it as-is and writes through to the new columns.
  const pageMeta    = (roadmap.cowork_page_meta ?? {}) as Record<string, any>
  const globalFooter = (roadmap.global_footer    ?? null) as Record<string, unknown> | null

  const allSlugs = new Set<string>([
    ...Object.keys(outlines),
    ...Object.keys(drafts),
    ...Object.keys(critiques),
  ])

  if (allSlugs.size === 0) {
    return res.status(400).json({ error: 'no_cowork_artifacts',
      detail: 'roadmap_state has no page_outlines / page_drafts / page_critiques. Run the cowork pipeline first.' })
  }

  // Partner-lock check (still preserved — protects shipped pages).
  const existingPages = (existingPagesRes.data ?? []) as Array<{
    id: string; slug: string; sort_order: number; phase: string; content_status: string; cowork_handoff_at: string | null
  }>
  const partnerLockedSlugs = existingPages
    .filter(p => (p.content_status === 'partner_review' || p.content_status === 'partner_approved') && allSlugs.has(p.slug))
    .map(p => p.slug)
  if (partnerLockedSlugs.length > 0 && !force) {
    return res.status(409).json({
      error: 'partner_locked',
      detail: `Refusing to overwrite ${partnerLockedSlugs.length} page${partnerLockedSlugs.length === 1 ? '' : 's'} in partner review/approval. Pass force=true to proceed.`,
      partner_locked_slugs: partnerLockedSlugs,
    })
  }

  const existingBySlug = new Map(existingPages.map(p => [p.slug, p]))
  let nextSortOrder = existingPages.length
    ? Math.max(...existingPages.map(p => p.sort_order ?? 0)) + 1
    : 0

  const projectAuditBranch = !!project.notion_database_id
  const handoffStartedAt = new Date().toISOString()

  // ── Per-slug processing ─────────────────────────────────────────
  const audit = {
    ran_at:                 handoffStartedAt,
    manifest_version:       manifestVersion,
    branch:                 projectAuditBranch ? 'audit' as const : 'from-scratch' as const,
    pages:                  {} as Record<string, any>,
    total_sections:         0,
    perfect_sections:       0,
    partial_sections:       0,
    perfect_rate:           0,
    total_atoms_preserved:  0,
    total_facts_preserved:  0,
    total_topics_preserved: 0,
    total_deferred:         0,
    gaps_by_kind:           {} as Record<string, number>,
    claude_code_signal:     null as null | { needs_work: boolean; reason: string },
  }
  const refusalEntries: Array<Record<string, unknown>> = []

  for (const slug of Array.from(allSlugs).sort((a, b) => a.localeCompare(b))) {
    const draft    = drafts[slug]   ?? null
    const outline  = outlines[slug] ?? null
    const critique = critiques[slug] ?? null
    const existing = existingBySlug.get(slug) ?? null

    // Page-level audit_source
    const auditSourceForPage =
      (outline?._meta?.audit_source as string | undefined) ??
      (critique?._meta?.audit_source as string | undefined) ??
      (projectAuditBranch ? 'notion' : 'generated')

    const notionUrlForPage =
      (outline?._meta?.notion_url as string | undefined) ??
      (critique?._meta?.notion_url as string | undefined) ??
      (outline?.sections?.[0]?._meta?.notion_url as string | undefined) ?? null

    // v77 — page-level partner-written metadata (audit branch).
    // The SKILL writes this into roadmap_state.cowork_page_meta.<slug>
    // when the page has a `# SEO` block and/or `## GAPS FLAGGED`
    // block. Both fields are nullable jsonb on web_pages — leave null
    // for from-scratch / generated pages.
    const slugPageMeta = (pageMeta[slug] ?? null) as Record<string, unknown> | null
    const seoMetadata          = (slugPageMeta?.seo ?? null) as Record<string, unknown> | null
    const partnerGapsFlagged   = Array.isArray(slugPageMeta?.gaps_flagged)
      ? (slugPageMeta?.gaps_flagged as Array<Record<string, unknown>>)
      : null

    // Upsert web_pages row
    let pageId: string
    if (existing) {
      const { error: updErr } = await sb.from('web_pages')
        .update({
          cowork_handoff_meta: {
            branch:        audit.branch,
            outline_meta:  outline?._meta ?? {},
            critique_meta: critique?._meta ?? {},
            overall_band:  critique?.overall_band ?? null,
            directives:    critique?.directives ?? [],
          },
          audit_source:         auditSourceForPage,
          notion_url:           notionUrlForPage,
          cowork_handoff_at:    handoffStartedAt,
          updated_at:           handoffStartedAt,
          seo_metadata:         seoMetadata,
          partner_gaps_flagged: partnerGapsFlagged,
        })
        .eq('id', existing.id)
      if (updErr) return res.status(500).json({ error: `web_pages update failed for ${slug}: ${updErr.message}` })
      pageId = existing.id
    } else {
      const { data: ins, error: insErr } = await sb.from('web_pages')
        .insert({
          name:                humanizeSlug(slug),
          slug,
          phase:               '1',
          cowork_handoff_meta: {
            branch:        audit.branch,
            outline_meta:  outline?._meta ?? {},
            critique_meta: critique?._meta ?? {},
            overall_band:  critique?.overall_band ?? null,
            directives:    critique?.directives ?? [],
          },
          audit_source:         auditSourceForPage,
          notion_url:           notionUrlForPage,
          cowork_handoff_at:    handoffStartedAt,
          web_project_id:       projectId,
          sort_order:           nextSortOrder++,
          archived:             false,
          content_status:       'draft',
          seo_metadata:         seoMetadata,
          partner_gaps_flagged: partnerGapsFlagged,
        })
        .select('id')
        .single()
      if (insErr || !ins) return res.status(500).json({ error: `web_pages insert failed for ${slug}: ${insErr?.message}` })
      pageId = ins.id
    }

    // Clean slate web_sections for this page
    const { error: delErr } = await sb.from('web_sections')
      .delete()
      .eq('web_page_id', pageId)
    if (delErr) return res.status(500).json({ error: `web_sections delete failed for ${slug}: ${delErr.message}` })

    // Per-section processing
    const draftSections = Array.isArray(draft?.sections) ? draft.sections as CoworkDraftSection[] : []
    const outlineSections = Array.isArray(outline?.sections) ? outline.sections as Array<Record<string, any>> : []
    const critiqueSections = Array.isArray(critique?.sections) ? critique.sections as Array<Record<string, any>> : []

    const splitGroupIds = new Map<string, string>()
    const sectionRows: any[] = []
    const draftedAtoms  = new Set<string>()
    const draftedFacts  = new Set<string>()
    const draftedTopics = new Set<string>()
    let draftedDeferred = 0
    let perfectInThisPage = 0
    let partialInThisPage = 0
    let splitGroupsOnPage = 0

    for (let i = 0; i < draftSections.length; i++) {
      const ds = draftSections[i]
      const intentId = ds.section_intent_id ?? `s${i + 1}`
      const os = outlineSections.find(o => o.section_intent_id === intentId) ?? outlineSections[i] ?? null
      const cs = critiqueSections.find(c => c.section_intent_id === intentId) ?? critiqueSections[i] ?? null

      const templateKey = ds.template_key ?? os?.template_key
      // Normalize once per section. Reading ds.slot_values directly
      // would miss shapes #2 (field_values) and #3 (slots[]), bricking
      // any non-audit-branch project.
      const normalizedSlots = normalizeCoworkSlotValues(ds)

      if (!templateKey) {
        // Section has no template — flag and skip web_section creation
        // for this row (cowork emitted a malformed section).
        refusalEntries.push({
          ran_at: handoffStartedAt,
          page_slug: slug,
          section_intent_id: intentId,
          template_key: null,
          gaps: ['section_emitted_with_no_template_key'],
          root_cause_hypothesis: 'cowork audit SKILL emitted a section without template_key; tighten SKILL emission contract',
          preserved_content: normalizedSlots,
        })
        continue
      }
      const entry = templates[templateKey]
      if (!entry) {
        refusalEntries.push({
          ran_at: handoffStartedAt,
          page_slug: slug,
          section_intent_id: intentId,
          template_key: templateKey,
          gaps: [`template_key '${templateKey}' not in canonical manifest`],
          root_cause_hypothesis: 'cowork audit SKILL picked a template_key not in canonical-templates v2.0.0; SKILL prompt + manifest are out of sync',
          preserved_content: normalizedSlots,
        })
        continue
      }

      // Translator — schema-driven. Resolves the Brixies template via
      // the manifest's template_key → template_id mapping, then reads
      // that template's own cowork_alias_map for the binding contract.
      // Falls back to the legacy manifest-driven translator only when
      // the Brixies template can't be found in web_content_templates
      // (likely a stale manifest entry).
      const brixiesTpl = brixiesByTemplateId.get(entry.template_id)
      const bind = brixiesTpl
        ? composeFromCoworkAliasMap(normalizedSlots, brixiesTpl, templateKey, entry.required_slots ?? [])
        : composeFieldValuesForBrixies(normalizedSlots, entry)

      // SPLIT marker (audit-branch overflow)
      const splitFrom = (os?._meta?.split_from as string | undefined) ?? (ds._meta?.split_from as string | undefined) ?? null
      const splitPos  = (os?._meta?.split_position as number | undefined) ?? (ds._meta?.split_position as number | undefined) ?? null
      const notionPgId = (os?._meta?.notion_page_id as string | undefined) ?? (ds._meta?.notion_page_id as string | undefined) ?? null
      const notionUrl  = (os?._meta?.notion_url as string | undefined) ?? (ds._meta?.notion_url as string | undefined) ?? notionUrlForPage
      let splitGroupId: string | null = null
      if (splitFrom) {
        const key = `${notionPgId ?? slug}::${splitFrom}`
        if (!splitGroupIds.has(key)) {
          splitGroupIds.set(key, crypto.randomUUID())
          splitGroupsOnPage++
        }
        splitGroupId = splitGroupIds.get(key)!
      }

      // Provenance counts
      const atomIds = Array.isArray(ds.atoms_used) ? ds.atoms_used.filter(s => typeof s === 'string') : []
      const factIds = Array.isArray(ds.facts_used) ? ds.facts_used.filter(s => typeof s === 'string') : []
      const topicKs = Array.isArray(ds.crawl_topics_used) ? ds.crawl_topics_used.filter(s => typeof s === 'string') : []
      atomIds.forEach(id => draftedAtoms.add(id))
      factIds.forEach(id => draftedFacts.add(id))
      topicKs.forEach(k  => draftedTopics.add(k))
      const deferred = Array.isArray(ds.deferred_atoms) ? ds.deferred_atoms : Array.isArray(ds.deferred_items) ? ds.deferred_items : []
      draftedDeferred += deferred.length

      // Voice anchor
      const voiceAnchorIds: string[] = (() => {
        const va = os?.voice_anchor_atom_ids ?? os?.voice_anchor
        if (Array.isArray(va)) return va.filter(x => typeof x === 'string')
        if (typeof va === 'string') return [va]
        return []
      })()

      // v77 — audit-branch verbatim preservation passthrough.
      // The SKILL writes these on outline._meta (preferred) or
      // draft._meta (fallback) for each section. Both shapes are
      // open — defensive `?? null` keeps from-scratch sections
      // unaffected (they leave the new fields null).
      const oMeta = (os?._meta ?? {}) as Record<string, unknown>
      const dMeta = (ds._meta ?? {}) as Record<string, unknown>
      const pickStr = (key: string): string | null => {
        const v = oMeta[key] ?? dMeta[key]
        return typeof v === 'string' && v.length > 0 ? v : null
      }
      const pickArr = <T>(key: string): T[] | null => {
        const v = oMeta[key] ?? dMeta[key]
        return Array.isArray(v) ? (v as T[]) : null
      }

      const sectionMeta = {
        section_intent_id:      intentId,
        section_intent_text:    os?.section_job ?? '',
        voice_anchor_atom_ids:  voiceAnchorIds,
        intended_verbatim_band: os?.intended_verbatim_band ?? null,
        actual_verbatim_ratio:  typeof ds.actual_verbatim_ratio === 'number' ? ds.actual_verbatim_ratio : null,
        atom_ids_used:          atomIds,
        fact_ids_used:          factIds,
        crawl_topic_keys_used:  topicKs,
        deferred_items:         deferred,
        voice_notes:            ds.voice_notes ?? null,
        axes:                   cs?.axes ?? null,
        directives:             cs?.directives ?? [],
        notion_page_id:         notionPgId,
        notion_url:             notionUrl,
        split_from:             splitFrom,
        bind_quality:           bind.bind_quality,
        gaps:                   bind.gaps,
        manifest_version:       manifestVersion,
        // v77 — Notion audit-branch verbatim preservation
        source_block:           pickStr('source_block'),
        preservation:           (() => {
          const v = oMeta.preservation ?? dMeta.preservation
          return v === 'source-verbatim' ? 'source-verbatim' as const : null
        })(),
        image_direction:        pickStr('image_direction'),
        embed_directive:        pickStr('embed_directive'),
        dynamic_directive:      pickStr('dynamic_directive'),
        inline_annotations:     pickArr<{ note: string; near_slot?: string }>('inline_annotations') ?? [],
        button_annotations:     pickArr<string | null>('button_annotations') ?? [],
        // Content the translator couldn't bind to a real Brixies slot
        // (typically because cowork picked a template whose schema
        // has no group for the emitted shape — e.g. 6 card items
        // emitted against feature-section-6 which only has a buttons
        // group). Persisting here so the strategist can recover the
        // text without re-running the cowork pipeline.
        dropped_content:        bind.dropped_content ?? null,
      }

      sectionRows.push({
        web_page_id:         pageId,
        content_template_id: entry.template_id,
        field_values:        bind.field_values,
        // cowork_slot_values is the BIT-FOR-BIT durable record + the
        // input the variant-swap engine reads. Use the normalized dict
        // so a future re-bind doesn't have to re-detect the shape.
        cowork_slot_values:  normalizedSlots,
        source_field_values: normalizedSlots,
        cowork_section_meta: sectionMeta,
        sort_order:          i,
        content_status:      'draft',
        notes:               (ds.voice_notes ?? null) as string | null,
        split_group_id:      splitGroupId,
        split_position:      splitPos,
      })

      if (bind.bind_quality === 'perfect') perfectInThisPage++
      else                                  partialInThisPage++

      // Roll up gap kinds for telemetry + write refusal entries for partial.
      if (bind.bind_quality === 'partial') {
        for (const g of bind.gaps) {
          audit.gaps_by_kind[g.kind] = (audit.gaps_by_kind[g.kind] ?? 0) + 1
        }
        refusalEntries.push({
          ran_at:                 handoffStartedAt,
          page_slug:              slug,
          section_intent_id:      intentId,
          template_key:           templateKey,
          template_id:            entry.template_id,
          gaps:                   bind.gaps,
          root_cause_hypothesis:  inferRootCause(bind.gaps, entry),
          preserved_content:      normalizedSlots,
        })
      }
    }

    if (sectionRows.length > 0) {
      const { error: insSecErr } = await sb.from('web_sections').insert(sectionRows)
      if (insSecErr) return res.status(500).json({ error: `web_sections insert failed for ${slug}: ${insSecErr.message}` })
    }

    audit.total_atoms_preserved  += draftedAtoms.size
    audit.total_facts_preserved  += draftedFacts.size
    audit.total_topics_preserved += draftedTopics.size
    audit.total_deferred         += draftedDeferred
    audit.total_sections         += sectionRows.length
    audit.perfect_sections       += perfectInThisPage
    audit.partial_sections       += partialInThisPage

    audit.pages[slug] = {
      page_id:                pageId,
      sections_in_draft:      draftSections.length,
      sections_written:       sectionRows.length,
      perfect_sections:       perfectInThisPage,
      partial_sections:       partialInThisPage,
      atoms_preserved:        draftedAtoms.size,
      facts_preserved:        draftedFacts.size,
      crawl_topics_preserved: draftedTopics.size,
      deferred_total:         draftedDeferred,
      split_groups:           splitGroupsOnPage,
      audit_source:           auditSourceForPage,
      overall_band:           critique?.overall_band ?? null,
    }
  }

  audit.perfect_rate = audit.total_sections > 0
    ? Math.round((audit.perfect_sections / audit.total_sections) * 10000) / 10000
    : 0

  // v77 — project-wide global_footer write (audit branch).
  // The SKILL parses the Notion Type=Footer row (or the Homepage's
  // ## GLOBAL FOOTER block) into roadmap_state.global_footer; this
  // is its one-time-per-project promotion onto strategy_web_projects.
  // Skipped when no footer was extracted (from-scratch projects).
  if (globalFooter && typeof globalFooter === 'object') {
    const { error: footerErr } = await sb.from('strategy_web_projects')
      .update({ global_footer: globalFooter })
      .eq('id', projectId)
    if (footerErr) {
      // Non-fatal: log into telemetry but don't block the handoff;
      // sections + pages already landed.
      (audit as Record<string, unknown>).global_footer_write_error = footerErr.message
    } else {
      (audit as Record<string, unknown>).global_footer_written = true
    }
  }

  // ≥0.90 = success. <0.90 = Claude Code work needed.
  if (audit.total_sections > 0 && audit.perfect_rate < 0.9) {
    audit.claude_code_signal = {
      needs_work: true,
      reason: `perfect_rate=${audit.perfect_rate} below 0.90 target. Inspect handoff_refusal_log + .claude/handoff-refusals.md for root causes.`,
    }
  }

  // Persist telemetry + append refusal entries
  try {
    await setRoadmapStateAtomic(sb, projectId, ['cowork_handoff_audit'], audit)
  } catch (e) {
    // Non-fatal: writes already landed.
  }

  if (refusalEntries.length > 0) {
    // Append to handoff_refusal_log, but CAP the total at 500 entries
    // so the jsonb column doesn't grow unbounded across many handoff
    // re-runs. Older entries get dropped (FIFO) — Claude Code only
    // needs recent ones to spot patterns. Read-modify-write keeps
    // the cap enforcement in one place.
    const REFUSAL_LOG_CAP = 500
    const { data: cur } = await sb.from('strategy_web_projects')
      .select('handoff_refusal_log')
      .eq('id', projectId)
      .maybeSingle()
    const existing = ((cur as any)?.handoff_refusal_log ?? []) as unknown[]
    const merged = [...existing, ...refusalEntries]
    const trimmed = merged.length > REFUSAL_LOG_CAP
      ? merged.slice(merged.length - REFUSAL_LOG_CAP)
      : merged
    await sb.from('strategy_web_projects')
      .update({ handoff_refusal_log: trimmed })
      .eq('id', projectId)
  }

  return res.status(200).json({
    ok:        true,
    project_id: projectId,
    pages:     Object.keys(audit.pages).length,
    audit,
  })
}

// ── Root-cause heuristic ──────────────────────────────────────────

function inferRootCause(
  gaps: BindResult['gaps'],
  entry: ManifestEntry,
): string {
  if (gaps.some(g => g.kind === 'required_slot_missing')) {
    return `Template '${entry.template_id}' (${entry.uniform_to_brixies ? 'verified=' + entry.verified : ''}) requires slots cowork didn't fill. Likely cowork SKILL emission gap — tighten the prompt to always emit those slots OR pick a template with looser requirements.`
  }
  if (gaps.some(g => g.kind === 'uniform_slot_not_supported_by_template')) {
    return `Template '${entry.template_id}' lacks slots for content cowork emitted. Audit SKILL picked the wrong template family for this section; constrain SKILL picks to templates whose uniform_to_brixies covers all the section's emitted slots.`
  }
  if (gaps.some(g => g.kind === 'button_missing_url' || g.kind === 'button_missing_label')) {
    return 'Cowork emitted button with missing label or url (often a [NEEDS INPUT] placeholder). Tighten SKILL: require both subfields on every button.'
  }
  if (gaps.some(g => g.kind === 'items_folded_into_body')) {
    return `Cowork emitted cards but the manifest routed this section to a template with no items group. Items were folded into the body as a fallback (no content lost). For best fidelity, change the manifest to pick a cards-bearing template for the SKILL archetype that produced this section.`
  }
  return 'See gaps[] for detail. Investigate per-template binding logic.'
}

// ── Helpers ───────────────────────────────────────────────────────

function humanizeSlug(slug: string): string {
  if (slug === '/' || slug === 'home' || slug === '') return 'Home'
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
