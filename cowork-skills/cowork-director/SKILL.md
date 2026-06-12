---
name: cowork-director
description: |
  Orchestrate one Copy Engine run for a single web project. Connect to
  the project's Supabase tables with service-role auth, inventory every
  source of truth, build a strict-resume work plan (skip what already
  landed), dispatch focused worker skills one unit at a time, and write
  live status to roadmap_state.cowork_progress after every step so the
  in-app workspace shows real progress without polling each worker.
  Entry point for the daily cron AND for a strategist's manual trigger.
model: anthropic/claude-opus-4-7
allowed-tools: Bash, Read, mcp__claude_ai_Supabase__execute_sql, Agent
version: '1.0.0'
---

# Cowork Director

You orchestrate the Copy Engine for ONE web project at a time. You are
the only skill that reads Supabase directly; every worker skill below
you receives its inputs pre-staged in its prompt.

## What you read (the project's inventory)

For the project ID you're given, query Supabase for:

| Table | What's there | Used for |
|---|---|---|
| `strategy_web_projects` (one row) | `roadmap_state` JSONB (current pipeline state), `member`, `name` | Decide what's already done. Skip anything present. |
| `web_intake_documents` (N rows, archived=false) | Uploaded strategy briefs, brand guides, content collection CSVs, prose docs | Source for `extract-strategic-pillars` (prose docs) AND `parse-facts-csv` (CSVs) |
| `strategy_content_collection_sessions` (latest row by submitted_at) | Page 1 + Page 2 partner-submitted answers per field | Passed straight to `outline-page` for the pages it applies to. Also a source for facts. |
| `web_project_topics` (N rows) | Crawl results organized by topic — `passages`, `items`, `topic_group`, `inventory_kind` | THE content inventory. Used by `outline-page` to find what content the partner's current site has on each topic. |
| `strategy_discovery_questionnaire` (latest row by member) | Q&A answers | Source for `extract-strategic-pillars` AND `synthesize-strategy` |
| `strategy_brand_guides` (latest published row by member) | Voice + identity from Brand squad | Source for `extract-strategic-pillars` |
| `strategy_account_progress` (one row by member) | `handoff_web_form`, `handoff_brand_form` | Source for `extract-strategic-pillars` if no published brand guide exists |
| `content_atoms` (existing) | Strategic Pillars already produced in prior runs | Resume-skip target — don't re-extract |
| `church_facts` (existing) | Structured facts already produced | Resume-skip target |

You DO NOT atomize the entire content inventory yourself. You orchestrate
focused skills that each handle one slice.

## What you do not do

- You don't write copy. You don't extract pillars yourself. You don't
  outline pages yourself. You dispatch a worker per unit.
- You don't load file contents into the model context. The worker
  skills that need file content load it themselves (storage URL is in
  `web_intake_documents.storage_url`).
- You don't decide which atoms are "good." That's the per-skill
  validator's job at import time.

## Strict-resume queue construction

For each potential step below, check the resume condition. **Only enqueue
the step if its resume condition says "needs work."** This makes runs
idempotent — strategists can re-trigger a project without paying for
work that already landed.

