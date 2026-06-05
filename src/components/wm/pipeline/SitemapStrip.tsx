/**
 * Persistent sitemap reference at the top of the Pages view.
 *
 * One chip per page from the Stage 2 sitemap. Each chip carries the
 * page's approval status so the strategist can scan project-wide
 * progress at a glance:
 *
 *   ✓  Approved      → green
 *   ⚠  Stale         → yellow (approved but Stage 8 found new issues)
 *   ◌  Draft         → muted (default; never approved or unlocked)
 *   🔓 Unlocked      → orange (was approved, now editable)
 *
 * Click a chip → calls onSelect(slug) to scroll the matching PageCard
 * into view + open it.
 */
import { Check, AlertTriangle, Unlock, Circle } from 'lucide-react'
import { getApproval, isApproved, isUnlocked, isStale } from '../../../lib/pageApprovals'

interface Stage2Page  { slug?: string; name?: string; nav_label?: string }

export function SitemapStrip({
  roadmapState,
  activeSlug,
  onSelect,
}: {
  roadmapState: unknown
  activeSlug:   string | null
  onSelect:     (slug: string) => void
}) {
  const rs = roadmapState as Record<string, any>
  const pages: Stage2Page[] = (rs?.stage_2?.pages ?? []) as Stage2Page[]
  if (pages.length === 0) return null

  // Project-wide summary numbers — strategist sees "5 of 17 approved"
  // at a glance.
  const approved = pages.filter(p => p.slug && isApproved(rs, p.slug)).length
  const stale    = pages.filter(p => p.slug && isStale(rs, p.slug)).length
  const unlocked = pages.filter(p => p.slug && isUnlocked(rs, p.slug)).length

  return (
    <div className="sticky top-0 z-20 -mx-6 md:-mx-8 px-6 md:px-8 py-2.5 bg-wm-bg-elevated border-b border-wm-border shadow-sm">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-baseline gap-3 mb-1.5">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Sitemap</p>
          <span className="text-[11px] text-wm-text-muted">
            {pages.length} page{pages.length === 1 ? '' : 's'}
          </span>
          {approved > 0 && (
            <span className="text-[11px] text-wm-success inline-flex items-center gap-1">
              <Check size={10} /> {approved} approved
            </span>
          )}
          {stale > 0 && (
            <span className="text-[11px] text-wm-warning inline-flex items-center gap-1">
              <AlertTriangle size={10} /> {stale} stale
            </span>
          )}
          {unlocked > 0 && (
            <span className="text-[11px] text-wm-accent-strong inline-flex items-center gap-1">
              <Unlock size={10} /> {unlocked} unlocked
            </span>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          {pages.map(p => {
            if (!p.slug) return null
            const slug   = p.slug
            const label  = p.name ?? p.nav_label ?? p.slug
            const approval = getApproval(rs, slug)
            const status =
              approval?.stale            ? 'stale'    :
              approval?.status === 'approved'  ? 'approved' :
              approval?.status === 'unlocked'  ? 'unlocked' :
                                                  'draft'
            const isActive = slug === activeSlug
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onSelect(slug)}
                title={
                  status === 'approved' ? `Approved v${approval?.version ?? 1}${approval?.approved_at ? ' · ' + new Date(approval.approved_at).toLocaleDateString() : ''}` :
                  status === 'stale'    ? `Approved v${approval?.version ?? 1}, marked stale — Stage 8 found new issues` :
                  status === 'unlocked' ? `Was approved v${approval?.version ?? 1}, now editable` :
                                          'Draft — not yet approved'
                }
                className={[
                  'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors border',
                  isActive
                    ? 'bg-wm-accent text-white border-wm-accent'
                    : status === 'approved' ? 'bg-wm-success-bg text-wm-success border-wm-success/30 hover:opacity-80' :
                      status === 'stale'    ? 'bg-wm-warning/10 text-wm-warning border-wm-warning/30 hover:opacity-80' :
                      status === 'unlocked' ? 'bg-wm-accent-tint text-wm-accent-strong border-wm-accent/30 hover:opacity-80' :
                                              'bg-wm-bg-hover text-wm-text-muted border-wm-border hover:text-wm-text',
                ].join(' ')}
              >
                <StatusIcon status={status} />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: 'approved' | 'stale' | 'unlocked' | 'draft' }) {
  if (status === 'approved') return <Check         size={10} />
  if (status === 'stale')    return <AlertTriangle size={10} />
  if (status === 'unlocked') return <Unlock        size={10} />
  return                            <Circle        size={8} className="opacity-50" />
}
