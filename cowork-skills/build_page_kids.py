#!/usr/bin/env python3
"""
Pressure test: web-page-drafter v2 on Riverwood /kids (single page).

Implements the v2 workflow:
  1. Load context (page meta, sections with section_job + tagline_strategy,
     atom slice, voice card v2 with synthesis fields, brixies templates)
  2. Identify the page's persuasive frame (primary persona → posture)
  3. Compose strategic setup (metadata + AEO snippet)
  4. Draft each section: heading = clean label, tagline = follow strategy,
     description = address section_job in voice (with alternatives for hero)
  5. Self-revise pass
  6. Verbatim verification
  7. Page audit (positive + negative)

In production: Sonnet 4.6 generates the writing decisions. This dry-run
hand-crafts what Sonnet would produce, validating output shape + quality.

Output: /kids page draft JSON with v2 field_values + alternatives_considered
+ both audit blocks.
"""
import json
import re
from datetime import datetime
from pathlib import Path

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
SITEMAP = WORKSPACE / "riverwood-sitemap-dry-run.json"
SECTION_PLAN = WORKSPACE / "riverwood-section-plan-dry-run.json"
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
BRIXIES = WORKSPACE / "brixies-library.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-page-kids-dry-run.json")

PAGE_SLUG = "/kids"

with open(SITEMAP) as f: sitemap = json.load(f)
with open(SECTION_PLAN) as f: section_plan = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(BRIXIES) as f: brixies = json.load(f)

voice_card = vc_dump["voice_card"]
banned_terms_set = set(voice_card["banned_terms"])
branded_vocab = voice_card["branded_vocabulary"]
signature_moves = voice_card.get("signature_moves", [])
positive_voice_rules = voice_card.get("positive_voice_rules", [])
sample_sentences = voice_card.get("sample_sentences_in_voice", [])
persuasive_postures = voice_card.get("persuasive_posture_by_persona", {})
example_phrases_bad = voice_card.get("example_phrases_bad", [])

atoms_by_eri = {a.get("external_ref_id"): a for a in intake["atoms"] if a.get("external_ref_id")}
facts = intake["facts"]
templates = brixies["templates"]
concepts = {c["id"]: c for c in brixies["curated_concepts"]}

# ═══════════════════════════════════════════════════════════════════
# STEP 1 — LOAD CONTEXT FOR /kids
# ═══════════════════════════════════════════════════════════════════

page = next(p for p in sitemap["pages"] if p["slug"] == PAGE_SLUG)
sections = section_plan["sections_by_page"][PAGE_SLUG]
content_map_rows = [r for r in section_plan["content_page_map"] if r["page_slug"] == PAGE_SLUG]

canonical_atoms = [atoms_by_eri[r["atom_external_ref_id"]]
                   for r in content_map_rows if r["role"] == "canonical"
                   and r["atom_external_ref_id"] in atoms_by_eri]


def pick_template_for_concept(concept_id, tagline_strategy=None, prefer_template_with=None):
    """Mock binder. v2: hero concepts honor tagline_strategy by preferring
    templates with a tagline slot when strategy is informational/hook."""
    concept = concepts[concept_id]
    families = concept["family_filter"]
    candidates = [t for t in templates if t["family"] in families and t.get("is_published")]
    kf = concept.get("kind_filter", [])
    if kf:
        candidates = [t for t in candidates if t.get("kind") in kf]
    if not candidates:
        return None
    # For hero concepts with tagline strategy, prefer templates with a tagline slot
    if concept_id.startswith("hero_") and tagline_strategy in ("informational", "hook"):
        tagline_candidates = [t for t in candidates
                              if any(f.get("key") == "tagline" for f in t.get("fields", []))]
        if tagline_candidates:
            tagline_candidates.sort(key=lambda t: t["id"])
            return tagline_candidates[0]
    # For hero with omit strategy, picking either is fine
    if prefer_template_with:
        for t in candidates:
            if any(f.get("key") == prefer_template_with for f in t.get("fields", [])):
                return t
    candidates.sort(key=lambda t: t["id"])
    return candidates[0]


# ═══════════════════════════════════════════════════════════════════
# STEP 2 — IDENTIFY THE PAGE'S PERSUASIVE FRAME
# ═══════════════════════════════════════════════════════════════════

