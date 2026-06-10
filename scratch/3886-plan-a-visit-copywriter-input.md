# Copywriter input dump — 3886 / `plan-a-visit` (rich version)

Replaces the earlier dump (which showed the prompt FORM but had
empty data inside). This version pulls the actual normalized
content from the DB so you can run your own quality tests.

What the prompt **should** contain to write `plan-a-visit` well is
documented below. What it **actually** contains today is degraded
by three bugs — each annotated inline.

Model in production: **anthropic/claude-sonnet-4-6**.

---

## Status check: which inputs are reaching the copywriter?

| Input | What's in DB | What page-draft.ts loads today |
|---|---|---|
| Global merge fields (church_name, address, etc.) | ✅ 12+ fields populated | 🛑 **NOT LOADED** (only loaded custom snippet rows, missed the 16 columns). **Fix shipped this commit.** |
| Custom snippets (web_project_snippets) | ✅ 116 entries | ✅ Loaded |
| Stage 1 (audience / voice card / personas / x_factor) | 🛑 **EMPTY** — extract-strategy hit the 8000-token cap and the tool_use response truncated. Only `_meta` lives in stage_1. | 🛑 Empty → copywriter sees `null` for every field. **Token cap raised to 24K this commit; re-run needed.** |
| Page brief (page_briefs.plan-a-visit) | ✅ exists with page_job, persona_focus, voice_exemplars_to_imitate (5 phrases), voice_anti_exemplars (5), section archetypes, AEO targets | ✅ Loaded |
| Content atoms (normalized facts in `content_atoms`) | ✅ **71 rich entries**: 6 ethos, 3 personas (full descriptions), 5 tone_descriptors, 7 value_statements, 13 voice_rules, 6 voice_samples (gold-quality paragraphs), 5 x_factors, plus stories + prose_snippets + recommended_pages | 🛑 **NONE REACH page-draft** — brief's `reference_atoms` uses slug-shaped ids (`service-times`, `kids-checkin`, `prayer-card`) that don't match content_atoms.id UUIDs. `.in('id', [...])` returns []. |
| Church facts (`church_facts`) | ✅ 110 entries | ❌ Not loaded by page-draft (only by extract-strategy) |
| Strategy brief upload | ✅ Loaded once at intake | Only re-read by extract-strategy at synthesize time |

---

## The actual content the copywriter SHOULD see for plan-a-visit

### Voice samples (verbatim from strategy brief — gold standard for imitation)

> "We know church hasn't always felt like a safe place. We know there are people sitting in our seats right now who came in with that same weight. We are not here to tell you to just get over it or that it wasn't that bad. We're here because we believe that one moment in God's presence can change everything, and because we've seen it happen for people who felt exactly like you do right now. You don't have to have it together to walk through our doors. In fact, we'd rather you didn't."

> "We know Sunday morning is sacred real estate when you've got a 6-year-old in baseball and a 3-year-old who skipped her nap. We're not going to ask you to pretend you have it together or sit through something that doesn't connect to your actual life. What we can promise is that your kids will be safe, known, and loved from the moment you drop them off, and that what you hear in that room will be worth the drive. Come as you are. There's a seat for your whole family here."

> "You don't need to have your theology figured out before you show up. Some of the best conversations that happen start with someone saying the thing everyone else was afraid to say out loud. We believe faith is relational, not institutional, and we mean that more than it sounds like a tagline. Come curious. Bring your questions. We'll take it from there."

### Voice rules (specific do's / don'ts)

