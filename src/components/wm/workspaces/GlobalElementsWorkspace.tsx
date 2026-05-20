/**
 * Web Manager — Global Elements workspace.
 *
 * The site-specific Brixies palette. Strategist works down a curated
 * checklist (see src/lib/webCuratedLibrary.ts for the 30-odd concepts),
 * binding one (or, for "pick 2" concepts, up to two) Brixies templates
 * to each row. Bindings persist as a jsonb map on the project row.
 *
 * Replaces the old Sitemap tab's chrome designation flow — that surface
 * handled just Headers/Footers/Megamenus; this one covers Hero variants,
 * Card variants, CTA banners, Content/Feature sections, archives,
 * single-post templates, Timeline, Testimonials, Contact, Career.
 *
 * Downstream: the AI auto-bind pass (Phase 3) consults this map before
 * the global catalog so each section the strategist drafts pulls from
 * the site's own palette first.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMCard } from '../Card'
import { WMButton } from '../Button'
import { WMIconButton } from '../IconButton'
import { WMCatalogSidePanel } from '../CatalogSidePanel'
import {
  LIBRARY_CONCEPTS, LIBRARY_BY_CATEGORY, LIBRARY_CATEGORIES,
  parseCuratedLibrary,
  type LibraryConcept, type CuratedLibrary,
} from '../../../lib/webCuratedLibrary'
import type { StrategyWebProject, WebContentTemplate } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

export function GlobalElementsWorkspace({ project, onChange }: Props) {
  const [library, setLibrary] = useState<CuratedLibrary>(
    () => parseCuratedLibrary(project.curated_library)
  )
  // Catalog of templates referenced by current bindings — loaded lazily
  // so we can render preview thumbnails / layer names in each row.
  const [boundTemplates, setBoundTemplates] = useState<Record<string, WebContentTemplate>>({})
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(LIBRARY_CATEGORIES)
  )
  const [editingConcept, setEditingConcept] = useState<LibraryConcept | null>(null)

  // Re-derive library from project prop if it changes externally.
  useEffect(() => {
    setLibrary(parseCuratedLibrary(project.curated_library))
  }, [project])

  // Fetch metadata for every template currently bound to any concept,
  // plus any system-level default ids — so defaulted concepts can
  // render the default template's preview/name without the strategist
  // having to bind anything.
  useEffect(() => {
    const explicitIds = Object.values(library).flat()
    const defaultIds = LIBRARY_CONCEPTS
      .map(c => c.defaultTemplateId)
      .filter((id): id is string => !!id)
    const allIds = Array.from(new Set([...explicitIds, ...defaultIds]))
    if (allIds.length === 0) {
      setBoundTemplates({})
      return
    }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('web_content_templates')
        .select('id, layer_name, family, kind, preview_image_url')
        .in('id', allIds)
      if (cancelled) return
      const map: Record<string, WebContentTemplate> = {}
      for (const t of (data ?? []) as WebContentTemplate[]) map[t.id] = t
      setBoundTemplates(map)
    })()
    return () => { cancelled = true }
  }, [library])

  const totals = useMemo(() => {
    const totalConcepts = LIBRARY_CONCEPTS.length
    const boundConcepts = LIBRARY_CONCEPTS.filter(c => (library[c.id]?.length ?? 0) > 0).length
    return { totalConcepts, boundConcepts }
  }, [library])

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const persist = async (next: CuratedLibrary) => {
    setLibrary(next)
    const { error } = await supabase
      .from('strategy_web_projects')
      .update({ curated_library: next } as never)
      .eq('id', project.id)
    if (error) {
      console.error('[GlobalElements] save failed:', error.message)
      return
    }
    await onChange()
  }

  const saveBinding = async (conceptId: string, templateIds: string[]) => {
    const next: CuratedLibrary = { ...library }
    if (templateIds.length === 0) delete next[conceptId]
    else next[conceptId] = templateIds
    await persist(next)
  }

  const clearBinding = async (conceptId: string) => {
    await saveBinding(conceptId, [])
  }

  return (
    <div className="px-6 md:px-10 py-6 md:py-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle">
          Site Library
        </p>
        <h1 className="text-2xl font-bold text-wm-text mt-1">Global Elements</h1>
        <p className="text-[13px] text-wm-text-muted mt-1 max-w-3xl">
          The site-specific Brixies palette. Bind one (or, for some concepts, up to two) templates to
          each row. The AI auto-bind pass uses this list before falling back to the global catalog —
          so picking your Ministry Card variant here means every Ministry Card on the site uses it.
        </p>
        <p className="text-[12px] text-wm-text mt-3">
          <span className="font-semibold">{totals.boundConcepts}</span>
          <span className="text-wm-text-muted"> of {totals.totalConcepts} concepts bound</span>
        </p>
      </header>

      <div className="space-y-3">
        {LIBRARY_CATEGORIES.map(category => {
          const concepts = LIBRARY_BY_CATEGORY[category]
          const isOpen = openCategories.has(category)
          const boundInCat = concepts.filter(c => (library[c.id]?.length ?? 0) > 0).length
          return (
            <WMCard key={category} padding="none">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-wm-bg-hover transition-colors"
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <h2 className="text-[13px] font-bold text-wm-text">{category}</h2>
                <span className="text-[11px] text-wm-text-subtle ml-auto">
                  {boundInCat} / {concepts.length}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-wm-border divide-y divide-wm-border">
                  {concepts.map(concept => (
                    <ConceptRow
                      key={concept.id}
                      concept={concept}
                      boundIds={library[concept.id] ?? []}
                      boundTemplates={boundTemplates}
                      onPick={() => setEditingConcept(concept)}
                      onClear={() => void clearBinding(concept.id)}
                    />
                  ))}
                </div>
              )}
            </WMCard>
          )
        })}
      </div>

      {/* Catalog picker — filtered to the concept's allowed families + kinds */}
      <WMCatalogSidePanel
        open={editingConcept !== null}
        onClose={() => setEditingConcept(null)}
        title={editingConcept ? `Pick a ${editingConcept.label}` : 'Pick a template'}
        subtitle={editingConcept ? editingConcept.description : undefined}
        kindFilter={editingConcept?.kindFilter}
        familyFilter={editingConcept?.familyFilter}
        mode={editingConcept && editingConcept.maxPicks > 1 ? 'multi' : 'single'}
        maxSelections={editingConcept?.maxPicks}
        selectedIds={editingConcept ? (library[editingConcept.id] ?? []) : []}
        onSelect={async (ids) => {
          if (editingConcept) {
            await saveBinding(editingConcept.id, ids)
            setEditingConcept(null)
          }
        }}
      />
    </div>
  )
}

