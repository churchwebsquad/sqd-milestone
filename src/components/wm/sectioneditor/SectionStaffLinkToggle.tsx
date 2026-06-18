/**
 * Section-level staff-link toggle for Team Section 14.
 *
 * One control per Team 14 section (not per card). Two display modes:
 *  - "inline"  — bios render on this section's cards (current behavior)
 *  - "linked"  — every card's bio gets mirrored onto a per-staff
 *                bio page (/staff/<kebab-name>) as a Single Team
 *                Section 6 section. Renderer (Phase 2) will make each
 *                card click-through and hide the bio paragraph.
 *
 * On flip-to-linked, the handler iterates every card in this section's
 * row_grid → card_team chain and runs the staffLink helpers for each
 * staff member with a non-blank name. Cards with blank names are
 * skipped + reported back to the strategist.
 *
 * Storage: the section's display_mode lives at
 *   field_values._staff_link.display_mode = 'inline' | 'linked'
 * and per-card staff_fact_id mappings live on each card cell as
 *   { ..., _staff_fact_id: <uuid> }
 * so Phase 2's renderer can read either and act accordingly.
 */
import { useState } from 'react'
import { Loader2, UserPlus, X, AlertTriangle, UserCheck } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  findOrCreateStaffFact,
  ensurePerStaffPage,
  appendSingleTeamSection,
} from '../../../lib/staffLink'
import type { WebSection } from '../../../types/database'

interface Props {
  section:   WebSection
  projectId: string
  /** Push the updated field_values back to the section row. */
  onPatch:   (nextValues: Record<string, unknown>) => void
}

interface FlipResult {
  linkedCount: number
  skippedCount: number
  skippedNames: string[]
}

type FlipStage = 'idle' | 'flipping' | 'done' | 'error'

/** Reach into the field_values shape: row_grid[].card_team[].cell.
 *  Returns an array of { cell, rowIdx, cardIdx } so the caller can
 *  enumerate every card across all rows for the per-card link flow. */
interface CardCursor {
  rowIdx:  number
  cardIdx: number
  name:    string
  role:    string
  bio:     string
  factId:  string | null
}
function enumerateCards(values: Record<string, unknown>): CardCursor[] {
  const out: CardCursor[] = []
  const rowGrid = Array.isArray(values.row_grid) ? (values.row_grid as Array<Record<string, unknown>>) : []
  for (let r = 0; r < rowGrid.length; r++) {
    const row = rowGrid[r] ?? {}
    const cards = Array.isArray(row.card_team) ? (row.card_team as Array<Record<string, unknown>>) : []
    for (let c = 0; c < cards.length; c++) {
      const cell = cards[c] ?? {}
      out.push({
        rowIdx:  r,
        cardIdx: c,
        name:   String(cell.team_name        ?? '').trim(),
        role:   String(cell.team_position    ?? '').trim(),
        bio:    typeof cell.team_description === 'string' ? cell.team_description : '',
        factId: typeof cell._staff_fact_id === 'string' ? cell._staff_fact_id : null,
      })
    }
  }
  return out
}

/** Write a single card's updated cell bag back into the row_grid path. */
function patchCard(
  values: Record<string, unknown>,
  rowIdx: number,
  cardIdx: number,
  cellPatch: Record<string, unknown>,
): Record<string, unknown> {
  const rowGrid = Array.isArray(values.row_grid) ? [...(values.row_grid as Array<Record<string, unknown>>)] : []
  const row = { ...(rowGrid[rowIdx] ?? {}) }
  const cards = Array.isArray(row.card_team) ? [...(row.card_team as Array<Record<string, unknown>>)] : []
  cards[cardIdx] = { ...(cards[cardIdx] ?? {}), ...cellPatch }
  row.card_team = cards
  rowGrid[rowIdx] = row
  return { ...values, row_grid: rowGrid }
}

