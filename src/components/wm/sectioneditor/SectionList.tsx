/**
 * Vertical stack of section preview cards in the editor canvas.
 *
 * Selection state lifts to the host (PagesWorkspace) so the right-side
 * details panel reads the same selected-section id. Insert "+"
 * affordances appear between sections on hover.
 */
import { Plus } from 'lucide-react'
import { SectionPreviewCard, type DuplicateTargetPage } from './SectionPreviewCard'
import type { SnippetMap } from '../../../lib/webBrixiesRender'
import type { WebContentTemplate, WebSection } from '../../../types/database'

export interface SectionReviewCounts {
  open_total:     number
  open_comments:  number
  open_suggested: number
  open_requested: number
}

interface Props {
  sections: WebSection[]
  templates: Record<string, WebContentTemplate>
  cardTemplates?: Record<string, WebContentTemplate>
  selectedId: string | null
  snippetMap: SnippetMap
  bindQualityFor: (section: WebSection) => 'good' | 'partial' | 'attention'
  /** Map of section id → open-review counts for the highlight + badge. */
  reviewCountsBySection?: Record<string, SectionReviewCounts>
  onSelect: (id: string) => void
  onMoveSection: (id: string, dir: -1 | 1) => void
  onChangeVariant: (section: WebSection) => void
  onUnbind: (id: string) => void
  onRemove: (id: string) => void
  onInsertBefore: (idx: number) => void
  onInsertAfter: () => void
  /** Duplicate a section to a new position on the SAME page (right below itself). */
  onDuplicateHere?: (id: string) => void
  /** Duplicate a section to ANOTHER page in the project (appended at the end). */
  onDuplicateToPage?: (id: string, targetPageId: string) => void
  /** Pages available as duplicate targets (excluding the current page). */
  availablePages?: ReadonlyArray<DuplicateTargetPage>
  /** Snapshot a section's content to the project clipboard. */
  onCopyToClipboard?: (id: string) => void
}

export function SectionList({
  sections, templates, cardTemplates, selectedId, snippetMap, bindQualityFor,
  reviewCountsBySection,
  onSelect, onMoveSection, onChangeVariant, onUnbind, onRemove,
  onInsertBefore, onInsertAfter,
  onDuplicateHere, onDuplicateToPage, availablePages, onCopyToClipboard,
}: Props) {
  if (sections.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-wm-border bg-wm-bg p-10 text-center">
        <Plus size={20} className="text-wm-text-subtle mx-auto mb-2" />
        <p className="text-[13px] font-semibold text-wm-text">Add the first section</p>
        <p className="text-[11px] text-wm-text-muted mt-1 mb-4">
          Import a brief or click "+ Add section" below to start building this page.
        </p>
        <button
          type="button"
          onClick={onInsertAfter}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-wm-text text-wm-bg-elevated text-[12px] font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus size={12} /> Add section
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => (
        <div key={section.id}>
          <InsertSeparator onClick={() => onInsertBefore(idx)} />
          <SectionPreviewCard
            section={section}
            template={section.content_template_id ? templates[section.content_template_id] : null}
            cardTemplates={cardTemplates}
            index={idx}
            total={sections.length}
            selected={section.id === selectedId}
            snippetMap={snippetMap}
            bindQuality={bindQualityFor(section)}
            reviewCounts={reviewCountsBySection?.[section.id]}
            onSelect={() => onSelect(section.id)}
            onMoveUp={() => onMoveSection(section.id, -1)}
            onMoveDown={() => onMoveSection(section.id, 1)}
            onChangeVariant={() => onChangeVariant(section)}
            onUnbind={() => onUnbind(section.id)}
            onRemove={() => onRemove(section.id)}
            onDuplicateHere={onDuplicateHere ? () => onDuplicateHere(section.id) : undefined}
            onDuplicateToPage={onDuplicateToPage ? (targetPageId) => onDuplicateToPage(section.id, targetPageId) : undefined}
            availablePages={availablePages}
            onCopyToClipboard={onCopyToClipboard ? () => onCopyToClipboard(section.id) : undefined}
          />
        </div>
      ))}
      <InsertSeparator final onClick={onInsertAfter} />
    </div>
  )
}

function InsertSeparator({
  onClick, final,
}: {
  onClick: () => void
  final?: boolean
}) {
  return (
    <div className={['relative group/insert h-6 -my-1 flex items-center', final ? 'mt-2' : ''].join(' ')}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-transparent group-hover/insert:bg-wm-accent/40 transition-colors" />
      <button
        type="button"
        onClick={onClick}
        className="relative mx-auto inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-wm-bg-elevated border border-wm-border text-[10px] font-semibold text-wm-text-subtle hover:bg-wm-accent text-wm-text-subtle hover:text-white hover:border-wm-accent transition-all opacity-0 group-hover/insert:opacity-100"
      >
        <Plus size={11} /> Add section
      </button>
    </div>
  )
}
