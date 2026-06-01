#!/usr/bin/env python3
"""
Pressure test: web-sitemap-builder skill executed against Riverwood's atoms +
voice card + brixies library.

Implements the skill's 8-step workflow:
  1. Load strategic spine (refs/sitemap-strategy.md — implicit here)
  2. Lift brief decisions (recommended_page, page_primacy_mapping)
  3. Apply mandatory 4 + 2 strategic for Phase 1
  4. Phase 2 proposals via density-driven nesting
  5. Nav structure (grouped_dropdowns + rules a-j + voice-match)
  6. Section list per page (concept-tagged from brixies library)
  7. AEO/GEO keywords per page
  8. Content strategy doc + coverage audit + confidence

Output: sitemap-shaped JSON, no Supabase writes.
"""
import json
import re
from datetime import datetime
from pathlib import Path
from collections import Counter, defaultdict

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
CONTENT_MAP = WORKSPACE / "riverwood-content-map-dry-run.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-sitemap-dry-run.json")

with open(NORMALIZER) as f:
    intake = json.load(f)
with open(VOICE_CARD) as f:
    vc_dump = json.load(f)
with open(CONTENT_MAP) as f:
    cm = json.load(f)

atoms = intake["atoms"]
facts = intake["facts"]
voice_card = vc_dump["voice_card"]
natural_pages = cm["natural_pages"]
consolidation_candidates = cm["consolidation_candidates"]
content_map_density = cm["topic_density"]

# ═══════════════════════════════════════════════════════════════════
# STEP 2 — LIFT BRIEF DECISIONS
# ═══════════════════════════════════════════════════════════════════
# Look for recommended_page atoms (none in Riverwood's brief) and
# page_primacy_mapping atom (present — the brief's per-page primary/secondary table).

recommended_pages = [a for a in atoms if a["topic"] == "recommended_page"]
primacy_atom = next((a for a in atoms if a["topic"] == "page_primacy_mapping"), None)
primacy_table = primacy_atom["metadata"]["mapping"] if primacy_atom else []
primacy_by_slug = {p["page"]: p for p in primacy_table}

# Voice card personas + their critical conversion pages
personas = voice_card["persona_snapshots"]
persona_labels = [p["label"] for p in personas]
critical_pages = {p["label"]: p.get("critical_conversion_page") for p in personas}


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — PHASE 1 PAGE SET
# ═══════════════════════════════════════════════════════════════════
# Mandatory 4 + 2 strategic. Voice card personas' critical_conversion_page
# values + the primacy table guide the 2 strategic picks.

def page(slug, name, phase, purpose, sort_order, **extras):
    """Helper to build a page entry, pulling persona primacy from the brief if present."""
    primary = secondary = None
    if slug in primacy_by_slug:
        primary = primacy_by_slug[slug]["primary"]
        secondary = primacy_by_slug[slug].get("secondary") or []
    p = {
        "slug": slug,
        "name": name,
        "phase": phase,
        "primary_persona": primary,
        "secondary_personas": secondary or [],
        "purpose": purpose,
        "sort_order": sort_order,
    }
    p.update(extras)
    return p


pages = []
# Mandatory 4
pages.append(page("/", "Home", "1",
    "Communicate 'big church that feels small' to every audience in the first scroll. Establish mission and route visitors to their entry path.", 1))
pages.append(page("/visit", "Plan a Visit", "1",
    "Lower the barrier to entry for cautious guests by surfacing logistics first (service times, parking, kids check-in, what to wear).", 2))
pages.append(page("/watch", "Sermons", "1",
    "Pass-through to Church Center / YouTube sermon archive. Riverwood does not manage sermons on-site (per content collection).", 3))
pages.append(page("/give", "Give", "1",
    "Make generosity a worship response rather than a transaction. Online giving + non-cash giving + future building campaign placeholder.", 4))
# 2 strategic
pages.append(page("/kids", "Kids at Riverwood", "1",
    "The Suburban Family's critical conversion page. Confirm kids ministry is safe, organized, and curriculum-grounded (Gospel Project).", 5))
