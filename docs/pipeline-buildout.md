# Pipeline Buildout Inventory

**Status:** v0.1, post lift-before-generate reframe.
**Audience:** Ashley + future-Claude. The delivery-plan companion to `docs/autonomous-pipeline.md` (the data flow contract).
**What this is:** A single map of every agent, skill, function, gate, cron, and dependency in the pipeline — including what already exists, what gets adapted from existing skills, and what's genuinely new. Read this when you want to know "what is the next thing to build" or "is there already a thing that does X."

---

## Load-bearing principles

**Lift before generate.** Strategy brief, brand guide, and discovery already carry authored strategic content. The pipeline lifts; it does not regenerate. (See `docs/autonomous-pipeline.md` core principle 2.)

**Database rows are canonical; documents are renderings.** No maintained markdown catalogs or persona docs. Render on demand from typed rows. (See `docs/autonomous-pipeline.md` core principle 1.)

**Don't shoehorn — fit content to structure, not the reverse.** Brixies templates carry many slots; the drafter writes only the slots that have authentic content. Optional slots without backing content stay empty. The drafter never invents a tagline to fill a tagline slot, manufactures a fifth card to pad a six-card grid, or composes a CTA to fill an optional button slot. Required slots (`required: true`) must be filled; optional slots are content-driven.

**Structural fit at bind time, not at write time.** The template binder matches template structure to content structure — card grids only when there are cards; tabbed sections only when content naturally splits; image-left/text-right only when image atoms exist. The drafter writes against the bound template assuming structural fit is already correct.

---

## The two execution modes

Everything below exists in two parallel forms. Same data shapes, same gates, same chain. Different driver.

| Mode | Driver | Where work runs | Required for v1 testing? |
|---|---|---|---|
| **v1 — Cowork-orchestrated** | Ashley in a Cowork session | Cowork session itself (LLM + Supabase MCP) | YES. This is the path that proves the chain works on Riverwood before any code is committed. |
| **v2 — Production** | Vercel Cron → tick endpoint → workers | Vercel Serverless Functions via AI Gateway | NO. Build only after v1 passes. |

Same Supabase schema. Same artifacts written to the same tables. Same human gate decisions. The only difference is *who pushes the button*.

---

## The agent inventory

Each row is one pipeline step. "Source" tells you whether you start from scratch or adapt something existing.

| # | Step | Source | v1 (Cowork skill) | v2 (Vercel function) | Lifts from | Generates |
|---|---|---|---|---|---|---|
| 1 | `normalize_intake` | **NEW** | `web-intake-normalizer` | `api/web/agents/normalize-intake.ts` | All intake (extracts every authored element as atoms) | Light prose decomposition only |
| 2 | `synthesize_voice_card` | **NEW** (prompt drafted v2) | `web-voice-card-compiler` | `api/web/agents/synthesize-voice-card.ts` | Strategic atoms (persona, tone, mission, x_factor, etc.) | JSON assembly only |
| 3 | `generate_content_map` | **NEW** | `web-content-map-builder` | `api/web/agents/generate-content-map.ts` | Atoms + facts grouped by topic | Natural pages proposed by content density + standard consolidation candidates + atom-to-topic-group map. **No final page decisions** — input to sitemap. |
| 4 | `generate_sitemap` | **ADAPT** existing Sitemap/Content Strategy Skill (structural parts only) | `web-sitemap-builder` | `api/web/agents/generate-sitemap.ts` | Content map's natural_pages + brief recommended_page + page_primacy_mapping atoms; strategic-spine rules | Final page set (Phase 1 / Phase 2 / consolidated), nav structure, AEO/GEO keywords per page. **No section concepts, no prose.** |
| 4.5 | `generate_section_plan` | **NEW** | `web-section-planner` | `api/web/agents/generate-section-plan.ts` | Final pages + content_map atom-to-topic-group + voice card + brixies curated_concepts | Sections per page tagged with concept_ids + atom × page × role × treatment assignments |
| 5 | `generate_content_strategy` | **ADAPT** existing Sitemap/Content Strategy Skill (Output 4 — partner-facing prose only) | `web-content-strategy-author` | `api/web/agents/generate-content-strategy.ts` | Sitemap + section plan + voice card | Executive Summary, Nav Architecture writeup, AEO/GEO Strategy narrative, Phase Summary writeup |
| 6 | `generate_roadmap` | **ADAPT** existing Web Roadmap Skill (heavily simplified) | `web-roadmap-builder` | `api/web/agents/generate-roadmap.ts` | All roadmap properties from atoms | Partner-facing opening paragraph |
| 7 | `bind_section_templates` (per page) | **REUSE** existing `auto-bind-page.ts` | `web-section-binder` (wraps existing endpoint for v1) | `api/web/agents/auto-bind-page.ts` (already exists) | Concept's family_filter; default_template_id; project card_palette | Specific `template_id` per section, matched on structural fit |
| 8 | `draft_page` (per page) | **ADAPT** existing Copywriting Claude Skill | `web-page-drafter` | `api/web/agents/draft-page.ts` | Verbatim atoms, handling_notes, voice card vocabulary, branded terms, bound template field schema | Field-keyed JSON for Brixies slots — only slots with content; optional slots stay empty |
| 9 | `review_*` (paired per generator) | **NEW** for v1; pattern from squad-orchestrator Billy-C | Inline checks in each Cowork skill | `api/web/agents/review-{step}.ts` | Voice card constraints, source integrity check, concept-family validity | Structured verdict + confidence band |

