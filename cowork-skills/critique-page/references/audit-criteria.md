# Audit Criteria — Global Mechanical Rules

> **version:** 1.0.0
> **scope:** GLOBAL mechanical rules ONLY. Partner-specific
> configuration (banned_terms, branded_vocabulary, sample_sentences_in_voice,
> example_phrases_bad, syntax_rules, persuasive_posture_by_persona) is
> loaded from the partner's `voice_card` at audit time — **never**
> transcribed into this file or the SKILL.md prose.
>
> **What lives here:** craft rules that apply across every partner
> (no em-dashes, no filler triads, no AI clichés, no self-promoting
> We/Our, heading-is-a-clean-label, hero-description-invites,
> visitor-as-hero, primary-CTA-specific, etc.). These rules don't
> change between churches; they encode Church Media Squad's house
> craft standard.
>
> **What does NOT live here:** anything one specific church bans or
> brands. Those go in that partner's voice_card. If you find yourself
> typing a partner's name into this file, stop — that's drift, and
> P4 from the engineering backlog exists exactly to prevent it.
>
> **When to bump version:** any time the craft standard changes
> (new AI cliché added, new church cliché bumped from yellow to red,
> CTA rule tightened). Bump the minor for additive checks, major for
> changes that flip a previously-passing page to fail.

Detailed scan patterns and judgment heuristics for the web-page-reviewer
skill, applied to every partner equally.

## Negative-check scan patterns

### 1. Em-dashes

Regex: `[—–]` (Unicode em-dash, en-dash) or `--` (ASCII double-hyphen)

Any hit fails. En-dash is allowed ONLY in date/time ranges per brand rule (e.g., `9am–11am`). If you see `–` between non-numeric tokens, flag.

### 2. Filler adjective triads

Regex: `\b[a-z]+, [a-z]+,? and [a-z]+\b`

For each hit, apply the test: would removing any one word damage the meaning?
- "warm, welcoming, and authentic" → all interchangeable filler → FAIL
- "safe, known, and loved" → each carries distinct semantic weight → PASS
- "9, 10:15, and 11:30am" → factual list of times → PASS (not adjective triad)
- "Open Arms Nursery, Preschool, and Elementary" → list of named programs → PASS
- "Foyer, Kids Wing, and Worship Center" → list of named places → PASS

### 3. Filler intensifiers

Word list: truly, really, deeply, incredibly, very, amazing.

For "just":
- Filler: "we just want you here", "it's just amazing", "just love"
- Allowed: "just inside the Foyer" (locational), "just three steps" (precise quantifier)

### 4. Contrastive reframes

Patterns:
- `\bnot \w+,? it'?s \w+\b`
- `\bit'?s not (about )?\w+,? but \w+\b`
- `\bnot about \w+,? but\b`

### 5. AI clichés (full list)

delve, tapestry, unlock, unleash, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, testament, "in a world where", "at the heart of", "journey of faith"

### 6. Church clichés (full list)

"come as you are", "life-changing", "vibrant community", "spiritual journey", "walk with God", "on fire for the Lord", "do life together", "fellowship" (as verb)

### 7. Self-promoting We/Our

Scan: `\b(we|our)\b` (case-insensitive) in body slots only (description, body, card.description_card, step.description). Skip headings, taglines, CTAs.

For each hit, apply the test:
- Self-descriptive about the church (banned): "we are an amazing community", "our exceptional kids ministry", "we have a heart for our city"
- Partnership invitational (allowed): "we partner with parents", "we walk with you through hard seasons", "we want you to find your place"

When ambiguous, lean banned and recommend rewrite using the church's proper name or restructure.

### 8. Two consecutive sentences same opener

Split each description/body into sentences (split on `[.!?]\s+`). For each adjacent pair, check the first word. If same (case-insensitive), flag.

Especially watch for "You. You. You." sequences — easy to slip into when leaning on visitor-as-hero framing.

### 9. Banned terms from voice card

For each term in `voice_card.banned_terms`, scan body for exact word boundary match (case-insensitive).

### 10. max_chars

For each filled field_values entry, compare length to the bound template field's `max_chars`. Strict — exceeded by even 1 char = fail.

### 11. Required slots filled

For each section's bound template, check every field with `required: true` is filled. Empty string or null = fail.

### 12. Verbatim atom preservation

For each atom in the brief with `verbatim=true` AND `content_quality=clean`, the atom's body must appear exactly somewhere in the drafted output. Case-sensitive substring match. If missing or paraphrased, fail.

Atoms with `content_quality=raw_form_output` are exempt — those were demoted upstream and the copywriter is free to recompose them.

## Positive-check criteria

### Heading is a clean label