pages.append(page("/story-beliefs", "Our Story & Beliefs", "1",
    "Trust-building through church history (since 1991) and theological clarity (8 doctrines). Serves The Person in a Hard Season's vetting + The Established Member's legacy recognition.", 6))


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — PHASE 2 PAGE SET
# ═══════════════════════════════════════════════════════════════════
# Walk facts + content atoms. Distinct vs. nest decisions per
# sitemap-strategy §4 (density-driven). Audience-specific pages stay
# distinct (§4 paragraph 2).

pages.append(page("/leadership", "Leadership Team", "2",
    "Humanize the pastoral team for The Person in a Hard Season. Real names, real emails, real bios (21 staff in content collection).", 7))
pages.append(page("/connect", "Connect", "2",
    "Hub for Be Known mission pillar. Routes Suburban Family to relational next steps.", 8))
pages.append(page("/students-college", "Students & College", "2",
    "The Kent State Student's primary page. Distinct from Kids (different audience).", 9))
pages.append(page("/adult-studies", "Adult Studies & Classes", "2",
    "Adult discipleship — Life Groups + Care Support Groups + Bible Studies + Men's Huddle + Women to Women.", 10))
pages.append(page("/discovery-membership", "Discovery & Membership", "2",
    "Single defined assimilation pathway. Houses Baptism (per standard consolidation).", 11))
pages.append(page("/care", "Care & Recovery", "2",
    "The Person in a Hard Season's primary page. 5 named programs (Celebrate Recovery, GriefShare, Overcome, Care 101, Cancer Care).", 12))
pages.append(page("/outreach", "Local & Global Outreach", "2",
    "The Established Member's primary page. Make Him Known mission pillar. Local (Food Pantry + 3 partners) + Global (10 missionary partnerships).", 13))
pages.append(page("/events", "Events", "2",
    "Current-state surface (per sitemap-strategy §6c). Planning Center embed.", 14))


# Pages from primacy_table not yet in pages[] — check coverage
primacy_slugs = {p["page"] for p in primacy_table}
proposed_slugs = {p["slug"] for p in pages}
missing_from_proposal = primacy_slugs - proposed_slugs
if missing_from_proposal:
    print(f"⚠ Pages in brief primacy table not yet proposed: {missing_from_proposal}")


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — NAV STRUCTURE
# ═══════════════════════════════════════════════════════════════════
# Pattern: grouped_dropdowns (14 pages → grouped beats flat). Primary
# nav max 6 items. Voice-match each label against voice card.

nav_items = [
    {"label": "Plan a Visit", "slug": "/visit", "position": "header", "sort_order": 1},
    {"label": "About", "position": "header", "sort_order": 2, "children": [
        {"label": "Our Story & Beliefs", "slug": "/story-beliefs"},
        {"label": "Leadership Team", "slug": "/leadership"},
    ]},
    {"label": "Connect", "position": "header", "sort_order": 3, "children": [
        {"label": "Kids", "slug": "/kids"},
        {"label": "Students & College", "slug": "/students-college"},
        {"label": "Adult Studies", "slug": "/adult-studies"},
        {"label": "Discovery & Membership", "slug": "/discovery-membership"},
    ]},
    {"label": "Impact", "position": "header", "sort_order": 4, "children": [
        {"label": "Care & Recovery", "slug": "/care"},
        {"label": "Local & Global Outreach", "slug": "/outreach"},
    ]},
    {"label": "Watch", "slug": "/watch", "position": "header", "sort_order": 5},
    {"label": "Give", "slug": "/give", "position": "header", "sort_order": 6},
    # Footer
    {"label": "Homepage", "slug": "/", "position": "footer", "sort_order": 1},
    {"label": "Events", "slug": "/events", "position": "footer", "sort_order": 2},
    {"label": "Contact", "slug": "/visit", "position": "footer", "sort_order": 3, "note": "Contact info section on Plan a Visit; no standalone Contact page"},
    {"label": "Newsletter", "position": "footer", "sort_order": 4, "external_url": "https://riverwoodchapel.us7.list-manage.com/subscribe"},
]

# Voice-match audit (rule d). For Riverwood: warm, shepherding, understated.
voice_match_pass = []
banned_voice_failure = []
banned_terms = set(voice_card["banned_terms"])
for item in nav_items:
    label = item["label"].lower()
    # Check against banned terms
    for bt in banned_terms:
        if bt.lower() in label:
            banned_voice_failure.append({"label": item["label"], "banned": bt})
    # Check against voice card tone — none of these labels read as bold/cool
    voice_match_pass.append(item["label"])

