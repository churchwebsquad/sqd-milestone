/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PartnerUploadReview — strategist surface for the partner-uploaded
 * structured files ingested by /api/web/cowork/ingest-partner-upload.
 *
 * Why this exists: partners upload CSVs / lists / docs against the
 * "Add something we missed" form. The ingestor parses each into
 * draft rows in `church_facts` or `content_atoms`. Those drafts need
 * a human review before flowing into the content pool — partner CSVs
 * are typically messy (typos, blank rows, wrong columns).
 *
 * Surfaces in the Intake & Crawl tab between content-collection
 * responses and the crawl inventory.
 *
 * For each attachment:
 *   • Header: filename + parse-status badge + bucket + uploaded-at
 *   • Body:
 *     - parsed rows preview (church_facts / content_atoms, status=draft)
 *     - Approve all / Reject all / Re-parse / View file
 *   • On Approve: drafts flip to status='approved'.
 *   • On Reject: drafts get archived (status='archived'); attachment
 *     keeps its parsed_at so we don't auto-rerun.
 *   • On Re-parse: calls the ingestor with force=true.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ExternalLink, FileText, Loader2,
  RefreshCcw, X,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { triggerIngestPartnerUpload } from '../../../lib/contentCollectionAttachments'

interface Props {
  projectId: string
}

type ParsedDestination = 'church_facts' | 'content_atoms' | 'failed' | 'unsupported' | 'rejected'

interface AttachmentRow {
  id:                 string
  session_id:         string
  kind:               string
  file_path:          string
  file_name:          string
  mime_type:          string | null
  size_bytes:         number | null
  target_path:        string | null
  uploaded_at:        string
  parsed_at:          string | null
  parsed_destination: ParsedDestination | null
  parsed_rows_count:  number | null
  parse_error:        string | null
}

interface FactPreview {
  id:        string
  topic:     string
  data:      Record<string, unknown>
  status:    string
  source_attachment_id: string
}
interface AtomPreview {
  id:         string
  topic:      string
  body:       string
  verbatim:   boolean
  confidence: number | null
  status:     string
  source_attachment_id: string
}

