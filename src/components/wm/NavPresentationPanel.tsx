/**
 * NavPresentationPanel. Shared nav-presentation visualization.
 *
 * Originally lived inside src/components/wm/pipeline/previews/
 * SitemapPreview.tsx (legacy Copy Engine view). Extracted here so the
 * cowork View Details drawer + the legacy preview can share one
 * rendering and the strategist sees the same shell/megamenu/offcanvas
 * cards regardless of which pipeline produced the artifact.
 *
 * Pure presentation. No data loading, no Supabase calls. Takes a
 * NavPresentation object (or null), renders nothing when null.
 */

import type { ReactNode } from 'react'

// ── Types (mirror SitemapPreview's shape, kept local so this module
// can ship without a circular import). ────────────────────────────────

export interface NavPresentationVisibleTopLevel {
  kind?:        'page' | 'group' | 'button' | 'hamburger'
  label?:       string
  slug?:        string
  group_label?: string
}

export interface NavPresentationDropdownChild {
  label?: string
  slug?:  string
  one_line_description?: string
}

export interface NavPresentationDropdownGroup {
  group_label?: string
  children?:    NavPresentationDropdownChild[]
}

export interface NavPresentationMegamenuColumn {
  heading?:     string
  description?: string
  links?:       NavPresentationDropdownChild[]
}

export interface NavPresentationMegamenuPanel {
  triggered_by?:  string
  columns?:       NavPresentationMegamenuColumn[]
  featured_tile?: {
    kind?:       'image_cta' | 'sermon_card' | 'event_card' | 'persona_callout'
    heading?:    string
    body?:       string
    link_label?: string
    link_slug?:  string
  }
}

export interface NavPresentationOffcanvasSection {
  section_label?: string
  links?:         Array<{ label?: string; slug?: string }>
}

export interface NavPresentation {
  shell?:                  'standard_dropdowns' | 'megamenu' | 'offcanvas'
  presentation_rationale?: string
  visible_top_level?:      NavPresentationVisibleTopLevel[]
  standard_dropdowns?:     { groups?: NavPresentationDropdownGroup[] }
  megamenu_panels?:        NavPresentationMegamenuPanel[]
  offcanvas_overlay?: {
    hero_message?: string
    sections?:     NavPresentationOffcanvasSection[]
    surfaced_facts?: {
      service_times?: string
      address?:       string
      socials?:       Array<{ platform?: string; url?: string }>
      search?:        boolean
    }
  }
}

const SHELL_LABEL: Record<string, string> = {
  standard_dropdowns: 'Standard dropdowns',
  megamenu:           'Mega menu',
  offcanvas:          'Off-canvas overlay',
}

// ────────────────────────────────────────────────────────────────────

/** Visual variant. `'staff'` (default) surfaces strategist framing:
 *  the section wrapper, shell / rationale callout, internal labels
 *  ("Visible header, what the visitor sees at rest"), and the URL
 *  slug hints under each link. `'partner'` hides all of that so the
 *  same component is safe to embed inside the partner-facing sitemap
 *  review portal: just the visual mockup, no strategist voice. */
export type NavPresentationPanelVariant = 'staff' | 'partner'

