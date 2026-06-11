# Web Copywriter Suite

Three-component plugin for Church Media Squad's autonomous website copywriting pipeline. Each component does one job.

## Why three components

The original monolithic page-drafter tried to be a senior copywriter AND a Brixies field-mapper AND a mechanical scanner AND an audit reporter, all in one model invocation. Compliance overhead polluted the creative context. Sonnet 4.6's diagnosis after the first test run identified this as the structural problem.

This plugin separates the jobs:

| Component | Role | Model |
|---|---|---|
| `web-page-copywriter` (skill) | Pure creative writing — outputs prose with structural markers | Sonnet 4.6 |
| `/format-page` (command) | Deterministic prose → Brixies JSON mapping | Sonnet 4.6 (tight instructions) |
| `web-page-reviewer` (skill) | Fresh-eyes compliance audit — outputs verdict | Haiku 4.5 |

## Flow

```
BRIEF → [web-page-copywriter] → PROSE → [/format-page] → BRIXIES JSON → [web-page-reviewer] → VERDICT
```

1. User pastes a complete brief (voice card, section_jobs, atoms, facts, cross-cutting patterns).
2. `web-page-copywriter` skill triggers, produces prose per section with structural markers (`HEADING:`, `TAGLINE:`, `DESCRIPTION:`, `CARDS:`, `STEPS:`, `CTA:`, `ALTERNATIVES:`, `VOICE NOTES:`).
3. User invokes `/format-page` (and provides bound Brixies template schemas). The command maps prose to `field_values` JSON, applies `max_chars`, logs any kickbacks.
4. User invokes `web-page-reviewer` skill, providing the formatted JSON + voice card. Reviewer runs character-level mechanical scan + positive checks, outputs verdict object with `confidence_band` (green/yellow/red).
5. Red verdicts route back to the copywriter with specific kickbacks; green pages move to Gate 4 in the broader pipeline.

## Component details

### web-page-copywriter

**Trigger phrases:** "draft the kids page", "write copy for /visit", "run the copywriter on [church name]", "draft Phase 1 pages for [church]", "draft the homepage for Riverwood".

**Reads:** `references/cms-persuasive-patterns.md`, `references/brief-format.md`.

**Outputs:** prose only — no JSON, no Brixies slot names, no mechanical scan. Maximum creative freedom.

### /format-page

**Trigger:** Type `/format-page` after the copywriter has produced prose.

**Inputs:** copywriter's prose output + bound Brixies template schemas (provided by user).

**Outputs:** strict JSON with `field_values` keyed by Brixies slot names, `mechanical_scan_log` for any in-place fixes, `kickbacks_to_copywriter` for structural issues.

### web-page-reviewer

**Trigger phrases:** "review the page", "audit the copy", "check the draft", "run the reviewer on this output".

**Reads:** `references/audit-criteria.md`.

**Outputs:** verdict object with negative_checks (12 mechanical scans), positive_checks (10 persuasive intent checks), voice_match_assessment, section_by_section_notes, recommended_action, kickbacks_to_copywriter.

## Installation

Accept the `.plugin` file in the Cowork install prompt, or save to your plugins directory.

## Version

0.1.0 — initial release for Riverwood Chapel pressure testing.
