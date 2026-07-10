---
name: ingest-external-content-strategy
description: |
  Standalone cowork skill. Ingests an approved external content
  strategy doc (usually a Notion export authored offline by an AM)
  and writes the artifacts Content Engine steps 1-6 would have
  produced — stage_1, ministry_model, acf_plan, site_strategy —
  plus stamps sitemap_review as approved so the project moves
  straight to step 7. Skips crawl-inventory expectations because
  these partners typically hand over their own content collection
  outside the app.

  Shareable in isolation: everything the runtime needs is inline
  (project-resolution SQL, output shapes, persist pattern, self-
  checks). Just attach this SKILL.md + the partner's strategy doc
  to a Claude Code Desktop cowork session with Supabase MCP access.
model: anthropic/claude-opus-4-7
allowed-tools: Read
version: '1.1.0'
---

# Ingest External Content Strategy — Standalone Cowork Skill

You are consuming an already-decided content strategy document and
turning it into the four Content Engine artifacts the downstream
pipeline expects. The doc is the authority. You are NOT re-deriving
strategy from scratch, you are NOT second-guessing the AM's page
list, and you are NOT running the analyzer rules that
plan-site-strategy / synthesize-strategy / classify-ministry would
apply to a fresh partner. If the doc says something, the doc wins.

Where the doc is silent, use sensible defaults documented below. Do
not invent facts about the church — only lift what the doc supplies.

---

## Step 0 — Say hello and gather what you need

The moment this skill is invoked, greet the strategist and ask three
things. Do not proceed until you have all three:

