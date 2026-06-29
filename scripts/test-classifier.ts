// Standalone sanity check for the schema classifier.
// Feeds synthetic 3672 sections; prints schema_name + confidence +
// field diagnostics + CTA breakdown for each. Used to validate the
// classifier in isolation before wiring into buildDiscoverySections.
//
// Run with: npx tsx scripts/test-classifier.ts

import { classifySchema } from '../src/lib/acfFormationPlan/classifySchema'

// ── Synthetic 3672 sections (drawn from the hand-run handoff) ─────────

const SECTIONS = [
  // ── Home page ──
  {
    name: 'Home / Join Us Every Sunday',
    page_slug: 'home',
    heading:   'Join Us Every Sunday',
    section_role: null,
    template_id:  'content-section-45',
    template_field_keys: ['heading', 'description', 'list_content'],
    items: [
      { heading: '9:15 & 11:00 AM', description: 'Two worship services every Sunday', when: '9:15 AM and 11:00 AM' },
      { heading: '9200 N. Oracle Rd.', description: 'Oro Valley, Arizona' },
    ],
  },
  {
    name: 'Home / Find Community & Belonging',
    page_slug: 'home',
    heading:   'Find Community & Belonging',
    section_role: 'feature_grid' as const,
    template_id:  'feature-section-2',
    template_field_keys: ['heading', 'description', 'heading_card', 'description_card', 'cta_label', 'cta_url'],
    items: [
      { name: 'NextGen Kids',           description: 'Sunday mornings made for infants through 5th grade.', audience: 'infants-5th',   cta_label: 'For Families',  cta_url: '/nextgen-kids' },
      { name: 'NextGen Students',       description: 'Middle and high school.',                              audience: '6th-12th grade',cta_label: 'For Students',  cta_url: '/nextgen-students' },
      { name: 'Blessed Beginnings',     description: 'Our on-campus preschool.',                             audience: 'preschool',     cta_label: 'Learn More',    cta_url: '/blessed-beginnings' },
      { name: 'Young At Heart',         description: 'Outings, meals, and trips with friends.',              audience: 'seniors',       cta_label: 'For Seniors',   cta_url: '/adults' },
      { name: "Women's Community",      description: 'Studies, events, and friendship for women.',           audience: 'women',         cta_label: 'For Women',     cta_url: '/adults' },
      { name: "Men's Community",        description: 'Breakfasts, studies, and real conversation for men.',  audience: 'men',           cta_label: 'For Men',       cta_url: '/adults' },
    ],
  },
  {
    name: 'Home / Grow, Serve, Give, Share',
    page_slug: 'home',
    heading:   'Grow, Serve, Give, Share',
    section_role: 'feature_grid' as const,
    template_id:  'feature-section-2',
    template_field_keys: ['heading', 'description', 'heading_card', 'description_card', 'cta_label', 'cta_url'],
    items: [
      { step_order: 1, name: 'Grow',  description: 'Join a Talk, Listen, Do, or Care group.',  action_url: '/groups',   cta_url: '/groups',   cta_label: 'Find a Group' },
      { step_order: 2, name: 'Serve', description: 'Lend a hand at the church and across the city.', action_url: '/events',   cta_url: '/events',   cta_label: 'Get Involved' },
      { step_order: 3, name: 'Give',  description: 'Give to support the work, here and beyond.', action_url: '/give',     cta_url: '/give',     cta_label: 'Ways to Give' },
      { step_order: 4, name: 'Share', description: 'Share the good news of Jesus.',              action_url: '/discover', cta_url: '/discover', cta_label: 'Learn More' },
    ],
  },

  // ── Groups page ──
  {
    name: 'Groups / Ways to Connect',
    page_slug: 'groups',
    heading:   'Ways to Connect',
    section_role: null,
    template_id:  'feature-section-2',
    template_field_keys: ['heading', 'description', 'heading_card', 'description_card', 'cta_label', 'cta_url'],
    items: [
      { name: 'Talk Groups',   description: 'A discussion format.',           meeting_locations: 'On campus, in homes, and online classes coming soon', cta_label: 'Browse Talk Groups',   cta_url: 'https://cdobc.churchcenter.com/groups/talk-groups' },
      { name: 'Listen Groups', description: 'A lecture-style format.',         meeting_locations: 'On campus, in homes, and online',                     cta_label: 'Browse Listen Groups', cta_url: 'https://cdobc.churchcenter.com/groups/listen-groups' },
      { name: 'Do Groups',     description: 'Built around a common activity.', meeting_locations: 'On campus',                                            cta_label: 'Browse Do Groups',     cta_url: 'https://cdobc.churchcenter.com/groups/do-groups' },
      { name: 'Care Groups',   description: 'Focused around a life circumstance.', focus_areas: 'Grief, Divorce, Addiction, Mental Health', support_model: 'Partnered with national resources', cta_label: 'Browse Care Groups', cta_url: 'https://cdobc.churchcenter.com/groups/care-groups' },
    ],
  },

  // ── Events page ──
  {
    name: 'Events / Signature Events',
    page_slug: 'events',
    heading:   'Signature Events',
    section_role: 'feature_grid' as const,
    template_id:  'feature-section-2',
    template_field_keys: ['heading', 'description', 'heading_card', 'description_card'],
    items: [
      { name: 'SpringFest',                       description: 'Our annual outdoor community event.' },
      { name: 'Good Friday Service',              description: 'A moving annual service.' },
      { name: 'A Campus for the Community',       description: 'Campus hosts BSF, recovery, HOA meetings, etc.' },
    ],
  },
]

// ── Run + print ───────────────────────────────────────────────────────

console.log('Classifier sanity check — synthetic 3672 sections\n')
for (const s of SECTIONS) {
  const result = classifySchema({
    page_slug:           s.page_slug,
    heading:             s.heading,
    section_role:        s.section_role,
    items:               s.items,
    template_field_keys: s.template_field_keys,
    template_id:         s.template_id,
  }, { debug: true })

  console.log(`── ${s.name}`)
  console.log(`   schema:     ${result.schema_name ?? '(null)'}  [${result.schema_confidence}]`)
  console.log(`   items:      ${s.items.length}`)
  console.log(`   cta:        ${JSON.stringify(result.cta_target_breakdown)}`)
  console.log(`   fill rates: ${result.schema_field_diagnostics.map(d => `${d.key}=${d.fill_count}/${d.fill_total}${d.in_bound_template ? '' : ' ⚠dropped'}`).join('  ')}`)
  if (result.build_time_issues.length > 0) {
    for (const issue of result.build_time_issues) {
      console.log(`   🔴 ${issue.kind} on ${issue.template_id} — dropped: [${issue.dropped_fields.join(', ')}] (${issue.severity})`)
    }
  }
  // Print top 3 candidate scores for visibility
  const top3 = result._debug_scores!.slice(0, 3)
  console.log(`   scores:     ${top3.map(s => `${s.schema}=${s.score}(${s.reasons.join(',')})`).join('  ')}`)
  console.log('')
}
