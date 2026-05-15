# Sitemap Strategy — Stage 2 system reference (current state)

This is the working document the Stage 2 agent (`/api/web/agents/draft-sitemap`)
is built around. Adapted from the CS team's original sitemap-generator
skill, with everything we've added through iteration captured in one
place. Use this as the basis for the cowork session that produces a
"golden output" reference.

The CS skill's Notion delivery sub-steps (A–I), CS Review Checklist,
and four-output partner artifact don't apply here — Stage 2 writes its
output to `roadmap_state.stage_2` and downstream stages consume it
directly. What carries over is the strategic spine.

---

## 1. Mission

Take Stage 1's strategic foundation (audience, voice, personas, x-factor,
project goals, sitemap signals, sources) plus the original intake sources
(Strategy Brief, AM Handoff, Discovery Questionnaire, Brand Handoff,
Content Collection) and propose a LEAN strategic sitemap.

Scope: the sitemap only — page list + nav structure + vocabulary + AEO
keywords + CS flags. **No page outlines.** Hero direction, sections,
CTAs come in Stage 4 (Per-Page Roadmap) where each page gets its own
focused call with prompt caching.

---

## 2. CORE INVARIANTS — non-negotiable

These are the rules the Stage 2 system prompt opens with. Violating any
of them is a failure.

1. **Preservation on redo.** When a "Previous proposal" block is in
   user input, that proposal is LOCKED. Every page, slug, nav item,
   dropdown, footer section, vocabulary decision, AEO keyword, and
   audit row from the previous proposal MUST appear in the new output
   exactly as before, unless the strategist's feedback explicitly
   names it for change. Self-check: walk every page in your output
   and ask "did the feedback name this for change?" If no, it must
   match the previous proposal byte-for-byte.

2. **`content_coverage_audit` must be populated and exhaustive.**
   Empty array = failure. Every ministry name, service time, program,
   staff role, event series, external platform from the content
   collection gets one row with status: `placed` / `nested` /
   `navonly` / `dropped`.

3. **Every page must appear in `header_nav` OR `footer_nav`.**
   Orphaning a page is a failure. Walk every page in `pages[]` and
   verify it shows up in one of the two nav structures.

4. **No duplicate slugs in `pages[]` or in nav.** Two entries with
   the same slug = failure.

5. **Required pages can't disappear.** Homepage, Plan a Visit /
   Sundays, Sermons / Messages, Give — these four are mandatory
   Phase 1. Missing any of them = failure.

---

## 3. Phase 1 = launch sequencing, not nav structure

The nav tree must reflect the **full site** (Phase 1 + Phase 2 pages
together) as visitors will see it post-launch. Phase 2 pages are real
pages on the real site; they belong in the nav with appropriate
parents and groupings. Don't bury Phase 2 pages under arbitrary
"future" groupings.

**Phase 1 selection — target 6 pages, hard cap 7:**

Mandatory 4 (always Phase 1, no exceptions):
- Homepage
- Plan a Visit / Next Steps
- Sermons / Watch / Messages
- Give / Generosity

Pick 2 more from: About / Our Story, Kids Ministry, What We Believe /
Beliefs, Meet Our Team / Staff. Choose based on the church's primary
audience and stated goals. Only pick 2 → Phase 1 totals 6.

**Bilingual override:** Any Spanish-language or non-English
congregation gets a dedicated Phase 1 page (legitimate path to 7).

**Phase 2 = everything else.** Cap total Phase 1 + Phase 2 at 20
pages. Consolidate when count threatens to exceed:
- Combine Men's + Women's → "Adults" with sections
- Combine Local + Global Outreach → "Outreach"
- Roll Baptism + New Believer into Discipleship / Next Steps
- Move Membership into an About section

Note every consolidation in `absorbed_content`.

---

## 4. Density-driven nesting

- `high` density: enough unique content for a robust page
- `medium`: adequate; may need section work
- `low`: should be absorbed into a parent page or dropped

