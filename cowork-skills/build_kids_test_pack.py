#!/usr/bin/env python3
"""
Assembles a self-contained drafter test pack for /kids that Ashley can drop
into a fresh Cowork conversation with Sonnet 4.6.

Output: one markdown file containing:
  - Instructions for the operator (Ashley)
  - The web-page-drafter system prompt (extracted from web-page-drafter.md)
  - All upstream inputs Sonnet needs to draft /kids:
      • Page metadata + keywords
      • Sections (with section_jobs + tagline_strategies)
      • Voice card v2 (writer's brief)
      • Atoms referenced by /kids
      • Relevant church_facts
      • Bound Brixies template schemas (mock-bound for the dry-run)
      • Cross-cutting persuasive patterns
  - The expected output schema reminder

The deliverable lands in outputs/ as kids-drafter-test-pack.md
"""
import json
import re
from pathlib import Path

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
SITEMAP = WORKSPACE / "riverwood-sitemap-dry-run.json"
SECTION_PLAN = WORKSPACE / "riverwood-section-plan-dry-run.json"
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
BRIXIES = WORKSPACE / "brixies-library.json"
PAGE_DRAFTER = WORKSPACE / "web-page-drafter.md"

OUTPUT = Path("/sessions/sleepy-practical-bohr/mnt/outputs/kids-drafter-test-pack.md")

PAGE_SLUG = "/kids"

with open(SITEMAP) as f: sitemap = json.load(f)
with open(SECTION_PLAN) as f: section_plan = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(BRIXIES) as f: brixies = json.load(f)
drafter_md = PAGE_DRAFTER.read_text()


# ─── Extract system prompt from the page-drafter skill ──────────────
m = re.search(r"## The system prompt.*?```\n(.+?)\n```", drafter_md, re.DOTALL)
system_prompt = m.group(1).strip() if m else "[SYSTEM PROMPT EXTRACT FAILED]"


# ─── Slice page metadata ────────────────────────────────────────────
page = next(p for p in sitemap["pages"] if p["slug"] == PAGE_SLUG)


# ─── Slice sections + content_page_map for /kids ────────────────────
sections = section_plan["sections_by_page"][PAGE_SLUG]
content_map_rows = [r for r in section_plan["content_page_map"]
                    if r["page_slug"] == PAGE_SLUG]


# ─── Slice atoms referenced by content_page_map rows on this page ───
referenced_eris = {r["atom_external_ref_id"] for r in content_map_rows}
atoms_by_eri = {a.get("external_ref_id"): a for a in intake["atoms"]
                if a.get("external_ref_id")}
referenced_atoms = []
for eri in referenced_eris:
    if eri in atoms_by_eri:
        a = atoms_by_eri[eri]
        # Slim down to fields the drafter actually needs
        referenced_atoms.append({
            "external_ref_id": a.get("external_ref_id"),
            "topic": a.get("topic"),
            "label": a.get("label"),
            "body": a.get("body"),
            "body_short": a.get("body_short"),
            "verbatim": a.get("verbatim", False),
            "source_kind": a.get("source_kind"),
            "metadata": a.get("metadata", {}),
        })


# ─── Slice relevant facts (service times, kids URL, key staff) ──────
# Kids drafter cares about: service times (informational tagline material),
# kids check-in URL, address (for chrome), phone, key staff
relevant_facts = []
for f in intake["facts"]:
    t = f.get("topic")
    if t == "service_time":
        relevant_facts.append(f)
    elif t == "contact_method" and ("checkin" in (f.get("body") or "").lower() or
                                     "check-in" in (f.get("body") or "").lower() or
                                     "churchcenter" in (f.get("body") or "").lower()):
        relevant_facts.append(f)
    elif t == "address":
        relevant_facts.append(f)
    elif t == "phone":
        relevant_facts.append(f)
    elif t == "staff" and "kid" in (f.get("body") or "").lower():
        relevant_facts.append(f)


# ─── Mock-bind Brixies templates for each section ───────────────────
# In production, auto-bind-page.ts picks. For this test pack, we pick
# the templates the production binder would likely pick:
#  - hero_inner with tagline_strategy=informational → hero-section-102
#    (has tagline slot; supports label/qualifier/scene architecture)
#  - content_image_text → content-section-1
#  - feature_card_grid → feature-section-14 (with card palette group)
#  - feature_unique → feature-section-1 (process steps group)
#  - cta_simple → banner-section-1

