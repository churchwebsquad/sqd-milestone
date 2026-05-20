import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, PartyPopper, Link, Check, Globe, Wrench, Server } from 'lucide-react'
import type { StrategyAccountProgress, WebsiteSupportAudit, MilestoneStatus } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { extractWebPathway, normalizeWebsitePlatform } from '../../types/churches'
import { PATHWAY_LABELS, ASSET_TYPE_LABELS } from '../submit/types'
import EditableField from './EditableField'
import { SectionHeader, SubSectionLabel, ToolLink } from './ChurchUI'

const STATUS_CLASSES: Record<MilestoneStatus, string> = {
  sent: 'bg-primary-purple/10 text-primary-purple',
  waiting_on_partner: 'bg-amber-100 text-amber-700',
  partner_replied: 'bg-blue-100 text-blue-700',
  in_revision: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  escalated: 'bg-red-100 text-red-700',
}

const CONTENTSNARE_STATUS_COLORS: Record<string, string> = {
  Completed: 'bg-green-100 text-green-700 border-green-200',
  'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
  'Not Started': 'bg-purple-gray/10 text-purple-gray border-purple-gray/20',
  Overdue: 'bg-red-100 text-red-700 border-red-200',
}

interface Props {
  church: StrategyAccountProgress
  submissions: EnrichedSubmission[]
  websiteAudits: WebsiteSupportAudit[]
  onSave: (field: string, value: unknown) => Promise<void>
  editing?: boolean
  portalToken: string | null | undefined
  memberId: number
}

