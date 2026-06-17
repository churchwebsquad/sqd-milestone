/**
 * Rich Content Companion — the durable source-of-truth surface for
 * cowork-produced sections.
 *
 * WHY
 * The handoff endpoint pushes `cowork_slot_values` (uniform-shaped:
 * tagline / primary_heading / body / accent_body / items / buttons)
 * to web_sections, then derives `field_values` via the v2 translator
 * against the picked Brixies template. The strategist's editing
 * surface is THIS component — they edit the uniform slots, the
 * translator re-derives field_values, and the existing preview
 * re-renders with the new copy slotted into the Brixies layout.
 *
 * Edits never go through the Brixies field editor for cowork sections
 * — that path would lose the round-trip with cowork_slot_values + the
 * manifest's per-template binding rules. The Brixies fields ARE shown
 * (in the panel below this one) but are read-only-by-convention; the
 * source-of-truth is here.
 *
 * Three affordances per slot:
 *   1. Inline editor (text / richtext / list)
 *   2. Bind status indicator — which Brixies layer this slot maps to,
 *      green/yellow/red per cowork_section_meta.gaps[]
 *   3. Manual-bind dropdown (yellow status only) — strategist can
 *      route a uniform slot to a different Brixies slot when the
 *      auto-bind didn't fit.
 *
 * Above the slot list: template variant picker. Lists same-family
 * templates from `pickable_templates`. Click swaps content_template_id
 * + re-derives field_values (cowork_slot_values stays unchanged).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Loader2, Check, AlertTriangle, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { composeFieldValuesForBrixies, type ManifestEntry } from '../../../lib/cowork/coworkToBrixies'
import type { WebSection, WebContentTemplate, CoworkHandoffSectionMeta } from '../../../types/database'

interface Props {
  section:  WebSection
  template: WebContentTemplate | null
  /** Patch hook — same shape as SectionDetailsPanel's onChange. The
   *  parent owns persistence; we just hand back the patch. */
  onChange: (patch: Partial<WebSection>) => void
}

interface ButtonRow { label: string; url: string; kind?: 'primary' | 'secondary' }
interface ItemRow   {
  item_heading:    string
  item_body:       string
  item_meta:       string
  /** Optional per-item CTA — preserved when the picked template
   *  supports per-card buttons (e.g. cards_with_cta /
   *  feature-section-103). Cowork captures these from Notion
   *  cards-grid sections; the Companion exposes them so the
   *  strategist can add/edit URLs manually. */
  item_cta_label?: string
  item_cta_url?:   string
}

interface CoworkSlotValues {
  tagline?:         string
  primary_heading?: string
  body?:            string
  accent_body?:     string
  buttons?:         ButtonRow[]
  items?:           ItemRow[]
}

