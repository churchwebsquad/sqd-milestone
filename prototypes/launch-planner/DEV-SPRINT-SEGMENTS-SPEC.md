# Dev Sprint Segments — Handoff (v2 phased scheduling + cards)

Focused spec for **one piece**: replacing the flat "X hours into a sprint" model with a **phased per-site flow** and **dated, phase-aware sprint cards**. This is additive to the v1 planner — it changes how the schedule is *computed* and how the sprint timeline is *rendered*. Everything else (queue table, target deltas, help/recovery, tracked time) is unchanged.

**Reference implementation:** `launch-planner-prototype-v2.html` → functions `simulate()` and `renderSprints()`. Port those; this doc explains them.

---

## 1. The idea in one paragraph

A website isn't 60 hours of uninterrupted dev. It's **dev build → partner review pause → final edits + launch**. While a site is out for partner review (a few days where we're *not* working it), the single developer **pivots to the next site's build**, then **circles back** to do the short final pass and launch. The sprint timeline should make that hand-off rhythm legible: for any dated 2-week window you can see who's in build, who's out for review, and who's getting launched.

---

## 2. Phase model (per site)

Each active site decomposes into three segments:

| Segment | What | Consumes dev capacity? | Default size |
|---|---|---|---|
| **Build** | Main development | Yes | `planned_dev_hours − final_hours` |
| **Partner review** | Out with the partner for edits/feedback | **No** — dev pivots away | `review_days` calendar days (default **4**) |
| **Final edits + launch** | Post-review edits + go-live | Yes | `final_hours` (default **7**) |

`build_hours + final_hours = planned_dev_hours`. The review pause is **calendar time**, not dev hours — it delays when the final segment can start but frees the developer to work other sites meanwhile.

**Global settings added by this piece** (alongside the existing `base_weekly_capacity`, `launch_tail_days`, etc.):
- `review_days` — partner review pause, default **4** (the "at least 3–4 days").
- `final_hours` — final edits + launch after review, default **7**.

**In-flight sites** (`status='in_progress'` with `tracked_hours`): apply tracked time to build first, then final, so a nearly-done site skips straight to the final segment:
```
build_left = max(0, build_hours − tracked_hours)
final_left = max(0, final_hours − max(0, tracked_hours − build_hours))
if build_left == 0 and final_left > 0:  start already past review (treat as review-complete)
```

---

## 3. The scheduler — day-level simulation with pivot

The flat allocator can't express the review gap + pivot, so v2 simulates **day by day** at `base_weekly_capacity / 5` dev hours per **weekday** (35/wk → 7/day; weekends and blackout/Christmas weeks = 0). Extra help hours raise that week's daily rate (only when the designer is available — unchanged from v1).

Each site is a small state machine: `building → review → finalizing → done`. The loop:

```
for each weekday d (until all sites done):
    # 1. promote any review that has now elapsed
    for site in 'review' state: if today >= site.review_end: site.ready = true

    cap = daily dev capacity for d        # 0 on weekends / blackout weeks
    while cap > 0:
        # 2. pick the highest-PRIORITY workable segment:
        #    - a build with hours left, OR
        #    - a review-complete final with hours left
        pick = first site (in priority order) that is workable
        if none: break        # dev idle — everything left is still out for review

        work = min(cap, pick.segment_hours_left)
        record allocation(day=d, site=pick, phase, hours=work)
        cap -= work ; pick.segment_hours_left -= work

        if build just finished:
            pick.state = 'review'
            pick.review_start = today ; pick.review_end = today + review_days
        if final just finished:
            pick.state = 'done' ; pick.launch_date = today
```

**Why the pivot falls out automatically:** when site A finishes building it enters review and is *not* workable, so the loop's "highest-priority workable" pick moves to site B's build. The moment A's review elapses, A's final segment outranks B's build (A is higher priority), so it **preempts** the next day and A launches — then B's build resumes. No special-casing.

`launch_date = final-segment completion + launch_tail_days` (tail defaults to 0). `delta`, color bands, and the recovery solver are identical to v1 — the solver just trials help against this `simulate()` instead of the flat allocator.

**Idle note:** near the end of the queue the dev can sit idle if every remaining site is still out for review (nothing left to build). That's truthful. If maximum utilization is preferred instead, allow later sites' builds to start early to fill the gap — flag this as a product decision, don't assume it.

---

## 4. The sprint cards

One card per **2-week window**, rendered from the simulation's day-level allocations + each site's review window.

**Header (the change you asked for):**
- **Title = the date range**, e.g. `Jun 22 – Jul 5` (Georgia serif).
- **Subtext = `Sprint N`** (uppercase, muted) — i.e. the sprint number and the date swapped roles vs v1.

**Body = a time-ordered flow of phase rows** (not just name + hours). For the window, collect:
- **Build** rows — per site, summed build hours allocated in this window: `🟪 {name} · build · {h}h`
- **Partner review** rows — any site whose `[review_start, review_end]` overlaps the window: `🟧 {name} · partner review · out {start}–{end}` (dashed connector; no hours, since dev isn't working it)
- **Final** rows — per site, summed final hours in this window: `🟩 {name} · final edits + launch · {h}h`

Sort the rows by the day they first occur in the window (ties: build → review → final) so the card reads top-to-bottom as the work actually happened. Each row carries the site's consistent color dot.

**Capacity bar + label:** segment the bar by site using **dev hours only** (build + final). Label `{used} dev hrs scheduled / {capacity} hr capacity`. Reviews are deliberately excluded from the bar (they aren't dev work).

**Per-week controls** stay on the card: `base 35 🔒`, a `+ help` hours input, and a `designer out` checkbox (unchanged from v1).

---

## 5. Data model delta (only what this piece adds)

Add to settings: `review_days` (int, default 4), `final_hours` (numeric, default 7). No per-site columns are strictly required — build/final are derived from `planned_dev_hours` and the globals. If you want per-site overrides later, add `review_days_override` / `final_hours_override` to `strategy_web_launch_plan` (nullable; fall back to globals). The simulator output is transient (computed client-side); persist only inputs.

---

## 6. Verified reference output (seed data, start Jun 22 2026, 35 hr/wk, review 4d, final 7h, tail 0)

Build windows, review pauses, and resulting launches — produced by the prototype's `simulate()`:

| Site | Build window | Review (out) | Launch | Δ vs target |
|---|---|---|---|---|
| Mission Viejo | (in-flight, 3h left) | — | Jun 22 | +0 |
| Valley | Jun 22 → Jul 2 | Jul 2 – Jul 6 | Jul 6 | −6 |
| The MET | Jul 2 → Jul 17 | Jul 17 – Jul 21 | Jul 21 | +9 |
| Lakeway | Jul 17 → Jul 29 | Jul 29 – Aug 2 | Aug 3 | +10 |
| Journey | Jul 29 → Aug 11 | Aug 11 – Aug 15 | Aug 17 | +14 |
| Arvada | Aug 11 → Aug 20 | Aug 20 – Aug 24 | Aug 24 | +22 |
| … | … | … | … | … |
| Lakeshore | Oct 30 → Nov 10 | Nov 10 – Nov 14 | Nov 16 | +70 |

**Pivot is visible in the Sprint 1 window (Jun 22 – Jul 5):** builds `Valley 57h, The MET 10h`; final `Mission Viejo 3h`; review `Valley out Jul 2–Jul 6`. Valley builds, goes to review, the dev pivots to The MET's build, then circles back to launch Valley — exactly the intended rhythm. Launches land slightly later than the flat v1 model (last site Nov 16 vs Nov 12) because review pauses and final passes add real calendar time.

---

## 7. Porting checklist

1. Port `simulate(helpMap)` and `renderSprints()` from `launch-planner-prototype-v2.html` into the planner module. `simulate` is pure (no DOM) — keep it that way so the recovery solver can trial against it.
2. Add `review_days` + `final_hours` to settings UI and storage.
3. Swap the sprint timeline component to the dated/phased card layout (§4); leave the queue table, deltas, help, and tracked-time UI as-is.
4. Unit tests: (a) `build_hours + final_hours == planned_dev_hours`; (b) a site's `launch ≥ build_end + review_days`; (c) total dev hours allocated across all days equals the sum of remaining build+final hours; (d) the Sprint 1 fixture above reproduces (Valley 57h build, The MET 10h build, Mission Viejo 3h final, Valley review Jul 2–6).
5. Decide the idle-vs-pull-forward behavior from §3 with the VP of Strategy before locking it.
