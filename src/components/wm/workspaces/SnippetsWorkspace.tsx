/**
 * Web Manager — Snippets workspace.
 *
 * Two layers of reusable text:
 *
 *   1. Global merge fields (16 columns on strategy_web_projects + current_year
 *      system-derived) — phone, address, social URLs, service times, etc.
 *      Single source of truth per project; available everywhere via {{token}}.
 *
 *   2. Custom snippets (web_project_snippets table) — text-expander style
 *      project-scoped tokens. Manual or AI-suggested. Tag-grouped.
 *
 * Both surface in the Assistant Rail's Snippets tab; clicking a snippet
 * there (in Pages workspace) inserts at cursor.
 */

import { useEffect, useState } from 'react'
import { Tag, Plus, Trash2, Loader2, X, Upload } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { WMButton } from '../Button'
import { WMIconButton } from '../IconButton'
import { WMStatusPill } from '../StatusPill'
import { SnippetsImportModal } from '../SnippetsImportModal'
import type { StrategyWebProject, WebProjectSnippet } from '../../../types/database'

interface Props {
  project: StrategyWebProject
  onChange: () => Promise<void>
}

interface GlobalFieldDef {
  column: keyof StrategyWebProject
  token: string
  label: string
  placeholder: string
  type?: 'text' | 'url' | 'email' | 'tel'
}

const GLOBAL_FIELDS: GlobalFieldDef[] = [
  { column: 'church_name',          token: '{{church_name}}',          label: 'Church name',           placeholder: 'Evangel Christian Churches' },
  { column: 'church_short_name',    token: '{{church_short_name}}',    label: 'Short / common name',   placeholder: 'ECC' },
  { column: 'address',              token: '{{address}}',              label: 'Street address',        placeholder: '28491 Utica Rd' },
  { column: 'city_state',           token: '{{city_state}}',           label: 'City, state',           placeholder: 'Roseville, MI 48066' },
  { column: 'phone',                token: '{{phone}}',                label: 'Phone',                 placeholder: '+1 586-773-6568', type: 'tel' },
  { column: 'email',                token: '{{email}}',                label: 'General contact email', placeholder: 'info@church.org',      type: 'email' },
  { column: 'denomination',         token: '{{denomination}}',         label: 'Denomination',          placeholder: 'Non-denominational' },
  { column: 'pastor_name',          token: '{{pastor_name}}',          label: 'Lead pastor name',      placeholder: 'Dr. Michael Hines' },
  { column: 'primary_service_time', token: '{{primary_service_time}}', label: 'Primary service time',  placeholder: 'Sundays 10:15am' },
  { column: 'all_service_times',    token: '{{all_service_times}}',    label: 'All service times',     placeholder: 'Sundays 10:15am · Wed 7pm' },
  { column: 'social_facebook_url',  token: '{{social_facebook_url}}',  label: 'Facebook',              placeholder: 'https://facebook.com/…', type: 'url' },
  { column: 'social_instagram_url', token: '{{social_instagram_url}}', label: 'Instagram',             placeholder: 'https://instagram.com/…', type: 'url' },
  { column: 'social_youtube_url',   token: '{{social_youtube_url}}',   label: 'YouTube',               placeholder: 'https://youtube.com/@…',  type: 'url' },
  { column: 'social_tiktok_url',    token: '{{social_tiktok_url}}',    label: 'TikTok',                placeholder: 'https://tiktok.com/@…',   type: 'url' },
  { column: 'social_twitter_url',   token: '{{social_twitter_url}}',   label: 'X / Twitter',           placeholder: 'https://x.com/…',         type: 'url' },
  { column: 'social_linkedin_url',  token: '{{social_linkedin_url}}',  label: 'LinkedIn',              placeholder: 'https://linkedin.com/…',  type: 'url' },
]

