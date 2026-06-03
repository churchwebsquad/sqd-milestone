/**
 * ContentCollectionPage — /portal/:token/hub/content-collection/:sessionId
 *
 * Two-step partner-facing flow:
 *   Step 1 (Inventory Review): partner reviews each named program +
 *     topic-level bucket from the crawl. Marks each as
 *     Approved / Outdated (with update text) / Approved + Keep As Is
 *     (the last flag flows downstream so the copywriter AI doesn't
 *     rewrite that content).
 *   Step 2 (Content Collection Form): Discovery Recap (read-only from
 *     strategy_discovery_questionnaire) → Managing Your Website (events,
 *     sermons, groups display preferences with conditional follow-ups)
 *     → Preparing For Launch (domain registrar handoff + hosting
 *     approval).
 *
 * Saves are progressive (each interaction writes) so the partner can
 * resume mid-session without losing work. Final submit transitions the
 * session row to status='submitted'.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Calendar, CheckCircle2, Loader2, AlertCircle, ArrowRight, ArrowLeft, Edit3, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { InventoryView, type TopicRow, type SnippetRow, type Mark as InvMark, type MarkStatus, type SaveMark } from '../components/wm/inventory/InventoryView'
import { WMRichTextEditor } from '../components/wm/RichTextEditor'
import { FileUploadField } from '../components/contentcollection/FileUploadField'
import type { AttachmentMetadata, AttachmentKind } from '../lib/contentCollectionAttachments'
import { loadStrategyBriefSections, strategyBriefToExternalPrefills } from '../lib/webStrategyBrief'
import { sanitizeTopicsForPartner } from '../lib/sanitizeInventoryForPartner'
import {
  PartnerTextInput,
  PartnerTextArea,
  PartnerRadioGroup,
  PartnerCheckboxGroup,
  PartnerYesNo,
  PartnerRichTextField,
} from '../components/contentcollection/PartnerField'

interface SessionRow {
  id:                                string
  web_project_id:                    string
  member:                            number
  status:                            'open' | 'submitted' | 'closed'
  due_at:                            string | null
  inventory_snapshot:                Record<string, unknown>

  events_display_preference:         string | null
  events_external_url:               string | null
  events_wordpress_source_of_truth:  string | null
  events_wordpress_frustration:      string | null
  events_wordpress_recurring_needed: string | null
  /** Free-text preference for how events should render: "card view",
   *  "list view", "calendar view", or whatever the partner types.
   *  Asked under the Embed and WordPress paths only — External
   *  redirects out so display is the partner's other platform's job. */
  events_display_format:             string | null
  sermons_display_preference:        string | null
  sermons_external_url:              string | null
  /** Multi-select of optional sermon-archive features partners want
   *  included (discussion guides / notes / audio / filters). Stored as
   *  a text[] so the option list can grow without re-encoding. */
  sermon_archive_features:           string[] | null
  groups_display_preference:         string | null
  groups_external_url:               string | null
  groups_wordpress_source_of_truth:  string | null
  groups_wordpress_frustration:      string | null
  ministries_to_grow:                string | null
  high_maintenance_pages_context:    string | null
  additional_context:                string | null

  /** Multi-select of content types the partner wants their team to
   *  manage via the CMS (Volunteers Opportunities, Staff Directory,
   *  Blog, etc.). Auto-precheck logic in the UI fills this in from
   *  crawl evidence on first load; partners can de-select. */
  cms_managed_types:                 string[] | null
  /** Blog sub-radio: 'transfer' | 'sermon_based' | 'new'. Only set
   *  when 'blog' is in cms_managed_types. */
  blog_handling:                     'transfer' | 'sermon_based' | 'new' | null
  blog_existing_url:                 string | null
  /** Heart / purpose copy for a brand-new blog. */
  blog_new_description:              string | null
  /** Categorization filters the partner wants on a new blog
   *  (Topic, Bible Verse, Series, Author, …). text[] for extensibility. */
  blog_new_filters:                  string[] | null
  /** Free-form list when the sermon-archive "Create filters…" option
   *  is selected — partners list which filters they want. */
  sermon_filters_text:               string | null
  /** Y/N for "do you have a YouTube playlist set up?" — appears under
   *  the Direct-to-YouTube/Vimeo sermon display choice. */
  sermon_youtube_playlist_exists:    boolean | null
  sermon_youtube_playlist_url:       string | null
  /** External merch / shop store URL. The new site can link visitors
   *  out to the partner's store but doesn't host ecommerce under
   *  the subscription. v62. */
  merch_store_url:                   string | null
  /** Rich-text (HTML) list of ministries offered at the church. */
  ministries_list_html:              string | null
  /** Rich-text (HTML) description of the next-steps / discipleship pathway. */
  discipleship_pathway_html:         string | null

  domain_registrar_url:              string | null
  domain_credential_method:          'invite_admin' | 'one_password' | null
  domain_invite_confirmed:           boolean
  domain_one_password_invite_url:    string | null
  hosting_approved:                  boolean

  submitted_at:                      string | null
}

interface AttachmentRow {
  id:           string
  session_id:   string
  /** See migration v55 docs. Values include:
   *   missing | copy_doc | staff_csv | volunteer_csv | groups_csv |
   *   careers_csv | testimonials_csv | campuses_csv */
  kind:         string
  file_path:    string
  file_name:    string
  mime_type:    string | null
  size_bytes:   number | null
  target_path:  string | null
  uploaded_at:  string
}

interface Mark extends InvMark {
  id:                            string
  proposed_program_name:         string | null
  proposed_program_description:  string | null
}

interface DiscoveryRecap {
  top_website_priority:             string | null
  top_3_website_goals:              string | null
  copy_approach:                    string | null
  ideal_website_experience:         string | null
  best_outreach_methods:            string | null
  audience_voice_style:             string | null
  words_tones_to_avoid:             string | null
  inspirational_websites:           string | null
  weekly_maintenance_hours:         string | null
  high_maintenance_pages:           string | null
  software_in_use:                  string | null
  /** Selected initial web-support add-ons from discovery — used to
   *  pre-check the "sermon-based blog written by TheSquad" radio
   *  when the partner already opted in upstream. */
  initial_web_support_preferences:  string[] | null
  /** Photo-library URL the partner shared during discovery — used to
   *  prefill the Photos bucket's photo_library baseline field. */
  photo_library_url:                string | null
  /** Partner-submitted mission + vision combined into one field on
   *  the discovery questionnaire. Used as the prefill for the About
   *  Your Church → Mission statement baseline (and a fallback for
   *  Vision statement when the partner hasn't split them yet). */
  mission_vision_statement:         string | null
}

interface PartnerCtx {
  member:        number
  church_name:   string | null
  first_name:    string | null
  am_name:       string | null
  am_channel_id: string | null
  /** Best-effort photo library URL — discovery photo_library_url wins,
   *  then account_progress.photos_link, then legacy fallback. Used to
   *  prefill the Photos bucket on Step 1. */
  photo_library_url: string | null
  /** Multi-line "Facebook: …\nInstagram: …\nYouTube: …" string built
   *  from the URL-shaped values on strategy_account_progress. Used to
   *  prefill the Social Media bucket on Step 1. */
  social_links_prefill: string | null
  /** YouTube channel URL — used as a Step 2 sermon-channel prefill
   *  fallback when the global youtube_url snippet isn't populated
   *  but strategy_web_projects.social_youtube_url is. */
  sermon_channel_url: string | null
}

