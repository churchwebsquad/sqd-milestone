# Copywriter Brief — /leadership (Leadership Team)

Riverwood Chapel · Project 3490

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded (from the web-copywriter-suite plugin). Sonnet will produce prose for every section in this brief.

After Sonnet outputs the prose, invoke `/format-page` and paste `leadership-formatter-inputs.md` to produce the Brixies JSON. Then say "review the page" with the JSON output to get the reviewer's verdict.

---

## Page

```json
{
  "page_slug": "/leadership",
  "name": "Leadership Team",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel leadership",
      "Riverwood Chapel pastors",
      "Cole Tawney lead pastor"
    ],
    "secondary": [
      "Riverwood Chapel staff",
      "Riverwood Chapel pastors",
      "Kent Ohio church pastors",
      "Meet the team Riverwood",
      "Riverwood elders deacons"
    ],
    "long_tail": [
      "Who is the lead pastor at Riverwood Chapel",
      "Cole Tawney Riverwood Chapel"
    ],
    "local": [
      "Kent Ohio church leadership"
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
    "section_job": "Make a visitor feel that the people leading this church are reachable people, not branded personalities — and that they'd recognize them in the Foyer",
    "tagline_strategy": "hook",
    "intent_summary": "Leadership Team hero. Tone-aware for primary persona (The Person in a Hard Season).",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 2,
    "concept_id": "feature_team",
    "section_job": "Let every staff member's face and name land, so the church stops being an institution and becomes a roster of people the visitor could actually talk to",
    "tagline_strategy": null,
    "intent_summary": "Staff grid — 21 staff members with roles + emails + bios.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 3,
    "concept_id": "content_image_text",
    "section_job": "Make the visitor feel that they could email a pastor at this church and a pastor would actually email back",
    "tagline_strategy": null,
    "intent_summary": "Accessible Leadership value text — what this looks like in practice.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": "feature_team or content_image_text + named-person callout",
    "proof_person": {
      "name": "Cole Tawney",
      "role": "Lead Pastor"
    },
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
  "content_image_text.description": 400
}
```

## Content_page_map (atoms × this page × role)

