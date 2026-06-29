import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ChevronDown, ChevronRight, ExternalLink, PartyPopper, Link, Check, Globe, Wrench, Server, ArrowUpRight, KeyRound, Loader2, FileText } from 'lucide-react'
import type { StrategyAccountProgress, WebsiteSupportAudit, MilestoneStatus } from '../../types/database'
import type { EnrichedSubmission } from '../../pages/ChurchDetailPage'
import { extractWebPathway, normalizeWebsitePlatform } from '../../types/churches'
import { PATHWAY_LABELS, ASSET_TYPE_LABELS } from '../submit/types'
import { supabase } from '../../lib/supabase'
import EditableField from './EditableField'
import { SectionHeader, SubSectionLabel, ToolLink } from './ChurchUI'
import { WebSupportEvaluationChecklist } from './WebSupportEvaluationChecklist'

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

export default function WebSquadSection({ church, submissions, onSave, editing, portalToken, memberId }: Props) {
  const webPathway = extractWebPathway(church.handoff_web_form as Record<string, unknown> | null)
  const raw = church as Record<string, unknown>
  const currentPlatform = normalizeWebsitePlatform(raw.current_website_platform as string | null | undefined)

  // Launch fields per data mapping
  const websiteLaunched = raw.website_launched as boolean | null ?? false
  const [launched, setLaunched] = useState(!!websiteLaunched)

  // Look up the Website Manager project for this church (if one exists)
  // so we can link to /web/{projectId}?tab=planning from this section.
  // null = not loaded yet, '' = no project for this church.
  const [webProjectId, setWebProjectId] = useState<string | '' | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('strategy_web_projects')
        .select('id')
        .eq('member', memberId)
        .eq('archived', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setWebProjectId((data as { id?: string } | null)?.id ?? '')
    })()
    return () => { cancelled = true }
  }, [memberId])

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
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <SectionHeader icon={Globe} title="Website Squad" theme="web" />
        {webProjectId && (
          <RouterLink
            to={`/web/${webProjectId}?tab=planning`}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary-purple hover:text-deep-plum"
            title="Open this church's Website Manager project"
          >
            Website manager
            <ArrowUpRight size={12} />
          </RouterLink>
        )}
      </div>

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

      {/* Web Support Evaluation — inline checklist driven by
          website_support_audit. Replaces the prior external dashboard
          link and the audit-fix link; clicking an item appends this
          member to the audit row's CSV cells (append-only). */}
      <WebSupportEvaluationChecklist memberId={memberId} />

      {/* Initial Site Access — pre-evaluation handoff checklist.
          Backed by 6 nullable booleans on strategy_account_progress
          (v102 / v118). NULL = not yet set; the UI surfaces a 3-state
          pill so the AM can tell "not asked" apart from "explicitly
          no". Sub-heading shares the standalone migration intake link
          so AMs can send it to churches who want to migrate hosting
          WITHOUT completing the full Content Collection. */}
      <InitialSiteAccessChecklist church={church} onSave={onSave} />
      <MigrationIntakeShareLink portalToken={portalToken ?? memberId} />

      {/* Partner Site Notes — fetched from the Notion web support
          database, filtered to rows where `Notes Type = "Partner Site
          Notes"` and the title contains this church's name. */}
      <PartnerSiteNotesList churchName={church.church_name ?? ''} />

      {/* Tools */}
      <div className="mb-4">
        <SubSectionLabel label="Tools" icon={Wrench} variant="tools" />
        <div className="flex flex-wrap gap-2">
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

// ── Migration intake share link ───────────────────────────────────────
// Surfaces a copy-able URL to the standalone /portal/:token/registrar-
// intake form (RegistrarIntakePage). That form collects current_host
// + registrar info — same columns the full Content Collection page
// writes to, so a partner who completes the migration form will see
// their answers pre-filled if they later open Content Collection.
//
// Use case: partners who want to migrate hosting to our infra
// without doing a full redesign. Their existing site stays as-is;
// we move it to our WordPress hosting. The AM sends this link to
// gather just-enough info.
function MigrationIntakeShareLink({ portalToken }: { portalToken: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!portalToken) return null
  const url = `${window.location.origin}/portal/${portalToken}/registrar-intake`
  const copy = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="mb-4 rounded-xl border border-lavender bg-cream/40 px-3 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-deep-plum">Migration-only intake link</p>
        <p className="text-[11px] text-purple-gray leading-tight">
          Send this to a church migrating to Squad hosting without a full Content Collection — collects current host + domain registrar.
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-deep-plum bg-white border border-lavender hover:bg-lavender-tint rounded-full px-3 py-1.5"
        title={url}
      >
        {copied ? <><Check size={11} /> Copied</> : <><Link size={11} /> Copy link</>}
      </button>
    </div>
  )
}

