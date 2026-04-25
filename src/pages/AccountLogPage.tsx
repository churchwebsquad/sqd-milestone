import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, ChevronDown, ChevronRight, Copy, Check, AlertTriangle, Link, MessageSquare, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { displayReplyText } from '../lib/replyDisplay'
import { useAuth } from '../contexts/AuthContext'
import type {
  StrategyMilestoneDefinition,
  StrategyMilestoneSubmission,
  StrategySubmissionAsset,
  StrategyMilestoneReply,
  MilestoneStatus,
  TriageCategory,
} from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS, ASSET_TYPE_LABELS } from '../components/submit/types'

const N8N_TRIAGE_PROXY = '/api/webhook/reply-triage'

// ── Constants ─────────────────────────────────────────────────────────────────

const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  sent:               'Sent',
  waiting_on_partner: 'Waiting on Partner',
  partner_replied:    'Partner Replied',
  in_revision:        'In Revision',
  approved:           'Approved',
  escalated:          'Escalated',
}

const MILESTONE_STATUS_CLASSES: Record<MilestoneStatus, string> = {
  sent:               'bg-primary-purple/10 text-primary-purple',
  waiting_on_partner: 'bg-amber-100 text-amber-700',
  partner_replied:    'bg-blue-100 text-blue-700',
  in_revision:        'bg-amber-100 text-amber-800',
  approved:           'bg-green-100 text-green-700',
  escalated:          'bg-red-100 text-red-700',
}

const TRIAGE_LABELS: Record<TriageCategory, string> = {
  quick_fix:        'Quick Fix',
  larger_revision:  'Larger Revision',
  start_over:       'Start Over',
  no_action_needed: 'No Action Needed',
}

const ALL_MILESTONE_STATUSES: MilestoneStatus[] = [
  'sent',
  'waiting_on_partner',
  'partner_replied',
  'in_revision',
  'approved',
  'escalated',
]

const ALL_TRIAGE_CATEGORIES: TriageCategory[] = [
  'quick_fix',
  'larger_revision',
  'start_over',
  'no_action_needed',
]

// ── Local types ───────────────────────────────────────────────────────────────

interface PartnerInfo {
  member: number
  church_name: string | null
  first_name_of_primary: string | null
  css_rep: string | null
  portal_token: string | null
}