export function PartnerUploadReview({ projectId }: Props) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [factsByAtt,  setFactsByAtt]  = useState<Map<string, FactPreview[]>>(new Map())
  const [atomsByAtt,  setAtomsByAtt]  = useState<Map<string, AtomPreview[]>>(new Map())
  const [loading,     setLoading]     = useState(true)
  const [busy,        setBusy]        = useState<Map<string, 'approve' | 'reject' | 'reparse'>>(new Map())
  const [error,       setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      // Sessions for this project, then their attachments.
      const { data: sessions, error: sessErr } = await supabase
        .from('strategy_content_collection_sessions')
        .select('id')
        .eq('web_project_id', projectId)
      if (sessErr) throw new Error(sessErr.message)
      const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)
      if (sessionIds.length === 0) {
        setAttachments([])
        setFactsByAtt(new Map())
        setAtomsByAtt(new Map())
        setLoading(false)
        return
      }
      const { data: atts, error: attErr } = await supabase
        .from('strategy_content_collection_attachments')
        .select('id, session_id, kind, file_path, file_name, mime_type, size_bytes, target_path, uploaded_at, parsed_at, parsed_destination, parsed_rows_count, parse_error')
        .in('session_id', sessionIds)
        .order('uploaded_at', { ascending: false })
      if (attErr) throw new Error(attErr.message)
      const rows = (atts ?? []) as AttachmentRow[]
      setAttachments(rows)

      // Pull rows produced by each attachment.
      const attIds = rows.map(r => r.id)
      if (attIds.length === 0) {
        setFactsByAtt(new Map())
        setAtomsByAtt(new Map())
        setLoading(false)
        return
      }
      const [factsRes, atomsRes] = await Promise.all([
        supabase
          .from('church_facts')
          .select('id, topic, data, status, source_attachment_id')
          .in('source_attachment_id', attIds),
        supabase
          .from('content_atoms')
          .select('id, topic, body, verbatim, confidence, status, source_attachment_id')
          .in('source_attachment_id', attIds),
      ])
      const factsMap = new Map<string, FactPreview[]>()
      for (const f of ((factsRes.data ?? []) as FactPreview[])) {
        if (!factsMap.has(f.source_attachment_id)) factsMap.set(f.source_attachment_id, [])
        factsMap.get(f.source_attachment_id)!.push(f)
      }
      const atomsMap = new Map<string, AtomPreview[]>()
      for (const a of ((atomsRes.data ?? []) as AtomPreview[])) {
        if (!atomsMap.has(a.source_attachment_id)) atomsMap.set(a.source_attachment_id, [])
        atomsMap.get(a.source_attachment_id)!.push(a)
      }
      setFactsByAtt(factsMap)
      setAtomsByAtt(atomsMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attachments')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  // Bucket-key extraction from target_path = "missing:<bucket>/<slug>"
  const bucketFromTarget = (target: string | null) => {
    if (!target?.startsWith('missing:')) return null
    return target.slice('missing:'.length).split('/')[0]
  }

  const setBusyFor = (id: string, action: 'approve' | 'reject' | 'reparse' | null) => {
    setBusy(prev => {
      const next = new Map(prev)
      if (action) next.set(id, action); else next.delete(id)
      return next
    })
  }

  const approveAll = async (att: AttachmentRow) => {
    if (!att.parsed_destination || (att.parsed_destination !== 'church_facts' && att.parsed_destination !== 'content_atoms')) return
    setBusyFor(att.id, 'approve')
    try {
      const table = att.parsed_destination
      const { error: e } = await (supabase as any)
        .from(table)
        .update({ status: 'approved' })
        .eq('source_attachment_id', att.id)
        .eq('status', 'draft')
      if (e) throw new Error(e.message)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusyFor(att.id, null)
    }
  }

  const rejectAll = async (att: AttachmentRow) => {
    if (!att.parsed_destination || (att.parsed_destination !== 'church_facts' && att.parsed_destination !== 'content_atoms')) return
    setBusyFor(att.id, 'reject')
    try {
      const table = att.parsed_destination
      const { error: e } = await (supabase as any)
        .from(table)
        .update({ status: 'archived' })
        .eq('source_attachment_id', att.id)
        .eq('status', 'draft')
      if (e) throw new Error(e.message)
      // Mark attachment so we don't keep surfacing it; ingestor's
      // force=true is still available to re-process if needed.
      await (supabase as any)
        .from('strategy_content_collection_attachments')
        .update({ parsed_destination: 'rejected' })
        .eq('id', att.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setBusyFor(att.id, null)
    }
  }

  const reparse = async (att: AttachmentRow) => {
    setBusyFor(att.id, 'reparse')
    try {
      await triggerIngestPartnerUpload(att.id, { force: true })
      // Poll briefly so the user sees rows appear without manual refresh.
      await new Promise(r => setTimeout(r, 2000))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-parse failed')
    } finally {
      setBusyFor(att.id, null)
    }
  }

  // Split attachments by review status so the most-actionable surface
  // up top.
  const groups = useMemo(() => {
    const pending: AttachmentRow[] = []   // parsed, drafts produced, awaiting decision
    const failed:  AttachmentRow[] = []   // parse_error set
    const done:    AttachmentRow[] = []   // approved/rejected/no rows
    for (const att of attachments) {
      if (att.parse_error) failed.push(att)
      else if (att.parsed_destination === 'church_facts' || att.parsed_destination === 'content_atoms') {
        const rows = (att.parsed_destination === 'church_facts' ? factsByAtt : atomsByAtt).get(att.id) ?? []
        const hasDrafts = rows.some(r => r.status === 'draft')
        if (hasDrafts) pending.push(att)
        else done.push(att)
      } else done.push(att)
    }
    return { pending, failed, done }
  }, [attachments, factsByAtt, atomsByAtt])

  if (loading) {
    return (
      <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4 text-[12px] text-wm-text-muted flex items-center gap-2">
        <Loader2 size={13} className="animate-spin" />
        Loading partner uploads…
      </div>
    )
  }
  if (attachments.length === 0) return null

  return (
    <section className="rounded-lg border border-wm-border bg-wm-bg p-3 space-y-3">
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text">
            Partner uploads
          </p>
          <p className="text-[11px] text-wm-text-muted">
            Files the partner attached via "Add something we missed." Approve drafts to push them into the content pool.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-md border border-wm-danger/40 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger">
          {error}
        </div>
      )}

      {groups.pending.length > 0 && (
        <Group title={`Awaiting review (${groups.pending.length})`} tone="amber">
          {groups.pending.map(att => (
            <AttachmentCard
              key={att.id}
              att={att}
              factRows={factsByAtt.get(att.id) ?? []}
              atomRows={atomsByAtt.get(att.id) ?? []}
              bucket={bucketFromTarget(att.target_path)}
              busy={busy.get(att.id) ?? null}
              onApprove={() => approveAll(att)}
              onReject={() => rejectAll(att)}
              onReparse={() => reparse(att)}
            />
          ))}
        </Group>
      )}
      {groups.failed.length > 0 && (
        <Group title={`Parse failed (${groups.failed.length})`} tone="rose">
          {groups.failed.map(att => (
            <AttachmentCard
              key={att.id}
              att={att}
              factRows={[]}
              atomRows={[]}
              bucket={bucketFromTarget(att.target_path)}
              busy={busy.get(att.id) ?? null}
              onReparse={() => reparse(att)}
            />
          ))}
        </Group>
      )}
      {groups.done.length > 0 && (
        <details className="border-t border-wm-border pt-2">
          <summary className="text-[11px] text-wm-text-muted cursor-pointer">
            Done ({groups.done.length}) — already approved / rejected / unsupported
          </summary>
          <div className="mt-2 space-y-1.5">
            {groups.done.map(att => (
              <AttachmentCard
                key={att.id}
                att={att}
                factRows={factsByAtt.get(att.id) ?? []}
                atomRows={atomsByAtt.get(att.id) ?? []}
                bucket={bucketFromTarget(att.target_path)}
                busy={busy.get(att.id) ?? null}
                compact
                onReparse={() => reparse(att)}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function Group({ title, tone, children }: { title: string; tone: 'amber' | 'rose'; children: React.ReactNode }) {
  const border = tone === 'rose' ? 'border-l-rose-500' : 'border-l-amber-500'
  return (
    <div className={`border-l-[3px] ${border} pl-2 space-y-1.5`}>
      <p className="text-[10.5px] uppercase tracking-widest font-bold text-wm-text-muted">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

interface AttCardProps {
  att:       AttachmentRow
  factRows:  FactPreview[]
  atomRows:  AtomPreview[]
  bucket:    string | null
  busy:      'approve' | 'reject' | 'reparse' | null
  compact?:  boolean
  onApprove?: () => Promise<void> | void
  onReject?:  () => Promise<void> | void
  onReparse?: () => Promise<void> | void
}

function AttachmentCard({
  att, factRows, atomRows, bucket, busy, compact = false,
  onApprove, onReject, onReparse,
}: AttCardProps) {
  const rows = att.parsed_destination === 'church_facts' ? factRows : atomRows
  const draftCount = rows.filter(r => r.status === 'draft').length
  const approvedCount = rows.filter(r => r.status === 'approved').length

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1 flex items-start gap-2">
          <FileText size={13} className="text-wm-text-muted shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-wm-text truncate">{att.file_name}</p>
            <p className="text-[10.5px] text-wm-text-subtle font-mono">
              {bucket ? `${bucket} · ` : ''}
              {att.mime_type ?? 'unknown'} · {att.size_bytes ? formatBytes(att.size_bytes) : '—'}
              {' · '}uploaded {fmtRelative(att.uploaded_at)}
            </p>
          </div>
        </div>
        <StatusBadge att={att} draftCount={draftCount} approvedCount={approvedCount} />
      </div>

      {att.parse_error && (
        <div className="rounded-md border border-rose-300 bg-rose-50/50 px-2 py-1.5 text-[11px] text-rose-800 flex items-start gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          <span className="font-mono whitespace-pre-wrap break-words">{att.parse_error}</span>
        </div>
      )}

      {!compact && rows.length > 0 && (
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {rows.slice(0, 12).map(r => (
            <div key={r.id} className={`text-[11px] px-2 py-1 rounded border ${r.status === 'approved' ? 'border-emerald-200 bg-emerald-50/40' : r.status === 'archived' ? 'border-wm-border bg-wm-bg-elevated text-wm-text-subtle line-through' : 'border-wm-border bg-wm-bg'}`}>
              <span className="font-mono text-[10px] text-wm-text-subtle mr-1.5">{r.topic}</span>
              <span className="text-wm-text">
                {'body' in r ? (r as AtomPreview).body : JSON.stringify((r as FactPreview).data)}
              </span>
            </div>
          ))}
          {rows.length > 12 && (
            <p className="text-[10.5px] text-wm-text-subtle italic pl-2">
              +{rows.length - 12} more
            </p>
          )}
        </div>
      )}

      {!compact && (onApprove || onReject || onReparse) && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {onApprove && draftCount > 0 && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void onApprove()}
              className="inline-flex items-center gap-1 rounded-full bg-wm-accent text-white px-3 py-1 text-[11.5px] font-semibold hover:bg-wm-accent-strong transition-colors disabled:opacity-50"
            >
              {busy === 'approve' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Approve {draftCount} draft{draftCount === 1 ? '' : 's'}
            </button>
          )}
          {onReject && draftCount > 0 && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void onReject()}
              className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors disabled:opacity-50"
            >
              {busy === 'reject' ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              Reject all
            </button>
          )}
          {onReparse && (
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void onReparse()}
              className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg-elevated px-3 py-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text hover:border-wm-accent transition-colors disabled:opacity-50"
            >
              {busy === 'reparse' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
              Re-parse
            </button>
          )}
          <a
            href={publicUrlFor(att.file_path)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-wm-text-muted hover:text-wm-text"
          >
            <ExternalLink size={11} />
            View file
          </a>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ att, draftCount, approvedCount }: { att: AttachmentRow; draftCount: number; approvedCount: number }) {
  if (!att.parsed_at) {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-wm-border bg-wm-bg-elevated text-wm-text-muted">Queued</span>
  }
  if (att.parse_error) {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-rose-300 bg-rose-50 text-rose-800">Failed</span>
  }
  if (att.parsed_destination === 'unsupported') {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-wm-border bg-wm-bg-elevated text-wm-text-subtle">Unsupported</span>
  }
  if (att.parsed_destination === 'rejected') {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-wm-border bg-wm-bg-elevated text-wm-text-subtle">Rejected</span>
  }
  if (draftCount > 0) {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-amber-300 bg-amber-50 text-amber-800">{draftCount} draft{draftCount === 1 ? '' : 's'}</span>
  }
  if (approvedCount > 0) {
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-emerald-300 bg-emerald-50 text-emerald-800">{approvedCount} approved</span>
  }
  return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-wm-border bg-wm-bg-elevated text-wm-text-subtle">No rows</span>
}

// ── Tiny helpers ──────────────────────────────────────────────────

function publicUrlFor(filePath: string): string {
  return supabase.storage.from('content-collection-files').getPublicUrl(filePath).data.publicUrl
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function fmtRelative(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

