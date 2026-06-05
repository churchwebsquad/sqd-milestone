/**
 * Human-readable view of Stage 4 (page outlines) output.
 *
 * Layout: sticky horizontal chip row across the top (one chip per
 * page), main panel renders the selected page's voice notes + every
 * section's contract (job, voice, content, personas, goal, required
 * messages, CTA, keyword assignments, atoms, display options).
 *
 * The "contract" fields are the load-bearing additions — required
 * messages, CTA, and keyword assignments get visual prominence
 * because Stage 5 binds them mechanically and Stage 7 cannot violate
 * them.
 */
import { useMemo, useState } from 'react'
import { Target, Megaphone } from 'lucide-react'

interface DisplayOption {
  kind?:       string
  rationale?:  string
  fits_count?: number
}

interface Cta {
  intent?:           string
  label?:            string
  destination_page?: string
}

interface KeywordAssignments {
  primary?:    string[]
  supporting?: string[]
}

interface OutlineSection {
  section_id?:          string
  section_job?:         string
  voice_notes?:         string | null
  content_summary?:     string
  display_options?:     DisplayOption[]
  atoms_used?:          string[]
  serves_personas?:     string[]
  addresses_goal?:      string | null
  required_messages?:   string[]
  cta?:                 Cta | null
  keyword_assignments?: KeywordAssignments | null
}

interface PageSeoTargets {
  search_phrases?:          string[]
  answer_intents?:          string[]
  geo_anchors?:             string[]
  title_target?:            string | null
  meta_description_target?: string | null
}