- Avoid "have to." Always frame as "we get to."
- Avoid the abbreviation "DSC." Always write "Desert Springs Church" in full.
- Avoid "Visitor." Always say "guest."
- Avoid "Volunteer." Always say "Serve" or "Dream Team Member."
- Avoid "Take the offering." Say "worship God through our giving" / "express generosity" / "receive the offering."
- Use "We" more than "You." Lead with what the community does, feels, or believes.
- Lead with questions, not verdicts. Socratic, thought-provoking. "What would it look like if…" beats "You need to…"
- Never sound aggressive, demanding, or guilt-based. No manufactured urgency.
- Root everything in real story. "Someone's life was changed" is not a story. "A woman named Carla walked into H.O.P.E. not knowing if God still wanted her, and left knowing he did" is.
- Conversational, not casual. Sound like a prepared conversation, not an off-the-cuff comment or a press release.
- Sunday morning teaching tone leans Teacher first, then Coach.
- Say "Global Trip" / "Global Impact" rather than "Mission Trip" / "Missions Impact."
- All church communication (online, on stage, on camera) sounds the same: conversational, welcoming, invitational.

### Tone descriptors

- Conversational — sounds like a friend who takes faith seriously without taking themselves too seriously.
- Down-to-earth directness — does not talk around things. Plain, honest, specific.
- Warm and genuinely personal — the warmth of a community that has cared for people for 28 years, not a brand trained to seem friendly.
- Invitational without being pushy — clear invitation in everything, never tips into pressure.
- Generous and mission-minded — an outward pull in everything.

### Personas (full descriptions — currently only the persona NAME reaches the brief)

**Spiritually curious / church-hurt skeptic** (primary for plan-a-visit):
> Damien Okafor (26), UX designer at a tech startup, single, renting near downtown Chandler, originally from Houston. Grew up in a Christian home but quietly unsettled about faith through his 20s. Values authenticity, intellectual honesty, and community beyond his career. High authenticity radar — if it looks manufactured, he's out. Goals: real community (not networking), a place to ask the questions he's been carrying, something worth giving his Sunday to, and to figure out what he actually believes. Fall Fest was his low-stakes entry point. The Socratic teaching style fits how he thinks.

> Maria Delgado (38), single mom of 13-year-old Isabela. Medical billing coordinator, divorced, moderate income, careful with money. Carries real church hurt from a previous experience that left her feeling judged and unseen. She still believes quietly but is anti-institution. Needs to heal without explaining herself, find something good for her daughter, build community that doesn't require her to be okay, and find her way back to God without losing herself. H.O.P.E. is her entry point before she ever attends a Sunday service.

**Busy parent (Jordan & Ashley)** (secondary):
> Jordan & Ashley Mercer (32 and 31), young family in Chandler's San Tan Ranch neighborhood with two kids (Caleb 6 and Lily 3). Dual-income — Jordan is a Project Manager at a semiconductor company, Ashley a part-time dental hygienist. Married 7 years. Looking for a place the whole family fits, something real (not performance), community that knows their name, and a reason to make Sunday a priority. Jordan grew up loosely Christian and is wary of sales pitches; Ashley is more open. Desert Springs helps through a trusted kids experience, teaching that asks questions rather than delivering verdicts, a down-to-earth culture, and Community Groups as a low-pressure next step.

### X-factors (the church's distinctive identity)

- **Tangible Prayer** — A church where you can actually be prayed for in person by someone who believes it matters. Trained prayer teams after every service. Prayer woven into the posture of the house, not run as a program.
- **A Place for the Hurting** — Known quietly but consistently as a church where hurting people find their way back to God. Early prophetic words: "a hospital for the hurting." That identity has held for 27 years.
- **An Opportunity for Salvation Every Sunday** — Without exception, with trained Dream Team members and prayer teams ready to walk with whoever responds.
- **Present in the Community** — Local outreach: H.O.P.E. ministry, support for nearby schools (San Marcos), Fall Fest, Egg Hunts, care for families from reservation neighborhoods and the homeless population.
- **Missions Generosity** — Set a goal to fund one church in Paraguay and ended up funding four church plants. "Equal sacrifice, not equal giving."

### Value statements (the 7 — what the church believes about itself)

