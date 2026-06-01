#!/usr/bin/env python3
"""
Build a clean copywriter-only brief for /kids that matches the new
three-component plugin architecture. Outputs TWO files:

1. kids-copywriter-brief.md — what Ashley pastes into a Sonnet conversation
   with the web-page-copywriter skill loaded. Contains the brief ONLY:
   atoms, voice card writer's brief, section_jobs, persona posture,
   cross-cutting patterns, max_chars advisory. NO Brixies schemas.
   NO compliance overhead.

2. kids-formatter-inputs.md — what Ashley pastes when she runs /format-page
   after the copywriter outputs prose. Contains the bound Brixies template
   schemas the formatter needs.

Both files land in milestone-comms-app/cowork-skills/ for easy access.
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

OUT_BRIEF = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills/kids-copywriter-brief.md")
OUT_FORMATTER = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills/kids-formatter-inputs.md")

PAGE_SLUG = "/kids"

with open(SITEMAP) as f: sitemap = json.load(f)
with open(SECTION_PLAN) as f: section_plan = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(BRIXIES) as f: brixies = json.load(f)


# ─── Slice page data ────────────────────────────────────────────────
page = next(p for p in sitemap["pages"] if p["slug"] == PAGE_SLUG)
sections = section_plan["sections_by_page"][PAGE_SLUG]
content_map_rows = [r for r in section_plan["content_page_map"]
                    if r["page_slug"] == PAGE_SLUG]


# ─── Slice atoms referenced on this page ───────────────────────────
referenced_eris = {r["atom_external_ref_id"] for r in content_map_rows}
atoms_by_eri = {a.get("external_ref_id"): a for a in intake["atoms"]
                if a.get("external_ref_id")}
referenced_atoms = []
for eri in referenced_eris:
    if eri in atoms_by_eri:
        a = atoms_by_eri[eri]
        referenced_atoms.append({
            "external_ref_id": a.get("external_ref_id"),
            "topic": a.get("topic"),
            "label": a.get("label"),
            "body": a.get("body"),
            "body_short": a.get("body_short"),
            "verbatim": a.get("verbatim", False),
            "content_quality": a.get("content_quality", "clean"),
            "source_kind": a.get("source_kind"),
            "metadata": a.get("metadata", {}),
            "handling_notes": a.get("handling_notes"),
        })


# ─── Slice relevant facts ──────────────────────────────────────────
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
    elif t == "staff" and ("kid" in (f.get("body") or "").lower() or
                            "kid" in str(f.get("metadata", {}).get("role", "")).lower()):
        relevant_facts.append(f)


# ─── Build copywriter-friendly section briefs (no template schemas) ───
copywriter_sections = []
templates_by_id = {t["id"]: t for t in brixies["templates"]}
TEMPLATE_BINDINGS = {
    ("hero_inner", "informational"): "hero-section-102",
    ("content_image_text", None): "content-section-1",
    ("feature_card_grid", None): "feature-section-14",
    ("feature_unique", None): "feature-section-1",
    ("cta_simple", None): "banner-section-1",
}

# max_chars advisory — extracted from templates but presented as guidance not enforcement
max_chars_advisory = {}
templates_used = []
for s in sections:
    cid = s["concept_id"]
    ts = s.get("tagline_strategy")
    tpl_id = TEMPLATE_BINDINGS.get((cid, ts), TEMPLATE_BINDINGS.get((cid, None)))
    tpl = templates_by_id.get(tpl_id, {})
    templates_used.append({
        "id": tpl.get("id"),
        "layer_name": tpl.get("layer_name"),
        "family": tpl.get("family"),
        "fields": tpl.get("fields"),
    })
    # Pull max_chars per slot as advisory
    for f in tpl.get("fields") or []:
        if f.get("type") in ("text", "richtext") and f.get("max_chars"):
            max_chars_advisory[f"{cid}.{f['key']}"] = f["max_chars"]

    copywriter_sections.append({
        "sort_order": s["sort_order"],
        "concept_id": cid,
        "section_job": s["section_job"],
        "tagline_strategy": ts,
        "intent_summary": s.get("intent_summary"),
        "atom_external_ref_ids": s.get("atom_external_ref_ids", []),
        # Surface the section planner's emotional-weight upgrades if any
        "concept_upgrade_recommended": s.get("_concept_upgrade_recommended"),
        "proof_person": s.get("_proof_person"),
        "emotional_weight_no_proof_note": s.get("_emotional_weight_no_proof"),
    })


# ─── Persuasive frame for the page's primary persona ───────────────
primary_persona_label = page.get("persona_primacy", {}).get("primary", "The Suburban Family")
persuasive_postures = vc_dump["voice_card"].get("persuasive_posture_by_persona", {})
persuasive_frame = persuasive_postures.get(primary_persona_label, {})


# ─── Voice card (the writer's brief portion) ───────────────────────
voice_card_for_writer = {
    "tone_descriptors": vc_dump["voice_card"]["tone_descriptors"],
    "branded_vocabulary": vc_dump["voice_card"]["branded_vocabulary"],
    "denominational_filter": vc_dump["voice_card"]["denominational_filter"],
    "mission_statement": vc_dump["voice_card"]["mission_statement"],
    "x_factor": vc_dump["voice_card"]["x_factor"],
    "persona_snapshots": vc_dump["voice_card"]["persona_snapshots"],
    "example_phrases_good": vc_dump["voice_card"]["example_phrases_good"],
    "anti_models": vc_dump["voice_card"]["anti_models"],
    # The writer's brief proper
    "signature_moves": vc_dump["voice_card"].get("signature_moves", []),
    "positive_voice_rules": vc_dump["voice_card"].get("positive_voice_rules", []),
    "sample_sentences_in_voice": vc_dump["voice_card"].get("sample_sentences_in_voice", []),
    "persuasive_posture_by_persona": persuasive_postures,
}


# ─── Compose the copywriter brief markdown ─────────────────────────
def jdump(o):
    return json.dumps(o, indent=2, ensure_ascii=False)


brief_md = f"""# Copywriter Brief — /kids (Riverwood Chapel, Project 3490)

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded. Sonnet should produce prose for every section in this brief, using the structural markers from the skill.