// ── Initial Site Access ────────────────────────────────────────────────
// Per-checkbox 3-state toggle (null → true → false → null). NULL = not
// yet set, which is meaningfully different from explicit false ("we
// asked and they don't have it"). Each row writes to one of four
// strategy_account_progress.web_squad_* boolean columns.

interface ChecklistItem {
  field:
    | 'web_squad_site_access_provided'
    | 'web_squad_hosting_details_provided'
    | 'web_squad_domain_registrar_provided'
    | 'web_squad_login_in_1password'
    | 'web_squad_ga_access_shared'
    | 'web_squad_ready_for_evaluation'
  label: string
  hint: string
}

// v118 — "Site access provided" was overloaded (CMS + hosting + registrar).
// Split into three distinct prerequisites so each can be tracked
// independently. Migration intake form fills hosting + registrar
// fields directly; CMS access is collected separately.
const SITE_ACCESS_ITEMS: ChecklistItem[] = [
  { field: 'web_squad_site_access_provided',     label: 'Site access provided',         hint: "Partner has shared CMS / admin login (e.g. WordPress, Squarespace dashboard)." },
  { field: 'web_squad_hosting_details_provided', label: 'Hosting details provided',     hint: "Partner has shared their current hosting provider + login (Bluehost, SiteGround, Squarespace hosting, etc.)." },
  { field: 'web_squad_domain_registrar_provided',label: 'Domain registrar confirmation',hint: "Partner has confirmed who manages the domain (GoDaddy, Namecheap, Squarespace, etc.) and shared access." },
  { field: 'web_squad_login_in_1password',       label: 'Login added to 1Password',     hint: "Credentials live in the Squad 1Password vault." },
  { field: 'web_squad_ga_access_shared',         label: 'GA access shared',             hint: "Partner has invited the Squad GA account." },
  { field: 'web_squad_ready_for_evaluation',     label: 'Ready for site evaluation',    hint: "All prerequisites met; the Squad will schedule the evaluation pass." },
]

