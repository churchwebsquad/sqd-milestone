/**
 * Website Manager — Brixies library (admin / inspection).
 *
 * Deliberately lean. This page is NOT the workflow surface — actual
 * template selection happens via a reusable side panel that the
 * Sitemap Editor, Brand Design Setup, and Content Manager all host.
 *
 * This page exists for:
 *   1. Verifying the parser import produced sane results
 *   2. Inspecting a specific template's schema (slots + groups +
 *      heading levels + paired post template) when debugging
 *   3. Hosting the eventual in-app "Add Template" form
 *
 * Layout: dense table + click-to-open side flyout. No marketing-grid
 * cards; the workflow surfaces handle that.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ExternalLink, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type {
  WebContentTemplate, WebFieldDef, WebGroupDef, WebSlotDef, WebTemplateKind,
} from '../../types/database'

// Display labels (UI-facing). The underlying kind values stay as
// 'chrome' / 'functional' in the DB and taxonomy — these just render
// in a way that's clearer in real-world context: chrome → "Global"
// (renders on every page); functional → "Filter" (in-page filter UI).
const KIND_LABELS: Record<WebTemplateKind, string> = {
  content:       'Content',
  chrome:        'Global',
  functional:    'Filter',
  media:         'Media',
  embed:         'Embed',
  component:     'Component',
  post_template: 'Post template',
}

const KIND_TONE: Record<WebTemplateKind, string> = {
  content:       'bg-lavender-tint text-primary-purple border-lavender',
  chrome:        'bg-deep-plum/8 text-deep-plum border-deep-plum/15',
  functional:    'bg-amber-50 text-amber-800 border-amber-200',
  media:         'bg-rose-50 text-rose-800 border-rose-200',
  embed:         'bg-emerald-50 text-emerald-800 border-emerald-200',
  component:     'bg-sky-50 text-sky-800 border-sky-200',
  post_template: 'bg-violet-50 text-violet-800 border-violet-200',
}

export default function WebTemplatesPage() {
  const [rows, setRows] = useState<WebContentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<WebTemplateKind | 'all'>('all')
  const [familyFilter, setFamilyFilter] = useState<string | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error: err } = await supabase
        .from('web_content_templates')
        .select('*')
        .order('family')
        .order('layer_name')
      if (cancelled) return
      if (err) setError(err.message)
      else setRows((data ?? []) as WebContentTemplate[])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const kindCounts = useMemo(() => {
    const out = new Map<WebTemplateKind | 'all', number>()
    out.set('all', rows.length)
    for (const r of rows) out.set(r.kind, (out.get(r.kind) ?? 0) + 1)
    return out
  }, [rows])

  const families = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      if (kindFilter !== 'all' && r.kind !== kindFilter) continue
      set.add(r.family)
    }
    return [...set].sort()
  }, [rows, kindFilter])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (familyFilter !== 'all' && r.family !== familyFilter) return false
      if (!q) return true
      const hay = `${r.family} ${r.layer_name} ${r.id}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, kindFilter, familyFilter])

  const selected = useMemo(
    () => rows.find(r => r.id === selectedId) ?? null,
    [rows, selectedId],
  )

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb + heading */}
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center flex-wrap gap-1 text-xs text-purple-gray">
          <Link to="/web" className="hover:text-primary-purple transition-colors">Website Manager</Link>
          <span className="opacity-60">›</span>
          <span className="text-deep-plum font-semibold">Brixies library</span>
        </nav>
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Admin</p>
            <h1 className="text-2xl font-semibold text-deep-plum">Brixies library</h1>
            <p className="text-sm text-purple-gray mt-1 max-w-2xl">
              Read-only inspection of the parsed template catalog. Used to verify imports and
              inspect a specific template's slot/group schema. Selecting a template happens
              in the workflow surfaces (Sitemap Editor, Brand Design, Content Manager).
            </p>
          </div>
          <p className="text-xs text-purple-gray whitespace-nowrap">
            {rows.length} templates · {families.length || '–'} families shown
          </p>
        </div>

        {/* Filters */}
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          {(['all','content','chrome','component','media','functional','post_template','embed'] as const).map(k => {
            const count = kindCounts.get(k) ?? 0
            if (k !== 'all' && count === 0) return null
            const active = kindFilter === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => { setKindFilter(k); setFamilyFilter('all') }}
                className={[
                  'rounded-full text-xs font-semibold px-3 py-1 transition-colors border',
                  active
                    ? 'bg-deep-plum text-white border-deep-plum'
                    : 'bg-white text-deep-plum border-lavender hover:border-primary-purple',
                ].join(' ')}
              >
                {k === 'all' ? 'All' : KIND_LABELS[k]}
                <span className={['ml-1.5 text-[10px]', active ? 'opacity-70' : 'text-purple-gray'].join(' ')}>{count}</span>
              </button>
            )
          })}
        </div>

        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-gray/60" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by family, layer name, or id…"
              className="w-full rounded-full border border-lavender bg-white pl-9 pr-9 py-2 text-sm text-deep-plum placeholder-purple-gray/60 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-gray hover:text-deep-plum"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            value={familyFilter}
            onChange={e => setFamilyFilter(e.target.value)}
            className="rounded-full border border-lavender bg-white px-4 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          >
            <option value="all">All families</option>
            {families.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        {/* Results */}
        {loading && (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 bg-lavender-tint/40 rounded-lg animate-pulse" />
            ))}
          </div>
        )}
        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Couldn't load library: {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-lavender bg-white/50 px-4 py-10 text-center text-sm text-purple-gray">
            {rows.length === 0
              ? 'Catalog is empty. Run scripts/import-brixies-catalog.mjs to seed.'
              : 'No templates match these filters.'}
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="rounded-xl border border-lavender bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-widest text-purple-gray/80 bg-lavender-tint/30">
                <tr>
                  <th className="px-3 py-2 w-20">Preview</th>
                  <th className="px-3 py-2">Template</th>
                  <th className="px-3 py-2 hidden md:table-cell">Kind</th>
                  <th className="px-3 py-2 hidden md:table-cell">Schema</th>
                  <th className="px-3 py-2 hidden lg:table-cell">Paired post</th>
                  <th className="px-3 py-2 w-8" aria-label="open"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(t => (
                  <TemplateTableRow
                    key={t.id}
                    template={t}
                    active={selectedId === t.id}
                    onClick={() => setSelectedId(t.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <TemplateFlyout
          template={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

// ── Table row ──────────────────────────────────────────────────────────

function TemplateTableRow({
  template, active, onClick,
}: {
  template: WebContentTemplate
  active: boolean
  onClick: () => void
}) {
  const { slotCount, groupCount } = summarizeFields(template.fields)
  return (
    <tr
      onClick={onClick}
      className={[
        'border-t border-lavender cursor-pointer transition-colors',
        active ? 'bg-lavender-tint/50' : 'hover:bg-lavender-tint/25',
      ].join(' ')}
    >
      <td className="px-3 py-2">
        {template.preview_image_url ? (
          <img
            src={template.preview_image_url}
            alt=""
            className="w-16 h-12 object-cover rounded-md border border-lavender bg-white"
            loading="lazy"
          />
        ) : (
          <div className="w-16 h-12 rounded-md border border-dashed border-lavender bg-lavender-tint/30 grid place-items-center text-[9px] text-purple-gray/70">
            no preview
          </div>
        )}
      </td>
      <td className="px-3 py-2 min-w-0">
        <div className="font-semibold text-deep-plum truncate">{template.layer_name}</div>
        <div className="text-[11px] text-purple-gray truncate">
          {template.family}{template.variant ? ` · v${template.variant}` : ''}
        </div>
      </td>
      <td className="px-3 py-2 hidden md:table-cell">
        <KindBadge kind={template.kind} />
      </td>
      <td className="px-3 py-2 hidden md:table-cell text-[11px] text-purple-gray whitespace-nowrap">
        {slotCount} slot{slotCount === 1 ? '' : 's'}
        {groupCount > 0 && <> · {groupCount} group{groupCount === 1 ? '' : 's'}</>}
      </td>
      <td className="px-3 py-2 hidden lg:table-cell text-[11px] text-purple-gray">
        {template.paired_post_template ?? <span className="opacity-50">—</span>}
      </td>
      <td className="px-3 py-2 text-purple-gray/60">
        <ChevronRight size={14} />
      </td>
    </tr>
  )
}

function summarizeFields(fields: WebFieldDef[]): { slotCount: number; groupCount: number } {
  let slotCount = 0
  let groupCount = 0
  for (const f of fields) {
    if (f.kind === 'group') groupCount++
    else slotCount++
  }
  return { slotCount, groupCount }
}

function KindBadge({ kind }: { kind: WebTemplateKind }) {
  return (
    <span className={[
      'inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border whitespace-nowrap',
      KIND_TONE[kind],
    ].join(' ')}>
      {KIND_LABELS[kind]}
    </span>
  )
}

// ── Flyout ─────────────────────────────────────────────────────────────

function TemplateFlyout({
  template, onClose,
}: {
  template: WebContentTemplate
  onClose: () => void
}) {
  const [htmlOpen, setHtmlOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-deep-plum/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative w-full max-w-xl h-full bg-cream border-l border-lavender shadow-2xl overflow-y-auto">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-cream border-b border-lavender px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">
              {template.family}{template.variant ? ` · ${template.variant}` : ''}
            </p>
            <h2 className="text-lg font-semibold text-deep-plum truncate">{template.layer_name}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <KindBadge kind={template.kind} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-purple-gray hover:bg-lavender-tint hover:text-deep-plum transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Preview */}
          {template.preview_image_url ? (
            <a
              href={template.preview_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-lavender bg-white overflow-hidden hover:border-primary-purple transition-colors group"
            >
              <img
                src={template.preview_image_url}
                alt={`${template.layer_name} preview`}
                className="w-full h-auto block"
                loading="lazy"
              />
              <div className="px-3 py-1.5 text-[10px] text-purple-gray flex items-center gap-1 group-hover:text-primary-purple transition-colors">
                <ExternalLink size={11} /> Open full size
              </div>
            </a>
          ) : (
            <div className="rounded-xl border border-dashed border-lavender bg-white p-6 text-center text-xs text-purple-gray">
              No preview image. JPG should be at <code>brand-assets/web-templates/{template.id}.jpg</code>.
            </div>
          )}

          {/* Paired post + references */}
          {(template.paired_post_template || template.paired_url_pattern) && (
            <Block label="Paired post template">
              <div className="text-xs text-deep-plum">
                <span className="font-semibold">{template.paired_post_template}</span>
                {template.paired_url_pattern && (
                  <span className="text-purple-gray ml-2">{template.paired_url_pattern}</span>
                )}
              </div>
              <p className="text-[10px] text-purple-gray mt-1">
                Auto-adds a detail page when this listing is placed on a project in WordPress display mode.
              </p>
            </Block>
          )}

          {/* Schema */}
          <Block label={`Schema · ${template.fields.length} top-level field${template.fields.length === 1 ? '' : 's'}`}>
            {template.fields.length === 0 ? (
              <p className="text-xs text-purple-gray italic">No fields parsed for this template.</p>
            ) : (
              <ul className="space-y-1">
                {template.fields.map((f, i) => <FieldNode key={`${f.key}-${i}`} field={f} depth={0} />)}
              </ul>
            )}
          </Block>

          {/* Metadata */}
          <Block label="Metadata">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-purple-gray">id</dt>
              <dd className="text-deep-plum font-mono">{template.id}</dd>
              <dt className="text-purple-gray">layer_name</dt>
              <dd className="text-deep-plum font-mono">{template.layer_name}</dd>
              <dt className="text-purple-gray">family · variant</dt>
              <dd className="text-deep-plum">{template.family} · {template.variant ?? '—'}</dd>
              <dt className="text-purple-gray">kind</dt>
              <dd className="text-deep-plum">{template.kind}</dd>
              <dt className="text-purple-gray">updated</dt>
              <dd className="text-deep-plum">{new Date(template.updated_at).toLocaleString()}</dd>
            </dl>
          </Block>

          {/* Source HTML (collapsed by default) */}
          <Block label="Source HTML">
            <button
              type="button"
              onClick={() => setHtmlOpen(o => !o)}
              className="text-xs text-primary-purple hover:underline"
            >
              {htmlOpen ? 'Hide' : `Show (${(template.source_html?.length ?? 0).toLocaleString()} bytes, trimmed to one item per group)`}
            </button>
            {htmlOpen && (
              <pre className="mt-2 rounded-lg bg-white border border-lavender p-3 text-[10px] text-deep-plum overflow-auto max-h-96 whitespace-pre-wrap">
                {template.source_html}
              </pre>
            )}
          </Block>
        </div>
      </aside>
    </div>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray/80 mb-2">{label}</p>
      {children}
    </section>
  )
}

// ── Recursive field rendering ──────────────────────────────────────────

function FieldNode({ field, depth }: { field: WebFieldDef; depth: number }) {
  if (field.kind === 'group') return <GroupNode group={field} depth={depth} />
  return <SlotNode slot={field} depth={depth} />
}

function SlotNode({ slot, depth }: { slot: WebSlotDef; depth: number }) {
  const indent = depth === 0 ? '' : `pl-${Math.min(depth * 4, 12)}`
  return (
    <li className={`text-xs ${indent}`} style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}>
      <div className="rounded-md bg-white border border-lavender px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-primary-purple font-bold">slot</span>
        <span className="font-semibold text-deep-plum">{slot.key}</span>
        <span className="text-[10px] text-purple-gray uppercase tracking-wide">{slot.type}</span>
        {slot.required && <span className="text-[10px] text-red-600">required</span>}
        {slot.heading_level && (
          <span className="text-[10px] text-purple-gray">H{slot.heading_level}</span>
        )}
        {slot.max_chars && (
          <span className="text-[10px] text-purple-gray">≤ {slot.max_chars}ch</span>
        )}
        {slot.scope && (
          <span className="text-[10px] text-purple-gray italic">scope: {slot.scope}</span>
        )}
        {slot.auto_populated && (
          <span className="text-[10px] text-amber-700">auto from {slot.source}</span>
        )}
        {slot.default_value && (
          <span className="text-[10px] text-emerald-700">default: {slot.default_value}</span>
        )}
        {slot.unmapped && (
          <span className="text-[10px] text-rose-600">unmapped</span>
        )}
      </div>
    </li>
  )
}

function GroupNode({ group, depth }: { group: WebGroupDef; depth: number }) {
  const [open, setOpen] = useState(depth === 0)
  return (
    <li className="text-xs" style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left rounded-md bg-lavender-tint border border-lavender hover:border-primary-purple px-2.5 py-1.5 flex items-center gap-2 flex-wrap transition-colors"
      >
        <span className="text-[10px] uppercase tracking-wide text-primary-purple font-bold">group</span>
        <span className="font-semibold text-deep-plum">{group.key}</span>
        <span className="text-[10px] text-purple-gray">default {group.default_count}</span>
        {group.item_template_ref === 'from_palette' && (
          <span className="text-[10px] text-sky-700">item: card from palette</span>
        )}
        {group.item_template_ref === 'section_ref' && (
          <span className="text-[10px] text-violet-700">item: → {group.referenced_template_id}</span>
        )}
        {group.single_instance_hint && (
          <span className="text-[10px] text-purple-gray italic">single instance</span>
        )}
        {group.numbered_sibling_variants && (
          <span className="text-[10px] text-purple-gray italic">numbered siblings</span>
        )}
        <span className="ml-auto text-[10px] text-purple-gray">{open ? 'hide' : 'show'} items</span>
      </button>
      {open && group.item_schema.length > 0 && (
        <ul className="mt-1 space-y-1 border-l-2 border-lavender ml-2 pl-2">
          {group.item_schema.map((f, i) => (
            <FieldNode key={`${f.key}-${i}`} field={f} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
