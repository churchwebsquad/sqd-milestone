/**
 * Staff-side inbox for partner-submitted edit requests on the sitemap
 * review. Groups entries by section, shows author + comment +
 * suggested change, and lets the strategist mark each one resolved
 * once it's been acted on (edit made in cowork, page renamed, etc.).
 *
 * Mounted at the top of SitemapReviewEditor so partner feedback is
 * the first thing staff sees on opening the review. Empty state is
 * hidden entirely, no visual noise when there's nothing to review.
 */

import { useMemo, useState } from 'react'
import type { PartnerEditRequest, SitemapReview } from '../../../lib/sitemapReview'

interface Props {
  review:    SitemapReview
  onChange:  (next: SitemapReview) => Promise<void> | void
  disabled?: boolean
}

export function PartnerEditRequestsInbox({ review, onChange, disabled }: Props) {
  const [showResolved, setShowResolved] = useState(false)

  const all = review.partner_edit_requests ?? []
  const open = useMemo(() => all.filter(r => r.status === 'open'),  [all])
  const done = useMemo(() => all.filter(r => r.status === 'resolved'), [all])

  const grouped = useMemo(() => groupBySection(open), [open])

  if (all.length === 0) return null

  const setStatus = (id: string, status: 'open' | 'resolved') => {
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).map(r =>
        r.id === id ? { ...r, status } : r,
      ),
    }
    void onChange(next)
  }

  const remove = (id: string) => {
    if (!confirm('Delete this note permanently?')) return
    const next: SitemapReview = {
      ...review,
      partner_edit_requests: (review.partner_edit_requests ?? []).filter(r => r.id !== id),
    }
    void onChange(next)
  }

  return (
    <div className="rounded-lg border-2 border-wm-accent bg-wm-accent-tint/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-wm-accent-strong">
            Partner notes inbox
          </div>
          <div className="text-[12px] text-wm-text-muted mt-0.5">
            {open.length === 0
              ? 'All partner notes have been resolved.'
              : `${open.length} open note${open.length === 1 ? '' : 's'} pinned to specific sections of the review.`}
          </div>
        </div>
        {done.length > 0 && (
          <button
            type="button"
            className="text-[11px] text-wm-accent-strong hover:underline"
            onClick={() => setShowResolved(v => !v)}
          >
            {showResolved ? 'Hide' : 'Show'} {done.length} resolved
          </button>
        )}
      </div>

      {grouped.length > 0 && (
        <div className="space-y-3">
          {grouped.map(group => (
            <div key={group.section_id} className="rounded-md bg-white border border-wm-border px-3 py-2.5">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="inline-flex items-center rounded-full bg-wm-accent-tint text-wm-accent-strong text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                  {group.section_label}
                </span>
                <span className="text-[10.5px] text-wm-text-subtle">
                  {group.items.length} note{group.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="space-y-2">
                {group.items.map(r => (
                  <li key={r.id} className="text-[12.5px]">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-semibold text-wm-text">{r.author_name || 'Guest'}</span>
                      <span className="text-[10.5px] text-wm-text-subtle">
                        {new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          disabled={disabled}
                          className="text-[10.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
                          onClick={() => setStatus(r.id, 'resolved')}
                        >
                          Mark resolved
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          className="text-[10.5px] text-wm-text-subtle hover:text-red-600 disabled:opacity-50"
                          onClick={() => remove(r.id)}
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                    <p className="text-wm-text leading-snug whitespace-pre-wrap">{r.comment}</p>
                    {r.suggested_change && (
                      <div className="mt-1.5 pt-1.5 border-t border-dashed border-wm-border">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-wm-accent-strong">Suggested change</span>
                        <p className="text-wm-text text-[12.5px] leading-snug mt-0.5 whitespace-pre-wrap">{r.suggested_change}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {showResolved && done.length > 0 && (
        <div className="mt-3 pt-3 border-t border-wm-border/60">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-wm-text-muted mb-2">Resolved</div>
          <ul className="space-y-1.5">
            {done.map(r => (
              <li key={r.id} className="flex items-baseline gap-2 text-[12px] text-wm-text-muted">
                <span className="inline-flex items-center rounded-full bg-wm-bg text-wm-text-muted text-[10px] font-semibold px-2 py-0.5 border border-wm-border">
                  {r.section_label}
                </span>
                <span className="line-through">{r.comment.slice(0, 80)}{r.comment.length > 80 ? '…' : ''}</span>
                <button
                  type="button"
                  disabled={disabled}
                  className="ml-auto text-[10.5px] text-wm-accent-strong hover:underline disabled:opacity-50"
                  onClick={() => setStatus(r.id, 'open')}
                >
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function groupBySection(requests: PartnerEditRequest[]): Array<{
  section_id:    string
  section_label: string
  items:         PartnerEditRequest[]
}> {
  const map = new Map<string, { section_id: string; section_label: string; items: PartnerEditRequest[] }>()
  for (const r of requests) {
    const cur = map.get(r.section_id)
    if (cur) {
      cur.items.push(r)
    } else {
      map.set(r.section_id, { section_id: r.section_id, section_label: r.section_label, items: [r] })
    }
  }
  // Sort items within each group by newest first
  for (const g of map.values()) {
    g.items.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  return Array.from(map.values())
}
