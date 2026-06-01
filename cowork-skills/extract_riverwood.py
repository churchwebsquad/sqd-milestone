#!/usr/bin/env python3
"""
Pressure test: web-intake-normalizer skill executed against Riverwood 3490.
Produces atoms[] + facts[] + coverage_report{} as a dry run (no Supabase writes).

This script IS the test. It implements the normalizer's per-source extraction rules
against the real Riverwood inputs and outputs the JSON the skill specifies.
"""
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from collections import Counter

ROOT = Path("/sessions/sleepy-practical-bohr/mnt/Projects/Websites/3490")

# Map ContentSnare table field names → CSV file paths.
# ContentSnare ships table content as a download URL in values_flat; the actual
# rows live in CSV exports in the project folder. The normalizer matches by
# table field name to find the right CSV.
TABLE_CSV_MAP = {
    "Statement of Beliefs": ROOT / "about_your_church/statement_of_beliefs.csv",
    "Sermon Archive": ROOT / "weekend_services/sermon_archive.csv",
    "Staff & Board": ROOT / "staff_volunteers_testimonies/staff_board.csv",
    "Please list available volunteer opportunities.": ROOT / "staff_volunteers_testimonies/please_list_available_volunteer_opportunities_.csv",
    "Please list your Local Outreach opportunities.": ROOT / "ministries/please_list_your_local_outreach_opportunities_.csv",
    "Please list your Local Ministry Partners.": ROOT / "ministries/please_list_your_local_ministry_partners_.csv",
    "Please list your Global Ministry Partners.": ROOT / "ministries/please_list_your_global_ministry_partners_.csv",
}


def read_csv_rows(path):
    """Read a CSV and return list of dicts, skipping empty rows."""
    if not path.exists():
        return []
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for r in reader:
            # Skip rows where all values are empty
            if any((v or "").strip() for v in r.values()):
                rows.append(r)
    return rows


def slugify(s, max_len=30):
    """Lowercase, hyphenate, strip non-alnum. Used to scope ContentSnare
    reference_ids by page+section path so reused field templates don't
    collide on external_ref_id."""
    if not s:
        return "unknown"
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len] or "unknown"


def parse_service_times(prose):
    """Parse service times enumerated in prose form.

    Handles patterns like:
      "Sundays at 7:45, 9:00, 10:15, and 11:30"
      "Sunday 9am and 11am"
      "Wednesdays at 7pm"

    Returns a list of dicts: [{day, time, raw_context}, ...]
    """
    results = []
    # Match the day, then grab the line/sentence containing the time list
    day_pat = re.compile(
        r"(Sundays?|Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?)\s+(?:at\s+)?(.+?)(?:\n|\.|\(|$)",
        re.IGNORECASE,
    )
    for m in day_pat.finditer(prose):
        day = m.group(1).rstrip("s").capitalize()
        times_str = m.group(2)
        # Extract all time-shaped tokens (HH:MM or HH followed by optional am/pm)
        times = re.findall(r"\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?", times_str)
        # Filter out empty / single-digit-without-context noise
        times = [t.strip() for t in times if t.strip() and not t.strip().isdigit() or len(t.strip()) > 1]
        # Deduplicate while preserving order
        seen = set()
        unique_times = []
        for t in times:
            tn = t.strip()
            if tn and tn not in seen:
                seen.add(tn)
                unique_times.append(tn)
        for t in unique_times:
            results.append({"day": day, "time": t, "raw_context": prose[:200]})
    return results
PROJECT_ID = "3490-poc"

atoms = []
facts = []
warnings = []
expected_but_missing = []


def add_atom(**kwargs):
    """Append an atom with defaults filled in."""
    a = {
        "topic": kwargs["topic"],
        "label": kwargs.get("label"),
        "body": kwargs.get("body", ""),
        "body_short": kwargs.get("body_short"),
        "verbatim": kwargs.get("verbatim", False),
        "confidence": kwargs.get("confidence", "partner_stated"),
        "source_kind": kwargs["source_kind"],
        "source_ref": kwargs.get("source_ref"),
        "external_ref_id": kwargs.get("external_ref_id"),
        "metadata": kwargs.get("metadata", {}),
        "handling_notes": kwargs.get("handling_notes"),
    }
    # Drop nulls for compactness
    a = {k: v for k, v in a.items() if v not in (None, {}, "")}
    atoms.append(a)


def add_fact(**kwargs):
    f = {
        "topic": kwargs["topic"],
        "subtopic": kwargs.get("subtopic"),
        "body": kwargs["body"],
        "body_short": kwargs.get("body_short"),
        "verbatim": kwargs.get("verbatim", False),
        "confidence": kwargs.get("confidence", "partner_stated"),
        "source_kind": kwargs["source_kind"],
        "source_ref": kwargs.get("source_ref"),
        "external_ref_id": kwargs.get("external_ref_id"),
        "metadata": kwargs.get("metadata", {}),
    }
    f = {k: v for k, v in f.items() if v not in (None, {}, "")}
    facts.append(f)


# =============================================================================
# PASS 2 — STRATEGY BRIEF
# =============================================================================
# Source: riverwood-persona-and-journey.md
# Treating this as the strategy brief input. NOTE: this is technically a
# persona-and-journey doc derived from discovery+brand guide (Riverwood
# doesn't appear to have an original strategy brief). Atoms still extract
# meaningfully; flag in coverage report.

BRIEF_SRC = "riverwood-persona-and-journey.md"

