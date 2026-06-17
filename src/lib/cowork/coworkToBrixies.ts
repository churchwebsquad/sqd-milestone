/**
 * composeFieldValuesForBrixies — load-bearing translator for the
 * Cowork→Pages handoff. Lives here so the handoff endpoint AND the
 * dry-run regression script share one source of truth.
 *
 * Input: cowork-emitted uniform `slot_values` + a manifest entry per
 * `cowork-skills/canonical-templates.json`.
 *
 * Output: { field_values (Brixies-shaped), bind_quality, gaps[] }.
 *
 * Contract:
 *   - Cowork emits a CLOSED set of top-level slots:
 *       primary_heading, tagline, body, accent_body, items, buttons.
 *   - Items use `{item_heading, item_body, item_meta,
 *                 item_cta_label, item_cta_url}` (v2 schema — added
 *     per-item CTA fields to stop dropping cards-grid CTAs).
 *   - Buttons use `{label, url, kind?: 'primary'|'secondary'}`.
 *   - VERBATIM PRESERVATION: any value containing `[NEEDS INPUT: ...]`
 *     is passed through unchanged. Never substitute starter language.
 *     Button urls that are `[NEEDS INPUT: ...]` are blanked at bind
 *     time so the rendered href doesn't become a literal-text link.
 *   - Translator NEVER throws. Partial bindings return with a
 *     populated gaps[]; the caller decides bind_quality.
 */

export interface ManifestEntry {
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
      field?:    string
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

export interface BindResult {
  field_values: Record<string, unknown>
  bind_quality: 'perfect' | 'partial'
  gaps:         Array<{ kind: string; severity: 'info' | 'warning' | 'blocker'; detail: string; slot?: string }>
}

/** Wrap plain text in <p>...</p> if not already HTML. Renderer
 *  expects HTML strings for richtext slots. */
export function ensureHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(trimmed)) {
    return trimmed
  }
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

export function isHtmlAlready(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^<(p|ul|ol|li|h\d|div|blockquote|figure|table|section|article)[\s>]/i.test(value.trim())
}

/** True if a string is a strategist gap marker that must never be
 *  treated as final content. Recognized shapes (matching the audit
 *  SKILL's verbatim-preservation rule):
 *    - `[NEEDS INPUT: ...]`                — explicit placeholder
 *    - `\[NEEDS INPUT: ...\]`              — escaped-bracket variant
 *    - `*pending: ...*` / `*Pending Partner Input: ...*`
 *                                          — italicized strategist note
 *    - `*photo: [NEEDS INPUT: ...]*`       — per-item asset marker
 *    - `*image: [NEEDS INPUT: ...]*`       — same, image variant
 *    - `*Embed (video): [NEEDS INPUT…]*`   — video primary URL placeholder
 *    - `*Fallback: [NEEDS INPUT…]*`        — video fallback placeholder
 *    - `*Status: pending_partner_input*`   — per-item machine status tag
 *
 *  NOTE: `[NEEDS INPUT — suggested: "..."]` is INTENTIONALLY NOT a
 *  blocker — that variant carries a working value the strategist
 *  has supplied. extractSuggestedValue() pulls the value out before
 *  reaching this check. See its docs.
 *
 *  Visible-text slots keep these verbatim so the strategist sees the
 *  gap; URL slots return empty (sanitizeUrl) so the rendered href
 *  doesn't become a broken literal-text link. */