function PortalCopyBtn({ portalToken, memberId }: { portalToken: string | null | undefined; memberId: number }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" title="Copy portal link"
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/portal/${portalToken ?? memberId}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
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
          <p className="text-sm font-medium text-deep-plum truncate">{m?.step_name ?? 'Unknown milestone'}</p>
          <p className="text-xs text-purple-gray">
            {m?.pathway ? (PATHWAY_LABELS[m.pathway] ?? m.pathway) : ''} · {new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {s.submitted_by_name ? ` · ${s.submitted_by_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <PortalCopyBtn portalToken={portalToken} memberId={memberId} />
          <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${STATUS_CLASSES[(s.milestone_status ?? 'sent') as MilestoneStatus] ?? 'bg-lavender/40 text-purple-gray'}`}>
            {s.milestone_status?.replace(/_/g, ' ') ?? 'sent'}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-lavender/50 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-purple-gray">Status:</span> <span className="text-deep-plum font-medium">{s.status}</span></div>
            <div><span className="text-purple-gray">Submitted by:</span> <span className="text-deep-plum font-medium">{s.submitted_by_name ?? s.submitted_by_email}</span></div>
            {s.partner_contact_name && <div><span className="text-purple-gray">Contact:</span> <span className="text-deep-plum font-medium">{s.partner_contact_name}</span></div>}
            {s.is_continuation && <div><span className="text-amber-700 font-semibold">Continuation</span></div>}
          </div>
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
          {s.clickup_channel_id && (
            <div className="text-xs text-purple-gray">
              Channel: {s.clickup_channel_id}
              {s.clickup_thread_url && <> · <a href={s.clickup_thread_url} target="_blank" rel="noopener noreferrer" className="text-primary-purple hover:underline">View Thread</a></>}
            </div>
          )}
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

export default function WebSquadSection({ church, submissions, websiteAudits, onSave, editing, portalToken, memberId }: Props) {
  const webPathway = extractWebPathway(church.handoff_web_form as Record<string, unknown> | null)
  const raw = church as Record<string, unknown>
  const currentPlatform = normalizeWebsitePlatform(raw.current_website_platform as string | null | undefined)

  // Launch fields per data mapping
  const websiteLaunched = raw.website_launched as boolean | null ?? false
  const [launched, setLaunched] = useState(!!websiteLaunched)

  const handleLaunchToggle = async () => {
    const next = !launched
    setLaunched(next)
    try {
      await onSave('website_launched', next)
    } catch {
      setLaunched(!next) // revert on failure
    }
  }

  return (
    <section id="website-squad" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={Globe} title="Website Squad" theme="web" />

      {/* Web Pathway + current platform */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Web Pathway</p>
          <p className="text-sm text-deep-plum font-medium">{webPathway ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-0.5">Current Website Builder</p>
          <p className="text-sm text-deep-plum font-medium">{currentPlatform ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
        </div>
      </div>

      {/* Milestone progress */}
      <div className="mb-4">
        <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2">Milestone Progress</p>
        {submissions.length === 0 ? (
          <p className="text-xs text-purple-gray/50 italic">No web milestone submissions.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((entry, i) => (
              <SubmissionCard key={entry.submission.id} entry={entry} defaultOpen={i === 0} portalToken={portalToken} memberId={memberId} />
            ))}
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="mb-4">
        <SubSectionLabel label="Tools" icon={Wrench} variant="tools" />
        <div className="flex flex-wrap gap-2">
          <ToolLink label="Web Support Evaluation" url="https://website-support-audit-dashboard.lovable.app/" />
          {typeof raw.audit_fix_website === 'string' && raw.audit_fix_website.startsWith('http') && (
            <ToolLink label="Fix Website on Evaluation Tool" url={raw.audit_fix_website} />
          )}
          <ToolLink label="ContentSnare" url="https://churchmediasquad.contentsnare.com/requests" />
        </div>
      </div>

      {/* Hosting Details */}
      {Boolean(raw.hosting_submission || raw.hosting_details_form) && (
        <div className="mb-4 rounded-xl border border-lavender bg-lavender-tint/20 p-4">
          <SubSectionLabel label="Hosting Details" icon={Server} />
          <div className="flex flex-wrap gap-2 mb-2">
            {Boolean(raw.hosting_submission) && typeof raw.hosting_submission === 'string' && raw.hosting_submission.startsWith('http') && (
              <ToolLink label="Hosting Submission" url={raw.hosting_submission as string} />
            )}
            {Boolean(raw.hosting_details_form) && typeof raw.hosting_details_form === 'string' && raw.hosting_details_form.startsWith('http') && (
              <ToolLink label="Hosting Details Form" url={raw.hosting_details_form as string} />
            )}
          </div>
          {Boolean(raw.hosting_modified) && (
            <p className="text-xs text-purple-gray">Last Modified: <span className="text-deep-plum font-medium">{String(raw.hosting_modified)}</span></p>
          )}
        </div>
      )}

      {/* ContentSnare */}
      {Boolean(raw.contentsnare_status || raw.contentsnare) && (
        <div className="mb-4 rounded-xl border border-lavender bg-lavender-tint/20 p-4">
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-2">ContentSnare</p>
          <div className="flex items-center gap-3">
            {Boolean(raw.contentsnare_status) && (
              <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-0.5 border ${CONTENTSNARE_STATUS_COLORS[String(raw.contentsnare_status)] ?? 'bg-lavender/40 text-purple-gray border-lavender'}`}>
                {String(raw.contentsnare_status)}
              </span>
            )}
            {Boolean(raw.contentsnare) && typeof raw.contentsnare === 'string' && (
              <ToolLink label="View ContentSnare" url={raw.contentsnare as string} />
            )}
          </div>
        </div>
      )}

      {/* Web Support Evaluation Results — rendered as pill labels */}
      {websiteAudits.length > 0 && (
        <div className="mb-4 rounded-xl border border-lavender bg-lavender-tint/20 p-4">
          <p className="text-sm font-bold text-deep-plum mb-3">Web Support Evaluation Results</p>
          <div className="rounded-xl bg-lavender-tint/60 p-4">
            <div className="flex flex-wrap gap-2">
              {websiteAudits.map((audit, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-primary-purple/10 border border-primary-purple/20 text-primary-purple text-xs font-semibold px-3 py-1"
                >
                  {audit.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Launch Details */}
      <div className="border-t border-lavender/50 pt-4 mt-4">
        <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-3">Launch Details</p>

        {/* Website Launched toggle */}
        <button
          type="button"
          onClick={handleLaunchToggle}
          className={`mb-4 flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all w-full text-left ${
            launched
              ? 'border-green-400 bg-green-50'
              : 'border-lavender bg-white hover:border-primary-purple'
          }`}
        >
          {launched && <PartyPopper size={20} className="text-green-600 shrink-0" />}
          <div>
            <p className={`text-sm font-semibold ${launched ? 'text-green-700' : 'text-deep-plum'}`}>
              {launched ? 'Website Launched!' : 'Website Not Yet Launched'}
            </p>
            <p className="text-xs text-purple-gray">Click to toggle</p>
          </div>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <EditableField label="Desired Launch Date" value={raw.desired_launch_date as string | null} type="date" onSave={v => onSave('desired_launch_date', v)} forceEdit={editing} />
          <EditableField label="Likelihood of Launch" value={raw.likelihood_of_launch as string | null} onSave={v => onSave('likelihood_of_launch', v)} forceEdit={editing} />
          <EditableField label="Likelihood Reason" value={raw.likelihood_of_launch_reason as string | null} onSave={v => onSave('likelihood_of_launch_reason', v)} forceEdit={editing} />
          <EditableField label="Launch Notes" value={raw.launch_notes as string | null} type="textarea" onSave={v => onSave('launch_notes', v)} forceEdit={editing} />
        </div>
      </div>
    </section>
  )
}

