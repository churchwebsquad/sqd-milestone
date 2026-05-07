import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, Copy, Download, ExternalLink, FileText, Image as ImageIcon,
  MessageCircle, Palette, Share2, Sparkles, Type as TypeIcon, Users,
} from 'lucide-react'
import { loadHandoff, buildHandoffMarkdown, buildDesignTokens, HANDOFF_LIST_NAMES } from '../lib/brandHandoff'
import { loadBrandGuidesForMember, type MemberBrandGuides, type BrandGuideEntry } from '../lib/brandGuides'
import { isGoogleFont, buildGoogleFontsUrls } from '../lib/googleFonts'
import type {
  BrandHandoffPayload, HandoffTaskCard,
  StrategyBrandColor, StrategyBrandElement,
} from '../types/database'

// ── Color helper ────────────────────────────────────────────────────────────

/** Pick ink color that reads best on a given background. Mirrors the helper
 *  used in the PDF renderer. */
function contrastInk(hex: string): string {
  const h = hex.replace('#', '').trim()
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (s.length !== 6) return '#111'
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#111'
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111' : '#fff'
}

type TabId = 'overview' | 'graphics' | 'social' | 'web'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'graphics', label: 'Graphics & Video' },
  { id: 'social',   label: 'Social Media' },
  { id: 'web',      label: 'Web' },
]

// Which list_name values feed each tab's past-work feed.
const GRAPHICS_LISTS = ['Graphics & Video', 'Video - SRP Tasks', 'Branding 🔒']
const SOCIAL_LISTS = ['Social Media']

