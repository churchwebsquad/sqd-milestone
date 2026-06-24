/**
 * Crawl Inventory taxonomy.
 *
 * 30 buckets covering the canonical church website surface, plus
 * `other` as a catch-all so nothing the LLM can't classify ever
 * drops silently.
 *
 * Each bucket carries:
 *   · inventory_kind — 'voice_rich' (narrative — Kids, About) gets
 *                      passages + a tone summary. 'fact_rich'
 *                      (Sermons, Events, Staff) gets structured
 *                      items + a storage descriptor.
 *   · url_patterns  — regex on URL path. Pre-classifies pages
 *                      without an LLM call.
 *   · keywords      — body content phrases for the LLM prompt's
 *                      tie-breaker scoring (also used by the
 *                      pre-classifier when URL is ambiguous).
 *   · item_fields   — for fact_rich topics, the canonical fields
 *                      the LLM should extract per item. Surfaces
 *                      to the prompt so output stays consistent.
 *
 * To add a topic: append here. The categorizer + UI read this list
 * directly. Topic order in the UI follows the array order within
 * each group.
 */

export type CrawlTopicGroup =
  | 'identity'
  | 'ministry'
  | 'path'
  | 'activity'
  | 'logistics'
  | 'conversion'
  | 'other'

export type InventoryKind = 'voice_rich' | 'fact_rich'

export interface CrawlTopic {
  key:             string
  label:           string
  group:           CrawlTopicGroup
  inventory_kind:  InventoryKind
  url_patterns:    RegExp[]
  keywords:        string[]
  /** For fact_rich topics: canonical fields the LLM should extract
   *  per item. Helps keep output shape consistent across crawls. */
  item_fields?:    string[]
  /** Short prose shown in the UI under the topic title. */
  description:     string
}

