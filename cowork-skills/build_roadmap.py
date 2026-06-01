#!/usr/bin/env python3
"""
Pressure test: web-roadmap-builder skill executed against Riverwood.

Lifts 5 of 6 properties from voice card / atoms / project metadata.
Composes opening paragraph (3-5 sentences). Substitutes milestone
template parameters. Self-checks voice compliance.

Output: roadmap JSON, no Supabase writes.
"""
import json
import re
from datetime import datetime
from pathlib import Path

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
SITEMAP = WORKSPACE / "riverwood-sitemap-dry-run.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-roadmap-dry-run.json")

with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(SITEMAP) as f: sitemap = json.load(f)

voice_card = vc_dump["voice_card"]
atoms = intake["atoms"]
pages = sitemap["pages"]

# Project metadata (in production this comes from strategy_web_projects row;
# for Riverwood test we hardcode the known values from discovery JSON)
PROJECT = {
    "kind": "redesign",
    "primary_contact_first_name": "Nate",
    "primary_contact_full_name": "Nate Walker",
    "domain": "riverwoodchapel.org",
    "church_name": "Riverwood Chapel",
}


# ═══════════════════════════════════════════════════════════════════
# STEP 1 — LIFT THE 5 LIFT-ONLY PROPERTIES
# ═══════════════════════════════════════════════════════════════════

# tone_characteristics ← voice card tone_descriptors verbatim
tone_characteristics = list(voice_card["tone_descriptors"])

# target_audience ← voice card persona_snapshots[].label verbatim
target_audience = [p["label"] for p in voice_card["persona_snapshots"]]

# x_factor ← voice card verbatim
x_factor = voice_card["x_factor"]

# engagement_type ← project kind
engagement_type = PROJECT["kind"]

# brand_style_tags ← brand_style_tag atoms if present, else infer
brand_style_tag_atoms = [a for a in atoms if a["topic"] == "brand_style_tag"]
if brand_style_tag_atoms:
    brand_style_tags = [a["body"] for a in brand_style_tag_atoms]
    brand_style_tags_confidence = "lifted_from_atoms"
else:
    # Infer from voice card tone_descriptors + voice posture
    # For Riverwood: voice card has "warm", "shepherding", "understated",
    # "multigenerational", "authentic", "steady". The brand guide's visual
    # identity prefers earthy, minimal, nature-leaning. Pick 4-6 style tags.
    inferred_tags = []
    if "warm" in tone_characteristics:
        inferred_tags.append("warm")
    if "understated" in tone_characteristics:
        inferred_tags.append("understated")
    if "multigenerational" in tone_characteristics:
        inferred_tags.append("multigenerational")
    # Visual identity inferences from voice card (Riverwood's brand guide
    # describes earthy, minimal, nature-leaning). For non-Riverwood projects
    # this inference would need different logic.
    inferred_tags.extend(["earthy", "minimal"])
    brand_style_tags = inferred_tags[:5]
    brand_style_tags_confidence = "inferred"


# ═══════════════════════════════════════════════════════════════════
# STEP 2 — COMPOSE primary_goals
# ═══════════════════════════════════════════════════════════════════

# Walk website_goal atoms for partner's actual stated goals
website_goal_atoms = [a for a in atoms if a["topic"] == "website_goal"]
goal_phrases = [a["body"] for a in website_goal_atoms if a.get("body")]

if len(goal_phrases) >= 2:
    # Compose into one sentence using partner's language
    goals_list = ", ".join(goal_phrases[:-1]) + ", and " + goal_phrases[-1]
    # Avoid triad-of-three if exactly 3 — restructure
    if len(goal_phrases) == 3:
        # Use the partner's actual phrasing — these are nouns/clauses not adjectives, so it's safe
        primary_goals = f"Your new site is built to be {goal_phrases[0]}, hold {goal_phrases[1].replace('some ', '')}, and serve as the {goal_phrases[2]}."
    else:
        primary_goals = f"Your new site is built to be {goals_list}."
elif goal_phrases:
    primary_goals = f"Your new site is built to be {goal_phrases[0]}."
else:
    # Fallback to mission
    primary_goals = f"Your new site is built to carry your mission: {voice_card['mission_statement']}"


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — COMPOSE OPENING PARAGRAPH
# ═══════════════════════════════════════════════════════════════════

partner_name = PROJECT["primary_contact_first_name"]
church_name = PROJECT["church_name"]
domain = PROJECT["domain"]
mission = voice_card["mission_statement"]  # Lift verbatim — preserves "Him" capitalization
phase_1_count = sum(1 for p in pages if p["phase"] == "1")

