import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Megaphone, Search, Send, X } from 'lucide-react'
import { createProgress, getInitiativeDetail, listDocs } from '../../../lib/strategyNotion'
import { createAnnouncement } from '../../../lib/announcements'
import {
  isDirectorByEmployeeId, isVPByEmail, listVerifierDefaults,
} from '../../../lib/library'
import { useAuth } from '../../../contexts/AuthContext'
import type {
  Department, DocHubEntry, Milestone, ProgressCategory, ProgressEntry,
  VerifierDefault,
} from '../../../types/strategy'

const CATEGORIES: Array<{ value: ProgressCategory; label: string }> = [
  { value: 'progress', label: 'Progress' },
  { value: 'decision', label: 'Decision' },
  { value: 'resource', label: 'Resource' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'intel',    label: 'Intel' },
  { value: 'blocker',  label: 'Blocker' },
]

/** Human-readable audience label for the announcement toggle. The
 *  initiative dept drives who sees the popup; null/all-in broadcasts
 *  to everyone, dept-specific narrows. */
function announcementAudience(dept: Department | null | undefined): string {
  if (!dept || dept === 'all-in') return 'every staff member'
  const map: Record<Exclude<Department, 'all-in'>, string> = {
    web:      'everyone in Web',
    branding: 'everyone in Branding',
    social:   'everyone in Social',
  }
  return map[dept]
}

/** Inline form for posting a Progress update on the Initiative Detail.
 *  Author is set server-side; we don't ask the user to pick.
 *
 *  Action Item linkage: when `presetActionItemId` is passed (e.g. from the
 *  Action Item detail page), the form is pre-tagged with that Action
 *  Item and the picker is hidden. Otherwise the picker fetches the
 *  initiative's Action Items so the user can attach the update to one of
 *  them — leaving it blank still records the update on the initiative
 *  itself.
 *
 *  Announcement toggle: VPs + dept directors can flip "Push as
 *  announcement" to broadcast the update as a "What's New" popup to
 *  every staff member in the initiative's dept (or to everyone, when
 *  the initiative is `'all-in'`). The toggle is hidden for non-eligible
 *  authors. The announcement insert is best-effort — if it fails, the
 *  Progress entry still landed in Notion and we surface a non-blocking
 *  warning. */
