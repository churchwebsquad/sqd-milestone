import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowRight, Check, Download, ExternalLink, MessageCircle,
  Palette, Type as TypeIcon, Image as ImageIcon, Sparkles, AlertCircle,
  Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  BrandGuidePortalPayload, StrategyBrandColor, StrategyBrandTypography,
  StrategyBrandLogo, StrategyBrandElement,
} from '../types/database'
import { isGoogleFont, buildGoogleFontsUrls } from '../lib/googleFonts'
import { buildPortalPath } from '../lib/portalUrl'

// ── Sections ────────────────────────────────────────────────────────────────

const SECTIONS: { id: string; label: string }[] = [
  { id: 'logo',        label: 'Logo' },
  { id: 'color',       label: 'Color' },
  { id: 'typography',  label: 'Typography' },
  { id: 'elements',    label: 'Elements' },
  { id: 'voice',       label: 'Voice' },
  { id: 'attributes',  label: 'Attributes' },
  { id: 'positioning', label: 'Positioning' },
  { id: 'ministries',  label: 'Ministries' },
]

// Neutral fallback font loaded from Google Fonts. Always available.
const FALLBACK_FONT = 'Work Sans'
const FALLBACK_FONT_STACK = `"${FALLBACK_FONT}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

// ── Page ────────────────────────────────────────────────────────────────────

export default function BrandGuidePortalPage() {
  const { churchSlug, ministrySlug } = useParams<{ churchSlug: string; ministrySlug?: string }>()
  // Composite slug for the RPC — main guides live at `{church}`, subbrands at
  // `{church}/{ministry}`. The slug column in strategy_brand_guides stores the
  // full composite string either way.
  const slug = ministrySlug ? `${churchSlug}/${ministrySlug}` : churchSlug
  const [payload, setPayload] = useState<BrandGuidePortalPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data, error: err } = await supabase.rpc('get_brand_guide_by_slug', { p_slug: slug })
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setPayload(data as BrandGuidePortalPayload | null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [slug])

  // Inject font faces: brand fonts (when provided) + Work Sans fallback (always).
  useEffect(() => {
    const cleanups: (() => void)[] = []

    // Always load Work Sans so the fallback is available.
    const workSans = document.createElement('link')
    workSans.rel = 'stylesheet'
    workSans.href = 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap'
    document.head.appendChild(workSans)
    cleanups.push(() => document.head.removeChild(workSans))

    if (payload) {
      // De-dupe by href so multiple rows sharing a Google family only load once.
      const loadedHrefs = new Set<string>()
      const addLink = (href: string) => {
        if (loadedHrefs.has(href)) return
        loadedHrefs.add(href)
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        document.head.appendChild(link)
        cleanups.push(() => document.head.removeChild(link))
      }

      for (const font of payload.typography) {
        // Explicit Google/Adobe URL — inject as-is.
        if (font.font_url && /fonts\.googleapis\.com|use\.typekit/i.test(font.font_url)) {
          addLink(font.font_url)
          continue
        }
        // Uploaded webfont file — synthesize an @font-face so the family_name resolves.
        if (font.font_url && /\.(woff2?|ttf|otf)(\?|$)/i.test(font.font_url)) {
          const style = document.createElement('style')
          const webFamily = font.web_font_family || font.family_name
          style.textContent = `@font-face { font-family: "${webFamily}"; src: url("${font.font_url}"); font-display: swap; }`
          document.head.appendChild(style)
          cleanups.push(() => document.head.removeChild(style))
          continue
        }
        // No URL but the family name is a known Google Font — auto-inject one
        // <link> per requested weight. Per-weight links are important: Google
        // Fonts 400s the whole request if any weight is unsupported (Space
        // Mono has no 500, etc.), so bundling would take down regular + bold
        // along with the bad weight.
        if (!font.font_url && isGoogleFont(font.family_name)) {
          for (const href of buildGoogleFontsUrls(font.family_name, font.weight)) {
            addLink(href)
          }
        }
      }
    }

    return () => { cleanups.forEach(fn => fn()) }
  }, [payload])

  if (loading) return <Shell theme={null}><Loading /></Shell>
  if (error) return <Shell theme={null}><Message kind="error" title="Couldn't load this brand guide" body={error} /></Shell>
  if (!payload) return <Shell theme={null}><NotFound /></Shell>

  const theme = deriveTheme(payload)

  return (
    <Shell theme={theme}>
      <TopBar payload={payload} theme={theme} />
      <Body payload={payload} theme={theme} />
    </Shell>
  )
}

// ── Theme derivation ────────────────────────────────────────────────────────

interface PortalTheme {
  /** Page bg + card body fallback (background tier > #F7F6F2). */
  pageBg: string
  /** Ink — text tier > #111. */
  text: string
  /** Accent — primary tier > #341756 (deep plum safe default). */
  accent: string
  /** Secondary accent — secondary tier > accent. */
  secondary: string
  /** Top bar bg — text tier (usually the darkest). Falls back to deep plum. */
  topbarBg: string
  /** Text on top bar — opposite of topbarBg luminance. */
  topbarText: string
  /** Font family for headings. */
  headingFont: string
  /** Font family for body text. */
  bodyFont: string
  /** True when the primary heading font fell back to Work Sans (no web override provided). */
  headingFellBack: boolean
  /** Same for body. */
  bodyFellBack: boolean
}

function deriveTheme(payload: BrandGuidePortalPayload): PortalTheme {
  const colors = payload.colors
  const bg = colors.find(c => c.tier === 'background')
  const txt = colors.find(c => c.tier === 'text')
  const primary = colors.find(c => c.tier === 'primary')
  const secondary = colors.find(c => c.tier === 'secondary')

  const pageBg = bg?.hex ?? '#F7F6F2'
  const text = txt?.hex ?? '#111111'
  const accent = primary?.hex ?? '#341756'
  const secondaryHex = secondary?.hex ?? accent

  // Top bar uses the text tier when dark, else falls back to deep plum.
  const topbarBg = (txt && isDarkColor(txt.hex)) ? txt.hex : '#111111'
  const topbarText = contrastText(topbarBg)

  // Font resolution — primary/secondary rows from the brand; Work Sans fallback.
  const heading = payload.typography.find(t => t.tier === 'primary')
  const body = payload.typography.find(t => t.tier === 'secondary')

  const { stack: headingStack, fellBack: headingFellBack } = resolveFontStack(heading)
  const { stack: bodyStack, fellBack: bodyFellBack } = resolveFontStack(body)

  return {
    pageBg, text, accent, secondary: secondaryHex,
    topbarBg, topbarText,
    headingFont: headingStack,
    bodyFont: bodyStack,
    headingFellBack, bodyFellBack,
  }
}

/**
 * Resolve a font row into a CSS font stack + flags describing what we know.
 * `displayable` is true when the browser should actually be able to render
 * text in the intended family (either we loaded it explicitly or it's a
 * detected Google Font we auto-injected). `fellBack` is true when we had to
 * fall back to Work Sans because no usable font was provided.
 *
 * Preference order:
 *   1. font_url points at Google Fonts → use family_name
 *   2. font_url is an uploaded webfont file → use web_font_family (or family_name)
 *   3. family_name matches a known Google Font (auto-injected by the effect) → use it
 *   4. web_font_family override alone → use it (assume caller arranged for it)
 *   5. Nothing usable → Work Sans fallback
 */
function resolveFontStack(font: StrategyBrandTypography | undefined): {
  stack: string
  fellBack: boolean
  displayable: boolean
} {
  if (!font) return { stack: FALLBACK_FONT_STACK, fellBack: true, displayable: false }
  const isGoogleUrl = !!font.font_url && /fonts\.googleapis\.com/i.test(font.font_url)
  const isFileUrl = !!font.font_url && /\.(woff2?|ttf|otf)(\?|$)/i.test(font.font_url)
  if (isGoogleUrl) {
    return { stack: `"${font.family_name}", ${FALLBACK_FONT_STACK}`, fellBack: false, displayable: true }
  }
  if (isFileUrl) {
    const fam = font.web_font_family || font.family_name
    return { stack: `"${fam}", ${FALLBACK_FONT_STACK}`, fellBack: false, displayable: true }
  }
  if (isGoogleFont(font.family_name)) {
    return { stack: `"${font.family_name}", ${FALLBACK_FONT_STACK}`, fellBack: false, displayable: true }
  }
  if (font.web_font_family) {
    return { stack: `"${font.web_font_family}", ${FALLBACK_FONT_STACK}`, fellBack: false, displayable: true }
  }
  return { stack: FALLBACK_FONT_STACK, fellBack: true, displayable: false }
}

// ── Shell / top bar / messages ─────────────────────────────────────────────

function Shell({ children, theme }: { children: React.ReactNode; theme: PortalTheme | null }) {
  const style: React.CSSProperties = theme
    ? { backgroundColor: theme.pageBg, color: theme.text, fontFamily: theme.bodyFont }
    : { backgroundColor: '#f3f4f6' }
  return <div className="min-h-screen" style={style}>{children}</div>
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-32 text-gray-500">
      <div className="h-6 w-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
    </div>
  )
}

function Message({ kind, title, body }: { kind: 'error' | 'empty'; title: string; body: string }) {
  const isError = kind === 'error'
  return (
    <div className="max-w-xl mx-auto px-6 py-24 text-center">
      <div className={`inline-flex items-center justify-center h-12 w-12 rounded-full mb-4 ${
        isError ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
      }`}>
        {isError ? <AlertCircle size={22} /> : <ImageIcon size={22} />}
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-gray-600 mt-2">{body}</p>
    </div>
  )
}

function NotFound() {
  return (
    <Message
      kind="empty"
      title="This brand guide isn't published yet"
      body="If you believe you reached this page in error, reach out to your Church Media Squad team."
    />
  )
}

/**
 * Swap every image URL in the payload for a rasterized PNG data URL so
 * @react-pdf/renderer can embed it. Stores the natural dimensions alongside
 * the URL (as `preview_w` / `preview_h` / `on_color_logo_w` / `on_color_logo_h`)
 * so the PDF template can size images proportionally without stretching.
 * Falls back to the original URL + null dims when rasterization fails.
 */
type RasterFn = (url: string) => Promise<{ src: string; width: number; height: number } | null>

async function preparePayloadForPdf(
  payload: BrandGuidePortalPayload,
  rasterize: RasterFn,
): Promise<BrandGuidePortalPayload> {
  const deep: BrandGuidePortalPayload = JSON.parse(JSON.stringify(payload))

  const rasterize1 = async (url: string | null | undefined) => {
    if (!url || url.endsWith('.mp4')) return { src: url ?? null, width: null, height: null }
    const r = await rasterize(url)
    if (!r) return { src: url, width: null, height: null }
    return { src: r.src, width: r.width, height: r.height }
  }

  await Promise.all([
    ...deep.logos.map(async l => {
      const { src, width, height } = await rasterize1(l.preview_url)
      l.preview_url = src ?? ''
      ;(l as { preview_w?: number | null }).preview_w = width
      ;(l as { preview_h?: number | null }).preview_h = height
    }),
    ...deep.colors.map(async c => {
      const { src, width, height } = await rasterize1(c.on_color_logo_url)
      c.on_color_logo_url = src
      ;(c as { on_color_logo_w?: number | null }).on_color_logo_w = width
      ;(c as { on_color_logo_h?: number | null }).on_color_logo_h = height
    }),
    ...deep.elements.map(async e => {
      const { src, width, height } = await rasterize1(e.preview_url)
      e.preview_url = src
      ;(e as { preview_w?: number | null }).preview_w = width
      ;(e as { preview_h?: number | null }).preview_h = height
    }),
  ])

  return deep
}

function TopBar({ payload, theme }: {
  payload: BrandGuidePortalPayload
  theme: PortalTheme
}) {
  const { guide } = payload
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  const downloadPdf = async () => {
    if (downloadingPdf) return
    setDownloadingPdf(true)
    try {
      // Dynamic import so @react-pdf/renderer isn't in the initial bundle.
      const [{ pdf }, { BrandGuidePdf }, { rasterizeForPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('../components/brand/BrandGuidePdf'),
        import('../lib/pdfImageRaster'),
      ])

      // Pre-rasterize every image URL the PDF will reference. react-pdf's
      // <Image> can't render SVG and sometimes silently drops remote URLs —
      // converting to PNG data URLs up front guarantees they render. The
      // PDF renders in Helvetica exclusively — brand character comes from
      // the color palette applied to rules and borders, not the font.
      const prepared = await preparePayloadForPdf(payload, rasterizeForPdf)
      const blob = await pdf(<BrandGuidePdf payload={prepared} />).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${guide.slug}-brand-guide.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (err) {
      console.error('[BrandGuidePortalPage] PDF generation failed:', err)
      alert('Could not generate the PDF. Please try again or contact your Church Media Squad team.')
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ backgroundColor: theme.topbarBg, color: theme.topbarText, borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest opacity-60">
            {payload.parent ? `${payload.parent.display_name} · Ministry Brand Guide` : 'Brand Guidelines'}
          </p>
          <h1
            className="text-xl md:text-2xl font-semibold truncate leading-tight"
            style={{ fontFamily: theme.headingFont }}
          >
            {payload.parent
              ? `${payload.parent.display_name} — ${guide.display_name}`
              : guide.display_name}
          </h1>
        </div>
        <div className="flex flex-col items-stretch justify-center gap-1.5 shrink-0 self-center">
          <button
            type="button"
            onClick={downloadPdf}
            disabled={downloadingPdf}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border text-xs font-semibold px-3 py-1.5 transition-colors disabled:opacity-60"
            style={{
              borderColor: 'rgba(255,255,255,0.3)',
              color: theme.topbarText,
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
            title="Download a printer-friendly PDF of this brand guide"
          >
            <Download size={12} /> {downloadingPdf ? 'Preparing…' : 'Download PDF'}
          </button>
          {guide.assets_zip_url && (
            <a
              href={guide.assets_zip_url}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-full border text-xs font-semibold px-3 py-1.5 transition-colors"
              style={{
                borderColor: 'rgba(255,255,255,0.3)',
                color: theme.topbarText,
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
              title="Download the brand package (zip)"
            >
              <Download size={12} /> Download brand package
            </a>
          )}
        </div>
      </div>
      {(guide.last_updated_at ?? guide.updated_at) && (
        <div className="max-w-7xl mx-auto px-5 md:px-8 pb-2 text-[11px] opacity-60">
          Last updated {new Date(guide.last_updated_at ?? guide.updated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      )}
    </header>
  )
}

// ── Body — sidebar + content ───────────────────────────────────────────────

function Body({ payload, theme }: { payload: BrandGuidePortalPayload; theme: PortalTheme }) {
  const isSubbrand = payload.guide.parent_id != null
  const visibleSections = SECTIONS.filter(s => {
    if (s.id === 'ministries') return payload.subbrands.length > 0
    if (s.id === 'elements') return payload.elements.length > 0
    // Subbrands are brand-identity only — skip voice/positioning/attributes.
    if (isSubbrand && (s.id === 'voice' || s.id === 'attributes' || s.id === 'positioning')) return false
    return true
  })
  const [activeId, setActiveId] = useState<string>(visibleSections[0].id)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const ids = visibleSections.map(s => s.id)
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: [0, 0.2, 0.5, 1] },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [visibleSections])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }

  // Smooth-scroll a section into view without jumping. The `scroll-mt-24` on
  // section elements handles the top-bar offset; this just animates the jump.
  const scrollToSection = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="max-w-7xl mx-auto px-5 md:px-8 py-6 md:py-8">
      {/* No overflow-hidden on this wrapper — sticky children need it unset
          to keep their own layout context relative to the viewport. Rounded
          corners still look right because the nav + main both have their
          padding well inside the border. */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] divide-y md:divide-y-0 md:divide-x divide-gray-200">
          <nav
            className="md:sticky md:self-start py-10 px-2 md:max-h-[calc(100vh-5.5rem)] md:overflow-y-auto"
            style={{ top: '5.5rem' }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 px-4 mb-2">Sections</p>
            <ul className="space-y-0.5">
              {visibleSections.map(s => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={scrollToSection(s.id)}
                    className="block text-sm px-4 py-2 rounded-md transition-colors"
                    style={activeId === s.id
                      ? { backgroundColor: '#f3f4f6', color: theme.text, fontWeight: 600, borderLeft: `2px solid ${theme.accent}`, marginLeft: -2, paddingLeft: 14 }
                      : { color: '#4b5563' }
                    }
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="px-6 md:px-10 py-8 md:py-12 space-y-16 md:space-y-24" style={{ fontFamily: theme.bodyFont, color: theme.text }}>
            <LogoSection logos={payload.logos} colors={payload.colors} theme={theme} />
            <ColorSection colors={payload.colors} combinations={payload.color_combinations} aseSwatchUrl={payload.guide.ase_swatch_url} theme={theme} onCopy={showToast} />
            <TypographySection typography={payload.typography} theme={theme} />
            <ElementsSection elements={payload.elements} theme={theme} />
            {!isSubbrand && (
              <>
                <VoiceSection
                  overview={payload.guide.voice_overview}
                  toneCharacteristics={payload.voice_attributes}
                  voiceGuidelines={payload.voice_guidelines}
                  theme={theme}
                />
                <AttributesSection attributes={payload.attributes} theme={theme} />
                <PositioningSection statement={payload.guide.brand_statement} theme={theme} />
              </>
            )}
            <MinistriesSection subbrands={payload.subbrands} theme={theme} />
            {isSubbrand && (
              <BrandFamilySection
                parent={payload.parent}
                siblings={payload.siblings}
                theme={theme}
              />
            )}

            <footer className="pt-10 border-t border-gray-200 text-xs text-gray-500">
              Brand Guidelines
              {payload.guide.last_updated_at && (
                <> · Last updated {new Date(payload.guide.last_updated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</>
              )}
              {payload.guide.contact_name && payload.guide.contact_email && (
                <> · Questions? Contact <a href={`mailto:${payload.guide.contact_email}`} className="font-semibold hover:underline" style={{ color: theme.accent }}>{payload.guide.contact_name}</a></>
              )}
              {payload.guide.contact_name && !payload.guide.contact_email && (
                <> · Questions? Contact <span className="font-semibold" style={{ color: theme.accent }}>{payload.guide.contact_name}</span></>
              )}
              <> · Created by <a href="https://churchmediasquad.com" target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: theme.accent }}>Church Media Squad</a></>
            </footer>
          </main>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2"
          style={{ backgroundColor: theme.accent }}>
          <Check size={13} /> {toast}
        </div>
      )}
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function SectionHeader({ label, description, icon: Icon, theme }: {
  label: string
  description?: string
  icon: typeof Palette
  theme: PortalTheme
}) {
  return (
    <div className="border-b border-gray-200 pb-6 mb-8 flex items-start justify-between gap-6 flex-wrap">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 flex items-center gap-2">
          <Icon size={12} /> {label}
        </p>
        <h2 className="text-3xl md:text-4xl font-semibold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{label}</h2>
      </div>
      {description && <p className="text-sm text-gray-600 max-w-md leading-relaxed">{description}</p>}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-gray-500 italic border-l-2 border-gray-200 pl-4 py-2">
      {children}
    </p>
  )
}

// ── Color utilities ────────────────────────────────────────────────────────

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

function hexToRgbStr(hex: string, stored?: string | null): string {
  if (stored) return stored
  const rgb = parseHex(hex)
  if (!rgb) return ''
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`
}

