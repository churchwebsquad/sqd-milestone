/**
 * Brixies-block insert toolbar for a bound section.
 *
 * Each button operates directly on `field_values`:
 *   - Tagline — focuses the tagline slot if it exists; tooltip if not.
 *   - CTA — appends to the section's first CTA group or fills the
 *     first empty cta slot.
 *   - Card — appends to the section's first card-shaped group.
 *   - Image — informational popover; doesn't insert (image presence
 *     is template-driven).
 *   - Snippet — opens the project snippet picker; the picker inserts
 *     into the focused EditableSlot's TipTap editor (richtext slots
 *     only). Text slots accept a token via plain-text insertion.
 *
 * Buttons disable gracefully when the bound template has no matching
 * slot/group ("This template has no tagline slot").
 */
import { useState } from 'react'
import {
  Tag, MousePointerClick, LayoutGrid, Image as ImageIcon, Braces,
} from 'lucide-react'
import type { WebContentTemplate, WebFieldDef, WebGroupDef, WebSlotDef } from '../../../types/database'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  snippets?: readonly WMSnippetOption[]
}

export function SectionToolbar({ template, values, onChange, snippets }: Props) {
  const taglineSlot = findSlot(template.fields, isTaglineSlot)
  const ctaTarget = findCtaTarget(template.fields)
  const cardGroup = findGroup(template.fields, isCardShapedGroup)
  const imageCount = countImageSlots(template.fields)

  const handleTagline = () => {
    if (!taglineSlot) return
    // If tagline slot is empty, set a placeholder; otherwise scroll
    // the existing tagline into focus (handled by the editor's
    // auto-focus behavior on field render).
    if (!values[taglineSlot.key]) {
      onChange({ ...values, [taglineSlot.key]: 'Tagline' })
    }
    // Scroll to the slot — relies on data-bx-slot-key on the rendered
    // input set by EditableSlot.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-bx-slot-key="${taglineSlot.key}"]`) as HTMLElement | null
      el?.focus()
    })
  }

  const handleCta = () => {
    if (!ctaTarget) return
    if (ctaTarget.kind === 'slot') {
      // Fill the slot if empty; else no-op.
      const existing = values[ctaTarget.field.key]
      if (!existing || typeof existing !== 'object') {
        onChange({ ...values, [ctaTarget.field.key]: { label: 'Button label', url: '/' } })
      }
    } else {
      // Append to the group.
      const arr = Array.isArray(values[ctaTarget.field.key])
        ? [...(values[ctaTarget.field.key] as Array<Record<string, unknown>>)]
        : []
      // Find the cta-typed slot or button-label-text slot in item_schema.
      const ctaSlot = ctaTarget.field.item_schema.find((f): f is WebSlotDef =>
        f.kind === 'slot' && f.type === 'cta')
      const labelSlot = ctaTarget.field.item_schema.find((f): f is WebSlotDef =>
        f.kind === 'slot' && f.type === 'text'
        && (f.scope === 'button' || /button|cta/i.test(f.label ?? '') || /button/i.test(f.layer_name ?? '')))
      const newItem: Record<string, unknown> = {}
      if (ctaSlot) {
        newItem[ctaSlot.key] = { label: 'Button label', url: '/' }
      } else if (labelSlot) {
        newItem[labelSlot.key] = 'Button label'
        newItem.__cta_url = '/'
      }
      arr.push(newItem)
      onChange({ ...values, [ctaTarget.field.key]: arr })
    }
  }

  const handleCard = () => {
    if (!cardGroup) return
    const arr = Array.isArray(values[cardGroup.key])
      ? [...(values[cardGroup.key] as Array<Record<string, unknown>>)]
      : []
    arr.push({})
    onChange({ ...values, [cardGroup.key]: arr })
  }

  const [imageInfoOpen, setImageInfoOpen] = useState(false)
  const handleImage = () => setImageInfoOpen(o => !o)

  const [snippetOpen, setSnippetOpen] = useState(false)

  return (
    <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-wm-border bg-wm-bg">
      <span className="text-[9px] uppercase tracking-widest font-bold text-wm-text-subtle px-1.5 mr-1">
        Brixies blocks
      </span>

      <ToolbarBtn
        icon={<Tag size={12} />}
        text="Tagline"
        title={taglineSlot ? 'Focus the tagline slot' : 'No tagline slot on this template'}
        disabled={!taglineSlot}
        onClick={handleTagline}
      />
      <ToolbarBtn
        icon={<MousePointerClick size={12} />}
        text="CTA"
        title={ctaTarget ? 'Add a CTA' : 'No CTA slot or group on this template'}
        disabled={!ctaTarget}
        onClick={handleCta}
      />
      <ToolbarBtn
        icon={<LayoutGrid size={12} />}
        text="Card"
        title={cardGroup ? `Add a ${cardGroup.key.replace(/_/g, ' ')} item` : 'No card-shaped group on this template'}
        disabled={!cardGroup}
        onClick={handleCard}
      />
      <div className="relative">
        <ToolbarBtn
          icon={<ImageIcon size={12} />}
          text={`Image (${imageCount.filled}/${imageCount.expected})`}
          title={`${imageCount.expected} image slot${imageCount.expected === 1 ? '' : 's'} expected by this template`}
          disabled={false}
          onClick={handleImage}
        />
        {imageInfoOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setImageInfoOpen(false)} />
            <div className="absolute left-0 mt-1 w-72 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 p-3 text-[12px] text-wm-text">
              <p className="font-semibold mb-1">Images on this layout</p>
              <p className="text-wm-text-muted">
                This template expects <span className="font-semibold text-wm-text">{imageCount.expected}</span> image
                {imageCount.expected === 1 ? '' : 's'}.
                Currently filled: <span className="font-semibold text-wm-text">{imageCount.filled}</span>.
              </p>
              <p className="text-wm-text-muted mt-2 text-[11px]">
                Image upload happens in the Assets step (not yet implemented). For now the layout shows grey placeholders.
              </p>
            </div>
          </>
        )}
      </div>

      {snippets && snippets.length > 0 && (
        <div className="relative">
          <ToolbarBtn
            icon={<Braces size={12} />}
            text="Snippet"
            title="Insert a snippet token"
            disabled={false}
            onClick={() => setSnippetOpen(o => !o)}
          />
          {snippetOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSnippetOpen(false)} />
              <div className="absolute left-0 mt-1 w-64 max-h-64 overflow-auto rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1">
                {snippets.map(s => (
                  <button
                    key={s.token}
                    type="button"
                    onClick={() => {
                      // Insert the literal {{token}} at the document's
                      // active text input/textarea, or copy to clipboard
                      // as a fallback. The richtext slot's TipTap will
                      // recognize and chip-ify on the next refresh pass.
                      const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
                      const literal = `{{${s.token}}}`
                      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                        const start = active.selectionStart ?? active.value.length
                        const end = active.selectionEnd ?? active.value.length
                        active.value = active.value.slice(0, start) + literal + active.value.slice(end)
                        active.dispatchEvent(new Event('input', { bubbles: true }))
                      } else {
                        void navigator.clipboard?.writeText(literal)
                      }
                      setSnippetOpen(false)
                    }}
                    className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover"
                  >
                    <span className="font-mono text-wm-accent-strong">{`{{${s.token}}}`}</span>
                    <span className="ml-2 text-wm-text-muted truncate inline-block max-w-[140px] align-middle">
                      {s.resolvedValue}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ToolbarBtn({
  icon, text, title, disabled, onClick,
}: {
  icon: React.ReactNode
  text: string
  title: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-semibold transition-colors',
        disabled
          ? 'text-wm-text-subtle cursor-not-allowed opacity-50'
          : 'text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text',
      ].join(' ')}
    >
      {icon}
      <span>{text}</span>
    </button>
  )
}

// ── Field finders ───────────────────────────────────────────────────

function findSlot(fields: ReadonlyArray<WebFieldDef>, pred: (s: WebSlotDef) => boolean): WebSlotDef | null {
  for (const f of fields) {
    if (f.kind === 'slot' && pred(f)) return f
  }
  return null
}
function findGroup(fields: ReadonlyArray<WebFieldDef>, pred: (g: WebGroupDef) => boolean): WebGroupDef | null {
  for (const f of fields) {
    if (f.kind === 'group' && pred(f)) return f
  }
  return null
}
function isTaglineSlot(s: WebSlotDef): boolean {
  const c = s.key.toLowerCase().replace(/[_\s-]+/g, '')
  return c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')
}
function isCardShapedGroup(g: WebGroupDef): boolean {
  const c = g.key.toLowerCase().replace(/[_\s-]+/g, '')
  if (c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')) return false
  return c.includes('card') || c === 'items' || c === 'features' || c === 'tiles'
    || c === 'blocks' || c === 'pillars' || c === 'tiers' || c === 'programs'
    || c === 'members' || c === 'groups' || c === 'classes' || c === 'events'
    || c === 'steps' || c === 'doctrines' || c === 'values'
}
function findCtaTarget(fields: ReadonlyArray<WebFieldDef>):
  | { kind: 'slot'; field: WebSlotDef }
  | { kind: 'group'; field: WebGroupDef }
  | null
{
  // Prefer a CTA-shaped group; fall back to a single CTA slot.
  for (const f of fields) {
    if (f.kind !== 'group') continue
    const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
    if (c === 'cta' || c === 'ctas' || c.includes('button') || c.includes('action')) {
      return { kind: 'group', field: f }
    }
  }
  for (const f of fields) {
    if (f.kind === 'slot' && f.type === 'cta') return { kind: 'slot', field: f }
  }
  return null
}
function countImageSlots(fields: ReadonlyArray<WebFieldDef>): { expected: number; filled: number } {
  // No values param wired — the toolbar shows just the count of image
  // slots in the template; the section header has the filled count.
  let expected = 0
  const walk = (fs: ReadonlyArray<WebFieldDef>) => {
    for (const f of fs) {
      if (f.kind === 'slot' && f.type === 'image') expected++
      if (f.kind === 'group') walk(f.item_schema)
    }
  }
  walk(fields)
  return { expected, filled: 0 }
}