Nine steps. Three new from scratch. Three adapted from existing skills. One reuses an already-built endpoint. Two are paired structural patterns (reviewers).

---

## What we already have that this plan uses

These are existing assets the buildout depends on. Don't rebuild them.

### App infrastructure

- **Vercel Serverless + AI Gateway** wired via `AI_GATEWAY_API_KEY`. Pattern established by `api/web/agents/auto-bind-page.ts`. Every new worker copies this shape.
- **Supabase MCP** in Cowork. Lets Cowork read and write any pipeline table directly. This is what makes v1 work without code.
- **`cowork-skills/brixies-library.json`** — the snapshot of all 34 curated_concepts + 257 templates exported from the live Supabase tables. Schema documented in the file's `doc` field (field_kinds, slot_types, palette_groups, snippet_tokens). v1 skills load this file directly; v2 workers query the live tables (`web_content_templates` + `web_curated_library`) and the JSON regenerates from them.
- **`web_content_templates` registry (Supabase)** — 23 Brixies families with full `WebFieldDef` schemas (slot list with `max_chars`, `required`, `heading_level`, `source`). Already populated. The drafter reads this (or the JSON snapshot in v1) to know what to write.
- **`webBrixiesFamilies.ts`** — semantic metadata about each family (content fallback / narrow use / accent / chrome). The sitemap generator and binder read this to know which families fit which intents.
- **`auto-bind-page.ts`** — already chooses Brixies template variants per section. REUSED as the worker for `bind_section_templates` (step 7).
- **`strategy_web_projects.card_palette[]`** — the project's chosen Card variants. Picked manually by the web designer in the Global Elements workspace BEFORE the pipeline runs. The binder consumes this, doesn't generate it.
- **Intake hard-stop computation** in `src/lib/webIntake.ts`. The trigger for `normalize_intake`.
- **Content Manager UI** with Voice / Heuristics / Rollup / Roadmap / Pages tabs and the existing Realtime polling on `strategy_web_projects`. New gate components mount inside this shell.
- **ClickUp send** in `src/lib/clickup.ts`. The notification layer wraps this.

### Existing skills to adapt (not rewrite)

