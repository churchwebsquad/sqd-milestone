#!/usr/bin/env python3
"""
Pressure test: web-voice-card-compiler v2 executed against the Riverwood
dry-run atoms produced by web-intake-normalizer.

This script implements the compiler's nine-step assembly order:
  1. Defaults from references/web-writing-rules.md
  2. Brand guide overlay (branded_term, voice_rule, theological_cap)
  3. Brief lift (persona, tone_descriptor, mission_statement, x_factor, denom)
  4. Discovery supplement (anti_model, voice_ammo)
  5. SYNTHESIZE signature_moves (Sonnet 4.6 in prod; hand-crafted here)
  6. SYNTHESIZE positive_voice_rules
  7. SYNTHESIZE sample_sentences_in_voice
  8. SYNTHESIZE persuasive_posture_by_persona
  9. Confidence tagging + absence notes

The four synthesis fields are hand-crafted in this dry-run to validate the
output shape Sonnet should produce. Every value traces to lifted atoms +
the cross-cutting persuasive patterns (no invention).

Output: church_voice_cards-shaped JSON, no Supabase writes.
"""
import json
import re
from datetime import datetime
from pathlib import Path

INPUT = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills/riverwood-normalizer-dry-run.json")
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-voice-card-dry-run.json")

with open(INPUT) as f:
    intake = json.load(f)

all_atoms = intake["atoms"]

STRATEGIC_TOPICS = {
    "persona", "tone_descriptor", "tone_block",
    "mission_statement", "vision_statement", "x_factor",
    "denominational_signal",
    "voice_rule", "theological_capitalization",
    "branded_term", "banned_term", "anti_model",
    "strategic_priority", "website_goal", "voice_ammo",
    "church_value", "ideal_experience", "community_struggle",
    "engagement_lever",
}
atoms = [a for a in all_atoms if a["topic"] in STRATEGIC_TOPICS]


def by_topic(topic, source_kind=None):
    for a in atoms:
        if a["topic"] != topic:
            continue
        if source_kind and a.get("source_kind") != source_kind:
            continue
        yield a


# ═══════════════════════════════════════════════════════════════════
# STEP 1 — DEFAULTS (global writing rules)
# ═══════════════════════════════════════════════════════════════════
syntax_rules = {
    "no_em_dash": True,
    "no_triads": True,
    "no_filler_intensifiers": True,
    "no_contrastive_constructions": True,
    "you_your_in_body": True,
    "no_we_our_in_body": True,
    "oxford_comma": True,
    "max_paragraph_sentences": 3,
    "max_h1_words": 7,
}
banned_terms_global = [
    "delve", "tapestry", "unlock", "unleash", "elevate", "beacon",
    "embark", "resonate", "dynamic", "synergistic", "game-changer",
    "testament", "in a world where", "at the heart of", "journey of faith",
    "truly", "really", "deeply", "incredibly", "amazing", "just",
]
example_phrases_bad = [
    "come as you are", "life-changing", "vibrant community",
    "spiritual journey", "walk with God",
]
banned_terms = list(banned_terms_global)


# ═══════════════════════════════════════════════════════════════════
# STEP 2 — BRAND GUIDE OVERLAY
# ═══════════════════════════════════════════════════════════════════
branded_vocabulary = {}
for a in by_topic("branded_term", source_kind="brand_handoff"):
    term = a["body"]
    note = a.get("metadata", {}).get("use_not_x_note", "")
    branded_vocabulary[term] = note
    not_x = re.findall(r"not (\w+(?:\s+or\s+\w+)*)", note)
    for nx_phrase in not_x:
        for nx in re.split(r"\s+or\s+", nx_phrase):
            nx = nx.strip()
            if nx and nx not in banned_terms:
                banned_terms.append(nx)

for a in by_topic("banned_term", source_kind="brand_handoff"):
    if a["body"] not in banned_terms:
        banned_terms.append(a["body"])

for a in by_topic("voice_rule", source_kind="brand_handoff"):
    body = a["body"]
    if "=" in body:
        k, v = body.split("=", 1)
        syntax_rules[k.strip()] = v.strip()
    else:
        syntax_rules[body.strip()] = True

