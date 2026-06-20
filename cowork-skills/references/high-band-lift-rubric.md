# High-band lift rubric — shared reference

Loaded by `plan-cross-page-allocation`, `outline-page`, and
`draft-page` when the project's `copy_approach.derived.intended_verbatim_band`
is `high` (or, per-section, when an entry's `intended_verbatim_band` is
`high`). The full design rationale lives at
`../_design/high-band-lift.md`.

## Core principle

The partner said "Keep most of our current content." Your job is **NOT
to author from scratch**. You're a polisher + UX flow expert. Your
default move is to lift the partner's existing copy verbatim from
their crawled website, then make light, in-spec edits.

**Verbatim measurement** = token-level bag of words. ≥ 70% verbatim
ratio target.

## Crawl atoms — the rubric source

Atoms with `source_kind='crawl'` exist now in `content_atoms`. One
atom per unique source page on the partner's existing site. The
atom's `body` is the **full page markdown**. The atom's `source_ref`
is the page URL.

```
content_atoms row
  source_kind: 'crawl'
  source_ref:  'https://partner.org/sundays'
  body:        <full markdown of /sundays>
  metadata.atom_role:  'page_rubric'
  metadata.page_title: 'Visit on Sundays'
```

This is your rubric, not your background context. **Read it first.**

## Allocation matrix (NOT an orphan pool)

Every section of every crawled source page MUST land somewhere on
the new sitemap — either as primary content on its natural target
page, supporting content elsewhere, or marked
`intentionally_dropped` with a documented rationale.

Allowed dispositions:

- `verbatim_lift` — same-page mapping (old `/home` → new `/home`),
  lifted with minimal polish.
- `same_page_polish` — same destination page, more substantive edit
  (combined sentences, reordered, voice-aligned). Still counts as
  verbatim by bag-of-words.
- `cross_page_lift_with_polish` — source from one old page, lands on
  a different new page. Surface as directive in cowork outline
  preview only when content **conflicts** with strategy.
- `restructured_with_lift` — content reorganized into a new section
  pattern (e.g., turning a paragraph of audience descriptions into
  a 3-card persona grid), retaining most lifted words.
- `intentionally_dropped` — explicit decision NOT to use, with a
  required rationale (e.g., `stale_pandemic_notice`,
  `replaced_by_strategic_persona_messaging`, `duplicate_of_other_page`).

Allocation gate: if the planner leaves source-sections unallocated AND
not-dropped, the planner emits them into a project-level "needs
allocation" bucket with a copy-paste cowork prompt for the strategist
(see `cowork-director` workflow).

## Polish operations allowed at `high` band

In-band (no ratio hit, no strategist sign-off needed):

- Grammar fixes (commas, possessives)
- Pronoun swaps (we → you, you → we) for audience clarity
- Sentence consolidation (3 sentences → 2)
- Reordering sentences within a section
- Replacing weak verbs / "discover" → "find"
- Voice alignment against `voice_and_tone` (skip on voice-locked pages — see below)
- Adding transition sentences
- Reordering sections on a page
- Moving sections to new pages (cross-page lift)
- Adding sections to a page that pull content from elsewhere

When strategy conflicts with lifted copy: **strategy wins**, verbatim
ratio takes the hit on that section, log the override.

## Voice lock — strict no-voice-pass pages

For destination pages whose slug OR title matches the canonical
identity/doctrine pattern set, skip the voice pass entirely. Only
allow grammar / pronoun / consolidation / reorder + adding
transitionary CTAs at the bottom. Their theology stays true.

Canonical pattern (case-insensitive, matched on slug AND title):

```
about | history | who[- ]we[- ]are | beliefs | statement[- ]of[- ]faith |
what[- ]we[- ]believe | our[- ]convictions | denomination | our[- ]story
```

If a destination page matches: stamp `voice_lock: 'strict'` on every
allocation entry routed to it. Outline and draft honor the lock.

## Brixies template selection rules (FPC gold-standard rubric)

Mined from FPC's bound templates — use as the canonical pattern
lookup. Card-shaped layouts are **NOT** capped by `default_count`:
render N items (5 cards on a Feature Section 2 grid, 7 FAQs on an
accordion, etc.) without worrying about template caps for list-style
families.

```
Page archetype       → opener        → middle pattern                          → closer
─────────────────────────────────────────────────────────────────────────────────────────
Homepage             → hero-102      → content-16 → feature-22 → feature-61    → cta-48 → cta-20
                                      → feature-2 (persona/ministry cards)
About / Identity     → hero-41       → content-16 → content-45/99 → faq-10     → cta-48 → cta-20
                                      → feature-2 (key concept cards)
Ministry topic       → hero-41       → content-16 → feature-2 (×N)             → cta-48 → cta-20
                                      → feature-66 (when longer copy per card)
Worship / dense      → hero-41       → feature-2 → content-89 (×N)             → cta-1 or cta-20
Archive (Watch/News) → hero or cta-1 → content-25/16 → category-filter-4       → cta-20
                                      → feature-2 (featured items)
Staff / team         → hero-41       → content-16 → team-14                    → cta-20
Single-* templates   → one-row template only (no opener/closer pattern)
```

### Cards rule clarified

- **Short copy, 3-column grid** (persona cards, ministry tiles, ways
  to give) → `feature-section-2`. Default for short-card layouts.
- **Long copy paired with card** (partner bios, serve opportunities) →
  `feature-section-66`.
- **2-up image-heavy split** (Join Us This Sunday) → `feature-section-22`.

### Caps are advisory for these families

- `feature-section-2` (and any default 3-column card grid)
- `accordion-faq-section-*` (any FAQ)
- multi-tab feature sections

Caps stay **enforced** for:

- Heroes (single-row by design)
- 2-up splits (literal layout cap)
- Single-* templates (post template — exactly one item)

### Word-count tolerance

- Tolerate +2 words over a slot's `max_chars` budget.
- Flag at +100 — picks a different template family.

## Rhythm preservation

"Rhythm" = the order of how a page flows / the user's journey on the
page. Lifting in order naturally preserves rhythm. When restructuring,
preserve the rhythm of:

1. Hero / identity opener
2. Mission or welcome
3. Service details (when applicable)
4. Featured content (ministries, sermons, personas)
5. Invitations / next steps (CTAs)

Don't compress an opener-mission-services flow into a single feature
grid. The rhythm IS the user's mental walk down the page.
