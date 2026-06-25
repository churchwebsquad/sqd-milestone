/**
 * InventoryView — the shared content-inventory surface used by both
 * staff (WM Crawl Inventory tab) and partner (Content Collection
 * review step).
 *
 * Same component, same data shape, same layout — only difference is
 * `reviewMode`:
 *   - reviewMode=false (staff): no status pills, read-only.
 *   - reviewMode=true  (partner): 3-state status pill + note field on
 *     every section/program.
 *
 * Layout per topic mirrors how a partner thinks about a ministry:
 *   Voice → Details → Programs (each as a dossier) → FAQs →
 *   Key Phrases → CTAs → Scripture → Sources.
 *
 * Topics are grouped under the 8 partner-facing groups
 * (PARTNER_GROUPS) so staff and partner see identical structure.
 *
 * No content is hidden behind "show more" — the partner can't approve
 * what they can't see. All passages, all items, expanded by default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Mic2, ClipboardList, Sparkles, HelpCircle, Quote, ArrowRight, BookOpen,
  ExternalLink, CheckCircle2, Edit3, Circle, EyeOff, Check, Pencil,
  Calendar, MapPin, MessageCircle, ListChecks, Hash, Plus,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Newspaper, Layers,
} from 'lucide-react'
import { PARTNER_GROUPS, type PartnerBucket } from '../../../lib/webPartnerGroups'
import { computeBaselineCoverage, type BaselineCoverage } from '../../../lib/webPartnerBaselines'
import { sanitizeTopicsForPartner } from '../../../lib/sanitizeInventoryForPartner'
import { detectToolFromUrl } from '../../../lib/partnerToolUrl'
import { WMRichTextEditor } from '../RichTextEditor'
import { FileUploadField } from '../../contentcollection/FileUploadField'
import type { AttachmentMetadata } from '../../../lib/contentCollectionAttachments'
import {
  PartnerTextInput,
  PartnerTextArea,
  PartnerRichTextField,
} from '../../contentcollection/PartnerField'

// ── Public types ─────────────────────────────────────────────────────

export interface TopicRow {
  id?:                  string
  topic_key:            string
  topic_label:          string
  voice_signal:         string | null
  passages:             Passage[]
  items:                Item[]
  added_snippet_tokens: string[]
  source_page_urls:     string[]
}

export interface Passage  { url: string; title?: string; text: string }
export type Item = Record<string, unknown> & { kind?: string; source_url?: string }
export interface SnippetRow { token: string; label: string; expansion: string }

export type MarkStatus = 'approved' | 'outdated' | 'approved_keep_as_is' | 'omit'
export interface Mark {
  target_kind:                   string
  target_path:                   string
  status:                        MarkStatus
  client_note:                   string | null
  /** Partner-supplied name for an "Add something we missed" entry —
   *  the title they typed in the form. Surfaced back beneath the
   *  bucket so the saved entry stays visible after the form closes. */
  proposed_program_name?:        string | null
  proposed_program_description?: string | null
}

export type SaveMark = (
  path: string,
  kind: 'topic' | 'program' | 'topic_item' | 'missing_program',
  status: MarkStatus,
  note?: string | null,
  extra?: {
    proposed_program_name?:        string | null
    proposed_program_description?: string | null
    /** Structured intent (v109). NULL/undefined = legacy/program-shaped
     *  add. {kind:"cta", url, tool, language?} for first-class CTAs. */
    proposed_metadata?:            Record<string, unknown> | null
  },
) => Promise<void>

/** Attachment row shape — mirrors strategy_content_collection_attachments.
 *  Kept local + minimal so this module doesn't take a dependency on the
 *  ContentCollectionPage's full type. */
export interface InventoryAttachment {
  id:           string
  session_id:   string
  kind:         string
  file_path:    string
  file_name:    string
  mime_type:    string | null
  size_bytes:   number | null
  target_path:  string | null
  uploaded_at:  string
}

/** Context for "Add something we missed" attachment uploads. Set at
 *  the InventoryView root in partner-review mode; nested AddMissing
 *  buttons read from it via `useAttachmentContext()`. Null elsewhere. */
interface AttachmentContextValue {
  sessionId:   string
  attachments: InventoryAttachment[]
  onChange:    (updater: (prev: InventoryAttachment[]) => InventoryAttachment[]) => void
}
const AttachmentContext = createContext<AttachmentContextValue | null>(null)
function useAttachmentContext() { return useContext(AttachmentContext) }

// ── Group-edit scope ─────────────────────────────────────────────────
//
// Edits at the partner portal happen one card at a time, not one
// line at a time. Each editable card (top-level Details section, each
// Program card) hosts a GroupEditScope that:
//   • exposes an `editing` flag down to descendants via context,
//   • collects each editable row's commit / reset callbacks via
//     `register`, and
//   • runs all commits sequentially when the card's Save button fires.
//
// Rows that want to participate call `useGroupEdit()`. When editing
// is true they render an input + register a commit (latest draft via
// ref). When editing is false they render read-only.
interface GroupEditRowHandlers {
  commit: () => Promise<void>
  reset:  () => void
}
interface GroupEditContextValue {
  editing:  boolean
  register: (id: string, handlers: GroupEditRowHandlers) => () => void
}
const GroupEditContext = createContext<GroupEditContextValue | null>(null)
function useGroupEdit(): GroupEditContextValue | null { return useContext(GroupEditContext) }

interface GroupEditState {
  editing:     boolean
  saving:      boolean
  startEdit:   () => void
  cancelAll:   () => void
  saveAll:     () => Promise<void>
  contextValue: GroupEditContextValue
}
function useGroupEditState(): GroupEditState {
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const handlersRef = useRef<Map<string, GroupEditRowHandlers>>(new Map())

  const register: GroupEditContextValue['register'] = useCallback((id, handlers) => {
    handlersRef.current.set(id, handlers)
    return () => { handlersRef.current.delete(id) }
  }, [])

  const startEdit = useCallback(() => { setEditing(true) }, [])
  const cancelAll = useCallback(() => {
    for (const h of handlersRef.current.values()) h.reset()
    setEditing(false)
  }, [])
  const saveAll = useCallback(async () => {
    setSaving(true)
    try {
      // Parallelize commits across rows. Each commit writes to a
      // DIFFERENT strategy_content_collection_marks row (keyed by
      // session_id + target_path), so there's no Supabase write
      // contention to avoid — the prior comment about sequential
      // saves was stale. With N rows in a group, the sequential
      // for-await loop racked up N * ~300ms = multi-second hangs;
      // Promise.all collapses that to a single round-trip wall time.
      //
      // Promise.allSettled keeps a single failing row from poisoning
      // the rest — partner sees the remaining edits saved, and we
      // surface failures via console rather than rolling everything
      // back (each row's optimistic state already reflects the draft;
      // a failed write means that row stays optimistic and the next
      // edit retries).
      const handlers = Array.from(handlersRef.current.values())
      const results = await Promise.allSettled(handlers.map(h => h.commit()))
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length > 0) {
        console.error(`[group-save] ${failures.length}/${results.length} commits failed`, failures.map(f => f.reason))
      }
    } finally {
      setSaving(false)
    }
    setEditing(false)
  }, [])

  const contextValue: GroupEditContextValue = useMemo(
    () => ({ editing, register }),
    [editing, register],
  )
  return { editing, saving, startEdit, cancelAll, saveAll, contextValue }
}

/** Edit / Save all / Cancel button cluster for a GroupEditScope's
 *  card header. Renders nothing when canEdit is false. */
