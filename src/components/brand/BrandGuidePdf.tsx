import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type {
  BrandGuidePortalPayload, StrategyBrandColor, StrategyBrandLogo,
  StrategyBrandTypography, StrategyBrandVoiceAttribute, StrategyBrandVoiceGuideline,
  StrategyBrandAttribute,
} from '../../types/database'
import type { ResolvedGoogleFont } from '../../lib/pdfFontResolver'

// ── Font / hyphenation setup ──────────────────────────────────────────────
// Disable hyphenation globally. react-pdf's default hyphenator inserts a
// hyphen in long all-caps strings ("TONE CHARACTERIS-TICS" in the section
// labels). For this layout we'd rather wrap at a space or let the word run
// on its own line than split a word with a hyphen.
Font.registerHyphenationCallback(word => [word])

// Two sources of brand fonts for the PDF:
//   1. Uploaded webfont files (.woff/.woff2/.ttf/.otf) — registered by URL.
//   2. Google-detected fonts — .woff2 URLs are resolved upstream in
//      pdfFontResolver.ts and passed in via the `resolvedFonts` prop. For
//      Google fonts we register one entry per weight so react-pdf can pick
//      the nearest match at render time.
// Registration is idempotent — react-pdf ignores duplicate registrations.

const REGISTERED = new Set<string>()

function registerUploadedBrandFonts(typography: StrategyBrandTypography[]) {
  for (const font of typography) {
    if (!font.font_url) continue
    if (!/\.(woff2?|ttf|otf)(\?|$)/i.test(font.font_url)) continue
    const family = font.web_font_family ?? font.family_name
    if (REGISTERED.has(family)) continue
    try {
      Font.register({ family, src: font.font_url })
      REGISTERED.add(family)
    } catch {
      // ignore — we'll fall back to Helvetica
    }
  }
}

function registerResolvedGoogleFonts(resolved: readonly ResolvedGoogleFont[]) {
  for (const rf of resolved) {
    if (REGISTERED.has(rf.family)) continue
    try {
      Font.register({
        family: rf.family,
        fonts: rf.sources.map(s => ({ src: s.src, fontWeight: s.weight })),
      })
      REGISTERED.add(rf.family)
    } catch {
      // ignore — per-family failure falls back to Helvetica for that tier
    }
  }
}

/** Resolve a reasonable font family for a tier, falling back gracefully.
 *  Returns the brand family name if it's registered (either from an uploaded
 *  webfont file or from the Google Fonts resolver), Times-Roman for accent
 *  tier when nothing is available, Helvetica otherwise. */
function fontForTier(typography: StrategyBrandTypography[], tier: 'primary' | 'secondary' | 'accent'): string {
  const match = typography.find(t => t.tier === tier)
  if (!match) return tier === 'accent' ? 'Times-Roman' : 'Helvetica'
  const family = match.web_font_family ?? match.family_name
  if (REGISTERED.has(family)) return family
  return tier === 'accent' ? 'Times-Roman' : 'Helvetica'
}

// ── Color helpers ─────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] | null {
  const v = hex.replace('#', '').trim()
  if (v.length === 3) {
    const r = parseInt(v[0] + v[0], 16)
    const g = parseInt(v[1] + v[1], 16)
    const b = parseInt(v[2] + v[2], 16)
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b]
  }
  if (v.length === 6) {
    const r = parseInt(v.slice(0, 2), 16)
    const g = parseInt(v.slice(2, 4), 16)
    const b = parseInt(v.slice(4, 6), 16)
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b]
  }
  return null
}

function hexToRgb(hex: string, stored?: string | null): string {
  if (stored) return stored
  const r = parseHex(hex)
  return r ? `${r[0]} ${r[1]} ${r[2]}` : ''
}

function hexToCmyk(hex: string, stored?: string | null): string {
  if (stored) return stored
  const rgb = parseHex(hex)
  if (!rgb) return ''
  const [r, g, b] = rgb.map(n => n / 255)
  const k = 1 - Math.max(r, g, b)
  if (k === 1) return '0 0 0 100'
  const c = ((1 - r - k) / (1 - k)) * 100
  const m = ((1 - g - k) / (1 - k)) * 100
  const y = ((1 - b - k) / (1 - k)) * 100
  return `${Math.round(c)} ${Math.round(m)} ${Math.round(y)} ${Math.round(k * 100)}`
}

