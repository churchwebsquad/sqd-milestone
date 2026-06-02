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
   *  be prefilled. Returns null when nothing extractable was found
   *  (the form renders an empty input + placeholder in that case).
   *  Optional — fields without an extractor render with the topic's
   *  first matching passage as a fallback prefill. */
  extract?: (topic: TopicRow) => string | null
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
      detect:  t => topicHasKeyword(t, 'our mission', 'mission is', 'mission statement', 'purpose is'),
      extract: t => firstPassageContaining(t, 'our mission', 'mission is', 'mission statement', 'purpose is') },
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
    { key: 'livestream_url',  label: 'Livestream URL',        description: 'Where weekend services stream live.',
      detect: t => topicHasKeyword(t, 'livestream', 'online church', 'youtube.com/@', 'live stream') || topicHasMatch(t, RE_URL) },
    { key: 'archive_url',     label: 'Sermon archive',        description: 'Where past sermons are catalogued.',
      detect: t => topicHasKeyword(t, 'sermon archive', 'past sermons', 'watch sermons', 'all sermons', 'messages') },
    { key: 'sermon_name',     label: 'What sermons are called', description: '"Sermons", "Messages", "Teachings", etc.',
      detect: t => topicHasKeyword(t, 'messages', 'teachings', 'sermons') },
    { key: 'discussion_guides', label: 'Discussion guides + notes', description: 'Companion materials per sermon.',
      detect: t => topicHasKeyword(t, 'discussion guide', 'sermon notes', 'study guide') },
  ],

  // ── Staff, Volunteers & Testimonies ─────────────────────────────────
  staff: [
    { key: 'staff_list',      label: 'Staff / pastor list', description: 'Named pastors + staff with roles.',
      detect: t => itemKindMatches(t, 'staff', 'person', 'team_member') || topicHasKeyword(t, 'pastor', 'staff') },
    { key: 'leader_bio',      label: 'Leader bios',         description: 'Short bio per named staff member.',
      detect: t => itemsAny(t, it => typeof (it as Record<string, unknown>).bio === 'string') },
  ],

  careers: [
    { key: 'openings_or_decision', label: 'Open positions OR decision to skip',
      description: 'Listed positions OR an explicit "we\'re not hiring publicly" decision.',
      detect: () => false },
  ],

  volunteers: [
    { key: 'volunteer_term',         label: 'What volunteers are called',
      description: '"Volunteers", "Serve Team", "Dream Team", etc.',
      detect: t => topicHasKeyword(t, 'volunteer', 'serve team', 'dream team', 'serving') },
    { key: 'why_volunteer',          label: 'Why someone should volunteer',
      description: 'The motivation pitch for getting involved.',
      detect: t => topicHasKeyword(t, 'why serve', 'why volunteer', 'serve because') },
    { key: 'volunteer_signup',       label: 'Signup form / path',
      description: 'How someone applies or signs up to serve.',
      detect: t => topicHasMatch(t, RE_URL) && topicHasKeyword(t, 'sign up', 'apply', 'form', 'serve') },
    { key: 'volunteer_opportunities', label: 'Specific roles or teams',
      description: 'Named volunteer opportunities (or explicit "via form only" decision).',
      detect: t => itemKindMatches(t, 'volunteer_role', 'serve_role') },
  ],

  testimonies: [
    { key: 'testimony_stories', label: 'Member testimony stories',
      description: 'Written or video stories of life-change.',
      detect: t => itemKindMatches(t, 'testimony', 'story') || (t.passages?.length ?? 0) > 0 },
    { key: 'story_form',        label: 'Story submission form',
      description: 'How visitors can share their own story.',
      detect: t => topicHasKeyword(t, 'share your story', 'tell us your story', 'submit your story') },
  ],

  // ── Discipleship ────────────────────────────────────────────────────
  small_groups: [
    { key: 'group_name',         label: 'What the church calls groups',
      description: '"Small Groups", "Life Groups", "Community Groups", etc.',
      detect: t => topicHasKeyword(t, 'small group', 'life group', 'community group', 'connect group') },
    { key: 'what_to_expect',     label: 'What to expect in a group',
      description: 'Size, format, where they meet, frequency.',
      detect: t => topicHasKeyword(t, 'what to expect', 'meet', 'gather', 'study', 'home') },
    { key: 'why_join',           label: 'Why someone should join',
      description: 'Theological + relational rationale.',
      detect: t => topicHasKeyword(t, 'community', 'belonging', 'together', 'connect') },
    { key: 'bible_saying',       label: 'Bible verse or saying',
      description: 'Anchor scripture or repeated phrase.',
      detect: t => topicHasMatch(t, RE_BIBLE_REF) || itemKindMatches(t, 'scripture', 'tagline') },
    { key: 'contact',            label: 'Contact for more info',
      description: 'Who to email / call about groups.',
      detect: t => topicHasMatch(t, RE_EMAIL) || topicHasMatch(t, RE_PHONE) },
    { key: 'signup',             label: 'How to find / join a group',
      description: 'Link to PCO, ChurchCenter, or in-house finder.',
      detect: t => topicHasMatch(t, RE_URL) },
  ],

  next_steps: [
    { key: 'pathway_steps',     label: 'Discipleship pathway steps',
      description: 'Sequential steps (Starting Point → Membership → Serve → Lead).',
      detect: t => itemKindMatches(t, 'program', 'step', 'pathway_step') || (t.passages?.length ?? 0) > 1 },
    { key: 'audience',          label: 'Target audience per step',
      description: 'Who each step is for (new believers, members, etc.).',
      detect: t => topicHasKeyword(t, 'new believer', 'new to', 'first time', 'member', 'leader') },
    { key: 'registration',      label: 'Registration links',
      description: 'How to sign up for each step.',
      detect: t => topicHasMatch(t, RE_URL) },
    { key: 'frequency_location', label: 'Frequency + location',
      description: 'When + where each step happens.',
      detect: t => topicHasMatch(t, RE_TIME) || topicHasMatch(t, RE_DAY) },
  ],

  classes: [
    { key: 'class_list',  label: 'Named classes',
      description: 'Membership, foundations, specialized courses.',
      detect: t => itemKindMatches(t, 'program', 'class') },
  ],

  baptism: [
    { key: 'why_baptize',  label: 'Why someone should be baptized',
      description: 'Theology of baptism.',
      detect: t => topicHasKeyword(t, 'why', 'baptism', 'baptize', 'public declaration', 'obedience') },
    { key: 'how',          label: 'What baptism looks like',
      description: 'Method (full immersion vs sprinkling, where, with whom).',
      detect: t => topicHasKeyword(t, 'immersion', 'sprinkling', 'water', 'baptistry') },
    { key: 'scripture',    label: 'Anchor Bible verses',
      description: 'Key passages cited for baptism.',
      detect: t => topicHasMatch(t, RE_BIBLE_REF) },
    { key: 'signup',       label: 'Baptism signup',
      description: 'Form or contact to be baptized.',
      detect: t => topicHasMatch(t, RE_URL) },
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
      detect: t => itemKindMatches(t, 'partner', 'organization') },
    { key: 'opportunities',  label: 'Local outreach opportunities',
      description: 'Recurring + one-time service events.',
      detect: t => itemKindMatches(t, 'event', 'opportunity') },
  ],

  global_outreach: [
    ...ministryBaseline(),
    { key: 'partners_list',  label: 'Global ministry partners',
      description: 'Missionaries + organizations supported globally.',
      detect: t => itemKindMatches(t, 'partner', 'organization', 'missionary') },
    { key: 'opportunities',  label: 'Global outreach opportunities',
      description: 'Mission trips, sponsorships, prayer partnerships.',
      detect: t => itemKindMatches(t, 'event', 'opportunity', 'trip') },
  ],

  // ── Events ──────────────────────────────────────────────────────────
  events: [
    { key: 'events_link',     label: 'Events calendar',
      description: 'Calendar URL (PCO, ChurchCenter, embedded, etc.).',
      detect: t => topicHasMatch(t, RE_URL) || topicHasKeyword(t, 'calendar', 'upcoming events') },
    { key: 'recurring_events', label: 'Recurring events',
      description: 'Standing events on the calendar (e.g. Wednesday night).',
      detect: t => itemKindMatches(t, 'event') && topicHasMatch(t, RE_DAY) },
    { key: 'camps_retreats',  label: 'Camps + retreats',
      description: 'Annual or seasonal away events.',
      detect: t => topicHasKeyword(t, 'camp', 'retreat', 'getaway') },
  ],

  // ── Giving ──────────────────────────────────────────────────────────
  ways_to_give: [
    { key: 'platform',     label: 'Giving platform',
      description: 'Where online gifts get processed (Subsplash, PCO, etc.).',
      detect: t => topicHasKeyword(t, 'subsplash', 'planning center', 'tithely', 'pushpay') || topicHasMatch(t, RE_URL) },
    { key: 'methods',      label: 'Ways to give',
      description: 'Online, recurring, in-person, app, stocks, etc.',
      detect: t => topicHasKeyword(t, 'recurring', 'in person', 'in-person', 'app', 'online', 'check', 'stock') },
    { key: 'why_give',     label: 'Why someone should give',
      description: 'Mission-tied rationale for generosity.',
      detect: t => topicHasKeyword(t, 'because of your', 'your gift', 'generosity', 'tithe', 'why give') },
    { key: 'scripture',    label: 'Anchor scripture',
      description: 'Bible verses or sayings about giving.',
      detect: t => topicHasMatch(t, RE_BIBLE_REF) },
  ],

  campaigns: [
    { key: 'active_campaigns', label: 'Active or upcoming campaigns',
      description: 'Capital, building, vision, end-of-year campaigns.',
      detect: t => itemKindMatches(t, 'campaign', 'program') || topicHasKeyword(t, 'campaign') },
    { key: 'campaign_purpose', label: 'Campaign purpose + goal',
      description: 'What each campaign is funding.',
      detect: t => (t.passages?.length ?? 0) > 0 },
  ],
}

