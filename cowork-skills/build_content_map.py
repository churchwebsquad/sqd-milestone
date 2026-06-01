#!/usr/bin/env python3
"""
Pressure test: web-content-map-builder skill executed against Riverwood.

Implements the 5-step workflow:
  1. Count atoms + facts by topic
  2. Score density per group (sitemap-strategy.md §4)
  3. Propose natural pages (no strategic-mandate pages)
  4. Flag standard consolidation candidates (sitemap-strategy.md §3)
  5. Tag confidence + absences

Output: content-density map JSON, no Supabase writes.
"""
import json
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-content-map-dry-run.json")

with open(NORMALIZER) as f:
    intake = json.load(f)
with open(VOICE_CARD) as f:
    vc_dump = json.load(f)

atoms = intake["atoms"]
facts = intake["facts"]

# Strategic topics belong to voice_card, not content_map
STRATEGIC_TOPICS = {
    "persona", "tone_descriptor", "tone_block",
    "mission_statement", "vision_statement", "x_factor",
    "denominational_signal", "voice_rule", "theological_capitalization",
    "branded_term", "banned_term", "anti_model",
    "strategic_priority", "website_goal",
    "page_primacy_mapping", "recommended_page",
    "design_reference", "am_note", "current_keyword",
    "voice_ammo",  # voice card pulls from these
}

# Content atoms — filter out strategic ones
content_atoms = [a for a in atoms if a["topic"] not in STRATEGIC_TOPICS]

# Some atoms are story/value content that lives on /story-beliefs but isn't a
# distinct natural page on its own — like church_value, ideal_experience,
# community_struggle, engagement_lever. These contribute to /story-beliefs
# density but aren't standalone pages.
STORY_BELIEFS_CONTRIBUTORS = {
    "church_value", "church_origin", "church_origin_rationale",
    "ideal_experience", "community_struggle", "engagement_lever",
    "tagline",
}

# Sermon-related atoms (low standalone density on /watch which is mostly external links)
WATCH_CONTRIBUTORS = {
    "sermon_vocabulary", "sermon_archive_url", "livestream_url",
    "sermon_note", "sermon_archive_location",
}

# Service-experience atoms feed /visit (strategic-mandate, sitemap adds it)
VISIT_CONTRIBUTORS = {
    "service_experience", "wayfinding", "parking", "campus_service_experience",
    "office_hours", "newsletter_contents", "newsletter_platform",
    "bulletin_contents", "social_media_handle",
}

# Give-related atoms feed /give (strategic-mandate)
GIVE_CONTRIBUTORS = {
    "give_rationale", "give_method", "give_verse_or_saying",
    "give_note", "giving_campaign",
}

# Volunteer / connect-related atoms feed /connect (strategic hub)
CONNECT_CONTRIBUTORS = {
    "volunteer_motivation", "volunteer_vocabulary", "volunteer_note",
}

# Strategic-mandate pages — content_map does NOT propose these
STRATEGIC_MANDATE_SLUGS = {"/", "/visit", "/watch", "/give", "/connect"}


# ═══════════════════════════════════════════════════════════════════
# STEP 1 — COUNT ATOMS + FACTS BY TOPIC
# ═══════════════════════════════════════════════════════════════════

def topic_key(item):
    """Compute the topic key — use subtopic when it materially distinguishes
    content groupings (e.g., partnership/local vs partnership/global)."""
    t = item["topic"]
    st = item.get("subtopic")
    if t == "partnership" and st in ("local", "global"):
        return f"{t}_{st}"
    if t == "ministry" and st in ("local_outreach", "global_outreach"):
        return f"ministry_{st}"
    if t == "other":
        # Don't bucket all "other" into one — use subtopic
        return f"other_{st}" if st else "other"
    return t


topic_atoms = defaultdict(list)
topic_facts = defaultdict(list)
for a in content_atoms:
    topic_atoms[topic_key(a)].append(a)
