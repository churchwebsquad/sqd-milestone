# Content fixes log — First Presbyterian Church of Charlotte (3249)

**Date:** 2026-06-18
**Project ID:** `435ccbf9-f755-4460-ac1f-aa6a604d0482`
**Companion doc:** [3249-first-pres-discrepancies.md](./3249-first-pres-discrepancies.md) (the audit that drove these fixes)

Every change in this doc:
- Has a verbatim Notion source it's restoring fidelity to (where applicable).
- Names the exact `web_sections.id` or `web_pages.id` touched + the slot/column changed.
- Includes a one-line revert SQL.

## What this log does NOT include

These changes need your decisions before I can apply them — listed in §"Decisions you need to make" at the end:

1. **The History Hallway slug** — Notion's GAPS FLAGGED says `/history-hallway` vs `/fpc-clergy`; the rendered slug is `the-history-hallway` (matches neither).
2. **Cards-grid restructuring** on Local-Global, Advocacy, Serve — these need 10/6/5 sibling sections collapsed into one cards-grid each. That's destructive (drops sections, restructures items[]) and depends on whether you want `feature-section-2` (image cards) or `accordion_faq` (text-only accordion) or another shape. Bigger lift; better to do in the workspace UI with you watching.
3. **Give Member Testimony required-slot** — `feature-section-19` needs a `primary_heading`. Options: (a) synthesize from section title → "Member Testimony", (b) swap template to a heading-optional one. Your call on which.
4. **Areas of Focus (Advocacy s2) verbatim breach** — `vr=0.4` indicates the intro body is partly synthesized rather than verbatim Notion. Fix requires fetching the Notion source for that specific section to confirm. Deferred until I can re-fetch Notion or you confirm the current copy is acceptable.

---

## FIX 1 — Archive `_meta` orphan page

**Page:** `b4f3eff6-4a29-404e-935d-4474a490e94d` (slug `_meta`)
**What changed:** Set `archived = true` so it stops surfacing as a navigable page.
**Why:** The audit branch wrote a `_meta` "page" while ingesting the Notion DB's metadata row. It's not a real partner page; it shouldn't ever be in `web_pages`.

**Revert:**
```sql
UPDATE web_pages SET archived = false WHERE id = 'b4f3eff6-4a29-404e-935d-4474a490e94d';
```

---

## FIX 2 — Normalize `partner_gaps_flagged` field name on 3 pages

**Pages:** `employment`, `events`, `local-global` (slugs)
**What changed:** Each entry in `web_pages.partner_gaps_flagged` had a `text` key; renamed to `note` so the column matches the v77 schema convention used elsewhere.
**Why:** Mid-rollout drift — early SKILL writes used `text`, the v77 columns + UI assume `note`. Without this, the three pages' partner gaps were invisible to the Pages workspace.

**Revert:**
```sql
UPDATE web_pages
SET partner_gaps_flagged = (
  SELECT jsonb_agg(
    CASE WHEN entry ? 'note' AND NOT entry ? 'text'
      THEN (entry - 'note') || jsonb_build_object('text', entry -> 'note')
      ELSE entry END
  )
  FROM jsonb_array_elements(partner_gaps_flagged) AS entry
)
WHERE web_project_id = '435ccbf9-f755-4460-ac1f-aa6a604d0482'
  AND slug IN ('employment','events','local-global');
```

---

## FIX 3 — Pastoral Transition s3 paraphrase reverted

**Section:** `ba4e9c8d-2265-4e36-99ef-42c04082320f` (page `pastoral-transition`, sort_order 2)
**What changed:** `cowork_slot_values.body` set to `null`. The Notion source has no partner-written visitor-facing body for this section — only an italic content-migration directive (`*[Content migration: all existing posts from firstpres-charlotte.org/updates-from-the-transition-team/ move here intact, newest first — lift and shift, preserving each post's date and author...]*`) which was correctly captured into `cowork_section_meta.dynamic_directive`. The translator additionally fabricated a paraphrase of that directive into the body slot ("New updates appear at the top..."). The audit found this as the only `actual_verbatim_ratio: 0.5` breach in 18 audited pages.
**Why:** Verbatim policy — the body must match Notion. Notion has no body here; the directive belongs in `dynamic_directive`, not in visitor copy. Updated `cowork_section_meta.actual_verbatim_ratio` to `1`.

**Visitor impact:** The section now renders just the heading "Updates from the Team" until migrated blog posts arrive. The dynamic_directive is preserved for the strategist/designer phase.

**Revert:**
```sql
UPDATE web_sections SET cowork_slot_values = jsonb_set(cowork_slot_values, '{body}', '"New updates appear at the top. (Existing posts migrate here intact from the current Transition Team updates page, newest first.)"'::jsonb) WHERE id = 'ba4e9c8d-2265-4e36-99ef-42c04082320f';
```

---

## FIX 4 — Advocacy editorial leakage strip (6 sub-ministry sections)

**Pattern:** The translator left partner→strategist directives (italic-bracket placeholders like `*[Editable callout — Advocacy team updates this...]*` and the dangling `**What You Can Do Now:**` label) inside `body`. Strategist directives belong in `cowork_section_meta.inline_annotations`, not visitor copy.

**Sections touched (Advocacy page `41216399-2149-460f-8b06-a00f2b5bfd01`):**