function contrastInk(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#111'
  const [r, g, b] = rgb
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111' : '#fff'
}

// ── Styles ────────────────────────────────────────────────────────────────
// Printer-friendly: white page background (no ink wasted on a cream tint),
// hairline dividers, brand colors ONLY in swatches and proportion bars.
// Headings stay ink-black.

const PAGE_BG = '#ffffff'
const INK = '#111111'
const INK_MUTED = '#4b5563'
const HAIRLINE = '#d1d5db'

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAGE_BG,
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomColor: HAIRLINE,
    borderBottomWidth: 0.5,
    paddingBottom: 10,
    marginBottom: 18,
  },
  church: { fontSize: 22, fontWeight: 700, color: INK },
  pageLabel: { fontSize: 8, letterSpacing: 1.2, color: INK_MUTED, textTransform: 'uppercase' },
  // Big, prominent section title block used on each content page. Replaces
  // the thin rule+label combo that used to divide sub-sections — sections now
  // own their own page (or half-page) and read more like chapter openers.
  // marginTop is generous (32pt) so when two sections share a page (Color +
  // Typography on page 2) they aren't visually touching. On single-section
  // pages the extra top air reads as intentional chapter breathing room.
  sectionTitleBlock: {
    marginTop: 32,
    marginBottom: 18,
  },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.4,
    color: INK_MUTED,
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: INK,
    lineHeight: 1.1,
  },
  sectionTitleRule: {
    height: 2,
    width: 48,
    backgroundColor: INK,
    marginTop: 10,
  },
  // Sub-section divider inside a page — still used for "Tone characteristics"
  // etc. on the voice page.
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: INK_MUTED,
    textTransform: 'uppercase',
    fontWeight: 700,
    paddingRight: 12,
    flexShrink: 0,
  },
  sectionRule: {
    flex: 1,
    height: 0.5,
    backgroundColor: HAIRLINE,
  },
  body: { fontSize: 9, lineHeight: 1.5, color: INK_MUTED },
  footer: {
    position: 'absolute',
    left: 54, right: 54, bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopColor: HAIRLINE,
    borderTopWidth: 0.5,
    paddingTop: 8,
    fontSize: 7.5,
    color: INK_MUTED,
  },
  // Logo — now on its own page, so the frames can be taller.
  logoPrimaryFrame: {
    height: 280,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: HAIRLINE,
    borderWidth: 0.5,
    backgroundColor: '#ffffff',
    marginBottom: 14,
  },
  logoSupportingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  logoSupportingFrame: {
    width: '31.7%',
    height: 140,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: HAIRLINE,
    borderWidth: 0.5,
    backgroundColor: '#ffffff',
  },
  // Colors — bigger chips so the page reads as a proper spread alongside type.
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: {
    width: '31.5%',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  swatchChip: {
    width: 46, height: 46, borderRadius: 3,
    borderColor: HAIRLINE, borderWidth: 0.5,
  },
  swatchName: { fontSize: 10, fontWeight: 700, color: INK },
  swatchMeta: { fontSize: 7, color: INK_MUTED, marginTop: 0.5, fontFamily: 'Courier' },
  proportionBar: {
    flexDirection: 'row',
    height: 34,
    borderColor: HAIRLINE,
    borderWidth: 0.5,
    marginTop: 10,
  },
  combinationsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  combinationTile: {
    width: 88, height: 58,
    borderColor: HAIRLINE, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  // Typography list — no specimens, just a flex-wrap list of families.
  typeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeChip: {
    minWidth: 180,
    borderColor: HAIRLINE,
    borderWidth: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  typeChipEyebrow: {
    fontSize: 7,
    letterSpacing: 1.2,
    color: INK_MUTED,
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: 3,
  },
  typeChipName: { fontSize: 13, fontWeight: 700, color: INK },
  typeChipDetail: { fontSize: 7.5, color: INK_MUTED, marginTop: 2 },
  // Voice / page 3
  voiceOverview: { fontSize: 11, lineHeight: 1.5, color: INK, marginBottom: 14 },
  twoByTwo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 14,
  },
  voiceCell: { width: '46%', marginBottom: 8 },
  voiceTitle: { fontSize: 11, fontWeight: 700, color: INK, marginBottom: 3 },
  voiceDesc: { fontSize: 8.5, lineHeight: 1.5, color: INK_MUTED },
  attrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  attrCell: { width: '30%', marginBottom: 6 },
  attrLabel: { fontSize: 10, fontWeight: 700, color: INK },
  attrDesc: { fontSize: 7.5, lineHeight: 1.5, color: INK_MUTED, marginTop: 1.5 },
  statement: {
    fontSize: 14,
    lineHeight: 1.4,
    color: INK,
    fontStyle: 'italic',
    paddingLeft: 14,
    borderLeftWidth: 1.5,
    borderLeftColor: INK,
  },
})

