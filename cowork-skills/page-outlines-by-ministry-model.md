# Church Website Page Outline Template Sets — by Ministry Model

> ## How this guide is used by the page-outlines agent
>
> **This is a FRAME OF REFERENCE, not a template-first source.**
>
> The page-outlines agent leads with the partner's actual content
> collection — atoms, voice rules, marks, snippets, persona data.
> This guide informs *conventional flow* (what sections tend to
> appear, in what order, on a given page-type × ministry model).
>
> Rules the agent must follow:
> 1. **Content collection wins.** If the partner doesn't have content
>    that fits a section the guide suggests, the section is dropped.
>    Never invent content to fill a template slot.
> 2. **Partner's own vocabulary wins.** If they say "Engage the
>    City," use that — don't substitute the guide's "Mission" label.
> 3. **`do_not_rewrite` marks are sacred.** Atoms marked
>    `approved_keep_as_is` on `strategy_content_collection_marks`
>    must be quoted verbatim into their assigned section, not
>    rewritten.
> 4. **The ministry-model is a STARTING POINT.** Most churches blend
>    models. The guide names the dominant; per-page deviations are
>    fine when the actual content demands them.
> 5. **Skip pages with no inventory.** If atoms tagged for a page
>    don't exist, don't generate the page from template alone.

---

**Purpose:** A copywriting guide, companion to the journey-stage sets. These three sets are organized by the **church's ministry model** — its philosophy of how it makes disciples. Because the model is a property of the *church* (not the page), it applies cleanly across all 9 page types, including the homepage. Pick the set that matches the partner church's dominant philosophy, then write every page in that voice and structure.

**How the three sets differ:** Same page type, different center of gravity. The model decides what leads, what gets the most real estate, and where the primary CTA points.

| Set | Ministry model | Core conviction | The "win" a page drives toward | Default primary CTA |
|-----|----------------|-----------------|--------------------------------|---------------------|
| **1 — Attractional / Seeker** | The weekend is the front door | "Get them in the room. Remove every barrier." | A great first experience | *Plan a Visit / Watch Online* |
| **2 — Discipleship / Formation** | Maturity, not attendance | "Move people from rows to circles along a clear pathway." | The next step on the pathway | *Take Your Next Step / Join a Group* |
| **3 — Missional / Sending** | The church exists for the city + world | "Equip and send people as leaders into culture." | Joining the mission | *Join the Mission / Serve / Go* |

**How to spot each model in the wild:**
- **Attractional:** Cinematic, brand-forward homepages that lead with the weekend experience and a single "Plan a Visit" / "Watch" action; events and production are front and center.
- **Discipleship/Formation:** Sites built around a named growth pathway (e.g., "Your Journey," Connect → Grow → Reach) and the "rows to circles" move into groups; formation language throughout.
- **Missional/Sending:** Sites that lead with the city, vocation/culture sectors, and the nations — members framed as leaders and missionaries to be equipped and sent.

**Most churches blend.** Use the dominant model for the homepage and overall site voice; you can borrow a different model's structure on a single page where it fits (e.g., a missional church may still run an attractional Plan a Visit page).

**Everything here is an example, not a spec.** The page names, nav labels, and section orders are illustrative starting points that show the *shape* a model tends toward. Always lead with the church's own vocabulary — if they already say "engage the city," "do life together," or "find your people," prefer those words over the generic labels shown here, in both the copy and the navigation.

**Two layers — keep them in their lane.** This guide spans (1) a **nav/sitemap layer** (the Primary Navigation Frameworks section: page list + nav + vocabulary) and (2) a **page layer** (the per-page section outlines below). If a sitemap/sitemap-agent step is producing only a page list and nav, use the nav layer only — the section outlines are downstream (per-page roadmap) work and shouldn't be emitted in a sitemap.

**Notation:** Each line is a section, in order. The arrow (→) states the section's job. *(optional)* = include if relevant. Cross-cutting principles from the journey-stage guide still apply (one primary CTA per page; logistics are content; show real people; name a human; cut insider jargon on front-door pages).

---

# Primary Navigation Frameworks (by model)