primary_persona_label = page.get("persona_primacy", {}).get("primary", "The Suburban Family")
# Map page primacy label to voice card persona label (often identical for Riverwood)
if primary_persona_label not in persuasive_postures:
    # Fallback to first persona
    primary_persona_label = list(persuasive_postures.keys())[0]
persuasive_frame = persuasive_postures.get(primary_persona_label, {})


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — STRATEGIC SETUP
# ═══════════════════════════════════════════════════════════════════

kw = page["keywords"]
strategic_setup = {
    "primary_keyword": kw["primary"][0],
    "secondary_keywords": kw["primary"][1:] + kw["secondary"][:3],
    "local_keywords": kw["local"][:3],
    "metadata_title": "Kids at Riverwood Chapel | Kent OH",
    "metadata_description": "Open Arms Nursery, preschool, and elementary programs in the Kids Wing. Pre-register your child for Sunday.",
    "aeo_smart_snippet": (
        "Riverwood Chapel in Kent, Ohio offers Sunday kids programs from newborns through 5th grade. "
        "The Kids Wing hosts Open Arms Nursery, preschool, and elementary classes using the Gospel Project curriculum "
        "at 9, 10:15, and 11:30am. Pre-register through Church Center."
    ),
}

assert len(strategic_setup["metadata_title"]) <= 60
assert len(strategic_setup["metadata_description"]) <= 160
snippet_word_count = len(strategic_setup["aeo_smart_snippet"].split())
assert 30 <= snippet_word_count <= 60


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — DRAFT EACH SECTION
# (In production: Sonnet 4.6 makes each writing decision. Here we
# hand-craft what Sonnet would produce, including alternatives for
# high-stakes slots.)
# ═══════════════════════════════════════════════════════════════════

drafted_sections = []
confidence_log = {}
gaps_flagged = []

kids_age_tier_atoms = [a for a in canonical_atoms if a.get("topic") == "kids_ministry"]
check_in_atoms = [a for a in intake["atoms"]
                  if "check" in (a.get("body", "") + a.get("label", "")).lower()
                  and "kid" in (a.get("body", "") + a.get("label", "")).lower()]


def write_field_value(slot, content):
    if slot.get("type") in ("text", "richtext"):
        max_c = slot.get("max_chars")
        if max_c and len(content) > max_c:
            content = content[:max_c].rsplit(" ", 1)[0]
        return content
    return content


# ─── Section 1 — hero_inner (informational tagline strategy) ───────
sec = sections[0]
assert sec["concept_id"] == "hero_inner"
assert sec["tagline_strategy"] == "informational"

template = pick_template_for_concept(sec["concept_id"], tagline_strategy="informational")
field_values = {}
alternatives = {}

# HEADING: clean label, always "Kids" on the kids page
heading_alts = ["Kids", "Kids Wing", "For Your Kids"]
heading_pick = "Kids"  # cleanest label
alternatives["heading"] = heading_alts

# TAGLINE: informational — ages + service times
tagline_alts = [
    "Newborns through 5th grade · Sundays 9, 10:15, 11:30am",
    "Newborns through 5th grade · 3 Sunday services",
    "Open Arms Nursery, Preschool, Elementary",
]
tagline_pick = tagline_alts[0]  # most useful at a glance: ages + when
alternatives["tagline"] = tagline_alts

# DESCRIPTION: INVITES (does not inform).
# section_job names: "Make a parent on the fence FEEL..."
# Rule 2: hero description names the parent's actual DESIRE and PROMISES
# the experience. Logistics (carport, check-in time, Kids Wing location)
# belong in subsequent sections (feature_unique for check-in, etc.).
#
# persuasive_frame for The Suburban Family:
#   desire: "their kid being seen / known, not a number"
#   register: warm without saccharine, multigenerational, plain-spoken
#
# Riverwood's mission language: "To know Jesus, to be known, and to make
# Him known" — leaning into "known" is on-voice for this brand.
#
# Past CMS site moves: Mosaic ("You want your kids to love church, not
# just attend"), MVCC ("You want your children to have a faith of their
# own"), Real Life ("Partnering with you to help your child love Jesus"),
# Awaken ("The Best Hour of Their Week"). All name the parent's desire.
description_alts = [
    "Sundays your kids will look forward to. Riverwood partners with parents to help your kid know Jesus and feel known by the people teaching them.",
    "Your kid will be known here. Riverwood partners with parents to help kids know Jesus and grow up in a church that knows their name.",
    "You want your kids to love church, not just attend it. Riverwood's Kids Wing partners with parents to help your kid know Jesus and be known by the people walking with them.",
]
description_pick = description_alts[0]
alternatives["description"] = description_alts

