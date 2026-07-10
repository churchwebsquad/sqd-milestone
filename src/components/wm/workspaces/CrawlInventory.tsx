/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Crawl Inventory — staff view.
 *
 * Renders the same InventoryView component the partner sees, with
 * reviewMode=false (no status pills). Identical content + layout
 * across both surfaces so staff can preview what the partner sees
 * before sending a Content Collection request.
 */
import { useEffect, useRef, useState } from 'react'
import { ListChecks, Loader2, Sparkles, Send, Copy, X, Link as LinkIcon, ExternalLink, RefreshCw, Check } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { InventoryView, type TopicRow, type SnippetRow, type Mark, type SaveMark, type InventoryCampus } from '../inventory/InventoryView'
import { loadStrategyBriefSections, strategyBriefToExternalPrefills } from '../../../lib/webStrategyBrief'

interface Props {
  projectId: string
}

export function CrawlInventory({ projectId }: Props) {
  const [rows, setRows]                 = useState<TopicRow[]>([])
  const [snippetsByToken, setSnippets]  = useState<Map<string, SnippetRow>>(new Map())
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [activeShareUrl, setActiveShareUrl] = useState<string | null>(null)

  // Off-crawl prefills (photo library URL, social handles, mission &
  // vision from discovery) so staff sees actual values in the
  // bucket cards rather than placeholder rollups like "Supplied
  // during onboarding."
  const [externalPrefills, setExternalPrefills] = useState<Record<string, string>>({})
  // Short-lived confirmation toast after a refresh so staff can see
  // which intake docs were picked up (e.g. "Strategy brief loaded").
  // Cleared after ~4s.
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null)
  // v115 — multi-campus registry from strategy_web_projects.campuses.
  // Empty array = single-campus project (the default for every church
  // pre-Doxology). Threaded into InventoryView so the campus chip
  // selector + per-campus filtering only activate when registered.
  const [campuses, setCampuses] = useState<InventoryCampus[]>([])
  const [campusLabelSingular, setCampusLabelSingular] = useState<string | null>(null)
  const [campusLabelPlural,   setCampusLabelPlural]   = useState<string | null>(null)
  // v116 — drives the InventoryView verbatim-only banner. NULL until
  // the first crawl-categorize run writes a detected value.
  const [defaultLanguage, setDefaultLanguage] = useState<string | null>(null)

  // Staff-side cleanup: omitting misclassified items writes a mark to
  // strategy_content_collection_marks. We lazy-create a draft session
  // on first omit (status='open', no due_at) so staff can tidy the
  // inventory before sending it to the partner. The same session is
  // reused when the partner is later invited.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map())

  const ensureSession = async (memberFallback: number | null): Promise<string | null> => {
    if (sessionId) return sessionId
    // Try latest session first (might exist if a partner-collection
    // request was already created).
    const { data: latest } = await (supabase as any)
      .from('strategy_content_collection_sessions')
      .select('id')
      .eq('web_project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest?.id) { setSessionId(latest.id); return latest.id }
    // No session yet — create a draft. due_at null = no partner
    // deadline yet; the Request Content Collection button fills that
    // in when the link is sent.
    if (memberFallback == null) return null
    const { data: created, error } = await (supabase as any)
      .from('strategy_content_collection_sessions')
      .insert({
        web_project_id:     projectId,
        member:             memberFallback,
        due_at:             null,
        inventory_snapshot: { topics: rows, snapped_at: new Date().toISOString() },
      })
      .select('id')
      .single()
    if (error || !created) return null
    setSessionId(created.id)
    return created.id
  }

  const memberRef = useRef<number | null>(null)

  const saveMark: SaveMark = async (path, kind, status, note = null, extra = {}) => {
    const sid = await ensureSession(memberRef.current)
    if (!sid) return
    const next: Mark = {
      target_kind:                  kind,
      target_path:                  path,
      status,
      client_note:                  note ?? null,
      proposed_program_name:        extra?.proposed_program_name ?? null,
      proposed_program_description: extra?.proposed_program_description ?? null,
    }
    setMarks(prev => new Map(prev).set(path, next))
    await (supabase as any)
      .from('strategy_content_collection_marks')
      .upsert({
        session_id:                   sid,
        target_kind:                  kind,
        target_path:                  path,
        status,
        client_note:                  note ?? null,
        proposed_program_name:        extra?.proposed_program_name ?? null,
        proposed_program_description: extra?.proposed_program_description ?? null,
      }, { onConflict: 'session_id,target_path' })
  }

  const load = async (opts: { isManualRefresh?: boolean } = {}) => {
    setLoading(true); setError(null)
    // Track what intake docs got picked up this round so the Refresh
    // button can summarize what changed (briefly).
    const intakeFound: string[] = []

    // Manual refresh actually re-fires the crawl-categorize +
    // atomize edge functions before re-reading the DB. Prior to
    // 2026-07 this button only re-read web_project_topics /
    // web_project_snippets, so if the categorizer got stuck or a
    // Postgres trigger missed a completed crawl_job (which happens
    // when firecrawl-webhook lands during a schema deploy or the
    // trigger regresses), staff would click Refresh and see no
    // change even though the crawl was complete. Now Refresh:
    //   1. Looks up the newest completed crawl_job for the project.
    //   2. Fires crawl-categorize (aggregates across all jobs → topics).
    //   3. Fires atomize-crawl-into-atoms (dedupes across all jobs → atoms).
    //   4. Re-reads topics + snippets.
    // Only runs on isManualRefresh so the initial page load stays
    // cheap. Best-effort — if either edge call fails we still
    // proceed to the DB re-read.
    let refireError: string | null = null
    if (opts.isManualRefresh) {
      try {
        const { data: latestJob } = await (supabase as any)
          .schema('web-hub')
          .from('crawl_jobs')
          .select('id')
          .eq('project_id', projectId)
          .eq('status', 'complete')
          .order('completed_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        if (latestJob?.id) {
          const [catRes, atomRes] = await Promise.allSettled([
            supabase.functions.invoke('crawl-categorize', {
              body: { project_id: projectId, crawl_job_id: latestJob.id },
            }),
            supabase.functions.invoke('atomize-crawl-into-atoms', {
              body: { project_id: projectId },
            }),
          ])
          if (catRes.status === 'rejected') refireError = `categorize failed: ${String(catRes.reason)}`
          else if (catRes.value.error)      refireError = `categorize failed: ${catRes.value.error.message}`
          if (!refireError && atomRes.status === 'rejected') refireError = `atomize failed: ${String(atomRes.reason)}`
          else if (!refireError && atomRes.status === 'fulfilled' && atomRes.value.error) refireError = `atomize failed: ${atomRes.value.error.message}`
        }
      } catch (e) {
        refireError = e instanceof Error ? e.message : String(e)
        console.error('[CrawlInventory] manual re-fire failed:', e)
      }
    }
    const [topicsRes, snippetsRes, projRes] = await Promise.all([
      supabase.from('web_project_topics')
        .select('id, topic_key, topic_label, voice_signal, passages, items, added_snippet_tokens, source_page_urls, campus_slug')
        .eq('web_project_id', projectId),
      supabase.from('web_project_snippets')
        .select('token, label, expansion').eq('web_project_id', projectId).eq('archived', false),
      supabase.from('strategy_web_projects').select('id, member, campuses, campus_label_singular, campus_label_plural, default_language').eq('id', projectId).maybeSingle(),
    ])
    if (topicsRes.error) setError(topicsRes.error.message)
    setRows((topicsRes.data as TopicRow[] | null) ?? [])
    const m = new Map<string, SnippetRow>()
    for (const s of (snippetsRes.data as SnippetRow[] | null) ?? []) m.set(s.token, s)
    setSnippets(m)
    // v115 — campus registry from the project. Empty for the existing
    // single-campus fleet; non-empty only for projects where staff
    // confirmed campuses in the CrawlWorkspace.
    const projCampuses = (projRes.data as { campuses?: InventoryCampus[]; campus_label_singular?: string | null; campus_label_plural?: string | null; default_language?: string | null } | null)
    setCampuses(Array.isArray(projCampuses?.campuses) ? projCampuses!.campuses : [])
    setCampusLabelSingular(projCampuses?.campus_label_singular ?? null)
    setCampusLabelPlural(projCampuses?.campus_label_plural ?? null)
    setDefaultLanguage(projCampuses?.default_language ?? null)

    // Active partner-share link (latest non-closed session for this project)
    // + off-crawl prefills assembled the same way ContentCollectionPage does.
    const member = projRes.data?.member ?? null
    memberRef.current = member
    if (member != null) {
      const [sessionRes, apRes, discRes] = await Promise.all([
        // Surface the latest session regardless of status so staff can
        // copy the Page 2 link even after the partner submits / closes
        // a session — used for the "supply supplemental content"
        // workflow where the partner may need to revisit Page 2.
        supabase
          .from('strategy_content_collection_sessions')
          .select('id')
          .eq('web_project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('strategy_account_progress')
          .select('portal_token, photos_link, legacy_photo_library, photos_from_all_in_discovery_form, facebook, facebook_link, instagram, instagram_link, youtube')
          .eq('member', member)
          .maybeSingle(),
        supabase
          .from('strategy_discovery_questionnaire')
          .select('photo_library_url, mission_vision_statement')
          .eq('member', member)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (sessionRes.data?.id && apRes.data?.portal_token) {
        setActiveShareUrl(`${window.location.origin}/portal/${apRes.data.portal_token}/hub/content-collection/${sessionRes.data.id}`)
      } else {
        setActiveShareUrl(null)
      }
      // Track the session id (if any) so saveMark can append to it
      // without re-querying. Load existing marks too so the omit
      // toggles render with the current state on first paint.
      if (sessionRes.data?.id) {
        setSessionId(sessionRes.data.id)
        const { data: marksData } = await (supabase as any)
          .from('strategy_content_collection_marks')
          .select('target_kind, target_path, status, client_note, proposed_program_name, proposed_program_description')
          .eq('session_id', sessionRes.data.id)
        const m = new Map<string, Mark>()
        for (const row of (marksData ?? []) as Mark[]) m.set(row.target_path, row)
        setMarks(m)
      } else {
        setSessionId(null)
        setMarks(new Map())
      }
      const ap = (apRes.data ?? {}) as Record<string, string | null>
      const disc = (discRes.data ?? {}) as Record<string, string | null>
      const photoUrl = disc.photo_library_url ?? ap.photos_link ?? ap.legacy_photo_library ?? ap.photos_from_all_in_discovery_form ?? null
      const fb = ap.facebook_link ?? ap.facebook ?? null
      const ig = ap.instagram_link ?? ap.instagram ?? null
      const yt = ap.youtube ?? null
      const socialLines = [
        fb ? `Facebook: ${fb}` : null,
        ig ? `Instagram: ${ig}` : null,
        yt ? `YouTube: ${yt}` : null,
      ].filter(Boolean)
      // Strategy-brief parsed sections override discovery's combined
      // mission_vision_statement when present — the brief is the
      // AM-curated authoritative version.
      const brief = await loadStrategyBriefSections(projectId)
      const briefPrefills = strategyBriefToExternalPrefills(brief)
      if (brief) {
        // Tell staff exactly which brief sections got extracted — if
        // the brief was uploaded but a section is missing here, the
        // partner's brief headings didn't match the parser's keywords.
        const sections: string[] = []
        if (brief.mission)        sections.push('mission')
        if (brief.vision)         sections.push('vision')
        if (brief.values)         sections.push('values')
        if (brief.founding_story) sections.push('founding story')
        if (brief.taglines)       sections.push('taglines')
        intakeFound.push(
          sections.length > 0
            ? `Strategy brief (${sections.join(', ')})`
            : 'Strategy brief (no recognized sections — check the brief\'s headings)',
        )
      }
      if (disc.mission_vision_statement) intakeFound.push('Discovery questionnaire')
      if (photoUrl)                       intakeFound.push('Photo library')
      setExternalPrefills({
        ...(photoUrl ? { 'branding_photos/photo_library': photoUrl } : {}),
        ...(socialLines.length > 0 ? { 'social_newsletter/social_links': socialLines.join('\n') } : {}),
        ...(disc.mission_vision_statement
          ? {
              'mission_beliefs/mission_statement': disc.mission_vision_statement,
              'mission_beliefs/vision_statement':  disc.mission_vision_statement,
            }
          : {}),
        ...briefPrefills,
      })
    } else {
      setExternalPrefills({})
    }
    setLoading(false)

    // Manual-refresh-only confirmation. Auto-clears after 4s so it
    // doesn't linger across long sessions.
    if (opts.isManualRefresh) {
      const base = intakeFound.length > 0
        ? `Refreshed · Recategorized crawl + picked up ${intakeFound.join(', ')}.`
        : 'Refreshed · Recategorized crawl.'
      const msg = refireError ? `${base} (Warning: ${refireError})` : base
      setRefreshFeedback(msg)
      setTimeout(() => setRefreshFeedback(null), refireError ? 8000 : 4000)
    }
  }
  useEffect(() => { void load() }, [projectId])

  const totalItems = rows.reduce((n, r) => n + (r.items?.length ?? 0) + (r.passages?.length ?? 0), 0)
  const totalSnippets = rows.reduce((n, r) => n + (r.added_snippet_tokens?.length ?? 0), 0)

  return (
    <div className="rounded-xl border border-wm-border bg-wm-bg-elevated">
      <header className="px-5 py-4 border-b border-wm-border flex items-baseline gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ListChecks size={14} className="text-wm-accent" />
            <h2 className="text-[14px] font-bold text-wm-text">Crawl Inventory</h2>
          </div>
          <p className="text-[12px] text-wm-text-muted mt-0.5">
            Every fact, FAQ, program, key phrase, scripture, and CTA the crawler found — grouped
            the way partners review it. This is exactly what the partner sees when you request a
            Content Collection.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-wm-text-muted shrink-0">
          <span>{totalItems} pieces</span>
          <span>·</span>
          <span>{totalSnippets} snippets</span>
          <button
            type="button"
            onClick={() => void load({ isManualRefresh: true })}
            disabled={loading}
            className="ml-2 inline-flex items-center gap-1 text-wm-accent hover:underline text-[11px] disabled:opacity-50"
            title="Re-fire the crawl-categorize + atomize edge functions across every completed crawl_job for this project, then re-read topics, snippets, and intake docs. Use this after a 'Crawl more pages' run to force new pages to land."
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh content + intake docs
          </button>
          <RequestContentCollectionButton projectId={projectId} rows={rows} hasActiveLink={!!activeShareUrl} onCreated={url => setActiveShareUrl(url)} />
        </div>
      </header>

{refreshFeedback && (
        <div className="px-5 py-2 bg-emerald-50 border-b border-emerald-200 text-[11.5px] text-emerald-900 inline-flex items-center gap-1.5">
          <Check size={11} className="text-emerald-600" />
          {refreshFeedback}
        </div>
      )}

      {activeShareUrl && (
        <>
          <div className="px-5 py-2.5 bg-wm-accent-tint/40 border-b border-wm-accent/20 flex items-center gap-2 flex-wrap">
            <LinkIcon size={11} className="text-wm-accent shrink-0" />
            <span className="text-[11px] font-semibold text-wm-text shrink-0">Full content collection (Steps 1 → 3):</span>
            <code className="text-[11px] font-mono text-wm-text flex-1 min-w-0 truncate">{activeShareUrl}</code>
            <PartnerLinkActions url={activeShareUrl} />
          </div>
          <div className="px-5 py-2.5 bg-wm-accent-tint/20 border-b border-wm-accent/15 flex items-center gap-2 flex-wrap">
            <LinkIcon size={11} className="text-wm-accent shrink-0" />
            <span className="text-[11px] font-semibold text-wm-text shrink-0">Supplemental content (Step 2 only):</span>
            <code className="text-[11px] font-mono text-wm-text flex-1 min-w-0 truncate">{activeShareUrl}?step=2</code>
            <PartnerLinkActions url={`${activeShareUrl}?step=2`} />
          </div>
        </>
      )}

      {error && (
        <div className="px-5 py-3 bg-wm-danger-bg border-b border-wm-danger/20 text-[11px] text-wm-danger">{error}</div>
      )}
      {loading && (
        <div className="px-5 py-8 grid place-items-center text-wm-text-muted">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div className="px-5 py-8 text-center">
          <Sparkles className="mx-auto mb-2 text-wm-text-subtle" size={20} />
          <p className="text-[13px] font-semibold text-wm-text mb-1">No inventory yet</p>
          <p className="text-[11px] text-wm-text-muted max-w-md mx-auto leading-relaxed">
            The inventory fills automatically after a crawl completes. If a crawl just ran, the
            categorizer is still processing — refresh in a moment.
          </p>
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="p-4 md:p-5">
          {/* groupAccordion: same one-open-at-a-time UX partners see,
              but without review pills/marks. Keeps this page
              scrollable when the crawl returns 30+ topics. */}
          <InventoryView
            topicRows={rows}
            campuses={campuses}
            campusLabelSingular={campusLabelSingular}
            campusLabelPlural={campusLabelPlural}
            defaultLanguage={defaultLanguage}
            snippetsByToken={snippetsByToken}
            reviewMode={false}
            groupAccordion
            externalPrefills={externalPrefills}
            marks={marks}
            saveMark={saveMark}
          />
        </div>
      )}
    </div>
  )
}

// ── Request Content Collection (staff trigger) ───────────────────────

function RequestContentCollectionButton({
  projectId, rows, hasActiveLink, onCreated,
}: {
  projectId:      string
  rows:           TopicRow[]
  hasActiveLink:  boolean
  onCreated:      (url: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [busy, setBusy]     = useState(false)
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 14)
    return d.toISOString().slice(0, 10)
  })
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

  const create = async () => {
    setBusy(true); setError(null)
    try {
      const { data: proj } = await supabase
        .from('strategy_web_projects')
        .select('id, member')
        .eq('id', projectId)
        .maybeSingle()
      if (!proj) throw new Error('Project not found')

      const { data: partner } = await supabase
        .from('strategy_account_progress')
        .select('portal_token')
        .eq('member', proj.member)
        .maybeSingle()
      if (!partner?.portal_token) throw new Error('Partner has no portal_token — set one up first.')

      const { data: existing } = await (supabase as any)
        .from('strategy_content_collection_sessions')
        .select('id')
        .eq('web_project_id', projectId)
        .neq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let sessionId = existing?.id
      const dueAt = dueDate ? new Date(dueDate).toISOString() : null

      if (sessionId) {
        await (supabase as any)
          .from('strategy_content_collection_sessions')
          .update({ due_at: dueAt })
          .eq('id', sessionId)
      } else {
        const { data: created, error: createErr } = await (supabase as any)
          .from('strategy_content_collection_sessions')
          .insert({
            web_project_id: projectId,
            member: proj.member,
            due_at: dueAt,
            inventory_snapshot: { topics: rows, snapped_at: new Date().toISOString() },
          })
          .select('id')
          .single()
        if (createErr) throw createErr
        sessionId = created.id
      }

      const url = `${window.location.origin}/portal/${partner.portal_token}/hub/content-collection/${sessionId}`
      setShareUrl(url)
      onCreated(url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setShareUrl(null); setError(null) }}
        className="ml-1 inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent hover:underline"
      >
        <Send size={11} />
        {hasActiveLink ? 'Update due date / regenerate' : 'Request from partner'}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-wm-bg-elevated rounded-2xl border border-wm-border w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-bold text-wm-text">Request Content Collection</h3>
                <p className="text-[11px] text-wm-text-muted mt-0.5">
                  Snapshots this inventory and sends the partner a link to review it + answer setup questions.
                </p>
              </div>
              <button type="button" onClick={() => !busy && setOpen(false)} className="text-wm-text-subtle hover:text-wm-text">
                <X size={16} />
              </button>
            </div>

            {!shareUrl && (
              <>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-wm-text-muted mb-1">
                  Due date
                </label>
                <input
                  type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full text-sm border border-wm-border bg-wm-bg rounded-md px-3 py-2 text-wm-text focus:outline-none focus:border-wm-accent"
                />
                {error && (
                  <p className="mt-3 text-[11px] text-wm-danger bg-wm-danger-bg border border-wm-danger/20 rounded-md px-3 py-2">{error}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-[12px] font-semibold text-wm-text-muted px-3 py-1.5">
                    Cancel
                  </button>
                  <button
                    type="button" onClick={create} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-wm-accent text-white px-4 py-1.5 rounded-full hover:bg-wm-accent-hover disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Generate link
                  </button>
                </div>
              </>
            )}

            {shareUrl && (
              <>
                <p className="text-[11px] text-wm-text-muted mb-1.5">Share this link with the partner:</p>
                <div className="flex items-center gap-2 bg-wm-bg border border-wm-border rounded-md px-3 py-2">
                  <code className="flex-1 text-[11px] text-wm-text truncate font-mono">{shareUrl}</code>
                  <button type="button" onClick={copy} className="text-wm-accent hover:underline text-[11px] font-semibold inline-flex items-center gap-1 shrink-0">
                    <Copy size={11} />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold bg-wm-accent text-white px-4 py-1.5 rounded-full hover:bg-wm-accent-hover">
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function PartnerLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent hover:underline"
      >
        <Copy size={11} />
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-wm-accent hover:underline"
      >
        <ExternalLink size={11} />
        Open
      </a>
    </div>
  )
}