function InitialSiteAccessChecklist({
  church, onSave,
}: {
  church: StrategyAccountProgress
  onSave: (field: string, value: unknown) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  /** Three-state cycle: null → true → false → null. */
  const cycleValue = (current: boolean | null): boolean | null => {
    if (current === null) return true
    if (current === true) return false
    return null
  }

  const handleClick = async (field: ChecklistItem['field']) => {
    const current = (church[field] as boolean | null) ?? null
    const next = cycleValue(current)
    setBusy(field)
    try {
      await onSave(field, next)
      // v118 — when "Ready for site evaluation" flips to true, fire
      // a Slack notification to #am-pm-web with a summary of which
      // prerequisites are checked off. Fire-and-forget; UI doesn't
      // wait. Other field flips don't trigger a post.
      if (field === 'web_squad_ready_for_evaluation' && next === true) {
        const supabaseUrl = (import.meta as unknown as { env: { VITE_SUPABASE_URL: string } }).env.VITE_SUPABASE_URL
        const { data: sess } = await supabase.auth.getSession()
        const accessToken = sess?.session?.access_token
        if (supabaseUrl && accessToken && church.member != null) {
          void fetch(`${supabaseUrl}/functions/v1/notify-site-evaluation-ready`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body:    JSON.stringify({ member: church.member }),
          }).catch(err => console.warn('[InitialSiteAccess] Slack notify failed:', err))
        }
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-4">
      <SubSectionLabel label="Initial Site Access" icon={KeyRound} />
      <p className="text-[11px] text-purple-gray mb-2">
        Pre-evaluation handoff. Click each row to cycle: <strong>Not yet → Yes → No → Not yet</strong>.
      </p>
      <div className="rounded-xl border border-lavender bg-white divide-y divide-lavender/60">
        {SITE_ACCESS_ITEMS.map(item => {
          const value = (church[item.field] as boolean | null) ?? null
          const isBusy = busy === item.field
          return (
            <button
              key={item.field}
              type="button"
              onClick={() => void handleClick(item.field)}
              disabled={isBusy}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-lavender-tint/40 transition-colors disabled:opacity-60"
            >
              <CheckboxBox state={value} busy={isBusy} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-deep-plum leading-tight">{item.label}</p>
                <p className="text-[11px] text-purple-gray leading-tight mt-0.5">{item.hint}</p>
              </div>
              <StatePill state={value} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Three-state checkbox box. Filled purple when true; outlined red when
 *  explicit false; hollow lavender when null (not yet set). */
function CheckboxBox({ state, busy }: { state: boolean | null; busy: boolean }) {
  if (busy) {
    return (
      <div className="w-5 h-5 rounded-md border-2 border-primary-purple/40 bg-white grid place-items-center shrink-0">
        <Loader2 size={11} className="animate-spin text-primary-purple" />
      </div>
    )
  }
  if (state === true) {
    return (
      <div className="w-5 h-5 rounded-md bg-primary-purple border-2 border-primary-purple grid place-items-center shrink-0">
        <Check size={13} className="text-white" />
      </div>
    )
  }
  if (state === false) {
    return (
      <div className="w-5 h-5 rounded-md border-2 border-red-400 bg-red-50 grid place-items-center shrink-0">
        <span className="text-red-500 text-[12px] font-bold leading-none">–</span>
      </div>
    )
  }
  return <div className="w-5 h-5 rounded-md border-2 border-lavender bg-white shrink-0" />
}

function StatePill({ state }: { state: boolean | null }) {
  if (state === true)  return <span className="text-[10px] font-bold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">Yes</span>
  if (state === false) return <span className="text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">No</span>
  return <span className="text-[10px] font-bold uppercase tracking-wide text-purple-gray bg-lavender/30 border border-lavender rounded-full px-2 py-0.5">Not yet</span>
}

// ── Partner Site Notes (Notion) ────────────────────────────────────────
// Pulls rows from the Web Support Notion database filtered by
// `Notes Type = "Partner Site Notes"`, then narrows to ones whose title
// contains the church name. Notion fetch happens via the strategy-notion
// edge function so the NOTION_TOKEN stays server-side. Property name +
// select value are case-sensitive on the Notion API.

interface PartnerSiteNote {
  page_id:        string
  title:          string
  last_edited_at: string | null
  url:            string
  preview:        string
}

function PartnerSiteNotesList({ churchName }: { churchName: string }) {
  const [notes, setNotes] = useState<PartnerSiteNote[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  // Without a church name we can't meaningfully filter — every Notion
  // note would surface (firehose). Show the section in a disabled
  // state so the AM understands why it's empty.
  const hasFilter = churchName.trim().length > 0

  // Lazy-load: defer the Notion round-trip until the AM opens the
  // section. Keeps the church-detail render fast for accounts that
  // don't have site notes yet.
  useEffect(() => {
    if (!open || notes !== null || !hasFilter) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: sess } = await supabase.auth.getSession()
        const accessToken = sess.session?.access_token
        if (!accessToken) throw new Error('Not signed in.')
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-notion`,
          {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              op:          'list-partner-site-notes',
              titleFilter: churchName,
              limit:       10,
            }),
          },
        )
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
        }
        setNotes((body.notes ?? []) as PartnerSiteNote[])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, churchName, notes])

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={!hasFilter}
        className="w-full flex items-center justify-between gap-2 text-left py-2 px-3 rounded-lg border border-lavender bg-lavender-tint/30 hover:bg-lavender-tint/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        title={hasFilter ? '' : 'Set the church name first so we can filter Notion notes by title.'}
      >
        <span className="flex items-center gap-2">
          <FileText size={14} className="text-primary-purple" />
          <span className="text-sm font-semibold text-deep-plum">Partner site notes (Notion)</span>
          {notes && (
            <span className="text-[10px] text-purple-gray">
              · {notes.length} note{notes.length === 1 ? '' : 's'}
            </span>
          )}
          {!hasFilter && (
            <span className="text-[10px] text-purple-gray italic">· church name needed to filter</span>
          )}
        </span>
        {open ? <ChevronDown size={14} className="text-purple-gray" /> : <ChevronRight size={14} className="text-purple-gray" />}
      </button>

      {open && (
        <div className="mt-2">
          {loading && (
            <div className="text-center py-4 text-purple-gray text-xs inline-flex items-center gap-1.5 w-full justify-center">
              <Loader2 size={12} className="animate-spin" />
              Loading from Notion…
            </div>
          )}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <strong className="font-semibold">Notion fetch failed:</strong> {error}
              <p className="mt-1 text-red-600">
                If this is a permission error, the Notion integration may need access to the Web Support database. Share the database with the Squad integration in Notion → Connections.
              </p>
            </div>
          )}
          {!loading && !error && notes && notes.length === 0 && (
            <p className="text-xs text-purple-gray italic py-3 px-1">
              No partner site notes in Notion for "{churchName}" yet.
            </p>
          )}
          {!loading && !error && notes && notes.length > 0 && (
            <ul className="divide-y divide-lavender/60 border border-lavender rounded-lg bg-white">
              {notes.map(note => (
                <li key={note.page_id}>
                  <a
                    href={note.url || `https://www.notion.so/${note.page_id.replace(/-/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-3 py-2.5 hover:bg-lavender-tint/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-deep-plum leading-tight">{note.title}</p>
                      <ExternalLink size={11} className="text-purple-gray shrink-0 mt-0.5" />
                    </div>
                    {note.preview && (
                      <p className="text-[11px] text-purple-gray leading-snug mt-1 line-clamp-2">{note.preview}</p>
                    )}
                    {note.last_edited_at && (
                      <p className="text-[10px] text-purple-gray/70 mt-1">
                        Last edited {new Date(note.last_edited_at).toLocaleDateString()}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

