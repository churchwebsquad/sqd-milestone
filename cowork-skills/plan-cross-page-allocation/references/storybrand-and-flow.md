# Journey-Down-The-Page Framework

Reference for `plan-cross-page-allocation`. Distills two patterns:

1. **flow_role conventions** — what each section of a page actually
   does for the persona on it.
2. **StoryBrand-derived journey** — how those flow_roles tend to
   sequence on a well-composed page.

This is NOT a rigid template. The partner's actual content + the
ministry-model pattern reference (`../../page-outlines-by-ministry-model.md`)
take precedence over the abstract framework here.

---

## flow_role vocabulary

Every section has a `flow_role`. Pick the ONE that best describes
what the section does for the persona standing on the page in their
journey.

| flow_role | What it does | When you use it |
|---|---|---|
| `hook` | Grab attention; signal "this page is for you" | First section. Usually a hero or tagline_band. ONE per page. |
| `orient` | Tell the persona what this page is + where they are | Often follows hook on home / category pages. Skip on focused pages where the URL already orients (e.g., `/give`). |
| `reassure` | Address the specific barrier the persona is carrying | Single biggest place where "voice character" lives. Use the persona's actual fear. Examples: parent worried about kid safety, returning visitor worried about being "the new person." |
| `inform` | Deliver the facts they came for | Service times, ministry program details, what to expect, how to give. Densest information. |
| `deepen` | Add texture, voice, story — show character | Stories, testimonials, beliefs in the church's own words. The section that proves the church is a real place with real people. |
| `invite` | Offer the next step | A specific, low-friction action. Visit Sunday. Email a pastor. Sign up for a small group. ONE primary invite per page. |
| `close` | Close the page with intent | Final tagline, footer-style CTA band, or a single declarative line. Could be the invite itself rephrased; could be a benediction-style sign-off. |

---

## Sequencing — the journey-down-the-page

Most well-composed church web pages follow this shape:

```
hook → orient (optional) → reassure → inform → deepen → invite → close
```

Variations by page type:

### Home page
```
hook (who we are, x_factor)
orient (audience + invite to explore)
reassure (low-pressure language for visitors)
inform (3-4 cards: visit, kids, give, beliefs — gateways out)
deepen (a story or a voice-anchored value statement)
invite (plan a visit)
close (tagline / signature line)
```

### Plan a Visit (single most barrier-loaded page)
```
hook ("Whatever you're carrying today, you're welcome.")
orient (what to expect in 90 seconds)
reassure (parent worry, what-to-wear worry, will-I-stand-out worry — address by name)
inform (FAQs: time, parking, kids, length, dress code, communion)
deepen (a returning-visitor or first-timer story)
invite (book a visit / text a pastor / pre-register kids)
close (a "we'll be looking for you" line)
```

### Kids page
```
hook (signal SAFE + FUN)
reassure (background-check policy, drop-off procedure, secure pickup, named ministry lead)
inform (age groups + what they do, weekly schedule, special events)
deepen (a parent or kid story OR a leader's voice anchor)
invite (visit this Sunday + register kids ahead of time)
close
```

### Beliefs page
```
hook (the church's distinctive theological POV in ONE line)
orient (denominational tradition without jargon)
deepen (beliefs in the church's own voice — not borrowed evangelical-stock)
inform (specific positions where partners care — Scripture, sacraments, mission)
invite (a path: study the beliefs in a class, ask a pastor)
close
```

### About page
```
hook (a story or origin moment, NOT a generic "welcome to our church")
orient (when we started, where we are, dominant ministry model)
deepen (founding values lived out in concrete examples)
inform (leadership snapshot, denominational tradition, partnerships)
invite (visit / read more about beliefs / meet the team)
close
```

### Give page
```
hook (theology of generosity — NOT a "donate now" headline)
reassure (transparency, fiduciary, where the money goes)
inform (how to give — recurring, one-time, in-person, mail, stock)
deepen (a story of generosity OR a statement of mission impact)
invite (a specific giving action)
close
```

---

## Cross-page allocation principles (StoryBrand-derived)

StoryBrand's BrandScript framework (hero, problem, guide, plan, call,
success, failure) maps to flow_role usage like this:

- **Hero = the persona** (NOT the church). Every section should be
  written FOR the persona, not ABOUT the church.
- **Problem = the persona's barrier.** The `reassure` flow_role
  exists specifically to surface and resolve the problem.
- **Guide = the church.** The church is the guide, never the hero.
  Voice samples and ethos pillars establish guide authority via
  posture, not credentials.
- **Plan = the inform sections.** Concrete steps. The `inform`
  flow_role IS the plan.
- **Call = the `invite` flow_role.** ONE primary call per page.
- **Success = what life looks like for the persona after taking the
  call.** Often woven into `deepen` (stories of people who took the
  step and where they are now) or into `close` (a benediction-style
  vision line).
- **Failure = the cost of not engaging.** Use sparingly. Most often
  surfaces implicitly via reassure ("you don't have to keep doing
  this alone").

When allocating sources, ask: **does this source serve the persona's
journey, or is it the church talking about itself?** If it's the
latter, either reframe (treatment: `reframe_for_persona`) or move it
to a deepen/voice_anchor role where the partner's voice IS the value.

---

## Anti-patterns to allocate AWAY from

- **Lists of staff bios on the home page.** Staff facts belong on a
  team/leadership page with treatment `card_per_row`, not home's
  hook or inform.
- **Service times as a hero.** Service times are `inform`, often
  better as `surface_as_faq` or part of a contact band on /visit,
  not as the page-opening headline.
- **Mission statement as a feature grid.** Mission belongs as
  `voice_anchor` on home's hook OR on about's deepen with
  `lift_verbatim`. Don't fragment it across 3 cards.
- **Beliefs page as a creed dump.** Beliefs lifted verbatim from a
  doctrinal statement read as cold. Treatment: `weave_into_paragraph`
  with the church's actual voice from `voice_sample` pillars.
- **Kids page that opens with policies.** Safety belongs in `reassure`,
  not `hook`. Lead with kid-experience hook; surface policy via
  `surface_as_faq` after the reassure.

---

## Quality check before returning the plan

Walk every page once more and verify:

1. **Hook lands first.** No section_intent before the hook unless it's
   genuinely a label (eyebrow) — and even then, prefer integrating.
2. **One primary invite per page.** Multiple sub-invites are fine
   (small CTAs in inform sections) but ONE primary `invite` flow_role.
3. **Reassure addresses a real persona barrier from
   site_strategy.persona_journeys.barriers_addressed**, not a generic
   "we welcome everyone."
4. **Voice anchors are placed.** Every primary page (home, visit,
   about, give) has at least one `voice_anchor` treatment using a
   `voice_sample` pillar.
5. **Cross-page reuse is intentional.** If a kids ministry pillar
   lands as hook on home, on /kids it should land as `inform` or
   `deepen`, NOT as another hook.