export function SnippetsWorkspace({ project, onChange }: Props) {
  const [customs, setCustoms] = useState<WebProjectSnippet[]>([])
  const [loadingCustoms, setLoadingCustoms] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const loadCustoms = async () => {
    setLoadingCustoms(true)
    const { data } = await supabase
      .from('web_project_snippets')
      .select('*')
      .eq('web_project_id', project.id)
      .eq('archived', false)
      .order('used_count', { ascending: false })
      .order('created_at', { ascending: false })
    setCustoms((data ?? []) as WebProjectSnippet[])
    setLoadingCustoms(false)
  }

  useEffect(() => { void loadCustoms() }, [project.id])

  const updateGlobal = async (col: GlobalFieldDef['column'], value: string) => {
    const v = value.trim() || null
    await supabase.from('strategy_web_projects').update({ [col]: v }).eq('id', project.id)
    await onChange()
  }

  const archiveCustom = async (id: string) => {
    await supabase.from('web_project_snippets').update({ archived: true }).eq('id', id)
    await loadCustoms()
  }

  return (
    <div className="p-4">
      {/* Header — compact for rail render */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1 text-wm-accent-strong">
          <Tag size={13} />
          <p className="text-[11px] font-bold uppercase tracking-widest">Snippets</p>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold text-wm-text">Reusable text</h1>
            <p className="text-[12px] text-wm-text-muted mt-1">
              Tokens like <code className="text-wm-accent-strong">{'{{phone}}'}</code> resolve
              anywhere they appear in body copy. Update once, applied everywhere.
            </p>
          </div>
          <WMButton
            variant="secondary"
            size="sm"
            iconLeft={<Upload size={11} />}
            onClick={() => setImportOpen(true)}
            className="shrink-0"
          >
            Import
          </WMButton>
        </div>
      </div>

      {/* Global merge fields — flat list (no card wrapper, no grid). */}
      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle">Global merge fields</h2>
          <span className="text-[10px] text-wm-text-subtle">{GLOBAL_FIELDS.length + 1} fields</span>
        </div>
        <div className="space-y-2">
          {GLOBAL_FIELDS.map(f => (
            <GlobalFieldRow
              key={f.column}
              field={f}
              value={(project[f.column] as string | null) ?? ''}
              onSave={(v) => updateGlobal(f.column, v)}
            />
          ))}
          {/* current_year — system-derived */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <p className="text-[11px] font-semibold text-wm-text">Current year</p>
              <WMStatusPill tone="ai" size="sm">system</WMStatusPill>
            </div>
            <code className="text-[10px] text-wm-accent-strong">{'{{current_year}}'}</code>
            <p className="text-[12px] text-wm-text-muted mt-1">{new Date().getFullYear()}</p>
          </div>
        </div>
      </section>

      {/* Custom snippets — flat list */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest text-wm-text-subtle">Custom snippets</h2>
          <WMButton variant="ghost" size="sm" iconLeft={<Plus size={11} />} onClick={() => setAddOpen(true)}>
            Add
          </WMButton>
        </div>

        {loadingCustoms ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-md bg-wm-bg-hover animate-pulse" />
            ))}
          </div>
        ) : customs.length === 0 ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full rounded-md border border-dashed border-wm-border bg-wm-bg p-4 text-center hover:border-wm-border-focus transition-colors"
          >
            <Tag size={16} className="text-wm-text-subtle mx-auto mb-1.5" />
            <p className="text-[12px] font-semibold text-wm-text">No custom snippets yet</p>
            <p className="text-[11px] text-wm-text-muted mt-1 leading-snug">
              AI will suggest snippets after scanning intake content. You can also add them manually now.
            </p>
          </button>
        ) : (
          <div className="space-y-1.5">
            {customs.map(s => (
              <SnippetRow key={s.id} snippet={s} onArchive={() => void archiveCustom(s.id)} />
            ))}
          </div>
        )}
      </section>

      {addOpen && (
        <AddSnippetModal
          projectId={project.id}
          existing={customs}
          onClose={() => setAddOpen(false)}
          onCreated={async () => { setAddOpen(false); await loadCustoms() }}
        />
      )}

      <SnippetsImportModal
        project={project}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          // Reload local custom snippets + bubble up to refresh the
          // rail's snippet count + the project row (in case globals
          // were updated).
          await Promise.all([loadCustoms(), onChange()])
        }}
      />
    </div>
  )
}

// ── Global field row ─────────────────────────────────────────────────