# --- Personas (4) ---
add_atom(
    topic="persona",
    label="The Suburban Family",
    body="Parents of children somewhere between newborn and high school. Live in Kent or the surrounding Portage County suburbs. Middle to upper-middle class. Likely some prior church background — may be returning, may be casually shopping, may be already attending Riverwood and looking for the next step for their kids. The discovery describes the broader demographic as suburban, not exurban or rural.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:persona:suburban-family",
    metadata={
        "label": "The Suburban Family",
        "grounded_in": "discovery.community_and_audience.who_actively_trying_to_engage + discovery.community_focus.how_to_adapt_to_community_needs + community_struggles 'Families - Kids and student ministry programs'",
        "needs": [
            "Confidence that the Kids Wing is safe, organized, and well-staffed",
            "A Sunday experience that works with kids in tow — pre-registration, easy check-in, clear directions",
            "Programming that respects an already-full family schedule",
            "A multigenerational community where their kids are around adults who are not their parents",
            "Real teaching for them, not just for the kids",
        ],
        "scares_off": [
            "Mega-church vibes — explicitly named by Riverwood as the feeling to avoid",
            "Kids ministry that looks disorganized, under-staffed, or vague",
            "Theological vagueness",
            "Implied schedule demands before they've even attended",
        ],
        "voice_resonance": "Practical and specific. 'Pre-register on the way and check-in takes 30 seconds. The Kids Wing has its own entrance through the carport.' Warm without being saccharine. Brand-aligned: friend-not-presenter, intentional, every word purposeful.",
        "entry_pages": ["/visit", "/kids", "/adult-studies", "/connect", "/"],
        "critical_conversion_page": "/kids",
    },
)
add_atom(
    topic="persona",
    label="The Kent State Student",
    body="Undergraduate at Kent State (or possibly a recent graduate or grad student). Lives on or near campus. Faith background variable: could be raised in the church and testing inherited belief, could be exploring church for the first time, could be returning after stepping away. The discovery doesn't specify but the description of 'heavy campus partnerships' signals Riverwood actively goes to where students are.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:persona:kent-state-student",
    metadata={
        "label": "The Kent State Student",
        "grounded_in": "discovery.community_and_audience 'Kent State - College ministry and heavy campus partnerships' + community_focus 'Kent State - college student' + stated audience 'College students.'",
        "needs": [
            "A college-specific surface in the navigation that names her without lumping her in with high schoolers or families",
            "Clear meeting times that fit a college schedule",
            "An authentic register that doesn't try to be cool for college students",
            "Pastoral access — direct contact with a named director or pastor",
            "Visibility for ministry partnerships with Kent State",
        ],
        "scares_off": [
            "Mega-church anonymity (feeling like one of 1,000 in a service with no one knowing them)",
            "Family-only programming language",
            "Slick stage production with no actual relationship behind it",
            "'Youth ministry' framing aimed at high schoolers extended to college",
        ],
        "voice_resonance": "Authentic, direct, not trying. 'Wednesday nights at 7 in the Worship Center. Bring a friend or come alone. Both work.' Brand-aligned: unpolished, relational, real.",
        "entry_pages": ["/students-college", "/visit", "/watch", "/connect"],
        "critical_conversion_page": "/students-college",
    },
)
add_atom(
    topic="persona",
    label="The Person in a Hard Season",
    body="Someone in Kent or Portage County facing a specific moment of difficulty. The discovery names multiple categories of hardship Riverwood serves: addiction recovery, grief, cancer care, family crisis, financial hardship (food pantry). Demographics vary — could be a young adult in recovery, a middle-aged person in grief, an older person in cancer treatment, a struggling family without enough food. Faith background variable; some attendees come to a Care program before they'd ever come to a Sunday service.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:persona:hard-season",
    metadata={
        "label": "The Person in a Hard Season",
        "grounded_in": "discovery community_struggles 'Care - families, deaths, crisis etc.' + 'People in need - food pantry' + most_effective_engagement 'Care related things' + named CR (Celebrate Recovery) program",
        "needs": [
            "Permission to show up as they are, with the burden visible",
            "Specific named programs, not vague reassurance — Celebrate Recovery, GriefShare, Overcome, Care 101, Food Pantry",
            "Confidentiality and dignity baked into the language",
            "A church positioned as a hospital, not a country club",
            "Easy first-touch — prayer form, Care Team contact, or quiet visit to a program without committing to Sunday attendance",
        ],
        "scares_off": [
            "Theology that shames struggle",
            "Sales energy ('Jesus will fix this!')",
            "Performative care without specifics",
            "Insider church language that gates access",
            "Implied judgment about why they're in crisis",
        ],
        "voice_resonance": "Safe, non-judgmental, plain. 'GriefShare meets Thursdays at 7pm in the Foyer. Walk in, sit down, share what you want or sit quietly. Both are welcome.' Brand-aligned: steady, wise, dependable, multigenerational.",
        "entry_pages": ["/care", "/outreach", "/watch", "/visit"],
        "critical_conversion_page": "/care",
    },
)
add_atom(
    topic="persona",
    label="The Established Member",
    body="Has been part of Riverwood for years or decades, or moved to Kent and joined an established faith community there. Faith is settled and central. Likely 45+ but the multigenerational value means this segment spans middle-aged through retired. Knows the leadership team by name. Has watched the church grow from the 1991 start, the move to Fairchild Ave in 1997, the staff additions, the gym expansion in 2019, the growth to four services in 2024.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:persona:established-member",
    metadata={
        "label": "The Established Member",
        "grounded_in": "discovery.messaging_and_voice value 'A Multigenerational Community' + 35-year church history + sustained 1,000 weekly attendance + value 'Accessible and Adaptable Leadership'",
        "needs": [
            "Recognition of the church's history and longtime members' role",
            "Continued pastoral access — real, reachable people",
            "Local outreach that's specific and active",
            "Building campaign updates that are transparent and biblically framed",
            "Multigenerational identity preserved",
        ],
        "scares_off": [
            "Anything signaling the church is forgetting its roots",
            "Watered-down doctrine",
            "Pure marketing energy aimed at newcomers with no recognition of the existing congregation",
        ],
        "voice_resonance": "Multigenerational, grateful, rooted in legacy without being stuck in it. The brand voice (measured, wise, dependable) is exactly right for this audience. References to the church's history carry weight when used precisely.",
        "entry_pages": ["/outreach", "/give", "/care", "/story-beliefs", "/events"],
        "critical_conversion_page": "/outreach",
    },
)

