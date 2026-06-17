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
 *    - `[NEEDS INPUT: ...]`           — explicit placeholder
 *    - `\[NEEDS INPUT: ...\]`         — escaped-bracket variant
 *    - `*pending: ...*`               — italicized strategist note
 *    - `*photo: [NEEDS INPUT: ...]*`  — per-item asset marker
 *    - `*image: [NEEDS INPUT: ...]*`  — same, image variant
 *
 *  Visible-text slots keep these verbatim so the strategist sees the
 *  gap; URL slots return empty (sanitizeUrl) so the rendered href
 *  doesn't become a broken literal-text link. */
export function isNeedsInput(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const s = value.trim()
  return (
    /^\\?\[NEEDS INPUT\b/i.test(s) ||
    /^\*pending\s*:/i.test(s) ||
    /^\*(?:photo|image)\s*:\s*\\?\[NEEDS INPUT\b/i.test(s)
  )
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
      // content_image_text_b — `description` slot is shadowed by
      // `description_items` (same layer_name "Description"); the
      // group wins. Move body INTO description_items[0].text, and
      // each items[i].item_body into description_items[i+1].text.
      delete out.description
      const di: Array<Record<string, unknown>> = []
      if (body) di.push({ text: ensureHtml(body) })
      for (const it of items) {
        const ibBody = it.item_body ?? it.body ?? ''
        const hdr    = it.item_heading ?? it.heading ?? ''
        // If both heading and body present, concat (description_items
        // is a single-slot list, no separate heading subfield).
        const combined = hdr ? `<p><strong>${escapeHtml(String(hdr))}</strong></p>${ensureHtml(String(ibBody))}` : ensureHtml(String(ibBody))
        di.push({ text: combined })
      }
      out.description_items = di
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
      if (buttons.length > 0) {
        const b = buttons[0]
        const label = typeof b.label === 'string' ? b.label : ''
        const url   = typeof b.url   === 'string' ? b.url   : ''
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
