/**
 * Partner-facing web review portal.
 *
 * URL: /portal/review/<token>
 *   - Public (no auth). The token IS the credential — anyone with the
 *     link can leave feedback. Tokens are generated from a v4 UUID
 *     when the strategist clicks "Start partner review" in Site Manager.
 *
 * Flow:
 *   1. Look up the review by partner_token. If not found, status=closed,
 *      or kind!=partner → polite "review not available" screen.
 *   2. Capture the partner's name on first visit. Persist locally and
 *      also update web_reviews.partner_name if it's still null.
 *   3. Render the project's pages as a preview (Brixies HTML) with a
 *      sidebar nav. Sections are clickable; clicking opens a slide-in
 *      drawer with a feedback form.
 *   4. Drawer captures: general comment, optional field-specific
 *      suggested edits, optional image attachment. Submitting creates
 *      web_review_comments rows (kind='comment' for general,
 *      kind='requested' for field-specific edits) tied to the review
 *      with author_kind='partner', plus web_review_attachments for any
 *      uploaded screenshots.
 *
 * Direct field writes are intentionally NOT possible from this surface
 * — every partner change becomes a request that staff must apply,
 * amend, or dismiss in Site Manager.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, FileText, Loader2, MessageSquarePlus, Paperclip,
  Send, X, Check, ImagePlus, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { uploadAttachment } from '../lib/attachmentUpload'
import { PagePreview } from '../components/wm/PagePreview'
import { augmentTemplate } from '../lib/webBrixiesSchemaAugment'
import { loadEditorSnippets } from '../lib/webSnippets'
import type { SnippetMap } from '../lib/webBrixiesRender'
import type {
  WebReview, WebPage, WebSection, WebContentTemplate, WebFieldDef,
  StrategyWebProject,
} from '../types/database'

// ── Local state shapes ─────────────────────────────────────────────

interface PortalData {
  review: WebReview
  project: StrategyWebProject
  pages: WebPage[]
  sectionsByPage: Record<string, WebSection[]>
  templates: Record<string, WebContentTemplate>
  snippetMap: SnippetMap
}

interface FieldSuggestion {
  field_key: string
  layer_name: string
  field_type: 'text' | 'richtext' | 'cta'
  original_value: unknown
  proposed_value: string
}

interface DraftComment {
  /** The section being commented on. */
  section: WebSection
  /** General feedback body (creates kind='comment' row). */
  body: string
  /** Per-field proposed edits (each creates kind='requested' row). */
  suggestions: FieldSuggestion[]
  /** Selected file pending upload. */
  attachment: File | null
}

// ── Page ────────────────────────────────────────────────────────────