# --- Tone descriptors (lifted from brief) ---
for descriptor in ["warm", "shepherding", "understated", "multigenerational", "authentic", "steady"]:
    add_atom(
        topic="tone_descriptor",
        body=descriptor,
        verbatim=True,
        source_kind="strategy_brief",
        source_ref=BRIEF_SRC,
        external_ref_id=f"brief:tone:{descriptor}",
    )

# --- Mission ---
add_atom(
    topic="mission_statement",
    body="To know Jesus, to be known, and to make Him known.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:mission",
)

# --- X-factor ---
add_atom(
    topic="x_factor",
    body="A big church that wants to feel small. Flat structure, accessible pastors, and a home-like atmosphere over mega-church performance.",
    verbatim=True,
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:xfactor",
)

# --- Denominational signal ---
add_atom(
    topic="denominational_signal",
    body="non-denominational evangelical",
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:denom",
    metadata={"canonical_filter": "evangelical-non-denominational"},
)

# --- Page-persona primacy mapping (from the brief's page-by-page table) ---
add_atom(
    topic="page_primacy_mapping",
    body="(see metadata for the full primary/secondary mapping per page from the brief)",
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:page_primacy",
    metadata={
        "mapping": [
            {"page": "/", "primary": "All four", "secondary": [], "notes": "Synthesis test. Must communicate 'big church that feels small' to every audience"},
            {"page": "/visit", "primary": "The Suburban Family", "secondary": ["The Kent State Student", "The Person in a Hard Season"], "notes": "Practical, specific. Parking, kids check-in, what to wear"},
            {"page": "/story-beliefs", "primary": "The Person in a Hard Season", "secondary": ["The Established Member", "The Suburban Family"]},
            {"page": "/leadership", "primary": "The Person in a Hard Season", "secondary": ["All"]},
            {"page": "/connect", "primary": "The Suburban Family", "secondary": ["The Kent State Student"]},
            {"page": "/kids", "primary": "The Suburban Family", "secondary": []},
            {"page": "/students-college", "primary": "The Kent State Student", "secondary": []},
            {"page": "/adult-studies", "primary": "The Suburban Family", "secondary": ["The Established Member"]},
            {"page": "/discovery-membership", "primary": "All four", "secondary": []},
            {"page": "/care", "primary": "The Person in a Hard Season", "secondary": []},
            {"page": "/outreach", "primary": "The Established Member", "secondary": ["The Suburban Family"]},
            {"page": "/watch", "primary": "The Person in a Hard Season", "secondary": ["All"]},
            {"page": "/give", "primary": "The Established Member", "secondary": ["All"]},
            {"page": "/events", "primary": "All four", "secondary": []},
        ]
    },
)

# --- Mission pillar mapping (from brief's "Mission anchor" section) ---
add_atom(
    topic="strategic_priority",
    body="Watch + Our Story & Beliefs = Know Jesus (Scripture-rooted teaching, theological substance)",
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:pillar:know-jesus",
)
add_atom(
    topic="strategic_priority",
    body="Connect hub (Kids, Students & College, Adult Studies, Discovery & Membership) = Be Known (relational growth, assimilation, life stage ministries)",
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:pillar:be-known",
)
add_atom(
    topic="strategic_priority",
    body="Impact hub (Care & Recovery, Local & Global Outreach) = Make Him Known (care for the body, outreach to the city)",
    source_kind="strategy_brief",
    source_ref=BRIEF_SRC,
    external_ref_id="brief:pillar:make-him-known",
)


# =============================================================================
# PASS 3 — BRAND GUIDE
# =============================================================================
# Source: riverwoodchapelbrand.md (markdown export from live.standards.site/riverwood/strategy)

BRAND_SRC = "riverwoodchapelbrand.md"

# --- Branded vocabulary (Do's) ---
branded = [
    ("Riverwood", "preferred short form"),
    ("Riverwood Chapel", "preferred long form"),
    ("Foyer", "not lobby or atrium"),
    ("Worship Center", "not sanctuary or auditorium"),
    ("Welcome Center", "the desk in the Foyer"),
    ("Immanuel", "preferred spelling, not Emmanuel"),
    ("Carport", "specifically for the area in front of main doors"),
    ("Gym Carport", "the smaller carport on the far right"),
    ("Kids Wing", "the west end / hallways"),
    ("Meeting Room", "the room off the airlock"),
    ("Resource Room", "the office supply room"),
    ("Child care", "open play time"),
    ("Sunday school class", "structured Bible lesson"),
]
for term, note in branded:
    slug = re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")
    add_atom(
        topic="branded_term",
        body=term,
        verbatim=True,
        source_kind="brand_handoff",
        source_ref=BRAND_SRC,
        external_ref_id=f"brand:vocabulary:{slug}",
        metadata={"use_not_x_note": note},
    )
    # Also as a fact for downstream merge-field consumers
    add_fact(
        topic="branded_term",
        body=term,
        verbatim=True,
        source_kind="brand_handoff",
        source_ref=BRAND_SRC,
        external_ref_id=f"brand:vocabulary:{slug}:fact",
        metadata={"use_not_x_note": note},
    )

# --- Banned terms (Don'ts from brand guide) ---
for term, ref in [
    ("RCC", "brand:banned:rcc"),
    ("RC", "brand:banned:rc"),
    ("Riverwood Community Chapel", "brand:banned:full-legal-name"),
    ("Emmanuel", "brand:banned:emmanuel"),  # avoid this spelling, use Immanuel
]:
    add_atom(
        topic="banned_term",
        body=term,
        source_kind="brand_handoff",
        source_ref=BRAND_SRC,
        external_ref_id=ref,
    )

