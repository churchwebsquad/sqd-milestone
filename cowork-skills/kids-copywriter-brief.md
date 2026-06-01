# Copywriter Brief — /kids (Riverwood Chapel, Project 3490)

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded. Sonnet should produce prose for every section in this brief, using the structural markers from the skill.

After Sonnet outputs the prose, you'll invoke `/format-page` and paste `kids-formatter-inputs.md` to produce the Brixies JSON.

---

## Page

```json
{
  "page_slug": "/kids",
  "name": "Kids at Riverwood",
  "primary_persona": "The Suburban Family",
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

## Persuasive Frame (for the primary persona)

```json
{
  "fear_to_disarm": "Will my kid be safe? Will Sunday morning actually work for our family without becoming another logistics problem?",
  "desire_to_name": "A church that respects our family's time and treats our kids as more than a daycare problem",
  "proof_to_offer": "Named Kids Wing entrance through the carport, 30-second check-in, vetted staff, four service times across Sunday morning, multigenerational community where kids are around adults who aren't their parents",
  "register_notes": "Practical and specific. Times, places, names. Warm without saccharine. Acknowledge that getting the family out the door is hard."
}
```

## Sections to Draft

Each section has a `section_job` (feeling-led brief) the copywriter writes toward. Hero sections additionally have `tagline_strategy` (informational / hook / omit).

```json
[
  {
    "sort_order": 1,
    "concept_id": "hero_inner",
    "section_job": "Make a parent feel that their kid will be loved here and want to come back. Address the parent's actual desire (a child who loves church and is known by name), not their logistics question",
    "tagline_strategy": "informational",
    "intent_summary": "Kids at Riverwood hero. Tone-aware for primary persona (The Suburban Family).",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 2,
    "concept_id": "content_image_text",
    "section_job": "Help a parent feel that what their kid hears on Sunday is the real thing, taught by people who are actually partnering with them as parents",
    "tagline_strategy": null,
    "intent_summary": "What kids learn at Riverwood — Gospel Project curriculum, partnership with parents in childhood discipleship.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": "feature_team or content_image_text + named-person callout",
    "proof_person": {
      "name": "Josh Miller",
      "role": "Kids &amp; Middle School Pastor"
    },
    "emotional_weight_no_proof_note": null
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
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 4,
    "concept_id": "feature_unique",
    "section_job": "Walk a nervous parent through the exact moment of Sunday morning when their hand will leave their kid's, and make it feel okay",
    "tagline_strategy": null,
    "intent_summary": "Kids check-in process as a 4-step numbered flow. Process Section concept.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 5,
    "concept_id": "cta_simple",
    "section_job": "Turn a parent's 'we're going to try it' into a small action right now that means Sunday morning is already easier",
    "tagline_strategy": null,
    "intent_summary": "Pre-register your kids — Church Center check-in URL.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  }
]
```

## max_chars Advisory (not enforcement)

These come from the bound Brixies templates. They are advisory — write naturally, aim short, but don't truncate creativity to hit a character count. The `/format-page` step does final fitting.

```json
{
  "hero_inner.tagline": 60,
  "hero_inner.heading": 100,
  "hero_inner.description": 400,
  "content_image_text.heading": 100,
  "content_image_text.description": 400,
  "feature_card_grid.heading": 100,
  "feature_card_grid.description": 400
}
```

## Content_page_map (atoms × this page × role)

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

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (they were HTML-mashed ContentSnare form output). You are FREE to clean and recompose these into web-ready prose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
[
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_1",
    "topic": "kids_ministry",
    "label": null,
    "body": "Middle SchoolSunday Morning5th-6th Grades - 10:15-11:15am in room 1017th-8th Grades - 10:15-11:15am in the Student CenterJoin us as we look at big truths in the Bible and see how it relates to everyday life.&nbsp;Middle School NightWednesdays 6:30-8:30pm GymOn Wednesday nights, the doors to our building are open to 5th–8th graders for the best night of their week! Middle School Night is a high-energy program that includes gym games, teaching time, and times in small groups. It’s a great opportunity for students to connect with their peers, small group leaders, and most importantly God.CLICK HERE TO SEE THE SCHEDULEMinistry LeaderAJ Coy - Director of Middle School Ministryaj.coy@riverwoodchapel.orgCora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: word-boundary mash detected: ['orgCora']; HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_2",
    "topic": "kids_ministry",
    "label": null,
    "body": "High SchoolSunday Morning&nbsp;10:15-11:15am in the Gathering SpaceJoin us on Sunday mornings at 10:15am in the Gathering Space, as we follow along with the sermon series and discuss the passage together. Whether you go to worship before or after, our Sunday Morning Bible Study is a great way to connect with your peers and apply God’s Word to your life.Sunday Night GatheringVarious Sunday Nights - 6:30-8:30pm in the GymGathering nights are a time for our whole youth group to come together, connect, and grow. These nights are designed to be low-pressure, fun, and welcoming—perfect for inviting friends and building relationships within the larger youth group. Whether you’re a student looking to meet new people or grow as a follower of Jesus, our Gatherings are the place to start. It’s more than just a hangout—it’s the foundation for real community and meaningful Gospel conversations. Come be a part of it!CLICK HERE TO SEE THE SCHEDULESmall GroupSunday nights - 6:30–8:30pm - Locations vary by groupSmall Group nights provide a slower, more focused time for students to connect on a deeper level with their peers and leaders. Come be a part of intentional Bible study, prayer, and meaningful conversations with other students with a desire to know and follow Jesus. Small Groups are a space to grow, be encouraged, and do life together.Ministry LeaderJosiah Keating - Director of High School Ministry&nbsp;josiah.keating@riverwoodchapel.orgCora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: word-boundary mash detected: ['groupSmall', 'orgCora']; HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:ministries:kids-students:rfld_RqKznjHbDD83KG:repeater_0",
    "topic": "kids_ministry",
    "label": null,
    "body": "Sunday SchoolIt is our hope that the plan for childhood discipleship at Riverwood would encourage and enhance the discipleship efforts of the parents and guardians of Riverwood kids.Open Arms Nursery9:00am, 10:15am, and 11:30amOpen Arms Nursery provides infants through toddlers with a routine of welcome, Bible stories, playtime, and snack. Once a toddler is three and potty trained, they “graduate” to the Jr Pre K class.Preschool Classes9:00am, 10:15am, and 11:30amPreschool Classes are open to children who are three years old – Kindergarten. Here they will enjoy a time of singing and dancing, a Bible story from&nbsp;the Gospel Project curriculum, and a corresponding craft or game to develop the truth from God’s Word.Elementary Classes9:00am, 10:15am, and 11:30amElementary Classes are open to kids in 1st – 4th grade. Kids will participate in a Bible lesson from&nbsp;the Gospel Project curriculum, worship, and an application game or craft to develop the truth from God’s Word.Ministry LeadersJosh Miller - Kids &amp; Middle School Pastor&nbsp;josh.miller@riverwoodchapel.org330-227-4791Cora Gray - Administrative Assistantcora.gray@riverwoodchapel.org330-227-4532",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  }
]
```

## Relevant Facts

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
    "topic": "staff",
    "body": "Josh Miller",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_5",
    "metadata": {
      "role": "Kids &amp; Middle School Pastor",
      "email": "josh.miller@riverwoodchapel.org",
      "bio": "Josh is head over all Kids and Middle School ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Jodi Crawfis",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_12",
    "metadata": {
      "role": "Kids Ministry Volunteer Coordinator",
      "email": "jodi.crawfis@riverwoodchapel.org",
      "bio": "Jodi is head of Kids Ministry Volunteers.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Carol Gray",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_14",
    "metadata": {
      "role": "Kids Ministry Curriculum Coordinator",
      "email": "carol.gray@riverwoodchapel.org",
      "bio": "Carol is head of Kids Ministry Curriculum.",
      "campus": ""
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

## Voice Card (the writer's brief)

Lift fields: branded_vocabulary, banned_terms, mission, x_factor, personas, anti_models, example_phrases_good. Synthesis fields (the writer's brief proper): signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona.

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
  "example_phrases_good": [
    "know Jesus",
    "being known",
    "family/home",
    "Shepherding",
    "<ul><li>“To know Jesus, to be known, and to make Him known”</li><li>Home</li><li>A place to feel known</li><li>Not just in the community, but part of it.&nbsp;</li></ul><div><br></div><div>Brand Campaign Slogans:<br><ul><li>\"<em>Built for Belonging”</em></li><li><em><em><em>“Breath Again”</em></em></em></li><li><em><em><em><em>“Jesus at the Center”</em></em></em></em></li><li><em><em><em><em><em><em>“Kent Knows Us”</em></em></em></em></em></em></li></ul></div>"
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
  }
}
```

---

**Start drafting.** Output prose for every section in order, using the structural markers from the skill spec (HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:). Do not output JSON. Do not run mechanical scans. Do not produce an audit. Those are downstream jobs.
