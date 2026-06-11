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
import { Loader2, Plus, RefreshCw, Search, X, Sparkles, ArrowRight, Settings2, Building2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  createSession,
  listSessions,
  type SrpSessionListRow as SessionListRow,
  STEP_LABELS,
} from '../lib/srpSessions'
import { SrpHeroHeading } from '../components/srp/_shared/SrpHeading'
import { SrpButton } from '../components/srp/_shared/SrpButton'

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
      const { session_id } = await createSession({
        member: account.member,
        churchName: account.church_name,
        userEmail,
      })
      setPickerOpen(false)
      navigate(`/social/srp/${encodeURIComponent(session_id)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }, [navigate, userEmail])

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
          <div className="flex items-center gap-2">
            <Link
              to="/social/srp/prompts"
              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] px-2 py-1 transition-colors"
            >
              <Settings2 size={12} /> Prompt settings
            </Link>
            <SrpButton
              onClick={() => setPickerOpen(true)}
              disabled={!userEmail}
              leadingIcon={<Plus size={14} />}
              trailingIcon={<ArrowRight size={14} />}
            >
              New SRP
            </SrpButton>
          </div>
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
                    <td className="px-4 py-3 text-[var(--color-purple-gray)]">{STEP_LABELS[s.current_step ?? ''] ?? s.current_step ?? '—'}</td>
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
    : status === 'archived' ? 'bg-[var(--color-lavender)]/50 text-[var(--color-purple-gray)]'
    : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]'
  return (
    <span className={['text-[10px] uppercase tracking-[0.12em] font-bold px-2 py-1 rounded-full', tone].join(' ')}>
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
    <div className="fixed inset-0 z-50 bg-[var(--color-deep-plum)]/40 backdrop-blur-sm flex items-start justify-center pt-24 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg rounded-xl bg-white border border-[var(--color-lavender)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]">
          <h2 className="text-[14px] font-semibold text-[var(--color-deep-plum)]">Pick an account</h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors"
            aria-label="Close"
          ><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-purple-gray)]" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Member number or church name"
              autoFocus
              className="w-full rounded-full border border-[var(--color-lavender)] bg-white pl-9 pr-3 py-2 text-[13px] text-[var(--color-deep-plum)] placeholder:text-[var(--color-purple-gray)] focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)]"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {searching && (
              <p className="text-[12px] text-[var(--color-purple-gray)] py-2 px-1">
                <Loader2 size={12} className="animate-spin inline mr-1.5" /> Searching…
              </p>
            )}
            {!searching && query.trim().length >= 2 && !hasResults && (
              <p className="text-[12px] text-[var(--color-purple-gray)] py-2 px-1">No matches.</p>
            )}
            {hasResults && (
              <ul className="divide-y divide-[var(--color-lavender)] rounded-lg border border-[var(--color-lavender)] overflow-hidden">
                {results.map(r => (
                  <li key={r.member}>
                    <button
                      onClick={() => onPick(r)}
                      disabled={busy}
                      className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-lavender-tint)] disabled:opacity-50 transition-colors flex items-center gap-3"
                    >
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]">
                        <Building2 size={12} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[var(--color-deep-plum)] truncate">{r.church_name}</p>
                        <p className="text-[11px] text-[var(--color-purple-gray)] truncate">
                          <span className="font-mono">{r.member}</span>
                          {r.css_rep && <span> · {r.css_rep}</span>}
                        </p>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {busy && (
            <p className="text-[11px] text-[var(--color-primary-purple)]">
              <Loader2 size={12} className="animate-spin inline mr-1.5" /> Creating session…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
