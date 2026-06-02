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
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Calendar, CheckCircle2, Loader2, AlertCircle, ArrowRight, ArrowLeft, Edit3, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { InventoryView, type TopicRow, type SnippetRow, type Mark as InvMark, type MarkStatus, type SaveMark } from '../components/wm/inventory/InventoryView'

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

  domain_registrar_url:              string | null
  domain_credential_method:          'invite_admin' | 'one_password' | null
  domain_invite_confirmed:           boolean
  domain_one_password_invite_url:    string | null
  hosting_approved:                  boolean

  submitted_at:                      string | null
}

interface Mark extends InvMark {
  id:                            string
  proposed_program_name:         string | null
  proposed_program_description:  string | null
}

interface DiscoveryRecap {
  top_website_priority:        string | null
  top_3_website_goals:         string | null
  copy_approach:               string | null
  ideal_website_experience:    string | null
  best_outreach_methods:       string | null
  audience_voice_style:        string | null
  words_tones_to_avoid:        string | null
  inspirational_websites:      string | null
  weekly_maintenance_hours:    string | null
  high_maintenance_pages:      string | null
  software_in_use:             string | null
}

interface PartnerCtx {
  member:        number
  church_name:   string | null
  first_name:    string | null
  am_name:       string | null
  am_channel_id: string | null
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

