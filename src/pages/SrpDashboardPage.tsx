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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  createSession,
  listSessions,
  type SessionListRow,
  STEP_LABELS,
} from '../lib/srpSessions'

interface AccountOption {
  member: string
  church_name: string
  css_rep?: string | null
}

export default function SrpDashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions]   = useState<SessionListRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating]   = useState(false)
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

  const handleCreate = useCallback(async (account: AccountOption) => {
    if (!userEmail) return
    setCreating(true)
    try {
      const sessionId = await createSession({
        member: account.member,
        churchName: account.church_name,
        userEmail,
      })
      setPickerOpen(false)
      navigate(`/social/srp/${encodeURIComponent(sessionId)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }, [navigate, userEmail])

  return (
    <div className="min-h-full bg-wm-bg py-6 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-baseline justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[24px] font-semibold text-wm-text">SRP Generator</h1>
            <p className="text-[13px] text-wm-text-muted mt-1">Sermon Recap Pipeline — text deliverables for the weekly social run.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/social/srp/prompts"
              className="text-[12px] text-wm-text-muted hover:text-wm-text px-2 py-1"
            >
              Prompt settings
            </Link>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={!userEmail}
              className="inline-flex items-center gap-1.5 rounded-full bg-wm-accent px-4 py-2 text-[13px] text-white font-semibold disabled:opacity-50"
            >
              <Plus size={14} /> New SRP
            </button>
          </div>
        </header>

        <div className="flex items-baseline gap-3 mb-3">
          <div className="inline-flex rounded-full border border-wm-border overflow-hidden text-[12px]">
            <button
              onClick={() => setFilter('mine')}
              className={['px-3 py-1', filter === 'mine' ? 'bg-wm-accent text-white' : 'text-wm-text-muted hover:text-wm-text'].join(' ')}
            >My sessions</button>
            <button
              onClick={() => setFilter('all')}
              className={['px-3 py-1', filter === 'all' ? 'bg-wm-accent text-white' : 'text-wm-text-muted hover:text-wm-text'].join(' ')}
            >All sessions</button>
          </div>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted hover:text-wm-text ml-auto"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg px-3 py-2 text-[12px] text-wm-danger mb-3">{error}</div>
        )}

        <div className="rounded-lg border border-wm-border bg-wm-bg-elevated overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[12px] text-wm-text-muted">
              <Loader2 size={16} className="animate-spin inline mr-2" /> Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-wm-text-muted">
              No sessions yet. Click <span className="font-semibold">New SRP</span> to start one.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-wm-bg text-[10px] uppercase tracking-widest text-wm-text-subtle">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Church</th>
                  <th className="text-left px-3 py-2 font-semibold">Member</th>
                  <th className="text-left px-3 py-2 font-semibold">Step</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Updated</th>
                  {filter === 'all' && <th className="text-left px-3 py-2 font-semibold">Created by</th>}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr
                    key={s.id}
                    className="border-t border-wm-border hover:bg-wm-accent/5 cursor-pointer"
                    onClick={() => navigate(`/social/srp/${encodeURIComponent(s.session_id)}`)}
                  >
                    <td className="px-3 py-2 font-medium text-wm-text">{s.church_name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-wm-text-muted">{s.member ?? '—'}</td>
                    <td className="px-3 py-2 text-wm-text-muted">{STEP_LABELS[s.current_step ?? ''] ?? s.current_step ?? '—'}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={s.status} />
                    </td>
                    <td className="px-3 py-2 text-[11px] text-wm-text-muted whitespace-nowrap">
                      {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}
                    </td>
                    {filter === 'all' && (
                      <td className="px-3 py-2 text-[11px] text-wm-text-muted">{s.user_email ?? '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {pickerOpen && (
        <AccountPickerModal
          onCancel={() => setPickerOpen(false)}
          onPick={handleCreate}
          busy={creating}
        />
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string | null }) {
  const tone =
    status === 'completed' ? 'bg-wm-success-bg text-wm-success'
    : status === 'archived' ? 'bg-wm-border/40 text-wm-text-subtle'
    : 'bg-wm-accent/10 text-wm-accent-strong'
  return (
    <span className={['text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded', tone].join(' ')}>
      {status ?? 'unknown'}
    </span>
  )
}

function AccountPickerModal({ onCancel, onPick, busy }: {
  onCancel: () => void
  onPick: (a: AccountOption) => void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AccountOption[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    const handle = setTimeout(async () => {
      const isNumeric = /^\d+$/.test(q)
      let req = supabase
        .from('strategy_account_progress')
        .select('member, church_name, css_rep')
        .limit(20)
      req = isNumeric ? req.eq('member', Number(q)) : req.ilike('church_name', `%${q}%`)
      const { data } = await req
      const rows = (data ?? []).map(r => ({
        member: String(r.member ?? ''),
        church_name: String(r.church_name ?? ''),
        css_rep: r.css_rep as string | null,
      })).filter(r => r.member && r.church_name)
      setResults(rows)
      setSearching(false)
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  const hasResults = useMemo(() => results.length > 0, [results])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-lg bg-wm-bg-elevated border border-wm-border shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center justify-between border-b border-wm-border">
          <h2 className="text-[14px] font-semibold text-wm-text">Pick an account</h2>
          <button onClick={onCancel} className="text-wm-text-muted hover:text-wm-text"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-wm-text-subtle" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Member number or church name"
              autoFocus
              className="w-full rounded-md border border-wm-border bg-wm-bg pl-9 pr-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {searching && (
              <p className="text-[12px] text-wm-text-muted py-2 px-1">
                <Loader2 size={12} className="animate-spin inline mr-1.5" /> Searching…
              </p>
            )}
            {!searching && query.trim().length >= 2 && !hasResults && (
              <p className="text-[12px] text-wm-text-muted py-2 px-1">No matches.</p>
            )}
            {hasResults && (
              <ul className="divide-y divide-wm-border">
                {results.map(r => (
                  <li key={r.member}>
                    <button
                      onClick={() => onPick(r)}
                      disabled={busy}
                      className="w-full text-left px-3 py-2 hover:bg-wm-accent/5 disabled:opacity-50"
                    >
                      <p className="text-[13px] font-medium text-wm-text">{r.church_name}</p>
                      <p className="text-[11px] text-wm-text-muted">
                        <span className="font-mono">{r.member}</span>
                        {r.css_rep && <span> · {r.css_rep}</span>}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {busy && (
            <p className="text-[11px] text-wm-accent-strong">
              <Loader2 size={12} className="animate-spin inline mr-1.5" /> Creating session…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
