# Content diagnosis — Canyon Del Oro Bible Church (3672)

What's sitting here to be organized. Per-section discovery grouped by
page. Trivial single-item sections (heros, intros, single-CTA banners)
are filtered out — only sections the dev needs to model.

---

## Home `/home` · 4 sections

**Join Us Every Sunday**
- 2 items
- schema: `name` `when`
- target: flat list, no individual pages
- sample (first record):
  - name: 9:15 & 11:00 AM
  - when: Two worship services every Sunday
- other items: 9200 N. Oracle Rd.

**Find Community & Belonging**
- 6 items
- schema: `name` `description` `audience` `cta_label` `cta_url`
- target: individual detail page per item
- sample (first record):
  - name: NextGen Kids
  - description: Sunday mornings made for infants through 5th grade.
  - audience: infants–5th grade
  - cta_label: For Families
  - cta_url: /nextgen-kids
- other items: NextGen Students · Blessed Beginnings Preschool · Young At Heart · Women's Community · Men's Community

**Grow, Serve, Give, Share**
- 4 items
- schema: `step_order` `name` `description` `cta_label` `cta_url`
- target: individual detail page per item
- sample (first record):
  - step_order: 1
  - name: Grow
  - description: Join a Talk, Listen, Do, or Care group and get to know people.
  - cta_label: Find a Group
  - cta_url: /groups
- other items: Serve · Give · Share

**Latest Message**
- 0 items (sermons surface as a single CTA only)
- target: linked out to third-party
- display preference: `cta_only`
- external source: https://www.youtube.com/@CanyonDelOroBibleChurch/streams

---

## Groups `/groups` · 1 section

**Ways to Connect**
- 4 items
- schema: `name` `description` `meeting_locations` `focus_areas` `support_model` `cta_label` `cta_url`
- target: linked out to third-party
- sample (first record):
  - name: Talk Groups
  - description: A discussion format, where each person grows by talking things out and hearing multiple voices. The most flexible way in.
  - meeting_locations: On campus, in homes, and online classes coming soon
  - focus_areas: —
  - support_model: —
  - cta_label: Browse Talk Groups
  - cta_url: https://cdobc.churchcenter.com/groups/talk-groups
- other items: Listen Groups · Do Groups · Care Groups
- display preference: `external`
- external source: https://cdobc.churchcenter.com/groups/talk-groups?enrollment=open_signup…
- ⚠ binding issue: bound template carries only `name + description + cta`. Source has `meeting_locations` on all 4 + `focus_areas` + `support_model` on Care Groups — currently dropped at render. Tracked in [build-time-errors.md](build-time-errors.md).

---

## Events `/events` · 2 sections

**Events calendar (Subsplash widget)**
- 0 items modeled on-site (live items live inside Subsplash)
- target: embedded from third-party
- display preference: `embed`
- display format: `Subsplash Embed: <script id="subsplash-embed-78s4q8f" …>` (full embed code on file)

**Signature Events**
- 3 items
- schema: `name` `description`
- target: flat list, no individual pages
- sample (first record):
  - name: SpringFest
  - description: Our annual outdoor community event, formerly the Fall Festival, that brings Oro Valley together for a day of fun. Around 2,000 people join us.
- other items: Good Friday Service · A Campus for the Community
- 🟡 schema vocabulary note: these are annual marketing tiles, not calendared events. Doesn't fit `event_card`. Closest existing match is generic `feature_card` (name + description ± optional CTA). Add to vocabulary if pattern repeats across partners.

---

## Editorial decisions worth recording

- **Groups page topic conflated two concepts.** Crawl emitted 12 items under `connect_groups`, but only 4 are actual groups (Talk / Listen / Do / Care). The other 8 are connection channels (Connection Card, Members & Friends email, church app, social media) plus standalone CTAs. The drafted page surfaces only the 4 group types; the connection channels were intentionally dropped (they belong on Welcome, not Groups). Good editorial judgment — no action needed, just recorded.