1. **Church name** — the partner's church name. Used to sanity-check
   the DB lookup and phrase the walkthrough by name (e.g. "Ready to
   ingest Evangel Christian Churches?").
2. **Member number** — the numeric member id (e.g. `2846`). This is
   the primary key that resolves to a `strategy_web_projects` row.
3. **Content strategy doc** — confirm the strategist has attached it
   to this conversation. If they haven't, ask them to paste or drop
   it now.

Your greeting should sound like a Squad teammate, not a bot. Example:

> Hey! I'll turn the AM's content strategy doc into everything the
> Content Engine needs, so we can jump straight to step 7. Before I
> start, three quick things:
>
> 1. What's the church's name?
> 2. What's their member number?
> 3. Have you attached the strategy doc to this chat? (Notion export
>    / markdown / whatever the AM wrote.)

Once all three land, echo them back for confirmation before running
the DB lookup in Step 1.

---

## Step 1 — Resolve project_id via Supabase MCP

Given the member number, look up the active web project. This gives
you the `project_id` (uuid) used in every write below.

```sql
SELECT wp.id AS project_id,
       wp.name,
       wp.kind,
       wp.current_phase,
       wp.archived,
       ap.church_name,
       ap.member,
       (wp.roadmap_state ? 'stage_1')          AS has_stage_1,
       (wp.roadmap_state ? 'ministry_model')   AS has_ministry_model,
       (wp.roadmap_state ? 'acf_plan')         AS has_acf_plan,
       (wp.roadmap_state ? 'site_strategy')    AS has_site_strategy,
       (wp.roadmap_state ? 'sitemap_review')   AS has_sitemap_review,
       (wp.roadmap_state ? 'strategic_goals')  AS has_strategic_goals
FROM strategy_web_projects wp
LEFT JOIN strategy_account_progress ap ON ap.member = wp.member
WHERE wp.member = <MEMBER_NUMBER>
  AND wp.archived = false
ORDER BY wp.created_at DESC
LIMIT 5;
```

Interpret the result:

- **0 rows** → the partner has no web project yet. Stop and tell the
  strategist they need to create the project in the Website Manager
  before running this skill.
- **1 row** → confirm `church_name` matches what the strategist told
  you. If it doesn't match, stop and confirm the member number is
  right — mis-typing the member is the most common failure mode.
- **2+ rows** → multiple projects for this member. Show the list and
  ask the strategist which project id to use.

If any of the `has_*` flags are `true`, warn the strategist:

> This project already has {list of populated artifacts}. Running
> the skill will replace them with fresh output from the doc. That's
> usually the right move when the AM's doc supersedes the pipeline's
> earlier output, but confirm before I overwrite.

Wait for explicit "go" before proceeding.

Also pull the approved strategic_goals if present — it fills fields
the doc leaves silent. Do NOT need to fetch every field the app
carries; the pieces this skill needs are:

```sql
SELECT roadmap_state->'strategic_goals' AS strategic_goals
FROM strategy_web_projects
WHERE id = '<PROJECT_ID>'::uuid;
```

Inside `strategic_goals`, the load-bearing fields are:
`goals_and_vision.top_3_website_goals`, `goals_and_vision.church_vision`,
`voice_and_tone.one_key_message`, `voice_and_tone.tone_descriptors`,
`content_and_allocation.ministries_to_grow`. Every field carries a
`{value, status}` shape — only trust entries whose `status ===
'approved'`. Ignore drafts.

---

## Step 2 — Read the doc thoroughly, then walk me through your reading

Before persisting anything, read the doc end-to-end and give the
strategist your read of it. Cover:

- Church identity: how does the doc position this church? (1-2 lines)
- Central persona: who is the site primarily for? (visitor / parent
  / member / seeker / other)
- Ministry model: what's the doc's dominant posture? (family_first /
  discipleship_pathway / community_first / teaching_first /
  outreach_first / worship_first — see §4 below for definitions)
- Phase 1 page list, in order.
- Phase 2 page list.
- Nav architecture headline (primary items + dropdowns + footer).
- Any explicit "carry forward from current site" pages.
- Any open items / action items the doc calls out.

Pause here. Let the strategist push back on any read before you
build the artifacts.

---

## Step 3 — What you produce (the four artifacts + the approved review)

Five things get written to `roadmap_state`:

1. `roadmap_state.stage_1`         — foundation strategy
2. `roadmap_state.ministry_model`  — model classification
3. `roadmap_state.acf_plan`        — audience × category × funnel
4. `roadmap_state.site_strategy`   — page list + nav + journeys
5. `roadmap_state.sitemap_review`  — stamped `status: 'approved'`

Every artifact carries an `_meta` block per the ArtifactMeta contract
(see §6 for the exact shape). Fields are described below in the
order they should appear on the object.

### 3.1 `stage_1`

```
{
  audience:                {}                   // freeform object; describe the doc's positioning
  personas: [
    {
      name:               string
      age_range?:         string
      barrier:            string
      need:               string
      voice_resonance:    string                // what tone / register lands for them
      primary_pages?:     string[]              // page slugs this persona should be served on
    },
    ...
  ]
  x_factor:                string               // 1-2 sentences — what makes this church distinct
  voice_exemplars:         string[]             // verbatim phrases the doc endorses
  voice_anti_exemplars:    string[]             // verbatim phrases the doc says to avoid
  voice_characteristics:   string[]             // tone_descriptors expanded
  project_goals:           string[]             // from approved strategic_goals.top_3_website_goals
  vision_statement:        string               // verbatim from approved strategic_goals; else ''
  key_message:             string               // verbatim from approved one_key_message; else the doc's positioning line
  sitemap_signals:         string[]             // 3-6 partner-stated needs driving sitemap shape
  topic_coverage_plan:     Record<string,string> // topic_key → page slug
  total_page_count:        number               // count of unique pages in the doc
  existing_pages_to_carry_forward: string[]     // slugs
  seo_aeo_geo_targets:     {                    // seed for step 8 downstream
    primary_keywords:      Array<{ query: string; page_slug: string }>
    secondary_keywords:    Array<{ query: string; page_slug: string }>
    long_tail_queries:     Array<{ query: string; page_slug: string }>
    local_terms:           string[]             // city, state, neighborhoods, service areas
    aeo_targets?:          Array<{ question: string; page_slug: string }>
  }
  sources_used:            ['external_content_strategy_doc']
  _meta:                   ArtifactMeta
}
```

**Persona extraction rules.** Explicit personas win — if the doc
names a "first-time visitor" persona, that's the name. When the doc
implies personas without naming them, extract from context: a page
titled "Plan a Visit" targeted at "the nervous newcomer" produces a
`first-time visitor` persona; a "Family Ministries" page targeted at
"the parent wondering if their kids have a place" produces a
`parent` persona. Emit at least ONE persona. Zero personas = the
skill has failed to read the doc.

**Voice exemplar extraction.** Anything the doc quotes as "confirmed
ECC language" / "confirmed language" / puts in double quotes as a
brand phrase is an exemplar. Lift verbatim.

**seo_aeo_geo_targets.** Nearly every strategy doc has an AEO/GEO or
SEO Strategy section. Structure per the schema above so step 8 can
reshape into per-page WebPageSeo plans without re-analysis.

### 3.2 `ministry_model`

Classify against the closed enum:

- **family_first** — kids/teens/families are the hero; discipleship
  pathway centers on family life; family ministries surface at the
  top of nav.
- **discipleship_pathway** — Grow Tracks / classes / Bible study are
  the through-line; ownership + formation is the story.
- **community_first** — Life Groups + relational community as the
  primary invitation.
- **teaching_first** — Sunday teaching / sermon archive is the
  anchor; the pulpit is the draw.
- **outreach_first** — missions / justice / neighborhood presence is
  the hero.
- **worship_first** — Sunday worship experience is the anchor.

Emit:

```
{
  model:            <primary>
  confidence:       0.85-1.0              // authored strategy = high confidence
  secondary_blend:  <secondary> | null    // when doc gives near-equal weight to a second model
  blend_notes:      string | null         // 1-2 sentences on the blend
  evidence:         string[]              // 3-5 verbatim phrases from the doc justifying the classification
  rationale:        string                // 2-3 sentences explaining the pick
  cta_default:      string                // doc's dominant CTA (e.g. "Plan a Visit", "Find your people")
  _meta:            ArtifactMeta
}
```

### 3.3 `acf_plan`

Compact form. For an ingested doc you don't emit ACF module configs
(those come from web_content_templates); you emit the density map
and gap list step 7 uses to route allocation.

```
{
  modules:       []                            // deliberately empty — no analyzer-derived modules
  taxonomies:    []
  rationale:     string                        // 2-3 sentences on how the doc structures audience/funnel
  cell_density:  Record<`${audience}:${category}:${funnel}`, number>
  coverage_gaps: string[]                      // gaps the doc explicitly flags as Phase 2 or open
  _meta:         ArtifactMeta
}
```

**Cell density.** For every page in the doc, credit +1 to the cells
its purpose implies. Vocab:

- Audience: `visitor` | `attender` | `member` | `parent` | `general`
- Category: `invitation` | `story` | `belief` | `ministry` | `care` |
  `generosity` | `teaching` | `event` | `admin`
- Funnel: `discover` | `consider` | `commit`

The doc's Strategic Purpose lines are your best signal. E.g. "Give
visitors a taste of Dr. Hines' teaching that makes them want to show
up Sunday" = `visitor:teaching:discover`.

**Coverage gaps.** Phase 2 items on the doc's Phase Summary table
belong here as gaps ("Meet Our Team — Phase 2, awaits Genna's
titles", "Baptism — Phase 2", etc.).

### 3.4 `site_strategy`

The load-bearing artifact. Step 7 reads this to route allocation.

```
{
  pages: Array<{
    slug:              string                  // kebab-case (from doc's URL, e.g. '/plan-a-visit' → 'plan-a-visit')
    name:              string                  // doc's page heading
    purpose:           string                  // doc's Strategic Purpose, ≤180 chars
    primary_audience:  string                  // persona name from stage_1 OR 'general'
    primary_funnel:    'discover' | 'consider' | 'commit'
    covers_cells: Array<{ audience: string; category: string; funnel: string }>
    nav_order:         number | null           // Phase 1 primary nav order; null for pages not in primary nav
    nav_strategy:      'primary' | 'secondary' | 'footer' | 'contextual_only'
    has_children:      boolean                 // true when doc names sub-pages (e.g. About with Beliefs + Meet Our Team + Our Story)
    phase:             1 | 2                   // Phase 1 vs Phase 2 from doc's Phase Summary
    carryover_slug?:   string                  // when the doc names this as carried from current site
  }>

  nav: {
    primary:   Array<{ slug: string; children?: string[] }>
    secondary?: Array<{ slug: string; children?: string[] }>
    secondary_label?: string
    footer: {
      primary_links?: string[]
      explore?:       string[]
      legal?:         string[]
      social?:        string[]                  // platform names: 'facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin'
      parked?:        Array<{ label: string; reason: string }>
      contact_block?: boolean                   // default true
      service_times?: boolean                   // default true
    }
    cta_only: string[]                          // sticky-CTA links (e.g. Give)
  }

  nav_change_level: 'full_rewrite' | 'partial' | 'tweaks' | 'preserve'
  // full_rewrite when doc explicitly changes current nav (default for AM-authored strategy docs)
  // partial when doc preserves current spine with tweaks
  // preserve when doc says "keep as-is"

  siteflow: {
    homepage_arc:     string[]                  // ordered phrases describing what homepage DOES
    narrative_thread: string                    // 2-3 sentences on how site reads top-to-bottom
  }

  persona_journeys: Array<{
    persona_name:  string                       // exact name from stage_1
    entry_points:  string[]                     // 1-3 slugs they're most likely to land on
    journey_arc:   string[]                     // ordered slugs, ends on a commit-funnel page
    barriers_addressed: string[]
  }>

  page_elevations: Array<{
    topic:      string                          // e.g. 'Family Ministries', 'Watch demoted'
    importance: 'core' | 'supporting' | 'optional'
    rationale:  string                          // lift from doc's Why-these-decisions narrative
  }>

  pages_considered_dropped: Array<{ slug: string; reason: string }>

  key_info_to_highlight: Array<{ what: string; where: string }>

  voice_register_per_page_type: Record<string, string>
  // e.g. { hero: 'warm, practical, no jargon',
  //        doctrinal: 'measured, honest',
  //        ministry: 'invitational' }

  report: {
    page_count:              number
    nav_primary_count:       number
    pages_carried_forward:   string[]
    coverage_gaps_addressed: string[]
    coverage_gaps_remaining: string[]           // Phase 2 items belong here
  }

  rationale: string                             // 3-5 sentence summary from doc's executive summary
  _meta:     ArtifactMeta
}
```

### 3.5 `sitemap_review`

The doc IS the approved sitemap review. Emit a full review with the
partner-facing fields populated so the SitemapReviewEditor opens
cleanly if staff wants to re-view:

```
{
  schema_version: 1
  token:          <cryptographically random opaque id, 32 chars kebab-case>
  status:         'approved'
  created_at:     <now ISO>
  updated_at:     <now ISO>
  published_at:   <now ISO>
  approved_at:    <now ISO>
  approved_by:    'staff'
  intro: {
    headline: '<Church Name> Website Content Strategy'
    body:     '<2-3 sentence pull from doc executive summary>'
  }
  executive_summary:   <verbatim from doc Executive Summary block>
  navigation_strategy: <verbatim from doc's "Why these decisions" narrative>
  pages: Array<{
    slug:             string                    // same slugs as site_strategy.pages
    name:             string
    purpose:          string
    sitemap_tag:      'hub' | 'ministry' | 'churchwide' | 'foundation' | 'utility'
                      // hub for primary-nav destinations, ministry for Ministries dropdown children,
                      // churchwide for About/Give/Messages, foundation for Homepage/Plan a Visit,
                      // utility for footer-only Baptism/Events
    is_nav_parent_only?: boolean                // true when doc lists a dropdown label with no destination
                                                //   of its own (e.g. Ministries, Connect)
    is_phase_2?:      boolean                   // true when doc puts this in Phase 2
  }>
  nav_layout: {
    primary:          Array<{ slug: string; label: string; children?: Array<{ slug: string; label: string }> }>
    secondary?:       string[]
    footer?:          string[]
  }
  footer_info: {
    address?:      string
    phone?:        string
    email?:        string
    service_times?: string                      // e.g. "Sundays at 10:15am"
    office_hours?: string
    socials?:      Array<{ platform: string; url?: string }>
    search?:       boolean
  }
  persona_postures: [] // (staff can author later; can be empty on ingest)
  content_migrations: []
  partner_edit_requests: []
  edit_history: [
    { at: <now ISO>, actor: 'staff', kind: 'ingest', note: 'Ingested from external content strategy doc via ingest-external-content-strategy skill v1.1.0' }
  ]
}
```

**Sitemap tag heuristic** — sort each page one of:

- `foundation` — Homepage, Plan a Visit (the visitor-entry pages)
- `churchwide` — About, Give, Messages (site-wide identity/action)
- `ministry` — Family Ministries, ECC Kids, ECC Teens, Life Groups,
  Grow Tracks, Team ECC, Celebrate Recovery, ECC Women, ECC Men
- `utility` — Baptism, Events, What We Believe, Meet Our Team,
  Sermon Blog (footer or standalone destinations)
- `hub` — any dropdown parent that has children but no destination
  of its own (Ministries, Connect, sometimes About)

---

## Step 4 — Persist (column-free chunked write)

Two failure modes to avoid every time:

**(A) Output-limit failure** — a naked `SELECT roadmap_state_set(...)`
returns the full ~300 KB roadmap_state on success and blows the MCP
output limit. **Every `roadmap_state_set` call MUST be wrapped in
`IS NOT NULL`.**

**(B) Input-size failure** — emitting one giant `execute_sql` with
all chunks inline as `VALUES` exceeds Claude Desktop's output token
cap (~8k tokens, ~32 KB of SQL). Use the column-free scratchpad
pattern below — each individual statement stays under 8 KB SQL.

For each of the five artifacts, walk this four-step shape:

### Step A — clear prior scratch (idempotent)

```sql
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks,<ARTIFACT>}'
WHERE id = '<PROJECT_ID>'::uuid;
```

`<ARTIFACT>` ∈ `{stage_1, ministry_model, acf_plan, site_strategy, sitemap_review}`.

### Step B — stage each chunk (one call per chunk index)

Base64-encode your assembled JSON locally so quotes / newlines don't
corrupt the SQL literal. Split into chunks of ≤6 KB each so the
surrounding statement stays comfortably under 8 KB total. Write each
chunk to its own slot:

```sql
UPDATE strategy_web_projects
SET roadmap_state = jsonb_set(
  COALESCE(roadmap_state, '{}'::jsonb),
  ARRAY['_chunks','<ARTIFACT>','<INDEX>'],
  to_jsonb('<BASE64-CHUNK-TEXT>'::text)
)
WHERE id = '<PROJECT_ID>'::uuid;
```

Each call is idempotent — safe to re-run if a socket drops mid-write.

### Step C — assemble + verify + write + return BOOLEAN

One final call per artifact (~1 KB SQL each):

```sql
WITH chunks AS (
  SELECT (e.key)::int AS ix, e.value AS b64
  FROM strategy_web_projects p,
       jsonb_each_text(p.roadmap_state -> '_chunks' -> '<ARTIFACT>') AS e
  WHERE p.id = '<PROJECT_ID>'::uuid
),
body_cte AS (
  SELECT convert_from(decode(string_agg(b64, '' ORDER BY ix), 'base64'), 'UTF8') AS body
  FROM chunks
)
SELECT
  CASE WHEN md5(body) = '<LOCAL-MD5>'
    THEN (roadmap_state_set('<PROJECT_ID>'::uuid, ARRAY['<ARTIFACT>'], body::jsonb) IS NOT NULL)
    ELSE FALSE
  END AS committed
FROM body_cte;
```

Return value:
- `true` → artifact wrote successfully.
- `false` → md5 mismatch; the assembled body doesn't match what you
  intended. Investigate before rerunning.

The `IS NOT NULL` wrapper collapses the ~300 KB `roadmap_state_set`
return payload into a single boolean so the response fits the MCP
output limit.

### Step D — cleanup scratch

Once all five artifacts have committed successfully:

```sql
UPDATE strategy_web_projects
SET roadmap_state = roadmap_state #- '{_chunks}',
    updated_at = now()
WHERE id = '<PROJECT_ID>'::uuid;
```

Removes the temporary `_chunks` scratchpad. Wait to run this until
EVERY artifact is committed — the scratch is what lets you resume
mid-flight if something disconnects.

### Verification pass

After Step D:

```sql
SELECT
  (roadmap_state->'stage_1'        ? '_meta')                AS stage_1_ok,
  (roadmap_state->'ministry_model' ? '_meta')                AS ministry_ok,
  (roadmap_state->'acf_plan'       ? '_meta')                AS acf_ok,
  (roadmap_state->'site_strategy'  ? '_meta')                AS strategy_ok,
  (roadmap_state->'sitemap_review'->>'status')               AS sm_status,
  jsonb_array_length(COALESCE(roadmap_state->'site_strategy'->'pages','[]'::jsonb)) AS page_count,
  jsonb_array_length(COALESCE(roadmap_state->'stage_1'->'personas','[]'::jsonb))    AS persona_count
FROM strategy_web_projects
WHERE id = '<PROJECT_ID>'::uuid;
```

Expected: every `_ok` is `true`, `sm_status = 'approved'`,
`page_count` matches the doc's Phase 1 + Phase 2 total, and
`persona_count ≥ 1`.

If any check fails, DO NOT tell the strategist you're done. Fix
before signing off.

---

## Step 5 — `_meta` block (identical on every artifact)

```
{
  bundle_version: 'v1'                                     // stable
  skill_name:     'ingest-external-content-strategy'
  skill_version:  '1.1.0'
  generated_at:   <ISO timestamp, same on all five artifacts so re-run detection works>
  model:          'claude-opus-4-7'                        // or whatever model actually ran
  prompt_hash:    <optional, first 16 hex chars of sha256(system_prompt); can omit>
  usage:          { input_tokens: number, output_tokens: number } // optional but preferred
}
```

Downstream tools inspect `skill_name` to know the provenance — the
Content Engine step display, the Dev Handoff panel, and the
sitemap-review composer all look for this so they show the right
badges + affordances.

---

## Step 6 — Self-checks BEFORE persisting

Verify before writing anything:

1. **Every page named in the doc is in `site_strategy.pages[]`.**
   Cross-reference against the doc's URL list. Missing pages =
   incomplete ingest.
2. **Nav shape matches the doc's Navigation Architecture verbatim.**
   Same primary items in same order. Same dropdown groupings. Same
   footer items.
3. **Persona journeys terminate at a `commit`-funnel page.** No
   dead-end journeys.
4. **`sitemap_review.status === 'approved'`.** The whole point is
   to short-circuit steps 1-6, so this stamp must land or the app
   will still gate step 7.
5. **`_meta.skill_name === 'ingest-external-content-strategy'` on
   every artifact.**
6. **`_meta.generated_at`** carries the same ISO timestamp across
   all five artifacts.
7. **No hallucinated pages, personas, or ministries.** Everything
   maps back to the doc. When the doc is silent, leave the field
   empty (or use a defensible default named in this SKILL) rather
   than invent.
8. **At least one persona in `stage_1.personas`.** Zero personas
   almost always means the doc's implicit personas weren't lifted.

---

## Step 7 — Hand off to plan-cross-page-allocation

After committing everything, tell the strategist:

> Content strategy ingested. Steps 1-6 are marked done; the sitemap
> is approved as canonical. Step 7 (plan-cross-page-allocation) is
> the immediate next action.
>
> Note this partner has an external content collection and no crawl
> inventory. Step 7 will need to rely on the doc's page purposes +
> partner-supplied assets rather than atoms + facts pools. If a
> content_collection session exists, its supplemental submissions
> are still available; otherwise the AM should provide any partner-
> supplied copy separately before step 7 runs.
>
> To kick off step 7, open the Content Engine tab in the Website
> Manager and hit the "Decide what goes on which page" step's
> starter prompt — it'll pull the plan-cross-page-allocation skill
> and the doc-derived site_strategy in as inputs.

That paragraph is the handoff plan-cross-page-allocation reads out
of `prior_handoff_notes`, so keep it accurate.

---

## Common failure modes + recovery

- **You lost the strategist mid-conversation.** Resume by re-reading
  the doc and asking "want me to pick up where I left off?" — the
  scratch chunks under `roadmap_state._chunks` survive so you can
  finish the assemble step without redoing all the extraction.
- **md5 mismatch in Step C.** The assembled body doesn't match what
  you thought you wrote. Re-emit the chunks and try again.
- **`SELECT roadmap_state_set(...)` returned an error about output
  size.** You forgot the `IS NOT NULL` wrapper. Re-run the
  wrapped version.
- **`page_count` doesn't match the doc.** You dropped or duplicated
  a page during extraction. Re-read the doc's Phase Summary table
  and rebuild `site_strategy.pages[]`.
- **`persona_count == 0`.** You didn't extract personas from the
  doc's implicit framing. Re-read the "Strategic Purpose" and hero
  direction on each page — the persona voice is baked into them.
- **Existing artifacts in the way.** You warned the strategist in
  Step 1 that overwriting was going to happen; they said go. The
  `roadmap_state_set` call swaps the artifact atomically, so the
  old value goes away as the new one lands. No prior cleanup needed
  beyond the strategist's confirmation.
