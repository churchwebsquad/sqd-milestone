#!/usr/bin/env python3
"""
Generate copywriter briefs + formatter inputs for ALL pages in the Riverwood
sitemap. One pair of files per page.

Reads from cowork-skills/ dry-runs (sitemap, section plan, normalizer, voice
card, brixies library) and writes to cowork-skills/briefs/:

  /             → briefs/homepage-copywriter-brief.md + briefs/homepage-formatter-inputs.md
  /visit        → briefs/visit-copywriter-brief.md + briefs/visit-formatter-inputs.md
  /watch        → briefs/watch-copywriter-brief.md + briefs/watch-formatter-inputs.md
  ...etc...

Workflow for each page:
1. Paste the copywriter-brief into a fresh Sonnet conversation with the
   web-copywriter-suite plugin installed. Sonnet outputs prose.
2. Type /format-page and paste the formatter-inputs. Command outputs JSON.
3. Say "review the page" with the JSON. Haiku outputs verdict.
4. Apply kickbacks; iterate.
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
SNIPPETS = WORKSPACE / "riverwood-snippets-manifest.json"
OUT_DIR = WORKSPACE / "briefs"

with open(SITEMAP) as f: sitemap = json.load(f)
with open(SECTION_PLAN) as f: section_plan = json.load(f)
with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc_dump = json.load(f)
with open(BRIXIES) as f: brixies = json.load(f)
snippets_manifest = json.loads(SNIPPETS.read_text()) if SNIPPETS.exists() else None


atoms_by_eri = {a.get("external_ref_id"): a for a in intake["atoms"]
                if a.get("external_ref_id")}
templates_by_id = {t["id"]: t for t in brixies["templates"]}
voice_card = vc_dump["voice_card"]
persuasive_postures = voice_card.get("persuasive_posture_by_persona", {})


# Template binding map. In production auto-bind-page.ts picks; for v1 we use
# heuristic defaults aware of tagline_strategy.
def pick_template(concept_id, tagline_strategy=None):
    """Pick a representative template variant for a concept. For hero with
    informational/hook strategy, prefer templates with a tagline slot."""
    # Hard-coded picks that match what the production binder would likely pick
    PINS = {
        ("hero_homepage", "hook"): "hero-section-200",
        ("hero_inner", "informational"): "hero-section-102",
        ("hero_inner", "hook"): "hero-section-102",
        ("hero_inner", "omit"): "hero-section-1",
        ("content_image_text", None): "content-section-1",
        ("feature_card_grid", None): "feature-section-14",
        ("feature_card_carousel", None): "feature-section-14",
        ("feature_unique", None): "feature-section-1",
        ("feature_team", None): "feature-section-1",
        ("feature_tabbed", None): "feature-section-1",
        ("cta_simple", None): "banner-section-1",
        ("cta_callout", None): "banner-section-1",
        ("contact_section", None): "contact-section-1",
        ("accordion_faq", None): "accordion-section-1",
        ("timeline_story", None): "timeline-section-1",
        ("archive_current_series", None): "archive-section-1",
        ("archive_filter", None): "archive-section-1",
    }
    # Try strategy-specific pin first
    if tagline_strategy and (concept_id, tagline_strategy) in PINS:
        tpl_id = PINS[(concept_id, tagline_strategy)]
        if tpl_id in templates_by_id:
            return templates_by_id[tpl_id]
    # Fall back to concept-level pin
    if (concept_id, None) in PINS:
        tpl_id = PINS[(concept_id, None)]
        if tpl_id in templates_by_id:
            return templates_by_id[tpl_id]
    # Last resort: first published template in the concept's family
    concept = next((c for c in brixies["curated_concepts"] if c["id"] == concept_id), None)
    if concept:
        for t in brixies["templates"]:
            if t.get("family") in concept["family_filter"] and t.get("is_published"):
                return t
    return None


def relevant_facts_for_page(slug):
    """Heuristic-based fact selection per page slug."""
    facts = []
    for f in intake["facts"]:
        t = f.get("topic")
        body = (f.get("body") or "").lower()
        role = str(f.get("metadata", {}).get("role", "")).lower()

        # Service times: relevant on /visit, /watch, /, /kids, /students-college, /care
        if t == "service_time" and slug in ("/visit", "/watch", "/", "/kids",
                                              "/students-college", "/care", "/events",
                                              "/adult-studies", "/discovery-membership"):
            facts.append(f)
            continue
        # Address: on /, /visit, /events, /care, /contact-related
        if t == "address" and slug in ("/visit", "/", "/events", "/care"):
            facts.append(f)
            continue
        # Phone: same pages as address
        if t == "phone" and slug in ("/visit", "/", "/events", "/care"):
            facts.append(f)
            continue
        # Staff: page-specific
        if t == "staff":
            page_to_keywords = {
                "/kids": ["kid", "children", "family"],
                "/students-college": ["student", "youth", "college"],
                "/care": ["care", "counseling", "pastoral"],
                "/connect": ["connect", "groups", "discipleship"],
                "/adult-studies": ["group", "discipleship"],
                "/leadership": [""],  # all staff
                "/discovery-membership": ["pastor", "discipleship"],
                "/outreach": ["outreach", "missions"],
                "/give": ["finance", "stewardship"],
                "/events": ["event"],
                "/": ["lead", "pastor"],
            }
            keywords = page_to_keywords.get(slug, [])
            if keywords and any(k in body or k in role for k in keywords):
                facts.append(f)
                continue
        # Contact methods: on /, /visit, /kids (checkin), /give (giving URL), /events
        if t == "contact_method":
            page_to_terms = {
                "/kids": ["check", "regist", "kids"],
                "/give": ["give", "giving", "donat"],
                "/events": ["event", "regist"],
                "/visit": ["regist"],
                "/": ["regist"],
            }
            terms = page_to_terms.get(slug, [])
            if any(t_ in body for t_ in terms):
                facts.append(f)
                continue
        # Milestones for /story-beliefs
        if t == "milestone" and slug == "/story-beliefs":
            facts.append(f)
            continue
        # Beliefs for /story-beliefs
        if t == "belief" and slug == "/story-beliefs":
            facts.append(f)
            continue
        # Partnerships for /outreach
        if t == "partnership" and slug == "/outreach":
            facts.append(f)
            continue
        # Branded terms relevant everywhere — surface a slim list
        # (Skip; voice card branded_vocabulary covers this)
    return facts


def slug_to_filename(slug):
    """Convert a URL slug into a clean filename stem."""
    if slug == "/":
        return "homepage"
    return slug.strip("/").replace("/", "-")


def jdump(o):
    return json.dumps(o, indent=2, ensure_ascii=False)


def build_brief_for_page(page):
    """Return (brief_md, formatter_md) for one page."""
    slug = page["slug"]
    sections = section_plan["sections_by_page"][slug]
    content_map_rows = [r for r in section_plan["content_page_map"] if r["page_slug"] == slug]

    # Atoms referenced on this page
    referenced_eris = {r["atom_external_ref_id"] for r in content_map_rows}
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

    # Relevant facts
    facts = relevant_facts_for_page(slug)

    # Sections for copywriter (no template schemas)
    copywriter_sections = []
    templates_used = []
    max_chars_advisory = {}
    for s in sections:
        cid = s["concept_id"]
        ts = s.get("tagline_strategy")
        tpl = pick_template(cid, ts) or {}
        templates_used.append({
            "id": tpl.get("id"),
            "layer_name": tpl.get("layer_name"),
            "family": tpl.get("family"),
            "fields": tpl.get("fields"),
        })
        # max_chars advisory
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
            "concept_upgrade_recommended": s.get("_concept_upgrade_recommended"),
            "proof_person": s.get("_proof_person"),
            "emotional_weight_no_proof_note": s.get("_emotional_weight_no_proof"),
        })

    # Persuasive frame
    primary_persona = page.get("persona_primacy", {}).get("primary", "")
    if primary_persona not in persuasive_postures and persuasive_postures:
        primary_persona = list(persuasive_postures.keys())[0]
    persuasive_frame = persuasive_postures.get(primary_persona, {})

    # Voice card for writer (mostly the full thing — copywriter reads it all)
    voice_card_for_writer = {
        "tone_descriptors": voice_card["tone_descriptors"],
        "branded_vocabulary": voice_card["branded_vocabulary"],
        "denominational_filter": voice_card["denominational_filter"],
        "mission_statement": voice_card["mission_statement"],
        "x_factor": voice_card["x_factor"],
        "persona_snapshots": voice_card["persona_snapshots"],
        "example_phrases_good": voice_card["example_phrases_good"],
        "anti_models": voice_card["anti_models"],
        "signature_moves": voice_card.get("signature_moves", []),
        "positive_voice_rules": voice_card.get("positive_voice_rules", []),
        "sample_sentences_in_voice": voice_card.get("sample_sentences_in_voice", []),
        "persuasive_posture_by_persona": persuasive_postures,
    }

    page_meta = {
        "page_slug": slug,
        "name": page["name"],
        "primary_persona": primary_persona,
        "keywords": page.get("keywords", {}),
    }

    brief_md = f"""# Copywriter Brief — {slug} ({page["name"]})

