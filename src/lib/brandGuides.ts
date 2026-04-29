/**
 * Resolves a partner's brand-guide surfaces across both systems:
 *   1. The new in-app SQD brand guide (`strategy_brand_guides`),
 *      with parent + optional subbrands (each its own row, joined via
 *      `parent_id`).
 *   2. The legacy "Live on Standards" guides hosted on
 *      live.standards.site, modeled as one row per brand in
 *      `prf_brand_guides` (subbrands are separate rows).
 *
 * Used by:
 *   - BrandingIndexPage — to render a status pill on each card and
 *     route to the right surface (in-app handoff for SQD churches,
 *     direct Standards URL for legacy-only churches).
 *   - BrandHandoffPage — to surface every published guide for a
 *     church when staff arrive there, including any Standards
 *     subbrands the church has not yet migrated.
 *
 * "Has any SQD guide" wins over "has Standards" — the SQD system is
 * canonical going forward, and we want staff defaulting to the new
 * surface. Standards links remain accessible from the handoff page.
 */

import { supabase } from './supabase'
import { buildPortalUrl } from './portalUrl'

export type BrandGuideStatus = 'sqd' | 'standards' | 'none'

export interface BrandGuideEntry {
  /** Where this entry came from. Used for icon + labeling on consumers. */
  kind: 'sqd-parent' | 'sqd-sub' | 'standards'
  /** Display label — partner-facing brand or ministry name. */
  label: string
  /** Absolute URL the consumer should link to. */
  url: string
  /** Marks legacy entries we want to nudge staff away from over time. */
  legacy: boolean
}

export interface MemberBrandGuides {
  status: BrandGuideStatus
  /** Primary URL for the "card click" affordance — the SQD parent
   *  guide if available, the first Standards guide otherwise, null if
   *  the church has nothing published. */
  primaryUrl: string | null
  entries: BrandGuideEntry[]
}

interface SqdRow {
  member: number
  parent_id: string | null
  id: string
  slug: string
  display_name: string
  is_published: boolean
}

interface PrfRow {
  account: number | null
  brand_guide_link: string | null
  brand_name: string | null
  is_active: boolean | null
}

/** Normalize a `prf_brand_guides.brand_guide_link` value to a URL the
 *  browser can open. Any non-empty string counts — partners on
 *  Standards have `https://live.standards.site/...`, but the table
 *  also holds rows for guides hosted on Notion, Drive, Frontify, and
 *  occasionally bare-host strings. The original strict
 *  `startsWith('https://live.standards.site')` filter was hiding
 *  those, which made churches with valid Standards-hosted guides
 *  appear as "no brand guide" on the index. Returns null when the
 *  field is missing or whitespace. */
function normalizeStandardsUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Bare host like `live.standards.site/abc` — make it openable.
  return `https://${trimmed}`
}

/** Bulk version for the index page. One query per table. */
export async function loadAllBrandGuidesIndex(): Promise<Map<number, MemberBrandGuides>> {
  const [sqdRes, prfRes] = await Promise.all([
    supabase
      .from('strategy_brand_guides')
      .select('member, parent_id, id, slug, display_name, is_published'),
    supabase
      .from('prf_brand_guides')
      .select('account, brand_guide_link, brand_name, is_active'),
  ])
  const sqd = (sqdRes.data ?? []) as SqdRow[]
  const prf = (prfRes.data ?? []) as PrfRow[]

  const sqdByMember = new Map<number, SqdRow[]>()
  for (const r of sqd) {
    if (!r.member) continue
    const arr = sqdByMember.get(r.member) ?? []
    arr.push(r)
    sqdByMember.set(r.member, arr)
  }

  const prfByMember = new Map<number, PrfRow[]>()
  for (const r of prf) {
    if (r.account == null) continue
    const arr = prfByMember.get(r.account) ?? []
    arr.push(r)
    prfByMember.set(r.account, arr)
  }

  const memberIds = new Set<number>([...sqdByMember.keys(), ...prfByMember.keys()])
  const out = new Map<number, MemberBrandGuides>()
  for (const m of memberIds) {
    out.set(m, buildMemberBrandGuides(sqdByMember.get(m) ?? [], prfByMember.get(m) ?? []))
  }
  return out
}

/** Single-member version for the handoff page. */
export async function loadBrandGuidesForMember(member: number): Promise<MemberBrandGuides> {
  const [sqdRes, prfRes] = await Promise.all([
    supabase
      .from('strategy_brand_guides')
      .select('member, parent_id, id, slug, display_name, is_published')
      .eq('member', member),
    supabase
      .from('prf_brand_guides')
      .select('account, brand_guide_link, brand_name, is_active')
      .eq('account', member),
  ])
  return buildMemberBrandGuides(
    (sqdRes.data ?? []) as SqdRow[],
    (prfRes.data ?? []) as PrfRow[],
  )
}

function buildMemberBrandGuides(sqdRows: SqdRow[], prfRows: PrfRow[]): MemberBrandGuides {
  const entries: BrandGuideEntry[] = []

  // SQD parent first, then subbrands sorted by display_name. We resolve
  // subbrand URLs by joining parent slug + sub slug, mirroring the
  // route shape used by BrandGuidePortalPage and the legacy /brand/
  // tree (see lib/portalUrl.ts).
  const parents = sqdRows.filter(r => !r.parent_id)
  const subs = sqdRows.filter(r => r.parent_id)
  const parentById = new Map(parents.map(p => [p.id, p]))

  parents.sort((a, b) => a.display_name.localeCompare(b.display_name))
  for (const p of parents) {
    entries.push({
      kind: 'sqd-parent',
      label: p.display_name,
      url: buildPortalUrl(p.slug),
      legacy: false,
    })
    const childSubs = subs
      .filter(s => s.parent_id === p.id)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
    for (const s of childSubs) {
      entries.push({
        kind: 'sqd-sub',
        label: s.display_name,
        url: buildPortalUrl(`${p.slug}/${s.slug}`),
        legacy: false,
      })
    }
  }

  // Orphan SQD subs (parent missing) — extremely rare but render with
  // just the sub slug so they don't disappear silently.
  const orphanSubs = subs.filter(s => !parentById.has(s.parent_id ?? ''))
  for (const s of orphanSubs) {
    entries.push({
      kind: 'sqd-sub',
      label: s.display_name,
      url: buildPortalUrl(s.slug),
      legacy: false,
    })
  }

  // Legacy / Standards entries — any row with a usable URL counts.
  // Inactive rows get a "(inactive)" label suffix.
  for (const r of prfRows) {
    const url = normalizeStandardsUrl(r.brand_guide_link)
    if (!url) continue
    const base = r.brand_name ?? 'Standards Brand Guide'
    const label = r.is_active === false ? `${base} (inactive)` : base
    entries.push({
      kind: 'standards',
      label,
      url,
      legacy: true,
    })
  }

  const hasSqd = entries.some(e => e.kind === 'sqd-parent' || e.kind === 'sqd-sub')
  const hasStandards = entries.some(e => e.kind === 'standards')
  const status: BrandGuideStatus = hasSqd ? 'sqd' : hasStandards ? 'standards' : 'none'

  // primaryUrl: first SQD parent (if any), otherwise first Standards
  // entry, otherwise null. Drives the "card click" routing on the
  // index page — staff with a partner that's still legacy-only get
  // sent straight to live.standards.site.
  const primaryUrl =
    entries.find(e => e.kind === 'sqd-parent')?.url ??
    entries.find(e => e.kind === 'standards')?.url ??
    null

  return { status, primaryUrl, entries }
}
