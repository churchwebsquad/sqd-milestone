/**
 * Right-side details panel — the editor for one selected section.
 *
 * Layout (top → bottom):
 *   Header       — template thumbnail + family/variant title + actions
 *   Name         — short label for the section (stored under notes.name)
 *   Fields       — flat list of slot / group editors, in template order
 *   Counters     — asset / element presence chips (read-only, at the bottom)
 *
 * Image slots are deliberately hidden from the editor — at this stage
 * we just need to count how many image placeholders the template
 * expects; the actual upload flow lives elsewhere.
 *
 * No freehand __extras. If a section needs a CTA / card / etc. the
 * strategist swaps the variant.
 */
import { useEffect, useRef, useState } from 'react'
import {
  X, Image as ImageIcon, LayoutGrid, MousePointerClick, FormInput,
  ChevronDown, ChevronRight, RotateCw, Archive, Trash2,
  MessageSquarePlus, Clock, AlertTriangle,
} from 'lucide-react'
import { SlotEditor } from './SlotEditor'
import { GroupEditor } from './GroupEditor'
import { GridEditor, detectGridChain } from './GridEditor'
import { SnippetMenu } from './SnippetMenu'
import { CommentActions } from './CommentActions'
import { FeedbackCard } from '../feedback/FeedbackCard'
import { SaveToLibraryButton } from './SaveToLibraryButton'
import { ProjectPagesProvider } from './ProjectPagesContext'
import { summarizeSlotPresence } from '../../../lib/webBrixiesLayoutParser'
import { supabase } from '../../../lib/supabase'
import {
  findPlacements, applyPlacement, previewConversion, isStructuredPlacement,
  findShapeMismatches, healShapeMismatches,
  type Placement,
} from '../../../lib/webUnmappedMapper'
import type { WMSnippetOption } from '../RichTextEditor'
import type {
  WebContentTemplate, WebSection, WebFieldDef, WebGroupDef,
  WebReview, WebReviewComment,
} from '../../../types/database'

interface Props {
  section: WebSection
  template: WebContentTemplate | null
  snippets: readonly WMSnippetOption[]
  /** Card-family templates available to palette-referenced groups. */
  cardTemplates?: Record<string, WebContentTemplate>
  /** Project's full page list, threaded in so the CTA slot editor's
   *  "internal route" dropdown can read it. The panel renders inside
   *  the AssistantRail — a sibling of the workspace tree, so the
   *  workspace-mounted ProjectPagesProvider doesn't reach in here. */
  pages?: ReadonlyArray<{ id: string; name: string; slug: string }>
  onChange: (patch: Partial<WebSection>) => void
  onClose: () => void
  onChangeVariant: () => void
  onUnbind: () => void
  onRemove: () => void
  /** Project row — needed by the "Save to site library" button so it
   *  can read/write `curated_library`. Optional so older callers
   *  (e.g. legacy review portal) compile; SaveToLibraryButton is
   *  hidden when this isn't passed. */
  project?: import('../../../types/database').StrategyWebProject
  /** Existing library bindings + their template metadata, used by the
   *  Save popover to render "Replace this pick" lists with names. */
  libraryTemplatesById?: Record<string, Pick<WebContentTemplate, 'id' | 'layer_name'>>
  /** Refresh hook fired after the curated_library is mutated from
   *  this panel. The workspace re-reads the project row when this
   *  fires so the badge state stays in sync. */
  onLibraryChange?: () => Promise<void>
  /** Active internal review on the project (or null). Drives the
   *  comment-create entry point at the bottom of the panel. */
  activeInternalReview?: WebReview | null
  /** Open comments + suggestions attached to this section. */
  sectionComments?: WebReviewComment[]
  /** Review row keyed by id — used to resolve each comment's
   *  reviewKind + roundNumber for the new FeedbackCard header. */
  reviewsById?: Record<string, WebReview>
  /** Called after a comment is created or resolved so the parent
   *  workspace reloads the review state. */
  onCommentsChange?: () => Promise<void>
}