export default function PortalReviewPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftComment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [recentSubmissions, setRecentSubmissions] = useState(0)

  // ── Load on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (!token) {
      setError('No review token in the URL.')
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const { data: review, error: rErr } = await supabase
          .from('web_reviews')
          .select('*')
          .eq('partner_token', token)
          .eq('kind', 'partner')
          .maybeSingle()
        if (rErr) throw new Error(rErr.message)
        if (!review)            { setError('This review link is invalid.'); return }
        if (review.status === 'closed') { setError('This review has been closed by the team.'); return }

        const projectId = (review as WebReview).web_project_id
        const [
          { data: project, error: pErr },
          { data: pageRows },
        ] = await Promise.all([
          supabase.from('strategy_web_projects').select('*').eq('id', projectId).maybeSingle(),
          supabase.from('web_pages').select('*').eq('web_project_id', projectId).eq('archived', false).order('sort_order'),
        ])
        if (pErr) throw new Error(pErr.message)
        if (!project) { setError('Project not found.'); return }
        const pages = (pageRows ?? []) as WebPage[]

        // Sections for every page
        const pageIds = pages.map(p => p.id)
        let sectionRows: WebSection[] = []
        if (pageIds.length > 0) {
          const { data: secRows } = await supabase
            .from('web_sections')
            .select('*')
            .in('web_page_id', pageIds)
            .order('sort_order')
          sectionRows = (secRows ?? []) as WebSection[]
        }
        const sectionsByPage: Record<string, WebSection[]> = {}
        for (const s of sectionRows) {
          (sectionsByPage[s.web_page_id] ??= []).push(s)
        }

        // Templates — augment so the field schemas match what the editor sees.
        const tplIds = Array.from(new Set(sectionRows.map(s => s.content_template_id).filter((x): x is string => !!x)))
        const templates: Record<string, WebContentTemplate> = {}
        if (tplIds.length > 0) {
          const { data: tplRows } = await supabase
            .from('web_content_templates')
            .select('*')
            .in('id', tplIds)
          for (const t of (tplRows ?? []) as WebContentTemplate[]) {
            templates[t.id] = augmentTemplate(t)
          }
        }

        const snippetList = await loadEditorSnippets(project as StrategyWebProject)
        const snippetMap: Record<string, string> = {}
        for (const sn of snippetList) snippetMap[sn.token] = sn.resolvedValue

        if (cancelled) return
        setData({
          review:        review as WebReview,
          project:       project as StrategyWebProject,
          pages,
          sectionsByPage,
          templates,
          snippetMap,
        })

        // Pick the first page by default
        setActivePageId(pages[0]?.id ?? null)

        // Partner name: prefer localStorage, fall back to whatever the
        // review has stored, fall back to prompting.
        const stored = window.localStorage.getItem(`partner_review_${token}_name`)
        const reviewName = (review as WebReview).partner_name
        if (stored)             setPartnerName(stored)
        else if (reviewName)    setPartnerName(reviewName)
        // else: leave null — name modal will show

      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load review.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // ── Render gates ────────────────────────────────────────────────

  if (loading) {
    return (
      <FullScreen>
        <Loader2 className="animate-spin text-deep-plum" size={28} />
      </FullScreen>
    )
  }
  if (error || !data) {
    return (
      <FullScreen>
        <div className="rounded-2xl bg-white border border-lavender px-6 py-6 max-w-md text-center">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary-purple mb-1">Review unavailable</p>
          <p className="text-[14px] text-deep-plum">{error ?? 'Something went wrong.'}</p>
          <p className="text-[12px] text-purple-gray mt-2">
            If you think this is a mistake, contact your Church Media Squad team for a fresh link.
          </p>
        </div>
      </FullScreen>
    )
  }
  if (!partnerName) {
    return (
      <NameCaptureModal
        onSubmit={async (name) => {
          const trimmed = name.trim()
          if (!trimmed) return
          window.localStorage.setItem(`partner_review_${token}_name`, trimmed)
          setPartnerName(trimmed)
          // First partner to identify themselves — record on the review row.
          if (!data.review.partner_name) {
            await supabase
              .from('web_reviews')
              .update({ partner_name: trimmed } as never)
              .eq('id', data.review.id)
          }
        }}
        projectName={data.project.name}
      />
    )
  }

  // ── Main UI ─────────────────────────────────────────────────────

  const activePage = data.pages.find(p => p.id === activePageId) ?? null
  const activeSections = activePage ? (data.sectionsByPage[activePage.id] ?? []) : []

  const startComment = (sectionId: string) => {
    const section = data.sectionsByPage[activePageId!]?.find(s => s.id === sectionId)
    if (!section) return
    setDraft({ section, body: '', suggestions: [], attachment: null })
  }

  const submit = async () => {
    if (!draft) return
    setSubmitting(true)
    try {
      const inserts: Array<Record<string, unknown>> = []
      if (draft.body.trim()) {
        inserts.push({
          review_id:           data.review.id,
          web_page_id:         draft.section.web_page_id,
          web_section_id:      draft.section.id,
          field_key:           null,
          author_kind:         'partner',
          author_external_name: partnerName,
          kind:                'comment',
          body:                draft.body.trim(),
        })
      }
      for (const s of draft.suggestions) {
        if (!s.proposed_value.trim()) continue
        inserts.push({
          review_id:           data.review.id,
          web_page_id:         draft.section.web_page_id,
          web_section_id:      draft.section.id,
          field_key:           s.field_key,
          author_kind:         'partner',
          author_external_name: partnerName,
          kind:                'requested',
          body:                null,
          original_value:      s.original_value,
          suggested_value:     s.proposed_value,
        })
      }
      if (inserts.length === 0) return
      const { data: insertedRows, error: insErr } = await supabase
        .from('web_review_comments')
        .insert(inserts as never)
        .select('id')
      if (insErr) throw new Error(insErr.message)

      // Attach the optional image to ALL created comment rows (so it
      // shows up alongside whatever the partner submitted — keeps the
      // attachment glued to context even if their feedback was a
      // mix of general + per-field).
      if (draft.attachment && insertedRows && insertedRows.length > 0) {
        const upload = await uploadAttachment(draft.attachment, null, undefined, {
          bucket:     'brand-assets',
          pathPrefix: `web-reviews/${data.review.id}`,
          allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
          maxBytes:   10 * 1024 * 1024,
        })
        const attachmentRows = (insertedRows as Array<{ id: string }>).map(c => ({
          comment_id:      c.id,
          storage_path:    upload.path,
          storage_url:     upload.url,
          filename:        upload.filename,
          mime_type:       draft.attachment!.type,
          file_size_bytes: draft.attachment!.size,
        }))
        await supabase.from('web_review_attachments').insert(attachmentRows as never)
      }

      setRecentSubmissions(n => n + 1)
      setDraft(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to submit feedback.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-lavender-tint/40 via-cream to-cream">
      {/* Top bar */}
      <header className="border-b border-lavender bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">
              {data.project.church_name ?? data.project.name} · Website review
            </p>
            <h1 className="text-[18px] font-semibold text-deep-plum truncate">
              {data.project.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-purple-gray">Reviewing as</p>
              <p className="text-[13px] font-semibold text-deep-plum">{partnerName}</p>
            </div>
            {recentSubmissions > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1">
                <Check size={11} /> {recentSubmissions} sent
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-4 py-6 flex gap-4 items-start">
        {/* Page nav */}
        <aside className="w-60 shrink-0 sticky top-[88px]">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-2 px-2">
            Pages · {data.pages.length}
          </p>
          <nav className="space-y-0.5">
            {data.pages.map(p => {
              const sectionCount = (data.sectionsByPage[p.id] ?? []).length
              const active = p.id === activePageId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePageId(p.id)}
                  className={[
                    'w-full text-left rounded-lg px-3 py-2 transition-colors flex items-center gap-2',
                    active
                      ? 'bg-deep-plum text-white'
                      : 'bg-white border border-lavender text-deep-plum hover:border-primary-purple',
                  ].join(' ')}
                >
                  <FileText size={13} className="shrink-0 opacity-80" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate">{p.name}</p>
                    <p className={[
                      'text-[10px] truncate',
                      active ? 'text-white/70' : 'text-purple-gray',
                    ].join(' ')}>
                      /{p.slug} · {sectionCount} section{sectionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </button>
              )
            })}
          </nav>
          <div className="mt-4 rounded-xl bg-white border border-lavender px-3 py-2.5">
            <p className="text-[11px] font-semibold text-deep-plum mb-1">How this works</p>
            <p className="text-[11px] text-purple-gray leading-snug">
              Click any section to leave a comment or request specific edits.
              Your feedback goes to the team — nothing changes on the live
              site until they review it.
            </p>
          </div>
        </aside>

        {/* Preview */}
        <main className="flex-1 min-w-0">
          {activePage ? (
            activeSections.length === 0 ? (
              <div className="text-center py-16 rounded-xl bg-white border border-lavender text-purple-gray text-[13px]">
                This page has no sections yet.
              </div>
            ) : (
              <PagePreview
                sections={activeSections}
                templates={data.templates}
                snippetMap={data.snippetMap}
                onSelectSection={startComment}
              />
            )
          ) : (
            <div className="text-center py-16 rounded-xl bg-white border border-lavender text-purple-gray">
              Pick a page to review.
            </div>
          )}
        </main>
      </div>

      {/* Comment drawer */}
      {draft && (
        <CommentDrawer
          draft={draft}
          setDraft={setDraft}
          submitting={submitting}
          onCancel={() => setDraft(null)}
          onSubmit={submit}
          template={draft.section.content_template_id ? data.templates[draft.section.content_template_id] ?? null : null}
        />
      )}
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-lavender-tint/40 via-cream to-cream p-6">
      {children}
    </div>
  )
}

function NameCaptureModal({
  onSubmit, projectName,
}: {
  onSubmit: (name: string) => Promise<void>
  projectName: string
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <FullScreen>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          setSaving(true)
          try { await onSubmit(name) } finally { setSaving(false) }
        }}
        className="rounded-2xl bg-white border border-lavender px-6 py-6 max-w-md w-full text-center shadow-sm"
      >
        <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">{projectName}</p>
        <h1 className="text-[20px] font-semibold text-deep-plum mb-1">Welcome to the review</h1>
        <p className="text-[13px] text-purple-gray mb-4">
          Let us know who's reviewing so your team can credit your feedback.
        </p>
        <label className="block text-left mb-4">
          <span className="text-[11px] uppercase tracking-widest font-bold text-purple-gray block mb-1">Your name</span>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            placeholder="Jane Doe"
            className="w-full rounded-full border border-lavender bg-white px-4 py-2 text-[14px] text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-[13px] font-semibold px-5 py-2 hover:bg-primary-purple transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
          Start reviewing
        </button>
      </form>
    </FullScreen>
  )
}