interface EnrichedSubmission {
  submission: StrategyMilestoneSubmission
  milestone: StrategyMilestoneDefinition | null
  currentMilestone: StrategyMilestoneDefinition | null
  nextMilestone: StrategyMilestoneDefinition | null
  assets: StrategySubmissionAsset[]
  replies: StrategyMilestoneReply[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── DeliveryBadge — shows ClickUp send status (sent/failed) ──────────────────

function DeliveryBadge({ status }: { status: string }) {
  return status === 'sent' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-0.5">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Delivered
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-0.5">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Failed
    </span>
  )
}

// ── MilestoneStatusBadge — shows workflow status ──────────────────────────────

function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full text-xs font-semibold px-2.5 py-0.5 ${MILESTONE_STATUS_CLASSES[status]}`}
    >
      {MILESTONE_STATUS_LABELS[status]}
    </span>
  )
}

// ── MilestoneStatusDropdown — allows manual status change ────────────────────

function MilestoneStatusDropdown({
  submissionId,
  currentStatus,
  onChange,
}: {
  submissionId: string
  currentStatus: MilestoneStatus
  onChange: (id: string, status: MilestoneStatus) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as MilestoneStatus
    if (next === currentStatus) return
    setSaving(true)
    try {
      await onChange(submissionId, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative inline-flex items-center gap-1">
      {saving && (
        <span className="h-3 w-3 rounded-full border border-lavender border-t-primary-purple animate-spin" />
      )}
      <select
        value={currentStatus}
        onChange={handleChange}
        disabled={saving}
        onClick={e => e.stopPropagation()}
        className="rounded-lg border border-lavender bg-white text-xs text-deep-plum px-2 py-1 pr-5 outline-none focus:border-primary-purple focus:ring-1 focus:ring-primary-purple/30 disabled:opacity-60 cursor-pointer appearance-none"
        style={{ backgroundImage: 'none' }}
      >
        {ALL_MILESTONE_STATUSES.map(s => (
          <option key={s} value={s}>{MILESTONE_STATUS_LABELS[s]}</option>
        ))}
      </select>
    </div>
  )
}

// ── TriageDropdown ────────────────────────────────────────────────────────────

function TriageDropdown({
  replyId,
  current: currentCategory,
  onSave,
}: {
  replyId: string
  current: TriageCategory | null
  onSave: (replyId: string, category: TriageCategory | null) => Promise<void>
}) {
  const [pending, setPending] = useState<TriageCategory | null>(currentCategory)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = pending !== currentCategory

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
              ? 'border-red-400 focus:border-red-400 focus:ring-red-200'
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

// ── ReplyThread ───────────────────────────────────────────────────────────────

/** Strips the /t/{messageId} suffix from a ClickUp thread URL to get the channel URL. */
function channelUrlFromThread(threadUrl: string | null): string | null {
  if (!threadUrl) return null
  const idx = threadUrl.lastIndexOf('/t/')
  return idx !== -1 ? threadUrl.slice(0, idx) : threadUrl
}

const SOURCE_LABELS: Record<string, string> = {
  clickup_thread: 'ClickUp Chat',
  markup_review:  'MarkUp',
}

function ReplyThread({
  replies,
  submissionThreadUrl,
  assets,
  onTriageSave,
}: {
  replies: StrategyMilestoneReply[]
  submissionThreadUrl: string | null
  assets: StrategySubmissionAsset[]
  onTriageSave: (replyId: string, category: TriageCategory | null) => Promise<void>
}) {
  if (replies.length === 0) return null

  const channelUrl  = channelUrlFromThread(submissionThreadUrl)
  const markupAsset = assets.find(a => a.asset_type === 'markup_review')

  // Group children under their folders. Everything else renders standalone.
  // Display order preserves detected_at on the top-level rows (folder OR
  // standalone reply), so a markup folder that received its first comment
  // on Monday sits before a ClickUp reply from Tuesday.
  const childrenByFolder = new Map<string, StrategyMilestoneReply[]>()
  for (const r of replies) {
    if (r.folder_id) {
      const arr = childrenByFolder.get(r.folder_id) ?? []
      arr.push(r)
      childrenByFolder.set(r.folder_id, arr)
    }
  }
  const topLevel = replies.filter(r => !r.folder_id)

  return (
    <div className="space-y-3">
      {topLevel.map(reply => {
        const openUrl = reply.source === 'clickup_thread'
          ? channelUrl
          : reply.source === 'markup_review'
            ? (markupAsset?.asset_url ?? null)
            : null

        const children = reply.is_folder ? (childrenByFolder.get(reply.id) ?? []) : []

        return (
          <ReplyCard
            key={reply.id}
            reply={reply}
            openUrl={openUrl}
            onTriageSave={onTriageSave}
            children={children}
            markupUrl={markupAsset?.asset_url ?? null}
          />
        )
      })}
    </div>
  )
}

/** Single reply card — handles standalone rows and folder rows. For folder
 *  rows, children render collapsed behind a toggle so the thread stays scannable
 *  when a review has 20+ markup comments. */
function ReplyCard({
  reply, openUrl, onTriageSave, children, markupUrl,
}: {
  reply: StrategyMilestoneReply
  openUrl: string | null
  onTriageSave: (replyId: string, category: TriageCategory | null) => Promise<void>
  children: StrategyMilestoneReply[]
  markupUrl: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isFolder = reply.is_folder
  const childCount = children.length

  return (
    <div className={`rounded-lg px-3 py-2.5 border ${
      reply.is_partner_reply ? 'bg-blue-50 border-blue-200' : 'bg-lavender-tint/50 border-lavender'
    }`}>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-deep-plum truncate">
            {isFolder ? `MarkUp bulk · ${childCount} comment${childCount === 1 ? '' : 's'}` : reply.reply_author_name}
          </span>
          {reply.is_partner_reply && !isFolder && (
            <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide shrink-0">
              Partner
            </span>
          )}
          {reply.source && SOURCE_LABELS[reply.source] && (
            <span className="inline-flex items-center rounded-full bg-primary-purple/10 text-primary-purple text-[10px] font-bold px-1.5 py-0.5 shrink-0">
              {SOURCE_LABELS[reply.source]}
            </span>
          )}
          {isFolder && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 shrink-0 uppercase tracking-wide">
              Bulk
            </span>
          )}
          <span className="text-[10px] text-purple-gray shrink-0">
            {formatDateShort(reply.detected_at)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-[11px] font-semibold text-deep-plum px-2.5 py-0.5 hover:bg-lavender-tint hover:border-primary-purple transition-colors"
            >
              Open Link
              <ExternalLink size={9} />
            </a>
          )}
          {reply.is_partner_reply && (
            <TriageDropdown
              replyId={reply.id}
              current={reply.triage_category}
              onSave={onTriageSave}
            />
          )}
        </div>
      </div>

      {/* Body — folder shows collapsed summary + expand toggle; standalone shows text */}
      {isFolder ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] font-semibold text-primary-purple hover:text-deep-plum mt-1 inline-flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'} {childCount} comment{childCount === 1 ? '' : 's'}
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-blue-200">
              {children
                .slice()
                .sort((a, b) => a.detected_at.localeCompare(b.detected_at))
                .map(c => (
                  <div key={c.id} className="bg-white/60 rounded px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[11px] font-semibold text-deep-plum">{c.reply_author_name}</span>
                      <span className="text-[10px] text-purple-gray">{formatDateShort(c.detected_at)}</span>
                      {markupUrl && (
                        <a
                          href={markupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-[10px] text-primary-purple hover:underline inline-flex items-center gap-0.5"
                        >
                          Open
                          <ExternalLink size={8} />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-deep-plum leading-relaxed whitespace-pre-wrap">
                      {displayReplyText(c.reply_text) || <span className="italic text-purple-gray/60">(empty)</span>}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-deep-plum leading-relaxed whitespace-pre-wrap">
          {displayReplyText(reply.reply_text) || <span className="italic text-purple-gray/60">(empty)</span>}
        </p>
      )}

      {reply.triage_category && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide">
            Triaged: {TRIAGE_LABELS[reply.triage_category]}
          </p>
          {reply.edit_task_url && reply.triage_category !== 'no_action_needed' && (
            <a
              href={reply.edit_task_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-[11px] font-semibold text-deep-plum px-2.5 py-0.5 hover:bg-lavender-tint hover:border-primary-purple transition-colors"
            >
              View Task
              <ExternalLink size={9} />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy to clipboard"
      className="inline-flex items-center gap-1 text-xs text-purple-gray hover:text-primary-purple transition-colors"
    >
      {copied ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── SubmissionCard ────────────────────────────────────────────────────────────

function SubmissionCard({
  enriched,
  allSubmissions,
  onStatusChange,
  onTriageSave,
}: {
  enriched: EnrichedSubmission
  allSubmissions: EnrichedSubmission[]
  onStatusChange: (id: string, status: MilestoneStatus) => Promise<void>
  onTriageSave: (replyId: string, submissionId: string, category: TriageCategory | null) => Promise<void>
}) {
  const { submission, milestone, currentMilestone, nextMilestone, assets, replies } = enriched
  const [messageOpen, setMessageOpen] = useState(false)
  const [repliesOpen, setRepliesOpen] = useState(
    submission.milestone_status === 'partner_replied',
  )

  const continuationSource =
    submission.is_continuation && submission.continuation_of
      ? allSubmissions.find(e => e.submission.id === submission.continuation_of)
      : null

  // For counts we only consider "top-level" replies — folder children are
  // already auto-triaged to 'no_action_needed' and don't represent user work.
  const partnerReplies = replies.filter(r => r.is_partner_reply && !r.folder_id)
  const untriagedCount = partnerReplies.filter(r => r.triage_category === null).length

  return (
    <div className="bg-white border border-lavender rounded-xl shadow-sm overflow-hidden">
      {/* Card header ─────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 bg-lavender-tint/50 border-b border-lavender">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {milestone && (
              <>
                <span className="text-xs font-bold text-primary-purple uppercase tracking-wide">
                  {SQUAD_LABELS[milestone.squad] ?? milestone.squad}
                </span>
                <span className="text-purple-gray/40 text-xs">·</span>
                <span className="text-xs text-purple-gray">
                  {PATHWAY_LABELS[milestone.pathway] ?? milestone.pathway}
                </span>
              </>
            )}
            {submission.is_continuation && (
              <span className="rounded-full bg-primary-purple/10 text-primary-purple text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
                Continuation
              </span>
            )}
            {submission.track_name && (
              <span className="rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
                {submission.track_name}
              </span>
            )}
          </div>
          <span className="text-xs text-purple-gray">{formatDateTime(submission.submitted_at)}</span>
        </div>

        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <MilestoneStatusBadge status={submission.milestone_status as MilestoneStatus} />
          <MilestoneStatusDropdown
            submissionId={submission.id}
            currentStatus={submission.milestone_status as MilestoneStatus}
            onChange={onStatusChange}
          />
          <DeliveryBadge status={submission.status} />
        </div>
      </div>

      {/* Milestone + meta ────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 space-y-1.5">
        <p className="text-sm font-semibold text-deep-plum">
          {milestone
            ? `Step ${milestone.step_number} — ${milestone.step_name}`
            : 'Unknown milestone'}
        </p>
        {milestone?.section_group && (
          <p className="text-xs text-purple-gray">{milestone.section_group}</p>
        )}
        <p className="text-xs text-purple-gray">
          Submitted by{' '}
          <span className="font-medium text-deep-plum">
            {submission.submitted_by_name ?? submission.submitted_by_email}
          </span>
        </p>
        {submission.is_continuation && submission.continuation_of && (
          <p className="text-xs text-purple-gray">
            Continuation of{' '}
            <code className="font-mono text-[11px] bg-lavender-tint px-1 py-0.5 rounded text-deep-plum">
              {submission.continuation_of.slice(0, 8)}…
            </code>
            {continuationSource?.milestone && (
              <span className="ml-1">({continuationSource.milestone.step_name})</span>
            )}
          </p>
        )}
        {submission.partner_contact_name && (
          <p className="text-xs text-purple-gray">
            Tagged:{' '}
            <span className="font-medium text-deep-plum">{submission.partner_contact_name}</span>
          </p>
        )}
      </div>

      {/* Current / Next ──────────────────────────────────────────────────── */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-lavender-tint/60 px-3 py-2">
          <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">
            Current Milestone
          </p>
          <p className="text-xs font-medium text-deep-plum leading-snug">
            {currentMilestone
              ? `Step ${currentMilestone.step_number} — ${currentMilestone.step_name}`
              : '—'}
          </p>
        </div>
        <div className="rounded-lg bg-lavender-tint/60 px-3 py-2">
          <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">
            Next Up
          </p>
          <p className="text-xs font-medium text-deep-plum leading-snug">
            {nextMilestone
              ? `Step ${nextMilestone.step_number} — ${nextMilestone.step_name}`
              : <span className="text-purple-gray italic">Final step</span>}
          </p>
        </div>
      </div>

      {/* ClickUp info ────────────────────────────────────────────────────── */}
      {(submission.clickup_channel_id || submission.clickup_message_id || submission.clickup_thread_url) && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-4 text-xs text-purple-gray">
          {submission.clickup_channel_id && (
            <span>
              Channel:{' '}
              <code className="font-mono text-[11px] bg-lavender-tint px-1.5 py-0.5 rounded text-deep-plum">
                {submission.clickup_channel_id}
              </code>
            </span>
          )}
          {submission.clickup_message_id && (
            <span className="flex items-center gap-2">
              Message ID:{' '}
              <code className="font-mono text-[11px] bg-lavender-tint px-1.5 py-0.5 rounded text-deep-plum">
                {submission.clickup_message_id}
              </code>
              <CopyButton value={submission.clickup_message_id} />
            </span>
          )}
          {submission.clickup_thread_url && (
            <a
              href={submission.clickup_thread_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-purple hover:underline font-medium"
            >
              <ExternalLink size={11} />
              View thread in ClickUp
            </a>
          )}
        </div>
      )}

      {/* Assets ──────────────────────────────────────────────────────────── */}
      {assets.length > 0 && (
        <div className="px-4 pb-3 border-t border-lavender pt-3">
          <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-2">
            Attached Assets
          </p>
          <div className="flex flex-wrap gap-2">
            {assets.map(asset => (
              <a
                key={asset.id}
                href={asset.asset_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1 hover:bg-lavender-tint transition-colors"
              >
                <ExternalLink size={10} className="text-purple-gray shrink-0" />
                {asset.asset_label ? (
                  <>
                    {asset.asset_label}
                    <span className="text-[10px] text-purple-gray">
                      · {ASSET_TYPE_LABELS[asset.asset_type]}
                    </span>
                  </>
                ) : (
                  ASSET_TYPE_LABELS[asset.asset_type]
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Reply thread (collapsible). Count reflects top-level rows — folder
           children sit inside the folder and aren't counted separately. */}
      {replies.length > 0 && (
        <div className="border-t border-lavender">
          <button
            type="button"
            onClick={() => setRepliesOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-purple-gray hover:bg-lavender-tint/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <MessageSquare size={12} />
              Replies ({replies.filter(r => !r.folder_id).length})
              {untriagedCount > 0 && (
                <span className="rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5">
                  {untriagedCount} untriaged
                </span>
              )}
            </span>
            {repliesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          {repliesOpen && (
            <div className="px-4 pb-4">
              <ReplyThread
                replies={replies}
                submissionThreadUrl={submission.clickup_thread_url}
                assets={assets}
                onTriageSave={(replyId, category) =>
                  onTriageSave(replyId, submission.id, category)
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Rendered message (collapsible) ─────────────────────────────────── */}
      <div className="border-t border-lavender">
        <button
          type="button"
          onClick={() => setMessageOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-purple-gray hover:bg-lavender-tint/50 transition-colors"
        >
          <span>Message sent</span>
          {messageOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {messageOpen && (
          <div className="px-4 pb-4">
            <pre className="text-xs text-deep-plum bg-lavender-tint/40 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed border border-lavender">
              {submission.rendered_message}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-lavender rounded-xl p-4 animate-pulse space-y-3">
      <div className="flex justify-between">
        <div className="h-3 w-32 bg-lavender/50 rounded" />
        <div className="h-3 w-24 bg-lavender/40 rounded" />
      </div>
      <div className="h-4 w-56 bg-lavender/50 rounded" />
      <div className="h-3 w-40 bg-lavender/30 rounded" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-10 bg-lavender/30 rounded-lg" />
        <div className="h-10 bg-lavender/30 rounded-lg" />
      </div>
    </div>
  )
}

// ── WarningToast ──────────────────────────────────────────────────────────────

function WarningToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-300 shadow-lg px-4 py-3 max-w-sm w-full mx-4">
      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-800 flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-amber-600 hover:text-amber-800 transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountLogPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const navigate = useNavigate()
  const { staffProfile } = useAuth()

  const [partner, setPartner] = useState<PartnerInfo | null>(null)
  const [enriched, setEnriched] = useState<EnrichedSubmission[]>([])
  const [squadFilter, setSquadFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logMissedOpen, setLogMissedOpen] = useState(false)

  const [webhookWarning, setWebhookWarning] = useState<string | null>(null)

  const dismissWarning = useCallback(() => setWebhookWarning(null), [])

  const [portalCopied, setPortalCopied] = useState(false)
  const portalUrl = `${window.location.origin}/portal/${partner?.portal_token ?? memberId}`

  const handleCopyPortal = () => {
    navigator.clipboard.writeText(portalUrl).then(() => {
      setPortalCopied(true)
      setTimeout(() => setPortalCopied(false), 2000)
    })
  }

  // ── Milestone status change ───────────────────────────────────────────────
  const handleStatusChange = async (id: string, status: MilestoneStatus) => {
    const { error: updateErr } = await supabase
      .from('strategy_milestone_submissions')
      .update({ milestone_status: status })
      .eq('id', id)

    if (updateErr) throw new Error(updateErr.message)

    setEnriched(prev => prev.map(e =>
      e.submission.id === id
        ? { ...e, submission: { ...e.submission, milestone_status: status } }
        : e,
    ))
  }

  // ── Triage save ───────────────────────────────────────────────────────────
  const handleTriageSave = async (
    replyId: string,
    submissionId: string,
    category: TriageCategory | null,
  ) => {
    // ── 1. Save to Supabase (authoritative — throws on failure) ───────────
    const { data: updated, error: updateErr } = await supabase
      .from('strategy_milestone_replies')
      .update({ triage_category: category })
      .eq('id', replyId)
      .select('id')
      .maybeSingle()

    if (updateErr) throw new Error(updateErr.message)
    if (!updated) throw new Error('Triage save was blocked — a Supabase UPDATE policy may be missing on strategy_milestone_replies.')

    // ── 2. Optimistic local state update ──────────────────────────────────
    setEnriched(prev => prev.map(e => {
      if (e.submission.id !== submissionId) return e
      return {
        ...e,
        replies: e.replies.map(r =>
          r.id === replyId ? { ...r, triage_category: category } : r,
        ),
      }
    }))

    // ── 3. Fire n8n webhook (best-effort — never blocks the UI) ──────────
    if (category && category !== 'no_action_needed') {
      const submissionEntry = enriched.find(e => e.submission.id === submissionId)
      const reply = submissionEntry?.replies.find(r => r.id === replyId)

      const payload = {
        triage_category:  category,
        reply_id:         replyId,
        submission_id:    submissionId,
        member:           partner?.member ?? null,
        church_name:      partner?.church_name ?? null,
        milestone_name:   submissionEntry?.milestone?.step_name ?? null,
        squad:            submissionEntry?.milestone?.squad ?? null,
        reply_text:       reply?.reply_text ?? null,
        reply_author:     reply?.reply_author_name ?? null,
        triaged_by:       staffProfile?.full_name ?? staffProfile?.name ?? null,
      }

      fetch(N8N_TRIAGE_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(res => {
        if (!res.ok) {
          setWebhookWarning('Triage saved but the webhook notification failed — notify your admin.')
          return
        }
        // Poll for edit_task_url after n8n has had time to create the task
        setTimeout(async () => {
          const { data } = await supabase
            .from('strategy_milestone_replies')
            .select('id, edit_task_url')
            .eq('id', replyId)
            .maybeSingle()
          if (data?.edit_task_url) {
            setEnriched(prev => prev.map(e => ({
              ...e,
              replies: e.replies.map(r =>
                r.id === replyId ? { ...r, edit_task_url: data.edit_task_url } : r,
              ),
            })))
          }
        }, 5000)
      }).catch(() => {
        setWebhookWarning('Triage saved but the webhook notification failed — notify your admin.')
      })
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  /** Reload partner + submissions. Hoisted so the Log-Missed-Milestone
   *  modal can re-trigger after a successful insert. */
  const reload = useCallback(async () => {
    if (!memberId) return
    const memberNum = Number(memberId)
    if (isNaN(memberNum)) {
      setError('Invalid member ID')
      setLoading(false)
      return
    }
    try {
      const [partnerRes, subsRes] = await Promise.all([
          supabase
            .from('strategy_account_progress')
            .select('member, church_name, first_name_of_primary, css_rep, portal_token')
            .eq('member', memberNum)
            .maybeSingle(),
          supabase
            .from('strategy_milestone_submissions')
            .select('*')
            .eq('member', memberNum)
            .order('submitted_at', { ascending: false }),
        ])

        if (partnerRes.data) setPartner(partnerRes.data as PartnerInfo)

        const submissions = (subsRes.data ?? []) as StrategyMilestoneSubmission[]
        if (submissions.length === 0) {
          setLoading(false)
          return
        }

        const milestoneIdSet = new Set<string>()
        for (const s of submissions) {
          if (s.milestone_id) milestoneIdSet.add(s.milestone_id)
          if (s.current_milestone_id) milestoneIdSet.add(s.current_milestone_id)
          if (s.next_milestone_id) milestoneIdSet.add(s.next_milestone_id)
        }

        const submissionIds = submissions.map(s => s.id)

        const [defsRes, assetsRes, repliesRes] = await Promise.all([
          supabase
            .from('strategy_milestone_definitions')
            .select('*')
            .in('id', [...milestoneIdSet]),
          supabase
            .from('strategy_submission_assets')
            .select('*')
            .in('submission_id', submissionIds)
            .order('sort_order'),
          supabase
            .from('strategy_milestone_replies')
            .select('*')
            .in('submission_id', submissionIds)
            .order('detected_at', { ascending: true }),
        ])

        const defsMap = new Map<string, StrategyMilestoneDefinition>()
        for (const d of (defsRes.data ?? []) as StrategyMilestoneDefinition[]) {
          defsMap.set(d.id, d)
        }

        const assetsMap = new Map<string, StrategySubmissionAsset[]>()
        for (const a of (assetsRes.data ?? []) as StrategySubmissionAsset[]) {
          if (!assetsMap.has(a.submission_id)) assetsMap.set(a.submission_id, [])
          assetsMap.get(a.submission_id)!.push(a)
        }

        const repliesMap = new Map<string, StrategyMilestoneReply[]>()
        for (const r of (repliesRes.data ?? []) as StrategyMilestoneReply[]) {
          if (!repliesMap.has(r.submission_id)) repliesMap.set(r.submission_id, [])
          repliesMap.get(r.submission_id)!.push(r)
        }

        setEnriched(
          submissions.map(s => ({
            submission: s,
            milestone: defsMap.get(s.milestone_id) ?? null,
            currentMilestone: defsMap.get(s.current_milestone_id) ?? null,
            nextMilestone: s.next_milestone_id ? (defsMap.get(s.next_milestone_id) ?? null) : null,
            assets: assetsMap.get(s.id) ?? [],
            replies: repliesMap.get(s.id) ?? [],
          })),
        )
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to load account data')
    } finally {
      setLoading(false)
    }
  }, [memberId])

  useEffect(() => { void reload() }, [reload])

  // Derive the unique squads present in this account's submissions
  const presentSquads = [...new Set(
    enriched.flatMap(e => e.milestone?.squad ? [e.milestone.squad] : [])
  )].sort()

  const filteredEnriched = squadFilter === 'all'
    ? enriched
    : enriched.filter(e => e.milestone?.squad === squadFilter)

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      {webhookWarning && (
        <WarningToast message={webhookWarning} onDismiss={dismissWarning} />
      )}
      <div className="max-w-3xl mx-auto">

        {/* Back nav ──────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-deep-plum transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          All Partners
        </button>

        {/* Page header ────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="mb-6 space-y-2">
            <div className="h-7 w-64 bg-lavender/40 rounded-lg animate-pulse" />
            <div className="h-4 w-48 bg-lavender/30 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-deep-plum">
                {partner?.church_name ?? `Member #${memberId}`}
              </h1>
              <p className="text-sm text-purple-gray mt-0.5">
                Member #{memberId}
                {partner?.css_rep && (
                  <> · Account Manager: <span className="font-medium text-deep-plum">{partner.css_rep}</span></>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-lavender bg-lavender-tint/40 px-3 py-2">
                <span className="text-xs text-purple-gray font-mono truncate max-w-[200px]">{portalUrl}</span>
                <button
                  type="button"
                  onClick={handleCopyPortal}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors shrink-0"
                >
                  {portalCopied ? <Check size={12} className="text-green-600" /> : <Link size={12} />}
                  {portalCopied ? 'Copied!' : 'Share Portal'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/submit?member=${memberId}`)}
                className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2.5 hover:bg-primary-purple transition-colors"
              >
                Submit New Milestone →
              </button>
              <button
                type="button"
                onClick={() => setLogMissedOpen(true)}
                className="rounded-full border border-deep-plum text-deep-plum text-sm font-semibold px-5 py-2.5 hover:bg-deep-plum hover:text-white transition-colors"
                title="Log a milestone that was already sent to the partner outside this app — captures assets + the existing message link without sending a new ClickUp message."
              >
                Log Missed Milestone
              </button>
            </div>
          </div>
        )}

        {logMissedOpen && partner && (
          <LogMissedMilestoneModal
            partner={partner}
            onClose={() => setLogMissedOpen(false)}
            onLogged={() => { setLogMissedOpen(false); reload() }}
          />
        )}

        {/* Submissions ────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !error && (
          enriched.length === 0 ? (
            <div className="bg-white border border-lavender rounded-xl p-10 text-center">
              <p className="text-purple-gray text-sm">No milestone submissions yet for this partner.</p>
              <button
                type="button"
                onClick={() => navigate(`/submit?member=${memberId}`)}
                className="mt-4 rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2.5 hover:bg-primary-purple transition-colors"
              >
                Submit First Milestone →
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Squad filter pills — only shown when multiple squads present */}
              {presentSquads.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  {(['all', ...presentSquads] as string[]).map(squad => (
                    <button
                      key={squad}
                      type="button"
                      onClick={() => setSquadFilter(squad)}
                      className={`rounded-full text-xs font-semibold px-3.5 py-1.5 transition-colors border ${
                        squadFilter === squad
                          ? 'bg-deep-plum text-white border-deep-plum'
                          : 'border-lavender text-deep-plum hover:border-primary-purple hover:text-primary-purple bg-white'
                      }`}
                    >
                      {squad === 'all'
                        ? `All (${enriched.length})`
                        : `${SQUAD_LABELS[squad] ?? squad} (${enriched.filter(e => e.milestone?.squad === squad).length})`
                      }
                    </button>
                  ))}
                </div>
              )}

              <p className="text-xs text-purple-gray">
                {filteredEnriched.length}{enriched.length !== filteredEnriched.length ? ` of ${enriched.length}` : ''} submission{filteredEnriched.length !== 1 ? 's' : ''} · most recent first
              </p>

              {filteredEnriched.length === 0 ? (
                <div className="bg-white border border-lavender rounded-xl p-8 text-center">
                  <p className="text-sm text-purple-gray">No {SQUAD_LABELS[squadFilter] ?? squadFilter} submissions for this partner.</p>
                </div>
              ) : (
                filteredEnriched.map(e => (
                  <SubmissionCard
                    key={e.submission.id}
                    enriched={e}
                    allSubmissions={enriched}
                    onStatusChange={handleStatusChange}
                    onTriageSave={handleTriageSave}
                  />
                ))
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Log Missed Milestone modal ─────────────────────────────────────────────
//
// Captures a milestone that was already sent to the partner outside this
// app. Inserts a `strategy_milestone_submissions` row with the existing
// ClickUp message URL parsed into channel + message id, plus
// `strategy_submission_assets` rows for any assets the user attaches. No
// ClickUp send happens — the message already exists. Once logged, the
// reply-scrub cron will pick up partner replies on that thread the same
// way it does for app-sent submissions.

interface LogMissedMilestoneModalProps {
  partner: PartnerInfo
  onClose: () => void
  onLogged: () => void
}

interface MissedAsset {
  type: string
  url: string
  label: string
}

/** Parse a ClickUp message URL into its channel + message ids. ClickUp
 *  thread URLs look like:
 *    https://app.clickup.com/{teamId}/chat/r/{channelId}/t/{messageId}
 *    https://app.clickup.com/{teamId}/v/cn/{channelId}/t/{messageId}
 *  Both are valid; both encode the channel as the segment after `r/` or
 *  `cn/` and the message as the segment after `t/`. Returns null fields
 *  for any segment we can't extract. */
function parseClickUpUrl(url: string): { channelId: string | null; messageId: string | null } {
  if (!url) return { channelId: null, messageId: null }
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean)
    let channelId: string | null = null
    let messageId: string | null = null
    for (let i = 0; i < segments.length - 1; i++) {
      if ((segments[i] === 'r' || segments[i] === 'cn') && segments[i + 1]) {
        channelId = segments[i + 1]
      }
      if (segments[i] === 't' && segments[i + 1]) {
        messageId = segments[i + 1]
      }
    }
    return { channelId, messageId }
  } catch {
    return { channelId: null, messageId: null }
  }
}

const ASSET_TYPE_OPTIONS = [
  'Mood Board', 'Brand Guide', 'Logo', 'Asset Pack', 'Strategy Brief',
  'Wireframe', 'Mockup', 'Site Preview', 'Vista Social', 'Other',
]

function LogMissedMilestoneModal({ partner, onClose, onLogged }: LogMissedMilestoneModalProps) {
  const { staffProfile } = useAuth()
  const [milestones, setMilestones] = useState<StrategyMilestoneDefinition[]>([])
  const [milestoneId, setMilestoneId] = useState('')
  const [trackName, setTrackName] = useState('')
  const [messageUrl, setMessageUrl] = useState('')
  const [submittedAt, setSubmittedAt] = useState(new Date().toISOString().slice(0, 10))
  const [assets, setAssets] = useState<MissedAsset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load active milestone definitions for the picker.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('strategy_milestone_definitions')
      .select('*')
      .eq('is_active', true)
      .order('squad').order('pathway').order('step_number')
      .then(({ data }) => { if (!cancelled) setMilestones((data ?? []) as StrategyMilestoneDefinition[]) })
    return () => { cancelled = true }
  }, [])

  const parsed = parseClickUpUrl(messageUrl)
  const canSubmit = !!milestoneId && !!messageUrl.trim() && (parsed.channelId || parsed.messageId)

  const addAsset = () => setAssets(a => [...a, { type: 'Other', url: '', label: '' }])
  const removeAsset = (idx: number) => setAssets(a => a.filter((_, i) => i !== idx))
  const updateAsset = (idx: number, patch: Partial<MissedAsset>) =>
    setAssets(a => a.map((row, i) => i === idx ? { ...row, ...patch } : row))

  const handleSubmit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const milestone = milestones.find(m => m.id === milestoneId)
      const submitterEmail = staffProfile?.email ?? null
      const submitterName = staffProfile?.full_name ?? staffProfile?.name ?? null

      const submittedAtIso = new Date(submittedAt).toISOString()

      // Insert the submission row. `milestone_status` = 'sent' so it
      // matches the active set the reply-scrub cron walks. The cron uses
      // clickup_channel_id + clickup_message_id to fetch replies.
      const { data: row, error: insertErr } = await supabase
        .from('strategy_milestone_submissions')
        .insert({
          member: partner.member,
          church_name: partner.church_name,
          milestone_id: milestoneId,
          current_milestone_id: milestoneId,
          next_milestone_id: null,
          track_name: trackName || null,
          message_body: '(Logged after the fact — original message lives in ClickUp)',
          milestone_status: 'sent',
          submitted_by_name: submitterName,
          submitted_by_email: submitterEmail,
          submitted_at: submittedAtIso,
          clickup_channel_id: parsed.channelId,
          clickup_message_id: parsed.messageId,
          clickup_thread_url: messageUrl.trim(),
          partner_contact_name: null,
          partner_contact_clickup_id: null,
          is_continuation: false,
          continuation_of: null,
          step_squad: milestone?.squad ?? null,
          step_pathway: milestone?.pathway ?? null,
          logged_after_the_fact: true,
        })
        .select('id')
        .single()

      if (insertErr) throw insertErr
      const submissionId = (row as { id: string } | null)?.id
      if (!submissionId) throw new Error('Submission insert returned no id')

      // Insert any attached assets.
      const validAssets = assets
        .filter(a => a.url.trim())
        .map((a, i) => ({
          submission_id: submissionId,
          asset_type: a.type,
          asset_url: a.url.trim(),
          asset_label: a.label.trim() || null,
          sort_order: i,
        }))
      if (validAssets.length > 0) {
        const { error: assetsErr } = await supabase
          .from('strategy_submission_assets')
          .insert(validAssets)
        if (assetsErr) throw assetsErr
      }

      onLogged()
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to log milestone')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4 py-6" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-lavender px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h2 className="text-lg font-semibold text-deep-plum">Log a missed milestone</h2>
            <p className="text-xs text-purple-gray mt-0.5">
              Capture a milestone that was already sent to <strong>{partner.church_name ?? `member ${partner.member}`}</strong> outside this app. We won't send a new ClickUp message — paste the existing thread link so we can track replies and surface assets on their portal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-purple-gray hover:text-deep-plum"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Milestone picker */}
          <div>
            <label className="block text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-1">
              Milestone *
            </label>
            <select
              value={milestoneId}
              onChange={e => setMilestoneId(e.target.value)}
              className="w-full rounded-lg border border-lavender bg-white px-3 py-2 text-sm outline-none focus:border-primary-purple"
            >
              <option value="">Select a milestone…</option>
              {milestones.map(m => (
                <option key={m.id} value={m.id}>
                  {SQUAD_LABELS[m.squad] ?? m.squad} · {PATHWAY_LABELS[m.pathway] ?? m.pathway} · {m.step_number}. {m.step_name}
                </option>
              ))}
            </select>
          </div>

          {/* Track name (optional) */}
          <div>
            <label className="block text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-1">
              Track / sequence name (optional)
            </label>
            <input
              type="text"
              value={trackName}
              onChange={e => setTrackName(e.target.value)}
              placeholder="e.g. Kids Ministry, Spanish Service"
              className="w-full rounded-lg border border-lavender bg-white px-3 py-2 text-sm outline-none focus:border-primary-purple"
            />
            <p className="text-[10px] text-purple-gray mt-1">Leave blank if this milestone wasn't part of a sub-track.</p>
          </div>

          {/* ClickUp thread URL */}
          <div>
            <label className="block text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-1">
              ClickUp message link *
            </label>
            <input
              type="url"
              value={messageUrl}
              onChange={e => setMessageUrl(e.target.value)}
              placeholder="https://app.clickup.com/.../chat/r/.../t/..."
              className="w-full rounded-lg border border-lavender bg-white px-3 py-2 text-sm outline-none focus:border-primary-purple font-mono"
            />
            {messageUrl && (
              <p className="text-[10px] mt-1">
                {parsed.channelId && parsed.messageId
                  ? <span className="text-green-700">✓ Parsed channel <code>{parsed.channelId}</code> and message <code>{parsed.messageId}</code></span>
                  : <span className="text-amber-700">⚠ Couldn't parse a channel and message id from this URL — replies won't be tracked unless we have both.</span>}
              </p>
            )}
          </div>

          {/* Submitted at */}
          <div>
            <label className="block text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-1">
              Date sent
            </label>
            <input
              type="date"
              value={submittedAt}
              onChange={e => setSubmittedAt(e.target.value)}
              className="rounded-lg border border-lavender bg-white px-3 py-2 text-sm outline-none focus:border-primary-purple"
            />
          </div>

          {/* Assets */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">
                Assets ({assets.length})
              </label>
              <button
                type="button"
                onClick={addAsset}
                className="text-[11px] font-semibold text-primary-purple hover:underline"
              >
                + Add asset
              </button>
            </div>
            <p className="text-[10px] text-purple-gray mb-2">
              Same asset types as a normal submission. These appear on the partner's portal once logged.
            </p>
            {assets.length === 0 ? (
              <p className="text-xs text-purple-gray italic">No assets attached.</p>
            ) : (
              <div className="space-y-2">
                {assets.map((a, idx) => (
                  <div key={idx} className="grid grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
                    <select
                      value={a.type}
                      onChange={e => updateAsset(idx, { type: e.target.value })}
                      className="rounded-md border border-lavender bg-white text-xs px-2 py-1.5 outline-none"
                    >
                      {ASSET_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      type="url"
                      value={a.url}
                      onChange={e => updateAsset(idx, { url: e.target.value })}
                      placeholder="https://…"
                      className="rounded-md border border-lavender bg-white text-xs px-2 py-1.5 outline-none focus:border-primary-purple font-mono"
                    />
                    <input
                      type="text"
                      value={a.label}
                      onChange={e => updateAsset(idx, { label: e.target.value })}
                      placeholder="Label (optional)"
                      className="rounded-md border border-lavender bg-white text-xs px-2 py-1.5 outline-none focus:border-primary-purple"
                    />
                    <button
                      type="button"
                      onClick={() => removeAsset(idx)}
                      className="text-purple-gray hover:text-red-600 text-xs px-1"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-lavender px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-lavender bg-white text-sm font-medium text-deep-plum px-4 py-2 hover:bg-lavender-tint"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold px-4 py-2 hover:bg-primary-purple disabled:opacity-50"
          >
            {busy ? 'Logging…' : 'Log milestone'}
          </button>
        </div>
      </div>
    </div>
  )
}
