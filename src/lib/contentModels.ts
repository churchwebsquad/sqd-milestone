/**
 * Strategist-owned content models — the upstream side of the
 * formation plan. Where the dev-handoff content-model analyzer
 * tries to INFER a content model from already-bound sections, this
 * library lets the strategist DECLARE the model up-front from the
 * Pages workspace: name it, list its fields, point at the sections
 * that should feed it.
 *
 * Storage: strategy_web_projects.roadmap_state.content_models — a
 * single JSONB array on the project row. No new table; same edit
 * surface as every other strategist-authored roadmap key.
 *
 * Shape:
 *   {
 *     id:           uuid
 *     name:         "Staff" | "Events" | "Values" | etc. (free text)
 *     schema:       [{ key, label, type }]
 *     cta_target:   'internal-page' | 'external' | 'mailto' | null
 *     section_ids:  [uuid, ...]                // sections feeding this model
 *     created_at:   ISO
 *     updated_at:   ISO
 *   }
 *
 * Entries (the actual data items) aren't stored here — they're
 * derived from each connected section's field_values at render time.
 * That keeps this layer purely structural; the partner content stays
 * single-source-of-truth on web_sections.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ContentModelFieldType =
  | 'text' | 'richtext' | 'image' | 'file' | 'cta' | 'url' | 'email' | 'date' | 'category'

export interface ContentModelField {
  key:   string
  label: string
  type:  ContentModelFieldType
}

export interface ContentModel {
  id:           string
  name:         string
  schema:       ContentModelField[]
  cta_target:   'internal-page' | 'external' | 'mailto' | 'tel' | 'anchor' | 'na' | null
  /** Optional pairing with a content-collection topic. When set, the
   *  dev handoff card for this model surfaces the partner's answers
   *  from strategy_content_collection_sessions (display_preference,
   *  external source URLs, source-of-truth systems, frustrations,
   *  playlist URLs, archive features) — the "What the partner asked
   *  for in Content Collection" callout — right on the model card
   *  instead of on the individual sections. Null when the model
   *  doesn't align to any content-collection topic (Staff, Ways to
   *  Give, generic Feature cards, etc.). */
  paired_content_kind?: 'events' | 'sermons' | 'groups' | null
  /** Section ids (web_sections.id) bound to this model. Default
   *  behavior: ALL items in the section's primary group belong to
   *  the model. Override per-section via `item_bindings` below. */
  section_ids:  string[]
  /** Per-section item-level binding overrides. When a section id
   *  appears in this map, ONLY the listed item indices belong to the
   *  model — useful for mixed sections like Feature 22 where one
   *  card is location info and the other two are service entries.
   *  Indices reference items in the section's primary group
   *  (typically the row/card group). When omitted for a section in
   *  section_ids, the whole section binds. */
  item_bindings?: Record<string, { indices: number[]; group_key?: string }>
  created_at:   string
  updated_at:   string
}

/** Read all content models for a project. Returns [] when none have
 *  been declared yet (the strategist hasn't opened the panel). */
export async function loadContentModels(
  sb: SupabaseClient,
  projectId: string,
): Promise<ContentModel[]> {
  const { data } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  const rs = (data as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state ?? {}
  const raw = (rs as { content_models?: unknown }).content_models
  if (!Array.isArray(raw)) return []
  return raw.filter(isContentModel)
}

/** Write the full content_models array back. Caller passes the new
 *  list; this function does a read-merge-write so other roadmap_state
 *  keys are preserved verbatim. */
export async function saveContentModels(
  sb: SupabaseClient,
  projectId: string,
  next: ContentModel[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error: readErr } = await sb
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const rs = ((row as { roadmap_state?: Record<string, unknown> } | null)?.roadmap_state) ?? {}
  const merged = { ...rs, content_models: next }
  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({ roadmap_state: merged } as never)
    .eq('id', projectId)
  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true }
}

/** Upsert a single content model — preserves the rest of the list,
 *  replaces by id, appends when new. */
export async function upsertContentModel(
  sb: SupabaseClient,
  projectId: string,
  model: ContentModel,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const list = await loadContentModels(sb, projectId)
  const idx = list.findIndex(m => m.id === model.id)
  const next = idx >= 0
    ? list.map((m, i) => i === idx ? { ...model, updated_at: new Date().toISOString() } : m)
    : [...list, model]
  return saveContentModels(sb, projectId, next)
}

/** Connect a section to a content model — adds section_id to the
 *  model's section_ids list (dedupe-safe). Returns the updated model. */
export async function connectSectionToModel(
  sb: SupabaseClient,
  projectId: string,
  modelId: string,
  sectionId: string,
): Promise<{ ok: true; model: ContentModel } | { ok: false; error: string }> {
  const list = await loadContentModels(sb, projectId)
  const target = list.find(m => m.id === modelId)
  if (!target) return { ok: false, error: `Model ${modelId} not found` }
  if (target.section_ids.includes(sectionId)) return { ok: true, model: target }
  const updated: ContentModel = {
    ...target,
    section_ids: [...target.section_ids, sectionId],
    updated_at:  new Date().toISOString(),
  }
  const next = list.map(m => m.id === modelId ? updated : m)
  const res = await saveContentModels(sb, projectId, next)
  if (!res.ok) return res
  return { ok: true, model: updated }
}

