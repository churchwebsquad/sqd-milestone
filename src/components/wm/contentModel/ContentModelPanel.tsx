/**
 * Content Model panel — strategist-owned content modeling, lifted out
 * of SectionDetailsPanel so both the right-rail "Content Model" tab and
 * the per-section inline section can mount the same component.
 *
 * Per-section mode (sectionId set): the panel binds to that section.
 * Shows the model it belongs to (with section count, schema editor,
 * button-target picker), lets the user attach to a different model, or
 * create a new one.
 *
 * Project-wide mode (sectionId null): the panel shows every declared
 * model on the project with section counts, lets the user create new
 * ones, and provides drill-in to edit each.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  loadContentModels, upsertContentModel, connectSectionToModel, disconnectSectionFromModel,
  findModelForSection, defaultSchemaForName, newContentModelId, setSectionItemBindings,
  type ContentModel, type ContentModelField, type ContentModelFieldType,
} from '../../../lib/contentModels'

interface Props {
  projectId: string
  /** Section currently selected in the page editor. When null, the
   *  panel renders the project-wide overview instead of section-scoped
   *  attach/create controls. */
  sectionId: string | null
  /** True when this panel is rendered INSIDE another container that
   *  already provides padding (e.g. SectionDetailsPanel's `<Section>`
   *  wrapper). Skips the outer `p-3` so the panel doesn't get nested
   *  padding. Default false (standalone rail-tab mount). */
  embedded?: boolean
}

