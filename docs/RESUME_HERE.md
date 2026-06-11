# Resume Here

Single source of truth for picking up work across active threads. Updated
2026-06-11 at session pause.

---

## 1. Active threads at a glance

| Thread | Status | Blocked on | Resume trigger |
|---|---|---|---|
| **SRP port** | Phases 1–3 complete (schema + 14 endpoints + 12-step UI) | Smoke test on a real session | "resume SRP smoke test" / "SRP Phase 4 cleanup" / "SRP polish (resume / previous-week / clip-trim)" |
| **Cowork pipeline** | 3 skills written (director, extract-pillars, plan-cross-page-allocation on Fable 5) | User running Fable 5 validation outside chat | "fable test passed" / "fable test failed: …" / "continue cowork workers" |
| Web copy engine | Steps 1–8 shipped earlier (legacy); pivoted to cowork architecture | n/a | "back to legacy copy engine" — but cowork is the active path |
| Content Collection Page 2 | Still pending (separate flagged task) | n/a | "build content collection page 2" |
| SRP — first session in production | Not started | Above smoke test | "ship SRP to the team" |

---

## 2. SRP port — what's done, what's left

### Done
- **Phase 1** — `srp_pipeline` schema verified intact on squad-data; added 2 columns + 10 perf indexes via `schema/v69_srp_pipeline.sql` (applied as `v69_srp_pipeline_additions`).
- **Phase 2** — 14 server endpoints in [api/srp/](../api/srp/):
  - Helper: `_lib/aiGateway.ts` (Vercel AI Gateway forced tool-call), `_lib/mediaUrl.ts` (URL validator)
  - 6 generate-* endpoints on `google/gemini-3-pro-preview`
  - 4 n8n integration endpoints (start-transcription / transcription-callback / start-clipcutter / clipcutter-callback) writing to `srp_pipeline.transcript_jobs` and `clipcutter_jobs`
  - submit-to-clickup rewritten as n8n webhook flow with `srp_task_id_override` fallback
  - push-to-vista repointed to read from `srp_pipeline.sessions`
  - save-clip-template, save-brand-voice (brand voice writes to `srp_pipeline.clip_templates`, NOT `strategy_account_progress`)
  - fetch-sermon-submissions for the Recent Submissions popup
- **Phase 3** — full 12-step UI:
  - `src/contexts/SrpWorkflowContext.tsx` (state + 1s debounced autosave)
  - `src/lib/srpSessions.ts` + `srpRealtime.ts` (with `useTranscriptJob` / `useClipcutterJob` realtime hooks)
  - `src/lib/squadAccount.ts` + `accountContext.ts`
  - `src/lib/srpApi.ts` + `vistaCsvExport.ts`
  - 12 step components in [src/components/srp/steps/](../src/components/srp/steps/):
    AccountSelection · DeliverableSelection · SermonInput · ClipSelection · ReelCaptions · Carousel · Facebook · SundayInvite · PhotoRecap · CreativeDirection · ClipProcessing · ApprovedContent
  - Sidebar widgets: SrpQuickLinks, SrpAccountInfoPanel, RecentSubmissionsWidget, MissingBlockerTaskDialog
  - Shared subcomponents: BrandVoiceTagsBadges, CitationsList
  - Cleanup: deleted 7 dead files from the 4-step build + `_stubs.tsx`
- Brand voice writes never touch `strategy_account_progress` — they go to `srp_pipeline.clip_templates.brand_voice_guidelines` per CLAUDE.md.

### Deferred / polish (Phase 3.5, low priority)
- **ResumeSessionDialog** — auto-resume the most recent in-progress session for the user when they hit `/social/srp`
- **PreviousWeekCaptions** widget — show last week's deliverables as inspiration on the AccountSelection step
- **ClipTrimEditor** — let the coach cut out regions in the middle of a clip (Step 4); the schema column `clip_selections[*].cuts` already exists, just needs the editor UI

### Pending — Phase 4 cleanup
- Delete `tmp-srp-reference/` (working copy of the two reference apps; already in `.gitignore`)
- Smoke test a real session end-to-end on a Paradox account
- Audit `public.sms_srp_generation` + `public.sms_prompt_settings` (the orphan tables from the old broken build) — confirm no data worth migrating, then drop in a v70 migration

