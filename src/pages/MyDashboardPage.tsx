import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ExternalLink, ChevronRight, MessageSquare,
  CheckCircle2, AlertTriangle, X, Clock, Send,
  Activity, Target, Building2, Wrench, Search, Sparkles,
  BookOpen,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { displayReplyText } from '../lib/replyDisplay'
import { useAuth } from '../contexts/AuthContext'
import type {
  StrategyMilestoneReply,
  MilestoneStatus,
  TriageCategory,
  SubmissionStatus,
} from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS } from '../components/submit/types'
import { getMyDashboardStrategy, listDocs, listInitiatives, listMilestones, isSetupError } from '../lib/strategyNotion'
import type {
  MyDashboardStrategyBundle, Initiative, Milestone,
  StrategyNotionSetupError, DocHubEntry,
} from '../types/strategy'
import { ProgressEntryItem } from '../components/strategy/ProgressEntryItem'
import { useLinkedDocsByProgressIds } from '../hooks/useLinkedDocsByProgressIds'
import { MilestoneEventItem } from '../components/strategy/MilestoneEventItem'
import { InitiativeCard } from '../components/strategy/InitiativeCard'
import {
  employeeDepartmentToStrategy, getActiveVerifier as resolveVerifier,
  isDirectorByEmployeeId, isVPByEmail,
  listMyReads, listRequiredReading, listVerifierDefaults,
} from '../lib/library'
import type { VerifierDefault } from '../types/strategy'

const N8N_TRIAGE_PROXY = '/api/webhook/reply-triage'

// ── Constants ─────────────────────────────────────────────────────────────────

const MILESTONE_STATUS_CLASSES: Record<MilestoneStatus, string> = {
  sent:               'bg-primary-purple/10 text-primary-purple',
  waiting_on_partner: 'bg-amber-100 text-amber-700',
  partner_replied:    'bg-blue-100 text-blue-700',
  in_revision:        'bg-amber-100 text-amber-800',
  approved:           'bg-green-100 text-green-700',
  escalated:          'bg-red-100 text-red-700',
}

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  sent:               'Sent',
  waiting_on_partner: 'Waiting',
  partner_replied:    'Partner Replied',
  in_revision:        'In Revision',
  approved:           'Approved',
  escalated:          'Escalated',
}

const TRIAGE_LABELS: Record<TriageCategory, string> = {
  quick_fix:        'Quick Fix',
  larger_revision:  'Larger Revision',
  start_over:       'Start Over',
  no_action_needed: 'No Action Needed',
}

const ALL_TRIAGE_CATEGORIES: TriageCategory[] = [
  'quick_fix', 'larger_revision', 'start_over', 'no_action_needed',
]

// ── Local types ───────────────────────────────────────────────────────────────

interface TriageItem {
  reply: StrategyMilestoneReply
  submissionId: string
  member: number
  churchName: string | null
  milestoneName: string | null
  milestoneSquad: string | null
  milestonePathway: string | null
  threadUrl: string | null
  markupAssetUrl: string | null
  // transient UI state after saving
  justTriaged?: TriageCategory
}