# Pull the actual field schemas for these templates from the library.
TEMPLATE_BINDINGS = {
    ("hero_inner", "informational"): "hero-section-102",
    ("content_image_text", None): "content-section-1",
    ("feature_card_grid", None): "feature-section-14",
    ("feature_unique", None): "feature-section-1",
    ("cta_simple", None): "banner-section-1",
}

# Augment each section with template_id + the actual template schema
templates_by_id = {t["id"]: t for t in brixies["templates"]}
sections_for_drafter = []
templates_used = []
for s in sections:
    cid = s["concept_id"]
    ts = s.get("tagline_strategy")
    tpl_id = TEMPLATE_BINDINGS.get((cid, ts), TEMPLATE_BINDINGS.get((cid, None)))
    if not tpl_id:
        # Fallback: first published template in the concept's family
        concept = next(c for c in brixies["curated_concepts"] if c["id"] == cid)
        for t in brixies["templates"]:
            if t.get("family") in concept["family_filter"] and t.get("is_published"):
                tpl_id = t["id"]
                break
    tpl = templates_by_id.get(tpl_id, {})
    sections_for_drafter.append({
        "sort_order": s["sort_order"],
        "concept_id": cid,
        "section_job": s["section_job"],
        "tagline_strategy": ts,
        "intent_summary": s.get("intent_summary"),
        "atom_external_ref_ids": s.get("atom_external_ref_ids", []),
        "template_id": tpl_id,
    })
    templates_used.append({
        "id": tpl.get("id"),
        "layer_name": tpl.get("layer_name"),
        "family": tpl.get("family"),
        "fields": tpl.get("fields"),  # The slot schemas
    })


# ─── Cross-cutting CMS persuasive patterns (inlined from memory) ────
# Past sites: Mosaic, MVCC, Awaken, Real Life. These are the patterns
# the drafter pattern-matches against, layered on top of Riverwood's
# specific voice card.
cms_persuasive_patterns = """
**Cross-cutting persuasive patterns** (distilled from four shipped CMS sites):

1. Hero leads with the visitor's posture, never the church's claim about itself.
2. Visitor is protagonist; church is guide; "you" appears in nearly every opening line.
3. A specific felt-fear is named in the visitor's own words, then disarmed.
4. Every page closes with a low-friction next step framed as a story, not a transaction.

**Brixies hero architecture (critical):**
- Heading slot (h1) = always a clean page label or program name (Kids, Visit, Give). Never a hook. Past sites overloaded the h1; v2 stops doing that.
- Tagline slot (above h1) = three strategies per tagline_strategy: informational (factual qualifier), hook (persuasive promise), omit (utility pages).
- Description slot (body below h1) = warm scene-setting, addressing the visitor's actual concern from the section_job. Hero descriptions INVITE — they do not deliver logistics. Logistics live in downstream sections built for them.

**Past hero descriptions that landed (note: each names the parent's actual desire, not logistics):**
- Mosaic /kids: "You want your kids to love church, not just attend… we partner with parents"
- MVCC /kids: "You want your children to have a faith of their own. Partner with a ministry designed to help them build a resilient foundation."
- Real Life /kids: "Partnering with you to help your child love Jesus"

**Encoding shorthand:** {Acknowledge a felt tension or desire} → {Reframe the church/action as the posture-shift} → {Hand the visitor a single small step that feels like joining a story already in motion}. The work happens in the tagline + description, NOT in the h1.
"""


# ─── Assemble the bundle ────────────────────────────────────────────
def jdump(o):
    return json.dumps(o, indent=2, ensure_ascii=False)