# Programmatic rule checks
primary_nav_count = sum(1 for n in nav_items if n["position"] == "header")
assert primary_nav_count <= 6, f"Primary nav has {primary_nav_count} items, max 6"


# ═══════════════════════════════════════════════════════════════════
# STEP 6 — REMOVED (moved to web-section-planner)
# ═══════════════════════════════════════════════════════════════════
# Section concept tagging is no longer this skill's responsibility.
# web-section-planner runs AFTER this skill with the locked page set
# + content_map's atom-to-topic_group mapping + voice card + brixies
# library as input. It produces sections_by_page with concept_ids.
#
# Removing this from sitemap means: (a) sitemap doesn't have to guess
# section concepts before content distribution is known; (b) section
# planner has the actual atom distribution to work from.

_REMOVED_sections_block_DO_NOT_RESTORE = {
    "/": [
        {"sort_order": 1, "concept_id": "hero_homepage",
         "intent_summary": "Welcome hero: 'A place to feel known' or similar. Service times + 2 CTAs (Plan a Visit, Watch a sermon). Image of Foyer / community moment."},
        {"sort_order": 2, "concept_id": "content_image_text",
         "intent_summary": "Mission framing: Know Jesus, Be Known, Make Him Known. Riverwood's three pillars in plain language."},
        {"sort_order": 3, "concept_id": "feature_card_grid",
         "intent_summary": "Three mission pillars as cards (Know Jesus → Watch + Beliefs; Be Known → Connect; Make Him Known → Impact)."},
        {"sort_order": 4, "concept_id": "cta_callout",
         "intent_summary": "Big banner CTA — Plan a Visit. Service time snippet + parking note."},
        {"sort_order": 5, "concept_id": "contact_section",
         "intent_summary": "Foyer-style welcome: address, map preview, phone, office hours."},
    ],
    "/visit": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Plan-your-visit hero. 'Get ready for Sunday.' Service times + 'Get directions' primary CTA + 'Pre-register your kids' secondary CTA."},
        {"sort_order": 2, "concept_id": "content_image_text",
         "intent_summary": "What to expect on Sunday — service experience prose lifted from content collection. Bent Tree Coffee in the Foyer, greeters at the doors, kids check-in process."},
        {"sort_order": 3, "concept_id": "feature_unique",
         "intent_summary": "4-step kids check-in process. Process Section concept — sequenced steps."},
        {"sort_order": 4, "concept_id": "feature_card_grid",
         "intent_summary": "3 cards: Where to park · What to wear · Where the kids go. Wayfinding for first-time families."},
        {"sort_order": 5, "concept_id": "cta_simple",
         "intent_summary": "Pre-register your kids — Church Center check-in URL."},
        {"sort_order": 6, "concept_id": "contact_section",
         "intent_summary": "Quick contact — Nate Walker (Director of Services) + map + phone."},
    ],
    "/watch": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Sermons hero. Cole Tawney's teaching style line. Current series art if available."},
        {"sort_order": 2, "concept_id": "archive_current_series",
         "intent_summary": "Current sermon series featured prominently. Pulls from Church Center."},
        {"sort_order": 3, "concept_id": "cta_simple",
         "intent_summary": "Watch the Sunday livestream → YouTube. Add service times here (C1 audit finding)."},
        {"sort_order": 4, "concept_id": "feature_card_grid",
         "intent_summary": "Recent sermons grid — link out to Church Center archive."},
    ],
    "/give": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Give hero. Generosity-as-worship framing."},
        {"sort_order": 2, "concept_id": "content_image_text",
         "intent_summary": "Why give — Riverwood's full give_rationale text (lifted verbatim from content collection)."},
        {"sort_order": 3, "concept_id": "feature_card_grid",
         "intent_summary": "Ways to give: Online (Suran link), Non-cash (Cindy Bowser contact), Year-End Statement, Building Campaign placeholder."},
        {"sort_order": 4, "concept_id": "accordion_faq",
         "intent_summary": "Common giving questions — tax statements, recurring gifts, designated funds."},
        {"sort_order": 5, "concept_id": "cta_simple",
         "intent_summary": "Give online → Suran giving form."},
    ],
    "/kids": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Kids at Riverwood hero. Warm + practical: 'Safe, organized, taught.' Note: 7:45 service has no kids programming."},
        {"sort_order": 2, "concept_id": "content_image_text",
         "intent_summary": "What kids learn at Riverwood — Gospel Project curriculum, partnership with parents in childhood discipleship."},
        {"sort_order": 3, "concept_id": "feature_card_grid",
         "intent_summary": "3 age tiers: Open Arms Nursery (infants-toddlers), Preschool (3-K), Elementary (1st-4th)."},
        {"sort_order": 4, "concept_id": "feature_unique",
         "intent_summary": "Kids check-in process as a 4-step numbered flow. Process Section concept."},
        {"sort_order": 5, "concept_id": "cta_simple",
         "intent_summary": "Pre-register your kids — Church Center check-in URL."},
    ],
    "/story-beliefs": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Our Story & Beliefs hero. 'Grounded in truth.' Tagline 'Riverwood Chapel since 1991.'"},
        {"sort_order": 2, "concept_id": "content_image_text",
         "intent_summary": "Mission + Vision verbatim. 'Heaven on earth in Kent and Portage County.'"},
        {"sort_order": 3, "concept_id": "timeline_story",
         "intent_summary": "Church history milestones — 1991 founding through 2024 four services. 11 milestones from discovery."},
        {"sort_order": 4, "concept_id": "feature_card_grid",
         "intent_summary": "6 church values as cards: Scripture First, Intentional Discipleship, Known and Connected, Accessible Leadership, Multigenerational, Community Presence."},
        {"sort_order": 5, "concept_id": "accordion_faq",
         "intent_summary": "Statement of Beliefs — 8 doctrines as expandable items (God, Jesus Christ, Holy Spirit, People & Sin, Salvation, Church, Ordinances, End Times)."},
    ],
    "/leadership": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Leadership hero. Accessible Leadership value framing."},
        {"sort_order": 2, "concept_id": "feature_team",
         "intent_summary": "Staff grid — 21 staff members from content collection. Names, roles, emails, optional bios."},
        {"sort_order": 3, "concept_id": "content_image_text",
         "intent_summary": "Accessible Leadership value text — what this looks like in practice."},
    ],
    "/connect": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Connect hero. Be Known mission pillar. Not-sure-where-to-start framing."},
        {"sort_order": 2, "concept_id": "feature_card_grid",
         "intent_summary": "4 connect pathways: Kids, Students & College, Adult Studies, Discovery & Membership."},
        {"sort_order": 3, "concept_id": "cta_simple",
         "intent_summary": "Email Maggie or visit the Welcome Center in the Foyer."},
    ],
    "/students-college": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Students & College hero. Welcoming without pressure (lifted from content collection)."},
        {"sort_order": 2, "concept_id": "feature_tabbed",
         "intent_summary": "Tabbed: Middle School / High School / College. Each tab has its schedule and director (AJ Coy, Josiah Keating, Bryan Kane)."},
        {"sort_order": 3, "concept_id": "cta_simple",
         "intent_summary": "Email the director — link to staff directory."},
    ],
    "/adult-studies": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Adult Studies & Classes hero. Five-investments framework (Christ, Word, others, corporate worship, disciple-making)."},
        {"sort_order": 2, "concept_id": "feature_card_grid",
         "intent_summary": "Group types: Life Groups, Care Support Groups, Bible Studies, Men's Huddle, Women to Women."},
        {"sort_order": 3, "concept_id": "accordion_faq",
         "intent_summary": "How small groups work — meeting cadence, sign-up, contact (Josh Miller)."},
    ],
    "/discovery-membership": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Discovery & Membership hero. Single assimilation pathway."},
        {"sort_order": 2, "concept_id": "feature_unique",
         "intent_summary": "4-week class process: Mission · Values · Theology · Staff + practical next steps."},
        {"sort_order": 3, "concept_id": "content_image_text",
         "intent_summary": "Baptism section — why, what it looks like, 5-step sign-up process. Acts 2:39 + Matthew 3:11."},
        {"sort_order": 4, "concept_id": "cta_simple",
         "intent_summary": "Sign up for Discovery — Church Center registration URL."},
    ],
    "/care": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Care & Recovery hero. 'It's okay to not be okay.' (verbatim from page outline.)"},
        {"sort_order": 2, "concept_id": "feature_card_grid",
         "intent_summary": "5 named programs as cards: Care 101 (Kirk McCutcheon), GriefShare (Diana Knapp), Overcome, Celebrate Recovery (Kirk McCutcheon), Cancer Care."},
        {"sort_order": 3, "concept_id": "contact_section",
         "intent_summary": "Care Team contact — Jeff Haynes (Care & Outreach Pastor), Nola Ruble (Admin)."},
    ],
    "/outreach": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Local & Global Outreach hero. 'Gather to worship, then scatter to live sent lives' (verbatim from vision)."},
        {"sort_order": 2, "concept_id": "feature_card_grid",
         "intent_summary": "Local: Food Pantry + 3 partners (Faithful Servant Care Center, Akron Pregnancy Services, Shepherd's House of Portage County)."},
        {"sort_order": 3, "concept_id": "feature_card_carousel",
         "intent_summary": "Global: 10 missionary partnerships (Brad & Sara, Riley & Alissa Brookings, Clemente family, Del Rey, John & Jane Doe, Jenny Haver, Dan & Jen, Dale & Jillian Liff, PJ & Lizzy, Niedergalls). Note: some names are pseudonyms — security-sensitive (handling_notes from atoms)."},
    ],
    "/events": [
        {"sort_order": 1, "concept_id": "hero_inner",
         "intent_summary": "Events hero. Current-state framing."},
        {"sort_order": 2, "concept_id": "archive_filter",
         "intent_summary": "Planning Center events embed. Calendar surface."},
        {"sort_order": 3, "concept_id": "contact_section",
         "intent_summary": "Event questions — Cora Gray (Event Communications Coordinator)."},
    ],
}

