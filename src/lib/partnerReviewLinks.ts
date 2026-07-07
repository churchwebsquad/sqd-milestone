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
}

/** Fetch every open partner review link for this member. Returns
 *  an empty array on any miss (no project, no portal token, no
 *  open sessions) — callers render conditionally. */
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
  // Needs both an open session AND the partner's portal token; the
  // public URL embeds both. If either is missing the link can't be
  // assembled, so we skip silently.
  if (portalToken) {
    const ccRes = await supabase
      .from('strategy_content_collection_sessions')
      .select('id')
      .eq('web_project_id', projectId)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ccRes.data?.id) {
      links.push({
        id:          `content_collection:${ccRes.data.id}`,
        label:       'Website Content Collection',
        description: 'Review what we found on your current site, tell us what to update or leave alone, and answer a few questions about how you\'d like the new site to work.',
        url:         `${origin}/portal/${portalToken}/hub/content-collection/${ccRes.data.id}`,
        source:      'content_collection',
      })
    }
  }

  // ── Sitemap & Navigation review ────────────────────────────────
  // Token + status live under roadmap_state.sitemap_review. Only
  // surfaced once the strategist has published the review; drafts
  // stay hidden from the partner. Uses its own token in the URL
  // (roadmap_state.sitemap_review.token), which the sitemap portal
  // page resolves via the get_sitemap_review_by_token RPC.
  const smRes = await supabase
    .from('strategy_web_projects')
    .select('roadmap_state')
    .eq('id', projectId)
    .maybeSingle()
  const smRaw = smRes.data?.roadmap_state as { sitemap_review?: { token?: string; status?: string } } | null
  const sm    = smRaw?.sitemap_review
  const smVisible = sm?.status === 'published' || sm?.status === 'partner_reviewed'
  if (sm?.token && smVisible) {
    links.push({
      id:          `sitemap_review:${sm.token}`,
      label:       'Sitemap & Navigation Review',
      description: 'The pages we\'re planning for your new site, how the navigation groups them, and who each one is for. Tell us what to rename, move, or add.',
      url:         `${origin}/portal/sitemap/${sm.token}`,
      source:      'sitemap_review',
    })
  }

  // ── Web partner review ─────────────────────────────────────────
  // Open partner-kind review for this project — token alone is
  // enough; the portal page resolves project/member from the token.
  const wrRes = await supabase
    .from('web_reviews')
    .select('partner_token')
    .eq('web_project_id', projectId)
    .eq('kind', 'partner')
    .in('status', ['no_status', 'open_for_review', 'editing_content', 'open'])
    .not('partner_token', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (wrRes.data?.partner_token) {
    links.push({
      id:          `web_partner_review:${wrRes.data.partner_token}`,
      label:       'Website Content Review',
      description: 'Walk through the drafted pages, suggest specific edits, and leave notes for the team.',
      url:         `${origin}/portal/review/${wrRes.data.partner_token}`,
      source:      'web_partner_review',
    })
  }

  return links
}
