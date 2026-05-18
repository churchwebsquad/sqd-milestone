/**
 * Section header for the Brixies live-assembly editor.
 *
 * Replaces the form-heavy SectionBlock header. Surfaces:
 *
 *   - Bind quality dot (green / amber / neutral — same as before).
 *   - Section title + Brixies family (clickable to collapse the body).
 *   - Slot presence chips: 📷 N images · ⊞ N/M cards · ▶ N CTAs.
 *   - Length warning chip: ⚠ N slots over limit (click → popover
 *     listing which slots and by how much).
 *   - Action menu: Change template · Unbind to freehand · Remove section.
 */
import { useState } from 'react'
import {
  ChevronDown, ChevronRight, MoreHorizontal, Trash2, AlertTriangle,
  Image as ImageIcon, LayoutGrid, MousePointerClick,
} from 'lucide-react'
import { WMIconButton } from '../IconButton'
import {
  summarizeSlotPresence, findOverLimitSlots,
} from '../../../lib/webBrixiesLayoutParser'
import type { WebContentTemplate } from '../../../types/database'

interface Props {
  template: WebContentTemplate
  values: Record<string, unknown>
  open: boolean
  bindQuality: 'good' | 'partial' | 'attention'
  onToggleOpen: () => void
  onBindRequest: () => void          // Change template…
  onUnbindRequest: () => void
  onRemove: () => void
}

export function SectionHeader({
  template, values, open, bindQuality,
  onToggleOpen, onBindRequest, onUnbindRequest, onRemove,
}: Props) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [overOpen, setOverOpen] = useState(false)

  const presence = summarizeSlotPresence(template, values)
  const overLimit = findOverLimitSlots(template, values)

  // Build a one-glance slot summary string for the subtitle.
  const slotSummary = buildSlotSummary(template)

  return (
    <div className="flex items-center gap-2 mb-2 -ml-1 flex-wrap">
      <span
        className={[
          'shrink-0 w-2 h-2 rounded-full',
          bindQuality === 'good' ? 'bg-wm-success'
          : bindQuality === 'partial' ? 'bg-wm-warning'
          : 'bg-wm-text-subtle',
        ].join(' ')}
        title={
          bindQuality === 'good' ? 'Bound cleanly'
          : bindQuality === 'partial' ? 'Bound with overflow or missing slots'
          : 'Freehand — needs a template'
        }
      />
      {/* Template preview thumbnail — instant visual context. Click
          opens the Change Template panel. */}
      {template.preview_image_url ? (
        <button
          type="button"
          onClick={onBindRequest}
          className="shrink-0 h-6 w-9 rounded-sm overflow-hidden border border-wm-border bg-wm-bg hover:border-wm-accent transition-colors"
          title="Change template…"
        >
          <img
            src={template.preview_image_url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <div className="shrink-0 h-6 w-9 rounded-sm border border-wm-border bg-wm-bg-hover" />
      )}
      <button
        type="button"
        onClick={onToggleOpen}
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle hover:text-wm-accent-strong transition-colors min-w-0"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="truncate">{template.layer_name}</span>
      </button>
      <span className="text-[9px] tracking-wide text-wm-text-subtle italic">· {template.family}</span>
      {slotSummary && (
        <span className="text-[10px] text-wm-text-subtle truncate min-w-0">· {slotSummary}</span>
      )}

      {/* Slot presence chips */}
      {presence.images.expected > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-wm-bg-hover text-[10px] text-wm-text-muted">
          <ImageIcon size={10} />
          {presence.images.filled}/{presence.images.expected} images
        </span>
      )}
      {presence.cards.expected > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-wm-bg-hover text-[10px] text-wm-text-muted">
          <LayoutGrid size={10} />
          {presence.cards.filled}/{presence.cards.expected} {presence.cards.groupKey ?? 'cards'}
        </span>
      )}
      {presence.ctas.expected > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-wm-bg-hover text-[10px] text-wm-text-muted">
          <MousePointerClick size={10} />
          {presence.ctas.filled}/{presence.ctas.expected} CTAs
        </span>
      )}

      {/* Length warning chip */}
      {overLimit.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOverOpen(o => !o)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-wm-danger-bg text-[10px] font-semibold text-wm-danger border border-wm-danger/30"
            title="Slots over their max_chars limit"
          >
            <AlertTriangle size={10} />
            {overLimit.length} over limit
          </button>
          {overOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOverOpen(false)} />
              <div className="absolute left-0 mt-1 w-80 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 p-3 text-[12px]">
                <p className="font-semibold text-wm-text mb-1">Slots over the limit</p>
                <ul className="space-y-1 text-wm-text-muted">
                  {overLimit.map(o => (
                    <li key={o.path} className="flex items-center justify-between gap-2">
                      <span className="truncate">{o.label}</span>
                      <span className="font-mono text-wm-danger text-[11px]">
                        {o.used} / {o.max} (+{o.used - o.max})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity">
        <div className="relative">
          <WMIconButton
            label="Section actions"
            size="sm"
            onClick={() => setActionsOpen(o => !o)}
          >
            <MoreHorizontal size={13} />
          </WMIconButton>
          {actionsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
              <div className="absolute right-0 mt-1 w-48 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg z-20 py-1 animate-wm-slide-in-up">
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); onBindRequest() }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text hover:bg-wm-bg-hover font-semibold"
                >
                  Change template…
                </button>
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); onUnbindRequest() }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text"
                >
                  Unbind to freehand
                </button>
              </div>
            </>
          )}
        </div>
        <WMIconButton label="Remove section" size="sm" onClick={onRemove}>
          <Trash2 size={13} />
        </WMIconButton>
      </div>
    </div>
  )
}

/** Build a one-glance summary string of the template's slots + groups,
 *  e.g. "Tagline + H1 + body + 2 buttons + image · 4 cards". */
function buildSlotSummary(template: WebContentTemplate): string {
  const slots: string[] = []
  const groups: string[] = []
  for (const f of template.fields) {
    if (f.kind === 'slot') {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      if (c.includes('tagline') || c.includes('eyebrow') || c.includes('kicker')) slots.push('tagline')
      else if (f.heading_level === 1) slots.push('H1')
      else if (f.heading_level === 2) slots.push('H2')
      else if (f.heading_level && f.heading_level >= 3) slots.push(`H${f.heading_level}`)
      else if (f.type === 'richtext' || c.includes('body') || c.includes('description')) slots.push('body')
      else if (f.type === 'image') slots.push('image')
      else if (f.type === 'cta') slots.push('cta')
    } else {
      const c = f.key.toLowerCase().replace(/[_\s-]+/g, '')
      const isCta = c === 'cta' || c === 'ctas' || c.includes('button')
      const isStep = c.includes('step') || c.includes('process')
      if (isCta) groups.push(`${f.default_count} buttons`)
      else if (isStep) groups.push(`${f.default_count} steps`)
      else groups.push(`${f.default_count} ${f.key.replace(/_/g, ' ')}`)
    }
  }
  const slotPart = slots.join(' + ')
  const groupPart = groups.join(', ')
  return [slotPart, groupPart].filter(Boolean).join(' · ')
}
