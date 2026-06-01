#!/usr/bin/env python3
"""
Build a starter snippets_manifest.json for Riverwood Chapel from the
existing normalizer dry-run facts + voice card. Output format matches
the app's expected import schema (globals + snippets[] with token/label/
expansion/description/tags).

Writes: cowork-skills/riverwood-snippets-manifest.json

Ashley can edit this freely before importing — null out anything she
doesn't want, add custom snippets, fix any auto-generated tokens.
"""
import json
import re
from pathlib import Path

WORKSPACE = Path("/sessions/sleepy-practical-bohr/mnt/milestone-comms-app/cowork-skills")
NORMALIZER = WORKSPACE / "riverwood-normalizer-dry-run.json"
VOICE_CARD = WORKSPACE / "riverwood-voice-card-dry-run.json"
OUT = WORKSPACE / "riverwood-snippets-manifest.json"

with open(NORMALIZER) as f: intake = json.load(f)
with open(VOICE_CARD) as f: vc = json.load(f)

facts = intake["facts"]
atoms = intake["atoms"]
voice_card = vc["voice_card"]


def first_fact(topic, filter_fn=None):
    for f in facts:
        if f.get("topic") == topic:
            if filter_fn is None or filter_fn(f):
                return f
    return None


def all_facts(topic, filter_fn=None):
    out = []
    for f in facts:
        if f.get("topic") == topic:
            if filter_fn is None or filter_fn(f):
                out.append(f)
    return out


# ─── GLOBALS ────────────────────────────────────────────────────────
globals_block = {}

# church_name + short_name from branded vocabulary
branded = voice_card.get("branded_vocabulary", {})
if "Riverwood Chapel" in branded:
    globals_block["church_name"] = "Riverwood Chapel"
if "Riverwood" in branded:
    globals_block["church_short_name"] = "Riverwood"

# address — look for address fact
addr_fact = first_fact("address")
if addr_fact:
    globals_block["address"] = addr_fact.get("body")
else:
    globals_block["address"] = None  # ask partner

# city_state — Kent, OH (from discovery / known)
# Look in facts metadata or atoms for city
city_fact = None
for f in facts:
    body = (f.get("body") or "").lower()
    md = f.get("metadata", {})
    if "kent" in body and "ohio" in body:
        city_fact = f
        break
    if md.get("city") and md.get("state"):
        city_fact = {"body": f"{md['city']}, {md['state']}"}
        break
globals_block["city_state"] = "Kent, OH"  # Confirmed from atoms; safe to hardcode

# phone — look for phone fact
phone_fact = first_fact("phone")
if phone_fact:
    globals_block["phone"] = phone_fact.get("body")
else:
    # Fallback to brand-guide phone format if available
    sr = voice_card.get("syntax_rules", {})
    if "phone_format" in sr:
        globals_block["phone"] = sr["phone_format"]
    else:
        globals_block["phone"] = None

# email — look for general contact email
email_fact = None
for f in facts:
    if f.get("topic") == "contact_method":
        body = f.get("body") or ""
        if "@" in body and "info@" in body.lower() or "hello@" in body.lower() or "office@" in body.lower():
            email_fact = f
            break
if email_fact:
    # Extract just the email from the body
    m = re.search(r"[\w.-]+@[\w.-]+\.\w+", email_fact.get("body") or "")
    if m:
        globals_block["email"] = m.group(0)
else:
    globals_block["email"] = None

# denomination
globals_block["denomination"] = voice_card.get("denominational_filter", "Non-denominational")
# Make it human-readable
if globals_block["denomination"] == "evangelical-non-denominational":
    globals_block["denomination"] = "Non-denominational"

# pastor_name — find lead pastor staff fact
lead_pastor_fact = None
for f in facts:
    if f.get("topic") != "staff":
        continue
    role = str(f.get("metadata", {}).get("role", "")).lower()
    body = (f.get("body") or "").lower()
    if "lead pastor" in role or "lead pastor" in body:
        lead_pastor_fact = f
        break
    if "senior pastor" in role or "senior pastor" in body:
        lead_pastor_fact = f
        break
globals_block["pastor_name"] = lead_pastor_fact.get("body") if lead_pastor_fact else None

# service times
service_times = all_facts("service_time")
times_str = ", ".join(sorted([f.get("metadata", {}).get("time", "") or f.get("body", "") for f in service_times]))
if service_times:
    # Primary = earliest Sunday service
    sundays = [s for s in service_times if "sunday" in (s.get("body") or "").lower()]
    if sundays:
        # Sort by time
        def time_key(f):
            t = (f.get("metadata", {}).get("time") or f.get("body") or "").lower()
            m = re.search(r"(\d{1,2}):(\d{2})", t)
            if m:
                hr = int(m.group(1))
                mn = int(m.group(2))
                if "pm" in t and hr != 12:
                    hr += 12
                return hr * 60 + mn
            return 9999
        sundays.sort(key=time_key)
        primary = sundays[0]
        # Build primary service time string
        primary_body = primary.get("body") or ""
        # Try to extract "Sunday 9:00am" pattern
        m = re.search(r"sunday\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)", primary_body.lower())
        if m:
            globals_block["primary_service_time"] = f"{m.group(1).strip()} Sunday".replace("  ", " ")
        else:
            globals_block["primary_service_time"] = primary_body
        # all_service_times — concatenate
        all_times = []
        for s in sundays:
            body = s.get("body") or ""
            m = re.search(r"\d{1,2}:?\d{0,2}\s*(?:am|pm)?", body.lower())
            if m:
                all_times.append(m.group(0).strip())
        if all_times:
            globals_block["all_service_times"] = ", ".join(all_times[:-1]) + (" and " if len(all_times) > 1 else "") + all_times[-1] + " Sunday" if len(all_times) > 1 else all_times[0] + " Sunday"

