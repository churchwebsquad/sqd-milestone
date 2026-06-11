# SRP Generator — Port Plan (B: rip + replace)

Tracking doc for the SRP port. Updated as phases complete.

## Goal

Replace the current broken SRP code in `api/srp/` + `src/components/srp/` +
`src/pages/Srp*Page.tsx` with a faithful port of `srp-generator-main`'s
12-step workflow, lifting prompts from the Sermon Studio App where they
differ. Use Vercel AI Gateway routed to Gemini 3 Pro so we don't carry the
Lovable dependency.

## Why B and not A

Our existing SRP code is:
- Missing 8 of the 12 workflow steps (no AccountSelection, no Deliverable
  Selection, no ClipSelection / ClipTrimEditor, no CreativeDirection, no
  ClipProcessing, no ApprovedContentPanel, no sidebar, no Account Info,
  no Quick Links, no Brand Voice editor)
- Calling Anthropic Sonnet 4.0 (deprecated, retires 2026-06-15) directly
  with prose+prefill+JSON.parse — the exact pattern that throws
  "Slides model returned non-JSON output"
- Missing source citations on every generator
- Missing all 5 per-step JSONB input persistence columns

Fixing every one of those individually is more work than porting the
proven reference. Amend (A) was never viable.

## Decisions locked

| Decision | Value | Rationale |
|---|---|---|
| Approach | B (rip + replace) | Confirmed by user |
| Reference | `srp-generator-main` (full feature set) | Sermon Studio App's prompts get lifted into srp-generator-main's structure |
| AI gateway | Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1/ai`) | Already wired (we use it for Claude in cowork-skills); no Lovable dep |
| Content gen model | `google/gemini-3-pro-preview` (1M context, 64K output, $2/$12 per MTok, +tier above 200K) | Most advanced text-gen Gemini on the Gateway per user direction |
| Transcription model | `google/gemini-2.5-flash` | Sermon Studio App uses this; cheaper + multimodal-capable; no Gemini 3 transcription model exposed yet |
| Structured output | OpenAI-compatible Chat Completions `tools[]` + `tool_choice: {type:"function",function:{name}}` + `additionalProperties:false` + explicit `required` arrays | Identical to Sermon Studio App's pattern; the model literally cannot return non-JSON |
| Schema name | `srp_pipeline` | Confirmed by user (mirrors srp-generator-main's current name after rename from `srp_app`) |
| Brand voice write target | NEW column on `srp_pipeline.clip_templates` (per-account brand voice) | Per CLAUDE.md: never write back to `strategy_account_progress`. srp-generator-main's `save-brand-voice` endpoint will be redirected. |
| n8n integration | Existing `SRP_N8N_TRANSCRIPTION_WEBHOOK_URL` / `SRP_N8N_CLIPCUTTER_WEBHOOK_URL` / `SRP_N8N_CALLBACK_SECRET` env vars | Already documented in `docs/SRP_N8N_INTEGRATION.md` |
| ClickUp submission | n8n webhook posting to "SRP Video" child task | Same n8n route as srp-generator-main |

**Note:** `gemini-3-pro-preview` carries the "preview" tag — it's beta and
the ID may change. If Google promotes it to `gemini-3-pro` we'll bump.
Until then, preview is the most advanced text-gen Gemini Vercel exposes.

## Phases

### ✅ Phase 0 — Setup
- [x] Inventory all 3 codebases (Sermon Studio App + srp-generator-main + our current code)
- [x] Confirm Vercel AI Gateway Gemini lineup via `https://ai-gateway.vercel.sh/v1/models`
- [x] Add `tmp-srp-reference/` to `.gitignore`
- [x] Write this plan

### ✅ Phase 1 — Database (complete)

**Major finding:** `srp_pipeline` schema **already existed** on squad-data
(created when srp-generator-main was originally deployed against the
same Supabase project). All 6 tables present with their full column sets
plus the supporting `update_updated_at` function, per-table triggers,
RLS enabled, realtime publication on `transcript_jobs` + `clipcutter_jobs`,
and 3 seeded admins (ashley/amber/duane).

The original v69 migration was rewritten to be additive-only, adding
just the deltas the port needs:

