# Copy Engine — normalize-intake audit + architecture refactor plan

Written after Ashley flagged that the Sonnet copywriter is producing
poor quality, 3886 was stuck (no way to re-trigger synthesize), and
the broader concern that content collection data could be silently
dropped.

---

## Part 1 — normalize-intake audit (Stage 0)

### What I checked
- `api/web/agents/normalize-intake.ts` end-to-end
- `src/lib/pipelinePromptsCore.ts` fallback prompt for `normalize`
- DB state for 3886 (stage_0 meta + content_atoms + church_facts)
- The file-load path + pre-flight + idempotent-delete path

### Strengths (already robust)
- Pre-flight validates the three minimum sources (strategy brief, brand source, discovery) before running. Missing sources → 400 with a clear error.
- 7 input sources cleanly labeled in the user message: AM handoff, brand guide / handoff, discovery, intake docs, **crawl topics (canonical inventory)**, content collection session, project snippets.
- Source priority documented in the normalize prompt (crawl as ground-truth inventory; strategic intake as overlay).
- Output token cap was already 32K (Opus has plenty of headroom past that).
- Idempotent — deletes prior atoms/facts before insert, so the strategist can re-run as many times as needed.

### Gaps found (8 total) — all fixed in this commit

**1. Silent file-load failures.** `loadIntakeFiles` caught per-file errors with `// silently skip; pre-flight already validated presence`. Pre-flight only validates DB-row presence, not storage readability. A 404 from `storage_url` = silent drop.
- **Fix:** `loadIntakeFiles` now returns `{loaded, failed}`. The handler refuses to run when `failed.length > 0`, returning a 422 with the exact file(s) + reason. Zero-loss guarantee enforced.

**2. No truncation detection.** If Opus used 100% of the 32K output budget, the handler had no way to tell whether the response was complete or cut mid-write.
- **Fix:** computes `truncation_suspected = output_tokens >= MAX * 0.9` and stamps it on `stage_0._meta.truncation_suspected` + `truncation_pct`. Same flag added to `extract-strategy.ts` (where 3886 actually got bitten — it was a silent 8000-token cut).

**3. Destructive delete with no backup.** Re-run produced fewer rows? Prior content was gone.
- **Fix:** before the `DELETE FROM content_atoms WHERE web_project_id = …`, snapshot the existing rows + counts into `roadmap_state.stage_0._prior_runs[]` (capped at 3, oldest dropped). Strategist can diff against the prior run and recover anything that disappeared.

**4. No per-source coverage telemetry.** Couldn't tell at a glance which input contributed which atoms.
- **Fix:** `stage_0._meta.atoms_by_source` + `facts_by_source` count atoms grouped by `source_kind`. Plus `sources_loaded` shows which sources were even available. A source that loaded but produced zero atoms is now a visible red flag.

**5. No delta-vs-prior tracking.** Re-run that produced 60 atoms when the prior had 90 was indistinguishable from a genuine improvement.
- **Fix:** `atoms_delta_vs_prior` + `significant_drop_vs_prior` (true when atoms_count dropped ≥20%). Surfaced in the new Setup Health banner.

**6. Stage 1 truncation goes silent.** 3886's stage_1 had only `_meta` because Opus hit the 8000-token cap and the tool_use truncated mid-write — `toolResult` landed as `{}`. The function happily wrote an empty stage_1 with `status: 'approved'` in _meta. Downstream every page-draft ran with `voice_exemplars=null / personas=null / x_factor=null`.
- **Fix:** `extract-strategy.ts` now stamps `truncation_suspected`, `looks_empty`, and `substantive_keys_count` into stage_1._meta. The workspace's `hasStage1` check now requires substantive keys (not just a populated _meta block), so a truncated extraction surfaces as "Stage 1 missing" and the Synthesize button reappears.
- **Also fixed:** `MAX_OUTPUT_TOKENS` raised from 8000 → 24000 (shipped in the previous commit).

