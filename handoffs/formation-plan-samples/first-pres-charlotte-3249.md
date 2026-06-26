# Formation Plan — Dev Handoff

*Translated from* `first-pres-charlotte-3249.json`
*Generated* 6/26/2026, 11:30:54 AM *fingerprint* `-rgvu76`

## How to use this doc

1. **Open questions section first** — strategist answers the content questions; McNeel answers the implementation ones. Don't start building until they're filled in.
2. **Build the WP objects** (CPTs + Options page) using the registration args in each "WordPress object" section. Then add the ACF field groups using the structures shown.
3. **Populate the content** using the sidecar `<filename>.content-import.json` — each WP object has a matching block with records ready to seed via your AI assistant or wp-cli.

## At a glance

| Metric | Count |
|--------|------:|
| Classifications (one per piece of content) | 1051 |
| WordPress objects (CPTs + Options + Repeaters) | 70 |
| ACF field groups | 70 |
| Open questions (need an answer before build) | 14 |
| Low-confidence classifications | 0 |

## Open questions — answer before building

Each question has an empty **Answer** line. The owner writes the decision back in, then the dev unblocks.

### For the Strategist (1)

Content / modelling decisions — what the site should HAVE, not how it's wired.

**Q1.** Confirm with McNeel: should the `event` CPT have a single-detail template? Default depends on partner intent.

- *Affects:* `single-event/heading`, `single-event/featured_image`, `single-event/content`, `single-event/card`, `wp_object.event`
- **Answer:** ___________________________________________________________

### For McNeel (1)

Implementation decisions — how to wire what the strategist's already decided.

**Q1.** Confirm with McNeel: use Bricks native Nestable for this page, or fall back to ACF Flexible Content?

- *Affects:* `employment/__page_layout`, `events/__page_layout`, `local-global/__page_layout`, `staff/__page_layout`, `the-history-hallway/__page_layout`, `watch/__page_layout`
- **Answer:** ___________________________________________________________

## WordPress objects to register

### Custom Post Types (6)

#### `staff` — Staff Member / Staff

**Registration**

- Single detail page: ✅ yes — CPT `staff` has detail-section roles in the approved pages — single template needed.
- Archive page: ❌ no
- Public: yes · Queryable: yes · REST: yes · In nav menus: yes · In search: yes
- Supports: title, editor, thumbnail, revisions
- URL slug: `/staff/`
- Menu icon: `dashicons-groups`
- Taxonomies:
  - `staff_team` — Team / Teams (hierarchical)
  - `staff_campus` — Campus / Campuses (flat)

**ACF field group**

- Key: `acf.staff`
- Fields:
  - `tagline` (text) — *Tagline*
  - `heading` (text, required) — *Heading*
  - `description` (wysiwyg) — *Description*
  - `row_grid` (repeater) — *Row Grid*
    - `card_team` (repeater) — *Card Team*
      - `team_name` (text, required) — *Staff name*
      - `team_position` (text) — *Role / title*
      - `team_description` (wysiwyg) — *Bio / about*
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*
  - `avatar` (image) — *Headshot / Avatar*
  - `subheading` (text) — *Subheading*
  - `list_item` (repeater) — *List Item*
    - `description` (wysiwyg) — *Description*
  - `social_wrapper` (repeater) — *Social Wrapper*
    - `linkedin` (url) — *LinkedIn profile URL*
  - `inner_container_content` (repeater) — *Inner Container Content*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*
    - `description_2` (wysiwyg) — *Description 2*
    - `heading_2` (text) — *Heading 2*
  - `staff_team` (taxonomy) → `staff_team` — *Team*
  - `staff_campus` (taxonomy) → `staff_campus` — *Campus*

**Existing records to seed** — 61 records (full data in `.content-import.json`)

<details><summary>Anna Dickson</summary>

```json
{
  "team_name": "Anna Dickson",
  "team_position": "Executive Pastor and Pastor for Congregational Care",
  "team_description": "<p><a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"text-wm-accent-strong underline\" href=\"mailto:adickson@firstpres-charlotte.org\"><u>adickson@firstpres-charlotte.org</u></a></p>",
  "_source_group": "card_team"
}
```
</details>

<details><summary>Chuck Williamson</summary>

```json
{
  "team_name": "Chuck Williamson",
  "team_position": "Parish Associate",
  "team_description": "<p><a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"text-wm-accent-strong underline\" href=\"mailto:cwilliamson@firstpres-charlotte.org\"><u>cwilliamson@firstpres-charlotte.org</u></a></p>",
  "_source_group": "card_team"
}
```
</details>

<details><summary>Mary Bowman</summary>

```json
{
  "team_name": "Mary Bowman",
  "team_position": "Parish Associate",
  "team_description": "<p><a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"text-wm-accent-strong underline\" href=\"mailto:mbowman@firstpres-charlotte.org\"><u>mbowman@firstpres-charlotte.org</u></a></p>",
  "_source_group": "card_team"
}
```
</details>

*(58 more in the sidecar JSON)*

#### `career` — Career / Careers 🔒 **headless**

**Registration**

- Single detail page: ❌ no — CPT `career` only appears in listing roles in the approved pages — single template disabled, query loop drives the listing instead.
- Archive page: ❌ no
- Public: no · Queryable: no · REST: yes · In nav menus: no · In search: no (excluded)
- Supports: title, editor, thumbnail, revisions
- Menu icon: `dashicons-businessperson`
- Taxonomies:
  - `career_department` — Department / Departments (hierarchical)

**ACF field group**

- Key: `acf.career`
- Fields:
  - `tagline` (text) — *Tagline*
  - `heading` (text, required) — *Heading*
  - `description` (wysiwyg) — *Description*
  - `position` (repeater) — *Position*
    - `title` (text, required) — *Position title*
    - `location` (text) — *Location*
    - `summary` (wysiwyg) — *Job summary*
    - `apply_cta` (group) — *Apply CTA*
      - `label` (text) — *Label*
      - `url` (url) — *URL*
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*
  - `career_department` (taxonomy) → `career_department` — *Department*

**CTA / button routing** — 1 destination across this group:

- **1** → file download (PDF / doc / etc.) — e.g. `https://firstpres-charlotte.org/wp-content/uploads/2026/01/…`

**Existing records to seed** — 1 record (full data in `.content-import.json`)

<details><summary>Afternoon/Evening Custodian</summary>

```json
{
  "title": "Afternoon/Evening Custodian",
  "summary": "<p>The custodian is a 37.5-hour-per-week position working with and reporting to the Director of Operations. Custodians are responsible for maintaining the cleanliness and orderliness of school and church facilities. Primary tasks include setting and resetting meeting room layouts, vacuuming common areas and offices, light cleaning, maintaining property grounds, washing dishes in the church and school kitchen, and ensuring all areas are presentable and ready for use.</p>",
  "location": "Operations",
  "apply_cta_url": "https://firstpres-charlotte.org/wp-content/uploads/2026/01/Afternoon_Evening-Custodian-2026.pdf",
  "apply_cta_kind": "external_url",
  "apply_cta_label": "View Full Job Description",
  "apply_cta_target": "_blank",
  "_source_group": "position",
  "_cta_routes": [
    {
      "field": "apply_cta_url",
      "url": "https://firstpres-charlotte.org/wp-content/uploads/2026/01/Afternoon_Evening-Custodian-2026.pdf",
      "route_type": "file",
      "hint": ".pdf download"
    }
  ]
}
```
</details>

