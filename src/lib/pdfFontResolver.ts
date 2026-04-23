/**
 * Resolves Google Fonts into direct .woff2 URLs for embedding in a
 * client-generated PDF via @react-pdf/renderer.
 *
 * Why this exists:
 *   react-pdf's Font.register() only accepts a direct font file URL — it
 *   cannot follow a Google Fonts CSS link. To get brand fonts into the PDF
 *   without forcing every staff member to manually upload .woff2 files, we
 *   fetch the Google Fonts CSS at PDF build time, extract the .woff2 URLs,
 *   and hand those to react-pdf.
 *
 *   Google Fonts CSS2 detects modern browsers by User-Agent and serves
 *   .woff2 URLs inline — since we run this in-browser, the detection works
 *   for free. fonts.gstatic.com (the actual font host) also serves CORS
 *   headers, so the PDF renderer can fetch the font bytes at render time.
 *
 * Scope:
 *   Only handles rows where `family_name` is a known Google Font AND no
 *   `font_url` was set. Uploaded .woff/.woff2/.ttf/.otf files continue to
 *   be registered by BrandGuidePdf.tsx directly.
 *
 * Failure mode:
 *   Per-family/per-weight failures are swallowed — the PDF renders, just
 *   falls back to Helvetica for that family. Caller should not await on
 *   individual resolutions.
 */

import type { StrategyBrandTypography } from '../types/database'
import { isGoogleFont, buildGoogleFontsUrls } from './googleFonts'

export interface ResolvedGoogleFont {
  /** CSS family name (matches what Font.register will receive). */
  family: string
  /** One source per weight — react-pdf picks the closest match at render. */
  sources: Array<{ weight: number; src: string }>
}

/** Regex for the first woff2 `url(...)` in a Google Fonts CSS response. */
const WOFF2_URL_RE = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+?)\)\s*format\(['"]woff2['"]\)/

/** Extract the weight spec from a CSS2 URL we constructed. */
function weightFromUrl(url: string): number | null {
  const m = url.match(/:wght@(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export async function resolveGoogleFontsForPdf(
  typography: readonly StrategyBrandTypography[],
): Promise<ResolvedGoogleFont[]> {
  const targets = typography.filter(
    t => !t.font_url && isGoogleFont(t.family_name),
  )
  if (targets.length === 0) return []

  // De-dupe by family (multiple tiers can share a family).
  const byFamily = new Map<string, StrategyBrandTypography>()
  for (const t of targets) {
    if (!byFamily.has(t.family_name)) byFamily.set(t.family_name, t)
  }

  const out: ResolvedGoogleFont[] = []
  for (const [family, font] of byFamily) {
    const sources: ResolvedGoogleFont['sources'] = []
    const cssUrls = buildGoogleFontsUrls(family, font.weight)
    // Fetch all weights in parallel — each CSS call is cheap and independent.
    const responses = await Promise.all(
      cssUrls.map(async url => {
        try {
          const res = await fetch(url)
          if (!res.ok) return null
          return { url, css: await res.text() }
        } catch {
          return null
        }
      }),
    )
    for (const r of responses) {
      if (!r) continue
      const weight = weightFromUrl(r.url)
      if (weight == null) continue
      const match = r.css.match(WOFF2_URL_RE)
      if (!match) continue
      sources.push({ weight, src: match[1] })
    }
    if (sources.length > 0) out.push({ family, sources })
  }
  return out
}