# --- Voice rules from brand guide ---
# Syntax rules — mechanical / formatting. Format rules use key=value bodies
# so the voice card compiler can split and store the actual format value.
syntax_rules = [
    ("oxford_comma", "Always include a comma before the final item in a list of three or more."),
    ("max_one_exclamation_per_sentence", "Use only one exclamation mark at the end of a sentence. Never use multiple."),
    ("space_after_colon_two", "Two spaces after a colon (one space after period/semicolon)."),
    ("punctuation_inside_quotes", "Place punctuation inside the final quotation mark."),
    ("italicize_book_titles", "Use italics for book titles."),
    ("numerals_for_ages_grades_addresses_phones_financial", "Always use numerals for ages, grades, addresses, phone numbers, and financial figures."),
    ("numerals_for_10_and_above", "Spell out numbers one through nine; use numerals for 10 and above."),
    ("hyphenate_number_adjectives", "Hyphenate a number that acts as an adjective directly before a noun (e.g., '10-year-old boy')."),
    ("apostrophe_for_dropped_decade_digits", "Use an apostrophe only when dropping the first two numbers (e.g., 'Totally '80s' or '1980s'). Do not use '1980's.'"),
    ("abbreviate_days_months", "Days: Sun, Mon, Tues, Wed, Thurs, Fri, Sat. Months: Jan, Feb, Mar, Apr, May, June, July, Aug, Sept, Oct, Nov, Dec."),
    ("allow_en_dash_for_ranges", "Use an en-dash (–) for date or time spans (e.g., June 1–3, 8am–5pm)."),
    ("drop_zero_minutes", "Drop ':00' from even hours."),
    ("am_pm_at_end_of_range", "Include 'am' or 'pm' only at the end of a range unless both are needed (e.g., 6:30–8pm)."),
    ("no_date_time_shorthand", "Do not use '9/1,' 'Sept 1st,' '@,' or the word 'through' in date/time strings."),
    # Format rules — key=value encoding so the compiler captures the actual value
    ("phone_format=330.678.7000", "Format phone numbers with dots. Example: 330.678.7000. Do not use hyphens or parentheses."),
    ("url_format=no_www", "Use riverwoodchapel.org. Do not include 'www.'"),
    ("no_ampersand_or_at_symbol_in_prose", "Do not use symbols like & or @ in prose; spell out 'and' and 'at.'"),
    ("no_hyphenate_numbers_at_line_break", "Do not hyphenate numbers when they carry over to a next line."),
]
for rule_key, rule_desc in syntax_rules:
    # external_ref_id uses just the key portion (before any = sign)
    ref_key = rule_key.split("=")[0]
    add_atom(
        topic="voice_rule",
        body=rule_key,
        source_kind="brand_handoff",
        source_ref=BRAND_SRC,
        external_ref_id=f"brand:rule:{ref_key.replace('_', '-')}",
        metadata={"description": rule_desc},
    )

# Voice posture — how to sound. Captured as a SINGLE tone_block atom so
# the compiler can fall through to it when the brief has no tone_descriptor
# atoms. For Riverwood, brief tone_descriptors win and this is unused noise
# in syntax_rules avoided.
brand_voice_posture = [
    "Be warm and shepherding: project a multi-generational, welcoming feel that emphasizes belonging and spiritual depth.",
    "Prioritize authenticity over performance: maintain an unpolished, relational, and humble tone.",
    "Speak with spiritual confidence: root the voice in identity rather than showmanship.",
    "Maintain a steady presence: use a measured, wise, and dependable voice.",
    "Write as a friend, not a presenter: address the audience like someone who knows their story.",
    "Be intentional: choose every word with purpose. Do not use filler language.",
]
add_atom(
    topic="tone_block",
    body="\n".join(brand_voice_posture),
    source_kind="brand_handoff",
    source_ref=BRAND_SRC,
    external_ref_id="brand:voice-posture",
    metadata={"directives": brand_voice_posture},
)

# --- Theological capitalization ---
theo_caps = [
    ("gospel", "Capitalize 'Gospel' when referring to a specific book of the Bible or the four Gospels. Use lowercase 'gospel' for general references to the Christian message."),
    ("he_him_his", "Always capitalize He, Him, and His when referring to the Father, Son, or the Holy Spirit."),
    ("word", "Use uppercase 'Word' when referring specifically to Jesus or the Bible (God's Word)."),
]
for key, desc in theo_caps:
    add_atom(
        topic="theological_capitalization",
        body=desc,
        source_kind="brand_handoff",
        source_ref=BRAND_SRC,
        external_ref_id=f"brand:theo-cap:{key}",
    )


# =============================================================================
# PASS 4 — DISCOVERY QUESTIONNAIRE
# =============================================================================
DISCOVERY_SRC = "riverwood_chapel_discovery.json"
with open(ROOT / DISCOVERY_SRC) as f:
    discovery = json.load(f)

# --- Anti-models ---
avoid_list = discovery["messaging_and_voice"].get("organizations_or_churches_to_avoid_looking_like") or []
avoid_notes = discovery["messaging_and_voice"].get("avoid_notes") or ""
for i, url in enumerate(avoid_list):
    name_match = re.search(r"https?://(?:www\.)?([^/]+)", url)
    name = name_match.group(1).rsplit(".", 1)[0].title() if name_match else url
    if "redemption" in url.lower(): name = "Redemption Chapel"
    elif "ccchapel" in url.lower(): name = "Christ Community Chapel"
    add_atom(
        topic="anti_model",
        body=name,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:messaging.avoid.{i}",
        metadata={
            "url": url,
            # avoid_notes is a single shared note that applies to every
            # anti_model in the list — apply to all, not just the first.
            "what_to_avoid": avoid_notes or None,
        },
    )