- [x] `schema/v69_srp_pipeline.sql` — applied as `v69_srp_pipeline_additions`
  - `sessions.srp_task_id_override` (TEXT) — manual ClickUp blocker-dependency override
  - `clip_templates.brand_voice_guidelines` (TEXT) — per-account brand voice (replaces srp-generator-main's CLAUDE.md-forbidden write to `strategy_account_progress`)
  - 10 performance indexes (`sessions_member_idx`, `sessions_user_email_idx`, `sessions_status_idx`, `sessions_updated_at_idx`, `sessions_clickup_task_idx`, `transcript_jobs_session_idx`, `transcript_jobs_status_idx`, `clipcutter_jobs_session_idx`, `clipcutter_jobs_status_idx`, `clip_templates_member_idx`)
- [x] Applied via Supabase MCP `apply_migration` on project `wttgwoxlezqoyzmesekt` (squad-data)
- [x] Verified: both columns present, all 10 indexes created

**Orphans to leave in place for now:** `public.sms_srp_generation` and
`public.sms_prompt_settings` (what the current broken code writes to).
Once Phase 3 ships and the new UI is verified, we can audit those for
any data worth migrating, then drop them in a follow-up.

**Approved users reconciliation deferred to Phase 5** — current 3-admin
seed is fine for the port; staff roster sync from `clickup_users.employee`
happens later.

### ✅ Phase 2 — Server (complete)

All 13 server-side files in `api/srp/` ported to the new architecture.
Zero references to `sms_srp_generation`, `sms_prompt_settings`, or the
broken `_lib/anthropic.ts` remain.

#### 2a — AI Gateway helper foundation
- [x] `api/srp/_lib/aiGateway.ts` — Vercel AI Gateway helper hitting
  `/v1/chat/completions` with `AI_GATEWAY_API_KEY`. `callGateway()` forces
  a single tool call with strict JSON Schema (`additionalProperties: false`
  + explicit `required`) and returns parsed `arguments`. NO `JSON.parse`
  on prose anywhere. Includes typed errors (`GatewayRateLimitError`,
  `GatewayTransientError`, `GatewayContractError`), `resolvePrompt()` for
  DB overrides, and `BRAND_VOICE_TAGS_BLOCK` for transparent provenance.
- [x] Model constants centralized: `MODEL_CONTENT = 'google/gemini-3-pro-preview'`,
  `MODEL_TRANSCRIPTION = 'google/gemini-2.5-flash'`
- [x] Broken `_lib/anthropic.ts` deleted

#### 2b — 6 generate endpoints (AI-driven, pure functions)
- [x] `generate-reel-caption.ts` — single quote → `{ caption, brandVoiceTags }`
- [x] `generate-clips.ts` — transcript → 8 clips with category/quote/timing; branches on `hasTimecodes`; server-side filter rejects clips outside duration/wordcount envelope
- [x] `generate-carousel.ts` — 3 carousel concepts OR caption mode (given slides)
- [x] `generate-facebook-post.ts` — 3 FB post options with citations
- [x] `generate-sunday-invite.ts` — 3 invite options (warm/energetic/topical) with per-option citation
- [x] `generate-photo-recap.ts` — 3-5 captions, category-branched (serviceHighlights/weekendTeaching/seriesStartEnd/generalCelebration)
- Response shapes match Sermon Studio App exactly so the Phase 3 UI port works against these endpoints unchanged
- Architectural shift: endpoints are pure functions (no server-side DB writes). The Phase 3 UI handles persistence via WorkflowContext autosave through `supabase-js`

#### 2c — 4 n8n integration endpoints (async jobs)
- [x] `_lib/mediaUrl.ts` — shared YouTube/Dropbox/Vimeo/Google Drive validator (extracted from inline)
- [x] `start-transcription.ts` — inserts `srp_pipeline.transcript_jobs` row, fires n8n webhook, returns `job_id` for Realtime subscription
- [x] `transcription-callback.ts` — n8n PATCHes by `job_id`, mirrors to `sessions.transcript` on completion
- [x] `start-clipcutter.ts` — inserts `srp_pipeline.clipcutter_jobs`, fires n8n, returns `job_id`
- [x] `clipcutter-callback.ts` — n8n PATCHes by `job_id`, mirrors `clip_processing_status` to sessions on terminal status

#### 2d — ClickUp + Vista + save + fetch endpoints
- [x] `submit-to-clickup.ts` — **REWRITTEN** from direct ClickUp API comment-post to n8n-mediated flow that pushes clip videos + transcripts as attachments to a "SRP Video" child task (matches srp-generator-main behavior). Reads clip_results from `clipcutter_jobs`. Handles `no_blocker_dependency` from n8n by surfacing 422 so UI can prompt for `srp_task_id_override`.
- [x] `push-to-vista.ts` — repointed to read from `srp_pipeline.sessions`; rendered URLs from `clipcutter_jobs.clip_results`
- [x] `save-clip-template.ts` — NEW: upsert per-account creative direction defaults
- [x] `save-brand-voice.ts` — NEW: writes `brand_voice_guidelines` to `srp_pipeline.clip_templates` (NOT `strategy_account_progress` — CLAUDE.md rule)
- [x] `fetch-sermon-submissions.ts` — NEW: powers the Recent Submissions popup + Pair-by-ClickUp-Task-ID search. Read-only against `public.strategy_sermon_data` joined with `public.sf-srp-uploads` on `clickup_task_id = task_id`. Two modes: weekly (Friday–Thursday UTC window, srp_info_selection NOT NULL, capped 200) and targeted (single row by `clickup_task_id`). Returns `{ submissions, weekStart, searched? }` matching Sermon Studio App's contract.

#### Env vars status

| Env var | Used by | Status |
|---|---|---|
| `AI_GATEWAY_API_KEY` | All 6 generate-* endpoints | ✅ confirmed set in Vercel |
| `SRP_N8N_TRANSCRIPTION_WEBHOOK_URL` | start-transcription | Existing |
| `SRP_N8N_CLIPCUTTER_WEBHOOK_URL` | start-clipcutter | Existing |
| `SRP_N8N_CALLBACK_SECRET` | All 4 callback handlers + submit-to-clickup | Existing |
| `SRP_N8N_CLICKUP_WEBHOOK_URL` | submit-to-clickup | ✅ set in Vercel |
| `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | All endpoints | Existing |
| `VISTA_API_BASE_URL`, `VISTA_API_TOKEN`, `VISTA_TEAM_ID` | push-to-vista (optional) | If set, direct push works; if not, returns 503 + UI falls back to CSV |

### ✅ Phase 3 — Client (complete, polish deferred)

Shipped across 4 batches (foundation → input flow → generation steps → finalization).
All 12 workflow steps are real components. See [docs/RESUME_HERE.md](RESUME_HERE.md) for the
single source of truth on current state.

#### Foundation (Batch 1)
- [x] `src/contexts/SrpWorkflowContext.tsx` — 12-step state + 1s debounced autosave + `visibleSteps` computation
- [x] `src/lib/srpSessions.ts` rewrite (`srp_pipeline.sessions` via `.schema()` cast)
- [x] `src/lib/srpRealtime.ts` rewrite + `useTranscriptJob` / `useClipcutterJob` hooks
- [x] `src/lib/squadAccount.ts` + `accountContext.ts`
- [x] `src/lib/srpApi.ts` (fetch wrapper for `/api/srp/*`)
- [x] `src/components/srp/_shared/SrpWorkflowShell.tsx` — added `sidebarFooter` + ClickUp pill
- [x] `src/components/srp/_shared/SrpSidebarStepper.tsx` — `SrpWorkflowStep` type
- [x] `src/components/srp/SrpQuickLinks.tsx` — 8-tile external links grid
- [x] `src/components/srp/SrpAccountInfoPanel.tsx` — collapsible church info card
- [x] `src/pages/SrpWorkflowPage.tsx` rewrite — wraps SrpWorkflowProvider
- [x] `src/pages/SrpDashboardPage.tsx` — uses new srpSessions
- [x] Deleted 7 dead files from the 4-step build

#### Input flow (Batch 2)
- [x] `AccountSelectionStep` — church card + RecentSubmissionsWidget + Brand Voice editor (writes to `srp_pipeline.clip_templates`)
- [x] `RecentSubmissionsWidget` — `/api/srp/fetch-sermon-submissions` (weekly + Pair-by-Task-ID)
- [x] `DeliverableSelectionStep` — 4 toggle cards + reel counter (capped at 2 per schema)
- [x] `SermonInputStep` — URL/paste tabs; URL fires `/api/srp/start-transcription` with live `useTranscriptJob` progress
- [x] `ClipSelectionStep` — generate + pick clips matching reel count (ClipTrimEditor deferred)

#### Generation steps (Batch 3)
- [x] `BrandVoiceTagsBadges` + `CitationsList` shared subcomponents
- [x] `ReelCaptionsStep` — per-clip caption generation with per-reel guidance input
- [x] `CarouselStep` — two-phase (slides options → pick → caption with `type:"caption"`)
- [x] `FacebookStep` — 3 options with citations + edit
- [x] `SundayInviteStep` — 3 tone-coded invites (warm/energetic/topical)
- [x] `PhotoRecapStep` — category picker + captions with brand voice tags

#### Finalization (Batch 4)
- [x] `CreativeDirectionStep` — 6-template .webm grid (Wasabi-hosted) + BGM + designer notes + save-as-default
- [x] `ClipProcessingStep` — fires `/api/srp/start-clipcutter` with MM:SS → milliseconds conversion + `useClipcutterJob` Realtime
- [x] `ApprovedContentStep` — final review + Copy buttons + Submit to ClickUp + Vista CSV/direct push
- [x] `MissingBlockerTaskDialog` — modal for `srp_task_id_override` when n8n can't resolve blocker-dependency
- [x] `src/lib/vistaCsvExport.ts` — per-platform CSV builder (one row per deliverable per platform)

#### Deferred polish (Phase 3.5)
- [ ] `ResumeSessionDialog` — auto-resume the most recent in-progress session for the user on dashboard load
- [ ] `PreviousWeekCaptions` widget — show last week's deliverables as inspiration on AccountSelection
- [ ] `ClipTrimEditor` — let the coach cut out regions in the middle of a clip (Step 4); `clip_selections[*].cuts` column already exists in the schema
- [ ] Reconcile admin gating with our `clickup_users.employee` table (current allowlist still hardcoded in `srp_pipeline.approved_users`)
- [ ] Mobile responsive audit (sidebar → hamburger on mobile)

### Phase 4 — Cleanup + smoke test (pending — pause point at 2026-06-11)
- [ ] Run a real session against a test account through all 12 steps (checklist in [docs/RESUME_HERE.md](RESUME_HERE.md) §SRP smoke test)
- [ ] Delete `tmp-srp-reference/` directory (gitignored already)
- [ ] Audit orphan tables `public.sms_srp_generation` + `public.sms_prompt_settings` per the org dependency-audit rule — confirm no data worth migrating, then drop in v70
- [ ] Update `docs/SRP_N8N_INTEGRATION.md` if any contract changes surfaced in smoke test
- [ ] Verify mobile responsive on iPhone-sized viewport
- [ ] Verify "Model returned non-JSON output" error path is GONE

### Phase 5 — Hardening (optional, after Phase 4 ships)
- [ ] Tighten RLS policies from `USING (true)` to per-user / per-account scopes
- [ ] Move admin allowlist from hardcoded → DB (already done in approved_users)
- [ ] Cost telemetry: log token usage per generation to `srp_pipeline.sessions.usage_log` JSONB

## Reference paths (for the port)

| Need | File in tmp-srp-reference |
|---|---|
| Workflow shell | `srp-generator-main/src/pages/Index.tsx` |
| 12 step components | `srp-generator-main/src/components/steps/` |
| WorkflowContext (autosave) | `srp-generator-main/src/contexts/WorkflowContext.tsx` |
| accountContext lib | `srp-generator-main/src/lib/accountContext.ts` |
| Sidebar | `srp-generator-main/src/components/AppSidebar.tsx` |
| Account Info Panel | `srp-generator-main/src/components/AccountInfoPanel.tsx` |
| Approved Panel | `srp-generator-main/src/components/ApprovedContentPanel.tsx` |
| n8n call shapes | `srp-generator-main/supabase/functions/srp-*` |
| Schema migration | `srp-generator-main/supabase/migrations/20260415000000_create_srp_app_schema.sql` (rename `srp_app` → `srp_pipeline`) |
| Step input columns | `srp-generator-main/supabase/migrations/20260522105706_persist_step_inputs.sql` |
| ALL prompt defaults | `sermon-studio-app/supabase/functions/generate-*/index.ts` (DEFAULT_* constants) |
| Tool-call wire shape (OpenAI flavor) | `sermon-studio-app/supabase/functions/generate-caption/index.ts` |

## Risks / open questions

- **`gemini-3-pro-preview` may shift.** Preview models can change schema or get renamed. Mitigation: define the model string in ONE place (`api/srp/_lib/aiGateway.ts` `MODEL_CONTENT`) so a future rename is a 1-line change. If Google releases stable `google/gemini-3-pro`, we bump.
- **Gemini 3 Pro prompt quality vs Gemini 3 Flash via Lovable.** Sermon Studio App's reliability claim was about Gemini 3 Flash *preview* via Lovable's stack. Gemini 3 Pro is theoretically more capable but we're on a different distribution channel. If output quality regresses vs current Lovable behavior, lift the prompts verbatim from Sermon Studio App's DEFAULT_* constants before trying to tune.
- **No web search / vision in our content gen calls** (we're text-only). If a future step wants the model to look at the church's site, switch to a `web_search` capable model (Gemini 2.5 Flash supports it on the Gateway).
- **Vista Social CSV export** in `ApprovedContentPanel` uses placeholder CloudFront URLs in srp-generator-main. We need to either populate real media URLs from clipcutter_jobs or drop the columns.
- **`approved_users` table vs `clickup_users.employee`.** We already have an employee table — don't duplicate the allowlist. At apply time we'll either (a) seed `approved_users` from `clickup_users` or (b) skip `approved_users` entirely and gate on `clickup_users.employee IS NOT NULL`. Decision pending review.