- **Sitemap / Content Strategy Skill** (`Sitemap Content Strategy Skill.md`) — keep the 6-page Phase 1 cap, the mandatory page set, the AEO/GEO framework, the navigation audit pattern, the consolidation rules, the StoryBrand frame. Drop the manual Notion delivery sequence (sub-steps A–I) — that's replaced by Supabase writes. Drop the manual page outlines section — that becomes `draft_page` output. The strategic decisions and constraints stay; the delivery mechanics change.
- **Copywriting Claude Skill** (`Copywriting Claude Skill.md`) — keep the writing rules, denominational filter, source control rule, self-audit checklist, StoryBrand check, AEO setup. Adapt the workflow from "human navigates Notion → writes one page at a time" to "drafter receives a single page's atom slice + Brixies schema → outputs field-keyed JSON." The voice rules and quality bars carry over directly.
- **Web Roadmap Skill** (`Web Roadmap Skill.md`) — keep the four-section structure as a reference but heavily simplify. Drop the Notion delivery (two-pages-one-internal-one-partner-facing) because the partner roadmap lives in the app's Roadmap tab. The roadmap properties layout from the user's spec (Primary goals, Tone, Target audience, Brand style tags, X-factor, Engagement type, Milestone overview) is the new minimal output.

### Reference docs (loaded as constants)

- `references/web-writing-rules.md` — global writing rules. Loaded into voice card + drafter + reviewer agents.
- `references/denominational-filters.md` — denominational filter library. Voice card uses to set `denominational_filter`; drafter applies overlay.
- `references/persona-hooks.md` — generic persona patterns. Only used as last-resort fallback when no persona atoms exist (which should be rare).

### Schema (already drafted, not yet applied)

- `schema/v35_pipeline_foundation.sql` — the seven new tables plus column additions. Drafted, reverted catalog-mirror columns. Ready to apply.

---

## What's genuinely new to build

### Schema additions

- **`v35_pipeline_foundation.sql`** — apply to Supabase. (Drafted.)
- **`v36_pipeline_seed_prompts.sql`** — one row per agent in `prompt_versions` with the initial system prompt. NEW. Required before any agent can run.

### v1 Cowork skills (markdown, invokable in Cowork)

Each skill is a markdown file with YAML frontmatter, lives under `cowork-skills/` at the repo root. Same git history, same versioning as the rest of the code. Each skill follows the structure of `prompts/voice-card-synthesizer.md`: human-readable spec at top, fenced system prompt block at bottom.

**Source of truth model:** the markdown is canonical. Cowork reads it directly during v1 manual runs. For v2 production, a sync script (`scripts/sync-prompts.mjs`) extracts the fenced system prompt from each skill and upserts rows into `prompt_versions`. Vercel workers read from `prompt_versions`. Markdown → sync script → Supabase → Vercel. Vercel never reads markdown at runtime.

The v1 chain works by Ashley invoking these skills in sequence; each writes its output to Supabase via MCP, then prompts Ashley for the gate decision before invoking the next. A thin `web-pipeline-runner.md` parent skill exists for the all-in-one case (invokes A → gate → B → gate → ...) — but each step skill is independently invocable for retries / partial reruns.

