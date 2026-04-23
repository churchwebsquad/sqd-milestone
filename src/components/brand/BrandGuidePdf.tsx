import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer'
import type {
  BrandGuidePortalPayload, StrategyBrandColor, StrategyBrandLogo,
  StrategyBrandTypography, StrategyBrandVoiceAttribute, StrategyBrandVoiceGuideline,
  StrategyBrandAttribute,
} from '../../types/database'

// ── Hyphenation ──────────────────────────────────────────────────────────
// Disable hyphenation globally. react-pdf's default hyphenator inserts a
// hyphen in long all-caps strings ("TONE CHARACTERIS-TICS" in the section
// labels). For this layout we'd rather wrap at a space or let the word run
// on its own line than split a word with a hyphen.
Font.registerHyphenationCallback(word => [word])

// ── Fonts ────────────────────────────────────────────────────────────────
// The PDF intentionally renders in the built-in Helvetica family only. We
// tried registering brand fonts (uploaded webfonts + Google-resolved woff2)
// but hit two unreliable paths: (a) subsetted Google woff2 files produced
// broken PDF font subsets in fontkit/PDFKit (PDF viewers showed "Cannot
// extract the embedded font"), and (b) react-pdf's text-shaping engine
// dropped specific glyphs under certain font+style combinations. Helvetica
// is always available, always embeds cleanly, and reads consistently on
// screen and in print. Brand character comes from the accent color
// applied to borders, rules, and eyebrow labels — see `brand` below.

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
// Printer-friendly: white page background, Helvetica everywhere, thin rules.
// Brand color (computed per-render from the guide's `primary` color tier)
// is applied inline to the `Brand` prop-dependent elements below — section
// eyebrows, thin rules, frame borders, positioning quote border.

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
    borderBottomWidth: 0.5,
    paddingBottom: 10,
    marginBottom: 18,
  },
  church: { fontSize: 22, fontWeight: 700, color: INK },
  // All uppercase labels are rendered pre-transformed via String.toUpperCase()
  // at the call site rather than via CSS `textTransform`. react-pdf's text
  // layout engine has a shaping bug where letterSpacing + textTransform drops
  // specific glyphs (notably U+0041 "A") — the pre-transform sidesteps it.
  pageLabel: { fontSize: 8, letterSpacing: 1.2 },
  sectionTitleBlock: {
    marginTop: 32,
    marginBottom: 18,
  },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.4,
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
    marginTop: 10,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: 1.2,
    fontWeight: 700,
    paddingRight: 12,
    flexShrink: 0,
  },
  sectionRule: {
    flex: 1,
    height: 0.5,
  },
  body: { fontSize: 9, lineHeight: 1.5, color: INK_MUTED },
  footer: {
    position: 'absolute',
    left: 54, right: 54, bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    paddingTop: 8,
    fontSize: 7.5,
    color: INK_MUTED,
  },
  logoPrimaryFrame: {
    height: 280,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderWidth: 0.5,
    backgroundColor: '#ffffff',
  },
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
  typeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeChip: {
    minWidth: 180,
    borderWidth: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  typeChipEyebrow: {
    fontSize: 7,
    letterSpacing: 1.2,
    fontWeight: 700,
    marginBottom: 3,
  },
  typeChipName: { fontSize: 13, fontWeight: 700, color: INK },
  typeChipDetail: { fontSize: 7.5, color: INK_MUTED, marginTop: 2 },
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
  },
})

/** Brand-color resolver — derives a single accent color from the guide's
 *  colors array. Used for borders, rules, and eyebrow text; the rest of
 *  the PDF stays in monochrome ink + muted gray. If no primary color is
 *  set, we fall back to the existing neutral palette so unbranded guides
 *  read the same as they used to. */
interface Brand {
  /** Border color for frames, rules, hairlines. */
  line: string
  /** Accent text color (section eyebrows, page labels, sub-section labels). */
  accent: string
  /** Stronger accent for hero rules and the positioning blockquote. */
  strong: string
}

function deriveBrand(colors: readonly StrategyBrandColor[]): Brand {
  const primary = colors.find(c => c.tier === 'primary')?.hex
  if (!primary) {
    return { line: HAIRLINE, accent: INK_MUTED, strong: INK }
  }
  return { line: primary, accent: primary, strong: primary }
}

// ── Component ─────────────────────────────────────────────────────────────