#### `event` — Event / Events

**Registration**

- Single detail page: ✅ yes — CPT `event` has detail-section roles in the approved pages — single template needed.
- Archive page: ❌ no
- Public: yes · Queryable: yes · REST: yes · In nav menus: yes · In search: yes
- Supports: title, editor, thumbnail, revisions, excerpt
- URL slug: `/event/`
- Menu icon: `dashicons-calendar-alt`
- Taxonomies:
  - `event_category` — Category / Categories (hierarchical)
  - `event_campus` — Campus / Campuses (flat)

**ACF field group**

- Key: `acf.event`
- Fields:
  - `heading` (text, required) — *Heading*
  - `featured_image` (image) — *Featured image*
  - `content` (wysiwyg) — *Body content*
  - `card` (repeater) — *Card*
    - `date_card` (date_time_picker) — *Date*
    - `excerpt_card` (wysiwyg) — *Excerpt Card*
  - `event_category` (taxonomy) → `event_category` — *Category*
  - `event_campus` (taxonomy) → `event_campus` — *Campus*

**Existing records to seed:** *(none extracted)*

#### `post` — Post / Posts

**Registration**

- Single detail page: ✅ yes — CPT `post` has detail-section roles in the approved pages — single template needed.
- Archive page: ❌ no
- Public: yes · Queryable: yes · REST: yes · In nav menus: yes · In search: yes
- Supports: title, editor, thumbnail, revisions, excerpt, custom-fields
- URL slug: `/post/`
- Taxonomies:
  - `category` — Category / Categories (hierarchical)
  - `post_tag` — Tag / Tags (flat)

**ACF field group**

- Key: `acf.post`
- Fields:
  - `image` (image) — *Image*
  - `category_1` (text) — *Category tag*
  - `heading` (text, required) — *Heading*
  - `description` (wysiwyg) — *Description*
  - `avatar_author_container` (image) — *Image*
  - `author_name_author_container` (text) — *Heading*
  - `author_bio_author_container` (wysiwyg) — *Body*
  - `buttons_author_container` (group) — *CTA*
    - `label` (text) — *Label*
    - `url` (url) — *URL*
  - `category` (taxonomy) → `category` — *Category*
  - `post_tag` (taxonomy) → `post_tag` — *Tag*

**Existing records to seed** — 1 record (full data in `.content-import.json`)

<details><summary>Blog Post Heading</summary>

```json
{
  "image": null,
  "category_1": "News",
  "heading": "Blog Post Heading",
  "description": null,
  "avatar_author_container": null,
  "author_name_author_container": "",
  "author_bio_author_container": "<p>News &amp; Publications</p>",
  "buttons_author_container": null
}
```
</details>

#### `sermon` — Sermon / Sermons

**Registration**

- Single detail page: ✅ yes — Legacy "wordpress" value — treated as the equivalent of archive_pages (CPT + single template + archive).
- Archive page: ✅ yes
- Public: yes · Queryable: yes · REST: yes · In nav menus: yes · In search: yes
- Supports: title, editor, thumbnail, revisions, excerpt
- URL slug: `/sermon/`
- Menu icon: `dashicons-microphone`
- Taxonomies:
  - `sermon_series` — Series / Series (flat)
  - `sermon_speaker` — Speaker / Speakers (flat)
  - `sermon_topic` — Topic / Topics (hierarchical)

**ACF field group**

- Key: `acf.sermon`
- Fields:
  - `sermon_series` (taxonomy) → `sermon_series` — *Series*
  - `sermon_speaker` (taxonomy) → `sermon_speaker` — *Speaker*
  - `sermon_topic` (taxonomy) → `sermon_topic` — *Topic*

**Existing records to seed:** *(none extracted)*

#### `group` — Group / Groups

**Registration**

- Single detail page: ✅ yes — Groups in WP with per-group detail pages, listed via Bricks query loop on /groups.
- Archive page: ❌ no (rendered via query loop on `/groups`)
- Public: yes · Queryable: yes · REST: yes · In nav menus: yes · In search: yes
- Supports: title, revisions
- URL slug: `/group/`
- Menu icon: `dashicons-networking`
- Taxonomies:
  - `group_type` — Type / Types (hierarchical)
  - `group_day` — Day / Days (flat)
  - `group_campus` — Campus / Campuses (flat)

**ACF field group**

- Key: `acf.group`
- Fields:
  - `group_type` (taxonomy) → `group_type` — *Type*
  - `group_day` (taxonomy) → `group_day` — *Day*
  - `group_campus` (taxonomy) → `group_campus` — *Campus*

**Existing records to seed:** *(none extracted)*

### Global Settings / Options Page (1)

#### `global-site` — Global Site Settings

One editable surface for site-wide content. Bind references from any template here.

**ACF field group**

- Key: `acf.global_site`
- Fields:
  - `church_name` (text) — *Church Name*
  - `denomination` (text) — *Denomination*
  - `social_facebook_url` (url) — *Facebook URL*
  - `social_instagram_url` (url) — *Instagram URL*
  - `social_youtube_url` (url) — *YouTube URL*
  - `social_tiktok_url` (url) — *TikTok URL*
  - `social_twitter_url` (url) — *X / Twitter URL*
  - `social_linkedin_url` (url) — *LinkedIn URL*
  - `address` (text) — *Address*
  - `city_state` (text) — *City, State*
  - `phone` (text) — *Phone*
  - `email` (email) — *Email*
  - `primary_service_time` (text) — *Primary Service Time*
  - `all_service_times` (wysiwyg) — *All Service Times*
  - `pastor_name` (text) — *Pastor Name*

**CTA / button routing** — 3 destinations across this group:

- **2** → social profile — e.g. `https://www.facebook.com/firstprescharlotte`, `https://www.instagram.com/firstprescharlotte/`
- **1** → YouTube — e.g. `https://www.youtube.com/@firstprescharlotte`

**Current global values** — 1 record (full data in `.content-import.json`)

<details><summary>First Presbyterian Church of Charlotte</summary>

```json
{
  "church_name": "First Presbyterian Church of Charlotte",
  "denomination": null,
  "social_facebook_url": "https://www.facebook.com/firstprescharlotte",
  "social_instagram_url": "https://www.instagram.com/firstprescharlotte/",
  "social_youtube_url": "https://www.youtube.com/@firstprescharlotte",
  "social_tiktok_url": null,
  "social_twitter_url": null,
  "social_linkedin_url": null,
  "address": "200 W. Trade Street, Charlotte, NC 28202",
  "city_state": "Charlotte, NC",
  "phone": "704.332.5123",
  "email": "communications@firstpres-charlotte.org",
  "primary_service_time": null,
  "all_service_times": "Sundays, 9 a.m. and 11 a.m.",
  "pastor_name": "Rev. Pendleton Peery",
  "_cta_routes": [
    {
      "field": "social_facebook_url",
      "url": "https://www.facebook.com/firstprescharlotte",
      "route_type": "social",
      "hint": "social profile / post"
    },
    {
      "field": "social_instagram_url",
      "url": "https://www.instagram.com/firstprescharlotte/",
      "route_type": "social",
      "hint": "social profile / post"
    },
    {
      "field": "social_youtube_url",
      "url": "https://www.youtube.com/@firstprescharlotte",
      "route_type": "youtube",
      "hint": "YouTube video / channel"
    }
  ]
}
```
</details>

### Page-scoped Repeater field groups (63)

