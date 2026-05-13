# Denominational filters

Per-tradition guardrails for the AI copywriter. After the global
`web-writing-rules.md` is applied, the matching denominational filter
runs as a second pass — naming what to *say explicitly*, what to
*avoid*, and which words to *swap*.

This file is editable inline. As patterns surface in real projects,
add them here rather than hard-coding into prompts. The Content
Manager picks the active filter from the project's intake (church's
self-reported tradition + leadership's vocabulary).

If a church's intake doesn't fit cleanly under one tradition, default
to **Evangelical / Non-Denominational** — it's the most theologically
neutral baseline — and override individual rules from the brand voice
doc.

---

## Evangelical / Non-Denominational

The default. Most independent and many "Bible church" / "community
church" / network-church contexts (Acts 29, Vineyard, etc.) fit here.

**Name explicitly:**
- Jesus (not just "God" or "Christ")
- The Bible as authoritative
- Personal faith / relationship with Jesus
- "Following Jesus" as the lifelong frame

**Avoid:**
- Heavy liturgical vocabulary (*Eucharist, vespers, lectionary*)
- Sacramental language without context (*sacraments, mass, confession*)
- Catholic-coded terms (*Mary, the saints, purgatory*)
- Mainline-coded social-justice framing as the lead — it can come
  through, but shouldn't be the primary identity hook

**Vocabulary swaps:**
- "service" not "mass" or "liturgy"
- "communion" not "Eucharist"
- "kids ministry" not "Sunday school" (regional — confirm in intake)
- "small group" not "cell group" or "house church" (unless the
  church uses those terms)

---

## Reformed / Calvinist

Presbyterian (PCA, OPC, EPC), Reformed Baptist, many Acts 29 plants,
some non-denoms with explicitly Reformed teaching.

**Name explicitly:**
- The sovereignty of God
- Doctrines of grace (when the church centers them)
- Confessional documents the church holds to (Westminster, 1689,
  Three Forms of Unity) — by name if intake confirms
- Sola Scriptura framing where appropriate

**Avoid:**
- "Make a decision for Christ" / "ask Jesus into your heart"
  framing — Reformed contexts find it theologically thin
- Charismatic vocabulary (*Spirit-led, prophetic word, anointing*)
  unless the intake specifically calls for it
- Heavy emotion-led conversion language

**Vocabulary swaps:**
- "elders" not "board members"
- "covenant" carries weight — use it deliberately
- "doctrine" is acceptable, even welcomed (this audience reads it
  as a strength, not jargon)

---

## Pentecostal / Charismatic

Assemblies of God, Foursquare, ARC plants, Vineyard (varies),
non-denom charismatic, Bethel/IHOP-influenced contexts.

**Name explicitly:**
- The Holy Spirit (active, present-tense)
- Healing, prayer for the sick, prophetic gifts (when the church
  practices them)
- Encounter, presence, breakthrough (these are native vocabulary,
  not clichés in this context)
- Worship as an extended congregational practice

**Avoid:**
- Reformed sovereignty framing as the lead theme
- Cessationist-coded language (don't flatten Spirit references into
  generic "God is at work")
- Liturgical vocabulary that implies fixed forms

**Vocabulary swaps:**
- "worship" carries specific meaning — extended sung worship, not
  just "the music portion of the service"
- "the Spirit" or "the Holy Spirit" — use freely
- "breakthrough," "encounter," "presence" are acceptable here even
  though they read as cliché elsewhere — but still avoid stacking
  them

---

## Methodist / Wesleyan

UMC, Free Methodist, Wesleyan Church, Nazarene, Salvation Army.

**Name explicitly:**
- Grace (prevenient, justifying, sanctifying — if the church teaches
  the Wesleyan distinction)
- Holiness / sanctification as a real lifelong pursuit
- John Wesley (occasionally, where intake supports)
- Connection, conference, circuit (UMC structural language, used in
  about-us copy)

**Avoid:**
- Hardline Reformed sovereignty framing
- Sacramentalism heavier than the tradition (Methodists honor
  baptism + communion; they don't call them "sacraments" with the
  weight Catholic/Anglican contexts do)
