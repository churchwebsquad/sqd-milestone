# Build-time errors

**Standing location.** When the user says "report on build time errors
and fix," start here. Surfaces issues that block correctness or
correct downstream behaviour but that a non-developer strategist
can't action on their own — so the next dev/agent session catches +
fixes them proactively.

Distinct from runtime warnings (Slack notifies, console errors,
PostgreSQL advisors). This file holds **architectural / process-level
issues** that need code or library changes, named explicitly so the
strategist isn't expected to find them in logs.

## Conventions

- One H2 section per issue.
- **Status: open** or **Status: closed (commit hash)** at the top of each.
- Triage: surface what's broken, why it's a build-time issue (not a
  runtime warning), what unblocks it.
- A non-developer strategist should be able to read the file and
  understand the *impact*, even if they can't action the fix.

## Workflow

1. Whenever code identifies a structural issue (e.g. Brixies library
   missing a covering template for a diagnosed schema), append a
   new H2 section here.
2. When fixed, change status to closed + commit ref. Don't delete —
   the history is useful when similar issues recur.
3. New chat sessions read this file to know what's outstanding.

## Open items

### Brixies display-template coverage gap (cross-product of schemas × display patterns)
**Status:** open
**Filed:** 2026-06-27
**Audit source:** [handoffs/inventory-schema-audit.md](inventory-schema-audit.md)

Important framing — **schema is not the same as template**:

- **Schema** is the CSV-like table of fields we LOG per concept. We
  capture everything the partner has, regardless of which template
  ends up rendering it.
- **Template** is the Brixies layout that visualizes some SUBSET of
  the schema. A staff card might render 4 of 9 fields; the detail
  page might render all 9.

We don't need a Brixies slot for every schema field to be worth
capturing in the schema. The audit doc's per-concept schemas are
about INVENTORY capture; this build-time error is about DISPLAY
coverage.

**Display patterns the library needs to cover** (paired with the
schemas that feed them — see [inventory-schema-audit.md](inventory-schema-audit.md)):

| Display pattern | Fed by which schemas |
|---|---|
| Person card (rich) — name + role + headshot + mailto + optional bio + phone + linkedin | Leadership · Care · Counseling · Music ministry team · College/Adult/Student/Kids ministry leads |
| Person detail page — all schema fields | Leadership · Care · Counseling (when CTA target = additional_page) |
| Sermon card / archive grid | Sermons (CTA target = YouTube OR additional_page OR file_download depending on partner) |
| Sermon detail page | Sermons (when CTA target = additional_page) |
| Event card | Events · Camps · Retreats (CTA target = Church Center · register form · additional_page) |
| Event embed (Church Center / Planning Center) | Events when CTA target = external_url |
| FAQ accordion | Beliefs · Statement of Faith · Baptism · Kids FAQs · New Here · Plan a Visit FAQ |
| Ministry-program card | Kids · Students · Youth · Adults · College · Care · Worship/Music ministries |
| Volunteer / Outreach card | Serve · Missions · Outreach |
| Group card (with filters: day · audience · campus) | Connect / Groups |
| Blog post card / archive | Blog / News |
| Service-info block | Sundays / Services |
| Way-to-give card | Giving |
| Career card / job board | Careers / Jobs |
| Newsletter / bulletin link list | Newsletter archive |
| Testimony card | Testimonies |
| Sequential pathway / numbered cards | Discipleship pathway / Next Steps |
| Multi-site location card | Multi-campus locations |

Each pattern needs to handle the relevant **CTA target type** —
file download (renders as a download button), additional_page
(renders as "Read more"), external_url (renders as external-link
icon), mailto (renders as mailto icon), etc.

**Confirmed library gap (the 3672 Pastors symptom):**

`feature-section-2` is currently used to bind staff sections on
3672 — carries only `heading_card` + `description_card` per item.
Drops the 7 other staff schema fields the inventory captured.
Schema is fine; display layer is lossy.

Either:
- Pick a richer template at binding time (one that covers more of
  the staff schema), or
- Add a new template that carries the full staff schema.

The binder must always pick or build a template that **carries every
field the strategist wants displayed**. Fields not displayed are
still in the schema for the dev handoff + content-import sidecar.

**What unblocks this:** squad inventories the existing Brixies
library against the display patterns above. For each gap, either
extends an existing template (add slots) or builds a new one. Binder
logic prefers richer templates when the schema has richer data.

**Strategist impact:** until the display library covers every
pattern × CTA target combo above, partner content gets visually
compressed at binding. Inventory still has the data. Dev handoff
still surfaces it. But the rendered Brixies layout doesn't show
everything that's available.

## Diagnostic-surfaced library coverage gaps

**Last rolled up:** 2026-06-27 (run `npx tsx scripts/audit-library-gaps.ts` to refresh)
**Partners audited:** 6
**Total discovery sections:** 242
**Classified to canonical schema:** 153
**Library coverage gaps (template):** 0
**Upstream compression losses (cowork):** 337

### Upstream compression losses (cowork → bound)

Fields present in `web_project_topics.items` source but absent from every bound section of the same schema. The loss happens at cowork's 5-slot uniform shape, BEFORE template binding. Unblocking these requires expanding cowork's per-concept output shape — separate from library coverage work.

#### `feature_card` losing [`cta_label`, `cta_url`]
- 153 bound sections across 4 partners
- Severity: 0 high, 153 medium, 0 low
- Partners affected: Real Life Church (3061), First Presbyterian Church of Charlotte (3249), Arvada Vineyard (3734), null (99005)

#### `person_card` losing [`headshot`, `role`]
- 77 bound sections across 3 partners
- Severity: 77 high, 0 medium, 0 low
- Partners affected: Real Life Church (3061), First Presbyterian Church of Charlotte (3249), Arvada Vineyard (3734)

#### `person_card` losing [`bio`, `email`, `headshot`, `ministry_area`, `role`]
- 52 bound sections across 1 partner
- Severity: 52 high, 0 medium, 0 low
- Partners affected: First Presbyterian Church of Charlotte (3249)

#### `person_card` losing [`bio`, `headshot`, `role`]
- 52 bound sections across 1 partner
- Severity: 52 high, 0 medium, 0 low
- Partners affected: First Presbyterian Church of Charlotte (3249)

#### `blog_post_card` losing [`body`, `date`]
- 1 bound section across 1 partner
- Severity: 1 high, 0 medium, 0 low
- Partners affected: First Presbyterian Church of Charlotte (3249)

#### `blog_post_card` losing [`author`, `body`, `category`, `date`]
- 1 bound section across 1 partner
- Severity: 1 high, 0 medium, 0 low
- Partners affected: First Presbyterian Church of Charlotte (3249)

#### `blog_post_card` losing [`author`, `date`, `excerpt`, `url`]
- 1 bound section across 1 partner
- Severity: 1 high, 0 medium, 0 low
- Partners affected: First Presbyterian Church of Charlotte (3249)

