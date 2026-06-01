# Copywriter Brief — /adult-studies (Adult Studies & Classes)

Riverwood Chapel · Project 3490

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded (from the web-copywriter-suite plugin). Sonnet will produce prose for every section in this brief.

After Sonnet outputs the prose, invoke `/format-page` and paste `adult-studies-formatter-inputs.md` to produce the Brixies JSON. Then say "review the page" with the JSON output to get the reviewer's verdict.

---

## Page

```json
{
  "page_slug": "/adult-studies",
  "name": "Adult Studies & Classes",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel life groups",
      "Bible study Kent Ohio",
      "Adult Bible study Kent"
    ],
    "secondary": [
      "Men's group Kent OH",
      "Women's Bible study Kent",
      "Small group Kent Ohio church",
      "Discipleship class Riverwood",
      "Five investments framework"
    ],
    "long_tail": [
      "Where to join a Bible study in Kent",
      "How to find a life group at Riverwood"
    ],
    "local": [
      "Bible studies Kent Ohio"
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
    "section_job": "Make an adult feel that life at this church doesn't end when Sunday does — that there are rooms full of people who want to know them by name",
    "tagline_strategy": "informational",
    "intent_summary": "Adult Studies & Classes hero. Tone-aware for primary persona (The Suburban Family).",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 2,
    "concept_id": "feature_card_grid",
    "section_job": "Let each adult see the small-group option that fits their season — single, married, mid-life, post-kids, in a hard place — without having to translate",
    "tagline_strategy": null,
    "intent_summary": "4 group types: Life Groups, Care Support Groups, Bible Studies, Men's Huddle, Women to Women.",
    "atom_external_ref_ids": [
      "contentsnare:discipleship-next-steps:next-steps-classes:rfld_RqKznjHbDD83KG:repeater_0",
      "contentsnare:discipleship-next-steps:next-steps-classes:rfld_vRdJJeS58Nj0dM:repeater_0",
      "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_0",
      "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_1"
    ],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 3,
    "concept_id": "accordion_faq",
    "section_job": "Quietly answer the awkward questions about small groups (do I have to host, do I have to share, can I leave) so a hesitant adult can sign up without anxiety",
    "tagline_strategy": null,
    "intent_summary": "How small groups work — meeting cadence, sign-up, contact (Josh Miller).",
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
  "feature_card_grid.heading": 100,
  "feature_card_grid.description": 400,
  "accordion_faq.heading": 100,
  "accordion_faq.description": 400
}
```

## Content_page_map (atoms × this page × role)