export function RichContentCompanion({ section, template, onChange }: Props) {
  const meta = (section.cowork_section_meta ?? {}) as CoworkHandoffSectionMeta | null
  const initial = (section.cowork_slot_values ?? {}) as CoworkSlotValues

  // Editable copies — local state until save commits.
  const [tagline,         setTagline]         = useState(initial.tagline ?? '')
  const [primaryHeading,  setPrimaryHeading]  = useState(initial.primary_heading ?? '')
  const [body,            setBody]            = useState(initial.body ?? '')
  const [accentBody,      setAccentBody]      = useState(initial.accent_body ?? '')
  const [items,           setItems]           = useState<ItemRow[]>(initial.items ?? [])
  const [buttons,         setButtons]         = useState<ButtonRow[]>(initial.buttons ?? [])
  const [saving,          setSaving]          = useState(false)
  const [manifest,        setManifest]        = useState<Record<string, ManifestEntry> | null>(null)
  const [manifestLoading, setManifestLoading] = useState(false)

  // Re-seed when the section row changes (e.g. after a save round-trip
  // or a template swap from a sibling component).
  useEffect(() => {
    const v = (section.cowork_slot_values ?? {}) as CoworkSlotValues
    setTagline(v.tagline ?? '')
    setPrimaryHeading(v.primary_heading ?? '')
    setBody(v.body ?? '')
    setAccentBody(v.accent_body ?? '')
    setItems(v.items ?? [])
    setButtons(v.buttons ?? [])
  }, [section.id, section.cowork_slot_values])

  useEffect(() => {
    if (manifest != null) return
    setManifestLoading(true)
    void (async () => {
      const { data } = await supabase
        .schema('strategy')
        .from('cowork_templates')
        .select('manifest')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const m = (data as any)?.manifest?.page_section_templates ?? {}
      setManifest(m)
      setManifestLoading(false)
    })()
  }, [manifest])

  // Find the manifest entry for the current template — keyed by
  // template_id (the manifest is keyed by concept).
  const currentEntry: ManifestEntry | null = useMemo(() => {
    if (!manifest || !template) return null
    return Object.values(manifest).find(e => e.template_id === template.id) ?? null
  }, [manifest, template])

  const gapsBySlot: Record<string, string[]> = useMemo(() => {
    const acc: Record<string, string[]> = {}
    for (const g of meta?.gaps ?? []) {
      if (g.slot) (acc[g.slot] ??= []).push(g.detail)
    }
    return acc
  }, [meta])

  const bindStatus = (uniformKey: 'tagline' | 'primary_heading' | 'body' | 'accent_body' | 'items' | 'buttons') => {
    if (!currentEntry) return { tone: 'neutral' as const, label: 'loading…', detail: '' }
    const mapTarget =
      uniformKey === 'tagline'         ? currentEntry.uniform_to_brixies.tagline :
      uniformKey === 'primary_heading' ? currentEntry.uniform_to_brixies.primary_heading :
      uniformKey === 'body'            ? currentEntry.uniform_to_brixies.body :
      uniformKey === 'accent_body'     ? currentEntry.uniform_to_brixies.accent_body :
      uniformKey === 'items'           ? (currentEntry.uniform_to_brixies.items?.field ?? (currentEntry.uniform_to_brixies.items?.split?.groups.join('+') ?? null)) :
      uniformKey === 'buttons'         ? (currentEntry.uniform_to_brixies.buttons?.field ?? null) :
      null
    if (!mapTarget) {
      return { tone: 'warning' as const, label: 'not bound in this layout', detail: 'Content is preserved; pick a different variant or leave it Brixies-only.' }
    }
    const slotGaps = gapsBySlot[uniformKey] ?? gapsBySlot[String(mapTarget)] ?? []
    if (slotGaps.length > 0) {
      return { tone: 'warning' as const, label: `→ ${mapTarget} (gap)`, detail: slotGaps.join(' · ') }
    }
    return { tone: 'success' as const, label: `→ ${mapTarget}`, detail: '' }
  }

  const buildSlotValues = (): CoworkSlotValues => {
    const out: CoworkSlotValues = {}
    if (tagline)        out.tagline         = tagline
    if (primaryHeading) out.primary_heading = primaryHeading
    if (body)           out.body            = body
    if (accentBody)     out.accent_body     = accentBody
    const cleanItems = items
      .map(i => {
        const row: Record<string, string> = {
          item_heading: i.item_heading.trim(),
          item_body:    i.item_body.trim(),
          item_meta:    i.item_meta.trim(),
        }
        // Per-item CTA fields are optional; only persist when filled.
        const ctaLabel = (i.item_cta_label ?? '').trim()
        const ctaUrl   = (i.item_cta_url   ?? '').trim()
        if (ctaLabel) row.item_cta_label = ctaLabel
        if (ctaUrl)   row.item_cta_url   = ctaUrl
        return row
      })
      .filter(i => i.item_heading || i.item_body || i.item_meta || i.item_cta_label || i.item_cta_url)
    if (cleanItems.length > 0) out.items = cleanItems as ItemRow[]
    const cleanButtons = buttons
      .map(b => ({ label: b.label.trim(), url: b.url.trim() }))
      .filter(b => b.label || b.url)
    if (cleanButtons.length > 0) out.buttons = cleanButtons
    return out
  }

  const saveAndRederive = () => {
    if (!currentEntry) return
    setSaving(true)
    const slotValues = buildSlotValues()
    const bind = composeFieldValuesForBrixies(slotValues, currentEntry)
    onChange({
      cowork_slot_values:  slotValues,
      field_values:        bind.field_values,
      source_field_values: slotValues,
      cowork_section_meta: {
        ...(meta ?? {}),
        bind_quality: bind.bind_quality,
        gaps:         bind.gaps,
      } as any,
    })
    setTimeout(() => setSaving(false), 300)   // visual ack
  }

  // Hide entirely if there's no cowork content on this section.
  if (section.cowork_slot_values == null) return null

  return (
    <div className="rounded-lg border-2 border-wm-accent/40 bg-wm-accent-tint/20 overflow-hidden mb-3">
      {/* Header */}
      <div className="px-3 py-2 border-b border-wm-accent/30 bg-wm-accent-tint/40">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide font-bold text-wm-accent-strong">
            Original Content
          </span>
          {meta?.bind_quality && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
              meta.bind_quality === 'perfect' ? 'bg-wm-success-bg text-wm-success' : 'bg-wm-warning-bg text-wm-warning'
            }`}>
              {meta.bind_quality === 'perfect' ? '✓ perfect bind' : `~ ${meta.gaps?.length ?? 0} gap(s)`}
            </span>
          )}
        </div>
      </div>

      {/* Slot editors */}
      <div className="p-3 space-y-3">
        <SlotRow
          label="Tagline"
          status={bindStatus('tagline')}
          input={
            <input
              type="text"
              value={tagline}
              onChange={e => setTagline(e.target.value)}
              placeholder="Short eyebrow / label above the heading"
              className="w-full px-2 py-1.5 text-[12px] rounded border border-wm-border bg-white focus:border-wm-accent focus:outline-none"
              maxLength={60}
            />
          }
        />
        <SlotRow
          label="Primary heading"
          status={bindStatus('primary_heading')}
          input={
            <input
              type="text"
              value={primaryHeading}
              onChange={e => setPrimaryHeading(e.target.value)}
              placeholder="The main statement of this section"
              className="w-full px-2 py-1.5 text-[13px] font-semibold rounded border border-wm-border bg-white focus:border-wm-accent focus:outline-none"
              maxLength={100}
            />
          }
        />
        <SlotRow
          label="Body"
          status={bindStatus('body')}
          input={
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Main paragraph of this section"
              rows={3}
              className="w-full px-2 py-1.5 text-[12px] rounded border border-wm-border bg-white focus:border-wm-accent focus:outline-none resize-y"
              maxLength={400}
            />
          }
        />
        {((currentEntry?.uniform_to_brixies.accent_body) || accentBody) && (
          <SlotRow
            label="Accent body"
            status={bindStatus('accent_body')}
            input={
              <textarea
                value={accentBody}
                onChange={e => setAccentBody(e.target.value)}
                placeholder="Pull-quote / accent paragraph"
                rows={2}
                className="w-full px-2 py-1.5 text-[12px] italic rounded border border-wm-border bg-white focus:border-wm-accent focus:outline-none resize-y"
                maxLength={300}
              />
            }
          />
        )}

        {/* Items list */}
        {(currentEntry?.uniform_to_brixies.items || items.length > 0) && (
          <SlotRow
            label={`Items (${items.length})`}
            status={bindStatus('items')}
            input={
              <div className="space-y-1.5">
                {items.map((it, idx) => (
                  <div key={idx} className="rounded border border-wm-border bg-white p-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-wm-text-subtle">#{idx + 1}</span>
                      <input
                        type="text"
                        value={it.item_heading}
                        onChange={e => setItems(arr => arr.map((x, i) => i === idx ? { ...x, item_heading: e.target.value } : x))}
                        placeholder="Item heading"
                        className="flex-1 px-1.5 py-1 text-[12px] font-semibold rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setItems(arr => arr.filter((_, i) => i !== idx))}
                        className="text-wm-text-subtle hover:text-wm-danger p-0.5"
                        title="Remove item"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <textarea
                      value={it.item_body}
                      onChange={e => setItems(arr => arr.map((x, i) => i === idx ? { ...x, item_body: e.target.value } : x))}
                      placeholder="Item body"
                      rows={2}
                      className="w-full px-1.5 py-1 text-[11px] rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none resize-y"
                    />
                    <input
                      type="text"
                      value={it.item_meta}
                      onChange={e => setItems(arr => arr.map((x, i) => i === idx ? { ...x, item_meta: e.target.value } : x))}
                      placeholder="Item meta (optional)"
                      className="w-full px-1.5 py-1 text-[10.5px] text-wm-text-muted rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                    />
                    {/* Per-item CTA — only applies when the picked
                        template supports per-card buttons. The fields
                        always render so the strategist can add a CTA
                        + then swap the template to one that holds it. */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-wm-text-subtle min-w-[28px]">CTA</span>
                      <input
                        type="text"
                        value={it.item_cta_label ?? ''}
                        onChange={e => setItems(arr => arr.map((x, i) => i === idx ? { ...x, item_cta_label: e.target.value } : x))}
                        placeholder="Button label (optional)"
                        className="flex-1 px-1.5 py-1 text-[10.5px] rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                        maxLength={30}
                      />
                      <input
                        type="text"
                        value={it.item_cta_url ?? ''}
                        onChange={e => setItems(arr => arr.map((x, i) => i === idx ? { ...x, item_cta_url: e.target.value } : x))}
                        placeholder="URL"
                        className="flex-[2] px-1.5 py-1 text-[10px] text-wm-text-muted rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setItems(arr => [...arr, { item_heading: '', item_body: '', item_meta: '' }])}
                  className="text-[10.5px] px-2 py-1 rounded border border-dashed border-wm-border text-wm-text-subtle hover:border-wm-accent hover:text-wm-accent-strong"
                >
                  + Add item
                </button>
              </div>
            }
          />
        )}

        {/* Buttons list */}
        {(currentEntry?.uniform_to_brixies.buttons || buttons.length > 0) && (
          <SlotRow
            label={`Buttons (${buttons.length})`}
            status={bindStatus('buttons')}
            input={
              <div className="space-y-1.5">
                {buttons.map((b, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 rounded border border-wm-border bg-white p-1.5">
                    <span className="text-[9px] font-bold text-wm-text-subtle">#{idx + 1}</span>
                    <input
                      type="text"
                      value={b.label}
                      onChange={e => setButtons(arr => arr.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                      placeholder="Button label"
                      className="flex-1 px-1.5 py-1 text-[11.5px] font-semibold rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                      maxLength={30}
                    />
                    <input
                      type="text"
                      value={b.url}
                      onChange={e => setButtons(arr => arr.map((x, i) => i === idx ? { ...x, url: e.target.value } : x))}
                      placeholder="URL"
                      className="flex-[2] px-1.5 py-1 text-[10.5px] text-wm-text-muted rounded border border-wm-border-subtle focus:border-wm-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setButtons(arr => arr.filter((_, i) => i !== idx))}
                      className="text-wm-text-subtle hover:text-wm-danger p-0.5"
                      title="Remove button"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setButtons(arr => [...arr, { label: '', url: '' }])}
                  className="text-[10.5px] px-2 py-1 rounded border border-dashed border-wm-border text-wm-text-subtle hover:border-wm-accent hover:text-wm-accent-strong"
                >
                  + Add button
                </button>
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-wm-accent/20 bg-wm-accent-tint/30 flex items-center justify-between">
        <span className="text-[10px] text-wm-text-muted">
          {manifestLoading
            ? <><Loader2 size={10} className="animate-spin inline mr-1" />Loading manifest…</>
            : currentEntry
              ? <>Manifest: {currentEntry.concept} → {currentEntry.template_id}{currentEntry.verified ? ' ✓' : ' (inferred)'}</>
              : <>No manifest entry for this template_id — bind is best-effort.</>}
        </span>
        <button
          type="button"
          onClick={() => void saveAndRederive()}
          disabled={saving || !currentEntry}
          className="text-[11px] font-semibold px-3 py-1 rounded-full bg-wm-accent text-white hover:bg-wm-accent-strong disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Save + re-bind
        </button>
      </div>
    </div>
  )
}

function SlotRow({
  label, status, input,
}: {
  label:  string
  status: { tone: 'success' | 'warning' | 'neutral'; label: string; detail: string }
  input:  React.ReactNode
}) {
  const Icon = status.tone === 'success' ? Check : status.tone === 'warning' ? AlertTriangle : null
  const toneCls =
    status.tone === 'success' ? 'text-wm-success bg-wm-success-bg' :
    status.tone === 'warning' ? 'text-wm-warning bg-wm-warning-bg' :
    'text-wm-text-subtle bg-wm-bg-elevated'

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-wm-text-subtle">
          {label}
        </label>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${toneCls}`}>
          {Icon ? <Icon size={9} /> : null}
          {status.label}
        </span>
      </div>
      {input}
      {status.detail && (
        <p className="text-[10px] text-wm-text-muted italic mt-1">{status.detail}</p>
      )}
    </div>
  )
}