export function isNeedsInput(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const s = value.trim()
  return (
    /^\\?\[NEEDS INPUT\b/i.test(s) ||
    /^\*pending(?:\s+partner\s+input)?\s*:/i.test(s) ||
    /^\*(?:photo|image|embed[^*]*|fallback)\s*:/i.test(s) ||
    /^\*status\s*:\s*pending_partner_input/i.test(s)
  )
}

/** If a string is the suggested-value variant
 *  `[NEEDS INPUT — suggested: "..."]`, return the suggested text
 *  (without quotes/brackets). Otherwise return the original string.
 *
 *  This variant is used for metadata fields and other slots where
 *  the strategist HAS supplied a working value and is just asking
 *  the partner to confirm or override. Shipping the suggested text
 *  as the live draft (instead of treating it as a blocker) means
 *  the partner sees a complete page, and the audit logs it as a
 *  `pending_approval` rather than `pending_input`.
 *
 *  Examples that extract:
 *    [NEEDS INPUT — suggested: "Justice & Local Partners | Arvada Vineyard"]
 *      → "Justice & Local Partners | Arvada Vineyard"
 *    \[NEEDS INPUT — suggested: "..."\]
 *      → same after unescaping
 *
 *  Examples that DON'T extract (return original):
 *    [NEEDS INPUT: maps link]               // no suggested value
 *    [NEEDS INPUT: Ben Folman to confirm]   // no suggested value
 *    *pending: confirm email*               // different marker shape
 */
export function extractSuggestedValue(value: unknown): { text: string; wasSuggested: boolean } {
  if (typeof value !== 'string') return { text: '', wasSuggested: false }
  // Match either '[NEEDS INPUT — suggested: "..."]' or '\[NEEDS INPUT … suggested: "…"\]'
  // The dash is U+2014 (em dash) — some sources use a plain hyphen or en dash too.
  const m = value.match(/\\?\[NEEDS INPUT\s*[—–\-]\s*suggested\s*:\s*"([^"]+)"\s*\\?\]/i)
  if (m) return { text: m[1], wasSuggested: true }
  return { text: value, wasSuggested: false }
}

/** Sanitize a URL field: blank out `[NEEDS INPUT: ...]` so it doesn't
 *  become a broken href. Pass through real URLs verbatim. */
export function sanitizeUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (isNeedsInput(value)) return ''
  return value
}