One ACF repeater field per (page, content piece). Bound to a Bricks page template; populate via the sidecar `.content-import.json`.

#### Page: `/about` — 8 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_about_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `list_content`

**ACF field group**

- Key: `acf.repeater_about_list_content`
- Fields:
  - `list_content` (repeater) — *List Content*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>"In the name of Christ by the power of the Holy Spirit, the Christian community…</summary>

```json
{
  "description": "<p><em>\"In the name of Christ by the power of the Holy Spirit, the Christian community worships and serves God in shared experiences of life, in personal discipleship, in mutual ministry, and in common ministry in the world.\"</em></p>"
}
```
</details>

<details><summary>"The Church is called to be a sign in and for the world of the new reality whic…</summary>

```json
{
  "description": "<p><em>\"The Church is called to be a sign in and for the world of the new reality which God has made available to people in Jesus Christ.\"</em></p>"
}
```
</details>

##### Repeater: `tagline`

**ACF field group**

- Key: `acf.repeater_about_tagline`
- Fields:
  - `tagline` (text) — *Tagline*

**Existing rows:** *(none extracted)*

##### Repeater: `heading`

**ACF field group**

- Key: `acf.repeater_about_heading`
- Fields:
  - `heading` (text, required) — *Heading*

**Existing rows:** *(none extracted)*

##### Repeater: `description`

**ACF field group**

- Key: `acf.repeater_about_description`
- Fields:
  - `description` (wysiwyg) — *Description*

**Existing rows:** *(none extracted)*

##### Repeater: `accordion_right`

**ACF field group**

- Key: `acf.repeater_about_accordion_right`
- Fields:
  - `accordion_right` (repeater) — *Accordion Right*
    - `title` (text, required) — *Question*
    - `description` (wysiwyg) — *Answer*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>Women in Ministry</summary>

```json
{
  "text": "Women serve as pastors, elders, deacons, teachers, and leaders across all ministries. This community joyfully affirms the gifts of women for every form of leadership.",
  "title": "Women in Ministry",
  "description": "<p>Women serve as pastors, elders, deacons, teachers, and leaders across all ministries. This community joyfully affirms the gifts of women for every form of leadership.</p>"
}
```
</details>

<details><summary>Racial Justice</summary>

```json
{
  "text": "First Presbyterian is actively reckoning with its own racial history and is committed to ongoing anti-racism work. Racial justice is understood as a theological issue, not a political one.",
  "title": "Racial Justice",
  "description": "<p>First Presbyterian is actively reckoning with its own racial history and is committed to ongoing anti-racism work. Racial justice is understood as a theological issue, not a political one.</p>"
}
```
</details>

<details><summary>Politics and Public Life</summary>

```json
{
  "text": "The church prays for leaders at every level but does not endorse political parties or candidates. Following Jesus, this community believes, has real consequences for how you care for your neighbors.",
  "title": "Politics and Public Life",
  "description": "<p>The church prays for leaders at every level but does not endorse political parties or candidates. Following Jesus, this community believes, has real consequences for how you care for your neighbors.</p>"
}
```
</details>

##### Repeater: `accordion_left`

**ACF field group**

- Key: `acf.repeater_about_accordion_left`
- Fields:
  - `accordion_left` (repeater) — *Accordion Left*
    - `title` (text, required) — *Question*
    - `description` (wysiwyg) — *Answer*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>Reformed Faith</summary>

```json
{
  "title": "Reformed Faith",
  "description": "<p>God's sovereignty and grace are the foundation. Faith is a journey of submission to God's Word, not a destination you arrive at once.</p>"
}
```
</details>

<details><summary>Scripture</summary>

```json
{
  "title": "Scripture",
  "description": "<p>Trusted as the unique and authoritative witness to Jesus Christ, interpreted in community, guided by the Holy Spirit.</p>"
}
```
</details>

<details><summary>Inclusion</summary>

```json
{
  "title": "Inclusion",
  "description": "<p>All people have inherent dignity as God's children. First Presbyterian is a member of the Covenant Network of Presbyterians and affirms LGBTQIA+ people as full participants in the life and leadership of the church.</p>"
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_about_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/the-history-hallway` — 8 repeaters

##### Repeater: `feature_element`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_feature_element`
- Fields:
  - `feature_element` (repeater) — *Feature Element*
    - `description_feature_element` (wysiwyg) — *Description Feature Element*

**Existing rows:** *(none extracted)*

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

##### Repeater: `tagline`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_tagline`
- Fields:
  - `tagline` (text) — *Tagline*

**Existing rows:** *(none extracted)*

##### Repeater: `heading`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_heading`
- Fields:
  - `heading` (text, required) — *Heading*

**Existing rows:** *(none extracted)*

##### Repeater: `description`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_description`
- Fields:
  - `description` (wysiwyg) — *Description*

**Existing rows:** *(none extracted)*

##### Repeater: `accordion_right`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_accordion_right`
- Fields:
  - `accordion_right` (repeater) — *Accordion Right*
    - `title` (text, required) — *Question*
    - `description` (wysiwyg) — *Answer*

**Existing rows:** *(none extracted)*

##### Repeater: `accordion_left`

**ACF field group**

- Key: `acf.repeater_the-history-hallway_accordion_left`
- Fields:
  - `accordion_left` (repeater) — *Accordion Left*
    - `title` (text, required) — *Question*
    - `description` (wysiwyg) — *Answer*

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>Repentance and Resurrection Statement</summary>

```json
{
  "title": "Repentance and Resurrection Statement",
  "description": "<p><em>Teacher, which commandment in the law is the greatest?&nbsp; Jesus said to him, You shall love the Lord your God with all your heart, and with all your soul, and with all your mind… And… You shall love your neighbor as yourself.</em></p><p>Since its founding in 1821, the roots of First Presbyterian Church have wound inextricably through the roots of Charlotte, exerting a powerful impact both as a body of Christ and as a group of dedicated individuals acting throughout the community. Countless examples exist of faithful, compassionate, even courageous ministries spread by FPC and its members.</p><p>But because the Church is a human instrument used by God for divine purposes, there are also examples of human failings and sinfulness. Thus, the soil of our history includes numerous incidents of exclusion, racism, sexism, and other affronts to the promise of God’s inseparable love for all people. In particular, FPC and its members have condoned, sanctioned, and given moral legitimacy to slavery and white supremacy.</p><p><em>We confess these moral failings unequivocally.</em>&nbsp;We do so not as morally superior beings casting judgment on the past, but as sinners in need of God’s grace. The purpose of confession and repentance is to acknowledge our need for grace before God.&nbsp; To be a covenant community means we must own the sins of the past if we are to repent and respond to God’s call to a new and better future together. We are committed both to remembering our history and to continuing to take steps towards repair.</p><p>As we work to repent of our sins, we look forward to the promise of forgiveness, and to the promise of resurrection – both of which remind us that change and a new way of life are not only possible, but are assured through Christ our Redeemer.</p><p><em>In memory of all those who entered and worshipped at First Presbyterian Church as enslaved or otherwise subordinated people, including these described by name in Session minutes: Marie, a colored woman belonging to Rev. Cyrus Johnson; Joe, a slave formerly the property of James Irwin; Charity, a servant girl of Mr. Irwin; Sophia, a servant to Joseph H. White; Charles, a servant belonging to John Williamson; and Alexander, a servant of Mr. Henderson.</em></p>"
}
```
</details>

