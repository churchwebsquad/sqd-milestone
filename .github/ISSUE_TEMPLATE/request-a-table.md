---
name: Request a Supabase table
about: Ask Ashley to create a new database table for a feature or tool you're building
title: "[Table request] <table name>"
labels: ["table-request"]
assignees: churchwebsquad
---

<!--
  Directors don't create tables directly — open this so Ashley can review the
  shape, check dependencies (per the org's pre-change audit rule), and create
  it. Adding COLUMNS to an EXISTING table doesn't need this — do that with a
  reviewed /schema/vNN_*.sql migration in a PR.
-->

## Proposed table name
<!-- Must use the `strategy_` prefix per repo convention, e.g. strategy_social_calendar -->


## Squad / tool this is for
- [ ] Brand
- [ ] Social


## Why an existing table won't work
<!-- Could this be columns on an existing table instead? If so, do that instead. -->


## Columns
| Column | Type | Nullable? | Notes / default |
|--------|------|-----------|-----------------|
| id | uuid | no | PK, default gen_random_uuid() |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | default now() |
| is_active | boolean | no | soft-delete flag, default true |
|  |  |  |  |

## Relationships / foreign keys
<!-- Does this reference strategy_account_progress, employees, etc.? -->


## Roughly how many rows, and written by what?
<!-- e.g. "one per partner, written by the SRP tool" -->


## Anything else Ashley should know

