# Website Launch Planner — Build Spec & Handoff

**Purpose:** An administrative planning surface for the Strategy Division's web team. It schedules the **development bottleneck** for partner website redesigns across back-to-back two-week sprints, projects each site's actual launch date, compares it to the target the partner is hoping for, and flags where bringing in additional help would recover a date.

This document is the contract for weaving the prototype (`launch-planner-prototype.html`) into the existing `milestone-comms-app` (React + TypeScript + Vite + Tailwind + Supabase). The prototype's `<script>` block is the reference implementation of every formula below — port it, don't reinvent it.

---

## 1. Core mental model (read this first)

- We schedule **development hours only.** Strategy, copywriting, and design run *alongside* dev and finish faster, so they are never the constraint. **Do not label these hours as "total project hours."** UI copy must consistently say "dev hours," "build hours," or "development effort."
- A standard redesign's **Build Phase** rolls up to ~69h in ClickUp; we plan most sites at **60 dev hours**. That 60 is a planning default, not the whole project.
- Capacity is **one developer at a HARD 35 dev hrs/week** (decided with the VP of Strategy). The developer cannot exceed 35 — it is a ceiling, not a target. A **sprint = 2 weeks = 70 dev hrs**. Sites flow through the pipeline **sequentially in priority order**. The 35-hr cap is *the reason* launches slip; it is never raised by pretending the dev works more.
- A sprint can hold one full site, or be **split** across several (e.g. 45 hrs to one partner + 15 to another) — this falls out naturally from sequential fill, no special logic needed.
- **"Extra help hours" are a separate, costed line — not extra developer throughput.** The only way a week clears more than 35 dev hours is a *second person* (typically the web designer doing edits, image uploads). Help hours are stored, displayed, and summed separately from the locked base so the staffing cost is always visible. Adding help pulls a launch **earlier**; it never delays one.
- **Help has two gating conditions (both must hold):** (a) the recovery work is **offloadable** — the site is flagged `designer`-recoverable, not `dev-only`; and (b) the **designer is available** that week (not marked "designer out"). If either fails, help cannot be applied and **the projected launch stands** — the tool says so explicitly rather than inventing capacity.
- **The scheduler plans only the work that's LEFT.** A site's `status` is `queued` | `in_progress` | `launched`. For an `in_progress` site the pipeline consumes `planned_dev_hours − tracked_hours` (remaining), not the full estimate — so a site that's nearly done barely occupies the queue and everything below it moves up. `launched` sites are excluded entirely. See `remainingHours()`.
- **Launch tail defaults to 0** (launch = dev-complete date). It's still an editable setting if a partner's launch needs a buffer after dev finishes.
- This is an **admin panel, not a notice board.** Every value (priority order, dev hours, target date, start date, launch tail, per-week help hours, designer availability, recovery mode, status/tracked) is editable and recalculates live.

---

## 2. Data model

### 2.1 New table: `strategy_web_launch_plan`
Per the project rule on net-new tables: this data does not fit cleanly into the existing read-only tables. `strategy_account_progress` is keyed on `member` and owned by other workflows; we should **not** write planning fields into it. A dedicated planning table keeps the planner's mutable state (priority, planned dev hours, target date, overrides) isolated and writable.

> **Approval still required before `CREATE TABLE`.** Alternative considered: add `web_priority`, `web_target_launch`, `web_planned_dev_hours` columns to `strategy_account_progress`. Trade-off — that table is READ-ONLY by project rule and shared across squads, so writing planner state there violates the existing constraint and risks collisions. Recommend the new table below; confirm before applying.