export function SectionDetailsPanel({
  section, template, snippets, cardTemplates, pages,
  onChange, onClose, onChangeVariant, onUnbind, onRemove,
  project, libraryTemplatesById, onLibraryChange,
  activeInternalReview, sectionComments, reviewsById, onCommentsChange,
}: Props) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const setValue = (key: string, v: unknown) => {
    onChange({ field_values: { ...values, [key]: v } })
  }

  const presence = template ? summarizeSlotPresence(template, values) : null
  const fields: WebFieldDef[] = template?.fields ?? []
  const visibleFields = fields.filter(isEditableField)

  // Roll up every slot whose entered text exceeds its max_chars
  // budget. The CharCounter on each individual slot makes the local
  // overflow visible — this summary makes the section-level total
  // visible so the strategist (or AI copywriter) can see at a glance
  // when the layout is being asked to render more text than it was
  // designed for.
  const overflowingSlots = template ? collectOverflowingSlots(fields, values) : []

  return (
    <ProjectPagesProvider pages={pages ?? []}>
    <aside className="w-full h-full flex flex-col bg-wm-bg-elevated min-h-0">
      {/* Header */}
      <header className="shrink-0 px-4 py-3 border-b border-wm-border bg-wm-bg">
        <div className="flex items-start gap-3">
          {template?.preview_image_url ? (
            <button
              type="button"
              onClick={onChangeVariant}
              className="shrink-0 w-14 h-9 rounded-md overflow-hidden border border-wm-border hover:border-wm-accent transition-colors"
              title="Change variant"
            >
              <img src={template.preview_image_url} alt="" className="w-full h-full object-cover" />
            </button>
          ) : (
            <div className="shrink-0 w-14 h-9 rounded-md border border-wm-border bg-wm-bg-hover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest font-bold text-wm-accent-strong truncate">
              {template?.family ?? 'Freehand section'}
            </p>
            <p className="text-[13px] font-semibold text-wm-text truncate">
              {template?.layer_name ?? 'No template bound'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 h-7 w-7 grid place-items-center rounded text-wm-text-subtle hover:bg-wm-bg-hover hover:text-wm-text transition-colors"
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          <PanelButton onClick={onChangeVariant} icon={<RotateCw size={11} />}>Change variant</PanelButton>
          {template && project && onLibraryChange && (
            <SaveToLibraryButton
              project={project}
              template={template}
              templatesById={libraryTemplatesById}
              onChange={onLibraryChange}
            />
          )}
          {template && (
            <PanelButton onClick={onUnbind} icon={<Archive size={11} />} variant="ghost">Unbind</PanelButton>
          )}
          <PanelButton onClick={onRemove} icon={<Trash2 size={11} />} variant="danger">Remove</PanelButton>
          <div className="ml-auto">
            <SnippetMenu snippets={snippets} />
          </div>
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        {/* When an internal review is active, surface the review
            comments block at the TOP so it's visually distinct from
            the page-editing chrome — it's the primary action surface
            during review mode, not an afterthought tucked at the
            bottom. */}
        {activeInternalReview && (
          <ReviewCommentsBlock
            section={section}
            template={template}
            activeInternalReview={activeInternalReview}
            sectionComments={sectionComments ?? []}
            reviewsById={reviewsById ?? {}}
            onCommentsChange={onCommentsChange ?? (async () => {})}
          />
        )}

        {/* Layout-budget overflow rollup — shown above the field
            editors so the strategist sees overflow before scrolling
            through individual char counters. Each entry names the
            field and how many chars over budget it is. */}
        {template && overflowingSlots.length > 0 && (
          <Section title={`Layout budget · ${overflowingSlots.length} field${overflowingSlots.length === 1 ? '' : 's'} over`} defaultOpen>
            <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg p-3">
              <p className="text-[11px] text-wm-text leading-snug mb-2">
                Copy exceeds the layout's natural character budget — the
                rendered preview will spill or wrap unexpectedly. Trim
                where possible, or swap to a denser variant via Change
                variant if the content genuinely needs more room.
              </p>
              <ul className="space-y-1">
                {overflowingSlots.map(o => (
                  <li key={o.path} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono text-wm-text-muted truncate">{o.label}</span>
                    <span className="font-mono tabular-nums text-wm-danger font-semibold shrink-0">
                      +{o.over} chars
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {/* Field editors */}
        {template && visibleFields.length > 0 && (
          <Section title="Fields" defaultOpen>
            <div className="space-y-3">
              {visibleFields.map((field, idx) => {
                if (field.kind === 'slot') {
                  return (
                    <SlotEditor
                      key={field.key + '-' + idx}
                      slot={field}
                      value={values[field.key]}
                      onChange={(v) => setValue(field.key, v)}
                      snippets={snippets}
                    />
                  )
                }
                // Group: if it has a recognizable row × col chain,
                // render as a flat grid instead of nested chevrons.
                if (detectGridChain(field)) {
                  return (
                    <GridEditor
                      key={field.key + '-' + idx}
                      group={field}
                      value={values[field.key]}
                      onChange={(v) => setValue(field.key, v)}
                      snippets={snippets}
                      cardTemplates={cardTemplates}
                    />
                  )
                }
                return (
                  <GroupEditor
                    key={field.key + '-' + idx}
                    group={field}
                    value={values[field.key]}
                    onChange={(v) => setValue(field.key, v)}
                    snippets={snippets}
                    cardTemplates={cardTemplates}
                  />
                )
              })}
            </div>
          </Section>
        )}

        {/* Freehand body for sections without a template */}
        {!template && (
          <Section title="Body copy" defaultOpen>
            <FreehandBodyField
              value={typeof values.body === 'string' ? values.body : ''}
              onChange={(v) => setValue('body', v)}
            />
          </Section>
        )}

        {/* Review comments + suggestion entry point. Only renders
            HERE (at the bottom) when there's no active internal
            review; an active review pulls this block to the top via
            the conditional above. */}
        {!activeInternalReview && (
          <ReviewCommentsBlock
            section={section}
            template={template}
            activeInternalReview={null}
            sectionComments={sectionComments ?? []}
            reviewsById={reviewsById ?? {}}
            onCommentsChange={onCommentsChange ?? (async () => {})}
          />
        )}

        {/* Shape-mismatch healing — items placed before the re-keying
            pipeline shipped (or from manual edits) sometimes have
            field names that don't match the group's item_schema, so
            they render as empty cards even though the data is present.
            Detect those cases and offer a one-click heal. */}
        {template && (() => {
          const mismatches = findShapeMismatches(template, values, cardTemplates ?? {})
          if (mismatches.length === 0) return null
          const byGroup = new Map<string, typeof mismatches>()
          for (const m of mismatches) {
            const arr = byGroup.get(m.group_label) ?? []
            arr.push(m)
            byGroup.set(m.group_label, arr)
          }
          return (
            <Section title={`Item shapes need fixing (${mismatches.length})`} defaultOpen>
              <div className="rounded-md border border-wm-accent/40 bg-wm-accent-tint p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={12} className="text-wm-accent shrink-0 mt-0.5" />
                  <p className="text-[11px] text-wm-text leading-snug">
                    Cards in the layout have copy under field names that
                    don't match the slot keys, so they render empty.
                    Auto-fix re-keys them using semantic aliases
                    (name → heading, title → description, etc.).
                  </p>
                </div>
                <div className="space-y-1 text-[11px]">
                  {Array.from(byGroup.entries()).map(([groupLabel, ms]) => (
                    <div key={groupLabel}>
                      <p className="font-semibold text-wm-text">
                        {groupLabel}
                        <span className="ml-1 text-wm-text-muted font-normal">
                          ({ms.length} field{ms.length === 1 ? '' : 's'})
                        </span>
                      </p>
                      <ul className="space-y-0.5 pl-3 text-[10px] text-wm-text-muted">
                        {ms.slice(0, 4).map((m, i) => (
                          <li key={i}>
                            <span className="font-mono">{m.source_key}</span> → <span className="font-mono">{m.target_key}</span>
                            <span className="ml-1 text-wm-text-subtle">({m.value_preview})</span>
                          </li>
                        ))}
                        {ms.length > 4 && (
                          <li className="italic text-wm-text-subtle">…and {ms.length - 4} more</li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const result = healShapeMismatches(template, values, cardTemplates ?? {})
                    if (result.healed > 0) onChange({ field_values: result.fieldValues })
                  }}
                  className="rounded-md bg-wm-accent text-white text-[11px] font-semibold px-3 py-1.5 hover:bg-wm-accent-hover transition-colors"
                >
                  Auto-fix {mismatches.length} field{mismatches.length === 1 ? '' : 's'} →
                </button>
              </div>
            </Section>
          )
        })()}

        {/* Unmapped content — copy the aggressive auto-mapper couldn't
            place in the current template. Each leftover key gets a
            "Move to →" dropdown listing every viable slot + the shape
            conversion that would run when picked. */}
        {template && (() => {
          const raw = values.__unmapped
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
          const entries = Object.entries(raw as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
          if (entries.length === 0) return null
          return (
            <Section title={`Unmapped content (${entries.length})`} defaultOpen>
              <div className="rounded-md border border-wm-warning/40 bg-wm-warning-bg p-3">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle size={12} className="text-wm-warning shrink-0 mt-0.5" />
                  <p className="text-[11px] text-wm-text leading-snug">
                    Copy that didn't fit the layout. Pick a slot to move
                    each item into — shape conversions are applied
                    automatically.
                  </p>
                </div>
                <ul className="space-y-2">
                  {entries.map(([k, v]) => (
                    <UnmappedEntryRow
                      key={k}
                      sourceKey={k}
                      value={v}
                      template={template}
                      fieldValues={values}
                      paletteTemplates={cardTemplates ?? {}}
                      onPlace={(placement) => {
                        const result = applyPlacement(values, k, v, placement)
                        onChange({ field_values: result.fieldValues })
                      }}
                    />
                  ))}
                </ul>
              </div>
            </Section>
          )
        })()}

        {/* Counters at the bottom — read-only */}
        {template && presence && (
          <Section title="Contents">
            <div className="flex flex-wrap gap-1.5">
              <CounterChip
                icon={<ImageIcon size={11} />}
                label="Images"
                count={presence.images.expected}
              />
              <CounterChip
                icon={<MousePointerClick size={11} />}
                label="CTAs"
                count={countCtas(template, values)}
              />
              <CounterChip
                icon={<LayoutGrid size={11} />}
                label="Cards"
                count={countCards(template, values)}
              />
              <CounterChip
                icon={<FormInput size={11} />}
                label="Form fields"
                count={fields.filter(f => f.kind === 'slot' && f.type === 'form-input').length}
              />
            </div>
          </Section>
        )}
      </div>
    </aside>
    </ProjectPagesProvider>
  )
}

// ── Layout-budget overflow ─────────────────────────────────────────

interface OverflowingSlot { path: string; label: string; over: number }

/** Walk every text-bearing slot in the section (top-level + nested
 *  group items) and report ones whose entered text exceeds the
 *  layout's natural character budget. Plain-text length is used for
 *  richtext so HTML markup doesn't get counted. */
function collectOverflowingSlots(
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
): OverflowingSlot[] {
  const out: OverflowingSlot[] = []
  const visit = (
    schema: ReadonlyArray<WebFieldDef>,
    valueAt: unknown,
    pathPrefix: string[],
  ): void => {
    if (!Array.isArray(schema)) return
    for (const f of schema) {
      if (f.kind === 'slot') {
        const max = f.max_chars
        if (!max) continue
        const v = (valueAt && typeof valueAt === 'object')
          ? (valueAt as Record<string, unknown>)[f.key]
          : undefined
        if (typeof v !== 'string' || !v) continue
        const used = f.type === 'richtext'
          ? v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().length
          : v.length
        if (used > max) {
          const path = [...pathPrefix, f.key].join('.')
          const label = humanizeSlotPath([...pathPrefix, f.layer_name ?? f.key])
          out.push({ path, label, over: used - max })
        }
        continue
      }
      // Group — recurse into each item's values against item_schema.
      const groupValueRaw = (valueAt && typeof valueAt === 'object')
        ? (valueAt as Record<string, unknown>)[f.key]
        : undefined
      const items: Array<Record<string, unknown>> = Array.isArray(groupValueRaw)
        ? (groupValueRaw as Array<Record<string, unknown>>)
        : (groupValueRaw && typeof groupValueRaw === 'object' && 'items' in (groupValueRaw as Record<string, unknown>)
            ? ((groupValueRaw as Record<string, unknown>).items as Array<Record<string, unknown>>)
            : [])
      for (let i = 0; i < items.length; i++) {
        visit(f.item_schema as WebFieldDef[], items[i], [...pathPrefix, `${f.key}[${i + 1}]`])
      }
    }
  }
  visit(fields, values, [])
  return out
}

function humanizeSlotPath(parts: ReadonlyArray<string>): string {
  return parts
    .map(p => p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' › ')
}

// ── Visibility rules ────────────────────────────────────────────────

/** Hide non-editable fields from the panel — image slots, image
 *  groups, and groups that are decorative (single-instance with empty
 *  schema, e.g. Brixies's `Step` element that just shows "Step 01"
 *  and is auto-numbered by the renderer). */
function isEditableField(field: WebFieldDef): boolean {
  if (field.kind === 'slot') {
    return field.type !== 'image'
  }
  // Group:
  if (isImageGroup(field)) return false
  // Palette-referenced groups are always shown (GroupEditor renders a
  // placeholder pill explaining the referenced template).
  if (field.item_template_ref) return true
  const itemSchema = Array.isArray(field.item_schema) ? field.item_schema : []
  // Decorative single-instance group with no editable slots in its
  // item_schema. Common pattern: `Step` group with empty item_schema
  // whose text is "Step 01" — handled entirely by the renderer's
  // renumberDecorativeSequences pass.
  if (itemSchema.length === 0 && field.single_instance_hint) return false
  // Group whose item_schema has no editable content at any depth.
  if (itemSchema.length === 0) {
    // Empty multi-instance — surface it so the strategist can see the
    // count but it won't have edit fields. Could hide entirely; for
    // now keep visible.
    return true
  }
  const anyEditable = itemSchema.some(f => isEditableField(f))
  return anyEditable
}

function isImageGroup(g: WebGroupDef): boolean {
  const layerLooksImage = /image|photo|picture|graphic|logo/i.test(
    `${g.layer_name ?? ''} ${g.key}`,
  )
  const itemSchema = Array.isArray(g.item_schema) ? g.item_schema : []
  if (itemSchema.length === 0) return layerLooksImage
  // Group whose only authored slot is an image.
  const editable = itemSchema.filter(f => !(f.kind === 'slot' && f.type === 'image'))
  return editable.length === 0
}

// ── Better card / cta counters ──────────────────────────────────────

function countCtas(template: WebContentTemplate, values: Record<string, unknown>): number {
  let n = 0
  for (const f of template.fields) {
    if (f.kind === 'slot' && f.type === 'cta') {
      const v = values[f.key]
      if (hasButtonContent(v)) n++
    }
    if (f.kind === 'group') {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
      if (!isCta) continue
      const items = Array.isArray(values[f.key]) ? values[f.key] as unknown[] : []
      for (const it of items) {
        if (it && typeof it === 'object' && Object.values(it).some(v => hasButtonContent(v) || isNonEmptyString(v))) n++
      }
    }
  }
  return n
}

/** A value counts as a "filled" CTA when it's either a `{label, url}`
 *  object with a non-empty label, or a plain non-empty string (the
 *  legacy text+scope=button shape, when ButtonInput hasn't migrated). */
function hasButtonContent(v: unknown): boolean {
  if (typeof v === 'string') return v.trim() !== ''
  if (v && typeof v === 'object') {
    const label = (v as { label?: unknown }).label
    if (typeof label === 'string' && label.trim() !== '') return true
  }
  return false
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

function countCards(template: WebContentTemplate, values: Record<string, unknown>): number {
  // Walk groups (and nested groups) — anything card-shaped counts.
  let n = 0
  const walk = (fields: ReadonlyArray<WebFieldDef>, vals: Record<string, unknown>) => {
    for (const f of fields) {
      if (f.kind !== 'group') continue
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
      if (isCta) continue
      const items = Array.isArray(vals[f.key]) ? vals[f.key] as Array<Record<string, unknown>> : []
      // Card-shaped or just a content-group with any text — count items
      // that have any non-empty string in them. Walk into nested groups too.
      for (const it of items) {
        if (it && typeof it === 'object'
            && Object.values(it).some(v => typeof v === 'string' && v.trim() !== '')) {
          n++
        }
        // Recurse into nested groups within the item.
        if (Array.isArray(f.item_schema)) walk(f.item_schema, it)
      }
    }
  }
  walk(template.fields, values)
  return n
}

// ── Building-block components ───────────────────────────────────────

function Section({
  title, children, defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 mb-2 text-[10px] uppercase tracking-[0.1em] font-bold text-wm-text-subtle hover:text-wm-accent-strong transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </button>
      {open && <div>{children}</div>}
    </section>
  )
}

function CounterChip({
  icon, label, count,
}: {
  icon: React.ReactNode
  label: string
  count: number
}) {
  if (count === 0) return null
  return (
    <span
      title={`${count} ${label.toLowerCase()}`}
      className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-wm-bg-hover text-wm-text-muted border border-wm-border text-[10px] font-semibold"
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </span>
  )
}

function PanelButton({
  children, icon, onClick, variant = 'secondary',
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}) {
  const styles = {
    primary:
      'bg-wm-accent text-white border-wm-accent hover:opacity-90',
    secondary:
      'bg-wm-bg-elevated text-wm-text border-wm-border hover:bg-wm-bg-hover',
    ghost:
      'bg-transparent text-wm-text-muted border-transparent hover:bg-wm-bg-hover hover:text-wm-text',
    danger:
      'bg-transparent text-wm-text-muted border-transparent hover:bg-wm-danger-bg hover:text-wm-danger',
  } as const
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11px] font-semibold transition-colors',
        styles[variant],
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  )
}

function FreehandBodyField({
  value, onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={6}
      placeholder="Write the body copy for this freehand section. Bind it to a template later to flow into design."
      className="w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 text-[13px] resize-y transition-colors"
    />
  )
}

// ── Review comments block ─────────────────────────────────────────

/** Lives at the bottom of the panel body. Shows open comments on the
 *  current section (if any) + a small "Add note" entry point that
 *  creates a new comment row tied to the active internal review.
 *  Resolution actions (Apply / Amend / Dismiss) ship in Phase E. */
function ReviewCommentsBlock({
  section, template, activeInternalReview, sectionComments, reviewsById, onCommentsChange,
}: {
  section: WebSection
  template: WebContentTemplate | null
  activeInternalReview: WebReview | null
  sectionComments: WebReviewComment[]
  reviewsById: Record<string, WebReview>
  onCommentsChange: () => Promise<void>
}) {
  // Open the comment form by default when an internal review is
  // active — saves the strategist from hunting for "Add note" each
  // time they pick a section.
  const [open, setOpen] = useState<boolean>(!!activeInternalReview)
  const [kind, setKind] = useState<'comment' | 'suggested'>('comment')
  const [fieldKey, setFieldKey] = useState<string>('')
  const [body, setBody] = useState('')
  const [suggested, setSuggested] = useState('')
  const [saving, setSaving] = useState(false)

  const fieldChoices = (template?.fields ?? []).filter(
    (f): f is WebFieldDef & { kind: 'slot' } => f.kind === 'slot' && f.type !== 'image',
  )

  const reset = () => {
    setOpen(false); setKind('comment'); setFieldKey(''); setBody(''); setSuggested('')
  }

  const submit = async () => {
    if (!activeInternalReview) return
    if (!body.trim() && !suggested.trim()) return

    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const values = (section.field_values ?? {}) as Record<string, unknown>

    // Snapshot the staff name onto the row so we don't have to do a
    // user_id → employees join every time we render the inbox.
    // Looks up the employees row by the auth email; falls back to the
    // email itself if we don't find a match (rare — domain-gated auth).
    let staffName: string | null = null
    const email = user?.user?.email ?? null
    if (email) {
      const { data: emp } = await supabase
        .from('employees')
        .select('full_name, name, first_name')
        .ilike('email', email)
        .limit(1)
        .maybeSingle()
      const e = emp as { full_name?: string | null; name?: string | null; first_name?: string | null } | null
      staffName = e?.full_name?.trim() || e?.name?.trim() || e?.first_name?.trim() || email
    }

    const payload: Record<string, unknown> = {
      review_id:           activeInternalReview.id,
      web_page_id:         section.web_page_id,
      web_section_id:      section.id,
      field_key:           fieldKey || null,
      author_kind:         'staff',
      author_user_id:      user?.user?.id ?? null,
      author_external_name: staffName,
      kind:                kind === 'suggested' && fieldKey ? 'suggested' : 'comment',
      body:                body.trim() || null,
    }
    if (kind === 'suggested' && fieldKey) {
      payload.original_value  = values[fieldKey] ?? null
      payload.suggested_value = suggested
    }

    const { error } = await supabase
      .from('web_review_comments')
      .insert(payload as never)
    setSaving(false)
    if (error) {
      console.error('[reviews] insert comment failed:', error.message)
      return
    }
    // Clear the fields but keep the form open so the strategist can
    // immediately add another comment without re-clicking "Add note".
    setKind('comment'); setFieldKey(''); setBody(''); setSuggested('')
    await onCommentsChange()
  }

  return (
    <Section title="Review comments" defaultOpen>
      {/* Existing comments — rendered as the new FeedbackCard so the
          section panel matches the rail's feedback tab visually. */}
      {sectionComments.length === 0 ? (
        <p className="text-[11px] text-wm-text-subtle italic mb-2">
          No comments on this section yet.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {sectionComments.map(c => {
            const r = reviewsById[c.review_id]
            return (
              <FeedbackCard
                key={c.id}
                comment={c}
                reviewKind={r?.kind ?? 'internal'}
                roundNumber={r?.round_number ?? 1}
                pageName={null}
                sectionLabel={null}
                sectionFieldValues={(section.field_values ?? {}) as Record<string, unknown>}
                onChanged={onCommentsChange}
              />
            )
          })}
        </div>
      )}

      {/* Entry point */}
      {!activeInternalReview ? (
        <p className="text-[11px] text-wm-text-subtle italic">
          Start an internal review (in the Review tab) to add comments + suggested edits here.
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-wm-border bg-wm-bg-elevated text-[11px] font-semibold text-wm-text hover:border-wm-accent hover:text-wm-accent-strong transition-colors"
        >
          <MessageSquarePlus size={11} /> Add note
        </button>
      ) : (
        <div className="rounded-md border border-wm-accent/40 bg-wm-bg-elevated p-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'comment'}
                onChange={() => setKind('comment')}
                className="accent-wm-accent"
              />
              <span className="text-wm-text">Comment</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={kind === 'suggested'}
                onChange={() => setKind('suggested')}
                className="accent-wm-accent"
              />
              <span className="text-wm-text">Suggest edit</span>
            </label>
          </div>

          {kind === 'suggested' && (
            <>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Field</span>
                <select
                  value={fieldKey}
                  onChange={(e) => setFieldKey(e.target.value)}
                  className="mt-0.5 w-full text-[12px] px-2 py-1 rounded border border-wm-border bg-wm-bg focus:border-wm-accent focus:outline-none"
                >
                  <option value="">— Pick a field —</option>
                  {fieldChoices.map(f => (
                    <option key={f.key} value={f.key}>{f.layer_name ?? f.key}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Suggested value</span>
                <textarea
                  value={suggested}
                  onChange={(e) => setSuggested(e.target.value)}
                  rows={2}
                  className="mt-0.5 w-full text-[12px] px-2 py-1 rounded border border-wm-border bg-wm-bg focus:border-wm-accent focus:outline-none resize-y"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
              {kind === 'suggested' ? 'Why (optional)' : 'Note'}
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder={kind === 'suggested'
                ? 'Context for the suggestion (optional)…'
                : 'Drop a note for review…'}
              className="mt-0.5 w-full text-[12px] px-2 py-1 rounded border border-wm-border bg-wm-bg focus:border-wm-accent focus:outline-none resize-y"
            />
          </label>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={reset}
              className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || (!body.trim() && !suggested.trim()) || (kind === 'suggested' && !fieldKey)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-wm-accent text-wm-text-on-accent text-[11px] font-semibold hover:bg-wm-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

function KindTag({ kind }: { kind: WebReviewComment['kind'] }) {
  const colors: Record<WebReviewComment['kind'], string> = {
    comment:   'bg-wm-bg-hover text-wm-text-muted',
    suggested: 'bg-wm-accent-tint text-wm-accent-strong',
    requested: 'bg-wm-warn-bg text-wm-warn',
  }
  const labels: Record<WebReviewComment['kind'], string> = {
    comment:   'Comment',
    suggested: 'Suggested',
    requested: 'Requested',
  }
  return (
    <span className={`inline-flex items-center px-1 rounded font-bold ${colors[kind]}`}>
      {labels[kind]}
    </span>
  )
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return iso }
}

function stringifyVal(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.slice(0, 140)
  if (typeof v === 'object' && v !== null) {
    const obj = v as { label?: unknown; url?: unknown }
    if (typeof obj.label === 'string') {
      return obj.url ? `${obj.label} — ${String(obj.url)}` : obj.label
    }
    try { return JSON.stringify(v).slice(0, 140) } catch { return String(v) }
  }
  return String(v)
}

/** Render a single __unmapped value. Strings render as-is (with HTML
 *  stripped for safety). Arrays / `{items: [...]}` render every item
 *  with every field exposed so the strategist can see exactly what
 *  they're moving — not a 3-line summary. */
function UnmappedValuePreview({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    const clean = value.replace(/<[^>]+>/g, '').trim()
    return <p className="text-[12px] text-wm-text leading-snug whitespace-pre-wrap">{clean}</p>
  }
  const items = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && 'items' in (value as Record<string, unknown>)
        && Array.isArray((value as { items: unknown }).items)
        ? (value as { items: unknown[] }).items
        : null)
  if (items) {
    // Show full structure — every item with every field — so the user
    // makes informed mapping decisions. Shared keys surface in a
    // compact header so the user knows what shape the items take.
    const sharedKeys: string[] = []
    for (const it of items) {
      if (it && typeof it === 'object' && !Array.isArray(it)) {
        for (const k of Object.keys(it as Record<string, unknown>)) {
          if (!sharedKeys.includes(k)) sharedKeys.push(k)
        }
      }
    }
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] text-wm-text-muted">
          {items.length} item{items.length === 1 ? '' : 's'}
          {sharedKeys.length > 0 && (
            <span> · each has <span className="font-mono">{sharedKeys.join(', ')}</span></span>
          )}
        </p>
        <ol className="space-y-1.5 pl-3 list-decimal text-[11px]">
          {items.map((item, i) => (
            <li key={i} className="text-wm-text leading-snug">
              {item && typeof item === 'object' && !Array.isArray(item) ? (
                <div className="space-y-0.5">
                  {Object.entries(item as Record<string, unknown>).map(([k, v]) => {
                    const str = typeof v === 'string'
                      ? v
                      : typeof v === 'number' || typeof v === 'boolean'
                        ? String(v)
                        : JSON.stringify(v).slice(0, 80)
                    return (
                      <div key={k}>
                        <span className="text-[10px] font-mono text-wm-text-subtle uppercase tracking-wider mr-1.5">{k}</span>
                        <span className="text-wm-text">{str}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                String(item)
              )}
            </li>
          ))}
        </ol>
      </div>
    )
  }
  if (value && typeof value === 'object') {
    const obj = value as { label?: unknown; url?: unknown }
    if (typeof obj.label === 'string' || typeof obj.url === 'string') {
      const label = typeof obj.label === 'string' ? obj.label : ''
      const url   = typeof obj.url === 'string' ? obj.url : ''
      return (
        <p className="text-[12px] text-wm-text leading-snug">
          {label}{label && url ? ' — ' : ''}
          {url && <code className="text-[10px] text-wm-text-subtle font-mono">{url}</code>}
        </p>
      )
    }
  }
  return <p className="text-[11px] font-mono text-wm-text-muted">{stringifyVal(value)}</p>
}

function renderItemPreview(item: Record<string, unknown>): string {
  // Prefer a heading-shaped key if present.
  for (const [k, v] of Object.entries(item)) {
    const ck = k.toLowerCase().replace(/[_\s-]+/g, '')
    if ((ck.includes('heading') || ck.includes('title') || ck.includes('name') || ck === 'label') && typeof v === 'string' && v.trim()) {
      return v
    }
  }
  // Else first non-empty string.
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && v.trim()) return v.slice(0, 100)
  }
  try { return JSON.stringify(item).slice(0, 100) } catch { return '' }
}

/** A group of placement options in the dropdown — either the
 *  structurally-aligned "Recommended" set or the text-stuffing
 *  fallbacks. Each option renders its target slot label + emptiness
 *  state + a one-line preview of what would actually land. */
function PlacementGroup({
  title, badge, items, value, onPick,
}: {
  title: string
  badge?: string
  items: Placement[]
  value: unknown
  onPick: (p: Placement) => void
}) {
  return (
    <div>
      <div className="px-3 pt-2 pb-1 flex items-center gap-2 bg-wm-bg-hover/40">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-muted">{title}</p>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-wm-accent text-white text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5">
            {badge}
          </span>
        )}
      </div>
      <ul className="divide-y divide-wm-border">
        {items.map((p, i) => {
          const preview = previewConversion(value, p)
          return (
            <li key={`${p.slot_path.join('.')}-${i}`}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left px-3 py-2 hover:bg-wm-bg-hover transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-[12px] font-semibold text-wm-text">{p.slot_label}</span>
                  <span className={`text-[10px] shrink-0 ${p.is_empty ? 'text-wm-text-subtle' : 'text-wm-warning'}`}>
                    {p.is_empty ? 'empty' : 'has content'}
                  </span>
                </div>
                {p.conversion_note && (
                  <p className="text-[10px] text-wm-text-muted mb-1">{p.conversion_note}</p>
                )}
                {preview && (
                  <div className="rounded bg-wm-bg-hover/60 px-2 py-1 mt-1">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">Will land as</p>
                    <p className="text-[11px] text-wm-text leading-snug">{preview}</p>
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** One row in the Unmapped Content panel: preview of the leftover
 *  value + a "Move to →" dropdown listing every viable slot the
 *  current template can accept this value into (after a shape
 *  conversion). Picking an option applies the conversion immediately.
 *
 *  Aggressive Layer-1 auto-mapping at bind time already places most
 *  unmapped keys; what survives to this row is the truly-ambiguous
 *  remainder (multiple equally-good fits, edge shapes, etc.). */
function UnmappedEntryRow({
  sourceKey, value, template, fieldValues, paletteTemplates, onPlace,
}: {
  sourceKey:        string
  value:            unknown
  template:         WebContentTemplate
  fieldValues:      Record<string, unknown>
  paletteTemplates: Record<string, WebContentTemplate>
  onPlace:          (p: Placement) => void
}) {
  const [open, setOpen] = useState(false)
  const placements = open
    ? findPlacements(sourceKey, value, template, fieldValues, paletteTemplates)
    : []
  // Close on Escape + on outside click — modal-style dismiss so the
  // user doesn't get stuck with an absolute-positioned dropdown
  // hanging over the panel.
  const rootRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <li ref={rootRef} className="rounded border border-wm-border bg-wm-bg-elevated p-2 space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle font-mono mb-1">{sourceKey}</p>
        <UnmappedValuePreview value={value} />
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 rounded-md bg-wm-accent text-white text-[11px] font-semibold px-2.5 py-1 hover:bg-wm-accent-hover transition-colors"
        >
          Move to →
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {open && (
          // Absolute so the dropdown floats above the panel's scroll
          // container — inline positioning was getting clipped at
          // viewport bottom. High z-index to clear the rail header.
          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg max-h-[28rem] overflow-y-auto">
            {placements.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-wm-text-muted">
                No editable slot accepts this shape. Try swapping the
                template variant via the header — every other layout in
                the catalog will rescore for this content.
              </p>
            ) : (() => {
              const structured = placements.filter(isStructuredPlacement)
              const fallback   = placements.filter(p => !isStructuredPlacement(p))
              return (
                <div>
                  {structured.length > 0 && (
                    <PlacementGroup
                      title="Recommended — places the full structure"
                      badge="best fit"
                      items={structured}
                      value={value}
                      onPick={(p) => { onPlace(p); setOpen(false) }}
                    />
                  )}
                  {fallback.length > 0 && (
                    <PlacementGroup
                      title={structured.length > 0 ? 'Or stuff into a single text slot:' : 'Place into a text slot:'}
                      items={fallback}
                      value={value}
                      onPick={(p) => { onPlace(p); setOpen(false) }}
                    />
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </li>
  )
}