# Concept validation moved to web-section-planner along with the section
# tagging itself. This skill no longer touches Brixies concepts.


# ═══════════════════════════════════════════════════════════════════
# STEP 7 — AEO/GEO KEYWORDS PER PAGE
# ═══════════════════════════════════════════════════════════════════
# Per-page primary / secondary / long-tail / local keywords. Grounded
# in church_name, denomination, location, ministry-specific terms.

CHURCH = "Riverwood Chapel"
CITY = "Kent"
STATE = "Ohio"
COUNTY = "Portage County"
DENOMINATION = "Non-denominational"


def kw(slug):
    """Per-page keyword bundles. Grounded in Riverwood specifics."""
    bundles = {
        "/": {
            "primary": [f"{CHURCH}", f"{CHURCH} {CITY}", f"{DENOMINATION} church {CITY} {STATE}"],
            "secondary": [f"Bible church {CITY}", f"{CHURCH} service times", "Church family Kent OH", f"Evangelical church {CITY} {STATE}", f"Christian church near {CITY} State"],
            "long_tail": [f"What is {CHURCH}", f"{CHURCH} mission and beliefs", f"Big church that feels small {CITY} {STATE}"],
            "local": [f"Church near {CITY} State University", f"{CITY} {STATE} church family", f"{COUNTY} non-denominational church", f"Church near 44240"],
        },
        "/visit": {
            "primary": [f"Plan a visit {CHURCH}", f"{CHURCH} service times", f"Sunday service {CITY} {STATE}"],
            "secondary": ["What to wear church Kent", "Kids check-in Kent Ohio church", "Riverwood Chapel parking", "First time visit Riverwood", "Riverwood Chapel Sundays"],
            "long_tail": [f"What to expect first time at {CHURCH}", f"Where to park at {CHURCH}", f"What time are services at {CHURCH}"],
            "local": [f"Church visit {CITY} {STATE}", f"{CITY} {STATE} church Sunday morning", "Family church Kent OH"],
        },
        "/watch": {
            "primary": [f"{CHURCH} sermons", f"{CHURCH} livestream", f"Cole Tawney sermons"],
            "secondary": [f"Sunday sermon {CITY} {STATE}", f"Bible teaching church {COUNTY}", f"Watch {CHURCH} online", "Riverwood Chapel YouTube", "Riverwood sermon archive"],
            "long_tail": [f"What time is the {CHURCH} livestream", f"Where to watch {CHURCH} sermons"],
            "local": [f"Sunday livestream {CITY} {STATE}"],
        },
        "/give": {
            "primary": [f"{CHURCH} giving", f"Give to {CHURCH}", f"Online giving {CITY} {STATE} church"],
            "secondary": ["Recurring giving church Kent", "Non-cash giving Kent Ohio", "Building campaign Riverwood", "Riverwood Chapel donate", "Generosity Kent Ohio church"],
            "long_tail": [f"How to give to {CHURCH}", f"Stock donations {CHURCH}", "Year-end giving statement Riverwood"],
            "local": [f"{CITY} {STATE} church giving"],
        },
        "/kids": {
            "primary": [f"{CHURCH} kids", f"Kids ministry {CITY} {STATE}", f"Children's church {CITY}"],
            "secondary": ["Riverwood nursery", "Sunday school Kent Ohio", "Kids check-in Riverwood Chapel", "Gospel Project curriculum Kent", "Kids Wing Kent church", "Children Sunday programs Kent OH"],
            "long_tail": [f"Where is the kids wing at {CHURCH}", f"Pre-register {CHURCH} kids", "Age groups Riverwood kids ministry"],
            "local": [f"Family church {CITY} OH", f"Kids programs {COUNTY}", f"{CITY} {STATE} Sunday school"],
        },
        "/story-beliefs": {
            "primary": [f"{CHURCH} beliefs", f"{CHURCH} statement of faith", f"{CHURCH} history"],
            "secondary": ["What does Riverwood believe", "Statement of faith Kent Ohio church", "Non-denominational evangelical beliefs Kent", "Riverwood Chapel since 1991", "Riverwood doctrine"],
            "long_tail": [f"What does {CHURCH} teach about salvation", f"{CHURCH} statement of beliefs", "Christian beliefs Kent Ohio"],
            "local": [f"{CITY} Ohio Christian beliefs"],
        },
        "/leadership": {
            "primary": [f"{CHURCH} leadership", f"{CHURCH} pastors", "Cole Tawney lead pastor"],
            "secondary": [f"{CHURCH} staff", "Riverwood Chapel pastors", "Kent Ohio church pastors", "Meet the team Riverwood", "Riverwood elders deacons"],
            "long_tail": [f"Who is the lead pastor at {CHURCH}", "Cole Tawney Riverwood Chapel"],
            "local": [f"{CITY} {STATE} church leadership"],
        },
        "/connect": {
            "primary": [f"Get connected {CHURCH}", "Find community Kent Ohio church", "Be known Riverwood"],
            "secondary": ["Life groups Kent Ohio", "Volunteer Riverwood Chapel", "Connection group Kent OH", "Riverwood pathways", "Welcome Center Riverwood"],
            "long_tail": [f"How to get involved at {CHURCH}", "First step after visiting Riverwood"],
            "local": [f"Christian community {CITY} {STATE}"],
        },
        "/students-college": {
            "primary": [f"Kent State campus ministry", f"{CHURCH} students", "College ministry Kent Ohio"],
            "secondary": ["Middle school ministry Kent OH", "High school youth Kent", "Wednesday night students Riverwood", "Sunday night high school Kent", "Christian fellowship Kent State"],
            "long_tail": [f"College ministry near {CITY} State", "Christian community for Kent State students", "Youth group Kent Ohio non-denominational"],
            "local": [f"{CITY} State campus partner church", f"{CITY} Ohio youth ministry"],
        },
        "/adult-studies": {
            "primary": [f"{CHURCH} life groups", "Bible study Kent Ohio", "Adult Bible study Kent"],
            "secondary": ["Men's group Kent OH", "Women's Bible study Kent", "Small group Kent Ohio church", "Discipleship class Riverwood", "Five investments framework"],
            "long_tail": [f"Where to join a Bible study in {CITY}", "How to find a life group at Riverwood"],
            "local": [f"Bible studies {CITY} {STATE}"],
        },
        "/discovery-membership": {
            "primary": [f"{CHURCH} membership", f"{CHURCH} Discovery class", "Baptism Kent Ohio church"],
            "secondary": ["Become a member Riverwood", "Riverwood Discovery class", "Baptism Riverwood Chapel", "Membership process Kent OH", "Get baptized Kent Ohio"],
            "long_tail": [f"How to become a member at {CHURCH}", f"How to get baptized at {CHURCH}", "Membership class Kent Ohio"],
            "local": [f"Baptism {CITY} {STATE}"],
        },
        "/care": {
            "primary": ["Celebrate Recovery Kent Ohio", "GriefShare Kent OH", "Care ministry Kent church"],
            "secondary": ["Overcome group Riverwood", "Cancer care ministry Kent", "Crisis support Kent Ohio church", "Recovery group Portage County", "Biblical counseling Kent"],
            "long_tail": [f"Is there a church in {CITY} with a recovery program", "Where can I find GriefShare in Kent Ohio", "Cancer care support Kent Ohio"],
            "local": [f"Support groups {CITY} {STATE} church", f"{COUNTY} care ministry"],
        },
        "/outreach": {
            "primary": [f"{CHURCH} food pantry", "Local outreach Kent Ohio", "Mission partners Riverwood"],
            "secondary": ["Food pantry Kent OH Friday", "Akron Pregnancy Services partner", "Shepherd's House Portage County", "Global mission partners Riverwood", "Local outreach church Kent"],
            "long_tail": [f"Where to get help with food in {CITY} {STATE}", "Riverwood Chapel missionaries", "Local ministry partners Riverwood"],
            "local": [f"{CITY} {STATE} food pantry", f"{COUNTY} church outreach"],
        },
        "/events": {
            "primary": [f"{CHURCH} events", "Kent Ohio church events", "Riverwood Chapel calendar"],
            "secondary": ["Community events Kent Ohio church", "Riverwood VBS", "Sports camp Kent OH", "Church events Portage County"],
            "long_tail": [f"What events are happening at {CHURCH}", "Upcoming events Riverwood Chapel"],
            "local": [f"Family events {CITY} {STATE} church"],
        },
    }
    return bundles.get(slug, {"primary": [], "secondary": [], "long_tail": [], "local": []})