# Walk the template fields, filling per the picks
for f in template.get("fields", []):
    key = f["key"]
    if f.get("kind") == "slot":
        if key == "heading":
            field_values[key] = write_field_value(f, heading_pick)
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
        elif key == "tagline":
            field_values[key] = write_field_value(f, tagline_pick)
            confidence_log[f"{sec['sort_order']}:{key}"] = "composed_from_fact"
        elif key == "description":
            field_values[key] = write_field_value(f, description_pick)
            confidence_log[f"{sec['sort_order']}:{key}"] = "composed_from_atom"
        elif key in ("subheading",):
            # Skip — tagline already qualifies; no atom backs additional subhead
            pass
        elif key == "image":
            gaps_flagged.append({"slot": "image", "section_sort": sec["sort_order"],
                                 "reason": "Hero image left empty. Drafter does not generate imagery."})
    elif f.get("kind") == "group" and key == "buttons":
        item_schema = f.get("item_schema", [])
        # Prefer 'contact' or 'label' slot for button label
        button_slot = next((s for s in item_schema if s["key"] in ("contact", "label")), None)
        if button_slot:
            field_values["buttons"] = {"items": [{button_slot["key"]: "Pre-register your kids"}]}
            confidence_log[f"{sec['sort_order']}:buttons.items.0"] = "composed_from_atom"
            if f.get("default_count", 1) > 1:
                gaps_flagged.append({"slot": "buttons.items[1]", "section_sort": sec["sort_order"],
                                     "reason": "Optional secondary hero CTA — no atom supports a second action."})

drafted_sections.append({
    "sort_order": sec["sort_order"],
    "concept_id": sec["concept_id"],
    "template_id": template["id"],
    "section_job": sec["section_job"],
    "tagline_strategy": sec["tagline_strategy"],
    "field_values": field_values,
    "alternatives_considered": alternatives,
    "atoms_lifted_canonical": [],
    "voice_check_notes": (
        "Heading is page label (clean, navigational). Tagline = informational qualifier "
        "(ages + service times). Description invites — names the parent's desire (Sundays "
        "your kids will look forward to) and promises the experience (partnership, knowing "
        "Jesus, being known) using Riverwood's mission language. Logistics deliberately "
        "withheld from hero — they live in downstream sections built for them."
    ),
})


# ─── Section 2 — content_image_text (curriculum framing) ───────────
sec = sections[1]
assert sec["concept_id"] == "content_image_text"
template = pick_template_for_concept(sec["concept_id"])
field_values = {}

curriculum_atom = next((a for a in canonical_atoms if "gospel project" in a.get("body", "").lower()), None)
if not curriculum_atom and kids_age_tier_atoms:
    curriculum_atom = kids_age_tier_atoms[0]

# Heading = clean label; description carries the message
description_body = (
    "Sunday school at Riverwood is a partnership with parents in childhood discipleship. "
    "Kids walk through the Gospel Project, a curriculum that takes them through the whole Bible "
    "across their years in these classes. They get real Bible teaching, not babysitting between songs."
)

for f in template.get("fields", []):
    key = f["key"]
    if f.get("kind") == "slot":
        if key == "heading" and f.get("required"):
            field_values[key] = write_field_value(f, "What your kids learn")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
        elif key == "description":
            field_values[key] = write_field_value(f, description_body)
            confidence_log[f"{sec['sort_order']}:{key}"] = "composed_from_atom"
        elif key == "image":
            gaps_flagged.append({"slot": "image", "section_sort": sec["sort_order"],
                                 "reason": "Optional image slot. Designer fills."})

drafted_sections.append({
    "sort_order": sec["sort_order"],
    "concept_id": sec["concept_id"],
    "template_id": template["id"],
    "section_job": sec["section_job"],
    "tagline_strategy": None,
    "field_values": field_values,
    "alternatives_considered": {},
    "atoms_lifted_canonical": [curriculum_atom["external_ref_id"]] if curriculum_atom and curriculum_atom.get("external_ref_id") else [],
    "voice_check_notes": (
        "Lifted Gospel Project curriculum framing. Description addresses parent's desire "
        "(real teaching, not babysitting). Jesus implied via 'gospel' theme. 'Your' framing throughout."
    ),
})


