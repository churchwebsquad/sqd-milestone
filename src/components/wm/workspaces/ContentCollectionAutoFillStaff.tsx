/**
 * ContentCollectionAutoFillStaff — internal pre-fill suggester.
 *
 * Moved off the partner portal 2026-06-15. The strategist runs this
 * from the Content Collection Responses panel to scan uploaded intake
 * files (strategy brief, discovery questionnaire, content collection
 * files) and propose values for Page 2 strategic configuration fields
 * (events/sermons/groups display, CMS-managed types, ministries
 * content, etc.). Each suggestion is reviewed individually — accept
 * writes the value to the session row; dismiss hides it locally.
 *
 * Auth path: staff JWT (Bearer) + projectId in the body, per
 * api/web/agents/answer-content-collection.ts.
 */
import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

type AutoFillField =
  | 'cms_managed_types' | 'blog_handling' | 'blog_existing_url' | 'blog_new_description'
  | 'events_display_preference' | 'events_external_url' | 'events_wordpress_source_of_truth'
  | 'sermons_display_preference' | 'sermons_external_url'
  | 'sermon_youtube_playlist_exists' | 'sermon_youtube_playlist_url'
  | 'groups_display_preference' | 'groups_external_url' | 'groups_wordpress_source_of_truth'
  | 'merch_store_url' | 'ministries_to_grow'
  | 'ministries_list_html' | 'discipleship_pathway_html'

interface AutoFillSuggestion {
  field:           AutoFillField
  value:           unknown
  confidence:      'high' | 'medium' | 'low'
  source_category: string
  source_quote:    string
  rationale:       string
}

interface Props {
  projectId: string
  sessionId: string
  /** Snapshot of the session row's current values — used to compute
   *  the alreadyFilled pre-filter so the agent doesn't overwrite
   *  fields the partner already answered. */
  session:   Record<string, unknown>
  /** Called after a suggestion is accepted and written to the
   *  session row. Parent reloads to surface the new value. */
  onAccepted?: () => void
}

const PROPOSABLE_FIELDS: AutoFillField[] = [
  'cms_managed_types', 'blog_handling', 'blog_existing_url', 'blog_new_description',
  'events_display_preference', 'events_external_url', 'events_wordpress_source_of_truth',
  'sermons_display_preference', 'sermons_external_url',
  'sermon_youtube_playlist_exists', 'sermon_youtube_playlist_url',
  'groups_display_preference', 'groups_external_url', 'groups_wordpress_source_of_truth',
  'merch_store_url', 'ministries_to_grow',
  'ministries_list_html', 'discipleship_pathway_html',
]

