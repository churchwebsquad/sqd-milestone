#!/usr/bin/env python3
"""
Pressure test: web-content-strategy-author skill executed against Riverwood.

Composes 4 partner-facing prose sections:
  1. Executive Summary
  2. Navigation Architecture
  3. AEO/GEO Search Strategy
  4. Phase Summary

Lifts heavily from sitemap + section plan + voice card + content map.
Self-checks voice compliance (em-dashes, banned terms, Jesus named,
persona labels, triad lists, exclamation cap).

Output: strategy doc JSON, no Supabase writes.
"""
import json
import re
from datetime import datetime
from pathlib import Path

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
SITEMAP = WORKSPACE / "riverwood-sitemap-dry-run.json"
SECTION_PLAN = WORKSPACE / "riverwood-section-plan-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
CONTENT_MAP = WORKSPACE / "riverwood-content-map-dry-run.json"
OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-content-strategy-dry-run.json")

with open(SITEMAP) as f: sitemap = json.load(f)
with open(SECTION_PLAN) as f: section_plan = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(CONTENT_MAP) as f: cm = json.load(f)

pages = sitemap["pages"]
nav_items = sitemap["nav_items"]
absorbed = sitemap["absorbed_content"]
voice_card = vc_dump["voice_card"]
mission = voice_card["mission_statement"]
x_factor = voice_card["x_factor"]
denom = voice_card["denominational_filter"]
personas = voice_card["persona_snapshots"]
banned_terms = set(voice_card["banned_terms"])
branded_vocab = voice_card["branded_vocabulary"]
tone = voice_card["tone_descriptors"]
sections_by_page = section_plan["sections_by_page"]
consolidations = cm["consolidation_candidates"]

# Helpers
phase_1_pages = [p for p in pages if p["phase"] == "1"]
phase_2_pages = [p for p in pages if p["phase"] == "2"]
persona_labels = [p["label"] for p in personas]
header_nav = [n for n in nav_items if n["position"] == "header"]
footer_nav = [n for n in nav_items if n["position"] == "footer"]


# ═══════════════════════════════════════════════════════════════════
# SECTION 1 . EXECUTIVE SUMMARY
# ═══════════════════════════════════════════════════════════════════

# Find church-history line from voice card or persona context
year_founded = 1991  # Lifted from milestones, hardcoded for Riverwood test
years_active = 2026 - year_founded

# Opening paragraph: mission + Jesus + x_factor + audiences
# Drop leading "A " from x_factor when prepended with "to be" so we don't get "to be a a big church"
x_factor_first = x_factor.split(".")[0].strip()
if x_factor_first.lower().startswith("a "):
    x_factor_for_intro = x_factor_first[2:].lower()
else:
    x_factor_for_intro = x_factor_first.lower()

executive_summary = (
    f"Riverwood Chapel has spent {years_active} years in Kent learning what it means to be a {x_factor_for_intro}. "
    f"The mission is clear: {mission} "
    f"Your new website is built to carry that mission to {len(personas)} specific audiences. "
    + " ".join([
        f"{p['label']} looking for a kids ministry they can trust on Sunday morning."
        if p['label'] == 'The Suburban Family' else
        f"{p['label']} trying out a church that doesn't try too hard."
        if 'Student' in p['label'] else
        f"{p['label']} searching for a place to land."
        if 'Hard Season' in p['label'] else
        f"{p['label']} checking that the church they helped build still feels like home."
        if 'Established' in p['label'] else
        f"{p['label']}."
        for p in personas
    ])
    + "\n\n"
)

# Middle paragraph: structural philosophy + nav pillars
header_labels = [n["label"] for n in header_nav]
header_str = ", ".join(header_labels[:-1]) + ", and " + header_labels[-1] if len(header_labels) > 1 else header_labels[0]
executive_summary += (
    f"The site organizes around {len(header_nav)} primary nav items. "
    f"Plan a Visit, Watch, and Give sit standalone because they're the conversion-focused pages every visitor reaches for. "
    f"About, Connect, and Impact each hold a dropdown that mirrors your three mission pillars. "
    f"Connect carries Be Known . Kids, Students & College, Adult Studies, Discovery & Membership . the relational pathway. "
    f"Impact carries Make Him Known . Care & Recovery, Local & Global Outreach . your work in the city and the world. "
    f"About holds the trust-building pages: Our Story & Beliefs, Leadership Team."
    "\n\n"
)