<details><summary>Artist’s Statement</summary>

```json
{
  "title": "Artist’s Statement",
  "description": "<p>This project grew out of the work of the history section of the FPC Racial Justice Task Force, which was convened in 2020. Among the recommendations approved by the Session were: “Add a new plaque that includes confession of our past sins and a statement of repentance to be displayed in a prominent location outside the sanctuary. Find a way of recognizing specific people who were enslaved at FPC.” To accomplish this mission, I worked to create a visual piece in hopes of enticing the congregation to think more deeply about what the words were intended to convey.</p><p>The initial call I received from FPC was unexpected, as I have not been an active member of the church since moving away some years ago. The first question was how to present the statement on “Repentance and Resurrection” in a way that stands out from the large brass plaques formerly in the sanctuary. How can we entice the congregation to notice and read the words?&nbsp;</p><p>We began by discussing the shape of the piece. What could we do to make it distinctly different from the other plaques? I asked about possibly reclaiming some wood that had been removed from the sanctuary. Little did I know that the inquiry would lead to the door to the former choir loft arriving at my home. For some members of the church, this particular door may not hold meaning or emotional weight. For me, as a former choir member, that door represents so much that is good and wonderful about the ministry of FPC. Once I realized that the door was available, there were no further questions about the shape. From there, the door dictated how this project would unfold.</p><p>The tree flowed naturally from my own work, where I often use them as a stand-in for bodies to make difficult statements relatable, but also to connect our past with hopes for the future. With the magnificent oaks standing in the front of the church and their presence in the “Repentance and Resurrection” text, it was very natural to use a tree as the main motif.&nbsp;</p><p>As we spoke about the intentions behind the piece, it became increasingly apparent that the words needed to be visibly personal, something that the viewers could relate to, as opposed to a formal corporate confession. The style of lettering conveys information beyond the words. Printed letters in a font convey a formal corporate tone. Calligraphic hand lettering styles are also frequently used in more formal settings. It dawned on me that the best way to make this text personal was to use my own handwriting with all of its inconsistencies and imperfections.&nbsp;</p><p>Much of my recent work emphasizes “the flaws” that speak to our humanity and acknowledge the paradox of both its beauty and its foibles. I now work mostly with silver, allowing it to tarnish. The process of oxidization takes time. It is not something that I can predict or control. That unvarnished truth made silver leaf ideal as a carrier for meaning on this project. It should be noted that the piece is not varnished. The silver will oxidize and darken over time.</p><p><em>Originally from Ohio, artist Amy E. Gray lived and worked in Charlotte from 1996 to 2009. She sang in the FPC choir from 1999 to 2009. While at FPC, she had the opportunity to create several works for the church: the artwork on the harpsichord, the decorative work in the youth area and the mustard seed drawings. In 2009, she relocated to the DC area to attend Wesley Theological Seminary where she studied the relationship between religion and the arts. There she spent a decade working at the Henry Luce III Center for the Arts and Religion. She currently lives in Alexandria, VA where she continues creating artwork that engages the relationship between our human frailty and the divine. </em><a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"text-wm-accent-strong underline\" href=\"http://www.amyegraystudio.com\"><em>www.amyegraystudio.com</em></a></p>"
}
```
</details>

#### Page: `/new` — 7 repeaters

##### Repeater: `feature_element`

**ACF field group**

- Key: `acf.repeater_new_feature_element`
- Fields:
  - `feature_element` (repeater) — *Feature Element*
    - `description_feature_element` (wysiwyg) — *Description Feature Element*

**Existing rows:** *(none extracted)*

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_new_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → application or signup form — e.g. `https://firstpres-charlotte.formstack.com/forms/im_new`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://firstpres-charlotte.formstack.com/forms/im_new</summary>

```json
{
  "contact_url": "https://firstpres-charlotte.formstack.com/forms/im_new",
  "contact_label": "Ask Questions and Find Support",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "https://firstpres-charlotte.formstack.com/forms/im_new",
      "route_type": "form",
      "hint": "application / signup form"
    }
  ]
}
```
</details>

##### Repeater: `card_03`

**ACF field group**

- Key: `acf.repeater_new_card_03`
- Fields:
  - `card_03` (repeater) — *Card 03*
    - `image_card` (image) — *Image Card*
    - `heading_card` (text, required) — *Heading Card*
    - `description_card` (wysiwyg) — *Description Card*
    - `button_card` (group) — *CTA*
      - `label` (text) — *Label*
      - `url` (url) — *URL*

**CTA / button routing** — 1 destination across this group:

- **1** → external page — e.g. `https://www.google.com/maps/d/u/0/viewer?mid=1N-seFDQ0d9QIk…`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://www.google.com/maps/d/u/0/viewer?mid=1N-seFDQ0d9QIkTJe7BxmHXUcXjFEBdBW&…</summary>

```json
{
  "button_card_url": "https://www.google.com/maps/d/u/0/viewer?mid=1N-seFDQ0d9QIkTJe7BxmHXUcXjFEBdBW&ll=35.22953865596162%2C-80.84451825000001&z=19",
  "button_card_kind": "external_url",
  "button_card_label": "Parking Map",
  "heading_card": "Find Us in Uptown Charlotte",
  "description_card": "<p><strong>200 West Trade Street, Charlotte, NC 28202<br>Office hours: Monday through Friday, 8 a.m. to 5 p.m.<br>Phone: (704) 332-5123</strong></p><p>Free parking is available on Sunday mornings in the surface lot at the corner of Trade and Poplar Streets. Enter from Poplar Street, directly across from the church. After parking, walk up the driveway until you see the brick pathway and TV screen, where a campus map will guide your next steps.</p><p><em>Accessible parking is available on the driveway in front of the Sanctuary, accessed from Church Street.</em></p>",
  "_cta_routes": [
    {
      "field": "button_card_url",
      "url": "https://www.google.com/maps/d/u/0/viewer?mid=1N-seFDQ0d9QIkTJe7BxmHXUcXjFEBdBW&ll=35.22953865596162%2C-80.84451825000001&z=19",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_new_card`
- Fields:
  - `card` (repeater) — *Card*
    - `card_icon_card` (image) — *Card Icon Card*
    - `card_heading_card` (text, required) — *Card Heading Card*
    - `card_description_card` (wysiwyg) — *Card Description Card*
    - `buttons_card` (group) — *CTA*
      - `label` (text) — *Label*
      - `url` (url) — *URL*

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>internal_route</summary>

```json
{
  "buttons_card_kind": "internal_route",
  "card_heading_card": "Contemplative Service",
  "card_description_card": "<p>Sundays, 9 a.m. | Chapel | September through May</p><p>A quiet, reflective service with communion each week, Scripture, and space for silence. During summer months (starting May 24), this service pauses. Check the current bulletin for seasonal times.</p><p><strong><em>Note: </em></strong><em>The Contemplative Service pauses for summer, starting May 24. During summer months, one Traditional Service is held at 11 a.m. Check the current bulletin for seasonal schedule.</em></p>"
}
```
</details>

<details><summary>Traditional Service</summary>

```json
{
  "card_heading_card": "Traditional Service",
  "card_description_card": "<p>Sundays, 11 a.m. | Sanctuary | Year-round</p><p>The Traditional Service is the full expression of Presbyterian worship: corporate prayer, hymns, a choir, Scripture, and a sermon. It's rooted in tradition and alive with music. This service runs all year, including summer.</p>"
}
```
</details>

