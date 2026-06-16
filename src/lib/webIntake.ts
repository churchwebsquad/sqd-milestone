/**
 * Intake-status helper for the Website Manager.
 *
 * The Intake page is a verification checklist. Three of the six
 * categories source from existing Supabase tables (which key on
 * `member`); the rest live in `web_intake_documents`. This module
 * fetches everything in parallel and returns a single shape the
 * page can render against.
 *
 * Hard stops (gate Content Manager): discovery_questionnaire,
 * strategy_brief, content_collection.
 * Optional: am_handoff, brand_handoff.
 * Phase 2: site_crawl.
 */

import { supabase } from './supabase'
import type { WebIntakeDocument, WebIntakeCategory } from '../types/database'

export type IntakeKey =
  | 'am_handoff'
  | 'discovery_questionnaire'
  | 'strategy_brief'
  | 'content_strategy'                // optional pre-written content strategy (lifted 1:1 by cowork pipeline)
  | 'brand_handoff'
  | 'content_collection'

export interface IntakeRowStatus {
  key: IntakeKey
  is_hard_stop: boolean
  received: boolean
  received_at: string | null
  /** Where to view the original (Brand Squad tool, partner submission, etc.) */
  source_url: string | null
  source_label: string | null
  /** Uploaded supplemental / authoring files (when applicable to this category) */
  uploaded_files: WebIntakeDocument[]
}

export interface IntakeStatus {
  am_handoff:              IntakeRowStatus
  discovery_questionnaire: IntakeRowStatus
  strategy_brief:          IntakeRowStatus
  content_strategy:        IntakeRowStatus
  brand_handoff:           IntakeRowStatus
  content_collection:      IntakeRowStatus

  hard_stops_total:    number
  hard_stops_complete: number
  ready_for_content:   boolean
}

