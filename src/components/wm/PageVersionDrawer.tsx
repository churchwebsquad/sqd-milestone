/**
 * Page version history drawer.
 *
 * Right-side slide-in panel showing the snapshot history for one page.
 * Newest snapshots first, each row labeled by trigger (manual save /
 * agent run / bind / unbind / revert) with a Revert button.
 *
 * Reverting calls revertPageToVersion() which:
 *   - Restores the page row from snapshot
 *   - Smart-diffs sections (UPDATE preserved, INSERT removed,
 *     DELETE added) so reviewer notes on surviving sections stay intact
 *   - Writes a fresh snapshot tagged with reverted_from_version so the
 *     revert itself is undo-able
 */

import { useCallback, useEffect, useState } from 'react'
import { History, RotateCcw, X, Loader2, Bot, Save, Link2, Link2Off, Undo2, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { listPageVersions, revertPageToVersion } from '../../lib/webPageVersions'
import type { WebPageVersion } from '../../types/database'

interface Props {
  /** Page whose history we're showing. Null = drawer closed. */
  pageId: string | null
  pageName: string
  open: boolean
  onClose: () => void
  /** Fires after a successful revert so the parent can reload the
   *  active page + sections from the live tables. */
  onReverted?: () => void | Promise<void>
}

const TRIGGER_ICON: Record<string, typeof Bot> = {
  agent_run:   Bot,
  manual_save: Save,
  bind:        Link2,
  unbind:      Link2Off,
  revert:      Undo2,
}
const TRIGGER_LABEL: Record<string, string> = {
  agent_run:   'Agent run',
  manual_save: 'Manual save',
  bind:        'Bind',
  unbind:      'Unbind',
  revert:      'Revert',
}

export function PageVersionDrawer({ pageId, pageName, open, onClose, onReverted }: Props) {
  const [versions, setVersions] = useState<WebPageVersion[]>([])
  const [loading, setLoading]   = useState(false)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justReverted, setJustReverted] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!pageId) return
    setLoading(true)
    try {
      const list = await listPageVersions(supabase, pageId, 100)
      setVersions(list)
    } finally {
      setLoading(false)
    }
  }, [pageId])

  useEffect(() => {
    if (open && pageId) void load()
  }, [open, pageId, load])

  const handleRevert = async (version: WebPageVersion) => {
    if (!pageId) return
    if (!confirm(
      `Revert "${pageName}" to this version?\n\nThe page's current state will be replaced with the snapshot captured ${formatRelative(version.created_at)}. ` +
      `Sections that exist in both states keep their reviewer notes; sections added since the snapshot are removed.`,
    )) return
    setRevertingId(version.id)
    setError(null)
    const result = await revertPageToVersion(supabase, version.id)
    setRevertingId(null)
    if (!result.ok) {
      setError(result.error ?? 'Revert failed')
      return
    }
    setJustReverted(version.id)
    setTimeout(() => setJustReverted(null), 2500)
    await load()
    await onReverted?.()
  }

  if (!open) return null

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside className="fixed top-0 right-0 bottom-0 w-[420px] max-w-[90vw] bg-wm-bg z-50 border-l border-wm-border shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b border-wm-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <History size={14} className="text-wm-accent shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[13px] font-bold text-wm-text">Version history</h2>
              <p className="text-[11px] text-wm-text-muted truncate">{pageName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-wm-text-muted hover:text-wm-text p-1 rounded hover:bg-wm-bg-hover"
            title="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-6 grid place-items-center text-wm-text-muted">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-wm-text-muted leading-snug">
                No snapshots yet. New entries appear here whenever an agent runs
                or a manual save lands.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-wm-border">
              {versions.map(v => {
                const Icon = TRIGGER_ICON[v.trigger_kind] ?? Save
                const reverting = revertingId === v.id
                const reverted  = justReverted === v.id
                return (
                  <li key={v.id} className="px-4 py-3 hover:bg-wm-bg-hover/40 transition-colors">
                    <div className="flex items-start gap-3">
                      <Icon size={13} className="text-wm-accent mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-wm-text font-semibold truncate">
                          {v.trigger_label || TRIGGER_LABEL[v.trigger_kind] || v.trigger_kind}
                        </p>
                        <p className="text-[11px] text-wm-text-muted">
                          {formatRelative(v.created_at)} · {Array.isArray(v.sections_snapshot) ? v.sections_snapshot.length : 0} section{Array.isArray(v.sections_snapshot) && v.sections_snapshot.length === 1 ? '' : 's'}
                        </p>
                        {v.reverted_from_version && (
                          <p className="text-[10px] text-wm-text-subtle mt-0.5 italic">
                            (created by a revert)
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevert(v)}
                        disabled={reverting || reverted}
                        className="text-[11px] font-semibold text-wm-accent hover:text-wm-accent-strong disabled:opacity-50 inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded hover:bg-wm-accent-tint"
                        title="Revert page to this version"
                      >
                        {reverting ? <Loader2 size={11} className="animate-spin" /> :
                         reverted   ? <Check size={11} /> :
                                       <RotateCcw size={11} />}
                        {reverting ? 'Reverting' : reverted ? 'Reverted' : 'Revert'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 border-t border-wm-danger/30 bg-wm-danger-bg text-[11.5px] text-wm-danger shrink-0">
            {error}
          </div>
        )}
      </aside>
    </>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now  = Date.now()
  const diff = (now - then) / 1000  // seconds
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  if (diff < 86400 * 7) {
    const days = Math.floor(diff / 86400)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