export function PostProgressForm({
  initiativeId, initiativeName, initiativeDepartment,
  presetActionItemId, onPosted, onCancel,
}: {
  initiativeId: string
  /** Initiative's display name. When omitted the announcement toggle
   *  stays hidden — without a name we can't surface the popup subhead
   *  correctly. Pass it from the parent (InitiativeDetailPage knows
   *  the bundle; ProgressPage looks it up from the initiative list). */
  initiativeName?: string
  /** Initiative's strategy dept. Drives the targeting copy on the
   *  toggle ("Everyone in Branding will see this once") and is
   *  denormalized onto the announcement row at create time. */
  initiativeDepartment?: Department | null
  presetActionItemId?: string
  onPosted: (entry: ProgressEntry) => void
  onCancel: () => void
}) {
  const { user, staffProfile } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [categories, setCategories] = useState<ProgressCategory[]>(['progress'])
  const [actionItemId, setActionItemId] = useState<string>(presetActionItemId ?? '')
  const [actionItems, setActionItems] = useState<Milestone[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Announcement gate ───────────────────────────────────────────────
  // Toggle is rendered only when the author is the VP or a seated/
  // delegated director. We need the verifier-defaults table to make
  // the director check; load it lazily so the form mount doesn't pay
  // for it when the user is unlikely to qualify.
  const [pushAnnouncement, setPushAnnouncement] = useState(false)
  const [verifierDefaults, setVerifierDefaults] = useState<VerifierDefault[] | null>(null)
  useEffect(() => {
    if (!staffProfile) return
    let cancelled = false
    listVerifierDefaults()
      .then(rows => { if (!cancelled) setVerifierDefaults(rows) })
      .catch(() => { if (!cancelled) setVerifierDefaults([]) })
    return () => { cancelled = true }
  }, [staffProfile])
  const isAnnouncementAuthor =
    isVPByEmail(staffProfile?.email ?? null) ||
    isDirectorByEmployeeId(staffProfile?.id ?? null, verifierDefaults ?? [])
  const announcementToggleAvailable =
    isAnnouncementAuthor && !!initiativeName

  // ── Library doc linker ──────────────────────────────────────────────
  // When the announcement toggle is on, the author can attach Library
  // docs that show up as one-click buttons in the popup. We lazy-load
  // the doc list only after the toggle goes on so the form doesn't
  // pay for the docs query when no announcement is being authored.
  const [linkedDocIds, setLinkedDocIds] = useState<string[]>([])
  const [allDocs, setAllDocs] = useState<DocHubEntry[] | null>(null)
  const [docSearch, setDocSearch] = useState('')
  useEffect(() => {
    if (!pushAnnouncement || allDocs !== null) return
    let cancelled = false
    listDocs()
      .then(docs => { if (!cancelled) setAllDocs(docs) })
      .catch(() => { if (!cancelled) setAllDocs([]) })
    return () => { cancelled = true }
  }, [pushAnnouncement, allDocs])
  const docMatches = useMemo(() => {
    if (!allDocs) return [] as DocHubEntry[]
    const q = docSearch.trim().toLowerCase()
    if (!q) return [] as DocHubEntry[]
    return allDocs
      .filter(d => !linkedDocIds.includes(d.id))
      .filter(d => d.title.toLowerCase().includes(q))
      .slice(0, 6)
  }, [allDocs, docSearch, linkedDocIds])
  const linkedDocs = useMemo(() => {
    const map = new Map((allDocs ?? []).map(d => [d.id, d]))
    return linkedDocIds
      .map(id => map.get(id))
      .filter((d): d is DocHubEntry => !!d)
  }, [allDocs, linkedDocIds])

  // Lazy-load this initiative's Action Items only when the picker is
  // shown (no preset). Caches in component state — one fetch per mount.
  useEffect(() => {
    if (presetActionItemId || !initiativeId) return
    let cancelled = false
    getInitiativeDetail(initiativeId)
      .then(b => { if (!cancelled) setActionItems(b.milestones) })
      .catch(() => { if (!cancelled) setActionItems([]) })
    return () => { cancelled = true }
  }, [initiativeId, presetActionItemId])

  const toggle = (c: ProgressCategory) =>
    setCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return }
    setSubmitting(true)
    setError(null)
    try {
      const entry = await createProgress({
        initiativeId,
        title: title.trim(),
        body: body.trim(),
        categories,
        actionItemIds: actionItemId ? [actionItemId] : undefined,
      })
      // Announcement insert is best-effort — the Progress entry
      // already landed in Notion at this point, so a failure here
      // shouldn't block the rest of the submit flow. Surface a
      // non-blocking warning and hand the entry back to the parent.
      if (pushAnnouncement && initiativeName && user?.id) {
        try {
          await createAnnouncement({
            progress: entry,
            initiative: {
              id: initiativeId,
              name: initiativeName,
              department: initiativeDepartment ?? null,
            },
            body: body.trim(),
            createdByEmployeeId: staffProfile?.id ?? null,
            linkedDocs: linkedDocs.map(d => ({ notion_id: d.id, title: d.title })),
          })
        } catch (annErr) {
          const msg = annErr instanceof Error ? annErr.message : String(annErr)
          setError(`Update posted, but announcement failed: ${msg}`)
        }
      }
      onPosted(entry)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-primary-purple/30 bg-lavender-tint/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-deep-plum uppercase tracking-widest">
          New Progress Update
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-purple-gray/60 hover:text-deep-plum"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What happened? (one-line summary)"
        autoFocus
        className="w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      />

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Optional details, decisions, or context (plain text — formatting collapses on save)"
        rows={4}
        className="w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
      />

      {/* Action Item linkage. */}
      {presetActionItemId ? (
        // Posting from inside an Action Item detail page: the preset
        // is auto-applied and the picker is hidden. Surface a chip so
        // the author sees that the link will be set on save — staff
        // were missing the cue and assumed updates posted from the
        // Action Item page weren't being tied back to it.
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-semibold px-2.5 py-1 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-purple" />
          Linking this update to the current Action Item
        </div>
      ) : (
        // Free-form posting (Initiative detail or Progress page) lets
        // the author optionally attach to one of the initiative's
        // Action Items.
        <div className="grid grid-cols-[100px_1fr] items-center gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-deep-plum">
            Action Item
          </label>
          <select
            value={actionItemId}
            onChange={e => setActionItemId(e.target.value)}
            disabled={actionItems === null}
            className="rounded border border-lavender bg-white px-2 py-1.5 text-xs text-deep-plum outline-none focus:border-primary-purple"
          >
            <option value="">— None (initiative-level update) —</option>
            {(actionItems ?? []).map(ai => (
              <option key={ai.id} value={ai.id}>{ai.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            type="button"
            onClick={() => toggle(c.value)}
            className={[
              'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
              categories.includes(c.value)
                ? 'bg-primary-purple text-white'
                : 'bg-white border border-lavender text-deep-plum hover:border-primary-purple/40',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* "Push as announcement" — VP + directors only. Surfaces the
          dept-targeting copy so the author knows the blast radius
          before they hit submit. */}
      {announcementToggleAvailable && (
        <button
          type="button"
          onClick={() => setPushAnnouncement(v => !v)}
          disabled={!title.trim() || !body.trim()}
          className={[
            'w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
            pushAnnouncement
              ? 'border-primary-purple bg-primary-purple/10'
              : 'border-lavender bg-white hover:border-primary-purple/40',
            (!title.trim() || !body.trim()) ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
          title={!title.trim() || !body.trim()
            ? 'Add a title and body before announcing.'
            : undefined}
        >
          <Megaphone size={14} className="text-primary-purple shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-deep-plum">
              Push as &ldquo;What&rsquo;s New&rdquo; announcement
            </p>
            <p className="text-[11px] text-purple-gray mt-0.5 leading-relaxed">
              {pushAnnouncement
                ? <>{announcementAudience(initiativeDepartment)} will see this once as a popup.</>
                : <>Surface this update as a one-time popup for {announcementAudience(initiativeDepartment)}.</>}
            </p>
          </div>
          <span className={[
            'text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0',
            pushAnnouncement
              ? 'bg-primary-purple text-white'
              : 'bg-lavender/60 text-purple-gray',
          ].join(' ')}>
            {pushAnnouncement ? 'ON' : 'OFF'}
          </span>
        </button>
      )}

      {/* Library-doc linker — surfaces only when the announcement
          toggle is on. Each linked doc renders as a chip + becomes a
          "View [Doc Title]" button on the popup; clicking navigates to
          /strategy/library/doc/{id} where reading auto-tracks via the
          existing strategy_wiki_reads pipeline. */}
      {announcementToggleAvailable && pushAnnouncement && (
        <div className="rounded-lg border border-primary-purple/30 bg-white px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <BookOpen size={12} className="text-primary-purple" />
            <p className="text-[11px] font-bold text-deep-plum">
              Link Library docs <span className="font-normal text-purple-gray/70">(optional)</span>
            </p>
          </div>
          {linkedDocs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedDocs.map(d => (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-purple/10 text-primary-purple text-[11px] font-semibold px-2.5 py-0.5"
                >
                  <BookOpen size={10} />
                  <span className="truncate max-w-[200px]">{d.title}</span>
                  <button
                    type="button"
                    onClick={() => setLinkedDocIds(prev => prev.filter(id => id !== d.id))}
                    className="text-primary-purple/70 hover:text-primary-purple"
                    aria-label={`Remove ${d.title}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-gray/60" />
            <input
              type="text"
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              placeholder={allDocs === null ? 'Loading library docs…' : 'Search a doc to link…'}
              disabled={allDocs === null}
              className="w-full pl-7 pr-3 py-1.5 rounded border border-lavender bg-white text-xs text-deep-plum outline-none focus:border-primary-purple disabled:bg-lavender-tint/30"
            />
          </div>
          {docMatches.length > 0 && (
            <div className="rounded border border-lavender bg-white max-h-44 overflow-y-auto">
              {docMatches.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setLinkedDocIds(prev => [...prev, d.id])
                    setDocSearch('')
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-lavender-tint border-b border-lavender last:border-b-0"
                >
                  <BookOpen size={11} className="text-primary-purple shrink-0" />
                  <span className="flex-1 truncate text-deep-plum">{d.title}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-purple-gray/70 leading-relaxed">
            Recipients see each linked doc as a button on the popup. Clicking opens it in the Library, where reading is auto-tracked.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !title.trim() || (pushAnnouncement && !body.trim())}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple text-white text-xs font-semibold px-3 py-1.5 hover:bg-deep-plum disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pushAnnouncement ? <Megaphone size={11} /> : <Send size={11} />}
          {submitting
            ? 'Posting…'
            : pushAnnouncement ? 'Post + announce' : 'Post update'}
        </button>
      </div>
    </div>
  )
}
