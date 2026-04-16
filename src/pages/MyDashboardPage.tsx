import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ExternalLink, ChevronRight, MessageSquare,
  CheckCircle2, AlertTriangle, X, Clock, Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type {
  StrategyMilestoneReply,
  MilestoneStatus,
  TriageCategory,
  SubmissionStatus,
} from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS } from '../components/submit/types'

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
          {reply.reply_text || <span className="italic text-purple-gray/50">(empty reply)</span>}
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
        const recent: RecentItem[] = subs.slice(0, 15).map(s => {
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
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [userEmail])

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
    <div className="px-4 md:px-6 py-6 max-w-3xl mx-auto pb-20">

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

      {/* ── Needs Triage ─────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={15} className="text-primary-purple" />
          <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">Needs Triage</h2>
          {triageItems.length > 0 && (
            <span className="rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">
              {triageItems.length}
            </span>
          )}
        </div>

        {triageItems.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-lavender bg-white px-6 py-10 text-center">
            <CheckCircle2 size={28} className="text-green-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-deep-plum">You're all caught up!</p>
            <p className="text-xs text-purple-gray mt-1">No untriaged partner replies on your submissions.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triageItems.map(item => (
              <TriageCard
                key={item.reply.id}
                item={item}
                onSave={handleTriageSave}
              />
            ))}
          </div>
        )}
      </section>

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

      {/* Toast */}
      {webhookWarning && (
        <WarningToast message={webhookWarning} onDismiss={dismissWarning} />
      )}
    </div>
  )
}