Before the page outlines: the model should also shape the **primary nav**, because the menu is the first thing that tells a visitor how the church thinks. Observed across the reference sites, three distinct nav philosophies map onto the three models. **The label trees below are examples, not required wording** — they show the *shape and grouping* a model tends toward. Replace the labels with the church's own language wherever it has it. (`[Button]` = visually distinct CTA, usually contrasting color; indented items = mega-menu / dropdown children.)

### Cross-model nav best practices
- **Cap top-level at ~6 items** plus 1–2 persistent buttons (*Plan a Visit* and *Give* are almost always buttons).
- **Mega-menus with one-line descriptions** per child item read better and help SEO than bare link lists.
- **A utility bar** (Locations, Watch/Online, Search, App, Church Center login) sits above or beside the main nav so it doesn't crowd it.
- **Mobile = accordion** of the same structure; keep the two buttons pinned.
- **Label for the outsider, not the org chart** — avoid internal department names a newcomer wouldn't recognize.
- **Mine the church's own language first.** Before reaching for a generic label, look at their mission statement, taglines, and repeated calls to action. A phrase the church already owns (e.g., a CTA like "Engage the City") is a strong candidate for an actual nav label — it makes the menu feel native to that church and reinforces their vision in the one place every visitor looks. Use the examples below only where the church has no language of its own.
- **Visitor-clarity gate on owned phrases.** Promote a church's phrase to a nav label only if it stays clear to a first-time outsider. When the stated goal is visitor accessibility, a searchable default ("Kids," "Plan a Visit") beats a clever insider phrase — keep the branded phrase on the page, not in the menu. (A visitor Googles "kids ministry," not the branded name.)
- **Respect voice bans.** If the church's voice says "you don't [verb]" (e.g., "not a church you watch"), that verb and its passive synonyms are off-limits as nav labels — including the default "Watch." Use "Messages" or "Sermons" instead.
- **Four pages are non-negotiable:** Homepage, Plan a Visit/Sundays, Sermons/Messages, and Give. Sermons/Messages is mandatory, not optional.
- **Stay lean.** Few strong pages beat many thin ones; absorb low-density topics into a parent page as sections rather than spinning up a page or dropdown. Keep distinct audiences (Kids/Students/Young Adults) as distinct pages — don't collapse them into a generic "Ministries" catch-all.

### Nav organization models (presentation shells)
A separate choice from *which* pages group together: the shell decides *how* the groups are presented. Pick one shell, then pour the same groupings (below) into it — the clusters don't change, only the rendering. Each maps to a `nav_pattern` value.

- **Standard header + standard dropdowns** (`grouped_dropdowns`). Logo, ~5–6 visible top-level items, simple single-column dropdowns of 3–6 links. Each group = one dropdown. Best for small–mid sites (≤ ~12 pages) with straightforward content.
- **Standard header + mega menu** (`megamenu`). Same visible header, but dropdowns open into a wide multi-column panel — each column is one group with a heading and one-line child descriptions, optionally a featured tile/CTA. Each group = one column. Best for 12–25 pages, multi-ministry or multisite churches that have a lot to organize without burying it.
- **Consolidated focused header + off-canvas fly-out** (`offcanvas`). Minimal header (logo + Visit + Give + hamburger), with the full nav living in a slide-in/overlay grouped into labeled sections (plus service times, socials, search, app). Each group = one overlay section. Best for large/complex sites (15+ pages), brand-forward/attractional voice, or mobile-first builds.

Visit and Give stay visible in the header in every shell. Top-level stays ≤ 6 except off-canvas, which intentionally shows fewer. Which shell fits often tracks the model: attractional leans off-canvas or mega menu, discipleship leans standard dropdowns or mega menu, missional leans mega menu.

### Common groupings & pairings
Expected ways church pages cluster. Use as defaults; the church's own labels and the rules above still win. Constraints: a dropdown parent label must differ from its children, needs 3+ children to exist, and must not mix commitment-pathway items with current-state items.