export function SectionStaffLinkToggle({ section, projectId, onPatch }: Props) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const meta   = (values._staff_link ?? {}) as { display_mode?: string }
  const displayMode = meta.display_mode === 'linked' ? 'linked' : 'inline'

  const cards = enumerateCards(values)
  const linkedCount = cards.filter(c => c.factId != null).length

  const [stage, setStage] = useState<FlipStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FlipResult | null>(null)

  const flipToLinked = async () => {
    setError(null)
    setResult(null)
    setStage('flipping')
    let next = { ...values, _staff_link: { display_mode: 'linked' } } as Record<string, unknown>
    let linkedCountLocal = 0
    const skippedNames: string[] = []
    try {
      for (const card of cards) {
        if (!card.name) {
          skippedNames.push(`(card ${card.rowIdx + 1}.${card.cardIdx + 1})`)
          continue
        }
        if (card.factId) {
          // Already linked — skip the create step but still count.
          linkedCountLocal++
          continue
        }
        const factId = await findOrCreateStaffFact(supabase, projectId, {
          name: card.name, role: card.role, bio: card.bio,
        })
        const { pageId, pageSlug } = await ensurePerStaffPage(supabase, projectId, card.name)
        await appendSingleTeamSection(supabase, pageId, factId, {
          name: card.name, role: card.role, bio: card.bio,
        })
        // Store the slug alongside the fact id so Phase 2's renderer
        // can build the per-card anchor href without a runtime lookup.
        next = patchCard(next, card.rowIdx, card.cardIdx, {
          _staff_fact_id:   factId,
          _staff_page_slug: pageSlug,
        })
        linkedCountLocal++
      }
      onPatch(next)
      setResult({
        linkedCount:  linkedCountLocal,
        skippedCount: skippedNames.length,
        skippedNames,
      })
      setStage('done')
    } catch (e: unknown) {
      console.error('[staff-link] section flip failed', e)
      setError(e instanceof Error ? e.message : 'unknown error')
      setStage('error')
    }
  }

  const flipToInline = () => {
    // Per the brainstorm: always keep the destination sections + per-
    // staff pages. Toggle-back only clears the section-level display
    // flag; per-card _staff_fact_id stays so re-linking is idempotent.
    onPatch({ ...values, _staff_link: { display_mode: 'inline' } })
    setStage('idle')
    setError(null)
    setResult(null)
  }

  return (
    <div className="rounded-md border border-wm-border bg-wm-bg-elevated/60 px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 grid place-items-center w-7 h-7 rounded-full bg-wm-accent-tint text-wm-accent-strong">
          <UserPlus size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-bold text-wm-text leading-snug">Bio display mode</p>
          <p className="text-[11px] text-wm-text-muted leading-snug mt-0.5">
            {displayMode === 'inline'
              ? 'Bios render on the cards in this section. Click below to instead mirror every staff member to their own bio page.'
              : `Linked to single-staff bio pages. ${linkedCount} of ${cards.length} cards point at a /staff/… page.`}
          </p>
        </div>
        {stage === 'flipping' ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-wm-text-muted shrink-0">
            <Loader2 size={11} className="animate-spin" />
            Linking {cards.length}…
          </span>
        ) : displayMode === 'inline' ? (
          <button
            type="button"
            onClick={() => void flipToLinked()}
            disabled={cards.length === 0}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-accent-tint text-wm-accent-strong border border-wm-accent/30 hover:bg-wm-accent/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            title="Mirror every card's bio to its own /staff/… page"
          >
            <UserPlus size={11} />
            Move all to single-staff pages
          </button>
        ) : (
          <button
            type="button"
            onClick={flipToInline}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-wm-bg-hover text-wm-text-muted border border-wm-border hover:bg-wm-bg transition-colors shrink-0"
            title="Render bios inline on this section again. Per-staff pages stay (archive manually if needed)."
          >
            <X size={11} />
            Render inline again
          </button>
        )}
      </div>

      {result && (
        <div className="mt-2 text-[11px] text-emerald-700 inline-flex items-start gap-1">
          <UserCheck size={11} className="mt-0.5 shrink-0" />
          <span>
            Linked {result.linkedCount} staff member{result.linkedCount === 1 ? '' : 's'} to per-staff pages.
            {result.skippedCount > 0 && (
              <>
                {' '}Skipped {result.skippedCount} card{result.skippedCount === 1 ? '' : 's'} with no staff name set
                {result.skippedNames.length > 0 && `: ${result.skippedNames.slice(0, 3).join(', ')}${result.skippedNames.length > 3 ? '…' : ''}`}
                .
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-wm-warn inline-flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
