# Website Launch Planner — Handoff Bundle

This bundle contains a **working prototype** of a website-launch planning tool and the **build spec** to weave it into the existing `milestone-comms-app` (React + TS + Vite + Tailwind + Supabase).

## Files
- **`launch-planner-prototype.html`** — a self-contained, runnable prototype. Open it in a browser to see the full behavior and interactions. Its `<script>` block is the **reference implementation** of all scheduling/recovery/pace logic — port it, don't reinvent it.
- **`LAUNCH-PLANNER-SPEC.md`** — the build contract: data model, algorithm pseudocode, ClickUp + Supabase integration, UI surface, brand styling, and a file-by-file porting plan. **Read this first.**

## What it does (one paragraph)
Schedules the **development bottleneck** for partner website redesigns. One developer at a **hard 35 dev hrs/week**, back-to-back 2-week sprints, sites in drag-to-reorder priority order. It projects each site's launch date, compares it to the partner's target (color-coded delta), and — for sites running late — either recommends the **minimum extra "help hours"** (a second person, e.g. the designer) to recover the date, or states plainly that the date **stands** (work is developer-only, or the designer is unavailable). It pulls the dev estimate **and actual tracked time** from the ClickUp "Redesign: Build Phase" milestone to show whether each in-flight site is pacing within budget.

## Key model rules (don't violate these)
1. **35 hrs/week is a hard cap** for the one developer — never raise it to mean "the dev works more."
2. **Help hours are a separate, costed line** (a second person). They only apply when the site is `designer`-recoverable AND the designer is available that week; otherwise the projected launch stands.
3. **Schedule only remaining work** — `in_progress` sites consume `estimate − tracked`, not the full estimate.
4. Language is always **"dev / build hours,"** never "total project hours."
5. Respect the project's existing rules in `milestone-comms-app/CLAUDE.md` — especially: **get explicit approval before `CREATE TABLE`**, never modify the existing read-only tables, `strategy_` prefix, public-token client portal pattern, and the brand color system.

## Suggested first steps
1. Read `LAUNCH-PLANNER-SPEC.md` end to end.
2. Open the prototype in a browser; click around (drag rows, edit dev hours/targets, toggle a recovery chip to dev-only, add help hours to a week, mark a week "designer out").
3. Port the pure engine to `src/lib/launchScheduler.ts` with unit tests (assertions listed in spec §6).
4. Confirm the two new `strategy_` tables with the user before applying any migration.