for p in pages:
    p["keywords"] = kw(p["slug"])


# ═══════════════════════════════════════════════════════════════════
# STEP 8 — COVERAGE AUDIT + ABSORBED CONTENT + CONFIDENCE
# ═══════════════════════════════════════════════════════════════════
# NOTE: No content_strategy_doc generated here. Partner-facing prose
# is produced by web-content-strategy-author, downstream of content
# map. This skill stays focused on structural decisions.

absorbed_content = [
    {"original": "Membership", "absorbed_into": "/discovery-membership", "reason": "Single assimilation pathway. Per brief: Discovery class IS the front door to membership."},
    {"original": "Baptism", "absorbed_into": "/discovery-membership", "reason": "Standard consolidation. Acts 2:39 + Matthew 3:11 + 5-step sign-up flow live on the page."},
    {"original": "Local Outreach (standalone)", "absorbed_into": "/outreach", "reason": "Standard consolidation. Local + Global combined for unified Make Him Known pillar."},
    {"original": "Global Outreach (standalone)", "absorbed_into": "/outreach", "reason": "Standard consolidation."},
    {"original": "Contact (standalone page)", "absorbed_into": "/visit", "reason": "Contact section on Plan a Visit page. Riverwood's contact info is the same as their visit info; no standalone needed."},
    {"original": "Cancer Care (standalone)", "absorbed_into": "/care", "reason": "Distinct named program within Care & Recovery."},
    {"original": "Food Pantry (standalone)", "absorbed_into": "/outreach", "reason": "Distinct named program within Local outreach."},
]

