/**
 * /dev/feedback-preview — fixture-driven preview surface for the new
 * feedback UI primitives. Mounts the same `FeedbackBoardColumn`,
 * `FeedbackBoardVerticalList`, and `FeedbackBoardKanban` components
 * the rail and tab will use, but against in-memory boards so the
 * design can iterate without touching real reviews.
 *
 * State mutations are no-ops (we mock `onChanged`); the page is
 * read-only.
 */
import { useState } from 'react'
import { FeedbackBoardKanban } from '../components/wm/feedback/FeedbackBoardKanban'
import { FeedbackBoardVerticalList } from '../components/wm/feedback/FeedbackBoardVerticalList'
import { FeedbackTabs } from '../components/wm/feedback/FeedbackTabs'
import { AssigneeFilter } from '../components/wm/feedback/AssigneeFilter'
import type {
  FeedbackBoard, FeedbackAssignee, ProjectFeedbackBoards,
} from '../lib/webReviews'
import type {
  WebReviewComment, WebReviewEdit,
} from '../types/database'

const PAGE_LABELS: Record<string, string> = {
  page_home: 'Homepage',
  page_about: 'About',
  page_events: 'Events',
  page_give: 'Give',
  page_connect: 'Connect',
}
const SECTION_LABELS: Record<string, string> = {
  sec_hero: 'Hero section',
  sec_mission: 'Our Mission',
  sec_eventgrid: 'Event card grid',
  sec_givecta: 'Giving CTA',
  sec_connectform: 'Form module',
}

const NOW = new Date().toISOString()

