# Copywriter Brief — /outreach (Local & Global Outreach)

Riverwood Chapel · Project 3490

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded (from the web-copywriter-suite plugin). Sonnet will produce prose for every section in this brief.

After Sonnet outputs the prose, invoke `/format-page` and paste `outreach-formatter-inputs.md` to produce the Brixies JSON. Then say "review the page" with the JSON output to get the reviewer's verdict.

---

## Page

```json
{
  "page_slug": "/outreach",
  "name": "Local & Global Outreach",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel food pantry",
      "Local outreach Kent Ohio",
      "Mission partners Riverwood"
    ],
    "secondary": [
      "Food pantry Kent OH Friday",
      "Akron Pregnancy Services partner",
      "Shepherd's House Portage County",
      "Global mission partners Riverwood",
      "Local outreach church Kent"
    ],
    "long_tail": [
      "Where to get help with food in Kent Ohio",
      "Riverwood Chapel missionaries",
      "Local ministry partners Riverwood"
    ],
    "local": [
      "Kent Ohio food pantry",
      "Portage County church outreach"
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
    "section_job": "Let a visitor feel that this church doesn't just gather on Sunday — that what happens here on Sunday spills out into Kent and around the world every week",
    "tagline_strategy": "informational",
    "intent_summary": "Local & Global Outreach hero. Tone-aware for primary persona (The Established Member).",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 2,
    "concept_id": "feature_card_grid",
    "section_job": "Let the visitor see the specific people and places this church is showing up for in its own city, by name",
    "tagline_strategy": null,
    "intent_summary": "Local: Food Pantry + 2 partners.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 3,
    "concept_id": "feature_card_carousel",
    "section_job": "Let the visitor feel the global reach without drowning in it — proof that Riverwood's mission goes further than they expected",
    "tagline_strategy": null,
    "intent_summary": "Global: 10 missionary partnerships. Some names are pseudonyms — security-sensitive.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 4,
    "concept_id": "contact_section",
    "section_job": "For a visitor whose Sunday morning is starting to spill into their week, give them a real person who can show them where to start",
    "tagline_strategy": null,
    "intent_summary": "Outreach contact — Jeff Haynes (Care & Outreach Pastor).",
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
  "feature_card_carousel.heading": 100,
  "feature_card_carousel.description": 400,
  "contact_section.heading": 100,
  "contact_section.description": 400
}
```

## Content_page_map (atoms × this page × role)