**7. Setup Health blind spot in the UI.** Strategist had no way to see "did my synthesize succeed?" or "did normalize cover everything?". Just the "Strategy is ready" copy + a Draft sitemap button.
- **Fix:** new `SetupHealthBanner` renders at the top of Copy Engine. Three buckets: Stage 0 issues, Stage 1 issues, source-coverage gaps. Each row carries a one-click "Re-extract intake" / "Re-run Synthesize" button. Banner only shows when there's an actual issue.

**8. No way to trigger re-runs from Copy Engine.** Synthesize button only appeared when stage_1 was missing (false-positive bug). Normalize had NO entry point from this workspace — required switching to the Pipeline tab.
- **Fix:** new `run_normalize` orchestrate action (parallel to existing `run_synthesize`). The Setup Health banner exposes one-click re-runs for both stages.

### Zero-loss contract — what we now guarantee from normalize-intake
- Every intake file is either fully loaded OR the run aborts with a 422 naming the failed file.
- Truncation is surfaced explicitly (not silently swallowed).
- Significant drops vs the prior run are surfaced.
- Per-source coverage is auditable post-run.
- Prior runs are recoverable via `stage_0._prior_runs[]`.

### Gaps that REMAIN (limitations of a single-shot AI call)
- The model is still allowed to omit content from the response. If it's instructed to atomize "every distinct program" but decides 3 ministries don't matter, those won't appear in atoms. Truncation flags catch token-budget issues; they don't catch model judgment errors. The proposed architectural refactor (Part 2) addresses this by **splitting normalize-intake into per-topic agents** — each agent has a narrower scope and a smaller failure surface.
- The atom topic enum is closed (13 atom kinds + 12 fact kinds). Content that doesn't fit gets shoehorned or dropped. Refactor will introduce a catch-all + per-extractor schemas.

---

## Part 2 — Architecture refactor plan (Wave 14)

### Problem statement
- `extract-strategy` (Stage 1) is a monolithic AI call. Even with 24K output, large projects push the limit. When it truncates silently, every downstream stage runs blind.
- `page-briefs` boils 6 voice_samples + 13 voice_rules + 5 tone_descriptors + 7 value_statements into 5 voice_exemplars_to_imitate per page — a massive information loss before the copywriter ever sees the brief.
- `page-draft` reads the lossy brief + atoms it can't load (atom_id slug mismatch with content_atoms.id UUID) + snippets that USED to be missing church_name (fixed previous commit). The copywriter is starved of context.
- The brief is a SINGLE-SHOT REWRITE of work already done in stage_1 (which is itself a single-shot rewrite of stage_0). Three layers of lossy summarization between the partner's intake and the writer.

### Refactor approach
Replace extract-strategy's monolithic Stage 1 with **5 per-concern extractors**, each:
- Reads content_atoms by topic (filtered to its concern)
- Has a small, focused tool schema (≤4K output budget each)
- Writes to its own structured store (table or nested key in stage_1)
- Can be re-run independently when the strategist edits an input

Then refactor page-briefs to **reference, not duplicate**:
- Page briefs include a `voice_card_ref` pointing at the project's voice card, not a 5-phrase summary
- `atoms_assigned[]` carries REAL `content_atoms.id` UUIDs picked by topic-match per page
- The copywriter then reads the full voice card + real atoms + the brief's persona pointer

### New agents
| Agent | Reads | Writes | Output budget |
|---|---|---|---|
| `extract-voice-card` | `voice_sample` + `voice_rule` + `tone_descriptor` + `ethos` atoms | `voice_card` table OR `stage_1.voice_card` | 3K |
| `extract-personas` | `persona` atoms | `web_project_personas` table | 4K |
| `extract-mission-vision` | `mission_statement` + `vision_statement` + `value_statement` atoms | `stage_1.mission_vision` | 2K |
| `extract-x-factor` | `x_factor` atoms | `stage_1.x_factor` (top 2) | 1K |
| `extract-topic-plan` | `web_project_topics` + content_atoms by topic | `stage_1.topic_coverage_plan` | 5K |

