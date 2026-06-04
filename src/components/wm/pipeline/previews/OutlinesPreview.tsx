/**
 * Human-readable view of Stage 4 (page outlines) output.
 *
 * Layout: sticky horizontal chip row across the top (one chip per
 * page), main panel renders the selected page's voice notes + every
 * section's job/voice/content/atoms/display options. Display options
 * are the strategist's pick list for the bind step.
 */
import { useMemo, useState } from 'react'

interface DisplayOption {
  kind?:       string
  rationale?:  string
  fits_count?: number
}

interface OutlineSection {
  section_id?:      string
  section_job?:     string
  voice_notes?:     string | null
  content_summary?: string
  display_options?: DisplayOption[]
  atoms_used?:      string[]
}

interface PageOutline {
  page_slug?:   string
  voice_notes?: string | null
  sections?:    OutlineSection[]
}

interface OutlinesData {
  page_outlines?: PageOutline[]
}

export function OutlinesPreview({ output }: { output: Record<string, unknown> }) {
  const data  = output as OutlinesData
  const pages = data.page_outlines ?? []

  const [activeSlug, setActiveSlug] = useState<string | null>(
    pages[0]?.page_slug ?? null
  )

  const active = useMemo(
    () => pages.find(p => p.page_slug === activeSlug) ?? pages[0] ?? null,
    [pages, activeSlug]
  )

  const totalSections = useMemo(
    () => pages.reduce((s, p) => s + (p.sections?.length ?? 0), 0),
    [pages]
  )

  if (pages.length === 0) {
    return (
      <p className="text-[12px] text-wm-text-muted italic">
        No page outlines yet. Run Stage 4 to generate.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top metrics row */}
      <div className="flex items-baseline gap-4 text-[12px]">
        <span className="text-wm-text">
          <strong>{pages.length}</strong> {pages.length === 1 ? 'page' : 'pages'}
        </span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text">
          <strong>{totalSections}</strong> sections total
        </span>
      </div>

      {/* Sticky page tabs */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-wm-bg-elevated border-b border-wm-border">
        <div className="flex gap-1.5 flex-wrap">
          {pages.map(p => {
            const isActive = p.page_slug === active?.page_slug
            const count = p.sections?.length ?? 0
            return (
              <button
                key={p.page_slug ?? Math.random()}
                type="button"
                onClick={() => p.page_slug && setActiveSlug(p.page_slug)}
                className={[
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-mono transition-colors',
                  isActive
                    ? 'bg-wm-accent text-white'
                    : 'bg-wm-bg-hover text-wm-text-muted border border-wm-border hover:bg-wm-accent-tint hover:text-wm-text',
                ].join(' ')}
              >
                <span>{p.page_slug ?? '—'}</span>
                <span className={[
                  'text-[10px] tabular-nums',
                  isActive ? 'opacity-90' : 'text-wm-text-subtle',
                ].join(' ')}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Active page */}
      {active && <PageBlock page={active} />}
    </div>
  )
}

function PageBlock({ page }: { page: PageOutline }) {
  return (
    <div className="space-y-5">
      {/* Page voice notes */}
      {page.voice_notes && (
        <div className="rounded-md border border-wm-accent/20 bg-wm-accent-tint/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
            Page voice anchors
          </p>
          <p className="text-[12px] text-wm-text leading-relaxed">{page.voice_notes}</p>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {(page.sections ?? []).map((s, i) => (
          <SectionBlock key={s.section_id ?? i} index={i} section={s} />
        ))}
      </div>
    </div>
  )
}

function SectionBlock({ index, section }: { index: number; section: OutlineSection }) {
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      {/* Section header */}
      <div className="px-3 py-2 border-b border-wm-border flex items-baseline gap-2">
        <span className="text-[11px] font-mono text-wm-text-subtle tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-[12px] font-semibold text-wm-text">
          {section.section_id ?? `Section ${index + 1}`}
        </span>
        {section.atoms_used && section.atoms_used.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-wm-text-subtle">
            {section.atoms_used.length} {section.atoms_used.length === 1 ? 'atom' : 'atoms'}
          </span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {section.section_job && (
          <Field label="Job">{section.section_job}</Field>
        )}
        {section.voice_notes && (
          <Field label="Voice">{section.voice_notes}</Field>
        )}
        {section.content_summary && (
          <Field label="Content">
            <p className="whitespace-pre-wrap">{section.content_summary}</p>
          </Field>
        )}
        {section.display_options && section.display_options.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
              Display options ({section.display_options.length})
            </p>
            <ol className="space-y-2">
              {section.display_options.map((opt, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
                  <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-wm-accent-tint text-wm-accent-strong text-[10px] font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-semibold text-wm-text">{opt.kind ?? '—'}</span>
                      {opt.fits_count != null && (
                        <span className="text-[10px] font-mono text-wm-text-subtle">
                          fits {opt.fits_count}
                        </span>
                      )}
                    </div>
                    {opt.rationale && (
                      <p className="text-[12px] text-wm-text-muted leading-snug mt-0.5">
                        {opt.rationale}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">
        {label}
      </p>
      <div className="text-[12px] text-wm-text leading-relaxed">{children}</div>
    </div>
  )
}