```json
[
  {
    "atom_external_ref_id": "discovery:messaging.key_phrases.3",
    "page_slug": "/leadership",
    "section_sort_order": null,
    "role": "reference",
    "treatment": "Voice ammo: lift verbatim in Accessible Leadership framing."
  }
]
```

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (HTML-mashed form output). You are FREE to clean and recompose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
[
  {
    "external_ref_id": "discovery:messaging.key_phrases.3",
    "topic": "voice_ammo",
    "label": null,
    "body": "Shepherding",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {},
    "handling_notes": null
  }
]
```

## Relevant Facts

```json
[
  {
    "topic": "staff",
    "body": "Cole Tawney",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_0",
    "metadata": {
      "role": "Lead Pastor",
      "email": "cole.tawney@riverwoodchapel.org",
      "bio": "Cole has been the lead pastor of Riverwood Chapel for 12 years and has been a part of the team for over 23 years.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Tom Chamberlin",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_1",
    "metadata": {
      "role": "Executive Pastor",
      "email": "tom.chamberlin@riverwoodchapel.org",
      "bio": "Tom serves as our Pastor of Ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Jim Bossler",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_2",
    "metadata": {
      "role": "Director of Worship &amp; Missions",
      "email": "jim.bossler@riverwoodchapel.org",
      "bio": "Jim is head of all Worship and Missions ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Jeff Haynes",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_3",
    "metadata": {
      "role": "Care &amp; Outreach Pastor",
      "email": "jeff.haynes@riverwoodchapel.org",
      "bio": "Jeff is head of all Care and Outreach ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Nate Walker",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_4",
    "metadata": {
      "role": "Director of Services, Operations and Connections",
      "email": "nate.walker@riverwoodchapel.org",
      "bio": "Nate leads our Sunday experience and general building operations and communications.",
      "campus": ""
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
    "body": "Cindy Bowser",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_6",
    "metadata": {
      "role": "Director of Stewardship &amp; Facilities",
      "email": "cindy.bowser@riverwoodchapel.org",
      "bio": "Cindy is head of Stewardship and Facilities.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Josiah Keating",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_7",
    "metadata": {
      "role": "Director of High School Ministry",
      "email": "",
      "bio": "Josiah leads our High School Ministry",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Sarah Cord",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_8",
    "metadata": {
      "role": "Director of Women's Ministries",
      "email": "sarah.cord@riverwoodchapel.org",
      "bio": "Sarah is the head of Women's ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Maggie Kirbabas",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_9",
    "metadata": {
      "role": "Administrative Assistant",
      "email": "maggie.kirbabas@riverwoodchapel.org",
      "bio": "Maggie is head of Connections and is the administrative assistant for the Lead Pastor.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Nola Ruble",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_10",
    "metadata": {
      "role": "Administrative Assistant",
      "email": "nola.ruble@riverwoodchapel.org",
      "bio": "Nola is the administrative assistant for all Care Ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Cora Gray",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_11",
    "metadata": {
      "role": "Administrative Assistant",
      "email": "cora.gray@riverwoodchapel.org",
      "bio": "Cora is the administrative assistant for the Kids and Middle School Ministries. She is also the Event Communications Coordinator.",
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
    "body": "Amy Adkins",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_13",
    "metadata": {
      "role": "Nursery Coordinator",
      "email": "amy.adkins@riverwoodchapel.org",
      "bio": "Amy is the Nursery Coordinator.",
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
    "topic": "staff",
    "body": "Bryan Whitten",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_15",
    "metadata": {
      "role": "Technical Director for Worship Ministries",
      "email": "bryan.whitten@riverwoodchapel.org",
      "bio": "Bryan is the Technical Director for the Worship Ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Wayne Linder",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_16",
    "metadata": {
      "role": "Technical Coordinator for Worship Ministries",
      "email": "wayne.linder@riverwoodchapel.org",
      "bio": "Wayne is the Technical Coordinator and administrative support for the Worship Ministries.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Scott Hubin",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_17",
    "metadata": {
      "role": "Facilities Maintenance Manager",
      "email": "scott.hubin@riverwoodchapel.org",
      "bio": "Scott is head of all Facilities Maintenance.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Steven Kellhofer",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_18",
    "metadata": {
      "role": "Manager of Building Cleaning",
      "email": "steven.kellhofer@riverwoodchapel.org",
      "bio": "Steven is the Manager of Building Cleaning at Riverwood.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Erica Kellhofer",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_19",
    "metadata": {
      "role": "Building Cleaning Assistant",
      "email": "",
      "bio": "Erica is the Building Cleaning Assistant at Riverwood.",
      "campus": ""
    }
  },
  {
    "topic": "staff",
    "body": "Jocelyn O'Bryon",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "staff_board.csv",
    "external_ref_id": "contentsnare:staff-volunteers-testimonies:staff:rfld_EDKb5WhY4Jw4gY:row_20",
    "metadata": {
      "role": "Operations and Service Coordinator",
      "email": "",
      "bio": "Jocelyn aids in the planning and coordinating of Sunday experience and managing general building operations",
      "campus": ""
    }
  }
]
```

## Voice Card (the writer's brief)

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

## Snippets Manifest

The church has registered globals (church name, service times, address, phone, pastor, social URLs) and named snippets (ministry contacts, check-in URL, livestream URL, etc.). Write naturally — refer to the church by name, list service times, etc. The formatter will tokenize literals to `{globals_key}` and `{snippet_token}` automatically.

```json
{
  "globals": {
    "church_name": "Riverwood Chapel",
    "church_short_name": "Riverwood",
    "address": null,
    "city_state": "Kent, OH",
    "phone": "330.678.7000",
    "email": "Info@riverwoodchapel.org",
    "denomination": "Non-denominational",
    "pastor_name": "Cole Tawney",
    "primary_service_time": "7:45 Sunday",
    "all_service_times": "7:45, 9:00, 10:15 and 11:30 Sunday",
    "social_facebook_url": null,
    "social_instagram_url": null,
    "social_youtube_url": null,
    "social_tiktok_url": null,
    "social_twitter_url": null,
    "social_linkedin_url": null
  },
  "snippets": [
    {
      "token": "kids_check_in_url",
      "label": "Kids check-in link",
      "expansion": "https://riverwoodchapel.churchcenter.com/registrations",
      "description": "Pre-registration link for the Kids Wing — used in Kids Wing CTAs.",
      "tags": [
        "cta",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "worship_pastor_name",
      "label": "Worship Pastor name",
      "expansion": "Jim Bossler",
      "description": "Name of the worship pastor at Riverwood.",
      "tags": [
        "staff",
        "worship"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "worship_pastor_email",
      "label": "Worship Pastor email",
      "expansion": "jim.bossler@riverwoodchapel.org",
      "description": "Email contact for the worship pastor.",
      "tags": [
        "staff",
        "contact",
        "worship"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "care_pastor_name",
      "label": "Care Pastor name",
      "expansion": "Jeff Haynes",
      "description": "Name of the care pastor at Riverwood.",
      "tags": [
        "staff",
        "care"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "care_pastor_email",
      "label": "Care Pastor email",
      "expansion": "jeff.haynes@riverwoodchapel.org",
      "description": "Email contact for the care pastor.",
      "tags": [
        "staff",
        "contact",
        "care"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "kids_pastor_name",
      "label": "Kids Pastor name",
      "expansion": "Josh Miller",
      "description": "Name of the kids pastor at Riverwood.",
      "tags": [
        "staff",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "kids_pastor_email",
      "label": "Kids Pastor email",
      "expansion": "josh.miller@riverwoodchapel.org",
      "description": "Email contact for the kids pastor.",
      "tags": [
        "staff",
        "contact",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "livestream_url",
      "label": "Sunday livestream",
      "expansion": "https://www.youtube.com/live/hBK_Mzo64h4?si=zLC5KbRKjA_onIso",
      "description": "Where the Sunday service streams live.",
      "tags": [
        "cta",
        "watch"
      ],
      "source": "extracted_from_intake"
    }
  ]
}
```

---

**Start drafting.** Output prose for every section in order using the structural markers (HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:). No JSON, no audit, no mechanical scan.
