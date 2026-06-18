# Content fidelity audit — First Presbyterian Church of Charlotte (3249)

**Audit date:** 2026-06-18
**Project ID:** `435ccbf9-f755-4460-ac1f-aa6a604d0482`
**Notion DB:** [3249 - First Presbyterian Church of Charlotte Web Copy](https://app.notion.com/p/church-media-squad/335e83f731f681db8adff1855457b4f9)
**Branch:** audit (Notion → Brixies via `audit-external-copy` SKILL → handoff-to-pages)
**Pages audited:** 18 (Home, About, Adults, Advocacy, Bulletin Links, Care, Children-Youth, Employment, Events, Give, Local-Global, New, Pastoral Transition, Serve, Staff, The History Hallway, Watch, Worship) — plus a `_meta` orphan page from the handoff (no body content).
**Method:** 6 parallel audit subagents, each comparing 2–6 pages Notion-to-DB. Quoted source-blocks verbatim; cross-checked `cowork_slot_values` + `cowork_section_meta` + `seo_metadata` + `partner_gaps_flagged` + `global_footer`.

---

## TL;DR

**Verbatim prose fidelity is excellent** — every body, item, CTA label, URL, and contact email from Notion lands in the DB character-for-character. `actual_verbatim_ratio: 1` on 95% of sections. SEO + GAPS FLAGGED + global_footer wire through cleanly to the new v77 columns on every page.

**Where the pipeline drops the partner is in structural decisions** — how Notion's `## SECTION` + nested `### CARD` headers map to Brixies templates. The dominant bug is **inconsistent nested-`###`-list handling**: same Notion structure (`## PARENT` with N nested `### CHILDREN`) produces different outputs across — and within — the same project. Sometimes promoted to one cards-grid (correct); sometimes exploded into N separate full-width sections (fragmented). Local & Global and Advocacy are the worst offenders.

**Quantified blockers:** 4 🔴 BLOCKER findings (fragmented cards on Serve + Local-Global + Advocacy; required-slot missing on Give Member Testimony; dropped multi-button items on Home Service Times; empty URLs on placeholder buttons across multiple pages; broken video embeds on Watch).

**Quantified warnings:** ~20 🟡 WARN — template-cap overflows, `cta-section-20` tagline-slot mismatch, schema drift in `partner_gaps_flagged` field name (some pages use `text`, others use `note`), inline-annotation misclassifications.

**Two cross-cutting hygiene issues to note:**
1. `_meta` orphan page in `web_pages` (no body, no sections) — handoff side-effect, harmless but should be filtered out.
2. `partner_gaps_flagged` array element shape varies — `{text, kind}` on some pages, `{note, kind}` on others. Need one shape across the project.

---

## Discrepancies — full table by page

Severity scale:
- 🔴 **BLOCKER** — content loss, missing required slot, fabricated/empty URL on a real button, structural fragmentation.
- 🟡 **WARN** — structural drift, template mismatch surfaced but content preserved, classification quibble.
- 🟢 **NIT** — minor whitespace / charset / annotation routing; content is intact.

### Page: Home (`/`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| SERVICE TIMES + LOCATION AND PARKING (sort_order 2) | 🟡 WARN | `content_crosswiring` (intentional) | Two `## ` headings merged into one rendered section. `inline_annotations` self-documents the merge. | Single `content-section-89` with Service Times in items, Location prose in body. Location's H2 demoted to inline bold. | Strategist directive in section_meta. Structural drift but content preserved. |
| SERVICE TIMES — Watch Livestream button | 🔴 BLOCKER | `dropped_cta` | 2 buttons per service (View Bulletin + Watch the Livestream). | Each `items[i]` has 1 CTA only; 2nd button collapsed to freeform `item_meta` string. **No structured URL — won't render as button.** | Template `content-section-89.items[]` supports 1 CTA per item; second buttons lost to text annotation. |
| LOCATION — map embed | 🟢 NIT | preserved | iframe markup in `*[Map embed: …]*`. | Verbatim in `cowork_section_meta.embed_directive`. | Working as designed. |
| PODCAST — Listen button | 🔴 BLOCKER | `button_missing_url` | `*Button: Listen to Say Grace (podcast link placeholder)*` | `url: ""`. Self-flagged in `gaps[]`. | Placeholder URLs ship as empty; will 404 on click. |
| GLOBAL FOOTER | 🟡 WARN | (correct — no per-page render) | Full `## GLOBAL FOOTER` block. | NO web_section render; lives in `strategy_web_projects.global_footer` (2.5 KB). | Architecturally correct. Verify build consumes the global artifact. |
| Hero apostrophe | 🟢 NIT | charset (source bug) | `Sundays, 9 a.m & 11 a.m.` (typo — missing period after second `m`). | Stored verbatim. | Faithful to source typo. |

### Page: About (`about`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| OUR TEAM — developer note | 🟡 WARN | `directive_misclassified` | `*[Note for developer: This transition blog page must carry over to the new site — Cierra confirmed members reference it frequently…]*` | Stored in `dynamic_directive`. | Should be `inline_annotations` or a dedicated `developer_notes` field — this is a migration note, not dynamic-content. |
| WHAT WE BELIEVE | 🟡 WARN | `items_overflow` | 6 bulleted beliefs. | Rendered, `gaps` self-flags: cap 3 vs 6 items. | Template cap mismatch — `content-section-89` is wrong template for 6 beliefs. |
| COVENANT NETWORK + THE MISSION items | 🟡 WARN | `item_body_decapitated` | `**Engaging** the church to invite all of God's children…` (bold lead word + grammatical continuation). | Split into `item_heading: "Engaging"` / `item_body: "the church to invite…"` (lowercase fragment). Same for `**Worship and Formation** is about…`. | Bold-lead-word pattern split into heading + body; item_body becomes grammatically broken unless renderer concatenates `<strong>Engaging</strong> the church…`. |
| HISTORY HALLWAY button | 🔴 BLOCKER | `button_missing_url` | `*Button: The History Hallway (link to history-hallway OR fpc-clergy)*` | `url: ""`. | Ambiguous source; translator punted but shipped an unclickable button. Should defer. |
| THE ORIGIN vs WHAT WE BELIEVE link routing | 🟢 NIT | inconsistency | Same italic-link pattern (`*Link: PC(USA) -> *[url](url)`) on both. | ORIGIN: stuffed in `body`. BELIEVE: dedicated `body_footer` slot. | Inconsistent slot routing for the same pattern. |
| GAPS FLAGGED markdown | 🟢 NIT | inconsistency | About preserves bold markup; Home strips it. | Different `partner_gaps_flagged[i].text` shapes across pages. | Inconsistent capture rules. |

### Page: Adults (`adults`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Hero CTA | 🟡 WARN | `button_missing_url` | `**CTA:** See All Offerings Below` | `url: ""`. | Scroll-prompt label, not a real CTA; should produce anchor href like `#offerings`. |
| Sunday Morning Classes (s3) | 🟢 | clean | 2 `### ` nested classes. | `feature-section-103` with 2 items, meta/body/CTA + Zoom URLs verbatim. | Correctly promoted. |
| Weekday Studies (s4) | 🟢 | clean (cap-override) | 5 `### ` nested studies. | `feature-section-2` with 5 items in one section (cap-3 ignored per BATCH1). | Correct application. |
| Young Adults (s5) | 🟢 | clean | 4 `### ` programs. | `feature-section-2` with 4 items + intro body. | Correct. |
| Presbyterian Women (s6) | 🟢 | clean | Intro + 4 buttons + Beth Guinan contact. | Body verbatim, 4 buttons preserved, contact card structured. | Correct. |
| The Willard Lecture (s7) | 🟡 WARN | source_stale (partner-flagged) | "*The 2026 Willard Lecture date (March 1, 2026) has passed. Update when 2027 details available…*" | Verbatim + preserved as inline_annotation. | Partner gap; not a translator bug. |
| Section template cadence | 🟢 NIT | (false alarm) | "5 content-section-16 in a row" suspected. | Actually 4 content-section-16 separated by feature/cta templates; cards live as items, not as collapsed prose. **No `collapsed_cards`/`fragmented_cards` here.** | Adults page is structurally clean. |

### Page: Advocacy (`advocacy`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Areas of Focus + 6 sub-ministry cards (s3-s9) | 🔴 **BLOCKER** | **`fragmented_cards`** | `## THE SIX SUB-MINISTRIES` / `**H2:** Areas of Focus` + 6 H3 cards. **Notion editorial note explicitly says:** *"Each sub-ministry below should be formatted as a card or accordion"*. | 1 header `content-section-16` + 6 sibling `content-section-16` cards. `inline_annotations` admits: *"each promoted to their own card section per strategist decision"*. | **Direct violation of explicit Notion developer directive.** Partner said "card or accordion" — renderer produced 6 full-width prose sections. The directive lives in `dynamic_directive` but nothing acts on it. |
| Areas of Focus intro (s3) | 🟡 WARN | `fabricated_section_intro` | Notion has only the H2 + developer note — no body prose. | `body: "First Presbyterian's Advocacy Ministry works through six sub-ministries, each focused on a specific area…"` (verbatim_ratio 0.4 confirms fabrication). | Translator invented connective scaffolding. Low-stakes but a real fabrication. |
| Racial Justice link inline (s4) | 🟡 WARN | `editorial_leakage` | `*[Link: View the History Hallway online → https://firstpres-charlotte.org/fpc-clergy/ — confirm URL carries to new site]*` | Inlined into body verbatim, including `"— confirm URL carries to new site"` developer note. | Editorial directives rendering as body text. Visitor will see "confirm URL carries to new site" on the live site. |
| What-You-Can-Do-Now callouts × 5 cards (s4-s8) | 🟡 WARN | `editorial_leakage` | `*[Editable callout — Advocacy team updates this with current action items…]*` (verbatim across 5 of 6 cards). | Rendered verbatim into body prose. **Site visitors will literally see `*[Editable callout — …]*`** as visible text. | Editorial placeholder syntax (`*[ … ]*`) inlined as content. Should be an `editable_block` slot or stripped pre-publish. |
| Plowshares (s8) | 🟡 WARN | `editorial_leakage` | `*[Current and past books — link to or display the Plowshares library here]*` | Inlined verbatim in body. | Same pattern. |
| QR-code URL missing (in GAPS) | 🟡 WARN | `missing_url_from_gaps` | `## GAPS FLAGGED` calls out `https://firstpres-charlotte.org/triptych/` as **critical for QR codes on physical signage**. | URL appears in zero rendered sections. | Section split logic captured only the URL in each section's own block, not URLs referenced in GAPS. **Partner-flagged QR dependency at risk.** |

### Page: Bulletin Links (`bulletin-links`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Link List (s2) | 🟢 NIT | **bulletin URLs byte-exact PASS** | `https://firstpres-charlotte.org/bulletin` and `https://firstpres-charlotte.org/cb` (QR-coded URLs). | Both URLs in `item_cta_url` byte-exact, no trailing slash, "do not change" note preserved in `item_meta`. | **Critical QR fidelity test passes.** |
| Link List | 🟡 WARN | `items_overflow` | 9 link items. | All 9 emitted, cap-6 self-flagged. | Cap-override rule firing correctly. |
| Link List | 🟢 NIT | `item_cta_label_invented` | Notion items have no CTA label — just `**Title** → URL`. | All items got `item_cta_label: "Open"` (synthesized). | Template-required label; reasonable default. |
| `noindex` recommendation | 🟢 NIT | preserved | "recommend **noindex**". | `seo_metadata.noindex_recommended: true`. | Clean. |

### Page: Care (`care`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Pastoral Care (s3) | 🟡 WARN | `items_overflow` | 3 Care Pastors. | `team-section-14` (cap 2); 3 emitted with override. | Wrong template choice; switch to `feature-section-2` for >2. |
| Counseling Center embed | 🟡 WARN | `embed_directive deferred` (correct) | `*[Embed: Presby Psych intro video — placeholder until video is confirmed…]*` | Preserved verbatim; no actual embed rendered. | Correct deferral — matches `partner_gaps_flagged`. |
| Counseling Center anchor | 🟢 NIT | preserved | `*[Anchor link target for Global Footer: #counseling-center]*` | `anchor: "counseling-center"` slot set. | Clean. |
| Additional Care Ministries (s6) | 🟡 WARN | `items_overflow` | 8 nested `### ` ministries. | `feature-section-2` (cap 6); 8 emitted. `voice_notes` claims "nine" but Notion has 8. | Wrong template cap + minor voice_notes counting error. |
| Caregiver multi-contact | 🟢 NIT | `sub-field mashup` | Two contacts (Sarah Shifflet + Joan Wright) on one card. | `item_meta` carries both as one string; no `item_contact_email` (two contacts can't fit one field). | Acceptable workaround. |

### Page: Children & Youth (`children-youth`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| All ministry blocks | 🟢 | clean | Distinct kids ministries (Nursery, Sunday School, First Church) + Choir + Youth Programs + Youth Music. | Each promoted to its own cards section with items[] structure. Ages, rooms, times, security-check details all preserved. | Promotion rule works correctly when each `### ` is genuinely sub-page-sized content. |
| Preschools (s9) | 🟡 WARN | `uniform_slot_not_supported_by_template` | `*[Button: Visit the Preschools Website → https://fpcschools.org/]*` | `feature-section-103` doesn't have a button slot — button emitted to ignored slot. | Template mismatch — Preschools CTA won't render. |

### Page: Employment (`employment`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Current Openings (s3) | 🟢 NIT | preserved | `### Afternoon/Evening Custodian` with PDF URL `https://firstpres-charlotte.org/wp-content/uploads/2026/01/Afternoon_Evening-Custodian-2026.pdf` | PDF URL byte-exact in `item_cta_url`. | Clean — PDF link integrity is critical for HR. |
| Current Openings | 🟢 NIT | minor duplication | `**Department:** Operations` appears once in Notion. | Stored in `item_meta` AND body. | Department duplicated; harmless. |
| Final CTA (s6) | 🟡 WARN | `mailto_button_label_is_email` | `**Contact:** [hr@firstpres-charlotte.org](mailto:…)` | Button rendered with label = email address. | Synthesized button promoted from contact line; review for visual clarity. |

### Page: Events (`events`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Upcoming Events (s3) | 🟡 WARN | `items_overflow` | 9 featured events. | All 9 emitted; cap-6 self-flagged. | Cap-override rule firing correctly. |
| Upcoming Events | 🟡 WARN | dynamic embed deferred | `*[Events calendar embed or manually managed event cards — to be determined by developer]*` | `dynamic_directive` verbatim; no `embed_url`. | Correct deferral — dev decision pending. |
| Stay Connected (s5) | 🟡 WARN | `cta-section-20` tagline (no actual loss) | No tagline in Notion. | No tagline rendered. | Same template pattern as Worship; no loss here since Notion didn't supply one. |

### Page: Give (`give`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| **MEMBER TESTIMONY (s3)** | 🔴 **BLOCKER** | `required_slot_missing` | `## MEMBER TESTIMONY` — no `**H2:**` line in Notion, just the testimony quote. | `feature-section-19` rendered with empty `primary_heading`; gap flagged BLOCKER. | Template requires `heading`; translator failed to synthesize from section title or pick a no-heading template. |
| Ways to Give cards (s4) | 🟢 NIT | (per-card field shape varies) | `### Stocks and Securities` etc. | Stocks/Auto-Draft cards have `item_contact_email`; Give Online has CTA only; Text/In Person/Venmo have neither. | Per-card shape preserved as-emitted in Notion. |

### Page: Local & Global (`local-global`) — 17 sections

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| **Local Outreach (s4-s10)** | 🔴 **BLOCKER** | **`fragmented_cards`** | `## LOCAL OUTREACH` parent + 6 nested `### ` cards (Room in the Inn, Nourish Up, Second Saturday, Operation Sandwich, Westerly Hills, Habitat). **Notion `Categories: Style Guide = ["Video Gallery","Cards Grid","Short Text Content","Map"]`** — partner explicitly tagged this as a Cards Grid. | 6 separate full-width `cta-section-52` / `cta-section-20` / `content-section-16` siblings + 1 standalone heading-only `content-section-16` ("Serving Charlotte"). | **Partner's `Categories: Style Guide = "Cards Grid"` is ignored.** Translator promotes every `###` to a sibling section. |
| **Global Outreach (s11-s15)** | 🔴 **BLOCKER** | **`fragmented_cards`** | `## GLOBAL OUTREACH` + 4 nested `### ` partnerships (Cuba/Mexico/Haiti/WNC), all same shape. | 4 separate siblings, template choice driven by button count (Cuba/WNC → `content-section-16`, Mexico/Haiti → `cta-section-52`/`cta-section-20`). | Same fragmentation + template selection is button-count-driven, not card-shape-driven. **Visually inconsistent** — same card shape, three different templates. |
| Outreach Leadership (s3) | 🟡 WARN | `items_overflow` | 3 people (Lucy Crain, Flo Bryan, Heidi Squires). | `team-section-14` cap 2; 3 emitted. | Template choice wrong. |
| Outreach Philosophy (s2) | 🟡 WARN | `template_mismatch` | Dense prose ending with a single button. | `cta-section-52` (CTA template) used for a 3-paragraph reflective philosophy. | Should be `content-section-16` — CTA template will shout visually. |

### Page: I'm New (`new`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Hear Us Before You Visit | 🟡 WARN | `button_missing_url` | `*Button: Listen to Say Grace (podcast link placeholder)*` | `url: ""`. | Same placeholder pattern; correctly flagged. |
| Parking | 🟢 NIT | preserved + minor paraphrase in note | `*(Campus map image placeholder: https://…/230906-Map-for-Web.pdf)`. | Verbatim in body + `image_direction`; the *inline_annotations[0].note* re-paraphrases. | Verbatim still in body so reader sees it. |
| Parking — "Parking Map" line | 🟢 NIT | `button_promoted` | Bare text with URL (not prefixed `*Button:`). | Translator promoted to a secondary button with correct URL. | Reasonable inference. |
| All other sections | 🟢 | clean | All headings, items, contact-block, embed_directive, Hero image_direction. | Verbatim. | Page is structurally clean. |

### Page: Pastoral Transition (`pastoral-transition`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Transition Updates (s3) | 🟡 WARN | **`paraphrase_in_body`** | `*[Content migration: all existing posts from firstpres-charlotte.org/updates-from-the-transition-team/ move here intact, newest first — lift and shift…]*` | `body: "New updates appear at the top. (Existing posts migrate here intact from the current Transition Team updates page, newest first.)"` — **rewritten, not verbatim**; `actual_verbatim_ratio: 0.5`. Full directive preserved in `dynamic_directive`. | **Only verbatim breach across all 18 pages.** Translator paraphrased a partner directive into body. |
| Stay Informed (s4) | 🟢 NIT | inconsistency | Newsletter URL + `communications@firstpres-charlotte.org`. | Newsletter button verbatim; email captured in body but NO mailto button (unlike Employment's HR pattern). | Inconsistent contact rendering across pages. |

### Page: Serve (`serve`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| **Local Outreach (s5-s10)** | 🔴 **BLOCKER** | **`fragmented_cards`** | `## SERVE YOUR CITY` parent + 5 nested `### ` cards (Room in the Inn, Second Saturday, Operation Sandwich, Westerly Hills, Habitat). | sort_order 5 = empty `cta-section-52` intro; sort_orders 6-9 = each ministry as its own `cta-section-52` section. | Same fragmentation bug as Local-Global. Sibling sections instead of one cards-grid. |
| Worship Support cards (s3) | 🟢 NIT | clean (correct shape) | 5 nested `### ` Sunday-morning roles. | One `feature-section-2` with 5 items. | **This is what should have happened to Local Outreach too.** Inconsistency confirmed within the same page. |
| Hero CTA (s1) | 🟡 WARN | `button_missing_url` | `**CTA:** Find Your Serving Role Below` | `url: ""`. | Scroll prompt — should be anchor href. |
| Editorial note | 🟡 WARN | `annotation_dropped` | `**Editorial note:** Per Andrew (Content Strategy Notes, Comment 23), this page is the sign-up hub…` | NO `inline_annotations` carry this note. Give and Care both preserved their editorial notes. | Translator skipped block-quote / editorial note capture for this page only. Per-page miss. |

### Page: Staff (`staff`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Pastoral Staff (s2) | 🟡 WARN | `items_overflow` | 6 named pastors. | All 6 in `team-section-14` (cap 2); override. | Cap mismatch; renderer must honor override. |
| Program and Support Staff (s3) | 🟡 WARN | `items_overflow` | 39 named staff alphabetically. | All 39 in `team-section-14` (cap 2); missing bios kept as placeholders verbatim. | **All 39 present** — Andrea Nelson → Will Young, no omissions. Template choice is wrong — needs a higher-cap directory grid. |
| Elders and Deacons (s4) | 🟢 NIT | preserved (audit corrected: source has 15+47, not 31+47) | 3 classes × Elders (15 total) + 3 classes × Deacons (47 total). | All 6 class rosters verbatim. | Clean. |
| Pop-out modal directive | 🟢 NIT | preserved | `*[DEVELOPER NOTE: Each staff card should open as a pop-out card (modal/overlay)…]*` | Preserved in hero `inline_annotation` + both team sections' `image_direction`. | Directive multi-anchored — good fidelity. |

### Page: The History Hallway (`the-history-hallway`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| FPC Senior Pastors (s3) | 🟡 WARN | `migration_placeholder` (expected) | `*[Content migration: the full set of clergy portraits and biographies currently at firstpres-charlotte.org/fpc-clergy/ moves here intact — lift and shift…]*` | Directive in body + `dynamic_directive`; preservation flag set; **no actual bio content**. | Expected (lift-and-shift pending); flagged in GAPS. |
| The Triptych (s4) | 🟡 WARN | `migration_placeholder` (expected) | `*[Content migration: the triptych statement and imagery currently at firstpres-charlotte.org/triptych/ moves here intact…]*` | Same — placeholder, no content. | Expected. |
| **SLUG DECISION** | 🔴 **BLOCKER** | `slug_drift` | `## GAPS FLAGGED`: **SLUG DECISION (blocking):** `/history-hallway vs /fpc-clergy`. | Live rendered slug is `the-history-hallway` (with article). | **Slug matches neither option.** 301 redirect plan needs revision before launch. |

### Page: Watch (`watch`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Hero embed | 🟡 WARN | `embed_directive_only` | `*[Embed recent sermon]*` | `embed_directive` text only — no structured `embed_url` slot on `hero-section-42`. | Template doesn't expose embed slot; directive preserved as text. |
| Watch Live (s2) | 🔴 BLOCKER | `broken_dynamic_embed` | `*[Embedded livestream player — placeholder until developer embeds the current live stream]*` | `video.url: ""`, kind `livestream`. | Pending partner input (BoxCast URL). Launch-blocker review needed. |
| Watch Live bulletin URLs | 🟢 NIT | **byte-exact PASS** | `https://firstpres-charlotte.org/cb` and `https://firstpres-charlotte.org/bulletin`. | Verbatim in body, no trailing slash. | **QR-code URLs preserved.** |
| Say Grace (s3) Apple+Spotify | 🔴 BLOCKER | `button_missing_url` ×2 | Two subscribe-button placeholders. | Both `url: ""`; gaps self-flagged. | Pending podcast rebrand. |
| Say Grace episode embed | 🔴 BLOCKER | `broken_dynamic_embed` | `*[Featured episode player — embed most recent episode here]*` | `video.url: ""`, kind `podcast_episode`. | Pending partner input. |
| Sermon Archive (s4) | 🟢 NIT | clean | `*[YouTube playlist embed … https://www.youtube.com/@firstprescharlotte]*` + button. | `video.url` and button URL both = channel URL. | Clean extraction. |

### Page: Worship (`worship`)

| Section | Severity | Kind | Notion source | Rendered output | Root cause |
|---|---|---|---|---|---|
| Contemplative + Traditional Service (s2, s4) | 🟡 WARN ×2 | `uniform_slot_not_supported` | `Sundays, 9 a.m. \| Chapel \| September through May` (and 11 a.m. line). | Emitted as `tagline` but `cta-section-20` has NO tagline slot. Content preserved in JSON, won't render. | **Systemic template gap.** Fix the schema or fold tagline into body for cta-section-20. |
| Bulletin button | 🟡 WARN | `button_missing_url` | `*Button: View Current Bulletin (easy upload link…)*` | Empty `url`; gap logged. | Partner-flagged placeholder. |
| Music Ministry — 4 H3 promotions | 🟢 | documented | `## MUSIC MINISTRY` parent + 4 `### ` sub-sections. | Each promoted to own section. | Documented strategist decision — preserved cleanly. (Different from Local-Global because these are genuinely sub-page-sized content blocks.) |
| Music Ministry Leadership (s12) | 🟡 WARN | `items_overflow` | 5 leaders. | All 5 in `team-section-14` (cap 2). | Same cap-override pattern. |
| Music Ministry dev note | 🟡 WARN | `directive_misclassified` | `*[Developer note: Display as staff cards. Each card shows photo, name, title, and email. Cards should match the pop-out card style used on the Staff page.]*` | Stored in `image_direction` (semantically wrong — layout directive, not image). | Same pattern as About — needs `developer_notes` field. |

---

## Cross-cutting patterns

### 🔴 1. Nested-`###`-list fragmentation (the headline bug)

Quantified across pages:
| Page | Notion structure | Rendered as | Outcome |
|---|---|---|---|
| Local-Global | 6 local + 4 global partner cards under 2 `## ` parents | 10 sibling sections (mix of cta-section-52 / -20 / content-section-16) | 🔴 fragmented |
| Advocacy | 6 sub-ministry cards under 1 `## ` parent (explicit "card or accordion" directive) | 6 sibling `content-section-16` sections | 🔴 fragmented |
| Serve | 5 partner cards under `## SERVE YOUR CITY` | 5 sibling `cta-section-52` sections | 🔴 fragmented |
| Adults Weekday Studies | 5 `### ` studies under `## ` | One `feature-section-2` with 5 items | ✅ correct |
| Care Additional Ministries | 8 `### ` ministries under `## ` | One `feature-section-2` with 8 items | ✅ correct |
| Serve Worship Support | 5 `### ` Sunday roles under `## ` | One `feature-section-2` with 5 items | ✅ correct |
| Children & Youth | Multiple sub-ministries per `## ` (FPC Kids, Youth Programs) | One cards section per parent | ✅ correct |
| Worship Music Ministry | 4 `### ` sub-sections under `## ` | 4 promoted sibling sections | ✅ correct (intentional for sub-page-sized content) |

**Same Notion structure, opposite outcomes.** The translator's per-page `inline_annotations.note` says "promoted per strategist decision" for the fragmented ones — meaning the SKILL is treating the strategist's decision as authoritative without a deterministic rule. Notion's `Categories: Style Guide = ["Cards Grid"]` property and explicit `*[Developer note: format as a card or accordion]*` directives are being **ignored at template-selection time**.

**Recommended rule (deterministic):** When a `## PARENT` contains N ≥ 2 nested `### CHILDREN` whose bodies are each ≤ ~300 chars (short cards), collapse into ONE `feature-section-2` cards-grid. When each child is ≥ ~500 chars with its own internal structure (multiple paragraphs + CTAs + contacts), promote to siblings. Also: when Notion `Categories: Style Guide` includes `"Cards Grid"`, force collapse regardless of length.

### 🔴 2. Required-slot blockers when Notion omits `**H2:**`

Give's `## MEMBER TESTIMONY` had no inline `**H2:**` line. Translator picked `feature-section-19` (heading required) → empty `primary_heading` → BLOCKER. Three fixes:
- Synthesize `primary_heading` from the section title (e.g., "Member Testimony").
- Pick a heading-optional template (`content_video`-style).
- Defer to `deferred_atoms` + partner-input ask.

### 🔴 3. Multi-button items lose 2nd CTA

Home's Service Times: 2 buttons per service. `content-section-89.items[]` supports 1 CTA per item → 2nd button → freeform `item_meta` string → unclickable. Same shape lurks anywhere a Notion section has >1 button per item.

Fix in `coworkToBrixies.ts`: either (a) pick a multi-button-capable item template when item.buttons.length > 1, OR (b) emit secondary buttons as sibling action rows in `cowork_section_meta.item_secondary_actions[]`.

### 🔴 4. Placeholder URLs ship as empty `url: ""`

Pattern: every `*Button: <label> (placeholder)*` or `*Button: <label> (link to X OR Y)*` produces a button with `url: ""` + a self-flagged `button_missing_url` gap. Button still renders → broken link on click. Fix: hide buttons with empty `url` at render time, OR substitute `"#"`, OR defer entirely. **8 instances across the project.**

### 🟡 5. `cta-section-20` tagline-slot mismatch

Worship Contemplative + Traditional Service emit `tagline` strings but `cta-section-20` has no tagline slot. Content lives in JSON, won't render visibly. Fix the manifest's `uniform_to_brixies` for `cta-section-20` (skip tagline) or add a tagline element to the template's source HTML.

### 🟡 6. Editorial-placeholder leakage

Advocacy's `*[Editable callout — Advocacy team updates this…]*` syntax appears verbatim in 5 of 6 sub-ministry bodies. **Site visitors will see this as visible text.** Need an `editable_block` slot OR a pre-publish strip pass that removes `*[Editable …]*` markers from body content.

### 🟡 7. Inline annotation routing inconsistencies

| Notion shape | Should go to | Actually goes to |
|---|---|---|
| `*[Note for developer: migration/build directive]*` (About) | `developer_notes` (new field) | `dynamic_directive` (wrong) |
| `*[Developer note: Display as staff cards… match the pop-out style…]*` (Worship) | `developer_notes` | `image_direction` (wrong — it's a layout directive, not image) |
| `**Editorial note:** Per Andrew (Comment 23)…` (Serve) | `inline_annotations` | **Dropped entirely** |
| `*[Link: View the History Hallway online → URL — confirm URL carries…]*` (Advocacy) | `inline_annotations` (developer note about URL handoff) | Inlined into body verbatim |

Needs taxonomy cleanup: `developer_notes` bucket distinct from `image_direction` / `dynamic_directive` / `inline_annotations`.

### 🟡 8. Template-cap warnings everywhere

Care (3 pastors vs cap 2; 8 ministries vs cap 6), About (6 beliefs vs cap 3), Worship (5 leaders vs cap 2), Local-Global (3 leaders vs cap 2), Staff (6 pastors + 39 staff vs cap 2), Adults Weekday Studies (5 vs cap 3), Events (9 vs cap 6), Bulletin Links (9 vs cap 6) — all emit `items_overflow`. Strategist override is "ignore caps." Works as long as the renderer honors it (verified: it does). But the WARN spam signals consistently sub-optimal template picks.

Fix: SKILL update — when an items count exceeds the picked template's cap by >25%, prefer a cards-grid template with looser caps.

### 🟡 9. Schema drift in `partner_gaps_flagged` shape

| Pages using `text` field | Pages using `note` field |
|---|---|
| Local-Global, Events, Employment | Bulletin Links, The History Hallway, Pastoral Transition, Advocacy |

Same writer pipeline producing different shapes across pages. Pick one and migrate.

### 🟡 10. URLs referenced in GAPS but missing from rendered output

Advocacy's `## GAPS FLAGGED` calls out `https://firstpres-charlotte.org/triptych/` as critical for physical-signage QR codes. URL appears in zero rendered sections. Same risk: any GAPS-bullet URL not also in a section body gets lost. SKILL should cross-foot GAPS URLs against body URLs and warn on drift.

### 🟢 11. Things that work well

- **Verbatim prose preservation** — 95%+ of sections at `actual_verbatim_ratio: 1`.
- **SEO block round-trip** — every page's `# SEO` → `seo_metadata` with structured fields + raw_block, no drops.
- **Global footer** — single 2.5 KB artifact on `strategy_web_projects.global_footer`, consumed once.
- **GAPS FLAGGED capture** — every page has its `partner_gaps_flagged` array populated (modulo the `text`/`note` field drift).
- **Map embed iframe** — full iframe markup preserved verbatim in `embed_directive`.
- **Image direction preservation** — italic-bracket image notes consistently land in `image_direction`.
- **Bulletin URLs (QR-coded)** — both `/bulletin` and `/cb` and `/bulletin-links/` byte-exact.
- **Preservation flag** — `*[Original Working Notes (preserved)]*` blocks correctly stamp `preservation: source-verbatim`.
- **39-person staff directory** — all names present, source ordering preserved, missing-bio placeholders kept verbatim.

---

## Where in the pipeline each gap appeared

| Gap class | Pipeline stage | Notes |
|---|---|---|
| Nested-`###`-list fragmentation | `audit-external-copy` SKILL §Step 2 (body parser) + §Step 3 (template pick) | No deterministic rule for promote-vs-collapse. Strategist override is inconsistent across same project. Notion's `Categories: Style Guide` + `*[Developer note: format as a card]*` directives are ignored. |
| Required-slot blockers when no `**H2:**` | `audit-external-copy` §Step 3 | Picks heading-required template for heading-less section. Need `heading_synthesizer` step or heading-optional fallback. |
| Multi-button items collapsed | `coworkToBrixies.ts` translator overrides | Per-template overrides don't preserve >1 button per item. |
| `cta-section-20` tagline mismatch | `canonical-templates.json` manifest + template schema | Schema gap. Patch manifest's `uniform_to_brixies` for this template. |
| Placeholder URL `""` ships | `coworkToBrixies.ts` translator | No "drop empty url buttons" pass. |
| Editorial note dropped on Serve | `audit-external-copy` §Step 2 inline-marker table | Capture rule for `**Editorial note:**` isn't deterministic. |
| Inline annotation misclassification | `audit-external-copy` §Step 2 marker → field routing table | Needs `developer_notes` as a separate bucket. |
| Editorial-placeholder leakage (Advocacy callouts) | `audit-external-copy` §Step 2 | `*[Editable callout — …]*` should be stripped from body and routed to `editable_block` slot. |
| `partner_gaps_flagged` field-name drift (`text` vs `note`) | `audit-external-copy` §Step 2 (g) page-final block parser | Same parser producing two shapes — pick one (`note` recommended for consistency with `inline_annotations`). |
| Slug drift (History Hallway → "the-history-hallway") | handoff (slug derivation) | Slug generation added "the-" prefix; doesn't match the partner's GAPS-blocking decision of `/history-hallway` vs `/fpc-clergy`. |
| `_meta` orphan page | handoff-to-pages.ts | The `_meta` jsonb key of `page_outlines` got created as a fake `web_pages` row. Should be filtered. |

---

## Recommended next actions (priority order)

### Immediate (manual fixes via Rich Companion in workspace)

1. **Serve `/serve` — Local Outreach fragmentation.** Re-run audit-external-copy for this page only, with directive: "collapse `## SERVE YOUR CITY` nested `### ` children into one `feature-section-2` cards-grid, same as Sunday Mornings."
2. **Local-Global `/local-global` — same fragmentation × 2.** Collapse `## LOCAL OUTREACH` (6 partners) and `## GLOBAL OUTREACH` (4 partnerships) each into one cards-grid.
3. **Advocacy `/advocacy` — sub-ministry cards.** Collapse the 6 sub-ministries into one cards-grid OR an accordion (`accordion_faq`), per the Notion directive.
4. **Give `/give` — Member Testimony required-slot.** Set `primary_heading` to "Member Testimony" via Rich Companion, OR swap section template.
5. **Home `/` — Service Times multi-button.** Add the missing Watch Livestream URLs as proper buttons via Rich Companion, OR swap to multi-button-per-item template.
6. **Advocacy `/advocacy` — strip `*[Editable callout — …]*` from body.** Manual cleanup in Rich Companion until pre-publish strip pass exists.
7. **The History Hallway `/the-history-hallway` slug.** Strategist decides: `/history-hallway` vs `/fpc-clergy`? Update slug + redirect plan.
8. **Filter the `_meta` orphan page** from `web_pages` (manual SQL: `UPDATE web_pages SET archived = true WHERE slug = '_meta' AND web_project_id = '435ccbf9-…'`).

### Short-term (pipeline patches)

9. **Patch `coworkToBrixies.ts`:** drop buttons with `url === ""` at translator stage (or substitute `"#"`). Removes 8 instances of broken-button shipping.
10. **Patch `cta-section-20` manifest entry:** remove `tagline` from `uniform_to_brixies` so the slot isn't expected.
11. **Patch `partner_gaps_flagged` shape:** consolidate to `{note, kind}` everywhere.

### SKILL-level changes (audit-external-copy v3)

12. **Add deterministic nested-`###` rule:** length-thresholded promote-vs-collapse, plus honor Notion `Categories: Style Guide` + `*[Developer note: format as a card]*` directives.
13. **Add `developer_notes` field** to `cowork_section_meta` shape; route migration / build / layout directives there separately from image/dynamic/inline.
14. **Add `heading_synthesizer` step:** when picked template requires `heading` and Notion section has no inline H2, synthesize from section title.
15. **Add pre-publish strip pass:** `*[Editable callout — …]*` and `*[Content migration: …]*` and `— confirm URL carries to new site` and similar editorial markers should be removed from body content (kept in `dynamic_directive` for designer reference).
16. **Add GAPS-URL cross-foot:** any URL in `## GAPS FLAGGED` that's tagged as QR-code-critical should be required to appear in at least one rendered section body or button URL.

### Renderer-level changes

17. **Honor `items_overflow` override consistently** — confirmed rendering does already, but the WARN spam is misleading; suppress when strategist override is active.
18. **Render-time guard against empty `url`** — if `button.url === ""`, hide button or render as disabled.

---

*End of audit. Doc generated 2026-06-18 from 6 parallel content-fidelity subagents. Source verbatim quotes preserved throughout via backticks.*
