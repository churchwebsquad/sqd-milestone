// One-time seed for strategy_talking_points. Idempotent — upserts
// by title so re-running with edited body text refreshes the
// block. Run with:
//
//   node scripts/seed-talking-points.mjs
//
// Categories: process_value, value_prop, cadence, objections,
// differentiator.
//
// Each block is markdown and supports merge fields like
// {{church_name}}, {{projected_launch}}, {{target_date}} resolved
// at assembly time by the responder LLM.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const supabase = createClient(url, key)

const BLOCKS = [
  {
    category: 'process_value',
    title: 'Why partner-led review takes longer than drag-and-drop',
    body: `Our process isn't slow — it's deliberate. Every page goes through copywriting + design + final-review rounds with the partner because we're not just shipping a website; we're shipping a website that the church can actually use and steward. The two-week review windows aren't padding — they're where the partner shows it to their team, catches what doesn't fit their voice, and signs off. Skip that and you ship a site the leadership doesn't recognize.`,
    tags: ['process_value', 'review_cycles'],
    sort_order: 10,
  },
  {
    category: 'value_prop',
    title: 'What partners are paying for (vs. SaaS builders)',
    body: `A SaaS site builder gives you templates + a do-it-yourself canvas. What we give you is the strategy phase, the brand integration, the partner-voiced copy, the SEO build-out, the accessibility pass, and a Bricks/ACSS Pro foundation that another agency can extend in five years without a rebuild. That's why an 8-week build at a builder vs. our 12+ weeks isn't an apples-to-apples comparison.`,
    tags: ['value_prop'],
    sort_order: 20,
  },
  {
    category: 'cadence',
    title: 'Our 10-step process: where you are right now',
    body: `The Web Redesign pathway is Onboard → Strategy → Strategy Review → Copywriting → Copy Review → Design → Design Review → Build → Final Review → Launch. Each step has its own milestone notification so the team and the partner always know what's next. Most timeline shifts happen at Copy Review and Design Review — those are where partner feedback is densest. You're currently in the {{current_phase}} phase.`,
    tags: ['cadence'],
    sort_order: 30,
  },
  {
    category: 'cadence',
    title: 'Why design is paused on brand handoff',
    body: `Design phase can't start until the partner's brand handoff is complete — colors, typography, voice attributes. If brand is still in flight, we hold design rather than guess and rebuild later. The fastest way to pull design forward is to finish the brand approval; we can pre-stage everything else (copy, IA, dev scaffolding) in parallel.`,
    tags: ['cadence', 'brand_dependency'],
    sort_order: 40,
  },
  {
    category: 'objections',
    title: 'The cost of cutting review cycles',
    body: `When an AM asks "can we skip a partner review to pull this in?" — the answer is yes, it would save about a week. The cost is that we ship without the partner's leadership seeing the final shape. That's how launches turn into post-launch revision marathons. We can skip a round when the partner is responsive and the team trusts the work; we shouldn't skip it because we're up against a parallel marketing date.`,
    tags: ['objections', 'review_cycles'],
    sort_order: 50,
  },
  {
    category: 'objections',
    title: 'Why Group Kickoff URLs should point to the old site temporarily',
    body: `If the new site won't be live by the marketing-materials deadline, point the QR codes + URLs at the existing site for now. We can stand up redirect rules on launch day so the printed URL still works — visitors get auto-routed to the new equivalent page. That gives the partner cover to launch without rushing the new site through review.`,
    tags: ['objections', 'group_kickoff', 'fall_launch'],
    sort_order: 60,
  },
  {
    category: 'objections',
    title: 'Page count vs. timeline tradeoff',
    body: `Each additional page is roughly 3 hours of work across copy, design, and dev. If the timeline pressure is real, the cleanest lever is reducing scope — pages that can land in a Phase 2 rollout instead of launch. We typically recommend launching with 8 anchor pages and adding the rest in 2-4 week increments after go-live. The partner gets a real launch on the target date without the leadership feeling like they shipped a stub.`,
    tags: ['objections', 'scope'],
    sort_order: 70,
  },
  {
    category: 'objections',
    title: 'How partner responsiveness shifts the timeline',
    body: `Our timeline math assumes 2-3 business days for partner responses on review cycles. If responses take a week or more, the project shifts by the same amount on every round — and there are 3 partner reviews. A 7-day delay × 3 rounds = three weeks of slip. The fastest thing a partner can do to bring their launch forward is reply faster to milestone notifications.`,
    tags: ['objections', 'partner_responsiveness'],
    sort_order: 80,
  },
  {
    category: 'value_prop',
    title: 'The launch is the start, not the finish',
    body: `Our launch isn't a hand-off — it's day one of an ongoing partnership. The site we ship is the foundation; we keep iterating with the partner through their first year so the website actually grows with them. That's a different commitment than a builder template or an agency that disappears on Day 91.`,
    tags: ['value_prop', 'long_term'],
    sort_order: 90,
  },
  {
    category: 'differentiator',
    title: 'SEO + accessibility built in',
    body: `Every page ships with structured data, alt text on every image, semantic landmarks, focus-visible styles, and a real meta-description per page. Most builders treat accessibility as an after-launch checkbox; we treat it as part of design. That's why the build phase has the hours it has.`,
    tags: ['differentiator', 'seo', 'a11y'],
    sort_order: 100,
  },
  {
    category: 'differentiator',
    title: 'Real strategy phase, not just design',
    body: `Before any pixel is pushed, the strategy phase produces the brief: who the site is for, what action it's driving, what messaging the partner already repeats, where they want their visitors to land. That's the document the team and the partner come back to every time a "should we add X?" question comes up. It's also why we don't quote "design in two weeks" timelines.`,
    tags: ['differentiator', 'strategy'],
    sort_order: 110,
  },
  {
    category: 'differentiator',
    title: 'Brand + voice integration',
    body: `Most agencies "use the brand" — we integrate it. The partner's voice attributes drive the copywriter; the brand colors anchor the ACSS design tokens; the typography + radius + spacing all derive from the brand spec. That's why we wait on brand before design and why we don't bolt those decisions on at the end.`,
    tags: ['differentiator', 'brand'],
    sort_order: 120,
  },
]

let inserted = 0
let updated = 0

for (const b of BLOCKS) {
  // Find existing by title.
  const { data: existing } = await supabase
    .from('strategy_talking_points')
    .select('id')
    .eq('title', b.title)
    .maybeSingle()
  if (existing) {
    const { error } = await supabase
      .from('strategy_talking_points')
      .update({
        category: b.category,
        body: b.body,
        tags: b.tags,
        sort_order: b.sort_order,
        is_active: true,
      })
      .eq('id', existing.id)
    if (error) console.error(`[fail] update ${b.title}: ${error.message}`)
    else updated++
  } else {
    const { error } = await supabase
      .from('strategy_talking_points')
      .insert(b)
    if (error) console.error(`[fail] insert ${b.title}: ${error.message}`)
    else inserted++
  }
}

console.log(`Done. Inserted ${inserted}, updated ${updated} of ${BLOCKS.length} blocks.`)