for f_ in facts:
    topic_facts[topic_key(f_)].append(f_)


# ═══════════════════════════════════════════════════════════════════
# STEP 2 — SCORE DENSITY PER GROUP
# ═══════════════════════════════════════════════════════════════════

def score_density(atom_count, fact_count, topic):
    total = atom_count + fact_count
    # Adjust thresholds for fact-heavy topics where each fact is short (staff names, milestones, beliefs)
    fact_heavy = topic in ("staff", "milestone", "belief", "partnership_local", "partnership_global", "service_time")
    if fact_heavy:
        if total >= 5: return "high"
        if total >= 2: return "medium"
        return "low"
    # Atom-heavy: a few rich atoms is enough for a page
    if total >= 5: return "high"
    if total >= 2: return "medium"
    return "low"


topic_density = {}
for k in set(list(topic_atoms.keys()) + list(topic_facts.keys())):
    ac = len(topic_atoms[k])
    fc = len(topic_facts[k])
    topic_density[k] = {
        "atom_count": ac,
        "fact_count": fc,
        "total": ac + fc,
        "density_score": score_density(ac, fc, k),
    }


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — PROPOSE NATURAL PAGES
# ═══════════════════════════════════════════════════════════════════

natural_pages = []

# Define the mapping from topic groupings to natural pages.
# Each entry: (proposed_slug, proposed_name, topic_grouping_list, rationale_template)
PAGE_PROPOSALS = [
    ("/kids", "Kids", ["kids_ministry"],
     "Distinct audience (parents with children). Named kids ministries with curriculum + check-in process."),
    ("/students-college", "Students & College", ["student_ministry", "small_group_branded_name"],
     "Distinct audience (Kent State students + middle/high schoolers). Multiple ministry tiers."),
    ("/care", "Care & Recovery", ["care_ministry"],
     "Named recovery and care programs. Audience-distinct (people in crisis)."),
    ("/adult-studies", "Adult Studies & Classes", ["adult_ministry", "small_group_experience", "small_group_purpose",
                                                    "small_group_verse_or_saying", "small_group_leader_signup",
                                                    "small_group_contact", "next_steps_pathway",
                                                    "class_or_discipleship_ministry"],
     "Adult discipleship — Life Groups + Bible Studies + named classes (Men's Huddle, Women to Women)."),
    ("/local-outreach", "Local Outreach", ["local_outreach_purpose", "local_outreach_saying",
                                            "ministry_local_outreach", "partnership_local",
                                            "ministry_branded_name"],
     "Local ministry partners + Food Pantry. Make Him Known mission pillar — local expression."),
    ("/global-outreach", "Global Outreach", ["global_outreach_purpose", "global_outreach_saying",
                                              "partnership_global"],
     "10 missionary partnerships across regions. Make Him Known mission pillar — global expression."),
    ("/leadership", "Leadership Team", ["staff"],
     "21 staff members with roles, emails, bios. Accessible Leadership value."),
    ("/discovery-membership", "Discovery & Membership", ["baptism_why", "baptism_experience",
                                                          "baptism_signup", "baptism_verse_or_saying"],
     "Discovery class is the assimilation pathway; Baptism is integrated. Single named class flow."),
    ("/story-beliefs", "Our Story & Beliefs", ["church_origin", "church_origin_rationale",
                                                "church_value", "belief", "milestone",
                                                "ideal_experience"],
     "Theological substance (8 doctrines) + church history (9 milestones) + values + origin story. Trust-building page."),
    ("/events", "Events", ["other_how_would_you_like_to_display_events_on_your_website"],
     "Events display via external embed (Planning Center). Page exists for calendar surface."),
]