// ── Component ─────────────────────────────────────────────────────────────

export function BrandGuidePdf({ payload, resolvedFonts = [] }: {
  payload: BrandGuidePortalPayload
  /** Google-resolved .woff2 entries from pdfFontResolver. Empty array is fine
   *  — PDF falls back to Helvetica for any unresolved tier. */
  resolvedFonts?: readonly ResolvedGoogleFont[]
}) {
  registerUploadedBrandFonts(payload.typography)
  registerResolvedGoogleFonts(resolvedFonts)
  const { guide, logos, colors, color_combinations, typography, voice_attributes, voice_guidelines, attributes, parent } = payload

  const primary = logos.find(l => l.kind === 'primary') ?? logos[0]
  const supporting = logos.filter(l => l !== primary)
  const downloadDate = new Date().toISOString().slice(0, 10)

  const headingFont = fontForTier(typography, 'primary')
  const bodyFont = fontForTier(typography, 'secondary')

  // Subbrand guides: church name on the eyebrow, ministry on the big heading,
  // plus a combined string for the PDF file title and footer.
  const isSubbrand = Boolean(parent)
  const eyebrow = isSubbrand && parent ? `${parent.display_name} · Ministry Brand Guide` : 'Brand Guidelines'
  const bigTitle = isSubbrand && parent ? `${parent.display_name} — ${guide.display_name}` : guide.display_name
  const docTitle = `${bigTitle} — Brand Guidelines`

  const hasSoundPage = !isSubbrand && (
    Boolean(guide.voice_overview) ||
    voice_attributes.length > 0 ||
    voice_guidelines.length > 0 ||
    attributes.length > 0 ||
    Boolean(guide.brand_statement)
  )

  return (
    <Document title={docTitle}>
      {/* ── PAGE 1 — LOGOS ───────────────────────────────────────────────── */}
      {primary && (
        <Page size="A4" style={[styles.page, { fontFamily: bodyFont }]}>
          <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we look" headingFont={headingFont} />
          <SectionOpener eyebrow="01 · Identity" title="Logo" headingFont={headingFont} />
          <LogoRow primary={primary} supporting={supporting} />
          <FooterBar display={bigTitle} date={downloadDate} />
        </Page>
      )}

      {/* ── PAGE 2 — COLORS + TYPOGRAPHY ─────────────────────────────────── */}
      <Page size="A4" style={[styles.page, { fontFamily: bodyFont }]}>
        <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we look" headingFont={headingFont} />

        <View wrap={false}>
          <SectionOpener eyebrow="02 · Palette" title="Color" headingFont={headingFont} />
          <ColorSwatches colors={colors} />
          <ProportionBar colors={colors} />
          <CombinationsRow combinations={color_combinations} colors={colors} />
        </View>

        {typography.length > 0 && (
          <View wrap={false}>
            <SectionOpener eyebrow="03 · Type system" title="Typography" headingFont={headingFont} />
            <TypographyList typography={typography} headingFont={headingFont} />
          </View>
        )}

        <FooterBar display={bigTitle} date={downloadDate} />
      </Page>

      {/* ── PAGE 3 — HOW WE SOUND ────────────────────────────────────────── */}
      {hasSoundPage && (
        <Page size="A4" style={[styles.page, { fontFamily: bodyFont }]}>
          <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we sound" headingFont={headingFont} />

          <SectionOpener eyebrow="04 · Brand voice" title="Voice" headingFont={headingFont} />

          {guide.voice_overview && <Text style={styles.voiceOverview}>{guide.voice_overview}</Text>}

          {voice_attributes.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Tone characteristics" />
              <TwoByTwo items={voice_attributes} headingFont={headingFont} />
            </View>
          )}

          {voice_guidelines.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Voice guidelines" />
              <TwoByTwo items={voice_guidelines} headingFont={headingFont} />
            </View>
          )}

          {attributes.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Attributes" />
              <AttributesBlock items={attributes} headingFont={headingFont} />
            </View>
          )}

          {guide.brand_statement && (
            <View wrap={false}>
              <SectionRule label="Positioning" />
              <Text style={[styles.statement, { fontFamily: headingFont }]}>"{guide.brand_statement}"</Text>
            </View>
          )}

          <FooterBar display={bigTitle} date={downloadDate} />
        </Page>
      )}
    </Document>
  )
}