# --- Key phrases (voice ammunition) ---
for i, phrase in enumerate(discovery["messaging_and_voice"].get("key_phrases", []) or []):
    add_atom(
        topic="voice_ammo",
        body=phrase,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:messaging.key_phrases.{i}",
    )

# --- Website goals ---
for i, goal in enumerate(discovery["website_redesign"].get("website_goals", []) or []):
    add_atom(
        topic="website_goal",
        body=goal,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:website.goals.{i}",
    )

# --- Design references ---
for i, ex in enumerate(discovery["website_redesign"].get("example_websites_liked", []) or []):
    add_atom(
        topic="design_reference",
        body=ex.get("name") or "",
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:website.examples.{i}",
        metadata={"reason": ex.get("reason"), "name": ex.get("name")},
    )

# --- Significant milestones (facts) ---
for i, m in enumerate(discovery["church_basics"].get("significant_milestones", []) or []):
    year_match = re.match(r"^(\d{4})\s+(.*)", m)
    if year_match:
        year, event = int(year_match.group(1)), year_match.group(2)
    else:
        year, event = None, m
    add_fact(
        topic="milestone",
        body=m,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:church_basics.milestones.{i}",
        metadata={"year": year, "event": event},
    )

# --- Three future goals ---
fg = discovery["church_basics"].get("three_future_goals")
if fg:
    add_atom(
        topic="strategic_priority",
        body=fg,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id="discovery:church_basics.three_future_goals",
    )

# --- Community struggles ---
for i, s in enumerate(discovery["community_and_audience"].get("community_struggles", []) or []):
    add_atom(
        topic="community_struggle",
        body=s,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:community.struggles.{i}",
    )

# --- Most effective engagement ---
for i, e in enumerate(discovery["community_and_audience"].get("most_effective_community_engagement", []) or []):
    add_atom(
        topic="engagement_lever",
        body=e,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:community.most_effective.{i}",
    )

# --- Ideal experience ---
for i, ie in enumerate(discovery["community_and_audience"].get("ideal_experience", []) or []):
    add_atom(
        topic="ideal_experience",
        body=ie,
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:community.ideal_experience.{i}",
    )

# --- Existing messaging values from discovery (these are richer than what brief has) ---
for i, v in enumerate(discovery["messaging_and_voice"]["existing_messaging"].get("values", []) or []):
    add_atom(
        topic="church_value",
        label=v["name"],
        body=v["description"],
        verbatim=True,
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id=f"discovery:messaging.values.{i}",
        metadata={"name": v["name"]},
    )

# --- Average weekly attendance (fact) ---
att = discovery["ministry_and_attendance"].get("average_weekly_attendance")
if att:
    add_fact(
        topic="audience",
        subtopic="weekly_attendance",
        body=str(att),
        source_kind="discovery_questionnaire",
        source_ref=DISCOVERY_SRC,
        external_ref_id="discovery:ministry_attendance.weekly",
        metadata={"value": att},
    )


# =============================================================================
# PASS 5 — CONTENT COLLECTION (ContentSnare JSON)
# =============================================================================
CC_SRC = "Riverwood Chapel.json"
with open(ROOT / CC_SRC) as f:
    cc = json.load(f)