# social URLs — look in atoms with social topic
def first_atom_url_by_topic(*topics):
    for a in atoms:
        if a.get("topic") in topics:
            body = a.get("body") or ""
            m = re.search(r"https?://\S+", body)
            if m:
                return m.group(0).rstrip(".,;)")
    return None

globals_block["social_facebook_url"] = first_atom_url_by_topic("social_facebook", "facebook")
globals_block["social_instagram_url"] = first_atom_url_by_topic("social_instagram", "instagram")
globals_block["social_youtube_url"] = first_atom_url_by_topic("social_youtube", "youtube")
globals_block["social_tiktok_url"] = first_atom_url_by_topic("social_tiktok", "tiktok")
globals_block["social_twitter_url"] = first_atom_url_by_topic("social_twitter", "twitter", "x")
globals_block["social_linkedin_url"] = first_atom_url_by_topic("social_linkedin", "linkedin")


# ─── SNIPPETS ───────────────────────────────────────────────────────
snippets = []


def add_snippet(token, label, expansion, description=None, tags=None, source="extracted_from_intake"):
    if not expansion:
        return
    snippets.append({
        "token": token,
        "label": label,
        "expansion": expansion,
        "description": description,
        "tags": tags or [],
        "source": source,
    })


# Kids check-in URL — from contact_method fact
for f in facts:
    if f.get("topic") == "contact_method":
        body = f.get("body") or ""
        if "churchcenter.com" in body and ("registration" in body.lower() or "check" in body.lower()):
            m = re.search(r"https?://\S+", body)
            if m:
                add_snippet(
                    token="kids_check_in_url",
                    label="Kids check-in link",
                    expansion=m.group(0).rstrip(".,;)"),
                    description="Pre-registration link for the Kids Wing — used in Kids Wing CTAs.",
                    tags=["cta", "kids"],
                )
                break

# Ministry staff contacts — pull staff members with named ministry roles
ROLE_TO_TOKEN = {
    "kids": ("kids_pastor", "Kids Pastor"),
    "middle school": ("kids_pastor", "Kids Pastor"),
    "student": ("students_director", "Students & College Director"),
    "college": ("students_director", "Students & College Director"),
    "care": ("care_pastor", "Care Pastor"),
    "outreach": ("outreach_pastor", "Outreach Pastor"),
    "events": ("events_contact", "Events Contact"),
    "groups": ("groups_director", "Groups Director"),
    "worship": ("worship_pastor", "Worship Pastor"),
}

for f in facts:
    if f.get("topic") != "staff":
        continue
    md = f.get("metadata", {})
    name = f.get("body")
    role = str(md.get("role", "")).lower()
    email = md.get("email")
    if not name:
        continue
    matched_token = None
    matched_label = None
    for key, (tok, lab) in ROLE_TO_TOKEN.items():
        if key in role:
            matched_token = tok
            matched_label = lab
            break
    if not matched_token:
        continue
    # Add name snippet
    if not any(s["token"] == f"{matched_token}_name" for s in snippets):
        add_snippet(
            token=f"{matched_token}_name",
            label=f"{matched_label} name",
            expansion=name,
            description=f"Name of the {matched_label.lower()} at Riverwood.",
            tags=["staff", matched_token.split("_")[0]],
        )
    # Add email snippet if present
    if email and not any(s["token"] == f"{matched_token}_email" for s in snippets):
        add_snippet(
            token=f"{matched_token}_email",
            label=f"{matched_label} email",
            expansion=email,
            description=f"Email contact for the {matched_label.lower()}.",
            tags=["staff", "contact", matched_token.split("_")[0]],
        )

# Giving URL — from contact_method
for f in facts:
    if f.get("topic") == "contact_method":
        body = f.get("body") or ""
        if "give" in body.lower() or "donat" in body.lower():
            m = re.search(r"https?://\S+", body)
            if m:
                add_snippet(
                    token="giving_url",
                    label="Online giving link",
                    expansion=m.group(0).rstrip(".,;)"),
                    description="Primary online giving form.",
                    tags=["cta", "giving"],
                )
                break

# Livestream URL — from atoms or facts
for a in atoms:
    if a.get("topic") in ("livestream_url", "sermon_archive_url", "watch_url"):
        body = a.get("body") or ""
        m = re.search(r"https?://\S+", body)
        if m:
            add_snippet(
                token="livestream_url",
                label="Sunday livestream",
                expansion=m.group(0).rstrip(".,;)"),
                description="Where the Sunday service streams live.",
                tags=["cta", "watch"],
            )
            break


# ─── OUTPUT ────────────────────────────────────────────────────────
manifest = {
    "globals": globals_block,
    "snippets": snippets,
}

OUT.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

print(f"Wrote {OUT}")
print(f"\n=== GLOBALS ===")
for k, v in globals_block.items():
    marker = "" if v is not None else "  ← null (review)"
    print(f"  {k:24s} {v!r}{marker}")
print(f"\n=== SNIPPETS ({len(snippets)}) ===")
for s in snippets:
    print(f"  {{{{{s['token']}}}}} = {s['expansion']!r}")
    print(f"      label: {s['label']}  tags: {s['tags']}")