```json
[
  {
    "atom_external_ref_id": "contentsnare:ministries:local-outreach:rfld_v8gOGDCljevogm",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:local-outreach:rfld_GoKMRwH6Y9x1LY",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:local-outreach:rfld_wOd96mc1MBZNgZ",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:global-outreach:rfld_v8gOGDCljevogm",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:global-outreach:rfld_GoKMRwH6Y9x1LY",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  },
  {
    "atom_external_ref_id": "contentsnare:ministries:global-outreach:rfld_wOd96mc1MBZNgZ",
    "page_slug": "/outreach",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /outreach."
  }
]
```

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (HTML-mashed form output). You are FREE to clean and recompose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
[
  {
    "external_ref_id": "contentsnare:ministries:local-outreach:rfld_GoKMRwH6Y9x1LY",
    "topic": "local_outreach_purpose",
    "label": "Why does your Local Outreach Ministry gather?",
    "body": "we believe the church is called to be the hands and feet of Jesus right where we live. Jesus didn’t simply announce the kingdom—He embodied it. And as His people, we want to bring a glimpse of heaven to earth through practical love, presence, and service.\n\nWe don’t want to be a church that is only in Kent and Portage County. We want to be a church that is deeply part of Kent and Portage County—woven into the lives, needs, and hopes of our neighbors. When we gather, we listen, we learn, and we step toward the places where God is already at work, joining Him in bringing restoration, compassion, and hope.\n\nOur partnership exist to help every person at Riverwood live out the gospel in tangible ways—showing the love of Jesus in our schools, neighborhoods, campuses, businesses, and city spaces. We gather so that together, we can serve, build relationships, meet needs, and reflect the kingdom of God in the everyday life of our community.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:ministries:local-outreach:rfld_v8gOGDCljevogm",
    "topic": "ministry_branded_name",
    "label": "Local Outreach Ministry Name",
    "body": "Local Partnerships",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_v8gOGDCljevogm",
    "topic": "ministry_branded_name",
    "label": "Global Outreach Ministry Name",
    "body": "Global Outreach ",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:ministries:local-outreach:rfld_wOd96mc1MBZNgZ",
    "topic": "local_outreach_saying",
    "label": "Do you have a repeated saying about Local Outreach?",
    "body": "we dont but it is tied to the \"Make Him Known\" Part of our mission",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_GoKMRwH6Y9x1LY",
    "topic": "global_outreach_purpose",
    "label": "Why does your Global Outreach Ministry gather?",
    "body": "Our Global Outreach Ministry exists because the mission of Jesus doesn’t stop at our city limits. From the very beginning, Jesus called His church to take the good news to the ends of the earth. We believe every follower of Christ is invited into that global story—spreading the gospel, making disciples, and helping the hope of Jesus take root in every nation.\n\nWe pursue this mission through deep, intentional partnerships with missionaries and ministries around the world. These partners are not projects—they are friends, co-laborers, and an extension of Riverwood’s heart. We support them financially, pray for them regularly, and stay connected to the real needs and opportunities they face.\n\nOur Global Outreach Ministry also exists to send people. We believe in the power of going—of stepping into another culture, serving alongside our partners, encouraging them, and learning from what God is doing through them. Mission trips are one of the ways we embody Christ’s love globally, bringing support, relationship, and the message of Jesus wherever He leads.\n\nWe exist to help Riverwood play its part in God’s global mission—partnering, sending, supporting, and proclaiming the gospel so that every tribe, nation, and people might come to know the hope found in Christ.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_wOd96mc1MBZNgZ",
    "topic": "global_outreach_saying",
    "label": "Do you have a repeated saying about Global Outreach?",
    "body": "We do not other than \"Make Him Known\"",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
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
    "topic": "partnership",
    "subtopic": "local",
    "body": "Faithful Servant Care Center",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_local_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:local-outreach:rfld_E4Kl68c5ElVwd7:row_0",
    "metadata": {
      "description": "A Christian-based health care organization with a commitment to providing quality urgent health care services to the uninsured in the Greater Akron area. Services are provided at no cost to the patient by professional, licensed physicians and clinicians. For more information or to become involved, click the button below to contact us.",
      "kind": "local"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "local",
    "body": "Akron Pregnancy Services",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_local_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:local-outreach:rfld_E4Kl68c5ElVwd7:row_1",
    "metadata": {
      "description": "APS provides support and services for women and families in crisis pregnancies by providing material, physical, and spiritual assistance during pregnancy and after delivery. APS’s sister organization Eva also provides no-cost pregnancy tests, ultrasounds, and education on life options. For more information on how you can help, see more info.",
      "kind": "local"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Brad &amp; Sara",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_0",
    "metadata": {
      "description": "Serving in a security sensitive area in the Muslim world. In 1995, we joined our love for one another and our calling to serve the North Caucasus Peoples of Russia. We ache for every one of the 45 Caucasus language groups and 1000 villages to have 1) at least a first chance to respond to Christ’s message of victory over death, 2) victory over Satan’s reign of terror, and 3) forgiving grace to those who surrender to Jesus.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Riley &amp; Alissa Brookings",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_1",
    "metadata": {
      "description": "Serving with World Team in Paris, France\nWe met through Campus Crusade for Christ (CRU) at Ohio University where we both did short-term trips to France. God clearly called us to France as we began our relationship together. Our student loan debt kept us in the US for the next eight years where the Lord grew us in many ways and taught us about church planting. In 2015, God opened all the doors for us to arrive in France eager for the journey ahead and to experience the call He had on our lives to serve Him there. Our son Aiden joined us on this journey a few years later.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Andrea &amp; Blerta Clemente",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_2",
    "metadata": {
      "description": "Serving with CRU/Agape Italia in Rome\nAndrea (Andrew) is from southern Italy. I had the privelage to study in seminary (very uncommon for Itailians). Blerta is originally from Albania. I met Christ in the 90’s after communism fell and missionaries planted a church in my hometown. I moved to Rome to attend college – and met Andrea. Together we serve with CRU/Agape Italia full-time to evangelize and disciple students. In April 2023, we had our baby girl Gioia Grace.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Del Rey Ministries",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_3",
    "metadata": {
      "description": "Serving in the sugar cane villages in the Dominican Republic\nDel Rey Ministries exists to build vibrant, self-sustaining, Christ-centered communities in the sugar cane villages of the Dominican Republic. We are a team of local Dominican and Hatian pastors partnered with American pastors.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "John &amp; Jane Doe",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_4",
    "metadata": {
      "description": "Serving in a security sensitive area in North Africa\nJohn transplanted to Northeast Ohio and took the perspectives class with Pastor Lon at Riverwood as a Stow student. Jane, a Toledo native, met John at the University of Akron. After getting married and living abroad for two years, we returned to Northeast Ohio in 2011 for training and worked with international students. In 2018, we moved to North Africa where we currently live. We now have 4 sons: 10 years old, 8 years old, 2 years old, and a baby.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Jenny Haver",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_5",
    "metadata": {
      "description": "Serving with Missionary Maintenance Service Aviation (MMS) in Ohio\nI grew up in Stow and was a member of Riverwood before moving away. I went through the MMS apprenticeship program, completed my aircraft mechanic’s certifications in 2017, and joined the long-term staff. Currently I’m serving as a project leader/supervisor.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Dan &amp; Jen",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_6",
    "metadata": {
      "description": "Serving with Greater Europe Mission in Czech Republic\nGod began to move us towards cross cultural work in 2015 when we joined the staff of a ministry in Central Florida focusing on short-term training trips with churches in the majority world. Through more than five years on staff there, God began to soften our hearts towards full-time cross-cultural missions and opened a door to work in central Europe with GEM. We have three kids – Andrew (9), Caroline (7) and Joshua (4).",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Dale &amp; Jillian Liff",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_7",
    "metadata": {
      "description": "Serving with Missionary Maintenance Service Aviation (MMS) in Ohio\nWe came to know Jesus in our early 30’s and soon after began attending Riverwood. While there, we became involved in cross-cultural ministry and short-term missions which planted the seed to share the Gospel globally. MMS prepares people and planes for world-wide missionary service. God had been equipping Dale with years of experience in electronics which would be handy for troubleshooting and repairing airplane avionics systems!",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "PJ &amp; Lizzy",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_8",
    "metadata": {
      "description": "Serving with Beyond in South Asia\nWe serve with Beyond in South Asia with our two children Naomi and Ezra. We ministered with Beyond for 17 years and serve a Tibetean people group called the Tazig people living in the Himalayan mountains. Lizzy worked as a teacher and principal at an international Christian school for the past eight years. Unfortunately, we have used the maximum number of permits an expatriate can work in the country, and we are relocating in 2023 to a new country close to the Tazig people.",
      "kind": "global"
    }
  },
  {
    "topic": "partnership",
    "subtopic": "global",
    "body": "Glenn &amp; Erin Niedergall",
    "verbatim": false,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "please_list_your_global_ministry_partners_.csv",
    "external_ref_id": "contentsnare:ministries:global-outreach:rfld_E4Kl68c5ElVwd7:row_9",
    "metadata": {
      "description": "Glenn &amp; Erin Niedergall\nServing with China Outreach Ministries at Kent State\nGod called us to China in 2013. We quit our jobs, sold our house and cars, and we moved to China to serve as missionaries. Glen taught PhD students, and Erin taught undergrads at one of the top universities in Beijing, China. We were privileged to disciple first-generation Christians weekly. We returned to America in 2015 when God transplanted us to North Carolina State University to reach out to the Chinese students and scholars there. In April 2018, God relocated us to Kent State.",
      "kind": "global"
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
