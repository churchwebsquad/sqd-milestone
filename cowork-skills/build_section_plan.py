#!/usr/bin/env python3
"""
Pressure test: web-section-planner skill executed against Riverwood.

Implements the 6-step workflow:
  1. Build canonical atom → page assignments
  2. Propose section list per page (group by structural shape)
  3. Identify cross-page references via voice card persona journeys
  4. Compose content_page_map rows
  5. Validate
  6. Confidence + unfilled

Output: section plan JSON, no Supabase writes.
"""
import json
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
SITEMAP = WORKSPACE / "riverwood-sitemap-dry-run.json"
CONTENT_MAP = WORKSPACE / "riverwood-content-map-dry-run.json"
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
BRIXIES = WORKSPACE / "brixies-library.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-section-plan-dry-run.json")

with open(SITEMAP) as f: sitemap = json.load(f)
with open(CONTENT_MAP) as f: content_map = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(BRIXIES) as f: brixies = json.load(f)

pages = sitemap["pages"]
nav_items = sitemap["nav_items"]
absorbed_content = sitemap.get("absorbed_content", [])

atoms = intake["atoms"]
facts = intake["facts"]

natural_pages = content_map["natural_pages"]
strategic_contribs = content_map["strategic_mandate_contributors"]
consolidation_candidates = content_map["consolidation_candidates"]

voice_card = vc_dump["voice_card"]
personas = voice_card["persona_snapshots"]

concepts = brixies["curated_concepts"]
concept_by_id = {c["id"]: c for c in concepts}

# Strategic-mandate page handlers — map from contributor key to page slug
MANDATE_PAGES = {
    "/visit": strategic_contribs["/visit_contributors"],
    "/watch": strategic_contribs["/watch_contributors"],
    "/give": strategic_contribs["/give_contributors"],
    "/connect": strategic_contribs["/connect_contributors"],
    "/story-beliefs": strategic_contribs["/story-beliefs_contributors"],
}

# Map from natural_page slug to final slug after sitemap consolidations
consolidations = {}
for cc in consolidation_candidates:
    if cc["type"] == "merge":
        target = cc.get("into")
        for src in cc["candidates"]:
            consolidations[src] = target
    elif cc["type"] == "absorb":
        target = cc.get("into")
        for src in cc["candidates"]:
            consolidations[src] = target  # absorbed topics


# ═══════════════════════════════════════════════════════════════════
# STEP 1 — CANONICAL ATOM → PAGE
# ═══════════════════════════════════════════════════════════════════

# Build topic → final_page map
topic_to_page = {}

# Start with natural_pages, applying consolidations
for np in natural_pages:
    np_slug = np["proposed_slug"]
    final_slug = consolidations.get(np_slug, np_slug)
    # Verify final_slug is in sitemap pages
    if final_slug not in {p["slug"] for p in pages}:
        # Try other variants (e.g., /outreach)
        for variant in (final_slug, final_slug.replace("-", "_"), final_slug.lstrip("/")):
            if "/" + variant.lstrip("/") in {p["slug"] for p in pages}:
                final_slug = "/" + variant.lstrip("/")
                break
    for topic in np["topic_grouping"]:
        topic_to_page[topic] = final_slug

# Add strategic-mandate contributors
for page_slug, contrib_topics in MANDATE_PAGES.items():
    for topic in contrib_topics:
        if topic not in topic_to_page:
            topic_to_page[topic] = page_slug

# Absorbed topics (baptism_*, membership) → their target
for cc in consolidation_candidates:
    if cc["type"] == "absorb":
        target = cc["into"]
        for src in cc["candidates"]:
            topic_to_page[src] = target

# Strategic atoms aren't in content_page_map at all — they belong to the voice
# card and other strategic outputs. Filter them out before assigning canonical
# pages.
STRATEGIC_TOPICS = {
    "persona", "tone_descriptor", "tone_block",
    "mission_statement", "vision_statement", "x_factor",
    "denominational_signal", "voice_rule", "theological_capitalization",
    "branded_term", "banned_term", "anti_model",
    "strategic_priority", "website_goal",
    "page_primacy_mapping", "recommended_page",
    "design_reference", "am_note", "current_keyword",
    "voice_ammo", "ideal_experience", "community_struggle", "engagement_lever",
    "tagline", "staff_value",  # staff_value is voice card content, not page content
}

# For each atom, find its canonical page
atom_canonical = {}  # atom_external_ref_id → page_slug
atoms_without_canonical = []
for a in atoms:
    topic = a["topic"]
    # Skip strategic atoms — they don't have a canonical page.
    if topic in STRATEGIC_TOPICS:
        continue
    eri = a.get("external_ref_id") or f"atom:{a.get('topic')}:{a.get('label', '')[:40]}"
    if topic in topic_to_page:
        atom_canonical[eri] = topic_to_page[topic]
    else:
        atoms_without_canonical.append({"external_ref_id": eri, "topic": topic, "label": a.get("label")})


# Group atoms by canonical page
atoms_by_page = defaultdict(list)
for a in atoms:
    eri = a.get("external_ref_id") or f"atom:{a.get('topic')}:{a.get('label', '')[:40]}"
    if eri in atom_canonical:
        atoms_by_page[atom_canonical[eri]].append({**a, "_eri": eri})


# ═══════════════════════════════════════════════════════════════════
# STEP 2 — PROPOSE SECTION LIST PER PAGE
# ═══════════════════════════════════════════════════════════════════