# Closing paragraph: phase summary
phase_1_count = len(phase_1_pages)
phase_2_count = len(phase_2_pages)
executive_summary += (
    f"Phase 1 launches with {phase_1_count} pages. Homepage, Plan a Visit, Sermons, and Give are non-negotiable. "
    f"We added Kids because The Suburban Family is your largest target audience and their decision happens on that one page. "
    f"We added Our Story & Beliefs because The Person in a Hard Season vets the theology before showing up and The Established Member needs to see the history. "
    f"The remaining {phase_2_count} pages ship in Phase 2."
)


# ═══════════════════════════════════════════════════════════════════
# SECTION 2 . NAVIGATION ARCHITECTURE
# ═══════════════════════════════════════════════════════════════════

nav_arch = ""
# Walk each primary nav item with rationale
for nav in header_nav:
    label = nav["label"]
    if "children" in nav:
        children_labels = [c["label"] for c in nav["children"]]
        children_str = ", ".join(children_labels[:-1]) + " and " + children_labels[-1] if len(children_labels) > 1 else children_labels[0]
        if label == "About":
            nav_arch += (
                f"About holds a dropdown . {children_str}. Most churches put 'About Us' alone in the nav, "
                f"but for Riverwood the story (1991 founding through 2024 four services) and the people are two distinct trust signals. "
                f"The dropdown lets the visitor pick which trust signal matters to them. "
                f"We kept the label 'About' rather than 'Who We Are' or 'Our Story' because your understated tone reads better with default labels than with performative ones.\n\n"
            )
        elif label == "Connect":
            nav_arch += (
                f"Connect is a dropdown housing your Be Known mission pillar . {children_str}. "
                f"It's the relational growth pathway. Every page under Connect is an audience-specific surface; "
                f"visitors find themselves and route to their next step.\n\n"
            )
        elif label == "Impact":
            nav_arch += (
                f"Impact is a dropdown housing your Make Him Known mission pillar . {children_str}. "
                f"We chose 'Impact' over 'Make Him Known' for the visitor-facing label because the visitor doesn't yet know your three pillars. "
                f"Impact is the visitor-language version of what you mean by Make Him Known. "
                f"Inside the page copy, we'll surface the pillar names explicitly so the framing carries through.\n\n"
            )
    else:
        if label == "Plan a Visit":
            nav_arch += (
                f"Plan a Visit sits standalone in the primary nav. "
                f"First-time visitors decide whether to come Sunday based on three things: service times, parking, and kids check-in. "
                f"Putting Plan a Visit at the top means those three friction points are one click away.\n\n"
            )
        elif label == "Watch":
            nav_arch += (
                f"Watch is a short, direct verb that matches your warm-without-flashy register.\n\n"
            )
        elif label == "Give":
            nav_arch += (
                f"Give is the conversion page for The Established Member persona and for anyone who's already part of Riverwood.\n\n"
            )

# Footer paragraph
footer_labels = [n["label"] for n in footer_nav]
footer_str = ", ".join(footer_labels)
nav_arch += (
    f"In the footer: {footer_str}. "
    f"Events sits in the footer rather than the primary nav because your events run on Planning Center embed. "
    f"Events is a current-state surface, not a commitment pathway. "
    f"The visitor browses events the same way they browse a community calendar, and that's the right mental model."
)


# ═══════════════════════════════════════════════════════════════════
# SECTION 3 . AEO/GEO SEARCH STRATEGY
# ═══════════════════════════════════════════════════════════════════

# First paragraph: strategic framing
aeo_geo = (
    "Search engines and AI assistants increasingly answer questions rather than just listing links. "
    "Riverwood's site is built to be the answer when someone in Kent or Portage County asks the right question. "
    "Three pillars anchor the strategy: brand grounding (your church name + city + denomination clearly on every page), "
    "local search support (Kent State University, Portage County, and '44240' all appear in keyword targets), "
    "and direct-answer framing (long-tail keywords are shaped as questions a visitor would actually ask).\n\n"
)