export function NavPresentationPanel({
  presentation,
  variant = 'staff',
}: {
  presentation: NavPresentation | null | undefined
  variant?:     NavPresentationPanelVariant
}) {
  if (!presentation) return null
  const shell    = presentation.shell
  const isPartner = variant === 'partner'
  const body = (
    <>
      {!isPartner && (
        <div className="rounded-md border-2 border-wm-accent/40 bg-wm-accent-tint/30 px-3 py-2.5 mb-4">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">Shell</span>
            <span className="text-[14px] font-semibold text-wm-text">{shell ? SHELL_LABEL[shell] ?? shell : '…'}</span>
          </div>
          {presentation.presentation_rationale && (
            <p className="text-[12px] text-wm-text leading-relaxed">{presentation.presentation_rationale}</p>
          )}
        </div>
      )}

      {/* Visible top-level: bar mockup */}
      {presentation.visible_top_level && presentation.visible_top_level.length > 0 && (
        <div className="mb-4">
          {!isPartner && (
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
              Visible header. What the visitor sees at rest.
            </p>
          )}
          <div className="rounded-md border border-wm-border bg-wm-bg/40 px-3 py-2 flex flex-wrap items-center gap-2">
            {presentation.visible_top_level.map((item, i) => (
              <VisibleTopLevelChip key={i} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Per-shell layout */}
      {shell === 'standard_dropdowns' && presentation.standard_dropdowns && (
        <StandardDropdownsLayout groups={presentation.standard_dropdowns.groups ?? []} variant={variant} />
      )}
      {shell === 'megamenu' && presentation.megamenu_panels && (
        <MegamenuLayout panels={presentation.megamenu_panels} variant={variant} />
      )}
      {shell === 'offcanvas' && presentation.offcanvas_overlay && (
        <OffcanvasLayout overlay={presentation.offcanvas_overlay} variant={variant} />
      )}
    </>
  )

  return isPartner ? <div>{body}</div> : <Section label="Nav presentation">{body}</Section>
}

function VisibleTopLevelChip({ item }: { item: NavPresentationVisibleTopLevel }) {
  const isButton    = item.kind === 'button'
  const isHamburger = item.kind === 'hamburger'
  const isGroup     = item.kind === 'group'
  if (isHamburger) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-wm-border bg-wm-bg-hover text-wm-text-muted text-[14px]">
        ☰
      </span>
    )
  }
  return (
    <span className={[
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px]',
      isButton
        ? 'bg-wm-accent text-white font-semibold'
        : 'bg-wm-bg-elevated border border-wm-border text-wm-text',
    ].join(' ')}>
      {item.label ?? item.group_label ?? '…'}
      {isGroup && <span className="text-[10px] opacity-60">▾</span>}
    </span>
  )
}

function StandardDropdownsLayout({ groups, variant }: { groups: NavPresentationDropdownGroup[]; variant: NavPresentationPanelVariant }) {
  const isPartner = variant === 'partner'
  return (
    <div>
      {!isPartner && (
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
          Dropdown panels
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map((g, i) => (
          <div key={i} className="rounded-md border border-wm-border bg-wm-bg/40 p-3">
            <p className="text-[12px] font-semibold text-wm-text mb-1.5">
              {g.group_label ?? '…'} ▾
            </p>
            <ul className="space-y-1.5">
              {(g.children ?? []).map((c, j) => (
                <li key={j} className="text-[12px]">
                  <span className="text-wm-text">{c.label}</span>
                  {!isPartner && c.slug && <span className="ml-1.5 text-[10px] font-mono text-wm-text-subtle">/{c.slug}</span>}
                  {c.one_line_description && (
                    <p className="text-[11px] text-wm-text-muted leading-snug mt-0.5">
                      {c.one_line_description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function MegamenuLayout({ panels, variant }: { panels: NavPresentationMegamenuPanel[]; variant: NavPresentationPanelVariant }) {
  const isPartner = variant === 'partner'
  return (
    <div className="space-y-4">
      {!isPartner && (
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Megamenu panels. What opens on each top-level hover.
        </p>
      )}
      {panels.map((panel, i) => (
        <div key={i} className="rounded-md border border-wm-accent/30 bg-wm-bg/40">
          <div className="px-3 py-1.5 border-b border-wm-accent/20 bg-wm-accent-tint/30">
            <p className="text-[11px] text-wm-text">
              {isPartner
                ? <><span className="font-semibold">{panel.triggered_by ?? '…'}</span></>
                : <>Opens from: <span className="font-semibold">&ldquo;{panel.triggered_by ?? '…'}&rdquo;</span></>
              }
            </p>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {(panel.columns ?? []).map((col, j) => (
              <div key={j} className="rounded border border-wm-border bg-wm-bg-elevated p-2.5">
                <p className="text-[11px] font-semibold text-wm-accent-strong mb-1">
                  {col.heading ?? '…'}
                </p>
                {col.description && (
                  <p className="text-[10px] text-wm-text-muted italic leading-snug mb-2">{col.description}</p>
                )}
                <ul className="space-y-1.5">
                  {(col.links ?? []).map((link, k) => (
                    <li key={k} className="text-[11px]">
                      <span className="text-wm-text font-medium">{link.label}</span>
                      {!isPartner && link.slug && (
                        <span className="ml-1 text-[10px] font-mono text-wm-text-subtle">/{link.slug}</span>
                      )}
                      {link.one_line_description && (
                        <p className="text-[10px] text-wm-text-muted leading-snug mt-0.5">{link.one_line_description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {panel.featured_tile && (
              <div className="rounded border-2 border-wm-accent bg-wm-accent-tint/40 p-2.5 col-span-1 md:col-span-1 lg:col-span-1">
                <p className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
                  {isPartner ? 'Featured' : `Featured ${panel.featured_tile.kind?.replace(/_/g, ' ') ?? 'tile'}`}
                </p>
                {panel.featured_tile.heading && (
                  <p className="text-[12px] font-semibold text-wm-text leading-tight mb-1">
                    {panel.featured_tile.heading}
                  </p>
                )}
                {panel.featured_tile.body && (
                  <p className="text-[11px] text-wm-text leading-snug mb-2">{panel.featured_tile.body}</p>
                )}
                {panel.featured_tile.link_label && (
                  <p className="text-[11px] text-wm-accent-strong font-semibold">
                    {panel.featured_tile.link_label} →
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function OffcanvasLayout({ overlay, variant }: { overlay: NonNullable<NavPresentation['offcanvas_overlay']>; variant: NavPresentationPanelVariant }) {
  const isPartner = variant === 'partner'
  return (
    <div>
      {!isPartner && (
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
          Off-canvas overlay. Full nav lives behind the hamburger.
        </p>
      )}
      <div className="rounded-md border-2 border-wm-accent/30 bg-wm-bg/60 p-3 max-w-md">
        {overlay.hero_message && (
          <p className="text-[13px] text-wm-text font-semibold mb-3 italic">
            &ldquo;{overlay.hero_message}&rdquo;
          </p>
        )}
        {(overlay.sections ?? []).map((section, i) => (
          <div key={i} className="mb-3">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
              {section.section_label}
            </p>
            <ul className="space-y-0.5">
              {(section.links ?? []).map((link, j) => (
                <li key={j} className="text-[12px] text-wm-text">
                  {link.label}
                  {!isPartner && link.slug && <span className="ml-1 text-[10px] font-mono text-wm-text-subtle">/{link.slug}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {overlay.surfaced_facts && (
          <div className="border-t border-wm-border pt-2 mt-3 space-y-1">
            {overlay.surfaced_facts.service_times && (
              <p className="text-[11px] text-wm-text">
                <span className="text-wm-text-subtle">Service:</span> {overlay.surfaced_facts.service_times}
              </p>
            )}
            {overlay.surfaced_facts.address && (
              <p className="text-[11px] text-wm-text">
                <span className="text-wm-text-subtle">Address:</span> {overlay.surfaced_facts.address}
              </p>
            )}
            {overlay.surfaced_facts.socials && overlay.surfaced_facts.socials.length > 0 && (
              <p className="text-[11px] text-wm-text">
                <span className="text-wm-text-subtle">Follow:</span>{' '}
                {overlay.surfaced_facts.socials.map(s => s.platform).join(' · ')}
              </p>
            )}
            {overlay.surfaced_facts.search && (
              <p className="text-[11px] text-wm-text-muted italic">Search box surfaces in overlay</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-2 pb-1.5 border-b border-wm-border">
        {label}
      </p>
      {children}
    </section>
  )
}