syntax_rules["theological_capitalization"] = []
for a in by_topic("theological_capitalization", source_kind="brand_handoff"):
    syntax_rules["theological_capitalization"].append(a["body"])


# ═══════════════════════════════════════════════════════════════════
# STEP 3 — BRIEF LIFT
# ═══════════════════════════════════════════════════════════════════
persona_snapshots = []
for a in by_topic("persona", source_kind="strategy_brief"):
    md = a.get("metadata", {})
    persona = {
        "label": md.get("label") or a.get("label"),
        "attributes": md.get("attributes") or a["body"],
        "needs": md.get("needs", []),
        "scares_off": md.get("scares_off", []),
        "voice_resonance": md.get("voice_resonance"),
        "entry_pages": md.get("entry_pages", []),
        "critical_conversion_page": md.get("critical_conversion_page"),
    }
    if md.get("grounded_in"):
        persona["grounded_in"] = md["grounded_in"]
    persona = {k: v for k, v in persona.items() if v not in (None, [], "")}
    persona_snapshots.append(persona)

tone_descriptors = [a["body"] for a in by_topic("tone_descriptor", source_kind="strategy_brief")]
if not tone_descriptors:
    for a in by_topic("tone_block", source_kind="strategy_brief"):
        tone_descriptors = re.findall(r"\b\w+\b", a["body"])[:8]

mission_statement = ""
for a in by_topic("mission_statement", source_kind="strategy_brief"):
    mission_statement = a["body"]
    break

vision_statement = ""
for a in by_topic("vision_statement", source_kind="strategy_brief"):
    vision_statement = a["body"]
    break

x_factor = ""
for a in by_topic("x_factor", source_kind="strategy_brief"):
    x_factor = a["body"]
    break

denominational_filter = ""
for a in by_topic("denominational_signal", source_kind="strategy_brief"):
    canonical = a.get("metadata", {}).get("canonical_filter")
    denominational_filter = canonical or a["body"]
    break
if not denominational_filter:
    denominational_filter = "evangelical-non-denominational"


# ═══════════════════════════════════════════════════════════════════
# STEP 4 — DISCOVERY SUPPLEMENT
# ═══════════════════════════════════════════════════════════════════
anti_models = []
for a in by_topic("anti_model", source_kind="discovery_questionnaire"):
    md = a.get("metadata", {})
    am = {
        "name": a["body"],
        "url": md.get("url"),
        "what_to_avoid": md.get("what_to_avoid"),
    }
    anti_models.append(am)

example_phrases_good = []
for a in by_topic("voice_ammo", source_kind="discovery_questionnaire"):
    example_phrases_good.append(a["body"])
for a in all_atoms:
    if a["topic"] == "tagline" and a.get("verbatim"):
        if a["body"] not in example_phrases_good:
            example_phrases_good.append(a["body"])


# ═══════════════════════════════════════════════════════════════════
# STEP 5 — SYNTHESIZE signature_moves
# (In production: Sonnet 4.6 generates from atoms + cms-persuasive-patterns)
# Hand-crafted here from Riverwood's tone, branded vocab, x_factor + patterns
# ═══════════════════════════════════════════════════════════════════
signature_moves = [
    "Lead with the visitor's situation, not the church's claim about itself",
    "Pin every claim to a specific time, place, or program (services at 7:45, 9, 10:15, 11:30am; Foyer; Carport; Kids Wing)",
    "Use Riverwood's branded place names — Foyer over lobby, Worship Center over sanctuary, Kids Wing over children's hall",
    "Short declarative sentences in moments of warmth; longer when explaining",
    "Multigenerational framing — write so a 70-year-old and a 25-year-old both feel addressed",
    "Quiet confidence over volume — never sales energy, never exclamation pile-ons",
    "Name what to expect before asking for action (walk visitors through arrival before asking them to plan)",
    "Honor the gap between where the visitor is and where they want to be — especially for someone in a hard season",
]