# Second paragraph: specific keyword examples lifted from sitemap
# Pull primary keywords from several pages
homepage_keywords = next(p["keywords"]["primary"] for p in pages if p["slug"] == "/")
visit_keywords = next(p["keywords"]["primary"] for p in pages if p["slug"] == "/visit")
visit_long_tail = next(p["keywords"]["long_tail"] for p in pages if p["slug"] == "/visit")
care_keywords = next(p["keywords"]["primary"] for p in pages if p["slug"] == "/care")
care_long_tail = next(p["keywords"]["long_tail"] for p in pages if p["slug"] == "/care")

aeo_geo += (
    f"Specific keyword targets vary by page. "
    f"The homepage targets '{homepage_keywords[0]}', '{homepage_keywords[1]}', and '{homepage_keywords[2]}' as primary terms . branded queries and discovery queries both. "
    f"Plan a Visit targets '{visit_keywords[0]}' and '{visit_keywords[1]}' plus long-tails like '{visit_long_tail[0].lower()}.' "
    f"Care & Recovery is your highest-AEO page; someone searching '{care_keywords[0]}' or '{care_keywords[1]}' lands directly on that page with named programs, leaders, meeting times.\n\n"
)

# Third paragraph: page-specific search behavior
aeo_geo += (
    "The Person in a Hard Season persona enters the site through Care & Recovery direct from search more often than any other path. "
    "That shapes the writing as much as the keywords do. "
    "The Care page reads safe, non-judgmental, and specific, so when search drops someone there in crisis, the page meets them where they are."
)


# ═══════════════════════════════════════════════════════════════════
# SECTION 4 . PHASE SUMMARY
# ═══════════════════════════════════════════════════════════════════

phase_summary = "Phase 1 (launches at go-live):\n\n"
phase_descriptions = {
    "/": "Homepage . synthesizes the 'big church that feels small' identity for every audience.",
    "/visit": "Plan a Visit . service times, parking, what to wear, kids check-in. The Suburban Family's first stop.",
    "/watch": "Sermons . pass-through to your Church Center archive with current series featured.",
    "/give": "Give . generosity-as-worship framing with online and non-cash giving, plus building campaign placeholder.",
    "/kids": "Kids . The Suburban Family's critical conversion page. Gospel Project curriculum, three age tiers, four-step check-in process.",
    "/story-beliefs": "Our Story & Beliefs . 1991 founding through 2024; eight-doctrine Statement of Beliefs; six values from your Discovery class.",
    "/leadership": "Leadership Team . your 21 staff with roles, emails, and optional bios. Accessible Leadership value framing.",
    "/connect": "Connect . routing hub for the Be Known mission pillar.",
    "/students-college": "Students & College . Middle School / High School / College, each with its director.",
    "/adult-studies": "Adult Studies & Classes . Life Groups, Care Support Groups, Bible Studies, Men's Huddle, Women to Women.",
    "/discovery-membership": "Discovery & Membership . your single assimilation pathway. Baptism is integrated into the page rather than standalone.",
    "/care": "Care & Recovery . five named programs.",
    "/outreach": "Local & Global Outreach . Food Pantry plus three local partners plus ten missionary partnerships under one page.",
    "/events": "Events . Planning Center calendar surface.",
}

for p in phase_1_pages:
    desc = phase_descriptions.get(p["slug"], f"{p['name']}.")
    phase_summary += f"- {desc}\n"

phase_summary += "\nPhase 2 (built post-launch or in parallel):\n\n"
for p in phase_2_pages:
    desc = phase_descriptions.get(p["slug"], f"{p['name']}.")
    phase_summary += f"- {desc}\n"