/** Set the per-item binding for a specific section in a model. Pass
 *  `null` to clear the override (reverts to whole-section binding).
 *  Pass an array of indices to restrict the binding to specific items
 *  in the section's primary group. */
export async function setSectionItemBindings(
  sb: SupabaseClient,
  projectId: string,
  modelId: string,
  sectionId: string,
  indices: number[] | null,
  groupKey?: string,
): Promise<{ ok: true; model: ContentModel } | { ok: false; error: string }> {
  const list = await loadContentModels(sb, projectId)
  const target = list.find(m => m.id === modelId)
  if (!target) return { ok: false, error: `Model ${modelId} not found` }
  const bindings = { ...(target.item_bindings ?? {}) }
  if (indices == null || indices.length === 0) {
    delete bindings[sectionId]
  } else {
    bindings[sectionId] = {
      indices: [...indices].sort((a, b) => a - b),
      ...(groupKey ? { group_key: groupKey } : {}),
    }
  }
  const updated: ContentModel = {
    ...target,
    item_bindings: Object.keys(bindings).length > 0 ? bindings : undefined,
    updated_at:    new Date().toISOString(),
  }
  const next = list.map(m => m.id === modelId ? updated : m)
  const res = await saveContentModels(sb, projectId, next)
  if (!res.ok) return res
  return { ok: true, model: updated }
}

/** Disconnect a section from a model. */
export async function disconnectSectionFromModel(
  sb: SupabaseClient,
  projectId: string,
  modelId: string,
  sectionId: string,
): Promise<{ ok: true; model: ContentModel } | { ok: false; error: string }> {
  const list = await loadContentModels(sb, projectId)
  const target = list.find(m => m.id === modelId)
  if (!target) return { ok: false, error: `Model ${modelId} not found` }
  const updated: ContentModel = {
    ...target,
    section_ids: target.section_ids.filter(id => id !== sectionId),
    updated_at:  new Date().toISOString(),
  }
  const next = list.map(m => m.id === modelId ? updated : m)
  const res = await saveContentModels(sb, projectId, next)
  if (!res.ok) return res
  return { ok: true, model: updated }
}

/** Find the model (if any) that contains a given section. Used by the
 *  Pages workspace to surface "this section is part of model X" in
 *  the Content Model panel. */
export function findModelForSection(
  models: ContentModel[],
  sectionId: string,
): ContentModel | null {
  return models.find(m => m.section_ids.includes(sectionId)) ?? null
}

/** Mint a default schema for a freshly-created model. The user can
 *  edit it from there; starting from a real Brixies-shaped baseline
 *  is friendlier than an empty list. */
export function defaultSchemaForName(name: string): ContentModelField[] {
  const lower = name.toLowerCase().trim()
  if (/staff|team|leader|pastor/.test(lower)) {
    return [
      { key: 'name',     label: 'Name',     type: 'text' },
      { key: 'role',     label: 'Role',     type: 'text' },
      { key: 'bio',      label: 'Bio',      type: 'richtext' },
      { key: 'headshot', label: 'Headshot', type: 'image' },
      { key: 'email',    label: 'Email',    type: 'email' },
    ]
  }
  if (/event|service|gather/.test(lower)) {
    return [
      { key: 'name',           label: 'Name',           type: 'text' },
      { key: 'description',    label: 'Description',    type: 'richtext' },
      { key: 'start_date',     label: 'Start date',     type: 'date' },
      { key: 'location',       label: 'Location',       type: 'text' },
      { key: 'register_url',   label: 'Register URL',   type: 'url' },
      { key: 'featured_image', label: 'Featured image', type: 'image' },
    ]
  }
  if (/sermon|message/.test(lower)) {
    return [
      { key: 'title',     label: 'Title',     type: 'text' },
      { key: 'speaker',   label: 'Speaker',   type: 'text' },
      { key: 'date',      label: 'Date',      type: 'date' },
      { key: 'video_url', label: 'Video URL', type: 'url' },
      { key: 'scripture', label: 'Scripture', type: 'text' },
    ]
  }
  if (/group|small|connect/.test(lower)) {
    return [
      { key: 'name',          label: 'Name',          type: 'text' },
      { key: 'description',   label: 'Description',   type: 'richtext' },
      { key: 'meeting_time',  label: 'Meeting time',  type: 'text' },
      { key: 'location',      label: 'Location',      type: 'text' },
      { key: 'contact_email', label: 'Contact email', type: 'email' },
    ]
  }
  // Generic content tile fallback.
  return [
    { key: 'heading',     label: 'Heading',     type: 'text' },
    { key: 'description', label: 'Description', type: 'richtext' },
    { key: 'image',       label: 'Image',       type: 'image' },
    { key: 'cta',         label: 'Button',      type: 'cta' },
  ]
}

/** Generate a stable id for new models. Uses crypto.randomUUID when
 *  available; falls back to a timestamp-derived id for the rare runtime
 *  that lacks it. */
export function newContentModelId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function isContentModel(v: unknown): v is ContentModel {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.id === 'string'
      && typeof r.name === 'string'
      && Array.isArray(r.schema)
      && Array.isArray(r.section_ids)
}