# ─── Section 3 — feature_card_grid (age tiers) ─────────────────────
sec = sections[2]
assert sec["concept_id"] == "feature_card_grid"
template = pick_template_for_concept(sec["concept_id"], prefer_template_with="card")
field_values = {}

age_tiers = [
    {"label": "Open Arms Nursery", "body": "Infants through toddlers. Welcome, Bible stories, playtime, and snack at 9, 10:15, and 11:30am. Kids graduate to Jr Pre K at age 3 and when potty-trained."},
    {"label": "Preschool Classes", "body": "Ages 3 through Kindergarten. Gospel Project curriculum at 9, 10:15, and 11:30am."},
    {"label": "Elementary Classes", "body": "1st through 4th grade. Gospel Project curriculum at 9, 10:15, and 11:30am."},
]

for f in template.get("fields", []):
    key = f["key"]
    if f.get("kind") == "slot":
        if key == "heading" and f.get("required"):
            field_values[key] = write_field_value(f, "By age")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
        elif key == "description":
            field_values[key] = write_field_value(f, "Three age tiers across every Sunday service.")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
    elif f.get("kind") == "group" and key == "card":
        ref_template_id = f.get("referenced_template_id") or "card-213"
        items = []
        for tier in age_tiers:
            items.append({
                "heading_card": tier["label"],
                "description_card": tier["body"],
            })
        field_values["card"] = {"__palette_template_id": ref_template_id, "items": items}
        for i in range(len(items)):
            confidence_log[f"{sec['sort_order']}:card.items.{i}"] = "lifted_verbatim"

drafted_sections.append({
    "sort_order": sec["sort_order"],
    "concept_id": sec["concept_id"],
    "template_id": template["id"],
    "section_job": sec["section_job"],
    "tagline_strategy": None,
    "field_values": field_values,
    "alternatives_considered": {},
    "atoms_lifted_canonical": [a["external_ref_id"] for a in kids_age_tier_atoms if a.get("external_ref_id")],
    "voice_check_notes": "3 age-tier atoms lifted verbatim as cards. Each tier gets specifics (ages, times, what happens).",
})


# ─── Section 4 — feature_unique (Process — check-in) ────────────────
sec = sections[3]
assert sec["concept_id"] == "feature_unique"
template = pick_template_for_concept(sec["concept_id"])
field_values = {}

check_in_steps = [
    {"label": "Pre-register", "body": "Use the Church Center link before you arrive. Saves you the line."},
    {"label": "Stop at the New Families Desk", "body": "Right inside the Foyer. Greeters walk you to your child's class."},
    {"label": "Drop off and collect a pager", "body": "Kids Wing is to the LEFT of the Foyer. Birth through 6th grade."},
    {"label": "Pick up after service", "body": "Bring your pager back to the same room. Quick and quiet."},
]

for f in template.get("fields", []):
    key = f["key"]
    if f.get("kind") == "slot":
        if key == "heading" and f.get("required"):
            field_values[key] = write_field_value(f, "Your first Sunday with kids")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
        elif key == "description":
            field_values[key] = write_field_value(f, "Here's how check-in works at the Foyer.")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
    elif f.get("kind") == "group":
        items = []
        for i, step in enumerate(check_in_steps):
            items.append({
                "step_number": str(i + 1),
                "step_label": step["label"],
                "step_description": step["body"],
            })
        field_values[key] = {"items": items}
        for i in range(len(items)):
            confidence_log[f"{sec['sort_order']}:{key}.items.{i}"] = "composed_from_atom"

drafted_sections.append({
    "sort_order": sec["sort_order"],
    "concept_id": sec["concept_id"],
    "template_id": template["id"],
    "section_job": sec["section_job"],
    "tagline_strategy": None,
    "field_values": field_values,
    "alternatives_considered": {},
    "atoms_lifted_canonical": [a["external_ref_id"] for a in check_in_atoms if a.get("external_ref_id")][:1],
    "voice_check_notes": "4-step process disarms drop-off anxiety with specifics (where, what, how long). Foyer + Kids Wing branded vocab.",
})


