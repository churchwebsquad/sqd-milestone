/**
 * Website Manager — Intake (v1).
 *
 * Verification checklist for the foundational inputs Content Manager
 * relies on. Three hard stops (Discovery Questionnaire, Strategy
 * Brief, Brand Handoff) gate the Continue button; AM Handoff +
 * Content Collection are optional.
 *
 * Most categories source from existing Supabase tables (joined on
 * member). The two-and-a-half that need uploads (Strategy Brief,
 * Content Collection, Discovery Questionnaire supplemental) land in
 * web_intake_documents + brand-assets bucket under web-intake/{id}/.
 *
 * This page does NOT render the substance of any intake — it's a
 * checklist. Strategist clicks through to the source tool if they
 * need to read the content.
 */

import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight, ArrowLeft, Check, CircleAlert, ExternalLink, Loader2,
  Trash2, Upload,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { uploadAttachment, removeAttachment } from '../../lib/attachmentUpload'
import { fetchIntakeStatus } from '../../lib/webIntake'
import type { IntakeRowStatus, IntakeStatus } from '../../lib/webIntake'
import type { StrategyWebProject, WebIntakeCategory, WebIntakeDocument } from '../../types/database'

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
  brand_handoff: {
    title: 'Brand Handoff',
    description: 'The Brand Squad\'s official handoff for this partner.',
    hardStop: true,
    uploadCategory: null,
    emptyHint: 'Brand Squad hasn\'t published a brand handoff yet. Optionally paste an external brand guide URL below.',
  },
  am_handoff: {
    title: 'AM Handoff',
    description: 'Account manager\'s web-handoff form, captured during onboarding. Upload supplemental notes if the AM shared them through another channel.',
    hardStop: false,
    uploadCategory: 'am_handoff_supplemental',
    emptyHint: 'No AM handoff on file. This is optional — workflow can proceed without it. Upload supplemental notes if the AM shared them through another channel.',
  },
  content_collection: {
    title: 'Content Collection',
    description: 'ContentSnare exports, supporting docs, photo libraries, ministry one-pagers.',
    hardStop: false,
    uploadCategory: 'content_collection',
    emptyHint: 'Optional but strongly recommended — feeds the AI copywriter with real church data.',
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

/** Browsers often report '' or 'application/octet-stream' for .md /
 *  .markdown files. Coerce by extension so the bucket policy accepts. */
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

export default function WebIntakePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<StrategyWebProject | null>(null)
  const [intake, setIntake] = useState<IntakeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!projectId) return
    const { data: p, error: pErr } = await supabase
      .from('strategy_web_projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle()
    if (pErr || !p) { setError(pErr?.message ?? 'Project not found'); setLoading(false); return }
    setProject(p as StrategyWebProject)
    try {
      const status = await fetchIntakeStatus(p.id, p.member)
      setIntake(status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load intake status')
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [projectId])

  const refreshIntake = async () => {
    if (!project) return
    try {
      const status = await fetchIntakeStatus(project.id, project.member)
      setIntake(status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh intake')
    }
  }

  if (loading) {
    return (
      <div className="min-h-full grid place-items-center text-purple-gray">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (error || !project || !intake) {
    return (
      <div className="min-h-full py-6 px-4 md:px-6 max-w-3xl mx-auto">
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? 'Project not found.'}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center flex-wrap gap-1 text-xs text-purple-gray">
          <Link to="/web" className="hover:text-primary-purple transition-colors">Website Manager</Link>
          <span className="opacity-60">›</span>
          <Link to={`/web/${project.id}`} className="hover:text-primary-purple transition-colors">{project.name}</Link>
          <span className="opacity-60">›</span>
          <span className="text-deep-plum font-semibold">Intake</span>
        </nav>

        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Intake</p>
            <h1 className="text-2xl font-semibold text-deep-plum">Foundations checklist</h1>
            <p className="text-sm text-purple-gray mt-1 max-w-xl">
              Verify the inputs Content Manager and Design Manager depend on. Three hard stops gate
              entry to content authoring. Actual review of each input happens in its source tool.
            </p>
          </div>
        </div>

        <StatusBar intake={intake} />

        <div className="mt-5 space-y-3">
          {(['discovery_questionnaire', 'strategy_brief', 'brand_handoff', 'am_handoff', 'content_collection'] as const).map(key => (
            <IntakeRow
              key={key}
              rowKey={key}
              row={intake[key]}
              project={project}
              onChange={refreshIntake}
              onProjectChange={(patch) => setProject(p => p ? { ...p, ...patch } as StrategyWebProject : p)}
            />
          ))}

          {/* Phase 2 placeholder */}
          <div className="rounded-xl border border-dashed border-lavender bg-white/40 px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-deep-plum">Site crawl</p>
              <p className="text-xs text-purple-gray mt-0.5">Automated crawl of the partner's current site.</p>
            </div>
            <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray bg-lavender-tint px-2 py-1 rounded-full">
              Phase 2
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => navigate(`/web/${project.id}`)}
            className="inline-flex items-center gap-1.5 text-sm text-deep-plum hover:text-primary-purple transition-colors"
          >
            <ArrowLeft size={15} /> Back to project
          </button>
          <button
            type="button"
            onClick={() => navigate(`/web/${project.id}/content`)}
            disabled={!intake.ready_for_content}
            className={[
              'rounded-full px-5 py-2 text-sm font-semibold inline-flex items-center gap-2 transition-colors',
              intake.ready_for_content
                ? 'bg-deep-plum text-white hover:bg-primary-purple'
                : 'bg-lavender-tint text-purple-gray/70 cursor-not-allowed',
            ].join(' ')}
          >
            Continue to Content Manager <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status bar ────────────────────────────────────────────────────────

function StatusBar({ intake }: { intake: IntakeStatus }) {
  const pct = (intake.hard_stops_complete / intake.hard_stops_total) * 100
  return (
    <div className="rounded-xl border border-lavender bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-deep-plum">
          Hard stops: <span className={intake.ready_for_content ? 'text-emerald-700' : 'text-amber-700'}>
            {intake.hard_stops_complete} of {intake.hard_stops_total}
          </span>
        </p>
        <p className="text-xs text-purple-gray">
          {intake.ready_for_content ? 'Ready for Content Manager' : 'Awaiting required inputs'}
        </p>
      </div>
      <div className="h-1.5 bg-lavender-tint rounded-full overflow-hidden">
        <div
          className={['h-full rounded-full transition-all', intake.ready_for_content ? 'bg-emerald-600' : 'bg-primary-purple'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────

function IntakeRow({
  rowKey, row, project, onChange, onProjectChange,
}: {
  rowKey: RowKey
  row: IntakeRowStatus
  project: StrategyWebProject
  onChange: () => Promise<void>
  onProjectChange: (patch: Partial<StrategyWebProject>) => void
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
    await supabase.from('web_intake_documents').update({ archived: true }).eq('id', doc.id)
    await removeAttachment(doc.storage_path, INTAKE_BUCKET)
    await onChange()
  }

  return (
    <div className="rounded-xl border border-lavender bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill received={row.received} hardStop={meta.hardStop} />
            <h2 className="text-base font-semibold text-deep-plum">{meta.title}</h2>
            {!meta.hardStop && (
              <span className="text-[10px] uppercase tracking-widest text-purple-gray">Optional</span>
            )}
          </div>
          <p className="text-xs text-purple-gray mt-1">{meta.description}</p>

          {row.received && row.source_label && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-700">
              <Check size={12} />
              <span>
                {row.source_label}
                {row.received_at && <span className="text-purple-gray/80 ml-1">· {formatDate(row.received_at)}</span>}
              </span>
              {row.source_url && (
                <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                  view <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
          {!row.received && (
            <p className="text-[11px] text-purple-gray italic mt-2">{meta.emptyHint}</p>
          )}
        </div>
      </div>

      {/* Uploaded files (when applicable) */}
      {row.uploaded_files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {row.uploaded_files.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-2 bg-lavender-tint/40 rounded-md px-3 py-1.5 text-xs">
              <div className="min-w-0 flex items-center gap-2">
                <a href={f.storage_url} target="_blank" rel="noopener noreferrer" className="text-deep-plum hover:underline truncate inline-flex items-center gap-1">
                  {f.filename} <ExternalLink size={10} />
                </a>
                {f.file_size_bytes != null && (
                  <span className="text-purple-gray whitespace-nowrap">{(f.file_size_bytes / 1024 / 1024).toFixed(2)} MB</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(f)}
                aria-label="Remove file"
                className="text-purple-gray hover:text-red-700 transition-colors p-1"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Upload affordance */}
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
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 bg-white border border-lavender text-deep-plum hover:border-primary-purple hover:text-primary-purple transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? 'Uploading…' : (row.uploaded_files.length > 0 ? 'Upload another' : 'Upload file')}
          </button>
          {uploadError && <p className="text-[11px] text-red-600 mt-1.5">{uploadError}</p>}
        </div>
      )}

      {/* Special per-row affordances */}
      {rowKey === 'strategy_brief' && (
        <NotionUrlField
          value={project.strategy_brief_notion_url ?? ''}
          onSave={async (v) => {
            const { error } = await supabase
              .from('strategy_web_projects')
              .update({ strategy_brief_notion_url: v.trim() || null })
              .eq('id', project.id)
            if (!error) onProjectChange({ strategy_brief_notion_url: v.trim() || null })
          }}
          label="Notion URL (optional)"
          placeholder="https://www.notion.so/…"
        />
      )}
      {rowKey === 'brand_handoff' && (
        <NotionUrlField
          value={project.external_brand_guide_url ?? ''}
          onSave={async (v) => {
            const { error } = await supabase
              .from('strategy_web_projects')
              .update({ external_brand_guide_url: v.trim() || null })
              .eq('id', project.id)
            if (!error) onProjectChange({ external_brand_guide_url: v.trim() || null })
          }}
          label="External brand guide URL (optional)"
          placeholder="https://live.standards.site/…"
        />
      )}
    </div>
  )
}

// ── Status pill ───────────────────────────────────────────────────────

function StatusPill({ received, hardStop }: { received: boolean; hardStop: boolean }) {
  if (received) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check size={10} /> Received
      </span>
    )
  }
  return (
    <span className={[
      'inline-flex items-center gap-1 rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border',
      hardStop ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-white text-purple-gray border-lavender',
    ].join(' ')}>
      <CircleAlert size={10} /> Pending
    </span>
  )
}

// ── Notion / external URL field ──────────────────────────────────────

function NotionUrlField({
  value, onSave, label, placeholder,
}: {
  value: string
  onSave: (v: string) => Promise<void>
  label: string
  placeholder: string
}) {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = draft.trim() !== (value ?? '').trim()

  const save = async () => {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="mt-3">
      <label className="text-[10px] uppercase tracking-widest font-bold text-purple-gray/80 block mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-full border border-lavender bg-white px-3 py-1.5 text-xs text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
        />
        {dirty && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="text-[11px] font-semibold rounded-full px-3 py-1.5 bg-deep-plum text-white hover:bg-primary-purple transition-colors disabled:opacity-50"
          >
            {saving ? '…' : 'Save'}
          </button>
        )}
        {saved && !dirty && (
          <span className="text-[11px] text-emerald-700 inline-flex items-center gap-0.5"><Check size={11}/> Saved</span>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return s }
}
