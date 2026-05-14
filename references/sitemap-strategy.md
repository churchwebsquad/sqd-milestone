# Sitemap Strategy — Stage 2 system reference

Adapted from the CS team's sitemap-generator skill for the Content Manager
pipeline. The skill's Notion delivery sub-steps (A–I), CS review checklist,
and the four-output partner artifact don't apply here — Stage 2 writes its
output to `roadmap_state.stage_2`, downstream stages consume it directly.

What carries over is the strategic spine: how to pick pages, how to name
them, how to nest, how to flag.

---

## Core principles

**1. Less is more.** Aim for the smallest page count that gives every
important content item a home. Density-driven nesting beats page
proliferation. Stage 1's `recommended_pages` is a first proposal — your job
is to challenge it.

**2. Phase 1 = 6 pages.** Hard cap at 7. The mandatory 4 plus 2 strategically
chosen pages.

Mandatory 4 (always Phase 1, no exceptions):
- Homepage
- Plan a Visit / Next Steps (whatever the church names it)
- Sermons / Watch / Messages (whatever the church names it)
- Give / Generosity (whatever the church names it)

Pick 2 more from these candidates, based on the church's primary audience
and stated goals:
- About / Our Story — when trust-building is primary
- Kids Ministry — when families are explicitly the target audience AND
  Kids content is confirmed (name, schedule, age ranges, check-in)
- What We Believe / Beliefs — when theological clarity is a stated priority
  or audience carries church hurt
- Meet Our Team / Staff — when confirmed bios + photos exist AND staff
  presence is a known draw

Only pick 2. If three feel equally important, move one to Phase 2 and
note why.

**Bilingual override:** Any Spanish-language or non-English congregation
gets a dedicated Phase 1 page. This is the one legitimate path to 7 Phase
1 pages.

**3. Phase 2 = everything else.** Cap total Phase 1 + Phase 2 at 20 pages.
Consolidate when count threatens to exceed:
- Combine Men's + Women's → "Adults" with sections
- Combine Local + Global Outreach → "Outreach"
- Roll Baptism + New Believer into Discipleship / Next Steps
- Move Membership into a section on About

Always note consolidations explicitly so the strategist can defend them.

**4. Vocabulary fits the voice.** Default page names like "Plan a Visit,"
"About Us," "Sermons" are safe but generic. Match the church's voice register
from Stage 1's `voice_characteristics.top_attributes`:

- Bold / city / Detroit-grit type voice → "Sundays," "Who We Are," "Listen"
- Formal / traditional → "Visit," "Our Story," "Sermons"
- Conversational → "First Time?," "Us," "Watch"
- Thematic groupings (Reality LA pattern) → "Jesus / You / Us"
- Action verbs (Austin Stone pattern) → "Take / Attend / Join / Go / Learn / Lead / Serve"
- Minimal → "Visit," "About," "Watch," "Give"

When the voice is unclear or conservative, default to standard names. Don't
force novelty.

**5. Nav patterns unlock structure.** Pick one that fits the church:

- **Flat:** Each item is a page. Best for small churches, simple sites.
  (Passion City pattern.)
- **Grouped dropdowns:** Parent labels reveal child pages. Best when 10+
  pages exist and grouping aids scanning. (Reality LA's Jesus / You / Us
  with dropdowns.)
- **Thematic verbs:** Action labels group pages by what visitor does.
  Best when the church has many overlapping ministries. (Austin Stone's
  Take / Attend / Join / Go.)
- **Offcanvas:** Slide-in menu, gives room for full ministry listing
  without cluttering header. Best for 15+ pages.
- **Megamenu:** Wide dropdown with scannable grid. Best for large churches
  with many distinct pages.

Default conservatively: flat or grouped dropdowns for most. Reserve
thematic patterns for churches whose voice register explicitly supports it.

**6. Density signals:**
- `high` = enough unique content for a robust page
- `medium` = adequate for a focused page; may need section work
- `low` = should be absorbed into a parent page or dropped

**7. Phase tagging:**
- `1` = MVP launch
- `2` = post-launch additions (parking lot)
- `nav-only` = item in nav, page not built (external link / archive)
- `global` = chrome (header / footer / banner)

---

## Page-by-page output

Every page in the output gets a complete outline with these fields:

