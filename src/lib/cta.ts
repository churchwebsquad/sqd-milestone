/**
 * CTA value normalization + classification.
 *
 * CTAs were historically stored as `{ label, url }` (or even a bare
 * string for text+button hybrid slots). Phase A adds `kind` + optional
 * `target` so the editor can render the right input + the dev handoff
 * inventory can validate routes.
 *
 * `normalizeCtaValue` accepts any of the legacy shapes and returns
 * the canonical CtaValue. Every reader in the app should funnel
 * through this so the rest of the code can pretend the shape was
 * always `CtaValue`.
 *
 * `inferCtaKind` heuristically classifies a URL string when the
 * stored shape didn't carry a kind. Conservative — anything ambiguous
 * gets the safest classification, which is `external_url`.
 */

import type { CtaKind, CtaValue, WebSlotDef } from '../types/database'

/** A slot is "button-shaped" — meaning its value is a CtaValue and
 *  the section panel renders it through ButtonInput — when any of
 *  three rules match. Centralized here so the Dev Handoff inventory,
 *  the slot editor, and any future walker apply the same definition.
 *
 *  Rules (mirror SlotEditor's isButtonShaped):
 *    1. type === 'cta'                                  (canonical)
 *    2. type === 'text' && scope === 'button'           (text-button hybrid)
 *    3. type === 'text' && label/key contains "button"  (heuristic) */
export function isButtonShapedSlot(slot: WebSlotDef): boolean {
  if (slot.type === 'cta') return true
  if (slot.type === 'text' && slot.scope === 'button') return true
  if (slot.type === 'text') {
    const k = (slot.label ?? slot.key).toLowerCase()
    if (k.includes('button') || k.includes('cta')) return true
  }
  return false
}