bundle = f"""# /kids Drafter Test Pack — for fresh Sonnet 4.6 conversation

**What this is:** everything Sonnet 4.6 needs to draft the /kids page for Riverwood Chapel. The page drafter skill spec + all upstream inputs (page metadata, sections with feeling-led section_jobs, voice card with writer's-brief fields, atoms, facts, Brixies template schemas, cross-cutting persuasive patterns).

**How to use it:**

1. Open a fresh Cowork conversation with Sonnet 4.6 as the model.
2. Paste this whole file as your message.
3. Sonnet should return ONE JSON object matching the schema in the system prompt (page_slug, strategic_setup, sections[], page_audit, gaps_flagged[], _confidence_log{{}}).
4. Compare its output to the dry-run version at `cowork-skills/riverwood-page-kids-dry-run.json` to see how the real model handles the brief vs how I (Opus) hand-crafted it.

**What we're testing:**
- Does Sonnet write invitational hero descriptions (naming the parent's desire) or slot-fill with logistics?
- Does it honor the heading-is-a-label / tagline-strategy / description-is-the-body architecture?
- Does it lift verbatim atoms, use branded vocabulary, avoid banned terms?
- Does it pick alternatives well for high-stakes slots?

---

## SYSTEM PROMPT (web-page-drafter skill)

Treat everything between the fences as your operating instructions for this task.

```
{system_prompt}
```

---

## INPUTS

### 1. Page metadata (from sitemap)

```json
{jdump(page)}
```

### 2. Sections to draft (each with section_job + tagline_strategy + bound template_id)

The section_planner already assigned the persuasive intent (`section_job`) per section and the tagline strategy (`tagline_strategy`) per hero. The drafter writes TOWARD the job, not just into the slots.

```json
{jdump(sections_for_drafter)}
```

### 3. Bound Brixies template schemas

The binder has already picked one template variant per section. These are the field schemas the drafter writes `field_values` into. Honor `required`, `max_chars`, and `kind` (slot vs group).

```json
{jdump(templates_used)}
```

### 4. Content page map (atoms × this page × role × treatment)

```json
{jdump(content_map_rows)}
```

### 5. Atoms referenced on this page

```json
{jdump(referenced_atoms)}
```

### 6. Relevant facts (service times, check-in URL, address, phone, staff)

```json
{jdump(relevant_facts)}
```

### 7. Voice card v2 (the writer's brief)

Lift fields: branded_vocabulary, banned_terms, syntax_rules, mission, x_factor, personas, anti_models, example_phrases_good/bad. Synthesis fields (the writer's brief proper): signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona.

```json
{jdump(vc_dump["voice_card"])}
```

### 8. Cross-cutting CMS persuasive patterns

{cms_persuasive_patterns}

---

## EXPECTED OUTPUT

Return ONE JSON object (no prose before or after, no markdown fences) with this top-level shape:

```json
{{
  "page_slug": "/kids",
  "primary_persona": "The Suburban Family",
  "persuasive_frame": {{...}},
  "strategic_setup": {{
    "primary_keyword": "...",
    "secondary_keywords": [...],
    "local_keywords": [...],
    "metadata_title": "...",
    "metadata_description": "...",
    "aeo_smart_snippet": "..."
  }},
  "sections": [
    {{
      "sort_order": 1,
      "concept_id": "hero_inner",
      "template_id": "hero-section-102",
      "section_job": "...",
      "tagline_strategy": "informational",
      "field_values": {{...}},                  // keyed by Brixies slot names
      "alternatives_considered": {{...}},        // for high-stakes slots
      "atoms_lifted_canonical": [...],
      "voice_check_notes": "..."
    }},
    ...
  ],
  "page_audit": {{
    "negative_checks": {{...}},
    "positive_checks": {{...}},
    "voice_match": "...",
    "alternatives_summary": "..."
  }},
  "gaps_flagged": [...],
  "_confidence_log": {{...}}
}}
```

**Start now.**
"""

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(bundle)

print(f"Wrote {OUTPUT}")
print(f"  size: {OUTPUT.stat().st_size:,} bytes")
print(f"  page: {PAGE_SLUG}")
print(f"  sections: {len(sections_for_drafter)}")
print(f"  templates bound: {len(templates_used)}")
print(f"  atoms surfaced: {len(referenced_atoms)}")
print(f"  facts surfaced: {len(relevant_facts)}")
print()
print(f"Bound templates:")
for s, t in zip(sections_for_drafter, templates_used):
    has_tagline = any(f.get("key") == "tagline" for f in (t.get("fields") or []))
    print(f"  {s['sort_order']}. {s['concept_id']:25s} → {s['template_id']:25s}  tagline_slot={has_tagline}")
