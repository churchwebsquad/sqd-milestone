/**
 * Web Manager — AM Q&A workspace.
 *
 * Account managers send messages asking when the team can hit a
 * given launch date. This page lets the strategist paste the
 * message and get back an evidence-backed draft response per
 * church mentioned, citing the feasibility verdict + the levers
 * that could shift it, framed in tones from the talking-points
 * library.
 *
 * Pipeline (server-side via `am-question-analyze` edge function):
 *   message  → LLM extracts church refs + dates
 *            → resolve to strategy_web_projects
 *            → run feasibility per (project, target_date)
 *            → LLM assembles markdown response with talking points
 *            → audit log to strategy_am_question_drafts
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles, Copy, Check, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { WMStatusPill } from '../../components/wm/StatusPill'
import { useAuth } from '../../contexts/AuthContext'

interface DetectedProjectRef {
  member_id:        number | null
  church_name:      string | null
  matched_project_id: string | null
  confidence:       'high' | 'medium' | 'low'
  target_dates:     Array<{ raw: string; iso: string | null; hardness: 'hard'|'ideal'|'soft' }>
}

interface AnalyzeResult {
  projects:            DetectedProjectRef[]
  response_md:         string
  talking_points_used: string[]
  draft_id:            string | null
  error?:              string
}

export default function AmQuestionsPage() {
  const navigate = useNavigate()
  const { staffProfile } = useAuth()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [responseEdit, setResponseEdit] = useState('')
  const [copied, setCopied] = useState(false)

  const analyze = async () => {
    if (!message.trim() || busy) return
    setBusy(true); setError(null); setResult(null)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('am-question-analyze', {
        body: {
          message,
          employee_id: staffProfile?.id ?? null,
        },
      })
      if (invokeErr) throw invokeErr
      const r = data as AnalyzeResult
      if (r.error) throw new Error(r.error)
      setResult(r)
      setResponseEdit(r.response_md)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(responseEdit)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/web')}
          className="inline-flex items-center gap-1 text-xs text-purple-gray hover:text-deep-plum mb-4"
        >
          <ArrowLeft size={11} /> Web Manager
        </button>

        <header className="mb-6">
          <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Web</p>
          <h1 className="text-2xl font-semibold text-deep-plum">AM questions</h1>
          <p className="text-sm text-purple-gray mt-1 max-w-2xl">
            Paste a message from an account manager asking about launch timelines.
            The analyzer parses the church references + dates, runs feasibility
            against the current schedule, and drafts a response you can copy
            into ClickUp.
          </p>
        </header>

        {/* Message input */}
        <div className="rounded-xl border border-lavender bg-white p-4 mb-4">
          <label className="block mb-2">
            <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">
              AM message
            </span>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={8}
              placeholder="Paste the AM's message here. Mention as many churches as needed — they'll each get their own block in the response."
              className="mt-1 w-full text-[13px] px-3 py-2 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none resize-vertical"
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-purple-gray">
              The analyzer logs every draft to strategy_am_question_drafts for audit.
            </p>
            <button
              type="button"
              onClick={analyze}
              disabled={!message.trim() || busy}
              className={[
                'inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12px] font-semibold transition-colors',
                busy
                  ? 'bg-purple-gray/30 text-purple-gray cursor-not-allowed'
                  : 'bg-deep-plum text-white hover:bg-primary-purple',
              ].join(' ')}
            >
              {busy
                ? <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
                : <><Sparkles size={12} /> Analyze</>}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {result && (
          <>
            {/* Detected churches */}
            <div className="rounded-xl border border-lavender bg-white p-4 mb-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-2">
                Detected projects ({result.projects.length})
              </p>
              {result.projects.length === 0 ? (
                <p className="text-[12px] text-purple-gray italic">
                  No churches detected. Edit the message and re-run.
                </p>
              ) : (
                <ul className="space-y-2">
                  {result.projects.map((p, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 text-[12px]">
                      <div className="min-w-0">
                        <p className="font-semibold text-deep-plum truncate">
                          {p.member_id ? `${p.member_id} · ` : ''}{p.church_name ?? 'Unnamed church'}
                        </p>
                        {p.target_dates.length > 0 && (
                          <p className="text-[11px] text-purple-gray mt-0.5">
                            Targets: {p.target_dates.map(d => `${d.raw} (${d.hardness})`).join(' · ')}
                          </p>
                        )}
                      </div>
                      <ConfidencePill confidence={p.confidence} matched={!!p.matched_project_id} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Draft response */}
            <div className="rounded-xl border border-lavender bg-white p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">
                  Draft response
                </p>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-semibold bg-primary-purple/10 text-primary-purple border border-primary-purple/20 hover:bg-primary-purple/20 transition-colors"
                >
                  {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
              </div>
              <textarea
                value={responseEdit}
                onChange={e => setResponseEdit(e.target.value)}
                rows={Math.max(12, responseEdit.split('\n').length + 2)}
                className="w-full text-[13px] font-mono px-3 py-2 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none resize-vertical leading-relaxed"
              />
              <p className="text-[11px] text-purple-gray mt-2">
                Markdown. Subheadings render as <code>###</code>. Edit freely before
                pasting into ClickUp — the audit log records the AI draft, not your edits.
              </p>
            </div>

            {result.talking_points_used.length > 0 && (
              <p className="text-[11px] text-purple-gray italic">
                {result.talking_points_used.length} talking-point block{result.talking_points_used.length === 1 ? '' : 's'} were available to the assembler.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ConfidencePill({
  confidence, matched,
}: {
  confidence: 'high' | 'medium' | 'low'
  matched:    boolean
}) {
  if (!matched) {
    return <WMStatusPill tone="warning" size="sm">No match</WMStatusPill>
  }
  if (confidence === 'high') {
    return <WMStatusPill tone="success" size="sm">High match</WMStatusPill>
  }
  if (confidence === 'medium') {
    return <WMStatusPill tone="info" size="sm">Fuzzy match</WMStatusPill>
  }
  return <WMStatusPill tone="warning" size="sm">Low confidence</WMStatusPill>
}