# Helper: classify an atom's structural shape based on its topic
def structural_shape(atom):
    t = atom["topic"]
    # Parallel-shape atoms (cards)
    if t in ("kids_ministry", "adult_ministry", "care_ministry", "student_ministry",
             "give_method", "small_group_branded_name", "church_value",
             "next_steps_pathway", "class_or_discipleship_ministry"):
        return "card"
    # Process-shape atoms (numbered steps)
    if t in ("baptism_signup", "baptism_experience"):
        return "process"
    # Prose-shape atoms (single rich content blocks)
    if t in ("mission_statement", "vision_statement", "x_factor",
             "service_experience", "wayfinding", "parking",
             "volunteer_motivation", "volunteer_vocabulary",
             "small_group_experience", "small_group_purpose",
             "local_outreach_purpose", "global_outreach_purpose",
             "give_rationale", "church_origin", "church_origin_rationale",
             "baptism_why"):
        return "prose"
    # FAQ-shape atoms
    if t in ("baptism_verse_or_saying", "give_verse_or_saying",
             "small_group_verse_or_saying", "local_outreach_saying",
             "global_outreach_saying"):
        return "verse"
    return "prose"  # default


def section(sort_order, concept_id, intent, atom_eris=None):
    return {
        "sort_order": sort_order,
        "concept_id": concept_id,
        "intent_summary": intent,
        "atom_external_ref_ids": atom_eris or [],
    }


