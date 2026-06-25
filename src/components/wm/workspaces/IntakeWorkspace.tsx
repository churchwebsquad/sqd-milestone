/**
 * Web Manager — Intake workspace.
 *
 * Foundations checklist embedded inside the Site Manager tab strip.
 * Five categories with status pills + per-category upload affordance:
 *   Discovery Questionnaire (hard stop)
 *   Strategy Brief (hard stop)
 *   Brand Handoff (optional)
 *   AM Handoff (optional)
 *   Content Collection (hard stop)
 *
 * Layout matches the (legacy) `WebIntakePage` body content. The
 * legacy page still works via /web/:projectId/intake for any deep
 * links; over time it becomes a thin redirect into this tab.
 */

import { useEffect, useState, useRef } from 'react'
import {
  Check, CircleAlert, ChevronDown, ChevronRight, ClipboardList,
  ExternalLink, Loader2, Trash2, Upload,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { uploadAttachment, removeAttachment } from '../../../lib/attachmentUpload'
import { fetchIntakeStatus } from '../../../lib/webIntake'
import { CrawlWorkspace } from './CrawlWorkspace'
import { CrawlInventory } from './CrawlInventory'
import { ContentCollectionResponsesPanel } from './ContentCollectionResponsesPanel'
import { PartnerUploadReview } from '../inventory/PartnerUploadReview'
import type { IntakeRowStatus, IntakeStatus } from '../../../lib/webIntake'
import type { StrategyWebProject, WebIntakeCategory, WebIntakeDocument } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

type RowKey = IntakeRowStatus['key']

const ROW_META: Record<RowKey, {
  title: string
  description: string
  hardStop: boolean
  uploadCategory: WebIntakeCategory | null
  emptyHint: string
}> = {
  discovery_questionnaire: {
    title: 'Discovery Questionnaire',
    description: 'Partner\'s onboarding answers — vision, audience, brand + web needs.',
    hardStop: true,
    uploadCategory: 'discovery_questionnaire_supplemental',
    emptyHint: 'No partner submission on file. Upload a supplemental file if the partner answered through another channel.',
  },
  strategy_brief: {
    title: 'Strategy Brief',
    description: 'The signed strategy doc from the strategy discovery call.',
    hardStop: true,
    uploadCategory: 'strategy_brief',
    emptyHint: 'Upload the latest Notion export or signed PDF.',
  },
  content_strategy: {
    title: 'Content Strategy (optional)',
    description: 'Pre-written content strategy with sitemap, personas, x-factor, voice. When uploaded, the cowork pipeline lifts these elements 1:1 instead of re-deriving them from atoms.',
    hardStop: false,
    uploadCategory: 'content_strategy',
    emptyHint: 'Optional. Skip if the project doesn\'t have one — the pipeline will synthesize from atoms + discovery. Upload if you have a pre-written content-strategy doc and want it taken as authoritative.',
  },
  brand_handoff: {
    title: 'Brand Handoff',
    description: 'The Brand Squad\'s official handoff for this partner.',
    hardStop: false,
    uploadCategory: null,
    emptyHint: 'Brand Squad hasn\'t published a brand handoff yet. Optional — workflow can proceed without it.',
  },
  am_handoff: {
    title: 'AM Handoff',
    description: 'Account manager\'s web-handoff form, captured during onboarding. Upload supplemental notes if the AM shared them through another channel.',
    hardStop: false,
    uploadCategory: 'am_handoff_supplemental',
    emptyHint: 'No AM handoff on file. This is optional — workflow can proceed without it.',
  },
  content_collection: {
    title: 'Content Collection',
    description: 'ContentSnare exports, supporting docs, photo libraries, ministry one-pagers.',
    hardStop: true,
    uploadCategory: 'content_collection',
    emptyHint: 'Required. Every downstream stage references real church content — sitemap, page outlines, and copy all pull from here.',
  },
}

const INTAKE_BUCKET = 'brand-assets'
const INTAKE_ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
]
const INTAKE_MAX_BYTES = 20 * 1024 * 1024

function normalizeFileType(file: File): File {
  const lower = file.name.toLowerCase()
  if ((lower.endsWith('.md') || lower.endsWith('.markdown')) &&
      (!file.type || file.type === 'application/octet-stream' || file.type === 'text/plain')) {
    return new File([file], file.name, { type: 'text/markdown' })
  }
  if (lower.endsWith('.txt') && (!file.type || file.type === 'application/octet-stream')) {
    return new File([file], file.name, { type: 'text/plain' })
  }
  return file
}

