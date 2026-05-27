/**
 * Copywriter notes panel — surfaces the copywriter's mechanical scan
 * log + flagged gaps + kickbacks for a single page. Pulls from
 * web_pages.brief.copywriter_meta which the copywriter-output importer
 * writes on every commit.
 *
 * Previously rendered as a banner at the top of the page editor; now
 * lives inside the Assistant Rail's Audit (scan) tab so all post-import
 * "things to review" sit in one place.
 */
import { useState } from 'react'
import { FileText } from 'lucide-react'
import { friendlyScanMessage } from '../../lib/webCopywriterOutput'

export interface CopywriterMeta {
  imported_at?:               string
  mechanical_scan_log?:       Array<{ section_sort: number | string; slot: string; issue: string; fix?: string }>
  gaps_flagged?:              Array<{ section_sort: number | string; slot?: string; issue?: string; note?: string }>
  kickbacks_to_copywriter?:   Array<{ section_sort?: number | string; note?: unknown }>
  template_overrides_applied?: Array<{ sort_order: number; template_id: string }>
}

export function parseCopywriterMeta(brief: unknown): CopywriterMeta | null {
  if (!brief || typeof brief !== 'object') return null
  const m = (brief as Record<string, unknown>).copywriter_meta
  if (!m || typeof m !== 'object') return null
  return m as CopywriterMeta
}

interface Props {
  brief: unknown
  /** When false, the wrapper renders without the outer card border —
   *  use this when embedding inside another panel (e.g. the Audit tab)
   *  that already provides chrome. */
  bordered?: boolean
  /** Collapsed-by-default unless there are scan or kickback entries. */
  defaultOpen?: boolean
}

export function CopywriterNotesPanel({ brief, bordered = true, defaultOpen }: Props) {
  const meta = parseCopywriterMeta(brief)
  const scan      = meta?.mechanical_scan_log     ?? []
  const gaps      = meta?.gaps_flagged            ?? []
  const kickbacks = meta?.kickbacks_to_copywriter ?? []
  const overrides = meta?.template_overrides_applied ?? []
  const total = scan.length + gaps.length + kickbacks.length
  const [open, setOpen] = useState(defaultOpen ?? (scan.length + kickbacks.length > 0))
  if (!meta || total === 0) return null

  // Map gaps_flagged entries — the copywriter sometimes ships `note`,
  // sometimes `issue`. Coerce to a single readable string.
  const gapNote = (g: CopywriterMeta['gaps_flagged'] extends Array<infer T> ? T : never): string => {
    if (typeof g.note === 'string') return g.note
    if (typeof g.issue === 'string') return g.issue
    return ''
  }

  return (
    <div className={bordered ? 'rounded-md border border-wm-border bg-wm-bg-elevated' : ''}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-wm-bg-hover"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} className="text-wm-accent-strong shrink-0" />
          <span className="text-[12px] font-semibold text-wm-text">Copywriter notes</span>
          <span className="text-[10px] text-wm-text-subtle truncate">
            {scan.length > 0      && `${scan.length} scan log · `}
            {gaps.length > 0      && `${gaps.length} gap${gaps.length === 1 ? '' : 's'} · `}
            {kickbacks.length > 0 && `${kickbacks.length} kickback${kickbacks.length === 1 ? '' : 's'} · `}
            {overrides.length > 0 && `${overrides.length} template swap${overrides.length === 1 ? '' : 's'} · `}
            {meta.imported_at && new Date(meta.imported_at).toLocaleString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <span className="text-[10px] text-wm-text-subtle shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-wm-border/60 pt-2.5">
          {scan.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1">
                Scan flags · {scan.length}
              </p>
              <ul className="space-y-1.5">
                {scan.map((m, i) => {
                  const fm = friendlyScanMessage({
                    section_sort: typeof m.section_sort === 'number' ? m.section_sort : -1,
                    slot:         m.slot,
                    issue:        m.issue,
                    fix:          m.fix,
                  })
                  return (
                    <li
                      key={i}
                      className={[
                        'rounded-md border px-2 py-1.5 text-[11px] leading-snug',
                        fm.severity === 'action'
                          ? 'border-wm-warning/40 bg-wm-warning-bg text-wm-text'
                          : 'border-wm-border bg-wm-bg text-wm-text-muted',
                      ].join(' ')}
                    >
                      <p className="font-semibold text-wm-text">{fm.headline}</p>
                      <p className="mt-0.5">{fm.advice}</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[9px] uppercase tracking-widest font-semibold text-wm-text-subtle hover:text-wm-text">
                          Technical detail
                        </summary>
                        <p className="mt-1 font-mono text-[10px] text-wm-text-subtle whitespace-pre-wrap">
                          {fm.technical}
                        </p>
                      </details>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {kickbacks.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-warning mb-1">
                Kickbacks · {kickbacks.length}
              </p>
              <ul className="space-y-1">
                {kickbacks.map((k, i) => (
                  <li key={i} className="text-[11px] text-wm-text">
                    {k.section_sort != null && <span className="font-semibold">Section {String(k.section_sort)} · </span>}
                    <span className="text-wm-text-muted">{typeof k.note === 'string' ? k.note : JSON.stringify(k)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
                Gaps to confirm · {gaps.length}
              </p>
              <ul className="space-y-1">
                {gaps.map((g, i) => (
                  <li key={i} className="text-[11px] text-wm-text">
                    <span className="font-semibold">Section {String(g.section_sort)}</span>
                    <span className="text-wm-text-muted"> — {gapNote(g)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overrides.length > 0 && (
            <p className="text-[10px] text-wm-text-subtle italic">
              {overrides.length} template{overrides.length === 1 ? '' : 's'} swapped from the copywriter's pick during import.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