export function ContentModelPanel({ projectId, sectionId, embedded = false }: Props) {
  const outerPad = embedded ? '' : 'p-3'
  const [models, setModels] = useState<ContentModel[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  /** When in project-wide mode, this drives which model the user is
   *  drilled into for inline editing. */
  const [drillModelId, setDrillModelId] = useState<string | null>(null)

  const current = sectionId ? findModelForSection(models, sectionId) : null
  const drilled = drillModelId ? models.find(m => m.id === drillModelId) ?? null : null

  const load = useCallback(async () => {
    setLoading(true)
    const list = await loadContentModels(supabase, projectId)
    setModels(list)
    setLoading(false)
  }, [projectId])
  useEffect(() => { void load() }, [load])

  const handleAttach = async (modelId: string) => {
    if (!sectionId) return
    setBusy(true)
    if (current && current.id !== modelId) {
      await disconnectSectionFromModel(supabase, projectId, current.id, sectionId)
    }
    await connectSectionToModel(supabase, projectId, modelId, sectionId)
    await load()
    setBusy(false)
  }

  const handleDetach = async () => {
    if (!sectionId || !current) return
    setBusy(true)
    await disconnectSectionFromModel(supabase, projectId, current.id, sectionId)
    await load()
    setBusy(false)
  }

  const handleCreate = async () => {
    const name = draftName.trim()
    if (!name) return
    setBusy(true)
    const now = new Date().toISOString()
    const model: ContentModel = {
      id:          newContentModelId(),
      name,
      schema:      defaultSchemaForName(name),
      cta_target:  null,
      section_ids: sectionId ? [sectionId] : [],
      created_at:  now,
      updated_at:  now,
    }
    if (sectionId && current) {
      await disconnectSectionFromModel(supabase, projectId, current.id, sectionId)
    }
    await upsertContentModel(supabase, projectId, model)
    await load()
    setDraftName('')
    setCreating(false)
    setBusy(false)
  }

  if (loading) {
    return <p className="text-[11.5px] text-wm-text-subtle p-3">Loading content models…</p>
  }

  // Project-wide mode — no section selected. Show overview + drill-in.
  if (!sectionId) {
    if (drilled) {
      return (
        <div className={`${outerPad} space-y-3`}>
          <button
            type="button"
            onClick={() => setDrillModelId(null)}
            className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline"
          >
            ← Back to all models
          </button>
          <div className="rounded-md border border-wm-accent/40 bg-wm-accent-tint/30 p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <ModelNameHeading
                projectId={projectId}
                model={drilled}
                sizeClass="text-[14px]"
                onSaved={load}
              />
              <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
                {drilled.section_ids.length} section{drilled.section_ids.length === 1 ? '' : 's'}
              </span>
            </div>
            <ContentModelSchemaEditor
              projectId={projectId}
              model={drilled}
              onSaved={load}
            />
          </div>
        </div>
      )
    }
    return (
      <div className={`${outerPad} space-y-3`}>
        <p className="text-[12px] text-wm-text-muted leading-snug">
          Strategist-owned content models for this project. Select a
          section in the editor to attach it to a model, or manage the
          list here.
        </p>
        {models.length === 0 && !creating && (
          <p className="text-[12px] text-wm-text-subtle italic">No content models declared yet.</p>
        )}
        {models.length > 0 && (
          <ul className="space-y-1.5">
            {models.map(m => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setDrillModelId(m.id)}
                  className="w-full text-left text-[12.5px] text-wm-text border border-wm-border rounded-md px-3 py-2 hover:border-wm-accent hover:bg-wm-accent-tint/30 transition-colors"
                >
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-[10.5px] text-wm-text-subtle mt-0.5">
                    {m.section_ids.length} section{m.section_ids.length === 1 ? '' : 's'}
                    {' · '}
                    {m.schema.length} field{m.schema.length === 1 ? '' : 's'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
        {creating ? (
          <CreateModelForm
            draftName={draftName}
            setDraftName={setDraftName}
            onCreate={handleCreate}
            onCancel={() => { setCreating(false); setDraftName('') }}
            busy={busy}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-[12px] font-semibold text-wm-accent-strong hover:underline"
          >
            + Create a new content model
          </button>
        )}
      </div>
    )
  }

  // Section-scoped mode.
  return (
    <div className={`${outerPad} space-y-3`}>
      <p className="text-[11.5px] text-wm-text-muted leading-snug">
        Group sections that feed the same content type (Staff, Events,
        Values, etc.). The dev handoff treats the group as one model
        instead of N separate inferred ones.
      </p>

      {current ? (
        <div className="rounded-md border border-wm-accent/40 bg-wm-accent-tint/30 p-3 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <ModelNameHeading
              projectId={projectId}
              model={current}
              sizeClass="text-[13px]"
              onSaved={load}
            />
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
              {current.section_ids.length} section{current.section_ids.length === 1 ? '' : 's'}
            </span>
          </div>
          <SectionItemBindingsControl
            projectId={projectId}
            model={current}
            sectionId={sectionId}
            onSaved={load}
          />
          <ContentModelSchemaEditor
            projectId={projectId}
            model={current}
            onSaved={load}
          />
          <button
            type="button"
            onClick={() => void handleDetach()}
            disabled={busy}
            className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger"
          >
            Disconnect this section from {current.name}
          </button>
        </div>
      ) : (
        <p className="text-[11.5px] text-wm-text-subtle italic">
          Not assigned to a content model yet.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">
          {current ? 'Move to a different model' : 'Add this section to a model'}
        </p>
        {models.length === 0 && !creating && (
          <p className="text-[11.5px] text-wm-text-subtle italic">No models yet — create one below.</p>
        )}
        {models.length > 0 && (
          <div className="flex flex-col gap-1">
            {models
              .filter(m => !current || m.id !== current.id)
              .map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void handleAttach(m.id)}
                  disabled={busy}
                  className="text-left text-[12px] text-wm-text border border-wm-border rounded px-2.5 py-1.5 hover:border-wm-accent hover:bg-wm-accent-tint/30 disabled:opacity-50"
                >
                  <span className="font-semibold">{m.name}</span>
                  <span className="ml-2 text-[10.5px] text-wm-text-subtle">
                    · {m.section_ids.length} section{m.section_ids.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
          </div>
        )}

        {creating ? (
          <CreateModelForm
            draftName={draftName}
            setDraftName={setDraftName}
            onCreate={handleCreate}
            onCancel={() => { setCreating(false); setDraftName('') }}
            busy={busy}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={busy}
            className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-50"
          >
            + Create a new content model
          </button>
        )}
      </div>
    </div>
  )
}

/** Inline-editable model name. Reads as bold text, becomes an input
 *  on click of the pencil affordance. Enter or "Save" commits via
 *  upsertContentModel; Escape or "Cancel" reverts. Trim + non-empty
 *  gate — refuses to save a blank name (rename to "" would break every
 *  place that keys off `name`). */
function ModelNameHeading({
  projectId, model, sizeClass, onSaved,
}: {
  projectId: string
  model:     ContentModel
  /** Tailwind text-size class applied to both the read and edit
   *  states so the heading doesn't jump when switching modes. */
  sizeClass: string
  onSaved:   () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(model.name)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Reset draft whenever the model prop changes (e.g. after save, or
  // when the panel drills into a different model).
  useEffect(() => { setDraft(model.name); setError(null) }, [model.id, model.name])

  const commit = async () => {
    const next = draft.trim()
    if (!next) {
      setError('Name cannot be empty')
      return
    }
    if (next === model.name) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const res = await upsertContentModel(supabase, projectId, {
      ...model,
      name:       next,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
    await onSaved()
  }

  if (!editing) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <p className={`${sizeClass} font-bold text-wm-text`}>{model.name}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10.5px] text-wm-text-subtle hover:text-wm-accent-strong hover:underline"
          title="Rename this content model"
        >
          rename
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); void commit() }
          if (e.key === 'Escape') { setEditing(false); setDraft(model.name); setError(null) }
        }}
        disabled={saving}
        autoFocus
        className={`${sizeClass} font-bold text-wm-text bg-white border border-wm-accent rounded px-1.5 py-0.5 focus:outline-none min-w-0`}
      />
      <button
        type="button"
        onClick={() => void commit()}
        disabled={saving || !draft.trim() || draft.trim() === model.name}
        className="text-[10.5px] font-semibold text-wm-accent-strong hover:underline disabled:opacity-40 disabled:no-underline"
      >
        {saving ? 'saving…' : 'save'}
      </button>
      <button
        type="button"
        onClick={() => { setEditing(false); setDraft(model.name); setError(null) }}
        disabled={saving}
        className="text-[10.5px] text-wm-text-subtle hover:text-wm-text"
      >
        cancel
      </button>
      {error && <span className="text-[10.5px] text-red-600">err: {error}</span>}
    </span>
  )
}

function CreateModelForm({
  draftName, setDraftName, onCreate, onCancel, busy,
}: {
  draftName:    string
  setDraftName: (v: string) => void
  onCreate:     () => Promise<void> | void
  onCancel:     () => void
  busy:         boolean
}) {
  return (
    <div className="rounded-md border border-wm-accent/40 bg-wm-bg-elevated p-2.5 space-y-2">
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Name</span>
        <input
          type="text"
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          placeholder="Staff, Events, Values, Beliefs…"
          className="mt-1 w-full text-[12.5px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:border-wm-accent focus:outline-none"
          autoFocus
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={busy || !draftName.trim()}
          className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-wm-accent-strong text-white rounded px-3 py-1 hover:bg-wm-accent disabled:opacity-50"
        >
          Create model
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Per-card binding control. When the active section has multiple
 *  items in its primary group (e.g. Feature 22 with three cards), the
 *  strategist can restrict the model to a subset — useful when one
 *  section mixes "Services" cards with a location/address card that
 *  doesn't belong to the same content type.
 *
 *  Loads the section + its template lazily so the panel doesn't have
 *  to thread section data through from the parent. Persists each
 *  toggle via setSectionItemBindings.
 */
function SectionItemBindingsControl({
  projectId, model, sectionId, onSaved,
}: {
  projectId: string
  model:     ContentModel
  sectionId: string
  onSaved:   () => Promise<void> | void
}) {
  const [items, setItems] = useState<Array<{ index: number; label: string }>>([])
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data: section } = await supabase
        .from('web_sections')
        .select('id, content_template_id, field_values')
        .eq('id', sectionId)
        .maybeSingle()
      if (cancelled || !section) { setLoading(false); return }
      const fv = (section.field_values ?? {}) as Record<string, unknown>
      let tpl: { fields?: unknown[] } | null = null
      if (section.content_template_id) {
        const { data: tplRow } = await supabase
          .from('web_content_templates')
          .select('fields')
          .eq('id', section.content_template_id)
          .maybeSingle()
        tpl = tplRow as { fields?: unknown[] } | null
      }
      if (cancelled) return
      const found = findItemsForBinding(fv, tpl?.fields)
      setItems(found.items)
      setGroupKey(found.groupKey)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [sectionId])

  const binding = model.item_bindings?.[sectionId]
  const selectedIndices = useMemo(() => {
    if (binding && Array.isArray(binding.indices) && binding.indices.length > 0) {
      return new Set(binding.indices)
    }
    // No override → ALL items belong.
    return new Set(items.map(it => it.index))
  }, [binding, items])

  const isPartial = binding != null && binding.indices.length > 0 && binding.indices.length < items.length

  const toggle = async (idx: number) => {
    setSaving(true)
    const next = new Set(selectedIndices)
    if (next.has(idx)) next.delete(idx); else next.add(idx)
    const arr = [...next].sort((a, b) => a - b)
    // When all items selected, store no override (whole section binds).
    const persist = arr.length === items.length ? null : arr
    await setSectionItemBindings(supabase, projectId, model.id, sectionId, persist, groupKey ?? undefined)
    await onSaved()
    setSaving(false)
  }

  const clearOverride = async () => {
    if (!binding) return
    setSaving(true)
    await setSectionItemBindings(supabase, projectId, model.id, sectionId, null)
    await onSaved()
    setSaving(false)
  }

  if (loading) {
    return <p className="text-[11px] text-wm-text-subtle">Loading section items…</p>
  }
  if (items.length === 0) {
    return (
      <p className="text-[11px] text-wm-text-subtle italic">
        This section has no card list — the whole section binds to {model.name}.
      </p>
    )
  }
  if (items.length === 1) {
    return (
      <p className="text-[11px] text-wm-text-subtle italic">
        One item in this section — entire section bound to {model.name}.
      </p>
    )
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1.5">
        Which cards in this section belong to {model.name}?
      </p>
      <ul className="space-y-1">
        {items.map(it => {
          const checked = selectedIndices.has(it.index)
          return (
            <li key={it.index} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => void toggle(it.index)}
                disabled={saving}
                className="accent-wm-accent cursor-pointer"
              />
              <span className={`text-[12px] ${checked ? 'text-wm-text' : 'text-wm-text-subtle line-through'}`}>
                {it.label || `Item ${it.index + 1}`}
              </span>
            </li>
          )
        })}
      </ul>
      {isPartial && (
        <button
          type="button"
          onClick={() => void clearOverride()}
          disabled={saving}
          className="mt-1.5 text-[11px] font-semibold text-wm-text-muted hover:text-wm-text disabled:opacity-50"
        >
          Reset to all cards
        </button>
      )}
    </div>
  )
}

/** Find the primary group + readable per-item labels for the binding
 *  checklist. Walks the template fields looking for the first non-
 *  empty `group` field in field_values; for each item, picks the most
 *  descriptive text-shaped value (heading, name, title, label) as the
 *  display label. Returns empty when nothing actionable found. */
function findItemsForBinding(
  fv: Record<string, unknown>,
  templateFields: unknown,
): { items: Array<{ index: number; label: string }>; groupKey: string | null } {
  if (!Array.isArray(templateFields)) return { items: [], groupKey: null }
  for (const f of templateFields) {
    if (!f || typeof f !== 'object') continue
    const field = f as { kind?: string; key?: string }
    if (field.kind !== 'group' || typeof field.key !== 'string') continue
    const raw = fv[field.key]
    // Two shapes for groups: plain array (most templates), or palette
    // envelope `{ __palette_template_id, items: [...] }`.
    let items: unknown[] = []
    if (Array.isArray(raw)) items = raw
    else if (raw && typeof raw === 'object') {
      const inner = (raw as { items?: unknown[] }).items
      if (Array.isArray(inner)) items = inner
    }
    if (items.length === 0) continue
    const labeled = items.map((item, i) => ({
      index: i,
      label: pickItemLabel(item),
    }))
    return { items: labeled, groupKey: field.key }
  }
  return { items: [], groupKey: null }
}

function pickItemLabel(item: unknown): string {
  if (item == null || typeof item !== 'object') return ''
  const obj = item as Record<string, unknown>
  for (const key of ['heading_card', 'card_heading_card', 'heading', 'team_name', 'name', 'title', 'label', 'question']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80)
  }
  // Nested card-group items often wrap a card object.
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      const nested = pickItemLabel(v[0])
      if (nested) return nested
    }
  }
  return ''
}

/** Editable schema list for a content model — add / remove / rename
 *  / re-type fields. Persists on Save. */
function ContentModelSchemaEditor({
  projectId, model, onSaved,
}: {
  projectId: string
  model:     ContentModel
  onSaved:   () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<ContentModelField[]>(model.schema)
  const [ctaTarget, setCtaTarget] = useState<ContentModel['cta_target']>(model.cta_target)
  const [pairedKind, setPairedKind] = useState<ContentModel['paired_content_kind']>(model.paired_content_kind ?? null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDraft(model.schema)
    setCtaTarget(model.cta_target)
    setPairedKind(model.paired_content_kind ?? null)
  }, [model.schema, model.cta_target, model.paired_content_kind, model.id])

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(model.schema)
    || ctaTarget !== model.cta_target
    || (pairedKind ?? null) !== (model.paired_content_kind ?? null)

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    await upsertContentModel(supabase, projectId, {
      ...model,
      schema:               draft,
      cta_target:           ctaTarget,
      paired_content_kind:  pairedKind ?? null,
    })
    await onSaved()
    setSaving(false)
  }

  const addField = () => {
    setDraft(d => [...d, { key: '', label: '', type: 'text' }])
  }
  const removeField = (i: number) => {
    setDraft(d => d.filter((_, idx) => idx !== i))
  }
  const updateField = (i: number, patch: Partial<ContentModelField>) => {
    setDraft(d => d.map((f, idx) => idx === i ? { ...f, ...patch } : f))
  }

  const FIELD_TYPES: Array<{ value: ContentModelFieldType; label: string }> = [
    { value: 'text',     label: 'Text' },
    { value: 'richtext', label: 'Rich text' },
    { value: 'image',    label: 'Image' },
    { value: 'cta',      label: 'Button (CTA)' },
    { value: 'url',      label: 'URL' },
    { value: 'email',    label: 'Email' },
    { value: 'date',     label: 'Date' },
    { value: 'category', label: 'Category / Tag' },
  ]

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Schema</p>
        <ul className="space-y-1">
          {draft.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5 bg-wm-bg-elevated border border-wm-border rounded px-2 py-1">
              <input
                type="text"
                value={f.label}
                onChange={e => updateField(i, { label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') })}
                placeholder="Field label"
                className="flex-1 min-w-0 text-[12px] text-wm-text bg-transparent focus:outline-none"
              />
              <select
                value={f.type}
                onChange={e => updateField(i, { type: e.target.value as ContentModelFieldType })}
                className="text-[11px] text-wm-text bg-wm-bg border border-wm-border rounded px-1 py-0.5 focus:outline-none"
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeField(i)}
                className="text-wm-text-subtle hover:text-wm-danger text-[14px] leading-none px-1"
                title="Remove field"
              >×</button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addField}
          className="mt-1 text-[11px] font-semibold text-wm-accent-strong hover:underline"
        >
          + Add field
        </button>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Where buttons link</p>
        <select
          value={ctaTarget ?? ''}
          onChange={e => setCtaTarget((e.target.value || null) as ContentModel['cta_target'])}
          className="w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent"
        >
          <option value="">(strategist confirms later)</option>
          <option value="na">N/A — no buttons on this model</option>
          <option value="internal-page">Individual page per entry (CPT detail)</option>
          <option value="external">External link</option>
          <option value="mailto">Email (mailto:)</option>
          <option value="tel">Phone (tel:)</option>
          <option value="anchor">Anchor on this page</option>
        </select>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">
          Pair with Content Collection
        </p>
        <p className="text-[10.5px] text-wm-text-muted mb-1 leading-snug">
          Attach this model to a partner topic from Content Collection.
          The dev handoff will show the partner's answers (display
          preference, source URL, playlist, etc.) alongside this model.
        </p>
        <select
          value={pairedKind ?? ''}
          onChange={e => setPairedKind((e.target.value || null) as ContentModel['paired_content_kind'])}
          className="w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:outline-none focus:border-wm-accent"
        >
          <option value="">(no pairing — generic content model)</option>
          <option value="events">Events</option>
          <option value="sermons">Sermons</option>
          <option value="groups">Groups</option>
        </select>
      </div>

      {dirty && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-wm-accent-strong text-white rounded px-3 py-1 hover:bg-wm-accent disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => { setDraft(model.schema); setCtaTarget(model.cta_target); setPairedKind(model.paired_content_kind ?? null) }}
            disabled={saving}
            className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-text"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
