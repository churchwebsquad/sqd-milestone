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
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Mic2, ClipboardList, Sparkles, HelpCircle, Quote, ArrowRight, BookOpen,
  ExternalLink, CheckCircle2, Edit3, Circle,
  Calendar, MapPin, MessageCircle, ListChecks, Hash, Plus,
  ChevronDown, ChevronUp, AlertCircle, Loader2,
} from 'lucide-react'
import { PARTNER_GROUPS, type PartnerBucket } from '../../../lib/webPartnerGroups'
import { computeBaselineCoverage, type BaselineCoverage } from '../../../lib/webPartnerBaselines'

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

export type MarkStatus = 'approved' | 'outdated' | 'approved_keep_as_is'
export interface Mark {
  target_kind:   string
  target_path:   string
  status:        MarkStatus
  client_note:   string | null
}

export type SaveMark = (
  path: string,
  kind: 'topic' | 'program' | 'topic_item' | 'missing_program',
  status: MarkStatus,
  note?: string | null,
  extra?: { proposed_program_name?: string | null; proposed_program_description?: string | null },
) => Promise<void>

interface Props {
  topicsByKey:      Map<string, TopicRow>
  snippetsByToken?: Map<string, SnippetRow>
  reviewMode?:      boolean
  marks?:           Map<string, Mark>
  saveMark?:        SaveMark
}

// ── Top-level component ──────────────────────────────────────────────