```sql
create table strategy_web_launch_plan (
  id            uuid primary key default gen_random_uuid(),
  member        integer not null,              -- FK-ish link to strategy_account_progress.member
  priority      integer not null,              -- 1 = top of queue; drag-drop reorders this
  planned_dev_hours numeric not null default 60,-- estimate (rolled-up Build Phase estimate)
  tracked_hours numeric not null default 0,     -- actual logged time on Build Phase (from ClickUp)
  pct_complete  numeric,                        -- 0..1, optional; drives burn projection while in flight
  status        text not null default 'queued', -- 'queued' | 'in_progress' | 'launched'
  recovery_mode text not null default 'designer',-- 'designer' (offloadable) | 'dev-only' (cannot offload)
  target_launch date,                          -- the date the partner is hoping for
  hard_deadline date,                          -- optional immovable date (🚩)
  launched_on   date,
  notes         text,
  clickup_build_task_id text,                  -- the "Redesign: Build Phase" milestone task id
  dev_hours_source text not null default 'manual', -- 'manual' | 'clickup'
  last_synced_at timestamptz,
  is_active     boolean not null default true, -- soft delete
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### 2.2 New table: `strategy_web_week_adjustments`
One row per calendar week that has been adjusted. Keyed to a real `week_start` date so adjustments survive start-date changes (the prototype keys by week *index* for simplicity; production keys by date). Holds the **extra help hours** and the **designer-out** flag — the base 35 is never stored here because it is locked.

```sql
create table strategy_web_week_adjustments (
  id            uuid primary key default gen_random_uuid(),
  week_start    date not null unique,          -- Monday of the affected week
  help_hours    numeric not null default 0,    -- extra designer/second-person hours ON TOP of base 35
  designer_out  boolean not null default false,-- if true, help_hours is ignored (no one to offload to)
  is_blackout   boolean not null default false,-- 0 dev capacity (e.g. Christmas break)
  reason        text,                          -- 'designer edits + image upload', 'Christmas break'
  created_at    timestamptz not null default now()
);
```

### 2.3 Global settings (single row, or app config)
`schedule_start` (date), `base_weekly_capacity` (default 35, the developer's **hard cap**), `sprint_weeks` (default 2), `launch_tail_days` (**default 0** — launch = dev-complete; raise only if a partner needs post-dev buffer), `max_help_per_week` (default 35 — a designer can contribute at most about one extra person's week). Store in a `strategy_web_plan_settings` row or in existing app settings.

---

## 3. The scheduling algorithm

All date math uses **UTC** to avoid timezone drift. Reference implementation: the prototype functions `schedule()`, `capacityOf()`, `computeHelp()`.

### 3.1 Weekly effective capacity
The base is **locked at 35** (the developer's hard cap). Extra help hours stack on top, but only when a designer is available that week:
```
weekStart(i)   = Monday(schedule_start) + i*7 days
help(i)        = 0                         if designer_out(i)         // no one to offload to
               = help_hours(i)             otherwise                  // extra second-person hours
effCap(i)      = 0                         if weekStart(i) is a blackout / Christmas break
               = base_weekly_capacity + help(i)   otherwise           // 35 (locked) + help
```
The reference implementation is `effCap(i, helpMap)` in the prototype. The scheduler is otherwise unchanged from §3.2 — it just reads `effCap` instead of a single capacity.

### 3.2 Sequential sprint allocator
Walk active (non-launched) sites in **priority order**, consuming a running pool of weekly capacity. This is the whole engine:

```
weekIndex = 0;  remaining = effCap(0)
for each site in priority order:               // launched sites already excluded
    need = remainingHours(site)                // planned_dev_hours, or estimate − tracked if in_progress
    advance weekIndex while remaining <= 0   (skips blackout/zero weeks)
    site.startWeek = weekIndex
    while need > 0:
        if remaining <= 0: weekIndex++; remaining = capacityOf(weekIndex); continue
        use = min(need, remaining)
        site.alloc[weekIndex] += use
        need -= use;  remaining -= use
    site.endWeek = weekIndex
```

Because each site picks up exactly where the previous one left off, **sprint splitting is automatic**: if a site only needs 45 of a sprint's 70 hrs, the next site consumes the remaining 25 in the same sprint.

### 3.3 Dev-complete date → actual launch date
The site finishes partway through `endWeek`. Convert hours-consumed-in-that-week into a business-day offset:

```
cap          = capacityOf(endWeek)
consumed     = cap - remaining                 # hrs used in the final week at completion
bizDaysInto  = ceil( (consumed / cap) * 5 )    # 5 working days per week
devCompleteDate = addBusinessDays(weekStart(endWeek), bizDaysInto)
actualLaunchDate = devCompleteDate + launch_tail_days   # calendar days (pre-launch, launch, QA)
```

### 3.4 Target delta (the headline number)
```
delta_days = actualLaunchDate − target_launch     # calendar days
  delta >  7  → GREEN  ("+Nd", comfortable slack)
  0 ≤ delta ≤ 7 → AMBER ("+Nd", tight)
  delta <  0  → RED    ("−Nd", projected to miss target)