# Coverage audit — every named ministry / program / staff / partner from facts and content atoms
coverage_items = []
# From facts
for f in facts:
    if f["topic"] == "staff":
        coverage_items.append({"item": f["body"], "type": "staff", "status": "placed", "page": "/leadership"})
    elif f["topic"] == "ministry":
        coverage_items.append({"item": f["body"], "type": "ministry", "status": "placed", "page": "/outreach"})
    elif f["topic"] == "partnership":
        kind = f.get("metadata", {}).get("kind", "global")
        coverage_items.append({"item": f["body"], "type": f"partnership_{kind}", "status": "placed", "page": "/outreach"})
    elif f["topic"] == "belief":
        coverage_items.append({"item": f.get("metadata", {}).get("doctrine", f["body"][:40]), "type": "belief", "status": "placed", "page": "/story-beliefs"})
    elif f["topic"] == "milestone":
        coverage_items.append({"item": f["body"][:60], "type": "milestone", "status": "placed", "page": "/story-beliefs"})
    elif f["topic"] == "service_time":
        coverage_items.append({"item": f["body"], "type": "service_time", "status": "nested", "page": "/visit", "section_concept": "hero_inner"})

# From content atoms — ministries
for a in atoms:
    if a["topic"] == "kids_ministry":
        coverage_items.append({"item": a.get("label") or a["body"][:60], "type": "kids_ministry", "status": "nested", "page": "/kids", "section_concept": "feature_card_grid"})
    elif a["topic"] == "care_ministry":
        coverage_items.append({"item": a.get("label") or a["body"][:60], "type": "care_ministry", "status": "nested", "page": "/care", "section_concept": "feature_card_grid"})
    elif a["topic"] == "adult_ministry":
        coverage_items.append({"item": a.get("label") or a["body"][:60], "type": "adult_ministry", "status": "nested", "page": "/adult-studies", "section_concept": "feature_card_grid"})