// ── Shared ministry baseline (cowork form: 7.0 Ministries section) ────

/** The cowork form's per-ministry checklist — used as the baseline for
 *  every ministry bucket (kids, students, adults, care, etc.). Built
 *  once and instantiated per bucket so each ministry section reads the
 *  same baseline. */
/** Simplified ministry baseline: a single freeform "details" field
 *  partners can use for anything that isn't already captured in the
 *  Program cards (which render below the form). The named program
 *  data (meeting time, leader, contact, etc.) is shown as cards
 *  separately, so we don't duplicate those fields here. */
function ministryBaseline(): BaselineField[] {
  return [
    { key: 'ministry_details',  label: 'Additional ministry details',
      description: 'Anything not already covered by the programs below — e.g. overall ministry intro, age groupings, leadership philosophy.',
      detect:  () => false },
  ]
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

/** Walk topics, return the first non-null extractor result. Returns
 *  null when no explicit extractor exists — better to render an empty
 *  input with placeholder than to repeat the same generic passage
 *  across unrelated fields (which was the prior bug — every
 *  Ministry/Why/Description prefilled identical text). Fields that
 *  need a prefill MUST declare an `extract` function. */
function safeExtract(field: BaselineField, topics: TopicRow[]): string | null {
  if (!field.extract) return null
  for (const t of topics) {
    try {
      const v = field.extract(t)
      if (v && v.trim()) return v.trim()
    } catch { /* skip */ }
  }
  return null
}

// Re-export `Passage` so consumers don't need to import from
// InventoryView when this module also re-exports the inventory types.
export type { Passage }
