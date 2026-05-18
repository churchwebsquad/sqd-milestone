/**
 * Brixies live-assembly editor.
 *
 * One unified surface that IS the rendered layout. The template's
 * `source_html` is parsed and walked into a React tree where:
 *
 *   - Each element with `data-layer="X"` matching a template slot →
 *     replaced with an inline EditableSlot inside the original wrapper.
 *   - Each element with `data-layer="X"` matching a template group →
 *     repeated N times (one per item in field_values[group.key]) by
 *     cloning the first data-layer child, with bindings into the
 *     item's slot schema. Each item gets a × delete handle on hover;
 *     a "+ Add" affordance lives at the end of the group container.
 *   - Anything else → cloned as a static element with children
 *     recursively rendered.
 *
 * Brixies's inline styles ride along — we override only the outermost
 * width and a few inner fixed pixel widths (see .bx-live-canvas CSS)
 * so the layout fits inside the editor pane.
 *
 * No TipTap document at the section level. Toolbar buttons (Tagline /
 * CTA / Card / Image / Snippet) operate on field_values directly.
 */
import React, { useMemo, useCallback } from 'react'
import {
  parseSourceHtml, buildBindingMap, findBinding, findItemBinding,
  type LayoutBindingMap,
} from '../../../lib/webBrixiesLayoutParser'
import { EditableSlot } from './EditableSlot'
import type { WebContentTemplate, WebSlotDef, WebGroupDef, WebFieldDef } from '../../../types/database'
import type { WMSnippetOption } from '../RichTextEditor'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  snippets?: readonly WMSnippetOption[]
}

export function BrixiesLayoutEditor({ template, values, onChange, snippets }: Props) {
  const root = useMemo(() => parseSourceHtml(template.source_html), [template.source_html])
  const bindingMap = useMemo(() => buildBindingMap(template.fields), [template.fields])

  // Stable update helpers — closure over `values` would re-fire on
  // every keystroke since onChange replaces values; instead read from
  // a ref pattern by going through the callback.
  const updateTopSlot = useCallback((key: string, v: unknown) => {
    onChange({ ...values, [key]: v })
  }, [values, onChange])
  const updateGroupItem = useCallback((groupKey: string, idx: number, itemKey: string, v: unknown) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    while (arr.length <= idx) arr.push({})
    arr[idx] = { ...arr[idx], [itemKey]: v }
    onChange({ ...values, [groupKey]: arr })
  }, [values, onChange])
  const removeGroupItem = useCallback((groupKey: string, idx: number) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    arr.splice(idx, 1)
    onChange({ ...values, [groupKey]: arr })
  }, [values, onChange])
  const addGroupItem = useCallback((groupKey: string) => {
    const arr = Array.isArray(values[groupKey]) ? [...(values[groupKey] as Array<Record<string, unknown>>)] : []
    arr.push({})
    onChange({ ...values, [groupKey]: arr })
  }, [values, onChange])

  if (!root) {
    return (
      <div className="rounded-md border border-wm-danger/30 bg-wm-danger-bg/40 p-3 text-[12px] text-wm-danger">
        Could not parse this template's source_html. Try Change template…
      </div>
    )
  }

  return (
    <div className="bx-live-canvas">
      {renderElement(root, {
        bindingMap,
        values,
        groupKey: null,
        itemIndex: null,
        itemSchema: null,
        updateTopSlot,
        updateGroupItem,
        removeGroupItem,
        addGroupItem,
        snippets,
      }, 'root')}
    </div>
  )
}

// ── Render context + walker ─────────────────────────────────────────

interface RenderContext {
  bindingMap: LayoutBindingMap
  /** Top-level field_values when at root; the item object when inside a group item. */
  values: Record<string, unknown>
  /** When set, we're rendering inside a group item — propagate to onChange. */
  groupKey: string | null
  itemIndex: number | null
  itemSchema: ReadonlyArray<WebFieldDef> | null
  updateTopSlot: (key: string, v: unknown) => void
  updateGroupItem: (groupKey: string, idx: number, itemKey: string, v: unknown) => void
  removeGroupItem: (groupKey: string, idx: number) => void
  addGroupItem: (groupKey: string) => void
  snippets?: readonly WMSnippetOption[]
}