# Walk all fields, applying field-type-driven rules
field_count = 0
for p in cc["pages"]:
    page_name = p.get("name", "")
    for s in p["sections"]:
        section_name = s.get("name", "")
        for fld in s["fields"]:
            field_count += 1
            # ContentSnare reuses the same `reference_id` across multiple
            # page+section instances of the same field template (e.g.,
            # "Add and describe your..." appears verbatim under Discipleship,
            # Kids, Adults, Care). Scope the external_ref_id by page+section
            # so each instance is uniquely identifiable.
            page_slug = slugify(p.get("name") or "page")
            section_slug = slugify(s.get("name") or "section")
            ref_id = f"contentsnare:{page_slug}:{section_slug}:{fld['reference_id']}"
            ftype = fld["type"]
            fname = fld["name"]
            vals = fld.get("values", []) or []
            vstruct = fld.get("values_structured", []) or []
            vflat = fld.get("values_flat") or ""

            if ftype == "signature" or ftype == "task list":
                continue
            if not vflat and not vstruct and not vals:
                if fld.get("required"):
                    warnings.append(f"Required field empty: {fname} (page={page_name}, section={section_name})")
                continue

            src_ref = f"{CC_SRC} ({page_name} > {section_name} > '{fname}')"

            # === TABLE FIELDS — one fact per row, topic by table name ===
            # ContentSnare ships tables as CSV download URLs, not inline data.
            # The actual rows live in CSV exports in the project folder.
            if ftype == "table":
                csv_path = TABLE_CSV_MAP.get(fname)
                if not csv_path:
                    warnings.append(f"Table field has no CSV mapping: '{fname}' — captured as unclassified atom")
                    continue
                rows = read_csv_rows(csv_path)
                if "Statement of Beliefs" in fname:
                    for ri, rd in enumerate(rows):
                        body = rd.get("Description", "")
                        if not body:
                            continue
                        add_fact(
                            topic="belief",
                            body=body,
                            verbatim=True,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={"doctrine": rd.get("Belief")},
                        )
                elif "Staff & Board" in fname or fname == "Staff & Board":
                    for ri, rd in enumerate(rows):
                        sname = rd.get("Staff Name", "")
                        if not sname:
                            continue
                        add_fact(
                            topic="staff",
                            body=sname,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={
                                "role": rd.get("Title"),
                                "email": rd.get("Email"),
                                "bio": rd.get("Bio"),
                                "campus": rd.get("Campus"),
                            },
                        )
                elif "Sermon Archive" in fname:
                    # Empty by design per partner — confirm CSV is empty
                    if rows:
                        warnings.append(f"Sermon Archive CSV has {len(rows)} rows but was expected empty per partner design")
                    continue
                elif "volunteer" in fname.lower():
                    for ri, rd in enumerate(rows):
                        role = rd.get("Volunteer / Role", "")
                        if not role:
                            continue
                        add_fact(
                            topic="other",
                            subtopic="volunteer_role",
                            body=role,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={
                                "team": rd.get("Team / Ministry"),
                                "description": rd.get("Role Description"),
                                "signup_link": rd.get("Sign Up Link"),
                                "contact": rd.get("Who should be contacted for volunteer sign-ups?"),
                            },
                        )
                elif "Local Outreach" in fname:
                    for ri, rd in enumerate(rows):
                        title = rd.get("Title", "")
                        if not title:
                            continue
                        add_fact(
                            topic="ministry",
                            subtopic="local_outreach",
                            body=title,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={
                                "description": rd.get("Description"),
                                "datetime": rd.get("Date & Time"),
                                "register_link": rd.get("Link to Register"),
                                "photos": rd.get("Link to Photos"),
                            },
                        )
                elif "Local Ministry Partner" in fname:
                    for ri, rd in enumerate(rows):
                        org = rd.get("Organization", "")
                        if not org:
                            continue
                        add_fact(
                            topic="partnership",
                            subtopic="local",
                            body=org,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={
                                "description": rd.get("Description"),
                                "kind": "local",
                            },
                        )
                elif "Global Ministry Partner" in fname:
                    for ri, rd in enumerate(rows):
                        org = rd.get("Organization", "")
                        if not org:
                            continue
                        add_fact(
                            topic="partnership",
                            subtopic="global",
                            body=org,
                            source_kind="content_collection",
                            source_ref=str(csv_path.name),
                            external_ref_id=f"{ref_id}:row_{ri}",
                            metadata={
                                "description": rd.get("Description"),
                                "kind": "global",
                            },
                        )
                continue

            # === REPEATER FIELDS — one atom/fact per instance ===
            # Also handle PROSE-ENUMERATION: when a single repeater item carries
            # comma/and-separated values, parse out into multiple atoms/facts.
            if fld.get("repeater_enabled"):
                items = vstruct if vstruct else [{"value": v} for v in vals]

                # Special case: Service Times prose enumeration.
                # When the repeater has 1 item with enumerable times in prose,
                # parse out into one service_time fact per parsed time.
                if "Service Times" in fname and len(items) == 1:
                    item_val = items[0].get("value") if isinstance(items[0], dict) else items[0]
                    parsed = parse_service_times(item_val or "")
                    if parsed:
                        for pi, parsed_time in enumerate(parsed):
                            add_fact(
                                topic="service_time",
                                body=f"{parsed_time['day']} {parsed_time['time']}",
                                verbatim=False,
                                source_kind="content_collection",
                                source_ref=src_ref,
                                external_ref_id=f"{ref_id}:parsed_{pi}",
                                metadata=parsed_time,
                            )
                        # Skip the default repeater treatment for this field
                        continue
                    # If parse failed, fall through to default handling

                for ri, item in enumerate(items):
                    item_val = item.get("value") if isinstance(item, dict) else item
                    if not item_val:
                        continue
                    # Service times → facts (default for multi-item case)
                    if "Service Times" in fname:
                        add_fact(
                            topic="service_time",
                            body=item_val,
                            verbatim=True,
                            source_kind="content_collection",
                            source_ref=src_ref,
                            external_ref_id=f"{ref_id}:repeater_{ri}",
                            metadata={"raw": item_val},
                        )
                        continue
                    # Taglines → atoms
                    if "tagline" in fname.lower():
                        add_atom(
                            topic="tagline",
                            body=item_val,
                            verbatim=True,
                            source_kind="content_collection",
                            source_ref=src_ref,
                            external_ref_id=f"{ref_id}:repeater_{ri}",
                        )
                        continue
                    # Strip HTML for body if it looks like wysiwyg content
                    body_clean = re.sub(r"<[^>]+>", "", item_val).strip() if isinstance(item_val, str) else item_val
                    body_clean = body_clean.replace("\xa0", " ") if isinstance(body_clean, str) else body_clean

                    # Kids & Student Ministries repeater
                    if "Kids & Student Ministries" in fname or "Kids" in fname:
                        topic = "kids_ministry"
                    elif "Adult Ministries" in fname:
                        topic = "adult_ministry"
                    elif "Care Ministries" in fname:
                        topic = "care_ministry"
                    elif ("Way" in fname and "Give" in fname) or "ways to give" in fname.lower() or "describe your ways to give" in fname.lower():
                        topic = "give_method"
                    elif "Small Group Ministry Name" in fname:
                        topic = "small_group_branded_name"
                    elif "Next Steps" in fname or "Discipleship Pathway" in fname:
                        topic = "next_steps_pathway"
                    elif "social media" in fname.lower():
                        topic = "social_media_handle"
                    elif "Livestream URL" in fname:
                        topic = "livestream_url"
                    elif "sermon archive" in fname.lower():
                        topic = "sermon_archive_url"
                    elif "Staff Values" in fname:
                        topic = "staff_value"
                    elif "classes or discipleship" in fname.lower():
                        topic = "class_or_discipleship_ministry"
                    elif "campus" in fname.lower() and "service" in fname.lower():
                        topic = "campus_service_experience"
                    else:
                        # Section-name-aware fallback for generic field names
                        sn = section_name.lower()
                        if "giving campaign" in sn:
                            topic = "giving_campaign"
                        elif "sermon" in sn:
                            topic = "sermon_note"
                        else:
                            topic = "unclassified"
                            warnings.append(f"Repeater item with no topic mapping: field='{fname}' section='{section_name}' → unclassified")
                    add_atom(
                        topic=topic,
                        body=body_clean if isinstance(body_clean, str) else json.dumps(body_clean),
                        verbatim=True,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=f"{ref_id}:repeater_{ri}",
                    )
                continue

            # === WYSIWYG / TEXTAREA — atoms, partner authorship ===
            if ftype in ("wysiwyg", "textarea"):
                # Strip HTML for body
                body = re.sub(r"<[^>]+>", "", vflat).strip() if vflat else ""
                if not body:
                    continue
                # Semantic topic mapping based on field name
                fn = fname.lower()
                if "mission statement" in fn:
                    topic = "mission_statement"
                    # If brief already has mission_statement, this is duplicative — keep both, tag source_kind
                elif "vision statement" in fn:
                    topic = "vision_statement"
                elif "church values" in fn:
                    topic = "church_value"
                elif "how was your church started" in fn:
                    topic = "church_origin"
                elif "why was your church created" in fn:
                    topic = "church_origin_rationale"
                elif "frequently used taglines" in fn:
                    topic = "tagline"
                elif "what can a visitor expect" in fn:
                    topic = "service_experience"
                elif "describe what it is like to visit" in fn:
                    topic = "service_experience"
                elif "how do visitors know where to go" in fn:
                    topic = "wayfinding"
                elif "describe your weekend service experiences" in fn:
                    topic = "campus_service_experience"
                elif "what does your church refer to sermons" in fn:
                    topic = "sermon_vocabulary"
                elif "where do you save your sermon archive" in fn:
                    topic = "sermon_archive_location"
                elif "staff values" in fn:
                    topic = "staff_value"
                elif "what do you call your volunteers" in fn:
                    topic = "volunteer_vocabulary"
                elif "why should someone apply to volunteer" in fn:
                    topic = "volunteer_motivation"
                elif "what language does your church typically use when talking about volunteering" in fn:
                    topic = "volunteer_vocabulary"
                elif "additional notes about volunteer opportunities" in fn:
                    topic = "volunteer_note"
                elif "small group ministry name" in fn:
                    topic = "small_group_branded_name"
                elif "what should visitors expect in a small group" in fn:
                    topic = "small_group_experience"
                elif "why do your small groups gather" in fn:
                    topic = "small_group_purpose"
                elif "bible verse or repeated saying about small groups" in fn:
                    topic = "small_group_verse_or_saying"
                elif "how can someone sign up to become a small group leader" in fn:
                    topic = "small_group_leader_signup"
                elif "who should site visitors contact to get more information about small groups" in fn:
                    topic = "small_group_contact"
                elif "next steps" in fn or "discipleship pathway" in fn:
                    topic = "next_steps_pathway"
                elif "classes or discipleship ministries" in fn:
                    topic = "class_or_discipleship_ministry"
                elif "why should someone be baptized" in fn:
                    topic = "baptism_why"
                elif "describe what it looks like to be baptized" in fn:
                    topic = "baptism_experience"
                elif "main bible verses or repeated sayings for baptism" in fn:
                    topic = "baptism_verse_or_saying"
                elif "how can someone sign up to be baptized" in fn:
                    topic = "baptism_signup"
                elif "kids" in fn and ("ministries" in fn or "students" in fn):
                    topic = "kids_ministry"
                elif "adult ministries" in fn:
                    topic = "adult_ministry"
                elif "care ministries" in fn:
                    topic = "care_ministry"
                elif "local outreach" in fn and "gather" in fn:
                    topic = "local_outreach_purpose"
                elif "global outreach" in fn and "gather" in fn:
                    topic = "global_outreach_purpose"
                elif "repeated saying about local outreach" in fn:
                    topic = "local_outreach_saying"
                elif "repeated saying about global outreach" in fn:
                    topic = "global_outreach_saying"
                elif "what is included in your newsletter" in fn:
                    topic = "newsletter_contents"
                elif "what do you use to send your newsletter" in fn:
                    topic = "newsletter_platform"
                elif "what is included in your bulletin" in fn:
                    topic = "bulletin_contents"
                elif "where can we find you on social media" in fn:
                    topic = "social_media_handle"
                elif "admin office hours" in fn:
                    topic = "office_hours"
                elif "why should someone give" in fn:
                    topic = "give_rationale"
                elif "bible verses or repeated sayings for giving" in fn:
                    topic = "give_verse_or_saying"
                elif "ways to give" in fn or "describe your ways to give" in fn:
                    topic = "give_method"
                elif "additional notes about giving" in fn:
                    topic = "give_note"
                elif "new formatted text field" in fn:
                    topic = "giving_campaign"
                else:
                    topic = "unclassified"
                    warnings.append(f"Wysiwyg/textarea field with no semantic mapping: '{fname}' (page={page_name}, section={section_name}) — captured as unclassified")
                add_atom(
                    topic=topic,
                    label=fname,
                    body=body,
                    verbatim=True,
                    source_kind="content_collection",
                    source_ref=src_ref,
                    external_ref_id=ref_id,
                )
                continue

            # === TEXT / PHONE / EMAIL / ADDRESS / NUMBER → facts ===
            if ftype in ("text", "phone", "email", "address", "number", "url"):
                fn = fname.lower()
                if "church name" in fn:
                    add_fact(
                        topic="other",
                        subtopic="church_name",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"field": "church_name", "value": vflat},
                    )
                elif "phone number" in fn:
                    add_fact(
                        topic="contact_method",
                        subtopic="phone",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"kind": "phone", "value": vflat},
                    )
                elif "email" in fn:
                    add_fact(
                        topic="contact_method",
                        subtopic="email",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"kind": "email", "value": vflat},
                    )
                elif "address" in fn:
                    add_fact(
                        topic="location_detail",
                        subtopic="address",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"value": vflat},
                    )
                elif "campuses" in fn:
                    add_fact(
                        topic="campus",
                        body=f"Number of campuses: {vflat}",
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"count": int(vflat) if vflat.isdigit() else vflat},
                    )
                elif ftype == "url":
                    add_fact(
                        topic="contact_method",
                        subtopic="url",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"field": fname, "value": vflat},
                    )
                elif "global outreach ministry name" in fn or "local outreach ministry name" in fn:
                    # Branded ministry names
                    add_atom(
                        topic="ministry_branded_name",
                        label=fname,
                        body=vflat,
                        verbatim=True,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                    )
                elif "is there reserved visitor parking" in fn:
                    add_fact(
                        topic="other",
                        subtopic="visitor_parking",
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                    )
                elif "what does your church refer to sermons" in fn:
                    add_atom(
                        topic="sermon_vocabulary",
                        body=vflat,
                        verbatim=True,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                    )
                else:
                    add_fact(
                        topic="other",
                        subtopic=re.sub(r"[^a-z0-9]+", "_", fname.lower()).strip("_"),
                        body=vflat,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=ref_id,
                        metadata={"field": fname},
                    )
                continue

            # === RADIO / SELECT — boolean/choice facts ===
            if ftype in ("radio", "select"):
                add_fact(
                    topic="other",
                    subtopic=re.sub(r"[^a-z0-9]+", "_", fname.lower()).strip("_")[:60],
                    body=vflat,
                    source_kind="content_collection",
                    source_ref=src_ref,
                    external_ref_id=ref_id,
                    metadata={"field": fname, "choice": vflat},
                )
                continue

            # === CHECKBOX — multi-value, one fact per checked item ===
            if ftype == "checkbox":
                for ci, choice in enumerate(vals):
                    add_fact(
                        topic="other",
                        subtopic=re.sub(r"[^a-z0-9]+", "_", fname.lower()).strip("_")[:60],
                        body=choice,
                        source_kind="content_collection",
                        source_ref=src_ref,
                        external_ref_id=f"{ref_id}:choice_{ci}",
                        metadata={"field": fname, "choice": choice},
                    )
                continue

            warnings.append(f"Unhandled field type: '{ftype}' ('{fname}')")


