/**
 * Small helper to detect whether a font family name matches a known Google
 * Fonts offering. We keep a curated list of the most-requested families so the
 * portal can auto-inject `<link>` tags without the user having to paste the
 * Google Fonts URL themselves, and so the editor can warn when a custom font
 * name won't load without a proper webfont license + uploaded file.
 *
 * The list is intentionally broad but not exhaustive — when in doubt the user
 * can still paste a Google Fonts URL manually and the existing font_url path
 * will handle it. Misses here are a UX nicety, not a correctness issue.
 */

const GOOGLE_FONT_NAMES: readonly string[] = [
  // Sans-serifs
  'Inter', 'Work Sans', 'Roboto', 'Roboto Flex', 'Roboto Condensed', 'Roboto Mono',
  'Open Sans', 'Lato', 'Montserrat', 'Source Sans 3', 'Source Sans Pro',
  'Poppins', 'Nunito', 'Nunito Sans', 'Raleway', 'Oswald', 'Ubuntu',
  'Noto Sans', 'Noto Sans Display', 'Noto Serif', 'PT Sans', 'Manrope',
  'Rubik', 'Barlow', 'Barlow Condensed', 'Outfit', 'Plus Jakarta Sans',
  'DM Sans', 'DM Serif Display', 'DM Serif Text', 'Mulish', 'Quicksand',
  'Bebas Neue', 'Anton', 'Archivo', 'Archivo Black', 'Archivo Narrow',
  'Assistant', 'Hind', 'Cabin', 'Karla', 'Exo 2', 'Signika', 'Teko',
  'Fira Sans', 'Fira Sans Condensed', 'Heebo', 'Josefin Sans', 'Kanit',
  'Prompt', 'Sora', 'Space Grotesk', 'Space Mono', 'IBM Plex Sans',
  'IBM Plex Sans Condensed', 'IBM Plex Serif', 'IBM Plex Mono',
  'Red Hat Display', 'Red Hat Text', 'Red Hat Mono', 'Urbanist',
  'Titillium Web', 'Catamaran', 'Dosis', 'Varela Round', 'Comfortaa',
  'Figtree', 'Albert Sans', 'Onest', 'Bricolage Grotesque',

  // Serifs
  'Playfair Display', 'Playfair', 'Merriweather', 'Lora', 'PT Serif',
  'EB Garamond', 'Libre Baskerville', 'Libre Caslon Text', 'Libre Franklin',
  'Cormorant Garamond', 'Cormorant', 'Crimson Text', 'Crimson Pro',
  'Spectral', 'Bitter', 'Cardo', 'Arvo', 'Zilla Slab', 'Alegreya',
  'Alegreya Sans', 'Fraunces', 'Frank Ruhl Libre', 'Vollkorn', 'Gentium Plus',

  // Display / script / mono
  'Abril Fatface', 'Caveat', 'Pacifico', 'Dancing Script', 'Lobster',
  'Satisfy', 'Great Vibes', 'Permanent Marker', 'Shadows Into Light',
  'Indie Flower', 'Kalam', 'Amatic SC', 'Bungee', 'Righteous', 'Russo One',
  'Fjalla One', 'Rajdhani', 'Exo', 'Orbitron', 'Press Start 2P',
  'Cinzel', 'Cinzel Decorative', 'JetBrains Mono', 'Fira Code',
  'Source Code Pro', 'Inconsolata', 'Courier Prime',
]

const GOOGLE_FONT_LOOKUP: Set<string> = new Set(GOOGLE_FONT_NAMES.map(n => n.toLowerCase()))

/** True when the family name matches a known Google Font (case-insensitive, trims whitespace). */
export function isGoogleFont(familyName: string | null | undefined): boolean {
  if (!familyName) return false
  return GOOGLE_FONT_LOOKUP.has(familyName.trim().toLowerCase())
}

/**
 * Build a list of Google Fonts CSS2 URLs — one per weight — for the given
 * family. We issue one `<link>` per weight on purpose: Google Fonts returns
 * HTTP 400 for any family/weight combo it doesn't ship, and it does so for
 * the ENTIRE URL even if only a single weight is unsupported. Per-weight
 * URLs isolate failures so that an unsupported weight (e.g. Space Mono 500
 * — Space Mono only ships 400/700) doesn't break the others.
 *
 * We always include 400 and 700 so the portal has both regular and bold
 * coverage, regardless of what the user typed in the weight field. The
 * user's weights are merged in on top of those.
 */
export function buildGoogleFontsUrls(familyName: string, weights: string | null | undefined): string[] {
  const family = familyName.trim().replace(/\s+/g, '+')
  const all = new Set<number>([400, 700, ...parseWeights(weights)])
  return Array.from(all)
    .sort((a, b) => a - b)
    .map(w => `https://fonts.googleapis.com/css2?family=${family}:wght@${w}&display=swap`)
}

function parseWeights(raw: string | null | undefined): number[] {
  if (!raw) return []
  const tokens = raw.split(/[,\s/]+/).map(t => t.trim()).filter(Boolean)
  const weights = new Set<number>()
  for (const t of tokens) {
    const n = Number(t)
    if (Number.isFinite(n) && n >= 100 && n <= 900) weights.add(Math.round(n / 100) * 100)
  }
  return Array.from(weights).sort((a, b) => a - b)
}
