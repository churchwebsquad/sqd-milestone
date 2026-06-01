# Riverwood Chapel — Copywriter Briefs (Project 3490)

14 page brief pairs, ready to drop into a fresh Cowork conversation with the **web-copywriter-suite** plugin installed.

## Per-page workflow

For each page (start with `/kids` since it's already validated):

1. **Open a fresh Cowork conversation.** Make sure the `web-copywriter-suite` plugin is installed and Sonnet 4.6 is the active model.

2. **Paste `<page>-copywriter-brief.md` as your message.** The `web-page-copywriter` skill will trigger. Sonnet outputs prose with structural markers (HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:).

3. **Read the prose, decide if it lands.** If a section feels weak, ask Sonnet to rewrite that section's description with a specific direction (e.g., "rewrite section 2 description to lean harder on the parent's actual desire").

4. **Type `/format-page` and paste `<page>-formatter-inputs.md`.** The formatter command maps prose → Brixies field_values JSON, applies max_chars (trim or flag), logs any kickbacks for structural issues.

5. **Say "review the page" and paste the formatter's JSON output + the voice card from the original brief.** The `web-page-reviewer` skill runs the audit and returns a verdict object with confidence_band (green/yellow/red), negative_checks, positive_checks, and kickbacks_to_copywriter.

6. **Apply kickbacks** if any. Round-trip back to the copywriter with the specific request.

7. **Save the final approved JSON** somewhere durable. In production this would write to Supabase `web_sections.field_values`.

## Files in this folder

| Slug | Brief | Formatter |
|---|---|---|
| `/` | homepage-copywriter-brief.md | homepage-formatter-inputs.md |
| `/visit` | visit-copywriter-brief.md | visit-formatter-inputs.md |
| `/watch` | watch-copywriter-brief.md | watch-formatter-inputs.md |
| `/give` | give-copywriter-brief.md | give-formatter-inputs.md |
| `/kids` | kids-copywriter-brief.md | kids-formatter-inputs.md |
| `/story-beliefs` | story-beliefs-copywriter-brief.md | story-beliefs-formatter-inputs.md |
| `/leadership` | leadership-copywriter-brief.md | leadership-formatter-inputs.md |
| `/connect` | connect-copywriter-brief.md | connect-formatter-inputs.md |
| `/students-college` | students-college-copywriter-brief.md | students-college-formatter-inputs.md |
| `/adult-studies` | adult-studies-copywriter-brief.md | adult-studies-formatter-inputs.md |
| `/discovery-membership` | discovery-membership-copywriter-brief.md | discovery-membership-formatter-inputs.md |
| `/care` | care-copywriter-brief.md | care-formatter-inputs.md |
| `/outreach` | outreach-copywriter-brief.md | outreach-formatter-inputs.md |
| `/events` | events-copywriter-brief.md | events-formatter-inputs.md |

## Phase 1 priority (ship-first set)

Recommend running in this order so the most-visited pages are validated first:

1. `/` (homepage)
2. `/visit` (highest-stakes conversion)
3. `/kids` (already done — keep for reference)
4. `/watch`
5. `/give`
6. `/story-beliefs`

Phase 2 (after the first six land cleanly):

7. `/leadership`
8. `/connect`
9. `/students-college`
10. `/adult-studies`
11. `/discovery-membership`
12. `/care`
13. `/outreach`
14. `/events`

## When a brief feels stale

If you change anything upstream (voice card, section_jobs, atoms), re-run `build_all_page_briefs.py` to regenerate every brief with the fresh data.