interface RecentItem {
  id: string
  member: number
  churchName: string | null
  milestoneName: string | null
  milestoneSquad: string | null
  milestoneStepNumber: number | null
  milestonePathway: string | null
  submittedAt: string
  status: SubmissionStatus
  milestoneStatus: MilestoneStatus
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── TriageDropdown ────────────────────────────────────────────────────────────

function TriageDropdown({
  replyId,
  current,
  onSave,
}: {
  replyId: string
  current: TriageCategory | null
  onSave: (replyId: string, category: TriageCategory | null) => Promise<void>
}) {
  const [pending, setPending] = useState<TriageCategory | null>(current)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = pending !== current

  const handlePush = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(replyId, pending)
    } catch (err) {
      setSaveError((err as { message?: string })?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-1.5">
        {saving && (
          <span className="h-3 w-3 rounded-full border border-lavender border-t-primary-purple animate-spin" />
        )}
        <select
          value={pending ?? ''}
          onChange={e => setPending(e.target.value === '' ? null : e.target.value as TriageCategory)}
          disabled={saving}
          className={`rounded-full border bg-white text-[11px] text-deep-plum px-2.5 py-0.5 outline-none focus:ring-1 disabled:opacity-60 cursor-pointer ${
            saveError
              ? 'border-red-400 focus:ring-red-200'
              : isDirty
              ? 'border-primary-purple focus:ring-primary-purple/30'
              : 'border-lavender focus:border-primary-purple focus:ring-primary-purple/30'
          }`}
        >
          <option value="">— Triage —</option>
          {ALL_TRIAGE_CATEGORIES.map(c => (
            <option key={c} value={c}>{TRIAGE_LABELS[c]}</option>
          ))}
        </select>
        {isDirty && !saving && (
          <button
            type="button"
            onClick={handlePush}
            className="rounded-full bg-primary-purple text-white text-[11px] font-semibold px-2.5 py-0.5 hover:bg-deep-plum transition-colors whitespace-nowrap"
          >
            Push →
          </button>
        )}
      </div>
      {saveError && (
        <span className="text-[10px] text-red-600">{saveError}</span>
      )}
    </div>
  )
}

// ── TriageCard ────────────────────────────────────────────────────────────────

function TriageCard({
  item,
  onSave,
}: {
  item: TriageItem
  onSave: (replyId: string, category: TriageCategory | null) => Promise<void>
}) {
  const navigate = useNavigate()
  const { reply } = item

  // Resolve the "open" URL for the reply
  const openUrl = reply.source === 'clickup_thread'
    ? (item.threadUrl ? item.threadUrl.replace(/\/t\/[^/]+$/, '') : null)
    : reply.source === 'markup_review'
    ? item.markupAssetUrl
    : null

  if (item.justTriaged) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 text-sm text-green-700">
        <CheckCircle2 size={15} className="shrink-0" />
        <span>
          Triaged as <strong>{TRIAGE_LABELS[item.justTriaged]}</strong>
          {' '}for{' '}
          <span className="font-medium">{item.churchName ?? `Member #${item.member}`}</span>
        </span>
      </div>
    )
  }

  return (
    <div className="bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/account/${item.member}`)}
            className="text-sm font-bold text-deep-plum hover:text-primary-purple transition-colors truncate block text-left"
          >
            {item.churchName ?? `Member #${item.member}`}
            <ChevronRight size={13} className="inline ml-0.5" />
          </button>
          {item.milestoneSquad && (
            <p className="text-[11px] text-purple-gray mt-0.5">
              <span className="font-semibold text-primary-purple">
                {SQUAD_LABELS[item.milestoneSquad] ?? item.milestoneSquad}
              </span>
              {item.milestonePathway && (
                <> · {PATHWAY_LABELS[item.milestonePathway] ?? item.milestonePathway}</>
              )}
              {item.milestoneName && (
                <> · {item.milestoneName}</>
              )}
            </p>
          )}
        </div>
        <span className="text-[10px] text-purple-gray shrink-0">
          {timeAgo(reply.detected_at)}
        </span>
      </div>

      {/* Reply body */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-semibold text-deep-plum">{reply.reply_author_name}</span>
          <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide">
            Partner
          </span>
          <span className="text-[10px] text-purple-gray">{formatDate(reply.detected_at)}</span>
        </div>

        <p className="text-sm text-deep-plum leading-relaxed line-clamp-4 whitespace-pre-wrap">
          {displayReplyText(reply.reply_text) || <span className="italic text-purple-gray/50">(empty reply)</span>}
        </p>
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-lavender bg-lavender-tint/30">
        <div className="flex items-center gap-2">
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-[11px] font-semibold text-deep-plum px-2.5 py-0.5 hover:bg-lavender-tint hover:border-primary-purple transition-colors"
            >
              Open in {reply.source === 'markup_review' ? 'MarkUp' : 'ClickUp'}
              <ExternalLink size={9} />
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate(`/account/${item.member}`)}
            className="inline-flex items-center gap-1 text-[11px] text-purple-gray hover:text-primary-purple transition-colors"
          >
            View Full Log
            <ChevronRight size={10} />
          </button>
        </div>
        <TriageDropdown
          replyId={reply.id}
          current={null}
          onSave={onSave}
        />
      </div>
    </div>
  )
}

// ── RecentRow (desktop) ───────────────────────────────────────────────────────