export const CRAWL_TAXONOMY: readonly CrawlTopic[] = [
  // ── Identity ─────────────────────────────────────────────────────────
  {
    key: 'about', label: 'Who We Are', group: 'identity', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(about|who-we-are|our-story|story|history)\/?$/i, /^\/about\//i],
    keywords: ['who we are', 'our story', 'about us', 'mission', 'vision'],
    description: 'Identity narrative — mission, vision, story, who they are.',
  },
  {
    key: 'beliefs', label: 'Beliefs & Values', group: 'identity', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(beliefs|what-we-believe|values|doctrine|statement-of-faith)\/?/i],
    keywords: ['we believe', 'core values', 'doctrine', 'statement of faith', 'theology'],
    description: 'Statement of faith, core values, distinctives.',
  },
  {
    key: 'testimonies', label: 'Testimonies & Stories', group: 'identity', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(stories|testimonies|testimony|baptism-stories|life-change|impact-stories|my-story)\/?/i, /^\/stories\//i, /^\/testimon/i],
    keywords: ['testimony', 'testimonies', 'my story', 'life change', 'transformed', 'baptism story'],
    description: 'Verbatim partner testimonies and life-change stories the church publishes.',
  },
  {
    key: 'leadership', label: 'Leadership & Staff', group: 'identity', inventory_kind: 'fact_rich',
    // Word-boundary anchors (?:\/|$) so we don't accidentally match
    // event-style URLs like /leadership-summit or /pastors-retreat.
    // The prior `\/?` pattern allowed prefix matches and was pulling
    // in conference / summit pages.
    url_patterns: [
      /^\/(staff|team|leadership|elders|pastors|our-team)(?:\/|$)/i,
    ],
    keywords: ['lead pastor', 'executive pastor', 'elder', 'our team', 'staff directory'],
    // Explicit URL deny-list: even if a page matches a leadership
    // keyword, drop it from this topic if the URL slug points at an
    // event/summit/conference/retreat/camp/register page. Honored by
    // crawl-categorize.
    exclude_url_patterns: [/(summit|conference|retreat|camp\b|register|event|gathering)/i],
    item_fields: ['name', 'role', 'bio', 'photo_url', 'email'],
    description: 'People who lead — names, roles, contact, photos.',
  },

  // ── Ministries ───────────────────────────────────────────────────────
  {
    key: 'kids', label: 'Kids Ministry', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(kids|kids-ministry|children|childrens-ministry|kidmin)\/?/i],
    keywords: ['kids ministry', 'children', 'preschool', 'elementary', 'kids wing', 'check-in', 'birth through'],
    description: 'Birth through elementary content + safety/check-in narrative.',
  },
  {
    key: 'students', label: 'Students / Youth', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(students|youth|teens|student-ministry|youth-ministry|middle-school|high-school)\/?/i],
    keywords: ['student ministry', 'youth group', 'middle school', 'high school', '6th-8th', '9th-12th'],
    description: 'Middle and high school programming.',
  },
  {
    key: 'college', label: 'College / Young Adults', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(college|young-adults|20s|twenties|college-ministry)\/?/i],
    keywords: ['college', 'young adults', 'twenties', 'campus ministry', 'post-grad'],
    description: 'College students and 20-somethings.',
  },
  {
    key: 'adults', label: 'Adult Ministry', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(adults|adult-ministry|men|women|seniors)\/?/i],
    keywords: ['adult ministry', 'mens ministry', 'womens ministry', 'seniors', 'over 50'],
    description: 'Men, women, adult-stage programming (when not split into separate sections).',
  },
  {
    key: 'worship_music', label: 'Worship & Music', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(worship|music|worship-arts|worship-team|choir|band)\/?/i],
    keywords: ['worship team', 'music ministry', 'choir', 'band', 'worship arts'],
    description: 'Worship arts, music ministry, audition pathways.',
  },
  {
    key: 'missions', label: 'Missions & Outreach', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(missions|outreach|global|local-outreach|partners)\/?/i],
    keywords: ['missions', 'outreach', 'global partners', 'sending', 'mission trips'],
    description: 'Local and global mission engagement.',
  },
  {
    key: 'care', label: 'Care', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(care|prayer|grief|funerals|hospital)\/?/i],
    keywords: ['care ministry', 'prayer', 'grief', 'funerals', 'hospital visits', 'crisis'],
    description: 'Pastoral care, crisis, grief, prayer.',
  },
  {
    key: 'counseling', label: 'Counseling', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(counseling|biblical-counseling|therapy)\/?/i],
    keywords: ['biblical counseling', 'counseling', 'therapy', 'recovery'],
    description: 'Counseling ministry — biblical counseling, recovery groups, referrals.',
  },
  {
    key: 'special_needs', label: 'Special Needs', group: 'ministry', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(special-needs|access|inclusion|disability)\/?/i],
    keywords: ['special needs', 'inclusion', 'disability', 'access ministry', 'sensory friendly'],
    description: 'Inclusion and special-needs ministry.',
  },

  // ── Connection paths ─────────────────────────────────────────────────
  {
    key: 'new_here', label: 'New Here / First-Time', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(new|new-here|first-time|im-new|welcome)\/?/i],
    keywords: ['new here', 'first time', 'what to expect', 'welcome'],
    description: 'First-time visitor path. What to expect on Sunday.',
  },
  {
    key: 'plan_visit', label: 'Plan a Visit', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(plan-a-visit|plan-your-visit|visit)\/?/i],
    keywords: ['plan a visit', 'plan your visit', 'first sunday', 'getting here'],
    description: 'Pre-visit pathway — directions, parking, what to wear, check-in.',
  },
  {
    key: 'connect_groups', label: 'Connect / Groups', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(connect|groups|life-groups|small-groups|community|get-connected)\/?/i],
    keywords: ['get connected', 'life groups', 'small groups', 'community', 'discipleship'],
    description: 'Life Groups / Small Groups / community discipleship.',
  },
  {
    key: 'serve', label: 'Serve / Volunteer', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(serve|volunteer|get-involved|teams|ministry-teams)\/?/i],
    keywords: ['serve', 'volunteer', 'get involved', 'ministry teams', 'team signup'],
    description: 'Volunteer onboarding + serve teams.',
  },
  {
    key: 'membership', label: 'Membership', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(membership|become-a-member|covenant-membership|partnership)\/?/i],
    keywords: ['membership', 'become a member', 'covenant member', 'partnership'],
    description: 'Membership / partnership covenant pathway.',
  },
  {
    key: 'baptism', label: 'Baptism', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(baptism|baptisms|get-baptized)\/?/i],
    keywords: ['baptism', 'baptized', 'next step'],
    description: 'Baptism story, signup, next step.',
  },
  {
    key: 'next_steps', label: 'Next Steps', group: 'path', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(next-steps|next-step|grow|discipleship)\/?/i],
    keywords: ['next step', 'next steps', 'discipleship path', 'starting point'],
    description: 'Discipleship journey + decision-making path.',
  },

  // ── Activities (mostly fact-rich) ────────────────────────────────────
  {
    key: 'sundays', label: 'Sundays / Services', group: 'activity', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(sundays|sunday|services|sunday-services|gathering)\/?/i],
    keywords: ['sunday service', 'service times', 'sunday morning', 'what to expect on sunday'],
    description: 'Sunday gathering narrative + service times context.',
  },
  {
    key: 'sermons', label: 'Sermons / Messages', group: 'activity', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(sermons?|messages|teaching|preaching|watch)\/?/i, /^\/(sermons?|messages)\//i],
    keywords: ['sermons', 'messages', 'sermon series', 'watch online'],
    item_fields: ['title', 'speaker', 'date', 'series', 'video_url', 'audio_url', 'notes_url', 'description'],
    description: 'Sermon archive — title, speaker, date, series, media URLs.',
  },
  {
    key: 'events', label: 'Events / Calendar', group: 'activity', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(events?|calendar|happenings)\/?/i, /^\/(events?|calendar)\//i],
    keywords: ['events', 'upcoming events', 'calendar', 'happenings', 'register'],
    item_fields: ['name', 'start_date', 'end_date', 'time', 'location', 'audience', 'register_url', 'description'],
    description: 'Upcoming + recurring events. Each item carries date, time, audience, registration.',
  },
  {
    key: 'camps_retreats', label: 'Camps / Retreats', group: 'activity', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(camp|camps|retreat|retreats|conferences?)\/?/i],
    keywords: ['camp', 'retreat', 'overnight', 'conference', 'getaway'],
    item_fields: ['name', 'start_date', 'end_date', 'audience', 'cost', 'register_url'],
    description: 'Camps, retreats, conferences. Big-ticket events that often live in their own section.',
  },
  {
    key: 'blog_news', label: 'Blog / News', group: 'activity', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(blog|news|articles|posts)\/?/i, /^\/(blog|news|articles)\//i],
    keywords: ['blog', 'latest news', 'articles', 'updates'],
    item_fields: ['title', 'author', 'date', 'excerpt', 'url'],
    description: 'Blog posts / news / articles archive.',
  },

  // ── Logistics ────────────────────────────────────────────────────────
  {
    key: 'location_contact', label: 'Location & Contact', group: 'logistics', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(contact|location|directions|where|find-us)\/?/i],
    keywords: ['contact us', 'directions', 'address', 'parking', 'get in touch'],
    description: 'Physical address, directions, parking, primary contact channels.',
  },
  {
    key: 'locations_multi', label: 'Locations (multi-site)', group: 'logistics', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(locations|campuses|sites)\/?/i, /^\/(locations|campuses|sites)\//i],
    keywords: ['campuses', 'locations', 'satellite', 'campus pastor'],
    item_fields: ['name', 'address', 'service_times', 'campus_pastor', 'phone', 'website'],
    description: 'Multi-site / multi-campus listings.',
  },
  {
    key: 'school', label: 'School / Preschool', group: 'logistics', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(school|preschool|academy|christian-school)\/?/i],
    keywords: ['christian school', 'preschool', 'academy', 'k-12', 'enrollment'],
    description: 'School or preschool affiliated with the church.',
  },
  {
    key: 'newsletter_bulletin', label: 'Newsletter & Bulletin', group: 'logistics', inventory_kind: 'fact_rich',
    url_patterns: [/^\/(newsletter|bulletin|weekly-update|enews|e-news|news)\/?/i, /^\/(newsletter|bulletin)\//i],
    keywords: ['newsletter', 'bulletin', 'weekly update', 'enews', 'subscribe', 'mailing list'],
    item_fields: ['title', 'date', 'link', 'excerpt'],
    description: 'Newsletter, weekly bulletin, or email digest entries with link + date.',
  },

  // ── Conversion ───────────────────────────────────────────────────────
  {
    key: 'giving', label: 'Giving', group: 'conversion', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(give|giving|donate|stewardship|tithe)\/?/i],
    keywords: ['give online', 'giving', 'tithe', 'donate', 'stewardship', 'planned giving'],
    description: 'Online giving + stewardship narrative.',
  },
  {
    key: 'capital_campaign', label: 'Capital Campaign', group: 'conversion', inventory_kind: 'voice_rich',
    url_patterns: [/^\/(campaign|capital-campaign|building|growth-campaign)\/?/i],
    keywords: ['capital campaign', 'building campaign', 'pledge', 'expansion'],
    description: 'Capital campaigns, building expansions, special asks.',
  },

  // ── Catch-all ────────────────────────────────────────────────────────
  // The categorizer assigns anything it can't cleanly classify here.
  // Nothing drops silently. The UI surfaces the orphan passages so
  // strategists can promote a new topic if a pattern emerges.
  {
    key: 'other', label: 'Other / Unclassified', group: 'other', inventory_kind: 'voice_rich',
    url_patterns: [],   // no auto-match — only assigned by the LLM fallback
    keywords: [],
    description: 'Pages and passages the classifier couldn\'t fit a defined topic. Review periodically — recurring patterns are candidates for a new taxonomy entry.',
  },
]