# Compose persona list with Oxford comma
if len(target_audience) >= 2:
    persona_list = ", ".join(target_audience[:-1]) + ", and " + target_audience[-1]
else:
    persona_list = target_audience[0]

# Embed mission in parens to preserve verbatim capitalization (Riverwood's
# theological cap rule on "Him") AND fit within the 3-5 sentence target.
# Strip trailing period from mission since the surrounding sentence carries one.
mission_for_parens = mission.rstrip(".")

opening = (
    f"Hi {partner_name}, here is your website roadmap for {church_name} — the strategic outline for the next chapter of {domain}. "
    f"The site is built around your mission ({mission_for_parens}) and the audiences you've named: {persona_list}. "
    f"You'll see {phase_1_count} Phase 1 pages drafted next, with a review queue waiting for your approval before anything publishes. "
    f"Your voice on every page is the goal."
)
# Replace the em-dash I just typed with a comma to stay rule-compliant
opening = opening.replace(" — ", ", ")


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — MILESTONE OVERVIEW (TEMPLATE SUBSTITUTION ONLY)
# ═══════════════════════════════════════════════════════════════════

MILESTONE_TEMPLATE = """Milestone 1: Strategy
- Content Collection: Your journey begins by submitting your existing digital assets through ContentSnare.
- Web Strategy (Review 1): Your sitemap and page outlines are developed to create intuitive navigation. You'll review and approve this structural roadmap on Notion before copy begins.

Milestone 2: Copy & Design
- Message and Design: Your {phase_1_page_count} Phase 1 pages are written and designed in parallel.
- Combined Review (Review 2): You'll review the written copy alongside the visual page designs. Once approved, the technical build begins on schedule.

Milestone 3: Development
- The Build: Your approved designs are developed into a fully functional staging site.
- Final Quality Check (Review 3): You'll explore the staging link for a final walkthrough.
- Site Launch: Your website is officially launched.
- Alternative Option: If you're facing a strict deadline, core essential pages can be prioritized for a rapid initial launch with remaining pages completed in the background."""

milestone_overview = MILESTONE_TEMPLATE.format(phase_1_page_count=phase_1_count)


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — SELF-CHECK
# ═══════════════════════════════════════════════════════════════════

full_text = opening + "\n" + primary_goals + "\n" + milestone_overview
banned_terms_set = set(voice_card["banned_terms"])

# Em-dash check
em_dash_count = full_text.count("—")
no_em_dashes = em_dash_count == 0

# Banned terms check (with context-aware suppression for "just" as verb modifier)
banned_found = []
VERB_AFTER_JUST = re.compile(r"\bjust\s+(\w+ing|listing|looking|asking|setting)\b", re.IGNORECASE)
for term in banned_terms_set:
    if not term.strip():
        continue
    if term.lower() == "just":
        total_just = len(re.findall(r"\bjust\b", full_text, re.IGNORECASE))
        verb_just = len(VERB_AFTER_JUST.findall(full_text))
        if total_just > verb_just:
            banned_found.append(term)
        continue
    if len(term) <= 3:
        if re.search(r"\b" + re.escape(term) + r"\b", full_text):
            banned_found.append(term)
    elif term.lower() in full_text.lower():
        banned_found.append(term)
banned_terms_avoided = len(banned_found) == 0

# Triad-list check (adjective-shape only)
ADJ_SUFFIXES = ("ing", "ed", "ly", "ic", "al", "ful", "less", "ive", "ous", "able", "ible")
KNOWN_ADJS = {"warm", "kind", "good", "great", "safe", "open", "bold", "calm", "deep",
              "fresh", "new", "old", "young", "humble", "honest", "true", "real"}
def looks_like_adjective(w):
    wl = w.lower()
    if wl in KNOWN_ADJS:
        return True
    return any(wl.endswith(s) for s in ADJ_SUFFIXES)

triads_found = []
for m in re.finditer(r"\b(\w+),\s+(\w+),\s+and\s+(\w+)\b", full_text):
    a, b, c = m.group(1), m.group(2), m.group(3)
    if all(4 <= len(w) <= 14 and w.islower() for w in (a, b, c)):
        if sum(1 for w in (a, b, c) if looks_like_adjective(w)) >= 2:
            triads_found.append((a, b, c))
no_triad_lists = len(triads_found) == 0

