/**
 * Partner-facing baseline scaffolds — what we always ask about per
 * bucket, regardless of what the crawl turned up.
 *
 * The crawl inventory shows what we FOUND. The baseline shows what we
 * always LOOK for. Together they tell partners "if your phone number
 * isn't on this list, we don't have it" — turning the review from
 * "confirm what's accurate" into "spot what's missing."
 *
 * Each `PartnerBucket` (from `webPartnerGroups.ts`) maps to a list of
 * baseline fields. A baseline field has:
 *
 *   • key         — internal identifier
 *   • label       — partner-facing label
 *   • description — one-line nudge to help partners recognize the field
 *   • detect      — heuristic that returns true if the topic's content
 *                   appears to satisfy this baseline; used to mark the
 *                   field "found" vs "needed."
 *
 * Detection is intentionally lenient. False positives (marking a field
 * found when it's actually thin) are better than false negatives that
 * crowd the gaps list — partners can still flag thin coverage in the
 * inventory itself; the baseline is for COMPLETENESS not QUALITY.
 *
 * Baselines mirror the ContentSnare cowork form's expected fields per
 * subject. Buckets the form doesn't explicitly cover (Campuses,
 * Branding & Photos) have minimal baselines that defer to whatever the
 * crawl returns.
 */

import type { TopicRow, Item, Passage } from '../components/wm/inventory/InventoryView'

export interface BaselineField {
  key:         string
  label:       string
  description: string
  /** True if the topic's content satisfies this field. Pure function —
   *  no DB / network access. */
  detect: (topic: TopicRow) => boolean
  /** Pull the concrete value out of the topic so the form field can
   *  be prefilled. Returns null when nothing extractable was found.
   *  Runs before the itemKinds fallback. */
  extract?: (topic: TopicRow) => string | null
  /** Item kinds whose entries semantically belong to this baseline.
   *  When `extract` is undefined or returns null, the system joins
   *  matching items (`items[]` where `kind` is in this list) into a
   *  display list via `formatItemForList`. This is the lever the user
   *  asked for — instead of bespoke extractors per field, declare
   *  which item types feed which baseline and let the generic
   *  formatter handle the rest. */
  itemKinds?: string[]
}

// ── Reusable detection helpers ────────────────────────────────────────

