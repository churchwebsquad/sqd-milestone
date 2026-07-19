import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, CheckCircle2, Clock, AlertCircle, Play } from 'lucide-react'

interface SessionStatus {
  session_id: string
  church_name: string
  sermon_title: string
  created_at: string
  current_step: string | null
  has_transcript: boolean
  has_auto_drafts: boolean
  deliverables: string[]
  generated: string[]
  missing: string[]
  ready: boolean
}

const DELIVERABLE_LABELS: Record<string, string> = {
  overview:    'Overview',
  clips:       'Clips',
  carousel:    'Carousel',
  facebook:    'FB Post',
  photoRecap:  'Photo Recap',
  sundayInvite: 'Invite',
}

export default function SrpStatusPage() {
  const [rows, setRows]         = useState<SessionStatus[]>([])
  const [loading, setLoading]   = useState(true)
  const [days, setDays]         = useState(7)
  const [triggering, setTriggering] = useState<Set<string>>(new Set())
  const [triggerResults, setTriggerResults] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/srp/session-status?days=${days}`)
      const data = await r.json()
      setRows(data.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  async function triggerAutoGenerate(sessionId: string) {
    setTriggering(prev => new Set(prev).add(sessionId))
    setTriggerResults(prev => ({ ...prev, [sessionId]: 'running' }))
    try {
      const r = await fetch('/api/srp/auto-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await r.json()
      if (data.skipped) {
        setTriggerResults(prev => ({ ...prev, [sessionId]: 'already done' }))
      } else if (data.ok) {
        const keys = Object.keys(data.generated ?? {}).join(', ')
        setTriggerResults(prev => ({ ...prev, [sessionId]: `done: ${keys}` }))
        await load()
      } else {
        setTriggerResults(prev => ({ ...prev, [sessionId]: `error: ${data.error ?? 'unknown'}` }))
      }
    } catch {
      setTriggerResults(prev => ({ ...prev, [sessionId]: 'network error' }))
    } finally {
      setTriggering(prev => { const s = new Set(prev); s.delete(sessionId); return s })
    }
  }

  const withTranscript = rows.filter(r => r.has_transcript)
  const ready          = withTranscript.filter(r => r.ready).length
  const missing        = withTranscript.filter(r => !r.ready).length

  return (
    <div className="min-h-screen bg-[#F9F5F1] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#513DE5] font-semibold mb-1">SRP Admin</p>
            <h1 className="text-2xl font-serif text-[#341756]">Auto-Generate Status</h1>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="text-sm border border-[#CFC9F8] rounded-lg px-3 py-2 bg-white text-[#341756]"
            >
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
            </select>
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
        {!loading && withTranscript.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-[#341756]">{withTranscript.length}</div>
              <div className="text-xs text-[#6B6180] mt-1">Sessions with transcripts</div>
            </div>
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{ready}</div>
              <div className="text-xs text-[#6B6180] mt-1">Fully generated</div>
            </div>
            <div className="bg-white border border-[#CFC9F8] rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{missing}</div>
              <div className="text-xs text-[#6B6180] mt-1">Missing drafts</div>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#6B6180]">
            <RefreshCw size={18} className="animate-spin mr-2" /> Loading sessions...
          </div>
        ) : withTranscript.length === 0 ? (
          <div className="bg-white border border-[#CFC9F8] rounded-xl p-10 text-center text-[#6B6180]">
            No sessions with transcripts in the last {days} days.
          </div>
        ) : (
          <div className="space-y-3">
            {withTranscript.map(row => (
              <div
                key={row.session_id}
                className={`bg-white border rounded-xl p-4 ${row.ready ? 'border-[#CFC9F8]' : 'border-amber-200'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {row.ready
                        ? <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                        : <AlertCircle size={16} className="text-amber-500 shrink-0" />
                      }
                      <Link
                        to={`/social/srp/${row.session_id}`}
                        className="font-semibold text-[#341756] hover:text-[#513DE5] truncate"
                      >
                        {row.church_name}
                      </Link>
                      <span className="text-xs text-[#6B6180] shrink-0">
                        {new Date(row.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    {row.sermon_title && (
                      <p className="text-sm text-[#6B6180] ml-6 mb-2 truncate">{row.sermon_title}</p>
                    )}

                    {/* Deliverable chips */}
                    <div className="flex flex-wrap gap-1.5 ml-6">
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
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              done
                                ? 'bg-[#EDE9FC] text-[#513DE5]'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {done ? '✓ ' : '○ '}{label}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  {/* Trigger button */}
                  {!row.ready && (
                    <div className="shrink-0 text-right">
                      {triggerResults[row.session_id] && triggerResults[row.session_id] !== 'running' ? (
                        <span className="text-xs text-[#6B6180]">{triggerResults[row.session_id]}</span>
                      ) : (
                        <button
                          onClick={() => triggerAutoGenerate(row.session_id)}
                          disabled={triggering.has(row.session_id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#513DE5] text-white rounded-full text-xs font-medium hover:bg-[#6B5CE7] transition-colors disabled:opacity-50"
                        >
                          {triggering.has(row.session_id)
                            ? <><RefreshCw size={12} className="animate-spin" /> Generating...</>
                            : <><Play size={12} /> Generate</>
                          }
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {triggerResults[row.session_id] === 'running' && (
                  <div className="mt-2 ml-6 flex items-center gap-2 text-xs text-[#513DE5]">
                    <Clock size={12} className="animate-pulse" />
                    Running auto-generate — this takes about 30-60 seconds...
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Sessions without transcript */}
        {rows.filter(r => !r.has_transcript).length > 0 && (
          <details className="text-sm text-[#6B6180]">
            <summary className="cursor-pointer hover:text-[#341756]">
              {rows.filter(r => !r.has_transcript).length} sessions without transcripts (no action needed)
            </summary>
            <ul className="mt-2 ml-4 space-y-1">
              {rows.filter(r => !r.has_transcript).map(r => (
                <li key={r.session_id}>
                  <Link to={`/social/srp/${r.session_id}`} className="hover:text-[#513DE5]">
                    {r.church_name} — step: {r.current_step ?? 'unknown'}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