##### Repeater: `column_list`

**ACF field group**

- Key: `acf.repeater_new_column_list`
- Fields:
  - `column_list` (repeater) — *Column List*
    - `image` (image) — *Image*
    - `card` (repeater) — *Card*
      - `heading_card` (text, required) — *Heading Card*
      - `description_card` (wysiwyg) — *Description Card*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Nursery (Birth through Age 2)",
      "description_card": "<p>The nursery is open beginning at 9:30 a.m. in Room P311. Professionally trained staff provide a safe, loving environment. When children turn three, they&#39;re encouraged to join Sunday School and First Church.</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Children's Sunday School (Ages 3 through 5th Grade)",
      "description_card": "<p>Sunday School runs from 9:45 to 10:45 a.m. Children meet in the gym at 9:45 and are escorted to their classrooms at 10. Pick-up is in the gym at 10:45. For check-in, a parent or guardian must be present. Each child receives a two-part security sticker: one half stays with the child, the other half goes with the parent. Only the adult with the matching tag can pick up.</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "First Church (Ages 3 through 1st Grade, During the 11 a.m. Service)",
      "description_card": "<p>During the 11 a.m. service, children participate in the Time for Children in the sanctuary. Afterward, they leave with a leader for First Church, a simplified worship experience where they help lead and engage with the day&#39;s Scripture. They rejoin their families during the final hymn.</p>"
    }
  ]
}
```
</details>

##### Repeater: `tab`

**ACF field group**

- Key: `acf.repeater_new_tab`
- Fields:
  - `tab` (repeater) — *Tab*
    - `tagline` (text) — *Tab tagline*
    - `image` (image) — *Image*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*
    - `buttons` (repeater) — *Buttons*
      - `contact` (text) — *Button label*

**CTA / button routing** — 2 destinations across this group:

- **1** → application or signup form — e.g. `https://form.jotform.com/81076098123153`
- **1** → email (mailto:) — e.g. `mailto:jives@firstpres-charlotte.org `

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>Baptsim</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://form.jotform.com/81076098123153",
        "kind": "mailto",
        "label": "Sign Up for Baptism"
      }
    }
  ],
  "heading": "Baptsim",
  "description": "<p>Baptism is a visible sign of God's grace and a lifelong marker of belonging. God chooses, calls, and claims people even before they can fully articulate faith. Baptism isn't just something that happens to you; it's something the whole congregation commits to live out with you.</p><p>At FPC, baptism is offered for both infants and adults. The Session (the church's governing board of elders) asks families and individuals to attend a brief baptism class to understand the meaning of the sacrament and the promises being made. Whether you're exploring baptism for yourself or for your child, this is a meaningful and supported next step.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://form.jotform.com/81076098123153",
      "route_type": "form",
      "hint": "application / signup form"
    }
  ]
}
```
</details>

<details><summary>Membership</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "mailto:jives@firstpres-charlotte.org ",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Membership",
  "description": "<p>First Presbyterian encourages you to worship here first and get a feel for the community before thinking about membership. There's no pressure and no timeline.</p><p>When you're ready to explore joining, reach out to our Membership Coordinator who is glad to connect before or after worship or during the week to answer questions and walk you through the process. A quarterly New Member Class introduces the church and the Presbyterian tradition. After the class, new members are welcomed during the 11 a.m. service the following Sunday.</p><p><em>Offered twice a year, in the spring and fall, First Presbyterian Church hosts a New Member Luncheon for everyone who has joined in the previous six months.</em></p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "mailto:jives@firstpres-charlotte.org ",
      "route_type": "mailto",
      "hint": "jives@firstpres-charlotte.org"
    }
  ]
}
```
</details>

##### Repeater: `tab_button`

**ACF field group**

- Key: `acf.repeater_new_tab_button`
- Fields:
  - `tab_button` (repeater) — *Tab Button*
    - `heading` (text, required) — *Heading*

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>Get Baptized</summary>

```json
{
  "heading": "Get Baptized"
}
```
</details>

<details><summary>Become A Member</summary>

```json
{
  "heading": "Become A Member"
}
```
</details>

#### Page: `/serve` — 5 repeaters

##### Repeater: `feature_element`

**ACF field group**

- Key: `acf.repeater_serve_feature_element`
- Fields:
  - `feature_element` (repeater) — *Feature Element*
    - `description_feature_element` (wysiwyg) — *Description Feature Element*

**Existing rows:** *(none extracted)*

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_serve_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → anchor on same page — e.g. `#`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>#</summary>

```json
{
  "contact_url": "#",
  "contact_kind": "anchor",
  "contact_label": "Find Your Role Below",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "#",
      "route_type": "internal-anchor",
      "hint": "#"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_serve_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

##### Repeater: `tab`

**ACF field group**

- Key: `acf.repeater_serve_tab`
- Fields:
  - `tab` (repeater) — *Tab*
    - `tagline` (text) — *Tab tagline*
    - `image` (image) — *Image*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*
    - `buttons` (repeater) — *Buttons*
      - `contact` (text) — *Button label*

**CTA / button routing** — 11 destinations across this group:

- **6** → external page — e.g. `https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213…`, `https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-610689…`, `https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-478188…`
- **5** → email (mailto:) — e.g. `mailto:fbryan@firstpres-charlotte.org`, `mailto:lcrain@firstpres-charlotte.org`, `mailto:cmcghee@alpcharlotte.org`

**Existing rows** — 5 records (full data in `.content-import.json`)

<details><summary>Room in the Inn</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213-room#/",
        "kind": "external_url",
        "label": "Sign Up to Host",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-61068969-room#/",
        "kind": "external_url",
        "label": "Sign Up to Make Beds",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "mailto:fbryan@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Room in the Inn",
  "description": "<p>Every Monday and Tuesday evening from December through March, 10 unsheltered guests are brought to the church from Roof Above, served dinner, given beds for the night, and sent off in the morning with breakfast and a bag lunch. Volunteers are needed to host overnight, provide and serve meals, and help make beds.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213-room#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-61068969-room#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[2].contact.url",
      "url": "mailto:fbryan@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "fbryan@firstpres-charlotte.org"
    }
  ]
}
```
</details>

<details><summary>Second Saturday for Service</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-47818846-second#/",
        "kind": "external_url",
        "label": "Sign Up",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "mailto:lcrain@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Second Saturday for Service",
  "description": "<p>On the second Saturday of every month from 9 to 11 a.m., volunteers serve alongside Crisis Assistance Ministry at their community FreeStore, helping neighbors who are working to avoid homelessness. Lunch together follows. Great for families, open to ages 10 and up.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-47818846-second#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "mailto:lcrain@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "lcrain@firstpres-charlotte.org"
    }
  ]
}
```
</details>

<details><summary>Operation Sandwich</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-roof1#/",
        "kind": "external_url",
        "label": "Sign Up",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "mailto:fbryan@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Operation Sandwich",
  "description": "<p>On the first Sunday of every month, volunteers gather in the Fellowship Hall to assemble up to 600 sandwiches — then deliver them to the College Street Day Center for unsheltered neighbors. Sunday school classes, young adults, youth, and new members all join in throughout the year.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-roof1#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "mailto:fbryan@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "fbryan@firstpres-charlotte.org"
    }
  ]
}
```
</details>

*(2 more in the sidecar JSON)*

##### Repeater: `tab_button`

**ACF field group**