```json
[
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_mzdXYltrxrb1g7",
    "page_slug": "/adult-studies",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /adult-studies."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_1jLjoBfzjz9vdr",
    "page_slug": "/adult-studies",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /adult-studies."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_E4Kl68cX5XJQd7",
    "page_slug": "/adult-studies",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /adult-studies."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_W1K7ZXiP7PBBg5",
    "page_slug": "/adult-studies",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /adult-studies."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_GRgZ2XF0r7wPgP",
    "page_slug": "/adult-studies",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /adult-studies."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:next-steps-classes:rfld_RqKznjHbDD83KG:repeater_0",
    "page_slug": "/adult-studies",
    "section_sort_order": 2,
    "role": "canonical",
    "treatment": "Full content on /adult-studies. Section 2."
  },
  {
    "atom_external_ref_id": "contentsnare:discipleship-next-steps:next-steps-classes:rfld_vRdJJeS58Nj0dM:repeater_0",
    "page_slug": "/adult-studies",
    "section_sort_order": 2,
    "role": "canonical",
    "treatment": "Full content on /adult-studies. Section 2."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_0",
    "page_slug": "/adult-studies",
    "section_sort_order": 2,
    "role": "canonical",
    "treatment": "Full content on /adult-studies. Section 2."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_1",
    "page_slug": "/adult-studies",
    "section_sort_order": 2,
    "role": "canonical",
    "treatment": "Full content on /adult-studies. Section 2."
  }
]
```

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (HTML-mashed form output). You are FREE to clean and recompose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
[
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_1jLjoBfzjz9vdr",
    "topic": "small_group_purpose",
    "label": "Why do your small groups gather?",
    "body": "It all depends on the group. Check the links for more info on each one. They vary depending on the type and schedule.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_W1K7ZXiP7PBBg5",
    "topic": "small_group_leader_signup",
    "label": "How can someone sign up to become a small group leader?",
    "body": "They can inquire about this by reaching out to our Disipleship Pastor - Josh Miller",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_mzdXYltrxrb1g7",
    "topic": "small_group_experience",
    "label": "What should visitors expect in a small group?",
    "body": "All of these groups vary depending on their type. Bible studies follow a fall and spring schedule. Care groups launch at different times throughout the year with specific topics. Life groups vary from group to group, with many taking a break during the summer.A great place to begin is with a Bible study—it’s the perfect starting point for anyone looking to take a next step into deeper community.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:next-steps-classes:rfld_RqKznjHbDD83KG:repeater_0",
    "topic": "next_steps_pathway",
    "label": null,
    "body": "Discovery &amp; MembershipSign-Up Form:&nbsp;https://riverwoodchapel.churchcenter.com/registrations/events/category/80622Discovery is the next step for anyone who is newer to Riverwood or who has never become a member. This is a four-week class offered on Sunday mornings. The goal is to take you deeper into Riverwood’s mission and values, our theology, and our staff, while also giving you practical next steps for your journey here. It’s also a great space to meet people as we intentionally create opportunities for connection.At the end of the four weeks, you’ll have the option to return for our Membership Class the following week. In that session, we explain what membership means, what the process looks like, and what you can expect if you choose to pursue it.Contact:Maggie Kirbabas — Maggie.Kirbabas@riverwoodchapel.orgClass Resource Folder: https://drive.google.com/drive/folders/12EhirpLxN62r6Acvan8dUhyWUv9a_I_L?usp=share_linkClass Details:Held in Room 115 on Sunday morningsOffered every other monthA Saturday morning version is also offered a few times throughout the year—this is a 4-hour experience and will be promoted as dates are set",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: word-boundary mash detected: ['orgClass', 'morningsOffered']; HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_GRgZ2XF0r7wPgP",
    "topic": "small_group_contact",
    "label": "Who should site visitors contact to get more information about small groups?",
    "body": "Josh Miller",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:next-steps-classes:rfld_vRdJJeS58Nj0dM:repeater_0",
    "topic": "class_or_discipleship_ministry",
    "label": null,
    "body": "ClassesSign Up Form -&nbsp;https://riverwoodchapel.churchcenter.com/groups/classes?enrollment=open_signup,request_to_join&amp;filter=enrollmentWe offer two ongoing classes—Men’s Huddle&nbsp;and&nbsp;Women to Women. These meet on Sunday mornings during the 10:15 hour. Men’s Huddle is hosted in Room 115, and Women to Women meets in the gym. Both classes are great opportunities to be poured into and to connect with others. These run year-round.We also offer&nbsp;seasonal, topic-based classes&nbsp;that are open to everyone. These happen four times a year and take the place of the men’s and women’s classes when they are in session. Seasonal classes are hosted in the gym.",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: word-boundary mash detected: ['enrollmentWe']; HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:discipleship-next-steps:small-groups:rfld_E4Kl68cX5XJQd7",
    "topic": "small_group_verse_or_saying",
    "label": "Do you have a bible verse or repeated saying about small groups?",
    "body": "We do not. We might say this is the \"Be Known\" part of our mission.&nbsp;",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_1",
    "topic": "adult_ministry",
    "label": null,
    "body": "AdultsSunday MorningMen's Huddle - 9:00-10:15 AM in Room 114Women to Women -&nbsp;9:00-10:15 AM in The Gathering SpaceA time for adults to come together for the sake of learning and equipping so they might follow Jesus more deeply and serve Him in a higher capacity.Bible StudiesGetting together to know each other better and dig deeper into God’s word is so important. Visit our events page to explore the adult Bible studies we currently offer.&nbsp;EVENTS PAGEMinistry Leader:Josh MillerJosh.miller@riverwoodchapel.orgSarah Cordsarah.cord@riverwoodchapel.org",
    "body_short": null,
    "verbatim": false,
    "content_quality": "raw_form_output",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": "Originally partner-authored verbatim source; demoted to non-verbatim due to content_quality=raw_form_output (reasons: word-boundary mash detected: ['orgSarah']; HTML entity leakage). Needs human cleanup pass before re-marking verbatim."
  },
  {
    "external_ref_id": "contentsnare:ministries:adults:rfld_RqKznjHbDD83KG:repeater_0",
    "topic": "adult_ministry",
    "label": null,
    "body": "CollegeSunday Morning10:15 - 11:15 AM in Room 115A time for college students to come together to learn and to build community so they might follow Jesus more deeply and serve Him in a higher capacity.&nbsp;Ministry Leader:Bryan Kane",
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
