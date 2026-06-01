# Copywriter Brief — /story-beliefs (Our Story & Beliefs)

Riverwood Chapel · Project 3490

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded (from the web-copywriter-suite plugin). Sonnet will produce prose for every section in this brief.

After Sonnet outputs the prose, invoke `/format-page` and paste `story-beliefs-formatter-inputs.md` to produce the Brixies JSON. Then say "review the page" with the JSON output to get the reviewer's verdict.

---

## Page

```json
{
  "page_slug": "/story-beliefs",
  "name": "Our Story & Beliefs",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel beliefs",
      "Riverwood Chapel statement of faith",
      "Riverwood Chapel history"
    ],
    "secondary": [
      "What does Riverwood believe",
      "Statement of faith Kent Ohio church",
      "Non-denominational evangelical beliefs Kent",
      "Riverwood Chapel since 1991",
      "Riverwood doctrine"
    ],
    "long_tail": [
      "What does Riverwood Chapel teach about salvation",
      "Riverwood Chapel statement of beliefs",
      "Christian beliefs Kent Ohio"
    ],
    "local": [
      "Kent Ohio Christian beliefs"
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
    "section_job": "Make a visitor sense that this church has been here long enough to be trusted, and is clear enough about what it believes to be honest with",
    "tagline_strategy": "hook",
    "intent_summary": "Our Story & Beliefs hero. Tone-aware for primary persona (The Person in a Hard Season).",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 2,
    "concept_id": "content_image_text",
    "section_job": "Let the visitor read the mission and feel that this church actually lives it — that the sentence describes what they'd find here next Sunday",
    "tagline_strategy": null,
    "intent_summary": "Mission + Vision verbatim. 'Heaven on earth in Kent and Portage County.'",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": "section_job is emotional-proof-heavy but no named-person fact or testimonial atom available. Drafter may underdeliver. Route to needs queue: request a named teacher quote, parent testimonial, or partner-authored proof from this church before drafting."
  },
  {
    "sort_order": 3,
    "concept_id": "timeline_story",
    "section_job": "Let the visitor see that the church is older than them and still moving, so joining it means joining something already in motion",
    "tagline_strategy": null,
    "intent_summary": "9 church history milestones from 1991 founding through 2024.",
    "atom_external_ref_ids": [],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 4,
    "concept_id": "feature_card_grid",
    "section_job": "Make the visitor feel the values as a description of the church's personality — what they'd notice if they sat through a Sunday and a small group and a Wednesday night",
    "tagline_strategy": null,
    "intent_summary": "7 church values as cards: Scripture First, Intentional Discipleship, Known and Connected, Accessible Leadership, Multigenerational, Community Presence.",
    "atom_external_ref_ids": [
      "discovery:messaging.values.0",
      "discovery:messaging.values.1",
      "discovery:messaging.values.2",
      "discovery:messaging.values.3",
      "discovery:messaging.values.4",
      "discovery:messaging.values.5",
      "contentsnare:about-your-church:mission-beliefs:rfld_GRgvR3HQ0085g2"
    ],
    "concept_upgrade_recommended": null,
    "proof_person": null,
    "emotional_weight_no_proof_note": null
  },
  {
    "sort_order": 5,
    "concept_id": "accordion_faq",
    "section_job": "Let a visitor with theological caution see exactly what's believed here without having to ask anyone, so they can decide for themselves whether it fits",
    "tagline_strategy": null,
    "intent_summary": "Statement of Beliefs — 8 doctrines as expandable items.",
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
  "timeline_story.tagline": 60,
  "timeline_story.heading": 100,
  "timeline_story.description": 400,
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
    "atom_external_ref_id": "discovery:messaging.values.0",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "discovery:messaging.values.1",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "discovery:messaging.values.2",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "discovery:messaging.values.3",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "discovery:messaging.values.4",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "discovery:messaging.values.5",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_GRgvR3HQ0085g2",
    "page_slug": "/story-beliefs",
    "section_sort_order": 4,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs. Section 4."
  },
  {
    "atom_external_ref_id": "contentsnare:about-your-church:church-origins-common-lingo:rfld_EDKb5WhY4480gY",
    "page_slug": "/story-beliefs",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs."
  },
  {
    "atom_external_ref_id": "contentsnare:about-your-church:church-origins-common-lingo:rfld_wOd96mc1MMrwgZ",
    "page_slug": "/story-beliefs",
    "section_sort_order": null,
    "role": "canonical",
    "treatment": "Full content on /story-beliefs."
  },
  {
    "atom_external_ref_id": "discovery:messaging.key_phrases.0",
    "page_slug": "/story-beliefs",
    "section_sort_order": null,
    "role": "reference",
    "treatment": "Voice ammo: lift verbatim in mission framing."
  }
]
```

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (HTML-mashed form output). You are FREE to clean and recompose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
[
  {
    "external_ref_id": "discovery:messaging.values.5",
    "topic": "church_value",
    "label": "Community-Focused Posture",
    "body": "Riverwood is not just in Kent but part of it. Our heart is to reflect the gospel of Jesus in the community to which God has called us. We strive to be good neighbors, embody and share the gospel, and make a positive impact in our community.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "Community-Focused Posture"
    },
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.values.0",
    "topic": "church_value",
    "label": "The Authority of Scripture",
    "body": "We are driven by Scripture in everything we do, and devoted to exegetical teaching and preaching. We are intentional to make the Bible the core driver of every ministry we do.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "The Authority of Scripture"
    },
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:about-your-church:church-origins-common-lingo:rfld_EDKb5WhY4480gY",
    "topic": "church_origin",
    "label": "How was your church started, by who, and why?",
    "body": "Riverwood Chapel began its journey as a plant of The Chapel in Akron – planted with faith and purpose. Our first service, marking the beginning of a new chapter, was held on September 15, 1991, at Kent Roosevelt High School. Since then, we have blossomed into a nurturing spiritual home for several hundred families across Portage and Summit counties. The genesis of Riverwood was inspired by the visionary leadership at The Chapel. They dreamed of establishing an independent evangelical church dedicated to serving the greater Kent-Stow community. With the steadfast support of our 'mother church', a congregation sharing a unified vision for the ministry, and an ever-growing community presence, Riverwood has been blessed to flourish. We are a testament to the strength of faith, the power of community, and the beauty of shared dreams and goals.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_GRgvR3HQ0085g2",
    "topic": "church_value",
    "label": "Church Values",
    "body": "Scripture FirstGod’s Word drives everything we do. We are devoted to preaching, teaching, and living out the authority of Scripture.Intentional DiscipleshipDiscipleship is personal and often messy, but it’s worth it. We pursue Jesus, grow in community, and serve others through intentional relationships.Known and ConnectedWe value people over programs and strive to create a community where everyone is seen, known, and truly belongs.Accessible LeadershipOur leaders are approachable, Spirit-led, and transparent. We adapt as God leads and empower others to join the mission.MultigenerationalWe believe the church must reach and disciple every age. We intentionally cultivate worship, discipleship, and community across generations.Community PresenceRiverwood is part of Kent and Portage County. We seek to be good neighbors, reflect the gospel, and make a tangible impact in our community.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.values.4",
    "topic": "church_value",
    "label": "A Multigenerational Community",
    "body": "The heart of our God is to reach every age. It requires both effort and intentionality to be truly multigenerational. The ministry and culture we cultivate is designed to foster intentional discipleship, worship, and community across all ages. We consider this not only valuable but essential to the life and future of the Church.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "A Multigenerational Community"
    },
    "handling_notes": null
  },
  {
    "external_ref_id": "contentsnare:about-your-church:church-origins-common-lingo:rfld_wOd96mc1MMrwgZ",
    "topic": "church_origin_rationale",
    "label": "Why was your church created instead of attending another church in the area?",
    "body": "Riverwood’s x-factor is its shepherding heart wrapped in a small-church feel—even with its size, it remains deeply personal. Messaging should highlight the church’s ability to make people feel seen and spiritually cared for, not as attenders but as family. It’s not about performance or polish; it’s about deep relationships, rooted truth, and sincere relatability. Riverwood isn’t spiritual fast food—it’s a table, where people linger, grow, and are nourished by something real. That’s what makes it different—and that’s what makes it last.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "content_collection",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.key_phrases.0",
    "topic": "voice_ammo",
    "label": null,
    "body": "know Jesus",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {},
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.values.3",
    "topic": "church_value",
    "label": "Accessible and Adaptable Leadership",
    "body": "We strive to have pastors and leaders who are accessible to people, leading in sensitivity to the Spirit of God and the needs of people, allowing plans to change as the Spirit leads. We aim to be transparent, extend trust, and empower people to share in that same mission.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "Accessible and Adaptable Leadership"
    },
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.values.1",
    "topic": "church_value",
    "label": "Committed to Intentional Discipleship",
    "body": "We understand everyone has a different story, and life-changing discipleship is both messy and challenging, but always worth it. Everything that happens at Riverwood is to this end, that we would pursue Jesus, grow together in community, and serve others. There is no one size fits all spiritual journey for every person, but through connection and intentional shepherding, deep life-changing discipleship is possible.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "Committed to Intentional Discipleship"
    },
    "handling_notes": null
  },
  {
    "external_ref_id": "discovery:messaging.values.2",
    "topic": "church_value",
    "label": "A Place Where People Can Be Known",
    "body": "We are dedicated to creating a space where people are seen, known, and connected in the body of Christ. We value people over programs, seek to build a home-like atmosphere rather than corporate-style clarity, and strive for people to be known.",
    "body_short": null,
    "verbatim": true,
    "content_quality": "clean",
    "source_kind": "discovery_questionnaire",
    "metadata": {
      "name": "A Place Where People Can Be Known"
    },
    "handling_notes": null
  }
]
```

## Relevant Facts

```json
[
  {
    "topic": "milestone",
    "body": "1991 Began meeting in Kent Roosevelt High School",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.0",
    "metadata": {
      "year": 1991,
      "event": "Began meeting in Kent Roosevelt High School"
    }
  },
  {
    "topic": "milestone",
    "body": "1997 Moved to the current location on Fairchild Ave.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.1",
    "metadata": {
      "year": 1997,
      "event": "Moved to the current location on Fairchild Ave."
    }
  },
  {
    "topic": "milestone",
    "body": "2000 The church grew to the point of hiring full time youth and worship pastors",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.2",
    "metadata": {
      "year": 2000,
      "event": "The church grew to the point of hiring full time youth and worship pastors"
    }
  },
  {
    "topic": "milestone",
    "body": "2006 The founding pastor left and began pastoring at a different church",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.3",
    "metadata": {
      "year": 2006,
      "event": "The founding pastor left and began pastoring at a different church"
    }
  },
  {
    "topic": "milestone",
    "body": "2009 Church moved from having two morning services to three",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.4",
    "metadata": {
      "year": 2009,
      "event": "Church moved from having two morning services to three"
    }
  },
  {
    "topic": "milestone",
    "body": "2011 Major work behind the scenes of paying down original debt of the building",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.5",
    "metadata": {
      "year": 2011,
      "event": "Major work behind the scenes of paying down original debt of the building"
    }
  },
  {
    "topic": "milestone",
    "body": "2015 Church became debt free and began examining a campus expansion",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.6",
    "metadata": {
      "year": 2015,
      "event": "Church became debt free and began examining a campus expansion"
    }
  },
  {
    "topic": "milestone",
    "body": "2019 Completed a gym/kitchen and classroom addition",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.7",
    "metadata": {
      "year": 2019,
      "event": "Completed a gym/kitchen and classroom addition"
    }
  },
  {
    "topic": "milestone",
    "body": "2024 Significant numerical growth period for the church and ministries and the movement to four morning services",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "discovery_questionnaire",
    "source_ref": "riverwood_chapel_discovery.json",
    "external_ref_id": "discovery:church_basics.milestones.8",
    "metadata": {
      "year": 2024,
      "event": "Significant numerical growth period for the church and ministries and the movement to four morning services"
    }
  },
  {
    "topic": "belief",
    "body": "We believe in one God who is the holy and loving creator of all things seen and unseen. God exists eternally in three distinct and equal persons – the Father, Son and Holy Spirit.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_0",
    "metadata": {
      "doctrine": "God"
    }
  },
  {
    "topic": "belief",
    "body": "Jesus is wholly God and wholly man. He was conceived of the Holy Spirit, was born of the Virgin Mary, and lived a perfect sinless life. He died on the cross as the atonement for the sins of us all. He bodily rose from the dead and ascended into heaven where he is now our High Priest, Advocate, and King. It is through Jesus alone that we may find forgiveness and restoration with God.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_1",
    "metadata": {
      "doctrine": "Jesus Christ"
    }
  },
  {
    "topic": "belief",
    "body": "The Holy Spirit is sent from God to live in all who believe in Jesus. He teaches, comforts, and empowers us; giving each follower of Jesus diverse gifts for serving in the church and serving others in the world. We believe that it is through the Holy Spirit that we grow in faith, developing a holy life and Jesus-like character.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_2",
    "metadata": {
      "doctrine": "The Holy Spirit"
    }
  },
  {
    "topic": "belief",
    "body": "Each person is created with dignity and value in the image of God. Through sin, we have lost our spiritual life and are separated from fellowship with our Creator. This separation has been transmitted to the entire human race and affects our relationships with God and each other.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_3",
    "metadata": {
      "doctrine": "People &amp; Sin"
    }
  },
  {
    "topic": "belief",
    "body": "A perfect act of redemption was performed with the finished work of Jesus’ death on the cross. Through the grace (free gift) of God, we are rescued from the eternal consequences of sin, and our broken relationship with God is restored. We receive the free gift of forgiveness and are spiritually reborn by placing faith in Jesus alone. We believe that the relationship that one enters into with God upon salvation is eternally secure.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_4",
    "metadata": {
      "doctrine": "Salvation"
    }
  },
  {
    "topic": "belief",
    "body": "We believe that all those – anywhere in the world – who have put their faith in Jesus Christ are members of the Church and are united together in the Body of Christ. This Church is universal and global in nature and extent while expressed in the local gatherings of believers. We believe the local church exists for the purpose of worship, teaching, community, and to serve and reach others by bringing them the hope and love of Jesus. The Church is the Body of Christ, made up of empowered believers to be part of the mission of God on earth.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_5",
    "metadata": {
      "doctrine": "The Church"
    }
  },
  {
    "topic": "belief",
    "body": "The Lord Jesus Christ gave two ordinances to the church: water baptism (by immersion) and the Lord’s Supper (communion). Though these ordinances are not a means of salvation, they are a means of testimony and are practiced by the church until Christ comes again.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_6",
    "metadata": {
      "doctrine": "Ordinances (Baptism &amp; Communion)"
    }
  },
  {
    "topic": "belief",
    "body": "We believe in the personal return of Jesus Christ. He will judge the nations and restore all things to God’s original intent. We believe in a literal Heaven and Hell, and in the bodily resurrection of all. The believer will be raised to everlasting life with the Lord, and the unbeliever will be raised to judgment and everlasting conscious punishment apart from the presence of the Lord.",
    "verbatim": true,
    "confidence": "partner_stated",
    "source_kind": "content_collection",
    "source_ref": "statement_of_beliefs.csv",
    "external_ref_id": "contentsnare:about-your-church:mission-beliefs:rfld_VwL6zxcwa0D5L2:row_7",
    "metadata": {
      "doctrine": "Future Things (End Times)"
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