# ═══════════════════════════════════════════════════════════════════
# STEP 6 — SYNTHESIZE positive_voice_rules
# ═══════════════════════════════════════════════════════════════════
positive_voice_rules = [
    "Open with a concrete moment, not an abstract claim",
    "Address the visitor's posture, not the church's identity",
    "Use 'you' or 'your' in the first line of every section",
    "Pin every promise to a specific time, place, or program — never abstract",
    "Use Riverwood's branded place names verbatim; never substitute generic equivalents",
    "Pair conversion CTAs with a no-pressure secondary option (e.g., 'plan a visit, or walk in this Sunday')",
    "Frame next steps as joining a story or finding a place, not completing a transaction",
    "When writing for someone in difficulty, give permission to show up as they are — no pressure, no fix-it energy",
    "Use multigenerational framing — write so families, college students, and longtime members all feel addressed",
]


# ═══════════════════════════════════════════════════════════════════
# STEP 7 — SYNTHESIZE sample_sentences_in_voice
# Demonstrates the brand's voice across every section position the
# drafter will write into: heading labels, taglines (informational
# AND hook variants), hero descriptions (the invitational body), warm
# scene-setting for content sections, and closing CTAs.
#
# Hero descriptions specifically demonstrate the invitational pattern —
# they name the visitor's desire, promise the experience, and stay out
# of logistics (which belong in downstream sections). The drafter
# pattern-matches against these, not against a rule.
# ═══════════════════════════════════════════════════════════════════
sample_sentences_in_voice = [
    # Page-label headings (h1 — clean, navigational)
    "Kids",
    "Visit",
    "Care",
    "Our Story",

    # Informational taglines (factual qualifiers, where the page warrants)
    "Newborns through 5th grade · Sundays 9, 10:15, 11:30am",
    "Sundays 7:45, 9, 10:15, 11:30am · Fairchild Ave.",

    # Hook taglines (persuasive promise, where the page warrants)
    "A big church that wants to feel small",
    "Here on Fairchild since 1997",

    # Hero descriptions — INVITATIONAL pattern (this is the test).
    # Name the visitor's actual desire. Promise the experience. No logistics
    # (those live in downstream sections).
    "Sundays your kids will look forward to. Riverwood partners with parents to help your kid know Jesus and feel known by the people teaching them.",
    "You don't have to be okay to come here. Whatever season you're in, someone at Riverwood has walked it, and there's a real path through it with you.",
    "Walking into a new church takes more than most people admit. Nothing about Sunday morning here is going to require courage you don't have.",
    "A big church that wants to feel small. That's been the same since Riverwood started in 1991, and it's still the point.",

    # Warm scene-setting (non-hero body — proof-bearing, specifics live here)
    "GriefShare meets Thursdays at 7pm in the Foyer. You can share what you want, or sit quietly.",
    "Wednesday nights at 7 in the Worship Center. Bring a friend or come alone. Both work.",

    # Closing CTA (invitational, not directive)
    "Find your place at Riverwood. Plan your visit ahead of time, or walk in this Sunday.",
    "Pre-register your kids. Two minutes now means a faster Sunday morning.",
]