- **Main level (never buried):** Plan a Visit / Sundays, Sermons / Messages, Give. These three sit at the top, with Plan a Visit and Give usually as buttons. Events is main-level or under a Community group.
- **Family / Next Gen dropdown:** Kids · Students/Youth · Young Adults — grouped under one parent (Ministries / Family / Next Gen) but each remains its own page.
- **Get Involved / Next Steps / Grow dropdown:** Groups · Serve · Baptism · Classes · Care. Commitment-pathway items only. Membership usually goes to the footer or an About section, not here.
- **About / Who We Are dropdown:** Our Story · Beliefs · Leadership · Locations · Careers. (If you label it "About," make it a standalone page rather than a dropdown containing an "About" item.)
- **Community / What's Happening dropdown:** Events · Stories · Blog/News — current-state content. Keep Events and Stories here, not under Next Steps.
- **Mission / Outreach dropdown (esp. missional):** Local · Global · Mission Trips · Vocation/Sectors.
- **Footer typically holds:** Contact, Privacy, Careers, Membership, Newsletter, Sermon Blog, Share Your Story, App, Login. Avoid generic "Resources" / "More" dropdowns — if a grouping can't be named with clear intent, don't group it.

Common consolidations when page count runs high: Men's + Women's → "Adults" (sections); Local + Global → "Outreach"; Baptism + Membership rolled into Next Steps.

---

### Set 1 — Attractional / Seeker → "Front-Door Nav"
**Philosophy:** Short, scannable, newcomer-first. Plain department nouns and verbs. The visit + watch actions are unmistakable. Nothing requires insider knowledge.

```
[Plan a Visit]   Messages   Events   Ministries ▾   About ▾   [Give]
(use "Watch" only if the church's voice doesn't ban it)

Ministries ▾ : Kids · Students · Young Adults · Adults · (Español, Special Needs…)
About ▾      : Our Story · What We Believe · Leadership · Locations · Careers
Utility bar  : Locations · Watch Online · Search · App
```
**Why it works:** Lowest cognitive load. A first-time guest finds "when/where/what to expect" and "watch" in one glance; everything else is a tidy dropdown.

**Language & voice:** Warm, plain, invitational, second-person ("you"). Verbs over nouns where possible (*Plan a Visit*, *Watch*). Avoid theological jargon in nav labels. *Leave room for the church's own phrases:* if they greet newcomers with "I'm New" or "Saved You a Seat," that becomes the first nav item rather than a generic "Visit."

---

### Set 2 — Discipleship / Formation → "Pathway Nav"
**Philosophy:** Group the nav by the *disciple's journey or relationship*, not by department. The menu itself teaches the model. Two proven shapes:

```
Pattern A — Relationship grouping
Jesus ▾   You ▾   Us ▾   [Give]
  Jesus ▾ : Sunday Gatherings · Sermons/Messages · Resources
  You ▾   : The Pathway · Groups · Serve · Baptism · Care · Give
  Us ▾    : Who We Are · Beliefs · Leadership · Story · Ministries · Contact

Pattern B — Stage grouping
[Plan a Visit]   Start Here ▾   Grow / Next Steps ▾   Explore ▾   Messages   [Give]
  Start Here ▾        : Plan a Visit · What to Expect · Beliefs · Newcomer Class
  Grow/Next Steps ▾   : The Pathway · Groups · Baptism · Membership/Class · Serve
  Explore ▾           : Kids · Students · Young Adults · Equipping · Care
```
**Why it works:** The pathway is itself a nav item, so the site reinforces "rows → circles" before a visitor reads a word of body copy. Best when the church has a clearly named journey (e.g., Connect → Grow → Reach).

**Language & voice:** Growth-oriented and relational; framed as a journey ("start," "grow," "next step," "belong"). *Leave room for the church's own pathway names:* if they call their stages "Know → Grow → Go" or their groups "Life Groups" / "Together Groups," those exact terms should be the nav labels, not the placeholders shown. The nav should sound like the church already talks.

---

### Set 3 — Missional / Sending → "Mission Nav"
**Philosophy:** Elevate the city + world and being sent to the top level. Serve / Go / Outreach are *not* buried under "Connect" — they're primary. Vocation/sectors and local + global each get a home, and the leadership pipeline is visible.