- `name` — display name (e.g., "Plan a Visit," "Sundays")
- `slug` — URL slug (e.g., "plan-a-visit," "sundays")
- `nav_label` — what shows in nav (often same as name)
- `phase` — 1 / 2 / nav-only / global
- `parent_slug` — null for top-level, parent slug for nested
- `page_type` — content / chrome / functional
- `strategic_purpose` — one sentence: what this page does for the visitor
- `rationale` — why exists, why named this way
- `content_sources` — which intake source(s) feed this page
- `density` — high / medium / low
- `hero` — { headline_direction, subheadline_direction, primary_cta }
- `sections` — array of { name, contains, content_source, aeo_note? }
- `primary_action` — the one thing the visitor should do on this page
- `secondary_action` — supporting action (optional)

Phase 1 outlines should be detailed enough to begin copywriting (Stage 5).
Phase 2 outlines can be lighter — blueprints to expand later.

---

## AEO / GEO framework

For each page, think through:

- **Direct answer structure:** Does this answer a "who / what / where / when"
  question someone might ask Google, Siri, or ChatGPT? (e.g., "What time
  does [Church] in [City] start?")
- **Entity clarity:** Does the page establish church name + city + state
  clearly enough for search engines?
- **Intent matching:** Does the page title use language visitors search for,
  not insider church language? ("Family" over "Ministries," "Find a Church"
  over "Visit Us")

Surface AEO notes on Plan a Visit, Contact, Sermons, Kids, and Beliefs at
minimum.

Provide AEO keyword targets in the output:
- Primary (2–3 high-intent local terms)
- Secondary (5–7 semantic variations)
- Long-tail (specific question phrases this church can own)

Ground keywords in the church's actual location, denomination, and audience.
"Church near me" is not useful. Specific local + denominational terms are.

---

## Strategic discipline

**Be strategic, not literal.** Don't take the content collection at its
word. If 5 ministry sub-pages have only a paragraph each, nest them as
sections on a single Ministries page. If the strategy brief says "don't
promote the Apple Podcast," drop it.

**Every page traces to a source.** Every claim, every section, every
service time, staff name, ministry name must come from intake. Speculative
pages get flagged in `cs_flags.soft_assumptions`.

**Use partner vocabulary.** If the church calls volunteers "Disciples
Serve," use that. If sermons are called "Messages," use that.

**Vocabulary decisions explained.** Whenever you choose a non-default name
(e.g., "Sundays" instead of "Plan a Visit"), record it in
`vocabulary_decisions` with rationale tied to Stage 1 voice.

**Traffic retention audit.** If a current site URL exists in intake, flag
which current nav items send visitors away (YouTube, external giving,
Planning Center) and propose where those could become internal pages.

---

## CS Flags (carry forward from skill)

Separate into three categories:

- **hard_blockers** — copy can't be written without resolving. Escalate
  to AM immediately. (e.g., "Kids ministry name confirmed but no schedule
  provided.")
- **soft_assumptions** — verify with partner or AM before Review 1.
  (e.g., "Assumed Spanish-language ministry from one mention in
  Discovery; needs confirmation before Phase 1 reserves a slot.")
- **design_flags** — route to Web Director, not the strategist. (e.g.,
  "Megamenu recommended — designer needs to confirm header component
  supports it.")

---

## Voice rules (carry from Stage 1)

Apply to every string you emit:
- No em-dashes (— or –). Use periods or commas.
- No three-adjective clusters. Pick the single strongest word.
- No filler intensifiers: truly, really, deeply, incredibly, very, amazing,
  just, simply.
- No AI clichés: delve, tapestry, unlock, unleash, elevate, beacon, embark,
  resonate, dynamic, synergistic, game-changer, seamless, robust, leverage,
  transformative, vibrant, foster, pivotal, paramount.
- No church clichés: "come as you are," "life-changing," "vibrant community,"
  "spiritual journey," "walk with God."
- No "We / Our" framing for partner-facing copy. Refer to the church by name.
- Jesus is the destination. Programs are the vehicle. Name Jesus explicitly
  at least once in the page outlines (e.g., in Homepage hero direction or
  Sermons strategic purpose).

---

## When in doubt

- Default conservative on page names.
- Default conservative on nav patterns (flat or grouped dropdowns).
- Default fewer pages.
- Always flag, never invent.