Total max output across all 5: ~15K, distributed across 5 calls. No truncation risk on any single call.

The existing `extract-strategy` becomes a thin **aggregator** that calls the 5 sub-extractors in parallel and composes `stage_1`. No AI re-derivation in the aggregator.

### page-briefs refactor
- Today's `page-briefs` produces one brief per page with full voice fields duplicated.
- New `page-briefs` produces one brief per page with:
  - `voice_card_ref: <voice_card_id>` — points at the project-level voice card (read at copywriting time, not duplicated per page)
  - `persona_focus: { primary_id, secondary_id }` — UUIDs into `web_project_personas`, not name strings
  - `atoms_assigned: [<real UUIDs from content_atoms>]` — picked by topic-match for the page's job
  - `page_job` + `aeo_geo_targets` + `section_targets` (unchanged)

### page-draft refactor
- Loads:
  - The full voice card by `voice_card_ref` from the brief (all voice_samples + voice_rules + tone_descriptors)
  - The personas by `persona_focus.primary_id` (full description, not just name)
  - The atoms by `atoms_assigned[]` UUIDs (now they actually resolve)
  - Global merge fields + custom snippets (already fixed previous commit)
- The user-message body grows but each piece is REAL primary-source content, not a lossy summary.

### Migration plan
1. **Ship per-concern extractors as ADDITIONS, not replacements.** Existing `extract-strategy` keeps working; new extractors emit to new keys. Allows A/B comparison.
2. **Migrate page-briefs to read both old + new shapes.** Backward-compatible during rollout.
3. **Migrate page-draft to prefer new shapes over old.** Falls back to old fields if new ones are absent.
4. **Delete the old `extract-strategy` monolith** once all projects have re-extracted under the new pipeline.

Step 1-3 ship behind a feature flag per project. Once any project has voice_card + personas + topic_plan all populated, the engine reads from those. Otherwise it falls back to today's behavior.

### Open questions
- **Should `web_project_personas` be a real table or a nested key in stage_1?** Real table allows the strategist to edit per-persona in a dedicated UI, voice/persona-pass agents to reference specific personas, and per-persona content tagging on content_atoms. Recommendation: real table.
- **Should `voice_card` be a real table?** Less obvious. Voice cards are project-scoped (one per project), so a table adds little vs. a JSON key in stage_1. Recommendation: nested key for v1, promote to table only if multiple voice cards per project ever becomes a need.

### Effort estimate
- 5 new extractor agents: ~1 day each for the schema + prompt + call, with ~half a day each on prompt iteration → ~7 days.
- `extract-strategy` becomes thin aggregator: ~0.5 day.
- `page-briefs` refactor (dual-shape read + new emit): ~1 day.
- `page-draft` refactor (read new shapes, fall back to old): ~1 day.
- Migration helpers (backfill from existing stage_1 to new keys for in-progress projects): ~0.5 day.

Roughly 2 weeks of focused work. Half of that is prompt iteration on the extractors.

### What this DOES NOT fix
- Atom topic enum is still closed. The 13-topic taxonomy may need to grow. Out of scope for this refactor.
- Model quality on individual sections (heading word choices, etc.) is downstream of the refactor — better inputs → better defaults from the same model. If the user still wants Opus 4.8 on page-draft after the refactor lands, that's a separate switch.

---

## Decision points for you

1. **Approve the Stage 0 robustness fixes shipping this commit?** Yes/no — they're already in but I want to be explicit about the new contract (any file-load failure aborts the run with a 422; truncation/drop flags surface in UI; prior runs snapshotted).
2. **Approve the architecture refactor (Wave 14)?** It's a 2-week build. If yes, I'll start with `extract-voice-card` since voice is the most-broken downstream concern and the smallest individual surface to validate.
3. **Should personas land as a dedicated table?** My recommendation is yes — pays off in per-persona UI + targeted page assignments.