### Smoke test checklist
1. `npx tsc -b` + `npm run build` clean
2. Open `/social/srp` → click New SRP → pick a test partner (Paradox or any test account)
3. Workflow shell renders with **only** `Account → Deliverables → Approved` in sidebar
4. Step 1: see church card + Recent Submissions popup populates from `strategy_sermon_data` (Friday–Thursday window) → click to pair → ClickUp pill appears in sidebar → edit + save brand voice
5. Step 2: toggle deliverables; reel counter 0→1→2 — sidebar reshapes live as new steps appear
6. Step 3 (URL mode): paste a video URL → "Transcribe via n8n" → live job progress; OR paste-mode: textarea + timecode toggle → save
7. Step 4: Generate suggestions → 8 clips with category badges → pick 2 → continue
8. Steps 5–9: for each, generate, see citations + brand voice tags, pick, edit, continue
9. Step 10: pick template SRPA (.webm should autoplay), toggle BGM, write designer notes, check "save as default", continue → save fires
10. Step 11: Render clips → watch n8n status push in via Realtime → rendered MP4 links appear
11. Step 12: review every deliverable → Copy buttons work → Download CSV → Submit to ClickUp (should hit the blocker-dependency dialog the first time if no SRP Video child task exists)
12. Verify `srp_pipeline.sessions` row reflects all state; `srp_pipeline.transcript_jobs` + `clipcutter_jobs` have status = 'completed'

