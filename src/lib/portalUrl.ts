/**
 * Central source of truth for brand-guide portal URLs.
 *
 * The portal now lives on a dedicated subdomain (`brand.thesqd.com`) so the
 * partner-facing URL reads as `brand.thesqd.com/{church}[/{ministry}]`
 * instead of the original `strategy.thesqd.com/brand/{church}…`. The legacy
 * prefix stays live for backwards compatibility — both URLs resolve to the
 * same React app, and App.tsx serves different route trees depending on the
 * hostname it sees at mount.
 *
 * Two helpers are exposed:
 *   - `buildPortalUrl(slug)`    — absolute URL. Used for "Copy portal link"
 *                                  in the editor and anywhere a fully-formed
 *                                  URL is emitted to staff or partners.
 *   - `buildPortalPath(slug)`   — relative path. Used for in-portal
 *                                  cross-links (ministry → main church,
 *                                  ministry → sibling ministry) so they
 *                                  stay on the host the viewer is on.
 */

export const BRAND_PORTAL_HOST = 'brand.thesqd.com'

/**
 * Absolute URL for a brand-guide portal page.
 *
 * Production (running on any *.thesqd.com host): always points at
 * `https://brand.thesqd.com/{slug}` — the canonical partner-facing URL.
 * Local dev / Vercel previews: mirrors the current origin with the legacy
 * `/brand/` prefix so Copy-link and PDF downloads keep working without
 * requiring the subdomain to be configured.
 */
export function buildPortalUrl(slug: string): string {
  if (typeof window === 'undefined') {
    return `https://${BRAND_PORTAL_HOST}/${slug}`
  }
  const host = window.location.hostname
  if (host.endsWith('thesqd.com')) {
    return `https://${BRAND_PORTAL_HOST}/${slug}`
  }
  return `${window.location.origin}/brand/${slug}`
}

/**
 * Relative path to another guide from inside the portal. Keeps the viewer
 * on whichever host they arrived on — if they hit `brand.thesqd.com/hope`,
 * a link to the Kids ministry stays on brand.thesqd.com; if they hit the
 * legacy `strategy.thesqd.com/brand/hope`, it stays under /brand/.
 */
export function buildPortalPath(slug: string): string {
  if (typeof window === 'undefined') return `/${slug}`
  return window.location.hostname === BRAND_PORTAL_HOST
    ? `/${slug}`
    : `/brand/${slug}`
}