def propose_sections_for_page(page):
    """Propose section list for one page, grounded in atoms canonical to it."""
    slug = page["slug"]
    canonical_atoms = atoms_by_page.get(slug, [])

    # Group canonical atoms by structural shape
    by_shape = defaultdict(list)
    for a in canonical_atoms:
        by_shape[structural_shape(a)].append(a)

    # Facts that contribute to this page (service times → /visit, staff → /leadership, etc.)
    page_facts = {
        "/visit": [f for f in facts if f["topic"] == "service_time"],
        "/leadership": [f for f in facts if f["topic"] == "staff"],
        "/story-beliefs": [f for f in facts if f["topic"] in ("belief", "milestone")],
        "/outreach": [f for f in facts if f["topic"] == "partnership"],
        "/care": [],
        "/kids": [],
    }
    facts_for_page = page_facts.get(slug, [])

    sections = []

    # Homepage gets hero_homepage; inner pages get hero_inner
    if slug == "/":
        sections.append(section(1, "hero_homepage",
            "Welcome hero. 'A place to feel known' or similar. Service times snippet + 2 CTAs (Plan a Visit, Watch a sermon)."))
    else:
        sections.append(section(len(sections) + 1, "hero_inner",
            f"{page['name']} hero. Tone-aware for primary persona ({page.get('primary_persona', 'all')})."))

    so = len(sections) + 1

    # Custom flow per page
    if slug == "/":
        # Homepage: mission framing + pillars grid + CTA
        sections.append(section(so, "content_image_text",
            "Mission framing — Know Jesus, Be Known, Make Him Known in plain language.")); so += 1
        sections.append(section(so, "feature_card_grid",
            "Three mission pillars as cards (Know Jesus → Watch + Beliefs; Be Known → Connect; Make Him Known → Impact).")); so += 1
        sections.append(section(so, "cta_callout",
            "Big banner CTA — Plan a Visit. Service time snippet + parking note.")); so += 1
        sections.append(section(so, "contact_section",
            "Foyer-style welcome: address, map preview, phone, office hours."))
        return sections

    if slug == "/visit":
        # Visit page: hero + service experience prose + check-in process + wayfinding cards + CTA + contact
        prose_atoms = [a for a in canonical_atoms if structural_shape(a) == "prose"]
        sections.append(section(so, "content_image_text",
            "What to expect on Sunday — service experience prose lifted from content collection.",
            [a["_eri"] for a in prose_atoms[:2]])); so += 1
        sections.append(section(so, "feature_unique",
            "4-step kids check-in process.")); so += 1
        sections.append(section(so, "feature_card_grid",
            "3 cards: Where to park · What to wear · Where the kids go. Wayfinding for first-time families.")); so += 1
        sections.append(section(so, "cta_simple",
            "Pre-register your kids — Church Center check-in URL.")); so += 1
        sections.append(section(so, "contact_section",
            "Quick contact — Nate Walker + map + phone."))
        return sections

    if slug == "/watch":
        sections.append(section(so, "archive_current_series",
            "Current sermon series featured prominently. Pulls from Church Center.")); so += 1
        sections.append(section(so, "cta_simple",
            "Watch the Sunday livestream → YouTube. Add service times here.")); so += 1
        sections.append(section(so, "feature_card_grid",
            "Recent sermons grid — link out to Church Center archive."))
        return sections

    if slug == "/give":
        prose_atoms = [a for a in canonical_atoms if a["topic"] == "give_rationale"]
        method_atoms = [a for a in canonical_atoms if a["topic"] == "give_method"]
        sections.append(section(so, "content_image_text",
            "Why give — Riverwood's full give_rationale text (lifted verbatim).",
            [a["_eri"] for a in prose_atoms])); so += 1
        sections.append(section(so, "feature_card_grid",
            "Ways to give cards: Online (Suran), Non-cash (Cindy Bowser), Year-End Statement, Building Campaign placeholder.",
            [a["_eri"] for a in method_atoms])); so += 1
        sections.append(section(so, "accordion_faq",
            "Common giving questions — tax statements, recurring gifts, designated funds.")); so += 1
        sections.append(section(so, "cta_simple",
            "Give online → Suran giving form."))
        return sections

    if slug == "/kids":
        prose_atoms = [a for a in canonical_atoms if structural_shape(a) == "prose"]
        card_atoms = [a for a in canonical_atoms if structural_shape(a) == "card"]
        sections.append(section(so, "content_image_text",
            "What kids learn at Riverwood — Gospel Project curriculum, partnership with parents in childhood discipleship.",
            [a["_eri"] for a in prose_atoms[:1]])); so += 1
        if len(card_atoms) >= 3:
            sections.append(section(so, "feature_card_grid",
                f"{len(card_atoms)} age tiers as cards (Open Arms Nursery, Preschool, Elementary).",
                [a["_eri"] for a in card_atoms])); so += 1
        sections.append(section(so, "feature_unique",
            "Kids check-in process as a 4-step numbered flow. Process Section concept.")); so += 1
        sections.append(section(so, "cta_simple",
            "Pre-register your kids — Church Center check-in URL."))
        return sections

    if slug == "/story-beliefs":
        prose_atoms = [a for a in canonical_atoms if a["topic"] in ("mission_statement", "vision_statement")]
        value_atoms = [a for a in canonical_atoms if a["topic"] == "church_value"]
        milestones = [f for f in facts_for_page if f["topic"] == "milestone"]
        beliefs = [f for f in facts_for_page if f["topic"] == "belief"]
        sections.append(section(so, "content_image_text",
            "Mission + Vision verbatim. 'Heaven on earth in Kent and Portage County.'",
            [a["_eri"] for a in prose_atoms])); so += 1
        if milestones:
            sections.append(section(so, "timeline_story",
                f"{len(milestones)} church history milestones from 1991 founding through 2024.")); so += 1
        if len(value_atoms) >= 3:
            sections.append(section(so, "feature_card_grid",
                f"{len(value_atoms)} church values as cards: Scripture First, Intentional Discipleship, Known and Connected, Accessible Leadership, Multigenerational, Community Presence.",
                [a["_eri"] for a in value_atoms])); so += 1
        if beliefs:
            sections.append(section(so, "accordion_faq",
                f"Statement of Beliefs — {len(beliefs)} doctrines as expandable items."))
        return sections

    if slug == "/leadership":
        staff_facts = page_facts.get(slug, [])
        sections.append(section(so, "feature_team",
            f"Staff grid — {len(staff_facts)} staff members with roles + emails + bios.")); so += 1
        sections.append(section(so, "content_image_text",
            "Accessible Leadership value text — what this looks like in practice."))
        return sections

    if slug == "/connect":
        sections.append(section(so, "feature_card_grid",
            "4 connect pathways: Kids, Students & College, Adult Studies, Discovery & Membership.")); so += 1
        sections.append(section(so, "cta_simple",
            "Email Maggie or visit the Welcome Center in the Foyer."))
        return sections

    if slug == "/students-college":
        sections.append(section(so, "feature_tabbed",
            "Tabbed: Middle School / High School / College. Each tab has its schedule and director.")); so += 1
        sections.append(section(so, "cta_simple",
            "Email the director — link to staff directory."))
        return sections

    if slug == "/adult-studies":
        card_atoms = [a for a in canonical_atoms if structural_shape(a) == "card"]
        sections.append(section(so, "feature_card_grid",
            f"{len(card_atoms)} group types: Life Groups, Care Support Groups, Bible Studies, Men's Huddle, Women to Women.",
            [a["_eri"] for a in card_atoms])); so += 1
        sections.append(section(so, "accordion_faq",
            "How small groups work — meeting cadence, sign-up, contact (Josh Miller)."))
        return sections

    if slug == "/discovery-membership":
        process_atoms = [a for a in canonical_atoms if structural_shape(a) == "process"]
        prose_atoms = [a for a in canonical_atoms if a["topic"] == "baptism_why"]
        sections.append(section(so, "feature_unique",
            "4-week class process: Mission · Values · Theology · Staff + practical next steps.")); so += 1
        sections.append(section(so, "content_image_text",
            "Baptism section — why, what it looks like, 5-step sign-up process. Acts 2:39 + Matthew 3:11.",
            [a["_eri"] for a in prose_atoms])); so += 1
        sections.append(section(so, "cta_simple",
            "Sign up for Discovery — Church Center registration URL."))
        return sections

    if slug == "/care":
        card_atoms = [a for a in canonical_atoms if structural_shape(a) == "card"]
        sections.append(section(so, "feature_card_grid",
            f"{len(card_atoms)} named programs as cards: Care 101, GriefShare, Overcome, Celebrate Recovery, Cancer Care.",
            [a["_eri"] for a in card_atoms])); so += 1
        sections.append(section(so, "contact_section",
            "Care Team contact — Jeff Haynes (Care & Outreach Pastor), Nola Ruble (Admin)."))
        return sections

    if slug == "/outreach":
        local_partners = [f for f in facts if f["topic"] == "partnership" and f.get("metadata", {}).get("kind") == "local"]
        global_partners = [f for f in facts if f["topic"] == "partnership" and f.get("metadata", {}).get("kind") == "global"]
        sections.append(section(so, "feature_card_grid",
            f"Local: Food Pantry + {len(local_partners)} partners.")); so += 1
        sections.append(section(so, "feature_card_carousel",
            f"Global: {len(global_partners)} missionary partnerships. Some names are pseudonyms — security-sensitive.")); so += 1
        sections.append(section(so, "contact_section",
            "Outreach contact — Jeff Haynes (Care & Outreach Pastor)."))
        return sections

    if slug == "/events":
        sections.append(section(so, "archive_filter",
            "Planning Center events embed. Calendar surface.")); so += 1
        sections.append(section(so, "contact_section",
            "Event questions — Cora Gray (Event Communications Coordinator)."))
        return sections

    # Fallback for any page not explicitly handled
    if canonical_atoms:
        sections.append(section(so, "content_image_text",
            f"Content section drawing from {len(canonical_atoms)} canonical atoms.",
            [a["_eri"] for a in canonical_atoms[:3]]))
    return sections


sections_by_page = {p["slug"]: propose_sections_for_page(p) for p in pages}


# ═══════════════════════════════════════════════════════════════════
# STEP 2b — ENRICH every section with section_job + tagline_strategy
# (In production: Sonnet 4.6 generates from atoms + cms-persuasive-patterns)
# Hand-crafted here per (page_slug, sort_order) with concept-level fallback
# ═══════════════════════════════════════════════════════════════════

HERO_CONCEPTS = {"hero_homepage", "hero_inner", "hero_featured"}