export function composeFieldValuesForBrixies(
  slotValues: Record<string, unknown>,
  entry: ManifestEntry,
): BindResult {
  const fv: Record<string, unknown> = {}
  const gaps: BindResult['gaps'] = []
  const map = entry.uniform_to_brixies
  const richtextKeys = new Set(entry.richtext_keys ?? [])

  // ── Scalars ────────────────────────────────────────────────────
  for (const uniformKey of ['tagline', 'primary_heading', 'body', 'accent_body'] as const) {
    const brixiesKey = map[uniformKey]
    const coworkValue = slotValues[uniformKey]
    const hasCowork = coworkValue != null && coworkValue !== ''

    if (brixiesKey == null) {
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

    // `[NEEDS INPUT — suggested: "..."]` ships the suggested text
    // and logs a pending_approval gap (info severity) so the
    // strategist sees what's pending without the page rendering
    // a literal-bracket placeholder. Other NEEDS INPUT shapes
    // pass through verbatim (blockers).
    let resolved: unknown = coworkValue
    const { text: extracted, wasSuggested } = extractSuggestedValue(coworkValue)
    if (wasSuggested) {
      resolved = extracted
      gaps.push({
        kind: 'pending_partner_approval',
        severity: 'info',
        detail: `slot '${uniformKey}' shipped a strategist-suggested value awaiting partner approval: "${extracted.slice(0, 80)}${extracted.length > 80 ? '…' : ''}"`,
        slot: uniformKey,
      })
    }

    if (richtextKeys.has(brixiesKey)) {
      fv[brixiesKey] = isHtmlAlready(resolved) ? resolved : ensureHtml(resolved)
    } else {
      fv[brixiesKey] = String(resolved)
    }
  }

  // ── Buttons ────────────────────────────────────────────────────
  if (Array.isArray(slotValues.buttons) && slotValues.buttons.length > 0) {
    const coworkButtons = slotValues.buttons as Array<Record<string, unknown>>
    // cta_callout (cta-section-52) has a SINGLE cta slot — secondary
    // buttons get dropped (strategist sees them in the Rich Companion
    // + can swap to cta_simple which has a 2-button group). Surface
    // the loss as a warning so it shows up in the audit panel.
    if (entry.template_id === 'cta-section-52' && coworkButtons.length > 1) {
      gaps.push({
        kind: 'secondary_button_unfilled_by_template',
        severity: 'warning',
        detail: `template 'cta-section-52' has 1 cta slot but cowork emitted ${coworkButtons.length} buttons. Primary renders; secondary preserved in cowork_slot_values + visible in the Rich Companion. Swap to 'cta_simple' to render both.`,
        slot: 'buttons',
      })
    }
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
      fv[field] = coworkButtons.map(b => {
        const label =
          typeof b.label === 'string' ? b.label :
          typeof b.text === 'string' ? b.text :
          typeof b.contact === 'string' ? b.contact :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).label === 'string'
            ? (b.contact as any).label : '')
        const rawUrl =
          typeof b.url === 'string' ? b.url :
          typeof b.href === 'string' ? b.href :
          (b.contact && typeof b.contact === 'object' && typeof (b.contact as any).url === 'string'
            ? (b.contact as any).url : '')
        // [NEEDS INPUT: …] in a url slot → blank href (visible label
        // stays verbatim so the strategist sees the unresolved item).
        const url = sanitizeUrl(rawUrl)
        if (rawUrl && isNeedsInput(rawUrl)) {
          gaps.push({
            kind:     'needs_input_url_blanked',
            severity: 'info',
            detail:   `button '${label}' has placeholder url ${rawUrl}; rendered as no-href`,
            slot:     'buttons',
          })
        }
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
          const inner: Record<string, unknown> = {}
          inner[subL] = label
          if (subU) inner[subU] = url
          return { contact: inner }
        }
        const row: Record<string, unknown> = {}
        row[subL] = label
        if (subU) row[subU] = url
        return row
      })
    }
  }

  // ── Items ──────────────────────────────────────────────────────
  if (Array.isArray(slotValues.items) && slotValues.items.length > 0) {
    const coworkItems = slotValues.items as Array<Record<string, unknown>>
    if (map.items == null) {
      gaps.push({
        kind: 'uniform_slot_not_supported_by_template',
        severity: 'warning',
        detail: `cowork emitted ${coworkItems.length} item(s) but template '${entry.template_id}' has no items slot`,
        slot: 'items',
      })
    } else {
      const { field: singleField, subfields, split } = map.items
      const subH = subfields.item_heading
      const subB = subfields.item_body
      const subM = subfields.item_meta

      const composeItem = (it: Record<string, unknown>): Record<string, unknown> => {
        const row: Record<string, unknown> = {}
        if (subH != null) {
          const v = it.item_heading ?? it.heading ?? it.title ?? ''
          row[subH] = String(v)
        }
        if (subB != null) {
          const v = it.item_body ?? it.body ?? it.description ?? ''
          row[subB] = richtextKeys.has(subB)
            ? (isHtmlAlready(v) ? v : ensureHtml(v))
            : String(v)
        }
        if (subM != null) {
          const v = it.item_meta ?? it.meta ?? ''
          row[subM] = String(v)
        }
        return row
      }

      if (split) {
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

      const itemsSpec = entry.cowork_writable_slots?.items
      const maxItems = itemsSpec?.max_items
      if (typeof maxItems === 'number' && coworkItems.length > maxItems) {
        gaps.push({
          kind: 'items_overflow',
          severity: 'warning',
          detail: `${coworkItems.length} items emitted; template '${entry.template_id}' caps at ${maxItems}`,
          slot: 'items',
        })
      }
    }
  }

  // ── Required-slot final sweep ───────────────────────────────────
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

  // ── Template-specific render-shape overrides ──────────────────
  //
  // The default mapping above writes Brixies field keys from the
  // manifest's uniform_to_brixies. That gets most templates right,
  // but six of them have nested or quirky layer structures the
  // simple mapping can't express. These overrides were each
  // verified by running the production renderer (jsdom) against
  // synthetic markers — see scripts/find-shape.ts. Don't change
  // these without re-running scripts/check-real-render.ts.
  const fv2 = applyTemplateOverrides(entry.template_id, fv, slotValues)

  const bind_quality: 'perfect' | 'partial' = gaps.length === 0 ? 'perfect' : 'partial'

  return { field_values: fv2, bind_quality, gaps }
}