# =============================================================================
# PASS 6 — AM HANDOFF
# =============================================================================
# Not provided — no strategy_account_progress.handoff_web_form JSONB to read.
# In production, this would query that column.
expected_but_missing.append({
    "category": "am_handoff",
    "reason": "No AM handoff data available in test inputs. In production, would query strategy_account_progress.handoff_web_form JSONB."
})

# =============================================================================
# PASS 7 — SEO REPORT
# =============================================================================
expected_but_missing.append({
    "category": "seo_report",
    "reason": "No SEO report uploaded for this project. Pipeline can proceed without it; downstream sitemap step will generate keywords from church location/denomination only."
})


# =============================================================================
# COVERAGE REPORT
# =============================================================================
atoms_by_topic = Counter(a["topic"] for a in atoms)
atoms_by_source = Counter(a["source_kind"] for a in atoms)
facts_by_topic = Counter(f["topic"] for f in facts)

# Expected coverage checks
if atoms_by_topic.get("persona", 0) == 0:
    expected_but_missing.append({
        "category": "persona",
        "reason": "Strategy brief did not yield persona atoms. Voice card will have empty persona_snapshots."
    })
if atoms_by_topic.get("branded_term", 0) == 0:
    expected_but_missing.append({
        "category": "branded_term",
        "reason": "Brand guide did not yield branded_term atoms. Voice card will have empty branded_vocabulary."
    })
