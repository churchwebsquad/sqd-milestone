import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface BrandingChurchRow {
  member: number
  church_name: string | null
  portal_token: string
}

/**
 * Staff-only index page at /branding. Lists every church with a
 * portal_token and lets staff search to jump into the per-church handoff
 * doc. Designed for speed — a single fetch of member / name / token, all
 * filtering is client-side.
 */
export default function BrandingIndexPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<BrandingChurchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('strategy_account_progress')
        .select('member, church_name, portal_token')
        .not('portal_token', 'is', null)
        .order('church_name')
      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        setRows((data ?? []) as BrandingChurchRow[])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const name = (r.church_name ?? '').toLowerCase()
      const member = String(r.member)
      return name.includes(q) || member.includes(q)
    })
  }, [rows, query])

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Internal</p>
          <h1 className="text-2xl font-semibold text-deep-plum">Brand Handoffs</h1>
          <p className="text-sm text-purple-gray mt-1 max-w-xl">
            Quick-reference docs for Graphics, Video, Social, and Web squads starting a project.
            Find a church below to open their handoff doc.
          </p>
        </div>

        <div className="relative mb-5">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by church name or member number…"
            className="w-full rounded-full border border-lavender bg-white pl-9 pr-10 py-2.5 text-sm text-deep-plum placeholder-purple-gray/60 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-gray hover:text-deep-plum"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 bg-lavender-tint/40 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Couldn't load churches: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <p className="text-xs text-purple-gray mb-2">
              {filtered.length} {filtered.length === 1 ? 'church' : 'churches'}
            </p>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-lavender bg-white/50 px-4 py-8 text-center text-sm text-purple-gray">
                No churches match "<span className="text-deep-plum font-semibold">{query}</span>".
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map(row => (
                  <button
                    key={row.portal_token}
                    type="button"
                    onClick={() => navigate(`/branding/${row.portal_token}`)}
                    className="text-left rounded-xl border border-lavender bg-white px-4 py-3 hover:border-primary-purple hover:shadow-sm transition-all flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-deep-plum truncate">
                        {row.church_name ?? `Member #${row.member}`}
                      </p>
                      <p className="text-[11px] text-purple-gray">#{row.member}</p>
                    </div>
                    <ArrowRight size={14} className="text-primary-purple shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