for slug, name, topics, rationale in PAGE_PROPOSALS:
    atom_count = sum(len(topic_atoms.get(t, [])) for t in topics)
    fact_count = sum(len(topic_facts.get(t, [])) for t in topics)
    if atom_count + fact_count == 0:
        continue  # no content — skip
    density = score_density(atom_count, fact_count, topics[0] if topics else "")
    if density == "low":
        # Low-density natural pages should be flagged as consolidation candidates, not proposed
        continue
    natural_pages.append({
        "proposed_slug": slug,
        "proposed_name": name,
        "topic_grouping": topics,
        "density_score": density,
        "atom_count": atom_count,
        "fact_count": fact_count,
        "rationale": rationale,
    })


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — FLAG STANDARD CONSOLIDATION CANDIDATES
# ═══════════════════════════════════════════════════════════════════

consolidation_candidates = []

# Local + Global outreach merge
proposed_slugs = {p["proposed_slug"] for p in natural_pages}
if "/local-outreach" in proposed_slugs and "/global-outreach" in proposed_slugs:
    local_total = next(p["atom_count"] + p["fact_count"] for p in natural_pages if p["proposed_slug"] == "/local-outreach")
    global_total = next(p["atom_count"] + p["fact_count"] for p in natural_pages if p["proposed_slug"] == "/global-outreach")
    consolidation_candidates.append({
        "type": "merge",
        "candidates": ["/local-outreach", "/global-outreach"],
        "into": "/outreach",
        "reason": f"Both serve the Make Him Known mission pillar. Combined density ({local_total + global_total} atoms+facts) supports a single page with distinct local + global sections. Standard consolidation.",
        "rule_source": "sitemap-strategy §3 standard consolidation",
    })

# Baptism atoms absorb into Discovery & Membership
baptism_topics = ["baptism_why", "baptism_experience", "baptism_signup", "baptism_verse_or_saying"]
baptism_count = sum(len(topic_atoms.get(t, [])) + len(topic_facts.get(t, [])) for t in baptism_topics)
if baptism_count > 0:
    consolidation_candidates.append({
        "type": "absorb",
        "candidates": baptism_topics,
        "into": "/discovery-membership",
        "reason": "Baptism atoms (why, experience, signup, scripture) integrate with the Discovery & Membership assimilation pathway. Standard consolidation.",
        "rule_source": "sitemap-strategy §3 standard consolidation",
    })

# Membership consolidation (if there's membership-related content)
membership_atoms = [a for a in content_atoms if "member" in a.get("body", "").lower()[:200] or "membership" in a.get("label", "").lower()]
if membership_atoms:
    consolidation_candidates.append({
        "type": "absorb",
        "candidates": ["membership"],
        "into": "/discovery-membership",
        "reason": "Membership is the optional 5th-week add-on to the Discovery class per content collection. Single assimilation pathway.",
        "rule_source": "sitemap-strategy §3 standard consolidation",
    })


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — CONFIDENCE + ABSENCES
# ═══════════════════════════════════════════════════════════════════

atom_to_topic_group = {}
for k, atom_list in topic_atoms.items():
    for a in atom_list:
        atom_to_topic_group[a["external_ref_id"] or a.get("topic", "unknown")] = k

# Group atoms by what natural page their topic feeds
for p in natural_pages:
    p["atom_external_ref_ids"] = []
    for t in p["topic_grouping"]:
        for a in topic_atoms.get(t, []):
            if a.get("external_ref_id"):
                p["atom_external_ref_ids"].append(a["external_ref_id"])

confidence_log = {}
for p in natural_pages:
    confidence_log[p["proposed_slug"]] = "lifted_from_normalizer"

# Absence checks — content map flags missing-but-expected content
unfilled = {}
if "staff" not in topic_facts or len(topic_facts.get("staff", [])) == 0:
    unfilled["staff"] = "No staff facts found. /leadership cannot ship without them. Likely a missing intake source — verify Staff & Board CSV was supplied."
if "service_time" not in topic_facts or len(topic_facts.get("service_time", [])) == 0:
    unfilled["service_time"] = "No service time facts found. /visit page will lack critical info."
