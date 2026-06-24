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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, FileText, Loader2, MessageSquarePlus, Paperclip,
  Send, X, Check, ImagePlus, Trash2, Inbox, PartyPopper, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveStaffName } from '../lib/webReviews'
import { uploadAttachment } from '../lib/attachmentUpload'
import { PagePreview } from '../components/wm/PagePreview'
import { WMRichTextEditor } from '../components/wm/RichTextEditor'
import { augmentTemplate } from '../lib/webBrixiesSchemaAugment'
import { loadEditorSnippets } from '../lib/webSnippets'
import type { SnippetMap } from '../lib/webBrixiesRender'
import type {
  WebReview, WebPage, WebSection, WebContentTemplate, WebFieldDef,
  WebReviewComment, StrategyWebProject,
} from '../types/database'

// ── Local state shapes ─────────────────────────────────────────────

interface PortalData {
  review: WebReview
  project: StrategyWebProject
  pages: WebPage[]
  sectionsByPage: Record<string, WebSection[]>
  templates: Record<string, WebContentTemplate>
  cardTemplates: Record<string, WebContentTemplate>
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
  /** For internal-kind reviews only: the Supabase auth user + their
   *  resolved staff name. Internal reviews require sign-in (attribution
   *  comes from auth, never from a free-text name modal). For partner
   *  reviews this stays null. */
  const [staffUser, setStaffUser] = useState<{ id: string; email: string } | null>(null)
  /** Set after the auth check completes for an internal review whose
   *  visitor isn't signed in. The render branch then shows a sign-in
   *  prompt instead of the review surface. */
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftComment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /** Every comment the partner has submitted on this review (refreshed
   *  after each save). Drives the right-side feedback tracker. */
  const [myComments, setMyComments] = useState<WebReviewComment[]>([])
  const [finishing, setFinishing] = useState(false)
  /** Once the partner clicks "Tell the Squad I'm finished", flip to
   *  done-mode: hide the comment drawer + replace right rail with
   *  a thank-you panel. The actual review row stays open until staff
   *  closes it from Site Manager. */
  const [finishedAt, setFinishedAt] = useState<string | null>(null)

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
        // Token resolves to either a partner or internal review.
        // Internal reviews now generate tokens too so strategists can
        // share an internal-only review link with teammates the same
        // way they share partner links. The UI is the same surface —
        // the only difference is which review row carries it.
        const { data: review, error: rErr } = await supabase
          .from('web_reviews')
          .select('*')
          .eq('partner_token', token)
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
        // Hide template-placeholder pages (e.g. {single-staff},
        // {single-event}, {single-sermon}) — these are routing
        // stand-ins for the dev's WP post-template loop, not real
        // copy the partner reviews.
        const pages = ((pageRows ?? []) as WebPage[])
          .filter(p => !p.name.startsWith('{') && !p.slug.startsWith('{'))

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