### Required Vercel env vars (verified set per user's confirmation)
- `AI_GATEWAY_API_KEY` ✅
- `SRP_N8N_TRANSCRIPTION_WEBHOOK_URL` (carried over)
- `SRP_N8N_CLIPCUTTER_WEBHOOK_URL` (carried over)
- `SRP_N8N_CALLBACK_SECRET` (carried over)
- `SRP_N8N_CLICKUP_WEBHOOK_URL` ✅ (new — set this batch)
- `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (existing)
- Optional: `VISTA_API_BASE_URL`, `VISTA_API_TOKEN`, `VISTA_TEAM_ID` (push-to-vista falls back to CSV if missing)

---

## 3. Cowork pipeline — what's done, what's left

### Done
- `cowork-skills/cowork-director/SKILL.md` (Opus 4.7) — orchestrator
- `cowork-skills/extract-strategic-pillars/SKILL.md` (Opus 4.7) — strategic-signal extractor (NOT a content atomizer)
- `cowork-skills/plan-cross-page-allocation/SKILL.md` (Fable 5) — cross-page sorter; layered empty-slot prevention
- `cowork-skills/canonical-templates.json` — Paradox baseline (20 page-section templates with uniform vocab)
- `cowork-skills/plan-cross-page-allocation/references/storybrand-and-flow.md` — flow_role framework
- `cowork-skills/page-outlines-by-ministry-model.md` — existing 446-line ministry-model × page-type doc
- `src/types/coworkBundle.ts` — bundle contract source-of-truth (`BUNDLE_VERSION = '1.0.0'`)
- `cowork-skills/plan-cross-page-allocation/FABLE-5-VALIDATION.md` — user-runnable test prompt for Fable 5 validation (user updated it with corrected Supabase schema notes)

### Active — user testing
- User is running Fable 5 validation on `plan-cross-page-allocation` outside the chat per `FABLE-5-VALIDATION.md`. Targeting **Paradox Church (TEST), member 99005**, `web_project_id 15394f01-b371-415e-9bae-5d6e7d50c58a`.

### Pending — branch on Fable 5 outcome
- **If pass:** write `draft-page` skill on Fable 5 (the copy-writing step — voice + dignity + persona fit). Director, extract-pillars, outline-page, critique-page, synthesize-critique, parse-facts-csv, synthesize-strategy, classify-ministry, organize-acf, plan-site-strategy stay on Opus 4.7.
- **If fail:** revert `plan-cross-page-allocation/SKILL.md` `model:` field back to `anthropic/claude-opus-4-7` and iterate on the prompt before re-testing.

### Pending — once branch decided
1. Write the remaining 4 per-page worker skills: `outline-page`, `draft-page`, `critique-page`, `synthesize-critique`
2. Write the 5 upstream worker skills: `parse-facts-csv`, `synthesize-strategy`, `classify-ministry`, `organize-acf`, `plan-site-strategy`
3. Build app-side `api/web/agents/import-cowork-bundle.ts` — deterministic translation from cowork bundle to `web_sections` writes with manifest validation
4. Workspace UI: replace `runEngine` cascade with a `cowork_progress`-polling status surface
5. Register CronCreate workflow that fires `cowork-director` against any project marked `ready_for_cowork`

### Models locked
- `cowork-director` → `anthropic/claude-opus-4-7`
- `extract-strategic-pillars` → `anthropic/claude-opus-4-7`
- `plan-cross-page-allocation` → `anthropic/claude-fable-5` (under test)
- `draft-page` (when written) → `anthropic/claude-fable-5` if Fable test passes, else `anthropic/claude-opus-4-7`
- Everything else → `anthropic/claude-opus-4-7`

### Pre-flight before any Fable 5 call
- Confirm the Anthropic org's data-retention setting is ≥30 days (Fable 5 returns `400 invalid_request_error` on every request if ZDR or below).

---

## 4. Smaller open threads

- **Content Collection Page 2** — flagged 2026-06-01. Page 1 inventory restructuring landed; Page 2 still pending. Resume trigger: "build content collection page 2".
- **Legacy copy engine** — Steps 1–8 shipped earlier; Step 9 (delete legacy 8-stage pipeline) intentionally deferred. The cowork pivot supersedes this work, but the legacy UI is still alive at `/web/:projectId?tab=pipeline`. Decision: delete legacy entirely once cowork ships, no separate Step 9.
- **Dashboard "ClickUp Task Sync"** — user originally flagged this as a gap. The Recent Submissions popup + Pair-by-Task-ID now does what the user described. If they want a richer sync (e.g. status push back to ClickUp on every step), that's net-new beyond what either reference app shipped.

---

## 5. How to resume each thread

| Thread | Phrase to say | What happens |
|---|---|---|
| SRP smoke test | "resume SRP smoke test" | I help walk through the smoke-test checklist on a real session; fix any bugs found |
| SRP Phase 4 cleanup | "SRP Phase 4 cleanup" | Delete `tmp-srp-reference/`, write v70 to drop orphan tables (with dependency audit per org rules) |
| SRP polish | "SRP polish" | Write the 3 deferred components (ResumeSessionDialog, PreviousWeekCaptions, ClipTrimEditor) |
| Fable test passed | "fable test passed" | Switch `draft-page` (when written) to Fable 5; otherwise leave plan-cross-page-allocation as-is |
| Fable test failed | "fable test failed: <details>" | Iterate on `plan-cross-page-allocation/SKILL.md` based on the failure or revert to Opus 4.7 |
| Cowork worker skills | "continue cowork workers" | Write the 9 remaining cowork skill files in order: outline-page → critique-page → synthesize-critique → parse-facts-csv → synthesize-strategy → classify-ministry → organize-acf → plan-site-strategy → draft-page (model TBD by Fable outcome) |
| Cowork import endpoint | "build import-cowork-bundle" | Write `api/web/agents/import-cowork-bundle.ts` against the manifest |
| Cowork status UI | "wire cowork status surface" | Replace runEngine cascade with `cowork_progress` polling |
| Content Collection Page 2 | "build content collection page 2" | Separate flagged task — different scope |

---

## 6. Files of record (where to look)

| File | Purpose |
|---|---|
| `docs/SRP_PORT_PLAN.md` | Full SRP port plan + phase status |
| `docs/SRP_N8N_INTEGRATION.md` | n8n webhook contract + env vars |
| `docs/RESUME_HERE.md` | **This file** — top-level resume state |
| `cowork-skills/plan-cross-page-allocation/FABLE-5-VALIDATION.md` | Fable 5 validation harness (user-runnable) |
| `src/types/coworkBundle.ts` | Cowork bundle contract |
| `schema/v69_srp_pipeline.sql` | SRP additive schema migration (applied) |

---

## 7. Conventions locked in by user during this run

- **No shortcuts on models** — Opus 4.7 / Fable 5 only. No Sonnet/Haiku unless explicitly chosen.
- **Brand voice writes never touch `strategy_account_progress`** — write to `srp_pipeline.clip_templates.brand_voice_guidelines` instead (CLAUDE.md rule).
- **Cap reels at 2** in v1 (schema constraint — only `reel1_caption`/`reel2_caption` columns exist).
- **URL is canonical for SRP sessions** — never store session_id in localStorage; load fresh from DB on mount.
- **Tool-use forcing is the structured-output contract** — never `JSON.parse` on prose. The "Model returned non-JSON output" bug class is permanently fixed by `api/srp/_lib/aiGateway.ts`.
- **n8n webhook callbacks key on `job_id` (UUID of the jobs row)** — not on `session_id`.
- **Sermon Studio App's DEFAULT_* prompts are the gold-standard** — lifted verbatim into our 6 generate-* endpoints.
- **`google/gemini-3-pro-preview` is the SRP content model on Vercel AI Gateway.** `gemini-2.5-flash` is reserved for transcription (cheaper, multimodal).
- **Wasabi-hosted .webm template thumbnails** — same URLs as srp-generator-main, no asset migration needed.
- **Dependency audit before any Supabase table drop/alter** — per org instructions. New schemas don't need it; ALTERs do.
