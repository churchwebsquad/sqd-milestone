/**
 * Human-readable view of Stage 2 (sitemap) output.
 *
 * The Stage2Output type in pipelineTypes.ts is stale vs. what
 * draft-sitemap.ts actually emits, so we type against the real shape
 * here. Tolerant of missing keys — older runs may not have every field.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { NavPresentationPanel } from '../../NavPresentationPanel'

interface NavItem {
  kind?:      'page' | 'group'
  label?:     string
  slug?:      string | null
  url?:       string
  rationale?: string
  children?:  NavItem[]
}

interface FooterSection {
  section_label?: string
  items?:         Array<{ slug?: string; url?: string; label?: string }>
}

interface SitemapPage {
  name?:               string
  slug?:               string
  phase?:              string | number
  density?:            string
  nav_label?:          string
  page_type?:          string
  rationale?:          string
  parent_slug?:        string | null
  content_sources?:    string[]
  strategic_purpose?:  string
}

interface VocabDecision {
  we_chose?:    string
  instead_of?:  string
  why?:         string
}

interface PhaseSummary {
  total?:           number
  phase_1_count?:   number
  phase_2_count?:   number
  rationale?:       string
}

interface VisibleTopLevel {
  kind?:        'page' | 'group' | 'button' | 'hamburger'
  label?:       string
  slug?:        string
  group_label?: string
}

interface StandardDropdownGroup {
  group_label?: string
  children?:    Array<{ label?: string; slug?: string; one_line_description?: string }>
}

interface MegamenuColumn {
  heading?:     string
  description?: string
  links?:       Array<{ label?: string; slug?: string; one_line_description?: string }>
}

interface MegamenuPanel {
  triggered_by?:  string
  columns?:       MegamenuColumn[]
  featured_tile?: {
    kind?:       'image_cta' | 'sermon_card' | 'event_card' | 'persona_callout'
    heading?:    string
    body?:       string
    link_label?: string
    link_slug?:  string
  }
}

interface OffcanvasSection {
  section_label?: string
  links?:         Array<{ label?: string; slug?: string }>
}

interface NavPresentation {
  shell?:                  'standard_dropdowns' | 'megamenu' | 'offcanvas'
  presentation_rationale?: string
  visible_top_level?:      VisibleTopLevel[]
  standard_dropdowns?:     { groups?: StandardDropdownGroup[] }
  megamenu_panels?:        MegamenuPanel[]
  offcanvas_overlay?: {
    hero_message?: string
    sections?:     OffcanvasSection[]
    surfaced_facts?: {
      service_times?: string
      address?:       string
      socials?:       Array<{ platform?: string; url?: string }>
      search?:        boolean
    }
  }
}

interface SitemapData {
  pages?:                SitemapPage[]
  header_nav?:           NavItem[]
  footer_nav?:           FooterSection[]
  vocabulary_decisions?: VocabDecision[] | Record<string, string>
  phase_summary?:        PhaseSummary
  nav_strategy?:         string
  nav_voice_register?:   string
  nav_presentation?:     NavPresentation
  aeo_keywords?:         string[]
  cs_flags?:             string[]
  sources_used?:         string[]
  absorbed_content?:     unknown
  content_coverage_audit?: { covered?: string[]; gaps?: string[] }
}

export function SitemapPreview({ output }: { output: Record<string, unknown> }) {
  const data = output as SitemapData
  const pages   = data.pages ?? []
  const header  = data.header_nav ?? []
  const footer  = data.footer_nav ?? []

  // Normalize vocabulary_decisions — actual shape is array; legacy type
  // says Record. Coerce to array of {we_chose, instead_of, why}.
  const vocab = useMemo<VocabDecision[]>(() => {
    const v = data.vocabulary_decisions
    if (!v) return []
    if (Array.isArray(v)) return v
    return Object.entries(v).map(([instead_of, we_chose]) => ({ we_chose, instead_of }))
  }, [data.vocabulary_decisions])

  // Group pages by phase for the page list section.
  const pagesByPhase = useMemo(() => {
    const groups = new Map<string, SitemapPage[]>()
    for (const p of pages) {
      const k = String(p.phase ?? '—')
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(p)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [pages])

  return (
    <div className="space-y-6">
      {/* Phase summary */}
      {data.phase_summary && (
        <Section label="Phase breakdown">
          <div className="flex gap-4 flex-wrap">
            <Stat n={data.phase_summary.total ?? pages.length} label="Total pages" />
            {data.phase_summary.phase_1_count != null && (
              <Stat n={data.phase_summary.phase_1_count} label="Phase 1" tone="accent" />
            )}
            {data.phase_summary.phase_2_count != null && (
              <Stat n={data.phase_summary.phase_2_count} label="Phase 2" tone="muted" />
            )}
          </div>
          {data.phase_summary.rationale && (
            <p className="mt-3 text-[12px] text-wm-text-muted leading-relaxed">
              {data.phase_summary.rationale}
            </p>
          )}
        </Section>
      )}

      {/* Header nav */}
      {header.length > 0 && (
        <Section label="Header navigation">
          <NavTree items={header} />
        </Section>
      )}

      {/* Nav presentation — shell + per-shell layout */}
      {data.nav_presentation && (
        <NavPresentationPanel presentation={data.nav_presentation} />
      )}

      {/* Footer nav */}
      {footer.length > 0 && (
        <Section label="Footer navigation">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {footer.map((col, i) => (
              <div key={i}>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1.5">
                  {col.section_label ?? '—'}
                </p>
                <ul className="space-y-1">
                  {(col.items ?? []).map((it, j) => (
                    <li key={j} className="text-[12px] text-wm-text leading-snug">
                      {it.label}
                      <span className="ml-1.5 text-[10px] font-mono text-wm-text-subtle">
                        {it.slug ? `/${it.slug}` : it.url ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Pages */}
      {pages.length > 0 && (
        <Section label={`Pages (${pages.length})`}>
          <div className="space-y-4">
            {pagesByPhase.map(([phase, ps]) => (
              <div key={phase}>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">
                  Phase {phase} · {ps.length} {ps.length === 1 ? 'page' : 'pages'}
                </p>
                <div className="space-y-2">
                  {ps.map(p => <PageRow key={p.slug ?? p.name} page={p} />)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Vocabulary decisions */}
      {vocab.length > 0 && (
        <Section label="Vocabulary decisions">
          <ul className="space-y-3">
            {vocab.map((v, i) => (
              <li key={i} className="text-[12px] leading-relaxed">
                <p className="text-wm-text">
                  <span className="font-semibold">&ldquo;{v.we_chose}&rdquo;</span>
                  {v.instead_of && (
                    <span className="text-wm-text-muted"> instead of <span className="line-through">&ldquo;{v.instead_of}&rdquo;</span></span>
                  )}
                </p>
                {v.why && <p className="text-wm-text-muted mt-0.5">↳ {v.why}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Content coverage */}
      {data.content_coverage_audit && (
        <Section label="Content coverage audit">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-success mb-1.5">
                Covered ({data.content_coverage_audit.covered?.length ?? 0})
              </p>
              <ul className="space-y-0.5">
                {(data.content_coverage_audit.covered ?? []).map((c, i) => (
                  <li key={i} className="text-[12px] text-wm-text">· {c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1.5">
                Gaps ({data.content_coverage_audit.gaps?.length ?? 0})
              </p>
              <ul className="space-y-0.5">
                {(data.content_coverage_audit.gaps ?? []).map((g, i) => (
                  <li key={i} className="text-[12px] text-wm-text">· {g}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* Strategic context */}
      {(data.nav_strategy || data.nav_voice_register) && (
        <Section label="Strategic context">
          {data.nav_strategy && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Nav strategy</p>
              <p className="text-[12px] text-wm-text-muted leading-relaxed">{data.nav_strategy}</p>
            </div>
          )}
          {data.nav_voice_register && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Nav voice register</p>
              <p className="text-[12px] text-wm-text-muted leading-relaxed">{data.nav_voice_register}</p>
            </div>
          )}
        </Section>
      )}

      {/* AEO keywords + sources used (compact) */}
      {(data.aeo_keywords?.length || data.sources_used?.length || data.cs_flags?.length) ? (
        <Section label="Audit trail">
          {data.aeo_keywords && data.aeo_keywords.length > 0 && (
            <ChipRow label="AEO keywords" items={data.aeo_keywords} />
          )}
          {data.sources_used && data.sources_used.length > 0 && (
            <ChipRow label="Sources used" items={data.sources_used} />
          )}
          {data.cs_flags && data.cs_flags.length > 0 && (
            <ChipRow label="CS flags" items={data.cs_flags} tone="warning" />
          )}
        </Section>
      ) : null}
    </div>
  )
}

function NavTree({ items, depth = 0 }: { items: NavItem[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'space-y-1.5' : 'space-y-1 mt-1'}>
      {items.map((it, i) => (
        <NavRow key={i} item={it} depth={depth} />
      ))}
    </ul>
  )
}

function NavRow({ item, depth }: { item: NavItem; depth: number }) {
  const isGroup = item.kind === 'group' || (item.children && item.children.length > 0)
  const [open, setOpen] = useState(true)
  const indent = depth * 14

  return (
    <li>
      <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1.5">
        {isGroup ? (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="shrink-0 inline-flex items-center justify-center w-3 h-3 text-wm-text-muted hover:text-wm-text"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="shrink-0 w-3 inline-block" />
        )}
        <span className={[
          'text-[12px]',
          isGroup ? 'font-semibold text-wm-text' : 'text-wm-text',
        ].join(' ')}>
          {item.label ?? '—'}
        </span>
        {item.slug && (
          <span className="text-[10px] font-mono text-wm-text-subtle">/{item.slug}</span>
        )}
        {item.url && !item.slug && (
          <span className="text-[10px] font-mono text-wm-text-subtle">{item.url}</span>
        )}
      </div>
      {item.rationale && (
        <p style={{ paddingLeft: indent + 18 }} className="text-[11px] text-wm-text-muted leading-snug mt-0.5">
          {item.rationale}
        </p>
      )}
      {isGroup && open && item.children && item.children.length > 0 && (
        <NavTree items={item.children} depth={depth + 1} />
      )}
    </li>
  )
}

function PageRow({ page }: { page: SitemapPage }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(page.strategic_purpose || page.rationale || (page.content_sources && page.content_sources.length > 0))

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        className={[
          'w-full px-2.5 py-1.5 flex items-baseline gap-2 text-left',
          hasDetail ? 'hover:bg-wm-bg-hover' : 'cursor-default',
        ].join(' ')}
      >
        {hasDetail ? (
          open
            ? <ChevronDown size={11} className="shrink-0 text-wm-text-muted self-center" />
            : <ChevronRight size={11} className="shrink-0 text-wm-text-muted self-center" />
        ) : <span className="shrink-0 w-3" />}
        <span className="text-[12px] font-semibold text-wm-text">{page.name ?? page.slug}</span>
        {page.slug && (
          <span className="text-[10px] font-mono text-wm-text-subtle">/{page.slug}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {page.density && <Tag tone="muted">{page.density}</Tag>}
          {page.page_type && <Tag tone="muted">{page.page_type}</Tag>}
        </span>
      </button>
      {hasDetail && open && (
        <div className="px-2.5 pb-2 pt-1 pl-8 space-y-1.5 border-t border-wm-border bg-wm-bg/20">
          {page.nav_label && page.nav_label !== page.name && (
            <p className="text-[11px] text-wm-text-muted">
              <span className="text-wm-text-subtle">Nav label:</span> {page.nav_label}
            </p>
          )}
          {page.strategic_purpose && (
            <p className="text-[11px] text-wm-text leading-relaxed">
              <span className="text-wm-text-subtle">Purpose:</span> {page.strategic_purpose}
            </p>
          )}
          {page.rationale && (
            <p className="text-[11px] text-wm-text-muted leading-relaxed">
              <span className="text-wm-text-subtle">Rationale:</span> {page.rationale}
            </p>
          )}
          {page.content_sources && page.content_sources.length > 0 && (
            <p className="text-[11px] text-wm-text-muted">
              <span className="text-wm-text-subtle">Sources:</span> {page.content_sources.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2 pb-1.5 border-b border-wm-border">
        {label}
      </p>
      {children}
    </section>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'accent' | 'muted' }) {
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40 px-3 py-2">
      <p className={[
        'text-2xl font-semibold leading-none',
        tone === 'accent' ? 'text-wm-accent-strong' : 'text-wm-text',
      ].join(' ')}>{n}</p>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mt-1">{label}</p>
    </div>
  )
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <span className={[
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono',
      tone === 'warning'
        ? 'bg-wm-warning/10 text-wm-warning border border-wm-warning/30'
        : 'bg-wm-bg-hover text-wm-text-muted border border-wm-border',
    ].join(' ')}>
      {children}
    </span>
  )
}

function ChipRow({ label, items, tone }: { label: string; items: string[]; tone?: 'warning' }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => <Tag key={i} tone={tone ?? 'muted'}>{it}</Tag>)}
      </div>
    </div>
  )
}