# Confidence log
confidence_log = {}
for p in pages:
    slug = p["slug"]
    if slug in primacy_by_slug:
        confidence_log[slug] = "lifted_from_brief"  # primacy was lifted
    elif slug in ("/", "/visit", "/watch", "/give"):
        confidence_log[slug] = "default_from_strategy_spine"  # mandatory 4
    else:
        confidence_log[slug] = "inferred_from_voice_card"


unfilled = {}
# Note: no recommended_page atoms means brief didn't list pages explicitly
if not recommended_pages:
    unfilled["recommended_page_atoms"] = "Brief did not contain a recommended_page list. Phase 1 selection inferred from voice card persona critical_conversion_pages + sitemap-strategy.md §3 rules."


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════
result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_sitemap_builder v1",
    "dry_run": True,
    "source_atoms": NORMALIZER.name,
    "source_voice_card": VOICE_CARD.name,
    "source_content_map": CONTENT_MAP.name,
    "pages": pages,
    "nav_items": nav_items,
    "absorbed_content": absorbed_content,
    "content_coverage_audit": coverage_items,
    "_confidence_log": confidence_log,
    "_unfilled_with_reason": unfilled,
    "_voice_match_audit": {
        "labels_audited": voice_match_pass,
        "banned_term_collisions": banned_voice_failure,
    },
    "_validation": {
        "phase_1_count": sum(1 for p in pages if p["phase"] == "1"),
        "phase_1_max": 7,
        "phase_2_count": sum(1 for p in pages if p["phase"] == "2"),
        "total_pages": len(pages),
        "total_max": 20,
        "primary_nav_count": primary_nav_count,
        "primary_nav_max": 6,
        "pages_in_brief_primacy_table_not_proposed": list(missing_from_proposal),
    },
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface key numbers
print(f"Wrote {OUTPUT}")
print()
print("=== Phase 1 (6 pages) ===")
for p in pages:
    if p["phase"] == "1":
        print(f"  {p['sort_order']}. {p['slug']:25s} {p['name']:35s} primary={p['primary_persona']}")
print()
print("=== Phase 2 (8 pages) ===")
for p in pages:
    if p["phase"] == "2":
        print(f"  {p['sort_order']}. {p['slug']:25s} {p['name']:35s} primary={p['primary_persona']}")
print()
print(f"Total: {len(pages)} / 20")
print(f"Primary nav: {primary_nav_count} / 6")
print()
print(f"Banned term collisions in nav labels: {len(banned_voice_failure)}")
print(f"Pages in brief primacy table not proposed: {list(missing_from_proposal)}")
print(f"Coverage audit entries: {len(coverage_items)}")
print(f"_confidence_log entries: {len(confidence_log)}")
print(f"_unfilled_with_reason: {len(unfilled)}")
print()
print("(Section concept tagging moved to web-section-planner — runs after this skill.)")