Riverwood Chapel · Project 3490

Drop this into a fresh Cowork conversation with the **web-page-copywriter** skill loaded (from the web-copywriter-suite plugin). Sonnet will produce prose for every section in this brief.

After Sonnet outputs the prose, invoke `/format-page` and paste `{slug_to_filename(slug)}-formatter-inputs.md` to produce the Brixies JSON. Then say "review the page" with the JSON output to get the reviewer's verdict.

---

## Page

```json
{jdump(page_meta)}
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

Atoms marked `content_quality: "raw_form_output"` were demoted from `verbatim=true` by the normalizer (HTML-mashed form output). You are FREE to clean and recompose. Atoms marked `clean` AND `verbatim=true` lift exactly.

```json
{jdump(referenced_atoms)}
```

## Relevant Facts

```json
{jdump(facts)}
```

## Voice Card (the writer's brief)

```json
{jdump(voice_card_for_writer)}
```

## Snippets Manifest

The church has registered globals (church name, service times, address, phone, pastor, social URLs) and named snippets (ministry contacts, check-in URL, livestream URL, etc.). Write naturally — refer to the church by name, list service times, etc. The formatter will tokenize literals to `{{globals_key}}` and `{{snippet_token}}` automatically.

```json
{jdump(snippets_manifest) if snippets_manifest else "{}"}
```

---

**Start drafting.** Output prose for every section in order using the structural markers (HEADING:, TAGLINE:, DESCRIPTION:, CARDS:, STEPS:, CTA:, ALTERNATIVES:, VOICE NOTES:). No JSON, no audit, no mechanical scan.
"""

    formatter_md = f"""# Formatter Inputs — {slug} ({page["name"]})

Riverwood Chapel · Project 3490

After **web-page-copywriter** has produced prose for {slug}, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

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
{jdump(page_meta)}
```