- We are people who are **filled with passion for God**.
- We are people who are **unafraid to dream** — His dreams for our lives are way bigger than anything we could accomplish in our own strength.
- We are people who **embrace today** — today is a gift from God.
- We are people who **leave it better than we found it**.
- We are people who **raise the bar** — like a pole vaulter who keeps raising the bar.
- We are people who **refuse to settle** — we refuse to settle for anything less than the full extent of God's plans.
- We are people who **speak life** — we have the power of life or death in our tongues.

### Vision statement

> Desert Springs is building toward a church known in Chandler not for its programming but for its presence — a community where the 32-year-old working dad who hasn't stepped inside a church in years feels like he belongs from the first Sunday, where lives are visibly changed through prayer and the ministry of H.O.P.E., and where generosity flows so naturally that the church becomes a genuine conduit for kingdom impact locally and globally.

### Mission statement

> Desert Springs Church exists to help people **Connect with God, Grow in Biblical Community, and Go Make a Difference**.

### Founding story

> In 1998 Pastors Brad and Becky Davis felt the call from God to plant a new, life-giving church in Chandler Arizona. Shortly after, several prophetic words were shared about Desert Springs Church being "a hospital for the hurting." Brad and Becky moved from Minnesota to Chandler in 1997 with their 2 children, started Bible study in their living room with a small group, and officially launched on Easter Sunday 1998. They were in rented facilities for 10½ years before having their own building.

### Plan-a-visit specific recommended page rationale (from AM handoff)

> Dedicated "New Here" / first-time guest pathway page covering parking lot, lobby, kids check-in, service experience, and what to expect from the message. Current site lacks any real preview for first-time guests.

### Page brief (currently feeding the copywriter)

```json
{
  "page_job": "Walk a first-time guest, on their phone, through exactly what Sunday looks like — parking, lobby, kids check-in, worship, message, prayer teams, altar response — so nothing is a surprise.",
  "page_slug": "plan-a-visit",
  "persona_focus": {
    "primary": "Spiritually curious / church-hurt skeptic",
    "secondary": "Busy parent (Jordan & Ashley)",
    "rationale": "AM handoff explicitly names this as the primary CTA across the site and the page needing extra attention for first-time guests."
  },
  "atoms_assigned": [],
  "reference_atoms": [
    { "atom_id": "service-times",  "reason": "Hero must surface service times and address." },
    { "atom_id": "kids-checkin",   "reason": "Reference to Kids page for parents who want more detail." },
    { "atom_id": "prayer-card",    "reason": "Cross-link to Contact prayer card." }
  ],
  "voice_exemplars_to_imitate": [
    "come as you are",
    "we'll save you a seat",
    "tangible prayer",
    "we get to",
    "no cheese factor"
  ],
  "voice_anti_exemplars_to_avoid": [
    "Don't miss this Sunday",
    "Visitor",
    "manufactured urgency",
    "insider language (sanctuary, foyer, narthex)",
    "DSC"
  ],
  "section_targets": {
    "section_count": 7,
    "archetypes": [
      "hero", "intro_paragraph", "steps_row", "accordion",
      "image_text_split", "two_up", "contact_band"
    ]
  },
  "aeo_geo_targets": {
    "search_phrases": [
      "what to expect at Desert Springs Church first time",
      "Sunday service times Desert Springs Chandler",
      "Desert Springs Church Chandler"
    ],
    "answer_intents": [
      "What should I wear?",
      "Where do I park?",
      "How does kids check-in work?",
      "How long is the service?",
      "What happens at the end of the service?"
    ],
    "geo_anchors": ["Chandler, AZ"]
  }
}
```

### Global merge fields (NOW being loaded after this commit's fix)

