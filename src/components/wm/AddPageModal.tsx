/**
 * Web Manager — Add Page modal.
 *
 * Inline form used from the Pages workspace left panel to create a
 * new web_page row in a specific phase. Slug auto-derives from name;
 * duplicates within the project are blocked client-side.
 *
 * Extracted from the old SitemapWorkspace when page-tree management
 * folded into Pages (Phase 2 of the workspace restructure).
 */
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { WMButton } from './Button'
import type { WebPage } from '../../types/database'

interface Props {
  projectId: string
  phase: string
  existingPages: WebPage[]
  onClose: () => void
  onCreated: () => Promise<void>
}

export function AddPageModal({ projectId, phase, existingPages, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (v: string) => {
    setName(v)
    if (!slug || slug === toSlug(name)) setSlug(toSlug(v))
  }

  const save = async () => {
    setError(null)
    if (!name.trim() || !slug.trim()) { setError('Name and slug are required.'); return }
    if (existingPages.some(p => p.slug === slug.trim())) {
      setError(`Slug "${slug}" is already in use on this project.`); return
    }
    setSaving(true)
    const maxOrder = existingPages.filter(p => p.phase === phase).reduce((m, p) => Math.max(m, p.sort_order), 0)
    const { error: insertErr } = await supabase.from('web_pages').insert({
      web_project_id: projectId,
      name: name.trim(),
      slug: slug.trim(),
      phase,
      sort_order: maxOrder + 1,
    })
    setSaving(false)
    if (insertErr) { setError(insertErr.message); return }
    await onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-wm-text/30 backdrop-blur-[1px] animate-wm-fade-in"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-wm-bg-elevated rounded-lg border border-wm-border shadow-2xl w-full max-w-md p-5 animate-wm-slide-in-up"
      >
        <h3 className="text-[15px] font-semibold text-wm-text mb-1">Add page</h3>
        <p className="text-[12px] text-wm-text-muted mb-4">
          Phase: <span className="font-semibold text-wm-text">{phase}</span>
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Page name</label>
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              autoFocus
              placeholder="e.g. Plan a Visit"
              className="w-full h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Slug</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-wm-text-subtle">/</span>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(toSlug(e.target.value))}
                placeholder="plan-a-visit"
                className="flex-1 h-9 rounded-md bg-wm-bg border border-wm-border px-3 text-sm text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/20"
              />
            </div>
          </div>
          {error && <p className="text-[12px] text-wm-danger">{error}</p>}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <WMButton variant="ghost" size="sm" onClick={onClose}>Cancel</WMButton>
          <WMButton variant="primary" size="sm" loading={saving} onClick={save}>Create page</WMButton>
        </div>
      </div>
    </div>
  )
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}