```
[Visit]   Mission ▾   Get Involved ▾   Ministries ▾   Media   About ▾   [Give]

Mission ▾      : For the City (Local) · For the Nations (Global) · Mission Trips · Vocation/Sectors
Get Involved ▾ : Serve · Groups · Lead/Residencies · Classes · Events
Ministries ▾   : Kids · Students · College · Adults
About ▾        : Vision & Strategy · Beliefs · Leadership · Locations · Initiatives
```
**Why it works:** A visitor sees in three seconds that this church measures itself by who it sends, not just who it seats. Outreach and leadership are top-level, not afterthoughts.

**Language & voice:** Outward, active, commissioning ("sent," "go," "for the city," "for the nations," "live it out"). Mission-forward without guilt. *Leave room for the church's own rallying cry:* a CTA the church already uses — "Engage the City," "Take Jesus Where His Name Isn't Spoken," "Live Sent" — is the ideal top-level nav label here, since the menu becomes a constant restatement of the vision. Use the generic "Mission ▾ / For the City / For the Nations" only as a fallback.

---

# 1. Homepage

### Set 1 — Attractional / Seeker
- **Hero** → Brand + energy + warm promise; primary CTA = *Plan a Visit*. Big, cinematic, confident.
- **Service Times & Location** → Times, address, online, directions — first scroll.
- **New Here? band** → One-line reassurance + *Plan a Visit*.
- **What to Expect teaser** → 3 quick reassurances (parking, kids, come as you are).
- **This Week's Message** → Proof of teaching quality; *Watch* CTA.
- **Get Connected grid** → Kids, Students, Groups, Serve — scannable.
- **Upcoming Events** → The big front-door moments.
- **Stories / social proof** *(optional)*.
- **Footer** → Times, map, social, app, newsletter, quick links.

### Set 2 — Discipleship / Formation
- **Hero** → Invitation to grow / "you weren't made to do this alone"; primary CTA = *Take Your Next Step*.
- **Service Times & Location** → Kept, condensed.
- **The Pathway band** → The named journey, visualized (e.g., Connect → Grow → Reach; rows → circles). The signature element.
- **Get Connected / Next Steps** → Groups, Starting Point/class, Follow Jesus/Baptism, Serve.
- **Ministries by life stage** → Kids/Students/Young Adults/Adults as formation by season.
- **This Week's Message + Series** → Ongoing engagement.
- **Stories of transformation** → Maturity, not just attendance.
- **Footer**.

### Set 3 — Missional / Sending
- **Hero** → Mission/vision for the city + world; primary CTA = *Join the Mission* or *Plan a Visit*.
- **Mission & Vision band** → Why this church exists; who it's trying to reach (sectors, city, nations).
- **Ways to Engage / Be Sent** → Serve the city, vocation/sectors, go (trips), local + global.
- **Service Times & Location**.
- **Get Connected grid** → Groups, Serve, Kids/Students — framed as being equipped to be sent.
- **Stories of impact** → City and world change, real people deployed.
- **This Week's Message**.
- **Footer**.

---

# 2. Kids / Youth / Young Adult Ministries

*Template family with age variants (Kids, Jr High / Students, High School, Young Adults). Safety/check-in and explicit age ranges are non-negotiable on every model.*

### Set 1 — Attractional / Seeker
- **Header** → Ministry name + age range + high-energy, fun one-liner ("they'll beg to come back").
- **What to Expect** → The experience: games, worship, energy, Bible stories that stick.
- **Safety & Check-In** *(Kids)* → Security, ratios, allergy/medical handling.
- **Meeting Times & Location**.
- **Plan a Visit / Pre-Register CTA**.
- **Events & Camps** → Big attractional moments (VBS, camp, retreats).
- **Parent / Student FAQ**.
- **Ministry Leader Contact**.

### Set 2 — Discipleship / Formation
- **Header** → Age range + formation framing ("not the future church — the church today").
- **Discipleship Vision by age** → What we're forming and the spiritual goal.
- **What We Teach / The Rhythm** → Weekly + small groups + milestones (dedication, baptism, promotion).
- **Safety & Check-In** *(Kids)*.
- **Get Involved CTA** → Register / join a group.
- **Family Equipping / At-Home** → Tools to disciple kids beyond Sunday.
- **Ministry Leader Contact**.

