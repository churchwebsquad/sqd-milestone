import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Link, Check, Palette, BookOpen } from 'lucide-react'
import type { StrategyAccountProgress, PrfBrandGuide, MilestoneStatus } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { extractBrandPathway } from '../../types/churches'
import { ASSET_TYPE_LABELS, PATHWAY_LABELS } from '../submit/types'
import { SectionHeader, SubSectionLabel, DocLink } from './ChurchUI'

const STATUS_CLASSES: Record<MilestoneStatus, string> = {
  sent: 'bg-primary-purple/10 text-primary-purple',
  waiting_on_partner: 'bg-amber-100 text-amber-700',
  partner_replied: 'bg-blue-100 text-blue-700',
  in_revision: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  escalated: 'bg-red-100 text-red-700',
}

interface Props {
  church: StrategyAccountProgress
  submissions: EnrichedSubmission[]
  brandGuides: PrfBrandGuide[]
  portalToken: string | null | undefined
  memberId: number
}

function PortalCopyButton({ portalToken, memberId }: { portalToken: string | null | undefined; memberId: number }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `${window.location.origin}/portal/${portalToken ?? memberId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button type="button" onClick={handleCopy} title="Copy portal link"
      className="inline-flex items-center justify-center h-6 w-6 rounded-full hover:bg-lavender-tint text-purple-gray hover:text-primary-purple transition-colors">
      {copied ? <Check size={11} className="text-green-600" /> : <Link size={11} />}
    </button>
  )
}

function SubmissionCard({ entry, defaultOpen, portalToken, memberId }: { entry: EnrichedSubmission; defaultOpen: boolean; portalToken: string | null | undefined; memberId: number }) {
  const [open, setOpen] = useState(defaultOpen)
  const s = entry.submission
  const m = entry.milestone

  return (
    <div className="border border-lavender rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-lavender-tint/30 transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-primary-purple shrink-0" /> : <ChevronRight size={14} className="text-purple-gray shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-deep-plum truncate">
            {m?.step_name ?? 'Unknown milestone'}
          </p>
          <p className="text-xs text-purple-gray">
            {m?.pathway ? (PATHWAY_LABELS[m.pathway] ?? m.pathway) : ''} · {new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {s.submitted_by_name ? ` · ${s.submitted_by_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <PortalCopyButton portalToken={portalToken} memberId={memberId} />
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${STATUS_CLASSES[(s.milestone_status ?? 'sent') as MilestoneStatus] ?? 'bg-lavender/40 text-purple-gray'}`}>
            {s.milestone_status?.replace(/_/g, ' ') ?? 'sent'}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-lavender/50 space-y-3">
          {/* Submission meta */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-purple-gray">Status:</span> <span className="text-deep-plum font-medium">{s.status}</span></div>
            <div><span className="text-purple-gray">Submitted by:</span> <span className="text-deep-plum font-medium">{s.submitted_by_name ?? s.submitted_by_email}</span></div>
            {s.partner_contact_name && <div><span className="text-purple-gray">Contact:</span> <span className="text-deep-plum font-medium">{s.partner_contact_name}</span></div>}
            {s.is_continuation && <div><span className="text-amber-700 font-semibold">Continuation</span></div>}
          </div>

          {/* Assets */}
          {entry.assets.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Assets</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.assets.map(a => (
                  <a key={a.id} href={a.asset_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs text-deep-plum px-2.5 py-1 hover:bg-lavender-tint transition-colors">
                    <ExternalLink size={9} />
                    {a.asset_label || ASSET_TYPE_LABELS[a.asset_type] || a.asset_type}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ClickUp info */}
          {s.clickup_channel_id && (
            <div className="text-xs text-purple-gray">
              Channel: {s.clickup_channel_id}
              {s.clickup_thread_url && (
                <> · <a href={s.clickup_thread_url} target="_blank" rel="noopener noreferrer" className="text-primary-purple hover:underline">View Thread</a></>
              )}
            </div>
          )}

          {/* Message preview */}
          {s.rendered_message && (
            <div>
              <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Message</p>
              <pre className="whitespace-pre-wrap text-xs text-deep-plum font-sans leading-relaxed bg-lavender-tint/30 rounded-lg px-3 py-2 max-h-40 overflow-y-auto">
                {s.rendered_message}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BrandSquadSection({ church, submissions, brandGuides, portalToken, memberId }: Props) {
  const brandPathway = extractBrandPathway(church.handoff_brand_form as Record<string, unknown> | null)

  return (
    <section id="brand-squad" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={Palette} title="Brand Squad" theme="brand" />

      {/* Brand Pathway */}
      <div className="mb-4">
        <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Brand Pathway</p>
        <p className="text-sm text-deep-plum font-medium">{brandPathway ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
      </div>

      {/* Milestone progress */}
      <div className="mb-4">
        <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2">Milestone Progress</p>
        {submissions.length === 0 ? (
          <p className="text-xs text-purple-gray/50 italic">No brand milestone submissions.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((entry, i) => (
              <SubmissionCard key={entry.submission.id} entry={entry} defaultOpen={i === 0} portalToken={portalToken} memberId={memberId} />
            ))}
          </div>
        )}
      </div>

      {/* Brand guide links */}
      {brandGuides.length > 0 && (
        <div>
          <SubSectionLabel label="Brand Guides" icon={BookOpen} variant="docs" />
          <div className="flex flex-wrap gap-2">
            {brandGuides.map((g, i) => {
              const raw = g as Record<string, unknown>
              const url = raw.brand_guide_link as string | undefined
              const name = raw.brand_name as string | undefined
              const isActive = raw.is_active as boolean | undefined
              if (!url || !url.startsWith('https://live.standards.site')) return null
              const label = isActive === false ? `${name ?? 'Brand Guide'} (inactive)` : (name ?? 'Brand Guide')
              return <DocLink key={i} label={label} url={url} icon={BookOpen} />
            })}
          </div>
        </div>
      )}
    </section>
  )
}
