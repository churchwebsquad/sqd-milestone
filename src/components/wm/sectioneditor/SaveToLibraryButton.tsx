/**
 * Page-builder affordance for promoting a section's bound template to
 * the project's site library. Opens a small popover that handles three
 * cases:
 *
 *   1. Template already a pick under some concept → "✓ In site library"
 *      label + an "Unpin" item per concept it's bound to.
 *   2. Concept has room (current bindings < maxPicks) → "Save as X"
 *      one-click adds.
 *   3. Concept is at max picks → list current picks with "Replace"
 *      buttons so the strategist swaps one out without leaving the
 *      page builder.
 *
 * Concept matching uses the template's family + kind against
 * LIBRARY_CONCEPTS' filters (same logic the Global Elements picker
 * applies in reverse).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Check, Loader2, ChevronRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  parseCuratedLibrary, findCandidateConcepts, findConceptsContainingTemplate,
  addOrReplaceLibraryBinding, removeLibraryBinding,
  type CuratedLibrary, type LibraryConcept,
} from '../../../lib/webCuratedLibrary'
import type { StrategyWebProject, WebContentTemplate } from '../../../types/database'

export interface SaveToLibraryButtonProps {
  project: StrategyWebProject
  template: Pick<WebContentTemplate, 'id' | 'family' | 'kind' | 'layer_name'>
  /** Templates keyed by id — the popover renders bound-template labels
   *  when offering Replace, so we need names for the alternatives. */
  templatesById?: Record<string, Pick<WebContentTemplate, 'id' | 'layer_name'>>
  /** Refresh callback fired after a successful save / replace so the
   *  workspace can re-read curated_library. */
  onChange: () => Promise<void>
}

export function SaveToLibraryButton({
  project, template, templatesById = {}, onChange,
}: SaveToLibraryButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  // Local mirror of the library we mutate optimistically. Refreshed
  // each time we open the popover so concurrent edits in Global
  // Elements aren't clobbered.
  const [library, setLibrary] = useState<CuratedLibrary>(
    () => parseCuratedLibrary(project.curated_library),
  )
  useEffect(() => {
    if (open) setLibrary(parseCuratedLibrary(project.curated_library))
  }, [open, project.curated_library])

  const candidates = useMemo(
    () => findCandidateConcepts({
      id:     template.id,
      family: template.family ?? null,
      kind:   template.kind   ?? null,
    }),
    [template.id, template.family, template.kind],
  )
  const containing = useMemo(
    () => findConceptsContainingTemplate(library, template.id),
    [library, template.id],
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const persist = async (next: CuratedLibrary): Promise<boolean> => {
    setBusy(true); setError(null)
    setLibrary(next)
    const { error: err } = await supabase
      .from('strategy_web_projects')
      .update({ curated_library: next } as never)
      .eq('id', project.id)
    setBusy(false)
    if (err) {
      console.error('[site-library] save failed:', err.message)
      setError(err.message)
      // Roll back local mirror so the popover reflects truth.
      setLibrary(parseCuratedLibrary(project.curated_library))
      return false
    }
    await onChange()
    return true
  }

  const addToConcept = async (concept: LibraryConcept) => {
    const current = library[concept.id] ?? []
    if (current.includes(template.id)) return  // no-op (shouldn't happen — UI hides)
    if (current.length < concept.maxPicks) {
      await persist(addOrReplaceLibraryBinding(library, concept.id, template.id, { kind: 'add' }))
    }
    // Replace flows happen via per-pick buttons in the popover below.
  }

  const replaceInConcept = async (concept: LibraryConcept, replacesTemplateId: string) => {
    await persist(addOrReplaceLibraryBinding(library, concept.id, template.id, {
      kind: 'replace', replacesTemplateId,
    }))
  }

  const unpinFromConcept = async (concept: LibraryConcept) => {
    await persist(removeLibraryBinding(library, concept.id, template.id))
  }

  const isInLibrary = containing.length > 0

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={candidates.length === 0}
        title={
          candidates.length === 0
            ? `No site-library concept accepts ${template.family ?? template.layer_name}.`
            : isInLibrary
              ? `${template.layer_name} is in your site library. Click to manage.`
              : 'Save this template to your site library.'
        }
        className={[
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          isInLibrary
            ? 'bg-wm-accent-tint border-wm-accent/30 text-wm-accent-strong hover:border-wm-accent'
            : 'bg-wm-bg-elevated border-wm-border-strong text-wm-text hover:border-wm-text-subtle',
        ].join(' ')}
      >
        {isInLibrary ? <Check size={11} /> : <BookmarkPlus size={11} />}
        {isInLibrary ? 'In site library' : 'Save to site library'}
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1.5 right-0 min-w-[280px] max-w-[360px] rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg py-1">
          {error && (
            <div role="alert" className="mx-2 my-1 px-2 py-1 rounded text-[10px] text-wm-danger bg-wm-danger-bg">
              {error}
            </div>
          )}

          {/* If template is already in one+ concepts, surface unpins first. */}
          {containing.map(concept => (
            <ConceptRow
              key={`pinned-${concept.id}`}
              concept={concept}
              label="In library"
              variant="pinned"
            >
              <button
                type="button"
                onClick={() => void unpinFromConcept(concept)}
                disabled={busy}
                className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger px-2 py-1 rounded hover:bg-wm-danger-bg/50 transition-colors disabled:opacity-50"
              >
                Unpin
              </button>
            </ConceptRow>
          ))}

          {/* Concepts that could ACCEPT this template (passes family + kind
              filters) — minus ones already containing it. */}
          {candidates
            .filter(c => !containing.some(p => p.id === c.id))
            .map(concept => {
              const current = library[concept.id] ?? []
              const hasRoom = current.length < concept.maxPicks
              return (
                <ConceptRow key={concept.id} concept={concept}>
                  {hasRoom ? (
                    <button
                      type="button"
                      onClick={() => void addToConcept(concept)}
                      disabled={busy}
                      className="text-[11px] font-semibold text-wm-accent-strong hover:underline px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <BookmarkPlus size={11} />}
                      Save as {concept.label}
                    </button>
                  ) : (
                    <span className="text-[10px] text-wm-text-subtle italic">
                      Full ({current.length}/{concept.maxPicks}) — replace one:
                    </span>
                  )}
                  {!hasRoom && (
                    <ul className="mt-1 ml-2 space-y-0.5">
                      {current.map(id => {
                        const t = templatesById[id]
                        return (
                          <li key={id} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-wm-text-muted truncate">
                              {t?.layer_name ?? id}
                            </span>
                            <button
                              type="button"
                              onClick={() => void replaceInConcept(concept, id)}
                              disabled={busy}
                              className="text-[10px] font-semibold text-wm-accent-strong hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
                            >
                              <ChevronRight size={9} /> Replace
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </ConceptRow>
              )
            })}

          {containing.length === 0 && candidates.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-wm-text-subtle italic">
              No matching concept. Open Global Elements to bind manually.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ConceptRow({
  concept, label, variant = 'normal', children,
}: {
  concept: LibraryConcept
  label?: string
  variant?: 'normal' | 'pinned'
  children: React.ReactNode
}) {
  return (
    <div
      className={[
        'px-3 py-2 border-b border-wm-border last:border-b-0',
        variant === 'pinned' ? 'bg-wm-accent-tint/30' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold text-wm-text leading-tight">{concept.label}</p>
            {label && (
              <span className="text-[9px] uppercase tracking-widest font-bold text-wm-accent-strong">
                {label}
              </span>
            )}
          </div>
          <p className="text-[10px] text-wm-text-muted leading-tight mt-0.5">{concept.category}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  )
}