function GlobalFieldRow({
  field, value, onSave,
}: {
  field: GlobalFieldDef
  value: string
  onSave: (v: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== (value ?? '').trim()

  useEffect(() => { setDraft(value) }, [value])

  const commit = async () => {
    if (!dirty) return
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <p className="text-[11px] font-semibold text-wm-text">{field.label}</p>
        <code className="text-[10px] text-wm-accent-strong">{field.token}</code>
        {saving && <Loader2 size={11} className="animate-spin text-wm-text-subtle" />}
      </div>
      <input
        type={field.type ?? 'text'}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={field.placeholder}
        className="w-full h-8 rounded-md bg-wm-bg-elevated border border-wm-border px-2.5 text-[13px] text-wm-text placeholder-wm-text-subtle outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
      />
    </div>
  )
}

// ── Custom snippet row ───────────────────────────────────────────────

function SnippetRow({
  snippet, onArchive,
}: {
  snippet: WebProjectSnippet
  onArchive: () => void
}) {
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 rounded-md bg-wm-bg-elevated border border-wm-border hover:border-wm-border-focus transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <code className="text-[11px] text-wm-accent-strong">{'{{' + snippet.token + '}}'}</code>
          <p className="text-[13px] font-semibold text-wm-text">{snippet.label}</p>
          {snippet.source !== 'manual' && (
            <WMStatusPill tone="ai" size="sm">{snippet.source === 'ai_suggested' ? 'AI' : 'extracted'}</WMStatusPill>
          )}
        </div>
        <p className="text-[12px] text-wm-text-muted line-clamp-2">{snippet.expansion}</p>
        {snippet.tags.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {snippet.tags.map(t => (
              <span key={t} className="text-[10px] text-wm-text-subtle bg-wm-bg-hover rounded px-1.5 py-0.5">{t}</span>
            ))}
          </div>
        )}
      </div>
      <span className="text-[10px] text-wm-text-subtle whitespace-nowrap shrink-0">used {snippet.used_count}×</span>
      <WMIconButton label="Archive snippet" size="sm" onClick={onArchive} className="opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 size={13} />
      </WMIconButton>
    </div>
  )
}

// ── Add snippet modal ────────────────────────────────────────────────

function AddSnippetModal({
  projectId, existing, onClose, onCreated,
}: {
  projectId: string
  existing: WebProjectSnippet[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('')
  const [expansion, setExpansion] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLabelChange = (v: string) => {
    setLabel(v)
    if (!token || token === toToken(label)) setToken(toToken(v))
  }

  const save = async () => {
    setError(null)
    if (!token.trim() || !label.trim() || !expansion.trim()) {
      setError('Token, label, and expansion are required.'); return
    }
    if (existing.some(s => s.token === token.trim())) {
      setError(`Token "${token}" is already in use.`); return
    }
    setSaving(true)
    const { error: err } = await supabase.from('web_project_snippets').insert({
      web_project_id: projectId,
      token: token.trim(),
      label: label.trim(),
      expansion: expansion.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      source: 'manual',
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    await onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-wm-text/30 backdrop-blur-[1px] animate-wm-fade-in p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-wm-bg-elevated rounded-lg border border-wm-border shadow-2xl w-full max-w-lg p-5 animate-wm-slide-in-up">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-wm-text">Add custom snippet</h3>
            <p className="text-[12px] text-wm-text-muted mt-0.5">
              Reusable text for this project. Reference as <code className="text-wm-accent-strong">{'{{token}}'}</code> in body copy.
            </p>
          </div>
          <WMIconButton label="Close" onClick={onClose}><X size={14} /></WMIconButton>
        </div>
        <div className="space-y-3">
          <Field label="Label">
            <input
              type="text"
              value={label}
              onChange={e => handleLabelChange(e.target.value)}
              autoFocus
              placeholder="Disciples Serve tagline"
              className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </Field>
          <Field label="Token">
            <div className="flex items-center gap-1">
              <span className="text-sm text-wm-text-subtle">{'{{'}</span>
              <input
                type="text"
                value={token}
                onChange={e => setToken(toToken(e.target.value))}
                placeholder="disciples_serve_tagline"
                className="flex-1 h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
              />
              <span className="text-sm text-wm-text-subtle">{'}}'}</span>
            </div>
          </Field>
          <Field label="Expansion">
            <textarea
              value={expansion}
              onChange={e => setExpansion(e.target.value)}
              rows={3}
              placeholder="The text or paragraph that replaces this token."
              className="w-full rounded-md bg-wm-bg border border-wm-border px-3 py-2 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </Field>
          <Field label="Tags (comma-separated, optional)">
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="ministry, volunteer"
              className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </Field>
          {error && <p className="text-[12px] text-wm-danger">{error}</p>}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
          <WMButton variant="primary" size="sm" loading={saving} onClick={save}>Add snippet</WMButton>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">{label}</label>
      {children}
    </div>
  )
}

function toToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}