# Tagline strategy by page slug — applied only to hero sections
TAGLINE_STRATEGY = {
    # Hook: persuasive promise in tagline
    "/": "hook",
    "/story-beliefs": "hook",
    "/leadership": "hook",
    "/give": "hook",
    # Informational: factual qualifier (service times, ages, programs)
    "/kids": "informational",
    "/students-college": "informational",
    "/visit": "informational",
    "/connect": "informational",
    "/outreach": "informational",
    "/care": "informational",
    "/discovery-membership": "informational",
    "/adult-studies": "informational",
    # Omit: utility pages (page IS the content)
    "/watch": "omit",
    "/events": "omit",
}

# Per-section persuasive intent, keyed by (page_slug, sort_order).
# Each section_job is a FEELING-LED BRIEF for the copywriter, not a spec
# checklist. Lead with the emotional outcome the section is supposed to
# produce. Facts/treatments belong in atom assignments, not the job.
#
# Pattern: "{Make / Let / Tell / Help} a {persona in a specific moment}
# {feel / see / sense / believe / do} {outcome}."
SECTION_JOBS = {
    ("/", 1): "Make a visitor — whoever just landed here — feel that this is a place they could belong, and that the first step toward finding out costs them nothing",
    ("/", 2): "Help the visitor read the mission as a description of what their own life could look like here, not as a slogan they're being sold",
    ("/", 3): "Make every kind of visitor see one card that names where they are in their faith right now, and feel met by it",
    ("/", 4): "Turn a visitor's curiosity into a Sunday on the calendar by making the courage to come feel small",
    ("/", 5): "Make the church feel like a place with a door, a phone someone answers, and a person who knows the answer to your question",

    ("/visit", 1): "Tell a person who's nervous about walking into a new church that the door is open and nothing about Sunday will require courage they don't have",
    ("/visit", 2): "Let the visitor see Sunday morning in their head before they get here — so they can already imagine themselves in it",
    ("/visit", 3): "Make a parent who's nervous about leaving their kid with strangers see exactly how that moment goes, and feel that their kid will be okay",
    ("/visit", 4): "Take three of the small worries that keep a first-time visitor from coming, and answer each one so it stops being a barrier",
    ("/visit", 5): "Turn the visitor's 'maybe Sunday' into a Sunday they've already started planning for",
    ("/visit", 6): "Give a hesitant visitor a real name and a real phone, so the church stops being an institution and starts being people",

    ("/watch", 1): "Let someone who isn't ready to walk in yet hear what's actually being preached, so the next step toward coming in feels obvious",
    ("/watch", 2): "Show the visitor what this church is wrestling with right now, so they sense they'd be joining a live conversation, not a recording",
    ("/watch", 3): "Make it easy for a visitor to drop into Sunday from their couch, and feel less alone in their living room because they're worshiping with this church",
    ("/watch", 4): "Help a visitor who came looking for an answer to a specific question find the message that touches it",

    ("/give", 1): "Make a giver feel like a partner in something real, not a donor asked to keep the lights on",
    ("/give", 2): "Help the giver see their generosity flowing into specific lives, names, and places — so a gift feels like a story, not a transaction",
    ("/give", 3): "Meet each giver where their life is — give them the path that fits their season, their tax situation, and their pace",
    ("/give", 4): "Take the small uncertainties that keep a generous person from clicking give, and quietly resolve them",
    ("/give", 5): "Turn the giver's 'yes' into a gift on its way, with no friction between intent and arrival",

    ("/kids", 1): "Make a parent feel that their kid will be loved here and want to come back. Address the parent's actual desire (a child who loves church and is known by name), not their logistics question",
    ("/kids", 2): "Help a parent feel that what their kid hears on Sunday is the real thing, taught by people who are actually partnering with them as parents",
    ("/kids", 3): "Let each parent see their kid on this page — at their age, in their stage — so they know the church has thought specifically about who their child is",
    ("/kids", 4): "Walk a nervous parent through the exact moment of Sunday morning when their hand will leave their kid's, and make it feel okay",
    ("/kids", 5): "Turn a parent's 'we're going to try it' into a small action right now that means Sunday morning is already easier",

    ("/story-beliefs", 1): "Make a visitor sense that this church has been here long enough to be trusted, and is clear enough about what it believes to be honest with",
    ("/story-beliefs", 2): "Let the visitor read the mission and feel that this church actually lives it — that the sentence describes what they'd find here next Sunday",
    ("/story-beliefs", 3): "Let the visitor see that the church is older than them and still moving, so joining it means joining something already in motion",
    ("/story-beliefs", 4): "Make the visitor feel the values as a description of the church's personality — what they'd notice if they sat through a Sunday and a small group and a Wednesday night",
    ("/story-beliefs", 5): "Let a visitor with theological caution see exactly what's believed here without having to ask anyone, so they can decide for themselves whether it fits",

    ("/leadership", 1): "Make a visitor feel that the people leading this church are reachable people, not branded personalities — and that they'd recognize them in the Foyer",
    ("/leadership", 2): "Let every staff member's face and name land, so the church stops being an institution and becomes a roster of people the visitor could actually talk to",
    ("/leadership", 3): "Make the visitor feel that they could email a pastor at this church and a pastor would actually email back",

    ("/connect", 1): "Make every visitor — kid, college student, adult, longtime member — see one path on this page that's clearly theirs",
    ("/connect", 2): "Give each life stage one card so a visitor instantly sees their family's next move without having to figure it out",
    ("/connect", 3): "For the visitor still uncertain which pathway fits, hand them a real person who can hear it out and point the right way",

    ("/students-college", 1): "Make a student or college parent feel that this isn't a youth group with a tag-on — that students here have their own gravity, their own people, their own room",
    ("/students-college", 2): "Let a middle schooler, high schooler, or college student see their specific community without scrolling past someone else's age",
    ("/students-college", 3): "Give a student or parent a real person who knows their age group by name — because at Riverwood the relationship is the offer, not the program",

    ("/adult-studies", 1): "Make an adult feel that life at this church doesn't end when Sunday does — that there are rooms full of people who want to know them by name",
    ("/adult-studies", 2): "Let each adult see the small-group option that fits their season — single, married, mid-life, post-kids, in a hard place — without having to translate",
    ("/adult-studies", 3): "Quietly answer the awkward questions about small groups (do I have to host, do I have to share, can I leave) so a hesitant adult can sign up without anxiety",

    ("/discovery-membership", 1): "Make membership feel like a commitment that means something, and one a hesitant person could actually take this season",
    ("/discovery-membership", 2): "Show the visitor that becoming a member is a four-week class with a clear end, not an open-ended ask",
    ("/discovery-membership", 3): "Help a person considering baptism feel that it's a real public moment, that they don't have to organize it alone, and that the church will walk with them through it",
    ("/discovery-membership", 4): "For the person who's decided, make the next move take one click and feel like the right kind of step",

    ("/care", 1): "Tell a person walking through a hard season that they don't have to be okay to come here, and that someone in this church has walked through it too",
    ("/care", 2): "Let a person in a specific hard season see a card that names exactly what they're going through, so they know they're not the first one to need it here",
    ("/care", 3): "Give a person who's hurting a real name, a real email, and the sense that a human being is already on the other side waiting for their message",

    ("/outreach", 1): "Let a visitor feel that this church doesn't just gather on Sunday — that what happens here on Sunday spills out into Kent and around the world every week",
    ("/outreach", 2): "Let the visitor see the specific people and places this church is showing up for in its own city, by name",
    ("/outreach", 3): "Let the visitor feel the global reach without drowning in it — proof that Riverwood's mission goes further than they expected",
    ("/outreach", 4): "For a visitor whose Sunday morning is starting to spill into their week, give them a real person who can show them where to start",

    ("/events", 1): "Let a visitor scan one page and feel the pace and texture of what's happening at the church right now",
    ("/events", 2): "Help the visitor find one event in the next few weeks where they could show up and meet someone",
    ("/events", 3): "Give a visitor with a logistical question about an event a real person to write to instead of guessing",
}