function renderElement(el: Element, ctx: RenderContext, key: string): React.ReactNode {
  const layerName = el.getAttribute('data-layer')

  // Slot or group binding lookup. When we're inside an item, look up
  // against the item schema; otherwise against the top-level template
  // bindings.
  let binding:
    | { kind: 'slot'; field: WebSlotDef }
    | { kind: 'group'; field: WebGroupDef }
    | undefined

  if (layerName) {
    if (ctx.itemSchema) {
      const itemBinding = findItemBinding(ctx.bindingMap, ctx.groupKey ?? '', layerName)
      if (itemBinding) {
        binding = itemBinding.kind === 'slot'
          ? { kind: 'slot', field: itemBinding }
          : { kind: 'group', field: itemBinding }
      }
    } else {
      const topBinding = findBinding(ctx.bindingMap, layerName)
      if (topBinding) {
        binding = topBinding.kind === 'slot'
          ? { kind: 'slot', field: topBinding.field }
          : { kind: 'group', field: topBinding.field }
      }
    }
  }

  // Slot binding — wrap inner content with EditableSlot inside the
  // original Brixies wrapper element (preserves padding, color,
  // alignment from inline styles).
  if (binding?.kind === 'slot') {
    return renderWrapperWith(el, key, (
      <EditableSlot
        key="slot"
        slot={binding.field}
        value={readSlotValue(binding.field, ctx)}
        onChange={(v) => writeSlotValue(binding.field, v, ctx)}
        snippets={ctx.snippets}
      />
    ))
  }

  // Group binding — render the wrapper element with N item clones
  // inside, plus an "+ Add" affordance at the end.
  if (binding?.kind === 'group') {
    return renderGroup(el, binding.field, ctx, key)
  }

  // Static element — clone with children recursively rendered.
  return renderStatic(el, ctx, key)
}

/** Recursively render an element's children, preserving its tag + attrs. */
function renderStatic(el: Element, ctx: RenderContext, key: string): React.ReactNode {
  const tag = el.tagName.toLowerCase()
  const attrs = collectAttrs(el, key)

  // Self-closing elements (img, br, hr, etc.) have no children.
  if (VOID_ELEMENTS.has(tag)) {
    return React.createElement(tag, attrs)
  }

  const children = renderChildNodes(el, ctx)
  return React.createElement(tag, attrs, ...children)
}

/** Replace the wrapper's inner content with `inner`, preserving the
 *  wrapper's tag/attrs/styles. Used for slot bindings — the editable
 *  control lives where Brixies's text/image lived. */
function renderWrapperWith(el: Element, key: string, inner: React.ReactNode): React.ReactNode {
  const tag = el.tagName.toLowerCase()
  if (VOID_ELEMENTS.has(tag)) {
    // img + similar — render the inline inner BESIDE the void element
    // since we can't add children. Wrap in a span.
    return React.createElement('span', collectAttrs(el, key), inner)
  }
  return React.createElement(tag, collectAttrs(el, key), inner)
}

/** Render a group: locate the item-template child element, clone N
 *  times based on field_values[group.key] length, and append an
 *  "+ Add" affordance. */