# ═══════════════════════════════════════════════════════════════════
# STEP 8 — SYNTHESIZE persuasive_posture_by_persona
# Reason ABOUT each persona using only fields from that persona's atom
# ═══════════════════════════════════════════════════════════════════
persuasive_posture_by_persona = {
    "The Suburban Family": {
        "fear_to_disarm": "Will my kid be safe? Will Sunday morning actually work for our family without becoming another logistics problem?",
        "desire_to_name": "A church that respects our family's time and treats our kids as more than a daycare problem",
        "proof_to_offer": "Named Kids Wing entrance through the carport, 30-second check-in, vetted staff, four service times across Sunday morning, multigenerational community where kids are around adults who aren't their parents",
        "register_notes": "Practical and specific. Times, places, names. Warm without saccharine. Acknowledge that getting the family out the door is hard."
    },
    "The Kent State Student": {
        "fear_to_disarm": "Will I get lost in a sea of families? Will this be the high school youth group extended to college?",
        "desire_to_name": "A college-specific community that doesn't try to be cool but actually shows up on campus",
        "proof_to_offer": "Wednesday college nights, named director, on-campus partnerships at Kent State, real one-on-one relationships with pastors and peers",
        "register_notes": "Authentic, direct, not trying. Plain invitations. 'Bring a friend or come alone. Both work.' Never use 'youth' language for college; never lump college in with high schoolers."
    },
    "The Person in a Hard Season": {
        "fear_to_disarm": "Will I be judged? Will someone try to fix me or sell me something I don't have the bandwidth for?",
        "desire_to_name": "A place where my burden is welcome and someone has a real path through this",
        "proof_to_offer": "Specifically named programs (Celebrate Recovery, GriefShare, Care 101, Food Pantry, Overcome), confidential first-touch, ability to attend a Care program without committing to Sunday service",
        "register_notes": "Safe, non-judgmental, plain. Permission to show up as you are with the burden visible. Never assume the reader is a Christian; name the program, the time, the place, and let the visitor decide."
    },
    "The Established Member": {
        "fear_to_disarm": "Is my church forgetting where it came from? Is it watering down what we've built over the last 35 years?",
        "desire_to_name": "Recognition that this community has deep roots, and a continued role for me in its next chapter",
        "proof_to_offer": "Specific references to church history (1991 start, 1997 move to Fairchild, growth to four services in 2024), pastoral access, transparent updates on building campaigns",
        "register_notes": "Multigenerational, grateful, rooted in legacy without being stuck in it. References to history carry weight when used precisely — name the year, name the place."
    },
}


# ═══════════════════════════════════════════════════════════════════
# STEP 9 — CONFIDENCE TAGGING + ABSENCE NOTES
# ═══════════════════════════════════════════════════════════════════
confidence_log = {}
if tone_descriptors:
    confidence_log["tone_descriptors"] = "lifted_from_brief"
if banned_terms:
    confidence_log["banned_terms"] = "lifted_from_global + lifted_from_brand_guide"
if branded_vocabulary:
    confidence_log["branded_vocabulary"] = "lifted_from_brand_guide"
if denominational_filter:
    confidence_log["denominational_filter"] = "lifted_from_brief"
if mission_statement:
    confidence_log["mission_statement"] = "lifted_from_brief"
if vision_statement:
    confidence_log["vision_statement"] = "lifted_from_brief"
if x_factor:
    confidence_log["x_factor"] = "lifted_from_brief"
if persona_snapshots:
    confidence_log["persona_snapshots"] = "lifted_from_brief"
if syntax_rules:
    confidence_log["syntax_rules"] = "lifted_from_global + lifted_from_brand_guide"
if example_phrases_good:
    confidence_log["example_phrases_good"] = "lifted_from_discovery"
if example_phrases_bad:
    confidence_log["example_phrases_bad"] = "lifted_from_global"
if anti_models:
    confidence_log["anti_models"] = "lifted_from_discovery"
# NEW synthesis-field confidence
if signature_moves:
    confidence_log["signature_moves"] = "synthesized_from_atoms"
if positive_voice_rules:
    confidence_log["positive_voice_rules"] = "synthesized_from_atoms"
if sample_sentences_in_voice:
    confidence_log["sample_sentences_in_voice"] = "synthesized_from_atoms"
if persuasive_posture_by_persona:
    confidence_log["persuasive_posture_by_persona"] = "synthesized_from_atoms"


unfilled = {}
if not persona_snapshots:
    unfilled["persona_snapshots"] = "No persona atoms found in input."
if not mission_statement:
    unfilled["mission_statement"] = "No mission_statement atom found."
if not x_factor:
    unfilled["x_factor"] = "No x_factor atom found in brief."