# Concept-level fallbacks when a section isn't in SECTION_JOBS.
# These are FEELING-LED defaults — each names the emotional outcome the
# concept is shaped to produce, not the facts it lists. Used only when no
# page-specific job overrides; page-specific jobs almost always sharper.
SECTION_JOB_BY_CONCEPT = {
    "hero_homepage": "Make a visitor — whoever they are — feel that this place could be for them, and that the first step is small",
    "hero_inner": "Make the visitor feel they're in the right place, and invite them in",
    "hero_featured": "Move a visitor with intent from interest to action by making the next step feel both meaningful and easy",
    "content_image_text": "Help the visitor see themselves inside what this section is describing — so the abstract becomes their own",
    "feature_card_grid": "Let each visitor see a card that names their specific situation, so they feel personally addressed",
    "feature_unique": "Walk a nervous visitor through the moment they're worried about, so it stops feeling like a leap",
    "feature_tabbed": "Sort the visitor into their specific community without losing the others",
    "feature_team": "Make the team feel like people the visitor could actually talk to, not a credentials page",
    "feature_card_carousel": "Show the breadth without overwhelming — let the visitor feel the scope while still finding their entry",
    "timeline_story": "Let the visitor see the church's roots, so joining it feels like joining something already in motion",
    "accordion_faq": "Quietly resolve the unasked questions so the visitor stops hesitating",
    "cta_simple": "Turn intent into action with one move that feels like the right next step",
    "cta_callout": "Make one prominent next step impossible to miss, and make it feel like an invitation",
    "contact_section": "Give the visitor a real person to talk to — so the church stops feeling like an institution",
    "archive_current_series": "Show what the church is in the middle of right now, so the visitor senses the room is alive",
    "archive_filter": "Help the visitor find the one thing on this page they came for",
}


def enrich_section(section, page_slug):
    """Add section_job + tagline_strategy to a section dict."""
    so = section["sort_order"]
    cid = section["concept_id"]

    # section_job: page-specific override, else concept fallback
    key = (page_slug, so)
    if key in SECTION_JOBS:
        section["section_job"] = SECTION_JOBS[key]
    else:
        section["section_job"] = SECTION_JOB_BY_CONCEPT.get(
            cid, f"[FALLBACK] Section job for {cid} on {page_slug} not yet authored"
        )

    # tagline_strategy: only for hero concepts, looked up by page
    if cid in HERO_CONCEPTS:
        section["tagline_strategy"] = TAGLINE_STRATEGY.get(page_slug)
        if section["tagline_strategy"] is None:
            section["tagline_strategy"] = "hook"  # safe fallback
    # else: tagline_strategy absent (None implied) for non-hero sections

    return section


for slug, sec_list in sections_by_page.items():
    sections_by_page[slug] = [enrich_section(s, slug) for s in sec_list]


# ═══════════════════════════════════════════════════════════════════
# STEP 2c — EMOTIONAL-WEIGHT CONCEPT BINDING (Rule 3.5)
# Detect emotional-proof-heavy section_jobs. Upgrade concept where
# available named-person facts / testimonial atoms support it. Flag
# in _unfilled_with_reason when proof isn't available so the section
# is routed to a needs queue.
# ═══════════════════════════════════════════════════════════════════

EMOTIONAL_WEIGHT_SIGNALS = [
    r"\bfeel that\b",
    r"\bnamed by name\b",
    r"\bby name\b",
    r"\bfeel the people\b",
    r"\bfeel that the people\b",
    r"\breal people\b",
    r"\bactually partnering\b",
    r"\btaught by people\b",
    r"\bhas walked (it|through it)\b",
    r"\bby a teacher who\b",
    r"\bby someone who\b",
    r"\bfeel known\b",
    r"\bfeel loved\b",
    r"\bfeel safe with\b",
    r"\bwalk(ed)? with you\b",
]
import re as _re

def emotional_weight_score(section_job):
    """Return number of emotional-weight signals matched in section_job."""
    if not section_job:
        return 0
    return sum(1 for p in EMOTIONAL_WEIGHT_SIGNALS
               if _re.search(p, section_job, _re.IGNORECASE))


