/**
 * Partner-facing inventory groups.
 *
 * The crawl categorizer writes to a flat 30-topic taxonomy
 * (see webCrawlTaxonomy.ts). Partners see those topics regrouped into
 * an 8-section structure that matches how they think about their
 * site: Details / About / Weekend / Staff & Volunteers / Discipleship
 * / Ministries / Events / Giving.
 *
 * One topic can appear in only one bucket. Buckets can include zero
 * topics (e.g. Branding & Photos is staff-supplied, never crawled).
 *
 * For `missions`, the Local vs Global split is by `scope` field on the
 * named programs inside the topic — not a topic split — so both
 * "Local Outreach" and "Global Outreach" buckets reference the same
 * `missions` topic with different `programScope` filters.
 */

export interface PartnerBucket {
  key:           string
  label:         string
  /** Crawl topics (from webCrawlTaxonomy) that flow into this bucket. */
  topics:        string[]
  /** If set, only include named programs inside the topic whose `scope` matches. */
  programScope?: 'local' | 'global'
  /** Bucket is staff-supplied; no crawl topics feed it. UI shows an empty-state with a way to add manually. */
  staffSupplied?: boolean
  /** Short hint shown next to the bucket header. */
  helpText?:     string
}

export interface PartnerGroup {
  key:     string
  label:   string
  buckets: PartnerBucket[]
}

export const PARTNER_GROUPS: PartnerGroup[] = [
  {
    key: 'details', label: 'The Details',
    buckets: [
      { key: 'contact', label: 'Contact Information',
        topics: ['location_contact'],
        helpText: 'Phone, email, address, parking, directions.' },
      { key: 'social_newsletter', label: 'Social Media, Newsletter & Bulletin',
        topics: ['newsletter_bulletin', 'blog_news'],
        helpText: 'Newsletter, bulletin, blog. Social handles populate from globals.' },
      { key: 'branding_photos', label: 'Branding & Photos',
        topics: [], staffSupplied: true,
        helpText: 'Logo, brand guide, photo library — supplied during onboarding.' },
    ],
  },
  {
    key: 'about', label: 'About Your Church',
    buckets: [
      { key: 'mission_beliefs', label: 'Mission & Beliefs',
        topics: ['about', 'beliefs'],
        helpText: 'Mission, vision, statement of faith, distinctives.' },
      { key: 'campuses', label: 'Campuses',
        topics: ['locations_multi'],
        helpText: 'Each location: address, service times, campus pastor, parking, directions.' },
      { key: 'origins_lingo', label: 'Church Origins & Common Lingo',
        topics: [],
        helpText: 'Founding story + the words your church uses regularly. Surfaced from voice signals.' },
    ],
  },
  {
    key: 'weekend', label: 'Weekend Services',
    buckets: [
      { key: 'service_details', label: 'Service Details',
        topics: ['sundays', 'worship_music'],
        helpText: 'What Sundays feel like, worship style, service flow.' },
      { key: 'visit_details', label: 'Visit Details',
        topics: ['plan_visit', 'new_here'],
        helpText: 'First-time visitor info, what to expect, plan a visit.' },
      { key: 'sermons', label: 'Sermons',
        topics: ['sermons'],
        helpText: 'Sermon archive and how it’s organized.' },
    ],
  },
  {
    key: 'staff_volunteers', label: 'Staff, Volunteers & Testimonies',
    buckets: [
      { key: 'staff', label: 'Staff',
        topics: ['leadership'],
        helpText: 'Lead pastor + named staff with roles and bios.' },
      { key: 'careers', label: 'Careers',
        topics: [], staffSupplied: true,
        helpText: 'Open positions and how to apply — staff-supplied.' },
      { key: 'volunteers', label: 'Volunteers',
        topics: ['serve'],
        helpText: 'Serve teams, sign-up flow, expectations.' },
      { key: 'testimonies', label: 'Testimonies',
        topics: ['testimonies'],
        helpText: 'Verbatim life-change stories.' },
    ],
  },
  {
    key: 'discipleship', label: 'Discipleship & Next Step Pathways',
    buckets: [
      { key: 'small_groups', label: 'Small Groups',
        topics: ['connect_groups'],
        helpText: 'Groups, life groups, community.' },
      { key: 'next_steps', label: 'Next Steps',
        topics: ['next_steps'],
        helpText: 'The discipleship journey — from new believer to leader.' },
      { key: 'classes', label: 'Classes',
        topics: ['membership'],
        helpText: 'Membership class, foundations, named programs inside Next Steps.' },
      { key: 'baptism', label: 'Baptism',
        topics: ['baptism'],
        helpText: 'Baptism theology, scheduling, FAQs.' },
    ],
  },
  {
    key: 'ministries', label: 'Ministries',
    buckets: [
      { key: 'kids', label: 'Kids',
        topics: ['kids'],
        helpText: 'Kids ministry, age groups, check-in, programs.' },
      { key: 'students', label: 'Students / Youth',
        topics: ['students'],
        helpText: 'Middle + high school ministry, programs, leaders.' },
      { key: 'college', label: 'College / Young Adults',
        topics: ['college'],
        helpText: 'College + 20s ministry.' },
      { key: 'adults', label: 'Adults',
        topics: ['adults'],
        helpText: 'Men’s, women’s, seniors and other adult-focused ministries.' },
      { key: 'care', label: 'Care',
        topics: ['care', 'counseling', 'special_needs'],
        helpText: 'Pastoral care, counseling, special needs, inclusion.' },
      { key: 'local_outreach', label: 'Local Outreach',
        topics: ['missions'], programScope: 'local',
        helpText: 'Local outreach programs from the Missions topic (filtered by scope:local).' },
      { key: 'global_outreach', label: 'Global Outreach',
        topics: ['missions'], programScope: 'global',
        helpText: 'Global missions partnerships and trips (scope:global).' },
      { key: 'additional', label: 'Etc — Additional Ministries',
        topics: ['school', 'other'],
        helpText: 'School/preschool affiliations + anything the classifier didn’t fit elsewhere.' },
    ],
  },
  {
    key: 'events', label: 'Events',
    buckets: [
      { key: 'events', label: 'Events',
        topics: ['events', 'camps_retreats'],
        helpText: 'Calendar, recurring events, camps, retreats, conferences.' },
    ],
  },
  {
    key: 'giving', label: 'Giving',
    buckets: [
      { key: 'ways_to_give', label: 'Ways to Give',
        topics: ['giving'],
        helpText: 'Online, recurring, crypto, stocks, tiers, FAQs.' },
      { key: 'campaigns', label: 'Giving Campaigns',
        topics: ['capital_campaign'],
        helpText: 'Capital campaigns, building funds, vision asks.' },
    ],
  },
]

/** Reverse index: topic key → the bucket(s) it appears in.
 *  Used to detect when a crawl topic isn't accounted for (the result
 *  is empty), which should only happen if we add a new topic to the
 *  taxonomy without updating PARTNER_GROUPS. */
export const TOPIC_TO_BUCKET: Readonly<Record<string, { groupKey: string; bucketKey: string }[]>> =
  (() => {
    const out: Record<string, { groupKey: string; bucketKey: string }[]> = {}
    for (const g of PARTNER_GROUPS) {
      for (const b of g.buckets) {
        for (const t of b.topics) {
          (out[t] ??= []).push({ groupKey: g.key, bucketKey: b.key })
        }
      }
    }
    return Object.freeze(out)
  })()