**Audience-specific pages stay distinct.** Each age group / audience
served has its own page with its own context:
- Kids ministry → its own page
- Teens / Students → its own page (DISTINCT from Kids)
- Young Adults → its own page
- Men's, Women's, Adults / Marrieds → its own pages
- Care / Counseling / Recovery → its own page

Generic "Ministries" catch-alls that consolidate distinct audiences
are a failure mode — they drop audience context.

---

## 5. Navigation patterns

Pick one that fits the church:

- **`flat`**: each item is a page. Best for simple sites.
- **`grouped_dropdowns`**: parent labels reveal child pages. Best
  for 10+ pages.
- **`thematic_groups`**: themed parent labels (Reality LA's
  Jesus / You / Us).
- **`thematic_verbs`**: action labels (Austin Stone's Take / Attend /
  Join / Go / Learn / Lead / Serve).
- **`offcanvas`**: slide-in menu for 15+ pages.
- **`megamenu`**: wide grid dropdown for large churches.

Default conservative: flat or grouped_dropdowns. Reserve thematic
patterns for churches whose voice register supports it. Primary nav
max 6 items.

---

## 6. Nav structure rules (a–j, non-negotiable)

**a) Never label a dropdown parent with the same word as one of its
children.**
- ❌ "About" dropdown containing { About, Beliefs, Our Team }
- ✅ "About" as a standalone page that links inline to Beliefs / Team
- ✅ "Who We Are" as a dropdown parent containing { About, Beliefs, Team }

**b) Don't create a dropdown for fewer than 3 meaningful children.**
If you have 2 or fewer, make the parent a flat page and let child
concepts live inline as sections.

**c) Semantic categorization — distinguish current-state from
commitment pathway.**

Two distinct mental models:
- **Commitment pathway** (labels: Next Steps / Pathway / Grow / Get
  Connected): "I'm here. What's deeper?" → Grow Tracks, Baptism,
  Membership, Serve, Join a Group.
- **Current state** (labels: Community / What's Happening / Life):
  "What's alive at this church right now?" → Events, Stories /
  Testimonies, News, Recent baptisms.

These do not belong in the same dropdown:
- ❌ Events under "Next Steps" → events are current state, not
  commitment. Put under "Community" / "What's Happening" / standalone.
- ❌ Stories / testimonies under "Next Steps" → belong under
  "Community" / "Stories" / "About".

**Special signal:** if AM handoff or content collection emphasizes
FOMO as a strategy lever (curated clips, in-person attendance, life-
change stories driving visitors in), promote Events and Stories to
higher nav prominence — top-level or under "Community".

Other common categorization failures:
- ❌ Teens grouped under "Kids" → distinct audiences. Group as
  "Kids & Students" or as separate items.
- ❌ Blog under "Sermons" → sermon blog can live there if clearly
  labeled, general blog belongs elsewhere or footer.
- ❌ "Membership" as primary nav → almost always footer or
  About-page section.

Every grouping must pass: "If a visitor asked 'why are these
together?', would the answer be obvious?"

**d) Voice-match audit (CRITICAL).** Before submitting, audit EVERY
nav label against Stage 1's `voice_characteristics.top_attributes`
and the X-factor. A label that contradicts the voice is a failure
even if it's grammatical.

Examples:
- ❌ "Listen" when Stage 1 voice says "This isn't a church you watch.
  It's a church you build with." — passive verb contradicts active
  voice. Use "Messages" or "Sermons".
- ❌ Generic "About" when X-factor is "Relational Community" — use
  "Our Church" or "Community" or "Who We Are" to honor the X-factor.
- ❌ "Get Involved" when voice is "Grit / Direct" — too soft. Use
  "Serve" or "Build With Us".

**The X-factor should be a nav vocabulary driver.** If X-factor is
"Relational Community", "Community" is the natural dropdown label.

**e) Goal-match audit.** If discovery_questionnaire or project_goals
include "help first-time visitors find information easily", then
INSIDER LANGUAGE in primary nav is a failure:
- ❌ "ECC Kids" (insider branding) in nav → use "Kids" / "Children".
  Insider branding goes on the page, not in nav.
- ❌ "Our Story" / "What We Believe" when goal is visitor-clarity →
  use "About" / "Beliefs".