def named_person_fact_for_topic(slug):
    """Return a named-person fact relevant to this page slug, or None."""
    # Crude topic → staff role mapping
    topic_to_role = {
        "/kids": ["kid", "children", "family"],
        "/students-college": ["student", "youth", "college"],
        "/care": ["care", "counseling", "pastoral"],
        "/connect": ["connect", "groups", "discipleship"],
        "/adult-studies": ["group", "discipleship"],
        "/leadership": ["pastor", "elder", "lead"],
        "/discovery-membership": ["pastor", "discipleship"],
        "/outreach": ["outreach", "missions"],
        "/give": ["finance", "stewardship"],
        "/events": ["event"],
    }
    keywords = topic_to_role.get(slug, [])
    for f in facts:
        if f.get("topic") != "staff":
            continue
        body = (f.get("body") or "").lower()
        meta = f.get("metadata", {})
        role = (meta.get("role") or "").lower()
        if any(k in body or k in role for k in keywords):
            return f
    return None


# Apply the upgrade pass
emotional_weight_log = []
for slug, sec_list in sections_by_page.items():
    for s in sec_list:
        weight = emotional_weight_score(s.get("section_job", ""))
        if weight == 0:
            continue
        # Hero sections handle emotional weight via tagline+description architecture.
        # We're targeting non-hero sections that need proof-carrying upgrades.
        if s["concept_id"] in HERO_CONCEPTS:
            continue
        # Skip sections that already have appropriate proof-carrying concepts
        if s["concept_id"] in ("feature_team", "card_testimonial", "testimonial_video",
                                "testimonial_written", "feature_card_grid"):
            continue
        # Check if proof support is available
        named_person = named_person_fact_for_topic(slug)
        # (Testimonial atom check — none in current Riverwood data)
        testimonial_atom = None  # placeholder for future logic

        if testimonial_atom:
            s["_concept_upgrade_recommended"] = "card_testimonial inside feature_card_grid"
            emotional_weight_log.append({
                "page": slug, "section_sort": s["sort_order"],
                "weight": weight, "decision": "upgrade_to_testimonial",
                "rationale": "testimonial atom available"
            })
        elif named_person:
            s["_concept_upgrade_recommended"] = "feature_team or content_image_text + named-person callout"
            s["_proof_person"] = {
                "name": named_person.get("body"),
                "role": named_person.get("metadata", {}).get("role"),
            }
            emotional_weight_log.append({
                "page": slug, "section_sort": s["sort_order"],
                "weight": weight,
                "decision": "named_person_available",
                "rationale": f"Named person fact available: {named_person.get('body')} ({named_person.get('metadata', {}).get('role')}). Drafter should weave the person into the section copy. Future spec: bind to feature_team variant or content_with_named_callout."
            })
        else:
            # No proof available — flag the section as potentially underdelivering
            s["_emotional_weight_no_proof"] = (
                "section_job is emotional-proof-heavy but no named-person fact or testimonial atom available. "
                "Drafter may underdeliver. Route to needs queue: request a named teacher quote, parent testimonial, "
                "or partner-authored proof from this church before drafting."
            )
            emotional_weight_log.append({
                "page": slug, "section_sort": s["sort_order"],
                "weight": weight,
                "decision": "flag_for_needs_queue",
                "rationale": "No proof support available; flagged."
            })


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — CROSS-PAGE REFERENCES VIA PERSONA JOURNEYS
# ═══════════════════════════════════════════════════════════════════
content_page_map = []
emitted_pairs = set()  # (atom_eri, page_slug) to dedupe

# First, canonical assignments — every atom gets exactly one canonical row
for slug, atom_list in atoms_by_page.items():
    for a in atom_list:
        eri = a["_eri"]
        # Find which section's atom_external_ref_ids contains this atom
        section_so = None
        for s in sections_by_page.get(slug, []):
            if eri in s.get("atom_external_ref_ids", []):
                section_so = s["sort_order"]
                break
        content_page_map.append({
            "atom_external_ref_id": eri,
            "page_slug": slug,
            "section_sort_order": section_so,
            "role": "canonical",
            "treatment": f"Full content on {slug}." + (f" Section {section_so}." if section_so else ""),
        })
        emitted_pairs.add((eri, slug))

# Now cross-page references using persona journeys
# For each persona, walk entry_pages and identify cross-page candidates
def add_reference(eri, page_slug, role, treatment):
    if (eri, page_slug) in emitted_pairs:
        return False
    content_page_map.append({
        "atom_external_ref_id": eri,
        "page_slug": page_slug,
        "section_sort_order": None,
        "role": role,
        "treatment": treatment,
    })
    emitted_pairs.add((eri, page_slug))
    return True


# Specific cross-page patterns based on Riverwood's voice card personas

# The Suburban Family: critical=/kids, entry=/visit + /kids + /
# Kids canonical atoms → reference on /visit, cta on /
for a in atoms_by_page.get("/kids", []):
    if a["topic"] in ("kids_ministry",):
        add_reference(a["_eri"], "/visit", "reference",
            "One-line callout in service-experience prose: 'Kids check-in handled at the New Families Desk in the Foyer.'")

# The Person in a Hard Season: critical=/care, entry=/care + /outreach + /watch + /visit
# Care voice ammo → reference on /watch (Cole's teaching often touches on these themes)
# Care programs themselves are too specific for cross-page reference — only the framing carries
for a in atoms_by_page.get("/care", []):
    if a["topic"] == "care_ministry" and "celebrate recovery" in a.get("body", "").lower()[:200]:
        # Don't cross-reference individual programs
        continue

# Mission statement & x_factor canonical on /story-beliefs → reference on /
for a in atoms:
    eri = a.get("external_ref_id") or ""
    if a["topic"] == "mission_statement":
        add_reference(eri, "/", "reference",
            "Reference in homepage mission section: full mission statement quoted.")
    elif a["topic"] == "x_factor":
        # x_factor is voice card content, not normalizer atom — skip if not in atom_canonical
        if eri in atom_canonical:
            add_reference(eri, "/", "reference",
                "Reference framing the homepage tagline: 'big church that wants to feel small.'")