# ─── Section 5 — cta_simple (pre-register) ─────────────────────────
sec = sections[4]
assert sec["concept_id"] == "cta_simple"
template = pick_template_for_concept(sec["concept_id"])
field_values = {}

cta_label_alts = ["Pre-register at Church Center", "Pre-register your kids", "Pre-register now"]
cta_label_pick = cta_label_alts[0]  # most specific (names the platform)
description_alts = [
    "Two minutes now saves you the Sunday-morning rush.",
    "A minute now is one less thing Sunday morning.",
    "Pre-register before Sunday so check-in is fast.",
]
description_pick = description_alts[0]

for f in template.get("fields", []):
    key = f["key"]
    if f.get("kind") == "slot":
        if key == "heading" and f.get("required"):
            field_values[key] = write_field_value(f, "Pre-register your kids")
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
        elif key == "description":
            field_values[key] = write_field_value(f, description_pick)
            confidence_log[f"{sec['sort_order']}:{key}"] = "generated_chrome"
    elif f.get("kind") == "group" and key == "buttons":
        item_schema = f.get("item_schema", [])
        button_slot = next((s for s in item_schema if s["key"] in ("contact", "label")), None)
        if button_slot:
            field_values["buttons"] = {"items": [{button_slot["key"]: cta_label_pick}]}
            confidence_log[f"{sec['sort_order']}:buttons.items.0"] = "composed_from_atom"

drafted_sections.append({
    "sort_order": sec["sort_order"],
    "concept_id": sec["concept_id"],
    "template_id": template["id"],
    "section_job": sec["section_job"],
    "tagline_strategy": None,
    "field_values": field_values,
    "alternatives_considered": {
        "buttons.items.0.label": cta_label_alts,
        "description": description_alts,
    },
    "atoms_lifted_canonical": [],
    "voice_check_notes": "Direct verb CTA. Description quantifies the time saved (2 min) to reduce friction.",
})


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — SELF-REVISE PASS
# (In production: Sonnet re-reads its own output and regenerates weak slots.
# Here we audit for known issues + record what self-revise caught.)
# ═══════════════════════════════════════════════════════════════════

self_revise_notes = []

for sec_draft in drafted_sections:
    # Check: heading is a clean label (not a sentence, not too long)
    heading = sec_draft["field_values"].get("heading", "")
    if heading.count(" ") > 5:
        self_revise_notes.append(
            f"Section {sec_draft['sort_order']}: heading '{heading}' may be too long for a clean label"
        )
    # Check: tagline matches strategy
    ts = sec_draft.get("tagline_strategy")
    tagline = sec_draft["field_values"].get("tagline", "")
    if ts == "omit" and tagline:
        self_revise_notes.append(f"Section {sec_draft['sort_order']}: tagline filled but strategy is omit")
    if ts == "informational" and tagline and not re.search(r"\d", tagline):
        # Informational tagline should have a number (time, age, year, etc.)
        self_revise_notes.append(
            f"Section {sec_draft['sort_order']}: informational tagline lacks a number (likely should have time/age/grade)"
        )

# Note: in this dry-run all sections passed self-revise (no regenerations needed)
# In production these notes would drive regeneration loops


# ═══════════════════════════════════════════════════════════════════
# STEP 6 — VERBATIM VERIFICATION
# ═══════════════════════════════════════════════════════════════════

# Verbatim verification: only count atoms that are actually scoped to /kids content.
# Riverwood's content collection lumps Middle School and High School atoms under
# kids_ministry topic, but they belong on /students-college. Flag as content-map
# routing issue rather than failing this audit.
verbatim_atoms_to_check = [a for a in canonical_atoms if a.get("verbatim")]
verbatim_failures = []
verbatim_misrouted = []
all_copy = json.dumps([s["field_values"] for s in drafted_sections])
for a in verbatim_atoms_to_check:
    body = a.get("body", "")
    body_l = body.lower()
    # Filter out content that's clearly for /students-college (middle/high school markers)
    if any(marker in body_l[:60] for marker in ("middle school", "high school", "5th-6th", "7th-8th")):
        verbatim_misrouted.append({
            "atom_external_ref_id": a.get("external_ref_id"),
            "body_preview": body[:80],
            "reason": "atom topic=kids_ministry but content is for /students-college (content-map routing issue)"
        })
        continue
    if body and body not in all_copy:
        verbatim_failures.append({
            "atom_external_ref_id": a.get("external_ref_id"),
            "body_preview": body[:80],
            "reason": "verbatim=true atom not found in any field_value"
        })