function applyTemplateOverrides(
  templateId:  string,
  fv:          Record<string, unknown>,
  cowork:      Record<string, unknown>,
): Record<string, unknown> {
  const items = Array.isArray(cowork.items) ? cowork.items as Array<Record<string, unknown>> : []
  const buttons = Array.isArray(cowork.buttons) ? cowork.buttons as Array<Record<string, unknown>> : []
  const body = typeof cowork.body === 'string' ? cowork.body : ''
  const out = { ...fv }

  switch (templateId) {
    case 'content-section-16': {
      // content_image_text_b — schema simplified per user direction:
      // description_items removed; description slot is the only body
      // surface. To avoid losing items[] content when the audit picked
      // this template for a section that HAS items, concat the items
      // into the description as flowed HTML. Strategist can swap to a
      // cards-grid template later if they want item structure back.
      delete out.description_items
      if (items.length > 0) {
        const itemsHtml = items.map(it => {
          const hdr  = it.item_heading ?? ''
          const bdy  = it.item_body ?? ''
          if (hdr && bdy) return `<p><strong>${escapeHtml(String(hdr))}</strong> — ${String(bdy).replace(/^<p>|<\/p>$/g, '')}</p>`
          if (hdr)        return `<p><strong>${escapeHtml(String(hdr))}</strong></p>`
          if (bdy)        return ensureHtml(String(bdy))
          return ''
        }).filter(Boolean).join('\n')
        const existing = typeof out.description === 'string' ? out.description : ensureHtml(body)
        out.description = (existing && existing.trim()) ? `${existing}\n${itemsHtml}` : itemsHtml
      }
      return out
    }

    case 'content-section-89': {
      // content_featured_a — column_list each entry has a nested
      // `card` group; cards carry {heading_card, description_card}.
      out.column_list = items.map(it => ({
        card: [{
          heading_card:     String(it.item_heading ?? ''),
          description_card: ensureHtml(String(it.item_body ?? '')),
        }],
      }))
      return out
    }

    case 'team-section-14': {
      // feature_team — row_grid wrapper holds a single card_team
      // group; cards carry {team_name, team_position, team_description}.
      out.row_grid = [{
        card_team: items.map(it => ({
          team_name:        String(it.item_heading ?? ''),
          team_position:    String(it.item_meta ?? ''),
          team_description: ensureHtml(String(it.item_body ?? '')),
        })),
      }]
      return out
    }

    case 'feature-section-103': {
      // feature_unique — row_list per item; each row has heading +
      // nested item_list → card → {heading_card, list_item[].description,
      // button_card (cta)}. Per-card CTAs land in button_card when
      // cowork captured item_cta_label/url.
      out.row_list = items.map(it => {
        const card: Record<string, unknown> = {
          heading_card: String(it.item_heading ?? ''),
          list_item:   [{ description: ensureHtml(String(it.item_body ?? '')) }],
        }
        const ctaLabel = typeof it.item_cta_label === 'string' ? it.item_cta_label : ''
        const ctaUrl   = sanitizeUrl(it.item_cta_url)
        if (ctaLabel) card.button_card = { label: ctaLabel, url: ctaUrl }
        return {
          heading:   String(it.item_heading ?? ''),
          item_list: [{ card: [card] }],
        }
      })
      return out
    }

    case 'feature-section-66': {
      // feature_tabbed — each tab has heading+description+buttons,
      // PLUS a separate top-level `tab_button` group whose own
      // `heading` slot drives the tab-switcher chip label. Per user
      // direction: auto-derive tab_button.heading from tab.heading
      // so the strategist doesn't have to type each label twice.
      // Strategist override remains possible if they fill tab_button
      // manually — only apply when tab_button is empty or missing.
      const tabs = Array.isArray(out.tab) ? out.tab as Array<Record<string, unknown>> : []
      const existingButtons = Array.isArray(out.tab_button) ? out.tab_button as Array<Record<string, unknown>> : []
      if (tabs.length > 0 && existingButtons.length === 0) {
        out.tab_button = tabs.map(t => ({ heading: String(t.heading ?? '') }))
      }
      return out
    }

    case 'feature-section-2': {
      // Primary cards-grid template (per user direction). Uses palette
      // card-193 — the safest variant because it has heading + body +
      // CTA + image per card. The palette card's source HTML carries
      // BOTH an outer (heading/description) layer AND a nested `card`
      // group with heading_card/description_card/buttons/image_card.
      // Mapping:
      //   cowork item.item_heading        → outer heading + heading_card
      //   cowork item.item_body           → outer description + description_card
      //   cowork item.item_cta_label/url  → card.buttons[0].contact_card
      // image_card stays designer-bound (cowork never writes images).
      //
      // Force the palette pick to card-193 via the
      // {__palette_template_id, items} wrapper expandPaletteGroup
      // recognizes — this overrides whatever default
      // referenced_template_id the schema declared.
      const cardItems = items.map(it => {
        const ctaLabel = typeof it.item_cta_label === 'string' ? it.item_cta_label : ''
        const ctaUrl   = sanitizeUrl(it.item_cta_url)
        const cardInner: Record<string, unknown> = {
          heading_card:     String(it.item_heading ?? ''),
          description_card: ensureHtml(String(it.item_body ?? '')),
        }
        if (ctaLabel) {
          cardInner.buttons = [{ contact_card: ctaLabel, url: ctaUrl }]
        }
        return {
          // Outer card slots (rendered above the inner card content)
          heading:     String(it.item_heading ?? ''),
          description: ensureHtml(String(it.item_body ?? '')),
          // Inner card group — one inner card per outer card (single_instance_hint)
          card:        [cardInner],
        }
      })
      out.card = { __palette_template_id: 'card-193', items: cardItems }
      return out
    }

    case 'content-section-96': {
      // counter_contain[]{counter[].description, counter_description}
      out.counter_contain = items.map(it => ({
        counter:             [{ description: String(it.item_heading ?? '') }],
        counter_description: ensureHtml(String(it.item_body ?? '')),
      }))
      return out
    }

    case 'cta-section-52': {
      // cta_callout — buttons is a SINGLE cta slot (kind:slot
      // type:cta), not an array. `image` is a designer-only group.
      //
      // When cowork emits 2+ buttons (primary + secondary), pick the
      // PRIMARY (kind:'primary' if marked, else buttons[0]) for the
      // single cta slot. The secondary is preserved bit-for-bit in
      // cowork_slot_values and visible in the Rich Companion;
      // strategist can swap to cta_simple (2-button slot) via the
      // variant picker. The audit SKILL should prefer cta_simple for
      // 2-button sections — see SKILL.md template-hint table.
      if (buttons.length > 0) {
        const primary = buttons.find(b => b.kind === 'primary') ?? buttons[0]
        const label = typeof primary.label === 'string' ? primary.label : ''
        const url   = typeof primary.url   === 'string' ? primary.url   : ''
        out.buttons = { label, url }
      } else {
        delete out.buttons
      }
      delete out.image
      return out
    }

    case 'faq-section-10': {
      // accordion_faq — the renderer's heuristic collapses each
      // accordion side to a single leaf node, breaking item
      // binding. Until the renderer learns to handle Frame
      // wrappers with literal-lorem data-layer names, we collapse
      // items into a flowed description so the content stays
      // visible. Strategist can hand-polish layout via the Rich
      // Companion's variant picker.
      if (items.length > 0) {
        const concat = items
          .map(it => `<p><strong>${escapeHtml(String(it.item_heading ?? ''))}</strong> — ${escapeHtml(String(it.item_body ?? ''))}</p>`)
          .join('\n')
        out.description = concat
      }
      delete out.accordion_left
      delete out.accordion_right
      return out
    }

    default:
      return out
  }
}