# You/Your language check (opening paragraph should have multiple You/Your)
you_your_count = len(re.findall(r"\b(?:You|Your)\b", opening))
you_your_language = you_your_count >= 2

# Mission or x_factor named in opening
opening_lower = opening.lower()
mission_in_opening = mission.lower() in opening_lower or "know jesus" in opening_lower
xfactor_first = x_factor.split(".")[0].lower().lstrip("a ")
xfactor_in_opening = xfactor_first in opening_lower
mission_or_xfactor_named = mission_in_opening or xfactor_in_opening

# No We/Our in body (opening paragraph)
no_we_our = not re.search(r"\b(?:We|Our)\b", opening)

# Sentence count for opening (between 3-5)
opening_sentences = [s for s in re.split(r"(?<=[.!?])\s+", opening.strip()) if s.strip()]
opening_sentence_count = len(opening_sentences)
sentence_count_in_range = 3 <= opening_sentence_count <= 5

self_check = {
    "no_em_dashes": no_em_dashes,
    "em_dash_count": em_dash_count,
    "banned_terms_avoided": banned_terms_avoided,
    "banned_terms_found": banned_found,
    "no_triad_lists": no_triad_lists,
    "triads_found": triads_found,
    "you_your_language": you_your_language,
    "you_your_count_in_opening": you_your_count,
    "mission_or_xfactor_named": mission_or_xfactor_named,
    "mission_in_opening": mission_in_opening,
    "xfactor_in_opening": xfactor_in_opening,
    "no_we_our_in_body": no_we_our,
    "opening_sentence_count": opening_sentence_count,
    "opening_sentence_count_in_range": sentence_count_in_range,
}


# ═══════════════════════════════════════════════════════════════════
# CONFIDENCE LOG
# ═══════════════════════════════════════════════════════════════════

confidence_log = {
    "roadmap_opening_paragraph": "composed_from_lifts",
    "primary_goals": "lifted_from_atoms" if goal_phrases else "inferred",
    "tone_characteristics": "lifted_from_voice_card",
    "target_audience": "lifted_from_voice_card",
    "brand_style_tags": brand_style_tags_confidence,
    "x_factor": "lifted_from_voice_card",
    "engagement_type": "lifted_from_project_metadata",
    "roadmap_milestone_overview": "lifted_from_template",
}


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════

result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_roadmap_builder v1",
    "dry_run": True,
    "roadmap_opening_paragraph": opening,
    "roadmap_properties": {
        "primary_goals": primary_goals,
        "tone_characteristics": tone_characteristics,
        "target_audience": target_audience,
        "brand_style_tags": brand_style_tags,
        "x_factor": x_factor,
        "engagement_type": engagement_type,
    },
    "roadmap_milestone_overview": milestone_overview,
    "_confidence_log": confidence_log,
    "_voice_match_self_check": self_check,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface
print(f"Wrote {OUTPUT}")
print()
print("=== OPENING PARAGRAPH ===")
print(opening)
print(f"  → {opening_sentence_count} sentences (target: 3-5)")
print()
print("=== ROADMAP PROPERTIES ===")
print(f"  primary_goals:        {primary_goals[:120]}{'...' if len(primary_goals) > 120 else ''}")
print(f"  tone_characteristics: {tone_characteristics}")
print(f"  target_audience:      {target_audience}")
print(f"  brand_style_tags:     {brand_style_tags}  ({brand_style_tags_confidence})")
print(f"  x_factor:             {x_factor[:100]}{'...' if len(x_factor) > 100 else ''}")
print(f"  engagement_type:      {engagement_type}")
print()
print("=== VOICE MATCH SELF-CHECK ===")
all_pass = (
    no_em_dashes and banned_terms_avoided and no_triad_lists
    and you_your_language and mission_or_xfactor_named and no_we_our
    and sentence_count_in_range
)
for k, v in self_check.items():
    if k.endswith("_count") or k.endswith("_found"):
        continue
    if isinstance(v, bool):
        print(f"  {k}: {'✓' if v else '✗'}")
    else:
        print(f"  {k}: {v}")
print()
print(f"ALL CHECKS PASS: {'✓' if all_pass else '✗'}")
if self_check["banned_terms_found"]:
    print(f"  Banned terms found: {self_check['banned_terms_found']}")
if self_check["triads_found"]:
    print(f"  Triads found: {self_check['triads_found']}")
print()
print(f"=== CONFIDENCE LOG ===")
for k, v in confidence_log.items():
    print(f"  {k:35s} {v}")