export function BrandGuidePdf({ payload }: { payload: BrandGuidePortalPayload }) {
  const { guide, logos, colors, color_combinations, typography, voice_attributes, voice_guidelines, attributes, parent } = payload
  const brand = deriveBrand(colors)

  const primaryLogo = logos.find(l => l.kind === 'primary') ?? logos[0]
  const supporting = logos.filter(l => l !== primaryLogo)
  const downloadDate = new Date().toISOString().slice(0, 10)

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
      {primaryLogo && (
        <Page size="A4" style={styles.page}>
          <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we look" brand={brand} />
          <SectionOpener eyebrow="01 · Identity" title="Logo" brand={brand} />
          <LogoRow primary={primaryLogo} supporting={supporting} brand={brand} />
          <FooterBar display={bigTitle} date={downloadDate} brand={brand} />
        </Page>
      )}

      {/* ── PAGE 2 — COLORS + TYPOGRAPHY ─────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we look" brand={brand} />

        <View wrap={false}>
          <SectionOpener eyebrow="02 · Palette" title="Color" brand={brand} />
          <ColorSwatches colors={colors} />
          <ProportionBar colors={colors} />
          <CombinationsRow combinations={color_combinations} colors={colors} />
        </View>

        {typography.length > 0 && (
          <View wrap={false}>
            <SectionOpener eyebrow="03 · Type system" title="Typography" brand={brand} />
            <TypographyList typography={typography} brand={brand} />
          </View>
        )}

        <FooterBar display={bigTitle} date={downloadDate} brand={brand} />
      </Page>

      {/* ── PAGE 3 — HOW WE SOUND ────────────────────────────────────────── */}
      {hasSoundPage && (
        <Page size="A4" style={styles.page}>
          <PageHeader eyebrow={eyebrow} bigTitle={bigTitle} pageLabel="How we sound" brand={brand} />

          <SectionOpener eyebrow="04 · Brand voice" title="Voice" brand={brand} />

          {guide.voice_overview && <Text style={styles.voiceOverview}>{guide.voice_overview}</Text>}

          {voice_attributes.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Tone characteristics" brand={brand} />
              <TwoByTwo items={voice_attributes} />
            </View>
          )}

          {voice_guidelines.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Voice guidelines" brand={brand} />
              <TwoByTwo items={voice_guidelines} />
            </View>
          )}

          {attributes.length > 0 && (
            <View wrap={false}>
              <SectionRule label="Attributes" brand={brand} />
              <AttributesBlock items={attributes} />
            </View>
          )}

          {guide.brand_statement && (
            <View wrap={false}>
              <SectionRule label="Positioning" brand={brand} />
              <Text style={[styles.statement, { borderLeftColor: brand.strong }]}>"{guide.brand_statement}"</Text>
            </View>
          )}

          <FooterBar display={bigTitle} date={downloadDate} brand={brand} />
        </Page>
      )}
    </Document>
  )
}

function PageHeader({ eyebrow, bigTitle, pageLabel, brand }: {
  eyebrow: string
  bigTitle: string
  pageLabel: string
  brand: Brand
}) {
  return (
    <View style={[styles.header, { borderBottomColor: brand.line }]}>
      <View>
        <Text style={[styles.pageLabel, { color: brand.accent }]}>{eyebrow.toUpperCase()}</Text>
        <Text style={styles.church}>{bigTitle}</Text>
      </View>
      <Text style={[styles.pageLabel, { color: brand.accent }]}>{pageLabel.toUpperCase()}</Text>
    </View>
  )
}

function SectionOpener({ eyebrow, title, brand }: {
  eyebrow: string
  title: string
  brand: Brand
}) {
  return (
    <View style={styles.sectionTitleBlock}>
      <Text style={[styles.sectionEyebrow, { color: brand.accent }]}>{eyebrow.toUpperCase()}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={[styles.sectionTitleRule, { backgroundColor: brand.strong }]} />
    </View>
  )
}

function SectionRule({ label, brand }: { label: string; brand: Brand }) {
  return (
    <View style={styles.sectionDivider}>
      <Text style={[styles.sectionLabel, { color: brand.accent }]}>{label.toUpperCase()}</Text>
      <View style={[styles.sectionRule, { backgroundColor: brand.line }]} />
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

function LogoRow({ primary, supporting, brand }: {
  primary: StrategyBrandLogo | undefined
  supporting: StrategyBrandLogo[]
  brand: Brand
}) {
  if (!primary) return null

  // Primary fills its own page — bigger frame (280pt tall, 24pt padding
  // → usable ~440×232pt). More breathing room feels like a hero treatment.
  const primaryDims = fitToBox(
    (primary as { preview_w?: number | null }).preview_w,
    (primary as { preview_h?: number | null }).preview_h,
    420, 220,
  )

  return (
    <View>
      <View style={[styles.logoPrimaryFrame, { borderColor: brand.line }]}>
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
              <View key={logo.id} style={[styles.logoSupportingFrame, { borderColor: brand.line }]}>
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

function TypographyList({ typography, brand }: {
  typography: StrategyBrandTypography[]
  brand: Brand
}) {
  if (typography.length === 0) return null
  const TIER_LABEL: Record<string, string> = { primary: 'Heading', secondary: 'Body', accent: 'Accent' }
  return (
    <View style={styles.typeList}>
      {typography.map(font => (
        <View key={font.id} style={[styles.typeChip, { borderColor: brand.line }]}>
          <Text style={[styles.typeChipEyebrow, { color: brand.accent }]}>{(TIER_LABEL[font.tier] ?? font.tier).toUpperCase()}</Text>
          <Text style={styles.typeChipName}>{font.family_name}</Text>
          {font.weight && <Text style={styles.typeChipDetail}>Weights: {font.weight}</Text>}
          {font.suggested_use && <Text style={styles.typeChipDetail}>Use: {font.suggested_use}</Text>}
        </View>
      ))}
    </View>
  )
}

function TwoByTwo({ items }: {
  items: StrategyBrandVoiceAttribute[] | StrategyBrandVoiceGuideline[]
}) {
  if (items.length === 0) return null
  return (
    <View style={styles.twoByTwo}>
      {items.map(item => (
        <View key={item.id} style={styles.voiceCell}>
          <Text style={styles.voiceTitle}>{item.title}</Text>
          <Text style={styles.voiceDesc}>{item.description}</Text>
        </View>
      ))}
    </View>
  )
}

function AttributesBlock({ items }: { items: StrategyBrandAttribute[] }) {
  if (items.length === 0) return null
  return (
    <View style={styles.attrRow}>
      {items.map(a => (
        <View key={a.id} style={styles.attrCell}>
          <Text style={styles.attrLabel}>{a.label}</Text>
          {a.description && <Text style={styles.attrDesc}>{a.description}</Text>}
        </View>
      ))}
    </View>
  )
}

function FooterBar({ display, date, brand }: { display: string; date: string; brand: Brand }) {
  return (
    <View style={[styles.footer, { borderTopColor: brand.line }]} fixed>
      <Text>{display} · Brand Guidelines</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      <Text>Downloaded {date}</Text>
    </View>
  )
}
