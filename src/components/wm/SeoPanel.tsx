/**
 * Per-page SEO / AEO / GEO authoring panel.
 *
 * Mounted as the AssistantRail's SEO tab. Reads + writes
 * web_pages.seo (jsonb). Fields are intentionally text-heavy and
 * short — the goal is to give strategists a home for the structured
 * fields that already shape how the site gets indexed + how AI
 * answer engines + local pack pull from it.
 *
 * Save-on-blur to keep autosave cheap (no debounced thrash on every
 * keystroke). Failures surface as an inline pill.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { WebPageSeo } from '../../types/database'

interface Props {
  pageId: string
}

interface FormState {
  // SEO
  seoTitle:        string
  metaDescription: string
  focusKeywords:   string   // comma-separated in the form, array on save
  canonicalUrl:    string
  // AEO
  answerIntent:    string
  qa:              Array<{ q: string; a: string }>
  // GEO
  serviceAreas:    string   // comma-separated
  localKeywords:   string
  localLandmarks:  string
}

const EMPTY: FormState = {
  seoTitle: '', metaDescription: '', focusKeywords: '', canonicalUrl: '',
  answerIntent: '', qa: [],
  serviceAreas: '', localKeywords: '', localLandmarks: '',
}

function csv(arr: unknown): string {
  return Array.isArray(arr) ? (arr as unknown[]).map(String).join(', ') : ''
}
function uncsv(s: string): string[] {
  return s.split(',').map(t => t.trim()).filter(Boolean)
}

function seoToForm(seo: WebPageSeo | null): FormState {
  if (!seo) return EMPTY
  const s = seo.seo ?? {}
  const a = seo.aeo ?? {}
  const g = seo.geo ?? {}
  return {
    seoTitle:        s.title ?? '',
    metaDescription: s.meta_description ?? '',
    focusKeywords:   csv(s.focus_keywords),
    canonicalUrl:    s.canonical_url ?? '',
    answerIntent:    a.answer_intent ?? '',
    qa:              Array.isArray(a.structured_qa) ? a.structured_qa : [],
    serviceAreas:    csv(g.service_areas),
    localKeywords:   csv(g.local_keywords),
    localLandmarks:  g.local_landmarks ?? '',
  }
}

function formToSeo(f: FormState): WebPageSeo {
  return {
    seo: {
      title:            f.seoTitle.trim() || undefined,
      meta_description: f.metaDescription.trim() || undefined,
      focus_keywords:   uncsv(f.focusKeywords).length > 0 ? uncsv(f.focusKeywords) : undefined,
      canonical_url:    f.canonicalUrl.trim() || undefined,
    },
    aeo: {
      answer_intent: f.answerIntent.trim() || undefined,
      structured_qa: f.qa.filter(x => x.q.trim() || x.a.trim()),
    },
    geo: {
      service_areas:   uncsv(f.serviceAreas).length > 0 ? uncsv(f.serviceAreas) : undefined,
      local_keywords:  uncsv(f.localKeywords).length > 0 ? uncsv(f.localKeywords) : undefined,
      local_landmarks: f.localLandmarks.trim() || undefined,
    },
  }
}

export function SeoPanel({ pageId }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageName, setPageName] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: e } = await supabase
      .from('web_pages')
      .select('name, seo')
      .eq('id', pageId)
      .maybeSingle()
    if (e) setError(e.message)
    const row = data as { name?: string; seo?: WebPageSeo | null } | null
    setPageName(row?.name ?? '')
    setForm(seoToForm(row?.seo ?? null))
    setLoading(false)
  }, [pageId])

  useEffect(() => { void load() }, [load])

  const save = async (next: FormState) => {
    setSaving(true)
    setError(null)
    const { error: e } = await supabase
      .from('web_pages')
      .update({ seo: formToSeo(next), updated_at: new Date().toISOString() } as never)
      .eq('id', pageId)
    if (e) setError(e.message)
    setSaving(false)
  }

  // Blur-fires-save pattern keeps autosave traffic low — no per-keystroke
  // network. A pending save indicator surfaces in the header.
  const onBlur = () => void save(form)

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const setQaItem = (idx: number, patch: Partial<{ q: string; a: string }>) => {
    setForm(prev => {
      const next = { ...prev, qa: prev.qa.map((x, i) => i === idx ? { ...x, ...patch } : x) }
      return next
    })
  }
  const addQa = () => setForm(prev => ({ ...prev, qa: [...prev.qa, { q: '', a: '' }] }))
  const removeQa = (idx: number) => {
    const next = { ...form, qa: form.qa.filter((_, i) => i !== idx) }
    setForm(next)
    void save(next)
  }

  if (loading) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-wm-bg-hover animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-3 space-y-4 text-[12px] text-wm-text">
      <header className="px-1">
        <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">SEO · AEO · GEO</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="font-semibold truncate">{pageName || 'Page'}</p>
          {saving && (
            <span className="text-[10px] text-wm-text-subtle inline-flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" /> Saving
            </span>
          )}
        </div>
        {error && (
          <p className="text-[10px] text-wm-danger inline-flex items-center gap-1 mt-1">
            <AlertTriangle size={10} /> {error}
          </p>
        )}
      </header>

      {/* ── SEO ─────────────────────────────────────────── */}
      <FieldGroup label="SEO">
        <Field label="SEO title" hint="Browser tab + Google blue link. 50–60 chars works best.">
          <input
            type="text"
            value={form.seoTitle}
            onChange={(e) => setField('seoTitle', e.target.value)}
            onBlur={onBlur}
            className={inputCls}
          />
        </Field>
        <Field label="Meta description" hint="The snippet under the blue link. 150–160 chars.">
          <textarea
            value={form.metaDescription}
            onChange={(e) => setField('metaDescription', e.target.value)}
            onBlur={onBlur}
            rows={3}
            className={textareaCls}
          />
        </Field>
        <Field label="Focus keywords" hint="Comma-separated.">
          <input
            type="text"
            value={form.focusKeywords}
            onChange={(e) => setField('focusKeywords', e.target.value)}
            onBlur={onBlur}
            placeholder="church near me, sunday service kent"
            className={inputCls}
          />
        </Field>
        <Field label="Canonical URL" hint="Use only if this page should canonicalize to somewhere else.">
          <input
            type="text"
            value={form.canonicalUrl}
            onChange={(e) => setField('canonicalUrl', e.target.value)}
            onBlur={onBlur}
            placeholder="https://riverwood.life/visit"
            className={inputCls}
          />
        </Field>
      </FieldGroup>

      {/* ── AEO ─────────────────────────────────────────── */}
      <FieldGroup label="AEO (Answer engine)">
        <Field label="Answer intent" hint="What question does this page answer? Plain English, one sentence.">
          <textarea
            value={form.answerIntent}
            onChange={(e) => setField('answerIntent', e.target.value)}
            onBlur={onBlur}
            rows={2}
            placeholder="What time are services at Riverwood and what should a first-time visitor expect?"
            className={textareaCls}
          />
        </Field>
        <Field label="Structured Q&A" hint="Each Q&A maps to a FAQ schema block + answer-engine source.">
          <ul className="space-y-2">
            {form.qa.map((item, idx) => (
              <li key={idx} className="rounded-md border border-wm-border bg-wm-bg p-2 space-y-1.5">
                <input
                  type="text"
                  value={item.q}
                  onChange={(e) => setQaItem(idx, { q: e.target.value })}
                  onBlur={onBlur}
                  placeholder="Question"
                  className={inputCls}
                />
                <textarea
                  value={item.a}
                  onChange={(e) => setQaItem(idx, { a: e.target.value })}
                  onBlur={onBlur}
                  rows={2}
                  placeholder="Answer"
                  className={textareaCls}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeQa(idx)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-wm-text-subtle hover:text-wm-danger"
                    aria-label="Remove Q&A pair"
                  >
                    <Trash2 size={10} /> Remove
                  </button>
                </div>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={addQa}
                className="w-full inline-flex items-center justify-center gap-1 h-8 rounded-md border border-dashed border-wm-border text-[11px] font-medium text-wm-text-muted hover:border-wm-border-focus hover:text-wm-text"
              >
                <Plus size={10} /> Add Q&A
              </button>
            </li>
          </ul>
        </Field>
      </FieldGroup>

      {/* ── GEO ─────────────────────────────────────────── */}
      <FieldGroup label="GEO (Local targeting)">
        <Field label="Service areas" hint="Cities or neighborhoods this page targets. Comma-separated.">
          <input
            type="text"
            value={form.serviceAreas}
            onChange={(e) => setField('serviceAreas', e.target.value)}
            onBlur={onBlur}
            placeholder="Kent OH, Akron OH, Stow OH"
            className={inputCls}
          />
        </Field>
        <Field label="Local keywords" hint="Comma-separated.">
          <input
            type="text"
            value={form.localKeywords}
            onChange={(e) => setField('localKeywords', e.target.value)}
            onBlur={onBlur}
            placeholder="church in kent, kent ohio church"
            className={inputCls}
          />
        </Field>
        <Field label="Landmarks / regional context" hint="Anything useful for local pack and AI answers.">
          <textarea
            value={form.localLandmarks}
            onChange={(e) => setField('localLandmarks', e.target.value)}
            onBlur={onBlur}
            rows={2}
            className={textareaCls}
          />
        </Field>
      </FieldGroup>
    </div>
  )
}

const inputCls    = 'w-full rounded-md border border-wm-border bg-wm-bg px-2 py-1.5 text-[12px] text-wm-text outline-none focus:border-wm-border-focus focus:ring-2 focus:ring-wm-border-focus/15'
const textareaCls = `${inputCls} resize-y leading-snug`

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-wm-border/60 bg-wm-bg-elevated p-2.5 space-y-2.5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong px-1">{label}</p>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block px-1">
      <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-0.5">{label}</p>
      {hint && <p className="text-[10px] text-wm-text-subtle leading-snug mb-1">{hint}</p>}
      {children}
    </label>
  )
}
