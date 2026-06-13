# Cowork Desktop Guide

The cowork pipeline is split across two surfaces:

| Surface | What it owns |
|---|---|
| **Web UI** (Web Manager → Cowork tab) | Bulk operations, pipeline state, inventory review, project-level endpoint Run buttons. |
| **Claude Desktop** (this guide) | Per-page conversation work. Allocation. Drafting + critique in dialogue. Editing drafts with the model. |

When the Cowork tab status board shows a step's pill as **`Cowork session`**, that step happens here, in Claude Desktop. Web UI shows the strategist what's done + what's next; Claude Desktop is where the actual writing partnership happens.

## Setup (one-time)

Configure Claude Desktop (or Claude Code CLI) with:

1. **Supabase MCP server** — so the model can read project state + write back via `mcp__claude_ai_Supabase__execute_sql` and friends. Without this the model can't reach the project's inventory.
2. **The cowork-skills bundle** — available either:
   - As a project skill (preferred): point Claude Desktop / Code at `cowork-skills/` in this repo so skills load automatically.
   - Pasted into the conversation each session: open the relevant `cowork-skills/<skill-name>/SKILL.md` and paste at the start.

The skills you'll invoke from Claude Desktop:

| Skill | Step in pipeline | What it produces |
|---|---|---|
| `extract-strategic-pillars` | 1 (optional — the Vercel endpoint can also drive this) | `content_atoms` rows |
| `parse-facts-csv` | 2 (same — Vercel endpoint exists too) | `church_facts` rows |
| `plan-cross-page-allocation` | 7 | `roadmap_state.page_allocation_plan` |
| `outline-page` | 8 (per page) | `roadmap_state.page_outlines[<slug>]` |
| `draft-page` | 9 (per page) | `roadmap_state.page_drafts[<slug>]` |
| `critique-page` | 10 (per page) | `roadmap_state.page_critiques[<slug>]` |

Steps 3, 4, 5, 6, 11 fire from the web UI Run buttons. You don't run those skills in Claude Desktop unless you're debugging.

## Project-level invocation pattern

Replace `<PROJECT_ID>` with the project's UUID (visible in the URL on the Web Manager: `/web/<PROJECT_ID>?tab=cowork`).

---

### Step 7 — plan-cross-page-allocation

**Run this once per project**, after steps 1-6 are done on the web UI side.

> Use the `plan-cross-page-allocation` skill to produce a `page_allocation_plan` for project_id `<PROJECT_ID>`.
>
> Read everything you need from Supabase:
> - `strategy_web_projects.roadmap_state.stage_1`
> - `strategy_web_projects.roadmap_state.ministry_model`
> - `strategy_web_projects.roadmap_state.site_strategy`
> - `strategy_web_projects.roadmap_state.acf_plan`
> - All `content_atoms` for this project (status='approved' OR 'draft')
> - All `church_facts` for this project (status='approved' OR 'draft')
> - All `web_project_topics` for this project
>
> When the allocation is complete, write it to `strategy_web_projects.roadmap_state.page_allocation_plan` via the `roadmap_state_set` RPC (path: `['page_allocation_plan']`). Stamp the `_meta` block per the SKILL contract.
>
> Walk me through each page's allocation as you produce it; pause for my pushback before you persist.

---

### Step 8 — outline-page (one session per page, OR one stateful session walking through all pages)

For each page slug you want to outline (after allocation is done):

> Use the `outline-page` skill for project_id `<PROJECT_ID>`, page_slug `<SLUG>`.
>
> Read:
> - `strategy_web_projects.roadmap_state.page_allocation_plan.allocations[]` (find the entry where `page_slug = '<SLUG>'`)
> - `strategy_web_projects.roadmap_state.stage_1`
> - `strategy_web_projects.roadmap_state.ministry_model`
> - The `content_atoms`, `church_facts`, and `web_project_topics` referenced by that allocation slice
>
> Produce the outline per the SKILL contract (sections, atom_assignments, fact_assignments, crawl_topic_assignments, voice_anchor, etc.). Validate against the contract before persisting.
>
> Write to `strategy_web_projects.roadmap_state.page_outlines.<SLUG>` via the `roadmap_state_set` RPC (path: `['page_outlines', '<SLUG>']`). Stamp `_meta`.

---

### Step 9 — draft-page

For each outlined page:

> Use the `draft-page` skill for project_id `<PROJECT_ID>`, page_slug `<SLUG>`.
>
> Read:
> - `strategy_web_projects.roadmap_state.page_outlines.<SLUG>` (the outline)
> - `strategy_web_projects.roadmap_state.stage_1` (for voice + ethos + personas)
> - The atoms / facts / crawl topics the outline references
>
> Produce the draft per the SKILL contract (copy slot map, atoms_used, facts_used, crawl_topics_used, voice_notes, deferred_atoms if applicable).
>
> Write to `roadmap_state.page_drafts.<SLUG>`. Stamp `_meta` with model + prompt_hash + generated_at.

---

### Step 10 — critique-page

For each drafted page:

> Use the `critique-page` skill for project_id `<PROJECT_ID>`, page_slug `<SLUG>`.
>
> Read:
> - `roadmap_state.page_drafts.<SLUG>` (the draft)
> - `roadmap_state.page_outlines.<SLUG>` (the outline)
> - `roadmap_state.stage_1` (voice + ethos for dignity scoring)
> - The atoms / facts the draft consumed (for source_coverage + claim_plausibility)
> - The draft's `deferred_atoms[]` — every entry MUST surface in your `directives[]` at severity ≥ warning (visibility cost rule)
>
> Produce the 5-axis critique (dignity, voice_character, persona_fit, source_coverage, claim_plausibility) + standout_lines + problem_lines + directives + summary.
>
> Write to `roadmap_state.page_critiques.<SLUG>`. Stamp `_meta`.

---

## Editing a draft in conversation

After `critique-page` runs, you'll see directives (blockers / warnings / nits). To edit the draft:

> Read `roadmap_state.page_drafts.<SLUG>` and the critique at `roadmap_state.page_critiques.<SLUG>`. Walk me through each `blocker` directive; I'll tell you how to fix each.
>
> Apply the fixes by editing the draft's `copy` field. When done, re-stamp `_meta.generated_at` to now (so the staleness guard catches that the critique is now stale and needs re-firing).
>
> Write the updated draft back to `roadmap_state.page_drafts.<SLUG>`.

Then return to the web UI → Cowork tab → status board will show `critique-page` as `stale` once you Refresh. Re-fire critique-page in a fresh session for that slug.

## Notes

- **`_meta.generated_at` discipline.** Every artifact write needs a fresh ISO timestamp on `_meta.generated_at`. The web UI's staleness guard uses this to compute pipeline status. If you hand-edit a draft and forget to bump the timestamp, the web UI will incorrectly show downstream artifacts as fresh.
- **Status field.** `content_atoms` and `church_facts` rows produced by `extract-strategic-pillars` / `parse-facts-csv` land at `status='draft'` so the strategist reviews them in the Atoms / Facts tabs before pipeline runs trust them.
- **Per-source vs project-wide.** Steps 1 and 2 are per-source (one extraction call per intake document or content-collection field). Step 7 is once per project. Steps 8-10 are per-page (run them once per sitemap slug). Step 11 (synthesize-critique) is once per project, fired from the web UI after all per-page critiques exist.
- **No deep links from web UI.** The web UI doesn't pre-fill prompts or launch Claude Desktop for you. Open Claude Desktop, copy the relevant starter prompt from this guide, fire it. The strategist's familiar pattern.