        // Card templates — palette-referenced groups (Feature 2/22/82/106 etc.)
        // defer their item template to a Card-family row. Without loading these,
        // the renderer's expandPaletteGroup leaves the placeholder element in
        // place and the card grid renders empty.
        const cardIds = new Set<string>()
        const collectCardIds = (fields: unknown): void => {
          if (!Array.isArray(fields)) return
          for (const f of fields as Array<Record<string, unknown>>) {
            if (f.kind === 'group') {
              const persisted = (f as { __palette_template_id?: unknown }).__palette_template_id
              const ref = (f as { referenced_template_id?: unknown }).referenced_template_id
              if (typeof persisted === 'string' && persisted) cardIds.add(persisted)
              if (typeof ref === 'string' && ref) cardIds.add(ref)
              if (Array.isArray(f.item_schema)) collectCardIds(f.item_schema)
            }
          }
        }
        for (const t of Object.values(templates)) collectCardIds(t.fields as unknown)
        // Also include any palette overrides the strategist picked per-section.
        for (const s of sectionRows) {
          const fv = (s.field_values ?? {}) as Record<string, unknown>
          for (const v of Object.values(fv)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              const tid = (v as { __palette_template_id?: unknown }).__palette_template_id
              if (typeof tid === 'string' && tid) cardIds.add(tid)
            }
          }
        }
        const cardTemplates: Record<string, WebContentTemplate> = {}
        if (cardIds.size > 0) {
          const { data: cardRows } = await supabase
            .from('web_content_templates')
            .select('*')
            .in('id', Array.from(cardIds))
          for (const t of (cardRows ?? []) as WebContentTemplate[]) {
            cardTemplates[t.id] = augmentTemplate(t)
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
          cardTemplates,
          snippetMap,
        })

        // Pick the first page by default
        setActivePageId(pages[0]?.id ?? null)

        // Identity resolution branches on review.kind:
        //
        // - Internal reviews: require Supabase auth. Attribution is
        //   always the signed-in staff member — no name modal. If
        //   not signed in, the page renders a sign-in prompt instead
        //   of the review surface.
        // - Partner reviews: per-browser-session name modal (current
        //   behavior). The review row never stores any one visitor's
        //   name, so multiple teammates on the same link each pick
        //   their own identity on first visit.
        const reviewKind = (review as WebReview).kind
        if (reviewKind === 'internal') {
          const { data: u } = await supabase.auth.getUser()
          const authed = u?.user
          if (!authed) {
            setNeedsSignIn(true)
          } else {
            const name = await resolveStaffName(authed.email ?? null)
            setStaffUser({ id: authed.id, email: authed.email ?? '' })
            setPartnerName(name ?? authed.email ?? 'Squad member')
          }
        } else {
          const stored = window.localStorage.getItem(`partner_review_${token}_name`)
          if (stored) setPartnerName(stored)
          // else: leave null — partner name modal will show
        }

      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load review.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // Load everything this partner has submitted on the open review.
  // Anon SELECT on web_review_comments is scoped to open partner
  // reviews so this works without auth.
  const loadMyComments = useCallback(async () => {
    if (!data?.review) return
    const { data: rows } = await supabase
      .from('web_review_comments')
      .select('*')
      .eq('review_id', data.review.id)
      .order('created_at', { ascending: false })
    setMyComments((rows ?? []) as WebReviewComment[])
  }, [data?.review])

  useEffect(() => { void loadMyComments() }, [loadMyComments])

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
  // Internal-review sign-in gate. Anyone with the link gets
  // attribution from Supabase auth, never from a free-text name —
  // protects squad-only feedback from drive-by partner visits and
  // ensures every comment on an internal review is tied to a real
  // staff identity.
  if (needsSignIn) {
    const here = window.location.pathname + window.location.search
    return (
      <FullScreen>
        <div className="rounded-2xl bg-white border border-lavender px-6 py-6 max-w-md text-center shadow-sm">
          <p className="text-[12px] font-bold uppercase tracking-widest text-primary-purple mb-1">
            Squad sign-in required
          </p>
          <h2 className="text-[16px] font-semibold text-deep-plum mb-2">Internal review</h2>
          <p className="text-[12.5px] text-purple-gray leading-snug mb-4">
            This is a private review for the Web Squad. Sign in with your
            squad account so your comments are attributed to you.
          </p>
          <a
            href={`/login?next=${encodeURIComponent(here)}`}
            className="inline-flex items-center justify-center rounded-full bg-deep-plum text-white text-[12px] font-semibold px-4 py-2 hover:bg-primary-purple transition-colors"
          >
            Sign in to review
          </a>
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
          // Don't write partner_name back to web_reviews — it would
          // identify every subsequent visitor on this same link as
          // the first person who claimed it. Each browser stores its
          // own identity in localStorage; the review row stays
          // anonymous so any teammate gets their own prompt.
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
      // Author attribution branches on review.kind:
      //  - internal: signed-in staff (author_user_id + author_external_name)
      //  - partner:  external name only (no auth required)
      const isInternal = data.review.kind === 'internal'
      const authorFields = isInternal
        ? {
            author_kind:         'staff' as const,
            author_user_id:      staffUser?.id ?? null,
            author_external_name: partnerName,
          }
        : {
            author_kind:         'partner' as const,
            author_external_name: partnerName,
          }
      const inserts: Array<Record<string, unknown>> = []
      if (draft.body.trim()) {
        inserts.push({
          review_id:           data.review.id,
          web_page_id:         draft.section.web_page_id,
          web_section_id:      draft.section.id,
          field_key:           null,
          ...authorFields,
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
          ...authorFields,
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

      setDraft(null)
      await loadMyComments()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to submit feedback.')
    } finally {
      setSubmitting(false)
    }
  }

  /** Partner explicitly tells the Squad they're done. Writes a
   *  marker note onto web_reviews.notes so staff can see it in Site
   *  Manager (we don't close the review here — staff still owns
   *  the lifecycle). */
  const markFinished = async () => {
    if (!data?.review) return
    setFinishing(true)
    const stamp = new Date().toISOString()
    const note = `Partner ${partnerName ?? ''} marked review finished at ${stamp}`.trim()
    const existing = (data.review.notes ?? '').trim()
    const merged = existing ? `${existing}\n${note}` : note
    await supabase
      .from('web_reviews')
      .update({ notes: merged } as never)
      .eq('id', data.review.id)
    setFinishedAt(stamp)
    setFinishing(false)
  }

  /** Partner approves the whole site without per-section edits. Drops a
   *  single project-scoped 'comment' kind row so staff sees the approval
   *  in the queue, then marks the review finished. Optional final note
   *  comes from a small modal so we don't lose context if the partner
   *  has one thing to flag before approving. */
  const approveSite = async (finalNote: string) => {
    if (!data?.review) return
    setFinishing(true)
    // Pick the first page as the comment anchor — the project doesn't
    // have a "no page" comment surface, so we attach to page #1 with a
    // clear "site-wide approval" prefix.
    const anchorPage = data.pages[0]
    if (anchorPage) {
      await supabase.from('web_review_comments').insert({
        review_id:           data.review.id,
        web_page_id:         anchorPage.id,
        web_section_id:      null,
        field_key:           null,
        author_kind:         'partner',
        author_external_name: partnerName,
        kind:                'comment',
        body:                `Site-wide approval${finalNote.trim() ? `: ${finalNote.trim()}` : '. No changes requested.'}`,
      } as never)
    }
    const stamp = new Date().toISOString()
    const note = `Partner ${partnerName ?? ''} APPROVED the site at ${stamp}${finalNote.trim() ? ` — ${finalNote.trim()}` : ''}`.trim()
    const existing = (data.review.notes ?? '').trim()
    const merged = existing ? `${existing}\n${note}` : note
    await supabase
      .from('web_reviews')
      .update({ notes: merged } as never)
      .eq('id', data.review.id)
    await loadMyComments()
    setFinishedAt(stamp)
    setFinishing(false)
  }

  const requestedCount = myComments.filter(c => c.kind === 'requested').length
  const generalCount   = myComments.filter(c => c.kind === 'comment').length
  // Internal reviews are a different surface from partner reviews:
  // - Comments / notes ARE NEVER cross-visible (each review_id has its
  //   own comment scope; loadMyComments filters by data.review.id).
  // - Copy across the page is tuned to whichever audience the token
  //   belongs to. Partners get partner-facing language; squad members
  //   get collaboration-focused language.
  const isInternalReview = data.review.kind === 'internal'

  return (
    <div className="min-h-screen bg-gradient-to-br from-lavender-tint/40 via-cream to-cream">
      {/* Top bar */}
      <header className="border-b border-lavender bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple flex items-center gap-1.5">
              {data.project.name}
              {isInternalReview && (
                <span className="inline-flex items-center text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-deep-plum text-white tracking-widest">
                  INTERNAL · SQUAD ONLY
                </span>
              )}
            </p>
            <h1 className="text-[20px] font-semibold text-deep-plum truncate">
              {isInternalReview
                ? `${data.project.church_name ?? data.project.name} — Internal Squad Review`
                : `${data.project.church_name ?? data.project.name} Wireframes: Copy Review`}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-purple-gray">Reviewing as</p>
              <p className="text-[13px] font-semibold text-deep-plum">{partnerName}</p>
            </div>
            {(requestedCount > 0 || generalCount > 0) && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple bg-lavender-tint border border-primary-purple/30 rounded-full px-2 py-1">
                <MessageSquarePlus size={11} /> Feedback Requests: {requestedCount + generalCount}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Intro block — copy is tuned per review kind. Partner-token
          loads see partner-facing welcome copy; internal-token loads
          see squad-collaboration copy with an emphatic 'internal'
          banner so a squad member never confuses a partner review
          link with the staff-only one. */}
      <div className="max-w-[1440px] mx-auto px-4 pt-6">
        {isInternalReview ? (
          <div className="rounded-2xl bg-deep-plum text-white px-5 py-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-widest font-bold text-lavender mb-1">
              Internal · Squad only
            </p>
            <h2 className="text-[22px] font-semibold mb-3" style={{ fontFamily: 'Georgia, serif' }}>
              Squad Review — Internal Critique
            </h2>
            <div className="space-y-2.5 text-[13.5px] text-white/90 leading-relaxed max-w-3xl">
              <p>
                This is a private review for the Web Squad. Everything
                you leave here stays internal — the partner never sees
                this view, and your notes don't appear on their copy
                review surface.
              </p>
              <p>
                Use it to collaborate before sending the copy to the
                partner: catch voice drift, factual gaps, missing CTAs,
                or anything that needs a second pair of eyes. Tag a
                teammate by sharing this link with them — they'll land
                on the same page and can add their own notes.
              </p>
              <p>
                When the squad is aligned and the copy is ready for the
                partner, head back to the Review tab in Site Manager
                and close this round out.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-lavender px-5 py-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">
              Welcome
            </p>
            <h2 className="text-[22px] font-semibold text-deep-plum mb-3" style={{ fontFamily: 'Georgia, serif' }}>
              Your Copy Review
            </h2>
            <div className="space-y-2.5 text-[13.5px] text-deep-plum/90 leading-relaxed max-w-3xl">
              <p>
                Take a few minutes to review the pages below and share any
                edits, questions, or feedback you have. For now, focus on
                the words and messaging — we're not worried about the
                design or layout just yet.
              </p>
              <p>
                Once approved, this copy will be finalized and handed off
                to your designer and developer. Then we'll move into the
                exciting part: bringing your brand to life through your
                website design!
              </p>
              <p>
                When all feedback is in for your church and you're ready to
                move on to the next milestone, click{' '}
                <span className="font-semibold">Approve Copy &amp; Finalize Milestone</span>.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="max-w-[1440px] mx-auto px-4 py-6 flex gap-4 items-start">
        {/* Page nav */}
        <aside className="w-60 shrink-0 sticky top-[88px]">
          {(() => {
            const mainPages = data.pages.filter(p => !p.slug.startsWith('staff/'))
            const staffPages = data.pages.filter(p => p.slug.startsWith('staff/'))
            const renderRow = (p: WebPage) => {
              const active = p.id === activePageId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePageId(p.id)}
                  className={[
                    'w-full text-left rounded-md px-2.5 py-1.5 transition-colors flex items-center gap-2',
                    active
                      ? 'bg-deep-plum text-white'
                      : 'text-deep-plum hover:bg-lavender-tint/50',
                  ].join(' ')}
                  title={`/${p.slug}`}
                >
                  <FileText size={12} className="shrink-0 opacity-80" />
                  <span className="text-[12.5px] font-semibold truncate">{p.name}</span>
                </button>
              )
            }
            return (
              <>
                <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-2 px-2">
                  Pages · {mainPages.length}
                </p>
                <nav className="space-y-0.5">
                  {mainPages.map(renderRow)}
                </nav>
                {staffPages.length > 0 && (
                  <details className="mt-4 rounded-lg bg-lavender-tint/50 border border-primary-purple/15 group">
                    <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-2 text-[11px] uppercase tracking-widest font-bold text-primary-purple hover:bg-lavender-tint/80 rounded-lg transition-colors">
                      <span>Staff pages · {staffPages.length}</span>
                      <ChevronDown
                        size={13}
                        className="shrink-0 transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <nav className="px-1 pb-2 space-y-0.5">
                      {staffPages.map(renderRow)}
                    </nav>
                  </details>
                )}
              </>
            )
          })()}
          <div className="mt-4 rounded-xl bg-white border border-lavender px-3 py-2.5">
            <p className="text-[11px] font-semibold text-deep-plum mb-1">How this works</p>
            <p className="text-[11px] text-purple-gray leading-snug">
              {isInternalReview
                ? 'Click any section to leave squad notes or flag edits before the partner sees this. Everything here stays internal.'
                : 'Click on any section to leave a comment or request specific edits. Your feedback will be shared with your Web Squad after the review is completed.'}
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
                cardTemplates={data.cardTemplates}
                snippetMap={data.snippetMap}
                page={activePage}
                onSelectSection={startComment}
              />
            )
          ) : (
            <div className="text-center py-16 rounded-xl bg-white border border-lavender text-purple-gray">
              Pick a page to review.
            </div>
          )}
        </main>

        {/* Feedback tracker (right rail). Partner sees a live rollup
            of everything they've submitted plus the "I'm done" CTA. */}
        <aside className="w-72 shrink-0 sticky top-[88px]">
          <FeedbackTracker
            comments={myComments}
            pages={data.pages}
            sectionsByPage={data.sectionsByPage}
            templates={data.templates}
            finishedAt={finishedAt}
            finishing={finishing}
            isInternalReview={isInternalReview}
            onJumpToSection={(pageId, sectionId) => {
              setActivePageId(pageId)
              queueMicrotask(() => {
                document.getElementById(`section-${sectionId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              })
            }}
            onFinish={markFinished}
            onApprove={approveSite}
          />
        </aside>
      </div>

      {/* Comment drawer */}
      {draft && !finishedAt && (() => {
        // Partner-facing label: "Section N" based on the section's
        // position on its page (1-indexed by sort_order). Sections
        // are already sorted in data.sectionsByPage at load time.
        const onPage = data.sectionsByPage[draft.section.web_page_id] ?? []
        const idx = onPage.findIndex(s => s.id === draft.section.id)
        const partnerSectionLabel = idx >= 0 ? `Section ${idx + 1}` : 'Section'
        return (
          <CommentDrawer
            draft={draft}
            setDraft={setDraft}
            submitting={submitting}
            onCancel={() => setDraft(null)}
            onSubmit={submit}
            template={draft.section.content_template_id ? data.templates[draft.section.content_template_id] ?? null : null}
            existingForSection={myComments.filter(c => c.web_section_id === draft.section.id)}
            snippetMap={data.snippetMap}
            sectionLabel={partnerSectionLabel}
          />
        )
      })()}
    </div>
  )
}

// ── Feedback tracker (right rail) ─────────────────────────────────

function FeedbackTracker({
  comments, pages, sectionsByPage, templates, finishedAt, finishing,
  isInternalReview, onJumpToSection, onFinish, onApprove,
}: {
  comments: WebReviewComment[]
  pages: WebPage[]
  sectionsByPage: Record<string, WebSection[]>
  templates: Record<string, WebContentTemplate>
  finishedAt: string | null
  finishing: boolean
  /** True when the loaded review is kind='internal'. Branches the
   *  tracker's labels + the bottom-of-rail CTA so squad members see
   *  collaboration-focused copy instead of partner-finalization copy. */
  isInternalReview: boolean
  onJumpToSection: (pageId: string, sectionId: string) => void
  onFinish: () => Promise<void>
  onApprove: (finalNote: string) => Promise<void>
}) {
  // No-feedback approve modal — only triggers when the partner hits
  // "Complete Review" with zero comments on the project.
  const [approveModalOpen, setApproveModalOpen] = useState(false)
  const pageById = useMemo(() => {
    const m = new Map<string, WebPage>()
    for (const p of pages) m.set(p.id, p)
    return m
  }, [pages])
  const sectionById = useMemo(() => {
    const m = new Map<string, WebSection>()
    for (const list of Object.values(sectionsByPage)) for (const s of list) m.set(s.id, s)
    return m
  }, [sectionsByPage])

  // Group by page in the order they appear in nav.
  const byPage = useMemo(() => {
    const groups: Array<{ page: WebPage; items: WebReviewComment[] }> = []
    for (const p of pages) {
      const items = comments.filter(c => c.web_page_id === p.id)
      if (items.length > 0) groups.push({ page: p, items })
    }
    return groups
  }, [comments, pages])

  if (finishedAt) {
    return (
      <div className="rounded-2xl bg-white border border-emerald-200 px-4 py-5 text-center shadow-sm">
        <div className="mx-auto h-10 w-10 rounded-full bg-emerald-50 grid place-items-center text-emerald-600 mb-2">
          <PartyPopper size={18} />
        </div>
        <p className="text-[13px] font-semibold text-deep-plum">Thanks — your Squad will take it from here</p>
        <p className="text-[11px] text-purple-gray leading-snug mt-1">
          We've let them know you're finished. They'll review every request and follow up
          if anything needs clarification.
        </p>
        <p className="text-[10px] text-purple-gray/70 mt-2">
          {comments.length} item{comments.length === 1 ? '' : 's'} submitted
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white border border-lavender shadow-sm overflow-hidden">
      <div className="px-3 py-3 border-b border-lavender">
        <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">
          {isInternalReview ? 'Squad feedback' : 'Team feedback'}
        </p>
        <p className="text-[13px] font-semibold text-deep-plum">
          {comments.length === 0
            ? 'No items yet'
            : isInternalReview
              ? `${comments.length} squad note${comments.length === 1 ? '' : 's'}`
              : `${comments.length} item${comments.length === 1 ? '' : 's'} from your team`}
        </p>
        <p className="text-[10.5px] text-purple-gray mt-0.5 leading-snug">
          {isInternalReview
            ? 'Notes from the Web Squad — partner never sees this rail.'
            : 'Everything you and your teammates have submitted on this review.'}
        </p>
      </div>
      <div className="max-h-[55vh] overflow-y-auto">
        {byPage.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-purple-gray">
            <Inbox size={16} className="mx-auto text-purple-gray/50 mb-1.5" />
            Click any section in the preview to leave feedback. Everything you save shows up here.
          </div>
        ) : (
          <ul className="divide-y divide-lavender/60">
            {byPage.map(({ page, items }) => (
              <li key={page.id} className="px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-1">
                  {page.name}
                </p>
                <ul className="space-y-1">
                  {items.map(c => {
                    // Partner-facing section label: chronological
                    // position on the page ("Section 3") rather than
                    // the Brixies layer name ("Hero Section 55"),
                    // which is build-time jargon to a partner.
                    const onPage = sectionsByPage[page.id] ?? []
                    const idx = c.web_section_id
                      ? onPage.findIndex(s => s.id === c.web_section_id)
                      : -1
                    const sectionLabel = idx >= 0 ? `Section ${idx + 1}` : 'Section'
                    // Tag label: "comment" stays, "requested" /
                    // "suggested" both surface as "Edit" — partners
                    // don't differentiate between an inline edit and
                    // a structured suggestion in their head.
                    const kindLabel = c.kind === 'comment' ? 'Comment' : 'Edit'
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => c.web_section_id && onJumpToSection(page.id, c.web_section_id)}
                          className="w-full text-left rounded-md px-2 py-1.5 hover:bg-lavender-tint/40 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={[
                              'shrink-0 inline-flex items-center text-[9px] uppercase tracking-widest font-bold rounded-full px-1.5 py-0.5',
                              c.kind === 'requested' || c.kind === 'suggested'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-lavender-tint text-primary-purple border border-primary-purple/20',
                            ].join(' ')}>
                              {kindLabel}
                            </span>
                            <span className="text-[11px] text-deep-plum font-semibold truncate">
                              {sectionLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-purple-gray truncate mt-0.5">
                            {c.field_key
                              ? `${c.field_key}${typeof c.suggested_value === 'string' ? ` — ${stripHtml(c.suggested_value)}` : ''}`
                              : (c.body ?? '')}
                          </p>
                          <p className="text-[10px] text-purple-gray/70 mt-0.5">
                            {c.author_external_name ?? 'You'} · {fmtPortalDateTime(c.created_at)}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-3 py-3 border-t border-lavender bg-cream/40 space-y-2">
        {/* Save progress — comments save on submit, so this is purely
            a reassurance + share button. The text doubles as a hint
            that progress is auto-saved. */}
        <SaveProgressButton commentCount={comments.length} />
        {/* Share — invite another teammate to leave feedback on the
            same review. Different label per kind so the partner sees
            partner-staff language and squad members see squad
            language. */}
        <ShareReviewLinkButton isInternalReview={isInternalReview} />
        {isInternalReview ? (
          // Internal reviews are NOT finalized from here. Multiple
          // squad members leave feedback under the same round and
          // the round closes from Site Manager → Review when the
          // project lead bumps the project status. This is a
          // personal "I'm done for now" affordance: no DB write,
          // just nav back to Site Manager.
          <a
            href="/"
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-deep-plum text-white text-[12px] font-semibold px-4 py-2.5 hover:bg-primary-purple transition-colors"
          >
            <Check size={12} />
            I'm done reviewing
          </a>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (comments.length === 0) setApproveModalOpen(true)
              else void onFinish()
            }}
            disabled={finishing}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-deep-plum text-white text-[12px] font-semibold px-4 py-2.5 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {finishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Approve Copy & Finalize Milestone
          </button>
        )}
        {isInternalReview && (
          <p className="text-[10.5px] text-purple-gray text-center leading-snug mt-1">
            The round closes when the project lead changes the
            project status from Site Manager.
          </p>
        )}
      </div>

      {approveModalOpen && (
        <NoFeedbackApproveModal
          finishing={finishing}
          onCancel={() => setApproveModalOpen(false)}
          onApprove={async () => {
            await onApprove('')
            setApproveModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Reassurance button: comments persist the moment the partner hits
 *  Save Feedback inside the drawer, so this isn't a write — it
 *  surfaces a "you're safe to come back later" confirmation. Tapping
 *  briefly turns into a checkmark with copy that includes the saved
 *  item count, then resets after a few seconds. */
function SaveProgressButton({ commentCount }: { commentCount: number }) {
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    if (!confirmed) return
    const t = setTimeout(() => setConfirmed(false), 2400)
    return () => clearTimeout(t)
  }, [confirmed])
  return (
    <button
      type="button"
      onClick={() => setConfirmed(true)}
      className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-deep-plum text-[12px] font-semibold px-4 py-2 border border-lavender hover:border-primary-purple hover:bg-lavender-tint/30 transition-colors"
    >
      {confirmed ? (
        <>
          <Check size={12} className="text-emerald-600" />
          Progress saved · {commentCount} item{commentCount === 1 ? '' : 's'} on file
        </>
      ) : (
        <>
          <Inbox size={12} />
          Save progress
        </>
      )}
    </button>
  )
}

/** Lets the user copy the current review URL so they can hand it to
 *  a teammate. Label branches by kind: partner reviews say "another
 *  staff member" (their staff at the partner church), internal
 *  reviews say "another squad member" (the Web Squad). The link
 *  stays valid as long as the review is open. */
function ShareReviewLinkButton({ isInternalReview }: { isInternalReview: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2400)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      window.prompt('Copy this review link to share with a teammate:', window.location.href)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-deep-plum text-[12px] font-semibold px-4 py-2 border border-lavender hover:border-primary-purple hover:bg-lavender-tint/30 transition-colors"
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-600" />
          Link copied — paste it to a teammate
        </>
      ) : (
        <>
          <MessageSquarePlus size={12} />
          {isInternalReview
            ? 'Invite another squad member to review'
            : 'Request feedback from another staff member'}
        </>
      )}
    </button>
  )
}

/** Surfaced when the partner clicks "Approve Copy & Finalize Milestone"
 *  without leaving any feedback — prompts them to either confirm an
 *  as-is approval or go back and add feedback. */
function NoFeedbackApproveModal({
  finishing, onCancel, onApprove,
}: {
  finishing: boolean
  onCancel: () => void
  onApprove: () => Promise<void>
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-deep-plum/40 backdrop-blur-[2px] p-4">
      <div className="max-w-md w-full rounded-2xl bg-white border border-lavender shadow-xl px-5 py-5">
        <h2 className="text-[16px] font-semibold text-deep-plum mb-2">No feedback yet</h2>
        <p className="text-[13px] text-purple-gray leading-snug">
          We noticed you haven't shared any feedback yet, which makes us think we're on
          the right track. If everything looks good, go ahead and confirm that you'd like
          to approve these pages as-is so TheSquad can move into the next milestone.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={onCancel}
            disabled={finishing}
            className="text-[12px] font-semibold text-purple-gray hover:text-deep-plum px-3 py-2 disabled:opacity-40"
          >
            Go back & add feedback
          </button>
          <button
            type="button"
            onClick={() => void onApprove()}
            disabled={finishing}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white text-[12px] font-semibold px-4 py-2 hover:bg-emerald-700 transition-colors disabled:opacity-40"
          >
            {finishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Approve Pages As-Is
          </button>
        </div>
      </div>
    </div>
  )
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function fmtPortalDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return iso }
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
        <h1 className="text-[20px] font-semibold text-deep-plum mb-1">Welcome to your website content review</h1>
        <p className="text-[13px] text-purple-gray mb-4">
          Let us know who's reviewing so your Squad can credit your feedback.
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
  existingForSection, snippetMap: _snippetMap, sectionLabel: overrideLabel,
}: {
  draft: DraftComment
  setDraft: (d: DraftComment | null) => void
  submitting: boolean
  onCancel: () => void
  onSubmit: () => Promise<void>
  template: WebContentTemplate | null
  existingForSection: WebReviewComment[]
  snippetMap: SnippetMap
  /** Partner-facing section label override, e.g. "Section 3". Falls
   *  back to the bound template's layer_name when not supplied (used
   *  in non-partner contexts where the Brixies name is meaningful). */
  sectionLabel?: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Flatten the template into every editable leaf the partner can
  // request a change to. Recurses through groups (cards, item lists)
  // so each repeating item × child slot surfaces as its own row.
  // Path-style keys (`cards.0.heading`) let resolveComment write back
  // into the nested field_values shape on Apply.
  const editableFields = useMemo(() => {
    if (!template) return [] as EditableLeaf[]
    const values = (draft.section.field_values ?? {}) as Record<string, unknown>
    // Drop fields with no current value before showing them to the
    // partner. An empty "Current: (empty)" row is noise — the
    // partner can't critique what isn't there. If they want to add
    // content that isn't bound, that's a separate conversation.
    return flattenTemplateFields(template.fields ?? [], values)
      .filter(leaf => !isLeafEmpty(leaf))
  }, [template, draft.section.field_values])

  const setBody = (body: string) => setDraft({ ...draft, body })
  const toggleSuggestion = (leaf: EditableLeaf) => {
    const existing = draft.suggestions.find(s => s.field_key === leaf.fieldKey)
    if (existing) {
      setDraft({ ...draft, suggestions: draft.suggestions.filter(s => s.field_key !== leaf.fieldKey) })
    } else {
      const init = currentToProposedString(leaf.current)
      setDraft({
        ...draft,
        suggestions: [...draft.suggestions, {
          field_key:      leaf.fieldKey,
          layer_name:     leaf.label,
          field_type:     leaf.fieldType,
          original_value: leaf.current ?? null,
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
  // Partner-facing surface: prefer the position-based override
  // ("Section 3") if the caller provided one. The Brixies layer name
  // ("Hero Section 55") is a build-time label that doesn't mean
  // anything to a partner reviewing their copy.
  const sectionLabel = overrideLabel ?? template?.layer_name ?? 'Freehand section'

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
          {/* Existing per-section feedback — surfaced first so the
              partner can see what they've already saved before adding
              more. Avoids the "did my last edit go through?" confusion. */}
          {existingForSection.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-700 mb-1.5">
                Already saved on this section · {existingForSection.length}
              </p>
              <ul className="space-y-1.5">
                {existingForSection.map(c => (
                  <li key={c.id} className="text-[11px] text-deep-plum">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-emerald-700">{c.kind}</span>
                      {c.field_key && <span className="font-mono text-purple-gray">{c.field_key}</span>}
                      <span className="ml-auto text-[10px] text-purple-gray/70">
                        {c.author_external_name ?? 'You'} · {fmtPortalDateTime(c.created_at)}
                      </span>
                    </div>
                    <p className="text-purple-gray italic mt-0.5">
                      {c.field_key
                        ? (typeof c.suggested_value === 'string' ? stripHtml(c.suggested_value) : '')
                        : (c.body ?? '')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Specific edits — surfaced first because most partner
              feedback is per-field. Auto-expanded so it doesn't hide
              behind a +/− toggle. */}
          {editableFields.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-2">
                Suggest specific edits
              </p>
              <div className="space-y-2.5">
                {editableFields.map((leaf) => {
                  const sug = draft.suggestions.find(s => s.field_key === leaf.fieldKey)
                  const editing = !!sug
                  return (
                    <div
                      key={leaf.fieldKey}
                      className={[
                        'rounded-xl border px-3 py-2',
                        editing ? 'border-primary-purple bg-lavender-tint/30' : 'border-lavender bg-white',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          {leaf.itemLabel && (
                            <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">
                              {leaf.itemLabel}
                            </p>
                          )}
                          <p className="text-[11px] font-semibold text-deep-plum">{leaf.label}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSuggestion(leaf)}
                          className="text-[11px] font-semibold text-primary-purple hover:underline shrink-0"
                        >
                          {editing ? 'Cancel edit' : 'Edit this'}
                        </button>
                      </div>
                      {/* Surface the current value as rendered text (not
                          raw HTML) so the partner sees what readers see. */}
                      <FieldCurrentPreview
                        type={leaf.fieldType}
                        value={leaf.current}
                      />
                      {editing && sug && (
                        leaf.fieldType === 'richtext' ? (
                          <div className="mt-2 rounded-md border border-primary-purple/40 bg-white">
                            <WMRichTextEditor
                              value={sug.proposed_value}
                              onChange={(html) => setSuggestionValue(leaf.fieldKey, html)}
                              placeholder="Type your suggested wording…"
                              compact
                            />
                          </div>
                        ) : (
                          <textarea
                            value={sug.proposed_value}
                            onChange={(e) => setSuggestionValue(leaf.fieldKey, e.target.value)}
                            rows={leaf.fieldType === 'text' ? 2 : 3}
                            placeholder={leaf.fieldType === 'cta' ? 'Button label — /route' : 'Type your suggested wording…'}
                            className="w-full mt-1 rounded-md border border-primary-purple/40 bg-white px-2 py-1.5 text-[12px] text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15"
                            autoFocus
                          />
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* General comment — broad notes that aren't tied to a field. */}
          <div>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray block mb-1">
                Anything else to add?
              </span>
              <textarea
                value={draft.body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="A general note about this section that isn't tied to a specific field."
                className="w-full rounded-xl border border-lavender bg-white px-3 py-2 text-[13px] text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15"
              />
            </label>
          </div>

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
            title="Save this feedback. You can keep adding more before you tell the Squad you're done."
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Save feedback
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

/** Flattened editable leaf — one row in the partner edit list. Scalar
 *  slots produce a single leaf; groups recurse so each item × child slot
 *  surfaces. fieldKey is a dotted path (e.g. `cards.0.heading`) that
 *  resolveComment reads back into nested field_values on Apply. */
interface EditableLeaf {
  fieldKey:   string
  label:      string
  itemLabel?: string
  fieldType:  FieldSuggestion['field_type']
  current:    unknown
}

/** True when a leaf has no meaningful current value for the partner
 *  to critique. Hides the leaf from "Suggest specific edits" — empty
 *  rows are noise to a partner who's reviewing the rendered page.
 *  - text / richtext: empty string, whitespace-only, or pure-empty
 *    HTML (e.g. "<p></p>" / "<p><br></p>")
 *  - cta: no label AND no url */
function isLeafEmpty(leaf: EditableLeaf): boolean {
  const v = leaf.current
  if (v == null) return true
  if (leaf.fieldType === 'cta') {
    if (typeof v === 'object' && v !== null) {
      const cta = v as { label?: unknown; url?: unknown }
      const label = typeof cta.label === 'string' ? cta.label.trim() : ''
      const url   = typeof cta.url   === 'string' ? cta.url.trim()   : ''
      return label.length === 0 && url.length === 0
    }
    return true
  }
  if (typeof v !== 'string') return false
  const trimmed = v.trim()
  if (trimmed.length === 0) return true
  if (leaf.fieldType === 'richtext') {
    // Strip every tag and check if any actual text/space remains.
    // Catches "<p></p>", "<p><br></p>", "<div></div>", etc.
    const stripped = trimmed.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    return stripped.length === 0
  }
  return false
}

function flattenTemplateFields(
  fields: WebFieldDef[],
  values: Record<string, unknown>,
): EditableLeaf[] {
  const out: EditableLeaf[] = []
  for (const f of fields) {
    if (f.kind === 'slot') {
      if (f.type === 'text' || f.type === 'richtext' || f.type === 'cta') {
        out.push({
          fieldKey:  f.key,
          label:     f.layer_name ?? f.key,
          fieldType: f.type,
          current:   values[f.key],
        })
      }
      continue
    }
    if (f.kind === 'group') {
      const raw = values[f.key]
      const items: Array<Record<string, unknown>> = Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
        : []
      const groupLabel = f.layer_name ?? f.key
      items.forEach((item, idx) => {
        const itemLabel = `${groupLabel} · #${idx + 1}`
        for (const child of f.item_schema ?? []) {
          if (child.kind !== 'slot') continue
          if (child.type !== 'text' && child.type !== 'richtext' && child.type !== 'cta') continue
          out.push({
            fieldKey:  `${f.key}.${idx}.${child.key}`,
            label:     child.layer_name ?? child.key,
            itemLabel,
            fieldType: child.type,
            current:   item?.[child.key],
          })
        }
      })
    }
  }
  return out
}

/** Read-only preview of a field's current value. Rich text renders as
 *  parsed HTML; text/cta as plain text. Keeps partners from seeing
 *  `<p>…</p>` markup that would otherwise leak out of richtext slots. */
function FieldCurrentPreview({ type, value }: { type: 'text' | 'richtext' | 'cta'; value: unknown }) {
  if (value == null || value === '') {
    return <p className="text-[11px] text-purple-gray italic">Current: (empty)</p>
  }
  if (type === 'richtext' && typeof value === 'string') {
    return (
      <div className="text-[11px] text-purple-gray italic">
        <span className="not-italic font-mono text-[9px] uppercase tracking-widest text-purple-gray/70 mr-1">Current:</span>
        <span
          className="prose prose-sm max-w-none inline align-baseline [&>*]:inline [&>*]:m-0"
          dangerouslySetInnerHTML={{ __html: value }}
        />
      </div>
    )
  }
  if (type === 'cta' && typeof value === 'object' && value !== null) {
    const obj = value as { label?: unknown; url?: unknown }
    return (
      <p className="text-[11px] text-purple-gray italic line-clamp-2">
        Current: {typeof obj.label === 'string' ? obj.label : '(no label)'}
        {obj.url ? ` — ${String(obj.url)}` : ''}
      </p>
    )
  }
  return (
    <p className="text-[11px] text-purple-gray italic line-clamp-2">
      Current: {currentToProposedString(value)}
    </p>
  )
}

// Silenced — AlertTriangle/Send reserved for future portal states.
void AlertTriangle
void Send
