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

/** Regex for any `url(...)` ending in woff2 inside a Google Fonts CSS block. */
const WOFF2_URL_RE = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+?)\)\s*format\(['"]woff2['"]\)/

/** Extract the weight spec from a CSS2 URL we constructed. */
function weightFromUrl(url: string): number | null {
  const m = url.match(/:wght@(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Slice a Google Fonts CSS response into its individual `@font-face` blocks.
 * The response contains one block per Unicode subset (latin, latin-ext,
 * cyrillic, vietnamese, …) — we need to pick the right one rather than just
 * grabbing the first woff2 URL we find.
 */
function splitFontFaceBlocks(css: string): string[] {
  const blocks: string[] = []
  let idx = css.indexOf('@font-face')
  while (idx !== -1) {
    const end = css.indexOf('}', idx)
    if (end === -1) break
    blocks.push(css.slice(idx, end + 1))
    idx = css.indexOf('@font-face', end)
  }
  return blocks
}

/**
 * From the CSS response, return the woff2 URL that covers the ASCII range.
 *
 * Google Fonts CSS2 returns one `@font-face` per Unicode subset, ordered
 * roughly cyrillic → greek → vietnamese → latin-ext → latin. A naive "first
 * woff2" pick lands on a subset that covers accented glyphs (Ā Ă Ą) but
 * NOT plain ASCII (A B C). When that font is registered with react-pdf,
 * PDFKit resolves U+0041 through the registered table and emits nothing
 * because the glyph isn't there — which is exactly the "every A gone"
 * symptom on the PDF.
 *
 * The robust fix: parse the `unicode-range` on each block and pick the one
 * that explicitly starts at U+0000. That block is always the "latin"
 * subset — it covers A–Z, a–z, digits, Latin-1 punctuation (including the
 * middle dot U+00B7), the em-dash (U+2014), currency symbols, etc.
 *
 * Falls back to the last block's URL if no `U+0000` is found (extremely
 * unusual — only happens for fonts that ship no latin coverage at all).
 */
function extractLatinWoff2(css: string): string | null {
  const blocks = splitFontFaceBlocks(css)
  // First pass: block whose unicode-range explicitly starts at U+0000.
  for (const block of blocks) {
    const ur = block.match(/unicode-range\s*:\s*([^;}]+)/i)
    if (ur && /\bU\+0{0,3}0\b(?!\w)/i.test(ur[1])) {
      const m = block.match(WOFF2_URL_RE)
      if (m) return m[1]
    }
  }
  // Second pass: last block (Google's CSS ordering puts the broadest
  // subset last, so this is almost always the latin subset for fonts
  // that don't advertise unicode-range for some reason).
  for (let i = blocks.length - 1; i >= 0; i--) {
    const m = blocks[i].match(WOFF2_URL_RE)
    if (m) return m[1]
  }
  return null
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
      const src = extractLatinWoff2(r.css)
      if (!src) continue
      sources.push({ weight, src })
    }
    if (sources.length > 0) out.push({ family, sources })
  }
  return out
}