export const TOPIC_BY_KEY: Readonly<Record<string, CrawlTopic>> = Object.freeze(
  CRAWL_TAXONOMY.reduce<Record<string, CrawlTopic>>((acc, t) => {
    acc[t.key] = t
    return acc
  }, {}),
)

/** Pre-classify a URL into zero or more topic keys based on path
 *  patterns. Returns 0 keys when the URL doesn't match anything — the
 *  LLM step picks it up. */
export function preClassifyUrl(url: string): string[] {
  let path = url
  try { path = new URL(url).pathname } catch { /* relative or malformed */ }
  const hits: string[] = []
  for (const t of CRAWL_TAXONOMY) {
    if (t.key === 'other') continue
    for (const re of t.url_patterns) {
      if (re.test(path)) {
        hits.push(t.key)
        break
      }
    }
  }
  return hits
}

/** Group taxonomy keys by inventory_kind for rendering. */
export function topicsByKind(kind: InventoryKind): readonly CrawlTopic[] {
  return CRAWL_TAXONOMY.filter(t => t.inventory_kind === kind)
}

/** Group taxonomy keys by topic_group for the sidebar accordion. */
export function topicsByGroup(): Record<CrawlTopicGroup, readonly CrawlTopic[]> {
  const out: Record<CrawlTopicGroup, CrawlTopic[]> = {
    identity: [], ministry: [], path: [], activity: [],
    logistics: [], conversion: [], other: [],
  }
  for (const t of CRAWL_TAXONOMY) out[t.group].push(t)
  return out
}

export const GROUP_LABELS: Record<CrawlTopicGroup, string> = {
  identity:   'Identity',
  ministry:   'Ministries',
  path:       'Connection paths',
  activity:   'Activities',
  logistics:  'Logistics',
  conversion: 'Conversion',
  other:      'Other',
}
