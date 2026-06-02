/**
 * Crawl Inventory — staff view.
 *
 * Renders the same InventoryView component the partner sees, with
 * reviewMode=false (no status pills). Identical content + layout
 * across both surfaces so staff can preview what the partner sees
 * before sending a Content Collection request.
 */
import { useEffect, useState } from 'react'
import { ListChecks, Loader2, Sparkles, Send, Copy, X, Link as LinkIcon, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { InventoryView, type TopicRow, type SnippetRow } from '../inventory/InventoryView'
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

  const load = async () => {
    setLoading(true); setError(null)
    const [topicsRes, snippetsRes, projRes] = await Promise.all([
      supabase.from('web_project_topics')
        .select('id, topic_key, topic_label, voice_signal, passages, items, added_snippet_tokens, source_page_urls')
        .eq('web_project_id', projectId),
      supabase.from('web_project_snippets')
        .select('token, label, expansion').eq('web_project_id', projectId).eq('archived', false),
      supabase.from('strategy_web_projects').select('id, member').eq('id', projectId).maybeSingle(),
    ])
    if (topicsRes.error) setError(topicsRes.error.message)
    setRows((topicsRes.data as TopicRow[] | null) ?? [])
    const m = new Map<string, SnippetRow>()
    for (const s of (snippetsRes.data as SnippetRow[] | null) ?? []) m.set(s.token, s)
    setSnippets(m)

    // Active partner-share link (latest non-closed session for this project)
    // + off-crawl prefills assembled the same way ContentCollectionPage does.
    const member = projRes.data?.member ?? null
    if (member != null) {
      const [sessionRes, apRes, discRes] = await Promise.all([
        supabase
          .from('strategy_content_collection_sessions')
          .select('id')
          .eq('web_project_id', projectId)
          .neq('status', 'closed')
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
  }
  useEffect(() => { void load() }, [projectId])

  const topicsByKey = (() => {
    const out = new Map<string, TopicRow>()
    for (const r of rows) out.set(r.topic_key, r)
    return out
  })()

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
          <button type="button" onClick={() => void load()} className="ml-2 text-wm-accent hover:underline text-[11px]">
            Refresh
          </button>
          <RequestContentCollectionButton projectId={projectId} rows={rows} hasActiveLink={!!activeShareUrl} onCreated={url => setActiveShareUrl(url)} />
        </div>
      </header>

      {activeShareUrl && (
        <div className="px-5 py-2.5 bg-wm-accent-tint/40 border-b border-wm-accent/20 flex items-center gap-2 flex-wrap">
          <LinkIcon size={11} className="text-wm-accent shrink-0" />
          <span className="text-[11px] font-semibold text-wm-text shrink-0">Partner review link:</span>
          <code className="text-[11px] font-mono text-wm-text flex-1 min-w-0 truncate">{activeShareUrl}</code>
          <PartnerLinkActions url={activeShareUrl} />
        </div>
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
            topicsByKey={topicsByKey}
            snippetsByToken={snippetsByToken}
            reviewMode={false}
            groupAccordion
            externalPrefills={externalPrefills}
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

      const { data: existing } = await supabase
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
        await supabase
          .from('strategy_content_collection_sessions')
          .update({ due_at: dueAt })
          .eq('id', sessionId)
      } else {
        const { data: created, error: createErr } = await supabase
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