| # | Step (in dependency order) | Resume condition (skip if true) | Worker skill |
|---|---|---|---|
| 1 | Extract pillars from each prose source (strategy_brief / discovery / brand_guide / handoff / content_collection prose fields) | A `content_atoms` row exists whose `source_ref` matches THIS source's id | `extract-strategic-pillars` |
| 2 | Parse facts from each CSV intake doc + each structured content_collection field | A `church_facts` row exists whose `source_ref` matches the CSV's id | `parse-facts-csv` |
| 3 | Synthesize stage_1 | `roadmap_state.stage_1` exists AND its `_meta.generated_at` is AFTER the latest `content_atoms.created_at` for this project | `synthesize-strategy` |
| 4 | Classify ministry model | `roadmap_state.ministry_model` exists AND `_meta.generated_at` is after stage_1 | `classify-ministry` |
| 5 | Organize ACF plan | `roadmap_state.acf_plan` exists AND `_meta.generated_at` is after stage_1 | `organize-acf` |
| 6 | Plan site strategy | `roadmap_state.site_strategy` exists AND `_meta.generated_at` is after ministry_model | `plan-site-strategy` |
| **7** | **Plan cross-page allocation** — ONE project-level call that reads truth (crawl + content collection) + pillars (including `recommended_page` directive pillars) + facts + strategic supplements, and decides (a) what content lands on which pages with what treatment + flow_role, and (b) which `recommended_page` pillars route to the `build_directives[]` bucket (CMS/CPT workflow, redirect maps, seasonal theming, etc. — dev-handoff items, not page copy). Outputs `CoworkPageAllocationPlan` with `allocations` + `source_traces` + `unresolved_sources` + `build_directives`. The downstream importer surfaces `build_directives` on the project's dev handoff. | `roadmap_state.page_allocation_plan` exists AND `_meta.generated_at` is after site_strategy | `plan-cross-page-allocation` |
| 8 | Outline each sitemap page (consumes that page's allocation slice + the ministry-model templates) | For slug X: `roadmap_state.page_outlines[X]` exists AND `_meta.generated_at` is after the allocation plan | `outline-page` (per slug) |
| 9 | Draft each outlined page (reads outline + the actual source content via source_ref lookups — pulls crawl passages, content_collection fields, atoms by UUID) | For slug X: `roadmap_state.page_drafts[X]` exists AND `_meta.generated_at` is after that page's outline | `draft-page` (per slug) |
| 10 | Critique each drafted page (5-axis: dignity floor 70 / voice_character / persona_fit / atom_coverage / claim_plausibility) | For slug X: a `page_critique` artifact exists AND `_meta.generated_at` is after that page's draft | `critique-page` (per slug) |
| 11 | Roll up cross-page critique | `roadmap_state.critique_rollup` exists AND `_meta.generated_at` is after the last per-page critique | `synthesize-critique` |

The dependency rule above isn't "if it exists, skip" — it's "if it
exists AND is fresh enough relative to upstream, skip." This avoids
3734's failure mode where stage_1 / site_strategy / etc. existed but
were atom-blind (generated before any atoms landed).

## Status writes — the protocol the workspace polls

After EVERY dispatched worker call (success OR failure), write to
`strategy_web_projects.roadmap_state.cowork_progress` via the atomic
v68 RPC `roadmap_state_set(project_id, ['cowork_progress'], value)`.

The shape you write must match `CoworkBundleProgress` in
`src/types/coworkBundle.ts`. Concretely:

```json
{
  "bundle_version":  "1.0.0",
  "status":          "running",
  "current_step":    "outline-page:home",
  "completed_steps": ["extract-strategic-pillars:strategy_brief.md", "extract-strategic-pillars:discovery", "synthesize-strategy", "..."],
  "total_steps":     54,
  "started_at":      "2026-06-11T00:00:00Z",
  "last_action_at":  "2026-06-11T00:12:33Z",
  "last_artifact":   { "kind": "page_outline", "key": "home" }
}
```

When the queue is empty, set `status: "done"`. On any worker failure
that's not retriable, set `status: "failed"` and include `last_error`.

## Dispatch contract

Each worker skill expects a tightly-scoped input payload. You construct
the payload from Supabase data you've already read. You do NOT pass the
whole roadmap_state — only the slice that worker needs.

Worker input examples:

- `extract-strategic-pillars` per prose source:
  ```json
  {
    "project_id": "<uuid>",
    "source_id":  "<web_intake_documents.id or 'discovery' or 'brand_guide'>",
    "source_kind": "intake_doc | discovery_questionnaire | brand_guide | account_handoff",
    "source_filename": "Printer-friendly Strategy Brief.md",
    "source_text":  "<full text of the source — you load it via storage_url before dispatching>"
  }
  ```

- `outline-page` per slug:
  ```json
  {
    "project_id": "<uuid>",
    "page_slug":  "kids",
    "sitemap_entry": { /* the matching pages[] entry from stage_2 */ },
    "site_strategy": { /* stage_1 + site_strategy bundle */ },
    "ministry_model": { /* ministry_model artifact */ },
    "pillars_relevant": [/* content_atoms rows filtered to relevant topics for this page */],
    "facts_relevant":   [/* church_facts rows filtered to relevant topics for this page */],
    "crawl_topics_relevant": [/* web_project_topics rows for crawl topics that map to this page */],
    "content_collection_for_page": { /* any content_collection field that names this page */ }
  }
  ```

You decide what counts as "relevant" using the same heuristics in-app
`page-outlines.ts` used: topic-keyword match against the sitemap
entry's `name` + `page_job` + sitemap_signals, plus explicit
references from `site_strategy.page_elevations` and
`site_strategy.key_info_to_highlight`.

## Concurrency

Workers can run in PARALLEL when they're independent — multiple
`extract-strategic-pillars` calls (one per source) can run together;
multiple `outline-page` calls (one per sitemap page) can run together.

Workers must run in SERIES when they're dependent — every
`outline-page` must finish before any `draft-page` for that page;
all `critique-page` calls must finish before `synthesize-critique`.

Use the `Agent` tool with multiple tool-use blocks in one message to
fan out independent workers. Wait for all results before moving to the
next dependent stage.

## Failure handling

Per worker:
- If the worker returns successfully, write its artifact to Supabase
  via service-role and append to `completed_steps`.
- If the worker errors and the error is retriable (network, transient
  gateway hiccup), retry once with the same payload. If retry fails,
  mark this step blocked in `last_error` and continue with other
  independent work.
- If the worker errors and the error is structural (e.g., 0 atoms
  returned when input had content — that means the model failed to
  extract), skip the step and surface a flag in `last_error.note` for
  strategist review. Do NOT silently mark it done.

## When to STOP

Stop the run if:
- All queue items have been processed (success or failure-with-flag)
- Three consecutive workers have failed retriably (gateway is down)
- The project's `engine_state.status` flips to `cancelled` mid-run
  (strategist hit Stop in-app)

Final status write: `{ status: "done" }` OR `{ status: "failed", last_error }`.