### Set 3 — Missional / Sending
- **Header** → Age range + "raising the next generation of leaders / on mission."
- **Vision** → Kids/students discovering identity, purpose, and how to live sent.
- **What They Experience** → Worship, teaching, and serving together.
- **Serve & Lead** → Students serving on teams; families serving together.
- **Mission Trips / Local Outreach** → Age-appropriate ways to go.
- **Meeting Times & Safety/Check-In** *(Kids)*.
- **Ministry Leader Contact**.

---

# 3. Adult Ministries

*Covers Men's, Women's, Marriage, MomCo, Young Adults, Seniors, Recovery, Special Needs, Español. Best practice: a single page can hold several sub-ministries, each with heart + meeting time + two buttons (Get Connected / See Events). Keep sub-ministries parallel.*

### Set 1 — Attractional / Seeker
- **Header** → Who it's for + welcoming one-liner.
- **Per sub-ministry** → Heart + the experience + meeting time + *Get Connected* / *See Events* buttons.
- **What to Expect (first time)** → No-pressure reassurance.
- **Events** → Retreats, socials, big gatherings.
- **Ministry Leader Contact**.

### Set 2 — Discipleship / Formation
- **Header** → "Your growth doesn't stop here."
- **Why It Matters** → Move beyond casual attendance to maturity.
- **Per sub-ministry** → Heart + studies/tracks + meeting time + *Get Connected* / *See Events*.
- **Groups / Studies within the ministry** → The formation engine.
- **Ministry Leader Contact**.

### Set 3 — Missional / Sending
- **Header** → Ministry framed as equipping to serve and lead.
- **Per sub-ministry** → Heart + how it equips members to live sent + meeting time + buttons.
- **Serve Together** → Outreach and serve opportunities tied to the ministry.
- **Ministry Leader Contact**.

---

# 4. Outreach Ministries

*Best practice (e.g., an "Engage Local / Go Global" split, or a "Reach" / "Missions & Mercy" framing): cleanly separate local from global, name real partners, and give concrete serve / go / give actions. This page is secondary for attractional churches and the centerpiece for missional ones.*

### Set 1 — Attractional / Seeker
- **Header** → "Here to give" + warm invitation.
- **Why We Serve** → Plain, short heart statement.
- **Local & Global at a glance** → Two simple paths.
- **Featured Outreach Events** → Easy, low-commitment on-ramps.
- **Get Involved CTA** → One easy step.
- **Ministry Leader Contact**.

### Set 2 — Discipleship / Formation
- **Header** → "Faith that overflows" — outreach as part of maturing.
- **Your Daily Mission Field** → Mission in ordinary life (work, neighborhood).
- **Engage Local** → Partners, recurring serve days.
- **Go Global** → Trips, supported missionaries.
- **Serve / Go as a next step** → Tied to the discipleship pathway.
- **Stories**.
- **Ministry Leader Contact**.

### Set 3 — Missional / Sending *(centerpiece — most detail here)*
- **Header** → Vision: "Live it out / live sent."
- **The Vision** → Why the church exists for the city + world.
- **Your Daily Mission Field** → Vocation and neighborhood as the front line.
- **Local Opportunities (partner cards)** → Each: name, need, action verb CTA.
- **Global Partners (cards)** → Each: region, work, action CTA.
- **Mission Trips** → Calendar, applications, training.
- **How to Be Involved** → Give to missions · Pray · Go.
- **Ministry Leader Contact + Team**.

---

# 5. Events

### Set 1 — Attractional / Seeker
- **Header** → "Here's what's happening — you're invited."
- **Featured / Next Event** → The single best front-door event + CTA.
- **Upcoming grid** → Cards: image, date, title, 1-line, *More Details*.
- **What to Expect at an Event** *(optional)*.
- **Register / View All CTA**.