interface PageOutline {
  page_slug?:        string
  voice_notes?:      string | null
  sections?:         OutlineSection[]
  primary_persona?:  string | null
  page_seo_targets?: PageSeoTargets | null
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
  const totalCtas = useMemo(
    () => pages.reduce((s, p) => s + (p.sections?.filter(sec => sec.cta).length ?? 0), 0),
    [pages]
  )
  const totalRequired = useMemo(
    () => pages.reduce((s, p) =>
      s + (p.sections?.reduce((n, sec) => n + (sec.required_messages?.length ?? 0), 0) ?? 0), 0),
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
      <div className="flex items-baseline gap-4 text-[12px] flex-wrap">
        <span className="text-wm-text">
          <strong>{pages.length}</strong> {pages.length === 1 ? 'page' : 'pages'}
        </span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text">
          <strong>{totalSections}</strong> sections
        </span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text">
          <strong>{totalRequired}</strong> required messages
        </span>
        <span className="text-wm-text-muted">·</span>
        <span className="text-wm-text">
          <strong>{totalCtas}</strong> CTAs
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
  const seo = page.page_seo_targets
  return (
    <div className="space-y-5">
      {/* Page-level metadata: primary persona + voice anchors */}
      {(page.primary_persona || page.voice_notes) && (
        <div className="rounded-md border border-wm-accent/20 bg-wm-accent-tint/40 px-3 py-2 space-y-2">
          {page.primary_persona && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-0.5">
                Primary persona
              </p>
              <p className="text-[12px] text-wm-text">{page.primary_persona}</p>
            </div>
          )}
          {page.voice_notes && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-0.5">
                Page voice anchors
              </p>
              <p className="text-[12px] text-wm-text leading-relaxed">{page.voice_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Page SEO targets */}
      {seo && (seo.title_target || seo.meta_description_target ||
        (seo.search_phrases?.length ?? 0) > 0 ||
        (seo.answer_intents?.length ?? 0) > 0 ||
        (seo.geo_anchors?.length ?? 0) > 0) && (
        <div className="rounded-md border border-wm-border bg-wm-bg/40 px-3 py-2 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
            Page SEO / AEO / GEO targets
          </p>
          {seo.title_target && (
            <Mini label="Title">{seo.title_target}</Mini>
          )}
          {seo.meta_description_target && (
            <Mini label="Meta description">{seo.meta_description_target}</Mini>
          )}
          {seo.search_phrases && seo.search_phrases.length > 0 && (
            <ChipRow label="Search phrases" items={seo.search_phrases} tone="accent" />
          )}
          {seo.answer_intents && seo.answer_intents.length > 0 && (
            <ChipRow label="Answer intents" items={seo.answer_intents} tone="muted" />
          )}
          {seo.geo_anchors && seo.geo_anchors.length > 0 && (
            <ChipRow label="Geo anchors" items={seo.geo_anchors} tone="muted" />
          )}
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
  const kw   = section.keyword_assignments
  const kwTotal = (kw?.primary?.length ?? 0) + (kw?.supporting?.length ?? 0)
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg/40">
      {/* Section header */}
      <div className="px-3 py-2 border-b border-wm-border flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] font-mono text-wm-text-subtle tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-[12px] font-semibold text-wm-text">
          {section.section_id ?? `Section ${index + 1}`}
        </span>
        {section.cta && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-wm-accent text-white">
            <Megaphone size={9} /> CTA
          </span>
        )}
        <span className="ml-auto flex items-baseline gap-2">
          {(section.required_messages?.length ?? 0) > 0 && (
            <span className="text-[10px] font-mono text-wm-accent-strong">
              {section.required_messages!.length} req
            </span>
          )}
          {kwTotal > 0 && (
            <span className="text-[10px] font-mono text-wm-text-subtle">
              {kwTotal} kw
            </span>
          )}
          {section.atoms_used && section.atoms_used.length > 0 && (
            <span className="text-[10px] font-mono text-wm-text-subtle">
              {section.atoms_used.length} {section.atoms_used.length === 1 ? 'atom' : 'atoms'}
            </span>
          )}
        </span>
      </div>

      <div className="p-3 space-y-3">
        {section.section_job && (
          <Field label="Job">{section.section_job}</Field>
        )}

        {/* Contract row: personas + goal */}
        {(section.serves_personas?.length || section.addresses_goal) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {section.serves_personas && section.serves_personas.length > 0 && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">
                  Serves
                </p>
                <div className="flex flex-wrap gap-1">
                  {section.serves_personas.map(p => (
                    <span key={p} className="text-[11px] px-1.5 py-0.5 rounded bg-wm-bg-hover text-wm-text border border-wm-border">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {section.addresses_goal && (
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5 inline-flex items-center gap-1">
                  <Target size={10} /> Advances goal
                </p>
                <p className="text-[12px] text-wm-text leading-snug">{section.addresses_goal}</p>
              </div>
            )}
          </div>
        )}

        {/* Required messages — load-bearing claims */}
        {section.required_messages && section.required_messages.length > 0 && (
          <div className="rounded border border-wm-accent/30 bg-wm-accent-tint/30 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong mb-1">
              Required messages ({section.required_messages.length})
            </p>
            <ol className="space-y-1 list-decimal list-inside text-[12px] text-wm-text leading-snug">
              {section.required_messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
            <p className="text-[10px] text-wm-text-muted italic mt-1">
              Stage 5 may paraphrase but cannot drop these. Stage 7 voice pass cannot rewrite them away.
            </p>
          </div>
        )}

        {/* CTA */}
        {section.cta && (
          <div className="rounded border border-wm-success/30 bg-wm-success-bg/30 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-wm-success mb-1 inline-flex items-center gap-1">
              <Megaphone size={10} /> CTA · {section.cta.intent ?? '—'}
            </p>
            <p className="text-[12px] text-wm-text leading-snug">
              <span className="font-semibold">{section.cta.label ?? '—'}</span>
              {section.cta.destination_page && (
                <span className="text-wm-text-muted"> → </span>
              )}
              {section.cta.destination_page && (
                <code className="text-[11px] font-mono text-wm-accent-strong">{section.cta.destination_page}</code>
              )}
            </p>
          </div>
        )}

        {/* Keyword assignments */}
        {kw && kwTotal > 0 && (
          <div className="space-y-1.5">
            {kw.primary && kw.primary.length > 0 && (
              <ChipRow label="Primary keywords (heading or lead sentence)" items={kw.primary} tone="accent" />
            )}
            {kw.supporting && kw.supporting.length > 0 && (
              <ChipRow label="Supporting keywords (body copy)" items={kw.supporting} tone="muted" />
            )}
          </div>
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

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">{label}</p>
      <p className="text-[12px] text-wm-text leading-snug">{children}</p>
    </div>
  )
}

function ChipRow({ label, items, tone }: { label: string; items: string[]; tone: 'accent' | 'muted' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.map(item => (
          <span
            key={item}
            className={[
              'text-[11px] px-1.5 py-0.5 rounded border',
              tone === 'accent'
                ? 'bg-wm-accent-tint text-wm-accent-strong border-wm-accent/30 font-semibold'
                : 'bg-wm-bg-hover text-wm-text border-wm-border',
            ].join(' ')}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