function ConceptRow({
  concept, boundIds, boundTemplates, onPick, onClear,
}: {
  concept: LibraryConcept
  boundIds: string[]
  boundTemplates: Record<string, WebContentTemplate>
  onPick: () => void
  onClear: () => void
}) {
  const bound = boundIds.length > 0
  // When nothing is explicitly bound but the concept ships with a
  // default, render the default's preview/name with a "Default" badge.
  // The strategist can still click Override to swap it.
  const showingDefault = !bound && !!concept.defaultTemplateId
  const defaultTemplate = concept.defaultTemplateId
    ? boundTemplates[concept.defaultTemplateId]
    : undefined
  return (
    <div className="px-4 py-4 flex items-start gap-4">
      <div className="mt-0.5 shrink-0">
        {bound
          ? <Check size={14} className="text-wm-success" />
          : showingDefault
            ? <Check size={14} className="text-wm-text-subtle" />
            : <span className="block w-3.5 h-3.5 rounded-full border-2 border-wm-border" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-wm-text">{concept.label}</p>
        <p className="text-[12px] text-wm-text-muted mt-0.5">{concept.description}</p>
        {concept.includes.length > 0 && (
          <p className="text-[11px] text-wm-text-subtle mt-1.5">
            <span className="uppercase tracking-wide font-bold">Includes</span>
            <span className="ml-1">{concept.includes.join(' · ')}</span>
          </p>
        )}
        {bound && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {boundIds.map(id => {
              const t = boundTemplates[id]
              return (
                <div
                  key={id}
                  className="inline-flex items-center gap-2 pr-2.5 rounded-md border border-wm-border bg-wm-bg-elevated overflow-hidden"
                >
                  {t?.preview_image_url
                    ? <img src={t.preview_image_url} alt="" className="w-14 h-10 object-cover" loading="lazy" />
                    : <span className="w-14 h-10 bg-wm-bg-hover grid place-items-center text-[9px] text-wm-text-subtle">no preview</span>}
                  <span className="text-[12px] font-semibold text-wm-text truncate max-w-[160px]">
                    {t?.layer_name ?? id}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {showingDefault && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <div
              className="inline-flex items-center gap-2 pr-2.5 rounded-md border border-dashed border-wm-border bg-wm-bg-elevated overflow-hidden opacity-90"
              title="System default — pick a template to override for this project"
            >
              {defaultTemplate?.preview_image_url
                ? <img src={defaultTemplate.preview_image_url} alt="" className="w-14 h-10 object-cover" loading="lazy" />
                : <span className="w-14 h-10 bg-wm-bg-hover grid place-items-center text-[9px] text-wm-text-subtle">no preview</span>}
              <span className="text-[12px] font-semibold text-wm-text truncate max-w-[160px]">
                {defaultTemplate?.layer_name ?? concept.defaultTemplateId}
              </span>
              <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle border-l border-wm-border pl-1.5 ml-0.5">
                Default
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {bound
          ? (
            <>
              <WMButton variant="ghost" size="sm" iconLeft={<Pencil size={11} />} onClick={onPick}>
                {concept.maxPicks > 1 ? `Edit (${boundIds.length}/${concept.maxPicks})` : 'Replace'}
              </WMButton>
              <WMIconButton label="Clear binding" size="sm" onClick={onClear}>
                <Trash2 size={12} />
              </WMIconButton>
            </>
          )
          : showingDefault
            ? (
              <WMButton variant="ghost" size="sm" iconLeft={<Pencil size={11} />} onClick={onPick}>
                Override
              </WMButton>
            )
            : (
              <WMButton variant="primary" size="sm" iconLeft={<Plus size={11} />} onClick={onPick}>
                Pick template
              </WMButton>
            )}
      </div>
    </div>
  )
}