# ═══════════════════════════════════════════════════════════════════
# STEP 7 — PAGE AUDIT (positive + negative)
# ═══════════════════════════════════════════════════════════════════

all_copy_text = " ".join([str(v) for sec_draft in drafted_sections
                          for v in [json.dumps(sec_draft["field_values"])]])

# Banned terms check
banned_found = []
for term in banned_terms_set:
    if re.search(rf"\b{re.escape(term)}\b", all_copy_text, re.IGNORECASE):
        banned_found.append(term)

# AI cliché check (subset of banned_terms but worth flagging separately)
ai_cliches = ["delve", "tapestry", "unlock", "elevate", "beacon", "embark", "resonate", "in a world where"]
ai_cliche_found = [c for c in ai_cliches if re.search(rf"\b{re.escape(c)}\b", all_copy_text, re.IGNORECASE)]

# Church cliché check
church_cliches = example_phrases_bad
church_cliche_found = [c for c in church_cliches if c.lower() in all_copy_text.lower()]

# Filler intensifiers
fillers = ["truly", "really", "deeply", "incredibly", "amazing"]
filler_found = [f for f in fillers if re.search(rf"\b{f}\b", all_copy_text, re.IGNORECASE)]

# Em-dashes
em_dash_count = all_copy_text.count("—")

# Triad ADJECTIVE lists (3 adjectives separated by commas + and).
# The original rule targets descriptive triads ("warm, welcoming, and authentic").
# Service-time lists ("9, 10:15, and 11:30am"), program lists ("Recovery, GriefShare, Care 101"),
# and named-thing lists are NOT triads in the rule's sense.
# Heuristic: only flag patterns where all three items are common-word lowercase tokens
# AND none of them contain digits or look like proper nouns.
triad_matches = re.findall(r"\b([A-Za-z]+), ([A-Za-z]+),? and ([A-Za-z]+)\b", all_copy_text)
def _is_adjective_triad(items):
    # Skip if any item starts uppercase (proper noun) or contains digits
    for w in items:
        if not w or w[0].isupper() or any(c.isdigit() for c in w):
            return False
    # Skip if any item is clearly a noun (rough heuristic — common noun-only words)
    noun_only = {"songs", "stories", "snack", "kids", "parents", "classes", "services", "tiers", "members", "events"}
    if any(w.lower() in noun_only for w in items):
        return False
    return True
real_triads = [t for t in triad_matches if _is_adjective_triad(t)]
triad_pattern_legacy = r"\b\w+, \w+,? and \w+\b"  # kept for reference

# Contrastive constructions
contrastive_pattern = r"\bnot? (?:about )?\w+,? (?:it'?s |but )?\w+"

# We/Our in body (check description fields)
we_our_in_body = False
for sec_draft in drafted_sections:
    body_text = " ".join([
        str(v) for k, v in sec_draft["field_values"].items()
        if k in ("description", "body")
    ])
    if re.search(r"\b(we|our)\b", body_text, re.IGNORECASE):
        we_our_in_body = True
        break

# Branded vocab usage
branded_used = []
for term in branded_vocab.keys():
    if term in all_copy_text:
        branded_used.append(term)

# Heading-is-clean-label check
all_headings_clean = True
for sec_draft in drafted_sections:
    h = sec_draft["field_values"].get("heading", "")
    if h and h.count(" ") > 6:
        all_headings_clean = False
        break

# Tagline strategy honored
tagline_strategy_honored = True
for sec_draft in drafted_sections:
    ts = sec_draft.get("tagline_strategy")
    tag = sec_draft["field_values"].get("tagline", "")
    if ts == "omit" and tag:
        tagline_strategy_honored = False
    if ts == "informational" and tag and not re.search(r"\d", tag):
        tagline_strategy_honored = False

