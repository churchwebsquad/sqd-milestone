/**
 * Active partner-facing review links for a given member.
 *
 * The milestone submission form's asset picker surfaces these so a
 * staffer can attach (for example) "Website Content Collection" as
 * an asset with one click — the URL is the partner's actual portal
 * link, no copy-pasting from the WM workspace.
 *
 * Scope is the partner's most-recent unarchived web project (same
 * "current project" convention the auto-advance trigger uses). When
 * more review surfaces graduate to the hub (copy review, brand
 * handoff), add a new resolver below; the picker auto-renders any
 * link returned.
 */
import { supabase } from './supabase'

export type PartnerReviewLinkSource =
  | 'content_collection'
  | 'sitemap_review'
  | 'web_partner_review'

/** Lifecycle state for a review, from the partner's perspective.
 *  Drives which section the card renders in on the Partner Hub
 *  (outstanding vs completed) and which pill it wears. */
export type PartnerReviewLinkState = 'outstanding' | 'submitted' | 'approved'

export interface PartnerReviewLink {
  /** Stable id, used as the dropdown <option value>. */
  id:     string
  /** Display label — also stamped onto asset_label so the merge
   *  field renders `[Website Content Collection](url)`. */
  label:  string
  url:    string
  source: PartnerReviewLinkSource
  /** Partner-facing sub-headline. Used on the Partner Hub to give
   *  each outstanding-review card a one-line "what this is" beneath
   *  its title. Optional; consumers that don't need it (asset picker)
   *  ignore it. */
  description?: string
  /** Lifecycle state — the hub splits cards by this. `outstanding`
   *  is still waiting on the partner; `submitted` means partner has
   *  sent it in but staff hasn't finalized; `approved` means locked
   *  as canonical. */
  state: PartnerReviewLinkState
  /** Target-submission date (content collection only). Used to show
   *  a due badge on outstanding cards. Ignored once state !=
   *  outstanding. ISO string. */
  due_at?:       string | null
  /** When the partner submitted / approved. Used to stamp completed
   *  cards. ISO string. */
  submitted_at?: string | null
  /** Round number for this review, when the surface tracks rounds.
   *  - Web partner review carries `round_number` from web_reviews
   *    (auto-incremented per project + kind on insert).
   *  - Content collection is round = count of sessions to date.
   *  - Sitemap review is a single ongoing artifact — no rounds — so
   *    the field stays undefined and the sidebar card omits the pill.
   */
  round?: number
}

/** Fetch every live partner review link for this member — both
 *  outstanding and already-submitted. Each link carries a `state`
 *  the hub uses to decide which section it renders in. Closed /
 *  archived items are filtered out (they don't belong on a partner
 *  dashboard). Returns an empty array on any miss (no project, no
 *  portal token, nothing live) — callers render conditionally. */
