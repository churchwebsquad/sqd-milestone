import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, ExternalLink, Pencil, Plus, Trash2, Check, X } from 'lucide-react'
import type { Milestone, ProgressCategory, ProgressEntry, ProgressFeedEntry } from '../../types/strategy'
import { archivePage, getInitiativeDetail, updateProgress } from '../../lib/strategyNotion'
import { CategoryPill, DepartmentBadge } from './StrategyUI'
import { MarkdownBody } from './MarkdownBody'

const ALL_CATEGORIES: ProgressCategory[] = ['progress', 'decision', 'resource', 'feedback', 'intel', 'blocker']

/** Full progress entry card. The whole card is clickable — clicking
 *  navigates to the related initiative — but the action buttons (edit,
 *  archive, open-in-Notion) intercept the click so they don't double-fire.
 *  When in edit mode, the card click is suspended.
 *
 *  Author avatar + name shows above the date so attribution reads at a
 *  glance. The "View in Notion" link is always visible (not hover-gated)
 *  so the affordance is discoverable.
 *
 *  Linked docs: when this entry was authored as an announcement and
 *  the author attached Library docs, the parent passes `linkedDocs` so
 *  every reader has a persistent home for the doc list — not just the
 *  one shot in the announcement popup. */
export function ProgressEntryItem({ entry, showInitiative = true, linkedDocs, onUpdated, onArchived }: {
  entry: ProgressFeedEntry
  showInitiative?: boolean
  /** Library docs the author linked when posting this update. Renders
   *  as a "Read the docs" row below the body. Empty array or
   *  undefined → row hidden. Each doc opens its Library page in a
   *  new tab so the user can keep the entry visible. */
  linkedDocs?: Array<{ notion_id: string; title: string }>
  onUpdated?: (next: ProgressEntry) => void
  onArchived?: (id: string) => void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(entry.title)
  const [draftBody, setDraftBody] = useState(entry.body)
  const [draftCats, setDraftCats] = useState<ProgressCategory[]>(entry.categories)
  const [draftActionItemIds, setDraftActionItemIds] = useState<string[]>(entry.actionItemIds ?? [])
  // Picker source — populated lazily on first edit so we don't hit
  // Notion for entries the user never opens. Indexed by id so we can
  // resolve names for the currently-linked items even if their parent
  // initiative changed.
  const [actionItemOptions, setActionItemOptions] = useState<Milestone[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy-load this entry's initiative's Action Items the first time the
  // user opens edit mode. Skipped when the entry has no initiative
  // (orphan progress) — the picker just shows already-linked ids.
  useEffect(() => {
    if (!editing || !entry.initiativeId || actionItemOptions.length > 0) return
    let cancelled = false
    getInitiativeDetail(entry.initiativeId)
      .then(b => { if (!cancelled) setActionItemOptions(b.milestones) })
      .catch(() => { /* picker degrades to "no options"; the user can still remove existing links */ })
    return () => { cancelled = true }
  }, [editing, entry.initiativeId, actionItemOptions.length])

  const startEdit = () => {
    setDraftTitle(entry.title)
    setDraftBody(entry.body)
    setDraftCats(entry.categories)
    setDraftActionItemIds(entry.actionItemIds ?? [])
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    if (!draftTitle.trim()) { setError('Title required'); return }
    setPending(true)
    setError(null)
    try {
      const next = await updateProgress(entry.id, {
        title: draftTitle.trim(),
        body: draftBody,
        categories: draftCats,
        // Always send the relation so a clearing edit (user removes
        // every link) actually clears it server-side. The writer
        // handles `[]` → empty relation.
        actionItemIds: draftActionItemIds,
      })
      onUpdated?.({ ...next, kind: 'progress-entry' } as ProgressEntry)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const archive = async () => {
    if (!confirm('Archive this update?')) return
    await archivePage(entry.id, 'progress')
    onArchived?.(entry.id)
  }

  // Card-wide click: navigate to the related initiative. Suspended in
  // edit mode and ignored when the click target is an action button.
  const handleCardClick = () => {
    if (editing) return
    if (entry.initiativeId) navigate(`/strategy/initiatives/${entry.initiativeId}`)
  }
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <article
      onClick={entry.initiativeId && !editing ? handleCardClick : undefined}
      className={[
        'py-4 border-b border-[var(--color-lib-border)] last:border-b-0 group',
        entry.initiativeId && !editing
          ? 'cursor-pointer transition-colors hover:bg-[var(--color-lib-bg)]/40 -mx-5 px-5'
          : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        {editing ? (
          <input
            type="text"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onClick={stop}
            autoFocus
            className="flex-1 rounded border border-[var(--color-lib-accent)] bg-white px-2 py-1 text-sm font-semibold text-[var(--color-lib-text)] outline-none focus:ring-2 focus:ring-[var(--color-lib-accent)]/30"
          />
        ) : (
          <h3 className="text-sm font-semibold text-[var(--color-lib-text)] leading-snug flex-1">
            {entry.title}
          </h3>
        )}
        <div className="flex items-center gap-1.5 shrink-0" onClick={stop}>
          {!editing && entry.categories.map(cat => (
            <CategoryPill key={cat} category={cat} />
          ))}
          {!editing && (
            <a
              href={buildNotionUrl(entry.id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-colors"
              title="View in Notion"
            >
              <ExternalLink size={11} />
            </a>
          )}
          {onUpdated && !editing && (
            <button
              type="button"
              onClick={e => { stop(e); startEdit() }}
              className="opacity-0 group-hover:opacity-100 text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-accent)] transition-opacity"
              title="Edit"
            >
              <Pencil size={11} />
            </button>
          )}
          {onArchived && !editing && (
            <button
              type="button"
              onClick={e => { stop(e); archive() }}
              className="opacity-0 group-hover:opacity-100 text-[var(--color-lib-text-subtle)] hover:text-red-500 transition-opacity"
              title="Archive"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-lib-text-muted)] mb-2">
        {entry.author && <AuthorChip author={entry.author} />}
        {entry.datePosted && (
          <>
            {entry.author && <span className="text-[var(--color-lib-text-subtle)]">·</span>}
            <span>{formatDate(entry.datePosted)}</span>
          </>
        )}
        {showInitiative && entry.initiativeId && entry.initiativeName && (
          <>
            <span className="text-[var(--color-lib-text-subtle)]">·</span>
            <Link
              to={`/strategy/initiatives/${entry.initiativeId}`}
              onClick={stop}
              className="hover:text-[var(--color-lib-accent)] transition-colors font-medium"
            >
              {entry.initiativeName}
            </Link>
          </>
        )}
        {entry.actionItemIds && entry.actionItemIds.length > 0 && (
          <>
            {entry.actionItemIds.map((aid, i) => (
              <Link
                key={aid}
                to={`/strategy/action-items/${aid}`}
                onClick={stop}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] px-2 py-px text-[10px] font-medium hover:bg-[var(--color-lib-accent)] hover:text-white transition-colors"
                title="Open Action Item"
              >
                → {entry.actionItemNames?.[i] ?? 'Action Item'}
              </Link>
            ))}
          </>
        )}
        {showInitiative && <DepartmentBadge department={entry.department} size="xs" />}
      </div>

      {editing ? (
        <div className="space-y-2 mt-2" onClick={stop}>
          <textarea
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            rows={5}
            placeholder="Body (plain text)"
            className="w-full rounded border border-[var(--color-lib-border)] bg-white px-2 py-1.5 text-sm text-[var(--color-lib-text)] outline-none focus:border-[var(--color-lib-accent)] focus:ring-2 focus:ring-[var(--color-lib-accent)]/20"
          />
          <div className="flex flex-wrap gap-1.5">
            {ALL_CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setDraftCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                className={[
                  'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  draftCats.includes(c)
                    ? 'bg-[var(--color-lib-accent)] text-white'
                    : 'bg-white border border-[var(--color-lib-border)] text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
                ].join(' ')}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Linked Action Items — recovery affordance. The post form
              writes the relation up front, but earlier bugs let the
              link drop silently; this is the only path users have to
              fix already-posted entries. Shown for every entry, even
              ones with no initiative — staff can at least remove
              stale ids. */}
          <ActionItemPicker
            options={actionItemOptions}
            selectedIds={draftActionItemIds}
            onChange={setDraftActionItemIds}
            // For lookups when the original action item isn't in this
            // initiative's set anymore (renamed initiative, etc.).
            originalNames={entry.actionItemNames ?? []}
            originalIds={entry.actionItemIds ?? []}
            initiativeMissing={!entry.initiativeId}
          />

          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-lib-border)] bg-white text-xs text-[var(--color-lib-text)] px-2.5 py-1 hover:bg-[var(--color-lib-bg)]"
            >
              <X size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !draftTitle.trim()}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-lib-accent)] text-white text-xs font-semibold px-2.5 py-1 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
            >
              <Check size={11} />
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        entry.body.trim() && (
          <MarkdownBody
            text={entry.body}
            className="text-sm text-[var(--color-lib-text)] leading-relaxed space-y-2"
          />
        )
      )}

      {/* Linked Library docs — when this update was authored as a
          "What's New" announcement and the author attached docs, they
          surface here as persistent CTAs. Open in a new tab so the
          user keeps this entry visible while reading; reading the
          target Library page auto-tracks via strategy_wiki_reads. */}
      {!editing && linkedDocs && linkedDocs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-lavender/60">
          <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray/70 mb-1.5">
            Read the docs
          </p>
          <div className="flex flex-col gap-1.5" onClick={stop}>
            {linkedDocs.map(d => (
              <a
                key={d.notion_id}
                href={`/strategy/library/doc/${d.notion_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-lavender bg-white px-3 py-1.5 text-xs font-semibold text-deep-plum hover:border-primary-purple hover:text-primary-purple hover:bg-lavender-tint/40 transition-colors w-fit max-w-full"
              >
                <BookOpen size={11} className="text-primary-purple shrink-0" />
                <span className="truncate">{d.title}</span>
                <ArrowRight size={10} className="shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

/** Add/remove the Action Items relation from a Progress entry's edit
 *  form. Renders a row of selected items as removable chips and an
 *  inline dropdown that lists every Action Item on the entry's
 *  initiative which isn't already linked. Staff can both clear stale
 *  links (the bug we shipped this for) and attach new ones. */
function ActionItemPicker({
  options, selectedIds, onChange, originalNames, originalIds, initiativeMissing,
}: {
  options: Milestone[]
  selectedIds: string[]
  onChange: (next: string[]) => void
  originalNames: string[]
  originalIds: string[]
  initiativeMissing: boolean
}) {
  // Build a name lookup from both the picker's option set (current
  // initiative) and the entry's own original ids → names mapping (for
  // links that point at items outside the current initiative). Falls
  // back to a generic label when neither source has a name.
  const nameById = new Map<string, string>()
  for (const opt of options) nameById.set(opt.id, opt.name)
  for (let i = 0; i < originalIds.length; i++) {
    if (!nameById.has(originalIds[i])) {
      nameById.set(originalIds[i], originalNames[i] ?? 'Action Item')
    }
  }

  const remaining = options.filter(o => !selectedIds.includes(o.id))

  return (
    <div className="rounded-lg border border-[var(--color-lib-border)] bg-white px-3 py-2 space-y-1.5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-lib-text-muted)]">
        Linked action items
      </p>

      {selectedIds.length === 0 ? (
        <p className="text-[11px] italic text-[var(--color-lib-text-muted)]">None linked.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] pl-2.5 pr-1 py-0.5 text-[11px] font-medium"
            >
              {nameById.get(id) ?? 'Action Item'}
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter(x => x !== id))}
                className="rounded-full hover:bg-[var(--color-lib-accent)]/20 p-0.5"
                title="Remove this link"
                aria-label="Remove"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {initiativeMissing ? (
        <p className="text-[10px] text-[var(--color-lib-text-muted)] italic">
          Set an initiative on this entry to add new action-item links.
        </p>
      ) : remaining.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <Plus size={11} className="text-[var(--color-lib-text-muted)]" />
          <select
            value=""
            onChange={e => {
              if (!e.target.value) return
              onChange([...selectedIds, e.target.value])
            }}
            className="flex-1 rounded border border-[var(--color-lib-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-lib-text)] outline-none focus:border-[var(--color-lib-accent)]"
          >
            <option value="">Add an action item…</option>
            {remaining.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      ) : options.length === 0 ? (
        <p className="text-[10px] text-[var(--color-lib-text-muted)] italic">Loading action items…</p>
      ) : (
        <p className="text-[10px] text-[var(--color-lib-text-muted)] italic">All action items already linked.</p>
      )}
    </div>
  )
}

/** Compact author chip: avatar (or initials) + name. */
function AuthorChip({ author }: {
  author: { id: string; name: string | null; avatarUrl: string | null }
}) {
  const initials = (author.name ?? '?')
    .split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span className="inline-flex items-center gap-1.5">
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-[var(--color-lib-accent-soft)] text-[var(--color-lib-accent)] grid place-items-center text-[8px] font-semibold">
          {initials}
        </span>
      )}
      <span className="font-medium text-[var(--color-lib-text)]">{author.name ?? 'Unknown'}</span>
    </span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Fallback Notion URL when the entry's `notionUrl` isn't populated.
 *  Notion accepts the page ID with hyphens stripped. */
function buildNotionUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`
}

/** Compact single-line variant — used in sidebar previews on Command
 *  Center and the Recent Progress feed on My Dashboard. */
export function ProgressCompact({ entry }: { entry: ProgressFeedEntry }) {
  return (
    <Link
      to={entry.initiativeId ? `/strategy/initiatives/${entry.initiativeId}` : '/strategy/progress'}
      className="block py-1.5 hover:text-[var(--color-lib-accent)] transition-colors"
    >
      <p className="text-xs text-[var(--color-lib-text)] font-medium truncate">{entry.title}</p>
      <p className="text-[11px] text-[var(--color-lib-text-muted)] truncate">
        {entry.initiativeName ?? 'Unassigned'}
        {entry.datePosted && <> · {formatShort(entry.datePosted)}</>}
      </p>
    </Link>
  )
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