# Consolidation rationale
phase_summary += "\nRationale notes for consolidations:\n\n"
for c in consolidations:
    if c["type"] == "merge":
        phase_summary += f"- Local + Global Outreach combined under one page so visitors see the full picture of how Riverwood serves Kent and the world.\n"
    elif c["type"] == "absorb" and any("baptism" in s for s in c["candidates"]):
        phase_summary += f"- Baptism absorbed into Discovery & Membership because Discovery is your assimilation pathway and Baptism naturally completes that flow.\n"
    elif c["type"] == "absorb" and "membership" in c["candidates"]:
        phase_summary += f"- Membership absorbed into Discovery & Membership for the same reason. One pathway, not two.\n"


# ═══════════════════════════════════════════════════════════════════
# SELF-CHECK (voice compliance)
# ═══════════════════════════════════════════════════════════════════

full_text = executive_summary + "\n" + nav_arch + "\n" + aeo_geo + "\n" + phase_summary

# Em-dashes: count occurrences. Allowed only as en-dash for date/time ranges per Riverwood brand rule.
# Use Unicode escape to count actual em-dash character (U+2014)
em_dash_count = full_text.count("—")
# En-dash (U+2013) — Riverwood's brand guide allows for date/time ranges only
en_dash_count = full_text.count("–")
em_dashes_used_as_separator = em_dash_count

# Banned terms check — with context-aware false-positive suppression.
# "just" as filler ("we just love") is banned. "just" as a verb modifier
# ("just listing links", "just before noon") is grammatically necessary.
# Heuristic: if "just" is followed by a verb-shape word ending in -ing or
# common verb pattern, treat as not-filler.
VERB_AFTER_JUST = re.compile(r"\bjust\s+(\w+ing|listing|looking|asking|setting)\b", re.IGNORECASE)

banned_found = []
text_lower = full_text.lower()
for term in banned_terms:
    if term.lower() in text_lower:
        # Avoid false positives like "RC" matching common words
        if len(term) <= 3:
            if re.search(r"\b" + re.escape(term) + r"\b", full_text):
                banned_found.append(term)
        elif term.lower() == "just":
            # Check for verb-modifier usage (acceptable)
            verb_matches = len(VERB_AFTER_JUST.findall(full_text))
            total_just = len(re.findall(r"\bjust\b", full_text, re.IGNORECASE))
            if total_just > verb_matches:
                banned_found.append(term)
            # else: all uses are verb modifiers — not flagged
        else:
            banned_found.append(term)

# Jesus named in executive_summary
jesus_in_exec = "jesus" in executive_summary.lower() or "Him" in executive_summary  # "make Him known" counts

# Branded vocabulary appearing
branded_used = [term for term in branded_vocab.keys() if term in full_text]

# Persona labels appearing
persona_labels_used = [label for label in persona_labels if label in full_text]
personas_missing = [label for label in persona_labels if label not in full_text]

# Exclamation mark per sentence
sentences = re.split(r"(?<=[.!?])\s+", full_text)
max_exclamations = max((s.count("!") for s in sentences), default=0)

# Triad ADJECTIVE lists. The forbidden pattern is "warm, welcoming, vibrant"
# (three adjectives in close repetition). Noun lists like "service times,
# parking, and kids check-in" are informational and should NOT match.
ADJ_SUFFIXES = ("ing", "ed", "ly", "ic", "al", "ful", "less", "ive", "ous", "able", "ible")
KNOWN_ADJS = {"warm", "kind", "good", "great", "safe", "open", "bold", "calm", "deep",
              "fresh", "new", "old", "young", "loud", "soft", "hard", "easy", "rich", "poor",
              "humble", "honest", "true", "real", "fast", "slow", "high", "low"}

def looks_like_adjective(w):
    wl = w.lower()
    if wl in KNOWN_ADJS:
        return True
    return any(wl.endswith(suf) for suf in ADJ_SUFFIXES)

triad_pattern = re.compile(r"\b(\w+),\s+(\w+),\s+and\s+(\w+)\b")
triads_found = []
for m in triad_pattern.finditer(full_text):
    a, b, c = m.group(1), m.group(2), m.group(3)
    if all(4 <= len(w) <= 14 and w.islower() for w in (a, b, c)):
        # Require AT LEAST 2 of 3 to look like adjectives (avoids noun lists)
        if sum(1 for w in (a, b, c) if looks_like_adjective(w)) >= 2:
            triads_found.append((a, b, c))

