/**
 * Web Manager — Voice workspace (read-only).
 *
 * Pulls the latest published brand guide from strategy_brand_guides
 * (joined on member) and renders the brand statement, voice overview,
 * style tags, and handoff notes. Editing happens upstream in the Brand
 * Squad's own tooling; this is the strategist's reference card while
 * authoring web copy.
 */

import { useEffect, useState } from 'react'
import { Mic, ExternalLink, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMStatusPill } from '../StatusPill'
import type { StrategyWebProject } from '../../../types/database'

interface Props {
  project: StrategyWebProject
}

interface BrandGuide {
  id: string
  brand_statement: string | null
  voice_overview: string | null
  handoff_notes: string | null
  style_tags: string[] | null
  assets_zip_url: string | null
  slug: string | null
  display_name: string | null
  last_updated_at: string | null
  is_published: boolean
}

export function VoiceWorkspace({ project }: Props) {
  const [guide, setGuide] = useState<BrandGuide | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('strategy_brand_guides')
        .select('id, brand_statement, voice_overview, handoff_notes, style_tags, assets_zip_url, slug, display_name, last_updated_at, is_published')
        .eq('member', project.member)
        .eq('is_published', true)
        .order('last_updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancelled) {
        setGuide(data as BrandGuide | null)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [project.member])

  if (loading) {
    return (
      <div className="p-8 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="p-4">
        <Header />
        <div className="rounded-md border border-dashed border-wm-border bg-wm-bg p-5 text-center">
          <Mic size={20} className="text-wm-text-subtle mx-auto mb-2" />
          <h3 className="text-[13px] font-semibold text-wm-text mb-1">No brand handoff yet</h3>
          <p className="text-[11px] text-wm-text-muted leading-snug">
            Once the Brand Squad publishes a brand handoff for this partner, voice
            characteristics + brand statement appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <Header />

      {/* Source + status */}
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Source</p>
          <p className="text-[12px] font-medium text-wm-text">
            Brand Squad handoff
            {guide.last_updated_at && (
              <span className="text-wm-text-subtle font-normal ml-1.5">
                · {new Date(guide.last_updated_at).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WMStatusPill tone="success" size="sm">Published</WMStatusPill>
          {guide.slug && (
            <a
              href={`/library/brand/${guide.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5"
            >
              Full guide <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {guide.style_tags && guide.style_tags.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle mb-1.5">Style tags</h2>
          <div className="flex items-center gap-1.5 flex-wrap">
            {guide.style_tags.map(t => (
              <span key={t} className="text-[11px] font-medium text-wm-accent-strong bg-wm-ai-bg border border-wm-ai-border rounded-full px-2 py-0.5">{t}</span>
            ))}
          </div>
        </section>
      )}

      {guide.brand_statement && (
        <Section label="Brand statement">
          <blockquote className="text-[13px] leading-relaxed text-wm-text italic border-l-2 border-wm-accent pl-3">
            {guide.brand_statement}
          </blockquote>
        </Section>
      )}

      {guide.voice_overview && (
        <Section label="Voice overview">
          <p className="text-[12px] text-wm-text leading-relaxed whitespace-pre-wrap">{guide.voice_overview}</p>
        </Section>
      )}

      {guide.handoff_notes && (
        <Section label="Handoff notes">
          <p className="text-[12px] text-wm-text-muted leading-relaxed whitespace-pre-wrap">{guide.handoff_notes}</p>
        </Section>
      )}

      {project.external_brand_guide_url && (
        <section className="mt-5 pt-4 border-t border-wm-border">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">External brand guide</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-[12px] text-wm-text truncate min-w-0 flex-1">{project.external_brand_guide_url}</p>
            <a
              href={project.external_brand_guide_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5 shrink-0"
            >
              Open <ExternalLink size={10} />
            </a>
          </div>
        </section>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
        <Mic size={13} />
        <p className="text-[11px] font-bold uppercase tracking-widest">Voice</p>
      </div>
      <h1 className="text-[16px] font-semibold text-wm-text">Brand voice rollup</h1>
      <p className="text-[12px] text-wm-text-muted mt-1">
        Read-only reference for how this church sounds. Edits happen upstream in the Brand Squad's tooling.
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <p className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle mb-1.5">{label}</p>
      {children}
    </section>
  )
}
