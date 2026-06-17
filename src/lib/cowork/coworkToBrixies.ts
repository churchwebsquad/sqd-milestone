/**
 * composeFieldValuesForBrixies — load-bearing translator for the
 * Cowork→Pages handoff. Lives here so the handoff endpoint AND the
 * dry-run regression script share one source of truth.
 *
 * Input: cowork-emitted uniform `slot_values` + a v2.0.0 manifest
 * entry per `cowork-skills/canonical-templates.json`.
 *
 * Output: { field_values (Brixies-shaped), bind_quality, gaps[] }.
 *
 * Contract:
 *   - Cowork emits a CLOSED set of 5 top-level slots:
 *       primary_heading, tagline, body, items, buttons.
 *     `accent_body` is never emitted by cowork audit — templates that
 *     need it stay with the Brixies designer placeholder.
 *   - Items use `{item_heading, item_body, item_meta}` closed subkeys.
 *   - Buttons use `{label, url}` closed subkeys.
 *   - Translator NEVER throws. Partial bindings return with a
 *     populated gaps[]; the caller decides the bind_quality verdict.
 *   - field_values shape matches the renderer contract verbatim per
 *     the verified Phase 0 working examples. No guesswork.
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

  const bind_quality: 'perfect' | 'partial' = gaps.length === 0 ? 'perfect' : 'partial'

  return { field_values: fv, bind_quality, gaps }
}