### Set 2 — Discipleship / Formation
- **Header** → "Find your next thing."
- **Featured Events** → Connection/growth-oriented.
- **Filterable grid** → By audience and **by pathway step**.
- **Recurring Rhythms** → Weekly/monthly gatherings to plug into.
- **Register / Add to Calendar CTA**.

### Set 3 — Missional / Sending
- **Header** → Serve days, city-wide moments, sending events.
- **Featured Outreach / Serve Events**.
- **Calendar / Filterable grid** → Including local + global.
- **Recurring Serve Rhythms** → City nights, prayer, projects.
- **Volunteer / Register CTA**.

---

# 6. Plan a Visit

*Highest-intent newcomer page on any site — every model optimizes it hard. The differences are mostly in framing and the post-visit hand-off.*

### Set 1 — Attractional / Seeker *(this page is their home turf)*
- **Header** → "What to expect when you visit" + reassuring promise.
- **Service Times & Location** → Times, address, map, parking.
- **What to Expect** → Walkthrough: arrival, length, music, dress.
- **Your Kids** → Check-in, safety, where to go.
- **Plan Your Visit form CTA** → "Let us know you're coming" (pre-register kids, ask questions).
- **FAQ**.
- **What's Next After Your Visit** → A defined follow-up.
- **Contact** → A real person.

### Set 2 — Discipleship / Formation
- **Header** → "Glad you're coming — here's your first step."
- **Service Times & Location**.
- **What to Expect** + **Your Kids**.
- **Plan Your Visit form CTA**.
- **After Your Visit → Starting Point / the Pathway** *(emphasized)* → The class that moves you from attending to belonging (free lunch, meet pastors, hear the vision, stories).
- **Contact**.

### Set 3 — Missional / Sending
- **Header** → "Come see the mission you can be part of."
- **Service Times & Location**.
- **What to Expect** + **Your Kids**.
- **Plan Your Visit form CTA**.
- **Why We Exist** → The mission/vision the visitor would be joining.
- **Contact**.

---

# 7. Next Step Pages (Groups, Baptism, Classes, Volunteering)

*Shared template below; per-step notes follow. This page family is light for attractional, the spine of the site for discipleship, and reframed as deployment for missional.*

### Set 1 — Attractional / Seeker
- **Header** → The step named plainly + why it matters.
- **What It Is / What to Expect** → Demystify; remove intimidation.
- **One Clear CTA** → Sign up / register / express interest.
- **FAQ** *(optional)*.
- **Leader Contact**.

### Set 2 — Discipleship / Formation *(the spine — lead with the pathway)*
- **Header** → Step framed as growth/belonging.
- **Where This Fits in the Pathway** → Visual ("step 2 of 4," Connect→Grow→Reach).
- **What It Is + The Win** → The maturity on the other side.
- **How to Start** → Concrete steps, schedule, format.
- **Primary CTA** → Join / register (often a Church Center form).
- **Stories** *(optional)*.
- **Leader Contact**.

### Set 3 — Missional / Sending
- **Header** → Step framed as being equipped and sent.
- **How This Prepares You to Serve / Lead / Go**.
- **Lead / Host This** → Facilitate a group, lead a team, mentor.
- **Training & Resources**.
- **Primary CTA** → Apply to serve / lead / go.
- **Leader Contact**.

### Per-step content notes (apply within the template above)
- **Groups** → "Move from rows to circles." Include a **find-a-group grid** (name, meeting time, area, "Request to Join"), the rhythm (meal, study, prayer), a **"Didn't find a group? Let's talk"** fallback, and a CTA. Discipleship set makes this the hero; missional set adds host/start-a-group + leader coaching.
- **Baptism** → Lead with meaning, then *what to expect on the day*, then sign-up form, plus testimony video and a "questions?" contact.
- **Classes (Membership / Starting Point / Discover)** → Purpose ("from attending to belonging — meet the team, find your place"), low-pressure format (free lunch, childcare, meet the pastors, hear the vision, stories), what you leave with, dates + register CTA, and an **"After the class → next steps"** hand-off.
- **Volunteering / Serve** → Lead with "you have a part to play / I get to." List serve-team areas, walk the **3-step on-ramp: (1) Raise your hand, (2) Test drive a role for a Sunday, (3) Join the team.** Add **"Serve as a family,"** real stories, one CTA. Missional set elevates this page and adds the leadership pipeline.