function RecentRow({ item, onClick }: { item: RecentItem; onClick: () => void }) {
  return (
    <tr
      className="border-b border-lavender hover:bg-lavender-tint/40 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <p className="text-sm font-semibold text-deep-plum truncate max-w-[180px]">
          {item.churchName ?? `Member #${item.member}`}
        </p>
        <p className="text-xs text-purple-gray">#{item.member}</p>
      </td>
      <td className="px-4 py-3">
        {item.milestoneSquad ? (
          <div>
            <span className="text-xs font-bold text-primary-purple">
              {SQUAD_LABELS[item.milestoneSquad] ?? item.milestoneSquad}
            </span>
            {item.milestonePathway && (
              <span className="text-xs text-purple-gray ml-1.5">
                {PATHWAY_LABELS[item.milestonePathway] ?? item.milestonePathway}
              </span>
            )}
            {item.milestoneName && (
              <p className="text-xs text-deep-plum mt-0.5">
                {item.milestoneStepNumber ? `Step ${item.milestoneStepNumber} — ` : ''}{item.milestoneName}
              </p>
            )}
          </div>
        ) : (
          <span className="text-xs text-purple-gray/50">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-purple-gray whitespace-nowrap">
        <span title={formatDate(item.submittedAt)}>{timeAgo(item.submittedAt)}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2 py-0.5 ${MILESTONE_STATUS_CLASSES[item.milestoneStatus]}`}>
          {MILESTONE_STATUS_LABELS[item.milestoneStatus]}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <ChevronRight size={14} className="text-purple-gray/40 ml-auto" />
      </td>
    </tr>
  )
}

// ── RecentCard (mobile) ───────────────────────────────────────────────────────

function RecentCard({ item, onClick }: { item: RecentItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white border border-lavender rounded-xl px-4 py-3 hover:border-primary-purple hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-semibold text-deep-plum text-sm truncate">
          {item.churchName ?? `Member #${item.member}`}
        </p>
        <span className={`shrink-0 inline-flex items-center rounded-full text-xs font-semibold px-2 py-0.5 ${MILESTONE_STATUS_CLASSES[item.milestoneStatus]}`}>
          {MILESTONE_STATUS_LABELS[item.milestoneStatus]}
        </span>
      </div>
      {item.milestoneSquad && (
        <p className="text-xs text-purple-gray mb-1">
          <span className="font-semibold text-primary-purple">{SQUAD_LABELS[item.milestoneSquad] ?? item.milestoneSquad}</span>
          {item.milestonePathway && <> · {PATHWAY_LABELS[item.milestonePathway] ?? item.milestonePathway}</>}
        </p>
      )}
      {item.milestoneName && (
        <p className="text-xs text-deep-plum truncate">
          {item.milestoneStepNumber ? `Step ${item.milestoneStepNumber} — ` : ''}{item.milestoneName}
        </p>
      )}
      <p className="text-xs text-purple-gray mt-1.5 flex items-center gap-1">
        <Clock size={10} />
        {timeAgo(item.submittedAt)}
      </p>
    </button>
  )
}

// ── RequiredReadingCard ───────────────────────────────────────────────────
//
// Compact card for a doc that's flagged as required reading and the
// signed-in user hasn't marked read yet. Lighter visual weight than the
// triage / action-item cards (these aren't time-pressured the same way)
// but still surfaces the verification badge so verified vs. needs-review
// reads at a glance.

function RequiredReadingCard({ doc }: { doc: DocHubEntry }) {
  return (
    <Link
      to={`/strategy/library/doc/${doc.id}`}
      className="block rounded-xl border border-lavender bg-white shadow-sm hover:border-primary-purple hover:shadow transition-all"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <BookOpen size={13} className="text-primary-purple shrink-0" />
            <p className="text-sm font-bold text-deep-plum truncate">
              {doc.title}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-purple-gray">
            <span className="inline-flex items-center rounded-full bg-primary-purple/10 text-primary-purple text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
              Required reading
            </span>
            {doc.types[0] && <span>{doc.types[0]}</span>}
            {doc.department && (
              <>
                <span className="text-purple-gray/70">·</span>
                <span className="capitalize">{doc.department}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-white border border-lavender text-[11px] font-semibold text-deep-plum px-2.5 py-0.5">
            Read now
            <ChevronRight size={10} />
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── ActionItemAttentionCard ───────────────────────────────────────────────
//
// Renders a single upcoming Action Item inside the Attention Needed
// panel. Tone tracks urgency: overdue (red), due today (blue), within
// 4 days (yellow), 5–14 days (neutral). Click navigates to the Action
// Item detail; a secondary chip routes to the parent initiative.

function ActionItemAttentionCard({ item }: { item: Milestone }) {
  const navigate = useNavigate()
  const diff = item.targetDate ? daysFromToday(item.targetDate) : null
  const tone = urgencyTone(diff)
  const initiativeId = item.initiativeIds[0] ?? null
  return (
    <div className={['rounded-xl border shadow-sm overflow-hidden', tone.cardClass].join(' ')}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate(`/strategy/action-items/${item.id}`)}
            className="text-sm font-bold text-deep-plum hover:text-primary-purple transition-colors truncate block text-left"
          >
            {item.name}
            <ChevronRight size={13} className="inline ml-0.5" />
          </button>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-purple-gray">
            <span className={['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tone.badgeClass].join(' ')}>
              <AlertTriangle size={9} />
              {tone.label}
            </span>
            {item.targetDate && (
              <span>{formatTargetDate(item.targetDate)}</span>
            )}
            {item.initiativeName && (
              <span className="text-purple-gray/70">·</span>
            )}
            {item.initiativeName && initiativeId && (
              <Link
                to={`/strategy/initiatives/${initiativeId}`}
                className="font-semibold text-primary-purple hover:text-deep-plum transition-colors"
              >
                {item.initiativeName}
              </Link>
            )}
          </div>
          {item.notes && (
            <p className="text-xs text-deep-plum mt-2 line-clamp-2 whitespace-pre-wrap">
              {item.notes}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            to={`/strategy/action-items/${item.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-white border border-lavender text-[11px] font-semibold text-deep-plum px-2.5 py-0.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
          >
            Open
            <ChevronRight size={10} />
          </Link>
          {initiativeId && (
            <Link
              to={`/strategy/initiatives/${initiativeId}`}
              className="inline-flex items-center gap-1 rounded-full bg-white border border-lavender text-[11px] font-semibold text-deep-plum px-2.5 py-0.5 hover:border-primary-purple hover:text-primary-purple transition-colors"
              title="Open parent initiative"
            >
              Initiative
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

interface UrgencyTone {
  label: string
  cardClass: string
  badgeClass: string
}

/** Map "days until due" to a tone. Aligns with MyActionItemsPage's
 *  `computeUrgency` so a user sees the same color-coding wherever an
 *  Action Item's date is rendered. */
function urgencyTone(diff: number | null): UrgencyTone {
  if (diff === null) {
    return {
      label: 'No date',
      cardClass: 'bg-white border-lavender',
      badgeClass: 'bg-lavender-tint text-purple-gray',
    }
  }
  if (diff < 0) {
    return {
      label: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'}`,
      cardClass: 'bg-red-50 border-red-300',
      badgeClass: 'bg-red-100 text-red-700',
    }
  }
  if (diff === 0) {
    return {
      label: 'Due today',
      cardClass: 'bg-blue-50 border-blue-300',
      badgeClass: 'bg-blue-100 text-blue-700',
    }
  }
  if (diff <= 4) {
    return {
      label: `Due in ${diff} day${diff === 1 ? '' : 's'}`,
      cardClass: 'bg-amber-50 border-amber-300',
      badgeClass: 'bg-amber-100 text-amber-700',
    }
  }
  return {
    label: `Due in ${diff} days`,
    cardClass: 'bg-white border-lavender',
    badgeClass: 'bg-lavender-tint text-purple-gray',
  }
}

/** ISO calendar date → days from local-midnight today. Splits the
 *  YYYY-MM-DD parts by hand and rebuilds via local Date so the count
 *  stays in calendar terms regardless of timezone (the `new Date(iso)`
 *  UTC-midnight trap would shift counts by a day west of UTC). */
function daysFromToday(iso: string): number {
  const parts = iso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 9999
  const target = new Date(parts[0], parts[1] - 1, parts[2])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function formatTargetDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return iso
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── WarningToast ──────────────────────────────────────────────────────────────

function WarningToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-300 shadow-lg px-4 py-3 max-w-sm w-full mx-4">
      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-800 flex-1">{message}</p>
      <button type="button" onClick={onDismiss} className="text-amber-600 hover:text-amber-800 transition-colors shrink-0">
        <X size={14} />
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyDashboardPage() {
  const navigate = useNavigate()
  const { staffProfile } = useAuth()

  const [triageItems, setTriageItems] = useState<TriageItem[]>([])
  const [recentItems, setRecentItems] = useState<RecentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [webhookWarning, setWebhookWarning] = useState<string | null>(null)
  const dismissWarning = useCallback(() => setWebhookWarning(null), [])

  // Strategy-side state. Never blocks the main dashboard render — if the
  // Notion integration isn't set up yet we just hide the new sections and
  // show an inline setup hint on the initiatives card.
  const [strategyBundle, setStrategyBundle] = useState<MyDashboardStrategyBundle | null>(null)
  const [yourInitiatives, setYourInitiatives] = useState<Initiative[]>([])
  const [strategySetupError, setStrategySetupError] = useState<StrategyNotionSetupError | null>(null)
  const [topPartners, setTopPartners] = useState<Array<{ member: number; churchName: string | null; count: number }>>([])
  // Upcoming Action Items — fed into the combined "Attention Needed"
  // panel below the stat tiles. Populated alongside the strategy bundle
  // so the user's Notion id is already resolved when filtering.
  const [myActionItems, setMyActionItems] = useState<Milestone[]>([])

  // Linked Library docs for the visible Recent Progress feed — same
  // bulk-lookup pattern the Initiative Detail / Progress page use.
  const recentProgressIds = (strategyBundle?.recentFeed ?? [])
    .filter(f => f.kind === 'progress-entry')
    .slice(0, 6)
    .map(f => f.id)
  const recentLinkedDocs = useLinkedDocsByProgressIds(recentProgressIds)

  // Library counters (Phase 3) — Verify Docs + Recent Updates depend on
  // Doc Hub + the current user's read receipts. Loaded in parallel with
  // the existing strategy bundle.
  const [libraryDocs, setLibraryDocs] = useState<DocHubEntry[]>([])
  const [verifierDefaults, setVerifierDefaults] = useState<VerifierDefault[]>([])
  const [myReadIds, setMyReadIds] = useState<Set<string>>(new Set())
  const [requiredReadingIds, setRequiredReadingIds] = useState<Set<string>>(new Set())

  const userEmail = staffProfile?.email ?? ''
  const displayName = staffProfile?.first_name ?? staffProfile?.full_name?.split(' ')[0] ?? staffProfile?.name ?? 'there'

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userEmail) return

    const load = async () => {
      try {
        // Step 1: My most recent submissions
        const { data: subData, error: subErr } = await supabase
          .from('strategy_milestone_submissions')
          .select('id, member, current_milestone_id, milestone_id, submitted_at, status, milestone_status, clickup_thread_url')
          .eq('submitted_by_email', userEmail)
          .eq('is_active', true)
          .order('submitted_at', { ascending: false })
          .limit(50)

        if (subErr) throw subErr

        const subs = (subData ?? []) as Array<{
          id: string
          member: number
          current_milestone_id: string
          milestone_id: string
          submitted_at: string
          status: SubmissionStatus
          milestone_status: MilestoneStatus
          clickup_thread_url: string | null
        }>

        if (subs.length === 0) {
          setLoading(false)
          return
        }

        const submissionIds = subs.map(s => s.id)
        const memberNums = [...new Set(subs.map(s => s.member))]
        const milestoneIds = [...new Set(
          subs.flatMap(s => [s.current_milestone_id, s.milestone_id].filter(Boolean)),
        )]

        // Step 2: Parallel fetch — partner names, milestone defs, untriaged replies, markup assets
        const [progressRes, defsRes, repliesRes, assetsRes] = await Promise.all([
          supabase
            .from('strategy_account_progress')
            .select('member, church_name')
            .in('member', memberNums),
          supabase
            .from('strategy_milestone_definitions')
            .select('id, squad, pathway, step_name, step_number')
            .in('id', milestoneIds),
          supabase
            .from('strategy_milestone_replies')
            .select('*')
            .in('submission_id', submissionIds)
            .eq('is_partner_reply', true)
            .is('triage_category', null)
            // Folder children are auto-triaged; only show top-level rows
            // (individual replies + markup folders) in needs-attention.
            .is('folder_id', null)
            .order('detected_at', { ascending: false }),
          supabase
            .from('strategy_submission_assets')
            .select('submission_id, asset_type, asset_url')
            .in('submission_id', submissionIds)
            .eq('asset_type', 'markup_review'),
        ])

        // Build lookup maps
        const churchMap = new Map<number, string | null>()
        for (const p of (progressRes.data ?? []) as { member: number; church_name: string | null }[]) {
          churchMap.set(p.member, p.church_name)
        }

        const defMap = new Map<string, { squad: string; pathway: string; step_name: string; step_number: number }>()
        for (const d of (defsRes.data ?? []) as { id: string; squad: string; pathway: string; step_name: string; step_number: number }[]) {
          defMap.set(d.id, d)
        }

        const markupMap = new Map<string, string>()
        for (const a of (assetsRes.data ?? []) as { submission_id: string; asset_type: string; asset_url: string }[]) {
          markupMap.set(a.submission_id, a.asset_url)
        }

        const subMap = new Map(subs.map(s => [s.id, s]))

        // ── Build triage items ──────────────────────────────────────────────
        const replies = (repliesRes.data ?? []) as StrategyMilestoneReply[]
        const triage: TriageItem[] = replies.map(reply => {
          const sub = subMap.get(reply.submission_id)
          const def = sub ? defMap.get(sub.current_milestone_id) : null
          return {
            reply,
            submissionId: reply.submission_id,
            member: sub?.member ?? 0,
            churchName: sub ? (churchMap.get(sub.member) ?? null) : null,
            milestoneName: def?.step_name ?? null,
            milestoneSquad: def?.squad ?? null,
            milestonePathway: def?.pathway ?? null,
            threadUrl: sub?.clickup_thread_url ?? null,
            markupAssetUrl: markupMap.get(reply.submission_id) ?? null,
          }
        })

        // ── Build recent items (first 15) ───────────────────────────────────
        const recent: RecentItem[] = subs.slice(0, 5).map(s => {
          const def = defMap.get(s.current_milestone_id)
          return {
            id: s.id,
            member: s.member,
            churchName: churchMap.get(s.member) ?? null,
            milestoneName: def?.step_name ?? null,
            milestoneSquad: def?.squad ?? null,
            milestonePathway: def?.pathway ?? null,
            milestoneStepNumber: def?.step_number ?? null,
            submittedAt: s.submitted_at,
            status: s.status,
            milestoneStatus: s.milestone_status,
          }
        })

        setTriageItems(triage)
        setRecentItems(recent)

        // ── Top partners — computed from the same submissions query,
        // grouped by member and sorted by frequency (top 5). ─────────────
        const counts = new Map<number, number>()
        for (const s of subs) counts.set(s.member, (counts.get(s.member) ?? 0) + 1)
        const top = [...counts.entries()]
          .map(([member, count]) => ({
            member,
            churchName: churchMap.get(member) ?? null,
            count,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
        setTopPartners(top)
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [userEmail])

  // ── Strategy bundle + your initiatives + your action items ───────────────
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getMyDashboardStrategy().catch(err => err),
      listInitiatives().catch(err => err),
      listMilestones().catch(err => err),
    ]).then(([bundleResult, initsResult, milesResult]) => {
      if (cancelled) return
      if (isSetupError(bundleResult)) {
        setStrategySetupError(bundleResult)
        return
      }
      if (bundleResult && typeof bundleResult === 'object' && !('error' in bundleResult)) {
        setStrategyBundle(bundleResult as MyDashboardStrategyBundle)
      }
      const ownerId = (bundleResult as MyDashboardStrategyBundle)?.stats?.notionUserId
      if (Array.isArray(initsResult)) {
        // Filter to initiatives owned by the logged-in user via the
        // `notionUserId` the bundle resolved from JWT email.
        const mine = ownerId
          ? (initsResult as Initiative[]).filter(i => i.owner?.id === ownerId)
          : []
        setYourInitiatives(mine.slice(0, 4))
      }
      if (Array.isArray(milesResult) && ownerId) {
        // Filter to *my* open action items — the AttentionPanel does the
        // urgency window (within 14 days OR overdue) when rendering so
        // we keep the full open set here for any future surface.
        const mine = (milesResult as Milestone[]).filter(m =>
          m.owner?.id === ownerId &&
          m.status !== 'complete' &&
          m.status !== 'skipped',
        )
        setMyActionItems(mine)
      }
    })
    return () => { cancelled = true }
  }, [userEmail])

  // ── Library: docs + verifier defaults + my reads ─────────────────────────
  // Drives the new "Verify Docs" and "Recent Updates" stat tiles. Failures
  // are silent — the tiles render "—" and the rest of the dashboard works.
  useEffect(() => {
    if (!staffProfile?.id) return
    let cancelled = false
    const employeeId = staffProfile.id as string
    Promise.allSettled([
      listDocs(),
      listVerifierDefaults(),
      listMyReads(employeeId),
      listRequiredReading(),
    ]).then(([docsR, defaultsR, readsR, requiredR]) => {
      if (cancelled) return
      if (docsR.status === 'fulfilled') setLibraryDocs(docsR.value)
      if (defaultsR.status === 'fulfilled') setVerifierDefaults(defaultsR.value)
      if (readsR.status === 'fulfilled') setMyReadIds(readsR.value)
      if (requiredR.status === 'fulfilled') setRequiredReadingIds(requiredR.value)
    })
    return () => { cancelled = true }
  }, [staffProfile?.id])

  // ── Triage save ─────────────────────────────────────────────────────────────
  const handleTriageSave = async (replyId: string, category: TriageCategory | null) => {
    // 1. Save to Supabase
    const { data: updated, error: updateErr } = await supabase
      .from('strategy_milestone_replies')
      .update({ triage_category: category })
      .eq('id', replyId)
      .select('id')
      .maybeSingle()

    if (updateErr) throw new Error(updateErr.message)
    if (!updated) throw new Error('Triage save was blocked — RLS policy may be missing.')

    // 2. Optimistically mark as triaged then remove after brief delay
    setTriageItems(prev => prev.map(item =>
      item.reply.id === replyId
        ? { ...item, justTriaged: category ?? undefined }
        : item,
    ))
    setTimeout(() => {
      setTriageItems(prev => prev.filter(item => item.reply.id !== replyId))
    }, 1800)

    // 3. Fire n8n webhook (best-effort)
    if (category && category !== 'no_action_needed') {
      const item = triageItems.find(i => i.reply.id === replyId)
      const payload = {
        triage_category:  category,
        reply_id:         replyId,
        submission_id:    item?.submissionId ?? null,
        member:           item?.member ?? null,
        church_name:      item?.churchName ?? null,
        milestone_name:   item?.milestoneName ?? null,
        squad:            item?.milestoneSquad ?? null,
        reply_text:       item?.reply.reply_text ?? null,
        reply_author:     item?.reply.reply_author_name ?? null,
        triaged_by:       staffProfile?.full_name ?? staffProfile?.name ?? null,
      }

      fetch(N8N_TRIAGE_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        setWebhookWarning('Triage saved but the webhook notification failed.')
      }).then(res => {
        if (res && !res.ok) {
          setWebhookWarning('Triage saved but the webhook notification failed.')
        }
      })
    }
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-3xl mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-lavender rounded-xl p-4 animate-pulse space-y-3">
            <div className="h-4 w-48 bg-lavender/50 rounded" />
            <div className="h-3 w-64 bg-lavender/30 rounded" />
            <div className="h-14 bg-lavender/20 rounded-lg" />
            <div className="h-3 w-32 bg-lavender/30 rounded" />
          </div>
        ))}
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-6 py-6 max-w-5xl mx-auto pb-20">

      {/* Page header */}
      <div className="mb-6">
        <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">My Dashboard</p>
        <h1 className="text-2xl font-semibold text-deep-plum">
          Welcome back, <em>{displayName}</em>
        </h1>
        {triageItems.length > 0 && (
          <p className="text-sm text-purple-gray mt-1">
            You have{' '}
            <span className="font-semibold text-blue-700">{triageItems.length} partner {triageItems.length === 1 ? 'reply' : 'replies'}</span>{' '}
            waiting for triage.
          </p>
        )}
      </div>

      {/* ── Stats row (Phase 3 — replaces Active Churches/Your Initiatives) ─ */}
      {(() => {
        // Verify Docs: docs awaiting verification AND active verifier === me.
        // Staff who aren't director/VP get a muted tile.
        // Role is derived from authoritative sources, not the free-text
        // `employees.role` column (which is "employee" everywhere): VP via
        // hardcoded email, Director via membership in verifier_defaults.
        const myEmpId = staffProfile?.id ?? null
        const isVP = isVPByEmail(staffProfile?.email ?? null)
        const isDirector = isVP || isDirectorByEmployeeId(myEmpId, verifierDefaults)

        const verifyCount = (() => {
          if (!isDirector || !myEmpId) return 0
          if (isVP) {
            return libraryDocs.filter(d => d.verificationStatus === 'needs-verification').length
          }
          const myStrategyDept = employeeDepartmentToStrategy(staffProfile?.department ?? null)
          if (!myStrategyDept) return 0
          return libraryDocs.filter(d => {
            if (d.verificationStatus !== 'needs-verification') return false
            if (!d.department) return false
            const v = resolveVerifier(verifierDefaults, d.department)
            return v?.employeeId === myEmpId
          }).length
        })()

        // Initiative Check-Ins: VPs see the global count, staff see only
        // initiatives they own that are overdue.
        const checkInCount = isVP
          ? strategyBundle?.stats.needsCheckInCount
          : strategyBundle?.stats.myNeedsCheckInCount

        // Recent Updates: docs verified in the last 14 days that I haven't
        // read yet. Falls back to verified docs the user hasn't marked read.
        // Match the Library Recent Updates page: 7-day window + dept
        // gating so the dashboard counter agrees with the list the user
        // sees when they click into the tile.
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const myStrategyDept = employeeDepartmentToStrategy(staffProfile?.department ?? null)
        const recentUnread = libraryDocs.filter(d => {
          if (d.verificationStatus !== 'verified') return false
          if ((d.lastEditedTime ?? '') < sevenDaysAgo) return false
          if (myReadIds.has(d.id)) return false
          if (isVP) return true
          if (d.department === 'all-in') return true
          return myStrategyDept ? d.department === myStrategyDept : true
        }).length

        return (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard
              icon={MessageSquare}
              label="Triage Replies"
              value={triageItems.length}
              to="#needs-triage"
              alert={triageItems.length > 0}
            />
            <StatCard
              icon={CheckCircle2}
              label="Verify Docs"
              value={isDirector ? verifyCount : 0}
              to="/strategy/library/queue"
              alert={isDirector && verifyCount > 0}
              mutedLabel={!isDirector ? 'Not your queue' : undefined}
            />
            <StatCard
              icon={AlertTriangle}
              label="Initiative Check-Ins"
              value={checkInCount}
              to="/strategy/initiatives"
              disabled={strategySetupError !== null}
            />
            <StatCard
              icon={Activity}
              label="Recent Updates"
              value={recentUnread}
              to="/strategy/library/recent"
              disabled={strategySetupError !== null}
              mutedLabel={recentUnread === 0 ? 'Up to date' : undefined}
            />
          </section>
        )
      })()}

      {/* ── Attention Needed (triage + required reading + upcoming action items) ── */}
      {(() => {
        // Action items show when within 14 days of due OR overdue. Past
        // that window they're noise on the dashboard — they live in
        // /strategy/action-items for full triage.
        const upcomingActionItems = myActionItems
          .filter(m => m.targetDate && daysFromToday(m.targetDate) <= 14)
          .sort((a, b) => (a.targetDate ?? '').localeCompare(b.targetDate ?? ''))
        // Required-reading docs the user hasn't marked read. Cap at 5 on
        // the dashboard so a long backlog doesn't drown out triage and
        // due-soon work — the panel header links into the Library where
        // the full set is browsable.
        const requiredUnread = libraryDocs
          .filter(d => requiredReadingIds.has(d.id) && !myReadIds.has(d.id))
          .sort((a, b) => a.title.localeCompare(b.title))
        const requiredUnreadVisible = requiredUnread.slice(0, 5)
        const requiredUnreadHidden = Math.max(0, requiredUnread.length - requiredUnreadVisible.length)
        // Order: triage (blocked work) → required reading (foundational
        // context) → upcoming action items (your active work). Triage
        // ALWAYS first per spec; the rest fall in this rough urgency
        // hierarchy — reading you owe before doing the work, then the
        // work itself.
        const totalCount = triageItems.length + requiredUnread.length + upcomingActionItems.length
        return (
          <section id="attention-needed" className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={15} className="text-primary-purple" />
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Attention Needed</h2>
              {totalCount > 0 && (
                <span className="rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">
                  {totalCount}
                </span>
              )}
              {upcomingActionItems.length > 0 && (
                <Link
                  to="/strategy/action-items"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:text-deep-plum"
                >
                  View all action items
                  <ChevronRight size={11} />
                </Link>
              )}
            </div>

            {totalCount === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-lavender bg-white px-6 py-10 text-center">
                <CheckCircle2 size={28} className="text-green-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-deep-plum">You're all caught up!</p>
                <p className="text-xs text-purple-gray mt-1">No partner replies to triage, no required reading outstanding, and nothing due in the next 14 days.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Triage items always come first — blocked work. */}
                {triageItems.map(item => (
                  <TriageCard
                    key={item.reply.id}
                    item={item}
                    onSave={handleTriageSave}
                  />
                ))}
                {requiredUnread.length > 0 && (
                  <>
                    {triageItems.length > 0 && (
                      <div className="flex items-center gap-2 pt-1">
                        <div className="h-px flex-1 bg-lavender/60" />
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-purple-gray">
                          Required reading ({requiredUnread.length})
                        </span>
                        <div className="h-px flex-1 bg-lavender/60" />
                      </div>
                    )}
                    {requiredUnreadVisible.map(doc => (
                      <RequiredReadingCard key={doc.id} doc={doc} />
                    ))}
                    {requiredUnreadHidden > 0 && (
                      <Link
                        to="/strategy/library/recent"
                        className="block text-center rounded-xl border border-dashed border-lavender bg-white px-4 py-3 text-xs font-semibold text-primary-purple hover:bg-lavender-tint/30 hover:border-primary-purple transition-colors"
                      >
                        +{requiredUnreadHidden} more required doc{requiredUnreadHidden === 1 ? '' : 's'} to read
                        <ChevronRight size={11} className="inline ml-0.5" />
                      </Link>
                    )}
                  </>
                )}
                {upcomingActionItems.length > 0 && (
                  <>
                    {(triageItems.length > 0 || requiredUnread.length > 0) && (
                      <div className="flex items-center gap-2 pt-1">
                        <div className="h-px flex-1 bg-lavender/60" />
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-purple-gray">
                          Upcoming action items
                        </span>
                        <div className="h-px flex-1 bg-lavender/60" />
                      </div>
                    )}
                    {upcomingActionItems.map(item => (
                      <ActionItemAttentionCard key={item.id} item={item} />
                    ))}
                  </>
                )}
              </div>
            )}
          </section>
        )
      })()}

      {/* ── Recently Submitted ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={15} className="text-primary-purple" />
          <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Recently Submitted</h2>
          {recentItems.length > 0 && (
            <span className="rounded-full bg-lavender text-purple-gray text-xs font-medium px-2 py-0.5">
              Last {recentItems.length}
            </span>
          )}
        </div>

        {recentItems.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-lavender bg-white px-6 py-10 text-center">
            <Send size={28} className="text-lavender mx-auto mb-2" />
            <p className="text-sm font-semibold text-deep-plum">No milestone submissions yet.</p>
            <p className="text-xs text-purple-gray mt-1 mb-4">Your submitted milestones will appear here.</p>
            <button
              onClick={() => navigate('/submit')}
              className="inline-flex items-center gap-2 rounded-full bg-deep-plum text-white text-sm font-medium px-5 py-2 hover:bg-primary-purple transition-colors"
            >
              Send your first milestone →
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white border border-lavender rounded-xl overflow-hidden shadow-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-lavender bg-lavender-tint/40">
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold text-purple-gray uppercase tracking-wide">Partner</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold text-purple-gray uppercase tracking-wide">Milestone</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold text-purple-gray uppercase tracking-wide">Submitted</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold text-purple-gray uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {recentItems.map(item => (
                    <RecentRow
                      key={item.id}
                      item={item}
                      onClick={() => navigate(`/account/${item.member}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {recentItems.map(item => (
                <RecentCard
                  key={item.id}
                  item={item}
                  onClick={() => navigate(`/account/${item.member}`)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Recent Progress (Strategy) ──────────────────────────────────────── */}
      {/* Both the section header and a footer link route to the full
          Progress page. Inner cards remain individually clickable to
          their related initiative — wrapping the whole list in a single
          Link would nest anchors and break that. */}
      {strategyBundle && strategyBundle.recentFeed.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center justify-between gap-2 mb-3">
            <Link
              to="/strategy/progress"
              className="flex items-center gap-2 hover:text-primary-purple transition-colors"
            >
              <Activity size={15} className="text-primary-purple" />
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">
                Recent Progress
              </h2>
            </Link>
            <Link
              to="/strategy/progress"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:text-deep-plum transition-colors"
            >
              View all
              <ChevronRight size={11} />
            </Link>
          </div>
          <div className="rounded-2xl border border-lavender bg-white px-5 shadow-sm">
            {strategyBundle.recentFeed.slice(0, 6).map(item =>
              item.kind === 'progress-entry'
                ? <ProgressEntryItem
                    key={item.id}
                    entry={item}
                    linkedDocs={recentLinkedDocs.get(item.id)}
                  />
                : <MilestoneEventItem key={item.id} event={item} />
            )}
            <Link
              to="/strategy/progress"
              className="flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-primary-purple hover:text-deep-plum hover:bg-lavender-tint/30 transition-colors border-t border-lavender/60"
            >
              View full Progress feed
              <ChevronRight size={12} />
            </Link>
          </div>
        </section>
      )}

      {/* ── Bottom grid: Initiatives / Tools + Top partners ───────────────────── */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Target size={15} className="text-primary-purple" />
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">
                Your Initiatives
              </h2>
            </div>
            <Link
              to="/strategy/initiatives"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:text-deep-plum transition-colors"
            >
              All initiatives
              <ChevronRight size={11} />
            </Link>
          </div>
          {strategySetupError ? (
            <div className="rounded-2xl border border-lavender bg-white p-4 text-xs text-purple-gray">
              Strategy data not connected yet — visit the Strategy section to
              finish Notion setup.
            </div>
          ) : yourInitiatives.length === 0 ? (
            <div className="rounded-2xl border border-lavender bg-white p-4 text-xs text-purple-gray italic">
              You aren't listed as Owner on any active initiatives.
            </div>
          ) : (
            <div className="space-y-2.5">
              {yourInitiatives.map(i => <InitiativeCard key={i.id} initiative={i} />)}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Wrench size={15} className="text-primary-purple" />
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">
                Frequently Used Tools
              </h2>
            </div>
            <div className="rounded-2xl border border-lavender bg-white p-2 shadow-sm divide-y divide-lavender/60">
              <ToolLinkRow to="/submit" icon={Send} label="Submit Milestone" />
              <ToolLinkRow to="/social/srp" icon={Sparkles} label="SRP Generator" />
              <ToolLinkRow to="/social/intel" icon={Search} label="Intel Audit Tool" />
              <ToolLinkRow to="/branding" icon={Wrench} label="Brand Handoffs" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={15} className="text-primary-purple" />
              <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">
                Your Top Partners
              </h2>
            </div>
            {topPartners.length === 0 ? (
              <div className="rounded-2xl border border-lavender bg-white p-4 text-xs text-purple-gray italic">
                No recent submissions yet.
              </div>
            ) : (
              <div className="rounded-2xl border border-lavender bg-white p-2 shadow-sm divide-y divide-lavender/60">
                {topPartners.map(p => (
                  <button
                    key={p.member}
                    type="button"
                    onClick={() => navigate(`/account/${p.member}`)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-lavender-tint/50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-deep-plum font-medium truncate">
                        {p.churchName ?? `Member #${p.member}`}
                      </p>
                      <p className="text-[11px] text-purple-gray">
                        {p.count} submission{p.count === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ChevronRight size={13} className="text-purple-gray/40 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Toast */}
      {webhookWarning && (
        <WarningToast message={webhookWarning} onDismiss={dismissWarning} />
      )}
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, to, disabled, alert, mutedLabel }: {
  icon: typeof Target
  label: string
  value: number | null | undefined
  to: string
  disabled?: boolean
  /** Render the count in alert red — for "someone is waiting on you" tiles. */
  alert?: boolean
  /** Optional secondary label rendered below the count (e.g. "Up to date",
   *  "Not your queue") — replaces the count visual emphasis. */
  mutedLabel?: string
}) {
  const display = value === null || value === undefined ? '—' : String(value)
  const countClass = alert
    ? 'text-2xl font-semibold leading-none text-[var(--color-priority-high)]'
    : 'text-2xl font-semibold leading-none text-deep-plum'
  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className={alert ? 'text-[var(--color-priority-high)]' : 'text-primary-purple'} />
        <p className="text-[10px] font-bold text-deep-plum uppercase tracking-widest truncate">
          {label}
        </p>
      </div>
      <p className={countClass}>{display}</p>
      {mutedLabel && (
        <p className="text-[11px] text-purple-gray mt-0.5">{mutedLabel}</p>
      )}
    </>
  )
  const base = 'block rounded-2xl border border-lavender bg-white p-3 shadow-sm'
  if (disabled || to.startsWith('#')) {
    const href = disabled ? undefined : to
    return href ? (
      <a href={href} className={`${base} hover:border-primary-purple/40 transition-colors`}>
        {body}
      </a>
    ) : (
      <div className={`${base} opacity-70`}>{body}</div>
    )
  }
  return (
    <Link to={to} className={`${base} hover:border-primary-purple/40 transition-colors`}>
      {body}
    </Link>
  )
}

function ToolLinkRow({ to, icon: Icon, label }: {
  to: string
  icon: typeof Target
  label: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 px-3 py-2.5 text-sm text-deep-plum hover:bg-lavender-tint/50 transition-colors"
    >
      <Icon size={14} className="text-primary-purple" />
      <span className="flex-1">{label}</span>
      <ChevronRight size={13} className="text-purple-gray/40" />
    </Link>
  )
}