| Skill | Path | Adapts from | New behavior |
|---|---|---|---|
| `web-intake-normalizer` | `cowork-skills/web-intake-normalizer.md` | NEW | Reads intake (files + tables), extracts every authored element as atoms |
| `web-voice-card-compiler` | `cowork-skills/web-voice-card-compiler.md` | NEW (prompt v2 drafted at `prompts/voice-card-synthesizer.md`) | Reads strategic atoms, assembles voice card JSON, writes to `church_voice_cards` |
| `web-sitemap-builder` | `cowork-skills/web-sitemap-builder.md` | `Sitemap Content Strategy Skill.md` (structural parts) | Lifts recommended pages from brief atoms; honors caps; proposes section list per page with concept_id tags from brixies-library.json; writes to `web_pages` + `web_sections` + nav. **Does NOT produce partner-facing prose** — that's the next-but-two skill below. |
| `web-content-map-builder` | `cowork-skills/web-content-map-builder.md` | NEW | Atoms × pages → roles, writes to `content_page_map` |
| `web-content-strategy-author` | `cowork-skills/web-content-strategy-author.md` | `Sitemap Content Strategy Skill.md` Output 4 (partner-facing prose only) | Composes Executive Summary, Nav Architecture writeup, AEO/GEO Strategy narrative, Phase Summary writeup. Runs AFTER content map so it lifts from locked structural decisions. Writes to `strategy_web_projects.roadmap_state.stage_2`. |
| `web-roadmap-builder` | `cowork-skills/web-roadmap-builder.md` | `Web Roadmap Skill.md` (simplified) | Lifts properties from atoms, writes roadmap fields on project |
| `web-section-binder` | `cowork-skills/web-section-binder.md` | Wraps existing `auto-bind-page.ts` logic | Per page: picks specific Brixies template per section by structural fit; validates concept.family_filter; writes `web_sections.template_id` |
| `web-page-drafter` | `cowork-skills/web-page-drafter.md` | `Copywriting Claude Skill.md` | Page-at-a-time, bound-template-schema-aware output, atom-input-based; writes ONLY content-backed slots (don't shoehorn); writes field_values on web_sections |

Each skill includes:
- Inputs (Supabase tables to read).
- Outputs (Supabase tables to write).
- Lift rules (what to read from atoms vs. when to fall through).
- Gate decision (what Cowork asks Ashley after producing output).
- Send-back loop (how Ashley provides corrections).

### v2 Vercel workers (TypeScript, follows `auto-bind-page.ts` shape)

Model assignments are picked on results, not cost. Sonnet 4.6 for generation steps where multi-turn reasoning matters; Haiku 4.5 for extraction, normalization, lifting, and verification steps where structured output speed is what matters.

| Worker | Path | Model | Notes |
|---|---|---|---|
| Dispatcher | `api/web/pipeline/tick.ts` | (no LLM) | Reads `pipeline_jobs_ready`, marks rows running, fans out HTTP calls to workers |
| Notifier | `api/web/pipeline/notify.ts` | (no LLM) | Posts to ClickUp on `awaiting_gate`. Phase B uses simple DM-to-initiator; Phase C upgrades to task creation with smart routing (initiator + AM + PM by stage). |
| Normalizer | `api/web/agents/normalize-intake.ts` | `anthropic/claude-haiku-4-5` | Extraction + structured output. Haiku is the right fit; Sonnet would be over-spec. |
| Voice compiler | `api/web/agents/synthesize-voice-card.ts` | Haiku 4.5 | Lift + JSON assembly. Reframed as compiler, not synthesizer (see prompt v2). |
| Sitemap | `api/web/agents/generate-sitemap.ts` | `anthropic/claude-sonnet-4-6` | Multi-turn strategic reasoning + hard constraint enforcement. |
| Content strategy | `api/web/agents/generate-content-strategy.ts` | Sonnet 4.6 | Partner-facing prose with strategic framing. |
| Content map | `api/web/agents/generate-content-map.ts` | Sonnet 4.6 | Atom × page matrix reasoning crosses pages; Haiku struggles with this. |
| Roadmap | `api/web/agents/generate-roadmap.ts` | Haiku 4.5 | Almost entirely a lift step + simple opening paragraph generation. |
| Page drafter | `api/web/agents/draft-page.ts` | Sonnet 4.6 | Highest-stakes generation. Constrained creative — Sonnet excels here. Opus would be over-spec for tightly-constrained work. |
| Reviewers (per step) | `api/web/agents/review-{step}.ts` | Haiku 4.5 | Verification, not creative. Speed + accuracy on constraint checks. |

Shared:

- **`src/lib/pipelineQueue.ts`** — typed Supabase helpers (`enqueueJob`, `markRunning`, `markAwaitingGate`, `submitFeedback`). Every worker uses these.
- **`src/lib/pipelinePrompts.ts`** — loads active prompt from `prompt_versions` for an agent, injects template variables.
- **`scripts/sync-prompts.mjs`** — Node script. Walks `cowork-skills/`, parses each markdown file's frontmatter and fenced system-prompt block, upserts into `prompt_versions` keyed by (agent_name, version). Run on deploy or on-demand. The markdown stays canonical; the Supabase row is a derived snapshot.

### Gate UI components

For v2 — for v1 the gate decision happens in Cowork conversation.

| Component | Path | Reads | Action on approve | Action on send-back |
|---|---|---|---|---|
| Voice Card Gate | `src/components/wm/gates/VoiceCardGate.tsx` | `church_voice_cards` current row + paired `pipeline_jobs` reviewer verdict | Insert `pipeline_feedback` with action=approve | Insert with action=send_back + notes; worker layer enqueues corrective job |
| Sitemap + Strategy Gate | `src/components/wm/gates/SitemapGate.tsx` | `web_pages` + nav structure + strategy doc JSON | (same pattern) | (same) |
| Content Map Gate | `src/components/wm/gates/ContentMapGate.tsx` | `content_page_map` rendered as matrix | (same; supports inline cell edits) | (same) |
| Phase 1 Review Queue | `src/components/wm/gates/Phase1ReviewQueue.tsx` | All Phase 1 `web_pages` + reviewer bands | Per-page or bulk-approve-all-green | Per-page send-back with notes |
| Partner Publish Gate | `src/components/wm/gates/PartnerPublishGate.tsx` | Read-only partner portal preview | Activate partner portal token | (no send-back; either approve or cancel) |

### Cron + DB trigger glue

| Piece | Where | What it does | New? |
|---|---|---|---|
| Vercel cron entry | `vercel.json` `crons` array | Hits `/api/web/pipeline/tick` every minute | NEW (small edit) |
| pg_cron alternative | Supabase scheduled function | Same role as Vercel cron, but inside Supabase | Optional, NEW if used |
| `pipeline_jobs_advance_dependents` trigger | Already in `v35` | Flips dependent jobs from pending → ready when blockers succeed | DRAFTED in v35 |
| `pipeline_feedback_apply` trigger | Already in `v35` | Advances gated jobs from awaiting_gate → succeeded on approve | DRAFTED in v35 |
| Intake-complete trigger | NEW | Watches `web_intake_documents` insertions and `strategy_web_projects.handoff_web_form` updates; inserts a `normalize_intake` job when hard stops clear | Add as `v37_intake_trigger.sql` |

---

## The orchestration layer, side by side

### v1 — Cowork as orchestrator

```
[Ashley opens Cowork session]
  │
  ▼
"run the web pipeline for project 3490"
  │
  ▼
Cowork invokes web-intake-normalizer skill
  → reads intake files + Supabase rows
  → extracts atoms, writes via Supabase MCP
  → reports what was extracted
  │
  ▼
Cowork invokes web-voice-card-compiler skill
  → reads strategic atoms via MCP
  → produces voice card JSON
  → writes to church_voice_cards via MCP
  → asks Ashley: "review in the Voice tab. approve?"
  │
  ▼
[Ashley opens app, reads Voice tab, comes back]
"approve"
  │
  ▼
Cowork invokes web-sitemap-builder skill
  → reads voice card + atoms
  → produces sitemap + nav
  → writes web_pages + nav_items via MCP
  → asks Ashley: "review in the app. approve?"
  │
  ... (continues through content strategy, content map, roadmap, page drafts)
  │
  ▼
Cowork invokes web-section-binder for each Phase 1 page
  → reads concept tags on each section
  → loads brixies-library.json
  → picks specific template_id per section (structural fit)
  → validates template.family ∈ concept.family_filter
  → writes web_sections.template_id via MCP

Cowork invokes web-page-drafter for each Phase 1 page
  → for each page: reads atoms + voice card + each section's bound template schema
  → writes ONLY slots backed by content (don't shoehorn)
  → writes web_sections.field_values via MCP
  → after all done, asks Ashley: "review queue is ready. approve each in app."
  │
  ▼
[Ashley walks the Pages workspace, approves each]
  │
  ▼
Done. v1 has produced a real Phase 1 site draft for Riverwood.
```

**Required to run v1:** v35 applied, the 7 Cowork skill markdown files, the Riverwood inputs already in the project folder. No code beyond the SQL migration.

### v2 — Production: cron + workers

```
[Intake hard stops clear in Supabase]
  │
  ▼
Intake-complete trigger inserts pipeline_jobs row (step=normalize_intake)
  │
  ▼
Vercel cron (every minute) hits /api/web/pipeline/tick
  → tick reads pipeline_jobs_ready (LIMIT 5)
  → marks 'running'
  → POSTs to /api/web/agents/normalize-intake
  │
  ▼
normalize-intake worker
  → reads intake via Supabase service-role client
  → writes atoms + facts
  → marks job 'succeeded'
  │
  ▼
pipeline_jobs_advance_dependents trigger fires
  → flips pending synthesize_voice_card job to ready
  │
  ▼
Next cron tick picks it up, fires synthesize-voice-card worker
  → produces voice card
  → marks job 'awaiting_gate'
  │
  ▼
notify worker fires (separate concern)
  → posts to ClickUp with deep link to Voice Card Gate
  │
  ▼
[Ashley clicks ClickUp link, opens app at the gate]
[Ashley clicks Approve]
  → app inserts pipeline_feedback row (action=approve)
  → pipeline_feedback_apply trigger flips voice card job to succeeded
  → dependents trigger fires, flips next jobs to ready
  │
  ▼ (chain continues automatically through all steps)
  ▼
[All Phase 1 pages drafted + reviewed]
  → batch transition to awaiting_gate (gate_phase1_pages)
  → notify fires
  │
  ▼
[Ashley walks the queue, approves]
  → partner publish gate awaits
  │
  ▼
[Ashley approves partner publish]
  → partner portal activates
```

**Required to run v2:** Everything above plus the Vercel workers, the pipelineQueue lib, the cron config, the gate components, the notify wiring.

---

## Brand guide ingestion (dual-source, handled in normalize_intake)

The brand guide is the one input source with two possible homes during your migration. The normalizer resolves on every run:

```python
# pseudocode for the normalizer's brand guide load step
brand_guide_content = None

# 1. Try Supabase first
published_guide = supabase.table('strategy_brand_guides')
  .select('*')
  .eq('member', project.member)
  .eq('is_published', True)
  .order('last_updated_at desc')
  .limit(1)
  .maybeSingle()

if published_guide:
    brand_guide_content = render_brand_guide_to_text(published_guide)
    source_note = "supabase:strategy_brand_guides"
elif project.external_brand_guide_url:
    # 2. Fall back to standards.site URL fetch
    brand_guide_content = fetch_standards_site_ai_endpoint(project.external_brand_guide_url)
    source_note = f"external:{project.external_brand_guide_url}"
else:
    # 3. No brand guide — atoms.topic='branded_term', 'voice_rule' etc. just won't be created
    brand_guide_content = None
    source_note = "absent"

# Extract atoms from brand_guide_content (or skip if None)
```

Same logic in both v1 (Cowork does the resolution) and v2 (worker does the resolution). Neither source is "more authoritative" — whichever is configured is the source.

---

## Build order — what to do, in order

Each step is independently runnable / testable. Don't go forward until the previous step works.

### Phase A — proof on Riverwood (no code beyond SQL)

1. **Apply `v35_pipeline_foundation.sql`** to Supabase. (5 min)
2. **Draft and seed `v36_pipeline_seed_prompts.sql`** with the voice card compiler prompt v2 + placeholder rows for the other agents. (1 hr — mostly drafting prompts)
3. **Write `cowork-skills/web-intake-normalizer.md`**. The extraction rules. The hardest one to write because the lift quality of every downstream step depends on this. (1 day)
4. **Test step 3 manually**: invoke the skill in Cowork against Riverwood 3490 intake. Verify atoms land in Supabase with the right topic tags and source_kind. (Half day)
5. **Write `cowork-skills/web-voice-card-compiler.md`**. (Half day — voice card prompt v2 is mostly drafted, this wraps it as a Cowork skill.)
6. **Test step 5 manually**: invoke in Cowork. Verify voice card lands in `church_voice_cards`. Compare against the worked example in `prompts/voice-card-synthesizer.md`. (Half day)
7. **Open Voice tab in app**. Verify the voice card row renders correctly. (No code required — the Voice tab already exists from v30; minor template adjustments may be needed to render the new payload structure.) (Half day)
8. **Write remaining Cowork skills** (sitemap-builder, content-strategy-author, content-map-builder, roadmap-builder, page-drafter). Adapt from existing skills where applicable. (3-5 days)
9. **Test the full chain end-to-end on Riverwood**. Cowork session walks through all steps. Ashley approves at each gate. Final output: drafted Phase 1 pages visible in the app. (1-2 days)

After Phase A: you have a proof. Real Riverwood Phase 1 pages exist in the app, drafted by the chain, approved at every gate, ready to ship to the partner. No production code yet.

### Phase B — automate (production code)

10. **Build `src/lib/pipelineQueue.ts`** typed helpers. (1 day)
11. **Build `api/web/pipeline/tick.ts`** dispatcher. (Half day)
12. **Build first worker `api/web/agents/synthesize-voice-card.ts`**. Establishes the pattern. (1 day)
13. **Configure Vercel cron**. (10 min)
14. **End-to-end test of automated voice card loop on a test project**. (Half day)
15. **Build remaining workers**: normalize-intake, generate-sitemap, generate-content-strategy, generate-content-map, generate-roadmap, draft-page, plus paired reviewers. (5-7 days, mostly template work since they all follow the same shape)
16. **Build gate UI components**. (3-5 days)
17. **Build `api/web/pipeline/notify.ts`** + ClickUp wiring. (Half day)
18. **Build intake-complete trigger** (`v37_intake_trigger.sql`). (Half day)
19. **Full automated end-to-end test on a fresh project** (NOT Riverwood — Riverwood is now the v1 reference). (1 day)

After Phase B: a new project arrives, intake completes, you get a ClickUp ping when each gate opens, you approve. The pipeline produces a publishable Phase 1 site. No strategist required.

### Phase C — incremental (nice-to-haves)

20. **Site crawler** for the v2 of intake (currently manual upload). Lives in a Railway container or Vercel Background Function with Playwright. (3-5 days)
21. **Bulk regeneration** when intake materially changes. (1-2 days)
22. **Prompt A/B versioning** with quality tracking against reviewer scores. (2-3 days)
23. **Drift detection** — compare draft embeddings against a known-generic baseline. (2-3 days)

---

## Decisions locked in

1. **Cowork skills live in `cowork-skills/` at the repo root.** Version-controlled with the codebase. Cowork reads markdown directly during v1 runs. A `scripts/sync-prompts.mjs` build script (Phase B work) extracts the system prompts and seeds `prompt_versions` for Vercel workers. Markdown is canonical; Vercel never reads markdown at runtime.

2. **Seven separate skills + parent runner.** Each step skill is independently invocable for retries / partial reruns. A thin `web-pipeline-runner.md` chains them for end-to-end runs.

3. **Riverwood v1 test uses a fresh project row** labeled `3490-poc` (or similar). The existing 3490 project stays untouched.

4. **ClickUp notifications.** Phase B launches with simple DM-to-initiator. Phase C upgrades to task creation with smart routing to initiator + AM + PM by stage. Don't let notification engineering block the chain working.

5. **Model assignments — best for the job.** Sonnet 4.6 on generation-heavy steps (sitemap, content strategy, content map, page drafter). Haiku 4.5 on extraction, lift, normalization, and all reviewers. See the worker table above.

## Still open

None that block Phase A. Tactical questions surface as we build each skill.

---

## What this doc does NOT include

- The actual content of each Cowork skill markdown file. Those are drafted as separate files, one per skill, when we build them.
- The actual TypeScript of each Vercel worker. Those follow the `auto-bind-page.ts` template.
- The seed prompt content for agents beyond voice card. Those are drafted as we build each step.
- The gate UI design. The architecture doc has the contract; the actual React components are built in Phase B.

This is the map. Everything below the map gets built per the order above.