export function InventoryView({
  topicsByKey, snippetsByToken, reviewMode = false, marks, saveMark,
}: Props) {
  const tocEntries = useMemo(() => buildTocEntries(topicsByKey), [topicsByKey])
  // Accordion open-key is shared between the side TOC and the
  // accordion itself so TOC clicks can open the target group BEFORE
  // scrolling — without this the bucket element doesn't exist in the
  // DOM when collapsed, and scrollIntoView silently does nothing.
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(PARTNER_GROUPS[0]?.key ?? null)
  return (
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

  return (
    <>
      {filteredGroups.map(g => (
        <ReviewGroupAccordion
          key={g.key}
          group={g}
          isOpen={openKey === g.key}
          onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
          topicsByKey={topicsByKey}
          snippetsByToken={snippetsByToken}
          marks={marks}
          saveMark={saveMark}
        />
      ))}
    </>
  )
}

function ReviewGroupAccordion({
  group, isOpen, onToggle, topicsByKey, snippetsByToken, marks, saveMark,
}: {
  group:           import('../../../lib/webPartnerGroups').PartnerGroup
  isOpen:          boolean
  onToggle:        () => void
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

  // Staff-supplied or empty buckets show a compact card
  if (!hasContent && bucket.staffSupplied) {
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
  // first and can opt in to verify the inventory.
  const [foundOpen, setFoundOpen] = useState(coverage.length === 0)

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
        {saveMark && <AddMissingButton bucketKey={bucket.key} groupLabel={bucket.label} saveMark={saveMark} marks={marks} />}
      </article>
    )
  }

  return (
    <article id={`bucket:${bucket.key}`} className="bg-white border border-lavender rounded-2xl overflow-hidden scroll-mt-24">
      <header className="px-4 md:px-5 py-3 border-b border-lavender bg-lavender-tint/20">
        <p className="text-deep-plum font-semibold">{bucket.label}</p>
      </header>
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
                  />
                ))}
              </div>
            )}
          </div>
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
    </article>
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
  // Initial value priority: partner's saved answer > extracted prefill > empty.
  const persisted = existingMark?.client_note ?? null
  const [value,  setValue]  = useState(persisted ?? coverage.prefill ?? '')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Re-sync if the mark changes externally (e.g. another tab saved).
  useEffect(() => {
    const next = existingMark?.client_note ?? coverage.prefill ?? ''
    setValue(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingMark?.client_note, coverage.prefill])

  const save = async () => {
    if (!saveMark) return
    const trimmed = value.trim()
    // Don't save if value matches the prefill AND no partner edit exists yet
    // — implicit approval means "no edit needed."
    const prefill = coverage.prefill ?? ''
    if (!persisted && trimmed === prefill.trim()) return
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

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-bold text-purple-gray mb-1">
        {coverage.field.label}
      </label>
      {isLongField ? (
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          rows={lines}
          placeholder={coverage.field.description}
          className="w-full rounded-lg border border-lavender bg-cream/40 px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:bg-white resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          placeholder={coverage.field.description}
          className="w-full rounded-lg border border-lavender bg-cream/40 px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:bg-white"
        />
      )}
      {(saving || savedFlash) && (
        <div className="flex items-center justify-end mt-0.5 min-h-[14px]">
          {saving && <Loader2 size={10} className="animate-spin text-purple-gray" />}
          {savedFlash && !saving && (
            <span className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5">
              <CheckCircle2 size={10} /> Saved
            </span>
          )}
        </div>
      )}
    </div>
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
          We always collect
        </p>
        <p className={reviewMode
            ? 'text-xs font-semibold text-deep-plum'
            : 'text-[11px] font-semibold text-wm-text'}>
          {filled} of {total} found
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
  topic, programScope, snippetsByToken, reviewMode,
}: {
  topic:            TopicRow
  programScope?:    'local' | 'global'
  snippetsByToken?: Map<string, SnippetRow>
  reviewMode:       boolean
}) {
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
      switch (it.kind) {
        case 'program':           if (!programScope || it.scope === programScope) programs.push(it); break
        case 'detail':            details.push(it); break
        case 'faq':               faqs.push(it); break
        case 'key_phrase':
        case 'tier':
        case 'doctrine':          keyPhrases.push(it); break
        case 'cta':
        case 'link':              if (!isBrokenCta(it) && (!reviewMode || isExternalCta(it))) ctas.push(it); break
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
  }, [topic.items, programScope, reviewMode])

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
      className={reviewMode ? 'border-l-4 border-primary-purple/30 pl-4 md:pl-5' : 'border-l-2 border-wm-accent/30 pl-3'}
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

      {/* Details — consolidated detail items + snippets + passages.
          Raw passages (PassageRow) are hidden in reviewMode because
          they were the noisy "/url/  ·  ‘quoted text’" rows that
          didn't map to any baseline field. The values that DO matter
          already feed the form prefills via baseline extractors. */}
      {(consolidatedDetails.length > 0 || (!reviewMode && dedupedPassages.length > 0)) && (
        <Section reviewMode={reviewMode} icon={ClipboardList} title="Details">
          {consolidatedDetails.length > 0 && (
            <div className="space-y-2">
              {consolidatedDetails.map((d, i) => <ConsolidatedDetailRow key={`d-${i}`} entry={d} reviewMode={reviewMode} />)}
            </div>
          )}
          {!reviewMode && dedupedPassages.length > 0 && (
            <div className={(consolidatedDetails.length > 0 ? 'mt-3' : '') + ' space-y-2'}>
              {dedupedPassages.map((p, i) => <PassageRow key={`p-${i}`} passage={p} reviewMode={reviewMode} />)}
            </div>
          )}
        </Section>
      )}

      {/* Programs — each as a dossier */}
      {dedupedPrograms.length > 0 && (
        <Section reviewMode={reviewMode} icon={Sparkles} title={`Programs (${dedupedPrograms.length})`}>
          <div className="space-y-3">
            {dedupedPrograms.map((p, i) => (
              <ProgramDossier
                key={`prog-${i}`}
                program={p}
                reviewMode={reviewMode}
              />
            ))}
          </div>
        </Section>
      )}

      {/* FAQs */}
      {faqs.length > 0 && (
        <Section reviewMode={reviewMode} icon={HelpCircle} title={`FAQs (${faqs.length})`}>
          <div className="space-y-2">
            {faqs.map((f, i) => <FaqRow key={`f-${i}`} item={f} reviewMode={reviewMode} />)}
          </div>
        </Section>
      )}

      {/* Key Phrases */}
      {keyPhrases.length > 0 && (
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
      {dedupedStaff.length > 0 && (
        <Section reviewMode={reviewMode} icon={ListChecks} title={`Staff (${dedupedStaff.length})`}>
          <div className="space-y-2">{dedupedStaff.map((it, i) => <GenericRecordRow key={`st-${i}`} item={it} reviewMode={reviewMode} primary="name" />)}</div>
        </Section>
      )}
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
      {otherItems.length > 0 && (
        <Section reviewMode={reviewMode} icon={ListChecks} title={`Other (${otherItems.length})`}>
          <div className="space-y-2">{otherItems.map((it, i) => <GenericRecordRow key={`o-${i}`} item={it} reviewMode={reviewMode} />)}</div>
        </Section>
      )}

      {/* Sources */}
      {topic.source_page_urls.length > 0 && (
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

// ── Section wrapper (with optional review pill) ──────────────────────

function Section({
  reviewMode, icon: Icon, title, children,
}: {
  reviewMode: boolean
  icon:       typeof Mic2
  title:      string
  children:   React.ReactNode
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
  program, reviewMode,
}: {
  program:    Item
  reviewMode: boolean
}) {
  const name = String(program.name ?? 'Untitled program')
  const desc = String(program.description ?? '')

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
  const programCtas   = nestedItems.filter(i => i.kind === 'cta' || i.kind === 'link')
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
    <article className={reviewMode
        ? 'rounded-xl border border-primary-purple/20 bg-lavender-tint/15 p-4'
        : 'rounded-lg border border-wm-accent/20 bg-wm-accent-tint/15 p-3'}>
      {/* Program header — no per-program approval; partner approves at topic level */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <Sparkles size={13} className={reviewMode ? 'text-primary-purple' : 'text-wm-accent'} />
        <span className={reviewMode ? 'text-deep-plum font-bold text-base' : 'text-wm-text font-bold text-[13px]'}>{name}</span>
        {program.audience  ? <Pill text={String(program.audience)}  reviewMode={reviewMode} /> : null}
        {program.duration  ? <Pill text={String(program.duration)}  reviewMode={reviewMode} /> : null}
        {program.scope     ? <Pill text={String(program.scope).toUpperCase()} reviewMode={reviewMode} /> : null}
      </div>
      {program.tagline && (
        <p className={reviewMode ? 'text-sm italic text-primary-purple/80 mt-1' : 'text-[12px] italic text-wm-accent/80 mt-1'}>"{String(program.tagline)}"</p>
      )}

      {/* About */}
      {(desc || nestedPassages.length > 0) && (
        <DossierSlot icon={ClipboardList} title="About" reviewMode={reviewMode}>
          {desc && <p className={reviewMode ? 'text-sm text-deep-plum leading-snug' : 'text-[12px] text-wm-text leading-snug'}>{desc}</p>}
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
            {programDetails.map((d, i) => <ConsolidatedDetailRow key={`pd-${i}`} entry={d} reviewMode={reviewMode} />)}
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
              <ProgramDossier key={`sp-${i}`} program={sp} reviewMode={reviewMode} />
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
          <div className="space-y-2">{programFaqs.map((f, i) => <FaqRow key={i} item={f} reviewMode={reviewMode} />)}</div>
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
    </article>
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

function ConsolidatedDetailRow({ entry, reviewMode }: { entry: ConsolidatedEntry; reviewMode: boolean }) {
  const valueClass = reviewMode
    ? 'flex-1 text-deep-plum leading-snug whitespace-pre-line'
    : 'flex-1 text-wm-text leading-snug whitespace-pre-line'
  return (
    <div className={reviewMode
        ? 'flex gap-3 text-sm bg-cream/40 border border-lavender/60 rounded-md px-3 py-2'
        : 'flex gap-3 text-[12px] bg-wm-bg-hover/40 border border-wm-border rounded-md px-3 py-2'}>
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
      <div className={valueClass}>
        {isUrl(entry.value) ? (
          <a href={entry.value} target="_blank" rel="noopener noreferrer"
             className={reviewMode ? 'text-primary-purple hover:underline inline-flex items-center gap-0.5 font-mono text-xs break-all' : 'text-wm-accent hover:underline inline-flex items-center gap-0.5 font-mono text-[11px] break-all'}>
            {entry.value} <ExternalLink size={9} />
          </a>
        ) : entry.value}
      </div>
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

function FaqRow({ item, reviewMode }: { item: Item; reviewMode: boolean }) {
  return (
    <div className={reviewMode
        ? 'bg-cream/40 border border-lavender/60 rounded-md px-3 py-2'
        : 'bg-wm-bg-hover/40 border border-wm-border rounded-md px-3 py-2'}>
      <p className={reviewMode ? 'text-sm text-deep-plum font-semibold' : 'text-[12px] text-wm-text font-semibold'}>
        {String(item.question ?? '')}
      </p>
      <p className={reviewMode ? 'text-sm text-deep-plum/85 mt-1 leading-snug whitespace-pre-line' : 'text-[12px] text-wm-text/85 mt-1 leading-snug whitespace-pre-line'}>
        {String(item.answer ?? '')}
      </p>
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
        "{String(item.story ?? '')}"
      </p>
      {item.scripture_ref && (
        <p className={reviewMode ? 'text-[10px] font-mono text-primary-purple mt-1' : 'text-[10px] font-mono text-wm-accent mt-1'}>{String(item.scripture_ref)}</p>
      )}
    </div>
  )
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
  bucketKey, groupLabel, saveMark, marks, prefillField, compact,
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
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(prefillField?.label ?? '')
  const [desc, setDesc] = useState('')

  // Path scopes the uniqueness check — baseline-tied additions cluster
  // under their own prefix so a partner can add multiple entries to
  // the same baseline (e.g., several service times) without collision.
  const pathPrefix = prefillField
    ? `missing:${bucketKey}/baseline-${prefillField.key}-`
    : `missing:${bucketKey}/`
  const counter = Array.from(marks?.keys() ?? []).filter(k => k.startsWith(pathPrefix)).length

  const canSubmit = name.trim().length > 0 && desc.trim().length > 0
  const submit = async () => {
    if (!canSubmit) return
    const path = prefillField
      ? `${pathPrefix}${counter + 1}`
      : `missing:${bucketKey}/${slugify(name)}-${counter + 1}`
    await saveMark(path, 'missing_program', 'outdated', desc.trim(), {
      proposed_program_name: name.trim(),
      proposed_program_description: desc.trim(),
    })
    setName(prefillField?.label ?? ''); setDesc(''); setOpen(false)
  }

  const triggerCls = compact
    ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-primary-purple hover:underline'
    : 'w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-purple border border-dashed border-primary-purple/40 rounded-lg px-3 py-2 hover:border-primary-purple hover:bg-primary-purple/5 transition-colors'
  const triggerLabel = prefillField
    ? `Add ${prefillField.label.toLowerCase()}`
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
          <div>
            <label className="block text-[11px] font-bold text-deep-plum mb-1">
              What's it called? <span className="text-amber-600">*</span>
            </label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder={prefillField?.label ?? 'e.g. Wednesday Youth Night'}
              className="w-full text-sm border border-lavender bg-cream/30 rounded-md px-3 py-2 text-deep-plum focus:outline-none focus:border-primary-purple"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-deep-plum mb-1">
              Tell us about it <span className="text-amber-600">*</span>
            </label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)}
              placeholder={prefillField?.description
                ? `${prefillField.description}`
                : 'Who it\'s for, when it meets, where, and any key details you want included on the new site.'}
              rows={3}
              className="w-full text-sm border border-lavender bg-cream/30 rounded-md px-3 py-2 text-deep-plum focus:outline-none focus:border-primary-purple"
            />
            <p className="text-[11px] text-purple-gray mt-1">
              The more you share, the less back-and-forth later — we need this to write it up.
            </p>
          </div>
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

function isExternalCta(item: Item): boolean {
  const url = String(item.url ?? '').trim().toLowerCase()
  if (!url) return false
  if (url.startsWith('mailto:') || url.startsWith('tel:')) return true
  // Absolute http(s) urls are external by definition.
  if (/^https?:\/\//.test(url)) return true
  // Anything else (/path, #anchor, relative) is internal.
  return false
}

/** Item kinds where we filter out seasonal / one-off items in
 *  partner review (volunteers + events). Ministry programs can still
 *  legitimately reference seasonal terms in their description without
 *  being filtered. */
const SEASONAL_FILTERED_KINDS = new Set([
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
function renderCell(v: unknown): React.ReactNode {
  if (v == null) return null
  if (typeof v === 'string') {
    if (isUrl(v)) return <a href={v} target="_blank" rel="noopener noreferrer" className="hover:underline font-mono">{v.length > 60 ? v.slice(0, 57) + '…' : v}</a>
    return v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v).slice(0, 200)
}