function GroupEditToolbar({ scope, canEdit, label = 'Edit' }: {
  scope:   GroupEditState
  canEdit: boolean
  label?:  string
}) {
  if (!canEdit) return null
  if (scope.editing) {
    return (
      <div className="inline-flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void scope.saveAll()}
          disabled={scope.saving}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-primary-purple hover:bg-deep-plum rounded-full px-3 py-1 disabled:opacity-60"
        >
          {scope.saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save all
        </button>
        <button
          type="button"
          onClick={scope.cancelAll}
          className="text-[11px] font-semibold text-purple-gray hover:text-deep-plum"
        >
          Cancel
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={scope.startEdit}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:text-deep-plum px-2 py-0.5 rounded hover:bg-lavender-tint/60 shrink-0"
      title="Edit everything in this card"
    >
      <Pencil size={11} /> {label}
    </button>
  )
}

/** Context for external prefills (e.g. photo library URL from
 *  discovery). Keyed `bucketKey/fieldKey`. */
const ExternalPrefillContext = createContext<Record<string, string>>({})
function useExternalPrefill(bucketKey: string, fieldKey: string): string | undefined {
  const map = useContext(ExternalPrefillContext)
  return map[`${bucketKey}/${fieldKey}`]
}
function useExternalPrefillMap(): Record<string, string> {
  return useContext(ExternalPrefillContext)
}

interface Props {
  topicsByKey:      Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
  reviewMode?:      boolean
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
  /** Required for the "Add something we missed" attachments feature.
   *  When provided alongside `attachments` + `onAttachmentChange`,
   *  the form lets partners attach CSVs / docs / images to each
   *  missing-content mark. Omit on the staff side (read-only view). */
  sessionId?:         string
  attachments?:       InventoryAttachment[]
  onAttachmentChange?: (updater: (prev: InventoryAttachment[]) => InventoryAttachment[]) => void
  /** Per-field overrides keyed by `bucketKey/fieldKey`. When set,
   *  the baseline form-field renders this value as its prefill
   *  instead of whatever the crawl extracted. Used for fields whose
   *  source of truth lives outside the crawl — e.g. the photo
   *  library URL pulled from the discovery questionnaire / partner
   *  account progress. */
  externalPrefills?:  Record<string, string>
  /** Staff-side: render groups in the same one-at-a-time accordion
   *  pattern partners see, but WITHOUT the review-mode marks /
   *  status pills. Lets staff scroll the full crawl without it
   *  unrolling into an unwieldy wall. Ignored when reviewMode=true
   *  (partner side already uses the accordion). */
  groupAccordion?:    boolean
}

// ── Staff-side group accordion ───────────────────────────────────────
//
// Same shape as ReviewAccordion (one open at a time, scroll-to-top
// on open, Next button at the bottom) but without partner review
// affordances: no marks, no add-missing button, no per-section status
// pills. Used by the staff Intake & Crawl page so the inventory
// renders in scrollable chunks the way partners see it.

function StaffGroupAccordion({
  openKey, setOpenKey, topicsByKey, snippetsByToken,
}: {
  openKey:          string | null
  setOpenKey:       (key: string | null) => void
  topicsByKey:      Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
}) {
  const scrollToGroup = (key: string) => {
    queueMicrotask(() => {
      const el = document.getElementById(`group:${key}`)
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }
  const onOpenGroup = (key: string) => {
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    scrollToGroup(key)
  }
  return (
    <>
      {PARTNER_GROUPS.map((g, idx) => {
        const isOpen = openKey === g.key
        const nextGroup = PARTNER_GROUPS[idx + 1] ?? null
        return (
          <section
            key={g.key}
            id={`group:${g.key}`}
            className={`scroll-mt-24 rounded-2xl border bg-white border-lavender overflow-hidden transition-shadow ${isOpen ? 'shadow-sm' : ''}`}
          >
            <button
              type="button"
              onClick={() => onOpenGroup(g.key)}
              className="w-full px-4 md:px-5 py-3 md:py-4 flex items-center justify-between gap-3 text-left hover:bg-black/[0.02] transition-colors"
              aria-expanded={isOpen}
            >
              <h2 className="font-serif italic text-xl text-deep-plum min-w-0">{g.label}</h2>
              {isOpen
                ? <ChevronUp size={18} className="text-purple-gray shrink-0" />
                : <ChevronDown size={18} className="text-purple-gray shrink-0" />}
            </button>
            {isOpen && (
              <div className="px-4 md:px-5 pb-4 md:pb-5 space-y-3 border-t border-lavender/50">
                <div className="pt-3 space-y-3">
                  {g.buckets.map(b => (
                    <BucketBlock
                      key={b.key}
                      bucket={b}
                      topicsByKey={topicsByKey}
                      snippetsByToken={snippetsByToken}
                      reviewMode={false}
                    />
                  ))}
                </div>
                {nextGroup && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onOpenGroup(nextGroup.key)}
                      className="inline-flex items-center gap-2 rounded-full bg-deep-plum text-white px-4 py-2 text-[13px] font-semibold hover:bg-primary-purple transition-colors"
                    >
                      Next: {nextGroup.label}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

// ── Top-level component ──────────────────────────────────────────────

export function InventoryView({
  topicsByKey: rawTopicsByKey, snippetsByToken, reviewMode = false, marks, saveMark,
  sessionId, attachments, onAttachmentChange,
  externalPrefills = {},
  groupAccordion = false,
}: Props) {
  // Partner-facing view: dedupe items that landed in multiple topics
  // (Paradox Youth → kids + students; Young Adults → students +
  // college) and gate out any Church-Media-Squad references so they
  // never reach the partner. Staff view keeps the raw map.
  const topicsByKey = useMemo(
    () => reviewMode ? sanitizeTopicsForPartner(rawTopicsByKey) : rawTopicsByKey,
    [rawTopicsByKey, reviewMode],
  )
  const tocEntries = useMemo(() => buildTocEntries(topicsByKey), [topicsByKey])
  // Accordion open-key is shared between the side TOC and the
  // accordion itself so TOC clicks can open the target group BEFORE
  // scrolling — without this the bucket element doesn't exist in the
  // DOM when collapsed, and scrollIntoView silently does nothing.
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(PARTNER_GROUPS[0]?.key ?? null)
  const attachmentCtx: AttachmentContextValue | null =
    sessionId && attachments && onAttachmentChange
      ? { sessionId, attachments, onChange: onAttachmentChange }
      : null
  return (
    <AttachmentContext.Provider value={attachmentCtx}>
    <ExternalPrefillContext.Provider value={externalPrefills}>
    <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <InventoryTOC
        entries={tocEntries}
        reviewMode={reviewMode}
        marks={marks}
        saveMark={saveMark}
        onSelectGroup={reviewMode ? setOpenGroupKey : undefined}
      />
      <div className="space-y-6 min-w-0">
        {reviewMode ? (
          // Partner-facing review experience: accordion-style. One
          // group expanded at a time by default; partner approves or
          // marks-for-update at each group and the next un-reviewed
          // group auto-opens. Headers stay clickable so the partner
          // can also review ahead.
          <ReviewAccordion
            openKey={openGroupKey}
            setOpenKey={setOpenGroupKey}
            topicsByKey={topicsByKey}
            snippetsByToken={snippetsByToken}
            marks={marks}
            saveMark={saveMark}
          />
        ) : groupAccordion ? (
          // Staff view, accordion-flavored: one group open at a time so
          // the Intake & Crawl page stays scrollable. No marks / no
          // status pills (those are partner-mode only). TOC clicks
          // open the target group via the same openGroupKey state.
          <StaffGroupAccordion
            openKey={openGroupKey}
            setOpenKey={setOpenGroupKey}
            topicsByKey={topicsByKey}
            snippetsByToken={snippetsByToken}
          />
        ) : (
          // Staff view — keep everything expanded.
          PARTNER_GROUPS.map(g => (
            <section key={g.key} id={`group:${g.key}`} className="scroll-mt-24">
              <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-wm-text-muted mb-2 px-1">
                {g.label}
              </h2>
              <div className="space-y-3">
                {g.buckets.map(b => (
                  <BucketBlock
                    key={b.key}
                    bucket={b}
                    topicsByKey={topicsByKey}
                    snippetsByToken={snippetsByToken}
                    reviewMode={false}
                    marks={marks}
                    saveMark={saveMark}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
    </ExternalPrefillContext.Provider>
    </AttachmentContext.Provider>
  )
}

// ── Partner-facing review accordion ──────────────────────────────────
//
// Each section renders as a collapsible card. One open at a time by
// default (first section), but every header is clickable so partners
// can jump ahead. No per-section "approve" buttons — implicit approval
// via edits. Partners signal updates by editing the form fields inside
// each section; the Continue button at the bottom of Step 1 moves them
// to Step 2 when ready.

function ReviewAccordion({
  openKey, setOpenKey, topicsByKey, snippetsByToken, marks, saveMark,
}: {
  openKey:          string | null
  setOpenKey:       (key: string | null) => void
  topicsByKey:      Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
}) {
  // Some churches roll groups + baptism INTO their next-steps
  // pathway (Mission Viejo, etc.) so we'd be double-asking by
  // showing standalone small_groups / baptism buckets. Detect by
  // scanning the next_steps topic's items for group / baptism-shaped
  // program names; when present, drop the standalone buckets.
  const filteredGroups = useMemo(() => {
    const ns = topicsByKey.get('next_steps')
    const nsNames = (ns?.items ?? []).map(it => {
      const r = it as Record<string, unknown>
      return String(r.name ?? r.title ?? r.label ?? '').toLowerCase()
    })
    const nsCoversGroups  = nsNames.some(n => /\b(life\s*group|small\s*group|community\s*group|connect\s*group)\b/.test(n))
    const nsCoversBaptism = nsNames.some(n => /bapti[sz]/.test(n))
    if (!nsCoversGroups && !nsCoversBaptism) return PARTNER_GROUPS
    return PARTNER_GROUPS
      .map(g => ({
        ...g,
        buckets: g.buckets.filter(b => {
          if (b.key === 'small_groups' && nsCoversGroups)  return false
          if (b.key === 'baptism'      && nsCoversBaptism) return false
          return true
        }),
      }))
      .filter(g => g.buckets.length > 0)
  }, [topicsByKey])

  // Opening a group: set the key, then scroll its top into view on the
  // next frame so the partner lands at the section header — without
  // this, collapsing the prior section above shifts scroll position
  // and the user gets stranded mid-content / at the bottom.
  const scrollToGroup = (key: string) => {
    queueMicrotask(() => {
      const el = document.getElementById(`group:${key}`)
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }
  const onOpenGroup = (key: string) => {
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    scrollToGroup(key)
  }

  return (
    <>
      {filteredGroups.map((g, idx) => {
        const nextGroup = filteredGroups[idx + 1] ?? null
        return (
          <ReviewGroupAccordion
            key={g.key}
            group={g}
            isOpen={openKey === g.key}
            onToggle={() => onOpenGroup(g.key)}
            nextGroup={nextGroup}
            onGoToNext={nextGroup ? () => onOpenGroup(nextGroup.key) : undefined}
            topicsByKey={topicsByKey}
            snippetsByToken={snippetsByToken}
            marks={marks}
            saveMark={saveMark}
          />
        )
      })}
    </>
  )
}

function ReviewGroupAccordion({
  group, isOpen, onToggle, nextGroup, onGoToNext,
  topicsByKey, snippetsByToken, marks, saveMark,
}: {
  group:           import('../../../lib/webPartnerGroups').PartnerGroup
  isOpen:          boolean
  onToggle:        () => void
  /** The next group in the accordion, used to render a "Next" button
   *  at the bottom that closes this section and opens the next one. */
  nextGroup?:      import('../../../lib/webPartnerGroups').PartnerGroup | null
  onGoToNext?:     () => void
  topicsByKey:     Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
  marks?:          Map<string, Mark>
  saveMark?:       SaveMark
}) {
  return (
    <section
      id={`group:${group.key}`}
      className={`scroll-mt-24 rounded-2xl border bg-white border-lavender overflow-hidden transition-shadow ${isOpen ? 'shadow-sm' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 md:px-5 py-3 md:py-4 flex items-center justify-between gap-3 text-left hover:bg-black/[0.02] transition-colors"
        aria-expanded={isOpen}
      >
        <h2 className="font-serif italic text-xl text-deep-plum min-w-0">{group.label}</h2>
        {isOpen
          ? <ChevronUp size={18} className="text-purple-gray shrink-0" />
          : <ChevronDown size={18} className="text-purple-gray shrink-0" />}
      </button>
      {isOpen && (
        <div className="px-4 md:px-5 pb-4 md:pb-5 space-y-3 border-t border-lavender/50">
          <div className="pt-3 space-y-3">
            {group.buckets.map(b => (
              <BucketBlock
                key={b.key}
                bucket={b}
                topicsByKey={topicsByKey}
                snippetsByToken={snippetsByToken}
                reviewMode={true}
                marks={marks}
                saveMark={saveMark}
              />
            ))}
          </div>
          {nextGroup && onGoToNext && (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onGoToNext}
                className="inline-flex items-center gap-2 rounded-full bg-deep-plum text-white px-4 py-2 text-[13px] font-semibold hover:bg-primary-purple transition-colors"
              >
                Next: {nextGroup.label}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── Sticky TOC + active-topic action panel ───────────────────────────

interface TocEntry {
  groupKey:    string
  groupLabel:  string
  bucketKey:   string
  /** Bucket label is what the partner sees in the TOC and the active card. */
  label:       string
  domId:       string
  /** Short summary derived from all topics in this bucket (programs + key details). */
  summary:     string
}

function buildTocEntries(topicsByKey: Map<string, TopicRow>): TocEntry[] {
  const out: TocEntry[] = []
  for (const g of PARTNER_GROUPS) {
    for (const b of g.buckets) {
      const bucketTopics = b.topics.map(tk => topicsByKey.get(tk)).filter((t): t is TopicRow => !!t)
      if (bucketTopics.length === 0) continue
      const hasContent = bucketTopics.some(t => (t.items?.length ?? 0) > 0 || (t.passages?.length ?? 0) > 0)
      if (!hasContent) continue
      out.push({
        groupKey:   g.key,
        groupLabel: g.label,
        bucketKey:  b.key,
        label:      b.label,
        domId:      `bucket:${b.key}`,
        summary:    summarizeBucket(bucketTopics, b.programScope),
      })
    }
  }
  return out
}

function summarizeBucket(topics: TopicRow[], programScope?: 'local' | 'global'): string {
  const parts: string[] = []
  for (const topic of topics) {
    // Blog topic has no items — summarize by parent index labels so the
    // TOC reads "Articles · News · Resources" instead of empty.
    if (topic.topic_key === 'blog_news') {
      const sources = deriveBlogSources(topic)
      for (const s of sources.slice(0, 6)) parts.push(s.label)
      if (parts.length >= 6) break
      continue
    }
    for (const it of topic.items ?? []) {
      if (it.kind === 'program' && it.name) {
        if (programScope && it.scope !== programScope) continue
        parts.push(String(it.name))
      } else if (it.kind === 'detail' && it.label) {
        parts.push(String(it.label))
      }
      if (parts.length >= 6) break
    }
    if (parts.length >= 6) break
  }
  return parts.join(' · ')
}

function InventoryTOC({
  entries, reviewMode, marks, saveMark, onSelectGroup,
}: {
  entries:        TocEntry[]
  reviewMode:     boolean
  marks?:         Map<string, Mark>
  saveMark?:      SaveMark
  /** Set by InventoryView in review mode: opens the bucket's parent
   *  group BEFORE scrolling so the target exists in the DOM. */
  onSelectGroup?: (groupKey: string) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.domId ?? null)
  const lastIntersecting = useRef<string | null>(null)

  useEffect(() => {
    if (!entries.length) return
    const obs = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter(r => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          const id = visible[0].target.id
          if (id !== lastIntersecting.current) {
            lastIntersecting.current = id
            setActiveId(id)
          }
        }
      },
      { rootMargin: '-100px 0px -60% 0px', threshold: [0, 0.1, 0.5] },
    )
    for (const e of entries) {
      const el = document.getElementById(e.domId)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [entries])

  if (!entries.length) return null
  const active = entries.find(e => e.domId === activeId) ?? entries[0]
  const groupOrder: { key: string; label: string }[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (!seen.has(e.groupKey)) {
      seen.add(e.groupKey)
      groupOrder.push({ key: e.groupKey, label: e.groupLabel })
    }
  }
  const byGroup = (gk: string) => entries.filter(e => e.groupKey === gk)

  const handleJump = (entry: TocEntry) => {
    // Review-mode accordion: open the parent group first so the
    // target bucket exists in the DOM, then scroll once it's rendered.
    if (onSelectGroup) {
      onSelectGroup(entry.groupKey)
      // Defer scroll to next paint so the newly-opened section is
      // measurable. requestAnimationFrame chains twice — once for
      // the state commit, once for the layout.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.getElementById(entry.domId)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }))
      return
    }
    const el = document.getElementById(entry.domId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <aside className="hidden lg:block lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
      {/* Pure jump-navigation. The previous active-topic card with
          approve / needs-update / add-missing buttons was removed —
          approval is implicit (edits in the form == approval), so the
          sticky panel is now navigation only. */}
      <nav className={reviewMode
          ? 'bg-white border border-lavender rounded-2xl p-3'
          : 'bg-wm-bg-elevated border border-wm-border rounded-xl p-3'}>
        <p className={reviewMode
            ? 'text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-2 px-1'
            : 'text-[10px] uppercase tracking-widest font-bold text-wm-text-muted mb-2 px-1'}>
          Table of contents
        </p>
        <div className="space-y-3">
          {groupOrder.map(g => (
            <div key={g.key}>
              <p className={reviewMode
                  ? 'text-[11px] font-serif italic text-deep-plum mb-1 px-1'
                  : 'text-[11px] font-semibold text-wm-text mb-1 px-1'}>
                {g.label}
              </p>
              <ul className="space-y-0.5">
                {byGroup(g.key).map(e => {
                  const isActive = e.domId === activeId
                  return (
                    <li key={e.domId}>
                      <button
                        type="button"
                        onClick={() => handleJump(e)}
                        className={`w-full text-left text-[11px] px-2 py-1 rounded-md transition ${
                          isActive
                            ? (reviewMode ? 'bg-lavender-tint text-deep-plum font-bold' : 'bg-wm-accent-tint text-wm-text font-bold')
                            : (reviewMode ? 'text-purple-gray hover:bg-lavender-tint/40 hover:text-deep-plum' : 'text-wm-text-muted hover:bg-wm-bg-hover hover:text-wm-text')
                        }`}
                      >
                        <span className="truncate block">{e.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  )
}

// ── Bucket → topics ──────────────────────────────────────────────────

function BucketBlock({
  bucket, topicsByKey, snippetsByToken, reviewMode, marks, saveMark,
}: {
  bucket:           PartnerBucket
  topicsByKey:      Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
  reviewMode:       boolean
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
}) {
  // Gather topics in this bucket
  const topics = bucket.topics.map(k => topicsByKey.get(k)).filter((t): t is TopicRow => !!t)
  const hasContent = topics.some(t => (t.passages?.length ?? 0) > 0 || (t.items?.length ?? 0) > 0)
  const externalPrefillCtx = useExternalPrefillMap()

  // Partner-facing review now renders as a form (label + editable input
  // per baseline field, prefilled from the crawl). Branches early so
  // the staff-facing layout below stays unchanged.
  if (reviewMode) {
    return (
      <BucketReviewCard
        bucket={bucket}
        topics={topics}
        snippetsByToken={snippetsByToken}
        marks={marks}
        saveMark={saveMark}
      />
    )
  }

  // Staff-supplied or empty buckets show a compact card. When external
  // prefills (from discovery / account_progress) are available for
  // this bucket's baseline fields, render those as labeled rows so
  // staff sees the actual photo URL / mission text instead of just a
  // "Supplied during onboarding" pill.
  if (!hasContent && bucket.staffSupplied) {
    const externalRows: { label: string; value: string }[] = []
    const coverage = computeBaselineCoverage(bucket.key, topics)
    for (const c of coverage) {
      const v = externalPrefillCtx[`${bucket.key}/${c.field.key}`]
      if (v && v.trim()) externalRows.push({ label: c.field.label, value: v })
    }
    return (
      <article className={reviewMode ? 'bg-white/60 border border-dashed border-lavender rounded-xl px-4 py-3' : 'bg-wm-bg-elevated border border-dashed border-wm-border rounded-lg px-4 py-3'}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={reviewMode ? 'text-deep-plum font-semibold text-sm' : 'text-wm-text font-semibold text-[13px]'}>{bucket.label}</p>
            {bucket.helpText && <p className={reviewMode ? 'text-purple-gray text-xs mt-0.5' : 'text-wm-text-muted text-[11px] mt-0.5'}>{bucket.helpText}</p>}
          </div>
          <span className={reviewMode ? 'text-[10px] uppercase tracking-wider font-bold text-purple-gray bg-lavender-tint px-2 py-1 rounded-full' : 'text-[9px] uppercase tracking-widest font-bold text-wm-text-muted bg-wm-bg-hover px-2 py-1 rounded'}>
            Supplied during onboarding
          </span>
        </div>
        {externalRows.length > 0 && (
          <dl className="mt-2.5 space-y-1.5">
            {externalRows.map(r => (
              <div key={r.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 items-baseline">
                <dt className={reviewMode ? 'text-[10px] font-bold uppercase tracking-wider text-purple-gray' : 'text-[10px] font-bold uppercase tracking-wider text-wm-text-muted'}>
                  {r.label}
                </dt>
                <dd className={reviewMode ? 'text-[12px] text-deep-plum break-words whitespace-pre-line' : 'text-[12px] text-wm-text break-words whitespace-pre-line'}>
                  {/^https?:\/\//i.test(r.value)
                    ? <a href={r.value} target="_blank" rel="noopener noreferrer" className={reviewMode ? 'text-primary-purple hover:underline break-all' : 'text-wm-accent hover:underline break-all'}>{r.value}</a>
                    : r.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {reviewMode && saveMark && (
          <AddMissingButton bucketKey={bucket.key} groupLabel={bucket.label} saveMark={saveMark} marks={marks} />
        )}
      </article>
    )
  }
  if (!hasContent) {
    return (
      <article className={reviewMode ? 'bg-white border border-lavender rounded-xl px-4 py-3' : 'bg-wm-bg-elevated border border-wm-border rounded-lg px-4 py-3'}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={reviewMode ? 'text-deep-plum font-semibold text-sm' : 'text-wm-text font-semibold text-[13px]'}>{bucket.label}</p>
            <p className={reviewMode ? 'text-purple-gray text-xs mt-0.5' : 'text-wm-text-muted text-[11px] mt-0.5'}>Nothing found on the current site.</p>
          </div>
          {reviewMode && saveMark && <AddMissingButton bucketKey={bucket.key} groupLabel={bucket.label} saveMark={saveMark} marks={marks} />}
        </div>
        {/* Even with no crawl content, show the baseline scaffold so the
            partner sees what we always look for in this bucket. */}
        <div className="mt-3">
          <BaselineChecklist bucket={bucket} topics={[]} reviewMode={reviewMode} saveMark={saveMark} marks={marks} />
        </div>
      </article>
    )
  }

  const bucketPath = `bucket:${bucket.key}`
  const bucketMark = reviewMode ? marks?.get(bucketPath) ?? null : null

  return (
    <article
      id={bucketPath}
      className={reviewMode
        ? 'bg-white border border-lavender rounded-2xl overflow-hidden scroll-mt-24'
        : 'bg-wm-bg-elevated border border-wm-border rounded-xl overflow-hidden scroll-mt-24'}
    >
      <header className={reviewMode
          ? 'px-4 md:px-5 py-3 border-b border-lavender bg-lavender-tint/20'
          : 'px-4 py-3 border-b border-wm-border bg-wm-bg-hover/40'}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={reviewMode ? 'text-deep-plum font-semibold' : 'text-wm-text font-semibold text-[13px]'}>{bucket.label}</p>
            {bucket.helpText && (
              <p className={reviewMode ? 'text-purple-gray text-xs mt-0.5' : 'text-wm-text-muted text-[11px] mt-0.5'}>{bucket.helpText}</p>
            )}
          </div>
          {reviewMode && saveMark && (
            <StatusPicker
              current={bucketMark?.status ?? null}
              onPick={s => saveMark(bucketPath, 'topic_item', s, s === 'outdated' ? (bucketMark?.client_note ?? null) : null)}
            />
          )}
        </div>
        {reviewMode && saveMark && bucketMark?.status === 'outdated' && (
          <div className="mt-2">
            <MarkNoteBox path={bucketPath} kind="topic_item" marks={marks} saveMark={saveMark} />
          </div>
        )}
      </header>
      <div className={reviewMode ? 'p-4 md:p-5 space-y-6' : 'p-4 space-y-5'}>
        <BaselineChecklist bucket={bucket} topics={topics} reviewMode={reviewMode} saveMark={saveMark} marks={marks} />
        {topics.map(t => (
          <TopicCard
            key={t.topic_key}
            topic={t}
            programScope={bucket.programScope}
            snippetsByToken={snippetsByToken}
            reviewMode={reviewMode}
            bucketKey={bucket.key}
            marks={marks}
            saveMark={saveMark}
          />
        ))}
        {reviewMode && saveMark && (
          <AddMissingButton bucketKey={bucket.key} groupLabel={bucket.label} saveMark={saveMark} marks={marks} />
        )}
      </div>
    </article>
  )
}

// ── Partner-facing review form (one card per bucket) ─────────────────
//
// Each bucket renders as a small form: a header (label + helper text)
// then one row per baseline field. Each row has a label + an editable
// input prefilled with whatever value we extracted from the crawl.
// Edits autosave via `saveMark` (path `answer:<bucket>/<field>`,
// kind=topic_item, status=approved, client_note=value). Implicit
// approval — no per-section "Approve" button. Below the form, a
// collapsible "What we found on your current site" reveals the raw
// crawl evidence (passages + named items) as reference context.

/** Buckets where the found-on-site section is suppressed entirely
 *  in partner review mode. Sermons → the partner just needs to
 *  confirm livestream + archive URLs; raw sermon items would clutter.
 *  Events → individual event items aren't useful at the partner level
 *  (they belong on the live calendar). */
const HIDE_FOUND_ON_SITE = new Set(['sermons', 'events'])

function BucketReviewCard({
  bucket, topics, snippetsByToken, marks, saveMark,
}: {
  bucket:           PartnerBucket
  topics:           TopicRow[]
  snippetsByToken?: Map<string, SnippetRow>
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
}) {
  const coverage = computeBaselineCoverage(bucket.key, topics)
  // Always surface inventoried items beneath the form when they
  // exist. The raw passage quote rows that previously cluttered the
  // view are filtered out inside TopicCard via reviewMode now — the
  // structured items (programs, FAQs, staff, scripture, etc.) still
  // show, and the form prefills cover the rest.
  const hasInventory = topics.some(t => (t.items ?? []).length > 0)
  const showFoundOnSite = hasInventory && !HIDE_FOUND_ON_SITE.has(bucket.key)
  // Default open when there are NO form fields — the bucket is
  // entirely the found-on-site section in that case, so hiding it
  // behind a toggle would leave the card empty. Buckets that DO have
  // form fields keep the collapse default so partners see the form
  // first and can opt in to verify the inventory. Exception:
  // `small_groups` — its short form (2 fields) leaves plenty of room
  // for the crawl evidence and partners need it visible to answer
  // those fields well.
  const [foundOpen, setFoundOpen] = useState(
    coverage.length === 0 || bucket.key === 'small_groups'
  )

  // Empty-baseline + staff-supplied + no inventory → compact note
  // (e.g. Photos bucket when Brand Squad hasn't shipped anything yet).
  // Otherwise we always render the full card so the found-on-site
  // display below has somewhere to live.
  if (coverage.length === 0 && !hasInventory) {
    return (
      <article id={`bucket:${bucket.key}`} className="bg-white border border-lavender rounded-xl px-4 py-3 scroll-mt-24">
        <p className="text-deep-plum font-semibold text-sm">{bucket.label}</p>
        {bucket.staffSupplied && (
          <p className="mt-2 text-[11px] uppercase tracking-wider font-bold text-primary-purple">
            Supplied during onboarding
          </p>
        )}
        {marks && (
          <PartnerAddedList bucketKey={bucket.key} marks={marks} saveMark={saveMark} />
        )}
        {saveMark && <AddMissingButton bucketKey={bucket.key} groupLabel={bucket.label} saveMark={saveMark} marks={marks} />}
      </article>
    )
  }

  // Bucket-level omit. Partners can drop this whole card from the new
  // site — surfaces a "Skip this on the new site" toggle in the header.
  // When omitted the card collapses to header + restore affordance and
  // downstream pipelines (atomizer, prompt builder, sitemap) read the
  // bucket:<key> mark to exclude this bucket entirely.
  const bucketPath = `bucket:${bucket.key}`
  const isOmitted = (marks?.get(bucketPath)?.status ?? null) === 'omit'

  return (
    <article
      id={bucketPath}
      className={`bg-white border rounded-2xl overflow-hidden scroll-mt-24 transition-opacity ${
        isOmitted ? 'border-purple-gray/30 opacity-70' : 'border-lavender'
      }`}
    >
      <header className={`px-4 md:px-5 py-3 border-b ${
        isOmitted ? 'border-purple-gray/20 bg-cream/60' : 'border-lavender bg-lavender-tint/20'
      }`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`font-semibold ${isOmitted ? 'text-purple-gray line-through' : 'text-deep-plum'}`}>
              {bucket.label}
            </p>
          </div>
          {saveMark && (
            <OmitToggle
              isOmitted={isOmitted}
              onOmit={() => saveMark(bucketPath, 'topic_item', 'omit', null)}
              onRestore={() => saveMark(bucketPath, 'topic_item', 'approved', null)}
            />
          )}
        </div>
      </header>
      {isOmitted ? (
        <div className="px-4 md:px-5 py-3 text-[12.5px] text-purple-gray italic">
          We won't carry anything from <strong className="not-italic">{bucket.label.toLowerCase()}</strong> over to the new site. Click <strong className="not-italic text-deep-plum">Restore</strong> above to bring it back.
        </div>
      ) : (
      <div className="p-4 md:p-5 space-y-3">
        {coverage.map(c => (
          <BucketReviewField
            key={c.field.key}
            bucket={bucket}
            coverage={c}
            marks={marks}
            saveMark={saveMark}
          />
        ))}

        {/* "What we found on your site". Two render modes:
              • No form fields → no toggle. The bucket IS the
                inventory, so we render the topic cards directly.
              • Has form fields → collapsed toggle. Partner sees the
                form first; opening verifies the source content.
            Sermons + Events skip this section entirely (per
            HIDE_FOUND_ON_SITE). */}
        {showFoundOnSite && coverage.length === 0 && (
          <div className="space-y-3">
            {topics.map(t => (
              <TopicCard
                key={t.topic_key}
                topic={t}
                programScope={bucket.programScope}
                snippetsByToken={snippetsByToken}
                reviewMode={true}
                bucketKey={bucket.key}
                marks={marks}
                saveMark={saveMark}
              />
            ))}
          </div>
        )}
        {showFoundOnSite && coverage.length > 0 && (
          <div className="border-t border-lavender/60 pt-3">
            <button
              type="button"
              onClick={() => setFoundOpen(o => !o)}
              className="text-[11px] font-semibold text-primary-purple hover:underline inline-flex items-center gap-1"
              aria-expanded={foundOpen}
            >
              {foundOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {foundOpen ? 'Hide what we found on your site' : 'Show what we found on your site'}
            </button>
            {foundOpen && (
              <div className="mt-3 space-y-3">
                {topics.map(t => (
                  <TopicCard
                    key={t.topic_key}
                    topic={t}
                    programScope={bucket.programScope}
                    snippetsByToken={snippetsByToken}
                    reviewMode={true}
                    bucketKey={bucket.key}
                    marks={marks}
                    saveMark={saveMark}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* What you added — list every "Add something we missed" entry
            the partner has saved for this bucket so it stays visible
            after the form closes. Baseline-tied additions
            (`missing:bucket/baseline-...`) already surface inline next
            to their field via the "You added (N)" badge; this list is
            the standalone-addition surface. */}
        {marks && (
          <PartnerAddedList bucketKey={bucket.key} marks={marks} saveMark={saveMark} />
        )}

        {/* Add something we missed — always at the bottom of the
            bucket so the partner sees their content first, then has
            the affordance to flag anything we missed. */}
        {saveMark && (
          <AddMissingButton
            bucketKey={bucket.key}
            groupLabel={bucket.label}
            saveMark={saveMark}
            marks={marks}
          />
        )}
      </div>
      )}
    </article>
  )
}

/** Inline header-level toggle that flips a card between active and
 *  omitted. Partners hit "Skip this on the new site" to drop a card;
 *  the same control flips to "Restore" when omitted. Subtle — sits
 *  in the header opposite the bucket title. */
function OmitToggle({
  isOmitted, onOmit, onRestore,
}: { isOmitted: boolean; onOmit: () => void; onRestore: () => void }) {
  if (isOmitted) {
    return (
      <div className="inline-flex items-center gap-2 shrink-0">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-purple-gray bg-cream border border-purple-gray/30 rounded-full px-2 py-0.5">
          <EyeOff size={10} />
          Omitted
        </span>
        <button
          type="button"
          onClick={onRestore}
          className="text-[11px] font-semibold text-primary-purple hover:text-deep-plum underline-offset-2 hover:underline"
        >
          Restore
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOmit}
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-gray hover:text-deep-plum px-2.5 py-1 rounded-full border border-transparent hover:border-purple-gray/30 hover:bg-cream transition-colors"
      title="Drop this section from the new site"
    >
      <EyeOff size={11} />
      Skip on new site
    </button>
  )
}

/** List of partner-added entries for a bucket — surfaces the
 *  `proposed_program_name` + `client_note` from each non-baseline
 *  `missing:bucket/...` mark so the partner can see what they just
 *  saved. Without this, the AddMissingButton would close on save and
 *  the entry would visually disappear (the data is still saved, but
 *  the partner reads it as "Where did my note go?"). */
function PartnerAddedList({
  bucketKey, marks, saveMark,
}: {
  bucketKey: string
  marks:     Map<string, Mark>
  saveMark?: SaveMark
}) {
  // Standalone additions only — baseline-tied ones render their
  // "You added" badge inline next to the matching field.
  const baselinePrefix = `missing:${bucketKey}/baseline-`
  const bucketPrefix   = `missing:${bucketKey}/`
  const entries: Array<{ path: string; mark: Mark }> = []
  for (const [path, mark] of marks) {
    if (!path.startsWith(bucketPrefix)) continue
    if (path.startsWith(baselinePrefix)) continue
    // After "Remove" the row stays in the DB (we don't support hard
    // delete) but we null out the proposed name — filter those out so
    // they disappear from the list.
    const hasName = mark.proposed_program_name?.trim()
    const hasNote = (mark.client_note ?? mark.proposed_program_description ?? '').trim()
    if (!hasName && !hasNote) continue
    entries.push({ path, mark })
  }
  if (entries.length === 0) return null

  return (
    <div className="border-t border-lavender/60 pt-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 mb-2">
        You added ({entries.length})
      </p>
      <ul className="space-y-2">
        {entries.map(({ path, mark }) => {
          const name = mark.proposed_program_name?.trim() || '(unnamed)'
          const note = (mark.client_note ?? mark.proposed_program_description ?? '').trim()
          return (
            <li
              key={path}
              className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-deep-plum">{name}</p>
                {saveMark && (
                  <button
                    type="button"
                    onClick={async () => {
                      // Soft-delete: clear the proposed name + note
                      // so the filter above drops this row. We don't
                      // hard-delete to keep audit history.
                      await saveMark(path, 'missing_program', 'approved_keep_as_is', null, {
                        proposed_program_name:        null,
                        proposed_program_description: null,
                      })
                    }}
                    className="text-[11px] text-emerald-700/70 hover:text-emerald-900 font-semibold"
                    title="Remove"
                  >
                    Remove
                  </button>
                )}
              </div>
              {note && (
                <div
                  className="text-[12px] text-deep-plum/85 mt-1 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: note }}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BucketReviewField({
  bucket, coverage, marks, saveMark,
}: {
  bucket:    PartnerBucket
  coverage:  BaselineCoverage
  marks?:    Map<string, Mark>
  saveMark?: SaveMark
}) {
  const answerPath = `answer:${bucket.key}/${coverage.field.key}`
  const existingMark = marks?.get(answerPath)
  // External prefill (e.g. photo library URL from discovery /
  // strategy_account_progress) wins over crawl extraction when set.
  const external = useExternalPrefill(bucket.key, coverage.field.key)
  const effectivePrefill = external ?? coverage.prefill ?? ''
  // Initial value priority: partner's saved answer > external prefill > crawl prefill > empty.
  const persisted = existingMark?.client_note ?? null
  const [value,  setValue]  = useState(persisted ?? effectivePrefill)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Re-sync if the mark changes externally (e.g. another tab saved).
  useEffect(() => {
    const next = existingMark?.client_note ?? effectivePrefill
    setValue(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingMark?.client_note, effectivePrefill])

  const save = async () => {
    if (!saveMark) return
    const trimmed = value.trim()
    // Don't save if value matches the prefill AND no partner edit exists yet
    // — implicit approval means "no edit needed."
    if (!persisted && trimmed === effectivePrefill.trim()) return
    if (persisted && trimmed === (persisted ?? '')) return
    setSaving(true)
    try {
      await saveMark(answerPath, 'topic_item', 'approved', trimmed || null)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  // Auto-size: 1 line for short, up to 6 for long.
  const lines = Math.max(1, Math.min(6, Math.ceil((value.length || 1) / 80)))
  const isLongField = value.length > 60 || (coverage.prefill?.length ?? 0) > 60
  const isRich = coverage.field.rich === true

  const labelAdornment = (saving || savedFlash) ? (
    <span className="text-[10px] inline-flex items-center gap-1">
      {saving && <Loader2 size={10} className="animate-spin text-purple-gray" />}
      {savedFlash && !saving && (
        <span className="text-emerald-700 inline-flex items-center gap-0.5">
          <CheckCircle2 size={10} /> Saved
        </span>
      )}
    </span>
  ) : null

  if (isRich) {
    return (
      <PartnerRichTextField
        label={coverage.field.label}
        labelAdornment={labelAdornment}
        minHeight={120}
      >
        <div onBlur={save}>
          <WMRichTextEditor
            value={value}
            onChange={setValue}
            placeholder={coverage.field.description}
            compact
          />
        </div>
      </PartnerRichTextField>
    )
  }
  if (isLongField) {
    return (
      <PartnerTextArea
        label={coverage.field.label}
        labelAdornment={labelAdornment}
        placeholder={coverage.field.description}
        value={value}
        onChange={setValue}
        onBlur={save}
        rows={lines}
      />
    )
  }
  return (
    <PartnerTextInput
      label={coverage.field.label}
      labelAdornment={labelAdornment}
      placeholder={coverage.field.description}
      value={value}
      onChange={setValue}
      onBlur={save}
    />
  )
}

// ── Baseline checklist (staff CrawlInventory only) ──────────────────
//
// Kept around for the staff-facing CrawlInventory view (non-review
// mode). Partner-facing review now uses BucketReviewCard above
// instead. The staff side still benefits from the at-a-glance
// "X of Y found" coverage scan.

function BaselineChecklist({
  bucket, topics, reviewMode, saveMark, marks,
}: {
  bucket:     PartnerBucket
  topics:     TopicRow[]
  reviewMode: boolean
  saveMark?:  SaveMark
  marks?:     Map<string, Mark>
}) {
  const coverage = computeBaselineCoverage(bucket.key, topics)
  if (coverage.length === 0) return null

  const filled = coverage.filter(c => c.filled).length
  const total  = coverage.length

  return (
    <section
      className={reviewMode
        ? 'rounded-xl border border-lavender bg-lavender-tint/30 p-3 md:p-4'
        : 'rounded-lg border border-wm-border bg-wm-bg-hover/40 p-3'}
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <p className={reviewMode
            ? 'text-[11px] uppercase tracking-widest font-bold text-primary-purple'
            : 'text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong'}>
          Required baseline fields
        </p>
        <p className={reviewMode
            ? 'text-xs font-semibold text-deep-plum'
            : 'text-[11px] font-semibold text-wm-text'}>
          {filled} of {total} found in crawl
        </p>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
        {coverage.map(c => (
          <BaselineFieldRow
            key={c.field.key}
            c={c}
            reviewMode={reviewMode}
            bucket={bucket}
            saveMark={saveMark}
            marks={marks}
          />
        ))}
      </ul>
      {filled < total && (
        <p className={reviewMode
            ? 'text-[11px] italic text-purple-gray mt-2'
            : 'text-[10px] italic text-wm-text-muted mt-2'}>
          Items marked needed weren&rsquo;t detected on your current site. If you have this info, send it to us — if it doesn&rsquo;t exist for you, just let your project lead know.
        </p>
      )}
    </section>
  )
}

function BaselineFieldRow({
  c, reviewMode, bucket, saveMark, marks,
}: {
  c:          BaselineCoverage
  reviewMode: boolean
  bucket:     PartnerBucket
  saveMark?:  SaveMark
  marks?:     Map<string, Mark>
}) {
  // Does the partner already have a baseline-tied addition for this
  // field? Look for any mark whose path matches the baseline prefix.
  const baselinePrefix  = `missing:${bucket.key}/baseline-${c.field.key}-`
  const partnerAddCount = marks
    ? Array.from(marks.keys()).filter(k => k.startsWith(baselinePrefix)).length
    : 0
  const addedByPartner = partnerAddCount > 0

  // Visual state: filled (auto-detected from crawl) > added (partner
  // supplied) > needed.
  const status: 'filled' | 'added' | 'needed' = c.filled
    ? 'filled'
    : (addedByPartner ? 'added' : 'needed')

  const Icon = status === 'needed' ? Circle : CheckCircle2
  const iconCls = status === 'filled'
    ? (reviewMode ? 'text-primary-purple shrink-0 mt-0.5' : 'text-emerald-600 shrink-0 mt-0.5')
    : status === 'added'
      ? (reviewMode ? 'text-emerald-600 shrink-0 mt-0.5' : 'text-emerald-600 shrink-0 mt-0.5')
      : (reviewMode ? 'text-purple-gray/60 shrink-0 mt-0.5' : 'text-wm-text-subtle shrink-0 mt-0.5')
  const labelCls = status === 'needed'
    ? (reviewMode ? 'text-sm text-purple-gray italic' : 'text-[12px] text-wm-text-muted italic')
    : (reviewMode ? 'text-sm font-semibold text-deep-plum' : 'text-[12px] font-semibold text-wm-text')

  const showAddAffordance = reviewMode && saveMark && status !== 'filled'

  return (
    <li className="flex items-start gap-2">
      <Icon size={reviewMode ? 14 : 12} className={iconCls} />
      <div className="min-w-0 flex-1">
        <p className={labelCls}>
          {c.field.label}
          {status === 'added' && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
              You added{partnerAddCount > 1 ? ` (${partnerAddCount})` : ''}
            </span>
          )}
        </p>
        <p className={reviewMode ? 'text-[11px] text-purple-gray' : 'text-[10px] text-wm-text-subtle'}>
          {c.field.description}
        </p>
        {showAddAffordance && (
          <AddMissingButton
            bucketKey={bucket.key}
            groupLabel={bucket.label}
            saveMark={saveMark}
            marks={marks}
            prefillField={c.field}
            compact
          />
        )}
      </div>
    </li>
  )
}

// ── Topic card ───────────────────────────────────────────────────────

function TopicCard({
  topic, programScope, snippetsByToken, reviewMode, bucketKey, marks, saveMark,
}: {
  topic:            TopicRow
  programScope?:    'local' | 'global'
  snippetsByToken?: Map<string, SnippetRow>
  reviewMode:       boolean
  /** When provided alongside `marks` + `saveMark`, enables per-item
   *  omit affordances inside the topic (e.g. drop a misclassified
   *  blog row before the partner sees it). Staff-side CrawlInventory
   *  passes these; partner-side passes them too so the partner can
   *  see the omitted state. */
  bucketKey?:       string
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
}) {
  // Partner's own site host — pulled from the `site_url` snippet the
  // crawl writes during fire-crawl-trigger. Used to demote same-domain
  // absolute CTAs (e.g. https://desertspringschurch.com/team) to
  // "internal" so they don't pollute the partner-facing inventory.
  const selfHost = useMemo(
    () => hostFromUrl(snippetsByToken?.get('site_url')?.expansion ?? ''),
    [snippetsByToken],
  )
  // Partition items by kind
  const { programs, details, faqs, keyPhrases, ctas, scriptures, sermons, events, staff, testimonies, newsletterIssues, contacts, locations, meetingTimes, otherItems } = useMemo(() => {
    const programs:   Item[]    = []
    const details:    Item[]    = []
    const faqs:       Item[]    = []
    const keyPhrases: Item[]    = []
    const ctas:       Item[]    = []
    const scriptures: Item[]    = []
    const sermons:    Item[]    = []
    const events:     Item[]    = []
    const staff:      Item[]    = []
    const testimonies: Item[]   = []
    const newsletterIssues: Item[] = []
    const contacts:    Item[]    = []
    const locations:   Item[]    = []
    const meetingTimes: Item[]   = []
    const otherItems: Item[]    = []
    for (const it of topic.items ?? []) {
      // In review mode, drop seasonal / one-off event items from
      // volunteer + event-shaped kinds so partners don't see e.g.
      // "Easter Egg Hunt Volunteers" treated as an ongoing role.
      // Restricted to those kinds — programs / ministries can
      // legitimately reference seasonal terms (e.g. "Christmas Eve
      // service") without being filtered.
      if (reviewMode && SEASONAL_FILTERED_KINDS.has(String(it.kind ?? '')) && looksSeasonal(it)) continue
      // Substance check — drop items that lack their primary content
      // field. The categorizer sometimes emits empty placeholders
      // (e.g. testimony items with no story, just `kind: 'testimony',
      // person: null`); the partner doesn't need to see "92
      // Anonymous testimonies" of empty quotes. Concrete case seen
      // on baysidechurch.net 2026-06-08 inventory.
      if (!hasSubstance(it)) continue
      switch (it.kind) {
        case 'program':           if (!programScope || it.scope === programScope) programs.push(it); break
        case 'detail':            details.push(it); break
        case 'faq':               faqs.push(it); break
        case 'key_phrase':
        case 'tier':
        case 'doctrine':          keyPhrases.push(it); break
        case 'cta':
        case 'link':              if (!isBrokenCta(it) && (!reviewMode || isExternalCta(it, selfHost))) ctas.push(it); break
        case 'scripture':         scriptures.push(it); break
        case 'sermon':            sermons.push(it); break
        case 'event':             events.push(it); break
        case 'staff':             staff.push(it); break
        case 'testimony':         testimonies.push(it); break
        case 'newsletter_issue':  newsletterIssues.push(it); break
        case 'contact_block':     contacts.push(it); break
        case 'location_info':     locations.push(it); break
        case 'meeting_time':      meetingTimes.push(it); break
        default:                  otherItems.push(it)
      }
    }
    return {
      programs, details, faqs, keyPhrases,
      // Dedupe CTAs by destination URL (case-insensitive). "Get
      // Directions" can appear once as a header CTA and again in a
      // section card pointing at the same Google Maps link — only
      // one should surface. CTAs to DIFFERENT urls stay distinct.
      ctas:  dedupeByKey(ctas, c => String(c.url ?? '').trim().toLowerCase() || `__${(c.label ?? '')}`),
      scriptures, sermons, events, staff, testimonies, newsletterIssues,
      contacts, locations, meetingTimes, otherItems,
    }
  }, [topic.items, programScope, reviewMode, selfHost])

  // Snippets tied to this topic (label-value Details)
  const topicSnippets = useMemo(() => {
    if (!snippetsByToken) return []
    return (topic.added_snippet_tokens ?? [])
      .map(tok => snippetsByToken.get(tok))
      .filter((s): s is SnippetRow => !!s)
      .filter(s => !isBrokenSnippet(s.expansion))
  }, [topic.added_snippet_tokens, snippetsByToken])

  // Build de-duped Details: details items + snippets + topic-level
  // contact_block / location_info / meeting_time, collapsed by value.
  const consolidatedDetails = useMemo(() => {
    const faqQAs = new Set<string>()
    for (const f of faqs) {
      faqQAs.add(normValue(String(f.question ?? '')))
      faqQAs.add(normValue(String(f.answer ?? '')))
    }
    const extras: { label: string; value: string }[] = []
    for (const s of topicSnippets) extras.push({ label: s.label || s.token, value: s.expansion })
    for (const c of contacts) {
      const lbl = String(c.label ?? '').trim()
      if (c.email) extras.push({ label: lbl || 'Email', value: String(c.email) })
      if (c.phone) extras.push({ label: lbl || 'Phone', value: String(c.phone) })
    }
    for (const l of locations) {
      const lbl = String(l.label ?? '').trim()
      if (l.address) extras.push({ label: lbl || 'Address', value: String(l.address) })
    }
    for (const mt of meetingTimes) {
      const audience = mt.audience ? ` (${String(mt.audience)})` : ''
      const where    = mt.location ? ` · ${String(mt.location)}` : ''
      if (mt.when) extras.push({ label: 'Meets', value: `${String(mt.when)}${where}${audience}` })
    }
    return consolidateLabeledValues(details, extras, faqQAs)
  }, [details, topicSnippets, contacts, locations, meetingTimes, faqs])

  // Blog topic: every URL is usually one post. Roll children up under
  // their parent index (/articles, /blog, /news, /news-media, ...) so
  // the partner sees blog SOURCES, not an arbitrary post elevated as
  // "the blog." Computed only for the blog_news topic.
  const isBlogTopic = topic.topic_key === 'blog_news'
  const blogSources = useMemo(
    () => (isBlogTopic ? deriveBlogSources(topic) : ([] as BlogSource[])),
    [isBlogTopic, topic],
  )

  // Programs + staff records already surface their own bio/about text.
  // Drop topic-level passages whose information is already covered by
  // structured content (program description / passages / detail labels +
  // values / meeting_time / cta labels / staff bios). Uses word-set
  // overlap so "Lunch and child care are always provided" (passage)
  // matches "Lunch provided Child care provided: Yes" (detail).
  const dedupedPassages = useMemo(() => {
    if ((topic.passages?.length ?? 0) === 0) return [] as Passage[]
    const structuredWords = new Set<string>()
    const ingest = (s: string) => {
      for (const w of String(s ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length >= 4) structuredWords.add(w)
      }
    }
    for (const p of programs) {
      if (p.name) ingest(String(p.name))
      if (p.description) ingest(String(p.description))
      const pPassages = Array.isArray(p.passages) ? (p.passages as Array<string | Passage>) : []
      for (const pp of pPassages) ingest(typeof pp === 'string' ? pp : (pp.text ?? ''))
      const items = Array.isArray(p.items) ? (p.items as Item[]) : []
      for (const it of items) {
        if (it.kind === 'detail') { ingest(String(it.label ?? '')); ingest(String(it.value ?? '')) }
        if (it.kind === 'meeting_time') { ingest(String(it.when ?? '')); ingest(String(it.location ?? '')); ingest(String(it.audience ?? '')) }
        if (it.kind === 'cta' || it.kind === 'link') ingest(String(it.label ?? ''))
        if (it.kind === 'faq') { ingest(String(it.question ?? '')); ingest(String(it.answer ?? '')) }
      }
    }
    for (const s of staff) {
      if (s.bio) ingest(String(s.bio))
      if (s.name) ingest(String(s.name))
    }
    if (structuredWords.size === 0) return topic.passages

    return topic.passages.filter(p => {
      const passageWords = new Set<string>()
      for (const w of (p.text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length >= 4) passageWords.add(w)
      }
      // Drop very short fluff fragments ("We can't wait!" etc)
      if (passageWords.size < 3) return false
      // Drop if 70%+ of distinctive words are already in structured content
      let inStruct = 0
      for (const w of passageWords) if (structuredWords.has(w)) inStruct++
      return inStruct / passageWords.size < 0.7
    })
  }, [topic.passages, programs, staff])

  // Dedup kind=staff items:
  //   (1) exact-name merge (keep the richest record)
  //   (2) bio-content overlap merge — when "Brad Davis", "Becky Davis",
  //       and "Brad & Becky Davis" all carry the same 90%-overlap bio,
  //       collapse to the joint listing (or the richest entry if none).
  const dedupedStaff = useMemo(() => dedupStaffRecords(staff), [staff])

  // Dedup programs whose content is a subset of another program in the
  // same topic — e.g. a minimal "Lead Pastors" record alongside the rich
  // "Pastors Brad and Becky Davis" dossier.
  const dedupedPrograms = useMemo(() => dedupSubsetPrograms(programs), [programs])

  const titleCls = reviewMode ? 'font-serif italic text-lg text-deep-plum' : 'text-wm-text font-semibold text-[15px]'

  return (
    <article
      data-topic-key={topic.topic_key}
      data-topic-label={topic.topic_label}
      className={reviewMode ? '' : 'border-l-2 border-wm-accent/30 pl-3'}
    >
      <h3 className={titleCls}>{topic.topic_label}</h3>

      {/* Voice — internal-facing only. Partners shouldn't see the raw
          voice signal (it's our internal interpretation, not their
          submitted content). Staff still see it in non-review mode. */}
      {topic.voice_signal && !reviewMode && (
        <Section reviewMode={reviewMode} icon={Mic2} title="Voice">
          <p className={reviewMode ? 'text-sm text-deep-plum leading-relaxed' : 'text-[12px] text-wm-text leading-relaxed'}>
            {topic.voice_signal}
          </p>
        </Section>
      )}

      {/* Blog sources — for blog_news, group all crawled URLs by their
          parent index path (/articles, /blog, /news, ...) so a single
          post can't masquerade as the blog itself. Replaces the noisy
          per-post passage rows that used to render here.

          Per-row omit (staff-side cleanup): when bucketKey + marks +
          saveMark are passed, each row carries a Skip button that
          writes `item:<bucket>/<source-key>` mark. On the partner
          side (reviewMode=true), omitted rows are filtered before
          render so the partner never sees a misclassified row. */}
      {isBlogTopic && blogSources.length > 0 && (() => {
        const visibleSources = bucketKey && marks && reviewMode
          ? blogSources.filter(s => marks.get(`item:${bucketKey}/${s.key}`)?.status !== 'omit')
          : blogSources
        if (visibleSources.length === 0) return null
        return (
          <Section reviewMode={reviewMode} icon={Newspaper} title={`Blog sources (${visibleSources.length})`}>
            <div className="space-y-2">
              {visibleSources.map(s => (
                <BlogSourceRow
                  key={s.key}
                  source={s}
                  reviewMode={reviewMode}
                  bucketKey={bucketKey}
                  marks={marks}
                  saveMark={saveMark}
                />
              ))}
            </div>
          </Section>
        )
      })()}

      {/* Details — consolidated detail items + snippets + passages.
          Raw passages (PassageRow) are hidden in reviewMode because
          they were the noisy "/url/  ·  ‘quoted text’" rows that
          didn't map to any baseline field. The values that DO matter
          already feed the form prefills via baseline extractors. For
          blog_news, individual-post passages are also hidden — the
          BlogSourcesSection above already accounts for those URLs. */}
      {/* Details — split top-level (ministry-wide facts) from weekly
          lesson cruft. The categorizer doesn't distinguish "Service
          Times" (ministry-wide) from "Lesson Date / Memory Verse /
          Character Trait Theme / Week 4" (one specific weekly resource)
          when both appear on the same crawled page; both land as
          kind='detail' at the topic root and clutter the inventory.
          We partition by label here so the lesson-week stuff collapses
          into a sub-section and the partner sees the ministry-level
          facts cleanly. */}
      {(() => {
        if (isBlogTopic) return null
        const topLevelDetails = consolidatedDetails.filter(d => !isWeeklyLessonDetail(d))
        const weeklyDetails   = consolidatedDetails.filter(d =>  isWeeklyLessonDetail(d))
        if (topLevelDetails.length === 0 && weeklyDetails.length === 0 && (reviewMode || dedupedPassages.length === 0)) return null
        return (
          <DetailsGroupEditScope
            reviewMode={reviewMode}
            canEdit={!!bucketKey && !!saveMark}
            topLevelDetails={topLevelDetails}
            weeklyDetails={weeklyDetails}
            dedupedPassages={dedupedPassages}
            bucketKey={bucketKey}
            topicKey={topic.topic_key}
            marks={marks}
            saveMark={saveMark}
          />
        )
      })()}

      {/* Programs — split true ministry programs from weekly resources.
          Crawl-extracted "Elementary // Contentment Week 2 Resource"
          and similar should NOT sit alongside actual programs like
          "Youth Group" or "Kids Wednesdays". We detect resource-shaped
          names and collapse them. */}
      {dedupedPrograms.length > 0 && (() => {
        const realPrograms     = dedupedPrograms.filter(p => !isWeeklyResourceProgram(p))
        const resourcePrograms = dedupedPrograms.filter(p =>  isWeeklyResourceProgram(p))
        return (
          <Section reviewMode={reviewMode} icon={Sparkles} title={`Programs (${realPrograms.length})`}>
            {realPrograms.length > 0 && (
              <div className="space-y-3">
                {realPrograms.map((p, i) => (
                  <ProgramDossier
                    key={`prog-${i}`}
                    program={p}
                    reviewMode={reviewMode}
                    selfHost={selfHost}
                    bucketKey={bucketKey}
                    topicKey={topic.topic_key}
                    marks={marks}
                    saveMark={saveMark}
                  />
                ))}
              </div>
            )}
            {resourcePrograms.length > 0 && (
              <div className={realPrograms.length > 0 ? 'mt-3' : ''}>
                <CollapsibleSubsection
                  reviewMode={reviewMode}
                  title={`Ministry resources (${resourcePrograms.length})`}
                  hint="Weekly lesson resources, dated material, and per-session pages crawled in. These usually don't belong as standalone programs — skim and skip if outdated."
                >
                  <div className="space-y-3">
                    {resourcePrograms.map((p, i) => (
                      <ProgramDossier
                        key={`res-${i}`}
                        program={p}
                        reviewMode={reviewMode}
                        selfHost={selfHost}
                        bucketKey={bucketKey}
                        topicKey={topic.topic_key}
                        marks={marks}
                        saveMark={saveMark}
                      />
                    ))}
                  </div>
                </CollapsibleSubsection>
              </div>
            )}
          </Section>
        )
      })()}

      {/* FAQs */}
      {faqs.length > 0 && (
        <Section reviewMode={reviewMode} icon={HelpCircle} title={`FAQs (${faqs.length})`}>
          <div className="space-y-2">
            {faqs.map((f, i) => (
              <FaqRow
                key={`f-${i}`}
                item={f}
                reviewMode={reviewMode}
                bucketKey={bucketKey}
                topicKey={topic.topic_key}
                marks={marks}
                saveMark={saveMark}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Key Phrases — hidden for blog_news (per-article highlights are
          already accounted for in BlogSourcesSection above). */}
      {!isBlogTopic && keyPhrases.length > 0 && (
        <Section reviewMode={reviewMode} icon={Hash} title={`Key Phrases (${keyPhrases.length})`}>
          <div className="space-y-2">
            {keyPhrases.map((k, i) => <KeyPhraseRow key={`k-${i}`} item={k} reviewMode={reviewMode} />)}
          </div>
        </Section>
      )}

      {/* CTAs */}
      {ctas.length > 0 && (
        <Section reviewMode={reviewMode} icon={ArrowRight} title={`CTAs & Links (${ctas.length})`}>
          <div className="space-y-1.5">
            {ctas.map((c, i) => <CtaRow key={`c-${i}`} item={c} reviewMode={reviewMode} />)}
          </div>
        </Section>
      )}

      {/* Scripture */}
      {scriptures.length > 0 && (
        <Section reviewMode={reviewMode} icon={BookOpen} title={`Scripture (${scriptures.length})`}>
          <div className="space-y-2">
            {scriptures.map((s, i) => <ScriptureRow key={`s-${i}`} item={s} reviewMode={reviewMode} />)}
          </div>
        </Section>
      )}

      {/* Fact-rich kinds */}
      {sermons.length > 0 && (
        <Section reviewMode={reviewMode} icon={ListChecks} title={`Sermons (${sermons.length})`}>
          <div className="space-y-2">{sermons.map((it, i) => <GenericRecordRow key={`sm-${i}`} item={it} reviewMode={reviewMode} primary="title" />)}</div>
        </Section>
      )}
      {events.length > 0 && (
        <Section reviewMode={reviewMode} icon={Calendar} title={`Events (${events.length})`}>
          <div className="space-y-2">{events.map((it, i) => <GenericRecordRow key={`ev-${i}`} item={it} reviewMode={reviewMode} primary="name" />)}</div>
        </Section>
      )}
      {dedupedStaff.length > 0 && (() => {
        // Editable mode requires marks + saveMark + bucketKey wired up
        // (staff side of CrawlInventory + partner side of content
        // collection both pass these now). When all three present,
        // render each staff entry as an EditableStaffCard with inline
        // edits + Remove. Otherwise fall back to the read-only
        // GenericRecordRow so legacy view paths still work.
        const editable = bucketKey && marks && saveMark
        // Hide omitted staff from partner view; staff side keeps them
        // muted with a Restore affordance handled inside the card.
        const visible = editable && reviewMode
          ? dedupedStaff.filter(it => {
              const slug = slugify(String(it.name ?? it.title ?? '')) || ''
              if (!slug) return true
              return marks!.get(`item:${bucketKey}/${topic.topic_key}/${slug}`)?.status !== 'omit'
            })
          : dedupedStaff
        if (visible.length === 0) return null
        return (
          <Section reviewMode={reviewMode} icon={ListChecks} title={`Staff (${visible.length})`}>
            <div className="space-y-2">
              {visible.map((it, i) => editable
                ? <EditableStaffCard
                    key={`st-${i}`}
                    item={it}
                    bucketKey={bucketKey!}
                    topicKey={topic.topic_key}
                    marks={marks!}
                    saveMark={saveMark!}
                    reviewMode={reviewMode}
                  />
                : <GenericRecordRow key={`st-${i}`} item={it} reviewMode={reviewMode} primary="name" />,
              )}
            </div>
          </Section>
        )
      })()}
      {testimonies.length > 0 && (
        <Section reviewMode={reviewMode} icon={Quote} title={`Testimonies (${testimonies.length})`}>
          <div className="space-y-2">{testimonies.map((it, i) => <TestimonyRow key={`t-${i}`} item={it} reviewMode={reviewMode} />)}</div>
        </Section>
      )}
      {newsletterIssues.length > 0 && (
        <Section reviewMode={reviewMode} icon={ListChecks} title={`Newsletter Issues (${newsletterIssues.length})`}>
          <div className="space-y-2">{newsletterIssues.map((it, i) => <GenericRecordRow key={`n-${i}`} item={it} reviewMode={reviewMode} primary="title" />)}</div>
        </Section>
      )}
      {!isBlogTopic && otherItems.length > 0 && (
        <Section reviewMode={reviewMode} icon={ListChecks} title={`Other (${otherItems.length})`}>
          <div className="space-y-2">{otherItems.map((it, i) => <GenericRecordRow key={`o-${i}`} item={it} reviewMode={reviewMode} />)}</div>
        </Section>
      )}

      {/* Sources — hidden for blog_news; BlogSourcesSection already
          lists every URL under its parent. */}
      {!isBlogTopic && topic.source_page_urls.length > 0 && (
        <details className="mt-3">
          <summary className={reviewMode
              ? 'cursor-pointer text-[11px] uppercase tracking-widest font-bold text-purple-gray hover:text-deep-plum'
              : 'cursor-pointer text-[10px] uppercase tracking-widest font-bold text-wm-text-muted hover:text-wm-text'}>
            Source pages ({topic.source_page_urls.length})
          </summary>
          <ul className="mt-1.5 space-y-0.5 pl-3">
            {topic.source_page_urls.map(u => (
              <li key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer"
                   className={reviewMode
                     ? 'text-[11px] font-mono text-primary-purple hover:underline inline-flex items-center gap-0.5'
                     : 'text-[10px] font-mono text-wm-accent hover:underline inline-flex items-center gap-0.5'}>
                  {pathOnly(u)} <ExternalLink size={9} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

// ── Top-level Details section with group-edit scope ──────────────────
//
// Wraps the Details Section + its rows in a GroupEditScope so the
// section header carries a single Edit / Save all / Cancel cluster.
// Children rows (ConsolidatedDetailRow) read `editing` from the
// GroupEditContext and switch between read-only and input modes in
// sync.
function DetailsGroupEditScope({
  reviewMode, canEdit, topLevelDetails, weeklyDetails, dedupedPassages,
  bucketKey, topicKey, marks, saveMark,
}: {
  reviewMode:      boolean
  canEdit:         boolean
  topLevelDetails: ConsolidatedEntry[]
  weeklyDetails:   ConsolidatedEntry[]
  dedupedPassages: Passage[]
  bucketKey?:      string
  topicKey:        string
  marks?:          Map<string, Mark>
  saveMark?:       SaveMark
}) {
  const scope = useGroupEditState()
  // Force-open the lesson-details accordion while editing so the
  // Save-all button reaches the rows inside.
  const forceOpenWeekly = scope.editing
  return (
    <GroupEditContext.Provider value={scope.contextValue}>
      <Section
        reviewMode={reviewMode}
        icon={ClipboardList}
        title="Details"
        headerExtra={reviewMode ? <GroupEditToolbar scope={scope} canEdit={canEdit} /> : null}
      >
        {topLevelDetails.length > 0 && (
          <div className="space-y-2">
            {topLevelDetails.map((d, i) => (
              <ConsolidatedDetailRow
                key={`d-${i}`}
                entry={d}
                reviewMode={reviewMode}
                bucketKey={bucketKey}
                topicKey={topicKey}
                marks={marks}
                saveMark={saveMark}
              />
            ))}
          </div>
        )}
        {weeklyDetails.length > 0 && (
          <CollapsibleSubsection
            reviewMode={reviewMode}
            title={`Weekly lesson details (${weeklyDetails.length})`}
            hint="Date-stamped lesson info crawled from one specific weekly resource page. Usually safe to skim — fix or skip in bulk."
            forceOpen={forceOpenWeekly}
          >
            <div className="space-y-2">
              {weeklyDetails.map((d, i) => (
                <ConsolidatedDetailRow
                  key={`wd-${i}`}
                  entry={d}
                  reviewMode={reviewMode}
                  bucketKey={bucketKey}
                  topicKey={topicKey}
                  marks={marks}
                  saveMark={saveMark}
                />
              ))}
            </div>
          </CollapsibleSubsection>
        )}
        {!reviewMode && dedupedPassages.length > 0 && (
          <div className={(topLevelDetails.length + weeklyDetails.length > 0 ? 'mt-3' : '') + ' space-y-2'}>
            {dedupedPassages.map((p, i) => <PassageRow key={`p-${i}`} passage={p} reviewMode={reviewMode} />)}
          </div>
        )}
      </Section>
    </GroupEditContext.Provider>
  )
}

// ── Section wrapper (with optional review pill) ──────────────────────

function Section({
  reviewMode, icon: Icon, title, headerExtra, children,
}: {
  reviewMode:   boolean
  icon:         typeof Mic2
  title:        string
  /** Optional right-aligned element in the section header (e.g. a
   *  GroupEditToolbar for partner-facing edit affordances). */
  headerExtra?: React.ReactNode
  children:     React.ReactNode
}) {
  return (
    <div className={reviewMode ? 'mt-4' : 'mt-3'}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={12} className={reviewMode ? 'text-primary-purple' : 'text-wm-accent'} />
        <p className={reviewMode
            ? 'text-[10px] uppercase tracking-widest font-bold text-primary-purple'
            : 'text-[10px] uppercase tracking-widest font-bold text-wm-accent'}>
          {title}
        </p>
        {headerExtra && <div className="ml-auto">{headerExtra}</div>}
      </div>
      {children}
    </div>
  )
}

function MarkNoteBox({
  path, kind, marks, saveMark,
}: {
  path:     string
  kind:     'topic_item' | 'program'
  marks?:   Map<string, Mark>
  saveMark: SaveMark
}) {
  const [v, setV] = useState(marks?.get(path)?.client_note ?? '')
  const empty = !v.trim()
  return (
    <div className="mb-2">
      <label className="block text-[11px] font-bold text-amber-700 mb-1">
        What needs updating? <span className="text-amber-600">*</span>
      </label>
      <textarea
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => saveMark(path, kind, 'outdated', v)}
        placeholder="Tell us what's changed or what to fix — we need this to make the update."
        rows={2}
        className={`w-full text-sm border bg-white rounded-md px-3 py-2 text-deep-plum focus:outline-none focus:border-primary-purple ${empty ? 'border-amber-400 ring-1 ring-amber-200' : 'border-lavender'}`}
      />
      {empty && (
        <p className="text-[11px] text-amber-700 mt-1">Required — without this, we can't make the change.</p>
      )}
    </div>
  )
}

// ── Program dossier ──────────────────────────────────────────────────

function ProgramDossier({
  program, reviewMode, selfHost, bucketKey, topicKey, marks, saveMark,
}: {
  program:    Item
  reviewMode: boolean
  /** Partner's own site host. When set, CTAs pointing at this host
   *  are treated as internal and filtered out of partner-facing
   *  inventory. Sub-programs receive the same value. */
  selfHost?:  string
  /** When set with saveMark, the dossier hosts its own GroupEditScope
   *  so a single Edit button at the program header drives name +
   *  description + every nested editable row at once. */
  bucketKey?: string
  topicKey?:  string
  marks?:     Map<string, Mark>
  saveMark?:  SaveMark
}) {
  // Partner override paths for the program's name + description.
  const programSlug = slugify(String(program.name ?? '')).slice(0, 40) || 'unnamed'
  const programEditBase = bucketKey && topicKey
    ? `program-edit:${bucketKey}/${topicKey}/${programSlug}`
    : null
  const nameMark = programEditBase ? marks?.get(`${programEditBase}/name`) : undefined
  const descMark = programEditBase ? marks?.get(`${programEditBase}/description`) : undefined
  const origName = String(program.name ?? 'Untitled program')
  const origDesc = String(program.description ?? '')
  const name = (nameMark?.status === 'approved' && nameMark.client_note != null) ? nameMark.client_note : origName
  const desc = (descMark?.status === 'approved' && descMark.client_note != null) ? descMark.client_note : origDesc

  // Own group-edit scope per program. Independent of the topic-level
  // Details scope so the partner can edit one program at a time.
  const scope = useGroupEditState()
  const canEdit = reviewMode && !!programEditBase && !!saveMark

  // Local drafts for name + description, registered with the scope so
  // they save in the same batch as the nested rows.
  const [nameDraft, setNameDraft] = useState(name)
  const [descDraft, setDescDraft] = useState(desc)
  const nameDraftRef = useRef(nameDraft)
  const descDraftRef = useRef(descDraft)
  useEffect(() => { nameDraftRef.current = nameDraft }, [nameDraft])
  useEffect(() => { descDraftRef.current = descDraft }, [descDraft])
  useEffect(() => {
    if (!scope.editing) { setNameDraft(name); setDescDraft(desc) }
  }, [scope.editing, name, desc])

  useEffect(() => {
    if (!programEditBase || !saveMark) return
    return scope.contextValue.register(`${programEditBase}/header`, {
      commit: async () => {
        const nTrim = nameDraftRef.current.trim()
        const dTrim = descDraftRef.current.trim()
        await saveMark(`${programEditBase}/name`,        'topic_item', 'approved', nTrim === origName.trim() ? null : nTrim)
        await saveMark(`${programEditBase}/description`, 'topic_item', 'approved', dTrim === origDesc.trim() ? null : dTrim)
      },
      reset: () => { setNameDraft(name); setDescDraft(desc) },
    })
  }, [scope.contextValue, programEditBase, saveMark, origName, origDesc, name, desc])

  const headerEdited = (nameMark?.client_note != null) || (descMark?.client_note != null)

  const nestedItems = Array.isArray(program.items) ? (program.items as Item[]) : []
  const nestedPassages = Array.isArray(program.passages)
    ? (program.passages as Array<string | Passage>).map(p =>
        typeof p === 'string' ? { url: '', text: p } : { url: p.url, text: p.text })
    : []

  // Partition nested items
  const meetingTimes  = nestedItems.filter(i => i.kind === 'meeting_time')
  const locations     = nestedItems.filter(i => i.kind === 'location_info')
  const contacts      = nestedItems.filter(i => i.kind === 'contact_block')
  const programFaqs   = nestedItems.filter(i => i.kind === 'faq')
  const programCtas   = nestedItems
    .filter(i => i.kind === 'cta' || i.kind === 'link')
    .filter(i => !isBrokenCta(i) && (!reviewMode || isExternalCta(i, selfHost)))
  const programSteps  = nestedItems.filter(i => i.kind === 'step')
  const programScrips = nestedItems.filter(i => i.kind === 'scripture')
  const programTiers  = nestedItems.filter(i => i.kind === 'tier')
  const programKeyPhrases = nestedItems.filter(i => i.kind === 'key_phrase')
  const subPrograms   = nestedItems.filter(i => i.kind === 'program')
  const programFaqQAs = new Set<string>()
  for (const f of programFaqs) {
    programFaqQAs.add(normValue(String(f.question ?? '')))
    programFaqQAs.add(normValue(String(f.answer ?? '')))
  }
  const programDetailsRaw = nestedItems.filter(i => i.kind === 'detail')
  const programDetails = consolidateLabeledValues(programDetailsRaw, [], programFaqQAs)
  const handledKinds = new Set(['meeting_time','location_info','contact_block','faq','cta','link','step','scripture','tier','key_phrase','detail','program'])
  const programOther  = nestedItems.filter(i => !handledKinds.has(String(i.kind)))

  return (
    <GroupEditContext.Provider value={scope.contextValue}>
      <article className={reviewMode
          ? 'rounded-xl border border-primary-purple/20 bg-lavender-tint/15 p-4'
          : 'rounded-lg border border-wm-accent/20 bg-wm-accent-tint/15 p-3'}>
        {/* Program header — single Edit / Save all / Cancel cluster
            drives every editable field inside this card. Name +
            description flip to inputs in edit mode; nested details +
            FAQs flip in sync via GroupEditContext. */}
        <div className="flex items-start gap-2 flex-wrap">
          <Sparkles size={13} className={reviewMode ? 'text-primary-purple shrink-0 mt-1' : 'text-wm-accent shrink-0 mt-1'} />
          {scope.editing ? (
            <input
              type="text"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder="Program name"
              className={reviewMode
                ? 'flex-1 min-w-[180px] text-deep-plum font-bold text-base bg-white border border-primary-purple rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-purple/30'
                : 'flex-1 min-w-[180px] text-wm-text font-bold text-[13px] bg-wm-bg-elevated border border-wm-border-focus rounded px-2 py-0.5 focus:outline-none'}
            />
          ) : (
            <span className={reviewMode ? 'text-deep-plum font-bold text-base flex-1 min-w-0' : 'text-wm-text font-bold text-[13px] flex-1 min-w-0'}>
              {name}
              {headerEdited && (
                <span className={reviewMode
                    ? 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-primary-purple bg-lavender-tint border border-primary-purple/30 rounded-full px-1.5 py-0.5'
                    : 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-wm-accent bg-wm-accent-tint border border-wm-accent/30 rounded-full px-1.5 py-0.5'}>
                  Edited
                </span>
              )}
            </span>
          )}
          {program.audience  ? <Pill text={String(program.audience)}  reviewMode={reviewMode} /> : null}
          {program.duration  ? <Pill text={String(program.duration)}  reviewMode={reviewMode} /> : null}
          {program.scope     ? <Pill text={String(program.scope).toUpperCase()} reviewMode={reviewMode} /> : null}
          <GroupEditToolbar scope={scope} canEdit={canEdit} />
        </div>
        {program.tagline && (
          <p className={reviewMode ? 'text-sm italic text-primary-purple/80 mt-1' : 'text-[12px] italic text-wm-accent/80 mt-1'}>"{String(program.tagline)}"</p>
        )}

      {/* About */}
      {(desc || nestedPassages.length > 0 || scope.editing) && (
        <DossierSlot icon={ClipboardList} title="About" reviewMode={reviewMode}>
          {scope.editing ? (
            <textarea
              value={descDraft}
              rows={Math.max(2, Math.min(8, descDraft.split('\n').length + 1))}
              onChange={e => setDescDraft(e.target.value)}
              placeholder="What is this program? Who is it for?"
              className={reviewMode
                ? 'w-full text-sm text-deep-plum bg-white border border-primary-purple rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-purple/30 resize-y leading-snug'
                : 'w-full text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border-focus rounded px-2 py-1.5 focus:outline-none resize-y leading-snug'}
            />
          ) : (
            desc && <p className={reviewMode ? 'text-sm text-deep-plum leading-snug' : 'text-[12px] text-wm-text leading-snug'}>{desc}</p>
          )}
          {nestedPassages.map((p, i) => (
            <p key={i} className={reviewMode ? 'text-sm text-deep-plum/85 leading-snug mt-2 italic' : 'text-[12px] text-wm-text/85 leading-snug mt-2 italic'}>
              "{p.text}"
            </p>
          ))}
          {program.philosophy && (
            <p className={reviewMode ? 'text-xs text-purple-gray italic mt-2' : 'text-[11px] text-wm-text-muted italic mt-2'}>{String(program.philosophy)}</p>
          )}
        </DossierSlot>
      )}

      {programDetails.length > 0 && (
        <DossierSlot icon={ClipboardList} title="Details" reviewMode={reviewMode}>
          <div className="space-y-2">
            {programDetails.map((d, i) => (
              <ConsolidatedDetailRow
                key={`pd-${i}`}
                entry={d}
                reviewMode={reviewMode}
                bucketKey={bucketKey}
                topicKey={topicKey ? `${topicKey}/program-${slugify(String(program.name ?? '')).slice(0, 40) || 'unnamed'}` : undefined}
                marks={marks}
                saveMark={saveMark}
              />
            ))}
          </div>
        </DossierSlot>
      )}

      {meetingTimes.length > 0 && (
        <DossierSlot icon={Calendar} title="Meeting Times" reviewMode={reviewMode}>
          {meetingTimes.map((mt, i) => (
            <div key={i} className={reviewMode ? 'text-sm text-deep-plum' : 'text-[12px] text-wm-text'}>
              <strong>{String(mt.when ?? '')}</strong>
              {mt.location ? <span className="text-purple-gray"> · {String(mt.location)}</span> : null}
              {mt.audience ? <span className="text-purple-gray"> · {String(mt.audience)}</span> : null}
            </div>
          ))}
        </DossierSlot>
      )}

      {locations.length > 0 && (
        <DossierSlot icon={MapPin} title="Location" reviewMode={reviewMode}>
          {locations.map((l, i) => (
            <p key={i} className={reviewMode ? 'text-sm text-deep-plum' : 'text-[12px] text-wm-text'}>
              <strong>{String(l.address ?? '')}</strong>
              {l.label ? <span className="text-purple-gray"> · {String(l.label)}</span> : null}
            </p>
          ))}
        </DossierSlot>
      )}

      {contacts.length > 0 && (
        <DossierSlot icon={MessageCircle} title="Contact" reviewMode={reviewMode}>
          {contacts.map((c, i) => (
            <div key={i} className={reviewMode ? 'text-sm text-deep-plum' : 'text-[12px] text-wm-text'}>
              {c.label && <strong>{String(c.label)}: </strong>}
              {c.email && <a href={`mailto:${c.email}`} className={reviewMode ? 'text-primary-purple hover:underline' : 'text-wm-accent hover:underline'}>{String(c.email)}</a>}
              {c.email && c.phone && <span> · </span>}
              {c.phone && <span>{String(c.phone)}</span>}
            </div>
          ))}
        </DossierSlot>
      )}

      {programCtas.length > 0 && (
        <DossierSlot icon={ArrowRight} title="CTAs" reviewMode={reviewMode}>
          <div className="space-y-1">
            {programCtas.map((c, i) => <CtaRow key={i} item={c} reviewMode={reviewMode} />)}
          </div>
        </DossierSlot>
      )}

      {programSteps.length > 0 && (
        <DossierSlot icon={ListChecks} title="Steps" reviewMode={reviewMode}>
          <ol className="space-y-1 list-decimal list-inside">
            {programSteps.map((s, i) => (
              <li key={i} className={reviewMode ? 'text-sm text-deep-plum leading-snug' : 'text-[12px] text-wm-text leading-snug'}>
                <strong>{String(s.name ?? '')}</strong>
                {s.description ? <span className="text-purple-gray"> — {String(s.description)}</span> : null}
              </li>
            ))}
          </ol>
        </DossierSlot>
      )}

      {subPrograms.length > 0 && (
        <DossierSlot icon={Sparkles} title={`Sub-programs (${subPrograms.length})`} reviewMode={reviewMode}>
          <div className="space-y-2">
            {subPrograms.map((sp, i) => (
              <ProgramDossier key={`sp-${i}`} program={sp} reviewMode={reviewMode} selfHost={selfHost} />
            ))}
          </div>
        </DossierSlot>
      )}

      {programTiers.length > 0 && (
        <DossierSlot icon={ListChecks} title="Tiers" reviewMode={reviewMode}>
          <div className="space-y-2">
            {programTiers.map((t, i) => (
              <div key={i} className={reviewMode ? 'text-sm' : 'text-[12px]'}>
                <strong className={reviewMode ? 'text-deep-plum' : 'text-wm-text'}>{String(t.name ?? '')}</strong>
                {t.commitment ? <span className={reviewMode ? 'ml-2 text-xs font-mono px-1.5 py-0.5 rounded bg-primary-purple/10 text-primary-purple' : 'ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-wm-accent/10 text-wm-accent'}>{String(t.commitment)}</span> : null}
                {t.description && <p className={reviewMode ? 'text-deep-plum/80 mt-0.5' : 'text-wm-text/80 mt-0.5'}>{String(t.description)}</p>}
              </div>
            ))}
          </div>
        </DossierSlot>
      )}

      {programFaqs.length > 0 && (
        <DossierSlot icon={HelpCircle} title={`FAQs (${programFaqs.length})`} reviewMode={reviewMode}>
          <div className="space-y-2">{programFaqs.map((f, i) => (
            <FaqRow
              key={i}
              item={f}
              reviewMode={reviewMode}
              bucketKey={bucketKey}
              topicKey={topicKey ? `${topicKey}/program-${slugify(String(program.name ?? '')).slice(0, 40) || 'unnamed'}` : undefined}
              marks={marks}
              saveMark={saveMark}
            />
          ))}</div>
        </DossierSlot>
      )}

      {programKeyPhrases.length > 0 && (
        <DossierSlot icon={Hash} title={`Key Phrases (${programKeyPhrases.length})`} reviewMode={reviewMode}>
          <div className="space-y-2">{programKeyPhrases.map((k, i) => <KeyPhraseRow key={i} item={k} reviewMode={reviewMode} />)}</div>
        </DossierSlot>
      )}

      {programScrips.length > 0 && (
        <DossierSlot icon={BookOpen} title="Scripture" reviewMode={reviewMode}>
          <div className="space-y-2">{programScrips.map((s, i) => <ScriptureRow key={i} item={s} reviewMode={reviewMode} />)}</div>
        </DossierSlot>
      )}

      {programOther.length > 0 && (
        <DossierSlot icon={ListChecks} title={`Other (${programOther.length})`} reviewMode={reviewMode}>
          <div className="space-y-2">{programOther.map((it, i) => <GenericRecordRow key={i} item={it} reviewMode={reviewMode} />)}</div>
        </DossierSlot>
      )}

      {/* Partner add affordance — visible only when the program is in
          edit mode (i.e. the partner clicked Edit at the top). Lets
          them add a new item (detail, FAQ, meeting time, etc.) to THIS
          program. The Web Squad slots it into the right section
          downstream — partner doesn't have to pick a kind. */}
      {scope.editing && canEdit && bucketKey && saveMark && (
        <div className="mt-3 pt-3 border-t border-primary-purple/10">
          <AddMissingButton
            bucketKey={bucketKey}
            groupLabel={origName}
            saveMark={saveMark}
            marks={marks}
            programScope={{
              programSlug: slugify(origName).slice(0, 40) || 'unnamed',
              programName: origName,
            }}
          />
        </div>
      )}
      </article>
    </GroupEditContext.Provider>
  )
}

function DossierSlot({ icon: Icon, title, children, reviewMode }: { icon: typeof Mic2; title: string; children: React.ReactNode; reviewMode: boolean }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className={reviewMode ? 'text-primary-purple/70' : 'text-wm-accent/70'} />
        <p className={reviewMode
            ? 'text-[10px] uppercase tracking-widest font-bold text-primary-purple/80'
            : 'text-[10px] uppercase tracking-widest font-bold text-wm-accent/80'}>
          {title}
        </p>
      </div>
      {children}
    </div>
  )
}

// ── Row components ───────────────────────────────────────────────────

interface ConsolidatedEntry { value: string; labels: string[] }

/** Stable slug for a detail entry's edit-mark path. Derives from the
 *  first label when present; otherwise from the value itself. Same
 *  input → same slug across renders. */
function detailEntrySlug(entry: ConsolidatedEntry): string {
  const seed = entry.labels[0] || entry.value
  return slugify(seed).slice(0, 60) ||
    `e-${Math.abs(hashString(entry.labels.join('|') + '::' + entry.value)).toString(36).slice(0, 6)}`
}

function ConsolidatedDetailRow({
  entry, reviewMode, bucketKey, topicKey, marks, saveMark,
}: {
  entry:       ConsolidatedEntry
  reviewMode:  boolean
  bucketKey?:  string
  topicKey?:   string
  marks?:      Map<string, Mark>
  saveMark?:   SaveMark
}) {
  // Partner override path: when marks/saveMark are wired and the partner
  // has rewritten this entry inside the parent card's group-edit scope,
  // surface their edit instead of the crawled value. Falls back to
  // entry.value when no override exists.
  const editPath = bucketKey && topicKey
    ? `detail-edit:${bucketKey}/${topicKey}/${detailEntrySlug(entry)}`
    : null
  const editMark = editPath ? marks?.get(editPath) : undefined
  const currentValue = (editMark?.status === 'approved' && editMark.client_note != null)
    ? editMark.client_note
    : entry.value
  const groupEdit = useGroupEdit()
  const editing = groupEdit?.editing ?? false

  const [draft, setDraft] = useState(currentValue)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { if (!editing) setDraft(currentValue) }, [editing, currentValue])

  // Register commit + reset with the surrounding group-edit scope so
  // the card's Save all / Cancel buttons drive every row at once.
  useEffect(() => {
    if (!groupEdit?.register || !editPath || !saveMark) return
    return groupEdit.register(editPath, {
      commit: async () => {
        const trimmed = draftRef.current.trim()
        if (trimmed === entry.value.trim()) {
          await saveMark(editPath, 'topic_item', 'approved', null)
        } else {
          await saveMark(editPath, 'topic_item', 'approved', trimmed)
        }
      },
      reset: () => setDraft(currentValue),
    })
  }, [groupEdit, editPath, saveMark, entry.value, currentValue])

  const overridden = editMark?.status === 'approved' && editMark.client_note != null
  const wrapperClass = [
    reviewMode
      ? 'flex gap-3 text-sm bg-cream/40 border border-lavender/60 rounded-md px-3 py-2'
      : 'flex gap-3 text-[12px] bg-wm-bg-hover/40 border border-wm-border rounded-md px-3 py-2',
    overridden ? (reviewMode ? 'ring-1 ring-primary-purple/30' : 'ring-1 ring-wm-accent/30') : '',
  ].join(' ')
  const valueClass = reviewMode
    ? 'flex-1 min-w-0 text-deep-plum leading-snug whitespace-pre-line'
    : 'flex-1 min-w-0 text-wm-text leading-snug whitespace-pre-line'

  return (
    <div className={wrapperClass}>
      <div className="min-w-[8rem] shrink-0 flex flex-wrap gap-1 content-start">
        {entry.labels.length === 0 ? (
          <span className={reviewMode ? 'text-deep-plum/60 text-xs italic' : 'text-wm-text-muted text-[11px] italic'}>—</span>
        ) : entry.labels.map(l => (
          <span key={l} className={isSnippetLabel(l)
              ? (reviewMode
                ? 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-wm-success-bg/60 border border-wm-success/20 text-wm-success')
              : (reviewMode ? 'text-deep-plum font-bold text-sm' : 'text-wm-text font-bold text-[12px]')
          }>
            {l}
          </span>
        ))}
      </div>
      {editing ? (
        <textarea
          value={draft}
          rows={Math.max(2, Math.min(8, draft.split('\n').length))}
          onChange={e => setDraft(e.target.value)}
          className={reviewMode
            ? 'flex-1 min-w-0 text-sm text-deep-plum bg-white border border-primary-purple rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-purple/30 resize-y leading-snug'
            : 'flex-1 min-w-0 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border-focus rounded px-2 py-1.5 focus:outline-none resize-y leading-snug'}
        />
      ) : (
        <div className={valueClass}>
          {isUrl(currentValue) ? (
            <a href={currentValue} target="_blank" rel="noopener noreferrer"
               className={reviewMode ? 'text-primary-purple hover:underline inline-flex items-center gap-0.5 font-mono text-xs break-all' : 'text-wm-accent hover:underline inline-flex items-center gap-0.5 font-mono text-[11px] break-all'}>
              {currentValue} <ExternalLink size={9} />
            </a>
          ) : currentValue}
          {overridden && (
            <span className={reviewMode
              ? 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-primary-purple bg-lavender-tint border border-primary-purple/30 rounded-full px-1.5 py-0.5'
              : 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-wm-accent bg-wm-accent-tint border border-wm-accent/30 rounded-full px-1.5 py-0.5'}>
              Edited
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Blog parent-rollup ───────────────────────────────────────────────
//
// The blog_news topic is special: each crawled URL is usually one
// blog post, not the blog itself. Rendering every post as a passage
// row elevates an individual article ("/articles/we-are-not-grasshoppers")
// to look like THE blog content. The partner-truth signal is the
// PARENT — e.g. /articles or /news — with a count of children found.
//
// `deriveBlogSources` groups every URL in the topic by its first
// path segment per origin, identifies whichever URL exactly matches
// that segment as the parent index page (if crawled), and rolls the
// rest up as children. Sources sort by post count desc.

interface BlogSourceChild {
  url:          string
  title:        string
  date?:        string
  author?:      string
  passageText?: string
}
interface BlogSource {
  key:        string
  prefix:     string       // "/articles"
  label:      string       // "Articles"
  parentUrl:  string | null
  children:   BlogSourceChild[]
  summary:    string       // first sentence pulled from parent or any child passage
}

function titleizeSegment(seg: string): string {
  const cleaned = seg.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return seg
  return cleaned.replace(/\b\w/g, c => c.toUpperCase())
}

function deriveSlugTitle(url: string): string {
  try {
    const u = new URL(url)
    const segs = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    return titleizeSegment(segs[segs.length - 1] ?? '') || url
  } catch { return url }
}

function deriveBlogSources(topic: TopicRow): BlogSource[] {
  // Per-post record. The categorizer scatters info about a single post
  // across many shapes — kind=detail rows (Title/Author/Date Published),
  // kind=blog_news items with url+title+date, plus passages. All carry
  // a URL that identifies the post (item.source_url for details,
  // item.url for blog_news kind, passage.url for snippets). Collapse
  // them all into one PostRec keyed by that URL.
  type PostRec = {
    url:     string
    title?:  string
    date?:   string
    author?: string
    snippet?: string
  }
  const byUrl = new Map<string, PostRec>()
  const upsert = (url: string): PostRec => {
    let r = byUrl.get(url)
    if (!r) { r = { url }; byUrl.set(url, r) }
    return r
  }

  for (const u of topic.source_page_urls ?? []) upsert(u)

  for (const p of topic.passages ?? []) {
    if (!p.url) continue
    const r = upsert(p.url)
    if (!r.snippet && p.text) r.snippet = p.text
    if (!r.title && p.title) r.title = p.title
  }

  for (const it of (topic.items ?? []) as Item[]) {
    const itemUrl = String((it as Record<string, unknown>).url ?? it.source_url ?? '').trim()
    if (!itemUrl) continue
    const r = upsert(itemUrl)
    const kind = String(it.kind ?? '')
    if (kind === 'detail') {
      const lbl = String((it as Record<string, unknown>).label ?? '').trim().toLowerCase()
      const val = String((it as Record<string, unknown>).value ?? '').trim()
      if (!val) continue
      if (lbl === 'title' && !r.title) r.title = val
      else if (lbl === 'author' && !r.author) r.author = val
      else if ((lbl === 'date published' || lbl === 'date') && !r.date) r.date = val
    } else if (kind === 'blog_news') {
      const t = (it as Record<string, unknown>).title
      const d = (it as Record<string, unknown>).date
      if (!r.title && t) r.title = String(t)
      if (!r.date && d) r.date = String(d)
    }
  }

  type GroupEntry = { url: string; depth: number; post: PostRec }
  const groups = new Map<string, { prefix: string; label: string; entries: GroupEntry[] }>()
  for (const [url, post] of byUrl) {
    let u: URL
    try { u = new URL(url) } catch { continue }
    const segs = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (segs.length === 0) continue
    const seg = segs[0]
    const key = `${u.origin}/${seg}`
    const g = groups.get(key) ?? { prefix: `/${seg}`, label: titleizeSegment(seg), entries: [] }
    g.entries.push({ url, depth: segs.length, post })
    groups.set(key, g)
  }

  const sources: BlogSource[] = []
  for (const [key, g] of groups) {
    const parent = g.entries.find(e => e.depth === 1)
    const children: BlogSourceChild[] = g.entries
      .filter(e => e.depth > 1)
      .map(e => ({
        url:         e.url,
        title:       e.post.title || deriveSlugTitle(e.url),
        date:        e.post.date,
        author:      e.post.author,
        passageText: e.post.snippet,
      }))
    const summarySrc = parent?.post.snippet
      ?? children.find(c => c.passageText)?.passageText
      ?? g.entries.find(e => e.post.snippet)?.post.snippet
      ?? ''
    sources.push({
      key,
      prefix: g.prefix,
      label: g.label,
      parentUrl: parent?.url ?? null,
      children,
      summary: summarySrc.replace(/\s+/g, ' ').trim().slice(0, 260),
    })
  }
  // Sort by child count desc, then by whether parent was crawled, then alpha
  return sources.sort((a, b) => {
    if (b.children.length !== a.children.length) return b.children.length - a.children.length
    if ((a.parentUrl ? 1 : 0) !== (b.parentUrl ? 1 : 0)) return (b.parentUrl ? 1 : 0) - (a.parentUrl ? 1 : 0)
    return a.label.localeCompare(b.label)
  })
}

function BlogSourceRow({
  source, reviewMode, bucketKey, marks, saveMark,
}: {
  source:      BlogSource
  reviewMode:  boolean
  bucketKey?:  string
  marks?:      Map<string, Mark>
  saveMark?:   SaveMark
}) {
  const [open, setOpen] = useState(false)
  const hasChildren = source.children.length > 0
  const countLabel = `${source.children.length} ${source.children.length === 1 ? 'post' : 'posts'} found`
  const itemPath = bucketKey ? `item:${bucketKey}/${source.key}` : null
  const omitted  = itemPath ? marks?.get(itemPath)?.status === 'omit' : false
  const canEdit  = !!itemPath && !!saveMark
  return (
    <div className={[
      reviewMode
        ? 'bg-cream/40 border border-lavender/60 rounded-md px-3 py-2.5'
        : 'bg-wm-bg-hover/30 border border-wm-border rounded-md px-3 py-2.5',
      omitted ? 'opacity-60' : '',
    ].join(' ')}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className={[
            reviewMode ? 'text-sm text-deep-plum font-semibold' : 'text-[13px] text-wm-text font-semibold',
            omitted ? 'line-through' : '',
          ].join(' ')}>
            {source.label}
          </p>
          {source.parentUrl ? (
            <a href={source.parentUrl} target="_blank" rel="noopener noreferrer"
              className={reviewMode
                ? 'text-[11px] font-mono text-primary-purple hover:underline inline-flex items-center gap-0.5'
                : 'text-[10px] font-mono text-wm-accent hover:underline inline-flex items-center gap-0.5'}>
              {source.prefix} <ExternalLink size={9} />
            </a>
          ) : (
            <p className={reviewMode
                ? 'text-[11px] font-mono text-purple-gray'
                : 'text-[10px] font-mono text-wm-text-muted'}>
              {source.prefix} · index page not crawled
            </p>
          )}
        </div>
        <div className="inline-flex items-center gap-2 shrink-0">
          <Pill text={countLabel} reviewMode={reviewMode} />
          {canEdit && (
            omitted ? (
              <button
                type="button"
                onClick={() => void saveMark!(itemPath!, 'topic_item', 'approved', null)}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-purple-gray hover:text-deep-plum px-1.5 py-0.5 rounded-full border border-purple-gray/30 bg-cream"
                title="Bring this row back into the inventory"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void saveMark!(itemPath!, 'topic_item', 'omit', null)}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-purple-gray hover:text-deep-plum px-1.5 py-0.5 rounded-full hover:border hover:border-purple-gray/30 hover:bg-cream"
                title="This row is misclassified or shouldn't be carried over — skip it on the new site."
              >
                <EyeOff size={10} /> Skip
              </button>
            )
          )}
        </div>
      </div>
      {source.summary && (
        <p className={reviewMode
            ? 'text-[12px] text-deep-plum/85 italic mt-1.5 leading-snug'
            : 'text-[11px] text-wm-text/80 italic mt-1.5 leading-snug'}>
          "{source.summary}"
        </p>
      )}
      {hasChildren && (
        <button type="button" onClick={() => setOpen(o => !o)}
          className={reviewMode
            ? 'text-[10px] uppercase tracking-widest font-bold text-purple-gray hover:text-deep-plum mt-2 inline-flex items-center gap-1'
            : 'text-[10px] uppercase tracking-widest font-bold text-wm-text-muted hover:text-wm-text mt-2 inline-flex items-center gap-1'}>
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {open ? 'Hide individual posts' : 'Show individual posts'}
        </button>
      )}
      {open && hasChildren && (
        <ul className="mt-1.5 space-y-1 pl-3">
          {source.children.map(c => (
            <li key={c.url} className="leading-tight">
              <a href={c.url} target="_blank" rel="noopener noreferrer"
                className={reviewMode
                  ? 'text-[11px] text-primary-purple hover:underline inline-flex items-center gap-0.5'
                  : 'text-[10px] text-wm-accent hover:underline inline-flex items-center gap-0.5'}>
                {c.title || pathOnly(c.url)} <ExternalLink size={9} />
              </a>
              {(c.date || c.author) && (
                <span className={reviewMode
                    ? 'text-[10px] text-purple-gray ml-2'
                    : 'text-[10px] text-wm-text-muted ml-2'}>
                  {[c.date, c.author].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PassageRow({ passage, reviewMode }: { passage: Passage; reviewMode: boolean }) {
  return (
    <div className={reviewMode
        ? 'bg-cream/30 border border-lavender/40 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/30 border border-wm-border rounded-md px-3 py-2'}>
      {passage.url && (
        <a href={passage.url} target="_blank" rel="noopener noreferrer"
           className={reviewMode ? 'text-[10px] font-mono text-purple-gray hover:text-primary-purple inline-flex items-center gap-0.5' : 'text-[10px] font-mono text-wm-text-muted hover:text-wm-accent inline-flex items-center gap-0.5'}>
          {pathOnly(passage.url)} <ExternalLink size={9} />
        </a>
      )}
      <p className={reviewMode ? 'text-sm text-deep-plum italic leading-relaxed mt-1 whitespace-pre-line' : 'text-[12px] text-wm-text italic leading-relaxed mt-1 whitespace-pre-line'}>
        "{passage.text}"
      </p>
    </div>
  )
}

function FaqRow({
  item, reviewMode, bucketKey, topicKey, marks, saveMark,
}: {
  item:        Item
  reviewMode:  boolean
  bucketKey?:  string
  topicKey?:   string
  marks?:      Map<string, Mark>
  saveMark?:   SaveMark
}) {
  const origQuestion = String(item.question ?? '')
  const origAnswer   = String(item.answer ?? '')
  const slug = slugify(origQuestion).slice(0, 60) ||
    `faq-${Math.abs(hashString(origQuestion + '::' + origAnswer)).toString(36).slice(0, 6)}`
  const editPath = bucketKey && topicKey ? `faq-edit:${bucketKey}/${topicKey}/${slug}` : null
  const qMark    = editPath ? marks?.get(`${editPath}/question`) : undefined
  const aMark    = editPath ? marks?.get(`${editPath}/answer`)   : undefined
  const question = (qMark?.status === 'approved' && qMark.client_note != null) ? qMark.client_note : origQuestion
  const answer   = (aMark?.status === 'approved' && aMark.client_note != null) ? aMark.client_note : origAnswer
  const edited   = (qMark?.client_note != null) || (aMark?.client_note != null)

  const groupEdit = useGroupEdit()
  const editing = groupEdit?.editing ?? false

  const [qDraft, setQDraft] = useState(question)
  const [aDraft, setADraft] = useState(answer)
  const qDraftRef = useRef(qDraft)
  const aDraftRef = useRef(aDraft)
  useEffect(() => { qDraftRef.current = qDraft }, [qDraft])
  useEffect(() => { aDraftRef.current = aDraft }, [aDraft])
  useEffect(() => { if (!editing) { setQDraft(question); setADraft(answer) } }, [editing, question, answer])

  useEffect(() => {
    if (!groupEdit?.register || !editPath || !saveMark) return
    return groupEdit.register(`${editPath}/qa`, {
      commit: async () => {
        const qTrim = qDraftRef.current.trim()
        const aTrim = aDraftRef.current.trim()
        await saveMark(`${editPath}/question`, 'topic_item', 'approved', qTrim === origQuestion.trim() ? null : qTrim)
        await saveMark(`${editPath}/answer`,   'topic_item', 'approved', aTrim === origAnswer.trim()   ? null : aTrim)
      },
      reset: () => { setQDraft(question); setADraft(answer) },
    })
  }, [groupEdit, editPath, saveMark, origQuestion, origAnswer, question, answer])

  return (
    <div className={[
      reviewMode
        ? 'bg-cream/40 border border-lavender/60 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/40 border border-wm-border rounded-md px-3 py-2',
      edited ? (reviewMode ? 'ring-1 ring-primary-purple/30' : 'ring-1 ring-wm-accent/30') : '',
    ].join(' ')}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="block">
            <span className={reviewMode ? 'text-[10px] uppercase tracking-widest font-bold text-purple-gray' : 'text-[10px] uppercase tracking-widest font-bold text-wm-text-muted'}>Question</span>
            <textarea
              value={qDraft}
              rows={2}
              onChange={e => setQDraft(e.target.value)}
              className={reviewMode
                ? 'w-full mt-0.5 text-sm text-deep-plum bg-white border border-primary-purple rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-purple/30 resize-y leading-snug'
                : 'w-full mt-0.5 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border-focus rounded px-2 py-1.5 focus:outline-none resize-y leading-snug'}
            />
          </label>
          <label className="block">
            <span className={reviewMode ? 'text-[10px] uppercase tracking-widest font-bold text-purple-gray' : 'text-[10px] uppercase tracking-widest font-bold text-wm-text-muted'}>Answer</span>
            <textarea
              value={aDraft}
              rows={Math.max(3, Math.min(10, aDraft.split('\n').length + 1))}
              onChange={e => setADraft(e.target.value)}
              className={reviewMode
                ? 'w-full mt-0.5 text-sm text-deep-plum bg-white border border-primary-purple rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-purple/30 resize-y leading-snug'
                : 'w-full mt-0.5 text-[12px] text-wm-text bg-wm-bg-elevated border border-wm-border-focus rounded px-2 py-1.5 focus:outline-none resize-y leading-snug'}
            />
          </label>
        </div>
      ) : (
        <>
          <p className={reviewMode ? 'text-sm text-deep-plum font-semibold' : 'text-[12px] text-wm-text font-semibold'}>
            {question}
            {edited && (
              <span className={reviewMode
                  ? 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-primary-purple bg-lavender-tint border border-primary-purple/30 rounded-full px-1.5 py-0.5'
                  : 'ml-2 inline-flex items-center text-[9px] uppercase tracking-wider font-bold text-wm-accent bg-wm-accent-tint border border-wm-accent/30 rounded-full px-1.5 py-0.5'}>
                Edited
              </span>
            )}
          </p>
          <p className={reviewMode ? 'text-sm text-deep-plum/85 mt-1 leading-snug whitespace-pre-line' : 'text-[12px] text-wm-text/85 mt-1 leading-snug whitespace-pre-line'}>
            {answer}
          </p>
        </>
      )}
    </div>
  )
}

function KeyPhraseRow({ item, reviewMode }: { item: Item; reviewMode: boolean }) {
  const phrase = String(item.phrase ?? item.name ?? item.title ?? '')
  const context = String(item.context ?? item.statement ?? item.description ?? '')
  return (
    <div className={reviewMode
        ? 'bg-lavender-tint/40 border border-lavender rounded-md px-3 py-2'
        : 'bg-wm-accent-tint/40 border border-wm-accent/20 rounded-md px-3 py-2'}>
      <p className={reviewMode ? 'text-sm text-deep-plum font-bold' : 'text-[12px] text-wm-text font-bold'}>
        "{phrase}"
      </p>
      {context && (
        <p className={reviewMode ? 'text-xs text-purple-gray mt-1' : 'text-[11px] text-wm-text-muted mt-1'}>{context}</p>
      )}
    </div>
  )
}

function CtaRow({ item, reviewMode }: { item: Item; reviewMode: boolean }) {
  const url = String(item.url ?? '')
  const label = String(item.label ?? item.name ?? '')
  return (
    <div className={reviewMode
        ? 'bg-cream/30 border border-lavender/40 rounded-md px-3 py-2 flex items-baseline gap-3'
        : 'bg-wm-bg-hover/30 border border-wm-border rounded-md px-3 py-2 flex items-baseline gap-3'}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer"
           className={reviewMode
             ? 'text-[13px] font-semibold text-primary-purple hover:underline inline-flex items-center gap-1 shrink-0'
             : 'text-[12px] font-semibold text-wm-accent hover:underline inline-flex items-center gap-1 shrink-0'}>
          {label || url} <ExternalLink size={10} />
        </a>
      ) : (
        <span className={reviewMode ? 'text-[13px] font-semibold text-deep-plum' : 'text-[12px] font-semibold text-wm-text'}>{label}</span>
      )}
      {url && label && url !== label && (
        <code className={reviewMode
            ? 'text-[10px] font-mono text-purple-gray truncate min-w-0 flex-1'
            : 'text-[10px] font-mono text-wm-text-muted truncate min-w-0 flex-1'}>{url}</code>
      )}
    </div>
  )
}

function ScriptureRow({ item, reviewMode }: { item: Item; reviewMode: boolean }) {
  return (
    <div className={reviewMode
        ? 'bg-cream/30 border border-lavender/40 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/30 border border-wm-border rounded-md px-3 py-2'}>
      <p className={reviewMode ? 'text-[10px] font-mono uppercase tracking-wide text-primary-purple' : 'text-[10px] font-mono uppercase tracking-wide text-wm-accent'}>
        {String(item.reference ?? '')}
      </p>
      <p className={reviewMode ? 'text-sm text-deep-plum italic leading-snug mt-0.5' : 'text-[12px] text-wm-text italic leading-snug mt-0.5'}>
        "{String(item.text ?? '')}"
      </p>
    </div>
  )
}

function TestimonyRow({ item, reviewMode }: { item: Item; reviewMode: boolean }) {
  // The categorizer emits the testimony text under varying field names
  // depending on what the source page used (story / quote / text). Read
  // through the same priority order the substance filter uses, so the
  // rendered output never lands as an empty pair of quotes.
  const r = item as Record<string, unknown>
  const text = String(r.story ?? r.quote ?? r.text ?? '').trim()
  if (!text) return null
  // Context footnote — what is this testimony about? When the LLM
  // wrote a `context` field, prefer that ("Acts Series", "Baptism
  // Stories"). Otherwise derive a label from the source URL path so
  // the partner sees the page the quote came from. Falls back to
  // raw source_url for legacy items.
  const explicitContext = typeof r.context === 'string' ? r.context.trim() : ''
  const sourceUrl       = typeof r.source_url === 'string' ? r.source_url.trim() : ''
  let context = explicitContext
  if (!context && sourceUrl) {
    try {
      const path = new URL(sourceUrl).pathname.replace(/^\//, '').replace(/\/$/, '')
      if (path) {
        // "acts" → "Acts" · "stories/baptism" → "Stories Baptism"
        context = path.split('/').map(seg => seg.replace(/[-_]/g, ' ')).join(' · ')
          .replace(/\b\w/g, c => c.toUpperCase())
      }
    } catch { /* leave context empty */ }
  }
  return (
    <div className={reviewMode
        ? 'bg-cream/40 border border-lavender/60 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/40 border border-wm-border rounded-md px-3 py-2'}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className={reviewMode ? 'text-sm font-bold text-deep-plum' : 'text-[12px] font-bold text-wm-text'}>{String(item.person ?? 'Anonymous')}</p>
        {item.role && <span className={reviewMode ? 'text-xs text-purple-gray' : 'text-[11px] text-wm-text-muted'}>· {String(item.role)}</span>}
        {item.baptism_date && <span className={reviewMode ? 'text-xs text-purple-gray' : 'text-[11px] text-wm-text-muted'}>· {String(item.baptism_date)}</span>}
      </div>
      <p className={reviewMode ? 'text-sm text-deep-plum italic leading-relaxed mt-1 whitespace-pre-line' : 'text-[12px] text-wm-text italic leading-relaxed mt-1 whitespace-pre-line'}>
        "{text}"
      </p>
      {item.scripture_ref && (
        <p className={reviewMode ? 'text-[10px] font-mono text-primary-purple mt-1' : 'text-[10px] font-mono text-wm-accent mt-1'}>{String(item.scripture_ref)}</p>
      )}
      {context && (
        <p className={reviewMode
            ? 'text-[10px] uppercase tracking-wider font-bold text-primary-purple/70 mt-1.5'
            : 'text-[10px] uppercase tracking-wider font-bold text-wm-text-subtle mt-1.5'}>
          From {context}
        </p>
      )}
    </div>
  )
}

/** Editable card for a single staff entry. Each field (name, role,
 *  bio, email, phone) is inline-editable and saves on blur via
 *  saveMark. A Remove button omits the whole staff member (writes
 *  status='omit' on the parent item path). Falls back to a read-only
 *  GenericRecordRow when marks/saveMark aren't available. */
function EditableStaffCard({
  item, bucketKey, topicKey, marks, saveMark, reviewMode,
}: {
  item:       Item
  bucketKey:  string
  topicKey:   string
  marks:      Map<string, Mark>
  saveMark:   SaveMark
  reviewMode: boolean
}) {
  const rawName = String(item.name ?? item.title ?? '').trim()
  const itemKey = (slugify(rawName) || `unnamed-${Math.abs(hashString(JSON.stringify(item))).toString(36).slice(0, 6)}`)
  const basePath = `item:${bucketKey}/${topicKey}/${itemKey}`
  const omitMark = marks.get(basePath)
  const omitted  = omitMark?.status === 'omit'

  // Partner side hides removed staff entirely; staff side shows them
  // muted with a Restore affordance so the row isn't lost.
  if (omitted && reviewMode) return null

  // Per-field current value: partner edit wins over crawl extraction.
  const getField = (field: string): string => {
    const m = marks.get(`${basePath}/${field}`)
    if (m?.status === 'approved' && m.client_note != null) return m.client_note
    const v = (item as Record<string, unknown>)[field]
    return typeof v === 'string' ? v : (v != null ? String(v) : '')
  }
  const setField = async (field: string, value: string) => {
    await saveMark(`${basePath}/${field}`, 'topic_item', 'approved', value.trim() || null)
  }

  return (
    <div className={[
      reviewMode
        ? 'bg-white border border-lavender rounded-md p-3 space-y-2'
        : 'bg-wm-bg-elevated border border-wm-border rounded-md p-3 space-y-2',
      omitted ? 'opacity-60' : '',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <StaffField label="Name"  initial={getField('name')}  onCommit={v => setField('name', v)}  reviewMode={reviewMode} />
          <StaffField label="Role"  initial={getField('role') || getField('title')} onCommit={v => setField('role', v)} reviewMode={reviewMode} />
          <StaffField label="Email" initial={getField('email')} onCommit={v => setField('email', v)} reviewMode={reviewMode} type="email" />
          <StaffField label="Phone" initial={getField('phone')} onCommit={v => setField('phone', v)} reviewMode={reviewMode} type="tel" />
        </div>
        <div className="shrink-0">
          {omitted ? (
            <button
              type="button"
              onClick={() => void saveMark(basePath, 'topic_item', 'approved', null)}
              className="text-[11px] font-semibold text-primary-purple hover:text-deep-plum"
              title="Bring this staff member back"
            >
              Restore
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void saveMark(basePath, 'topic_item', 'omit', null)}
              className="text-[11px] font-semibold text-purple-gray hover:text-red-700 inline-flex items-center gap-1"
              title="Remove this staff member"
            >
              <EyeOff size={11} /> Remove
            </button>
          )}
        </div>
      </div>
      <StaffField
        label="Bio"
        initial={getField('bio')}
        onCommit={v => setField('bio', v)}
        reviewMode={reviewMode}
        multiline
      />
    </div>
  )
}

function StaffField({
  label, initial, onCommit, reviewMode, multiline, type,
}: {
  label:      string
  initial:    string
  onCommit:   (v: string) => Promise<void>
  reviewMode: boolean
  multiline?: boolean
  type?:      string
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue(initial) }, [initial])
  const commit = async () => {
    if (value === initial) return
    setSaving(true)
    try { await onCommit(value) } finally { setSaving(false) }
  }
  const labelCls = reviewMode
    ? 'text-[10px] uppercase tracking-widest font-bold text-purple-gray'
    : 'text-[10px] uppercase tracking-widest font-bold text-wm-text-muted'
  const inputCls = reviewMode
    ? 'w-full text-[12.5px] text-deep-plum bg-cream/40 border border-lavender/60 rounded px-2 py-1 focus:border-primary-purple focus:bg-white focus:outline-none'
    : 'w-full text-[12px] text-wm-text bg-wm-bg border border-wm-border rounded px-2 py-1 focus:border-wm-accent focus:bg-wm-bg-elevated focus:outline-none'
  return (
    <label className={multiline ? 'block w-full' : 'block'}>
      <span className={`${labelCls} inline-flex items-center gap-1`}>
        {label} {saving && <Loader2 size={9} className="animate-spin" />}
      </span>
      {multiline ? (
        <textarea
          value={value}
          rows={3}
          placeholder="Add or edit bio…"
          onChange={e => setValue(e.target.value)}
          onBlur={() => void commit()}
          className={`${inputCls} mt-0.5 resize-y leading-snug min-h-[60px]`}
        />
      ) : (
        <input
          type={type ?? 'text'}
          value={value}
          placeholder={`Add ${label.toLowerCase()}…`}
          onChange={e => setValue(e.target.value)}
          onBlur={() => void commit()}
          className={`${inputCls} mt-0.5`}
        />
      )}
    </label>
  )
}

/** Cheap, deterministic string hash for fallback item IDs when a
 *  staff entry has no name. Same input → same output across renders. */
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h
}

function GenericRecordRow({ item, reviewMode, primary }: { item: Item; reviewMode: boolean; primary?: string }) {
  const entries = Object.entries(item).filter(([k, v]) => k !== 'kind' && k !== 'source_url' && v != null && v !== '')
  const primaryEntry = primary ? entries.find(([k]) => k === primary) : null
  const rest = primary ? entries.filter(([k]) => k !== primary) : entries
  return (
    <div className={reviewMode
        ? 'bg-cream/30 border border-lavender/40 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/30 border border-wm-border rounded-md px-3 py-2'}>
      {primaryEntry && (
        <p className={reviewMode ? 'text-sm font-bold text-deep-plum' : 'text-[12px] font-bold text-wm-text'}>{renderCell(primaryEntry[1])}</p>
      )}
      <dl className="space-y-0.5 mt-1">
        {rest.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className={reviewMode ? 'text-[10px] font-mono uppercase tracking-wide text-purple-gray min-w-[7rem] shrink-0' : 'text-[10px] font-mono uppercase tracking-wide text-wm-text-muted min-w-[7rem] shrink-0'}>{k}:</dt>
            <dd className={reviewMode ? 'text-xs text-deep-plum leading-snug' : 'text-[11px] text-wm-text leading-snug'}>{renderCell(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── Status picker (3-state pill) + Add Missing button ────────────────

function StatusPicker({ current, onPick }: { current: MarkStatus | null; onPick: (s: MarkStatus) => void }) {
  const opts: { key: MarkStatus; icon: typeof CheckCircle2; label: string; idle: string; active: string }[] = [
    { key: 'approved', icon: CheckCircle2, label: 'Approved',     idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200', active: 'bg-emerald-500 text-white border-emerald-500 shadow-sm' },
    { key: 'outdated', icon: Edit3,        label: 'Needs update', idle: 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200',       active: 'bg-amber-500 text-white border-amber-500 shadow-sm' },
    { key: 'omit',     icon: EyeOff,       label: 'Omit',         idle: 'bg-cream text-purple-gray hover:bg-lavender-tint border-purple-gray/30',  active: 'bg-purple-gray text-white border-purple-gray shadow-sm' },
  ]
  return (
    <div className="inline-flex flex-wrap gap-1.5">
      {opts.map(o => {
        const Icon = o.icon
        const isActive = current === o.key
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onPick(o.key)}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${isActive ? o.active : o.idle}`}
          >
            <Icon size={12} />
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function AddMissingButton({
  bucketKey, groupLabel, saveMark, marks, prefillField, compact, programScope,
}: {
  bucketKey:    string
  groupLabel:   string
  saveMark:     SaveMark
  marks?:       Map<string, Mark>
  /** When set, this addition is tagged to a specific baseline field —
   *  the mark's path embeds `baseline-<field.key>` so staff can later
   *  surface it next to the matching baseline row. The form trigger
   *  also re-labels to "Add this" and pre-fills the name with the
   *  baseline label. */
  prefillField?: import('../../../lib/webPartnerBaselines').BaselineField
  /** Render as a compact inline button (for row-level use) instead of
   *  the full-width dashed CTA. */
  compact?:     boolean
  /** When set, the addition is scoped to a specific program inside the
   *  bucket. Path embeds `program-<slug>` so the downstream pipeline
   *  can attach the new item to that program rather than the bucket
   *  root. Trigger label flips from "Add something we missed in X" to
   *  "Add an item to {programName}". Re-uses the same target_kind +
   *  client_note serialization so no schema changes. */
  programScope?: { programSlug: string; programName: string }
}) {
  const [open, setOpen] = useState(false)
  // Add-kind picker (v109). Two modes:
  //   - 'program' (default, legacy behavior unchanged): name + description
  //   - 'cta':    action title + invitation copy + URL + tool detection
  // Baseline prefills always force program mode — the baseline field
  // semantics expect a value, not a CTA.
  const [addKind, setAddKind] = useState<'program' | 'cta'>('program')
  const [name, setName] = useState(prefillField?.label ?? '')
  const [desc, setDesc] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const attCtx = useAttachmentContext()

  // Run the tool detector on every URL change. Cheap (regex+URL parse);
  // safe to recompute on every render.
  const detected = useMemo(() => detectToolFromUrl(ctaUrl), [ctaUrl])

  // Path scopes the uniqueness check — baseline-tied additions cluster
  // under their own prefix so a partner can add multiple entries to
  // the same baseline (e.g., several service times) without collision.
  // Program-scoped additions cluster under `program-<slug>` so the
  // downstream pipeline can route them to the right program card.
  // CTA additions use a `cta-` prefix so the strategist's downstream
  // review can pre-sort first-class CTAs from generic programs.
  const pathPrefix = prefillField
    ? `missing:${bucketKey}/baseline-${prefillField.key}-`
    : programScope
      ? `missing:${bucketKey}/program-${programScope.programSlug}/`
      : addKind === 'cta'
        ? `missing:${bucketKey}/cta-`
        : `missing:${bucketKey}/`
  const counter = Array.from(marks?.keys() ?? []).filter(k => k.startsWith(pathPrefix)).length

  // Pre-compute the target_path so partners can attach files BEFORE
  // they hit Save — the saved mark uses this same path. Files upload
  // immediately to the bucket with this path baked in.
  const provisionalPath = useMemo(() => {
    if (prefillField) return `${pathPrefix}${counter + 1}`
    return `${pathPrefix}${slugify(name || 'untitled')}-${counter + 1}`
    // intentionally not depending on `name` to keep target_path stable
    // for files attached before the partner finalizes the title
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathPrefix, counter, prefillField])

  const myAttachments = (attCtx?.attachments ?? []).filter(a => a.target_path === provisionalPath)

  // CTA submit requires action title + URL that at least parses.
  // Invitation copy is optional (sometimes the URL + label is enough).
  // Program submit unchanged.
  const ctaUrlIsValid = (() => {
    const v = ctaUrl.trim()
    if (!v) return false
    try {
      // Tolerate "mlc.churchcenter.com/..." (no protocol) by prepending
      // https:// only for the parse check — what we save is what the
      // partner typed.
      new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
      return true
    } catch { return false }
  })()
  const canSubmit = addKind === 'cta'
    ? (name.trim().length > 0 && ctaUrlIsValid)
    : (name.trim().length > 0 && desc.trim().length > 0)
  const submit = async () => {
    if (!canSubmit) return
    if (addKind === 'cta') {
      // Compose a human-readable description from the copy + URL so legacy
      // readers that don't know about proposed_metadata still see something
      // useful in proposed_program_description.
      const trimmedCopy = desc.trim()
      const composed = trimmedCopy
        ? `${trimmedCopy}\n\n${ctaUrl.trim()}`
        : ctaUrl.trim()
      await saveMark(provisionalPath, 'missing_program', 'outdated', composed, {
        proposed_program_name: name.trim(),
        proposed_program_description: composed,
        proposed_metadata: {
          kind:   'cta',
          url:    ctaUrl.trim(),
          tool:   detected.tool,
          copy:   trimmedCopy || null,
          action: name.trim(),
        },
      })
    } else {
      await saveMark(provisionalPath, 'missing_program', 'outdated', desc.trim(), {
        proposed_program_name: name.trim(),
        proposed_program_description: desc.trim(),
      })
    }
    setName(prefillField?.label ?? ''); setDesc(''); setCtaUrl(''); setOpen(false)
  }

  const triggerCls = compact
    ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:underline'
    : 'w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-purple border border-dashed border-primary-purple/40 rounded-lg px-3 py-2 hover:border-primary-purple hover:bg-primary-purple/5 transition-colors'
  const triggerLabel = prefillField
    ? `Add ${prefillField.label.toLowerCase()}`
    : programScope
      ? `Add an item to ${programScope.programName}`
      : `Add something we missed in ${groupLabel}`

  return (
    <div className={compact ? 'mt-1' : 'mt-3'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={triggerCls}
      >
        <Plus size={compact ? 11 : 12} />
        {triggerLabel}
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-white border border-lavender rounded-lg p-3">
          {prefillField && (
            <p className="text-[11px] text-purple-gray">
              Tagged to <span className="font-semibold text-deep-plum">{prefillField.label}</span> in {groupLabel}.
            </p>
          )}
          {programScope && !prefillField && (
            <p className="text-[11px] text-purple-gray">
              Adding to <span className="font-semibold text-deep-plum">{programScope.programName}</span>. The Web Squad will slot this into the right section (details, meeting time, FAQ, etc.).
            </p>
          )}

          {/* Kind picker — only shown when there's no baseline prefill
              (baselines are always program-shaped). Default 'program'
              preserves the original behavior exactly; 'cta' opts into
              the structured call-to-action shape (URL + tool tag). */}
          {!prefillField && (
            <div className="inline-flex rounded-full border border-lavender bg-cream/60 p-0.5 text-[11px] font-semibold mb-1">
              <button
                type="button"
                onClick={() => setAddKind('program')}
                className={[
                  'px-3 py-1 rounded-full transition-colors',
                  addKind === 'program' ? 'bg-deep-plum text-cream' : 'text-purple-gray hover:text-deep-plum',
                ].join(' ')}
              >
                Item or program
              </button>
              <button
                type="button"
                onClick={() => setAddKind('cta')}
                className={[
                  'px-3 py-1 rounded-full transition-colors',
                  addKind === 'cta' ? 'bg-deep-plum text-cream' : 'text-purple-gray hover:text-deep-plum',
                ].join(' ')}
              >
                Link / call-to-action
              </button>
            </div>
          )}

          {addKind === 'cta' ? (
            <>
              <PartnerTextInput
                label="What does this help someone do?"
                required
                placeholder={detected.actionHint ?? 'e.g. Join a small group, Submit a prayer request'}
                value={name}
                onChange={setName}
              />
              <PartnerTextInput
                label="Link"
                required
                placeholder="https://..."
                value={ctaUrl}
                onChange={setCtaUrl}
              />
              {detected.tool && detected.label && (
                <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                  Detected: <span className="font-semibold">{detected.label}</span>
                  {detected.isFormish && ' — looks like a sign-up / form'}
                  . We'll route this as a call-to-action on your new site.
                </p>
              )}
              <PartnerRichTextField
                label="Invitation copy (optional)"
                minHeight={80}
              >
                <WMRichTextEditor
                  value={desc}
                  onChange={setDesc}
                  placeholder="Short paragraph that invites someone to click. Skip if the link + label say enough."
                  compact
                />
              </PartnerRichTextField>
            </>
          ) : (
            <>
              <PartnerTextInput
                label="What's it called?"
                required
                placeholder={prefillField?.label ?? (programScope ? 'e.g. Childcare available' : 'e.g. Wednesday Youth Night')}
                value={name}
                onChange={setName}
              />
              <PartnerRichTextField
                label="Tell us about it"
                required
                minHeight={120}
              >
                <WMRichTextEditor
                  value={desc}
                  onChange={setDesc}
                  placeholder={prefillField?.description
                    ? `${prefillField.description}`
                    : 'Who it\'s for, when it meets, where, and any key details you want included on the new site.'}
                  compact
                />
              </PartnerRichTextField>
            </>
          )}
          {attCtx && (
            <FileUploadField
              sessionId={attCtx.sessionId}
              kind="missing"
              targetPath={provisionalPath}
              attachments={myAttachments as unknown as AttachmentMetadata[]}
              onUploaded={(a) => attCtx.onChange(prev => [a as unknown as InventoryAttachment, ...prev])}
              onDeleted={(id) => attCtx.onChange(prev => prev.filter(x => x.id !== id))}
              label="Attach a file (optional)"
              help="CSV, Word doc, or image — for things like staff rosters, schedules, or photos that aren't on your current site."
              compact
            />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-purple-gray font-semibold">Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="text-xs font-semibold bg-deep-plum text-cream px-3 py-1.5 rounded-full hover:bg-purple-mid disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Utilities ────────────────────────────────────────────────────────

function Pill({ text, reviewMode }: { text: string; reviewMode: boolean }) {
  return (
    <span className={reviewMode
        ? 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-purple/10 text-primary-purple'
        : 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-wm-accent/10 text-wm-accent'}>
      {text}
    </span>
  )
}

function pathOnly(url: string): string {
  try { return new URL(url).pathname + (new URL(url).search ?? '') } catch { return url }
}
function isUrl(s: string): boolean { return /^https?:\/\//i.test(s) }
function normValue(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' ') }

/** Normalize a passage / prose chunk for substring-equality matching:
 *  lowercase, collapse whitespace, strip enclosing quotes/punctuation. */
function normPassageText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Dedup kind=staff items in two passes:
 *  1. exact-name (keep the entry with the most fields populated)
 *  2. bio overlap — when two records share ≥70% of distinctive bio words,
 *     keep ONE: prefer a joint listing ("Brad & Becky Davis") over
 *     individual names, then prefer the record with more fields. */
function dedupStaffRecords(items: Item[]): Item[] {
  // Pass 1 — by exact name
  const byName = new Map<string, Item>()
  const score = (s: Item) => Object.values(s).filter(v => v != null && v !== '').length
  for (const s of items) {
    const n = String(s.name ?? '').trim().toLowerCase()
    if (!n) continue
    const existing = byName.get(n)
    if (!existing || score(s) > score(existing)) byName.set(n, s)
  }
  let candidates = Array.from(byName.values())
  if (candidates.length < 2) return candidates

  // Pass 2 — by bio content overlap
  const bioWords = candidates.map(s => {
    const out = new Set<string>()
    for (const w of String(s.bio ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 5) out.add(w)
    }
    return out
  })
  const isJoint = (s: Item) => /\s(&|and|\+)\s/i.test(String(s.name ?? ''))
  const dropped = new Set<number>()
  for (let i = 0; i < candidates.length; i++) {
    if (dropped.has(i)) continue
    if (bioWords[i].size < 15) continue  // need enough content to compare
    for (let k = 0; k < candidates.length; k++) {
      if (k === i || dropped.has(k)) continue
      if (bioWords[k].size < 10) continue
      let intersect = 0
      for (const w of bioWords[k]) if (bioWords[i].has(w)) intersect++
      const overlap = intersect / Math.min(bioWords[i].size, bioWords[k].size)
      if (overlap < 0.7) continue
      // Decide which record to keep
      const iJoint = isJoint(candidates[i])
      const kJoint = isJoint(candidates[k])
      let keep = i
      if (iJoint !== kJoint) keep = iJoint ? i : k
      else if (score(candidates[i]) !== score(candidates[k])) keep = score(candidates[i]) > score(candidates[k]) ? i : k
      dropped.add(keep === i ? k : i)
      if (keep !== i) break  // i was dropped; move on
    }
  }
  return candidates.filter((_, i) => !dropped.has(i))
}

/** Drop programs whose content (description + passage text) is a high-overlap
 *  subset of another program's content in the same list. Keeps the richer
 *  program; hides the thin duplicate (Lead Pastors → Pastors Brad and
 *  Becky Davis case). */
function dedupSubsetPrograms(programs: Item[]): Item[] {
  if (programs.length < 2) return programs
  const fingerprint = (p: Item): Set<string> => {
    const chunks: string[] = []
    if (p.description) chunks.push(String(p.description))
    if (Array.isArray(p.passages)) {
      for (const pp of p.passages as Array<string | Passage>) {
        chunks.push(typeof pp === 'string' ? pp : pp.text ?? '')
      }
    }
    const text = chunks.join(' ').toLowerCase()
    const words = text.split(/[^a-z0-9]+/).filter(w => w.length >= 4)
    return new Set(words)
  }
  const fps = programs.map(fingerprint)
  const dropped = new Set<number>()
  for (let i = 0; i < programs.length; i++) {
    if (dropped.has(i)) continue
    if (fps[i].size < 8) continue  // not enough content to compare meaningfully
    for (let k = 0; k < programs.length; k++) {
      if (k === i || dropped.has(k)) continue
      if (fps[k].size < 4) continue
      // Is k's fingerprint a high-overlap subset of i's?
      let inI = 0
      for (const w of fps[k]) if (fps[i].has(w)) inI++
      const overlapRatio = inI / fps[k].size
      const sizeRatio    = fps[k].size / fps[i].size
      if (overlapRatio >= 0.8 && sizeRatio < 0.7) dropped.add(k)
    }
  }
  return programs.filter((_, i) => !dropped.has(i))
}
function isBrokenSnippet(value: string): boolean {
  // A snippet whose expansion is itself a {{…}} placeholder is unresolved — hide it.
  return /^\{\{\s*[\w.-]+\s*\}\}$/.test(value.trim())
}
function isSnippetLabel(label: string): boolean { return /^\{\{.+\}\}$/.test(label) }
function isBrokenValue(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  if (isBrokenSnippet(v)) return true
  // "Typeform embedded", "Form embedded here", "JavaScript widget" — describes the mechanism, not the data.
  if (/\b(typeform|mailchimp|javascript|widget|iframe)\b.*\b(embedded|embed)\b/i.test(v)) return true
  if (/^(typeform|embedded|inline form|see below)$/i.test(v)) return true
  return false
}
function isBrokenCta(item: Item): boolean {
  const url = String(item.url ?? '').trim()
  const label = String(item.label ?? item.name ?? '').trim()
  if (!url && !label) return true
  if (url && !isUrl(url)) return true  // CTAs must point at a real URL
  if (label && isBrokenValue(label)) return true
  return false
}

/** External CTAs only — partner review filters out internal-route
 *  links (e.g. /visit, /give, #contact). Those duplicate nav items
 *  that partners already see on their own site; the value of the
 *  CTA inventory in review is "these are the off-site destinations
 *  we'll be linking to" (Subsplash, ChurchCenter, YouTube, etc.). */
/** Generic dedupe that preserves first occurrence. Used for CTAs by
 *  URL — "Directions → maps.google…" appearing once at the top and
 *  again in a card collapses to one row. Different URLs stay
 *  distinct, so a North Campus map link and a South Campus map link
 *  both render. */
function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const k = keyFn(it)
    if (!k) { out.push(it); continue }
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

function isExternalCta(item: Item, selfHost?: string): boolean {
  const url = String(item.url ?? '').trim().toLowerCase()
  if (!url) return false
  if (url.startsWith('mailto:') || url.startsWith('tel:')) return true
  // Absolute http(s) urls: external ONLY when their host differs
  // from the partner's own site. desertspringschurch.com/team is
  // internal even though it parses as absolute, because it points
  // back at the same site partners are migrating away from.
  if (/^https?:\/\//.test(url)) {
    const h = hostFromUrl(url)
    if (selfHost && h && hostsMatch(h, selfHost)) return false
    return true
  }
  // Anything else (/path, #anchor, relative) is internal.
  return false
}

/** True when two normalized hostnames represent the same site —
 *  exact equality OR one is a subdomain of the other. Lets
 *  `m.paradoxredlands.com` count as internal against
 *  `paradoxredlands.com` and vice-versa. */
function hostsMatch(a: string, b: string): boolean {
  if (a === b) return true
  return a.endsWith('.' + b) || b.endsWith('.' + a)
}

/** Normalize a URL string to its lower-case host, stripping `www.`
 *  so `https://www.example.com/x` and `https://example.com/y` compare
 *  equal. Accepts bare hostnames too — the `site_url` snippet is
 *  often stored without an `https://` prefix, which would otherwise
 *  trip `new URL()` and leak every absolute CTA through the
 *  same-site filter. Returns empty string only when the input is
 *  blank or genuinely unparseable. */
function hostFromUrl(raw: string): string {
  if (!raw) return ''
  const candidates = /^https?:\/\//i.test(raw) ? [raw] : [`https://${raw}`, raw]
  for (const c of candidates) {
    try {
      const u = new URL(c)
      const h = u.host.toLowerCase().replace(/^www\./, '')
      if (h) return h
    } catch { /* try next candidate */ }
  }
  // Last-ditch: input is something like `paradoxredlands.com/foo`
  // and BOTH parse attempts above failed. Split on `/` and treat
  // the first segment as the host.
  const bare = raw.toLowerCase().trim()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  return bare || ''
}

/** Item kinds where we filter out seasonal / one-off items in
 *  partner review. Easter / Christmas / VBS / etc. surface as
 *  low-status findings — partners don't want them elevated to
 *  ongoing-ministry status. Filter at the kinds where the elevation
 *  happens: programs and details, plus the volunteer / event kinds
 *  that originally needed it. Doctrines / staff / scriptures stay
 *  unfiltered (a "Christmas doctrine" doesn't exist; a "Christmas
 *  pastor" doesn't either). */
const SEASONAL_FILTERED_KINDS = new Set([
  'program', 'detail',
  'volunteer_role', 'serve_role', 'role',
  'event', 'opportunity',
])

const SEASONAL_RE = /\b(easter|christmas|thanksgiving|good\s+friday|advent|halloween|vbs|vacation\s+bible|summer\s+camp|mother'?s?\s+day|father'?s?\s+day|fall\s+festival|spring\s+break|new\s+year'?s)\b/i

function looksSeasonal(item: Item): boolean {
  const r = item as Record<string, unknown>
  const name = String(r.name ?? r.title ?? r.label ?? r.role ?? '').trim()
  if (!name) return false
  return SEASONAL_RE.test(name)
}

/** Per-kind primary content fields. An item with NO value in any of
 *  these fields is empty — has nothing to show the partner. The
 *  partner-facing inventory drops such items before rendering. */
const SUBSTANCE_FIELDS: Record<string, string[]> = {
  testimony:        ['story', 'quote', 'text'],
  faq:              ['question', 'answer'],
  detail:           ['value', 'text'],
  key_phrase:       ['value', 'text', 'phrase'],
  tier:             ['value', 'text', 'name'],
  doctrine:         ['value', 'text', 'statement'],
  scripture:        ['reference', 'text', 'verse'],
  sermon:           ['title', 'name'],
  event:            ['name', 'title'],
  staff:            ['name', 'title'],
  program:          ['name', 'title'],
  newsletter_issue: ['title', 'date'],
  contact_block:    ['phone', 'email', 'address'],
  location_info:    ['address', 'name'],
  meeting_time:     ['when', 'time', 'day'],
  cta:              ['url', 'label'],     // CTAs have their own isBrokenCta gate too
  link:             ['url', 'label'],
}

const META_KEYS = new Set(['kind', 'source_url', 'source_urls', 'audience'])

function hasSubstance(item: Item): boolean {
  const r = item as Record<string, unknown>
  const kind = String(r.kind ?? '')
  const required = SUBSTANCE_FIELDS[kind]
  if (required) {
    // Item has at least one filled primary field for its kind?
    for (const f of required) {
      const v = r[f]
      if (typeof v === 'string' && v.trim().length > 0) return true
      if (Array.isArray(v) && v.length > 0) return true
      if (v && typeof v === 'object' && Object.keys(v).length > 0) return true
    }
    return false
  }
  // Unknown kind ('other' / unclassified) — keep if ANY non-meta
  // field has a non-empty value. The catch-all guard.
  for (const [k, v] of Object.entries(r)) {
    if (META_KEYS.has(k)) continue
    if (typeof v === 'string' && v.trim().length > 0) return true
    if (Array.isArray(v) && v.length > 0) return true
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return true
  }
  return false
}

/**
 * Collapse `details` items ({label, value}) + supplied label/value pairs
 * into one entry per unique value. Skips blank values, {{placeholder}}
 * expansions, and any value matching an FAQ Q/A. Order follows first
 * appearance.
 */
function consolidateLabeledValues(
  detailItems: Item[],
  extras: { label: string; value: string }[],
  faqQAs: Set<string>,
): ConsolidatedEntry[] {
  const byValue = new Map<string, ConsolidatedEntry>()
  const push = (rawLabel: string, rawValue: string) => {
    const value = String(rawValue ?? '').trim()
    if (!value) return
    if (isBrokenValue(value)) return
    if (faqQAs.has(normValue(value))) return
    const key = normValue(value)
    let entry = byValue.get(key)
    if (!entry) {
      entry = { value, labels: [] }
      byValue.set(key, entry)
    }
    const label = String(rawLabel ?? '').trim()
    if (label && !entry.labels.some(l => normValue(l) === normValue(label))) {
      entry.labels.push(label)
    }
  }
  for (const d of detailItems) push(String(d.label ?? ''), String(d.value ?? ''))
  for (const e of extras) push(e.label, e.value)
  return dedupeTimeBearingEntries(Array.from(byValue.values()))
}

/** Time-aware second pass on consolidated detail entries. Multiple
 *  detail rows often describe the same service-time schedule with
 *  different formatting ("Service Times: 9 AM and 11 AM" vs
 *  "Main Service Times: 9:00 AM & 11:00 AM"). Showing both misleads
 *  copywriters into thinking the church has different schedules and
 *  forces them to choose a format. This pass keeps only the entry
 *  with the MOST distinct time mentions; ties prefer the longest
 *  string (usually the more-completely-formatted version from the
 *  crawl). All other time-bearing entries get dropped.
 *
 *  Non-time entries pass through untouched. */
function dedupeTimeBearingEntries(entries: ConsolidatedEntry[]): ConsolidatedEntry[] {
  const TIME_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi
  const timeBearing = entries
    .map((entry, idx) => {
      const matches = entry.value.match(TIME_RE) ?? []
      // Normalize each time to a comparable form so "9 AM" and
      // "9:00 AM" count as the same distinct time. Otherwise the
      // longer format would always "win" by virtue of formatting,
      // not richness.
      const normTimes = new Set(matches.map(m =>
        m.toLowerCase().replace(/\s+/g, '').replace(/:00/, '')))
      return { entry, idx, distinctTimes: normTimes.size, length: entry.value.length }
    })
    .filter(r => r.distinctTimes > 0)
  if (timeBearing.length <= 1) return entries
  // Pick the winner: most distinct times, then longest value as
  // tiebreaker (richer formatting wins when count is equal).
  timeBearing.sort((a, b) =>
    (b.distinctTimes - a.distinctTimes) || (b.length - a.length))
  const winner = timeBearing[0].entry
  const losers = new Set(timeBearing.slice(1).map(r => r.entry))
  return entries.filter(e => e === winner || !losers.has(e))
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled'
}

// ── Weekly-lesson detail detector ────────────────────────────────────
//
// The categorizer's crawl pulls per-week lesson resources (Sunday school
// curriculum, character-trait series, etc.) onto whatever ministry topic
// page they sit under, then emits each lesson's metadata as
// kind='detail' items at the topic root. The result: ministry-level
// inventory polluted with "Lesson Date: November 23", "Memory Verse:
// Ephesians 4:32", "Character Trait Theme: Contentment (Week 4)", and
// dozens of other one-week-only facts that don't belong as top-level
// truth about, say, the Kids Ministry.
//
// We detect these by label, not by value, since the labels are
// LLM-extracted from the page and reliably echo the lesson curriculum's
// vocabulary. Anything matching gets routed into a collapsed
// "Weekly lesson details" sub-section so the partner can ignore or
// bulk-skip them without losing legitimate ministry facts above.
const WEEKLY_LESSON_LABEL_PATTERNS: RegExp[] = [
  /\blesson\s*(date|topic|title|name)\b/i,
  /\bmemory\s*verse\b/i,
  /\bteaching\s*truth\b/i,
  /\bscripture\s*reference\b/i,
  /\bcharacter\s*trait\b/i,           // covers Character Trait, Character Trait Theme/Focus/Definition
  /\btrait\s*definition\b/i,
  /\bfamily\s*activity\b/i,
  /\bwrap[\s-]*up\b/i,
  /\bweek\b/i,                        // "Week" / "Week 3" / "Weekly Resource" labels
  /\bpage\s*(subject|type)\b/i,
  /\bresource\s*(type|source)\b/i,
  /\bactivity\s*(name|description)\b/i,
  /\bdiscussion\s*question/i,
]
function isWeeklyLessonDetail(entry: ConsolidatedEntry): boolean {
  if (entry.labels.length === 0) return false
  return entry.labels.some(l => WEEKLY_LESSON_LABEL_PATTERNS.some(re => re.test(l)))
}

// ── Weekly-resource program detector ─────────────────────────────────
//
// The categorizer promotes weekly lesson pages (e.g. "Elementary //
// Contentment Week 2 Resource", "Unit 4 Lesson 2", "November 16 //
// Israel Wants a King") to top-level programs. They're not ministry
// programs — they're discrete weekly material from a series. Group
// them into a collapsed sub-section.
//
// Two signals:
//   1. NAME pattern — week N / unit N / lesson N / "resource(s)" /
//      "// " topic-marker / month-day date prefix.
//   2. SOURCE URL pattern — paths under /kids-resource, /lesson-N,
//      /unit-N, /week-N, /sermon-notes, etc. Catches "Evangelism
//      Sunday" or "Kindness Alphabet Activity" — names that don't
//      look resource-shaped but live on a resource page.
const RESOURCE_NAME_PATTERNS: RegExp[] = [
  /\bweek\s*\d+\b/i,                            // "Week 2"
  /\bunit\s*\d+\b/i,                            // "Unit 4"
  /\blesson\s*\d+\b/i,                          // "Lesson 2"
  /\bresources?\b/i,                            // "Resource" or "Resources" — plural was missed
  /\/\/.*\b(week|unit|lesson)\b/i,              // "Elementary // Contentment Week 2"
  /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\s+\d{1,2}\b/i,  // "November 16 //" date-prefix
  /\bday\s+\d+\b/i,                             // "Day 3"
  /\bsession\s+\d+\b/i,                         // "Session 2"
]
const RESOURCE_URL_PATTERNS: RegExp[] = [
  /\/(kids|youth|students?|family|adult|womens?|mens?)-?resource/i,  // /kids-resource, /youth-resource
  /\/resource(?:s|-|\/)/i,                      // /resources, /resource-, /resource/
  /\/unit-?\d+/i,                               // /unit-3, /unit3
  /\/week-?\d+/i,                               // /week-2, /week2
  /\/lesson-?\d+/i,                             // /lesson-4, /lesson4
  /\/sermon-?notes?/i,                          // /sermon-notes
  /\/memory-?verse/i,                           // /kids-memory-verse-songs etc
  /\/(self-control|kindness|purpose|contentment|joy|love|patience|gentleness|faithfulness|peace|goodness)-?week\d*/i,  // character trait series
]
function isWeeklyResourceProgram(program: Item): boolean {
  const name = String(program.name ?? program.title ?? '').trim()
  if (name && RESOURCE_NAME_PATTERNS.some(re => re.test(name))) return true
  const sourceUrl = String(program.source_url ?? '').trim()
  if (sourceUrl) {
    let path = sourceUrl
    try { path = new URL(sourceUrl).pathname } catch { /* keep raw */ }
    if (RESOURCE_URL_PATTERNS.some(re => re.test(path))) return true
  }
  return false
}

// ── Collapsible sub-section (used inside inventory Sections) ────────
function CollapsibleSubsection({
  reviewMode, title, hint, forceOpen, children,
}: {
  reviewMode: boolean
  title:      string
  hint?:      string
  /** When true, the body stays open regardless of the user's toggle.
   *  Used by group-edit scopes so the Save-all path reaches rows
   *  hidden inside collapsed accordions. */
  forceOpen?: boolean
  children:   React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open
  return (
    <div className={reviewMode ? 'mt-3 rounded-md border border-lavender/60 bg-cream/30' : 'mt-3 rounded-md border border-wm-border bg-wm-bg-hover/30'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={reviewMode
          ? 'w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-cream/60 rounded-md'
          : 'w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-wm-bg-hover/50 rounded-md'}
      >
        <span className="flex items-center gap-2">
          <Layers size={11} className={reviewMode ? 'text-purple-gray' : 'text-wm-text-muted'} />
          <span className={reviewMode
              ? 'text-[11px] uppercase tracking-widest font-bold text-deep-plum'
              : 'text-[11px] uppercase tracking-widest font-bold text-wm-text'}>
            {title}
          </span>
        </span>
        {isOpen ? <ChevronUp size={12} className={reviewMode ? 'text-purple-gray' : 'text-wm-text-muted'} />
                : <ChevronDown size={12} className={reviewMode ? 'text-purple-gray' : 'text-wm-text-muted'} />}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-1">
          {hint && (
            <p className={reviewMode ? 'text-[11px] text-purple-gray mb-2 leading-snug' : 'text-[11px] text-wm-text-muted mb-2 leading-snug'}>
              {hint}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

function renderCell(v: unknown): React.ReactNode {
  if (v == null) return null
  if (typeof v === 'string') {
    if (isUrl(v)) return <a href={v} target="_blank" rel="noopener noreferrer" className="hover:underline font-mono">{v.length > 60 ? v.slice(0, 57) + '…' : v}</a>
    return v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v).slice(0, 200)
}