- Key: `acf.repeater_serve_tab_button`
- Fields:
  - `tab_button` (repeater) — *Tab Button*
    - `heading` (text, required) — *Heading*

**Existing rows** — 6 records (full data in `.content-import.json`)

<details><summary>Room in the Inn</summary>

```json
{
  "heading": "Room in the Inn"
}
```
</details>

<details><summary>Nourish Up Food Pantry</summary>

```json
{
  "heading": "Nourish Up Food Pantry"
}
```
</details>

<details><summary>Second Saturday for Service</summary>

```json
{
  "heading": "Second Saturday for Service"
}
```
</details>

*(3 more in the sidecar JSON)*

#### Page: `/advocacy` — 4 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_advocacy_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → external page — e.g. `https://firstpres-charlotte.us7.list-manage.com/subscribe?u…`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://firstpres-charlotte.us7.list-manage.com/subscribe?u=329eb55dbe9b8f14eaa…</summary>

```json
{
  "contact_url": "https://firstpres-charlotte.us7.list-manage.com/subscribe?u=329eb55dbe9b8f14eaa9a0fe8&id=265dd823f8",
  "contact_label": "Sign Up for the Advocacy Newsletter",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "https://firstpres-charlotte.us7.list-manage.com/subscribe?u=329eb55dbe9b8f14eaa9a0fe8&id=265dd823f8",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

##### Repeater: `tab`

**ACF field group**

- Key: `acf.repeater_advocacy_tab`
- Fields:
  - `tab` (repeater) — *Tab*
    - `tagline` (text) — *Tab tagline*
    - `image` (image) — *Image*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*
    - `buttons` (repeater) — *Buttons*
      - `contact` (text) — *Button label*

**CTA / button routing** — 6 destinations across this group:

- **5** → email (mailto:) — e.g. `mailto:hclarke61@gmail.com`, `mailto:rossloeser@aol.com`, `mailto:lcrain@firstpres-charlotte.org`
- **1** → internal page (slug like `/sermons`) — e.g. `/the-history-hallway`

**Existing rows** — 5 records (full data in `.content-import.json`)

<details><summary>Housing and Homelessness</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "mailto:hclarke61@gmail.com",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Housing and Homelessness",
  "description": "<p>Many of Charlotte's neighbors don't have stable housing because of poverty, historically discriminatory policies, and systems that haven't kept up with the city's growth. Charlotte has families struggling to make rent and individuals on the street after a lost job or unexpected illness. They are all neighbors, and they are all, in the words of Scripture, made in God's image.</p><p>The Housing and Homelessness sub-ministry addresses the root causes of housing insecurity through education, advocacy, and shared action — not just immediate relief.</p><p><strong>What You Can Do Now:</strong></p><ul><li><p></p></li></ul><p></p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "mailto:hclarke61@gmail.com",
      "route_type": "mailto",
      "hint": "hclarke61@gmail.com"
    }
  ]
}
```
</details>

<details><summary>Racial Justice</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "mailto:rossloeser@aol.com",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "/the-history-hallway",
        "kind": "internal_route",
        "label": "Learn More"
      }
    }
  ],
  "heading": "Racial Justice",
  "description": "<p>Our faith in Jesus Christ leads this congregation to address racism as a theological issue, not a political one. The Racial Justice sub-ministry has undertaken a deep self-study of First Presbyterian's own history and continues to lead the congregation in ongoing anti-racism work. This means actively endorsing policies and ideas that lead to racial equity — through education, advocacy, and shared action in Charlotte.</p><p><strong>The History Hallway:</strong> First Presbyterian maintains a hallway dedicated to an honest reckoning with its own past. Photographs and brief biographies of each senior minister include both positive contributions and, truthfully, failings in the area of race. The Hallway also contains a Repentance and Resurrection statement and a work of art pointing toward hope and restoration.</p><p><strong>What You Can Do Now:</strong></p><ul><li><p></p></li></ul><p></p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "mailto:rossloeser@aol.com",
      "route_type": "mailto",
      "hint": "rossloeser@aol.com"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "/the-history-hallway",
      "route_type": "internal-page",
      "hint": "/the-history-hallway"
    }
  ]
}
```
</details>

<details><summary>Climate Change</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "mailto:lcrain@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Join or Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Climate Change",
  "description": "<p>Climate change is among the greatest challenges humanity has faced, and it disproportionately affects the most vulnerable people in Charlotte and around the world. The Climate Change sub-ministry provides understandable education and leads the congregation in prayerful, practical responses to address root causes.</p><p>Each quarter, the Climate Change Interest Group shares information and action steps. The goal is a congregation that is informed, engaged, and equipped to respond faithfully to what's happening to God's creation.</p><p><strong>What You Can Do Now:</strong></p><ul><li><p><a target=\"_blank\" rel=\"noopener noreferrer nofollow\" class=\"text-wm-accent-strong underline\" href=\"https://www.epa.gov/ghgemissions/carbon-footprint-calculator\">Calculate your carbon footprint</a></p></li></ul><p></p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "mailto:lcrain@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "lcrain@firstpres-charlotte.org"
    }
  ]
}
```
</details>

*(2 more in the sidecar JSON)*

##### Repeater: `tab_button`

**ACF field group**

- Key: `acf.repeater_advocacy_tab_button`
- Fields:
  - `tab_button` (repeater) — *Tab Button*
    - `heading` (text, required) — *Heading*

**Existing rows** — 5 records (full data in `.content-import.json`)

<details><summary>Housing and Homelessness</summary>

```json
{
  "heading": "Housing and Homelessness"
}
```
</details>

<details><summary>Racial Justice</summary>

```json
{
  "heading": "Racial Justice"
}
```
</details>

<details><summary>Climate Change</summary>

```json
{
  "heading": "Climate Change"
}
```
</details>

*(2 more in the sidecar JSON)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_advocacy_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/home` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_home_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 2 destinations across this group:

- **2** → internal page (slug like `/sermons`) — e.g. `/new`, `/watch`

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>/new</summary>

```json
{
  "contact_url": "/new",
  "contact_label": "Plan Your Visit",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "/new",
      "route_type": "internal-page",
      "hint": "/new"
    }
  ]
}
```
</details>

<details><summary>/watch</summary>

```json
{
  "contact_url": "/watch",
  "contact_label": "Watch Live",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "/watch",
      "route_type": "internal-page",
      "hint": "/watch"
    }
  ]
}
```
</details>

##### Repeater: `card_03`

**ACF field group**

- Key: `acf.repeater_home_card_03`
- Fields:
  - `card_03` (repeater) — *Card 03*
    - `image_card` (image) — *Image Card*
    - `heading_card` (text, required) — *Heading Card*
    - `description_card` (wysiwyg) — *Description Card*
    - `button_card` (group) — *CTA*
      - `label` (text) — *Label*
      - `url` (url) — *URL*

**CTA / button routing** — 1 destination across this group:

- **1** → external page — e.g. `https://maps.app.goo.gl/yxE2nXTaQzeS9Vnx9`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://maps.app.goo.gl/yxE2nXTaQzeS9Vnx9</summary>