function renderGroup(
  groupEl: Element,
  group: WebGroupDef,
  parentCtx: RenderContext,
  key: string,
): React.ReactNode {
  // Find the first data-layer child — that's the item template.
  const childrenArr = Array.from(groupEl.children)
  const itemTemplate = childrenArr.find(c => c.getAttribute('data-layer')) ?? childrenArr[0]
  if (!itemTemplate) {
    // No item template available — render the wrapper as static.
    return renderStatic(groupEl, parentCtx, key)
  }

  // Resolve item count from field_values; fall back to default_count
  // when empty so the strategist sees the expected shape.
  const items = Array.isArray(parentCtx.values[group.key])
    ? parentCtx.values[group.key] as Array<Record<string, unknown>>
    : []
  const count = items.length > 0 ? items.length : group.default_count

  // Build the React children: each item is a clone of the template
  // element with bindings into items[i]. Wrap in `.bx-group-item`
  // for hover-reveal × handles.
  const itemNodes: React.ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const itemValues = items[i] ?? {}
    const itemCtx: RenderContext = {
      ...parentCtx,
      values: itemValues,
      groupKey: group.key,
      itemIndex: i,
      itemSchema: group.item_schema,
    }
    itemNodes.push(
      <div key={`item-${i}`} className="bx-group-item">
        {renderElement(itemTemplate, itemCtx, `${key}-item-${i}`)}
        <button
          type="button"
          className="bx-item-remove"
          onClick={() => parentCtx.removeGroupItem(group.key, i)}
          title="Remove item"
        >×</button>
      </div>
    )
  }

  // Add affordance after items.
  itemNodes.push(
    <button
      key="add"
      type="button"
      className="bx-group-add"
      onClick={() => parentCtx.addGroupItem(group.key)}
    >+ Add {humanizeKey(group.key)}</button>
  )

  // Render the group's wrapper element with the item nodes inside.
  const tag = groupEl.tagName.toLowerCase()
  if (VOID_ELEMENTS.has(tag)) {
    return React.createElement('span', collectAttrs(groupEl, key), ...itemNodes)
  }
  return React.createElement(tag, collectAttrs(groupEl, key), ...itemNodes)
}

/** Walk the element's child nodes (text + elements) into React. */
function renderChildNodes(el: Element, ctx: RenderContext): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      out.push(renderElement(child as Element, ctx, `c${i++}`))
    } else if (child.nodeType === 3) {
      const text = child.textContent ?? ''
      if (text.trim() !== '') out.push(text)
    }
  }
  return out
}

// ── Slot value read / write ─────────────────────────────────────────

function readSlotValue(slot: WebSlotDef, ctx: RenderContext): unknown {
  return ctx.values[slot.key]
}

function writeSlotValue(slot: WebSlotDef, v: unknown, ctx: RenderContext): void {
  if (ctx.groupKey != null && ctx.itemIndex != null) {
    ctx.updateGroupItem(ctx.groupKey, ctx.itemIndex, slot.key, v)
  } else {
    ctx.updateTopSlot(slot.key, v)
  }
}

// ── DOM → React helpers ─────────────────────────────────────────────

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const RESERVED_ATTRS = new Set(['class', 'for'])
const REACT_ATTR_REMAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
}

/** Collect a DOM element's attributes into a React props object. */
function collectAttrs(el: Element, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = { key }
  for (const attr of Array.from(el.attributes)) {
    const name = RESERVED_ATTRS.has(attr.name) ? REACT_ATTR_REMAP[attr.name] : attr.name
    if (name === 'style') {
      out.style = parseInlineStyle(attr.value)
    } else {
      out[name] = attr.value
    }
  }
  return out
}

/** Parse an inline-style attribute string into a React style object. */
function parseInlineStyle(css: string): React.CSSProperties {
  const out: Record<string, string> = {}
  if (!css) return out
  for (const decl of css.split(';')) {
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    const rawKey = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (!rawKey || !value) continue
    const camelKey = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    out[camelKey] = value
  }
  return out as React.CSSProperties
}

/** Humanize a snake_case / kebab-case key for display in the "+ Add X"
 *  affordance. */
function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim()
  if (!words) return 'item'
  // Singularize basic plurals so "+ Add buttons" → "+ Add button".
  const singular = words.endsWith('s') ? words.slice(0, -1) : words
  return singular
}