export async function fetchIntakeStatus(
  webProjectId: string,
  member: number,
): Promise<IntakeStatus> {
  const [docsRes, accountRes, brandRes, discoveryRes, crawlRes, reviewsRes, ccSessionRes] = await Promise.all([
    supabase
      .from('web_intake_documents')
      .select('*')
      .eq('web_project_id', webProjectId)
      .eq('archived', false)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('strategy_account_progress')
      .select('member, handoff_web_form')
      .eq('member', member)
      .maybeSingle(),
    supabase
      .from('strategy_brand_guides')
      .select('id, member, is_published, last_updated_at, updated_at, slug')
      .eq('member', member)
      .eq('is_published', true)
      .order('last_updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('strategy_discovery_questionnaire')
      .select('id, member, submitted_at, primary_contact_name')
      .eq('member', member)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Latest crawl job for this project. Used by the content_collection
    // auto-complete derivation below.
    supabase
      .schema('web-hub')
      .from('crawl_jobs')
      .select('status, completed_at, created_at')
      .eq('project_id', webProjectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Partner reviews for this project. Same auto-complete derivation.
    supabase
      .from('web_reviews')
      .select('id, kind, status, completed_at, started_at')
      .eq('web_project_id', webProjectId)
      .eq('kind', 'partner'),
    // Content collection portal session. If the partner submitted the
    // portal, that counts as content_collection complete without needing
    // an uploaded file or the auto-complete derivation.
    supabase
      .from('strategy_content_collection_sessions')
      .select('id, status, submitted_at')
      .eq('web_project_id', webProjectId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  const docs = (docsRes.data ?? []) as WebIntakeDocument[]
  const docsByCategory = (cat: WebIntakeCategory) => docs.filter(d => d.category === cat)

  // AM handoff — DB row's handoff_web_form OR supplemental file uploaded
  const handoffJsonb = (accountRes.data as { handoff_web_form?: unknown } | null)?.handoff_web_form
  const dbHandoffPresent = handoffJsonb != null && (typeof handoffJsonb !== 'object' || Object.keys(handoffJsonb as object).length > 0)
  const amSupplemental = docsByCategory('am_handoff_supplemental')
  const am_handoff: IntakeRowStatus = {
    key: 'am_handoff',
    is_hard_stop: false,
    received: dbHandoffPresent || amSupplemental.length > 0,
    received_at: amSupplemental[0]?.uploaded_at ?? null,
    source_url: null,
    source_label: dbHandoffPresent ? 'AM web-handoff form' : (amSupplemental.length > 0 ? 'Supplemental upload' : null),
    uploaded_files: amSupplemental,
  }

  // Discovery questionnaire — DB row OR supplemental file uploaded
  const supplemental = docsByCategory('discovery_questionnaire_supplemental')
  const dqRow = discoveryRes.data as { id: string; submitted_at: string | null } | null
  const discovery_questionnaire: IntakeRowStatus = {
    key: 'discovery_questionnaire',
    is_hard_stop: true,
    received: dqRow != null || supplemental.length > 0,
    received_at: dqRow?.submitted_at ?? supplemental[0]?.uploaded_at ?? null,
    source_url: null,
    source_label: dqRow ? 'Partner submission' : (supplemental.length > 0 ? 'Supplemental upload' : null),
    uploaded_files: supplemental,
  }

  // Strategy brief — ≥1 file uploaded
  const briefs = docsByCategory('strategy_brief')
  const strategy_brief: IntakeRowStatus = {
    key: 'strategy_brief',
    is_hard_stop: true,
    received: briefs.length > 0,
    received_at: briefs[0]?.uploaded_at ?? null,
    source_url: null,
    source_label: briefs.length > 0 ? `${briefs.length} file${briefs.length === 1 ? '' : 's'} uploaded` : null,
    uploaded_files: briefs,
  }

  // Content strategy — optional pre-written doc (sitemap + personas +
  // x_factor + voice). When present, the cowork pipeline lifts these
  // elements 1:1 from the doc instead of re-deriving from atoms.
  // Never a hard stop; absence is the default for most projects.
  const csDocs = docsByCategory('content_strategy')
  const content_strategy: IntakeRowStatus = {
    key: 'content_strategy',
    is_hard_stop: false,
    received: csDocs.length > 0,
    received_at: csDocs[0]?.uploaded_at ?? null,
    source_url: null,
    source_label: csDocs.length > 0 ? `${csDocs.length} file${csDocs.length === 1 ? '' : 's'} uploaded — pipeline will lift 1:1` : null,
    uploaded_files: csDocs,
  }

  // Brand handoff — published row in strategy_brand_guides
  const brandRow = brandRes.data as { id: string; last_updated_at: string | null; slug?: string | null } | null
  const brand_handoff: IntakeRowStatus = {
    key: 'brand_handoff',
    is_hard_stop: false,
    received: brandRow != null,
    received_at: brandRow?.last_updated_at ?? null,
    source_url: brandRow?.slug ? `/library/brand/${brandRow.slug}` : null,
    source_label: brandRow ? 'Brand Squad handoff (published)' : null,
    uploaded_files: [],
  }

  // Content collection — uploaded files (hard stop — Stage 2+ can't run
  // without the partner's actual content to organize). Previously optional;
  // promoted to required because every downstream stage references it.
  //
  // Auto-complete: if there are NO uploaded files but the site crawl is
  // complete AND every partner review has closed, mark received=true and
  // surface that the row was satisfied via signals (no file upload
  // needed — the crawl + partner feedback round-trip is itself the
  // content collection for these projects). The partner-feedback gate
  // requires at least one partner review to have existed (a fresh
  // project with zero partner reviews can't auto-complete).
  const content = docsByCategory('content_collection')
  const latestCrawl = crawlRes.data as { status?: string; completed_at?: string | null; created_at?: string | null } | null
  const crawlComplete = latestCrawl?.status === 'complete'
  const partnerReviews = (reviewsRes.data ?? []) as Array<{
    id: string
    status?: string | null
    completed_at?: string | null
    started_at?: string | null
  }>
  const partnerFeedbackComplete = partnerReviews.length > 0
    && partnerReviews.every(r => r.status === 'completed' || r.status === 'closed')
  const autoCompleteContentCollection = content.length === 0 && crawlComplete && partnerFeedbackComplete
  // Pick the most-recent signal as the received_at when auto-completing.
  const lastPartnerCompletedAt = partnerReviews
    .map(r => r.completed_at)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? null
  const autoCompleteReceivedAt = autoCompleteContentCollection
    ? (lastPartnerCompletedAt
       && latestCrawl?.completed_at
       && lastPartnerCompletedAt > latestCrawl.completed_at
         ? lastPartnerCompletedAt
         : latestCrawl?.completed_at ?? lastPartnerCompletedAt ?? latestCrawl?.created_at ?? null)
    : null
  // Content collection portal — third trigger. If the partner submitted
  // the portal, that's a complete content collection regardless of
  // uploaded files or crawl/review state. Takes priority since it's the
  // most concrete signal that the partner provided their content.
  const ccSession = ccSessionRes.data as { id: string; status: string | null; submitted_at: string | null } | null
  const portalSubmitted = !!(ccSession && ccSession.status === 'submitted' && ccSession.submitted_at)
  const content_collection: IntakeRowStatus = {
    key: 'content_collection',
    is_hard_stop: true,
    received: portalSubmitted || content.length > 0 || autoCompleteContentCollection,
    received_at:
      portalSubmitted ? ccSession!.submitted_at :
      (content[0]?.uploaded_at ?? autoCompleteReceivedAt),
    source_url: null,
    source_label: portalSubmitted
      ? 'Content Collection portal submitted'
      : (content.length > 0
         ? `${content.length} file${content.length === 1 ? '' : 's'} uploaded`
         : (autoCompleteContentCollection
            ? 'Auto-completed via site crawl + partner feedback'
            : null)),
    uploaded_files: content,
  }

  const hardStops = [discovery_questionnaire, strategy_brief, content_collection]
  const hard_stops_complete = hardStops.filter(s => s.received).length

  return {
    am_handoff,
    discovery_questionnaire,
    strategy_brief,
    content_strategy,
    brand_handoff,
    content_collection,
    hard_stops_total: hardStops.length,
    hard_stops_complete,
    ready_for_content: hard_stops_complete === hardStops.length,
  }
}
