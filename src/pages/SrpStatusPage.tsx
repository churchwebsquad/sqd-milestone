import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, ArrowRight, Play, Link2, FileText } from 'lucide-react'

interface SessionStatus {
  session_id:    string
  church_name:   string
  sermon_title:  string
  created_at:    string
  current_step:  string | null
  video_url:     string | null
  has_video_url: boolean
  has_transcript: boolean
  has_auto_drafts: boolean
  deliverables:  string[]
  generated:     string[]
  missing:       string[]
  ready:         boolean
}

const DELIVERABLE_LABELS: Record<string, string> = {
  overview:     'Overview',
  clips:        'Clips',
  carousel:     'Carousel',
  facebook:     'FB Post',
  photoRecap:   'Photo Recap',
  sundayInvite: 'Invite',
}


export default function SrpStatusPage() {
  const [rows, setRows]       = useState<SessionStatus[]>([])
  const [loading, setLoading] = useState(true)

  const [urlInputs, setUrlInputs]     = useState<Record<string, string>>({})
  const [urlStatus, setUrlStatus]     = useState<Record<string, string>>({})
  const [generating, setGenerating]   = useState<Set<string>>(new Set())
  const [genResults, setGenResults]   = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/srp/session-status')
      const data = await r.json()
      setRows(data.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function submitUrl(row: SessionStatus) {
    const url = (urlInputs[row.session_id] ?? '').trim()
    if (!url) return
    setUrlStatus(prev => ({ ...prev, [row.session_id]: 'starting' }))
    try {
      const { data: { session: authSession } } = await (await import('../lib/supabase')).supabase.auth.getSession()
      const r = await fetch('/api/srp/start-transcription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({ session_id: row.session_id, source_url: url, source_type: 'unknown' }),
      })
      const data = await r.json()
      if (!r.ok) {
        setUrlStatus(prev => ({ ...prev, [row.session_id]: `error: ${data.error ?? 'unknown'}` }))
      } else {
        setUrlStatus(prev => ({ ...prev, [row.session_id]: 'transcribing — auto-generate will fire when done' }))
        await load()
      }
    } catch {
      setUrlStatus(prev => ({ ...prev, [row.session_id]: 'network error' }))
    }
  }

  async function triggerGenerate(sessionId: string) {
    setGenerating(prev => new Set(prev).add(sessionId))
    setGenResults(prev => ({ ...prev, [sessionId]: 'running' }))
    try {
      const r = await fetch('/api/srp/auto-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await r.json()
      if (data.skipped) {
        setGenResults(prev => ({ ...prev, [sessionId]: 'already done' }))
      } else if (data.ok) {
        setGenResults(prev => ({ ...prev, [sessionId]: `done: ${Object.keys(data.generated ?? {}).join(', ')}` }))
        await load()
      } else {
        setGenResults(prev => ({ ...prev, [sessionId]: `error: ${data.error ?? 'unknown'}` }))
      }
    } catch {
      setGenResults(prev => ({ ...prev, [sessionId]: 'network error' }))
    } finally {
      setGenerating(prev => { const s = new Set(prev); s.delete(sessionId); return s })
    }
  }

  const withTranscript    = rows.filter(r => r.has_transcript)
  const noTranscript      = rows.filter(r => !r.has_transcript)
  const readyCount        = withTranscript.filter(r => r.ready).length
  const missingCount      = withTranscript.filter(r => !r.ready).length

  return (
    <div className="min-h-screen bg-[#F9F5F1] p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#513DE5] font-semibold mb-1">SRP Admin</p>
            <h1 className="text-2xl font-serif text-[#341756]">This Week's SRPs</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#341756] text-white rounded-full text-sm font-medium hover:bg-[#513DE5] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary */}
        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#341756]">{withTranscript.length}</div>
              <div className="text-xs text-[#6B6180] mt-1">Transcripts pulled</div>
            </div>
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{readyCount}</div>
              <div className="text-xs text-[#6B6180] mt-1">Fully generated</div>
            </div>
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{missingCount + noTranscript.length}</div>
              <div className="text-xs text-[#6B6180] mt-1">Need attention</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#6B6180]">
            <RefreshCw size={18} className="animate-spin mr-2" /> Loading sessions...
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-[#CFC9F8] rounded-xl p-10 text-center text-[#6B6180]">
            No sessions this week yet.
          </div>
        ) : (
          <div className="space-y-3">

            {/* Sessions with transcripts */}
            {withTranscript.map(row => (
              <div
                key={row.session_id}
                className={`bg-white border rounded-xl p-4 ${row.ready ? 'border-[#CFC9F8]' : 'border-amber-200'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Name + date */}
                    <div className="flex items-center gap-2 mb-0.5">
                      {row.ready
                        ? <CheckCircle2 size={15} className="text-green-500 shrink-0" />
                        : <AlertCircle size={15} className="text-amber-500 shrink-0" />
                      }
                      <Link to={`/social/srp/${row.session_id}`} className="font-semibold text-[#341756] hover:text-[#513DE5]">
                        {row.church_name}
                      </Link>
                      <span className="text-xs text-[#6B6180] shrink-0">
                        {new Date(row.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>

                    {row.sermon_title && (
                      <p className="text-sm text-[#6B6180] ml-[23px] mb-2 truncate">{row.sermon_title}</p>
                    )}

                    {/* Status row: transcript + deliverables */}
                    <div className="ml-[23px] flex flex-wrap items-center gap-1.5 mt-1">
                      {/* Transcript chip */}
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-[#EDE9FC] text-[#513DE5]">
                        <FileText size={10} /> Transcript
                      </span>

                      {/* Deliverable chips */}
                      {Object.entries(DELIVERABLE_LABELS).map(([key, label]) => {
                        const needed = key === 'overview'
                          ? true
                          : key === 'clips'
                            ? row.deliverables.some(d => /^reel\d+$/.test(d))
                            : row.deliverables.includes(key)
                        if (!needed) return null
                        const done = row.generated.includes(key)
                        return (
                          <span
                            key={key}
                            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                              done
                                ? 'bg-[#EDE9FC] text-[#513DE5]'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {done ? <CheckCircle2 size={10} /> : <span className="text-[10px]">○</span>}
                            {label}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <Link
                      to={`/social/srp/${row.session_id}`}
                      className="inline-flex items-center gap-1 text-xs text-[#6B6180] hover:text-[#513DE5] transition-colors"
                    >
                      Open <ArrowRight size={11} />
                    </Link>
                    {!row.ready && (
                      genResults[row.session_id] && genResults[row.session_id] !== 'running' ? (
                        <span className="text-xs text-[#6B6180]">{genResults[row.session_id]}</span>
                      ) : (
                        <button
                          onClick={() => triggerGenerate(row.session_id)}
                          disabled={generating.has(row.session_id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#513DE5] text-white rounded-full text-xs font-medium hover:bg-[#6B5CE7] transition-colors disabled:opacity-50"
                        >
                          {generating.has(row.session_id)
                            ? <><RefreshCw size={11} className="animate-spin" /> Generating...</>
                            : <><Play size={11} /> Generate</>
                          }
                        </button>
                      )
                    )}
                  </div>
                </div>

                {genResults[row.session_id] === 'running' && (
                  <p className="mt-2 ml-[23px] text-xs text-[#513DE5] animate-pulse">Running — takes about 30-60 seconds...</p>
                )}
              </div>
            ))}

            {/* Sessions without transcripts — need a video URL */}
            {noTranscript.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-widest text-[#6B6180] font-semibold mb-3">No transcript yet</p>
                <div className="space-y-3">
                  {noTranscript.map(row => (
                    <div key={row.session_id} className="bg-white border border-[#CFC9F8] rounded-xl p-4">
                      <div className="flex items-start gap-2 mb-3">
                        <XCircle size={15} className="text-[#6B6180] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link to={`/social/srp/${row.session_id}`} className="font-semibold text-[#341756] hover:text-[#513DE5]">
                              {row.church_name}
                            </Link>
                            <span className="text-xs text-[#6B6180]">
                              {new Date(row.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          {row.sermon_title && (
                            <p className="text-sm text-[#6B6180] mt-0.5 truncate">{row.sermon_title}</p>
                          )}
                          {row.has_video_url && (
                            <p className="text-xs text-[#6B6180] mt-0.5 truncate">
                              <span className="text-[#513DE5]">Link on file</span> — transcription may still be running
                            </p>
                          )}
                        </div>
                      </div>

                      {/* URL input — only show if no video URL on file */}
                      {!row.has_video_url && (
                        urlStatus[row.session_id] ? (
                          <p className="text-xs text-[#513DE5] ml-[23px]">{urlStatus[row.session_id]}</p>
                        ) : (
                          <div className="ml-[23px] flex gap-2">
                            <div className="flex-1 flex items-center gap-2 border border-[#CFC9F8] rounded-lg px-3 py-2 bg-[#F9F5F1] focus-within:border-[#513DE5] focus-within:ring-2 focus-within:ring-[#EDE9FC]">
                              <Link2 size={13} className="text-[#6B6180] shrink-0" />
                              <input
                                type="url"
                                value={urlInputs[row.session_id] ?? ''}
                                onChange={e => setUrlInputs(prev => ({ ...prev, [row.session_id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') void submitUrl(row) }}
                                placeholder="Paste video URL to start transcription"
                                className="flex-1 bg-transparent text-sm text-[#341756] placeholder:text-[#6B6180] focus:outline-none"
                              />
                            </div>
                            <button
                              onClick={() => submitUrl(row)}
                              disabled={!urlInputs[row.session_id]?.trim()}
                              className="px-3 py-2 bg-[#341756] text-white rounded-lg text-sm font-medium hover:bg-[#513DE5] transition-colors disabled:opacity-40"
                            >
                              Go
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
