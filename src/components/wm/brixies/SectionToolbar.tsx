/**
 * Section toolbar — Brixies-block inserts.
 *
 * v3:
 *   - CTA and Card buttons are ALWAYS enabled. When the template has
 *     a matching slot/group, the click appends to it. When it
 *     doesn't, the click appends to field_values.__extra_ctas /
 *     __extra_cards (freehand extras, rendered in the canvas's
 *     Extras zone with a warning border).
 *   - Snippet picker routes via the SnippetFocusContext — inserts
 *     into whichever slot is focused (TipTap chip for richtext,
 *     {{token}} literal for text inputs).
 *   - Tagline still gates on the template having a tagline slot.
 *   - Image is informational only (count popover).
 */
import { useState } from 'react'
import {
  Tag, MousePointerClick, LayoutGrid, Image as ImageIcon, Braces,
} from 'lucide-react'
import { useSnippetFocus } from './SnippetFocusContext'
import type { WebContentTemplate, WebFieldDef, WebGroupDef, WebSlotDef } from '../../../types/database'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  snippets?: readonly WMSnippetOption[]
}

export function SectionToolbar({ template, values, onChange, snippets }: Props) {
  const focus = useSnippetFocus()
  const taglineSlot = findSlot(template.fields, isTaglineSlot)
  const ctaTarget = findCtaTarget(template.fields)
  const cardGroup = findGroup(template.fields, isCardShapedGroup)
  const imageInfo = countImageSlots(template.fields, values)

  const handleTagline = () => {
    if (!taglineSlot) return
    if (!values[taglineSlot.key]) onChange({ ...values, [taglineSlot.key]: 'Tagline' })
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-bx-slot-key="${taglineSlot.key}"]`) as HTMLElement | null
      el?.focus()
    })
  }

  const handleCta = () => {
    if (ctaTarget?.kind === 'slot') {
      // Top-level cta slot — fill if empty.
      const existing = values[ctaTarget.field.key]
      if (!existing || typeof existing !== 'object') {
        onChange({ ...values, [ctaTarget.field.key]: { label: 'Button label', url: '/' } })
      }
      return
    }
    if (ctaTarget?.kind === 'group') {
      const arr = Array.isArray(values[ctaTarget.field.key])
        ? [...(values[ctaTarget.field.key] as Array<Record<string, unknown>>)]
        : []
      const ctaSlot = ctaTarget.field.item_schema.find((f): f is WebSlotDef =>
        f.kind === 'slot' && f.type === 'cta')
      const labelSlot = ctaTarget.field.item_schema.find((f): f is WebSlotDef =>
        f.kind === 'slot' && f.type === 'text'
        && (f.scope === 'button' || /button|cta/i.test(f.label ?? '') || /button/i.test(f.layer_name ?? '')))
      const newItem: Record<string, unknown> = {}
      if (ctaSlot) newItem[ctaSlot.key] = { label: 'Button label', url: '/' }
      else if (labelSlot) { newItem[labelSlot.key] = 'Button label'; newItem.__cta_url = '/' }
      arr.push(newItem)
      onChange({ ...values, [ctaTarget.field.key]: arr })
      return
    }
    // No native CTA slot — append to __extra_ctas.
    const arr = Array.isArray(values.__extra_ctas)
      ? [...(values.__extra_ctas as Array<{ label?: string; url?: string }>)]
      : []
    arr.push({ label: 'Button label', url: '/' })
    onChange({ ...values, __extra_ctas: arr })
  }

  const handleCard = () => {
    if (cardGroup) {
      const arr = Array.isArray(values[cardGroup.key])
        ? [...(values[cardGroup.key] as Array<Record<string, unknown>>)]
        : []
      arr.push({})
      onChange({ ...values, [cardGroup.key]: arr })
      return
    }
    // No native card group — append to __extra_cards.
    const arr = Array.isArray(values.__extra_cards)
      ? [...(values.__extra_cards as Array<Record<string, unknown>>)]
      : []
    arr.push({})
    onChange({ ...values, __extra_cards: arr })
  }

  const [imageInfoOpen, setImageInfoOpen] = useState(false)
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
        title={ctaTarget ? 'Add a CTA' : 'Add a freehand CTA (no native slot on this template)'}
        disabled={false}
        onClick={handleCta}
      />
      <ToolbarBtn
        icon={<LayoutGrid size={12} />}
        text="Card"
        title={cardGroup ? `Add a ${cardGroup.key.replace(/_/g, ' ')} item` : 'Add a freehand card (no native card group on this template)'}
        disabled={false}
        onClick={handleCard}
      />

      <div className="relative">
        <ToolbarBtn
          icon={<ImageIcon size={12} />}
          text={`Image (${imageInfo.filled}/${imageInfo.expected})`}
          title={`${imageInfo.expected} image slot${imageInfo.expected === 1 ? '' : 's'} on this template`}
          disabled={false}
          onClick={() => setImageInfoOpen(o => !o)}
        />
        {imageInfoOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setImageInfoOpen(false)} />
            <div className="absolute left-0 mt-1 w-72 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 p-3 text-[12px] text-wm-text">
              <p className="font-semibold mb-1">Images on this layout</p>
              <p className="text-wm-text-muted">
                This template expects <span className="font-semibold text-wm-text">{imageInfo.expected}</span> image
                {imageInfo.expected === 1 ? '' : 's'}.
                Currently filled: <span className="font-semibold text-wm-text">{imageInfo.filled}</span>.
              </p>
              <p className="text-wm-text-muted mt-2 text-[11px]">
                Image upload happens in the Assets step. The layout shows grey placeholders here.
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
            title="Insert a snippet token into the focused slot"
            disabled={false}
            onClick={() => setSnippetOpen(o => !o)}
          />
          {snippetOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSnippetOpen(false)} />
              <div className="absolute left-0 mt-1 w-64 max-h-72 overflow-auto rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1">
                {!focus.focused && (
                  <p className="px-3 py-1.5 text-[11px] text-wm-text-subtle italic">
                    Click into a slot first, then pick a snippet.
                  </p>
                )}
                {snippets.map(s => (
                  <button
                    key={s.token}
                    type="button"
                    disabled={!focus.focused}
                    onClick={() => {
                      focus.insertSnippet(s)
                      setSnippetOpen(false)
                    }}
                    className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-wm-bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
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
  if (c.includes('step') || c.includes('process')) return false
  return c.includes('card') || c === 'items' || c === 'features' || c === 'tiles'
    || c === 'blocks' || c === 'pillars' || c === 'tiers' || c === 'programs'
    || c === 'members' || c === 'groups' || c === 'classes' || c === 'events'
    || c === 'doctrines' || c === 'values' || c === 'list' || c === 'rows'
}
function findCtaTarget(fields: ReadonlyArray<WebFieldDef>):
  | { kind: 'slot'; field: WebSlotDef }
  | { kind: 'group'; field: WebGroupDef }
  | null
{
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
function countImageSlots(
  fields: ReadonlyArray<WebFieldDef>,
  values: Record<string, unknown>,
): { expected: number; filled: number } {
  let expected = 0
  let filled = 0
  const walk = (fs: ReadonlyArray<WebFieldDef>, vals: Record<string, unknown>) => {
    for (const f of fs) {
      if (f.kind === 'slot' && f.type === 'image') {
        expected++
        if (typeof vals[f.key] === 'string' && vals[f.key] !== '') filled++
      }
      if (f.kind === 'group') {
        const arr = Array.isArray(vals[f.key]) ? vals[f.key] as Array<Record<string, unknown>> : []
        for (const item of arr) walk(f.item_schema, item)
      }
    }
  }
  walk(fields, values)
  return { expected, filled }
}
