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

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  loadContentModels, upsertContentModel, connectSectionToModel, disconnectSectionFromModel,
  findModelForSection, defaultSchemaForName, newContentModelId,
  type ContentModel, type ContentModelField, type ContentModelFieldType,
} from '../../../lib/contentModels'

interface Props {
  projectId: string
  /** Section currently selected in the page editor. When null, the
   *  panel renders the project-wide overview instead of section-scoped
   *  attach/create controls. */
  sectionId: string | null
}

export function ContentModelPanel({ projectId, sectionId }: Props) {
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
        <div className="p-3 space-y-3">
          <button
            type="button"
            onClick={() => setDrillModelId(null)}
            className="text-[11.5px] font-semibold text-wm-accent-strong hover:underline"
          >
            ← Back to all models
          </button>
          <div className="rounded-md border border-wm-accent/40 bg-wm-accent-tint/30 p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-bold text-wm-text">{drilled.name}</p>
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
      <div className="p-3 space-y-3">
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
    <div className="space-y-3">
      <p className="text-[11.5px] text-wm-text-muted leading-snug">
        Group sections that feed the same content type (Staff, Events,
        Values, etc.). The dev handoff treats the group as one model
        instead of N separate inferred ones.
      </p>

      {current ? (
        <div className="rounded-md border border-wm-accent/40 bg-wm-accent-tint/30 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-bold text-wm-text">{current.name}</p>
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
              {current.section_ids.length} section{current.section_ids.length === 1 ? '' : 's'}
            </span>
          </div>
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
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(model.schema); setCtaTarget(model.cta_target) }, [model.schema, model.cta_target, model.id])

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(model.schema)
    || ctaTarget !== model.cta_target

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    await upsertContentModel(supabase, projectId, {
      ...model,
      schema:     draft,
      cta_target: ctaTarget,
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
          <option value="internal-page">Individual page per entry (CPT detail)</option>
          <option value="external">External link</option>
          <option value="mailto">Email (mailto:)</option>
          <option value="tel">Phone (tel:)</option>
          <option value="anchor">Anchor on this page</option>
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
            onClick={() => { setDraft(model.schema); setCtaTarget(model.cta_target) }}
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
