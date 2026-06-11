---
description: Map the copywriter's prose output to Brixies field_values JSON. Deterministic mechanical mapping — no creative rewriting.
---

You are running the deterministic formatter step. Your job is mechanical mapping, NOT creative writing.

## Inputs

The user has either:
- Pasted the copywriter's prose output (with structural markers HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:) into chat above, OR
- Pasted a bundle containing both the copywriter's prose AND the bound Brixies template schemas

If the bound template schemas aren't visible, ask the user to provide them before proceeding. They look like:

```json
[
  {
    "id": "hero-section-102",
    "family": "Hero Section",
    "fields": [
      {"key": "tagline", "kind": "slot", "type": "text", "max_chars": 60},
      {"key": "heading", "kind": "slot", "type": "text", "required": true, "max_chars": 100},
      ...
    ]
  }
]
```

## The mapping

For each section in the copywriter's output (parsed by `## Section N — <concept_id>` headings):

1. Find the bound template by `concept_id` → `template_id` mapping (in the brief or provided by user).
2. Walk the template's `fields[]` array.
3. For each field, map by `key`:

| Marker in prose | → Field key | Notes |
|---|---|---|
| `HEADING:` | `heading` | Strip leading/trailing whitespace |
| `TAGLINE:` or `TAGLINE (informational):` etc. | `tagline` | Strip strategy parens, strip whitespace |
| `SUBHEADING:` | `subheading` | If present in prose AND template has the slot |
| `DESCRIPTION:` | `description` | The full prose block until the next marker |
| `CARDS:` list items | `card.items[]` | Each card maps to `{heading_card, description_card}` or whatever the card palette template defines |
| `STEPS:` list items | `process_steps.items[]` or the template's group key | Map step label + description |
| `CTA:` | `buttons.items[].label` + `.url` | Parse "Label → URL" or "Label (URL)" forms |

4. For each filled slot, check `max_chars`. If over:
   - If 10% or less over: trim at the last word boundary that fits, preserving meaning
   - If more than 10% over: leave un-trimmed and add an entry to `mechanical_scan_log` with a kickback flag: `"section_N.slot_key needs structural shortening, +X chars over max"`. The user routes this back to the copywriter.

5. For required slots that have no matching marker in the prose:
   - Add entry to `mechanical_scan_log`: `"section_N.slot_key required but missing from copywriter output"`. Do NOT invent content.

6. For optional slots with no matching marker:
   - Leave empty. NOT a failure.

7. Image slots: always leave empty (designer's job).

## Output

Return ONE JSON object:

```json
{
  "page_slug": "/kids",
  "primary_persona": "...",
  "strategic_setup": {
    "metadata_title": "...",
    "metadata_description": "...",
    "aeo_smart_snippet": "..."
  },
  "sections": [
    {
      "sort_order": 1,
      "concept_id": "hero_inner",
      "template_id": "hero-section-102",
      "section_job": "[passed through from brief]",
      "tagline_strategy": "informational",
      "field_values": {
        "tagline": "...",
        "heading": "...",
        "description": "...",
        "buttons": {"items": [{"label": "...", "url": "..."}]}
      },
      "alternatives_considered": {
        "description": ["alt 1 (chosen)", "alt 2", "alt 3"]
      },
      "atoms_lifted_canonical": [],
      "voice_notes_from_copywriter": "[lifted verbatim from VOICE NOTES: section]"
    }
  ],
  "mechanical_scan_log": [
    {"section_sort": 1, "slot": "tagline", "issue": "trimmed at word boundary, was +5 chars over max_chars=60", "fix": "applied"}
  ],
  "kickbacks_to_copywriter": [],
  "gaps_flagged": []
}
```

## Hard rules

- **No creative rewriting.** If a slot needs structural shortening, kick back to the copywriter. Do NOT paraphrase to fit.
- **No new content invention.** If a required slot has no source in the prose, log a kickback. Don't fabricate.
- **Preserve VOICE NOTES verbatim** in each section's `voice_notes_from_copywriter` field — this carries the writer's reasoning into the reviewer step.
- **Preserve ALTERNATIVES verbatim** in `alternatives_considered` — the reviewer uses these.
- **strategic_setup** (metadata_title, metadata_description, aeo_smart_snippet): if the copywriter's prose included these (some briefs ask for them), lift them. Otherwise produce them mechanically by templating: `{Page Name} at {Church Name} | {City}` for title, etc. — but only if the brief asks. Don't add unless requested.

Return only the JSON. After producing it, suggest the user invoke `web-page-reviewer` to audit.

---

## Snippets tokenization step (added in v0.2)

If a `snippets_manifest` is available in the brief (passed alongside the formatter inputs), apply mechanical tokenization to the field_values JSON BEFORE returning it.

### Scope

Tokenize literal values in these slot types ONLY:
- `description`, `body`, `subheading`, `tagline` (when hook strategy)
- Group items: `card.items[].description_card`, `process_steps.items[].description`, `info_wrapper.items[].description`

Do NOT tokenize:
- `heading` slots (h1s are clean labels — leave alone)
- `image` URLs or alt text
- `tagline` slots when strategy is `informational` (the literal facts are the point)
- Quoted testimonial blocks (literal preservation matters)
- Atom verbatim lifts where `content_quality: "clean"` AND `verbatim: true` (preserve exactly)

### What to replace

For each text value in scope:

1. **Globals.** Iterate the `globals` object. For each key with a non-null value, find every occurrence of that literal in the text (case-insensitive match, word-boundary respected) and replace with `{{key}}`. Examples:
   - "Riverwood Chapel" → `{{church_name}}`
   - "Riverwood" (standalone) → `{{church_short_name}}` (be careful — only when it's the short-form usage; if it's part of a longer phrase like "Riverwood's Kids Wing" keep "Riverwood's" intact and only tokenize "Riverwood" → `{{church_short_name}}`)
   - "9:00, 10:15, and 11:30am Sunday" or close variants → `{{all_service_times}}`
   - "Kent, OH" / "Kent, Ohio" → `{{city_state}}`
   - The pastor's name → `{{pastor_name}}`

2. **Custom snippets.** Iterate the `snippets[]` array. For each snippet with a defined `expansion`, find every occurrence of that exact expansion (case-insensitive for natural language; case-sensitive for URLs) and replace with `{{token}}`.

3. **Log every substitution** in `mechanical_scan_log` with the format:
   ```json
   {
     "section_sort": N,
     "slot": "...",
     "issue": "tokenized literal",
     "fix": "replaced 'Riverwood Chapel' with {{church_name}}"
   }
   ```

### Conflict cases

- If two globals/snippets could match the same span, prefer the **longer** match (e.g., "Riverwood Chapel" wins over "Riverwood" when both could apply).
- If a literal appears inside a `{{token}}` substring (which shouldn't happen but might from chaining), skip — don't re-tokenize tokens.

### Stay deterministic

This is a mechanical scan, not a creative pass. Do not paraphrase. Do not add tokens for values that aren't literally present. If a value is similar but not exact (e.g., "9 AM Sunday" vs "9:00 AM Sunday"), do NOT tokenize — leave it for the reviewer to flag as a candidate snippet.