export async function fetchPartnerReviewLinks(
  memberNumber: number,
): Promise<PartnerReviewLink[]> {
  if (!Number.isFinite(memberNumber) || memberNumber <= 0) return []

  // Resolve the active web project + the partner's portal token.
  const [projectRes, apRes] = await Promise.all([
    supabase
      .from('strategy_web_projects')
      .select('id')
      .eq('member', memberNumber)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('strategy_account_progress')
      .select('portal_token')
      .eq('member', memberNumber)
      .maybeSingle(),
  ])
  const projectId   = projectRes.data?.id   ?? null
  const portalToken = apRes.data?.portal_token ?? null
  if (!projectId) return []

  const origin = window.location.origin
  const links: PartnerReviewLink[] = []

  // ── Content collection ─────────────────────────────────────────
  // Needs the partner's portal token; the public URL embeds both
  // token and session id. We surface the latest non-closed session
  // and let the hub sort it by `state`:
  //   'open'      → outstanding (still on the partner's plate)
  //   'submitted' → submitted   (partner has sent it in)
  //   'closed'    → filtered out (staff has archived it)
  if (portalToken) {
    // Pull every session for this project (any status, chronological)
    // so we can both surface the latest AND compute the round number
    // (= 1-based index of the latest session in the ordered list).
    // Closed sessions still count as prior rounds — a partner in
    // round 2 shouldn't reset just because we archived round 1.
    const ccRes = await supabase
      .from('strategy_content_collection_sessions')
      .select('id, status, due_at, submitted_at, created_at')
      .eq('web_project_id', projectId)
      .order('created_at', { ascending: true })
    const sessions = ccRes.data ?? []
    const liveSessions = sessions.filter(s => s.status !== 'closed')
    const latest = liveSessions.length > 0 ? liveSessions[liveSessions.length - 1] : null
    if (latest?.id) {
      const state: PartnerReviewLinkState =
        latest.status === 'submitted' ? 'submitted' : 'outstanding'
      // Round = 1-based index of the latest session across ALL history
      // for this project, so a re-opened round shows as round 2 even
      // if round 1 was closed.
      const round = sessions.findIndex(s => s.id === latest.id) + 1
      links.push({
        id:           `content_collection:${latest.id}`,
        label:        'Website Content Collection',
        description:  'Review what we found on your current site, tell us what to update or leave alone, and answer a few questions about how you\'d like the new site to work.',
        url:          `${origin}/portal/${portalToken}/hub/content-collection/${latest.id}`,
        source:       'content_collection',
        state,
        due_at:       latest.due_at ?? null,
        submitted_at: latest.submitted_at ?? null,
        round:        round > 0 ? round : undefined,
      })
    }
  }

  // ── Sitemap & Navigation review ────────────────────────────────
  // Token + status live under roadmap_state.sitemap_review. Only
  // surfaced once the strategist has published the review; drafts
  // stay hidden from the partner. Status categorization:
  //   'published'        → outstanding (waiting on partner)
  //   'partner_reviewed' → submitted   (partner sent feedback)
  //   'approved'         → approved    (locked as canonical)
  const smRes = await supabase
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  const smRaw = smRes.data?.roadmap_state as {
    sitemap_review?: { token?: string; status?: string; approved_at?: string; partner_reviewed_at?: string }
  } | null
  const sm = smRaw?.sitemap_review
  const smState: PartnerReviewLinkState | null =
    sm?.status === 'published'        ? 'outstanding' :
    sm?.status === 'partner_reviewed' ? 'submitted'   :
    sm?.status === 'approved'         ? 'approved'    :
    null
  if (sm?.token && smState) {
    links.push({
      id:           `sitemap_review:${sm.token}`,
      label:        'Content Strategy Review',
      description:  'The pages we\'re planning for your new site, how the navigation groups them, and who each one is for. Tell us what to rename, move, or add.',
      url:          `${origin}/portal/sitemap/${sm.token}`,
      source:       'sitemap_review',
      state:        smState,
      submitted_at: sm.approved_at ?? sm.partner_reviewed_at ?? null,
    })
  }

  // ── Web partner review ─────────────────────────────────────────
  // Partner-kind review for this project. We now include closed
  // rows so the completed section can show finished reviews.
  //   no_status | open_for_review | editing_content | open → outstanding
  //   on_hold                                              → outstanding (staff pause, partner card still visible)
  //   completed | closed                                   → submitted
  const wrRes = await supabase
    .from('web_reviews')
    .select('partner_token, status, closed_at, round_number')
    .eq('web_project_id', projectId)
    .eq('kind', 'partner')
    .not('partner_token', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (wrRes.data?.partner_token) {
    const wrStatus = wrRes.data.status
    const wrState: PartnerReviewLinkState =
      wrStatus === 'completed' || wrStatus === 'closed' ? 'submitted' : 'outstanding'
    const wrRound = typeof wrRes.data.round_number === 'number' && wrRes.data.round_number > 0
      ? wrRes.data.round_number
      : undefined
    links.push({
      id:           `web_partner_review:${wrRes.data.partner_token}`,
      label:        'Website Content Review',
      description:  'Walk through the drafted pages, suggest specific edits, and leave notes for the team.',
      url:          `${origin}/portal/review/${wrRes.data.partner_token}`,
      source:       'web_partner_review',
      state:        wrState,
      submitted_at: wrRes.data.closed_at ?? null,
      round:        wrRound,
    })
  }

  return links
}