const RE_TIME       = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i
const RE_DAY        = /\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/i
const RE_PHONE      = /(?:\+?\d[\d\s().-]{7,})/
const RE_EMAIL      = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i
// Address regex tolerates abbreviated street prefixes with periods
// (e.g. "S. McQueen Rd."), multi-word street names, optional `.` after
// the street type, and optional trailing "City, ST 12345" tail so the
// extracted address reads naturally instead of clipping mid-line.
const RE_ADDRESS    = /\b\d{2,6}\s+(?:[A-Za-z][\w.'-]*\s+){0,6}(?:road|rd|street|st|avenue|ave|blvd|boulevard|drive|dr|lane|ln|way|pkwy|parkway|circle|cir|court|ct|highway|hwy|route|rte|trail|trl)\.?(?:\s*,?\s*[A-Za-z][\w\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/i
const RE_URL        = /\bhttps?:\/\/[^\s)]+/i
const RE_BIBLE_REF  = /\b(?:[1-3]\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d+:\d+(?:[-,]\d+)?/

function passageText(topic: TopicRow): string {
  const parts: string[] = []
  for (const p of (topic.passages ?? [])) {
    if (p?.title) parts.push(p.title)
    if (p?.text)  parts.push(p.text)
  }
  for (const it of (topic.items ?? [])) {
    for (const v of Object.values(it)) {
      if (typeof v === 'string') parts.push(v)
    }
  }
  return parts.join(' \n ')
}

function itemsAny(topic: TopicRow, pred: (it: Item) => boolean): boolean {
  return (topic.items ?? []).some(pred)
}

/** Generic regex extractor — first match in any passage / item string. */
function firstMatch(topic: TopicRow, re: RegExp): string | null {
  const m = re.exec(passageText(topic))
  return m ? m[0].trim() : null
}

/** Count distinct address matches across the topic's passages + items
 *  text. Used to auto-fill "Number of campuses" — one address found
 *  means one campus. Dedupes by the street-number prefix so a single
 *  address repeated across multiple pages doesn't inflate the count. */
function countAddresses(topic: TopicRow): number {
  const text = passageText(topic)
  const seen = new Set<string>()
  const re = new RegExp(RE_ADDRESS.source, RE_ADDRESS.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Normalize by street number + first street word so "123 Main St"
    // matches "123 Main St." even if punctuation/case differ.
    const numMatch = m[0].match(/^\s*(\d+)\s+(\w+)/)
    const key = numMatch ? `${numMatch[1]} ${numMatch[2].toLowerCase()}` : m[0].toLowerCase()
    seen.add(key)
  }
  return seen.size
}

/** First passage whose text contains any of the given keywords.
 *  Trimmed + length-capped so the form field stays readable. */
function firstPassageContaining(topic: TopicRow, ...keywords: string[]): string | null {
  const lower = keywords.map(k => k.toLowerCase())
  for (const p of (topic.passages ?? [])) {
    const text = (p?.text ?? '').trim()
    if (!text) continue
    const t = text.toLowerCase()
    if (lower.some(k => t.includes(k))) {
      return text.length > 400 ? text.slice(0, 400).trim() + '…' : text
    }
  }
  return null
}

/** First non-empty passage as a generic fallback prefill. */
function firstPassage(topic: TopicRow): string | null {
  for (const p of (topic.passages ?? [])) {
    const text = (p?.text ?? '').trim()
    if (text) return text.length > 400 ? text.slice(0, 400).trim() + '…' : text
  }
  return null
}

// ── Universal item → display-text formatter ─────────────────────────
//
// The systematic answer to "we have the data but the form is blank":
// instead of a bespoke `extract` function per baseline, each baseline
// can declare which `item.kind` values map to it. The formatter below
// knows how to render each kind into a readable line — Name + Role for
// staff, Question + Answer for FAQs, Reference + Text for scripture,
// etc. Adding new item kinds = adding one switch case here, not a
// new extractor per baseline that surfaces them.

function asString(it: Item, field: string): string {
  const v = (it as Record<string, unknown>)[field]
  return typeof v === 'string' ? v.trim() : ''
}

function formatItemForList(it: Item): string | null {
  switch (it.kind) {
    case 'staff':
    case 'person':
    case 'team_member': {
      const name = asString(it, 'name') || asString(it, 'title') || asString(it, 'label')
      const role = asString(it, 'role') || asString(it, 'position')
      if (name && role && name.toLowerCase() !== role.toLowerCase()) return `${name} — ${role}`
      return name || null
    }
    case 'testimony':
    case 'story': {
      const name = asString(it, 'member_name') || asString(it, 'name')
      const ministry = asString(it, 'ministry') || asString(it, 'topic')
      const summary = asString(it, 'story') || asString(it, 'description') || asString(it, 'text')
      const parts: string[] = []
      if (name) parts.push(name)
      if (ministry) parts.push(`(${ministry})`)
      const head = parts.join(' ')
      if (head && summary) {
        const trim = summary.length > 160 ? summary.slice(0, 160).trim() + '…' : summary
        return `${head} — ${trim}`
      }
      return head || (summary && (summary.length > 200 ? summary.slice(0, 200).trim() + '…' : summary)) || null
    }
    case 'faq':
    case 'question': {
      const q = asString(it, 'question') || asString(it, 'title')
      const a = asString(it, 'answer') || asString(it, 'text')
      if (q && a) {
        const trim = a.length > 300 ? a.slice(0, 300).trim() + '…' : a
        return `${q} — ${trim}`
      }
      return q || a || null
    }
    case 'partner':
    case 'organization': {
      const name = asString(it, 'organization') || asString(it, 'name') || asString(it, 'title')
      const desc = asString(it, 'description') || asString(it, 'about')
      if (name && desc) {
        const trim = desc.length > 200 ? desc.slice(0, 200).trim() + '…' : desc
        return `${name} — ${trim}`
      }
      return name || null
    }
    case 'event':
    case 'opportunity':
    case 'camp':
    case 'retreat': {
      const title = asString(it, 'title') || asString(it, 'name')
      const when  = asString(it, 'date_time') || asString(it, 'date') || asString(it, 'when')
      const desc  = asString(it, 'description')
      if (title && when) return `${title} (${when})`
      if (title && desc) {
        const trim = desc.length > 160 ? desc.slice(0, 160).trim() + '…' : desc
        return `${title} — ${trim}`
      }
      return title || null
    }
    case 'program':
    case 'ministry':
    case 'step':
    case 'pathway_step':
    case 'class':
    case 'campaign': {
      const name = asString(it, 'name') || asString(it, 'title') || asString(it, 'label')
      const desc = asString(it, 'description') || asString(it, 'about')
      if (name && desc) {
        const trim = desc.length > 160 ? desc.slice(0, 160).trim() + '…' : desc
        return `${name} — ${trim}`
      }
      return name || null
    }
    case 'cta':
    case 'button': {
      const label = asString(it, 'label') || asString(it, 'text')
      const url   = asString(it, 'url')
      if (label && url) return `${label} → ${url}`
      return label || url || null
    }
    case 'tagline':
    case 'key_phrase':
    case 'tier':
    case 'doctrine': {
      return asString(it, 'text') || asString(it, 'label') || asString(it, 'title') || null
    }
    case 'scripture': {
      const ref  = asString(it, 'reference') || asString(it, 'verse')
      const text = asString(it, 'text')
      if (ref && text) {
        const trim = text.length > 200 ? text.slice(0, 200).trim() + '…' : text
        return `${ref} — ${trim}`
      }
      return ref || text || null
    }
    case 'volunteer_role':
    case 'serve_role':
    case 'role': {
      const role = asString(it, 'role') || asString(it, 'name') || asString(it, 'title')
      const team = asString(it, 'team') || asString(it, 'ministry')
      if (role && team) return `${role} (${team})`
      return role || null
    }
    case 'sermon':
    case 'message':
    case 'series': {
      const title = asString(it, 'title') || asString(it, 'name')
      const speaker = asString(it, 'speaker')
      const url = asString(it, 'url')
      if (title && speaker) return `${title} — ${speaker}`
      if (title && url) return `${title} (${url})`
      return title || null
    }
    case 'newsletter':
    case 'newsletter_issue': {
      const title = asString(it, 'title') || asString(it, 'name')
      const date  = asString(it, 'date')
      if (title && date) return `${title} (${date})`
      return title || null
    }
    case 'location':
    case 'campus': {
      const name = asString(it, 'name') || asString(it, 'label')
      const addr = asString(it, 'address')
      if (name && addr) return `${name} — ${addr}`
      return name || addr || null
    }
    case 'detail': {
      const label = asString(it, 'label')
      const value = asString(it, 'value') || asString(it, 'text')
      if (label && value) return `${label}: ${value}`
      return value || label || null
    }
    case 'contact': {
      const name = asString(it, 'name')
      const role = asString(it, 'role')
      const email = asString(it, 'email')
      const phone = asString(it, 'phone')
      const head = name && role ? `${name} (${role})` : (name || role)
      const tail = email || phone
      if (head && tail) return `${head} — ${tail}`
      return head || tail || null
    }
    default: {
      // Unknown kind — try the most common display fields. Better to
      // surface SOMETHING than render the form blank when items clearly
      // exist.
      return asString(it, 'name')
          || asString(it, 'title')
          || asString(it, 'label')
          || asString(it, 'organization')
          || asString(it, 'text')
          || null
    }
  }
}

/** Join all items whose `kind` matches one of `kinds` into a display
 *  list. Used as the system-wide fallback extractor — when an extract
 *  function isn't defined (or returns null) but a baseline declares
 *  `itemKinds`, this fills the form input with matching items'
 *  formatted text. */
function itemsAsDisplayList(topic: TopicRow, kinds: ReadonlyArray<string>): string | null {
  const set = new Set(kinds)
  const matches = (topic.items ?? []).filter(it => set.has(String(it.kind ?? '')))
  if (matches.length === 0) return null
  const lines = matches
    .slice(0, 30)
    .map(formatItemForList)
    .filter((s): s is string => Boolean(s))
  if (lines.length === 0) return null
  return lines.join('\n')
}

/** FAQ items whose question reads like a "what we believe" item.
 *  Partners often store their statement of beliefs as FAQ entries
 *  ("Who is God?", "What do you believe about the Bible?"). This
 *  catches them so the Beliefs baseline field doesn't read "needed"
 *  when the content is actually present, just mis-categorized. */
const BELIEF_QUESTION_RE = /\b(believe|belief|bible|god|jesus|christ|holy\s+spirit|salvation|trinity|baptism|doctrine|creed|scripture)\b/i

function faqItemsAboutBeliefs(topic: TopicRow): Item[] {
  return (topic.items ?? []).filter(it => {
    if (it.kind !== 'faq') return false
    const q = typeof (it as Record<string, unknown>).question === 'string'
      ? (it as { question: string }).question : ''
    const a = typeof (it as Record<string, unknown>).answer === 'string'
      ? (it as { answer: string }).answer : ''
    return BELIEF_QUESTION_RE.test(q) || BELIEF_QUESTION_RE.test(a)
  })
}

/** Join FAQ-as-beliefs entries into one prefill string the partner can
 *  edit. Returns null when there are no belief-shaped FAQ entries. */
function joinFaqBeliefs(topic: TopicRow): string | null {
  const items = faqItemsAboutBeliefs(topic)
  if (items.length === 0) return null
  const lines: string[] = []
  for (const it of items) {
    const q = typeof (it as Record<string, unknown>).question === 'string'
      ? (it as { question: string }).question.trim() : ''
    const a = typeof (it as Record<string, unknown>).answer === 'string'
      ? (it as { answer: string }).answer.trim() : ''
    if (q && a) lines.push(`${q} — ${a}`)
    else if (a) lines.push(a)
    else if (q) lines.push(q)
  }
  const joined = lines.join('\n\n')
  return joined.length > 1200 ? joined.slice(0, 1200).trim() + '…' : joined
}

function topicHasMatch(topic: TopicRow, re: RegExp): boolean {
  return re.test(passageText(topic))
}

function topicHasKeyword(topic: TopicRow, ...keywords: string[]): boolean {
  const text = passageText(topic).toLowerCase()
  return keywords.some(k => text.includes(k.toLowerCase()))
}

function itemKindMatches(topic: TopicRow, ...kinds: string[]): boolean {
  return itemsAny(topic, it => typeof it.kind === 'string' && kinds.includes(it.kind))
}

function programsHaveField(topic: TopicRow, field: string): boolean {
  return itemsAny(topic, it => {
    if (it.kind !== 'program' && it.kind !== 'ministry') return false
    const v = (it as Record<string, unknown>)[field]
    return typeof v === 'string' ? v.trim() !== '' : Boolean(v)
  })
}

/** Pull a specific structured field from the first program/ministry
 *  item that carries it. Used by ministry-bucket extractors so the
 *  Ministry Name / Meeting Time / Leader fields render distinct
 *  values from the same item, instead of repeating the same passage.
 *  Joins multiple programs with " · " when more than one carries the
 *  field (so partners see e.g. "Mission Kids · Mission Students" for
 *  Ministry Name in a bucket with both). */
function programsField(topic: TopicRow, ...fields: string[]): string | null {
  const items = (topic.items ?? []).filter(it => it.kind === 'program' || it.kind === 'ministry')
  if (items.length === 0) return null
  const values: string[] = []
  for (const it of items) {
    for (const f of fields) {
      const v = (it as Record<string, unknown>)[f]
      if (typeof v === 'string' && v.trim()) { values.push(v.trim()); break }
    }
  }
  if (values.length === 0) return null
  // Dedupe — multiple programs may share the same leader / campus.
  const uniq = Array.from(new Set(values))
  return uniq.join(' · ')
}

// ── Baselines per bucket key ──────────────────────────────────────────

export const BUCKET_BASELINES: Record<string, BaselineField[]> = {
  // ── The Details ─────────────────────────────────────────────────────
  contact: [
    // church_name is omitted intentionally — we already know it from
    // strategy_account_progress.church_name, so asking partners would
    // be redundant noise.
    { key: 'phone',          label: 'General phone number', description: 'Main line site visitors can call.',
      detect:  t => topicHasMatch(t, RE_PHONE),
      extract: t => firstMatch(t, RE_PHONE) },
    { key: 'email',          label: 'General contact email', description: 'Main inbox for site visitor questions.',
      detect:  t => topicHasMatch(t, RE_EMAIL),
      extract: t => firstMatch(t, RE_EMAIL) },
    { key: 'address',        label: 'Primary address',      description: 'Street address of the main campus.',
      detect:  t => topicHasMatch(t, RE_ADDRESS),
      extract: t => firstMatch(t, RE_ADDRESS) },
    { key: 'office_hours',   label: 'Admin office hours',   description: 'When the office is open to walk-ins or calls.',
      detect:  t => topicHasKeyword(t, 'office hours', 'open hours', 'mon-fri', 'monday through'),
      extract: t => firstPassageContaining(t, 'office hours', 'open hours', 'mon-fri', 'monday through') },
    { key: 'campus_count',   label: 'Number of campuses',   description: 'How many physical locations the church operates.',
      detect:  t => topicHasKeyword(t, 'campus', 'location') || countAddresses(t) > 0,
      // Auto-fill from the count of distinct addresses we found in
      // the crawl — partners with one address shouldn't have to type
      // "1" themselves.
      extract: t => {
        const n = countAddresses(t)
        return n > 0 ? String(n) : null
      } },
  ],

  social_newsletter: [
    { key: 'social_links',     label: 'Social media accounts', description: 'Facebook, Instagram, YouTube, etc.',
      detect:  t => topicHasKeyword(t, 'facebook', 'instagram', 'youtube', 'tiktok'),
      extract: t => firstPassageContaining(t, 'facebook', 'instagram', 'youtube', 'tiktok') },
    { key: 'newsletter_signup', label: 'Newsletter signup',    description: 'How site visitors subscribe to church-wide updates.',
      detect:  t => topicHasKeyword(t, 'newsletter', 'subscribe', 'sign up'),
      extract: t => firstPassageContaining(t, 'newsletter', 'subscribe', 'sign up') },
  ],

  branding_photos: [
    // Logo + brand guide deliberately omitted — the Brand Squad
    // manages those upstream, so asking partners here is redundant.
    { key: 'photo_library', label: 'Photo library',      description: 'Library of campus + congregation photos.',
      detect: () => false },
    { key: 'mobile_app',    label: 'Mobile app links',   description: 'Apple / Google / Roku app store links if applicable.',
      detect: t => topicHasKeyword(t, 'app store', 'google play', 'subsplash', 'mobile app') },
  ],

  // ── About Your Church ───────────────────────────────────────────────
  mission_beliefs: [
    { key: 'mission_statement', label: 'Mission statement', description: 'Why the church exists — the core purpose.',
      // Broadened keyword set so "Desert Springs Church exists to
      // connect people…" matches — the prior list only caught
      // "Our mission" / "Mission statement" phrasings.
      detect:  t => topicHasKeyword(t,
        'our mission', 'mission is', 'mission statement', 'purpose is',
        'exists to', 'we exist', 'we are called', 'our purpose',
        'make disciples', 'reaching people'),
      extract: t => firstPassageContaining(t,
        'our mission', 'mission is', 'mission statement', 'purpose is',
        'exists to', 'we exist', 'we are called', 'our purpose',
        'make disciples', 'reaching people') },
    { key: 'vision_statement',  label: 'Vision statement',  description: 'Where the church is going — the future picture.',
      detect:  t => topicHasKeyword(t, 'our vision', 'vision is', 'vision statement', 'where we', 'where we\'re going'),
      extract: t => firstPassageContaining(t, 'our vision', 'vision is', 'vision statement', 'where we') },
    { key: 'values',            label: 'Church values',     description: 'The principles that guide behavior + decisions.',
      detect:  t => topicHasKeyword(t, 'our values', 'we value', 'core values'),
      extract: t => firstPassageContaining(t, 'our values', 'we value', 'core values') },
    { key: 'beliefs',           label: 'Statement of beliefs', description: 'Theological convictions (God, Bible, salvation, etc.).',
      detect:  t => topicHasKeyword(t, 'we believe', 'statement of beliefs', 'doctrine', 'creed')
                  || faqItemsAboutBeliefs(t).length > 0,
      extract: t => firstPassageContaining(t, 'we believe', 'statement of beliefs', 'doctrine')
                  ?? joinFaqBeliefs(t) },
  ],

  campuses: [
    { key: 'campus_addresses',    label: 'Each campus address',     description: 'Street address per location.',
      detect: t => topicHasMatch(t, RE_ADDRESS) },
    { key: 'campus_service_times', label: 'Per-campus service times', description: 'Schedule by campus when they differ.',
      detect: t => topicHasMatch(t, RE_TIME) },
    { key: 'campus_pastor',       label: 'Campus pastor / leader',  description: 'Who leads each location.',
      detect: t => topicHasKeyword(t, 'campus pastor', 'lead pastor', 'campus leader') },
  ],

  origins_lingo: [
    { key: 'founding_story', label: 'Founding story',      description: 'How and why the church started.',
      detect: t => topicHasKeyword(t, 'founded', 'started in', 'began in', 'our story', 'history') },
    { key: 'taglines',       label: 'Repeated taglines',   description: 'Slogans the church uses regularly across messaging.',
      detect: t => itemKindMatches(t, 'tagline', 'key_phrase') || topicHasKeyword(t, 'tagline') },
  ],

  // ── Weekend Services ────────────────────────────────────────────────
  service_details: [
    { key: 'service_times',     label: 'Service times',           description: 'When weekend services happen.',
      detect:  t => topicHasMatch(t, RE_TIME) || itemKindMatches(t, 'service_time'),
      extract: t => firstPassageContaining(t, 'sunday', 'service', 'am', 'pm') ?? firstMatch(t, RE_TIME) },
    { key: 'visitor_expect',    label: 'What visitors expect',    description: 'Service flow, length, vibe, dress code.',
      detect:  t => topicHasKeyword(t, 'what to expect', 'visitor', 'first time', 'service lasts', 'casual', 'experience'),
      extract: t => firstPassageContaining(t, 'what to expect', 'visitor', 'first time', 'expect') },
    { key: 'parking',           label: 'Parking info',            description: 'Where to park, reserved visitor parking?',
      detect:  t => topicHasKeyword(t, 'parking', 'parking lot'),
      extract: t => firstPassageContaining(t, 'parking') },
    { key: 'sunday_directions', label: 'How visitors find their way', description: 'Signage, greeters, parking lot volunteers.',
      detect:  t => topicHasKeyword(t, 'welcome team', 'greeters', 'signage', 'volunteer'),
      extract: t => firstPassageContaining(t, 'welcome team', 'greeters', 'signage') },
  ],

  visit_details: [
    { key: 'plan_visit_form',   label: 'Plan-a-visit form',  description: 'Pre-arrival form that flags first-time guests.',
      detect: t => topicHasKeyword(t, 'plan your visit', 'plan a visit', 'first time form') },
    { key: 'what_to_wear',      label: 'What to wear / dress', description: 'Dress code expectations for guests.',
      detect: t => topicHasKeyword(t, 'what to wear', 'casual', 'dress') },
    { key: 'arrival_directions', label: 'Arrival directions', description: 'Step-by-step what happens when a guest arrives.',
      detect: t => topicHasKeyword(t, 'when you arrive', 'getting here', 'directions') },
  ],

  sermons: [
    // Dropped sermon_name + discussion_guides baselines per branding
    // feedback — partners cover the same ground via the new Step 2
    // "sermon archive setup" checkboxes.
    { key: 'livestream_url',  label: 'Livestream URL',        description: 'Where weekend services stream live.',
      detect:  t => topicHasKeyword(t, 'livestream', 'online church', 'youtube.com/@', 'live stream') || topicHasMatch(t, RE_URL),
      extract: t => firstMatch(t, RE_URL) },
    { key: 'archive_url',     label: 'Sermon archive',        description: 'Where past sermons are catalogued.',
      detect:  t => topicHasKeyword(t, 'sermon archive', 'past sermons', 'watch sermons', 'all sermons', 'messages'),
      extract: t => firstMatch(t, RE_URL) ?? firstPassageContaining(t, 'sermon archive', 'past sermons', 'all sermons') },
  ],

  // ── Staff, Volunteers & Testimonies ─────────────────────────────────
  // Staff: no form fields — the found-on-site cards below the bucket
  // already show name + role + bio + email per person, which is
  // exactly the form we'd otherwise ask the partner to retype.
  staff: [],

  careers: [
    { key: 'openings_or_decision', label: 'Open positions OR decision to skip',
      description: 'Listed positions OR an explicit "we\'re not hiring publicly" decision.',
      detect: t => itemKindMatches(t, 'career', 'job', 'opening'),
      itemKinds: ['career', 'job', 'opening'] },
  ],

  volunteers: [
    { key: 'volunteer_term',         label: 'What volunteers are called',
      description: '"Volunteers", "Serve Team", "Dream Team", etc.',
      detect: t => topicHasKeyword(t, 'volunteer', 'serve team', 'dream team', 'serving') },
    { key: 'why_volunteer',          label: 'Why someone should volunteer',
      description: 'The motivation pitch for getting involved.',
      detect:  t => topicHasKeyword(t, 'why serve', 'why volunteer', 'serve because'),
      extract: t => firstPassageContaining(t, 'why serve', 'why volunteer', 'serve because') },
    { key: 'volunteer_signup',       label: 'Signup form / path',
      description: 'How someone applies or signs up to serve.',
      detect:  t => topicHasMatch(t, RE_URL) && topicHasKeyword(t, 'sign up', 'apply', 'form', 'serve'),
      extract: t => firstMatch(t, RE_URL) },
    { key: 'volunteer_opportunities', label: 'Specific roles or teams',
      description: 'Named volunteer opportunities (or explicit "via form only" decision).',
      detect: t => itemKindMatches(t, 'volunteer_role', 'serve_role', 'role'),
      itemKinds: ['volunteer_role', 'serve_role', 'role'] },
  ],

  testimonies: [
    { key: 'testimony_stories', label: 'Member testimony stories',
      description: 'Written or video stories of life-change.',
      detect: t => itemKindMatches(t, 'testimony', 'story') || (t.passages?.length ?? 0) > 0,
      itemKinds: ['testimony', 'story'] },
    { key: 'story_form',        label: 'Story submission form',
      description: 'How visitors can share their own story.',
      detect:  t => topicHasKeyword(t, 'share your story', 'tell us your story', 'submit your story'),
      extract: t => firstMatch(t, RE_URL) ?? firstPassageContaining(t, 'share your story', 'tell us your story', 'submit your story') },
  ],

  // ── Discipleship ────────────────────────────────────────────────────
  small_groups: [
    { key: 'group_name',         label: 'What the church calls groups',
      description: '"Small Groups", "Life Groups", "Community Groups", etc.',
      detect:  t => topicHasKeyword(t, 'small group', 'life group', 'community group', 'connect group'),
      extract: t => firstPassageContaining(t, 'small group', 'life group', 'community group', 'connect group') },
    { key: 'what_to_expect',     label: 'What to expect in a group',
      description: 'Size, format, where they meet, frequency.',
      detect:  t => topicHasKeyword(t, 'what to expect', 'meet', 'gather', 'study', 'home'),
      extract: t => firstPassageContaining(t, 'what to expect', 'meet', 'gather', 'study') },
    { key: 'why_join',           label: 'Why someone should join',
      description: 'Theological + relational rationale.',
      detect:  t => topicHasKeyword(t, 'community', 'belonging', 'together', 'connect'),
      extract: t => firstPassageContaining(t, 'community', 'belonging', 'together', 'connect') },
    { key: 'bible_saying',       label: 'Bible verse or saying',
      description: 'Anchor scripture or repeated phrase.',
      detect:  t => topicHasMatch(t, RE_BIBLE_REF) || itemKindMatches(t, 'scripture', 'tagline'),
      extract: t => firstMatch(t, RE_BIBLE_REF),
      itemKinds: ['scripture', 'tagline', 'key_phrase'] },
    { key: 'contact',            label: 'Contact for more info',
      description: 'Who to email / call about groups.',
      detect:  t => topicHasMatch(t, RE_EMAIL) || topicHasMatch(t, RE_PHONE),
      extract: t => firstMatch(t, RE_EMAIL) ?? firstMatch(t, RE_PHONE) },
    { key: 'signup',             label: 'How to find / join a group',
      description: 'Link to PCO, ChurchCenter, or in-house finder.',
      detect:  t => topicHasMatch(t, RE_URL),
      extract: t => firstMatch(t, RE_URL) },
  ],

  // Next steps: no form fields — the found-on-site program cards
  // (Starting Point, Next Steps class, baptism class, etc.) carry the
  // full pathway. If a church bundles groups or baptism under their
  // next-steps pathway, those standalone buckets are also suppressed
  // upstream in InventoryView.
  next_steps: [],

  classes: [
    { key: 'class_list',  label: 'Named classes',
      description: 'Membership, foundations, specialized courses.',
      detect: t => itemKindMatches(t, 'program', 'class'),
      itemKinds: ['program', 'class'] },
  ],

  baptism: [
    { key: 'why_baptize',  label: 'Why someone should be baptized',
      description: 'Theology of baptism.',
      detect:  t => topicHasKeyword(t, 'why', 'baptism', 'baptize', 'public declaration', 'obedience'),
      extract: t => firstPassageContaining(t, 'why', 'baptism', 'baptize', 'public declaration', 'obedience') },
    { key: 'how',          label: 'What baptism looks like',
      description: 'Method (full immersion vs sprinkling, where, with whom).',
      detect:  t => topicHasKeyword(t, 'immersion', 'sprinkling', 'water', 'baptistry'),
      extract: t => firstPassageContaining(t, 'immersion', 'sprinkling', 'water', 'baptistry') },
    { key: 'scripture',    label: 'Anchor Bible verses',
      description: 'Key passages cited for baptism.',
      detect:  t => topicHasMatch(t, RE_BIBLE_REF) || itemKindMatches(t, 'scripture'),
      extract: t => firstMatch(t, RE_BIBLE_REF),
      itemKinds: ['scripture'] },
    { key: 'signup',       label: 'Baptism signup',
      description: 'Form or contact to be baptized.',
      detect:  t => topicHasMatch(t, RE_URL),
      extract: t => firstMatch(t, RE_URL) },
  ],

  // ── Ministries ──────────────────────────────────────────────────────
  // Most ministries share the same baseline shape (the cowork form
  // explicitly enumerates these). We instantiate it per bucket key.
  ...buildMinistryBaselines([
    'kids', 'students', 'college', 'adults', 'care', 'additional',
  ]),

  local_outreach: [
    ...ministryBaseline(),
    { key: 'partners_list',  label: 'Local ministry partners',
      description: 'Organizations the church partners with locally.',
      detect: t => itemKindMatches(t, 'partner', 'organization'),
      itemKinds: ['partner', 'organization'] },
    { key: 'opportunities',  label: 'Local outreach opportunities',
      description: 'Recurring + one-time service events.',
      detect: t => itemKindMatches(t, 'event', 'opportunity'),
      itemKinds: ['event', 'opportunity'] },
  ],

  global_outreach: [
    ...ministryBaseline(),
    { key: 'partners_list',  label: 'Global ministry partners',
      description: 'Missionaries + organizations supported globally.',
      detect: t => itemKindMatches(t, 'partner', 'organization', 'missionary'),
      itemKinds: ['partner', 'organization', 'missionary'] },
    { key: 'opportunities',  label: 'Global outreach opportunities',
      description: 'Mission trips, sponsorships, prayer partnerships.',
      detect: t => itemKindMatches(t, 'event', 'opportunity', 'trip'),
      itemKinds: ['event', 'opportunity', 'trip'] },
  ],

  // ── Events ──────────────────────────────────────────────────────────
  // Only the calendar link — recurring events and camps + retreats
  // were dropped per branding feedback (partners just need to confirm
  // the calendar URL; specific events live there).
  events: [
    { key: 'events_link',     label: 'Events calendar',
      description: 'Calendar URL (PCO, ChurchCenter, embedded, etc.).',
      detect:  t => topicHasMatch(t, RE_URL) || topicHasKeyword(t, 'calendar', 'upcoming events'),
      extract: t => firstMatch(t, RE_URL) },
  ],

  // ── Giving ──────────────────────────────────────────────────────────
  ways_to_give: [
    { key: 'platform',     label: 'Giving platform',
      description: 'Where online gifts get processed (Subsplash, PCO, etc.).',
      detect:  t => topicHasKeyword(t, 'subsplash', 'planning center', 'tithely', 'pushpay') || topicHasMatch(t, RE_URL),
      extract: t => firstMatch(t, RE_URL) ?? firstPassageContaining(t, 'subsplash', 'planning center', 'tithely', 'pushpay') },
    { key: 'methods',      label: 'Ways to give',
      description: 'Online, recurring, in-person, app, stocks, etc.',
      detect:  t => topicHasKeyword(t, 'recurring', 'in person', 'in-person', 'app', 'online', 'check', 'stock'),
      extract: t => firstPassageContaining(t, 'recurring', 'in person', 'app', 'online', 'check') },
    { key: 'why_give',     label: 'Why someone should give',
      description: 'Mission-tied rationale for generosity.',
      detect:  t => topicHasKeyword(t, 'because of your', 'your gift', 'generosity', 'tithe', 'why give'),
      extract: t => firstPassageContaining(t, 'because of your', 'your gift', 'generosity', 'tithe', 'why give') },
    { key: 'scripture',    label: 'Anchor scripture',
      description: 'Bible verses or sayings about giving.',
      detect:  t => topicHasMatch(t, RE_BIBLE_REF) || itemKindMatches(t, 'scripture'),
      extract: t => firstMatch(t, RE_BIBLE_REF),
      itemKinds: ['scripture'] },
  ],

  campaigns: [
    { key: 'active_campaigns', label: 'Active or upcoming campaigns',
      description: 'Capital, building, vision, end-of-year campaigns.',
      detect: t => itemKindMatches(t, 'campaign', 'program') || topicHasKeyword(t, 'campaign'),
      itemKinds: ['campaign', 'program'] },
    { key: 'campaign_purpose', label: 'Campaign purpose + goal',
      description: 'What each campaign is funding.',
      detect:  t => (t.passages?.length ?? 0) > 0,
      extract: t => firstPassageContaining(t, 'campaign', 'goal', 'fund', 'capital', 'building') },
  ],
}

// ── Shared ministry baseline (cowork form: 7.0 Ministries section) ────

/** The cowork form's per-ministry checklist — used as the baseline for
 *  every ministry bucket (kids, students, adults, care, etc.). Built
 *  once and instantiated per bucket so each ministry section reads the
 *  same baseline. */
/** Ministry baseline is now empty — the program cards rendered
 *  beneath the bucket (Mission Kids, Mission Students, etc.) already
 *  surface the structured data partners would otherwise fill in.
 *  Adding form fields on top of those cards was duplicating the
 *  review experience. Partners still get an "Add something we
 *  missed" affordance for content the crawl didn't pick up. */
function ministryBaseline(): BaselineField[] {
  return []
}

function buildMinistryBaselines(keys: string[]): Record<string, BaselineField[]> {
  const base = ministryBaseline()
  const out: Record<string, BaselineField[]> = {}
  for (const k of keys) out[k] = base
  return out
}

// ── Public helpers consumed by InventoryView ──────────────────────────

export interface BaselineCoverage {
  field:  BaselineField
  filled: boolean
  /** First extracted value across the bucket's topics, when an
   *  extractor is defined and returned something. Used to prefill the
   *  form input. Null when no extractor / nothing found / extractor
   *  threw. Falls back to first-non-empty passage when undefined and
   *  detect=true so partners always see SOME context to work from. */
  prefill: string | null
}

/** Compute fill status for every baseline field this bucket expects,
 *  against the merged content of all the bucket's topics. Returns the
 *  baseline list in original order so the UI renders deterministically.
 *  Returns an empty array if the bucket has no baseline defined yet
 *  (the inventory then renders without a baseline scaffold). */
export function computeBaselineCoverage(
  bucketKey: string,
  topics:    TopicRow[],
): BaselineCoverage[] {
  const baseline = BUCKET_BASELINES[bucketKey]
  if (!baseline || baseline.length === 0) return []
  return baseline.map(field => {
    const filled  = topics.some(t => safeDetect(field, t))
    const prefill = safeExtract(field, topics)
    return { field, filled, prefill }
  })
}

function safeDetect(field: BaselineField, topic: TopicRow): boolean {
  try {
    return field.detect(topic)
  } catch {
    return false
  }
}

/** Walk topics, return the first non-null extractor result. Two-stage:
 *
 *   1. Explicit `extract` function — for fields with custom extraction
 *      logic (regex patterns, keyword-anchored passages, etc.).
 *   2. `itemKinds` fallback — declared item types get auto-formatted
 *      into a display list via `formatItemForList`. This is the
 *      system-wide answer to "we have the data but the form is blank"
 *      — instead of writing a bespoke extractor for every list-style
 *      baseline (staff, testimonies, partners, events, etc.), each
 *      baseline declares which item kinds belong to it.
 *
 *  Returns null only when BOTH paths fail. */
function safeExtract(field: BaselineField, topics: TopicRow[]): string | null {
  if (field.extract) {
    for (const t of topics) {
      try {
        const v = field.extract(t)
        if (v && v.trim()) return v.trim()
      } catch { /* skip */ }
    }
  }
  if (field.itemKinds && field.itemKinds.length > 0) {
    for (const t of topics) {
      const v = itemsAsDisplayList(t, field.itemKinds)
      if (v) return v
    }
  }
  return null
}

// Re-export `Passage` so consumers don't need to import from
// InventoryView when this module also re-exports the inventory types.
export type { Passage }
