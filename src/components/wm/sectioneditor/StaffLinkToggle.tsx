/**
 * Per-staff-card link toggle for Team Section 14 items.
 *
 * Renders a compact "Render bio on page / Add to single team page"
 * switch above each Card team item's slots. When toggled to linked,
 * the handler creates (or finds) a per-staff bio page and a Single
 * Team Section 6 section on that page, then writes the resulting
 * staff_fact_id + _display_mode='linked' onto the item's value.
 *
 * Only visible when this GroupEditor instance is the Card team group
 * (see ItemCard's `staffLinkEnabled` flag). Outside that context the
 * component returns null.
 */
import { useState } from 'react'
import { Loader2, UserCheck, UserPlus, AlertTriangle, ExternalLink, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useProjectPages } from './ProjectPagesContext'
import {
  findOrCreateStaffFact,
  ensurePerStaffPage,
  appendSingleTeamSection,
  readStaffFact,
} from '../../../lib/staffLink'

interface Props {
  /** The Card team item's current value bag. Reads team_name /
   *  team_position / team_description from here when flipping. */
  item: Record<string, unknown>
  /** Callback to write changes back to the item. The toggle writes
   *  `_display_mode` and `_staff_fact_id` meta keys. */
  onPatch: (patch: Record<string, unknown>) => void
  /** Project id — needed for church_facts + page lookups. */
  projectId: string
}

type FlipStage = 'idle' | 'flipping' | 'done' | 'error'

export function StaffLinkToggle({ item, onPatch, projectId }: Props) {
  const displayMode = (item._display_mode === 'linked') ? 'linked' : 'inline'
  const linkedFactId = typeof item._staff_fact_id === 'string' ? item._staff_fact_id : null
  const name = String(item.team_name ?? '').trim()
  const role = String(item.team_position ?? '').trim()
  const bio  = typeof item.team_description === 'string' ? item.team_description : ''

  const [stage, setStage] = useState<FlipStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [linkedPageSlug, setLinkedPageSlug] = useState<string | null>(null)
  const projectPages = useProjectPages()

  const flipToLinked = async () => {
    setError(null)
    if (!name) {
      setError('Add a staff name first — the slug + church_facts row are keyed on it.')
      return
    }
    setStage('flipping')
    try {
      const factId = await findOrCreateStaffFact(supabase, projectId, { name, role, bio })
      const { pageSlug } = await ensurePerStaffPage(supabase, projectId, name)
      const targetPageRow = await supabase
        .from('web_pages')
        .select('id')
        .eq('web_project_id', projectId)
        .eq('slug', pageSlug)
        .single()
      const pageId = (targetPageRow.data as { id: string } | null)?.id
      if (!pageId) throw new Error('per-staff page id missing after ensure')
      await appendSingleTeamSection(supabase, pageId, factId, { name, role, bio })
      onPatch({ _display_mode: 'linked', _staff_fact_id: factId })
      setLinkedPageSlug(pageSlug)
      setStage('done')
    } catch (e: unknown) {
      console.error('[staff-link] flipToLinked failed', e)
      setError(e instanceof Error ? e.message : 'unknown error')
      setStage('error')
    }
  }

  const flipToInline = () => {
    // Per the brainstorm answer: always keep the destination section.
    // Inline-flip only clears the local meta — the per-staff page +
    // Single Team Section 6 stay untouched. Strategist archives them
    // manually if they want.
    onPatch({ _display_mode: 'inline', _staff_fact_id: null })
    setStage('idle')
    setError(null)
    setLinkedPageSlug(null)
  }

  // Resolve the linked staff name/page when we already have a link
  // (e.g. after page reload — stage state doesn't survive but the
  // value bag does). Show a status row instead of the toggle prompt.
  const linkedRowVisible = displayMode === 'linked' && linkedFactId

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated/60 px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Bio display</span>
        <div className="flex-1" />
        {stage === 'flipping' ? (
          <span className="inline-flex items-center gap-1 text-wm-text-muted">
            <Loader2 size={11} className="animate-spin" />
            Linking…
          </span>
        ) : displayMode === 'inline' ? (
          <button
            type="button"
            onClick={() => void flipToLinked()}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 transition-colors"
            title="Add this bio to a single-staff page; the card on this section becomes a click-through link in Phase 2"
          >
            <UserPlus size={11} />
            Move to single-staff page
          </button>
        ) : (
          <button
            type="button"
            onClick={flipToInline}
            className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-semibold bg-wm-bg-hover text-wm-text-muted border border-wm-border hover:bg-wm-bg transition-colors"
            title="Render bio inline on this card again. The single-staff page section stays (archive manually if you don't want it)."
          >
            <X size={11} />
            Render bio inline again
          </button>
        )}
      </div>

      {linkedRowVisible && (
        <p className="mt-1.5 text-[11px] text-emerald-700 inline-flex items-start gap-1">
          <UserCheck size={11} className="mt-0.5 shrink-0" />
          <span>
            Linked to a single-staff bio page.
            {linkedPageSlug && (
              <>
                {' '}/<span className="font-mono">{linkedPageSlug}</span>
              </>
            )}
          </span>
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-[11px] text-wm-warn inline-flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