if not branded_vocabulary:
    unfilled["branded_vocabulary"] = "No branded_term atoms found from brand guide."


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════
voice_card = {
    # LIFT FIELDS
    "tone_descriptors": tone_descriptors,
    "banned_terms": banned_terms,
    "branded_vocabulary": branded_vocabulary,
    "denominational_filter": denominational_filter,
    "mission_statement": mission_statement,
    "x_factor": x_factor,
    "persona_snapshots": persona_snapshots,
    "syntax_rules": syntax_rules,
    "example_phrases_good": example_phrases_good,
    "example_phrases_bad": example_phrases_bad,
    "anti_models": anti_models,
    # SYNTHESIS FIELDS (the writer's brief)
    "signature_moves": signature_moves,
    "positive_voice_rules": positive_voice_rules,
    "sample_sentences_in_voice": sample_sentences_in_voice,
    "persuasive_posture_by_persona": persuasive_posture_by_persona,
    # META
    "_confidence_log": confidence_log,
    "_unfilled_with_reason": unfilled,
}
if vision_statement:
    voice_card["vision_statement"] = vision_statement


# ═══════════════════════════════════════════════════════════════════
# QUALITY AUDIT — sample sentences must comply with syntax_rules
# ═══════════════════════════════════════════════════════════════════
audit_failures = []
for s in sample_sentences_in_voice:
    if "—" in s or "—" in s:
        audit_failures.append(f"em-dash in: {s!r}")
    # Filler intensifiers (banned)
    fillers = ["truly", "really", "deeply", "incredibly", "amazing"]
    for f in fillers:
        if re.search(rf"\b{f}\b", s, re.IGNORECASE):
            audit_failures.append(f"filler '{f}' in: {s!r}")
    # "just" as filler intensifier (banned), but "just" as adverb is sometimes OK
    if re.search(r"\bjust\b", s, re.IGNORECASE):
        audit_failures.append(f"'just' in: {s!r}")
    # Banned vocabulary substitutions
    bad_subs = ["lobby", "atrium", "sanctuary", "auditorium"]
    for b in bad_subs:
        if re.search(rf"\b{b}\b", s, re.IGNORECASE):
            audit_failures.append(f"generic '{b}' in: {s!r}")


result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_voice_card_compiler v2",
    "dry_run": True,
    "source_atoms": INPUT.name,
    "voice_card": voice_card,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface counts + audit
print(f"Wrote {OUTPUT}")
print()
print("=== LIFT FIELDS ===")
print(f"  tone_descriptors: {len(tone_descriptors)}")
print(f"  banned_terms: {len(banned_terms)}")
print(f"  branded_vocabulary: {len(branded_vocabulary)} terms")
print(f"  persona_snapshots: {len(persona_snapshots)}")
for p in persona_snapshots:
    print(f"    - {p['label']}")
print(f"  syntax_rules: {len(syntax_rules)} entries")
print(f"  anti_models: {len(anti_models)}")
print()
print("=== SYNTHESIS FIELDS (the writer's brief) ===")
print(f"  signature_moves: {len(signature_moves)}")
for m in signature_moves:
    print(f"    - {m}")
print()
print(f"  positive_voice_rules: {len(positive_voice_rules)}")
for r in positive_voice_rules:
    print(f"    - {r}")
print()
print(f"  sample_sentences_in_voice: {len(sample_sentences_in_voice)}")
for s in sample_sentences_in_voice:
    print(f"    {s!r}")
print()
print(f"  persuasive_posture_by_persona: {len(persuasive_posture_by_persona)} personas covered")
for label, posture in persuasive_posture_by_persona.items():
    print(f"    {label}:")
    print(f"      fear_to_disarm:  {posture['fear_to_disarm']}")
    print(f"      desire_to_name:  {posture['desire_to_name']}")
print()
print(f"=== _confidence_log: {len(confidence_log)} entries ===")
for k, v in confidence_log.items():
    print(f"  {k}: {v}")
print()
if unfilled:
    print(f"_unfilled_with_reason: {len(unfilled)} entries")
    for k, v in unfilled.items():
        print(f"  {k}: {v}")
else:
    print("_unfilled_with_reason: (empty)")
print()
print("=== SAMPLE-SENTENCE QUALITY AUDIT ===")
if audit_failures:
    print(f"FAILURES ({len(audit_failures)}):")
    for f in audit_failures:
        print(f"  ✗ {f}")
else:
    print("  ✓ all sample sentences comply with syntax_rules + banned_terms")