After Sonnet outputs the prose, you'll invoke `/format-page` and paste `kids-formatter-inputs.md` to produce the Brixies JSON.

---

## Page

```json
{jdump({
    "page_slug": page["slug"],
    "name": page["name"],
    "primary_persona": primary_persona_label,
    "keywords": page["keywords"],
})}
```

## Persuasive Frame (for the primary persona)

```json
{jdump(persuasive_frame)}
```

## Sections to Draft

Each section has a `section_job` (feeling-led brief) the copywriter writes toward. Hero sections additionally have `tagline_strategy` (informational / hook / omit).

```json
{jdump(copywriter_sections)}
```

## max_chars Advisory (not enforcement)

These come from the bound Brixies templates. They are advisory — write naturally, aim short, but don't truncate creativity to hit a character count. The `/format-page` step does final fitting.

```json
{jdump(max_chars_advisory)}
```

## Content_page_map (atoms × this page × role)

```json
{jdump(content_map_rows)}
```

## Atoms Referenced

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (they were HTML-mashed ContentSnare form output). You are FREE to clean and recompose these into web-ready prose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
{jdump(referenced_atoms)}
```

## Relevant Facts

```json
{jdump(relevant_facts)}
```

## Voice Card (the writer's brief)

Lift fields: branded_vocabulary, banned_terms, mission, x_factor, personas, anti_models, example_phrases_good. Synthesis fields (the writer's brief proper): signature_moves, positive_voice_rules, sample_sentences_in_voice, persuasive_posture_by_persona.

```json
{jdump(voice_card_for_writer)}
```

---

**Start drafting.** Output prose for every section in order, using the structural markers from the skill spec (HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:). Do not output JSON. Do not run mechanical scans. Do not produce an audit. Those are downstream jobs.
"""


# ─── Compose the formatter-inputs markdown ─────────────────────────
formatter_md = f"""# Formatter Inputs — /kids

After **web-page-copywriter** has produced prose for /kids, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

## Bound Templates (one per section)

```json
{jdump([{
    "section_sort_order": cs["sort_order"],
    "concept_id": cs["concept_id"],
    "tagline_strategy": cs["tagline_strategy"],
    "section_job": cs["section_job"],
    "template_id": tpl["id"],
    "template_layer_name": tpl["layer_name"],
    "fields": tpl["fields"],
} for cs, tpl in zip(copywriter_sections, templates_used)])}
```

## Page Metadata (for strategic_setup if requested)

```json
{jdump({
    "page_slug": page["slug"],
    "name": page["name"],
    "primary_persona": primary_persona_label,
    "keywords": page["keywords"],
})}
```

The formatter's job is mechanical: parse the prose, map markers to slot keys, apply max_chars (trim safely or flag), output JSON. No creative rewriting. If a slot needs structural shortening, kick back to the copywriter.

After the formatter produces JSON, invoke **web-page-reviewer** with the formatted JSON + the voice card from the original brief to get the verdict.
"""


OUT_BRIEF.write_text(brief_md)
OUT_FORMATTER.write_text(formatter_md)

print(f"Wrote {OUT_BRIEF.name} ({OUT_BRIEF.stat().st_size:,} bytes)")
print(f"Wrote {OUT_FORMATTER.name} ({OUT_FORMATTER.stat().st_size:,} bytes)")
print()
print(f"Copywriter brief sections: {len(copywriter_sections)}")
for cs in copywriter_sections:
    upgrade = f" → {cs['concept_upgrade_recommended']}" if cs.get('concept_upgrade_recommended') else ""
    print(f"  {cs['sort_order']}. {cs['concept_id']:25s} tagline={cs.get('tagline_strategy', '—')}{upgrade}")
print()
print(f"Atoms surfaced: {len(referenced_atoms)}")
for a in referenced_atoms:
    print(f"  • [{a['topic']}] verbatim={a['verbatim']} content_quality={a['content_quality']}")
print()
print(f"Facts surfaced: {len(relevant_facts)}")
for f in relevant_facts:
    print(f"  • [{f['topic']}] {(f.get('body') or '')[:60]!r}")