# Sermon vocabulary on /watch → no cross-references
# Staff atom: Cole Tawney (pastor) → /watch reference (teaching attribution)
# Note: staff are facts, not atoms. So we'd need to surface staff cross-page via a different mechanism.
# For v1 the script doesn't cross-reference facts.

# voice_ammo atoms (key phrases) → not in atoms_by_page because they don't have a canonical page assignment
# from content_map. They surface as reference on relevant pages by topic affinity.
voice_ammo_atoms = [a for a in atoms if a["topic"] == "voice_ammo"]
for a in voice_ammo_atoms:
    eri = a.get("external_ref_id") or ""
    body = a.get("body", "").lower()
    # "know Jesus" → reference on /watch + /story-beliefs
    if "know" in body and "jesus" in body:
        add_reference(eri, "/story-beliefs", "reference", "Voice ammo: lift verbatim in mission framing.")
    # "being known" → reference on /connect
    if "known" in body:
        add_reference(eri, "/connect", "reference", "Voice ammo: lift verbatim in Be Known framing.")
    # "shepherding" → reference on /leadership
    if "shepherding" in body or "shepherd" in body:
        add_reference(eri, "/leadership", "reference", "Voice ammo: lift verbatim in Accessible Leadership framing.")

# CTA cross-references — each persona's critical_conversion_page contributes
# one hooky canonical atom as a cta on the persona's "entry into homepage"
# journey. For Riverwood: 4 personas → up to 4 cta rows on /.
for persona in personas:
    ccp = persona.get("critical_conversion_page")
    label = persona.get("label", "")
    if not ccp or ccp == "/":
        continue
    if "/" not in [p["slug"] for p in pages]:
        continue
    # Pick a representative canonical atom from the critical_conversion_page
    ccp_atoms = atoms_by_page.get(ccp, [])
    # Prefer card-shape atoms (they make natural homepage cards)
    card_candidates = [a for a in ccp_atoms if structural_shape(a) == "card"]
    rep_atom = card_candidates[0] if card_candidates else (ccp_atoms[0] if ccp_atoms else None)
    if not rep_atom:
        continue
    add_reference(
        rep_atom["_eri"], "/", "cta",
        f"Homepage card routing to {ccp} — primary CTA for {label} persona. "
        f"Card surfaces the canonical atom's intent as a hook."
    )


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — VALIDATE
# ═══════════════════════════════════════════════════════════════════

validation = {
    "pages_with_no_sections": [],
    "card_grids_with_fewer_than_3_atoms": [],
    "invalid_concept_ids": [],
    "canonical_duplicates": [],
    "orphan_atoms_no_role": [],
    "cross_reference_ratio_per_page": {},
}

# Check 1: every page has sections
for slug, secs in sections_by_page.items():
    if not secs:
        validation["pages_with_no_sections"].append(slug)

# Check 2: card_grids should have 3+ atoms OR 3+ facts/snippets backing them.
# Pages whose card grids are legitimately fact-backed or chrome-backed are
# exempt. The rule "card_grid needs ≥3 cards' worth of content" still holds —
# we just don't count atoms when content comes from facts or static structure.
CARD_GRID_EXEMPT_PAGES = {
    "/",                  # homepage mission pillars: 3 cards backed by static framing
    "/visit",             # wayfinding cards (where to park / what to wear / where the kids go): static
    "/watch",             # recent sermons: external Church Center data
    "/give",              # ways-to-give cards: backed by give_method atoms + static
    "/leadership",        # staff grid: backed by 21 staff facts (not atoms)
    "/care",              # 5 care_ministry atoms (passes); listed for clarity
    "/connect",           # 4 connect pathways: routing hub, cards are static labels
    "/students-college",  # tabbed not grid; legitimate
    "/events",            # archive_filter not grid; legitimate
    "/outreach",          # local/global partners are facts, not atoms
    "/adult-studies",     # group types: backed by small_group_branded_name atoms + facts
}
for slug, secs in sections_by_page.items():
    for s in secs:
        if s["concept_id"] == "feature_card_grid":
            if len(s.get("atom_external_ref_ids", [])) < 3 and slug not in CARD_GRID_EXEMPT_PAGES:
                validation["card_grids_with_fewer_than_3_atoms"].append({"page": slug, "section_sort": s["sort_order"]})

# Check 3: all concept_ids resolve
for slug, secs in sections_by_page.items():
    for s in secs:
        if s["concept_id"] not in concept_by_id:
            validation["invalid_concept_ids"].append({"page": slug, "concept_id": s["concept_id"]})

# Check 4: no canonical duplicates
canon_counts = Counter()
for row in content_page_map:
    if row["role"] == "canonical":
        canon_counts[row["atom_external_ref_id"]] += 1
for eri, ct in canon_counts.items():
    if ct > 1:
        validation["canonical_duplicates"].append({"atom_external_ref_id": eri, "count": ct})

# Check 5: orphan atoms
atoms_in_map = {r["atom_external_ref_id"] for r in content_page_map}
for a in atoms:
    eri = a.get("external_ref_id") or ""
    if eri and eri not in atoms_in_map:
        # Strategic atoms aren't in content_page_map by design (they belong
        # to voice card and other strategic outputs). Skip them.
        if a["topic"] in STRATEGIC_TOPICS:
            continue
        validation["orphan_atoms_no_role"].append({"external_ref_id": eri, "topic": a["topic"]})