---

# 8. Giving

*Best practice (framings like "Fuel the Mission" or "giving is worship," paired with an annual report): frame the why, make the act effortless across methods, and build trust with transparency + a returning-giver login.*

### Set 1 — Attractional / Seeker
- **Header** → "Giving is worship" — warm, no-pressure (reassure guests they're not expected to give).
- **Why We Give** → Short, plain theology of generosity.
- **Ways to Give** → Online, text, app, in-person, mail.
- **Give Now CTA**.
- **FAQ** *(brief, optional)*.

### Set 2 — Discipleship / Formation
- **Header** → Generosity as a mark of a maturing disciple.
- **The Heart Behind Generosity** → Scripture + "response to grace."
- **Ways to Give** → All methods + **Returning Givers / Manage Giving login**.
- **Recurring Giving** → Set up / manage.
- **Where It Goes** → What giving funds.
- **Contact** → Stewardship questions.

### Set 3 — Missional / Sending
- **Header** → "Fuel the Mission" — give = investing in life change beyond yourself.
- **The Vision You're Funding** → City + nations the gifts reach.
- **Ways to Give** → All methods + returning-giver login.
- **See Your Impact (stats)** → Outcomes, not dollars (baptisms, people in groups, families served) tied to "because you give…".
- **Designated & Missions Giving** → Missions, building, benevolence.
- **Financial Transparency** → Budget overview, annual report.
- **Contact**.

---

# 9. About

### Set 1 — Attractional / Seeker
- **Header** → "Who we are" in one warm, jargon-free sentence.
- **Mission / Vision (plain)** → Why this church exists.
- **What to Expect / How We Gather** → Bridge to visiting.
- **Our Story (short)**.
- **Meet the Leadership** → Lead pastor(s), photo + short bio.
- **Locations** *(if multisite)*.
- **Plan a Visit CTA**.

### Set 2 — Discipleship / Formation
- **Header** → Identity + invitation to grow.
- **Mission, Vision & Values** → Fuller framing of the DNA.
- **Our Story** → Heritage and trajectory.
- **What We Believe (summary + link)**.
- **Leadership & Staff**.
- **The Pathway / Next Steps CTA** → How you grow here.

### Set 3 — Missional / Sending
- **Header** → The mission and the movement they're part of.
- **Vision & Strategy** → The detailed "where we're going" (sectors, city, nations).
- **Core Values / Distinctives** → The DNA, fully explained.
- **Statement of Faith / Beliefs**.
- **Leadership, Elders & Governance**.
- **Locations / Network** *(if multisite)*.
- **Serve / Go / Join the Mission CTA**.

---

## Quick-reference matrix

| Page | Attractional leads with… | Discipleship leads with… | Missional leads with… |
|------|--------------------------|---------------------------|------------------------|
| Homepage | Experience + Plan a Visit + Times | The named Pathway | Mission/Vision for the city |
| Kids/Youth/YA | The fun + Safety | Formation vision by age | Next-gen as leaders / serving |
| Adult Ministries | Heart + events | Studies + groups | Equipped to serve & lead |
| Outreach | Easy on-ramps | Faith that overflows | Local + global partners *(centerpiece)* |
| Events | Featured front-door event | Filter by pathway step | Serve days / city nights |
| Plan a Visit | What to expect *(home turf)* | After-visit → Starting Point | The mission you're joining |
| Next Steps | Simple cards + one CTA | The Pathway *(the spine)* | Equipped & sent / lead |
| Giving | "No pressure" + why | Heart + manage giving | Fuel the mission + impact |
| About | Plain who-we-are | Values + story + pathway | Vision/strategy + sectors |

**How to choose for a partner church:** Read their existing mission statement and homepage. If it leads with the weekend experience → Attractional. If it leads with a named growth pathway or "groups/discipleship" → Discipleship. If it leads with the city, vocation, or "sent/mission" → Missional. Use that as the site's spine, and only deviate per-page when a specific page clearly serves a different job.