```
If `hard_deadline` is set and `actualLaunchDate > hard_deadline`, escalate to a hard-flag regardless of the soft target.

### 3.5 Recovery solver — minimum help hours, with two outcomes
For every site projected to miss target (`delta < 0`), run `solveHelp(siteId, baseResult)`. It does **not** use the old analytical shortfall — it incrementally adds help to eligible weeks and re-runs the scheduler until the site either lands on target or runs out of room. This naturally respects designer availability, the dev-only gate, and the pipeline ripple.

```
if recovery_mode == 'dev-only':
    return LOCKED(reason='dev-only')                 // can't offload — date stands
eligibleWeeks = weeks 0..baseResult.endWeek that are NOT blackout AND NOT designer_out
if eligibleWeeks is empty:
    return LOCKED(reason='designer-out')             // no available week to add help — date stands
trial = copy(help_hours)
added = 0
while added < eligibleWeeks.length * max_help_per_week:
    w = eligible week with the least help so far (and < max_help_per_week)
    trial[w] += 1 ;  added += 1
    r = computeSchedule(trial)[siteId]               // re-run whole pipeline
    if r.delta >= 0:
        return RECOVERABLE(help_hours=added, perWeek=diff(trial, help_hours), newDate=r.launchDate)
return INSUFFICIENT(help_hours=added, bestDate=last r.launchDate, stillLate=−r.delta)
```

**Three outcomes drive the UI:**
- **RECOVERABLE** → *"{site} is ~{behind}d behind. Recoverable: add {help_hours} help hrs (designer, ≈{help_hours/7} days) in wk {…} → launches {newDate}, within target."* + **Apply help** button.
- **LOCKED** (`dev-only` or `designer-out`) → *"Work is developer-only — can't offload"* / *"Designer unavailable in the weeks that feed this site."* + *"…projected launch {date} stands. Renegotiate the target, reprioritize, or add a second developer."* For `dev-only`, offer a **Mark designer-eligible** toggle.
- **INSUFFICIENT** → even max designer help can't reach the target (typically the target predates current capacity, e.g. a date essentially in the past). Reports the best achievable date and how many days still late; offers **Apply best-effort help**.

**Apply help** writes the solver's `perWeek` deltas into `help_hours` and re-runs. Because help is added to upstream weeks, sites *below* the recovered one also move earlier — this is correct (the pipeline genuinely clears faster) and the UI shows their new dates. Always check `max_help_per_week` so a single week never implies more than one extra full-time person without explicit intent.

### 3.6 Tracked-time pace (are we on pace toward target?)
Each in-flight site carries `tracked_hours` (actual logged time on the Build Phase) and optional `pct_complete`. The burn projection:
```
if status == 'in_progress' and tracked_hours > 0:
    projected_total = pct_complete > 0 ? round(tracked_hours / pct_complete) : planned_dev_hours
    over            = projected_total − planned_dev_hours
    pace = 'good'  if over < −1      // tracking under estimate
         | 'tight' if −1 ≤ over ≤ 3  // on estimate
         | 'late'  if over > 3       // burning over — launch at risk