export default function ContentCollectionPage() {
  const { token, sessionId } = useParams<{ token: string; sessionId: string }>()
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep]         = useState<1 | 2>(1)

  const [session, setSession]     = useState<SessionRow | null>(null)
  const [topics, setTopics]       = useState<TopicRow[]>([])
  const [snippetsByToken, setSnippets] = useState<Map<string, SnippetRow>>(new Map())
  const [marks, setMarks]         = useState<Map<string, Mark>>(new Map())
  const [recap, setRecap]         = useState<DiscoveryRecap | null>(null)
  const [partner, setPartner]     = useState<PartnerCtx | null>(null)
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  // Strategy brief sections (Mission / Vision / Values) parsed from
  // the uploaded markdown. Beats discovery_questionnaire.mission_
  // vision_statement when present — the brief is the AM-curated
  // canonical version.
  const [strategyBriefPrefills, setStrategyBriefPrefills] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!token || !sessionId) { setNotFound(true); setLoading(false); return }
    let cancelled = false

    const load = async () => {
      try {
        // 1. Verify token + load partner context (incl. photo-library
        //    + social-media candidates so the Photos and Social
        //    baselines can prefill).
        const { data: p } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name, first_name_of_primary, css_rep, photos_link, legacy_photo_library, photos_from_all_in_discovery_form, facebook, facebook_link, instagram, instagram_link, youtube')
          .eq('portal_token', token)
          .maybeSingle()
        if (!p) { if (!cancelled) setNotFound(true); return }

        // 2. Load session
        const { data: s } = await supabase
          .from('strategy_content_collection_sessions')
          .select('*')
          .eq('id', sessionId)
          .eq('member', p.member)
          .maybeSingle()
        if (!s) { if (!cancelled) setNotFound(true); return }
        if (cancelled) return
        setSession(s as SessionRow)

        // 3. Topics + snippets + marks + recap + AM channel + attachments + web-project-level social globals (parallel).
        //    The social_* columns on strategy_web_projects are where
        //    fire-crawl-trigger writes YouTube / Facebook / Instagram
        //    / TikTok URLs it finds in the crawl. They DON'T appear
        //    in web_project_snippets, so we need a separate query to
        //    surface them for the partner prefill.
        const [topicsRes, snippetsRes, marksRes, recapRes, chanRes, attRes, projRes] = await Promise.all([
          supabase.from('web_project_topics')
            .select('id, topic_key, topic_label, voice_signal, passages, items, added_snippet_tokens, source_page_urls')
            .eq('web_project_id', (s as SessionRow).web_project_id),
          supabase.from('web_project_snippets')
            .select('token, label, expansion')
            .eq('web_project_id', (s as SessionRow).web_project_id)
            .eq('archived', false),
          supabase.from('strategy_content_collection_marks').select('*').eq('session_id', sessionId),
          supabase.from('strategy_discovery_questionnaire')
            .select('top_website_priority, top_3_website_goals, copy_approach, ideal_website_experience, best_outreach_methods, audience_voice_style, words_tones_to_avoid, inspirational_websites, weekly_maintenance_hours, high_maintenance_pages, software_in_use, initial_web_support_preferences, photo_library_url, mission_vision_statement')
            .eq('member', p.member)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('clickup_chat_channels').select('id').eq('memberid', p.member).limit(1).maybeSingle(),
          supabase.from('strategy_content_collection_attachments').select('*').eq('session_id', sessionId),
          supabase.from('strategy_web_projects')
            .select('social_youtube_url, social_facebook_url, social_instagram_url, social_tiktok_url')
            .eq('id', (s as SessionRow).web_project_id)
            .maybeSingle(),
        ])
        if (cancelled) return
        setTopics((topicsRes.data ?? []) as TopicRow[])
        const sMap = new Map<string, SnippetRow>()
        for (const r of (snippetsRes.data ?? []) as SnippetRow[]) sMap.set(r.token, r)
        setSnippets(sMap)
        const m = new Map<string, Mark>()
        for (const row of (marksRes.data ?? []) as Mark[]) m.set(row.target_path, row)
        setMarks(m)
        const recapData = (recapRes.data ?? null) as DiscoveryRecap | null
        setRecap(recapData)
        setAttachments((attRes.data ?? []) as AttachmentRow[])

        // Fire-and-forget strategy-brief load. Runs after the initial
        // page render so the partner sees the form fast; the brief
        // prefills swap in once parsed (~1-2s for a typical brief).
        void loadStrategyBriefSections((s as SessionRow).web_project_id).then(brief => {
          if (cancelled) return
          setStrategyBriefPrefills(strategyBriefToExternalPrefills(brief))
        })
        const photoUrl = (recapData?.photo_library_url
          ?? (p as Record<string, unknown>).photos_link
          ?? (p as Record<string, unknown>).legacy_photo_library
          ?? (p as Record<string, unknown>).photos_from_all_in_discovery_form
          ?? null) as string | null
        // Build the social-links prefill — prefer crawl-extracted
        // globals on strategy_web_projects (the canonical home for
        // URL-shaped socials), fall back to the account_progress
        // entries the AM filled in by hand. Each platform renders as
        // one line so the partner sees a tidy "Platform: url" stack.
        const pr = p as Record<string, unknown>
        const proj = (projRes.data ?? null) as Record<string, unknown> | null
        const fbVal = String(proj?.social_facebook_url ?? pr.facebook_link ?? pr.facebook ?? '').trim()
        const igVal = String(proj?.social_instagram_url ?? pr.instagram_link ?? pr.instagram ?? '').trim()
        const ytVal = String(proj?.social_youtube_url ?? pr.youtube ?? '').trim()
        const ttVal = String(proj?.social_tiktok_url ?? '').trim()
        const socialLines = [
          fbVal ? `Facebook: ${fbVal}`   : null,
          igVal ? `Instagram: ${igVal}`  : null,
          ytVal ? `YouTube: ${ytVal}`    : null,
          ttVal ? `TikTok: ${ttVal}`     : null,
        ].filter(Boolean)
        const socialPrefill = socialLines.length > 0 ? socialLines.join('\n') : null
        // YouTube channel URL — used as the Step 2 sermon-channel
        // prefill fallback when the crawl didn't categorize it into
        // the sermons topic. Sourced from the same global column.
        const projYouTubeUrl = ytVal || null
        setPartner({
          member:        p.member,
          church_name:   p.church_name ?? null,
          first_name:    p.first_name_of_primary ?? null,
          am_name:       p.css_rep ?? null,
          am_channel_id: chanRes.data?.id ?? null,
          photo_library_url: photoUrl,
          social_links_prefill: socialPrefill,
          sermon_channel_url: projYouTubeUrl,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token, sessionId])

  // Index topics by key for fast bucket lookups
  const topicsByKey = (() => {
    const out = new Map<string, TopicRow>()
    for (const t of topics) out.set(t.topic_key, t)
    return out
  })()

  // ── Mark mutations ─────────────────────────────────────────────────
  const saveMark: SaveMark = async (path, kind, status, note = null, extra = {}) => {
    if (!sessionId) return
    const next: Mark = {
      id: marks.get(path)?.id ?? '',
      target_kind: kind,
      target_path: path,
      status,
      client_note: note ?? null,
      proposed_program_name: extra?.proposed_program_name ?? null,
      proposed_program_description: extra?.proposed_program_description ?? null,
    }
    // Optimistic update
    setMarks(prev => new Map(prev).set(path, next))
    const { data, error } = await supabase
      .from('strategy_content_collection_marks')
      .upsert({
        session_id: sessionId,
        target_kind: kind,
        target_path: path,
        status,
        client_note: note ?? null,
        proposed_program_name: extra?.proposed_program_name ?? null,
        proposed_program_description: extra?.proposed_program_description ?? null,
      }, { onConflict: 'session_id,target_path' })
      .select('id')
      .single()
    if (error) {
      console.error('Mark save failed', error)
      return
    }
    setMarks(prev => {
      const m = new Map(prev)
      m.set(path, { ...next, id: data.id })
      return m
    })
  }

  const saveSessionField = async <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => {
    if (!sessionId || !session) return
    setSession({ ...session, [field]: value })
    const { error } = await supabase
      .from('strategy_content_collection_sessions')
      .update({ [field]: value })
      .eq('id', sessionId)
    if (error) console.error('Session save failed', field, error)
  }

  const submitFinal = async () => {
    if (!sessionId) return
    await supabase
      .from('strategy_content_collection_sessions')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', sessionId)
    // Reconcile snippets with the partner's submitted answers. Fire-
    // and-forget so a slow / failing edge function doesn't block the
    // "you've submitted" screen — staff can also trigger this manually
    // from the Intake & Crawl page if it fails silently.
    void supabase.functions.invoke('refresh-snippets-from-content-collection', {
      body: { session_id: sessionId },
    }).catch(err => { console.error('[snippet refresh] failed', err) })
    setSession(session ? { ...session, status: 'submitted' } : null)
  }

  // ── Loading / error gates ──────────────────────────────────────────
  if (loading) return <FullPageLoader />
  if (notFound || !session || !partner) return <NotFound />
  if (session.status === 'submitted') return <AlreadySubmitted partner={partner} token={token!} />

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <Header partner={partner} session={session} step={step} token={token!} />

      <main className="flex-1 px-4 sm:px-6 py-6 md:py-10">
        {/* Same max-width for both steps so the inventory (Step 1)
         *  and the recap/form 2-col layout (Step 2) line up with the
         *  header above. Header uses the same value. */}
        <div className="max-w-6xl mx-auto">
          {step === 1 && (
            <Step1Review
              topicsByKey={topicsByKey}
              snippetsByToken={snippetsByToken}
              marks={marks}
              saveMark={saveMark}
              recap={recap}
              session={session}
              attachments={attachments}
              onAttachmentChange={(updater) => setAttachments(prev => updater(prev))}
              externalPrefills={{
                ...(partner.photo_library_url
                  ? { 'branding_photos/photo_library': partner.photo_library_url }
                  : {}),
                ...(partner.social_links_prefill
                  ? { 'social_newsletter/social_links': partner.social_links_prefill }
                  : {}),
                // Sermon archive falls back to the YouTube channel URL
                // when the categorizer didn't surface a sermon-specific
                // URL. Same source as the Step 2 "Link to sermon
                // channel" prefill — fire-crawl-trigger writes it to
                // strategy_web_projects.social_youtube_url.
                ...(partner.sermon_channel_url
                  ? { 'sermons/archive_url': partner.sermon_channel_url }
                  : {}),
                // Mission + Vision + Values come from the AM-curated
                // strategy brief (markdown file). Falls back to the
                // partner's raw discovery answer when no brief exists.
                // The brief is the authoritative source — listed
                // LAST so it overrides the discovery prefill below.
                ...(recap?.mission_vision_statement
                  ? {
                      'mission_beliefs/mission_statement': recap.mission_vision_statement,
                      'mission_beliefs/vision_statement':  recap.mission_vision_statement,
                    }
                  : {}),
                ...strategyBriefPrefills,
              }}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2Form
              session={session}
              recap={recap}
              snippetsByToken={snippetsByToken}
              topicsByKey={topicsByKey}
              attachments={attachments}
              onAttachmentChange={(updater) => setAttachments(prev => updater(prev))}
              sermonChannelUrl={partner.sermon_channel_url}
              saveField={saveSessionField}
              onBack={() => setStep(1)}
              onSubmit={submitFinal}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────

function Header({ partner, session, step, token }: { partner: PartnerCtx; session: SessionRow; step: 1 | 2; token: string }) {
  const due = formatDue(session.due_at)
  return (
    <header className="bg-hero-gradient text-cream px-4 sm:px-6 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <Link to={`/portal/${token}/hub`} className="text-xs font-bold uppercase tracking-[0.18em] text-lavender hover:text-cream inline-flex items-center gap-1">
            <ArrowLeft size={12} /> Hub
          </Link>
          <span className="text-lavender/50 text-xs">/</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-cream">Website Content Collection</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h1 className="font-serif italic text-2xl md:text-3xl">{partner.church_name ?? 'Website Content Collection'}</h1>
          {session.due_at && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
              due.tone === 'overdue' ? 'bg-red-100 text-red-700' :
              due.tone === 'soon'    ? 'bg-amber-100 text-amber-800' :
                                       'bg-cream/20 text-cream'
            }`}>
              <Calendar size={10} />
              {due.label}
            </span>
          )}
        </div>
        <p className="text-cream/80 text-sm mt-2">
          {step === 1
            ? 'Step 1 of 2 — Review your site information and details.'
            : 'Step 2 of 2 — Managing your new website.'}
        </p>
        <p className="text-cream/70 text-xs mt-1.5 inline-flex items-center gap-1.5">
          <CheckCircle2 size={11} className="text-cream/80 shrink-0" />
          Your responses save automatically. Close this tab any time and pick back up where you left off.
        </p>
        <ProgressBar step={step} />
      </div>
    </header>
  )
}

function ProgressBar({ step }: { step: 1 | 2 }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <div className={`h-1 rounded-full ${step >= 1 ? 'bg-cream' : 'bg-cream/30'}`} />
      <div className={`h-1 rounded-full ${step >= 2 ? 'bg-cream' : 'bg-cream/30'}`} />
    </div>
  )
}

// ── Step 1: Inventory Review (uses shared InventoryView) ────────────

function Step1Review({
  topicsByKey, snippetsByToken, marks, saveMark, recap, session, attachments, onAttachmentChange, externalPrefills, onContinue,
}: {
  topicsByKey:     Map<string, TopicRow>
  snippetsByToken: Map<string, SnippetRow>
  marks:           Map<string, Mark>
  saveMark:        SaveMark
  recap:           DiscoveryRecap | null
  session:         SessionRow
  attachments:     AttachmentRow[]
  onAttachmentChange: (updater: (prev: AttachmentRow[]) => AttachmentRow[]) => void
  externalPrefills:   Record<string, string>
  onContinue:      () => void
}) {
  const copyAllowance = copyAllowanceFromRecap(recap)
  // "Start from scratch" suppresses the crawl entirely — the partner
  // doesn't want any reference to existing content.
  const hideInventory = copyAllowance.key === 'do_not_use'
  return (
    <div className="space-y-6">
      <div className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
        <p className="font-serif italic text-deep-plum text-lg md:text-xl mb-2">
          You&rsquo;re one step closer to your new website.
        </p>
        <p className="text-purple-gray text-sm leading-relaxed">
          This form is where we&rsquo;ll gather the content and key information that will power your new website. To save you time, we&rsquo;ve already pulled content from your current site, so if your website is up to date, most of the heavy lifting is already done.
        </p>
        <p className="text-deep-plum text-sm font-semibold mt-4">As you review the information below:</p>
        <ol className="mt-2 space-y-3 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">1</span>
            <span className="text-deep-plum">
              <strong>Confirm what&rsquo;s correct</strong> — if the information accurately represents your church, there&rsquo;s nothing else you need to do.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">2</span>
            <span className="text-deep-plum">
              <strong>Fill in any gaps</strong> — if there&rsquo;s something missing or outdated from your current site, let us know so we can start with the most accurate information.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">3</span>
            <span className="text-deep-plum">
              <strong>Answer a few quick questions</strong> — your responses help us determine how to best structure your website based on how you use it.
            </span>
          </li>
        </ol>
        <div className="mt-5 pt-4 border-t border-lavender/60">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">What&rsquo;s next?</p>
          <p className="text-purple-gray text-xs leading-relaxed italic">
            Once you&rsquo;re finished, we&rsquo;ll use everything you&rsquo;ve shared to build a website strategy that reflects your church, supports your goals, and helps people take their next step.
          </p>
        </div>
      </div>

      {copyAllowance.partnerMessage && (
        <div className="bg-lavender-tint/40 border border-lavender rounded-xl p-4 md:p-5">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">
            Copywriting Approach from Discovery Questionnaire
          </p>
          <p className="text-sm text-deep-plum">{copyAllowance.partnerMessage}</p>
          {/* Crawl-allowance pill is staff-only — partners get just
              the plain-English message above. Staff see the chip via
              the WM inventory view (separate render path). */}
        </div>
      )}

      {!hideInventory && (
        <InventoryView
          topicsByKey={topicsByKey}
          snippetsByToken={snippetsByToken}
          reviewMode={true}
          marks={marks}
          saveMark={saveMark}
          sessionId={session.id}
          attachments={attachments}
          onAttachmentChange={onAttachmentChange}
          externalPrefills={externalPrefills}
        />
      )}
      {hideInventory && (
        <div className="bg-white border border-lavender rounded-2xl p-5 md:p-6 text-center">
          <p className="text-deep-plum font-semibold mb-1">Skipping the content review.</p>
          <p className="text-purple-gray text-sm">
            You chose to start your new site with completely fresh copy, so we&rsquo;re not asking you to review what&rsquo;s on your current site. Use the next step to tell us about your church and what you&rsquo;d like included.
          </p>
        </div>
      )}

      <div className="bg-white border border-lavender rounded-2xl p-4 md:p-5 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-deep-plum text-sm">
          Done reviewing? A few more questions next.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-cream font-semibold px-5 py-2.5 hover:bg-purple-mid transition-colors"
        >
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}


// ── Step 2: Content Collection Form ──────────────────────────────────

function Step2Form({
  session, recap, snippetsByToken, topicsByKey, attachments, onAttachmentChange, sermonChannelUrl, saveField, onBack, onSubmit,
}: {
  session:           SessionRow
  recap:             DiscoveryRecap | null
  snippetsByToken:   Map<string, SnippetRow>
  topicsByKey:       Map<string, TopicRow>
  attachments:       AttachmentRow[]
  onAttachmentChange: (updater: (prev: AttachmentRow[]) => AttachmentRow[]) => void
  sermonChannelUrl:  string | null
  saveField:         <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
  onBack:            () => void
  onSubmit:          () => Promise<void>
}) {
  // Auto-prefill: when the partner hasn't entered an external link
  // for sermons / events / groups, push the best candidate from the
  // crawl into the session row so the field renders pre-populated.
  //   • sermons → youtube_url snippet, or any youtube / youtu.be /
  //     vimeo URL inside the `sermons` topic items
  //   • events  → first http(s) CTA inside the `events` topic
  //   • groups  → first http(s) CTA inside the `connect_groups` topic
  // Runs once per mount; partner edits override silently because
  // saveField writes the new value back.
  useEffect(() => {
    if (!session.sermons_external_url) {
      // Three-step fallback chain. The snippet check was historically
      // empty for older crawls (fire-crawl-trigger routes the URL to
      // strategy_web_projects.social_youtube_url instead of inserting
      // into web_project_snippets), so `sermonChannelUrl` is the
      // authoritative source for sites where the global was filled.
      const yt = snippetsByToken.get('youtube_url')?.expansion
        ?? firstSermonChannelUrl(topicsByKey.get('sermons'))
        ?? sermonChannelUrl
        ?? null
      if (yt) void saveField('sermons_external_url', yt)
    }
    const eventsCta = firstExternalCtaUrl(topicsByKey.get('events'))
    if (!session.events_external_url && eventsCta) {
      void saveField('events_external_url', eventsCta)
    }
    // Same crawl source feeds the WP "source of truth" question — if
    // the partner runs events out of Church Center / CCB today, that's
    // both the link to direct visitors to AND the upstream system of
    // record. Partner can edit either independently after prefill.
    if (!session.events_wordpress_source_of_truth && eventsCta) {
      void saveField('events_wordpress_source_of_truth', eventsCta)
    }
    if (!session.groups_external_url) {
      const url = firstExternalCtaUrl(topicsByKey.get('connect_groups'))
      if (url) void saveField('groups_external_url', url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ProvideInfoSection is the "start from scratch" carve-out: when
  // the partner chose to not reference any existing content, the
  // crawl is irrelevant and they need to supply everything fresh.
  // In that case we promote the section to the TOP of Step 2 and
  // hide the rest of the form's crawl-dependent prompts.
  const fromScratch = copyAllowanceFromRecap(recap).key === 'do_not_use'

  return (
    // Two-column layout mirroring Step 1's TOC pattern. The Discovery
    // recap lives in the left column as a sticky aside on lg+ so the
    // partner always has the discovery context next to whatever
    // question they're answering. On smaller screens the recap stacks
    // above the form.
    <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <aside className="mb-6 lg:mb-0 lg:sticky lg:top-6">
        <DiscoveryRecapSection recap={recap} />
      </aside>
      <div className="space-y-6 min-w-0">
        {fromScratch && (
          <ProvideInfoSection
            session={session}
            attachments={attachments}
            onAttachmentChange={onAttachmentChange}
            saveField={saveField}
          />
        )}
        <MaintenanceContextSection session={session} recap={recap} saveField={saveField} />
        <CmsManagedTypesSection
          session={session}
          recap={recap}
          topicsByKey={topicsByKey}
          marks={null}
          attachments={attachments}
          onAttachmentChange={onAttachmentChange}
          saveField={saveField}
        />
        <EventsQuestion session={session} saveField={saveField} />
        <SermonsQuestion session={session} saveField={saveField} />
        {/* Archive setup only applies when the partner wants to manage
         *  sermons inside WordPress — for the external-channel flow
         *  these questions are irrelevant (YouTube/Vimeo handles them). */}
        {session.sermons_display_preference === 'wordpress' && (
          <SermonArchiveFeaturesQuestion session={session} saveField={saveField} />
        )}
        <GroupsQuestion session={session} saveField={saveField} />
        <MerchQuestion
          session={session}
          topicsByKey={topicsByKey}
          saveField={saveField}
        />
        <MinistriesToGrowSection
          session={session}
          topicsByKey={topicsByKey}
          saveField={saveField}
        />
        <ShortAnswerSection session={session} saveField={saveField} />
        <DomainSection session={session} saveField={saveField} />
        <HostingSection session={session} saveField={saveField} />
      </div>

      {/* Footer action row spans both columns so back/submit reads at
       *  full width on lg+ — matches Step 1's continue row. On mobile
       *  the recap sits above the form and the footer just stacks. */}
      <div className="lg:col-span-2 mt-6 bg-white border border-lavender rounded-2xl p-4 md:p-5 flex items-center justify-between gap-3 flex-wrap">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-purple-gray inline-flex items-center gap-1.5 hover:text-deep-plum">
          <ArrowLeft size={14} /> Back to review
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!session.hosting_approved}
          className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-cream font-semibold px-5 py-2.5 hover:bg-purple-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit Content Collection <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function DiscoveryRecapSection({ recap }: { recap: DiscoveryRecap | null }) {
  if (!recap) return null
  // "Inspiration" intentionally omitted — partners don't need their
  // inspiration websites surfaced back to them on Step 2.
  const items: { label: string; value: string | null | undefined }[] = [
    { label: 'Project priority',         value: recap.top_website_priority },
    { label: 'Top goals',                value: recap.top_3_website_goals },
    { label: 'Approach to copywriting',  value: recap.copy_approach },
    { label: 'Ideal website experience', value: recap.ideal_website_experience },
    { label: 'Community connection',     value: recap.best_outreach_methods },
    { label: 'How you speak to your audience', value: recap.audience_voice_style },
    { label: 'Words / tones to avoid',   value: recap.words_tones_to_avoid },
  ]
  const present = items.filter(i => i.value && i.value.trim())
  if (present.length === 0) return null
  // Rendered inside the left aside column of Step2Form — single
  // column list, no inner grid. Card chrome stays so it reads as
  // distinct from the form questions to its right.
  return (
    <section className="bg-white border border-lavender rounded-2xl p-4 md:p-5">
      <h2 className="font-serif italic text-lg text-deep-plum mb-3">From your discovery</h2>
      <dl className="space-y-3">
        {present.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">{label}</dt>
            <dd className="text-[13px] text-deep-plum mt-0.5 whitespace-pre-line leading-snug">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function MaintenanceContextSection({
  session, recap, saveField,
}: {
  session:   SessionRow
  recap:     DiscoveryRecap | null
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  if (!recap?.high_maintenance_pages) return null
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-1">High-maintenance pages</h2>
      {recap.high_maintenance_pages && (
        <div className="mt-3">
          <p className="text-sm text-deep-plum mb-2">
            In discovery, you listed the following pages that require the most frequent maintenance:
          </p>
          <p className="bg-lavender-tint/40 border border-lavender rounded-md px-3 py-2 text-sm text-deep-plum whitespace-pre-line">
            {recap.high_maintenance_pages}
          </p>
          <FieldLong
            label="Any additional context or examples to help us build a CMS that resolves this?"
            value={session.high_maintenance_pages_context}
            onChange={v => saveField('high_maintenance_pages_context', v)}
            optional
          />
        </div>
      )}
    </section>
  )
}

function EventsQuestion({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  const choice = session.events_display_preference
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">How would you like to display events on your website?</h2>
      <p className="text-purple-gray text-xs mb-3">Required</p>
      <div className="space-y-2">
        <Radio
          name="events"
          value="external"
          current={choice}
          label="We manage events in a separate platform and want to direct site visitors there"
          onChange={v => saveField('events_display_preference', v as SessionRow['events_display_preference'])}
        />
        {choice === 'external' && (
          <div className="pl-8">
            <FieldShort label="Link to your events" placeholder="https://..." value={session.events_external_url} onChange={v => saveField('events_external_url', v)} required />
          </div>
        )}
        <Radio
          name="events"
          value="embed"
          current={choice}
          label="Embed events from our Church Management Software directly on our site"
          help="Recommended if you use Planning Center or Church Community Builder."
          onChange={v => saveField('events_display_preference', v as SessionRow['events_display_preference'])}
        />
        {choice === 'embed' && (
          <div className="pl-8 space-y-3">
            <p className="text-xs text-purple-gray italic">Great. Your developer will contact you in the build phase to set up the integration.</p>
            <FieldShort
              label="Do you have a preference on how events are displayed? (e.g. Card view (default), List view, Calendar view)"
              placeholder="Card view"
              value={session.events_display_format}
              onChange={v => saveField('events_display_format', v)}
              help="This will depend on your platform’s capabilities, but we’ll do our best to accommodate."
            />
          </div>
        )}
        <Radio
          name="events"
          value="wordpress"
          current={choice}
          label="Manage and display events directly through WordPress"
          onChange={v => saveField('events_display_preference', v as SessionRow['events_display_preference'])}
        />
        {choice === 'wordpress' && (
          <div className="pl-8 space-y-2">
            <FieldLong label="Which platform is your current source of truth for events?" value={session.events_wordpress_source_of_truth} onChange={v => saveField('events_wordpress_source_of_truth', v)} required />
            <FieldLong label="What causes the most frustration with your current event system? Please provide a link if helpful." value={session.events_wordpress_frustration} onChange={v => saveField('events_wordpress_frustration', v)} required />
            <FieldLong label="Does your events manager need to support recurring events?" value={session.events_wordpress_recurring_needed} onChange={v => saveField('events_wordpress_recurring_needed', v)} required />
            <FieldShort
              label="Do you have a preference on how events are displayed? (e.g. Card view (default), List view, Calendar view)"
              placeholder="Card view"
              value={session.events_display_format}
              onChange={v => saveField('events_display_format', v)}
            />
          </div>
        )}
        <Radio
          name="events"
          value="none"
          current={choice}
          label="We do not want to display events on our website"
          onChange={v => saveField('events_display_preference', v as SessionRow['events_display_preference'])}
        />
      </div>
    </section>
  )
}

function SermonsQuestion({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  const choice = session.sermons_display_preference
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">How would you like to manage sermons on your website?</h2>
      <p className="text-purple-gray text-xs mb-3">Required — pick the level of complexity that fits how you want to maintain this section.</p>
      <div className="space-y-2">
        {/* Tier 1 — Easiest. Just a CTA button; no embed on the site. */}
        <Radio
          name="sermons"
          value="cta_only"
          current={choice}
          label="CTA button linking to our YouTube / Vimeo channel"
          tierLabel="Easiest"
          tierTone="green"
          onChange={v => saveField('sermons_display_preference', v as SessionRow['sermons_display_preference'])}
        />
        {choice === 'cta_only' && (
          <div className="pl-8 space-y-3">
            <FieldShort
              label="Link to your sermon channel"
              placeholder="https://youtube.com/..."
              value={session.sermons_external_url}
              onChange={v => saveField('sermons_external_url', v)}
            />
          </div>
        )}

        {/* Tier 2 — Recommended. Embed the most recent sermon on the
            Watch page; everything else still lives on YouTube/Vimeo. */}
        <Radio
          name="sermons"
          value="embed_latest"
          current={choice}
          label="Embed the most-recent sermon on our Watch page (everything else stays on YouTube)"
          tierLabel="Recommended"
          tierTone="purple"
          onChange={v => saveField('sermons_display_preference', v as SessionRow['sermons_display_preference'])}
        />
        {choice === 'embed_latest' && (
          <div className="pl-8 space-y-3">
            <FieldShort
              label="Link to your sermon channel"
              placeholder="https://youtube.com/..."
              value={session.sermons_external_url}
              onChange={v => saveField('sermons_external_url', v)}
            />
            <YesNoField
              label="Do you have a YouTube playlist set up to store your messages?"
              value={session.sermon_youtube_playlist_exists}
              onChange={v => saveField('sermon_youtube_playlist_exists', v)}
            />
            {session.sermon_youtube_playlist_exists === true && (
              <FieldShort
                label="Playlist link"
                placeholder="https://youtube.com/playlist?list=..."
                value={session.sermon_youtube_playlist_url}
                onChange={v => saveField('sermon_youtube_playlist_url', v)}
              />
            )}
          </div>
        )}

        {/* Tier 3 — Most Complex. Full WordPress archive with per-
            sermon pages; archive-features question fires next. */}
        <Radio
          name="sermons"
          value="wordpress"
          current={choice}
          label="List our entire sermon archive on our website with a single page for each sermon"
          tierLabel="Most Complex"
          tierTone="amber"
          onChange={v => saveField('sermons_display_preference', v as SessionRow['sermons_display_preference'])}
        />
      </div>
    </section>
  )
}

/** Multi-select sermon-archive setup question. Renders right after
 *  the main sermons display-preference question on Step 2. Stored on
 *  strategy_content_collection_sessions.sermon_archive_features
 *  (text[]). Optional — partners can skip without blocking submit. */
function SermonArchiveFeaturesQuestion({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  const OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'discussion_guides', label: 'Include Discussion Guides with each Sermon' },
    { value: 'sermon_notes',      label: 'Include Sermon Notes with each Sermon' },
    { value: 'audio_files',       label: 'Include Audio Files with each Sermon' },
    { value: 'filters',           label: 'Create Filters based on Topic, Passage, Speaker, etc.' },
  ]
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">
        Let us know which of the following apply to your preferred sermon archive setup.
      </h2>
      <p className="text-purple-gray text-xs mb-3">Select all that apply</p>
      <PartnerCheckboxGroup
        value={session.sermon_archive_features ?? []}
        onChange={(next) => void saveField('sermon_archive_features', next)}
        options={OPTIONS.map(opt => ({
          value: opt.value,
          label: opt.label,
          followUp: opt.value === 'filters'
            ? (
              <FieldLong
                label="Please list the filters you’d like created"
                placeholder="e.g. Topic, Bible passage, Speaker, Series"
                value={session.sermon_filters_text}
                onChange={v => saveField('sermon_filters_text', v)}
                required
              />
            )
            : undefined,
        }))}
      />
    </section>
  )
}

/** Optional merch-store question. Surfaces always (so partners with
 *  un-crawled stores can still answer), with a prominent note when
 *  the crawl found merch evidence. Prefills from the merch topic's
 *  first CTA URL OR from any item whose name/url mentions merch keywords. */
function MerchQuestion({
  session, topicsByKey, saveField,
}: {
  session:     SessionRow
  topicsByKey: Map<string, TopicRow>
  saveField:   <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  const detectedUrl = useMemo(() => detectMerchUrl(topicsByKey), [topicsByKey])
  const hasDetection = !!detectedUrl
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">
        Do you have a merch / online store?
      </h2>
      <p className="text-purple-gray text-xs mb-3">Optional</p>
      <div className="rounded-md border border-lavender bg-lavender-tint/30 px-3 py-2 mb-3 text-[12px] text-deep-plum leading-snug">
        Heads up: the new site can <strong>link visitors out</strong> to
        your existing merch store (Shopify, Printful, etc.) but our
        subscription doesn&rsquo;t include ecommerce hosting. Drop the
        URL below and we&rsquo;ll wire it up as a CTA.
      </div>
      {hasDetection && (
        <p className="text-purple-gray text-[12px] mb-2">
          We found what looks like a merch link on your current site —
          confirm or replace it below.
        </p>
      )}
      <FieldShort
        label="Link to your merch / shop store"
        placeholder={detectedUrl ?? 'https://your-store.com or your-church.printful.me'}
        value={session.merch_store_url ?? detectedUrl}
        onChange={v => saveField('merch_store_url', v)}
      />
    </section>
  )
}

/** Walks every topic looking for a URL that smells like a merch
 *  store — match on host (printful, shopify, redbubble, etc.) OR on
 *  path / label keywords (/shop, /store, /merch, "apparel", "swag"). */
function detectMerchUrl(topicsByKey: Map<string, TopicRow>): string | null {
  const MERCH_HOSTS = /printful|shopify|bigcartel|redbubble|teespring|spreadshop|printify|squareup\.com|square\.online|wix\.com.*\/shop/i
  const MERCH_KEYWORDS = /\b(shop|store|merch|apparel|swag|merchandise|gear|t-?shirt|hoodie)\b/i
  const seen = new Set<string>()
  for (const topic of topicsByKey.values()) {
    for (const item of topic.items ?? []) {
      const url = String(item.url ?? '').trim()
      if (url && /^https?:\/\//i.test(url)) {
        if (MERCH_HOSTS.test(url)) return url
        if (!seen.has(url)) {
          // Path-based fallback — only when the label / name also
          // looks merch-ish, since /shop alone could be a generic page.
          const labelOrName = String(item.label ?? item.name ?? '')
          if (MERCH_KEYWORDS.test(url) && MERCH_KEYWORDS.test(labelOrName)) {
            return url
          }
          seen.add(url)
        }
      }
    }
  }
  return null
}

function GroupsQuestion({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  const choice = session.groups_display_preference
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">How would you like to display small groups on your website?</h2>
      <p className="text-purple-gray text-xs mb-3">Required</p>
      <div className="space-y-2">
        <Radio
          name="groups"
          value="external"
          current={choice}
          label="Direct visitors to an external platform (Planning Center, Breeze, CCB, etc.)"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
        {choice === 'external' && (
          <div className="pl-8">
            <FieldShort label="Link to your groups" placeholder="https://..." value={session.groups_external_url} onChange={v => saveField('groups_external_url', v)} required />
          </div>
        )}
        <Radio
          name="groups"
          value="embed"
          current={choice}
          label="Embed individual small groups from Planning Center directly on our site"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
        {choice === 'embed' && (
          <p className="pl-8 text-xs text-purple-gray italic">Great. Your developer will contact you in the build phase to set up the integration.</p>
        )}
        <Radio
          name="groups"
          value="wordpress"
          current={choice}
          label="Display and manage individual small groups directly through your website"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
        {choice === 'wordpress' && (
          <div className="pl-8 space-y-2">
            <FieldLong label="Which platform is your current source of truth for groups? Include a link." value={session.groups_wordpress_source_of_truth} onChange={v => saveField('groups_wordpress_source_of_truth', v)} required />
            <FieldLong label="What causes the most frustration with your current group management system?" value={session.groups_wordpress_frustration} onChange={v => saveField('groups_wordpress_frustration', v)} required />
          </div>
        )}
        <Radio
          name="groups"
          value="contact"
          current={choice}
          label="Don't display individual small groups — direct visitors to contact us for information"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
      </div>
    </section>
  )
}

// ── CMS-managed content types ────────────────────────────────────────
//
// "Keep your website easy to update" — partner selects which content
// types they want their team to manage in WordPress. Auto-pre-checks
// the boxes when the crawl found evidence of the content type, OR
// when the partner added a missing-content mark on the matching Step 1
// inventory bucket. Per-type CSV uploads appear when the crawl found
// nothing AND nothing was added on Step 1.

interface CmsType {
  /** Stored value in cms_managed_types[]. Also the file-upload kind. */
  value:           string
  label:           string
  /** Topic keys in the crawl that count as evidence for this type. */
  topicKeys:       string[]
  /** Inventory bucket keys whose marks (partner additions) also count. */
  bucketKeys:      string[]
  /** Upload kind to surface when no content was found. Null skips upload. */
  uploadKind:      AttachmentKind | null
  uploadHelp?:     string
}

const CMS_TYPES: CmsType[] = [
  { value: 'volunteers',     label: 'Volunteer Opportunities',
    topicKeys: ['serve'], bucketKeys: ['volunteers'],
    uploadKind: 'volunteer_csv',
    uploadHelp: "Optional CSV of your current volunteer roles so we can pre-populate your directory." },
  { value: 'staff_directory', label: 'Staff Directory',
    topicKeys: ['leadership'], bucketKeys: ['staff'],
    uploadKind: 'staff_csv',
    uploadHelp: "Upload a CSV of your staff (name, role, email, bio, photo URL) — we'll use it to build the directory." },
  { value: 'blog',           label: 'Blog',
    topicKeys: ['blog_news'], bucketKeys: ['blog'],
    uploadKind: null },
  { value: 'careers',        label: 'Career Opportunities',
    topicKeys: [], bucketKeys: ['careers'],
    uploadKind: 'careers_csv',
    uploadHelp: "If you don’t have an active opening that’s okay — an example of a past one will help us know how to draft the content management." },
  { value: 'testimonials',   label: 'Testimonials',
    topicKeys: ['testimonies'], bucketKeys: ['testimonies'],
    uploadKind: 'testimonials_csv',
    uploadHelp: "Upload a CSV of testimonies you'd like featured (name, quote, optional photo URL)." },
  { value: 'groups',         label: 'Groups Directory',
    topicKeys: ['connect_groups'], bucketKeys: ['small_groups'],
    uploadKind: 'groups_csv',
    uploadHelp: "Optional CSV of your active groups so we can pre-populate the directory." },
  { value: 'sermons',        label: 'Sermons',
    topicKeys: ['sermons'], bucketKeys: ['sermons'],
    uploadKind: null },
  { value: 'events',         label: 'Events',
    topicKeys: ['events', 'camps_retreats'], bucketKeys: ['events'],
    uploadKind: null },
  { value: 'campuses',       label: 'Campuses / Locations',
    topicKeys: ['locations_multi'], bucketKeys: ['campuses'],
    uploadKind: 'campuses_csv',
    uploadHelp: "Upload a CSV or Word doc of your campuses (name, address, service times, campus pastor) — we'll use it to build the locations page." },
]

/** True if the crawl found content for this CMS type — used both for
 *  the auto-precheck logic and to suppress the CSV upload affordance. */
function cmsTypeHasContent(type: CmsType, topicsByKey: Map<string, TopicRow>): boolean {
  for (const tk of type.topicKeys) {
    const t = topicsByKey.get(tk)
    if (!t) continue
    const itemCount = (t.items?.length ?? 0)
    const passageCount = (t.passages?.length ?? 0)
    if (itemCount > 0 || passageCount > 0) return true
  }
  return false
}

function CmsManagedTypesSection({
  session, recap, topicsByKey, marks, attachments, onAttachmentChange, saveField,
}: {
  session:         SessionRow
  recap:           DiscoveryRecap | null
  topicsByKey:     Map<string, TopicRow>
  marks:           Map<string, Mark> | null
  attachments:     AttachmentRow[]
  onAttachmentChange: (updater: (prev: AttachmentRow[]) => AttachmentRow[]) => void
  saveField:       <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  // Pre-check logic: on first mount, when cms_managed_types is still
  // null, populate it with the CMS types where the crawl found
  // matching content. Partner can de-select but the defaults are
  // already aligned with what they'd care to manage.
  useEffect(() => {
    if (session.cms_managed_types !== null) return
    const prechecked = CMS_TYPES
      .filter(t => cmsTypeHasContent(t, topicsByKey))
      .map(t => t.value)
    void saveField('cms_managed_types', prechecked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-2">Keep your website easy to update</h2>
      <p className="text-purple-gray text-sm leading-relaxed">
        A great website doesn’t just serve visitors. It should also make life easier for your staff.
      </p>
      <p className="text-purple-gray text-sm leading-relaxed mt-2">
        For pages that change frequently, we can set up a content management system that allows your team to add, edit, and remove content without touching the website design. Common examples include staff directories, events, careers, volunteer opportunities, and locations.
      </p>
      <p className="text-deep-plum text-sm font-semibold mt-3 mb-3">
        Select any content types below that you’d like your team to manage on an ongoing basis.
      </p>
      <PartnerCheckboxGroup
        value={session.cms_managed_types ?? []}
        onChange={(next) => void saveField('cms_managed_types', next)}
        options={CMS_TYPES.map(t => {
          const hasContent = cmsTypeHasContent(t, topicsByKey)
          // CSV upload reveals when the box is checked AND no crawl
          // content / partner additions exist for this type. The
          // 'blog' option has its own sub-form instead of a CSV.
          const showUpload = t.uploadKind && !hasContent
          return {
            value: t.value,
            label: t.label,
            meta:  hasContent
              ? (
                <span className="text-[10px] uppercase tracking-wider font-bold text-primary-purple">
                  Found on site
                </span>
              )
              : null,
            followUp: t.value === 'blog'
              ? (
                <BlogHandlingSubform
                  session={session}
                  recap={recap}
                  topicsByKey={topicsByKey}
                  saveField={saveField}
                />
              )
              : showUpload && t.uploadKind
              ? (
                <div className="p-3 bg-cream/40 border border-lavender/60 rounded-lg">
                  <FileUploadField
                    sessionId={session.id}
                    kind={t.uploadKind}
                    attachments={attachments.filter(a => a.kind === t.uploadKind) as unknown as AttachmentMetadata[]}
                    onUploaded={(a) => onAttachmentChange(prev => [a as unknown as AttachmentRow, ...prev])}
                    onDeleted={(id) => onAttachmentChange(prev => prev.filter(x => x.id !== id))}
                    label={t.uploadHelp ? `Upload your ${t.label.toLowerCase()} file` : undefined}
                    help={t.uploadHelp}
                    compact
                  />
                </div>
              )
              : undefined,
          }
        })}
      />
    </section>
  )
}

// ── Blog handling sub-form ───────────────────────────────────────────

const BLOG_FILTER_OPTIONS = [
  { value: 'topic',     label: 'Topic / Category' },
  { value: 'verse',     label: 'Bible Verse' },
  { value: 'series',    label: 'Series' },
  { value: 'author',    label: 'Author' },
]

const SERMON_BLOG_DISCOVERY_NEEDLE = 'sermon-based blog post'

function BlogHandlingSubform({
  session, recap, topicsByKey, saveField,
}: {
  session:     SessionRow
  recap:       DiscoveryRecap | null
  topicsByKey: Map<string, TopicRow>
  saveField:   <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  // Auto-pre-check 'sermon_based' when discovery shows the partner
  // already opted into sermon-based blog generation upstream.
  useEffect(() => {
    if (session.blog_handling !== null) return
    const wantsSermonBlog = (recap?.initial_web_support_preferences ?? [])
      .some(p => p.toLowerCase().includes(SERMON_BLOG_DISCOVERY_NEEDLE))
    if (wantsSermonBlog) void saveField('blog_handling', 'sermon_based')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-fill the existing-blog URL from the crawl's blog topic CTAs
  // when 'transfer' is selected and the URL is still empty.
  useEffect(() => {
    if (session.blog_handling !== 'transfer') return
    if (session.blog_existing_url) return
    const url = firstExternalCtaUrl(topicsByKey.get('blog_news'))
    if (url) void saveField('blog_existing_url', url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.blog_handling])

  // Kick off a sub-crawl of the partner's existing blog URL so staff
  // can see individual blog posts in the WM CrawlWorkspace. Idempotent:
  // queries web-hub.crawl_jobs first to skip if a job for this URL
  // already exists in the project. Fire-and-forget — partner doesn't
  // wait, doesn't see it; staff finds the resulting row in the crawl
  // jobs list with target_url = the blog URL.
  useEffect(() => {
    if (session.blog_handling !== 'transfer') return
    const url = session.blog_existing_url?.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    let cancelled = false
    const fire = async () => {
      const { data: existing } = await supabase
        .schema('web-hub')
        .from('crawl_jobs')
        .select('id')
        .eq('project_id', session.web_project_id)
        .eq('target_url', url)
        .limit(1)
      if (cancelled || (existing && existing.length > 0)) return
      await supabase.rpc('web_crawl_fire_manual', {
        p_web_project_id: session.web_project_id,
        p_target_url:     url,
      })
    }
    void fire()
    return () => { cancelled = true }
  }, [session.blog_handling, session.blog_existing_url, session.web_project_id])

  return (
    <div className="p-4 bg-cream/40 border border-lavender/60 rounded-lg space-y-3">
      <p className="text-[11px] uppercase tracking-wider font-bold text-primary-purple">Blog setup</p>
      <Radio
        name="blog_handling"
        value="transfer"
        current={session.blog_handling}
        label="Transfer over our existing blog"
        onChange={v => saveField('blog_handling', v as SessionRow['blog_handling'])}
      />
      {session.blog_handling === 'transfer' && (
        <div className="pl-8">
          <FieldShort
            label="Link to your existing blog"
            placeholder="https://..."
            value={session.blog_existing_url}
            onChange={v => saveField('blog_existing_url', v)}
            required
          />
        </div>
      )}
      <Radio
        name="blog_handling"
        value="sermon_based"
        current={session.blog_handling}
        label="Sermon-based blog written by TheSquad"
        help="Generated upon submission of a 'post sermon' web project request."
        onChange={v => saveField('blog_handling', v as SessionRow['blog_handling'])}
      />
      <Radio
        name="blog_handling"
        value="new"
        current={session.blog_handling}
        label="Create a new blog"
        onChange={v => saveField('blog_handling', v as SessionRow['blog_handling'])}
      />
      {session.blog_handling === 'new' && (
        <div className="pl-8 space-y-3">
          <RichTextField
            label="Describe the heart behind your blog and the type of information to be conveyed"
            value={session.blog_new_description}
            onChange={v => saveField('blog_new_description', v)}
            placeholder="e.g. encouragement for new believers, parenting wisdom, weekly devotionals…"
          />
          <PartnerCheckboxGroup
            label="What filters would you like to include?"
            optional
            grid
            value={session.blog_new_filters ?? []}
            onChange={(next) => void saveField('blog_new_filters', next)}
            options={BLOG_FILTER_OPTIONS.map(f => ({ value: f.value, label: f.label }))}
          />
        </div>
      )}
    </div>
  )
}

// ── Ministries-to-grow + ministry chips ──────────────────────────────

function MinistriesToGrowSection({
  session, topicsByKey, saveField,
}: {
  session:     SessionRow
  topicsByKey: Map<string, TopicRow>
  saveField:   <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  // Build a chip list of ministry / program names found in the crawl,
  // filtered hard so the list reads as actual ongoing ministries —
  // not dated services, merch, sermon-series titles, agency
  // references, or duplicate variants.
  //
  // Rules:
  //   • Topics first run through sanitizeTopicsForPartner so Church
  //     Media Squad / TheSquad / dated services already get dropped
  //     before the chip walk.
  //   • Only kind='program' items count.
  //   • Reject dated names ("03.16.24 …", "Jun 1 …", "06/01 …").
  //   • Reject merch-shaped names (hat / tee / hoodie / mug / bottle
  //     / sticker / apparel — captures Paradox's "Be A More Loving
  //     Person Hat", "32oz Paradox Mug", etc.).
  //   • Reject sermon-series-style names with a ` | ` separator
  //     ("Why I Love Paradox | Jon Arellano-Jackson").
  //   • Reject one-off / generic logistics names via NON_MINISTRY_RE.
  //   • Normalize for dedup: lower-case, strip "more about" /
  //     "learn about" / leading articles, collapse whitespace.
  //   • When two names normalize to the same root, keep the SHORTER
  //     one — "DSC Kids" beats "More about DSC Kids".
  const programNames = useMemo(() => {
    const sanitized = sanitizeTopicsForPartner(topicsByKey)
    const ministryTopics = ['kids', 'students', 'college', 'adults', 'care', 'missions', 'school', 'other', 'serve', 'connect_groups']
    const NON_MINISTRY_RE = /\b(service\s+times?|service\s+schedule|check[-\s]?in|check[-\s]?in\s+process|driving\s+directions?|directions?|parking|visit|first[-\s]?time|plan\s+a\s+visit|new\s+here|sermon\s+series|watch|livestream|live\s+stream|give|giving|donate|tithe|map|location|address|hours|faq|frequently|about|connect|next\s+step|info|information|details?|page|home|sign[-\s]?up|register|registration|contact|email|phone)\b/i
    const DATED_NAME_RE = /^\s*(?:\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{1,2})\b/i
    const MERCH_NAME_RE = /\b(tee|t-?shirt|long\s*sleeve|hoodie|sweatshirt|crewneck|sweater|hat|cap|beanie|mug|tumbler|water\s*bottle|sticker|tote|apparel|merch|merchandise|swag|unisex|kids?\s+unisex)\b/i
    const SERMON_PIPE_RE = /\s[|–—]\s/
    const TIME_PHRASE_RE = /\b(?:coffee|brunch|breakfast|lunch|dinner)\s+with\s+(?:pastor|the\s+pastor)/i

    const normalizeRoot = (s: string): string =>
      s.toLowerCase()
        .replace(/^(more|learn|read)\s+(about|more\s+about)\s+/i, '')
        .replace(/^(the|a|an|our)\s+/i, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    // Map: normalized root → best (shortest, non-truncated) candidate.
    const best = new Map<string, string>()
    for (const tk of ministryTopics) {
      const t = sanitized.get(tk)
      for (const it of (t?.items ?? [])) {
        const r = it as Record<string, unknown>
        if (String(r.kind ?? '') !== 'program') continue
        const name = String(r.name ?? r.title ?? r.label ?? '').trim()
        if (!name || name.length < 3 || name.length > 60) continue
        if (NON_MINISTRY_RE.test(name)) continue
        if (DATED_NAME_RE.test(name)) continue
        if (MERCH_NAME_RE.test(name)) continue
        if (SERMON_PIPE_RE.test(name)) continue
        if (TIME_PHRASE_RE.test(name)) continue
        // Single-word names are usually staff first names ("Darise",
        // "Hannah") that slipped from leadership into other topics —
        // reject unless the word is long + camelCased / suggests a
        // program ("ParaTots", "KidsMin").
        const wordCount = name.trim().split(/\s+/).length
        if (wordCount === 1) {
          const hasInternalCaps = /[a-z][A-Z]/.test(name)
          if (!hasInternalCaps) continue
        }
        const root = normalizeRoot(name)
        if (!root) continue
        const prev = best.get(root)
        if (!prev || name.length < prev.length) best.set(root, name)
        if (best.size > 40) break
      }
      if (best.size > 40) break
    }
    return Array.from(best.values()).sort((a, b) => a.localeCompare(b))
  }, [topicsByKey])

  const currentText = session.ministries_to_grow ?? ''
  const appendChip = (name: string) => {
    const trimmed = currentText.trim()
    const next = trimmed ? `${trimmed}, ${name}` : name
    void saveField('ministries_to_grow', next)
  }

  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">
        Of all your ministries and programs, which one or two are you actively trying to grow right now? <span className="text-amber-600">*</span>
      </h2>
      <p className="text-purple-gray text-xs mb-3">Pick from the chips below or type your own.</p>
      {programNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {programNames.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => appendChip(name)}
              className="text-[11px] font-semibold text-primary-purple border border-primary-purple/40 rounded-full px-2.5 py-1 hover:bg-lavender-tint/40 transition-colors"
            >
              + {name}
            </button>
          ))}
        </div>
      )}
      <FieldLong
        label=""
        value={session.ministries_to_grow}
        onChange={v => saveField('ministries_to_grow', v)}
        required
      />
    </section>
  )
}

// ── Provide info for new site (docx + optional CSVs) ─────────────────

function ProvideInfoSection({
  session, attachments, onAttachmentChange, saveField,
}: {
  session:     SessionRow
  attachments: AttachmentRow[]
  onAttachmentChange: (updater: (prev: AttachmentRow[]) => AttachmentRow[]) => void
  saveField:   <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 space-y-4">
      <header>
        <h2 className="font-serif italic text-xl text-deep-plum mb-1">
          Provide the information for your new site
        </h2>
        <p className="text-purple-gray text-sm">
          Upload anything you’d like TheSquad to use when writing and building your new site.
        </p>
      </header>

      <div>
        <p className="text-xs font-semibold text-deep-plum mb-1.5">
          Copy document <span className="text-amber-600">*</span>
        </p>
        <FileUploadField
          sessionId={session.id}
          kind="copy_doc"
          attachments={attachments.filter(a => a.kind === 'copy_doc') as unknown as AttachmentMetadata[]}
          onUploaded={(a) => onAttachmentChange(prev => [a as unknown as AttachmentRow, ...prev])}
          onDeleted={(id) => onAttachmentChange(prev => prev.filter(x => x.id !== id))}
          help="Upload a Word document (.docx) with the copy you’d like TheSquad to use. PDFs are not accepted."
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-deep-plum mb-1.5">
          Additional data <span className="text-purple-gray font-normal">(optional)</span>
        </p>
        <p className="text-[11px] text-purple-gray mb-2">
          CSVs for staff, volunteers, groups, or general info you’d like included.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['staff_csv', 'volunteer_csv', 'groups_csv'] as AttachmentKind[]).map(kind => (
            <FileUploadField
              key={kind}
              sessionId={session.id}
              kind={kind}
              attachments={attachments.filter(a => a.kind === kind) as unknown as AttachmentMetadata[]}
              onUploaded={(a) => onAttachmentChange(prev => [a as unknown as AttachmentRow, ...prev])}
              onDeleted={(id) => onAttachmentChange(prev => prev.filter(x => x.id !== id))}
              label={kind === 'staff_csv' ? 'Staff CSV' : kind === 'volunteer_csv' ? 'Volunteers CSV' : 'Groups CSV'}
              compact
            />
          ))}
        </div>
      </div>

      <RichTextField
        label="Please provide a list of ministries offered at your church"
        value={session.ministries_list_html}
        onChange={v => saveField('ministries_list_html', v)}
        placeholder="Kids, Students, Worship, Local Outreach, …"
      />
      <RichTextField
        label="Please provide your next steps / discipleship pathway"
        value={session.discipleship_pathway_html}
        onChange={v => saveField('discipleship_pathway_html', v)}
        placeholder="How does someone go from first-time visitor to fully-engaged disciple? Outline the stops along the way."
      />
    </section>
  )
}

// ── Yes/No + Rich text field helpers ─────────────────────────────────

function YesNoField({
  label, value, onChange,
}: {
  label:    string
  value:    boolean | null
  onChange: (v: boolean) => void
}) {
  return <PartnerYesNo label={label} value={value} onChange={onChange} />
}

function RichTextField({
  label, value, onChange, placeholder, required,
}: {
  label:        string
  value:        string | null
  onChange:     (v: string) => void
  placeholder?: string
  required?:    boolean
}) {
  return (
    <PartnerRichTextField label={label} required={required} minHeight={150}>
      <WMRichTextEditor
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        compact
      />
    </PartnerRichTextField>
  )
}

function ShortAnswerSection({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  // "Ministries to grow" lives in its own MinistriesToGrowSection
  // (chips + free text). This section is now just the "anything else"
  // catch-all so we don't double-ask.
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 space-y-4">
      <FieldLong
        label="Anything else (notes, questions, details) you'd like included on your website that wasn't covered here?"
        value={session.additional_context}
        onChange={v => saveField('additional_context', v)}
        optional
      />
    </section>
  )
}

function DomainSection({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-1">Preparing for launch — Domain</h2>
      <p className="text-purple-gray text-sm mb-4">
        This is where you bought your website name (domain), like <em>examplechurchname.com</em>.
        In some cases, DNS settings are managed through a different provider than your registrar — if that
        applies to you, we'll request additional info during launch.
      </p>

      <FieldShort
        label="Who is your domain registrar?"
        placeholder="e.g. https://godaddy.com"
        value={session.domain_registrar_url}
        onChange={v => saveField('domain_registrar_url', v)}
        help="Examples: GoDaddy, Google Domains, Namecheap."
        required
      />

      <div className="mt-4">
        <p className="text-sm font-semibold text-deep-plum mb-2">How would you like to provide login credentials?</p>
        <div className="space-y-2">
          <Radio
            name="cred"
            value="invite_admin"
            current={session.domain_credential_method}
            label="Create a limited-access user account for TheSquad through your domain registrar"
            help="Recommended. Available with most major registrars (GoDaddy, Cloudflare, etc.)"
            onChange={v => saveField('domain_credential_method', v as SessionRow['domain_credential_method'])}
          />
          {session.domain_credential_method === 'invite_admin' && (
            <label className="pl-8 mt-2 flex items-start gap-2 text-sm text-deep-plum">
              <input
                type="checkbox"
                checked={session.domain_invite_confirmed}
                onChange={e => saveField('domain_invite_confirmed', e.target.checked)}
                className="mt-1 accent-primary-purple"
              />
              <span>
                I've created a limited-access user account for <strong>admin.websquad@churchmediasquad.com</strong>
              </span>
            </label>
          )}
          <Radio
            name="cred"
            value="one_password"
            current={session.domain_credential_method}
            label="Share credentials via a 1Password share/invite link"
            help="Set up a shared item in 1Password and paste the share link below. We don't store usernames or passwords in our system."
            onChange={v => saveField('domain_credential_method', v as SessionRow['domain_credential_method'])}
          />
          {session.domain_credential_method === 'one_password' && (
            <div className="pl-8">
              <FieldShort
                label="1Password share / invite URL"
                placeholder="https://share.1password.com/..."
                value={session.domain_one_password_invite_url}
                onChange={v => saveField('domain_one_password_invite_url', v)}
                required
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function HostingSection({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-1">Hosting confirmation</h2>
      <p className="text-purple-gray text-sm mb-3">
        Your All-In subscription includes fully managed WordPress hosting through Pressable, covering
        secure hosting, performance + speed optimization, daily backups, security plugin management, and
        ongoing technical maintenance.
      </p>
      <p className="text-purple-gray text-xs mb-4 italic">
        Please note: you remain responsible for your domain name, DNS settings, and any third-party tools
        connected to your site. We can only guarantee performance and support when your site is hosted on
        our platform.
      </p>
      <label className="flex items-start gap-2 text-sm text-deep-plum">
        <input
          type="checkbox"
          checked={session.hosting_approved}
          onChange={e => saveField('hosting_approved', e.target.checked)}
          className="mt-1 accent-primary-purple"
        />
        <span>
          I approve having our new website hosted on Pressable, Church Media Squad's chosen platform.
        </span>
      </label>
    </section>
  )
}

// ── Form primitives ──────────────────────────────────────────────────

// FieldShort / FieldLong / Radio are now thin wrappers over the
// PartnerField primitives — they preserve their existing call sites
// (and the draft-buffer-on-blur pattern for text inputs) while
// switching the visuals over to the Essential Forms kit geometry.

function Radio({
  name, value, current, label, help, onChange, tierLabel, tierTone,
}: {
  name:       string
  value:      string
  current:    string | null
  label:      string
  help?:      string
  onChange:   (v: string) => void
  /** Optional complexity badge ("Easiest" / "Recommended" / "Most
   *  Complex") shown next to the label. */
  tierLabel?: string
  tierTone?:  'green' | 'purple' | 'amber'
}) {
  // One-option group — used by question sections that build their
  // radio list manually. PartnerRadioGroup is also exported and
  // preferred for new code, but keeping this single-option shim lets
  // existing question components keep their flat structure.
  return (
    <PartnerRadioGroup
      name={name}
      value={current}
      onChange={onChange}
      options={[{
        value, label, help,
        ...(tierLabel && tierTone ? { badge: { label: tierLabel, tone: tierTone } } : {}),
      }]}
    />
  )
}

function FieldShort({
  label, value, onChange, placeholder, help, required,
}: {
  label:       string
  value:       string | null
  onChange:    (v: string) => void
  placeholder?: string
  help?:       string
  required?:   boolean
}) {
  // Draft buffer so we save on blur, not on every keystroke.
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <PartnerTextInput
      label={label}
      placeholder={placeholder}
      helper={help}
      required={required}
      value={draft}
      onChange={setDraft}
      onBlur={() => onChange(draft)}
    />
  )
}

function FieldLong({
  label, value, onChange, placeholder, required, optional,
}: {
  label:        string
  value:        string | null
  onChange:     (v: string) => void
  placeholder?: string
  required?:    boolean
  optional?:    boolean
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <PartnerTextArea
      label={label}
      placeholder={placeholder}
      required={required}
      optional={optional}
      value={draft}
      onChange={setDraft}
      onBlur={() => onChange(draft)}
    />
  )
}

// ── Misc ─────────────────────────────────────────────────────────────

function FullPageLoader() {
  return (
    <div className="min-h-screen bg-cream grid place-items-center">
      <Loader2 className="animate-spin text-primary-purple" size={28} />
    </div>
  )
}

function NotFound() {
  return (
    <div className="min-h-screen bg-cream grid place-items-center px-6">
      <div className="text-center max-w-md">
        <AlertCircle className="mx-auto text-primary-purple mb-3" size={32} />
        <h1 className="font-serif italic text-2xl text-deep-plum mb-2">We couldn't load this page</h1>
        <p className="text-purple-gray text-sm">The link may have expired. Please reach out to your account manager.</p>
      </div>
    </div>
  )
}

function AlreadySubmitted({ partner, token }: { partner: PartnerCtx; token: string }) {
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="bg-hero-gradient text-cream px-6 py-10">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-serif italic text-3xl mb-2">{partner.church_name ?? 'Submitted'}</h1>
          <p className="text-cream/80 text-sm">Content Collection — Submitted</p>
        </div>
      </header>
      <main className="flex-1 px-6 py-10">
        <div className="max-w-2xl mx-auto text-center">
          <CheckCircle2 className="mx-auto text-emerald-500 mb-3" size={48} />
          <h2 className="font-serif italic text-2xl text-deep-plum mb-2">Thanks — we've got this from here.</h2>
          <p className="text-purple-gray text-sm mb-6">
            Your responses are in. Your team will review them and reach out with next steps. If you need
            to make a change, contact your account manager.
          </p>
          <Link to={`/portal/${token}/hub`} className="text-primary-purple font-semibold underline inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Back to hub
          </Link>
        </div>
      </main>
    </div>
  )
}

function formatDue(iso: string | null): { label: string; tone: 'normal' | 'soon' | 'overdue' } {
  if (!iso) return { label: 'No target submission date', tone: 'normal' }
  const due = new Date(iso)
  const days = Math.floor((due.getTime() - Date.now()) / 86400000)
  // Full month name + day so partners see "Target Submission: July 5"
  // rather than the abbreviated "Jul 5". Overdue / due-soon cases
  // keep the same chip color tone via the helper.
  const full = due.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (days < 0)   return { label: `Overdue: ${full}`, tone: 'overdue' }
  if (days === 0) return { label: `Target Submission: ${full} (today)`, tone: 'soon' }
  if (days <= 3)  return { label: `Target Submission: ${full} (${days}d)`, tone: 'soon' }
  return { label: `Target Submission: ${full}`, tone: 'normal' }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled'
}

/** Map the discovery questionnaire's free-form copy_approach value to
 *  a partner-facing message + a short "crawl allowance" label staff
 *  can scan from anywhere. Keyed on substrings rather than exact
 *  matches because Fillout returns the full radio label text. */
export interface CopyAllowance {
  key:            'minor_edits' | 'revisions_and_restructure' | 'no_changes' | 'do_not_use' | 'unknown'
  label:          string
  partnerMessage: string | null
}

export function copyAllowanceFromRecap(recap: DiscoveryRecap | null): CopyAllowance {
  const v = (recap?.copy_approach ?? '').toLowerCase()
  if (/start.*scratch|not reference any existing/.test(v)) {
    return {
      key:            'do_not_use',
      label:          'do not use',
      partnerMessage: 'Based on your discovery questionnaire, you chose to start entirely from scratch on the new site, so we won’t pull anything from your current website into the new build.',
    }
  }
  if (/use all.*verbatim|use all.*existing copy as.?is/.test(v)) {
    return {
      key:            'no_changes',
      label:          'no changes permitted',
      partnerMessage: 'Based on your discovery questionnaire, we’ll honor the copy on your existing website exactly as it is. The information below will be reflected with no changes on the new site.',
    }
  }
  if (/replace most|write new copy/.test(v)) {
    return {
      key:            'revisions_and_restructure',
      label:          'revisions and restructure',
      partnerMessage: 'Based on your discovery questionnaire, we’ll use the copy on your existing site as a foundation for the details, and recontextualize the information for your community in your distinct brand voice.',
    }
  }
  if (/keep most|edit\/refine|edit.{0,5}refine/.test(v)) {
    return {
      key:            'minor_edits',
      label:          'minor edits only',
      partnerMessage: 'Based on your discovery questionnaire, we’ll honor the copy on your existing website. The information below will be reflected with only minor revisions on the new site.',
    }
  }
  return { key: 'unknown', label: '', partnerMessage: null }
}

/** First YouTube / Vimeo URL found anywhere inside the sermons topic
 *  (top-level items + nested program items). Used as a fallback when
 *  the global `youtube_url` snippet isn't set but the crawl surfaced
 *  a channel link in a sermon-section CTA. Matches youtube.com,
 *  youtu.be, and vimeo.com — partners use any of the three. */
function firstSermonChannelUrl(topic: TopicRow | undefined): string | null {
  if (!topic) return null
  const CHANNEL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\b/i
  const walk = (items: unknown[]): string | null => {
    for (const raw of items) {
      const it = raw as Record<string, unknown>
      const url = String(it.url ?? '').trim()
      if (CHANNEL_RE.test(url)) return url
      const nested = it.items
      if (Array.isArray(nested)) {
        const sub = walk(nested)
        if (sub) return sub
      }
    }
    return null
  }
  return walk(topic.items ?? [])
}

/** First absolute http(s) URL found in any `cta` / `link` item across
 *  a topic — used to prefill the Step 2 events / groups external-link
 *  fields when the partner hasn't entered one. Walks nested program
 *  items too, since Church Center / CCB CTAs typically live inside
 *  the most prominent program card. */
function firstExternalCtaUrl(topic: TopicRow | undefined): string | null {
  if (!topic) return null
  const walk = (items: unknown[]): string | null => {
    for (const raw of items) {
      const it = raw as Record<string, unknown>
      const kind = String(it.kind ?? '')
      if (kind === 'cta' || kind === 'link') {
        const url = String(it.url ?? '').trim()
        if (/^https?:\/\//i.test(url)) return url
      }
      const nested = it.items
      if (Array.isArray(nested)) {
        const sub = walk(nested)
        if (sub) return sub
      }
    }
    return null
  }
  return walk(topic.items ?? [])
}

