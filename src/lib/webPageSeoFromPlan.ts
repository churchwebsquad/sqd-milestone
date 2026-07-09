/**
 * Map a plan-page-seo output entry (the shape emitted by step 8 into
 * roadmap_state.page_seo_plans.pages[<slug>]) onto the canonical
 * web_pages.seo shape the Pages workspace SEO panel + Dev Handoff SEO
 * export table read.
 *
 * The plan is flat + prescriptive (primary_keyword, secondary_keywords,
 * meta_title, meta_description, aeo_qa[{question, short_answer}],
 * local_geo{city,state,neighborhoods,service_areas}, search_intent,
 * h1_directive, notes). The UI expects nested (seo{title,
 * meta_description, focus_keywords, canonical_url},
 * aeo{answer_intent, structured_qa[{q,a}]},
 * geo{service_areas, local_keywords, local_landmarks}).
 *
 * Kept in a shared lib so run-plan-page-seo (step 8) AND
 * handoff-to-pages both produce the same shape — before this both
 * wrote the raw plan into web_pages.seo and the UI showed em-dashes.
 */
import type { WebPageSeo } from '../types/database.js'

/** Shape emitted by plan-page-seo. Kept loose so a future field
 *  addition to the plan doesn't force a lockstep type update in
 *  every consumer. */
interface PlanEntry {
  primary_keyword?:    string | null
  secondary_keywords?: string[] | null
  meta_title?:         string | null
  meta_description?:   string | null
  h1_directive?:       string | null
  /** Two historic shapes seen in the wild:
   *    { question, short_answer } — current run-plan-page-seo schema
   *    { q, a_hint }              — older cowork-skill-authored plans
   *  Reader tolerates both. */
  aeo_qa?:             Array<Record<string, unknown> | null> | null
  local_geo?: {
    city?:          string | null
    state?:         string | null
    neighborhoods?: string[] | null
    service_areas?: string[] | null
  } | null
  search_intent?:      string | null
  notes?:              string | null
}

/** Canonical shape produced from a plan entry.
 *
 *  Non-obvious mappings:
 *  - `focus_keywords` = [primary_keyword, ...secondary_keywords], deduped
 *    while preserving order. The panel treats the first entry as the
 *    primary target so we lead with primary_keyword.
 *  - `aeo.answer_intent` is left unset — the plan has no direct
 *    equivalent (h1_directive is prescription, not the question). The
 *    strategist fills it via the SEO panel.
 *  - `geo.local_keywords` receives the plan's `neighborhoods` list.
 *    They're the same idea from the ranking side: neighborhood terms
 *    the page should surface in local pack results.
 *  - `_plan_context` on the returned object preserves the plan's
 *    prescriptive-but-unmapped fields (h1_directive, search_intent,
 *    notes) so no plan data is lost on round-trip — they're readable
 *    via the raw editor row on the panel and by downstream tools.
 */
export function mapPlanToWebPageSeo(plan: unknown, opts?: { status?: string }): WebPageSeo {
  const p = (plan && typeof plan === 'object' ? plan : {}) as PlanEntry

  const focusKeywords: string[] = []
  const seen = new Set<string>()
  const push = (kw: unknown) => {
    if (typeof kw !== 'string') return
    const t = kw.trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    focusKeywords.push(t)
  }
  push(p.primary_keyword)
  for (const kw of p.secondary_keywords ?? []) push(kw)

  const seoBlock: NonNullable<WebPageSeo['seo']> = {}
  if (p.meta_title)       seoBlock.title            = p.meta_title
  if (p.meta_description) seoBlock.meta_description = p.meta_description
  if (focusKeywords.length > 0) seoBlock.focus_keywords = focusKeywords

  const structuredQa = (p.aeo_qa ?? [])
    .map(row => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      // Accept either canonical shape: {question, short_answer} (current
      // run-plan-page-seo output) or the older cowork-authored
      // {q, a_hint}. Trim and drop empties.
      const qRaw = typeof raw.question === 'string' ? raw.question
                 : typeof raw.q        === 'string' ? raw.q
                 : ''
      const aRaw = typeof raw.short_answer === 'string' ? raw.short_answer
                 : typeof raw.a            === 'string' ? raw.a
                 : typeof raw.a_hint       === 'string' ? raw.a_hint
                 : ''
      const q = qRaw.trim()
      const a = aRaw.trim()
      return q && a ? { q, a } : null
    })
    .filter((r): r is { q: string; a: string } => r != null)

  const aeoBlock: NonNullable<WebPageSeo['aeo']> = {}
  if (structuredQa.length > 0) aeoBlock.structured_qa = structuredQa

  const geoBlock: NonNullable<WebPageSeo['geo']> = {}
  const serviceAreas = (p.local_geo?.service_areas ?? []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  const neighborhoods = (p.local_geo?.neighborhoods ?? []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  if (serviceAreas.length  > 0) geoBlock.service_areas  = serviceAreas
  if (neighborhoods.length > 0) geoBlock.local_keywords = neighborhoods

  const out: WebPageSeo = {}
  if (Object.keys(seoBlock).length > 0) out.seo = seoBlock
  if (Object.keys(aeoBlock).length > 0) out.aeo = aeoBlock
  if (Object.keys(geoBlock).length > 0) out.geo = geoBlock

  // Preserve prescriptive plan context that has no canonical panel
  // equivalent — surfaced by the raw-editor row on the SEO panel and
  // by downstream copy pipeline steps (outline / draft / handoff) that
  // read the plan out of roadmap_state anyway. Never null-blank a
  // field; only add it when the plan actually carried it.
  const planContext: Record<string, string> = {}
  if (typeof p.h1_directive  === 'string' && p.h1_directive.trim())  planContext.h1_directive  = p.h1_directive
  if (typeof p.search_intent === 'string' && p.search_intent.trim()) planContext.search_intent = p.search_intent
  if (typeof p.notes         === 'string' && p.notes.trim())         planContext.notes         = p.notes
  if (Object.keys(planContext).length > 0) out._plan_context = planContext

  if (opts?.status) out.status = opts.status
  return out
}