function PageHeader({ eyebrow, bigTitle, pageLabel, headingFont }: {
  eyebrow: string
  bigTitle: string
  pageLabel: string
  headingFont: string
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.pageLabel}>{eyebrow}</Text>
        <Text style={[styles.church, { fontFamily: headingFont }]}>{bigTitle}</Text>
      </View>
      <Text style={styles.pageLabel}>{pageLabel}</Text>
    </View>
  )
}

function SectionOpener({ eyebrow, title, headingFont }: {
  eyebrow: string
  title: string
  headingFont: string
}) {
  return (
    <View style={styles.sectionTitleBlock}>
      <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
      <Text style={[styles.sectionTitle, { fontFamily: headingFont }]}>{title}</Text>
      <View style={styles.sectionTitleRule} />
    </View>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionRule({ label }: { label: string }) {
  return (
    <View style={styles.sectionDivider}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionRule} />
    </View>
  )
}

/** Scale (naturalW, naturalH) into (maxW, maxH) preserving aspect ratio.
 *  Returns dims in PDF points. When natural dims aren't available (raster
 *  fetch failed, etc.) falls back to a SQUARE fit — better to render square
 *  and potentially undersized than to stretch a logo into a wrong aspect. */
function fitToBox(
  natW: number | null | undefined,
  natH: number | null | undefined,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  if (!natW || !natH) {
    const d = Math.min(maxW, maxH) * 0.8
    return { width: d, height: d }
  }
  const scale = Math.min(maxW / natW, maxH / natH)
  return { width: natW * scale, height: natH * scale }
}

function LogoRow({ primary, supporting }: { primary: StrategyBrandLogo | undefined; supporting: StrategyBrandLogo[] }) {
  if (!primary) return null

  // Primary now fills its own page — bigger frame (280pt tall, 24pt padding
  // → usable ~440×232pt). More breathing room feels like a hero treatment.
  const primaryDims = fitToBox(
    (primary as { preview_w?: number | null }).preview_w,
    (primary as { preview_h?: number | null }).preview_h,
    420, 220,
  )

  return (
    <View>
      <View style={styles.logoPrimaryFrame}>
        {primary.preview_url && !primary.preview_url.endsWith('.mp4') && (
          <Image src={{ uri: primary.preview_url }} style={primaryDims} />
        )}
      </View>
      {supporting.length > 0 && (
        <View style={styles.logoSupportingRow}>
          {supporting.slice(0, 6).map(logo => {
            // Row of 3 at 31.7% width (gap 12pt) → each frame ≈ 150pt wide,
            // 140pt tall, 24pt padding → usable ~126×116pt.
            const dims = fitToBox(
              (logo as { preview_w?: number | null }).preview_w,
              (logo as { preview_h?: number | null }).preview_h,
              122, 110,
            )
            return (
              <View key={logo.id} style={styles.logoSupportingFrame}>
                {logo.preview_url && !logo.preview_url.endsWith('.mp4') && (
                  <Image src={{ uri: logo.preview_url }} style={dims} />
                )}
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

function ColorSwatches({ colors }: { colors: StrategyBrandColor[] }) {
  if (colors.length === 0) return null
  return (
    <View style={styles.swatchRow}>
      {colors.map(c => (
        <View key={c.id} style={styles.swatch}>
          <View style={[styles.swatchChip, { backgroundColor: c.hex }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.swatchName}>{c.name ?? c.hex.toUpperCase()}</Text>
            <Text style={styles.swatchMeta}>HEX {c.hex.toUpperCase()}</Text>
            <Text style={styles.swatchMeta}>RGB {hexToRgb(c.hex, c.rgb)}</Text>
            <Text style={styles.swatchMeta}>CMYK {hexToCmyk(c.hex, c.cmyk)}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

function ProportionBar({ colors }: { colors: StrategyBrandColor[] }) {
  const withProp = colors.filter(c => typeof c.proportion_pct === 'number' && c.proportion_pct! > 0)
  if (withProp.length < 2) return null
  const total = withProp.reduce((n, c) => n + (c.proportion_pct ?? 0), 0)
  return (
    <View style={styles.proportionBar}>
      {withProp.map(c => (
        <View
          key={c.id}
          style={{
            width: `${(c.proportion_pct! / total) * 100}%`,
            backgroundColor: c.hex,
            justifyContent: 'flex-start',
            paddingTop: 3,
            paddingLeft: 4,
          }}
        >
          <Text style={{ fontSize: 7, color: contrastInk(c.hex), fontWeight: 700 }}>{c.proportion_pct}%</Text>
        </View>
      ))}
    </View>
  )
}

function CombinationsRow({ combinations, colors }: {
  combinations: BrandGuidePortalPayload['color_combinations']
  colors: StrategyBrandColor[]
}) {
  if (combinations.length === 0) return null
  const byId = new Map(colors.map(c => [c.id, c]))
  return (
    <View style={styles.combinationsRow}>
      {combinations.slice(0, 5).map(combo => {
        const bg = combo.bg_color_id ? byId.get(combo.bg_color_id) : null
        const fg = combo.fg_color_id ? byId.get(combo.fg_color_id) : null
        if (!bg || !fg) return null
        return (
          <View key={combo.id} style={[styles.combinationTile, { backgroundColor: bg.hex }]}>
            <View style={{ width: 42, height: 26, backgroundColor: fg.hex, borderRadius: 2 }} />
          </View>
        )
      })}
    </View>
  )
}

function TypographyList({ typography, headingFont }: {
  typography: StrategyBrandTypography[]
  headingFont: string
}) {
  if (typography.length === 0) return null
  const TIER_LABEL: Record<string, string> = { primary: 'Heading', secondary: 'Body', accent: 'Accent' }
  return (
    <View style={styles.typeList}>
      {typography.map(font => (
        <View key={font.id} style={styles.typeChip}>
          <Text style={styles.typeChipEyebrow}>{TIER_LABEL[font.tier] ?? font.tier}</Text>
          <Text style={[styles.typeChipName, { fontFamily: headingFont }]}>{font.family_name}</Text>
          {font.weight && <Text style={styles.typeChipDetail}>Weights: {font.weight}</Text>}
          {font.suggested_use && <Text style={styles.typeChipDetail}>Use: {font.suggested_use}</Text>}
        </View>
      ))}
    </View>
  )
}

function TwoByTwo({ items, headingFont }: {
  items: StrategyBrandVoiceAttribute[] | StrategyBrandVoiceGuideline[]
  headingFont: string
}) {
  if (items.length === 0) return null
  return (
    <View style={styles.twoByTwo}>
      {items.map(item => (
        <View key={item.id} style={styles.voiceCell}>
          <Text style={[styles.voiceTitle, { fontFamily: headingFont }]}>{item.title}</Text>
          <Text style={styles.voiceDesc}>{item.description}</Text>
        </View>
      ))}
    </View>
  )
}

function AttributesBlock({ items, headingFont }: { items: StrategyBrandAttribute[]; headingFont: string }) {
  if (items.length === 0) return null
  return (
    <View style={styles.attrRow}>
      {items.map(a => (
        <View key={a.id} style={styles.attrCell}>
          <Text style={[styles.attrLabel, { fontFamily: headingFont }]}>{a.label}</Text>
          {a.description && <Text style={styles.attrDesc}>{a.description}</Text>}
        </View>
      ))}
    </View>
  )
}

function FooterBar({ display, date }: { display: string; date: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{display} · Brand Guidelines</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      <Text>Downloaded {date}</Text>
    </View>
  )
}
