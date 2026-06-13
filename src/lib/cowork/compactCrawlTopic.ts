/**
 * Compact a web_project_topics row for inclusion in a cowork endpoint's
 * user message.
 *
 * Why this exists: crawl topics are HEAVY. Sermons.items can be ~39KB;
 * location_contact.items can be ~22KB. A home page that references 3-4
 * crawl topics in its allocation would balloon the user message past
 * the gateway's reasonable input window before we even add atoms +
 * facts + the outline.
 *
 * TWO RULES the cap has to honor (banked 2026-06-12 with the home-page
 * contract widening):
 *
 *   1. **Relevance-aware, not uniform.** The expensive case is small —
 *      a page typically references one or two primary topics with
 *      content treatments. Those get the GENEROUS cap. Topics that
 *      are merely cross-referenced or cms_managed get the COMPACT
 *      cap. Caller declares the relevance via the `relevance`
 *      argument; defaults to 'primary' because everything in the
 *      endpoint's per-page projection IS routed to this page (by
 *      construction the allocation already filtered).
 *
 *   2. **Never let the model believe the sample is the whole.**
 *      Always emit `passages_total` + `items_total` AND explicit
 *      `passages_truncated` / `items_truncated` booleans so the model
 *      can write from what it has AND declare an unresolved_input
 *      ("130 location items available, selection needed") instead of
 *      confidently treating the sample as the complete set. False
 *      certainty about completeness is the silent-no-op shape this
 *      week's other bugs share — sample-as-whole is the same shape
 *      in the prompt layer.
 *
 * Caps:
 *   - passages: cap 20 (primary) / 8 (compact). Passages are short
 *     verbatim quotes (~few hundred bytes each), so 20 is cheap.
 *   - items:    cap 8  (primary) / 8 (compact). Items are heavier
 *     structured rows (~2.5KB each on sermons), so we hold the line
 *     even on primary; if the page needs the rest, the model
 *     surfaces unresolved_input and the strategist routes back.
 *
 * The full inventory lives in web_project_topics; nothing here is
 * destructive — this is just the projection that goes through the
 * gateway. The drafter can request more via validation.flags / the
 * outline can name the gap via unresolved_inputs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CompactedCrawlTopic {
  topic_key:           string
  topic_label:         string | null
  topic_group:         string | null
  coverage_status:     string | null
  passages_sample:     unknown[]
  passages_total:      number
  passages_truncated:  boolean
  items_sample:        unknown[]
  items_total:         number
  items_truncated:     boolean
  /** What the caller declared this topic's relevance to be. 'primary'
   *  means this topic carries content treatments for this page;
   *  'compact' means it's cross-referenced / nav-only / cms_managed
   *  and we don't need the body. Echoed back so the model can see
   *  the caller's intent + the audit trail captures it. */
  relevance:           'primary' | 'compact'
}

const PASSAGES_CAP_PRIMARY = 20
const PASSAGES_CAP_COMPACT = 8
const ITEMS_CAP_PRIMARY    = 8
const ITEMS_CAP_COMPACT    = 8

export function compactCrawlTopic(
  row:       Record<string, any>,
  relevance: 'primary' | 'compact' = 'primary',
): CompactedCrawlTopic {
  const passages = Array.isArray(row?.passages) ? row.passages : []
  const items    = Array.isArray(row?.items)    ? row.items    : []
  const passagesCap = relevance === 'primary' ? PASSAGES_CAP_PRIMARY : PASSAGES_CAP_COMPACT
  const itemsCap    = relevance === 'primary' ? ITEMS_CAP_PRIMARY    : ITEMS_CAP_COMPACT
  return {
    topic_key:          String(row?.topic_key ?? ''),
    topic_label:        row?.topic_label ?? null,
    topic_group:        row?.topic_group ?? null,
    coverage_status:    row?.coverage_status ?? null,
    passages_sample:    passages.slice(0, passagesCap),
    passages_total:     passages.length,
    passages_truncated: passages.length > passagesCap,
    items_sample:       items.slice(0, itemsCap),
    items_total:        items.length,
    items_truncated:    items.length > itemsCap,
    relevance,
  }
}

export function compactCrawlTopics(
  rows:      Array<Record<string, any>>,
  relevance: 'primary' | 'compact' = 'primary',
): CompactedCrawlTopic[] {
  return rows.map(r => compactCrawlTopic(r, relevance))
}
