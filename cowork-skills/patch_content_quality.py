#!/usr/bin/env python3
"""
Retroactively apply Rule 5 (content_quality + verbatim cleanup gate) to the
existing Riverwood normalizer output. Avoids re-running the whole extraction.

Reads:  cowork-skills/riverwood-normalizer-dry-run.json
Writes: cowork-skills/riverwood-normalizer-dry-run.json (in place; backup first)

Adds two fields to every atom:
  - content_quality: "clean" | "needs_review" | "raw_form_output"
  - handling_notes (appended) if quality is demoted from verbatim=true

Detection heuristics from web-intake-normalizer.md Rule 5:
  1. Missing space after [a-z][A-Z] inside a word
  2. HTML entity leakage (&nbsp;, &amp;, etc.)
  3. All-caps run-on text
  4. Inline timestamps without prose framing
  5. Repeated content patterns (paragraph duplicated)

Any atom flagged raw_form_output gets verbatim coerced to false.
"""
import json
import re
import shutil
from pathlib import Path

INPUT = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills/riverwood-normalizer-dry-run.json")
BACKUP = INPUT.with_suffix(".v1backup.json")
OUTPUT = INPUT  # in place


def detect_content_quality(body):
    """Return (quality, reasons[])."""
    if not body or not isinstance(body, str):
        return "clean", []

    reasons = []

    # 1. Missing space after lowercase-uppercase boundary inside a word
    # (e.g., "SchoolIt", "MorningOpen") — but ignore CamelCase proper nouns like "iPhone"
    mash_matches = re.findall(r"\b[a-z]+[A-Z][a-z]+", body)
    # Filter out known acceptable CamelCase (e.g., proper nouns, brand names)
    acceptable = {"iPhone", "iPad", "YouTube", "ChurchCenter", "GriefShare", "KidsWing", "MarkUp", "ContentSnare"}
    real_mash = [m for m in mash_matches if m not in acceptable and not any(a in m for a in acceptable)]
    if real_mash:
        reasons.append(f"word-boundary mash detected: {real_mash[:3]}")

    # 2. HTML entity leakage
    if re.search(r"&(nbsp|amp|lt|gt|quot|#\d+);", body):
        reasons.append("HTML entity leakage")
    if re.search(r"<(p|br|div|span|li|ul|ol)\b", body):
        reasons.append("raw HTML tags in body")

    # 3. All-caps run-on text (>200 chars all caps)
    if re.search(r"[A-Z]{200,}", body):
        reasons.append("all-caps run-on text")

    # 4. Long body with no sentence breaks (no `.` or `?` or `!` over 300 chars)
    if len(body) > 300 and not re.search(r"[.!?]\s", body):
        reasons.append("long body with no sentence breaks")

    # 5. Repeated content patterns — same 60-char window appearing 3+ times
    # (suggests duplicated paragraph block)
    if len(body) > 200:
        windows = [body[i:i+60] for i in range(0, len(body) - 60, 30)]
        from collections import Counter
        window_counts = Counter(windows)
        if any(ct >= 3 for ct in window_counts.values()):
            reasons.append("repeated content block")

    if reasons:
        return "raw_form_output", reasons
    return "clean", []


def main():
    with open(INPUT) as f:
        data = json.load(f)

    # Backup first
    if not BACKUP.exists():
        shutil.copy2(INPUT, BACKUP)
        print(f"Backup written to {BACKUP.name}")

    atoms = data.get("atoms", [])
    counts = {"clean": 0, "needs_review": 0, "raw_form_output": 0}
    demoted_verbatim = []

    for atom in atoms:
        body = atom.get("body", "")
        quality, reasons = detect_content_quality(body)
        atom["content_quality"] = quality
        counts[quality] = counts.get(quality, 0) + 1

        # Rule 5: raw_form_output atoms cannot be verbatim
        if quality == "raw_form_output" and atom.get("verbatim"):
            atom["verbatim"] = False
            existing_notes = atom.get("handling_notes", "") or ""
            note = ("Originally partner-authored verbatim source; demoted to non-verbatim "
                    "due to content_quality=raw_form_output (reasons: " + "; ".join(reasons) +
                    "). Needs human cleanup pass before re-marking verbatim.")
            atom["handling_notes"] = (existing_notes + " | " + note).strip(" | ") if existing_notes else note
            demoted_verbatim.append({
                "external_ref_id": atom.get("external_ref_id"),
                "topic": atom.get("topic"),
                "reasons": reasons,
                "body_preview": body[:80],
            })

    # Update skill_version + add patch metadata
    data["skill_version"] = "web_intake_normalizer v2 (patched in place)"
    data["content_quality_patch"] = {
        "applied_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "counts": counts,
        "demoted_verbatim_count": len(demoted_verbatim),
        "demoted_atoms": demoted_verbatim,
    }

    with open(OUTPUT, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nPatched {OUTPUT.name}")
    print(f"\n=== CONTENT QUALITY CLASSIFICATION ===")
    for q, ct in counts.items():
        print(f"  {q:20s} {ct} atoms")
    print(f"\n=== VERBATIM DEMOTIONS ({len(demoted_verbatim)}) ===")
    for d in demoted_verbatim:
        print(f"  • [{d['topic']}] {d['external_ref_id']}")
        print(f"    reasons: {', '.join(d['reasons'])}")
        print(f"    preview: {d['body_preview']!r}")
    print()


if __name__ == "__main__":
    main()