```json
{
  "button_card_url": "https://maps.app.goo.gl/yxE2nXTaQzeS9Vnx9",
  "button_card_label": "Get Directions",
  "heading_card": "Find Us in Uptown Charlotte",
  "description_card": "<p><strong>200 West Trade Street, Charlotte, NC 28202<br>Office hours: Monday through Friday, 8 a.m. to 5 p.m.<br>Phone: (704) 332-5123</strong></p><p>Free parking is available on Sunday mornings in the surface lot at the corner of Trade and Poplar Streets. Enter from Poplar Street, directly across from the church. After parking, walk up the driveway until you see the brick pathway and TV screen, where a campus map will guide your next steps.</p><p><em>Accessible parking is available on the driveway in front of the Sanctuary, accessed from Church Street.</em></p>",
  "_cta_routes": [
    {
      "field": "button_card_url",
      "url": "https://maps.app.goo.gl/yxE2nXTaQzeS9Vnx9",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_home_card`
- Fields:
  - `card` (repeater) — *Card*
    - `card_icon_card` (image) — *Card Icon Card*
    - `card_heading_card` (text, required) — *Card Heading Card*
    - `card_description_card` (wysiwyg) — *Card Description Card*
    - `buttons_card` (group) — *CTA*
      - `label` (text) — *Label*
      - `url` (url) — *URL*

**Existing rows** — 2 records (full data in `.content-import.json`)

<details><summary>internal_route</summary>

```json
{
  "buttons_card_kind": "internal_route",
  "card_heading_card": "Contemplative Service",
  "card_description_card": "<p>Sundays, 9 a.m. | Chapel | September through May</p><p>A quiet, reflective service with communion each week, Scripture, and space for silence. During summer months (starting May 24), this service pauses. Check the current bulletin for seasonal times.</p><p><strong><em>Note: </em></strong><em>The Contemplative Service pauses for summer, starting May 24. During summer months, one Traditional Service is held at 11 a.m. Check the current bulletin for seasonal schedule.</em></p>"
}
```
</details>

<details><summary>Traditional Service</summary>

```json
{
  "card_heading_card": "Traditional Service",
  "card_description_card": "<p>Sundays, 11 a.m. | Sanctuary | Year-round</p><p>The Traditional Service is the full expression of Presbyterian worship: corporate prayer, hymns, a choir, Scripture, and a sermon. It's rooted in tradition and alive with music. This service runs all year, including summer.</p>"
}
```
</details>

#### Page: `/care` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_care_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → phone (tel:) — e.g. `tel:+17043325123`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>tel:+17043325123</summary>

```json
{
  "contact_url": "tel:+17043325123",
  "contact_kind": "tel",
  "contact_label": "Contact the Care Team",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "tel:+17043325123",
      "route_type": "tel",
      "hint": "+17043325123"
    }
  ]
}
```
</details>

##### Repeater: `row_list`

**ACF field group**

- Key: `acf.repeater_care_row_list`
- Fields:
  - `row_list` (repeater) — *Row List*
    - `item` (repeater) — *Item*
      - `heading` (text, required) — *Heading*
      - `description` (wysiwyg) — *Description*

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>Record (no name)</summary>

```json
{
  "item": [
    {
      "heading": "To request a pastoral visit:",
      "description": "<p>During office hours (Monday through Friday, 8 a.m. to 5 p.m.): call (704) 332-5123.</p><p>Outside of office hours: call the pastoral emergency line at (704) 927-0256. Your call will be returned promptly.</p>"
    },
    {
      "heading": "A note about hospital visits:",
      "description": "<p>Because of privacy regulations, hospitals do not notify churches when members are admitted. If you or a family member is hospitalized and would like a pastoral visit, please call the church office at (704) 332-5123.</p>"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_care_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/children-youth` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_children-youth_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_children-youth_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

##### Repeater: `column_list`

**ACF field group**

- Key: `acf.repeater_children-youth_column_list`
- Fields:
  - `column_list` (repeater) — *Column List*
    - `image` (image) — *Image*
    - `card` (repeater) — *Card*
      - `heading_card` (text, required) — *Heading Card*
      - `description_card` (wysiwyg) — *Description Card*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Carol Choir",
      "description_card": "<p><strong>Ages 4.5 years through 1st Grade</strong></p><p>Wednesday evenings, 5:45 to 6:45 p.m. | Room P307</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Kirk Choir",
      "description_card": "<p><strong>2nd Grade through 5th Grade</strong></p><p>Sunday evenings, 5:45 to 6:45 p.m. | Room P119</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Beginning Handbells",
      "description_card": "<p><strong>2nd Grade through 5th Grade</strong></p><p>Sunday evenings, 6:45 to 7:05 p.m. | Room P114</p>"
    }
  ]
}
```
</details>

#### Page: `/give` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_give_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → external page — e.g. `https://onrealm.org/firstprescharlotte/give/main`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://onrealm.org/firstprescharlotte/give/main</summary>