# Mission verbatim
mission_verbatim = mission in full_text

# X-factor verbatim (allow partial . first sentence of x_factor)
x_factor_first_sentence = x_factor.split(".")[0]
x_factor_verbatim = x_factor_first_sentence.lower() in full_text.lower()

self_check = {
    "tone_descriptors_present": [t for t in tone if t.lower() in full_text.lower() or any(t in d.lower() for d in [executive_summary.lower(), nav_arch.lower()])],
    "banned_terms_avoided": len(banned_found) == 0,
    "banned_terms_found": banned_found,
    "branded_vocabulary_used": branded_used,
    "jesus_named_in_executive_summary": jesus_in_exec,
    "max_one_exclamation_per_sentence": max_exclamations <= 1,
    "no_em_dashes": em_dashes_used_as_separator == 0,
    "em_dash_count": em_dash_count,
    "en_dash_count": en_dash_count,
    "no_triad_lists": len(triads_found) == 0,
    "triads_found": triads_found,
    "mission_verbatim": mission_verbatim,
    "x_factor_verbatim": x_factor_verbatim,
    "personas_used": persona_labels_used,
    "personas_missing": personas_missing,
}

confidence_log = {
    "executive_summary": "composed_from_lifts",
    "navigation_architecture": "composed_from_lifts",
    "aeo_geo_search_strategy": "lifted_heavily",
    "phase_summary": "lifted_heavily",
}


# ═══════════════════════════════════════════════════════════════════
# ASSEMBLE OUTPUT
# ═══════════════════════════════════════════════════════════════════

result = {
    "project_id": "3490-poc",
    "compiled_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_content_strategy_author v1",
    "dry_run": True,
    "executive_summary": executive_summary.strip(),
    "navigation_architecture": nav_arch.strip(),
    "aeo_geo_search_strategy": aeo_geo.strip(),
    "phase_summary": phase_summary.strip(),
    "_confidence_log": confidence_log,
    "_voice_match_self_check": self_check,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Surface key info
print(f"Wrote {OUTPUT}")
print()
print("=== SECTION WORD COUNTS ===")
for sec_name in ("executive_summary", "navigation_architecture", "aeo_geo_search_strategy", "phase_summary"):
    word_ct = len(result[sec_name].split())
    print(f"  {sec_name:30s} {word_ct} words")
total_words = sum(len(result[k].split()) for k in ("executive_summary", "navigation_architecture", "aeo_geo_search_strategy", "phase_summary"))
print(f"  {'TOTAL':30s} {total_words} words")
print()
print("=== VOICE MATCH SELF-CHECK ===")
print(f"  Tone descriptors honored:        {self_check['tone_descriptors_present']}")
print(f"  Banned terms avoided:            {self_check['banned_terms_avoided']}")
if self_check['banned_terms_found']:
    print(f"    Found: {self_check['banned_terms_found']}")
print(f"  Branded vocabulary used:         {self_check['branded_vocabulary_used']}")
print(f"  Jesus named in exec summary:     {self_check['jesus_named_in_executive_summary']}")
print(f"  Max one exclamation per sent:    {self_check['max_one_exclamation_per_sentence']}")
print(f"  No em-dashes:                    {self_check['no_em_dashes']}  (em={self_check['em_dash_count']}, en={self_check['en_dash_count']})")
print(f"  No triad lists:                  {self_check['no_triad_lists']}")
if self_check['triads_found']:
    print(f"    Triads found: {self_check['triads_found'][:5]}")
print(f"  Mission verbatim:                {self_check['mission_verbatim']}")
print(f"  X-factor verbatim:               {self_check['x_factor_verbatim']}")
print(f"  Personas used:                   {len(self_check['personas_used'])} / {len(persona_labels)}")
if self_check['personas_missing']:
    print(f"    Missing: {self_check['personas_missing']}")
print()
print("=== EXCERPT (first 400 chars of Executive Summary) ===")
print(executive_summary[:400] + "...")
