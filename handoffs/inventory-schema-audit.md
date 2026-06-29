# Content schema vocabulary + partner inventory audit

Two documents in one. The audit observations (what we saw across
Doxology, First Pres, and Arvada inventories) are the data; the
schema vocabulary (the analyzer's working set of recognized shapes)
is what we use the data to define.

---

## Part 1 — How the system thinks about content

### Schema ≠ page topic

A **schema** is the data shape that lives inside a section of items:
the columns of the CSV-like table. `person_card` carries name + role
+ bio + email + headshot. `event_card` carries name + date + time +
location + register_url.

A **page topic** is the categorical surface a church builds: a
Staff page, a Visitor page, a Watch page, a Capital Campaign page.
Page topics COMPOSE multiple schemas. A Staff page hosts
`person_card` items; a Visitor page hosts `service_time` +
`faq_qna` + `pathway_step`.

The diagnostic identifies SCHEMAS, not page topics. Page topics
are descriptive context for where schemas tend to appear.

### Three layers per schema instance

When a schema appears on a section, three layers of data attach:

1. **Per-item data** — the fields on each card / row / item.
2. **Concept-level integration config** — partner-supplied
   configuration from the Content Collection form (display
   preference, embed source URL, filter needs, playlist URL,
   weekly-update cadence, etc.). One config block per concept,
   shared by every section of that schema.
3. **CTA target type** — section-level click destination (additional
   page · file_download · external_url · signup_form · mailto ·
   tel · anchor · next_step · no_link).

The dev handoff surfaces all three for each schema instance.

### Schema vocabulary is open, not closed

The vocabulary below lists shapes the analyzer recognizes. It's a
**vocabulary**, not a checklist every church is graded against. If
a partner doesn't have any `volunteer_opportunity` items, they
don't need that schema — not a gap.

Anything that doesn't match a canonical shape but has the
"named-link-with-optional-metadata" pattern falls into the
`Resources` supertype, which names itself from the partner's own
section heading. Doxology's history hallway pastor timeline,
First Pres's bulletin archive, a partner's prayer-resource list,
devotional content collections — all Resources, with the
category derived from context.

### Per-partner output is a positive listing

For each partner, the analyzer emits "these schemas are observed
on this partner with these counts" — never "these schemas are
missing." If a church has no career listings, that's by design.

### CTA target type vocabulary

| Value | Meaning |
|---|---|
| `additional_page` | Per-item detail page we generate on the new site |
| `file_download` | Click downloads a file (PDF, doc, etc.) |
| `external_url` | Third-party URL (Church Center, YouTube, denomination resource) |
| `signup_form` | Application / registration form (Formstack, internal `/apply`, Google Form) |
| `mailto` | Email |
| `tel` | Phone |
| `anchor` | In-page jump |
| `next_step` | Specific page in our build (used by pathway schemas) |
| `no_link` | Display-only, no click destination |

---

## Part 2 — Schema vocabulary

Each schema below: **per-item fields** · **CTA target options** ·
**integration config (when applicable)** · **observed display
patterns**.

### `person_card`
Used for: Leadership · Staff · Care team · Counseling · Music
ministry team · Ministry program leaders.

**Per-item fields:** `name` · `role` · `bio` · `email` · `phone` ·
`headshot` · `linkedin` · `ministry_area`

**CTA target options:** `additional_page` (per-person detail) ·
`mailto` · `no_link` · `external_url`

**Integration config:** none specific.

**Display patterns:** card grid · per-person detail page · contact
modal.

### `sermon_card`
Used for: Sermons / Messages.

**Per-item fields:** `title` · `series` · `speaker` · `date` ·
`scripture` · `video_url` · `audio_url` · `notes_url` ·
`transcript_url` · `bulletin_url` · `duration`

**CTA target options:** `external_url` (YouTube / Vimeo) ·
`additional_page` (sermon detail) · `file_download` (notes,
bulletin) · `no_link`

**Integration config (from CC page 2):**
- `display_preference` (`latest_sermon` | `archive_pages` |
  `archive_youtube` | `latest_series_youtube` | `latest_series_pages`)
- `external_url` (sermon channel)
- `youtube_playlist_exists` + `youtube_playlist_url`
- `archive_features` (podcast · sermon notes · filters ·
  discussion guide)
- `weekly_update_needed` (manual push vs auto playlist)

**Display patterns:** archive grid · single featured embed ·
latest-series carousel.

### `event_card`
Used for: Events · Camps · Retreats.

**Per-item fields:** `name` · `description` · `audience` ·
`start_date` · `end_date` · `time` · `location` · `register_url` ·
`featured_image` · `cost`

**CTA target options:** `external_url` (Church Center embed source) ·
`signup_form` · `additional_page` (event detail) · `no_link`

**Integration config (from CC page 2):**
- `display_preference` (`wordpress` | `embed` | `external`)
- `display_format` (Calendar · Card · List)
- `external_url` (embed source)
- `wordpress_source_of_truth` (Events Calendar Plugin / etc.)
- `needs_filter` (y/n)
- `filter_includes` (search · category · audience · date)
- `recurring_events_needed` (y/n)
- `cta_target` (church center · register form · detail page)

**Display patterns:** event grid · calendar view · embed.

### `service_time`
Used for: Visitor orientation pages (Plan a Visit · New Here ·
Sundays · Home · multi-campus location pages).

**Per-item fields:** `name` · `when` · `location` · `description` ·
`audience` · `note`

**CTA target options:** `additional_page` (visitor page) · `no_link`

**Integration config:** none specific.

**Display patterns:** service info card · scheduled-times block.

### `faq_qna`
Used for: Beliefs · Statement of Faith · Baptism · Kids FAQs ·
Visitor-orientation Q&A · Membership questions · Plan a Visit
prep questions.

**Per-item fields:** `question` · `answer` · `scripture_ref` ·
`audience` · `context`

**CTA target options:** `no_link` (display-only inline expand) ·
`additional_page` (deep dive)

**Integration config:** none specific.

**Display patterns:** accordion · belief card · numbered list.

### `ministry_program_card`
Used for: Kids · Students · Youth · Adults · College / Young
Adults · Worship & Music · Care ministries · Adult education.

**Per-item fields:** `name` · `description` · `audience` (age
range / grade) · `contact` · `day` · `time` · `location` ·
`sign_up_url` · `philosophy`

**CTA target options:** `signup_form` · `additional_page` ·
`mailto` · `no_link`

**Integration config:** none specific.

**Display patterns:** card grid · feature list.

### `volunteer_opportunity`
Used for: Serve · Missions · Outreach · Volunteer roles.

**Per-item fields:** `name` · `description` · `audience` ·
`time_commitment` · `sign_up_url` · `contact`

**CTA target options:** `signup_form` · `mailto` · `additional_page` ·
`external_url`

**Integration config:** none specific.

**Display patterns:** card grid · accordion.

### `group_card`
Used for: Connect / Small groups · Life groups · Community groups.

**Per-item fields:** `name` · `description` · `leader` · `day` ·
`time` · `location` · `audience` · `contact_email` · `duration` ·
`philosophy`

**CTA target options:** `mailto` (contact leader) · `signup_form` ·
`additional_page` · `no_link`

**Integration config (from CC page 2):**
- `display_preference` (`wordpress` | `external` | `embed` | `contact`)
- `external_url`
- `wordpress_source_of_truth`
- `needs_filter` (y/n)
- `cta_target` (mailto · signup form · detail page)

**Display patterns:** card grid · filtered list with search.

### `pathway_step`
Used for: Discipleship pathway · Next Steps · Plan a Visit prep
sequence · onboarding flows.

**Per-item fields:** `step_order` · `name` · `description` ·
`audience` · `action_url` · `duration` · `philosophy`

**CTA target options:** `next_step` (subsequent step page) ·
`additional_page` · `external_url` · `signup_form` ·
`file_download` · `no_link`

**Integration config:** none specific.

**Display patterns:** numbered card sequence · stepper · "step
1 / 2 / 3 / …" visual.

### `blog_post_card`
Used for: Blog / News / Stories.

**Per-item fields:** `title` · `author` · `date` · `excerpt` ·
`body` · `featured_image` · `category` · `tags` · `url`

**CTA target options:** `additional_page` · `external_url`

**Integration config:** none specific.

**Display patterns:** card grid · featured hero · category-filtered
list.

### `way_to_give_card`
Used for: Giving page · campaign callouts on home page.

**Per-item fields:** `name` · `description` · `give_now_url` ·
`reference`

**CTA target options:** `external_url` (Realm / Givelify / etc.) ·
`file_download` (tax form / pledge card) · `mailto` · `no_link`

**Display patterns:** ways-to-give card list.

### `featured_campaign_card`
Used for: Active campaigns on Give page or home (links out to a
fuller campaign page).

**Per-item fields:** `name` · `description` · `target_amount` ·
`give_now_url` · `image_url` · `audience` · `progress`

**CTA target options:** `additional_page` (the fuller campaign
page) · `external_url` · `file_download` (pledge card)

**Display patterns:** featured card on Give or home · hero with
progress bar.

### `testimony_card`
Used for: Testimonies & Stories.

**Per-item fields:** `name` (person) · `role` · `story` ·
`scripture_ref` · `format` (video / written / quote) · `image_url`

**CTA target options:** `additional_page` · `external_url`
(YouTube) · `no_link`

**Display patterns:** card grid · featured story · carousel.

### `career_card`
Used for: Open positions / Careers.

**Per-item fields:** `title` · `department` · `location` ·
`employment_type` · `description` · `apply_url`

**CTA target options:** `file_download` (job description PDF) ·
`additional_page` · `external_url` (external job application) ·
`mailto`

**Display patterns:** card grid · job board list.

### `location_card`
Used for: Multi-site / multi-campus churches.

**Per-item fields:** `name` (campus name) · `address` ·
`service_times` · `phone` · `email` · `pastor_name` ·
`description` · `directions_url` · `image_url`

**CTA target options:** `additional_page` (per-location page) ·
`external_url` (Google Maps) · `mailto` · `no_link`

**Display patterns:** card grid · campus selector · per-campus
detail page · footer location picker.

### `Resources` (supertype — flexible catch-all)
Used for: anything else that's a named link with optional
metadata. Categories name themselves from the section heading:
**Bulletins** (First Pres newsletter archive), **Devotionals**,
**Prayer resources**, **Helpful links** (First Pres Watch page),
**Pastor timeline** (First Pres history hallway), reading lists,
denominational resources, partner resource libraries.

**Per-item fields:** `name` (optional) · `description` (optional) ·
`target_url` (required) · `target_url_type` (the CTA target type) ·
`image_url` (optional) · `resource_category` (named from section
heading) · `date` (optional) · `author` (optional) · `scope`
(optional)

**CTA target options:** any value in the CTA target vocabulary.

**Display patterns:** dated link list · card grid · accordion ·
sequence (when ordered).

**Promotion path:** when a `resource_category` recurs across 5+
partners with consistent shape, the squad may promote it to a
named canonical schema via [handoffs/build-time-errors.md](build-time-errors.md).
Until then, Resources holds it.

---

## Part 3 — Page topics observed across partners

Each topic below is a categorical page partners commonly build.
Each can host multiple schemas — and the same schema appears
across multiple topics (e.g. `person_card` shows up on Staff,
Care, Counseling, Music ministry).

| Page topic | Schemas typically composed |
|---|---|
| **Home** | `service_time` · `featured_campaign_card` · `pathway_step` (next-step CTAs) · `event_card` (upcoming) · `sermon_card` (latest) |
| **Visitor orientation** (Plan a Visit / New Here / Sundays) | `service_time` · `faq_qna` · `pathway_step` · `person_card` (greeters) |
| **About** (Who We Are / Our Story) | `person_card` (leaders) · `faq_qna` · `pathway_step` (history timeline) · `testimony_card` |
| **Beliefs / Statement of Faith** | `faq_qna` |
| **Staff** | `person_card` |
| **Watch / Messages / Sermons** | `sermon_card` · `Resources` (bulletin links / archive search) |
| **Events** | `event_card` |
| **Connect / Groups** | `group_card` · `faq_qna` |
| **Give** | `way_to_give_card` · `featured_campaign_card` · `faq_qna` |
| **Care** | `person_card` (counselors / pastoral team) · `ministry_program_card` (care groups) · `faq_qna` |
| **Kids ministry** | `ministry_program_card` · `faq_qna` · `service_time` (Sunday programming) · `person_card` (leads) |
| **Students / Youth** | `ministry_program_card` · `event_card` · `person_card` |
| **Adults / College** | `ministry_program_card` · `event_card` |
| **Missions / Outreach** | `volunteer_opportunity` · `ministry_program_card` · `Resources` (partner orgs) |
| **Serve / Volunteer** | `volunteer_opportunity` · `ministry_program_card` |
| **Counseling** | `person_card` · `Resources` (referral links) |
| **Camps / Retreats** | `event_card` (date-bound) · `Resources` (registration forms) |
| **School / Preschool** | `ministry_program_card` · `location_card` · `Resources` (enrollment PDFs) |
| **Careers** | `career_card` |
| **Blog / News** | `blog_post_card` |
| **Membership** | `pathway_step` · `faq_qna` |
| **Testimonies** | `testimony_card` |
| **Capital Campaigns** (when active) | `featured_campaign_card` · `way_to_give_card` · `faq_qna` |
| **Newsletter / Bulletin archive** | `Resources` (with category = "Newsletter" / "Bulletin") |
| **Multi-site Locations** | `location_card` |
| **Custom partner pages** | Resources + any canonical schemas that fit |

---

## Part 4 — Snapshot of the 3 partners audited

Read-only inventory inspection (June 2026). Listing what's
present on each — not a grade.

### Doxology Bible Church (member 1963)
- 53 topics in inventory, 49 with repeating items
- Multi-campus (3 congregations: Southwest / Alliance / Espanol)
- Topics observed: about · beliefs · sermons · events · kids ·
  students · adults · missions · serve · giving · care ·
  worship_music · groups · location_contact · new_here · sundays ·
  testimonies · blog_news · membership · counseling · school · ...
- Schemas inferred from inventory: `person_card` · `event_card` ·
  `sermon_card` · `service_time` · `faq_qna` · `ministry_program_card`
  · `volunteer_opportunity` · `group_card` · `pathway_step` ·
  `location_card` (multi-campus)

### First Presbyterian Charlotte (member 3249)
- 25 topics in inventory, 23 with repeating items
- Single-campus
- Topics observed: about · beliefs · sermons · events · kids ·
  students · adults · college · missions · serve · giving · care ·
  worship_music · location_contact · new_here · sundays ·
  testimonies · blog_news · membership · counseling · school ·
  newsletter_bulletin · baptism
- Schemas inferred: `person_card` (40 leadership records) ·
  `event_card` · `sermon_card` · `service_time` · `faq_qna` ·
  `ministry_program_card` · `volunteer_opportunity` ·
  `blog_post_card` (34 posts) · `testimony_card` ·
  `Resources` (8 newsletter / bulletin links to Mailchimp archive)

### Arvada Vineyard (member 3734)
- 21 topics in inventory, 17 with repeating items
- Multi-site (family of neighborhood churches)
- Topics observed: about · beliefs · sermons · events · kids ·
  students · missions · serve · giving · care · groups ·
  location_contact · new_here · plan_visit · counseling ·
  capital_campaign · connect_groups · careers
- Schemas inferred: `person_card` · `event_card` · `sermon_card`
  · `service_time` · `faq_qna` · `ministry_program_card` ·
  `volunteer_opportunity` · `group_card` (21 items — strongest
  group_card presence of the 3 partners) · `pathway_step` ·
  `career_card` (42 items) · `location_card` (multi-site)

---

## Part 5 — How this feeds the diagnostic pipeline

When the analyzer reads `web_project_topics.items` for a partner:

1. For each topic, walk the items array.
2. For each item, classify by SHAPE: does it match a canonical
   schema (person_card / event_card / etc.)?
3. If yes → emit a `DiagnosticSchemaInstance` with the schema name,
   the per-item fields detected (with fill rates), the CTA target
   type observed, and any concept-level integration config from
   CC page 2.
4. If no canonical match but the item is "named-link-shaped" →
   emit as a `Resources` instance with `resource_category` derived
   from the topic_label or section heading.
5. If neither → emit as an "unrecognized" instance carrying the
   raw fields so the strategist confirms.

Page-topic composition is descriptive context, not classification.
Two `person_card` instances on a Care page vs a Staff page are
both `person_card` — the page topic just adds context for the
strategist's mental model.

Output per partner: a list of `DiagnosticSchemaInstance`s. The dev
handoff groups them by page (for the strategist's reading order)
AND by schema (for the dev's modelling order). Both views from the
same data.
