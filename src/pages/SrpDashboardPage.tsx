/**
 * SRP Generator dashboard — landing page for the Social Media Squad's
 * Sermon Recap Pipeline tool.
 *
 * Shows the strategist's recent sessions (sms_srp_generation rows
 * ordered by updated_at desc) and a "New SRP" button that gates on
 * picking an account.
 *
 * Critical UX: clicking "New SRP" creates a FRESH row in
 * sms_srp_generation before navigating. The workflow page is keyed on
 * session_id from the URL — no shared client state — so the bug class
 * where state leaks between sessions cannot recur.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Sparkles, Settings2, Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  listSessions,
  type SrpSessionListRow as SessionListRow,
  STEP_LABELS,
} from '../lib/srpSessions'
import { SrpHeroHeading } from '../components/srp/_shared/SrpHeading'
export default function SrpDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions]   = useState<SessionListRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<'mine' | 'all'>('mine')

  const userEmail = user?.email ?? null

  const refresh = useCallback(async () => {
    if (!userEmail) return
    setLoading(true)
    try {
      const rows = await listSessions({
        userEmail: filter === 'mine' ? userEmail : undefined,
        limit: 100,
      })
      setSessions(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [filter, userEmail])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="min-h-full bg-[var(--color-cream)] py-8 px-4 md:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <SrpHeroHeading
            kicker="Social Squad"
            prefix="The"
            emphasis="Sermon Recap"
            suffix="Pipeline."
            subtitle="Text deliverables for the weekly social run — captions, posts, carousels, photo recaps. Open a session per partner, generate, and ship."
          />
          <Link
            to="/social/srp/prompts"
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] px-2 py-1 transition-colors"
          >
            <Settings2 size={12} /> Prompt settings
          </Link>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-full border border-[var(--color-lavender)] overflow-hidden text-[12px] bg-white">
            <button
              onClick={() => setFilter('mine')}
              className={[
                'px-3 py-1.5 transition-colors',
                filter === 'mine'
                  ? 'bg-[var(--color-deep-plum)] text-white font-semibold'
                  : 'text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)]',
              ].join(' ')}
            >My sessions</button>
            <button
              onClick={() => setFilter('all')}
              className={[
                'px-3 py-1.5 transition-colors',
                filter === 'all'
                  ? 'bg-[var(--color-deep-plum)] text-white font-semibold'
                  : 'text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)]',
              ].join(' ')}
            >All sessions</button>
          </div>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] ml-auto transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">{error}</div>
        )}

        <div className="rounded-xl border border-[var(--color-lavender)] bg-white overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-[12px] text-[var(--color-purple-gray)]">
              <Loader2 size={16} className="animate-spin inline mr-2" /> Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
                <Sparkles size={20} />
              </span>
              <p className="text-[14px] font-semibold text-[var(--color-deep-plum)]">No sessions yet.</p>
              <p className="text-[12px] text-[var(--color-purple-gray)] max-w-sm mx-auto">
                Click <span className="font-semibold">New SRP</span> to open your first one — pick the partner, drop in the sermon, and the pipeline takes it from there.
              </p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-[var(--color-cream)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-purple-gray)]">
                <tr>
                  <th className="text-left px-4 py-3 font-bold">Church</th>
                  <th className="text-left px-4 py-3 font-bold">Member</th>
                  <th className="text-left px-4 py-3 font-bold">Step</th>
                  <th className="text-left px-4 py-3 font-bold">Status</th>
                  <th className="text-left px-4 py-3 font-bold">Updated</th>
                  {filter === 'all' && <th className="text-left px-4 py-3 font-bold">Created by</th>}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr
                    key={s.id}
                    className="border-t border-[var(--color-lavender)] hover:bg-[var(--color-lavender-tint)]/60 cursor-pointer transition-colors"
                    onClick={() => navigate(`/social/srp/${encodeURIComponent(s.session_id)}`)}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-deep-plum)]">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
                          <Building2 size={12} />
                        </span>
                        {s.church_name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-purple-gray)]">{s.member ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--color-purple-gray)]">{s.current_step ? STEP_LABELS[s.current_step] : '—'}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--color-purple-gray)] whitespace-nowrap">
                      {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}
                    </td>
                    {filter === 'all' && (
                      <td className="px-4 py-3 text-[11px] text-[var(--color-purple-gray)]">{s.user_email ?? '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}

function StatusPill({ status }: { status: string | null }) {
  const tone =
    status === 'completed' ? 'bg-wm-success-bg text-wm-success'
    : status === 'archived' ? 'bg-[var(--color-lavender)]/50 text-[var(--color-purple-gray)]'
    : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]'
  return (
    <span className={['text-[10px] uppercase tracking-[0.12em] font-bold px-2 py-1 rounded-full', tone].join(' ')}>
      {status ?? 'unknown'}
    </span>
  )
}