```json
{
  "contact_url": "https://onrealm.org/firstprescharlotte/give/main",
  "contact_label": "Give Online",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "https://onrealm.org/firstprescharlotte/give/main",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

##### Repeater: `row_list`

**ACF field group**

- Key: `acf.repeater_give_row_list`
- Fields:
  - `row_list` (repeater) — *Row List*
    - `item` (repeater) — *Item*
      - `heading` (text, required) — *Heading*
      - `description` (wysiwyg) — *Description*

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>Record (no name)</summary>

```json
{
  "item": [
    {
      "heading": "Kyle and Courtney Bullard, FPC members",
      "description": "<p><em>\"Our trust in God inspires us to make a pledge each year. Everything we have is a gift from God. We are stewards of what he has provided, and we are to use our gifts in a way that brings glory to God. The act of pledging is showing God you trust him with your well-being and know that he will always provide.\"</em></p>"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_give_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/local-global` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_local-global_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → internal page (slug like `/sermons`) — e.g. `/serve`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>/serve</summary>

```json
{
  "contact_url": "/serve",
  "contact_kind": "internal_route",
  "contact_label": "Find a Serving Opportunity",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "/serve",
      "route_type": "internal-page",
      "hint": "/serve"
    }
  ]
}
```
</details>

##### Repeater: `tab`

**ACF field group**

- Key: `acf.repeater_local-global_tab`
- Fields:
  - `tab` (repeater) — *Tab*
    - `tagline` (text) — *Tab tagline*
    - `image` (image) — *Image*
    - `heading` (text, required) — *Heading*
    - `description` (wysiwyg) — *Description*
    - `buttons` (repeater) — *Buttons*
      - `contact` (text) — *Button label*

**CTA / button routing** — 12 destinations across this group:

- **7** → external page — e.g. `https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213…`, `https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-610689…`, `https://www.amazon.com/hz/wishlist/ls/1OXTXO2BF4UIB?ref_=wl…`
- **5** → email (mailto:) — e.g. `mailto:fbryan@firstpres-charlotte.org`, `mailto:lcrain@firstpres-charlotte.org`, `mailto:cmcghee@alpcharlotte.org`

**Existing rows** — 6 records (full data in `.content-import.json`)

<details><summary>Room in the Inn</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213-room#/",
        "kind": "external_url",
        "label": "Sign Up to Host",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-61068969-room#/",
        "kind": "external_url",
        "label": "Sign Up to Make Beds",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "mailto:fbryan@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Room in the Inn",
  "description": "<p>Every Monday and Tuesday evening from December through March, First Presbyterian opens its doors to 10 unsheltered neighbors. Guests are picked up from Roof Above's College Street campus and brought to the church, where they're served dinner, given a warm place to sleep, and sent off in the morning with breakfast and a bag lunch.</p><p>First Presbyterian is one of the founding churches that helped organize Room in the Inn with Urban Ministry, and this congregation has shown up for it every winter since. The need is consistent. So is the commitment.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.signupgenius.com/go/8050545AAAA2BA1FE3-59454213-room#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-61068969-room#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[2].contact.url",
      "url": "mailto:fbryan@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "fbryan@firstpres-charlotte.org"
    }
  ]
}
```
</details>

<details><summary>Nourish Up Food Pantry</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.amazon.com/hz/wishlist/ls/1OXTXO2BF4UIB?ref_=wl_share",
        "kind": "external_url",
        "label": "Shop the Pantry Wishlist",
        "target": "_blank"
      }
    }
  ],
  "heading": "Nourish Up Food Pantry",
  "description": "<p>The Nourish Up Food Pantry is located on the bottom floor of First Presbyterian's Poplar Street building. Volunteer teams stock the shelves, receive warehouse deliveries, and help referred clients shop for groceries on Wednesday and Friday afternoons and on the second and third Saturday mornings of each month.</p><p>A newer addition is the Home Delivery program, which brings pre-packaged boxes of food directly to food-insecure families in the 28208 neighborhood surrounding the church. This program lets volunteers meet neighbors where they are, at their front doors.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.amazon.com/hz/wishlist/ls/1OXTXO2BF4UIB?ref_=wl_share",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

<details><summary>Second Saturday for Service</summary>

```json
{
  "buttons": [
    {
      "contact": {
        "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-47818846-second#/",
        "kind": "external_url",
        "label": "Sign Up",
        "target": "_blank"
      }
    },
    {
      "contact": {
        "url": "mailto:lcrain@firstpres-charlotte.org",
        "kind": "mailto",
        "label": "Contact Us",
        "target": "_blank"
      }
    }
  ],
  "heading": "Second Saturday for Service",
  "description": "<p>On the second Saturday of every month, First Pres volunteers spend the morning at Crisis Assistance Ministry's community FreeStore, working alongside CAM to help neighbors who are working to stay housed and financially stable. It's a two-hour commitment followed by lunch. Perfect for families — open to ages 10 and up.</p>",
  "_cta_routes": [
    {
      "field": "buttons[0].contact.url",
      "url": "https://www.signupgenius.com/go/10C0E48ABA82AA1FAC61-47818846-second#/",
      "route_type": "external",
      "hint": "external page"
    },
    {
      "field": "buttons[1].contact.url",
      "url": "mailto:lcrain@firstpres-charlotte.org",
      "route_type": "mailto",
      "hint": "lcrain@firstpres-charlotte.org"
    }
  ]
}
```
</details>

*(3 more in the sidecar JSON)*

##### Repeater: `tab_button`

**ACF field group**

- Key: `acf.repeater_local-global_tab_button`
- Fields:
  - `tab_button` (repeater) — *Tab Button*
    - `heading` (text, required) — *Heading*

**Existing rows** — 6 records (full data in `.content-import.json`)

<details><summary>Room in the Inn</summary>

```json
{
  "heading": "Room in the Inn"
}
```
</details>

<details><summary>Nourish Up Food Pantry</summary>

```json
{
  "heading": "Nourish Up Food Pantry"
}
```
</details>

<details><summary>Second Saturday for Service</summary>

```json
{
  "heading": "Second Saturday for Service"
}
```
</details>

*(3 more in the sidecar JSON)*

#### Page: `/worship` — 3 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_worship_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_worship_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

##### Repeater: `column_list`

**ACF field group**

- Key: `acf.repeater_worship_column_list`
- Fields:
  - `column_list` (repeater) — *Column List*
    - `image` (image) — *Image*
    - `card` (repeater) — *Card*
      - `heading_card` (text, required) — *Heading Card*
      - `description_card` (wysiwyg) — *Description Card*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Sanctuary Choir",
      "description_card": "<p><strong>Rehearsals: Wednesdays, 7 to 8:30 p.m.</strong></p><p>This choir leads music for the 11 a.m. Sunday service as well as special services and programs throughout the year. The Sanctuary Choir sings across the full spectrum of sacred music and provides a close-knit community within the church. New voices of all ages are always welcome. Some music-reading ability, pitch-matching skills, and a love of singing are required.</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{
  "card": [
    {
      "heading_card": "Adult Handbells",
      "description_card": "<p><strong>Rehearsals: Tuesdays, noon to 1 p.m.</strong></p><p>This skilled handbell ensemble rings in worship regularly throughout the year and participates in larger church events. Prior handbell and music-reading experience is encouraged. Ringers are always welcome to join.</p>"
    }
  ]
}
```
</details>

<details><summary>Record (no name)</summary>

```json
{}
```
</details>

#### Page: `/adults` — 2 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_adults_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>See All Offerings Below</summary>

```json
{
  "contact_label": "See All Offerings Below"
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_adults_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/events` — 2 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_events_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → anchor on same page — e.g. `#whats-coming-up`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>#whats-coming-up</summary>

```json
{
  "contact_url": "#whats-coming-up",
  "contact_kind": "anchor",
  "contact_label": "See All Events Below",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "#whats-coming-up",
      "route_type": "internal-anchor",
      "hint": "#whats-coming-up"
    }
  ]
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_events_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/staff` — 2 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_staff_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_staff_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/watch` — 2 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_watch_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows:** *(none extracted)*

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_watch_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/single-sermon` — 2 repeaters

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_single-sermon_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**Existing rows** — 3 records (full data in `.content-import.json`)

<details><summary>internal_route</summary>

```json
{
  "contact_kind": "internal_route",
  "contact_label": "Audio"
}
```
</details>

<details><summary>internal_route</summary>

```json
{
  "contact_kind": "internal_route",
  "contact_label": "Bulletin"
}
```
</details>

<details><summary>internal_route</summary>

```json
{
  "contact_kind": "internal_route",
  "contact_label": "Transcript"
}
```
</details>

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_single-sermon_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

#### Page: `/news-media` — 2 repeaters

##### Repeater: `card`

**ACF field group**

- Key: `acf.repeater_news-media_card`
- Fields:
  - `card` (repeater) — *Card*

**Existing rows:** *(none extracted)*

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_news-media_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → external page — e.g. `https://fpc.tiny.us/news`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>https://fpc.tiny.us/news</summary>

```json
{
  "contact_url": "https://fpc.tiny.us/news",
  "contact_kind": "external_url",
  "contact_label": "Subscribe",
  "contact_target": "_blank",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "https://fpc.tiny.us/news",
      "route_type": "external",
      "hint": "external page"
    }
  ]
}
```
</details>

#### Page: `/employment` — 1 repeater

##### Repeater: `buttons`

**ACF field group**

- Key: `acf.repeater_employment_buttons`
- Fields:
  - `buttons` (repeater) — *Buttons*
    - `contact` (text) — *Button label*

**CTA / button routing** — 1 destination across this group:

- **1** → anchor on same page — e.g. `#open-positions`

**Existing rows** — 1 record (full data in `.content-import.json`)

<details><summary>#open-positions</summary>

```json
{
  "contact_url": "#open-positions",
  "contact_label": "See Current Openings Below",
  "_cta_routes": [
    {
      "field": "contact_url",
      "url": "#open-positions",
      "route_type": "internal-anchor",
      "hint": "#open-positions"
    }
  ]
}
```
</details>

---
*Regenerate: `tsx scripts/translate-formation-plan.ts handoffs/formation-plan-samples/first-pres-charlotte-3249.json`*