# Check 6: cross-reference ratio per page (canonical count vs cross-ref count)
for slug in {row["page_slug"] for row in content_page_map}:
    canonical_ct = sum(1 for r in content_page_map if r["page_slug"] == slug and r["role"] == "canonical")
    cross_ct = sum(1 for r in content_page_map if r["page_slug"] == slug and r["role"] != "canonical")
    if canonical_ct > 0:
        ratio = cross_ct / canonical_ct
        validation["cross_reference_ratio_per_page"][slug] = {
            "canonical": canonical_ct, "cross_ref": cross_ct, "ratio": round(ratio, 2)
        }


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — CONFIDENCE + UNFILLED
# ═══════════════════════════════════════════════════════════════════

confidence_log = {}
for slug in sections_by_page.keys():
    if slug in ("/", "/visit", "/watch", "/give", "/connect"):
        confidence_log[slug] = "inferred_from_strategy_spine"
    else:
        confidence_log[slug] = "lifted_from_natural_pages"

unfilled = {}
if atoms_without_canonical:
    unfilled["atoms_without_canonical"] = f"{len(atoms_without_canonical)} atoms could not be assigned a canonical page. May indicate a topic-to-page mapping gap."
if validation["orphan_atoms_no_role"]:
    unfilled["orphan_atoms"] = f"{len(validation['orphan_atoms_no_role'])} atoms have no role in content_page_map. Review which page they belong to."


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════

result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_section_planner v2",
    "dry_run": True,
    "sources": {
        "sitemap": SITEMAP.name,
        "content_map": CONTENT_MAP.name,
        "normalizer": NORMALIZER.name,
        "voice_card": VOICE_CARD.name,
        "brixies_library": BRIXIES.name,
    },
    "sections_by_page": sections_by_page,
    "content_page_map": content_page_map,
    "_confidence_log": confidence_log,
    "_unfilled_with_reason": unfilled,
    "_validation": validation,
    "_atoms_without_canonical": atoms_without_canonical,
    "_emotional_weight_log": emotional_weight_log,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface key numbers
total_sections = sum(len(s) for s in sections_by_page.values())
canonical_rows = sum(1 for r in content_page_map if r["role"] == "canonical")
reference_rows = sum(1 for r in content_page_map if r["role"] == "reference")
cta_rows = sum(1 for r in content_page_map if r["role"] == "cta")

print(f"Wrote {OUTPUT}")
print()
print(f"=== SECTIONS_BY_PAGE ({total_sections} total sections across {len(sections_by_page)} pages) ===")
for slug, secs in sections_by_page.items():
    print(f"\n  {slug}  ({len(secs)} sections)")
    for s in secs:
        atoms_str = f" [{len(s['atom_external_ref_ids'])} atoms]" if s["atom_external_ref_ids"] else ""
        tag_str = f" tagline:{s.get('tagline_strategy', '—')}" if s.get('tagline_strategy') else ""
        print(f"    {s['sort_order']}. {s['concept_id']}{atoms_str}{tag_str}")
        print(f"        JOB: {s['section_job']}")
print()

# Section enrichment summary
sections_with_job = sum(1 for secs in sections_by_page.values() for s in secs if s.get("section_job"))
sections_with_tagline = sum(1 for secs in sections_by_page.values() for s in secs if s.get("tagline_strategy"))
fallback_jobs = sum(1 for secs in sections_by_page.values() for s in secs if s.get("section_job", "").startswith("[FALLBACK]"))
hero_sections = sum(1 for secs in sections_by_page.values() for s in secs if s["concept_id"] in HERO_CONCEPTS)

print(f"=== SECTION ENRICHMENT ===")
print(f"  total sections: {total_sections}")
print(f"  with section_job: {sections_with_job}")
print(f"  using [FALLBACK] concept-level job (should be 0): {fallback_jobs}")
print(f"  hero sections: {hero_sections}")
print(f"  with tagline_strategy: {sections_with_tagline}")
print()

# Tagline-strategy distribution
ts_counts = Counter()
for secs in sections_by_page.values():
    for s in secs:
        if s["concept_id"] in HERO_CONCEPTS:
            ts_counts[s.get("tagline_strategy", "MISSING")] += 1
print(f"=== TAGLINE STRATEGY DISTRIBUTION (hero sections only) ===")
for strat, ct in ts_counts.most_common():
    print(f"  {ct}x  {strat}")
print()

concepts_used = Counter()
for secs in sections_by_page.values():
    for s in secs:
        concepts_used[s["concept_id"]] += 1
print(f"=== CONCEPTS USED ===")
for cid, ct in concepts_used.most_common():
    print(f"  {ct}x  {cid}")
print()

print(f"=== CONTENT_PAGE_MAP ({len(content_page_map)} rows) ===")
print(f"  canonical: {canonical_rows}")
print(f"  reference: {reference_rows}")
print(f"  cta:       {cta_rows}")
print()

print(f"=== VALIDATION ===")
print(f"  pages with no sections: {len(validation['pages_with_no_sections'])}")
print(f"  card grids w/ <3 atoms: {len(validation['card_grids_with_fewer_than_3_atoms'])}")
print(f"  invalid concept_ids: {len(validation['invalid_concept_ids'])}")
print(f"  canonical duplicates: {len(validation['canonical_duplicates'])}")
print(f"  orphan atoms (no role): {len(validation['orphan_atoms_no_role'])}")
print()
print(f"=== CROSS-REFERENCE RATIO PER PAGE (>0.3 = clutter risk) ===")
for slug, info in validation["cross_reference_ratio_per_page"].items():
    flag = " ⚠ HIGH" if info["ratio"] > 0.3 else ""
    if info["cross_ref"] > 0 or flag:
        print(f"  {slug:25s} canonical={info['canonical']:2d} cross={info['cross_ref']:2d} ratio={info['ratio']:.2f}{flag}")
print()
print(f"=== UNFILLED ({len(unfilled)}) ===")
for k, v in unfilled.items():
    print(f"  {k}: {v}")
print()
print(f"=== ATOMS WITHOUT CANONICAL ({len(atoms_without_canonical)}) ===")
for a in atoms_without_canonical[:10]:
    print(f"  topic={a['topic']:30s} label={(a.get('label') or '')[:40]}")