```
Display as a progress bar plus *"{pct}% done · {tracked}/{est}h · {+N over | −N under} est."* A `late` pace is the early-warning signal that the projected launch (and any target margin) is eroding even before the schedule itself shifts. `reference: paceOf()` in the prototype.

---

## 4. ClickUp integration contract

**Goal:** dev hours should be "legitimate" — sourced from tasks we've actually scheduled, not guessed.

- **Source of truth per site:** the partner's **`Redesign: Build Phase`** milestone task (parent `Website Redesign`, id pattern like `86e1zmbgz`). Two values come from it:
  - **Rolled-up time estimate → `planned_dev_hours`** (the ~60–69h dev figure).
  - **Summed time entries → `tracked_hours`** (actual logged time across the Build Phase subtasks) — this is what makes the dev hours "legitimate" and powers the §3.6 pace read.
- **Sync action (`Sync dev hours + tracked time`):** for each active site with a `clickup_build_task_id`, fetch the Build Phase milestone with its subtasks; write the rolled-up estimate to `planned_dev_hours`, sum the time entries into `tracked_hours`, set `dev_hours_source = 'clickup'`, stamp `last_synced_at`. Show a green **● ClickUp** badge when synced, a muted **○ manual** badge once a value is hand-edited.
- **Editing dev hours by hand** flips the row back to `dev_hours_source = 'manual'` and drops the badge (prototype does this on the `hours` input change).
- **Available MCP/endpoints** (already connected in this workspace):
  - `clickup_get_task` (with `subtasks`/`include_subtasks`) to roll up the estimate.
  - `clickup_get_time_entries` (filter to the Build Phase task + its subtasks, by date range) to sum **tracked** time. Optionally `clickup_get_bulk_tasks_time_in_status` for status context.
  - `clickup_filter_tasks` / `clickup_get_workspace_hierarchy` to discover Build Phase task ids per partner list. Map partner `member` → ClickUp list/folder via the existing `clickup_chat_channels` / workspace hierarchy.
  - Both estimates and time entries come back in **milliseconds** — divide by `3,600,000` for hours.
- `pct_complete` can be approximated as `tracked_hours / planned_dev_hours` if ClickUp has no explicit progress field, or pulled from a custom field / status mapping if one exists.
- Keep the actual fetch behind an Edge Function or `/api` route (org rule: API calls live in their own routes); the planner UI calls that route, never ClickUp directly from the client.

---

## 5. UI surface (matches prototype)

1. **Global controls bar** — schedule start, **developer rate (35, shown 🔒 locked hard cap)**, launch tail days, *Sync dev hours + tracked time*, *Add partner site*.
2. **Stat cards** — active sites; dev hrs queued (+ weeks at the hard 35/wk); **extra help scheduled (hrs ≈ designer-days)**; # behind target with a "(N recoverable w/ help)" sub-line, red when > 0.
3. **Build queue table** — drag-to-reorder priority; inline-editable dev hours and target date; columns for projected launch, Δ vs target (color pill), **Tracked vs est. (progress bar + pace badge)**, sprint span, remove. Each row carries a clickable **recovery-mode chip** (🎨 designer-recoverable ↔ 🔒 developer-only) and ClickUp/hard-deadline badges. Behind-target rows are tinted and followed by an inline recovery row that is *amber w/ **Apply help*** when recoverable, or *gray "date stands"* when locked/insufficient.
4. **Sprint timeline** — one card per 2-week sprint: capacity bar segmented by site, hours scheduled vs effective capacity, allocation chips (shows the 45/15-style splits). Each week shows the **locked `base 35 🔒`** alongside a separate **`+ help` hours input** and a **`designer out` checkbox** that disables/zeros that week's help. Blackout sprints (e.g. Christmas) render hatched with zero capacity.
5. **Recovery summary callout** — splits sites into *recoverable with help* (with total designer hrs/days) vs *can't be recovered with help* (with the reason per site: dev-only, designer out, or capacity).

### Brand styling (from `milestone-comms-app/CLAUDE.md`)
Primary Purple `#513DE5`, Deep Plum `#341756` (text/sidebar/primary buttons), Lavender `#CFC9F8` (borders), Lavender Tint `#EDE9FC` (selected/callout), Cream `#F9F5F1` (page bg — not white), White (cards). Pill buttons (`border-radius:999px`), Georgia serif headlines with italic accent words, Inter for UI, uppercase purple eyebrow labels. Never pure black, never raw gray. Dark hero gradient `135deg, #341756 → #513DE5` for the header. The prototype already encodes all of this in its `<style>` block — lift the tokens into the app's Tailwind config.

