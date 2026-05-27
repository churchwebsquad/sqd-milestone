/**
 * Per-slot editor for the section details panel.
 *
 * Slot types:
 *   text · url · email · phone · datetime → single-line input
 *   text with scope='button' / cta type   → label + URL combo (button)
 *   richtext                              → WMRichTextEditor (B/I/Link/Lists)
 *   image                                 → hidden (counted via panel chip)
 *   boolean                               → checkbox
 *   form-input                            → control type select
 */
import { useRef } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import { Link2, AlertTriangle } from 'lucide-react'
import { WMRichTextEditor } from '../RichTextEditor'
import type { WMSnippetOption } from '../RichTextEditor'
import { SnippetMenu } from './SnippetMenu'
import { useSnippetFocus } from './SnippetFocusContext'
import { useProjectPages } from './ProjectPagesContext'
import {
  normalizeCtaValue, defaultTargetFor, validateCta, CTA_KIND_LABELS,
  isButtonShapedSlot,
} from '../../../lib/cta'
import type { WebSlotDef, CtaKind, CtaValue } from '../../../types/database'

interface Props {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  depth?: number
}

export function SlotEditor({ slot, value, onChange, snippets, depth = 0 }: Props) {
  // Image slots aren't editable in v4 — the count appears in the
  // panel's bottom "Contents" chip.
  if (slot.type === 'image') return null

  const labelKind = kindOf(slot)
  const wantsSnippetMenu = slot.type === 'text' || slot.type === 'richtext'
    || slot.type === 'url' || slot.type === 'email'
  const isButton = isButtonShaped(slot)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 min-h-[20px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <SlotLabel slot={slot} tone={labelKind} />
          {slot.required && <span className="text-[10px] text-wm-danger font-semibold">required</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {slot.max_chars && typeof value === 'string' && (
            <CharCounter used={value.length} max={slot.max_chars} />
          )}
          {wantsSnippetMenu && !isButton && snippets.length > 0 && (
            <SnippetMenu snippets={snippets} slotKey={slot.key} compact />
          )}
        </div>
      </div>
      <SlotInput slot={slot} value={value} onChange={onChange} snippets={snippets} depth={depth} isButton={isButton} />
    </div>
  )
}

// ── Body dispatch ───────────────────────────────────────────────────

function SlotInput({
  slot, value, onChange, snippets, depth, isButton,
}: Props & { isButton: boolean }) {
  if (isButton) {
    return <ButtonInput slot={slot} value={value} onChange={onChange} />
  }
  switch (slot.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return <TextInput slot={slot} value={value} onChange={onChange} />
    case 'datetime':
      return <DateTimeInput value={value} onChange={onChange} />
    case 'richtext':
      return <RichTextInput slot={slot} value={value} onChange={onChange} snippets={snippets} depth={depth ?? 0} />
    case 'cta':
      return <ButtonInput slot={slot} value={value} onChange={onChange} />
    case 'boolean':
      return <BooleanInput slot={slot} value={value} onChange={onChange} />
    case 'form-input':
      return <FormInputInput value={value} onChange={onChange} />
    default:
      return <TextInput slot={slot} value={value} onChange={onChange} />
  }
}

// ── Inputs ──────────────────────────────────────────────────────────

function TextInput({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const focus = useSnippetFocus()
  const stringVal = typeof value === 'string' ? value : ''
  const inputType = slot.type === 'url' ? 'url'
    : slot.type === 'email' ? 'email'
    : slot.type === 'phone' ? 'tel'
    : 'text'
  const isHeading = slot.heading_level === 1
  const isSubhead = slot.heading_level === 2 || slot.heading_level === 3
  return (
    <input
      type={inputType}
      value={stringVal}
      maxLength={slot.max_chars}
      onChange={e => onChange(e.target.value)}
      onFocus={e => focus.registerInput(slot.key, e.currentTarget)}
      onBlur={() => focus.clear(slot.key)}
      placeholder={slot.description ?? slot.default_value ?? ''}
      className={[
        'w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none',
        'focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors',
        isHeading ? 'text-[16px] font-bold leading-tight'
          : isSubhead ? 'text-[14px] font-semibold leading-snug'
          : 'text-[13px]',
      ].join(' ')}
    />
  )
}

function DateTimeInput({
  value, onChange,
}: {
  value: unknown
  onChange: (v: unknown) => void
}) {
  const stringVal = typeof value === 'string' ? value : ''
  return (
    <input
      type="datetime-local"
      value={stringVal}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors text-[13px]"
    />
  )
}

function RichTextInput({
  slot, value, onChange, snippets, depth,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
  snippets: readonly WMSnippetOption[]
  depth: number
}) {
  const focus = useSnippetFocus()
  const editorRef = useRef<TipTapEditor | null>(null)
  const stringVal = typeof value === 'string' ? value : ''

  const handleEditorReady = (editor: TipTapEditor | null) => {
    editorRef.current = editor
    if (!editor) return
    editor.on('focus', () => focus.registerEditor(slot.key, editor))
    editor.on('blur', () => focus.clear(slot.key))
  }

  return (
    <WMRichTextEditor
      value={stringVal}
      onChange={(v) => onChange(v)}
      headingLevels={[2, 3, 4]}
      placeholder={slot.description ?? 'Write…'}
      compact={depth > 0}
      snippets={snippets}
      onEditorReady={handleEditorReady}
    />
  )
}

/** Button-shaped slot — renders a label + kind + URL combo regardless
 *  of whether the underlying slot is `type='cta'` or
 *  `type='text scope=button'`. Value shape: `CtaValue` (see types).
 *
 *  Back-compat: legacy `{ label, url }` or bare-string values get
 *  normalized on read and silently upgraded on the first edit. The
 *  kind picker switches the URL input between:
 *    · internal_route → dropdown of project page slugs (Phase B)
 *    · external_url   → http(s) text input
 *    · anchor         → #id text input
 *    · mailto / tel   → text input with the right scheme prefix
 *  An inline validation chip surfaces broken internal routes /
 *  malformed external URLs so staff catches them at authoring time. */
function ButtonInput({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const focus = useSnippetFocus()
  const pages = useProjectPages()
  const cta = normalizeCtaValue(value)
  const slugSet = new Set<string>(pages.map(p => p.slug))
  const validationError = validateCta(cta, slugSet)

  const patch = (partial: Partial<CtaValue>) => {
    const next: CtaValue = { ...cta, ...partial }
    // When the user changes kind, prep a sensible default URL prefix
    // + default target so the field doesn't feel mismatched.
    if (partial.kind && partial.kind !== cta.kind) {
      if (partial.kind === 'anchor' && !next.url.startsWith('#')) next.url = ''
      if (partial.kind === 'mailto' && !next.url.startsWith('mailto:')) next.url = 'mailto:'
      if (partial.kind === 'tel'    && !next.url.startsWith('tel:'))    next.url = 'tel:'
      if (partial.kind === 'external_url' && !/^https?:\/\//i.test(next.url)) next.url = ''
      if (partial.kind === 'internal_route' && /^https?:\/\//i.test(next.url)) next.url = ''
      if (partial.kind === 'snippet' && !/\{\{\s*[\w.]+\s*\}\}/.test(next.url)) next.url = ''
      // Reset target so the inferred default applies.
      next.target = defaultTargetFor(next.kind)
    }
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={cta.label}
        maxLength={slot.max_chars}
        onChange={e => patch({ label: e.target.value })}
        onFocus={e => focus.registerInput(slot.key + ':label', e.currentTarget)}
        onBlur={() => focus.clear(slot.key + ':label')}
        placeholder="Button label"
        className="w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors text-[13px] font-semibold"
      />
      <div className="flex items-center gap-1.5">
        <select
          value={cta.kind}
          onChange={e => patch({ kind: e.target.value as CtaKind })}
          className="bg-wm-bg-elevated text-wm-text px-2 py-1.5 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 text-[11px] shrink-0"
          aria-label="Link type"
        >
          {(Object.keys(CTA_KIND_LABELS) as CtaKind[]).map(k => (
            <option key={k} value={k}>{CTA_KIND_LABELS[k]}</option>
          ))}
        </select>
        {/* Target toggle — _self is the default for in-site stuff,
            _blank is the default for external. Staff can override. */}
        <label
          className="inline-flex items-center gap-1 text-[10px] text-wm-text-muted cursor-pointer ml-auto select-none"
          title="Open in a new tab"
        >
          <input
            type="checkbox"
            checked={(cta.target ?? defaultTargetFor(cta.kind)) === '_blank'}
            onChange={e => patch({ target: e.target.checked ? '_blank' : '_self' })}
            className="h-3 w-3 rounded border-wm-border text-wm-accent focus:ring-wm-accent"
          />
          New tab
        </label>
      </div>
      <CtaUrlInput cta={cta} pages={pages} onChange={(url) => patch({ url })} />
      {validationError && (
        <div className="inline-flex items-start gap-1 text-[10px] text-wm-warn">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          <span className="leading-snug">{validationError}</span>
        </div>
      )}
    </div>
  )
}

/** Kind-specific URL input. Internal routes get a project-page
 *  dropdown so strategists can't typo a slug; everything else gets
 *  a typed text input with the right scheme placeholder. */
function CtaUrlInput({
  cta, pages, onChange,
}: {
  cta: CtaValue
  pages: ReadonlyArray<{ id: string; name: string; slug: string }>
  onChange: (url: string) => void
}) {
  if (cta.kind === 'internal_route') {
    const currentSlug = cta.url.replace(/^\/+/, '').split(/[?#]/)[0]
    return (
      <div className="relative">
        <Link2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wm-text-subtle pointer-events-none z-10" />
        <select
          value={currentSlug}
          onChange={e => onChange(e.target.value ? `/${e.target.value}` : '')}
          className="w-full bg-wm-bg-elevated text-wm-text pl-7 pr-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors text-[12px] font-mono"
        >
          <option value="">— Pick a page —</option>
          {pages.map(p => (
            <option key={p.id} value={p.slug}>/{p.slug} · {p.name}</option>
          ))}
          {currentSlug && !pages.some(p => p.slug === currentSlug) && (
            <option value={currentSlug}>/{currentSlug} (unmatched)</option>
          )}
        </select>
      </div>
    )
  }
  const placeholder =
    cta.kind === 'external_url' ? 'https://example.com' :
    cta.kind === 'anchor'       ? '#section-id' :
    cta.kind === 'mailto'       ? 'mailto:hello@example.com' :
    cta.kind === 'tel'          ? 'tel:+15555551234' :
    cta.kind === 'snippet'      ? '{{directions_url}}' :
    ''
  return (
    <div className="relative">
      <Link2 size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-wm-text-subtle pointer-events-none" />
      <input
        type="text"
        value={cta.url}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-wm-bg-elevated text-wm-text pl-7 pr-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors text-[12px] font-mono text-wm-text-muted"
      />
    </div>
  )
}

function BooleanInput({
  slot, value, onChange,
}: {
  slot: WebSlotDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value === true}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-wm-border text-wm-accent focus:ring-wm-accent"
      />
      <span className="text-[13px] text-wm-text">
        {slot.description ?? slot.label ?? slot.key.replace(/_/g, ' ')}
      </span>
    </label>
  )
}

function FormInputInput({
  value, onChange,
}: {
  value: unknown
  onChange: (v: unknown) => void
}) {
  const stringVal = typeof value === 'string' ? value : ''
  return (
    <select
      value={stringVal}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-wm-bg-elevated text-wm-text px-3 py-2 rounded-md border border-wm-border outline-none focus:border-wm-accent focus:ring-2 focus:ring-wm-accent/15 transition-colors text-[13px]"
    >
      <option value="">Pick a control type…</option>
      <option value="text">Text</option>
      <option value="select">Select</option>
      <option value="checkbox">Checkbox</option>
      <option value="email">Email</option>
      <option value="tel">Phone</option>
    </select>
  )
}

// ── Label + helpers ─────────────────────────────────────────────────

type SlotKind = 'heading' | 'subhead' | 'body' | 'cta' | 'tagline' | 'other'

function kindOf(slot: WebSlotDef): SlotKind {
  if (slot.heading_level === 1) return 'heading'
  if (slot.heading_level && slot.heading_level >= 2) return 'subhead'
  const k = slot.key.toLowerCase().replace(/[_\s-]+/g, '')
  if (k.includes('tagline') || k.includes('eyebrow') || k.includes('kicker')) return 'tagline'
  if (slot.type === 'cta' || slot.scope === 'button') return 'cta'
  if (slot.type === 'richtext' || k.includes('body') || k.includes('description') || k.includes('content')) return 'body'
  return 'other'
}

// Delegates to the shared classifier in src/lib/cta.ts so every
// surface (slot editor + dev handoff inventory) treats the same set
// of slots as button-shaped.
const isButtonShaped = isButtonShapedSlot

const TONES: Record<SlotKind, string> = {
  heading:  'text-wm-accent-strong',
  subhead:  'text-wm-accent-strong',
  tagline:  'text-wm-text-muted',
  body:     'text-wm-text-muted',
  cta:      'text-emerald-700',
  other:    'text-wm-text-muted',
}

function SlotLabel({ slot, tone }: { slot: WebSlotDef; tone: SlotKind }) {
  const base = slot.label ?? slot.key.replace(/_/g, ' ')
  let display = base
  if (slot.heading_level) display = `H${slot.heading_level} · ${display}`
  return (
    <span className={[
      'text-[10px] uppercase tracking-[0.08em] font-bold truncate',
      TONES[tone],
    ].join(' ')}>
      {display}
    </span>
  )
}

function CharCounter({ used, max }: { used: number; max: number }) {
  const over = used > max
  const warn = used > max * 0.85
  return (
    <span className={[
      'text-[10px] font-mono tabular-nums',
      over ? 'text-wm-danger font-semibold' : warn ? 'text-wm-warning' : 'text-wm-text-subtle',
    ].join(' ')}>
      {used}/{max}
    </span>
  )
}