| Section | Heading | Removed from body | Preserved in inline_annotations |
|---|---|---|---|
| `b5452c79-...` | Housing and Homelessness | `**What You Can Do Now:** + [Editable callout — Advocacy team updates this with current action items and upcoming opportunities]` | yes (`partner_strategist_directive`) |
| `8b157612-...` | Racial Justice | History Hallway URL-confirm directive AND `**What You Can Do Now:** + [Editable callout — Advocacy team updates this with current action items]` | yes (2 entries) |
| `0b6ff6f8-...` | Climate Change | `- *[Additional action items — editable by Advocacy team]*` (kept partner's carbon-footprint link) | yes |
| `1935cefb-...` | Equity and Education | `**What You Can Do Now:** + [Editable callout — Advocacy team updates with current opportunities, including tutoring sign-ups and school support events]` | yes |
| `9a0f2d26-...` | Gun Violence Prevention | `**What You Can Do Now:** + [Editable callout — Advocacy team updates with current action items and upcoming events]` | yes |
| `41305e48-...` | Plowshares Book Club | `*[Current and past books — link to or display the Plowshares library here]*` | yes |

**Why:** Visitor-facing prose shouldn't contain editorial placeholders. The strategist needs to see them in a queryable, non-rendered location.

**Revert:** Each section's prior body is in git history. The annotations carry the exact removed text verbatim, so the revert is: copy the `note` value back into `body` at the spot it was removed.

---

## FIX 5 — Worship Service taglines folded into body

**Sections:**
- `dfd0d70f-085c-4480-af68-34329a4110ca` — Contemplative Service (page `worship`, sort_order 1)
- `23f5676a-509a-4ab2-97a8-2ab831d01415` — Traditional Service (page `worship`, sort_order 2)

**What changed:** Tagline content prefixed to body as bold leading line; `tagline` slot set to `null`. `cta-section-20` has no `tagline` slot in its `cowork_writable_slots`, so the tagline was orphaned (preserved in `cowork_slot_values` but not rendered).

**Before / after for Contemplative:**
- Tagline (orphaned): `"Sundays, 9 a.m. | Chapel | September through May"`
- Body (new prefix): `**Sundays, 9 a.m. | Chapel | September through May**\n\nThe Contemplative Service is an unhurried hour…`

**Why:** Visitor needs to see when/where the service is. The template choice forced the fold; no Notion content lost.

**Revert:** Restore the tagline values + strip the bold leading line from body. The original taglines are quoted above + in the inline_annotations entries.

---

## FIX 6 — Empty placeholder button URLs substituted with `#` (8 buttons across 7 sections)

**Pattern:** Buttons whose `url` was empty/blank/null shipped to the render layer as broken anchors that 404. Substituted `#` + added `_placeholder: true` flag on each.

**Buttons touched:**

| Section | Page | Label |
|---|---|---|
| `48fd33a4-...` | `/` (home) | Listen to Say Grace |
| `db48e194-...` | `about` | The History Hallway |
| `19f664f7-...` | `adults` | See All Offerings Below |
| `a502870a-...` | `new` | Listen to Say Grace |
| `49691258-...` | `serve` | Find Your Serving Role Below |
| `4aea52bc-...` | `watch` | Subscribe on Apple Podcasts |
| `4aea52bc-...` | `watch` | Subscribe on Spotify |
| `dfd0d70f-...` | `worship` | View Current Bulletin |

**Why:** A `#` link no-ops visually; a missing/empty URL produces an unstyled link or a 404. The `_placeholder: true` flag lets the strategist UI surface "needs a real URL" rather than treating them as final.

**Partner gap:** These 8 URLs need real destinations from First Pres before launch. The audit doc flagged these collectively under "Empty URLs in canonical buttons."

**Revert:** `UPDATE web_sections SET cowork_slot_values = jsonb_set(cowork_slot_values, '{buttons}', (SELECT jsonb_agg(CASE WHEN btn ? '_placeholder' THEN btn - '_placeholder' || jsonb_build_object('url', '') ELSE btn END) FROM jsonb_array_elements(cowork_slot_values -> 'buttons') AS btn)) WHERE id IN (... 7 ids ...);`

---

## FIX 7 — Home Service Times: 2nd CTA promoted from `item_meta` to `item_body` markdown links

**Section:** `38a33367-8976-46ef-9790-ac374e8c5339` (home "Join Us This Sunday", `content-section-89`)

**What changed:** Each of the two service items (Contemplative + Traditional) had a primary CTA (View Bulletin) stored in `item_cta_label`/`item_cta_url`, and a SECOND CTA ("Watch the Livestream → /watch") stranded in the `item_meta` STRING. Promoted both CTAs to bold markdown links appended to `item_body`. Cleared the stranded `item_meta` string + preserved it under `_original_item_meta` for revert.

**Why:** `content-section-89`'s schema models `item_heading` + `item_body` only — there's NO per-card CTA slot at all (both the primary and the stranded CTA were orphaned). Until the section is swapped to a `cards_with_cta` template (`feature-section-103`), inline markdown links inside `item_body` are the only path to visitor-facing CTAs.

**Inline annotation added:** Notes that this is a fidelity workaround and the section deserves a richer template later.

**Revert:** Each item's `_original_item_meta` field carries the prior stranded string; trim the `\n\n**[…]** · **[…]**` suffix from `item_body` and restore `item_meta`.

---

## FIX 8 — `field_values` re-derived across all 146 cowork sections

**What changed:** Ran `scripts/refresh-arvada-field-values.ts 435ccbf9-f755-4460-ac1f-aa6a604d0482` to re-translate every cowork-bound section's `field_values` from the new `cowork_slot_values` via the current `composeFieldValuesForBrixies` translator + canonical-templates manifest. Result: 146 sections updated, 0 skipped.
**Why:** FIXES 3–7 modified `cowork_slot_values`. The workspace preview reads `field_values` (Brixies-shape), not the slot values, so without this step the visual changes wouldn't appear until the next handoff push.
**Spot-check:** Pastoral Transition s3, Worship Contemplative, Home Service Times all return `bind_quality: "perfect"` and empty `gaps[]` after the regen.

---