When the partner's stated goal is visitor accessibility, default nav
names beat clever insider names.

**f) Match voice register when goal supports it.** If top_attributes
include "Bold / Grit / Direct" AND goal is NOT pure visitor-clarity:
- "About" → "Who We Are" / "The Story"
- "Sermons" → "Messages" (use partner vocabulary if they call them
  Messages)
- "Plan a Visit" → "Sundays" / "First Time"
- "Get Involved" → "Serve" / "Build With Us"

But the bolder name MUST pass rules (d) and (e). If voice says bold
but goal says visitor-clarity, visitor-clarity wins.

**f.5) Partner vocabulary alignment — use their terms inside
dropdowns.**

When the church has a specific term for a concept (e.g., "Grow Tracks"
for discipleship, "Disciples Serve" for volunteering, "ECC Littles"
for the youngest kids), use THEIR term as the page label inside a
dropdown. Don't use the generic concept name as both parent and child.

Example (Evangel — discipleship pathway called "Grow Tracks"):
- ❌ "Next Steps" dropdown containing { "Grow Tracks & Baptism" } —
  clunky pairing; child label fights parent. If the page lives at
  /next-steps, the parent dropdown and child slug collapse into the
  same idea.
- ✅ "Grow" dropdown containing { "Grow Tracks", "Baptism", "Serve" }
  — uses partner vocabulary, aligns with their footer "Grow" section.
- ✅ "Next Steps" dropdown containing { "Get Baptized", "Join a Grow
  Track", "Find Your Place" } — action-oriented children that don't
  duplicate the parent concept.

**g) Footer / header vocabulary coherence.** If you create a footer
section called "Grow" (containing pathway pages), don't use a different
word in the header for the same concept. Pick ONE term per concept and
use it consistently across `header_nav` and `footer_nav`.

**h) Visitor language wins over insider language.** Visitor searches
for "find a church" not "I'm New". Visitor types "kids ministry" not
"next gen". When in doubt, pick the term a visitor would type into
Google.

**i) Avoid generic dropdowns like "Resources" or "More".** They hide
content instead of organizing it. If you can't name a grouping with
specific intent, the pages shouldn't be grouped.

**j) Every page must be in header OR footer.** No page may be
unaccounted for. If a page isn't in primary header nav, it must
appear in `footer_nav` (with a section like "Connect" / "Resources" /
"About"). Includes: Contact, Privacy Policy, Share Your Story (if
not primary), Sermon Blog (if not primary), Membership, Job openings,
Newsletter signup. The strategist should never have to ask "where
does X live?"

---

## 7. Documented failure modes (real, from past runs)

These are written into the prompt as concrete "do not repeat" examples.

### Failure mode 1: "Watch" dropdown for a church whose voice says "you don't watch"

Stage 1 voice included: *"This isn't a church you watch. It's a church
you build with."*

Model emitted: `Watch` as a header_nav dropdown, with children
{ Messages, Blog, Events }.

Three failures stacked:
- "Watch" directly contradicts a quoted voice example.
- "Blog" can't be watched (categorical error — Blog is a reading
  surface, not a video surface).
- "Events" can't be watched (events are attended, not watched).

Correct approach:
- "Messages" as a standalone top-level page.
- "Events" under "Community" or as standalone (FOMO signal).
- "Blog" / "Sermon Blog" in footer or under About.

### Failure mode 2: Generic "Ministries" page consolidating distinct audiences

When a church serves Kids + Teens + Adults + Care as distinct
audiences, the model consolidated them into a single generic
"Ministries" page. Drops audience context — each group has different
parent concerns, different content needs.

Correct: separate Kids, Teens, Adults, Care pages, grouped under a
"Community" or "Ministries" dropdown — but the dropdown contains
DISTINCT PAGES, not one generic page.

### Failure mode 3: Voice-contradicting label after strategist objected

Strategist's prior redo called out: "Listen" contradicts the voice
'you build with.' Model swapped "Listen" → "Watch" — same failure with
a different verb. The lesson is broader: the voice claim "you don't
[verb]" rules out THAT VERB AND ALL ITS PASSIVE COUSINS as nav labels.