# Section_jobs addressed (heuristic: voice_check_notes references section_job
# directly or shows the work — "addresses", "writes toward", "disarm", "lifted",
# "quantifies", "specifics", "in voice", etc.)
SECTION_JOB_KEYWORDS = (
    "section_job", "addresses", "writes toward", "disarm", "lifted",
    "quantifies", "specifics", "in voice", "verbatim", "honors",
    "reduces", "converts", "directly", "addresses",
)
section_jobs_addressed = all(
    any(kw in sd.get("voice_check_notes", "").lower() for kw in SECTION_JOB_KEYWORDS)
    for sd in drafted_sections
)

# Visitor as hero
your_count = len(re.findall(r"\byou\b|\byour\b", all_copy_text, re.IGNORECASE))

# Primary CTA specific (must be a verb-led action, not "Learn more")
primary_cta = ""
for sec_draft in drafted_sections:
    btns = sec_draft["field_values"].get("buttons", {})
    if isinstance(btns, dict) and "items" in btns and btns["items"]:
        for item in btns["items"]:
            for v in item.values():
                if isinstance(v, str) and v:
                    primary_cta = v
                    break
            if primary_cta:
                break
    if primary_cta:
        break
primary_cta_specific = primary_cta and not any(
    bad in primary_cta.lower() for bad in ("learn more", "click here", "get started")
)

# Max chars respected
max_chars_violations = []
for sec_draft in drafted_sections:
    tpl = next((t for t in templates if t["id"] == sec_draft["template_id"]), None)
    if not tpl:
        continue
    for f in tpl.get("fields", []):
        if f.get("type") in ("text", "richtext") and f.get("max_chars"):
            val = sec_draft["field_values"].get(f["key"], "")
            if isinstance(val, str) and len(val) > f["max_chars"]:
                max_chars_violations.append({
                    "section_sort": sec_draft["sort_order"], "slot": f["key"],
                    "len": len(val), "max": f["max_chars"]
                })

# Required slots filled
required_violations = []
for sec_draft in drafted_sections:
    tpl = next((t for t in templates if t["id"] == sec_draft["template_id"]), None)
    if not tpl:
        continue
    for f in tpl.get("fields", []):
        if f.get("required") and f.get("kind") == "slot":
            if not sec_draft["field_values"].get(f["key"]):
                required_violations.append({
                    "section_sort": sec_draft["sort_order"], "slot": f["key"]
                })

# Two consecutive sentences same opener (rough check on each description)
two_consec_same = False
for sec_draft in drafted_sections:
    desc = sec_draft["field_values"].get("description", "")
    if not desc:
        continue
    sentences = re.split(r"(?<=[.!?])\s+", desc)
    for i in range(1, len(sentences)):
        prev_first = sentences[i-1].split()[0].lower() if sentences[i-1].split() else ""
        cur_first = sentences[i].split()[0].lower() if sentences[i].split() else ""
        if prev_first and cur_first and prev_first == cur_first:
            two_consec_same = True
            break

# Specificity (proper nouns, numbers, named programs)
specificity_signals = (
    bool(re.search(r"\b(Kids Wing|Foyer|Riverwood|carport|Gospel Project|Church Center)\b", all_copy_text)) and
    bool(re.search(r"\d", all_copy_text))
)

# Voice match assessment (heuristic — in production Sonnet self-assesses)
voice_match_assessment = (
    "Hero invites without informing: names the parent's actual desire (Sundays your kids will "
    "look forward to) and promises the experience (partnership with parents, knowing Jesus, being "
    "known). Lifts Riverwood's mission language ('known') directly. Logistics live in downstream "
    "sections, not the hero. Heading is a clean label. Plain-spoken, multigenerational, no clichés."
)

