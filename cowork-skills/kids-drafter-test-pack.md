# /kids Drafter Test Pack — for fresh Sonnet 4.6 conversation

**What this is:** everything Sonnet 4.6 needs to draft the /kids page for Riverwood Chapel. The page drafter skill spec + all upstream inputs (page metadata, sections with feeling-led section_jobs, voice card with writer's-brief fields, atoms, facts, Brixies template schemas, cross-cutting persuasive patterns).

**How to use it:**

1. Open a fresh Cowork conversation with Sonnet 4.6 as the model.
2. Paste this whole file as your message.
3. Sonnet should return ONE JSON object matching the schema in the system prompt (page_slug, strategic_setup, sections[], page_audit, gaps_flagged[], _confidence_log{}).
4. Compare its output to the dry-run version at `cowork-skills/riverwood-page-kids-dry-run.json` to see how the real model handles the brief vs how I (Opus) hand-crafted it.

**What we're testing:**
- Does Sonnet write invitational hero descriptions (naming the parent's desire) or slot-fill with logistics?
- Does it honor the heading-is-a-label / tagline-strategy / description-is-the-body architecture?
- Does it lift verbatim atoms, use branded vocabulary, avoid banned terms?
- Does it pick alternatives well for high-stakes slots?

---

## SYSTEM PROMPT (web-page-drafter skill)

Treat everything between the fences as your operating instructions for this task.

```
You are a senior copywriter for Church Media Squad, drafting copy for ONE church website page at a time. The brief in front of you is complete: voice card (with signature moves, sample sentences in voice, persuasive posture per persona, positive voice rules), section planner (with section_job and tagline_strategy per section), content_page_map (atoms pinned to slots), Brixies template schemas (slot constraints).

Your job is to write persuasive, on-brand, source-grounded copy that reads like a senior CMS writer wrote it — not safe slot-fills.

THE BRIXIES HERO ARCHITECTURE (most important thing to get right)

The h1 is ALWAYS a clean page label or program name. "Kids". "Visit". "Give". "Kids City". Never a hook, never clever, never a complete sentence. Past CMS sites overloaded the h1; v2 stops doing that. The h1 orients ("you are on the Kids page"); persuasion happens below it.

The tagline slot (small eyebrow above the h1) follows the section planner's tagline_strategy:
- informational → factual qualifier (service times, age groups, programs)
- hook → short persuasive promise (one line)
- omit → leave empty

The description slot (body below h1) is where the persuasive prose lives, addressing the visitor's actual concern from the section_job.

THE SEVEN HARD RULES

1. HEADING IS A CLEAN LABEL. Heading slot = page label or branded program name. Never a hook, never a sentence, never longer than ~3-4 words (unless it's a named program). Tagline follows tagline_strategy. Description carries the persuasive body.

2. WRITE TOWARD THE section_job. Every section has a section_job stating its persuasive intent. The drafter writes TOWARD that job — addressing the visitor's real concern in voice — not slot-filling against atoms.

3. USE THE VOICE CARD AS A WRITER'S BRIEF. Read signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona. The brand's voice atoms + persuasive postures shape every sentence. The copy you produce should feel adjacent to the voice card's sample sentences.

4. GENERATE ALTERNATIVES FOR HIGH-STAKES SLOTS. For tagline (when strategy is hook), description (hero body), primary CTA, hero subheading: produce 2-4 alternatives and pick the best against (a) section_job, (b) voice card signature moves, (c) the page's primary persona's posture, (d) banned-term/cliché avoidance, (e) positive audits. Record alternatives in alternatives_considered.

5. VERBATIM ATOMS PRESERVED EXACTLY. Atoms with verbatim=true appear unchanged. Mission, vision, x_factor lifts come verbatim. Branded vocabulary case-sensitive (Foyer not foyer). If a verbatim atom exceeds max_chars: use body_short if populated; else skip and flag.

6. DON'T SHOEHORN. Required slots MUST fill. Optional slots stay empty unless an atom backs them. Groups fill to actual atom count, not default_count. Image slots stay empty (designer fills). Secondary CTAs only when a second role='cta' atom exists.

7. SOURCE INTEGRITY + ALL HARD RULES. Every ministry name, service time, address, URL, pastor name, program traces to an atom or fact. Banned terms forbidden. AI clichés forbidden (delve, tapestry, unlock, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, testament, "in a world where"). Church clichés forbidden (come as you are, life-changing, vibrant community, spiritual journey, walk with God). No em-dashes. No triads. No filler intensifiers (truly, really, deeply, incredibly, very, amazing, just). No contrastive constructions. No We/Our in body. No two consecutive sentences with same opener. Jesus named explicitly per major section. Primary CTA direct verb.

8. SELF-REVISE BEFORE OUTPUT. After first draft, re-read every section. For any slot that's generic, slot-filled, off-voice, or fails any audit: regenerate. Only after this pass produces the final output.

INPUTS
1. Page metadata (slug, name, persona primacy, keywords)
2. Section list with concept_id, template_id, section_job, tagline_strategy
3. Bound template fields[] schemas
4. content_page_map slice (atoms × page × role × treatment)
5. Voice card v2 — lift fields (branded_vocabulary, banned_terms, syntax_rules, persona_snapshots, mission, x_factor, anti_models, example_phrases_good/bad) AND synthesis fields (signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona)
6. church_facts (service times, address, phone, staff)
7. references/web-writing-rules.md + references/cms-persuasive-patterns.md

OUTPUT
Return ONE JSON object per page (schema in spec). Required top-level: page_slug, primary_persona, persuasive_frame, strategic_setup, sections[], page_audit (with both negative_checks and positive_checks), gaps_flagged[], _confidence_log{}. Per-section required: sort_order, concept_id, template_id, section_job, tagline_strategy, field_values, alternatives_considered (for high-stakes slots), atoms_lifted_canonical[], voice_check_notes.

WORKFLOW PER PAGE
1. Load context.
2. Identify the page's persuasive frame (primary persona → posture from voice card).
3. Compose strategic_setup (metadata + AEO snippet).
4. Draft sections in order. For each slot: heading = clean label; tagline = follow strategy; description = address section_job in voice (with alternatives for hero descriptions); buttons = from content_page_map; groups = actual atom count; image = empty.
5. Self-revise pass — re-read, regenerate weak slots.
6. Verbatim verification.
7. Page audit (positive + negative) + confidence_log + gaps_flagged.

WHAT GOOD LOOKS LIKE
- Heading slots are clean labels every time (no hooks)
- Tagline slots match the assigned strategy
- Descriptions address the section_job in voice — a reader would feel something
- Sample alternatives demonstrate real choices made against voice + section_job
- Verbatim atoms preserved exactly
- Branded vocab used consistently
- Both positive and negative audits pass
- Self-revise shows visible improvement over first-pass drafts

WHAT BAD LOOKS LIKE (you will be rejected)
- Heading slot is a hook or complete sentence
- Tagline strategy violated
- Description is generic, slot-filled, or doesn't address section_job
- Any banned_term, AI cliché, or church cliché present
- Em-dashes, triads, filler intensifiers, contrastive constructions
- No alternatives for high-stakes slots
- Self-revise didn't change anything from the first draft
- Invented facts without atom backing
- Empty required slots
- max_chars violations

Return only the JSON. Begin.
```

---

## INPUTS

### 1. Page metadata (from sitemap)

```json
{
  "slug": "/kids",
  "name": "Kids at Riverwood",
  "phase": "1",
  "primary_persona": "The Suburban Family",
  "secondary_personas": [],
  "purpose": "The Suburban Family's critical conversion page. Confirm kids ministry is safe, organized, and curriculum-grounded (Gospel Project).",
  "sort_order": 5,
  "keywords": {
    "primary": [
      "Riverwood Chapel kids",
      "Kids ministry Kent Ohio",
      "Children's church Kent"
    ],
    "secondary": [
      "Riverwood nursery",
      "Sunday school Kent Ohio",
      "Kids check-in Riverwood Chapel",
      "Gospel Project curriculum Kent",
      "Kids Wing Kent church",
      "Children Sunday programs Kent OH"
    ],
    "long_tail": [
      "Where is the kids wing at Riverwood Chapel",
      "Pre-register Riverwood Chapel kids",
      "Age groups Riverwood kids ministry"
    ],
    "local": [
      "Family church Kent OH",
      "Kids programs Portage County",
      "Kent Ohio Sunday school"
    ]
  }
}
```

### 2. Sections to draft (each with section_job + tagline_strategy + bound template_id)

The section_planner already assigned the persuasive intent (`section_job`) per section and the tagline strategy (`tagline_strategy`) per hero. The drafter writes TOWARD the job, not just into the slots.

```json
[
  {
    "sort_order": 1,
    "concept_id": "hero_inner",
    "section_job": "Make a parent feel that their kid will be loved here and want to come back. Address the parent's actual desire (a child who loves church and is known by name), not their logistics question",
    "tagline_strategy": "informational",
    "intent_summary": "Kids at Riverwood hero. Tone-aware for primary persona (The Suburban Family).",
    "atom_external_ref_ids": [],
    "template_id": "hero-section-102"
  },
  {
    "sort_order": 2,
    "concept_id": "content_image_text",
    "section_job": "Help a parent feel that what their kid hears on Sunday is the real thing, taught by people who are actually partnering with them as parents",
    "tagline_strategy": null,
    "intent_summary": "What kids learn at Riverwood — Gospel Project curriculum, partnership with parents in childhood discipleship.",
    "atom_external_ref_ids": [],
    "template_id": "content-section-1"
  },
  {
    "sort_order": 3,
    "concept_id": "feature_card_grid",
    "section_job": "Let each parent see their kid on this page — at their age, in their stage — so they know the church has thought specifically about who their child is",
    "tagline_strategy": null,
    "intent_summary": "3 age tiers as cards (Open Arms Nursery, Preschool, Elementary).",
    "atom_external_ref_ids": [
      "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_0",
      "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_1",
      "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_2"
    ],
    "template_id": "feature-section-14"
  },
  {
    "sort_order": 4,
    "concept_id": "feature_unique",
    "section_job": "Walk a nervous parent through the exact moment of Sunday morning when their hand will leave their kid's, and make it feel okay",
    "tagline_strategy": null,
    "intent_summary": "Kids check-in process as a 4-step numbered flow. Process Section concept.",
    "atom_external_ref_ids": [],
    "template_id": "feature-section-1"
  },
  {
    "sort_order": 5,
    "concept_id": "cta_simple",
    "section_job": "Turn a parent's 'we're going to try it' into a small action right now that means Sunday morning is already easier",
    "tagline_strategy": null,
    "intent_summary": "Pre-register your kids — Church Center check-in URL.",
    "atom_external_ref_ids": [],
    "template_id": "banner-section-1"
  }
]
```

### 3. Bound Brixies template schemas

The binder has already picked one template variant per section. These are the field schemas the drafter writes `field_values` into. Honor `required`, `max_chars`, and `kind` (slot vs group).

```json
[
  {
    "id": "hero-section-102",
    "layer_name": "Hero Section 102",
    "family": "Hero Section",
    "fields": [
      {
        "key": "tagline",
        "kind": "slot",
        "type": "text",
        "max_chars": 60,
        "layer_name": "Tagline"
      },
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "buttons",
        "kind": "group",
        "layer_name": "Buttons",
        "item_schema": [
          {
            "key": "contact",
            "kind": "slot",
            "type": "text",
            "label": "Button label",
            "scope": "button",
            "max_chars": 30,
            "layer_name": "Contact"
          }
        ],
        "default_count": 2
      }
    ]
  },
  {
    "id": "content-section-1",
    "layer_name": "Content Section 1",
    "family": "Content Section",
    "fields": [
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "buttons",
        "kind": "slot",
        "type": "cta",
        "label": "CTA",
        "layer_name": "Buttons"
      }
    ]
  },
  {
    "id": "feature-section-14",
    "layer_name": "Feature section 14",
    "family": "Feature Section",
    "fields": [
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "image",
        "kind": "slot",
        "type": "image",
        "layer_name": "Image"
      },
      {
        "key": "card",
        "kind": "group",
        "layer_name": "Card",
        "item_schema": [
          {
            "key": "heading_card",
            "kind": "slot",
            "type": "text",
            "required": true,
            "max_chars": 100,
            "layer_name": "Heading",
            "heading_level": 2
          },
          {
            "key": "description_card",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Description"
          },
          {
            "key": "buttons_card",
            "kind": "slot",
            "type": "cta",
            "label": "CTA",
            "layer_name": "Buttons"
          }
        ],
        "default_count": 3
      }
    ]
  },
  {
    "id": "feature-section-1",
    "layer_name": "Feature Section 1",
    "family": "Feature Section",
    "fields": [
      {
        "key": "container_left",
        "kind": "group",
        "layer_name": "Container left",
        "item_schema": [
          {
            "key": "heading",
            "kind": "slot",
            "type": "text",
            "required": true,
            "max_chars": 100,
            "layer_name": "Heading",
            "heading_level": 2
          },
          {
            "key": "description",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Description"
          }
        ],
        "default_count": 2
      }
    ]
  },
  {
    "id": "banner-section-1",
    "layer_name": "Banner Section 1",
    "family": "Banner Section",
    "fields": [
      {
        "key": "info_wrapper",
        "kind": "group",
        "layer_name": "Info wrapper",
        "item_schema": [
          {
            "key": "description",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Info"
          }
        ],
        "default_count": 6
      }
    ]
  }
]
```

### 4. Content page map (atoms × this page × role × treatment)

```json
[
  {
    "atom_external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_0",
    "page_slug": "/kids",
    "section_sort_order": 3,
    "role": "canonical",
    "treatment": "Full content on /kids. Section 3."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_1",
    "page_slug": "/kids",
    "section_sort_order": 3,
    "role": "canonical",
    "treatment": "Full content on /kids. Section 3."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_2",
    "page_slug": "/kids",
    "section_sort_order": 3,
    "role": "canonical",
    "treatment": "Full content on /kids. Section 3."
  }
]
```

### 5. Atoms referenced on this page

```json
[
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_0",
    "topic": "kids_ministry",
    "label": null,
    "body": "Sunday SchoolIt is our hope that the plan for childhood discipleship at Riverwood would encourage and enhance the discipleship efforts of the parents and guardians of Riverwood kids.Open Arms Nursery9:00am, 10:15am, and 11:30amOpen Arms Nursery provides infants through toddlers with a routine of welcome, Bible stories, playtime, and snack. Once a toddler is three and potty trained, they “graduate” to the Jr Pre K class.Preschool Classes9:00am, 10:15am, and 11:30amPreschool Classes are open to children who are three years old – Kindergarten. Here they will enjoy a time of singing and dancing, a Bible story from&nbsp;the Gospel Project curriculum, and a corresponding craft or game to develop the truth from God’s Word.Elementary Classes9:00am, 10:15am, and 11:30amElementary Classes are open to kids in 1st – 4th grade. Kids will participate in a Bible lesson from&nbsp;the Gospel Project curriculum, worship, and an application game or craft to develop the truth from God’s Word.Ministry LeadersJosh Miller - Kids &amp; Middle School Pastor&nbsp;josh.miller@riverwoodchapel.org330-227-4791Cora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": true,
    "source_kind": "content_collection",
    "metadata": {}
  },
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_1",
    "topic": "kids_ministry",
    "label": null,
    "body": "Middle SchoolSunday Morning5th-6th Grades - 10:15-11:15am in room 1017th-8th Grades - 10:15-11:15am in the Student CenterJoin us as we look at big truths in the Bible and see how it relates to everyday life.&nbsp;Middle School NightWednesdays 6:30-8:30pm GymOn Wednesday nights, the doors to our building are open to 5th–8th graders for the best night of their week! Middle School Night is a high-energy program that includes gym games, teaching time, and times in small groups. It’s a great opportunity for students to connect with their peers, small group leaders, and most importantly God.CLICK HERE TO SEE THE SCHEDULEMinistry LeaderAJ Coy - Director of Middle School Ministryaj.coy@riverwoodchapel.orgCora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": true,
    "source_kind": "content_collection",
    "metadata": {}
  },
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_2",
    "topic": "kids_ministry",
    "label": null,
    "body": "High SchoolSunday Morning&nbsp;10:15-11:15am in the Gathering SpaceJoin us on Sunday mornings at 10:15am in the Gathering Space, as we follow along with the sermon series and discuss the passage together. Whether you go to worship before or after, our Sunday Morning Bible Study is a great way to connect with your peers and apply God’s Word to your life.Sunday Night GatheringVarious Sunday Nights - 6:30-8:30pm in the GymGathering nights are a time for our whole youth group to come together, connect, and grow. These nights are designed to be low-pressure, fun, and welcoming—perfect for inviting friends and building relationships within the larger youth group. Whether you’re a student looking to meet new people or grow as a follower of Jesus, our Gatherings are the place to start. It’s more than just a hangout—it’s the foundation for real community and meaningful Gospel conversations. Come be a part of it!CLICK HERE TO SEE THE SCHEDULESmall GroupSunday nights - 6:30–8:30pm - Locations vary by groupSmall Group nights provide a slower, more focused time for students to connect on a deeper level with their peers and leaders. Come be a part of intentional Bible study, prayer, and meaningful conversations with other students with a desire to know and follow Jesus. Small Groups are a space to grow, be encouraged, and do life together.Ministry LeaderJosiah Keating - Director of High School Ministry&nbsp;josiah.keating@riverwoodchapel.orgCora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": true,
    "source_kind": "content_collection",
    "metadata": {}
  }
]
```

### 6. Relevant facts (service times, check-in URL, address, phone, staff)

```json
[
  {
    "topic": "service_time",
    "body": "Sunday 7:45",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Weekend Services > Service Details > 'Service Times')",
    "external_ref_id": "contentsnare:weekend-services:service-details:rfld_E4Kl68c5EE5vd7:parsed_0",
    "metadata": {
      "day": "Sunday",
      "time": "7:45",
      "raw_context": "Sundays at 7:45, 9:00, 10:15, and 11:30\n\n(All four of the worship services are identical, with kids' programming at every service except 7:45)"
    }
  },
  {
    "topic": "service_time",
    "body": "Sunday 9:00",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Weekend Services > Service Details > 'Service Times')",
    "external_ref_id": "contentsnare:weekend-services:service-details:rfld_E4Kl68c5EE5vd7:parsed_1",
    "metadata": {
      "day": "Sunday",
      "time": "9:00",
      "raw_context": "Sundays at 7:45, 9:00, 10:15, and 11:30\n\n(All four of the worship services are identical, with kids' programming at every service except 7:45)"
    }
  },
  {
    "topic": "service_time",
    "body": "Sunday 10:15",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Weekend Services > Service Details > 'Service Times')",
    "external_ref_id": "contentsnare:weekend-services:service-details:rfld_E4Kl68c5EE5vd7:parsed_2",
    "metadata": {
      "day": "Sunday",
      "time": "10:15",
      "raw_context": "Sundays at 7:45, 9:00, 10:15, and 11:30\n\n(All four of the worship services are identical, with kids' programming at every service except 7:45)"
    }
  },
  {
    "topic": "service_time",
    "body": "Sunday 11:30",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Weekend Services > Service Details > 'Service Times')",
    "external_ref_id": "contentsnare:weekend-services:service-details:rfld_E4Kl68c5EE5vd7:parsed_3",
    "metadata": {
      "day": "Sunday",
      "time": "11:30",
      "raw_context": "Sundays at 7:45, 9:00, 10:15, and 11:30\n\n(All four of the worship services are identical, with kids' programming at every service except 7:45)"
    }
  },
  {
    "topic": "contact_method",
    "subtopic": "url",
    "body": "https://riverwoodchapel.churchcenter.com/registrations",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "Riverwood Chapel.json (Events > Events > 'Please provide a link to your events:')",
    "external_ref_id": "contentsnare:events:events:rfld_VwL6zxcwaXrWL2",
    "metadata": {
      "field": "Please provide a link to your events:",
      "value": "https://riverwoodchapel.churchcenter.com/registrations"
    }
  }
]
```

### 7. Voice card v2 (the writer's brief)

Lift fields: branded_vocabulary, banned_terms, syntax_rules, mission, x_factor, personas, anti_models, example_phrases_good/bad. Synthesis fields (the writer's brief proper): signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona.

```json
{
  "tone_descriptors": [
    "warm",
    "shepherding",
    "understated",
    "multigenerational",
    "authentic",
    "steady"
  ],
  "banned_terms": [
    "delve",
    "tapestry",
    "unlock",
    "unleash",
    "elevate",
    "beacon",
    "embark",
    "resonate",
    "dynamic",
    "synergistic",
    "game-changer",
    "testament",
    "in a world where",
    "at the heart of",
    "journey of faith",
    "truly",
    "really",
    "deeply",
    "incredibly",
    "amazing",
    "just",
    "lobby",
    "atrium",
    "sanctuary",
    "auditorium",
    "Emmanuel",
    "RCC",
    "RC",
    "Riverwood Community Chapel"
  ],
  "branded_vocabulary": {
    "Riverwood": "preferred short form",
    "Riverwood Chapel": "preferred long form",
    "Foyer": "not lobby or atrium",
    "Worship Center": "not sanctuary or auditorium",
    "Welcome Center": "the desk in the Foyer",
    "Immanuel": "preferred spelling, not Emmanuel",
    "Carport": "specifically for the area in front of main doors",
    "Gym Carport": "the smaller carport on the far right",
    "Kids Wing": "the west end / hallways",
    "Meeting Room": "the room off the airlock",
    "Resource Room": "the office supply room",
    "Child care": "open play time",
    "Sunday school class": "structured Bible lesson"
  },
  "denominational_filter": "evangelical-non-denominational",
  "mission_statement": "To know Jesus, to be known, and to make Him known.",
  "x_factor": "A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.",
  "persona_snapshots": [
    {
      "label": "The Suburban Family",
      "attributes": "Parents of children somewhere between newborn and high school. Live in Kent or the surrounding Portage County suburbs. Middle to upper-middle class. Likely some prior church background — may be returning, may be casually shopping, may be already attending Riverwood and looking for the next step for their kids. The discovery describes the broader demographic as suburban, not exurban or rural.",
      "needs": [
        "Confidence that the Kids Wing is safe, organized, and well-staffed",
        "A Sunday experience that works with kids in tow — pre-registration, easy check-in, clear directions",
        "Programming that respects an already-full family schedule",
        "A multigenerational community where their kids are around adults who are not their parents",
        "Real teaching for them, not just for the kids"
      ],
      "scares_off": [
        "Mega-church vibes — explicitly named by Riverwood as the feeling to avoid",
        "Kids ministry that looks disorganized, under-staffed, or vague",
        "Theological vagueness",
        "Implied schedule demands before they've even attended"
      ],
      "voice_resonance": "Practical and specific. 'Pre-register on the way and check-in takes 30 seconds. The Kids Wing has its own entrance through the carport.' Warm without being saccharine. Brand-aligned: friend-not-presenter, intentional, every word purposeful.",
      "entry_pages": [
        "/visit",
        "/kids",
        "/adult-studies",
        "/connect",
        "/"
      ],
      "critical_conversion_page": "/kids",
      "grounded_in": "discovery.community_and_audience.who_actively_trying_to_engage + discovery.community_focus.how_to_adapt_to_community_needs + community_struggles 'Families - Kids and student ministry programs'"
    },
    {
      "label": "The Kent State Student",
      "attributes": "Undergraduate at Kent State (or possibly a recent graduate or grad student). Lives on or near campus. Faith background variable: could be raised in the church and testing inherited belief, could be exploring church for the first time, could be returning after stepping away. The discovery doesn't specify but the description of 'heavy campus partnerships' signals Riverwood actively goes to where students are.",
      "needs": [
        "A college-specific surface in the navigation that names her without lumping her in with high schoolers or families",
        "Clear meeting times that fit a college schedule",
        "An authentic register that doesn't try to be cool for college students",
        "Pastoral access — direct contact with a named director or pastor",
        "Visibility for ministry partnerships with Kent State"
      ],
      "scares_off": [
        "Mega-church anonymity (feeling like one of 1,000 in a service with no one knowing them)",
        "Family-only programming language",
        "Slick stage production with no actual relationship behind it",
        "'Youth ministry' framing aimed at high schoolers extended to college"
      ],
      "voice_resonance": "Authentic, direct, not trying. 'Wednesday nights at 7 in the Worship Center. Bring a friend or come alone. Both work.' Brand-aligned: unpolished, relational, real.",
      "entry_pages": [
        "/students-college",
        "/visit",
        "/watch",
        "/connect"
      ],
      "critical_conversion_page": "/students-college",
      "grounded_in": "discovery.community_and_audience 'Kent State - College ministry and heavy campus partnerships' + community_focus 'Kent State - college student' + stated audience 'College students.'"
    },
    {
      "label": "The Person in a Hard Season",
      "attributes": "Someone in Kent or Portage County facing a specific moment of difficulty. The discovery names multiple categories of hardship Riverwood serves: addiction recovery, grief, cancer care, family crisis, financial hardship (food pantry). Demographics vary — could be a young adult in recovery, a middle-aged person in grief, an older person in cancer treatment, a struggling family without enough food. Faith background variable; some attendees come to a Care program before they'd ever come to a Sunday service.",
      "needs": [
        "Permission to show up as they are, with the burden visible",
        "Specific named programs, not vague reassurance — Celebrate Recovery, GriefShare, Overcome, Care 101, Food Pantry",
        "Confidentiality and dignity baked into the language",
        "A church positioned as a hospital, not a country club",
        "Easy first-touch — prayer form, Care Team contact, or quiet visit to a program without committing to Sunday attendance"
      ],
      "scares_off": [
        "Theology that shames struggle",
        "Sales energy ('Jesus will fix this!')",
        "Performative care without specifics",
        "Insider church language that gates access",
        "Implied judgment about why they're in crisis"
      ],
      "voice_resonance": "Safe, non-judgmental, plain. 'GriefShare meets Thursdays at 7pm in the Foyer. Walk in, sit down, share what you want or sit quietly. Both are welcome.' Brand-aligned: steady, wise, dependable, multigenerational.",
      "entry_pages": [
        "/care",
        "/outreach",
        "/watch",
        "/visit"
      ],
      "critical_conversion_page": "/care",
      "grounded_in": "discovery community_struggles 'Care - families, deaths, crisis etc.' + 'People in need - food pantry' + most_effective_engagement 'Care related things' + named CR (Celebrate Recovery) program"
    },
    {
      "label": "The Established Member",
      "attributes": "Has been part of Riverwood for years or decades, or moved to Kent and joined an established faith community there. Faith is settled and central. Likely 45+ but the multigenerational value means this segment spans middle-aged through retired. Knows the leadership team by name. Has watched the church grow from the 1991 start, the move to Fairchild Ave in 1997, the staff additions, the gym expansion in 2019, the growth to four services in 2024.",
      "needs": [
        "Recognition of the church's history and longtime members' role",
        "Continued pastoral access — real, reachable people",
        "Local outreach that's specific and active",
        "Building campaign updates that are transparent and biblically framed",
        "Multigenerational identity preserved"
      ],
      "scares_off": [
        "Anything signaling the church is forgetting its roots",
        "Watered-down doctrine",
        "Pure marketing energy aimed at newcomers with no recognition of the existing congregation"
      ],
      "voice_resonance": "Multigenerational, grateful, rooted in legacy without being stuck in it. The brand voice (measured, wise, dependable) is exactly right for this audience. References to the church's history carry weight when used precisely.",
      "entry_pages": [
        "/outreach",
        "/give",
        "/care",
        "/story-beliefs",
        "/events"
      ],
      "critical_conversion_page": "/outreach",
      "grounded_in": "discovery.messaging_and_voice value 'A Multigenerational Community' + 35-year church history + sustained 1,000 weekly attendance + value 'Accessible and Adaptable Leadership'"
    }
  ],
  "syntax_rules": {
    "no_em_dash": true,
    "no_triads": true,
    "no_filler_intensifiers": true,
    "no_contrastive_constructions": true,
    "you_your_in_body": true,
    "no_we_our_in_body": true,
    "oxford_comma": true,
    "max_paragraph_sentences": 3,
    "max_h1_words": 7,
    "max_one_exclamation_per_sentence": true,
    "space_after_colon_two": true,
    "punctuation_inside_quotes": true,
    "italicize_book_titles": true,
    "numerals_for_ages_grades_addresses_phones_financial": true,
    "numerals_for_10_and_above": true,
    "hyphenate_number_adjectives": true,
    "apostrophe_for_dropped_decade_digits": true,
    "abbreviate_days_months": true,
    "allow_en_dash_for_ranges": true,
    "drop_zero_minutes": true,
    "am_pm_at_end_of_range": true,
    "no_date_time_shorthand": true,
    "phone_format": "330.678.7000",
    "url_format": "no_www",
    "no_ampersand_or_at_symbol_in_prose": true,
    "no_hyphenate_numbers_at_line_break": true,
    "theological_capitalization": [
      "Capitalize 'Gospel' when referring to a specific book of the Bible or the four Gospels. Use lowercase 'gospel' for general references to the Christian message.",
      "Always capitalize He, Him, and His when referring to the Father, Son, or the Holy Spirit.",
      "Use uppercase 'Word' when referring specifically to Jesus or the Bible (God's Word)."
    ]
  },
  "example_phrases_good": [
    "know Jesus",
    "being known",
    "family/home",
    "Shepherding",
    "<ul><li>“To know Jesus, to be known, and to make Him known”</li><li>Home</li><li>A place to feel known</li><li>Not just in the community, but part of it.&nbsp;</li></ul><div><br></div><div>Brand Campaign Slogans:<br><ul><li>\"<em>Built for Belonging”</em></li><li><em><em><em>“Breath Again”</em></em></em></li><li><em><em><em><em>“Jesus at the Center”</em></em></em></em></li><li><em><em><em><em><em><em>“Kent Knows Us”</em></em></em></em></em></em></li></ul></div>"
  ],
  "example_phrases_bad": [
    "come as you are",
    "life-changing",
    "vibrant community",
    "spiritual journey",
    "walk with God"
  ],
  "anti_models": [
    {
      "name": "Redemption Chapel",
      "url": "https://redemptionchapel.com",
      "what_to_avoid": "these are both close to us and we want to be different enough from them. I know CCC has green as well, but I think we can be different enough."
    },
    {
      "name": "Christ Community Chapel",
      "url": "https://ccchapel.com",
      "what_to_avoid": "these are both close to us and we want to be different enough from them. I know CCC has green as well, but I think we can be different enough."
    }
  ],
  "signature_moves": [
    "Lead with the visitor's situation, not the church's claim about itself",
    "Pin every claim to a specific time, place, or program (services at 7:45, 9, 10:15, 11:30am; Foyer; Carport; Kids Wing)",
    "Use Riverwood's branded place names — Foyer over lobby, Worship Center over sanctuary, Kids Wing over children's hall",
    "Short declarative sentences in moments of warmth; longer when explaining",
    "Multigenerational framing — write so a 70-year-old and a 25-year-old both feel addressed",
    "Quiet confidence over volume — never sales energy, never exclamation pile-ons",
    "Name what to expect before asking for action (walk visitors through arrival before asking them to plan)",
    "Honor the gap between where the visitor is and where they want to be — especially for someone in a hard season"
  ],
  "positive_voice_rules": [
    "Open with a concrete moment, not an abstract claim",
    "Address the visitor's posture, not the church's identity",
    "Use 'you' or 'your' in the first line of every section",
    "Pin every promise to a specific time, place, or program — never abstract",
    "Use Riverwood's branded place names verbatim; never substitute generic equivalents",
    "Pair conversion CTAs with a no-pressure secondary option (e.g., 'plan a visit, or walk in this Sunday')",
    "Frame next steps as joining a story or finding a place, not completing a transaction",
    "When writing for someone in difficulty, give permission to show up as they are — no pressure, no fix-it energy",
    "Use multigenerational framing — write so families, college students, and longtime members all feel addressed"
  ],
  "sample_sentences_in_voice": [
    "Kids",
    "Visit",
    "Care",
    "Our Story",
    "Newborns through 5th grade · Sundays 9, 10:15, 11:30am",
    "Sundays 7:45, 9, 10:15, 11:30am · Fairchild Ave.",
    "A big church that wants to feel small",
    "Here on Fairchild since 1997",
    "Sundays your kids will look forward to. Riverwood partners with parents to help your kid know Jesus and feel known by the people teaching them.",
    "You don't have to be okay to come here. Whatever season you're in, someone at Riverwood has walked it, and there's a real path through it with you.",
    "Walking into a new church takes more than most people admit. Nothing about Sunday morning here is going to require courage you don't have.",
    "A big church that wants to feel small. That's been the same since Riverwood started in 1991, and it's still the point.",
    "GriefShare meets Thursdays at 7pm in the Foyer. You can share what you want, or sit quietly.",
    "Wednesday nights at 7 in the Worship Center. Bring a friend or come alone. Both work.",
    "Find your place at Riverwood. Plan your visit ahead of time, or walk in this Sunday.",
    "Pre-register your kids. Two minutes now means a faster Sunday morning."
  ],
  "persuasive_posture_by_persona": {
    "The Suburban Family": {
      "fear_to_disarm": "Will my kid be safe? Will Sunday morning actually work for our family without becoming another logistics problem?",
      "desire_to_name": "A church that respects our family's time and treats our kids as more than a daycare problem",
      "proof_to_offer": "Named Kids Wing entrance through the carport, 30-second check-in, vetted staff, four service times across Sunday morning, multigenerational community where kids are around adults who aren't their parents",
      "register_notes": "Practical and specific. Times, places, names. Warm without saccharine. Acknowledge that getting the family out the door is hard."
    },
    "The Kent State Student": {
      "fear_to_disarm": "Will I get lost in a sea of families? Will this be the high school youth group extended to college?",
      "desire_to_name": "A college-specific community that doesn't try to be cool but actually shows up on campus",
      "proof_to_offer": "Wednesday college nights, named director, on-campus partnerships at Kent State, real one-on-one relationships with pastors and peers",
      "register_notes": "Authentic, direct, not trying. Plain invitations. 'Bring a friend or come alone. Both work.' Never use 'youth' language for college; never lump college in with high schoolers."
    },
    "The Person in a Hard Season": {
      "fear_to_disarm": "Will I be judged? Will someone try to fix me or sell me something I don't have the bandwidth for?",
      "desire_to_name": "A place where my burden is welcome and someone has a real path through this",
      "proof_to_offer": "Specifically named programs (Celebrate Recovery, GriefShare, Care 101, Food Pantry, Overcome), confidential first-touch, ability to attend a Care program without committing to Sunday service",
      "register_notes": "Safe, non-judgmental, plain. Permission to show up as you are with the burden visible. Never assume the reader is a Christian; name the program, the time, the place, and let the visitor decide."
    },
    "The Established Member": {
      "fear_to_disarm": "Is my church forgetting where it came from? Is it watering down what we've built over the last 35 years?",
      "desire_to_name": "Recognition that this community has deep roots, and a continued role for me in its next chapter",
      "proof_to_offer": "Specific references to church history (1991 start, 1997 move to Fairchild, growth to four services in 2024), pastoral access, transparent updates on building campaigns",
      "register_notes": "Multigenerational, grateful, rooted in legacy without being stuck in it. References to history carry weight when used precisely — name the year, name the place."
    }
  },
  "_confidence_log": {
    "tone_descriptors": "lifted_from_brief",
    "banned_terms": "lifted_from_global + lifted_from_brand_guide",
    "branded_vocabulary": "lifted_from_brand_guide",
    "denominational_filter": "lifted_from_brief",
    "mission_statement": "lifted_from_brief",
    "x_factor": "lifted_from_brief",
    "persona_snapshots": "lifted_from_brief",
    "syntax_rules": "lifted_from_global + lifted_from_brand_guide",
    "example_phrases_good": "lifted_from_discovery",
    "example_phrases_bad": "lifted_from_global",
    "anti_models": "lifted_from_discovery",
    "signature_moves": "synthesized_from_atoms",
    "positive_voice_rules": "synthesized_from_atoms",
    "sample_sentences_in_voice": "synthesized_from_atoms",
    "persuasive_posture_by_persona": "synthesized_from_atoms"
  },
  "_unfilled_with_reason": {}
}
```

### 8. Cross-cutting CMS persuasive patterns


**Cross-cutting persuasive patterns** (distilled from four shipped CMS sites):

1. Hero leads with the visitor's posture, never the church's claim about itself.
2. Visitor is protagonist; church is guide; "you" appears in nearly every opening line.
3. A specific felt-fear is named in the visitor's own words, then disarmed.
4. Every page closes with a low-friction next step framed as a story, not a transaction.

**Brixies hero architecture (critical):**
- Heading slot (h1) = always a clean page label or program name (Kids, Visit, Give). Never a hook. Past sites overloaded the h1; v2 stops doing that.
- Tagline slot (above h1) = three strategies per tagline_strategy: informational (factual qualifier), hook (persuasive promise), omit (utility pages).
- Description slot (body below h1) = warm scene-setting, addressing the visitor's actual concern from the section_job. Hero descriptions INVITE — they do not deliver logistics. Logistics live in downstream sections built for them.

**Past hero descriptions that landed (note: each names the parent's actual desire, not logistics):**
- Mosaic /kids: "You want your kids to love church, not just attend… we partner with parents"
- MVCC /kids: "You want your children to have a faith of their own. Partner with a ministry designed to help them build a resilient foundation."
- Real Life /kids: "Partnering with you to help your child love Jesus"

**Encoding shorthand:** {Acknowledge a felt tension or desire} → {Reframe the church/action as the posture-shift} → {Hand the visitor a single small step that feels like joining a story already in motion}. The work happens in the tagline + description, NOT in the h1.


---

## EXPECTED OUTPUT

Return ONE JSON object (no prose before or after, no markdown fences) with this top-level shape:

```json
{
  "page_slug": "/kids",
  "primary_persona": "The Suburban Family",
  "persuasive_frame": {...},
  "strategic_setup": {
    "primary_keyword": "...",
    "secondary_keywords": [...],
    "local_keywords": [...],
    "metadata_title": "...",
    "metadata_description": "...",
    "aeo_smart_snippet": "..."
  },
  "sections": [
    {
      "sort_order": 1,
      "concept_id": "hero_inner",
      "template_id": "hero-section-102",
      "section_job": "...",
      "tagline_strategy": "informational",
      "field_values": {...},                  // keyed by Brixies slot names
      "alternatives_considered": {...},        // for high-stakes slots
      "atoms_lifted_canonical": [...],
      "voice_check_notes": "..."
    },
    ...
  ],
  "page_audit": {
    "negative_checks": {...},
    "positive_checks": {...},
    "voice_match": "...",
    "alternatives_summary": "..."
  },
  "gaps_flagged": [...],
  "_confidence_log": {...}
}
```

**Start now.**