## Snippets Manifest (for tokenization step)

The formatter's tokenization step replaces literal values with `{{tokens}}` using this manifest:

```json
{jdump(snippets_manifest) if snippets_manifest else "{}"}
```

After the formatter produces JSON, invoke **web-page-reviewer** with the formatted JSON + the voice card + this snippets manifest to get the verdict. The reviewer will surface any literals that should have been tokenized AND propose new snippet candidates.
"""

    return brief_md, formatter_md


# ─── Generate briefs for every page ────────────────────────────────
OUT_DIR.mkdir(parents=True, exist_ok=True)

summary = []
for page in sitemap["pages"]:
    slug = page["slug"]
    stem = slug_to_filename(slug)
    brief_md, formatter_md = build_brief_for_page(page)

    brief_path = OUT_DIR / f"{stem}-copywriter-brief.md"
    formatter_path = OUT_DIR / f"{stem}-formatter-inputs.md"
    brief_path.write_text(brief_md)
    formatter_path.write_text(formatter_md)

    summary.append({
        "slug": slug,
        "name": page["name"],
        "brief_kb": brief_path.stat().st_size // 1024,
        "formatter_kb": formatter_path.stat().st_size // 1024,
        "sections": len(section_plan["sections_by_page"][slug]),
    })

print(f"Generated {len(summary)} brief/formatter pairs in {OUT_DIR}/")
print()
for s in summary:
    print(f"  {s['slug']:25s} {s['name']:25s} {s['sections']} sections   "
          f"brief={s['brief_kb']}kb  formatter={s['formatter_kb']}kb")
