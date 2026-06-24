/**
 * ContentCollectionResponsesPanel — staff view of what the partner
 * answered on the Content Collection portal.
 *
 * Surfaces three layers of partner input:
 *   1. Step 2 form fields (display preferences, sermon archive opts,
 *      CMS-managed types, blog handling, ministries lists, etc.).
 *   2. Step 1 marks — partner edits to baseline form fields ("answer:"
 *      paths) AND "add something we missed" entries ("missing:" paths),
 *      including any attachments tagged to them.
 *   3. Attachments uploaded outside of marks (copy doc, CSVs).
 *
 * Lives on the Intake & Crawl tab so staff sees crawl + responses
 * together. Auto-loads the most recent non-closed session for the
 * project; if no session exists yet, the panel quietly omits itself.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, FileText, MessagesSquare, Pencil, AlertCircle, ExternalLink, RefreshCw, Paperclip, CheckCircle2, Undo2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { attachmentPublicUrl, type AttachmentMetadata } from '../../../lib/contentCollectionAttachments'
import { ContentCollectionAutoFillStaff } from './ContentCollectionAutoFillStaff'

interface Props { projectId: string }

interface SessionRow {
  id:                                string
  member:                            number
  status:                            'open' | 'submitted' | 'closed'
  due_at:                            string | null
  submitted_at:                      string | null
  created_at:                        string
  // Step 2 fields
  events_display_preference:         string | null
  events_external_url:               string | null
  events_wordpress_source_of_truth:  string | null
  events_wordpress_frustration:      string | null
  events_wordpress_recurring_needed: string | null
  events_display_format:             string | null
  merch_store_url:                   string | null
  sermons_display_preference:        string | null
  sermons_external_url:              string | null
  sermon_archive_features:           string[] | null
  sermon_filters_text:               string | null
  sermon_youtube_playlist_exists:    boolean | null
  sermon_youtube_playlist_url:       string | null
  groups_display_preference:         string | null
  groups_external_url:               string | null
  groups_wordpress_source_of_truth:  string | null
  groups_wordpress_frustration:      string | null
  ministries_to_grow:                string | null
  ministries_list_html:              string | null
  discipleship_pathway_html:         string | null
  cms_managed_types:                 string[] | null
  blog_handling:                     string | null
  blog_existing_url:                 string | null
  blog_new_description:              string | null
  blog_new_filters:                  string[] | null
  high_maintenance_pages_context:    string | null
  additional_context:                string | null
  domain_registrar_url:              string | null
  domain_credential_method:          string | null
  domain_invite_confirmed:           boolean
  domain_one_password_invite_url:    string | null
  hosting_approved:                  boolean
}

interface MarkRow {
  id:                            string
  target_path:                   string
  target_kind:                   string
  status:                        string
  client_note:                   string | null
  proposed_program_name:         string | null
  proposed_program_description:  string | null
  marked_at:                     string
}

export function ContentCollectionResponsesPanel({ projectId }: Props) {
  const [session, setSession]         = useState<SessionRow | null>(null)
  const [marks, setMarks]             = useState<MarkRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([])
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [refreshMsg, setRefreshMsg]   = useState<string | null>(null)
  const [reopening, setReopening]     = useState(false)

  const load = async () => {
    setLoading(true)
    // Most-recent non-closed session for the project
    const { data: s } = await supabase
      .from('strategy_content_collection_sessions')
      .select('*')
      .eq('web_project_id', projectId)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!s) {
      setSession(null); setMarks([]); setAttachments([]); setLoading(false); return
    }
    setSession(s as SessionRow)
    const [marksRes, attRes] = await Promise.all([
      supabase
        .from('strategy_content_collection_marks')
        .select('id, target_path, target_kind, status, client_note, proposed_program_name, proposed_program_description, marked_at')
        .eq('session_id', s.id)
        .order('marked_at', { ascending: false }),
      supabase
        .from('strategy_content_collection_attachments')
        .select('*')
        .eq('session_id', s.id)
        .order('uploaded_at', { ascending: false }),
    ])
    setMarks((marksRes.data ?? []) as MarkRow[])
    setAttachments((attRes.data ?? []) as AttachmentMetadata[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [projectId])

  /** Trigger refresh-snippets-from-content-collection edge function.
   *  Staff-initiated; the same function also fires automatically on
   *  partner submit so this button is for "I edited a snippet
   *  upstream and want CC values to win" or "the prefill drift'd". */
  const refreshSnippets = async () => {
    if (!session) return
    setRefreshing(true); setRefreshMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('refresh-snippets-from-content-collection', {
        body: { session_id: session.id },
      })
      if (error) {
        setRefreshMsg(`Failed: ${error.message}`)
      } else {
        const r = data as { updated?: number; created?: number; skipped?: number } | null
        setRefreshMsg(
          r ? `${r.updated ?? 0} snippet${(r.updated ?? 0) === 1 ? '' : 's'} updated · ${r.created ?? 0} created · ${r.skipped ?? 0} unchanged`
            : 'Refreshed (no detail)',
        )
      }
    } catch (e) {
      setRefreshMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setRefreshing(false)
    setTimeout(() => setRefreshMsg(null), 5000)
  }

  /** Staff-only reopen. Flips a submitted session back to 'open' and
   *  clears submitted_at so the partner's portal link is editable
   *  again. Useful when the partner submitted prematurely or staff
   *  needs them to fix Page 2. The partner's previous answers stay
   *  saved — only status + submitted_at change. */
  const reopenSession = async () => {
    if (!session || session.status !== 'submitted') return
    if (!confirm(
      'Reopen this submission?\n\n' +
      "The partner's portal link becomes editable again. Their previous answers stay saved. " +
      'They will not be notified — let them know separately if needed.',
    )) return
    setReopening(true)
    setRefreshMsg(null)
    const { error } = await supabase
      .from('strategy_content_collection_sessions')
      .update({ status: 'open', submitted_at: null })
      .eq('id', session.id)
    setReopening(false)
    if (error) {
      setRefreshMsg(`Reopen failed: ${error.message}`)
      setTimeout(() => setRefreshMsg(null), 5000)
      return
    }
    setRefreshMsg('Session reopened — partner can edit the portal again.')
    setTimeout(() => setRefreshMsg(null), 5000)
    await load()
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-wm-border bg-wm-bg-elevated px-5 py-4 grid place-items-center text-wm-text-muted">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }
  if (!session) return null

  const answerMarks  = marks.filter(m => m.target_path.startsWith('answer:'))
  const missingMarks = marks.filter(m => m.target_path.startsWith('missing:'))

  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated">
      <header className="px-5 py-4 border-b border-wm-border flex items-baseline gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <MessagesSquare size={14} className="text-wm-accent" />
            <h2 className="text-[14px] font-bold text-wm-text">Partner Responses</h2>
            <StatusChip status={session.status} submittedAt={session.submitted_at} />
            {session.status === 'submitted' && (
              <button
                type="button"
                onClick={() => void reopenSession()}
                disabled={reopening}
                className="inline-flex items-center gap-1 rounded-full border border-wm-border bg-wm-bg text-wm-text-muted text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 hover:bg-wm-bg-hover hover:text-wm-text disabled:opacity-50"
                title="Flip status back to Open so the partner's portal link is editable again. Their answers stay saved."
              >
                {reopening ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
                Reopen
              </button>
            )}
          </div>
          <p className="text-[12px] text-wm-text-muted mt-0.5">
            What the partner answered on the Content Collection portal —
            display preferences, baseline edits, "something we missed"
            additions, and any files they uploaded.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-wm-text-muted shrink-0">
          <span>{answerMarks.length} edits</span>
          <span>·</span>
          <span>{missingMarks.length} additions</span>
          <span>·</span>
          <span>{attachments.length} files</span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-2 text-wm-accent hover:underline text-[11px]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={refreshSnippets}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-wm-accent/30 bg-wm-bg text-wm-accent text-[11px] font-semibold px-2.5 py-1 hover:bg-wm-accent-tint disabled:opacity-50"
            title="Re-scan partner answers and update / create snippets so future builds use the latest partner-supplied values. Does NOT spend a Firecrawl token."
          >
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh snippets
          </button>
        </div>
      </header>

      {refreshMsg && (
        <div className="px-5 py-2 bg-wm-accent-tint/40 border-b border-wm-accent/20 text-[11px] text-wm-text inline-flex items-center gap-2">
          <CheckCircle2 size={11} className="text-wm-success" />
          {refreshMsg}
        </div>
      )}

      <div className="p-5 space-y-5">
        <ContentCollectionAutoFillStaff
          projectId={projectId}
          sessionId={session.id}
          session={session as unknown as Record<string, unknown>}
          onAccepted={() => void load()}
        />
        <Step2AnswersSection session={session} />
        {answerMarks.length > 0 && (
          <Step1AnswerEditsSection marks={answerMarks} />
        )}
        {missingMarks.length > 0 && (
          <Step1MissingSection marks={missingMarks} attachments={attachments} />
        )}
        {attachments.filter(a => a.kind !== 'missing').length > 0 && (
          <AttachmentsSection attachments={attachments.filter(a => a.kind !== 'missing')} />
        )}
      </div>
    </div>
  )
}