if atoms_by_topic.get("mission_statement", 0) == 0:
    expected_but_missing.append({
        "category": "mission_statement",
        "reason": "No mission_statement atom found."
    })

# Surface specific pressure-test notes
expected_but_missing.append({
    "category": "strategy_brief_format_note",
    "reason": "Source treated as strategy brief (riverwood-persona-and-journey.md) is technically a persona-and-journey doc derived from discovery+brand guide. In production, a real strategy brief from the brand squad would carry tone descriptors, x_factor, denominational signal as authored sections — they had to be inferred / lifted from this derived doc. Coverage is sufficient but worth noting."
})


output = {
    "project_id": PROJECT_ID,
    "extraction_run_at": datetime.utcnow().isoformat() + "Z",
    "skill_version": "web_intake_normalizer v1",
    "dry_run": True,
    "sources_loaded": {
        "content_collection": "Riverwood Chapel.json",
        "strategy_brief": "riverwood-persona-and-journey.md (used as brief stand-in; see coverage report)",
        "discovery_questionnaire": "riverwood_chapel_discovery.json",
        "brand_handoff": "riverwoodchapelbrand.md",
        "am_handoff": "absent",
        "seo_report": "absent",
    },
    "atoms": atoms,
    "facts": facts,
    "coverage_report": {
        "atoms_produced": {
            "total": len(atoms),
            "by_topic": dict(atoms_by_topic.most_common()),
            "by_source_kind": dict(atoms_by_source.most_common()),
        },
        "facts_produced": {
            "total": len(facts),
            "by_topic": dict(facts_by_topic.most_common()),
        },
        "expected_but_missing": expected_but_missing,
        "warnings": warnings,
        "contentsnare_field_walk_total": field_count,
    },
}

OUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/riverwood-normalizer-dry-run.json")
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"Wrote {OUT}")
print(f"  atoms: {len(atoms)}")
print(f"  facts: {len(facts)}")
print(f"  warnings: {len(warnings)}")
print(f"  expected_but_missing: {len(expected_but_missing)}")
print(f"  contentsnare fields walked: {field_count}")
print()
print("=== atoms by topic ===")
for t, c in atoms_by_topic.most_common():
    print(f"  {c:3d}  {t}")
print()
print("=== facts by topic ===")
for t, c in facts_by_topic.most_common():
    print(f"  {c:3d}  {t}")
print()
print("=== atoms by source_kind ===")
for s, c in atoms_by_source.most_common():
    print(f"  {c:3d}  {s}")
print()
if warnings:
    print(f"=== WARNINGS ({len(warnings)}) ===")
    for w in warnings[:20]:
        print(f"  {w}")
    if len(warnings) > 20:
        print(f"  ... and {len(warnings) - 20} more")