export default function BrandHandoffPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') as TabId) ?? 'overview'

  const [payload, setPayload] = useState<BrandHandoffPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await loadHandoff(token)
        if (cancelled) return
        if (!data) { setNotFound(true); return }
        setPayload(data)
      } catch (err) {
        if (!cancelled) setError((err as { message?: string })?.message ?? 'Failed to load handoff')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token])

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-6xl mx-auto">
        <div className="h-8 w-48 bg-lavender-tint rounded-lg animate-pulse mb-4" />
        <div className="h-40 bg-lavender-tint rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <BackLink />
        <div className="bg-white border border-lavender rounded-2xl p-8 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-deep-plum mb-2">Church not found</h1>
          <p className="text-sm text-purple-gray">
            This handoff link isn't pointing at any church in our records. Head back and pick one from the list.
          </p>
        </div>
      </div>
    )
  }

  if (error || !payload) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <BackLink />
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? 'Could not load handoff.'}
        </div>
      </div>
    )
  }

  // No SQD brand guide on this church → strip the page down to the
  // overview tab + brand-guide library card. Logos / Colors /
  // Typography have nothing to render, and the Graphics / Social /
  // Web tabs all draw on guide-derived content (style tags, colors,
  // tokens, components) that doesn't exist yet.
  const hasSqdGuide = !!payload.guide
  const visibleTabs = hasSqdGuide ? TABS : TABS.filter(t => t.id === 'overview')
  const activeTab: TabId = hasSqdGuide ? tab : 'overview'

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">
        <BackLink />
        <PageHeader payload={payload} onNavigateChurch={() => navigate(`/churches/${payload.church.member}`)} />

        {visibleTabs.length > 1 && (
          <nav className="flex gap-1 flex-wrap mb-5">
            {visibleTabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`text-xs font-semibold rounded-full px-4 py-1.5 transition-colors ${
                  activeTab === t.id
                    ? 'bg-deep-plum text-white'
                    : 'bg-white border border-lavender text-deep-plum hover:border-primary-purple hover:text-primary-purple'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}

        {activeTab === 'overview' && <OverviewTab payload={payload} />}
        {hasSqdGuide && activeTab === 'graphics' && <GraphicsTab payload={payload} />}
        {hasSqdGuide && activeTab === 'social'   && <SocialTab payload={payload} />}
        {hasSqdGuide && activeTab === 'web'      && <WebTab payload={payload} />}
      </div>
    </div>
  )
}

function BackLink() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/branding')}
      className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
    >
      <ArrowLeft size={14} /> Back to Brand Handoffs
    </button>
  )
}

// ── Header strip ────────────────────────────────────────────────────────────

function PageHeader({ payload, onNavigateChurch }: {
  payload: BrandHandoffPayload
  onNavigateChurch: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const copyLink = () => {
    const url = `${window.location.origin}/branding/${payload.church.portal_token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const downloadMd = () => {
    const md = buildHandoffMarkdown(payload)
    const slug = (payload.church.church_name ?? `member-${payload.church.member}`)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-handoff.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 1800)
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl p-5 shadow-sm mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Handoff doc</p>
          <h1 className="text-xl md:text-2xl font-semibold text-deep-plum truncate">
            {payload.church.church_name ?? `Member #${payload.church.member}`}
          </h1>
          <p className="text-xs text-purple-gray mt-0.5">
            Member #{payload.church.member}
            {payload.guide?.last_updated_at && (
              <> · Brand guide updated {new Date(payload.guide.last_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={onNavigateChurch}
            className="inline-flex items-center gap-1 text-xs font-semibold rounded-full border border-lavender bg-white text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
          >
            <Users size={11} /> Church detail
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-1 text-xs font-semibold rounded-full border border-lavender bg-white text-deep-plum px-3 py-1.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
          >
            {copied ? <Check size={11} className="text-green-600" /> : <Share2 size={11} />}
            {copied ? 'Copied' : 'Copy handoff link'}
          </button>
          {/* The AI handoff markdown is built from the SQD guide's
              voice / colors / tokens — pointless when no guide
              exists. Hidden in that case so staff don't download an
              empty .md. */}
          {payload.guide && (
            <button
              type="button"
              onClick={downloadMd}
              className="inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-deep-plum text-white px-3 py-1.5 hover:bg-primary-purple transition-colors"
            >
              {downloaded ? <Check size={11} /> : <Download size={11} />}
              {downloaded ? 'Downloaded' : 'Download for AI'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared primitives ──────────────────────────────────────────────────────

function Card({ title, icon: Icon, children, actions }: {
  title: string
  icon?: typeof Palette
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon size={14} className="text-primary-purple shrink-0" />}
          <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wide">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1 text-[11px] text-purple-gray hover:text-primary-purple transition-colors"
    >
      {copied ? <Check size={10} className="text-green-600" /> : <Copy size={10} />}
      {copied ? 'Copied' : (label ?? 'Copy')}
    </button>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-purple-gray/70 italic">{children}</p>
  )
}

// ── Brand-guide library ─────────────────────────────────────────────────────
//
// Lists every published brand guide for the church — the SQD parent,
// any SQD subbrands, and any Standards-hosted brands the church
// hasn't migrated yet. Subbrands often live on Standards while the
// parent is in the new SQD system, so this card guarantees staff can
// reach them all from one spot regardless of where each one lives.

function BrandGuideLibraryCard({ guides }: { guides: MemberBrandGuides }) {
  const sqdEntries = guides.entries.filter(e => e.kind !== 'standards')
  const standardsEntries = guides.entries.filter(e => e.kind === 'standards')
  return (
    <Card title="Brand guide library" icon={BookOpen}>
      {sqdEntries.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple mb-1.5">
            New SQD brand guides
          </p>
          <div className="flex flex-col gap-1.5">
            {sqdEntries.map((e, i) => <BrandGuideRow key={`sqd-${i}`} entry={e} />)}
          </div>
        </div>
      )}
      {standardsEntries.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1.5">
            Live on Standards
          </p>
          <div className="flex flex-col gap-1.5">
            {standardsEntries.map((e, i) => <BrandGuideRow key={`std-${i}`} entry={e} />)}
          </div>
        </div>
      )}
    </Card>
  )
}

function BrandGuideRow({ entry }: { entry: BrandGuideEntry }) {
  const isSub = entry.kind === 'sqd-sub'
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
        entry.legacy
          ? 'border-amber-200 bg-amber-50/40 text-amber-900 hover:border-amber-300'
          : 'border-lavender bg-white text-deep-plum hover:border-primary-purple hover:text-primary-purple hover:bg-lavender-tint/30'
      }`}
    >
      {isSub && <span aria-hidden className="text-purple-gray/40">↳</span>}
      <BookOpen size={12} className={`shrink-0 ${entry.legacy ? 'text-amber-700' : 'text-primary-purple'}`} />
      <span className="flex-1 min-w-0 truncate font-semibold">{entry.label}</span>
      <ExternalLink size={11} className={entry.legacy ? 'text-amber-700/70 shrink-0' : 'text-purple-gray/60 shrink-0'} />
    </a>
  )
}

// ── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ payload }: { payload: BrandHandoffPayload }) {
  const { guide, logos, colors, typography } = payload

  // Independent fetch — keeps the handoff payload shape unchanged and
  // lets the library render even on Standards-only churches who don't
  // have a SQD guide yet.
  const [allGuides, setAllGuides] = useState<MemberBrandGuides | null>(null)
  useEffect(() => {
    let cancelled = false
    loadBrandGuidesForMember(payload.church.member)
      .then(g => { if (!cancelled) setAllGuides(g) })
      .catch(() => { if (!cancelled) setAllGuides(null) })
    return () => { cancelled = true }
  }, [payload.church.member])

  return (
    <>
      {allGuides && allGuides.entries.length > 0 && (
        <BrandGuideLibraryCard guides={allGuides} />
      )}

      {guide?.handoff_notes && (
        <Card title="Designer notes" icon={Sparkles}>
          <p className="text-sm text-deep-plum whitespace-pre-wrap leading-relaxed">
            {guide.handoff_notes}
          </p>
        </Card>
      )}

      {guide?.style_tags && guide.style_tags.length > 0 && (
        <Card title="Style tags" icon={Sparkles}>
          <div className="flex flex-wrap gap-1.5">
            {guide.style_tags.map(tag => (
              <span key={tag} className="inline-flex items-center rounded-full bg-primary-purple/10 text-primary-purple text-xs font-semibold px-2.5 py-1">
                {tag}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Everything below renders only when a SQD brand guide exists.
          Without one, logos/colors/typography/elements have nothing
          authoritative to draw from — the partner is still on
          Standards (or has nothing published), so we skip straight
          past these sections. */}
      {guide && <>
      <Card title="Logos" icon={ImageIcon}>
        {logos.length === 0 ? (
          <EmptyHint>No logos uploaded yet.</EmptyHint>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {logos.map(logo => {
              const src = logo.preview_url
              const dl = logo.download_url ?? logo.preview_url
              const animUrl = logo.animation_url ?? null
              return (
                <div
                  key={logo.id}
                  className="group rounded-lg border border-lavender bg-white p-3 flex flex-col hover:border-primary-purple transition-colors relative"
                >
                  {animUrl && (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-primary-purple/10 text-primary-purple text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 z-10">
                      ▶ Motion
                    </span>
                  )}
                  <a
                    href={dl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <div className="h-20 flex items-center justify-center rounded bg-lavender-tint/30 mb-2 overflow-hidden">
                      {src && !src.endsWith('.mp4') && (
                        <img src={src} alt={logo.label ?? logo.kind} className="max-h-full max-w-full object-contain" />
                      )}
                    </div>
                    <p className="text-[11px] font-semibold text-deep-plum truncate">{logo.label ?? logo.kind}</p>
                    <p className="text-[10px] text-purple-gray/60 mt-0.5 inline-flex items-center gap-1">
                      <Download size={9} /> Still
                    </p>
                  </a>
                  {animUrl && (
                    <a
                      href={animUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary-purple mt-0.5 inline-flex items-center gap-1 hover:underline"
                    >
                      <Download size={9} /> Animation
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {guide?.assets_zip_url && (
          <a
            href={guide.assets_zip_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-deep-plum text-white px-3 py-1.5 hover:bg-primary-purple transition-colors"
          >
            <Download size={11} /> Full asset package (.zip)
          </a>
        )}
      </Card>

      <Card title="Colors" icon={Palette}>
        {colors.length === 0 ? (
          <EmptyHint>No colors set yet.</EmptyHint>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {colors.map(c => (
              <div key={c.id} className="rounded-lg border border-lavender p-3">
                <div className="h-12 rounded mb-2 border border-lavender/60" style={{ backgroundColor: c.hex }} />
                <p className="text-xs font-semibold text-deep-plum truncate">{c.name ?? c.hex.toUpperCase()}</p>
                <p className="text-[10px] text-purple-gray/60 uppercase tracking-wider">{c.tier}</p>
                <div className="mt-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-purple-gray">{c.hex.toUpperCase()}</span>
                    <CopyButton value={c.hex.toUpperCase()} label="hex" />
                  </div>
                  {c.rgb && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-purple-gray truncate">{c.rgb}</span>
                      <CopyButton value={c.rgb} label="rgb" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {guide?.ase_swatch_url && (
          <a
            href={guide.ase_swatch_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-deep-plum text-white px-3 py-1.5 hover:bg-primary-purple transition-colors"
          >
            <Download size={11} /> Download .ase swatch
          </a>
        )}
      </Card>

      <ColorHierarchyCard colors={colors} />

      <OnColorLogosCard colors={colors} />

      <Card title="Typography" icon={TypeIcon}>
        {typography.length === 0 ? (
          <EmptyHint>No fonts set yet.</EmptyHint>
        ) : (
          <>
            <ul className="space-y-2">
              {typography.map(t => (
                <li key={t.id} className="flex items-start justify-between gap-3 flex-wrap border-b border-lavender/60 pb-2 last:border-b-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-deep-plum">{t.family_name}</p>
                    <p className="text-[11px] text-purple-gray">
                      {t.tier}
                      {t.weight_label && <> · {t.weight_label}</>}
                      {t.letter_case && <> · {t.letter_case}</>}
                      {t.suggested_use && <> · {t.suggested_use}</>}
                    </p>
                    {t.weight && (
                      <p className="text-[10px] text-purple-gray/60 mt-0.5">Weights: {t.weight}</p>
                    )}
                    {t.free_alt_family && (
                      <p className="text-[11px] text-purple-gray mt-0.5">
                        Free alt: <span className="font-semibold text-deep-plum">{t.free_alt_family}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {t.font_url && (
                      <a href={t.font_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary-purple hover:underline">
                        Source <ExternalLink size={9} />
                      </a>
                    )}
                    {t.custom_font_purchase_url && (
                      <a href={t.custom_font_purchase_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary-purple hover:underline">
                        Purchase <ExternalLink size={9} />
                      </a>
                    )}
                    {t.free_alt_font_url && (
                      <a href={t.free_alt_font_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary-purple hover:underline">
                        Free alt <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-lavender">
              <Link
                to="?tab=web"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary-purple hover:underline"
              >
                View full webfont setup <ArrowRight size={11} />
              </Link>
            </div>
          </>
        )}
      </Card>

      <ElementsCard elements={payload.elements} />
      </>}
    </>
  )
}

// ── Overview sub-cards ──────────────────────────────────────────────────────

/** Horizontal bar showing color proportions (only renders when 2+ colors
 *  have a proportion_pct set — matches the public portal's rule). */
function ColorHierarchyCard({ colors }: { colors: StrategyBrandColor[] }) {
  const withProp = colors.filter(c => typeof c.proportion_pct === 'number' && c.proportion_pct! > 0)
  if (withProp.length < 2) return null
  const total = withProp.reduce((n, c) => n + (c.proportion_pct ?? 0), 0)
  return (
    <Card title="Color hierarchy" icon={Palette}>
      <p className="text-xs text-purple-gray mb-3">
        How the palette is balanced across brand applications.
      </p>
      <div className="flex h-10 rounded-lg overflow-hidden border border-lavender">
        {withProp.map(c => (
          <div
            key={c.id}
            className="flex items-center justify-center text-[10px] font-bold"
            style={{
              width: `${(c.proportion_pct! / total) * 100}%`,
              backgroundColor: c.hex,
              color: contrastInk(c.hex),
            }}
          >
            {c.proportion_pct}%
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {withProp.map(c => (
          <div key={c.id} className="text-[11px] flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded border border-lavender/60" style={{ backgroundColor: c.hex }} />
            <span className="font-semibold text-deep-plum">{c.name ?? c.hex.toUpperCase()}</span>
            <span className="text-purple-gray">{c.proportion_pct}%</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Shows how the logo pairs with each brand color — any color row that has
 *  an `on_color_logo_url` gets a tile with the logo rendered on the color. */
function OnColorLogosCard({ colors }: { colors: StrategyBrandColor[] }) {
  const withLogos = colors.filter(c => c.on_color_logo_url)
  if (withLogos.length === 0) return null
  return (
    <Card title="Logo on color" icon={ImageIcon}>
      <p className="text-xs text-purple-gray mb-3">
        The correct logo treatment for each brand color.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {withLogos.map(c => (
          <a
            key={c.id}
            href={c.on_color_logo_url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-lavender overflow-hidden hover:border-primary-purple transition-colors"
            title="Open logo file"
          >
            <div
              className="h-28 flex items-center justify-center p-4"
              style={{ backgroundColor: c.hex }}
            >
              <img
                src={c.on_color_logo_url!}
                alt={`Logo on ${c.name ?? c.hex}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="px-3 py-1.5 bg-white flex items-center justify-between">
              <span className="text-[11px] font-semibold text-deep-plum truncate">
                {c.name ?? c.hex.toUpperCase()}
              </span>
              <span className="text-[10px] text-purple-gray/60 uppercase tracking-wider shrink-0 ml-2">{c.tier}</span>
            </div>
          </a>
        ))}
      </div>
    </Card>
  )
}

/** Patterns / textures / application examples from the brand guide. */
function ElementsCard({ elements }: { elements: StrategyBrandElement[] }) {
  if (elements.length === 0) return null
  const KIND_LABEL: Record<string, string> = {
    pattern: 'Pattern',
    texture: 'Texture',
    application: 'Application',
  }
  return (
    <Card title="Elements & application" icon={Sparkles}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {elements.map(el => (
          <div key={el.id} className="rounded-lg border border-lavender overflow-hidden bg-white">
            {el.preview_url && (
              <div className="h-32 bg-lavender-tint/30 flex items-center justify-center overflow-hidden">
                <img
                  src={el.preview_url}
                  alt={el.label ?? el.kind}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}
            <div className="px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple mb-0.5">
                {KIND_LABEL[el.kind] ?? el.kind}
              </p>
              {el.label && (
                <p className="text-xs font-semibold text-deep-plum truncate">{el.label}</p>
              )}
              {el.download_url && (
                <a
                  href={el.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-[11px] text-primary-purple hover:underline"
                >
                  <Download size={10} /> Download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Graphics & Video tab ────────────────────────────────────────────────────

function GraphicsTab({ payload }: { payload: BrandHandoffPayload }) {
  const graphicsTasks = useMemo(
    () => payload.pastWork.filter(t => t.list_name && GRAPHICS_LISTS.includes(t.list_name)),
    [payload.pastWork],
  )

  return (
    <Card title="Past approved work — Graphics & Video" icon={ImageIcon}>
      <p className="text-xs text-purple-gray mb-3">
        Pulled from tasks in Graphics & Video, Video - SRP Tasks, and Branding lists with a
        status of Closed, complete, approved, or final files delivered.
      </p>
      <PastWorkList tasks={graphicsTasks} />
    </Card>
  )
}

// ── Social Media tab ────────────────────────────────────────────────────────

function SocialTab({ payload }: { payload: BrandHandoffPayload }) {
  const socialTasks = useMemo(
    () => payload.pastWork.filter(t => t.list_name && SOCIAL_LISTS.includes(t.list_name)),
    [payload.pastWork],
  )

  const { guide, voice_attributes, voice_guidelines, intel } = payload

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Voice" icon={MessageCircle}>
          {guide?.voice_overview ? (
            <p className="text-sm text-deep-plum leading-relaxed whitespace-pre-wrap mb-3">{guide.voice_overview}</p>
          ) : (
            <EmptyHint>No voice overview yet.</EmptyHint>
          )}
          {guide?.brand_statement && (
            <blockquote className="text-sm italic text-deep-plum border-l-2 border-primary-purple pl-3 mb-3">
              "{guide.brand_statement}"
            </blockquote>
          )}
          {voice_attributes.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1.5">Tone characteristics</p>
              <ul className="space-y-1">
                {voice_attributes.map(v => (
                  <li key={v.id} className="text-xs text-deep-plum">
                    <span className="font-semibold">{v.title}</span> — <span className="text-purple-gray">{v.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {voice_guidelines.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1.5">Voice guidelines</p>
              <ul className="space-y-1">
                {voice_guidelines.map(v => (
                  <li key={v.id} className="text-xs text-deep-plum">
                    <span className="font-semibold">{v.title}</span> — <span className="text-purple-gray">{v.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Church intel digest" icon={Sparkles}>
          {intel?.profile ? (
            <IntelDigest profile={intel.profile} />
          ) : (
            <div className="text-xs text-purple-gray/80 leading-relaxed">
              No church intel profile generated yet. Head to{' '}
              <a href="/social/intel" className="text-primary-purple hover:underline font-semibold">
                Intel Audit Tool
              </a>
              {' '}to create one.
            </div>
          )}
        </Card>
      </div>

      <Card title="Past approved social tasks" icon={ImageIcon}>
        <PastWorkList tasks={socialTasks} />
      </Card>
    </>
  )
}

/** Surfaces the handful of intel keys most useful for briefing a social post. */
function IntelDigest({ profile }: { profile: Record<string, unknown> }) {
  const keys = [
    { key: 'audience',              label: 'Audience' },
    { key: 'design',                label: 'Design direction' },
    { key: 'brand_voice',           label: 'Brand voice' },
    { key: 'what_performs_well',    label: 'What performs well' },
    { key: 'caption_cta_patterns',  label: 'Caption / CTA patterns' },
    { key: 'tagline_or_mission',    label: 'Tagline / mission' },
    { key: 'upcoming_opportunities',label: 'Upcoming opportunities' },
  ]
  const present = keys.filter(k => profile[k.key] != null && profile[k.key] !== '')
  if (present.length === 0) {
    return <EmptyHint>Intel profile exists but has no content for the handoff keys yet.</EmptyHint>
  }
  return (
    <div className="space-y-3">
      {present.map(({ key, label }) => (
        <div key={key}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1">{label}</p>
          <IntelValue value={profile[key]} />
        </div>
      ))}
    </div>
  )
}

function IntelValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return <p className="text-xs text-deep-plum leading-relaxed whitespace-pre-wrap">{value}</p>
  }
  if (Array.isArray(value)) {
    return (
      <ul className="text-xs text-deep-plum space-y-0.5 list-disc pl-4">
        {value.map((item, i) => (
          <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    )
  }
  if (value && typeof value === 'object') {
    return (
      <pre className="text-[11px] text-deep-plum bg-lavender-tint/40 rounded px-2 py-1.5 overflow-x-auto leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }
  return <p className="text-xs text-deep-plum">{String(value)}</p>
}

// ── Web tab ─────────────────────────────────────────────────────────────────

function WebTab({ payload }: { payload: BrandHandoffPayload }) {
  const [exported, setExported] = useState(false)

  const exportJson = () => {
    const json = buildDesignTokens(payload)
    const slug = (payload.church.church_name ?? `member-${payload.church.member}`)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-tokens.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    setExported(true)
    setTimeout(() => setExported(false), 1800)
  }

  return (
    <>
      <Card title="Design tokens" icon={Palette} actions={
        <button
          type="button"
          onClick={exportJson}
          className="inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-deep-plum text-white px-3 py-1.5 hover:bg-primary-purple transition-colors"
        >
          {exported ? <Check size={11} /> : <FileText size={11} />}
          {exported ? 'Exported' : 'Export tokens (JSON)'}
        </button>
      }>
        <p className="text-xs text-purple-gray mb-3">
          Compact JSON dump of colors + typography shaped for Figma token import.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1.5">Colors</p>
            <ul className="text-xs text-deep-plum space-y-1">
              {payload.colors.map(c => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded border border-lavender" style={{ backgroundColor: c.hex }} />
                  <span className="font-mono">{c.hex.toUpperCase()}</span>
                  <span className="text-purple-gray/70">· {c.tier}</span>
                  {c.name && <span className="truncate">· {c.name}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1.5">Typography</p>
            <ul className="text-xs text-deep-plum space-y-1">
              {payload.typography.map(t => (
                <li key={t.id}>
                  <span className="font-semibold">{t.family_name}</span>
                  <span className="text-purple-gray/70"> · {t.tier}</span>
                  {t.weight && <span className="text-purple-gray/70"> · {t.weight}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card title="Webfont links" icon={TypeIcon}>
        <p className="text-xs text-purple-gray mb-3">
          Ready-to-paste Google Fonts CSS links for detected brand fonts. Non-Google or custom fonts need a licensed source.
        </p>
        <ul className="space-y-2">
          {payload.typography.length === 0 && <EmptyHint>No fonts set.</EmptyHint>}
          {payload.typography.map(t => {
            const urls = isGoogleFont(t.family_name) ? buildGoogleFontsUrls(t.family_name, t.weight) : []
            return (
              <li key={t.id} className="border border-lavender rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-deep-plum">{t.family_name}</p>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
                    urls.length > 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {urls.length > 0 ? 'Google Font' : 'Custom / licensed'}
                  </span>
                </div>
                {urls.length > 0 ? (
                  <div className="space-y-1">
                    {urls.map(url => (
                      <div key={url} className="flex items-center gap-2 font-mono text-[11px] text-purple-gray">
                        <code className="truncate flex-1 bg-lavender-tint/40 rounded px-1.5 py-0.5">{url}</code>
                        <CopyButton value={url} label="" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-purple-gray">
                    Not a Google Font — source the licensed webfont from the brand's designer or use the uploaded .woff2.
                    {t.font_url && (
                      <> <a href={t.font_url} target="_blank" rel="noopener noreferrer" className="text-primary-purple hover:underline">View uploaded file</a>.</>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      <Card title="Components" icon={Sparkles}>
        <EmptyHint>Components coming soon — web squad will define per-brand primitives here.</EmptyHint>
      </Card>
    </>
  )
}

// ── Past work list (shared by Graphics + Social tabs) ───────────────────────

const STATUS_PILL: Record<string, string> = {
  'Closed':                 'bg-green-100 text-green-700',
  'complete':               'bg-green-100 text-green-700',
  'final files delivered':  'bg-primary-purple/10 text-primary-purple',
  'approved':               'bg-primary-purple/10 text-primary-purple',
}

function PastWorkList({ tasks }: { tasks: HandoffTaskCard[] }) {
  if (tasks.length === 0) {
    return <EmptyHint>No approved tasks found in these lists yet.</EmptyHint>
  }
  return (
    <ul className="space-y-2">
      {tasks.map(task => (
        <li key={task.task_id} className="rounded-lg border border-lavender p-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-deep-plum leading-snug">{task.task_name}</p>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {task.list_name && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-gray">{task.list_name}</span>
              )}
              {task.current_status && (
                <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 ${STATUS_PILL[task.current_status] ?? 'bg-lavender/50 text-purple-gray'}`}>
                  {task.current_status}
                </span>
              )}
              {task.status_changed_at && (
                <span className="text-[10px] text-purple-gray">
                  {new Date(task.status_changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {task.assignee_names && task.assignee_names.length > 0 && (
                <span className="text-[10px] text-purple-gray">· {task.assignee_names.join(', ')}</span>
              )}
            </div>
            {task.tags && task.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {task.tags.map(tag => (
                  <span key={tag} className="text-[10px] text-purple-gray bg-lavender-tint/60 rounded-full px-2 py-0.5">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// Helper not used directly in the render, but kept for parity with
// brandHandoff.ts's HANDOFF_LIST_NAMES scoping.
void HANDOFF_LIST_NAMES