// ── Subsections ──────────────────────────────────────────────────────

function StatusChip({ status, submittedAt }: { status: SessionRow['status']; submittedAt: string | null }) {
  if (status === 'submitted') {
    const when = submittedAt ? new Date(submittedAt).toLocaleString() : 'just now'
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-wm-success bg-wm-success-bg border border-wm-success/30 rounded-full px-2 py-0.5">
        Submitted {when}
      </span>
    )
  }
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-wm-accent bg-wm-accent-tint border border-wm-accent/30 rounded-full px-2 py-0.5">
        In progress
      </span>
    )
  }
  return null
}

function Step2AnswersSection({ session }: { session: SessionRow }) {
  // Compact Q&A list of every Step 2 form field. Renders only the
  // questions the partner actually touched so staff scans this in
  // seconds — empties don't pollute the read.
  const rows = useMemo(() => buildStep2Rows(session), [session])
  if (rows.length === 0) {
    return (
      <Block icon={<Pencil size={11} />} title="Step 2 — Form answers">
        <p className="text-[12px] text-wm-text-muted italic">
          Partner hasn’t answered any Step 2 questions yet.
        </p>
      </Block>
    )
  }
  return (
    <Block icon={<Pencil size={11} />} title={`Step 2 — Form answers (${rows.length})`}>
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        {rows.map(r => (
          <div key={r.key} className={r.span === 2 ? 'sm:col-span-2' : ''}>
            <dt className="text-[12px] font-semibold text-wm-text leading-snug">{r.question}</dt>
            <dd className="text-[13px] text-wm-text-muted mt-1 whitespace-pre-line leading-snug">
              <span className="text-wm-text font-medium">{r.answer}</span>
              {r.detail && (
                <>
                  <span className="text-wm-text-subtle"> · </span>
                  <span className="font-mono text-[12px] break-all">{r.detail}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Block>
  )
}

function Step1AnswerEditsSection({ marks }: { marks: MarkRow[] }) {
  return (
    <Block icon={<Pencil size={11} />} title={`Step 1 — Baseline answers (${marks.length})`}>
      <p className="text-[11px] text-wm-text-muted mb-2 italic">
        Partner-supplied text for the form fields under each crawl bucket. These override the crawl prefill on submit.
      </p>
      <ul className="space-y-2">
        {marks.map(m => {
          const { bucket, field } = parseAnswerPath(m.target_path)
          return (
            <li key={m.id} className="rounded-md border border-wm-border bg-wm-bg px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <code className="text-[10px] font-mono text-wm-text-muted">{bucket} · {field}</code>
                <span className="text-[10px] text-wm-text-subtle">{new Date(m.marked_at).toLocaleString()}</span>
              </div>
              <p className="text-[13px] text-wm-text mt-1 whitespace-pre-line leading-snug">
                {m.client_note || <span className="italic text-wm-text-subtle">empty</span>}
              </p>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

function Step1MissingSection({ marks, attachments }: { marks: MarkRow[]; attachments: AttachmentMetadata[] }) {
  return (
    <Block icon={<AlertCircle size={11} />} title={`Step 1 — Add something we missed (${marks.length})`}>
      <ul className="space-y-2">
        {marks.map(m => {
          const myFiles = attachments.filter(a => a.target_path === m.target_path)
          const { bucket } = parseMissingPath(m.target_path)
          return (
            <li key={m.id} className="rounded-md border border-wm-border bg-wm-bg px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-wm-text">
                  {m.proposed_program_name || '(unnamed)'}
                </span>
                <code className="text-[10px] font-mono text-wm-text-muted">{bucket}</code>
              </div>
              {m.proposed_program_description && (
                <div
                  className="text-[13px] text-wm-text mt-1 leading-snug [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:ml-4 [&_a]:text-wm-accent [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: m.proposed_program_description }}
                />
              )}
              {myFiles.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {myFiles.map(f => (
                    <li key={f.id}>
                      <a
                        href={attachmentPublicUrl(f.file_path)}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-wm-accent border border-wm-accent/30 bg-wm-bg-elevated rounded-md px-2 py-0.5 hover:bg-wm-accent-tint"
                      >
                        <Paperclip size={9} /> {f.file_name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

function AttachmentsSection({ attachments }: { attachments: AttachmentMetadata[] }) {
  return (
    <Block icon={<FileText size={11} />} title={`Files (${attachments.length})`}>
      <ul className="space-y-1.5">
        {attachments.map(a => (
          <li key={a.id} className="flex items-center gap-2 rounded-md border border-wm-border bg-wm-bg px-2.5 py-1.5">
            <Paperclip size={11} className="text-wm-text-muted shrink-0" />
            <span className="text-[10px] uppercase tracking-wider font-bold text-wm-text-muted shrink-0">
              {a.kind}
            </span>
            <a
              href={attachmentPublicUrl(a.file_path)}
              target="_blank" rel="noopener noreferrer"
              className="text-[12px] text-wm-accent hover:underline truncate flex-1 inline-flex items-center gap-1"
            >
              <span className="truncate">{a.file_name}</span>
              <ExternalLink size={10} className="shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </Block>
  )
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <header className="flex items-center gap-1.5 mb-2">
        <span className="text-wm-accent">{icon}</span>
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-wm-text">{title}</h3>
      </header>
      {children}
    </section>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

interface Step2Row {
  key:        string
  /** The full question text the partner saw, not an abbreviated key. */
  question:   string
  /** Their answer rendered as a human-readable label (radio-option
   *  text expanded, booleans turned into Yes/No, arrays joined, etc.). */
  answer:     string
  /** Optional supporting context — e.g. for radio choices, the
   *  follow-up URL or platform name the partner typed in. */
  detail?:    string
  span?:      1 | 2
}

/** Map of (column → enum value → human label). Mirrors the radio
 *  labels the partner sees in ContentCollectionPage so staff doesn't
 *  have to mentally translate "external" into the full sentence. */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  events_display_preference: {
    external: 'Manage events in a separate platform; direct visitors there',
    embed:    'Embed events from our Church Management Software (Planning Center / CCB)',
    wordpress:'Manage and display events directly through WordPress',
    none:     'Do not display events on our website',
  },
  sermons_display_preference: {
    // Legacy 'external' rows migrated to 'embed_latest' in v61; keep
    // the key for safety on any straggling pre-migration values.
    external:    'Embed the most-recent sermon on the Watch page (Recommended — legacy label)',
    cta_only:    'CTA button linking to our YouTube / Vimeo channel (Easiest)',
    embed_latest:'Embed the most-recent sermon on the Watch page (Recommended)',
    wordpress:   'List our entire sermon archive on our website with a page per sermon (Most Complex)',
  },
  groups_display_preference: {
    external: 'Direct visitors to an external platform (Planning Center / Breeze / CCB)',
    embed:    'Embed individual small groups from Planning Center directly on the site',
    wordpress:'Display and manage individual small groups directly through the website',
    contact:  'Do not display individual groups — direct visitors to contact us',
  },
  blog_handling: {
    transfer:     'Transfer over the existing blog',
    sermon_based: 'Sermon-based blog written by TheSquad (generated upon sermon submission)',
    new:          'Create a new blog',
  },
  domain_credential_method: {
    invite_admin: 'Create a limited-access user account for TheSquad through the registrar',
    one_password: 'Share credentials via a 1Password share/invite link',
  },
}

const ARCHIVE_FEATURE_LABELS: Record<string, string> = {
  discussion_guides: 'Include Discussion Guides with each Sermon',
  sermon_notes:      'Include Sermon Notes with each Sermon',
  audio_files:       'Include Audio Files with each Sermon',
  filters:           'Create Filters based on Topic, Passage, Speaker, etc.',
}

const CMS_TYPE_LABELS: Record<string, string> = {
  volunteers:      'Volunteer Opportunities',
  staff_directory: 'Staff Directory',
  blog:            'Blog',
  careers:         'Career Opportunities',
  testimonials:    'Testimonials',
  groups:          'Groups Directory',
  sermons:         'Sermons',
  events:          'Events',
  campuses:        'Campuses / Locations',
}

const BLOG_FILTER_LABELS: Record<string, string> = {
  topic:  'Topic / Category',
  verse:  'Bible Verse',
  series: 'Series',
  author: 'Author',
}

const expandEnum = (col: string, v: string | null): string => {
  if (!v) return ''
  return ENUM_LABELS[col]?.[v] ?? v
}
const expandList = (vals: string[] | null, map: Record<string, string>): string => {
  if (!vals || vals.length === 0) return ''
  return vals.map(v => map[v] ?? v).join('\n• ').replace(/^/, '• ')
}

function buildStep2Rows(s: SessionRow): Step2Row[] {
  const rows: Step2Row[] = []
  const yn = (b: boolean | null) => b === true ? 'Yes' : b === false ? 'No' : ''
  const push = (
    key: string,
    question: string,
    answer: string | null | undefined,
    opts: { detail?: string | null; span?: 1 | 2 } = {},
  ) => {
    const a = answer == null ? '' : typeof answer === 'string' ? answer.trim() : String(answer)
    if (!a) return
    const detail = opts.detail?.trim() || undefined
    rows.push({ key, question, answer: a, detail, span: opts.span })
  }

  // ── Events ────────────────────────────────────────────────────────
  push('events_pref', 'How would you like to display events on your website?',
       expandEnum('events_display_preference', s.events_display_preference),
       { detail: s.events_external_url ?? undefined, span: 2 })
  if (s.events_display_preference === 'wordpress') {
    push('events_wp_source', 'Which platform is your current source of truth for events?',  s.events_wordpress_source_of_truth, { span: 2 })
    push('events_wp_pain',   'What causes the most frustration with your current event system?',
         s.events_wordpress_frustration, { span: 2 })
    push('events_wp_recur',  'Does your events manager need to support recurring events?',
         s.events_wordpress_recurring_needed, { span: 2 })
  }
  if (s.events_display_preference === 'embed' || s.events_display_preference === 'wordpress') {
    push('events_display_format',
         'Do you have a preference on how events are displayed? (Card / List / Calendar / other)',
         s.events_display_format, { span: 2 })
  }
  // ── Sermons ───────────────────────────────────────────────────────
  push('sermons_pref', 'How would you like to manage sermons on your website?',
       expandEnum('sermons_display_preference', s.sermons_display_preference),
       { detail: s.sermons_external_url ?? undefined, span: 2 })
  // YouTube playlist follow-up applies to both the legacy 'external'
  // and the v61 'embed_latest' tier — both keep YouTube as the canonical
  // archive, so the playlist question is relevant for either.
  if (s.sermons_display_preference === 'external'
   || s.sermons_display_preference === 'embed_latest') {
    push('yt_playlist', 'Do you have a YouTube playlist set up to store your messages?',
         yn(s.sermon_youtube_playlist_exists),
         { detail: s.sermon_youtube_playlist_url ?? undefined })
  }
  if (s.sermons_display_preference === 'wordpress' && s.sermon_archive_features && s.sermon_archive_features.length > 0) {
    push('archive_features', 'Sermon archive setup (multi-select)',
         expandList(s.sermon_archive_features, ARCHIVE_FEATURE_LABELS), { span: 2 })
  }
  if ((s.sermon_archive_features ?? []).includes('filters')) {
    push('sermon_filters', 'Please list the filters you’d like created', s.sermon_filters_text, { span: 2 })
  }
  // ── Groups ────────────────────────────────────────────────────────
  push('groups_pref', 'How would you like to display small groups on your website?',
       expandEnum('groups_display_preference', s.groups_display_preference),
       { detail: s.groups_external_url ?? undefined, span: 2 })
  if (s.groups_display_preference === 'wordpress') {
    push('groups_wp_source', 'Which platform is your current source of truth for groups?',
         s.groups_wordpress_source_of_truth, { span: 2 })
    push('groups_wp_pain',   'What causes the most frustration with your current group management system?',
         s.groups_wordpress_frustration, { span: 2 })
  }
  // ── Merch / Shop ──────────────────────────────────────────────────
  if (s.merch_store_url && s.merch_store_url.trim()) {
    push('merch_store', 'Link to your merch / shop store',
         s.merch_store_url, { span: 2 })
  }
  // ── CMS / Blog ────────────────────────────────────────────────────
  if (s.cms_managed_types && s.cms_managed_types.length > 0) {
    push('cms_types',
         'Which content types would you like your team to manage on an ongoing basis?',
         expandList(s.cms_managed_types, CMS_TYPE_LABELS), { span: 2 })
  }
  if ((s.cms_managed_types ?? []).includes('blog')) {
    push('blog_handling', 'Blog setup — how should we approach the new blog?',
         expandEnum('blog_handling', s.blog_handling),
         { detail: s.blog_existing_url ?? undefined, span: 2 })
    if (s.blog_handling === 'new') {
      push('blog_new_desc', 'Describe the heart behind your blog and the type of information to be conveyed',
           s.blog_new_description, { span: 2 })
      if (s.blog_new_filters && s.blog_new_filters.length > 0) {
        push('blog_filters', 'New blog — filters to include',
             expandList(s.blog_new_filters, BLOG_FILTER_LABELS), { span: 2 })
      }
    }
  }
  // ── Ministries ────────────────────────────────────────────────────
  push('ministries_grow', 'Of all your ministries and programs, which one or two are you actively trying to grow right now?',
       s.ministries_to_grow, { span: 2 })
  push('ministries_list', 'Please provide a list of ministries offered at your church',
       s.ministries_list_html, { span: 2 })
  push('discipleship', 'Please provide your next steps / discipleship pathway',
       s.discipleship_pathway_html, { span: 2 })
  // ── Misc context ──────────────────────────────────────────────────
  push('high_maint_ctx', 'Any additional context or examples to help us build a CMS that resolves your high-maintenance pages?',
       s.high_maintenance_pages_context, { span: 2 })
  push('additional_ctx', 'Anything else (notes, questions, details) you’d like included that wasn’t covered here?',
       s.additional_context, { span: 2 })
  // ── Domain ────────────────────────────────────────────────────────
  push('domain_url',   'Who is your domain registrar?', s.domain_registrar_url, { span: 2 })
  push('domain_method','How would you like to provide login credentials?',
       expandEnum('domain_credential_method', s.domain_credential_method),
       { detail: s.domain_one_password_invite_url ?? undefined, span: 2 })
  if (s.domain_credential_method === 'invite_admin') {
    push('domain_invite_confirmed',
         'Has the partner created a limited-access user for admin.websquad@churchmediasquad.com?',
         yn(s.domain_invite_confirmed), { span: 2 })
  }
  // ── Hosting ───────────────────────────────────────────────────────
  push('hosting_ok',
       'I approve having our new website hosted on Pressable, Church Media Squad’s chosen platform.',
       yn(s.hosting_approved), { span: 2 })
  return rows
}

function parseAnswerPath(path: string): { bucket: string; field: string } {
  // answer:<bucket>/<field>
  const stripped = path.startsWith('answer:') ? path.slice(7) : path
  const slash = stripped.indexOf('/')
  if (slash < 0) return { bucket: stripped, field: '' }
  return { bucket: stripped.slice(0, slash), field: stripped.slice(slash + 1) }
}

function parseMissingPath(path: string): { bucket: string } {
  // missing:<bucket>/<slug-or-baseline>-N
  const stripped = path.startsWith('missing:') ? path.slice(8) : path
  const slash = stripped.indexOf('/')
  if (slash < 0) return { bucket: stripped }
  return { bucket: stripped.slice(0, slash) }
}