function CommentDrawer({
  draft, setDraft, submitting, onCancel, onSubmit, template,
}: {
  draft: DraftComment
  setDraft: (d: DraftComment | null) => void
  submitting: boolean
  onCancel: () => void
  onSubmit: () => Promise<void>
  template: WebContentTemplate | null
}) {
  const [showSpecific, setShowSpecific] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const editableFields = useMemo(() => {
    if (!template) return [] as Array<{ field: WebFieldDef & { kind: 'slot' }; current: unknown }>
    const values = (draft.section.field_values ?? {}) as Record<string, unknown>
    return (template.fields ?? [])
      .filter((f): f is WebFieldDef & { kind: 'slot' } =>
        f.kind === 'slot' &&
        (f.type === 'text' || f.type === 'richtext' || f.type === 'cta'),
      )
      .map(f => ({ field: f, current: values[f.key] }))
  }, [template, draft.section.field_values])

  const setBody = (body: string) => setDraft({ ...draft, body })
  const toggleSuggestion = (f: WebFieldDef & { kind: 'slot' }, current: unknown) => {
    const existing = draft.suggestions.find(s => s.field_key === f.key)
    if (existing) {
      setDraft({ ...draft, suggestions: draft.suggestions.filter(s => s.field_key !== f.key) })
    } else {
      const init = currentToProposedString(current)
      setDraft({
        ...draft,
        suggestions: [...draft.suggestions, {
          field_key:      f.key,
          layer_name:     f.layer_name ?? f.key,
          field_type:     f.type as FieldSuggestion['field_type'],
          original_value: current ?? null,
          proposed_value: init,
        }],
      })
    }
  }
  const setSuggestionValue = (field_key: string, proposed_value: string) => {
    setDraft({
      ...draft,
      suggestions: draft.suggestions.map(s =>
        s.field_key === field_key ? { ...s, proposed_value } : s,
      ),
    })
  }
  const setAttachment = (f: File | null) => setDraft({ ...draft, attachment: f })

  const canSubmit = (draft.body.trim() || draft.suggestions.some(s => s.proposed_value.trim())) && !submitting
  const sectionLabel = template?.layer_name ?? 'Freehand section'

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-deep-plum/30 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-lavender shadow-xl flex flex-col">
        <header className="px-5 py-4 border-b border-lavender flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">Comment on</p>
            <h2 className="text-[16px] font-semibold text-deep-plum truncate">{sectionLabel}</h2>
            <p className="text-[11px] text-purple-gray">{template?.family ?? ''}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 h-7 w-7 grid place-items-center rounded-full text-purple-gray hover:bg-lavender-tint hover:text-deep-plum transition-colors"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* General comment */}
          <div>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray block mb-1">
                Your feedback
              </span>
              <textarea
                value={draft.body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Tell the team what you'd like changed about this section."
                className="w-full rounded-xl border border-lavender bg-white px-3 py-2 text-[13px] text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15"
              />
            </label>
          </div>

          {/* Specific edits */}
          {editableFields.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowSpecific(s => !s)}
                className="text-[11px] font-semibold text-primary-purple hover:underline inline-flex items-center gap-1"
              >
                {showSpecific ? '−' : '+'} Suggest specific edits
              </button>
              {showSpecific && (
                <div className="mt-2 space-y-2.5">
                  {editableFields.map(({ field, current }) => {
                    const sug = draft.suggestions.find(s => s.field_key === field.key)
                    const editing = !!sug
                    return (
                      <div
                        key={field.key}
                        className={[
                          'rounded-xl border px-3 py-2',
                          editing ? 'border-primary-purple bg-lavender-tint/30' : 'border-lavender bg-white',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-[11px] font-semibold text-deep-plum">{field.layer_name ?? field.key}</p>
                          <button
                            type="button"
                            onClick={() => toggleSuggestion(field, current)}
                            className="text-[11px] font-semibold text-primary-purple hover:underline"
                          >
                            {editing ? 'Cancel edit' : 'Edit this'}
                          </button>
                        </div>
                        <p className="text-[11px] text-purple-gray italic line-clamp-2 mb-1">
                          Current: {currentToProposedString(current) || '(empty)'}
                        </p>
                        {editing && sug && (
                          <textarea
                            value={sug.proposed_value}
                            onChange={(e) => setSuggestionValue(field.key, e.target.value)}
                            rows={3}
                            placeholder="Type your suggested wording…"
                            className="w-full mt-1 rounded-md border border-primary-purple/40 bg-white px-2 py-1.5 text-[12px] text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15"
                            autoFocus
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Attachment */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-1.5">
              Attach a screenshot (optional)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setAttachment(f)
                if (e.target) e.target.value = ''
              }}
            />
            {draft.attachment ? (
              <div className="flex items-center gap-2 rounded-lg border border-lavender bg-white px-3 py-2">
                <Paperclip size={12} className="text-primary-purple shrink-0" />
                <span className="text-[12px] text-deep-plum truncate flex-1">{draft.attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="shrink-0 h-6 w-6 grid place-items-center rounded text-purple-gray hover:bg-red-50 hover:text-red-700"
                  aria-label="Remove attachment"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-lavender bg-white text-[12px] font-semibold text-primary-purple px-3 py-1.5 hover:border-primary-purple hover:bg-lavender-tint/30 transition-colors"
              >
                <ImagePlus size={12} /> Add image
              </button>
            )}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-lavender flex items-center justify-end gap-2 bg-cream/50">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] font-semibold text-purple-gray hover:text-deep-plum"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-[12px] font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send feedback
          </button>
        </footer>
      </aside>
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

/** Coerce a slot's stored value into a string the partner can edit.
 *  Text + richtext are strings already; CTAs become "{label} — {url}". */
function currentToProposedString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const obj = v as { label?: unknown; url?: unknown }
    if (typeof obj.label === 'string') {
      return obj.url ? `${obj.label} — ${String(obj.url)}` : obj.label
    }
  }
  return String(v)
}

// Silence unused MessageSquarePlus import — kept for a future
// "leave a comment" CTA that could surface on hover.
void MessageSquarePlus
// Same for ArrowLeft — reserved for an eventual "back to page list" button.
void ArrowLeft
