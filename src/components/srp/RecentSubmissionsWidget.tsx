/**
 * Recent Submissions widget — shown on the AccountSelection step.
 *
 * Two modes:
 *   1. Weekly list — calls /api/srp/fetch-sermon-submissions with no
 *      arguments. Returns the current Friday-Thursday window's
 *      submissions ordered newest-first.
 *   2. Search — coach pastes a ClickUp task ID; the endpoint runs a
 *      targeted lookup and returns the single matching submission
 *      (regardless of date).
 *
 * Clicking a row calls onPair(submission), which the step uses to
 * write clickup_task_id + sermon metadata onto the session.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Search, ExternalLink, Sparkles, Check, FileText, AlertTriangle } from 'lucide-react'
import { callSrpApi } from '../../lib/srpApi'
import type { SrpSermonSubmission } from '../../types/database'

interface FetchResponse {
  submissions: SrpSermonSubmission[]
  weekStart:   string
  searched?:   boolean
}

export function RecentSubmissionsWidget({
  pairedTaskId,
  member,
  onPair,
}: {
  /** Currently paired ClickUp task ID — used to highlight the row. */
  pairedTaskId?: string | null
  /** Filter weekly submissions to this church member number. */
  member?:       number | null
  onPair:       (s: SrpSermonSubmission) => void
}) {
  const [submissions, setSubmissions] = useState<SrpSermonSubmission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [searching, setSearching] = useState(false)
  const [searchedTaskId, setSearchedTaskId] = useState<string | null>(null)

  const loadWeekly = useCallback(async () => {
    setLoading(true); setError(null); setSearchedTaskId(null)
    try {
      const r = await callSrpApi<FetchResponse>('fetch-sermon-submissions', member ? { member } : {})
      setSubmissions(r.submissions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadWeekly() }, [loadWeekly])

  const runSearch = useCallback(async () => {
    const q = search.trim()
    if (!q) { void loadWeekly(); return }
    setSearching(true); setError(null)
    try {
      const r = await callSrpApi<FetchResponse>('fetch-sermon-submissions', { clickup_task_id: q })
      setSubmissions(r.submissions ?? [])
      setSearchedTaskId(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'search failed')
    } finally {
      setSearching(false)
    }
  }, [search, loadWeekly])

  return (
    <section className="rounded-xl border border-[var(--color-lavender)] bg-white">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]/40">
        <div className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-[var(--color-primary-purple)]" />
          <h3 className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
            Recent submissions
          </h3>
          {searchedTaskId && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] ml-1">
              · search
            </span>
          )}
        </div>
        <button
          onClick={() => void loadWeekly()}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </header>

      <div className="px-4 py-3 border-b border-[var(--color-lavender)]">
        <form
          onSubmit={e => { e.preventDefault(); void runSearch() }}
          className="relative"
        >
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-purple-gray)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pair by ClickUp task ID (e.g. 86c0xyz)"
            className="w-full rounded-full border border-[var(--color-lavender)] bg-white pl-9 pr-3 py-1.5 text-[12px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
          />
          {searching && (
            <Loader2 size={12} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-primary-purple)]" />
          )}
        </form>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {error && (
          <p className="px-4 py-3 text-[12px] text-wm-danger bg-wm-danger-bg">{error}</p>
        )}
        {loading && submissions.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-[var(--color-purple-gray)] text-center">
            <Loader2 size={12} className="animate-spin inline mr-1.5" /> Loading…
          </p>
        )}
        {!loading && submissions.length === 0 && !error && (
          <p className="px-4 py-6 text-[12px] text-[var(--color-purple-gray)] text-center">
            {searchedTaskId
              ? `No submission found for task ${searchedTaskId}.`
              : 'No submissions this week yet.'}
          </p>
        )}
        {submissions.length > 0 && (
          <ul className="divide-y divide-[var(--color-lavender)]">
            {submissions.map(s => {
              const isPaired = pairedTaskId && s.clickup_task_id === pairedTaskId
              return (
                <li key={s.clickup_task_id ?? `${s.account}-${s.created_at}`}>
                  <button
                    type="button"
                    onClick={() => onPair(s)}
                    className={[
                      'w-full text-left px-4 py-3 transition-colors',
                      isPaired
                        ? 'bg-[var(--color-lavender-tint)]'
                        : 'hover:bg-[var(--color-lavender-tint)]/60',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-[var(--color-deep-plum)] truncate">
                          {s.sermon_title || s.series_title || 'Untitled sermon'}
                        </p>
                        {s.series_title && s.sermon_title && s.series_title !== s.sermon_title && (
                          <p className="text-[11px] text-[var(--color-purple-gray)] truncate">
                            {s.series_title}
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--color-purple-gray)] mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono">{s.clickup_task_id ?? '—'}</span>
                          {s.is_this_week === false && (
                            <span className="inline-block rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)] px-1.5 py-px font-bold uppercase tracking-wider">
                              older
                            </span>
                          )}
                          {(s.video_url || s.external_link) && (
                            <a
                              href={s.video_url ?? s.external_link!}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)]"
                            >
                              video <ExternalLink size={9} />
                            </a>
                          )}
                          <span className="text-[var(--color-purple-gray)]">
                            {new Date(s.created_at).toLocaleDateString()}
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {/* Existing coach session — clicking the row will navigate there */}
                        {s.pipeline_session_id && s.session_status && s.session_status !== 'background' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)] px-1.5 py-px rounded-full">
                            Open session →
                          </span>
                        ) : (
                          <>
                            {isPaired && (
                              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
                                <Check size={11} /> paired
                              </span>
                            )}
                            {s.pipeline_status === 'transcribed' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#15803D] bg-[#F0FDF4] px-1.5 py-px rounded-full">
                                <FileText size={9} /> Transcript ready
                              </span>
                            )}
                            {s.pipeline_status === 'pending' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#513DE5] bg-[#EDE9FC] px-1.5 py-px rounded-full">
                                <Loader2 size={9} className="animate-spin" /> Processing…
                              </span>
                            )}
                            {s.pipeline_status === 'error' && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-px rounded-full"
                                title={s.pipeline_error ?? 'Pipeline error'}
                              >
                                <AlertTriangle size={9} /> No video
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
