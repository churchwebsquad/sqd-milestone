/**
 * Partner-facing inventory sanitizer.
 *
 * Runs once at the top of the InventoryView component when
 * `reviewMode=true`. Returns a NEW topicsByKey map with two
 * transformations applied:
 *
 *   1. Cross-topic deduplication of named items (programs / events
 *      / details with a `.name`). The LLM categorizer occasionally
 *      places the same program in multiple topics — e.g. "Paradox
 *      Youth" landing in BOTH `kids` and `students` because it
 *      mentions both ages. The dedup pass keeps each item in the
 *      single topic whose keyword profile best matches the item's
 *      name. Ties + no-match cases keep the first topic.
 *
 *   2. Hard gate against Church Media Squad mentions leaking
 *      partner-facing. Items + passages whose text mentions our
 *      agency are dropped entirely so the partner never sees
 *      "TheSquad will handle X" inside their own inventory.
 *
 * Pure — no I/O, no React. Easy to unit-test.
 */
import type { TopicRow, Item, Passage } from '../components/wm/inventory/InventoryView'

// ── Topic-key keyword profiles for cross-topic dedup ─────────
//
// Each entry lists distinctive words/phrases for that topic. Higher
// match count wins. Keywords are intentionally narrow — generic
// words like "ministry" or "church" don't help disambiguate.
const TOPIC_KEYWORDS: Record<string, string[]> = {
  kids: [
    'kid', 'kids', 'child', 'children', 'preschool', 'elementary',
    'pre-k', 'prek', 'k-5', 'nursery', 'kidmin', 'vbs',
  ],
  students: [
    'student', 'students', 'youth', 'teen', 'teens', 'teenager',
    'middle school', 'middle-school', 'high school', 'high-school',
    'junior high', 'jr high', '6th', '7th', '8th', '9th', '10th',
    '11th', '12th', 'middle', 'high',
  ],
  college: [
    'college', 'young adult', 'young adults', 'twenties', '20s',
    'university', 'campus ministry', 'collegiate',
  ],
  adults: [
    "men's", 'mens', 'men ministry',
    "women's", 'womens', 'women ministry',
    'senior', 'seniors', 'senior adults',
    'moms', "mom's", 'dads', "dad's",
  ],
}

const PARTNER_FACING_HIDDEN_TOKENS = [
  'church media squad',
  'churchmediasquad',
  'thechurchsquad',
  'the church squad',
  'thesquad',
  'the squad', // narrow; rarely a legitimate partner name
  '@churchmediasquad',
  'cms team', 'cms squad',
]

/** Returns true when the text references our agency and should not
 *  surface partner-facing. Case-insensitive substring match. */
export function looksLikeCmsContent(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.toLowerCase()
  return PARTNER_FACING_HIDDEN_TOKENS.some(tok => t.includes(tok))
}

/** Score a free-form name against a topic's keyword profile. Returns
 *  number of distinct keywords matched. */
function scoreNameForTopic(name: string, topicKey: string): number {
  const kws = TOPIC_KEYWORDS[topicKey]
  if (!kws || !name) return 0
  const n = name.toLowerCase()
  let hits = 0
  for (const kw of kws) {
    if (n.includes(kw)) hits++
  }
  return hits
}

/** A stable identity key for cross-topic dedup. We dedup by lowercased
 *  trimmed name — "Paradox Youth" and "PARADOX YOUTH " collapse to
 *  the same identity. */
function itemIdentity(item: Item): string | null {
  const name = String(item.name ?? '').trim().toLowerCase()
  return name || null
}

/** Walks every text-bearing field on an item to detect CMS mentions
 *  anywhere in its content (description, passages, etc.). */
function itemHasCmsContent(item: Item): boolean {
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && looksLikeCmsContent(v)) return true
    if (Array.isArray(v)) {
      for (const vv of v) {
        if (typeof vv === 'string' && looksLikeCmsContent(vv)) return true
        if (vv && typeof vv === 'object') {
          const o = vv as Record<string, unknown>
          for (const inner of Object.values(o)) {
            if (typeof inner === 'string' && looksLikeCmsContent(inner)) return true
          }
        }
      }
    }
  }
  return false
}

export function sanitizeTopicsForPartner(
  topicsByKey: Map<string, TopicRow>,
): Map<string, TopicRow> {
  // ── Pass 1: drop CMS-mentioning passages + items wholesale ──
  const cleaned = new Map<string, TopicRow>()
  for (const [key, topic] of topicsByKey) {
    const items = (topic.items ?? []).filter(it => !itemHasCmsContent(it))
    const passages = (topic.passages ?? []).filter(
      p => !looksLikeCmsContent(p.text) && !looksLikeCmsContent(p.title ?? null),
    )
    cleaned.set(key, { ...topic, items, passages })
  }

  // ── Pass 2: cross-topic dedupe ───────────────────────────
  // Build identity → list of topic keys carrying it.
  const identityHomes = new Map<string, string[]>()
  for (const [key, topic] of cleaned) {
    for (const item of topic.items) {
      const id = itemIdentity(item)
      if (!id) continue
      const list = identityHomes.get(id) ?? []
      list.push(key)
      identityHomes.set(id, list)
    }
  }

  // For every identity that appears in 2+ topics, pick the winner
  // and tag the others for removal.
  const removalsByTopic = new Map<string, Set<string>>()  // topic_key → set of identity strings to drop
  for (const [identity, homes] of identityHomes) {
    if (homes.length < 2) continue
    let winner = homes[0]
    let winnerScore = scoreNameForTopic(identity, winner)
    for (const home of homes.slice(1)) {
      const s = scoreNameForTopic(identity, home)
      if (s > winnerScore) { winner = home; winnerScore = s }
    }
    // If no topic scores > 0, keep the first home; if one scores, that
    // one wins. Either way, mark non-winners for removal.
    for (const home of homes) {
      if (home === winner) continue
      const set = removalsByTopic.get(home) ?? new Set<string>()
      set.add(identity)
      removalsByTopic.set(home, set)
    }
  }

  // Apply the removals.
  if (removalsByTopic.size === 0) return cleaned
  const final = new Map<string, TopicRow>()
  for (const [key, topic] of cleaned) {
    const drops = removalsByTopic.get(key)
    if (!drops || drops.size === 0) { final.set(key, topic); continue }
    final.set(key, {
      ...topic,
      items: topic.items.filter(it => {
        const id = itemIdentity(it)
        return !id || !drops.has(id)
      }),
    })
  }
  return final
}