| Token | Value |
|---|---|
| `{{church_name}}` | Desert Springs Church |
| `{{church_short_name}}` | Desert Springs |
| `{{address}}` | 19620 S. McQueen Rd., Chandler, AZ 85286 |
| `{{city_state}}` | Chandler, AZ 85286 |
| `{{phone}}` | 480.726.0399 |
| `{{email}}` | info@desertspringschurch.com |
| `{{denomination}}` | Assemblies of God |
| `{{pastor_name}}` | Brad & Becky Davis |
| `{{all_service_times}}` | 9:00 AM & 11:00 AM |
| `{{social_facebook_url}}` | facebook.com/desertspringschurchaz |
| `{{social_instagram_url}}` | instagram.com/desertspringsaz |
| `{{social_youtube_url}}` | https://www.youtube.com/channel/UCNxZ3dqcFnxgff9NPlyl2LQ |
| `{{current_year}}` | 2026 |

Plus 100+ custom tokens from `web_project_snippets` (full list in earlier dump).

---

## To test in Claude.ai

Compose a single message with:
1. The page-draft system prompt (`src/lib/pipelinePromptsCore.ts:1990` — full text)
2. The voice samples / voice rules / tone descriptors / personas / x-factors / values from this dump (as a "Project voice" block)
3. The page brief JSON
4. The global merge fields + custom snippets (as a `{{token}} -> expansion` list)
5. Trailing instruction: "Write the draft for page `plan-a-visit`. Use the `submit_page_draft` schema."

That's what the copywriter SHOULD have been getting. Run it through both Sonnet 4.6 and Opus 4.8. If Opus does dramatically better on this richer input, the model swap is justified. If Sonnet handles it fine with the richer input, the model isn't the problem — the data flow is.

---

## Critical: why the brief is the bottleneck

The brief currently boils 6 voice_samples + 13 voice_rules + 5 tone_descriptors + 7 value_statements down to **5 voice_exemplars_to_imitate phrases**. That's a massive information loss before the copywriter ever runs.

The data is RIGHT THERE in `content_atoms` for every project, organized by topic (`voice_sample`, `voice_rule`, `tone_descriptor`, `value_statement`, `persona`, `x_factor`, `ethos`, `story`, `mission_statement`, etc.). The copywriter should read those DIRECTLY (filtered by relevance to the page topic), not through the lossy Stage 1 → brief → 5-phrase summary funnel.

---

## What the next architecture wave should look like

```
[Intake docs + crawl]
     ↓
[normalize-intake]            — already exists. Emits content_atoms
                                with topic taxonomy.
     ↓
[per-concern extractors]      — split extract-strategy into smaller
                                agents, each pulling one topic from
                                content_atoms + Stage 0:
  - extract-voice-card        — reads voice_sample + voice_rule +
                                tone_descriptor atoms, emits
                                voice_card (smaller token budget,
                                no truncation risk)
  - extract-personas          — reads persona atoms, emits
                                persona array
  - extract-x-factor          — reads x_factor atoms, picks top 2
  - extract-mission-vision    — reads mission_statement +
                                vision_statement + value_statement
  - extract-topic-plan        — reads web_project_topics +
                                content_atoms, emits coverage plan
     ↓
[stage_1 aggregator]          — composes all the above into
                                roadmap_state.stage_1 (just
                                organizing, no AI re-derivation)
     ↓
[draft-sitemap]               — unchanged
     ↓
[page-briefs]                 — emits brief that REFERENCES the
                                voice_card by ID + picks relevant
                                atom UUIDs per page (by topic match,
                                not fabricated slugs)
     ↓
[page-draft]                  — reads:
                                  - the full voice_card (not a
                                    lossy 5-phrase summary)
                                  - the page's content_atoms by
                                    UUID (real matches)
                                  - global merge fields + custom
                                    snippets (the 16 fields fix
                                    shipped this commit)
                                  - the brief's persona_focus +
                                    page_job
```

Each per-concern extractor has a narrow output (≤4K tokens easily) so it can't truncate the way the monolithic Stage 1 did. And the copywriter sees rich primary-source voice samples instead of a 5-phrase summary.

This is a meaningful refactor. Want me to scope it as Wave 14?