function hexToCmykStr(hex: string, stored?: string | null): string {
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

function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function isDarkColor(hex: string): boolean {
  return luminance(hex) < 0.6
}

function contrastText(hex: string): string {
  return isDarkColor(hex) ? '#ffffff' : '#111111'
}

function lightnessLabel(hex: string): 'Light' | 'Dark' {
  return isDarkColor(hex) ? 'Dark' : 'Light'
}

// ── LOGO SECTION ───────────────────────────────────────────────────────────

function LogoSection({ logos, colors, theme }: {
  logos: StrategyBrandLogo[]
  colors: StrategyBrandColor[]
  theme: PortalTheme
}) {
  const primary = logos.find(l => l.kind === 'primary')
  const supporting = logos.filter(l => l.kind !== 'primary')
  const onColorColors = colors.filter(c => !!c.on_color_logo_url)

  return (
    <section id="logo" className="scroll-mt-24">
      <SectionHeader
        icon={ImageIcon}
        label="Logo"
        description="Our logo is the primary identifier for our church. Download assets for print and web below."
        theme={theme}
      />

      {primary ? (
        <div className="rounded-xl border border-gray-200 p-6 md:p-12 bg-white flex items-center justify-center min-h-[220px] mb-6 relative">
          {primary.download_url && (
            <a
              href={primary.download_url}
              target="_blank" rel="noopener noreferrer"
              className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-full text-white text-xs font-semibold px-3 py-1.5 transition-opacity hover:opacity-90"
              style={{ backgroundColor: theme.topbarBg }}
            >
              <Download size={11} /> Download
            </a>
          )}
          <LogoArtwork logo={primary} maxHeight="max-h-32" />
        </div>
      ) : (
        <EmptyHint>No primary logo uploaded yet.</EmptyHint>
      )}

      {supporting.length > 0 && (
        <>
          <h3 className="text-base font-bold mt-10 mb-3" style={{ fontFamily: theme.headingFont, color: theme.text }}>Supporting logos</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {supporting.map(logo => (
              <div key={logo.id} className="group relative rounded-xl border border-gray-200 bg-white aspect-square flex items-center justify-center p-6">
                <LogoArtwork logo={logo} maxHeight="max-h-24" />
                {logo.download_url && (
                  <a
                    href={logo.download_url}
                    target="_blank" rel="noopener noreferrer"
                    className="absolute inset-x-0 bottom-0 text-[11px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity py-1.5 text-center bg-white/90 backdrop-blur"
                  >
                    Download ↗
                  </a>
                )}
                {logo.label && (
                  <p className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {logo.label}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {onColorColors.length > 0 && (
        <>
          <h3 className="text-base font-bold mt-10 mb-3" style={{ fontFamily: theme.headingFont, color: theme.text }}>On color</h3>
          <p className="text-sm text-gray-600 mb-4 max-w-2xl">
            When our logo appears on a brand color, use the approved lockup below for ample contrast.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {onColorColors.map(c => {
              const logoSrc = c.on_color_logo_url!
              const isVideo = logoSrc.endsWith('.mp4')
              return (
                <div
                  key={c.id}
                  className="rounded-xl aspect-video flex items-center justify-center border border-gray-200"
                  style={{ backgroundColor: c.hex }}
                >
                  {isVideo ? (
                    <video src={logoSrc} className="max-h-16 max-w-full" autoPlay loop muted playsInline />
                  ) : (
                    <img src={logoSrc} alt={c.name ?? 'On-color logo'} className="max-h-16 max-w-full object-contain" />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {primary?.clear_space_note && (
        <p className="mt-10 text-sm text-gray-600 italic border-l-2 border-gray-300 pl-4">
          {primary.clear_space_note}
        </p>
      )}
    </section>
  )
}

function LogoArtwork({ logo, maxHeight }: { logo: StrategyBrandLogo; maxHeight: string }) {
  if (!logo.preview_url) {
    return <p className="text-xs text-gray-400">No image</p>
  }
  if (logo.preview_url.endsWith('.mp4')) {
    return <video src={logo.preview_url} className={`${maxHeight} max-w-full`} autoPlay loop muted playsInline />
  }
  return <img src={logo.preview_url} alt={logo.label ?? 'Logo'} className={`${maxHeight} max-w-full object-contain`} />
}

// ── COLOR SECTION ──────────────────────────────────────────────────────────

const COLOR_TIER_ORDER = ['primary', 'secondary', 'accent', 'light', 'dark', 'background', 'text'] as const

function ColorSection({ colors, combinations, aseSwatchUrl, theme, onCopy }: {
  colors: StrategyBrandColor[]
  combinations: BrandGuidePortalPayload['color_combinations']
  aseSwatchUrl: string | null
  theme: PortalTheme
  onCopy: (msg: string) => void
}) {
  const tiers = useMemo(() => {
    const groups = new Map<string, StrategyBrandColor[]>()
    for (const c of colors) {
      const arr = groups.get(c.tier) ?? []
      arr.push(c)
      groups.set(c.tier, arr)
    }
    return COLOR_TIER_ORDER
      .map(tier => ({ tier, items: groups.get(tier) ?? [] }))
      .filter(g => g.items.length > 0)
  }, [colors])

  const withProportion = colors.filter(c => typeof c.proportion_pct === 'number' && c.proportion_pct! > 0)
  const totalProportion = withProportion.reduce((n, c) => n + (c.proportion_pct ?? 0), 0)
  const colorsById = new Map(colors.map(c => [c.id, c]))

  if (colors.length === 0) {
    return (
      <section id="color" className="scroll-mt-24">
        <SectionHeader icon={Palette} label="Color" description="The color palette defines tone and hierarchy." theme={theme} />
        <EmptyHint>No colors defined yet.</EmptyHint>
      </section>
    )
  }

  return (
    <section id="color" className="scroll-mt-24">
      <SectionHeader
        icon={Palette}
        label="Color"
        description="Our palette sets the tone for everything we make. Primary carries prominence; secondary, accent, light, dark, background, and text support it. Click any swatch to copy the hex."
        theme={theme}
      />

      <div className="space-y-8">
        {tiers.map(g => (
          <div key={g.tier}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">{g.tier}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {g.items.map(c => <ColorSwatch key={c.id} color={c} theme={theme} onCopy={onCopy} />)}
            </div>
          </div>
        ))}
      </div>

      {withProportion.length >= 2 && totalProportion > 0 && (
        <div className="mt-12">
          <h3 className="text-base font-bold mb-2" style={{ fontFamily: theme.headingFont, color: theme.text }}>Color Hierarchy</h3>
          <p className="text-sm text-gray-600 mb-4 max-w-2xl">
            Suggested proportion of color usage across the brand identity. The bigger the bar, the more prominence it carries.
          </p>
          <div className="flex h-24 rounded-lg overflow-hidden border border-gray-200">
            {withProportion.map(c => (
              <div
                key={c.id}
                className="flex items-start justify-start px-3 pt-2 text-[11px] font-semibold"
                style={{
                  backgroundColor: c.hex,
                  width: `${(c.proportion_pct! / totalProportion) * 100}%`,
                  color: contrastText(c.hex),
                }}
                title={`${c.name ?? c.hex} — ${c.proportion_pct}%`}
              >
                {c.proportion_pct}%
              </div>
            ))}
          </div>
        </div>
      )}

      {combinations.length > 0 && (
        <div className="mt-12">
          <h3 className="text-base font-bold mb-2" style={{ fontFamily: theme.headingFont, color: theme.text }}>Combinations</h3>
          <p className="text-sm text-gray-600 mb-4 max-w-2xl">
            Not every color pair is suitable. These are approved foreground/background combinations.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {combinations.map(combo => {
              const bg = combo.bg_color_id ? colorsById.get(combo.bg_color_id) : null
              const fg = combo.fg_color_id ? colorsById.get(combo.fg_color_id) : null
              if (!bg || !fg) return null
              return (
                <div
                  key={combo.id}
                  className="aspect-video rounded-xl border border-gray-200 flex items-center justify-center"
                  style={{ backgroundColor: bg.hex }}
                >
                  <div
                    className="h-1/2 w-1/2 rounded-md"
                    style={{ backgroundColor: fg.hex }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {aseSwatchUrl && (
        <div className="mt-12">
          <h3 className="text-base font-bold mb-2" style={{ fontFamily: theme.headingFont, color: theme.text }}>Swatch file</h3>
          <p className="text-sm text-gray-600 mb-3 max-w-2xl">
            Designers can load the full palette into Photoshop, Illustrator, or InDesign in one click.
          </p>
          <a
            href={aseSwatchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-900 px-4 py-2 hover:border-gray-400 transition-colors"
          >
            <Download size={13} /> Download .ase swatch
          </a>
        </div>
      )}
    </section>
  )
}

function ColorSwatch({ color, theme, onCopy }: {
  color: StrategyBrandColor
  theme: PortalTheme
  onCopy: (msg: string) => void
}) {
  const copy = (value: string, label: string) => {
    navigator.clipboard.writeText(value).then(() => onCopy(`${label} copied`))
  }
  const rgbStr = hexToRgbStr(color.hex, color.rgb)
  const cmykStr = hexToCmykStr(color.hex, color.cmyk)
  const lightness = lightnessLabel(color.hex)

  return (
    <div className="flex items-start gap-4 group">
      <button
        type="button"
        onClick={() => copy(color.hex, color.hex.toUpperCase())}
        title="Click to copy hex"
        className="h-16 w-16 rounded-full border border-gray-200 shrink-0 transition-transform group-hover:scale-105"
        style={{ backgroundColor: color.hex }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{color.name ?? color.hex.toUpperCase()}</p>
          <span
            className="text-[9px] font-bold uppercase tracking-widest rounded-full px-1.5 py-0.5"
            style={{
              backgroundColor: lightness === 'Dark' ? '#111' : '#e5e7eb',
              color: lightness === 'Dark' ? '#fff' : '#374151',
            }}
          >
            {lightness}
          </span>
        </div>
        <p className="text-[11px] text-gray-500 font-mono mt-0.5">
          <button type="button" onClick={() => copy(color.hex, 'HEX')} className="hover:text-gray-800">
            HEX {color.hex.toUpperCase()}
          </button>
        </p>
        {rgbStr && (
          <p className="text-[11px] text-gray-500 font-mono">
            <button type="button" onClick={() => copy(rgbStr, 'RGB')} className="hover:text-gray-800">
              RGB {rgbStr}
            </button>
          </p>
        )}
        {cmykStr && (
          <p className="text-[11px] text-gray-500 font-mono">
            <button type="button" onClick={() => copy(cmykStr, 'CMYK')} className="hover:text-gray-800">
              CMYK {cmykStr}
            </button>
          </p>
        )}
        {color.pms && (
          <p className="text-[11px] text-gray-500 font-mono">
            <button type="button" onClick={() => copy(color.pms!, 'PMS')} className="hover:text-gray-800">
              PMS {color.pms}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

// ── TYPOGRAPHY SECTION ─────────────────────────────────────────────────────

const TYPE_TIER_LABEL: Record<string, string> = {
  primary: 'Heading',
  secondary: 'Body',
  accent: 'Accent',
}

function TypographySection({ typography, theme }: { typography: StrategyBrandTypography[]; theme: PortalTheme }) {
  if (typography.length === 0) {
    return (
      <section id="typography" className="scroll-mt-24">
        <SectionHeader icon={TypeIcon} label="Typography" description="Our type families and how we use them." theme={theme} />
        <EmptyHint>No typography defined yet.</EmptyHint>
      </section>
    )
  }

  // Show specimens only when *every* font in the list is displayable. Mixing
  // "here's what Space Mono looks like" next to "preview unavailable" reads
  // inconsistent, so if any family is missing its webfont we drop all samples
  // and show a compact metadata list for the whole section instead.
  const resolved = typography.map(font => ({ font, ...resolveFontStack(font) }))
  const allDisplayable = resolved.every(r => r.displayable)

  return (
    <section id="typography" className="scroll-mt-24">
      <SectionHeader icon={TypeIcon} label="Typography" description="Our type families and how we use them." theme={theme} />

      {allDisplayable ? (
        <div className="space-y-12">
          {resolved.map(({ font, stack }) => (
            <div key={font.id} className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-6 border-b border-gray-200 pb-10 last:border-b-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                  {TYPE_TIER_LABEL[font.tier] ?? font.tier}
                </p>
                <p className="text-xl font-bold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{font.family_name}</p>
                {font.weight_label && <p className="text-xs text-gray-600 mt-0.5">Weight: {font.weight_label}</p>}
                {font.weight && <p className="text-xs text-gray-500 mt-0.5">Technical: {font.weight}</p>}
                {font.letter_case && <p className="text-xs text-gray-600 mt-0.5">Set in: {font.letter_case}</p>}
                {font.suggested_use && <p className="text-xs text-gray-600 mt-0.5">Use: {font.suggested_use}</p>}
                <div className="mt-2 flex flex-col gap-1 text-[11px]">
                  {font.font_url && (
                    <a href={font.font_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: theme.accent }}>
                      Open-source source <ExternalLink size={10} />
                    </a>
                  )}
                  {font.custom_font_purchase_url && (
                    <a href={font.custom_font_purchase_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                      style={{ color: theme.accent }}>
                      Purchase license <ExternalLink size={10} />
                    </a>
                  )}
                  {font.free_alt_family && (
                    <span className="text-gray-600">
                      Free alt: <span className="font-semibold">{font.free_alt_family}</span>
                      {font.free_alt_font_url && (
                        <>
                          {' · '}
                          <a href={font.free_alt_font_url} target="_blank" rel="noopener noreferrer"
                            className="hover:underline"
                            style={{ color: theme.accent }}>
                            download
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-7xl md:text-8xl leading-none" style={{ fontFamily: stack, color: theme.text }}>Aa</p>
                <p className="mt-4 text-sm text-gray-600 tracking-wide" style={{ fontFamily: stack }}>
                  ABCDEFGHIJKLMNOPQRSTUVWXYZ
                </p>
                <p className="text-sm text-gray-600 tracking-wide" style={{ fontFamily: stack }}>
                  abcdefghijklmnopqrstuvwxyz 1234567890
                </p>
                <p className="mt-3 text-base leading-relaxed" style={{ fontFamily: stack, color: theme.text }}>
                  The quick brown fox jumps over the lazy dog.
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {resolved.map(({ font }) => (
            <div key={font.id} className="flex items-baseline gap-4 flex-wrap border-b border-gray-200 pb-4 last:border-b-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 w-20 shrink-0">
                {TYPE_TIER_LABEL[font.tier] ?? font.tier}
              </p>
              <p className="text-xl font-bold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{font.family_name}</p>
              {font.weight_label && <p className="text-xs text-gray-500">Weight: {font.weight_label}</p>}
              {font.letter_case && <p className="text-xs text-gray-500">Set in: {font.letter_case}</p>}
              {font.suggested_use && <p className="text-xs text-gray-500">Use: {font.suggested_use}</p>}
              {font.free_alt_family && (
                <p className="text-xs text-gray-500">
                  Free alt: <span className="font-semibold">{font.free_alt_family}</span>
                </p>
              )}
              <span className="ml-auto flex items-center gap-3">
                {font.font_url && (
                  <a href={font.font_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] hover:underline"
                    style={{ color: theme.accent }}>
                    Source <ExternalLink size={10} />
                  </a>
                )}
                {font.custom_font_purchase_url && (
                  <a href={font.custom_font_purchase_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] hover:underline"
                    style={{ color: theme.accent }}>
                    Purchase <ExternalLink size={10} />
                  </a>
                )}
                {font.free_alt_font_url && (
                  <a href={font.free_alt_font_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] hover:underline"
                    style={{ color: theme.accent }}>
                    Free alt <ExternalLink size={10} />
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── ELEMENTS SECTION ───────────────────────────────────────────────────────

const ELEMENT_LABEL: Record<string, string> = {
  pattern: 'Pattern',
  texture: 'Texture',
  application: 'Application',
}

function ElementsSection({ elements, theme }: { elements: StrategyBrandElement[]; theme: PortalTheme }) {
  if (elements.length === 0) return null

  return (
    <section id="elements" className="scroll-mt-24">
      <SectionHeader icon={Sparkles} label="Elements & Application" description="The patterns, textures, and supporting graphics that make our church's visuals feel like ours." theme={theme} />

      <div className="columns-1 sm:columns-2 md:columns-3 gap-4 [&>*]:mb-4">
        {elements.map(el => (
          <div key={el.id} className="break-inside-avoid rounded-xl border border-gray-200 bg-white overflow-hidden">
            {el.preview_url && (
              <img src={el.preview_url} alt={el.label ?? 'Element'} className="w-full h-auto object-cover" />
            )}
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{ELEMENT_LABEL[el.kind] ?? el.kind}</p>
              <p className="text-sm font-semibold mt-0.5" style={{ fontFamily: theme.headingFont, color: theme.text }}>{el.label ?? '—'}</p>
              {el.download_url && (
                <a href={el.download_url} target="_blank" rel="noopener noreferrer"
                   className="mt-2 inline-flex items-center gap-1 text-[11px] hover:underline"
                   style={{ color: theme.accent }}>
                  Download <ArrowRight size={10} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── VOICE SECTION ──────────────────────────────────────────────────────────

function VoiceSection({ overview, toneCharacteristics, voiceGuidelines, theme }: {
  overview: string | null
  toneCharacteristics: BrandGuidePortalPayload['voice_attributes']
  voiceGuidelines: BrandGuidePortalPayload['voice_guidelines']
  theme: PortalTheme
}) {
  const hasContent = overview || toneCharacteristics.length > 0 || voiceGuidelines.length > 0
  if (!hasContent) {
    return (
      <section id="voice" className="scroll-mt-24">
        <SectionHeader icon={MessageCircle} label="Voice" description="How our church sounds across every touchpoint." theme={theme} />
        <EmptyHint>No voice content yet.</EmptyHint>
      </section>
    )
  }

  return (
    <section id="voice" className="scroll-mt-24">
      <SectionHeader icon={MessageCircle} label="Voice" description="How our church sounds across every touchpoint." theme={theme} />

      {overview && (
        <p className="text-lg leading-relaxed max-w-2xl mb-10 font-medium" style={{ color: theme.text }}>
          {overview}
        </p>
      )}

      {toneCharacteristics.length > 0 && (
        <div className="mb-12">
          <h3 className="text-base font-bold mb-4" style={{ fontFamily: theme.headingFont, color: theme.text }}>Tone Characteristics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {toneCharacteristics.map(v => (
              <div key={v.id}>
                <h4 className="text-2xl font-bold mb-2" style={{ fontFamily: theme.headingFont, color: theme.secondary }}>{v.title}</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {voiceGuidelines.length > 0 && (
        <div>
          <h3 className="text-base font-bold mb-4" style={{ fontFamily: theme.headingFont, color: theme.text }}>Voice Guidelines</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {voiceGuidelines.map(v => (
              <div key={v.id}>
                <h4 className="text-2xl font-bold mb-2" style={{ fontFamily: theme.headingFont, color: theme.secondary }}>{v.title}</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ── ATTRIBUTES SECTION ─────────────────────────────────────────────────────

function AttributesSection({ attributes, theme }: {
  attributes: BrandGuidePortalPayload['attributes']
  theme: PortalTheme
}) {
  if (attributes.length === 0) {
    return (
      <section id="attributes" className="scroll-mt-24">
        <SectionHeader icon={Layers} label="Attributes" description="Defining words for our church." theme={theme} />
        <EmptyHint>No attributes yet.</EmptyHint>
      </section>
    )
  }

  return (
    <section id="attributes" className="scroll-mt-24">
      <SectionHeader icon={Layers} label="Attributes" description="Defining words for our church." theme={theme} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {attributes.map(a => (
          <div key={a.id}>
            <p className="text-lg font-bold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{a.label}</p>
            {a.description && <p className="text-sm text-gray-600 leading-relaxed mt-1">{a.description}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── POSITIONING SECTION ────────────────────────────────────────────────────

function PositioningSection({ statement, theme }: {
  statement: string | null
  theme: PortalTheme
}) {
  if (!statement) {
    return (
      <section id="positioning" className="scroll-mt-24">
        <SectionHeader icon={MessageCircle} label="Positioning" description="What our church stands for, in its own words." theme={theme} />
        <EmptyHint>No positioning statement yet.</EmptyHint>
      </section>
    )
  }

  return (
    <section id="positioning" className="scroll-mt-24">
      <SectionHeader icon={MessageCircle} label="Positioning" description="What our church stands for, in its own words." theme={theme} />
      <blockquote
        className="text-2xl md:text-3xl leading-snug max-w-3xl italic border-l-4 pl-6"
        style={{ fontFamily: theme.headingFont, color: theme.text, borderColor: theme.accent }}
      >
        "{statement}"
      </blockquote>
    </section>
  )
}

// ── MINISTRIES SECTION ─────────────────────────────────────────────────────

function MinistriesSection({ subbrands, theme }: {
  subbrands: BrandGuidePortalPayload['subbrands']
  theme: PortalTheme
}) {
  if (subbrands.length === 0) return null
  return (
    <section id="ministries" className="scroll-mt-24">
      <SectionHeader icon={Layers} label="Ministries" description="Brand guidelines for our individual ministries." theme={theme} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {subbrands.map(sb => (
          <a
            key={sb.slug}
            href={buildPortalPath(sb.slug)}
            className="group rounded-xl border border-gray-200 bg-white p-5 transition-colors flex items-center justify-between"
            style={{ borderColor: '#e5e7eb' }}
          >
            <span className="text-base font-semibold" style={{ fontFamily: theme.headingFont, color: theme.text }}>{sb.display_name}</span>
            <ArrowRight size={14} style={{ color: theme.accent }} />
          </a>
        ))}
      </div>
    </section>
  )
}

// ── BRAND FAMILY SECTION (subbrand bottom cross-links) ─────────────────────

function BrandFamilySection({ parent, siblings, theme }: {
  parent: BrandGuidePortalPayload['parent']
  siblings: BrandGuidePortalPayload['siblings']
  theme: PortalTheme
}) {
  if (!parent) return null
  return (
    <section className="scroll-mt-24">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Part of the family</p>

        <a
          href={buildPortalPath(parent.slug)}
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-4 mb-3 hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-0.5">Main church brand</p>
            <p className="text-lg font-semibold truncate" style={{ fontFamily: theme.headingFont, color: theme.text }}>{parent.display_name}</p>
          </div>
          <ArrowRight size={16} style={{ color: theme.accent }} />
        </a>

        {siblings.length > 0 && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-4 mb-2">Other ministries</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {siblings.map(s => (
                <a
                  key={s.slug}
                  href={buildPortalPath(s.slug)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm font-semibold truncate" style={{ fontFamily: theme.headingFont, color: theme.text }}>{s.display_name}</span>
                  <ArrowRight size={13} style={{ color: theme.accent }} />
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