export function IntakeWorkspace({ project, onChange }: Props) {
  const [intake, setIntake] = useState<IntakeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoFireMsg, setAutoFireMsg] = useState<string | null>(null)

  const refreshIntake = async () => {
    try {
      const status = await fetchIntakeStatus(project.id, project.member)
      setIntake(status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load intake status')
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const status = await fetchIntakeStatus(project.id, project.member)
        if (!cancelled) setIntake(status)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load intake status')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [project.id, project.member])

  // Auto-fire normalize-intake + aggregate-strategic-goals when the
  // three hard stops have just finished AND no atoms exist yet for
  // the project. This is the "content collection is done — run the
  // first cowork stages" trigger the strategist used to fire manually.
  // De-duped via sessionStorage so re-renders don't re-fire.
  useEffect(() => {
    if (!intake?.ready_for_content) return
    const dedupKey = `cowork-autofire-cc.${project.id}`
    if (sessionStorage.getItem(dedupKey)) return
    let cancelled = false
    void (async () => {
      const { count: atomCount } = await supabase
        .from('content_atoms')
        .select('id', { count: 'exact', head: true })
        .eq('web_project_id', project.id)
      if (cancelled) return
      if ((atomCount ?? 0) > 0) {
        sessionStorage.setItem(dedupKey, '1')
        return
      }
      sessionStorage.setItem(dedupKey, '1')
      setAutoFireMsg('Content collection is complete — running normalize-intake + strategic-goals snapshot. This takes 1-2 minutes; you can keep working.')
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      if (!jwt) {
        setAutoFireMsg('Auto-fire skipped: no auth session. Run normalize-intake manually from the Cowork tab.')
        return
      }
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` }
      // normalize-intake runs LONG (minutes). Browser fetches typically
      // abort at ~60-300s, which would cancel the function before it
      // finishes — leaving atom_count=0 even though the strategist saw
      // "Triggered…" in the toast. Two fixes:
      //   1. `keepalive: true` — tells the browser to keep the request
      //      alive even when the page is unloaded, raising the abort
      //      ceiling.
      //   2. Don't AWAIT the slow one. Send-and-forget; the function
      //      keeps running on Vercel until its maxDuration (800s).
      // strategic-goals aggregation is quick — we DO await that so the
      // toast flips to "Triggered" only after both kickoffs completed.
      try {
        // Fire-and-forget normalize-intake. Don't await — Vercel will
        // continue running it after the browser disconnects.
        void fetch('/api/web/agents/orchestrate', {
          method: 'POST', headers,
          body: JSON.stringify({ action: 'run_normalize', projectId: project.id }),
          keepalive: true,
        }).catch(() => { /* swallow — server side keeps running */ })
        // Await the quick one so we surface its errors meaningfully.
        const sgRes = await fetch('/api/web/cowork/aggregate-strategic-goals', {
          method: 'POST', headers,
          body: JSON.stringify({ project_id: project.id }),
        })
        if (!sgRes.ok) {
          const body = await sgRes.json().catch(() => ({}))
          throw new Error(`strategic-goals: ${(body as { error?: string }).error ?? sgRes.statusText}`)
        }
        if (!cancelled) setAutoFireMsg('Triggered normalize-intake (running in background, 1-2 min) + strategic-goals snapshot. Refresh the Cowork tab in a minute to see atoms appear.')
      } catch (e) {
        if (!cancelled) setAutoFireMsg(`Auto-fire failed: ${e instanceof Error ? e.message : 'unknown error'}. Run normalize-intake manually from Cowork.`)
      }
    })()
    return () => { cancelled = true }
  }, [intake?.ready_for_content, project.id])

  if (loading) {
    return (
      <div className="p-6 grid place-items-center text-wm-text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error || !intake) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-md bg-wm-danger-bg border border-wm-danger/15 px-4 py-3 text-sm text-wm-danger">
          {error ?? 'Failed to load intake.'}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
            <ClipboardList size={13} />
            <p className="text-[11px] font-bold uppercase tracking-widest">Intake &amp; Crawl</p>
          </div>
          <h1 className="text-2xl font-semibold text-wm-text">Foundations</h1>
          <p className="text-sm text-wm-text-muted mt-1 max-w-2xl">
            Inputs every downstream tab depends on. Three hard stops gate
            authoring; the crawl populates snippets + voice signals
            automatically once it runs.
          </p>
        </header>

        {autoFireMsg && (
          <div className="rounded-lg border border-wm-accent/30 bg-wm-accent-tint/40 px-4 py-3 text-[12.5px] text-wm-text flex items-start gap-2">
            <Loader2 size={14} className="shrink-0 mt-0.5 animate-spin text-wm-accent" />
            <span>{autoFireMsg}</span>
          </div>
        )}

        {/* Compact checklist — each row collapses to a single line by
            default. Click to expand for uploads + per-row affordances. */}
        <section className="rounded-xl border border-wm-border bg-wm-bg-elevated">
          <CompactStatusBar intake={intake} />
          <ul className="divide-y divide-wm-border">
            {(['discovery_questionnaire', 'strategy_brief', 'content_strategy', 'brand_handoff', 'am_handoff', 'content_collection'] as const).map(key => (
              <CompactIntakeRow
                key={key}
                rowKey={key}
                row={intake[key]}
                project={project}
                onChange={async () => { await refreshIntake(); await onChange() }}
              />
            ))}
          </ul>
        </section>

        {/* Copywriting branch — optional. When the partner came in
            with copy already drafted in Notion, the cowork pipeline
            collapses steps 7-10 into an autonomous audit pass instead
            of generating from scratch. */}
        <CopywritingSection project={project} onChange={onChange} />

        {/* Site crawl — formerly its own tab, now lives alongside the
            checklist since intake + crawl together form the "what do
            we know about this church?" surface. */}
        <CrawlWorkspace project={project} onProjectChange={onChange} />

        {/* Partner Responses — what the partner answered on the
            Content Collection portal. Sits between the crawl + the
            inventory so staff sees the partner's voice alongside the
            crawl's findings. Hides itself if no session exists. */}
        <ContentCollectionResponsesPanel projectId={project.id} />

        {/* Partner Uploads — files the partner attached via "Add
            something we missed." Each is ingested into church_facts
            (CSVs) or content_atoms (text docs); strategist approves
            the drafts here before they enter the content pool. Hides
            itself when no uploads exist. */}
        <PartnerUploadReview projectId={project.id} />

        {/* Crawl Inventory — topic-bucketed view of crawled content
            (voice signals on narrative topics, structured items on
            sermons/events/staff). Populated automatically by the
            crawl-categorize edge function. */}
        <CrawlInventory projectId={project.id} />
      </div>
    </div>
  )
}

// ── Status bar ────────────────────────────────────────────────────────

function StatusBar({ intake }: { intake: IntakeStatus }) {
  const pct = (intake.hard_stops_complete / intake.hard_stops_total) * 100
  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[13px] font-semibold text-wm-text">
          Hard stops:{' '}
          <span className={intake.ready_for_content ? 'text-wm-success' : 'text-wm-warn'}>
            {intake.hard_stops_complete} of {intake.hard_stops_total}
          </span>
        </p>
        <p className="text-[11px] text-wm-text-muted">
          {intake.ready_for_content ? 'Ready to author' : 'Awaiting required inputs'}
        </p>
      </div>
      <div className="h-1.5 bg-wm-bg-hover rounded-full overflow-hidden">
        <div
          className={['h-full rounded-full transition-all', intake.ready_for_content ? 'bg-wm-success' : 'bg-wm-accent'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Condensed bar + row ───────────────────────────────────────────────

function CompactStatusBar({ intake }: { intake: IntakeStatus }) {
  const pct = (intake.hard_stops_complete / intake.hard_stops_total) * 100
  return (
    <header className="px-4 py-2.5 border-b border-wm-border bg-wm-bg-hover/30 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-wm-text leading-tight">
          Hard stops:{' '}
          <span className={intake.ready_for_content ? 'text-wm-success' : 'text-wm-warn'}>
            {intake.hard_stops_complete} of {intake.hard_stops_total}
          </span>
          <span className="ml-2 text-[10px] text-wm-text-muted font-normal">
            {intake.ready_for_content ? 'Ready to author' : 'Awaiting required inputs'}
          </span>
        </p>
        <div className="mt-1.5 h-1 bg-wm-bg-hover rounded-full overflow-hidden">
          <div
            className={['h-full rounded-full transition-all', intake.ready_for_content ? 'bg-wm-success' : 'bg-wm-accent'].join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </header>
  )
}

function CompactIntakeRow({
  rowKey, row, project, onChange,
}: {
  rowKey: RowKey
  row: IntakeRowStatus
  project: StrategyWebProject
  onChange: () => Promise<void>
}) {
  const meta = ROW_META[rowKey]
  // Default-expand pending hard stops (action needed); default-collapse
  // everything else (just confirmation).
  const defaultOpen = meta.hardStop && !row.received
  const [open, setOpen] = useState(defaultOpen)

  const fileCount = row.uploaded_files.length

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2 flex items-center gap-3 hover:bg-wm-bg-hover/30 transition-colors text-left"
      >
        <span className="shrink-0 text-wm-text-subtle">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <CompactStatusPill received={row.received} hardStop={meta.hardStop} />
        <span className="flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-wm-text">{meta.title}</span>
          {!meta.hardStop && (
            <span className="ml-2 text-[10px] uppercase tracking-widest text-wm-text-subtle">Optional</span>
          )}
          {row.received && row.source_label && (
            <span className="ml-2 text-[11px] text-wm-text-muted truncate">
              · {row.source_label}
            </span>
          )}
        </span>
        {fileCount > 0 && (
          <span className="shrink-0 text-[10px] text-wm-text-muted bg-wm-bg px-1.5 py-0.5 rounded">
            {fileCount} file{fileCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 pl-12 border-t border-wm-border/40">
          <IntakeRow
            rowKey={rowKey}
            row={row}
            project={project}
            onChange={onChange}
          />
        </div>
      )}
    </li>
  )
}

function CompactStatusPill({ received, hardStop }: { received: boolean; hardStop: boolean }) {
  if (received) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-wm-success-bg text-wm-success border border-wm-success/20 shrink-0">
        <Check size={9} />
      </span>
    )
  }
  return (
    <span className={[
      'inline-flex items-center gap-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border shrink-0',
      hardStop ? 'bg-wm-warn-bg text-wm-warn border-wm-warn/20' : 'bg-wm-bg text-wm-text-muted border-wm-border',
    ].join(' ')}>
      <CircleAlert size={9} />
    </span>
  )
}

// ── Row ───────────────────────────────────────────────────────────────

function IntakeRow({
  rowKey, row, project, onChange,
}: {
  rowKey: RowKey
  row: IntakeRowStatus
  project: StrategyWebProject
  onChange: () => Promise<void>
}) {
  const meta = ROW_META[rowKey]
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    if (!meta.uploadCategory) return
    setUploading(true)
    setUploadError(null)
    try {
      const normalized = normalizeFileType(file)
      const result = await uploadAttachment(normalized, null, undefined, {
        bucket: INTAKE_BUCKET,
        pathPrefix: `web-intake/${project.id}/${meta.uploadCategory}`,
        allowedMime: INTAKE_ALLOWED_MIME,
        maxBytes: INTAKE_MAX_BYTES,
      })
      const { error: insertErr } = await supabase
        .from('web_intake_documents')
        .insert({
          web_project_id: project.id,
          category: meta.uploadCategory,
          filename: file.name,
          storage_path: result.path,
          storage_url: result.url,
          file_size_bytes: result.size,
          mime_type: normalized.type || null,
        })
      if (insertErr) throw new Error(insertErr.message)
      await onChange()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async (doc: WebIntakeDocument) => {
    if (!confirm(`Remove "${doc.filename}"?`)) return
    await (supabase as any).from('web_intake_documents').update({ archived: true }).eq('id', doc.id)
    await removeAttachment(doc.storage_path, INTAKE_BUCKET)
    await onChange()
  }

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated px-4 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill received={row.received} hardStop={meta.hardStop} />
            <h2 className="text-[14px] font-semibold text-wm-text">{meta.title}</h2>
            {!meta.hardStop && (
              <span className="text-[10px] uppercase tracking-widest text-wm-text-subtle">Optional</span>
            )}
          </div>
          <p className="text-[12px] text-wm-text-muted mt-1">{meta.description}</p>

          {row.received && row.source_label && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-wm-success">
              <Check size={12} />
              <span>
                {row.source_label}
                {row.received_at && <span className="text-wm-text-subtle ml-1">· {formatDate(row.received_at)}</span>}
              </span>
              {row.source_url && (
                <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                  view <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
          {!row.received && (
            <p className="text-[11px] text-wm-text-subtle italic mt-2">{meta.emptyHint}</p>
          )}
        </div>
      </div>

      {row.uploaded_files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {row.uploaded_files.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-2 bg-wm-bg-hover/40 rounded-md px-3 py-1.5 text-[12px]">
              <div className="min-w-0 flex items-center gap-2">
                <a href={f.storage_url} target="_blank" rel="noopener noreferrer" className="text-wm-text hover:underline truncate inline-flex items-center gap-1">
                  {f.filename} <ExternalLink size={10} />
                </a>
                {f.file_size_bytes != null && (
                  <span className="text-wm-text-subtle whitespace-nowrap">{(f.file_size_bytes / 1024 / 1024).toFixed(2)} MB</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(f)}
                aria-label="Remove file"
                className="text-wm-text-subtle hover:text-wm-danger transition-colors p-1"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {meta.uploadCategory && (
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.markdown,.zip,.jpg,.jpeg,.png,.gif,.webp,.svg"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-3 py-1.5 bg-wm-bg-elevated border border-wm-border text-wm-text hover:border-wm-accent hover:text-wm-accent-strong transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? 'Uploading…' : (row.uploaded_files.length > 0 ? 'Upload another' : 'Upload file')}
          </button>
          {uploadError && <p className="text-[11px] text-wm-danger mt-1.5">{uploadError}</p>}
        </div>
      )}

      {rowKey === 'strategy_brief' && (
        <ExternalUrlField
          label="Notion URL (optional)"
          placeholder="https://www.notion.so/…"
          initialValue={project.strategy_brief_notion_url ?? ''}
          onSave={async (v) => {
            await (supabase as any)
              .from('strategy_web_projects')
              .update({ strategy_brief_notion_url: v.trim() || null })
              .eq('id', project.id)
            await onChange()
          }}
        />
      )}
      {rowKey === 'brand_handoff' && (
        <ExternalUrlField
          label="External brand guide URL (optional)"
          placeholder="https://live.standards.site/…"
          initialValue={project.external_brand_guide_url ?? ''}
          onSave={async (v) => {
            await (supabase as any)
              .from('strategy_web_projects')
              .update({ external_brand_guide_url: v.trim() || null })
              .eq('id', project.id)
            await onChange()
          }}
        />
      )}
    </div>
  )
}

function StatusPill({ received, hardStop }: { received: boolean; hardStop: boolean }) {
  if (received) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 bg-wm-success-bg text-wm-success border border-wm-success/20">
        <Check size={10} /> Received
      </span>
    )
  }
  return (
    <span className={[
      'inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border',
      hardStop ? 'bg-wm-warn-bg text-wm-warn border-wm-warn/20' : 'bg-wm-bg text-wm-text-muted border-wm-border',
    ].join(' ')}>
      <CircleAlert size={10} /> Pending
    </span>
  )
}

function ExternalUrlField({
  label, placeholder, initialValue, onSave,
}: {
  label: string
  placeholder: string
  initialValue: string
  onSave: (v: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== initialValue.trim()

  useEffect(() => { setDraft(initialValue) }, [initialValue])

  const save = async () => {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false) }
  }

  return (
    <div className="mt-3">
      <label className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle block mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
        />
        {dirty && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="text-[11px] font-semibold rounded-md px-3 py-1.5 bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? '…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Copywriting branch (Notion-audit) ────────────────────────────────

/**
 * Parses a Notion URL into its database id. Notion URLs come in a
 * few flavors:
 *   https://www.notion.so/<workspace>/<title-with-dashes>-<id-no-dashes>
 *   https://www.notion.so/<id-no-dashes>?v=<view-id>
 *   https://app.notion.com/p/<workspace>/<id-no-dashes>?v=<view-id>
 * Returns the 32-char id (no dashes) or null when the URL doesn't
 * fit any known shape. The strategist UI surfaces the null result
 * as "couldn't parse — paste the full URL" so the typo is obvious.
 */
function extractNotionDatabaseId(input: string): string | null {
  const cleaned = input.trim()
  if (!cleaned) return null
  // Look for a 32-char hex run anywhere in the URL (Notion ids are
  // 32 hex chars, optionally split by dashes). Take the LAST match
  // since query-string view ids appear after the database id.
  const matches = cleaned.match(/[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g)
  if (!matches || matches.length === 0) return null
  // First match wins — that's the database id; later matches are
  // view ids / block ids.
  return matches[0].replace(/-/g, '')
}

function CopywritingSection({
  project, onChange,
}: { project: StrategyWebProject; onChange: () => Promise<void> }) {
  const initiallyOn = !!project.notion_database_id
  const [expanded, setExpanded] = useState(initiallyOn)
  const [urlDraft, setUrlDraft] = useState(project.notion_database_url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsedId = extractNotionDatabaseId(urlDraft)
  const dirty = urlDraft.trim() !== (project.notion_database_url ?? '').trim()

  const save = async () => {
    setError(null)
    if (!urlDraft.trim()) {
      // Empty URL = clearing the branch. Wipe both columns.
      setSaving(true)
      try {
        const { error } = await supabase
          .from('strategy_web_projects')
          .update({ notion_database_id: null, notion_database_url: null })
          .eq('id', project.id)
        if (error) throw error
        await onChange()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to clear Notion link')
      } finally { setSaving(false) }
      return
    }
    if (!parsedId) {
      setError('Couldn\'t find a Notion id in this URL. Paste the full URL from your browser address bar.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('strategy_web_projects')
        .update({ notion_database_id: parsedId, notion_database_url: urlDraft.trim() })
        .eq('id', project.id)
      if (error) throw error
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save Notion link')
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setUrlDraft('')
    setExpanded(false)
    setSaving(true)
    setError(null)
    try {
      const { error } = await supabase
        .from('strategy_web_projects')
        .update({ notion_database_id: null, notion_database_url: null })
        .eq('id', project.id)
      if (error) throw error
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear Notion link')
    } finally { setSaving(false) }
  }

  return (
    <section className="rounded-xl border border-wm-border bg-wm-bg-elevated px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown size={14} className="text-wm-text-muted shrink-0" /> : <ChevronRight size={14} className="text-wm-text-muted shrink-0" />}
          <h2 className="text-[14px] font-semibold text-wm-text">Copywriting (optional, external)</h2>
          {initiallyOn && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-success bg-wm-success/10 px-2 py-0.5 rounded">Audit branch on</span>
          )}
          {!initiallyOn && (
            <span className="text-[10px] uppercase tracking-widest text-wm-text-subtle">Optional</span>
          )}
        </div>
        {project.notion_database_url && (
          <a
            href={project.notion_database_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[11px] text-wm-accent hover:underline inline-flex items-center gap-1 shrink-0"
          >
            Open in Notion <ExternalLink size={11} />
          </a>
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-wm-text-muted leading-snug">
            If the partner came in with copywriting already in progress (e.g. drafts in a Notion database), paste the database URL here. The cowork pipeline will collapse steps 7-10 into an autonomous audit pass that scores the existing copy on the 5 axes and flags formatting gaps against the canonical templates. Pages missing from Notion auto-route to a supplemental authoring step.
          </p>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle block mb-1">
              Notion database URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                placeholder="https://www.notion.so/workspace/Database-name-1234abcd…"
                className="flex-1 min-w-0 rounded-md border border-wm-border bg-wm-bg-elevated px-2.5 py-1.5 text-[12px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15"
              />
              {dirty && (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="text-[11px] font-semibold rounded-md px-3 py-1.5 bg-wm-accent text-wm-text-on-accent hover:bg-wm-accent-hover transition-colors disabled:opacity-50"
                >
                  {saving ? '…' : 'Save'}
                </button>
              )}
              {initiallyOn && !dirty && (
                <button
                  type="button"
                  onClick={() => void clear()}
                  disabled={saving}
                  className="text-[11px] font-medium rounded-md px-3 py-1.5 text-wm-text-muted hover:bg-wm-bg-hover transition-colors disabled:opacity-50"
                  title="Removes the Notion link and reverts the pipeline to the standard generate-from-scratch branch."
                >
                  Clear
                </button>
              )}
            </div>
            {parsedId && (
              <p className="mt-1 text-[11px] text-wm-text-muted">
                Parsed database id: <code className="font-mono">{parsedId}</code>
              </p>
            )}
            {error && (
              <p className="mt-1 text-[11px] text-wm-danger">{error}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return s }
}