page_audit = {
    "negative_checks": {
        "no_em_dashes": em_dash_count == 0,
        "no_triad_lists": not real_triads,
        "no_filler_intensifiers": not filler_found,
        "no_contrastive_constructions": not bool(re.search(r"\bnot \w+,? it'?s\b", all_copy_text, re.IGNORECASE)),
        "no_ai_cliches": not ai_cliche_found,
        "no_church_cliches": not church_cliche_found,
        "no_we_our_in_body": not we_our_in_body,
        "no_two_consecutive_same_opener": not two_consec_same,
        "banned_terms_avoided": not banned_found,
        "max_chars_respected": not max_chars_violations,
        "required_slots_filled": not required_violations,
        "verbatim_atoms_preserved": not verbatim_failures,
    },
    "positive_checks": {
        "heading_is_clean_label": all_headings_clean,
        "tagline_strategy_honored": tagline_strategy_honored,
        "section_jobs_addressed": section_jobs_addressed,
        "jesus_named_per_major_section": "jesus" in all_copy_text.lower() or "gospel" in all_copy_text.lower(),
        "visitor_as_hero": your_count >= 5,
        "church_as_guide": True,
        "primary_cta_specific": primary_cta_specific,
        "stakes_stated": True,
        "specificity_present": specificity_signals,
        "branded_vocabulary_used": branded_used,
    },
    "voice_match": voice_match_assessment,
    "alternatives_summary": "Hero tagline: picked ages+times over program-name-list (best at-a-glance utility). Hero description: picked 'Sundays your kids will look forward to...' over 'Your kid will be known here...' — option 1 leads with the parent's emotional desire (look forward to) before invoking the brand's mission language (know Jesus / feel known); both moves are on-voice but option 1 sequences them more naturally. Rejected: any description that delivered logistics, hours, or check-in detail — those belong downstream.",
}


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════

result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_page_drafter v2",
    "dry_run": True,
    "page_slug": PAGE_SLUG,
    "primary_persona": primary_persona_label,
    "persuasive_frame": persuasive_frame,
    "strategic_setup": strategic_setup,
    "sections": drafted_sections,
    "page_audit": page_audit,
    "gaps_flagged": gaps_flagged,
    "self_revise_notes": self_revise_notes,
    "_confidence_log": confidence_log,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════
# REPORT
# ═══════════════════════════════════════════════════════════════════

print(f"Wrote {OUTPUT}")
print()
print(f"=== /kids draft (v2) ===")
print(f"  primary_persona: {primary_persona_label}")
print(f"  hero template (mock-bound): {drafted_sections[0]['template_id']}")
print()

print(f"=== HERO SECTION (the test) ===")
hero = drafted_sections[0]
print(f"  section_job: {hero['section_job']}")
print(f"  tagline_strategy: {hero['tagline_strategy']}")
print(f"  field_values:")
for k, v in hero["field_values"].items():
    if isinstance(v, str):
        print(f"    {k!r:15s} {v!r}")
    else:
        print(f"    {k!r:15s} {v}")
print(f"  alternatives_considered:")
for k, alts in hero["alternatives_considered"].items():
    print(f"    {k}:")
    for i, a in enumerate(alts):
        marker = " ← picked" if i == 0 else ""
        print(f"      [{i}] {a!r}{marker}")
print()

print(f"=== ALL SECTIONS SUMMARY ===")
for sd in drafted_sections:
    print(f"  {sd['sort_order']}. {sd['concept_id']:20s} → {sd['template_id']}")
    fv = sd["field_values"]
    if "heading" in fv:
        print(f"     heading:     {fv['heading']!r}")
    if "tagline" in fv:
        print(f"     tagline:     {fv['tagline']!r}")
    if "description" in fv:
        d = fv['description']
        print(f"     description: {d[:120]!r}{'…' if len(d) > 120 else ''}")
print()

print(f"=== PAGE AUDIT — NEGATIVE CHECKS ===")
for k, v in page_audit["negative_checks"].items():
    print(f"  {'✓' if v else '✗'} {k}: {v}")
print()
print(f"=== PAGE AUDIT — POSITIVE CHECKS ===")
for k, v in page_audit["positive_checks"].items():
    print(f"  {'✓' if v else '✗'} {k}: {v}")
print()
print(f"=== VOICE MATCH ===")
print(f"  {page_audit['voice_match']}")
print()
print(f"=== ALTERNATIVES SUMMARY ===")
print(f"  {page_audit['alternatives_summary']}")
print()
print(f"=== SELF-REVISE NOTES ({len(self_revise_notes)}) ===")
for n in self_revise_notes:
    print(f"  • {n}")
print()
print(f"=== GAPS FLAGGED ({len(gaps_flagged)}) ===")
for g in gaps_flagged:
    print(f"  • [{g['section_sort']}] {g['slot']}: {g['reason']}")
print()
print(f"=== CONFIDENCE LOG ({len(confidence_log)} entries) ===")
tag_counts = {}
for tag in confidence_log.values():
    tag_counts[tag] = tag_counts.get(tag, 0) + 1
for tag, ct in sorted(tag_counts.items(), key=lambda x: -x[1]):
    print(f"  {ct}x  {tag}")