export function ContentCollectionAutoFillStaff({
  projectId, sessionId, session, onAccepted,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<AutoFillSuggestion[] | null>(null)
  const [coverageNotes, setCoverageNotes] = useState<string | null>(null)
  const [docsRead, setDocsRead] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [accepting, setAccepting] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null); setSuggestions(null)
    try {
      const alreadyFilled: AutoFillField[] = []
      for (const k of PROPOSABLE_FIELDS) {
        const v = session[k]
        if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
          alreadyFilled.push(k)
        }
      }
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not signed in — refresh the page and try again')
      const res = await fetch('/api/web/agents/answer-content-collection', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ projectId, sessionId, alreadyFilled }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : [])
      setCoverageNotes(json.coverage_notes ?? null)
      setDocsRead(typeof json.docs_read === 'number' ? json.docs_read : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pre-fill scan failed')
    } finally {
      setBusy(false)
    }
  }

  const accept = async (s: AutoFillSuggestion) => {
    setAccepting(s.field)
    try {
      let coerced: unknown = s.value
      if (s.field === 'sermon_youtube_playlist_exists') {
        coerced = typeof s.value === 'boolean'
          ? s.value
          : (String(s.value).toLowerCase() === 'true' || String(s.value).toLowerCase() === 'yes')
      } else if (s.field === 'cms_managed_types') {
        coerced = Array.isArray(s.value)
          ? s.value.filter(v => typeof v === 'string')
          : typeof s.value === 'string' ? s.value.split(',').map(v => v.trim()).filter(Boolean) : []
      }
      const { error: updErr } = await (supabase as any)
        .from('strategy_content_collection_sessions')
        .update({ [s.field]: coerced })
        .eq('id', sessionId)
      if (updErr) throw updErr
      setDismissed(prev => new Set(prev).add(s.field))
      onAccepted?.()
    } catch (e) {
      setError(e instanceof Error ? `Could not save: ${e.message}` : 'Save failed')
    } finally {
      setAccepting(null)
    }
  }

  const dismiss = (field: string) => {
    setDismissed(prev => new Set(prev).add(field))
  }

  const visibleSuggestions = (suggestions ?? []).filter(s => !dismissed.has(s.field))

  if (suggestions === null) {
    return (
      <div className="rounded-lg border border-wm-accent/30 bg-wm-accent-tint/40 p-4">
        <div className="flex items-start gap-3">
          <Sparkles size={18} className="shrink-0 text-wm-accent mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-wm-text mb-0.5">Pre-fill Page 2 from uploaded intake</p>
            <p className="text-[11.5px] text-wm-text-muted leading-snug">
              Scan the partner's uploaded strategy brief, discovery questionnaire,
              and content collection files for answers to Page 2 strategic
              questions. Each proposal is reviewed individually — nothing
              writes without your accept.
            </p>
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-wm-accent hover:bg-wm-accent-strong px-3.5 py-1.5 text-[12px] text-white font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {busy ? 'Reading uploaded files…' : 'Suggest answers from uploads'}
            </button>
            {error && <p className="text-[11px] text-wm-danger mt-2">{error}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-wm-accent/30 bg-wm-accent-tint/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[12.5px] font-semibold text-wm-text">
          Suggested answers ({visibleSuggestions.length})
          {docsRead != null && <span className="text-[11px] font-normal text-wm-text-muted ml-2">· read {docsRead} file{docsRead === 1 ? '' : 's'}</span>}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="text-[11px] text-wm-accent hover:underline disabled:opacity-50"
          >
            {busy ? 'Re-reading…' : 'Re-scan files'}
          </button>
          <button
            type="button"
            onClick={() => { setSuggestions(null); setError(null); setDismissed(new Set()) }}
            className="text-[11px] text-wm-text-muted hover:text-wm-text"
          >
            Hide
          </button>
        </div>
      </div>
      {coverageNotes && (
        <p className="text-[11px] text-wm-text-muted leading-snug italic">{coverageNotes}</p>
      )}
      {error && <p className="text-[11px] text-wm-danger">{error}</p>}
      {visibleSuggestions.length === 0 ? (
        <p className="text-[12px] text-wm-text-muted leading-snug">
          {suggestions.length === 0
            ? 'No high-confidence answers found in uploaded files. Fill the session row manually.'
            : 'All suggestions handled.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleSuggestions.map(s => (
            <li key={s.field} className="rounded-md border border-wm-border bg-wm-bg-elevated p-3">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-[11px] font-mono font-semibold text-wm-text">{s.field}</span>
                <span className={[
                  'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                  s.confidence === 'high'   ? 'bg-green-100 text-green-800' :
                  s.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                              'bg-gray-100 text-gray-700',
                ].join(' ')}>
                  {s.confidence}
                </span>
                <span className="text-[10px] text-wm-text-muted">from {s.source_category}</span>
              </div>
              <div className="rounded bg-wm-bg px-2 py-1.5 mb-1.5 text-[12px] text-wm-text leading-snug break-words">
                {typeof s.value === 'string' && s.value.startsWith('<')
                  ? <code className="text-[11px]">{s.value.slice(0, 200)}{s.value.length > 200 ? '…' : ''}</code>
                  : Array.isArray(s.value)
                    ? <span className="font-mono text-[11px]">{(s.value as unknown[]).join(', ')}</span>
                    : <span>{String(s.value)}</span>}
              </div>
              {s.source_quote && (
                <p className="text-[11px] text-wm-text-muted italic leading-snug mb-1.5">"{s.source_quote}"</p>
              )}
              <p className="text-[11px] text-wm-text-muted leading-snug mb-2">{s.rationale}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void accept(s)}
                  disabled={accepting === s.field}
                  className="inline-flex items-center gap-1 rounded-full bg-wm-accent hover:bg-wm-accent-strong px-3 py-1 text-[11px] text-white font-semibold disabled:opacity-50"
                >
                  {accepting === s.field ? 'Saving…' : 'Accept'}
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(s.field)}
                  disabled={accepting !== null}
                  className="text-[11px] text-wm-accent hover:underline disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