---

## 6. Porting notes for Claude Code

- Lift `computeSchedule(helpMap)`, `effCap()`, `remainingHours()`, `solveHelp()`, `paceOf()`, and the date helpers (`parseD`, `addCal`, `mondayOf`, `addBiz`, `calBtw`) verbatim into a pure module, e.g. `src/lib/launchScheduler.ts`. They have **no DOM or framework dependencies** — keep them framework-free and unit-test them. Note `computeSchedule` is pure (takes a help map, mutates nothing) specifically so `solveHelp` can trial allocations against it.
- Suggested structure within the existing app:
  - `src/lib/launchScheduler.ts` — the engine (port of the prototype script).
  - `src/lib/clickupBuildPhase.ts` — sync helper hitting the `/api` route.
  - `src/hooks/useLaunchPlan.ts` — load/save plan + overrides from Supabase, expose `schedule()` output.
  - `src/pages/LaunchPlanner.tsx` — the admin page (a new app surface alongside the existing 7).
  - `src/components/launch/*` — `QueueTable`, `SprintTimeline`, `HelpCallout`, `StatCards`.
- Replace the in-memory `STATE` with Supabase reads/writes; debounce writes on drag-reorder and inline edits. Persist `priority` on drop; `planned_dev_hours`/`target_launch`/`recovery_mode` on change; week `help_hours`/`designer_out` on change.
- Key week adjustments (`help_hours`, `designer_out`, `is_blackout`) by `week_start` **date** (not index) so they survive start-date changes — the main deviation from the prototype.
- `tracked_hours`/`pct_complete` are read-only from ClickUp sync — don't expose them as editable.
- **Verification:** add unit tests asserting (a) per-week allocation never exceeds `capacityOf(i)`, (b) the queue is contiguous (total scheduled hrs = sum of dev hours), (c) a known fixture reproduces the prototype's deltas. The headless check that validated this prototype is reproduced in §7.

---

## 7. Validated reference output (seed data, start Jun 22 2026, hard 35 hrs/wk, 0-day tail)

Mission Viejo is `in_progress` with 55h tracked → only **3h remaining** scheduled; all others are queued at full estimate. Mosaic #1802 is `launched` and excluded.

| Site | Sched hrs | Sprint span | Projected launch | Target | Δ |
|---|---|---|---|---|---|
| Mission Viejo | 3 (of 58) | S1 | Jun 23 | Jun 22 | **−1d** |
| Valley Church | 64 | S1 | Jul 6 | Jun 30 | **−6d** |
| The MET | 75 | S1–S3 | Jul 21 | Jul 30 | +9d |
| Lakeway | 57 | S3 | Jul 31 | Aug 13 | +13d (hard Aug 16 ✓) |
| Journey | 64 | S3–S4 | Aug 13 | Aug 31 | +18d |
| Arvada Vineyard | 50 | S4–S5 | Aug 24 | Sep 15 | +22d |
| Real Life Palouse | 52 | S5–S6 | Sep 3 | Sep 29 | +26d |
| Awaken LV | 50 | S6 | Sep 14 | Oct 13 | +29d |
| Canyon Del Oro | 52 | S6–S7 | Sep 23 | Oct 27 | +34d |
| First Pres Charlotte | 51 | S7–S8 | Oct 2 | Nov 10 | +39d |
| Triumph Lutheran | 50 | S8–S9 | Oct 14 | Dec 1 | +48d |
| The Axis | 50 | S9 | Oct 23 | Dec 15 | +53d |
| Evangel | 50 | S9–S10 | Nov 3 | Jan 11 | +69d |
| Lakeshore | 50 | S10–S11 | Nov 12 | Jan 25 | +74d |

Total scheduled: **718 hrs** (= 773 estimate − 55 already tracked on Mission Viejo). Per-week sums never exceed 35. **Headline insight:** with a 0-day tail and remaining-aware scheduling, only the two nearest dates (Mission Viejo −1d, Valley −6d) are behind — both `designer`-recoverable. Lakeway clears its hard Aug 16 deadline by two weeks. This is the realistic recovery picture the planner exists to surface.
