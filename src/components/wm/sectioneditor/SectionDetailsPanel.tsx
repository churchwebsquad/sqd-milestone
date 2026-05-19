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
import { useState } from 'react'
import {
  X, Image as ImageIcon, LayoutGrid, MousePointerClick, FormInput,
  ChevronDown, ChevronRight, RotateCw, Archive, Trash2,
} from 'lucide-react'
import { SlotEditor } from './SlotEditor'
import { GroupEditor } from './GroupEditor'
import { SnippetMenu } from './SnippetMenu'
import { summarizeSlotPresence } from '../../../lib/webBrixiesLayoutParser'
import type { WMSnippetOption } from '../RichTextEditor'
import type {
  WebContentTemplate, WebSection, WebFieldDef,
} from '../../../types/database'

interface Props {
  section: WebSection
  template: WebContentTemplate | null
  snippets: readonly WMSnippetOption[]
  onChange: (patch: Partial<WebSection>) => void
  onClose: () => void
  onChangeVariant: () => void
  onUnbind: () => void
  onRemove: () => void
}

export function SectionDetailsPanel({
  section, template, snippets,
  onChange, onClose, onChangeVariant, onUnbind, onRemove,
}: Props) {
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const meta = parseSectionMeta(section.notes)
  const setMeta = (next: Partial<typeof meta>) => {
    onChange({ notes: stringifySectionMeta({ ...meta, ...next }) })
  }
  const setValue = (key: string, v: unknown) => {
    onChange({ field_values: { ...values, [key]: v } })
  }

  const presence = template ? summarizeSlotPresence(template, values) : null
  const fields: WebFieldDef[] = template?.fields ?? []
  const visibleFields = fields.filter(isEditableField)

  return (
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
        {/* Section name */}
        <Section title="Section name">
          <input
            type="text"
            value={meta.name}
            onChange={e => setMeta({ name: e.target.value })}
            placeholder={template?.layer_name ?? 'Untitled section'}
            className="w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 text-[13px] font-semibold transition-colors"
          />
        </Section>

        {/* Field editors */}
        {template && visibleFields.length > 0 && (
          <Section title="Fields" defaultOpen>
            <div className="space-y-3">
              {visibleFields.map((field, idx) => (
                field.kind === 'slot' ? (
                  <SlotEditor
                    key={field.key + '-' + idx}
                    slot={field}
                    value={values[field.key]}
                    onChange={(v) => setValue(field.key, v)}
                    snippets={snippets}
                  />
                ) : (
                  <GroupEditor
                    key={field.key + '-' + idx}
                    group={field}
                    value={values[field.key]}
                    onChange={(v) => setValue(field.key, v)}
                    snippets={snippets}
                  />
                )
              ))}
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
  )
}

// ── Visibility rules ────────────────────────────────────────────────

/** Hide image slots in the panel — at this stage we just count them
 *  (rendered by the counter chips below). Image upload happens later. */
function isEditableField(field: WebFieldDef): boolean {
  if (field.kind === 'slot' && field.type === 'image') return false
  return true
}

// ── Better card / cta counters ──────────────────────────────────────

function countCtas(template: WebContentTemplate, values: Record<string, unknown>): number {
  let n = 0
  for (const f of template.fields) {
    if (f.kind === 'slot' && f.type === 'cta') {
      const v = values[f.key]
      if (v && typeof v === 'object'
          && typeof (v as { label?: unknown }).label === 'string'
          && (v as { label: string }).label.trim() !== '') n++
    }
    if (f.kind === 'group') {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      const isCta = c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')
      if (!isCta) continue
      const items = Array.isArray(values[f.key]) ? values[f.key] as unknown[] : []
      for (const it of items) {
        if (it && typeof it === 'object'
            && Object.values(it).some(v => typeof v === 'string' && v.trim() !== '')) n++
      }
    }
  }
  return n
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
        walk(f.item_schema, it)
      }
    }
  }
  walk(template.fields, values)
  return n
}

// ── Section name / description JSON encoding in `notes` ─────────────

interface SectionMeta {
  name: string
  description: string
  legacy?: string
}

function parseSectionMeta(raw: string | null | undefined): SectionMeta {
  if (!raw) return { name: '', description: '' }
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) {
        return {
          name: typeof parsed.name === 'string' ? parsed.name : '',
          description: typeof parsed.description === 'string' ? parsed.description : '',
          legacy: typeof parsed.legacy === 'string' ? parsed.legacy : undefined,
        }
      }
    } catch { /* fall through */ }
  }
  return { name: '', description: '', legacy: raw }
}

function stringifySectionMeta(meta: SectionMeta): string {
  const obj: Record<string, string> = {}
  if (meta.name) obj.name = meta.name
  if (meta.description) obj.description = meta.description
  if (meta.legacy) obj.legacy = meta.legacy
  if (Object.keys(obj).length === 0) return ''
  return JSON.stringify(obj)
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
