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
import { WMCard } from '../Card'
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
      <div className="p-6 md:p-8">
        <div className="max-w-3xl mx-auto">
          <Header />
          <WMCard padding="loose">
            <div className="text-center py-8">
              <Mic size={28} className="text-wm-text-subtle mx-auto mb-3" />
              <h3 className="text-[15px] font-semibold text-wm-text mb-1">No brand handoff yet</h3>
              <p className="text-[12px] text-wm-text-muted max-w-md mx-auto">
                Once the Brand Squad publishes a brand handoff for this partner, voice characteristics,
                tone guidelines, and brand statement appear here.
              </p>
            </div>
          </WMCard>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <Header />

        <WMCard padding="loose" className="mb-4">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Source</p>
              <p className="text-[13px] font-medium text-wm-text">
                Brand Squad handoff
                {guide.last_updated_at && (
                  <span className="text-wm-text-subtle font-normal ml-2">
                    · published {new Date(guide.last_updated_at).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <WMStatusPill tone="success" size="sm">Published</WMStatusPill>
              {guide.slug && (
                <a
                  href={`/library/brand/${guide.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5"
                >
                  Open full guide <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>

          {guide.style_tags && guide.style_tags.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">Style tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {guide.style_tags.map(t => (
                  <span key={t} className="text-[11px] font-medium text-wm-accent-strong bg-wm-ai-bg border border-wm-ai-border rounded-full px-2 py-0.5">{t}</span>
                ))}
              </div>
            </div>
          )}

          {guide.brand_statement && (
            <Section label="Brand statement">
              <blockquote className="text-[15px] leading-relaxed text-wm-text italic border-l-2 border-wm-accent pl-4">
                {guide.brand_statement}
              </blockquote>
            </Section>
          )}

          {guide.voice_overview && (
            <Section label="Voice overview">
              <p className="text-sm text-wm-text leading-relaxed whitespace-pre-wrap">{guide.voice_overview}</p>
            </Section>
          )}

          {guide.handoff_notes && (
            <Section label="Handoff notes">
              <p className="text-sm text-wm-text-muted leading-relaxed whitespace-pre-wrap">{guide.handoff_notes}</p>
            </Section>
          )}
        </WMCard>

        {project.external_brand_guide_url && (
          <WMCard padding="default" className="mb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">External brand guide</p>
                <p className="text-[13px] text-wm-text truncate">{project.external_brand_guide_url}</p>
              </div>
              <a
                href={project.external_brand_guide_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5 shrink-0"
              >
                Open <ExternalLink size={11} />
              </a>
            </div>
          </WMCard>
        )}
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
        <Mic size={13} />
        <p className="text-[11px] font-bold uppercase tracking-widest">Voice</p>
      </div>
      <h1 className="text-2xl font-semibold text-wm-text">Brand voice rollup</h1>
      <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
        Read-only reference of how this church sounds — pulled from the Brand Squad handoff.
        Edits to the brand identity happen in the Brand Squad's tooling, not here.
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">{label}</p>
      {children}
    </div>
  )
}