- "Once saved, always saved" framing — Wesleyan theology disagrees

**Vocabulary swaps:**
- "communion" not "Eucharist"
- "service" not "mass"
- "discipleship" reads well in this tradition (the global rule's
  jargon caution still applies — define on first use)

---

## Baptist (Southern Baptist, Independent Baptist, GARBC, etc.)

**Name explicitly:**
- The authority of Scripture
- Believer's baptism by immersion
- Local-church autonomy
- Salvation by grace through faith

**Avoid:**
- Infant baptism vocabulary (christening, baptizing infants)
- Heavy ecumenical language
- Charismatic gifts framing (most Baptist contexts are cessationist)
- "We're a denomination" — Baptist self-identity is local-church
  first, association second

**Vocabulary swaps:**
- "associate pastor," "senior pastor" — formal titles preserved
- "Sunday school" is often used (regional confirmation in intake)
- "the gospel" is acceptable here without need for unpacking — but
  the global rule still requires Jesus to be named, not just "the
  gospel"

---

## Lutheran (LCMS, ELCA, WELS, NALC)

Each synod is meaningfully different. **Confirm the synod in intake.**

**Name explicitly:**
- Word and sacrament
- Justification by grace through faith
- Confessions / Book of Concord (where intake confirms)
- Liturgical structure (this is a feature, not something to hide)

**Avoid:**
- Low-church framing that flattens the liturgy
- "We're informal / casual" if the church actually follows the
  liturgical year — be honest about formality
- Pentecostal / charismatic vocabulary

**Vocabulary swaps:**
- "Divine Service" or "service" — confirm the church's preferred term
- "communion" or "the Lord's Supper" — both work
- "pastor" preferred to "minister"

---

## Catholic

Roman Catholic parishes, Eastern Catholic communities.

**Name explicitly:**
- The Mass
- The Eucharist (with proper weight — this is the source and summit)
- Mary, the saints (where parish life centers them)
- The parish, the diocese, the bishop
- Sacraments by name when relevant

**Avoid:**
- Evangelical-coded "personal relationship with Jesus" framing as
  the primary entry point — it isn't wrong, but it isn't native
- "Service" instead of "Mass"
- Treating sacraments as symbolic rather than sacramental

**Vocabulary swaps:**
- "Mass" not "service"
- "parish" not "church" (when referring to the community)
- "Father [Name]" not "Pastor [Name]"
- "homily" not "sermon"

---

## Anglican / Episcopal

Episcopal Church (USA), ACNA, Anglican Mission, continuing Anglican.

**Name explicitly:**
- The Book of Common Prayer (by name)
- The liturgical year, the lectionary
- Sacramental life
- Bishops and apostolic order (where intake centers it)

**Avoid:**
- Low-church framing for high-church parishes (and vice versa —
  confirm in intake)
- Evangelical "decision" language
- Treating prayer book worship as a quaint feature rather than the
  spiritual core

**Vocabulary swaps:**
- "Holy Eucharist," "Holy Communion," "Mass" — confirm the parish's
  preferred term in intake
- "rector," "vicar," "priest" — confirm exact title in intake
- "parish" or "congregation"

---

## Adding a tradition

When a project lands in a tradition not covered above, add a new
section using the same shape:

- **Name explicitly** — vocabulary the AI must use
- **Avoid** — vocabulary the AI must not use
- **Vocabulary swaps** — terminology preferences

Then add a one-line entry to the project's brand voice doc pointing
the copywriter at the new section.

---

## What this doc is not

- **Not a theology primer.** It's a vocabulary + framing guide. If a
  doctrinal nuance isn't actionable for the AI copywriter, it
  doesn't live here.
- **Not a denomination ranking.** Filters exist to honor each
  tradition's own self-presentation, not to assert which is correct.
- **Not exhaustive.** The traditions here cover the bulk of CMS
  partner work. Edge cases (Mennonite, Quaker, Eastern Orthodox,
  Messianic, etc.) get their own section when the first project in
  that tradition lands.