function makeComment(over: Partial<WebReviewComment>): WebReviewComment {
  return {
    id: crypto.randomUUID(),
    review_id: 'fixture-review',
    web_page_id: 'page_home',
    web_section_id: 'sec_hero',
    field_key: 'heading',
    author_kind: 'staff',
    author_user_id: null,
    author_external_name: 'Spencer Park',
    kind: 'comment',
    body: 'The hero headline feels a bit corporate. Can we lean into something warmer that speaks to families visiting for the first time?',
    original_value: null,
    suggested_value: null,
    status: 'open',
    resolved_by_user_id: null,
    resolved_by_name: null,
    resolved_at: null,
    resolution_note: null,
    category: null,
    assignee_user_id: null,
    assignee_name: null,
    assignee_email: null,
    due_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function makeBoard(over: Partial<FeedbackBoard>, comments: WebReviewComment[]): FeedbackBoard {
  const total    = comments.length
  const resolved = comments.filter(c => c.status !== 'open').length
  return {
    reviewId: crypto.randomUUID(),
    kind: 'partner',
    roundNumber: 1,
    label: 'Partner R1',
    status: 'open_for_review',
    startedAt: NOW,
    startedByName: null,
    partnerName: 'Bennett Rhodes',
    partnerToken: null,
    comments,
    edits: [] as WebReviewEdit[],
    counts: { open: total - resolved, resolved, total },
    ...over,
  }
}

const fixtureBoards: FeedbackBoard[] = [
  makeBoard(
    { kind: 'partner', roundNumber: 1, label: 'Partner R1', status: 'open_for_review',
      partnerName: 'Bennett Rhodes' },
    [
      makeComment({ web_page_id: 'page_home', web_section_id: 'sec_hero',
        author_external_name: 'Bennett Rhodes', author_kind: 'partner' }),
      makeComment({
        kind: 'suggested',
        author_external_name: 'Pastor Reyes', author_kind: 'partner',
        web_page_id: 'page_about', web_section_id: 'sec_mission',
        field_key: 'body',
        body: "Could we swap 'community' for 'family'? It's the language we use from the stage and across all our printed materials.",
        suggested_value: 'family',
        category: 'content',
        assignee_user_id: 'u1',
        assignee_name: 'Ashley S.',
        due_at: new Date(Date.now() + 4 * 86400000).toISOString(),
      }),
      makeComment({
        web_page_id: 'page_events', web_section_id: 'sec_eventgrid',
        author_external_name: 'Bennett Rhodes', author_kind: 'partner',
        body: 'Event cards feel too tight on mobile — would love a bit more breathing room between the date and title.',
        category: 'design',
        assignee_user_id: 'u2',
        assignee_name: 'Emily M.',
        due_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      }),
    ],
  ),
  makeBoard(
    { kind: 'internal', roundNumber: 2, label: 'Internal R2', status: 'editing_content',
      startedByName: 'Ashley S.' },
    [
      makeComment({
        kind: 'suggested', status: 'amended',
        author_external_name: 'Spencer Park',
        web_page_id: 'page_give', web_section_id: 'sec_givecta',
        body: "The CTA copy reads transactional. Let's reframe around generosity and impact, not the act of donating.",
        category: 'content',
        resolved_by_name: 'Ashley S.', resolved_at: NOW,
        assignee_user_id: 'u1', assignee_name: 'Ashley S.',
      }),
      makeComment({
        kind: 'comment',
        author_external_name: 'Amber Mills',
        web_page_id: 'page_connect', web_section_id: 'sec_connectform',
        body: 'Field labels are floating awkwardly above the inputs at smaller sizes — needs tightening.',
        category: 'design',
        assignee_user_id: 'u2', assignee_name: 'Emily M.',
      }),
    ],
  ),
  makeBoard(
    { kind: 'partner', roundNumber: 2, label: 'Partner R2', status: 'on_hold',
      partnerName: 'Bennett Rhodes' },
    [],
  ),
  makeBoard(
    { kind: 'internal', roundNumber: 1, label: 'Internal R1', status: 'completed' },
    [
      makeComment({
        kind: 'suggested', status: 'applied',
        author_external_name: 'Spencer Park',
        web_page_id: 'page_home', web_section_id: 'sec_hero',
        body: 'Mobile nav is hard to tap one-handed. Move the menu trigger to the right side so it lines up with thumb reach.',
        category: 'design',
        resolved_by_name: 'Emily M.', resolved_at: NOW,
        assignee_user_id: 'u2', assignee_name: 'Emily M.',
      }),
    ],
  ),
]

const fixtureAssignees: FeedbackAssignee[] = [
  { id: 'u1', name: 'Ashley S.', email: 'ashley@example.com' },
  { id: 'u2', name: 'Emily M.',  email: 'emily@example.com' },
]

const fixtureBundle: ProjectFeedbackBoards = {
  boards: fixtureBoards,
  byTab: {
    all: fixtureBoards,
    ...Object.fromEntries(fixtureBoards.map(b => [`${b.kind}-${b.roundNumber}`, [b]])),
  },
  assignees: fixtureAssignees,
}

const pageNameFor    = (id: string) => PAGE_LABELS[id] ?? null
const sectionLabelFor = (id: string | null) => (id ? SECTION_LABELS[id] : null)

export default function FeedbackPreviewPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [selectedAssignees, setSelectedAssignees] = useState<Set<string>>(new Set())
  const refresh = async () => { /* no-op for fixtures */ }

  const visibleBoards = activeTab === 'all'
    ? fixtureBundle.boards
    : fixtureBundle.byTab[activeTab] ?? []

  const filter = selectedAssignees.size === 0
    ? undefined
    : (c: WebReviewComment) => {
        const id = c.assignee_user_id ?? c.assignee_email ?? c.assignee_name ?? ''
        return selectedAssignees.has(id)
      }

  return (
    <div className="wm-theme bg-wm-bg min-h-screen text-wm-text p-8">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">Feedback preview</h1>
          <p className="text-[13px] text-wm-text-muted">
            Fixture-driven render of the new feedback primitives. Mutations are mocked.
          </p>
        </header>

        <section className="flex items-center gap-3 flex-wrap">
          <AssigneeFilter
            available={fixtureBundle.assignees}
            selectedIds={selectedAssignees}
            onChange={setSelectedAssignees}
          />
          <FeedbackTabs
            boards={fixtureBundle}
            active={activeTab}
            onChange={setActiveTab}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] uppercase tracking-widest font-semibold text-wm-text-subtle">
            Kanban (Review tab)
          </h2>
          <FeedbackBoardKanban
            boards={visibleBoards}
            pageNameFor={pageNameFor}
            sectionLabelFor={sectionLabelFor}
            onChanged={refresh}
            filter={filter}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-6">
          <div />
          <div className="flex flex-col gap-2">
            <h2 className="text-[11px] uppercase tracking-widest font-semibold text-wm-text-subtle">
              Vertical (side rail)
            </h2>
            <FeedbackBoardVerticalList
              boards={visibleBoards}
              pageNameFor={pageNameFor}
              sectionLabelFor={sectionLabelFor}
              onChanged={refresh}
              filter={filter}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