  useEffect(() => {
    if (!token || !sessionId) { setNotFound(true); setLoading(false); return }
    let cancelled = false

    const load = async () => {
      try {
        // 1. Verify token + load partner context
        const { data: p } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name, first_name_of_primary, css_rep')
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

        // 3. Topics + snippets + marks + recap + AM channel (parallel)
        const [topicsRes, snippetsRes, marksRes, recapRes, chanRes] = await Promise.all([
          supabase.from('web_project_topics')
            .select('id, topic_key, topic_label, voice_signal, passages, items, added_snippet_tokens, source_page_urls')
            .eq('web_project_id', (s as SessionRow).web_project_id),
          supabase.from('web_project_snippets')
            .select('token, label, expansion')
            .eq('web_project_id', (s as SessionRow).web_project_id)
            .eq('archived', false),
          supabase.from('strategy_content_collection_marks').select('*').eq('session_id', sessionId),
          supabase.from('strategy_discovery_questionnaire')
            .select('top_website_priority, top_3_website_goals, copy_approach, ideal_website_experience, best_outreach_methods, audience_voice_style, words_tones_to_avoid, inspirational_websites, weekly_maintenance_hours, high_maintenance_pages, software_in_use')
            .eq('member', p.member)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('clickup_chat_channels').select('id').eq('memberid', p.member).limit(1).maybeSingle(),
        ])
        if (cancelled) return
        setTopics((topicsRes.data ?? []) as TopicRow[])
        const sMap = new Map<string, SnippetRow>()
        for (const r of (snippetsRes.data ?? []) as SnippetRow[]) sMap.set(r.token, r)
        setSnippets(sMap)
        const m = new Map<string, Mark>()
        for (const row of (marksRes.data ?? []) as Mark[]) m.set(row.target_path, row)
        setMarks(m)
        setRecap((recapRes.data ?? null) as DiscoveryRecap | null)
        setPartner({
          member:        p.member,
          church_name:   p.church_name ?? null,
          first_name:    p.first_name_of_primary ?? null,
          am_name:       p.css_rep ?? null,
          am_channel_id: chanRes.data?.id ?? null,
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
        <div className={step === 1 ? 'max-w-6xl mx-auto' : 'max-w-3xl mx-auto'}>
          {step === 1 && (
            <Step1Review
              topicsByKey={topicsByKey}
              snippetsByToken={snippetsByToken}
              marks={marks}
              saveMark={saveMark}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2Form
              session={session}
              recap={recap}
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
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <Link to={`/portal/${token}/hub`} className="text-xs font-bold uppercase tracking-[0.18em] text-lavender hover:text-cream inline-flex items-center gap-1">
            <ArrowLeft size={12} /> Hub
          </Link>
          <span className="text-lavender/50 text-xs">/</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-cream">Content Collection</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h1 className="font-serif italic text-2xl md:text-3xl">{partner.church_name ?? 'Content Collection'}</h1>
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
            ? 'Step 1 of 2 — Review what we found on your current site.'
            : 'Step 2 of 2 — Tell us how you’d like the new site to work.'}
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
  topicsByKey, snippetsByToken, marks, saveMark, onContinue,
}: {
  topicsByKey:     Map<string, TopicRow>
  snippetsByToken: Map<string, SnippetRow>
  marks:           Map<string, Mark>
  saveMark:        SaveMark
  onContinue:      () => void
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
        <p className="font-serif italic text-deep-plum text-lg md:text-xl mb-2">
          Let&rsquo;s get you one step closer to your new website.
        </p>
        <p className="text-purple-gray text-sm leading-relaxed">
          To start, we need to get to know everything about your church. We&rsquo;ve made it
          easy by collecting the details from your current site — they&rsquo;re below.
        </p>
        <ol className="mt-4 space-y-2 text-sm">
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">1</span>
            <span className="text-deep-plum">
              <strong>Review</strong> the information below — double-check that the details from your current site are still accurate and approved for our use.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">2</span>
            <span className="text-deep-plum">
              <strong>Identify gaps</strong> — any missing information you&rsquo;d like to see represented.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-bold shrink-0 mt-0.5">3</span>
            <span className="text-deep-plum">
              <strong>Answer a few outlying questions</strong> to help us get started.
            </span>
          </li>
        </ol>
        <div className="mt-4 pt-4 border-t border-lavender/60">
          <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple mb-1">On deck</p>
          <p className="text-purple-gray text-xs leading-relaxed italic">
            Once you approve, we&rsquo;ll pair this with your goals + audience to build a website content strategy — so your new site serves your community through your unique voice and programs.
          </p>
        </div>
        <p className="mt-4 text-deep-plum font-semibold text-sm">Let&rsquo;s get started! ↓</p>
      </div>

      <InventoryView
        topicsByKey={topicsByKey}
        snippetsByToken={snippetsByToken}
        reviewMode={true}
        marks={marks}
        saveMark={saveMark}
      />

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
  session, recap, saveField, onBack, onSubmit,
}: {
  session:   SessionRow
  recap:     DiscoveryRecap | null
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
  onBack:    () => void
  onSubmit:  () => Promise<void>
}) {
  return (
    <div className="space-y-6">
      <DiscoveryRecapSection recap={recap} />
      <MaintenanceContextSection session={session} recap={recap} saveField={saveField} />
      <EventsQuestion session={session} saveField={saveField} />
      <SermonsQuestion session={session} saveField={saveField} />
      <SermonArchiveFeaturesQuestion session={session} saveField={saveField} />
      <GroupsQuestion session={session} saveField={saveField} />
      <ShortAnswerSection session={session} saveField={saveField} />
      <DomainSection session={session} saveField={saveField} />
      <HostingSection session={session} saveField={saveField} />

      <div className="bg-white border border-lavender rounded-2xl p-4 md:p-5 flex items-center justify-between gap-3 flex-wrap">
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
  const items: { label: string; value: string | null | undefined }[] = [
    { label: 'Project priority',         value: recap.top_website_priority },
    { label: 'Top goals',                value: recap.top_3_website_goals },
    { label: 'Approach to copywriting',  value: recap.copy_approach },
    { label: 'Ideal website experience', value: recap.ideal_website_experience },
    { label: 'Community connection',     value: recap.best_outreach_methods },
    { label: 'How you speak to your audience', value: recap.audience_voice_style },
    { label: 'Words / tones to avoid',   value: recap.words_tones_to_avoid },
    { label: 'Inspiration',              value: recap.inspirational_websites },
  ]
  const present = items.filter(i => i.value && i.value.trim())
  if (present.length === 0) return null
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-1">From your discovery</h2>
      <p className="text-purple-gray text-sm mb-4">A quick recap so we're working from the same page.</p>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        {present.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-primary-purple">{label}</dt>
            <dd className="text-sm text-deep-plum mt-0.5 whitespace-pre-line leading-snug">{value}</dd>
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
  if (!recap?.high_maintenance_pages && !recap?.weekly_maintenance_hours) return null
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-serif italic text-xl text-deep-plum mb-1">Managing your new website</h2>
      {recap.weekly_maintenance_hours && (
        <p className="text-purple-gray text-sm mb-3">
          Your team currently spends about <strong className="text-deep-plum">{recap.weekly_maintenance_hours}</strong> on your site each week. Your Web Squad will help cut that down.
        </p>
      )}
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
          <FieldShort label="Link to your events" placeholder="https://..." value={session.events_external_url} onChange={v => saveField('events_external_url', v)} required />
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
          <p className="ml-7 text-xs text-purple-gray italic">Great — your developer will contact you in the build phase to set up the integration.</p>
        )}
        <Radio
          name="events"
          value="wordpress"
          current={choice}
          label="Manage and display events directly through WordPress"
          onChange={v => saveField('events_display_preference', v as SessionRow['events_display_preference'])}
        />
        {choice === 'wordpress' && (
          <div className="ml-7 space-y-2">
            <FieldLong label="Which platform is your current source of truth for events?" value={session.events_wordpress_source_of_truth} onChange={v => saveField('events_wordpress_source_of_truth', v)} required />
            <FieldLong label="What causes the most frustration with your current event system? Please provide a link if helpful." value={session.events_wordpress_frustration} onChange={v => saveField('events_wordpress_frustration', v)} required />
            <FieldLong label="Does your events manager need to support recurring events?" value={session.events_wordpress_recurring_needed} onChange={v => saveField('events_wordpress_recurring_needed', v)} required />
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
      <p className="text-purple-gray text-xs mb-3">Required</p>
      <div className="space-y-2">
        <Radio
          name="sermons"
          value="external"
          current={choice}
          label="Direct viewers to YouTube/Vimeo and only host the most recent sermon on our website (Recommended)"
          onChange={v => saveField('sermons_display_preference', v as SessionRow['sermons_display_preference'])}
        />
        {choice === 'external' && (
          <FieldShort label="Link to your sermon channel" placeholder="https://youtube.com/..." value={session.sermons_external_url} onChange={v => saveField('sermons_external_url', v)} />
        )}
        <Radio
          name="sermons"
          value="wordpress"
          current={choice}
          label="Add and manage our sermon archive within WordPress"
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
  const selected = new Set(session.sermon_archive_features ?? [])
  const toggle = (v: string) => {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    saveField('sermon_archive_features', Array.from(next))
  }
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6">
      <h2 className="font-semibold text-deep-plum text-base mb-1">
        Let us know which of the following apply to your preferred sermon archive setup.
      </h2>
      <p className="text-purple-gray text-xs mb-3">Select all that apply</p>
      <div className="space-y-2">
        {OPTIONS.map(opt => {
          const isSelected = selected.has(opt.value)
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                isSelected
                  ? 'border-primary-purple bg-lavender-tint/40'
                  : 'border-lavender bg-white hover:border-primary-purple/40 hover:bg-cream/30'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(opt.value)}
                className="mt-0.5 h-4 w-4 accent-primary-purple shrink-0 cursor-pointer"
              />
              <span className="text-sm text-deep-plum">{opt.label}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
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
          <FieldShort label="Link to your groups" placeholder="https://..." value={session.groups_external_url} onChange={v => saveField('groups_external_url', v)} required />
        )}
        <Radio
          name="groups"
          value="embed"
          current={choice}
          label="Embed individual small groups from Planning Center directly on our site"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
        {choice === 'embed' && (
          <p className="ml-7 text-xs text-purple-gray italic">Great — your developer will contact you in the build phase to set up the integration.</p>
        )}
        <Radio
          name="groups"
          value="wordpress"
          current={choice}
          label="Display and manage individual small groups directly through your website"
          onChange={v => saveField('groups_display_preference', v as SessionRow['groups_display_preference'])}
        />
        {choice === 'wordpress' && (
          <div className="ml-7 space-y-2">
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

function ShortAnswerSection({
  session, saveField,
}: {
  session:   SessionRow
  saveField: <K extends keyof SessionRow>(field: K, value: SessionRow[K]) => Promise<void>
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 space-y-4">
      <FieldLong
        label="Of all your ministries and programs, which one or two are you actively trying to grow right now?"
        value={session.ministries_to_grow}
        onChange={v => saveField('ministries_to_grow', v)}
        required
      />
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
            <label className="ml-7 mt-2 flex items-start gap-2 text-sm text-deep-plum">
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
            <FieldShort
              label="1Password share / invite URL"
              placeholder="https://share.1password.com/..."
              value={session.domain_one_password_invite_url}
              onChange={v => saveField('domain_one_password_invite_url', v)}
              help="We'll never persist the underlying username or password — just the share link."
              required
            />
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

function Radio({
  name, value, current, label, help, onChange,
}: {
  name:    string
  value:   string
  current: string | null
  label:   string
  help?:   string
  onChange: (v: string) => void
}) {
  const checked = current === value
  return (
    <label className={`flex items-start gap-2 cursor-pointer rounded-lg p-2 -m-2 ${checked ? 'bg-lavender-tint/40' : 'hover:bg-lavender-tint/20'}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 accent-primary-purple"
      />
      <span className="flex-1 text-sm text-deep-plum">
        {label}
        {help && <span className="block text-xs text-purple-gray mt-0.5 italic">{help}</span>}
      </span>
    </label>
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
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <div className="mt-2 ml-7">
      <label className="block text-xs font-semibold text-deep-plum mb-1">
        {label} {required && <span className="text-amber-600">*</span>}
      </label>
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onChange(draft)}
        placeholder={placeholder}
        className="w-full text-sm border border-lavender bg-cream/30 rounded-md px-3 py-2 text-deep-plum focus:outline-none focus:border-primary-purple"
      />
      {help && <p className="text-xs text-purple-gray mt-1">{help}</p>}
    </div>
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
    <div className="mt-2">
      <label className="block text-xs font-semibold text-deep-plum mb-1">
        {label}{' '}
        {required && <span className="text-amber-600">*</span>}
        {optional && <span className="text-purple-gray font-normal">(optional)</span>}
      </label>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onChange(draft)}
        placeholder={placeholder}
        rows={3}
        className="w-full text-sm border border-lavender bg-cream/30 rounded-md px-3 py-2 text-deep-plum focus:outline-none focus:border-primary-purple"
      />
    </div>
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
  if (!iso) return { label: 'No due date', tone: 'normal' }
  const due = new Date(iso)
  const days = Math.floor((due.getTime() - Date.now()) / 86400000)
  if (days < 0)   return { label: `Overdue ${-days}d`, tone: 'overdue' }
  if (days === 0) return { label: 'Due today', tone: 'soon' }
  if (days <= 3)  return { label: `Due in ${days}d`, tone: 'soon' }
  return { label: `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, tone: 'normal' }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled'
}

