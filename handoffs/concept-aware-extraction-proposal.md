# Concept-aware extraction — round 5

## Audit results — read these first

A read-only audit across 3 partners' inventory (Doxology, First Pres,
Arvada — 99 topics, mostly repeating-content) is now baked into the
proposal. Two documents to read alongside this:

1. **[handoffs/inventory-schema-audit.md](inventory-schema-audit.md)** —
   per-topic canonical schemas observed in real partner data. Establishes
   the 13 template patterns Brixies needs.
2. **[handoffs/build-time-errors.md](build-time-errors.md)** — standing
   location for build-time-error items. The 13-template gap + the 3672
   lossy-binding case are filed here as actionable items the squad
   addresses before the diagnostic pipeline can ship without loss.

Key audit findings (drives the architecture):

- The inventory layer (`web_project_topics.items`) ALREADY contains
  rich schemas — staff with bio + email + phone + photo, sermons with
  video_url + notes_url, events with date + location + register_url.
  The data exists. The loss is downstream.
- Cowork's 5-slot uniform shape AND narrow Brixies templates BOTH
  drop the rich data on the way to bound sections. The fix is at
  both layers, but the inventory layer is correct and is the right
  source-of-truth for the diagnostic pipeline.
- Diagnostic pipeline reads inventory directly, not the lossy
  intermediates.

---

# Concept-aware extraction — round 4 (timing + no-mismatch-tolerance)

(All prior content preserved below for history.)


## What round 3 still got wrong (pump-the-brakes audit)

Two related failures of stance:

1. **"Flag mismatches at bind time"** — implied that lossy template
   bindings are an acceptable runtime state, just one we surface
   nicely. They're not. If `feature-section-2` can't carry email
   for a staff section, we don't flag it; we don't pick it.

2. **"Brixies template too narrow → flag drop"** — assumed the
   Brixies library is a fixed constraint we work around. Wrong
   stance. The squad built the Brixies library. We chose the
   templates. We control the slots. **If no available template can
   hold the diagnosed schema, the library has a gap and we expand
   it — we don't lose data to accommodate the gap.**

In other words: **lossy bindings are a build-time problem to solve,
never a runtime gap to surface.**

## Where data loss is actually allowed (and where it isn't)

There's a useful distinction the previous drafts blurred:

- **Intake gaps** (cowork didn't capture a field from the source) —
  CAN exist. The partner may genuinely not have a bio for a staff
  member. The handoff shows: "0 of 4 records have bio — confirm
  with strategist if this is intentional or if the source had bios
  cowork missed."

- **Translation gaps** (cowork captured a field but the Brixies
  template can't hold it) — **CANNOT exist.** If cowork captured
  email + bio + role + name, the bound template must hold all four.
  Picking a narrower template is a bug in template selection, not
  a tolerable state.

## Corrected pipeline

```
┌────────────────────────────────────────────────────────────────┐
│ 1. Crawl + content collection intake                           │
│    - Pulls partner's current site + uploaded files             │
│    - LLM extracts items into a richer-than-5-slot shape        │
│      (separate workstream: expand cowork's uniform shape)      │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. CONTENT DIAGNOSIS (persisted)                               │
│    Four universal questions per section:                       │
│                                                                │
│    - Is this a set of repeating schema items? (auto)           │
│    - What's the schema? (walk items, record fields + fill rates)│
│    - What's the click target? (CtaKind from observed CTAs)     │
│    - What format is this content currently in?                 │
│        (from crawl of partner's site; null when net-new)       │
│                                                                │
│    Output: structured per-section diagnosis blob.              │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. Brixies template selection (must guarantee fit)             │
│    - Reads the diagnosis                                       │
│    - Picks a template from the library whose slots cover       │
│      EVERY field in the diagnosed schema                       │
│    - If no template covers the schema → loud build-time error  │
│      "Library gap: schema {name, role, bio, email} has no fit. │
│       Add a template with these slots before continuing."      │
│      The squad expands the library; the runtime never tolerates│
│      a partial fit.                                            │
└─────────────────────────────┬──────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. Formation plan / dev handoff                                │
│    - Reads from the DIAGNOSIS as source of truth               │
│    - Surfaces INTAKE gaps only (missing fields from source)    │
│    - Never surfaces "translation gaps" — they can't exist in   │
│      a well-built library                                      │
└────────────────────────────────────────────────────────────────┘
```

## Implications

### 3.1. The Brixies library probably needs expansion

For 3672 Pastors, cowork captured emails via `item_cta` but the
bound template (`feature-section-2`) drops them. That's not a
formatting bug — it's a library gap. The squad should:

- Audit the team-shaped Brixies templates for slot coverage
- Confirm at least one variant carries name + role + bio + email
  per card (the canonical staff fields)
- Same audit for events (title + date + time + location + image +
  registration_url + ministry_tag), sermons (title + series +
  speaker + scripture + video_url + audio_url + podcast_url),
  groups, faqs, etc.

This audit is **prerequisite** to the diagnostic pipeline shipping.
The diagnostic only works when the library has variety to draw on.

### 3.2. Existing partners with narrow-template bindings need rebinding

For 3672 Pastors, the existing binding to `feature-section-2` is
already lossy. The fix:

- Re-diagnose (or load existing diagnosis once we compute it)
- Identify the schema: name, role, email (bio missing from source,
  reported as intake gap)
- Pick a different template from the library that holds name + role
  + email per card
- Rebind, re-translate

Rebinding has its own UX implications (does the strategist see this
happen? Is there an "auto-rebind on diagnosis change" step?). Open
question.

### 3.3. Cowork's 5-slot uniform shape becomes the binding constraint

Today cowork's uniform items array has 5 slots: `item_heading +
item_body + item_meta + item_cta_label + item_cta_url`. Even when
the diagnostic wants 7 fields per record (name + role + bio + email
+ headshot + linkedin + ministry_area for staff), cowork has nowhere
to put fields 6 and 7.

Fixing this is **prerequisite** to the diagnostic capturing more
than 5 fields. Either:

- Replace the uniform 5-slot with a flexible per-concept shape
  (matches diagnostic schema 1:1)
- Or layer richer fields onto a sibling structure that cowork
  populates alongside the existing uniform array

Both require LLM prompt rewrites in `cowork-skills/`. Big work.

## Storage

A new JSONB column on `web_sections`:

```sql
ALTER TABLE web_sections ADD COLUMN content_diagnosis jsonb;
```

Shape (no `dropped_in_translation` — that gap class doesn't exist):

```json
{
  "schema_version": 1,
  "diagnosed_at": "2026-06-27T...",
  "is_repeating": true,
  "item_count": 4,
  "format_type": "card",
  "schema_fields": [
    { "key": "name",  "fill_count": 4, "fill_total": 4, "fill_rate": 1.00, "value_type": "text" },
    { "key": "role",  "fill_count": 4, "fill_total": 4, "fill_rate": 1.00, "value_type": "text" },
    { "key": "email", "fill_count": 3, "fill_total": 4, "fill_rate": 0.75, "value_type": "mailto" },
    { "key": "bio",   "fill_count": 0, "fill_total": 4, "fill_rate": 0.00, "value_type": "richtext" }
  ],
  "click_target": "mailto",
  "click_target_breakdown": { "mailto": 3, "no_link": 1 },
  "intake_gaps": {
    "missing_per_field": { "bio": 4 }
  }
}
```

## Order of work — sequencing matters now

This is no longer "ship the formation plan reader and the rest is
follow-up." Several prerequisites need to be true before the
diagnostic pipeline produces correct output:

1. **Library audit** — confirm Brixies templates have slot coverage
   for canonical schemas (staff/events/sermons/groups/faqs/etc.).
   List gaps; squad adds templates or expands existing ones.

2. **Cowork uniform-shape expansion** — replace the 5-slot fixed
   shape with something that can hold whatever the diagnostic
   surfaces. Cowork prompt rewrites in `cowork-skills/`.

3. **Diagnostic computation** — pure TS function reading cowork's
   expanded shape + crawl provenance, returns ContentDiagnosis.

4. **Storage + persistence** — `content_diagnosis` JSONB column,
   computed at extraction time, never recomputed at render.

5. **Template selection** — at binding time, picks a template that
   FITS the schema. Errors loudly on no-fit (library expansion
   trigger).

6. **Existing-partner rebinding pass** — script that re-diagnoses
   each partner's sections, picks fitting templates, rebinds.

7. **Formation plan / dev handoff reads diagnosis** — replaces
   field_values-walking. Surfaces only intake gaps.

## Where I'm asking the user before continuing

I have enough about the SHAPE of the system now. But the sequencing
above implies real work in places I don't own:

1. **Library audit + expansion** is squad design work, not analyzer
   code. I can produce the audit report (which schemas don't have a
   covering template) but the squad has to add templates.

2. **Cowork prompt rewrites** in `cowork-skills/` are LLM-prompt
   work, not deterministic code. I can draft the prompt updates but
   they need validation against real partner content.

3. **Rebinding existing partners** is a one-time migration with UX
   implications (the strategist sees their pages change templates).
   Needs strategist sign-off.

Three open questions before code:

1. **Sequencing**: ship the diagnostic READ layer first (using
   whatever's in cowork today, including the 5-slot constraint),
   then expand cowork shape in a second pass? OR hold the read
   layer until the cowork shape is expanded so the first render
   is correct?

2. **Library audit**: do you want me to produce the audit (which
   canonical schemas have no covering Brixies template) as a
   handoff doc you and McNeel review? Or is this something the
   squad has already done and I should reference it?

3. **Rebinding existing partners**: in scope for this work or
   deferred? "Fix 3672 specifically" is one outcome; "make the
   system handle all existing partners" is much bigger.

No code yet. These three answers shape what I build.
