/**
 * Dedicated Discovery Brief view.
 *
 * Route: /churches/:memberId/discovery-brief
 *
 * Wraps the read-only `DiscoveryBriefSection` (every accordion expanded
 * by default for a focused, scrollable view) with breadcrumbs and
 * export controls so staff can hand the data off to AI tools (paste
 * into Claude / ChatGPT or upload a JSON file to Strategy Brief
 * Generator). Both export controls operate on the same payload.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, Copy, Check, Download, ArrowLeft, Inbox } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listQuestionnaireFiles } from '../lib/discoveryQuestionnaire'
import DiscoveryBriefSection from '../components/churches/DiscoveryBriefSection'
import type {
  StrategyAccountProgress,
  StrategyDiscoveryQuestionnaire,
  StrategyDiscoveryQuestionnaireFile,
} from '../types/database'

export default function DiscoveryBriefPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const navigate = useNavigate()
  const memberNum = Number(memberId)

  const [church, setChurch] = useState<StrategyAccountProgress | null>(null)
  const [row, setRow] = useState<StrategyDiscoveryQuestionnaire | null>(null)
  const [files, setFiles] = useState<StrategyDiscoveryQuestionnaireFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Used by the Copy button to show a brief "Copied!" affordance.
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!memberNum) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const [churchRes, rowRes] = await Promise.all([
          supabase
            .from('strategy_account_progress')
            .select('member, church_name, css_rep')
            .eq('member', memberNum)
            .maybeSingle(),
          supabase
            .from('strategy_discovery_questionnaire')
            .select('*')
            .eq('member', memberNum)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (churchRes.error) throw churchRes.error
        if (rowRes.error) throw rowRes.error
        if (cancelled) return
        setChurch(churchRes.data as StrategyAccountProgress | null)
        const r = rowRes.data as StrategyDiscoveryQuestionnaire | null
        setRow(r)
        if (r) {
          const fs = await listQuestionnaireFiles(r.id)
          if (!cancelled) setFiles(fs)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [memberNum])

  const exportPayload = useMemo(() => buildExportPayload(row, files), [row, files])
  const exportJson = useMemo(() => JSON.stringify(exportPayload, null, 2), [exportPayload])
  const churchName = church?.church_name ?? `Member #${memberNum}`

  const onCopy = async () => {
    if (!row) return
    try {
      await navigator.clipboard.writeText(exportJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fall back to a textarea-select pattern. Browsers without async
      // clipboard support are rare in our staff base — log once.
      console.warn('navigator.clipboard.writeText failed; user can use Download instead')
    }
  }

  const onDownload = () => {
    if (!row) return
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = buildExportFilename(row, churchName)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-4xl mx-auto">

        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center flex-wrap gap-1 text-xs text-purple-gray">
          <RouterLink to="/churches" className="hover:text-primary-purple transition-colors">
            Churches
          </RouterLink>
          <ChevronRight size={12} className="opacity-60" />
          <RouterLink
            to={`/churches/${memberNum}`}
            className="hover:text-primary-purple transition-colors max-w-[40ch] truncate"
          >
            {churchName}
          </RouterLink>
          <ChevronRight size={12} className="opacity-60" />
          <span className="text-deep-plum font-semibold">Discovery Brief</span>
        </nav>

        {/* Back affordance */}
        <button
          type="button"
          onClick={() => navigate(`/churches/${memberNum}`)}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to {churchName}
        </button>

        {/* Header — title + export controls */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-purple">
              Discovery Brief
            </p>
            <h1 className="text-2xl font-semibold text-deep-plum tracking-tight">
              {churchName}
            </h1>
            {row && (
              <p className="text-sm text-purple-gray mt-0.5">
                Submitted {formatDate(row.submitted_at)}
                {row.cohort && <> · {row.cohort}</>}
                {row.source !== 'native' && (
                  <> · <span className="italic">{row.source === 'airtable_legacy' ? 'Migrated from Airtable' : 'FillOut'}</span></>
                )}
              </p>
            )}
          </div>
          {row && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3.5 py-2 hover:border-primary-purple hover:text-primary-purple transition-colors"
                title="Copy the full brief as JSON for pasting into AI tools"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy JSON'}
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-2 hover:bg-primary-purple transition-colors"
                title="Download a JSON file you can upload to AI tools"
              >
                <Download size={12} />
                Download JSON
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        {loading && (
          <div className="rounded-xl border border-lavender bg-white p-6 text-sm text-purple-gray/70 italic">
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && !row && (
          <div className="rounded-xl border border-lavender bg-white p-8 text-center">
            <Inbox size={28} className="mx-auto text-purple-gray/60 mb-2" />
            <p className="text-sm font-semibold text-deep-plum">No discovery questionnaire on file</p>
            <p className="text-xs text-purple-gray mt-1">
              Once a partner submits the form, the brief will appear here automatically.
            </p>
          </div>
        )}
        {!loading && !error && row && (
          <DiscoveryBriefSection member={memberNum} defaultExpanded />
        )}
      </div>
    </div>
  )
}

// ── Export helpers ────────────────────────────────────────────────────────

/** Shape the JSON download / clipboard copy uses. We strip the
 *  passthrough `[key: string]: unknown` index from the row by only
 *  copying enumerable values, then attach the file metadata so the
 *  consumer (AI tool) sees one self-contained object. */
function buildExportPayload(
  row: StrategyDiscoveryQuestionnaire | null,
  files: StrategyDiscoveryQuestionnaireFile[],
): Record<string, unknown> {
  if (!row) return { row: null, files: [] }
  const { ...rest } = row
  return {
    member: row.member,
    submission_id: row.submission_id,
    source: row.source,
    submitted_at: row.submitted_at,
    exported_at: new Date().toISOString(),
    questionnaire: rest,
    files: files.map(f => ({
      file_kind: f.file_kind,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      storage_path: f.storage_path,
      source_url: f.source_url,
    })),
  }
}

function buildExportFilename(
  row: StrategyDiscoveryQuestionnaire,
  churchName: string,
): string {
  const slug = churchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `member-${row.member}`
  const date = (row.submitted_at ?? '').slice(0, 10) || 'unknown'
  return `discovery-brief-${slug}-${date}.json`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