if "kids_ministry" not in topic_atoms or len(topic_atoms.get("kids_ministry", [])) == 0:
    unfilled["kids_ministry"] = "No kids_ministry atoms found. If church has kids ministry, intake extraction missed it. Consider whether Phase 1 should still include /kids."


# Surface content that wasn't placed anywhere (audit)
all_placed_topics = set()
for p in natural_pages:
    all_placed_topics.update(p["topic_grouping"])
# Also count the strategic-mandate-page contributors as placed (sitemap adds those pages)
all_placed_topics.update(VISIT_CONTRIBUTORS)
all_placed_topics.update(WATCH_CONTRIBUTORS)
all_placed_topics.update(GIVE_CONTRIBUTORS)
all_placed_topics.update(CONNECT_CONTRIBUTORS)
all_placed_topics.update(STORY_BELIEFS_CONTRIBUTORS)
# Strategic-mandate contributors
all_placed_topics.update({
    "tagline",  # used in headers/heroes
    "mission_statement", "vision_statement",  # part of story-beliefs (already in STORY_BELIEFS_CONTRIBUTORS)
})

orphans = []
for k, items in {**topic_atoms, **topic_facts}.items():
    if k not in all_placed_topics:
        if k in ("branded_term", "tagline"):  # branded_term is global merge field, tagline is reused
            continue
        # Check if its content was placed under a natural page
        placed_in_natural = any(k in p["topic_grouping"] for p in natural_pages)
        if not placed_in_natural:
            orphans.append({"topic": k, "atom_count": len(topic_atoms.get(k, [])), "fact_count": len(topic_facts.get(k, []))})

if orphans:
    unfilled["orphan_topics"] = f"{len(orphans)} topics with content not placed in a natural page or strategic-mandate page contributor list. Sitemap_builder should review."


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════
result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_content_map_builder v1",
    "dry_run": True,
    "source_normalizer": NORMALIZER.name,
    "topic_density": dict(sorted(topic_density.items(), key=lambda kv: -kv[1]["total"])),
    "natural_pages": natural_pages,
    "consolidation_candidates": consolidation_candidates,
    "strategic_mandate_contributors": {
        "/visit_contributors": sorted(VISIT_CONTRIBUTORS),
        "/watch_contributors": sorted(WATCH_CONTRIBUTORS),
        "/give_contributors": sorted(GIVE_CONTRIBUTORS),
        "/connect_contributors": sorted(CONNECT_CONTRIBUTORS),
        "/story-beliefs_contributors": sorted(STORY_BELIEFS_CONTRIBUTORS),
    },
    "atom_to_topic_group": atom_to_topic_group,
    "_confidence_log": confidence_log,
    "_unfilled_with_reason": unfilled,
    "_orphan_topics": orphans,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface key numbers
print(f"Wrote {OUTPUT}")
print()
print("=== TOPIC DENSITY (top 20) ===")
for k, v in list(result["topic_density"].items())[:20]:
    print(f"  {v['density_score']:6s} {v['total']:3d}  {k}")
print()
print(f"=== NATURAL PAGES PROPOSED ({len(natural_pages)}) ===")
for p in natural_pages:
    print(f"  {p['density_score']:6s} {p['proposed_slug']:25s} {p['proposed_name']:25s} atoms={p['atom_count']:2d} facts={p['fact_count']:2d}")
print()
print(f"=== CONSOLIDATION CANDIDATES ({len(consolidation_candidates)}) ===")
for c in consolidation_candidates:
    print(f"  [{c['type']}] {c['candidates']} → {c.get('into', '(no target)')}")
print()
print(f"=== ABSENCES ({len(unfilled)}) ===")
for k, v in unfilled.items():
    print(f"  {k}: {v[:120]}")
print()
print(f"Orphan topics: {len(orphans)}")
for o in orphans[:10]:
    print(f"  {o}")