For every heading slot across all sections:
- Word count ≤ 4 words (unless it's a named program like "Open Arms Nursery")
- No complete sentences (no verbs that form a sentence)
- No hook-like phrasing (no "Where X meets Y", no exhortations, no questions)

PASS examples: "Kids", "Visit", "Give", "Open Arms Nursery", "What Your Kids Learn", "Your First Sunday"
FAIL examples: "Where Kids Meet Jesus", "Sundays Your Kids Will Love", "Broken Pieces, Made Whole"

### Tagline strategy honored

For each hero section:
- `informational` → tagline contains a number (time, age, year) or a list of factual qualifiers
- `hook` → tagline is a short persuasive line (one sentence, no facts dump)
- `omit` → tagline is empty string

### Hero description invites

For each hero section's description, check:
- Does it name a feeling word the persona is carrying (look forward to, known, belong, loved, breathe, walk with)?
- Does it AVOID delivering logistics (service times, hours, address, check-in process steps)?
- Past hero patterns it should feel adjacent to: "You want your kids to love church, not just attend" / "You don't have to be okay to come here" / "Walking into a new church takes more than most people admit"

If description leads with a place name + a time + a process step, flag as logistics-first → fail.

### Section_jobs addressed

For each section, the `voice_notes_from_copywriter` (preserved through /format-page) plus the field_values content should demonstrate the section_job was the target. The copywriter's voice notes are the receipts.

If voice_notes_from_copywriter is empty or generic ("filled the slots"), flag as red — drafter didn't engage with the brief.

### Jesus named per major section

Non-chrome sections (hero, content_image_text, feature_card_grid, feature_unique, timeline_story, content_featured) should name Jesus or the gospel explicitly at least once on the page. Chrome sections (contact_section, archive_filter, CTA-only sections) exempt.

### Visitor as hero

Body slots use "you/your" framing. Count "you" + "your" across all body content. Less than 3 occurrences = flag.

### Primary CTA specific

The first/primary CTA button label should be a direct verb-led action.

PASS: "Plan Your Visit", "Pre-register Your Kids", "Watch the Sunday Livestream", "Sign Up for Discovery"
FAIL: "Learn More", "Click Here", "Get Started", "Find Out More"

### Branded vocabulary used

Track which terms from voice_card.branded_vocabulary appear in the drafted output. Surface as a list in the verdict. Not pass/fail by itself, but a green page typically uses at least 2-3 branded terms.

### Specificity present

Body content contains at least one of: proper noun (named program, named place, named person), number (time, year, age, count), named partner.

### Voice match

Read the drafted output. Does it sound like the voice card's sample_sentences_in_voice? Register, sentence rhythm, vocabulary, posture — all should feel adjacent.

1-2 sentence written assessment in `voice_match_assessment` field. Note where it shines AND where it falls short.

## Confidence band rules (detailed)

### Green

- All 12 negative checks pass
- All 10 positive checks pass
- voice_match_assessment is clean (positive overall, no major drift noted)
- mechanical_scan_log from formatter has no unresolved kickbacks
- gaps_flagged is empty OR contains only honest "no atom available" flags (not "drafter punted")

### Yellow

- 1-2 positive checks are borderline (e.g., visitor_as_hero count is 3 exactly, branded_vocabulary used only 1 term, voice_match has minor critique)
- mechanical_scan_log shows 1-2 in-place trims that were applied cleanly
- No required-slot misses, no banned terms, no em-dashes
- Section_jobs addressed but one section feels thin

### Red

ANY of:
- Em-dash present
- Banned term present
- Required slot missing
- Heading is a hook (positive check 1 fail)
- Hero description leads with logistics (positive check 3 fail)
- Section_job clearly not addressed (positive check 4 fail)
- Self-promoting We/Our present
- Two consecutive same-opener sentences
- Verbatim atom missing or drifted (and the atom was content_quality=clean)
- max_chars violation
- Voice match flags significant drift from sample_sentences_in_voice

Red → return to copywriter with specific kickbacks naming the section, slot, and what to fix.

## Cross-cutting CMS persuasive patterns (reference)

The reviewer should be familiar with the patterns the copywriter writes toward. Same 4 cross-cutting principles + per-section persuasive jobs as the copywriter's reference. Don't audit against literal pattern match — audit against intent.

A copywriter who writes toward the parent's desire (instead of leading with logistics) is honoring the hero pattern, even if the wording differs from past sites. Reviewer should recognize the move, not require identical phrasing.

---

## Snippets consistency (v0.2 addition)

### Negative check 13: tokens_used_for_globals_and_snippets

Scan every text value in body slots for occurrences of:
- Each non-null `globals` value (church_name, church_short_name, address, city_state, phone, email, denomination, pastor_name, primary_service_time, all_service_times, social URLs)
- Each registered `snippets[].expansion`

Any literal occurrence that should be a token = fail.

**Exceptions** (do not flag):
- Headings (h1 labels stay literal)
- Informational taglines (the literal facts ARE the content)
- Quoted testimonials (literal preservation matters)
- Verbatim atom lifts where `content_quality: "clean"` AND `verbatim: true`
- Alt text and image URLs

### Positive output: proposed_snippets

Scan ALL text values for entities that appear 2+ times across the page AND are not in the manifest. Candidate types:

| Candidate type | How to detect | Token shape |
|---|---|---|
| Person name | Capitalized 2+ word sequence appearing 2+ times | `{role}_name` |
| Email address | Regex `[\w.-]+@[\w.-]+\.\w+` appearing 2+ times | `{role}_email` |
| URL | Regex `https?://\S+` appearing 2+ times | Describe action: `{action}_url` |
| Branded program / ministry name | Proper noun phrase appearing 2+ times AND in `branded_vocabulary` | `{program_slug}` |
| Recurring meeting time | Day + time pattern appearing 2+ times | `{ministry}_meeting_time` |

For each candidate, include `occurrences` and `sections` arrays in the proposed_snippets entry.

### Confidence band impact

- Untokenized globals/snippets count: 1-2 hits → yellow; 3+ hits → red
- proposed_snippets: not a band driver — informational only