export function inferCtaKind(url: string): CtaKind {
  const v = url.trim()
  if (!v) return 'internal_route'                              // empty defaults sensibly
  // Snippet token — resolved at render time from the project's
  // snippet map. Detect anywhere in the string so partial tokens like
  // "{{base_url}}/page" still classify as snippet.
  if (/\{\{\s*[\w.]+\s*\}\}/.test(v))         return 'snippet'
  if (v.startsWith('mailto:'))               return 'mailto'
  if (v.startsWith('tel:'))                  return 'tel'
  if (v.startsWith('#'))                     return 'anchor'
  if (/^https?:\/\//i.test(v)) {
    // Try to narrow external_url into a more specific kind so the
    // dev-handoff inventory / formation plan gets the right ACF
    // field type without re-classifying.
    const lower = v.toLowerCase()
    if (/(youtube\.com|youtu\.be|vimeo\.com)/.test(lower))   return 'video_link'
    const fileExt = lower.match(/\.([a-z0-9]{2,5})(\?|#|$)/)?.[1]
    if (fileExt && /^(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|mp4|mov|csv)$/.test(fileExt)) return 'file_download'
    if (/\/(apply|application|form|register|signup|sign-up|join|interest|onboard)/.test(lower)) return 'application_form'
    return 'external_url'
  }
  if (v.startsWith('/')) {
    // Internal apply/signup paths classify as application_form too —
    // matches strategist intent "this button starts a signup flow"
    // regardless of whether the form lives on-site or off-site.
    if (/^\/(apply|application|form|register|signup|sign-up|join|interest|onboard)/i.test(v)) return 'application_form'
    return 'internal_route'
  }
  // Bare strings like "visit" or "about-us" — most likely intended as
  // internal but not necessarily prefixed. Treat as internal so the
  // page-slug validator in Dev Handoff flags them if they don't match.
  return 'internal_route'
}

/** Default `target` for a kind. External + mailto + tel + the new
 *  off-site kinds (file/video/form) naturally open in a new tab;
 *  internal routes + anchors stay in-page. Snippets default to a new
 *  tab because the most common church snippets (give_url, directions_url,
 *  livestream_url) point off-site. */
export function defaultTargetFor(kind: CtaKind): '_self' | '_blank' {
  switch (kind) {
    case 'external_url':
    case 'mailto':
    case 'tel':
    case 'snippet':
    case 'file_download':
    case 'video_link':
    case 'application_form':
      return '_blank'
    default:
      return '_self'
  }
}

/** Coerce any legacy shape into a canonical CtaValue. Safe to call
 *  on undefined / null / strings / partial objects. */
export function normalizeCtaValue(raw: unknown): CtaValue {
  if (raw == null) {
    return { label: '', url: '', kind: 'internal_route' }
  }
  if (typeof raw === 'string') {
    return { label: raw, url: '', kind: 'internal_route' }
  }
  if (typeof raw === 'object') {
    const o = raw as { label?: unknown; url?: unknown; kind?: unknown; target?: unknown }
    const label = typeof o.label === 'string' ? o.label : ''
    const url   = typeof o.url   === 'string' ? o.url   : ''
    const kind: CtaKind = isCtaKind(o.kind) ? o.kind : inferCtaKind(url)
    const target = o.target === '_blank' || o.target === '_self'
      ? o.target
      : undefined
    return { label, url, kind, target }
  }
  return { label: '', url: '', kind: 'internal_route' }
}

/** Type guard so we trust caller-stamped kinds and only infer when the
 *  stored value is missing or garbage. */
function isCtaKind(v: unknown): v is CtaKind {
  return v === 'internal_route' || v === 'external_url' ||
         v === 'anchor' || v === 'mailto' || v === 'tel' ||
         v === 'snippet' || v === 'file_download' ||
         v === 'video_link' || v === 'application_form'
}

/** Human-readable label for the kind picker + the handoff inventory.
 *  Listed in the order strategists most commonly need them — internal
 *  page is the default for most clicks, then the off-site categories
 *  grouped together, then the niche options. */
export const CTA_KIND_LABELS: Record<CtaKind, string> = {
  internal_route:   'Internal page',
  external_url:     'External page',
  file_download:    'File download (PDF, doc, etc.)',
  video_link:       'Video link (YouTube / Vimeo)',
  application_form: 'Application or signup form',
  anchor:           'Anchor on this page',
  mailto:           'Email link',
  tel:              'Phone link',
  snippet:          'Site snippet',
}

/** Validate a CTA's URL against the set of internal page slugs known
 *  to this project. Returns `null` when valid (or N/A — non-internal
 *  kinds), or an error string describing what's wrong. */
export function validateCta(
  cta: CtaValue,
  knownSlugs: ReadonlySet<string>,
): string | null {
  const url = cta.url.trim()
  switch (cta.kind) {
    case 'internal_route': {
      if (!url) return 'No URL set.'
      // Strip leading slash + hash/query for slug match.
      const slug = url.replace(/^\/+/, '').split(/[?#]/)[0]
      if (!knownSlugs.has(slug)) return `No page on this site matches "/${slug}".`
      return null
    }
    case 'external_url': {
      if (!url) return 'No URL set.'
      if (!/^https?:\/\//i.test(url)) return 'External URLs must start with https:// (or http://).'
      try { new URL(url) } catch { return 'URL is malformed.' }
      return null
    }
    case 'anchor': {
      if (!url) return 'No anchor set.'
      if (!url.startsWith('#')) return 'Anchors should start with #.'
      return null
    }
    case 'mailto': {
      if (!url) return 'No email set.'
      if (!url.startsWith('mailto:')) return 'Email links should start with mailto:.'
      return null
    }
    case 'tel': {
      if (!url) return 'No phone set.'
      if (!url.startsWith('tel:')) return 'Phone links should start with tel:.'
      return null
    }
    case 'snippet': {
      if (!url) return 'No snippet set.'
      if (!/\{\{\s*[\w.]+\s*\}\}/.test(url)) return 'Snippet links should contain {{token}}.'
      return null
    }
    case 'file_download': {
      if (!url) return 'No file URL set.'
      // Accept any http(s) URL — uploaded WP media URLs vary in
      // extension. Soft warning if no recognizable file extension.
      if (!/^https?:\/\//i.test(url)) return 'File URLs must start with https:// (or http://).'
      return null
    }
    case 'video_link': {
      if (!url) return 'No video URL set.'
      if (!/^https?:\/\//i.test(url)) return 'Video URLs must start with https://.'
      return null
    }
    case 'application_form': {
      if (!url) return 'No form URL set.'
      // Both external (Formstack/etc.) and internal (/apply) paths
      // are valid — match either an http(s) URL or a leading slash.
      if (!/^(https?:\/\/|\/)/i.test(url)) return 'Form URLs should be https:// or start with /.'
      return null
    }
  }
}