### Failure mode 4: Empty `content_coverage_audit` despite required field

The model emitted the sitemap but skipped the required audit. The
required-by-schema rule alone wasn't enough — needed a programmatic
check that catches empty arrays and surfaces it as a hard blocker.

### Failure mode 5: Missing mandatory Phase 1 pages

The model emitted a sitemap with no Homepage, no Plan a Visit / Sundays,
no Messages, and no Give — all four mandatory Phase 1 pages absent.
Programmatic integrity audit now catches this and surfaces as a hard
blocker in `cs_flags`.

---

## 8. The check that prevents voice failures

Before picking any nav vocabulary, walk Stage 1's voice
`tone_examples_do`. Look for sentences shaped like "X isn't Y" or
"not Z" or "doesn't [verb]". Those are HARD constraints on nav
vocabulary.

If "this isn't a church you watch" is in tone_examples_do, then
"Watch" is banned as a nav label, full stop. Same for synonyms
("View", "Stream", "Tune") that imply the same passive consumption.

This is implemented programmatically server-side as the `banned_terms`
extractor in `applyIntegrityAudit`.

---

## 9. AEO / GEO framework

For each page, think:
- **Direct answer structure**: who/what/where/when questions
  (e.g., "What time does [Church] in [City] start?")
- **Entity clarity**: church name + city + state
- **Intent matching**: visitor language, not insider language

Surface AEO notes on Plan a Visit, Contact, Sermons, Kids, Beliefs
at minimum.

Provide `aeo_keywords`:
- `primary`: 2–3 high-intent local terms
- `secondary`: 5–7 semantic variations
- `long_tail`: specific question phrases this church can own

Ground keywords in the church's actual location, denomination, and
audience. "Church near me" is not useful. Specific local +
denominational terms are.

---

## 10. CS flags

Three categories:

- **hard_blockers** — copy can't be written without resolving.
  Escalate to AM immediately. (e.g., "Kids ministry name confirmed
  but no schedule provided.")
- **soft_assumptions** — verify with partner or AM before Review 1.
  (e.g., "Assumed Spanish-language ministry from one mention in
  Discovery; needs confirmation.")
- **design_flags** — route to Web Director, not the strategist.
  (e.g., "Megamenu recommended — designer needs to confirm header
  component supports it.")

---

## 11. Voice rules (carry from Stage 1)

Apply to every string emitted:
- No em-dashes (— or –). Use periods or commas.
- No three-adjective clusters. Pick the single strongest word.
- No filler intensifiers: truly, really, deeply, incredibly, very,
  amazing, just, simply.
- No AI clichés: delve, tapestry, unlock, unleash, elevate, beacon,
  embark, resonate, dynamic, synergistic, game-changer, seamless,
  robust, leverage, transformative, vibrant, foster, pivotal,
  paramount.
- No church clichés: "come as you are," "life-changing," "vibrant
  community," "spiritual journey," "walk with God."
- No "We / Our" framing for partner-facing copy. Refer to church
  by name.
- Jesus is the destination. Programs are the vehicle.

---

## 12. Strategic discipline

- **Be strategic, not literal.** Don't take content collection at
  its word. If 5 ministry sub-pages have only a paragraph each,
  nest them as sections.
- **Every page traces to a source.** Speculative pages →
  `cs_flags.soft_assumptions`.
- **Use partner vocabulary.** If church calls volunteers "Disciples
  Serve", use that. If sermons are called "Messages", use that.
- **Vocabulary decisions explained in `vocabulary_decisions`.**
- **Traffic retention audit.** If a current site URL exists in
  intake, flag which current nav items send visitors away (YouTube,
  external giving, Planning Center) and propose where those could
  become internal pages.

---

## 13. Coverage audit walk-list

`content_coverage_audit` is REQUIRED. Walk the content collection
systematically — every named item must appear in the audit:

- Every ministry name (e.g., ECC Littles, ECC Kids, ECC Teens, ECC
  Women, ECC Men, ECC Marrieds, Celebrate Recovery, Healing Rooms,
  Care Team, Life Groups)
- Every program (Grow Tracks, baptism process, volunteer track)
- Every service time and special service mentioned
- Every staff person / role mentioned
- Every event series or type (First Fridays, Kingdom Women
  Conference, etc.)
- Every external platform (YouTube, Pressable, Mailchimp, Clover,
  Apple Podcast)
- Every giving method / payment platform
- Address, phone, contact details

Each gets one row in `content_coverage_audit` with:
- `content_item`: name as it appears in content collection
- `landed_on`: page slug where it lives, or null if dropped
- `status`: `placed` / `nested` / `navonly` / `dropped`
- `note`: rationale for nested/dropped status (optional)

---

## 14. Output schema (what Stage 2 produces)

Required fields in the tool input:

```jsonc
{
  "nav_strategy": "string — 2–3 sentences",
  "nav_voice_register": "formal | conversational | bold | minimal | thematic",
  "nav_pattern": "flat | grouped_dropdowns | thematic_groups | thematic_verbs | offcanvas | megamenu",

  "voice_audit": {
    "banned_terms": [
      { "term": "watch", "source": "This isn't a church you watch." }
    ],
    "header_label_checks": [
      {
        "label": "Sundays",
        "voice_justification": "Matches X-factor 'Relational Community' — Sundays is the lived-in name for gathering.",
        "passes_ban_check": true
      }
    ]
  },

  "phase_summary": {
    "phase_1_count": 6,
    "phase_2_count": 7,
    "total": 13,
    "rationale": "..."
  },

  "pages": [
    {
      "name": "Sundays",
      "slug": "sundays",
      "nav_label": "Sundays",
      "phase": "1" | "2" | "nav-only" | "global",
      "parent_slug": null,
      "page_type": "content" | "chrome" | "functional",
      "strategic_purpose": "ONE sentence: what this page does for the visitor.",
      "rationale": "ONE sentence: why exists, why named this way.",
      "content_sources": ["Content Collection", "AM Handoff"],
      "density": "high" | "medium" | "low"
    }
    // ... no hero, sections, or CTAs — those come in Stage 4
  ],

  "header_nav": [
    {
      "label": "Sundays",
      "kind": "page",
      "slug": "sundays",
      "rationale": "..."
    },
    {
      "label": "Community",
      "kind": "group",
      "rationale": "...",
      "children": [
        { "label": "Events", "kind": "page", "slug": "events" }
      ]
    }
  ],

  "footer_nav": [
    {
      "section_label": "Connect",
      "items": [
        { "label": "Contact", "slug": "contact" },
        { "label": "Share Your Story", "slug": "share-your-story" }
      ]
    }
  ],

  "absorbed_content": [
    {
      "content_item": "Apple Podcast",
      "absorbed_into": null,
      "rationale": "Strategy Brief said don't promote in copy."
    }
  ],

  "vocabulary_decisions": [
    {
      "instead_of": "Plan a Visit",
      "we_chose": "Sundays",
      "why": "Matches voice register 'Bold + Detroit Grit.'"
    }
  ],

  "aeo_keywords": {
    "primary": ["evangel christian churches roseville", "...", "..."],
    "secondary": [...],
    "long_tail": [...]
  },

  "content_coverage_audit": [
    {
      "content_item": "ECC Littles",
      "landed_on": "kids",
      "status": "nested",
      "note": "Lives as a section on the Kids page."
    }
    // every concrete content item gets one row
  ],

  "cs_flags": {
    "hard_blockers": [],
    "soft_assumptions": [],
    "design_flags": []
  },

  "sources_used": {
    "stage_1": "How Stage 1 drove choices.",
    "strategy_brief": "...",
    "am_handoff": "...",
    "discovery_questionnaire": "...",
    "brand_handoff": "...",
    "content_collection": "...",
    "conflicts_resolved": [
      "Discovery said X, AM said Y, deferred to AM..."
    ]
  }
}
```

---

## 15. Programmatic integrity audit (server-side, post-emit)

Runs after the model emits, before the DB write. Catches what the
prompt alone can't enforce. Violations get prepended to
`cs_flags.hard_blockers` as `[Auto-detected]` entries.

Current checks:

1. **Dropped pages on a redo.** Any page in the previous proposal
   whose slug is missing from the new output gets flagged (unless
   the strategist's redoContext mentions removing it).

2. **Empty `content_coverage_audit`.** Required field; empty array
   triggers a blocker.

3. **Orphaned pages.** Any page in `pages[]` whose slug isn't in
   `header_nav` OR `footer_nav` gets flagged.

4. **Duplicate slugs.** Two pages with the same slug = blocker.

5. **Mandatory Phase 1 pages missing.** Checks for Home, Plan a Visit
   / Sundays, Sermons / Messages, Give / Generosity by name + slug
   patterns. Any missing gets flagged.

6. **Voice-contradicting nav labels.** Parses Stage 1
   `tone_examples_do` for "isn't a church you X" / "not a Y" /
   "doesn't Z" patterns. Extracts the verbs, plus synonyms
   (watch → view/stream/tune; listen → hear). Any header_nav label
   hitting the ban list gets flagged with the quoted Stage 1 source.

---

## 16. Model + token settings

- **Model:** `anthropic/claude-opus-4-7` via Vercel AI Gateway
- **MAX_OUTPUT_TOKENS:** 12,000 (lean schema typically uses 5–8K)
- **`toolChoice`:** forced to `submit_sitemap` (incompatible with
  extended thinking — would prevent reasoning before emission)
- **maxDuration:** 300 seconds (Vercel Pro ceiling)

Cost per run: ~$1–2 for Opus on a project this size.

---

## 17. Redo behavior

When `redoContext` is set and a previous `roadmap_state.stage_2`
exists:

- The endpoint reads the previous proposal as `previousStage2`.
- The user content includes a "Previous proposal (LOCKED — refine
  only what feedback names)" block with the full prior JSON.
- The strategist's feedback is included as "Strategist's redo
  feedback".
- The prompt explicitly says: do not modify any page name, slug,
  parent, density, or nav position the feedback doesn't name. When
  feedback is silent on something, copy it through verbatim.
- Post-emit, the integrity audit checks for dropped pages and flags
  any that vanished without being in the redoContext.

When `redoContext` is NOT set (fresh run or re-run after clearing):
- Previous proposal is not fed in.
- Model proposes from scratch.

---

## 18. What's NOT in scope for Stage 2

- Per-page hero direction, section structure, CTAs (→ Stage 4)
- Page copy / body text (→ Stage 5)
- User journey paths (→ Stage 3)
- Wireframe rendering (→ separate concern)
- Commit to `web_pages` records (→ separate `commitSitemapToPages`
  helper, fires on Stage 2 approval)
- Notion delivery / partner-facing assembly (out of scope — handled
  separately by the CS team in their existing Notion workflow)

---

## 19. Where this lives in code

- System prompt + tool schema + integrity audit:
  `api/web/agents/draft-sitemap.ts`
- Client wrapper: `src/lib/webAgents.ts` (`draftSitemap`)
- UI display: `src/components/wm/Stage2SitemapView.tsx`
- Commit helper: `src/lib/webSitemap.ts`
  (`commitSitemapToPages`)

---

## 20. Cowork session — suggested workflow

To produce a "golden output" reference:

1. Take Evangel's Stage 1 extraction (project 2846 in DB, or export).
2. Take Evangel's content collection text.
3. By hand or in dialogue, fill in the output schema (§14) with the
   correct values for this church specifically. Argue every decision.
4. The resulting JSON becomes a few-shot example baked into the
   Stage 2 prompt — "this is what good looks like for a bold-voice
   Detroit church."
5. We bring that reference back into the codebase and rebuild the
   prompt around it. Test against Evangel — if output deviates from
   the reference in ways we didn't intend, iterate. If it matches,
   we have a baseline for other churches.

The current prompt has the right *principles* (CORE INVARIANTS,
categorization rules, voice/goal audits). It lacks a concrete target.
The cowork output supplies that.
