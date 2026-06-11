# Brief Format

The shape of the input the copywriter expects. The user (or an upstream pipeline step) packages all this into a single message before invoking the copywriter.

## Top-level structure

```json
{
  "page_slug": "/kids",
  "page_metadata": {
    "name": "Kids",
    "primary_persona": "The Suburban Family",
    "keywords": {
      "primary": [...],
      "secondary": [...],
      "local": [...]
    }
  },
  "sections": [
    {
      "sort_order": 1,
      "concept_id": "hero_inner",
      "section_job": "<feeling-led brief>",
      "tagline_strategy": "informational" | "hook" | "omit" | null,
      "intent_summary": "<structural hint>",
      "atom_external_ref_ids": [...]
    }
  ],
  "content_page_map": [
    {
      "atom_external_ref_id": "...",
      "page_slug": "/kids",
      "section_sort_order": 1,
      "role": "canonical" | "reference" | "cta",
      "treatment": "..."
    }
  ],
  "atoms": [
    {
      "external_ref_id": "...",
      "topic": "kids_ministry",
      "body": "...",
      "body_short": "...",
      "verbatim": true | false,
      "content_quality": "clean" | "needs_review" | "raw_form_output",
      "source_kind": "content_collection" | "strategy_brief" | ...,
      "metadata": {...}
    }
  ],
  "facts": [
    {
      "topic": "service_time" | "address" | "phone" | "staff" | "contact_method",
      "body": "...",
      "metadata": {...}
    }
  ],
  "voice_card": {
    "tone_descriptors": [...],
    "banned_terms": [...],
    "branded_vocabulary": {...},
    "mission_statement": "...",
    "x_factor": "...",
    "persona_snapshots": [...],
    "syntax_rules": {...},
    "example_phrases_good": [...],
    "example_phrases_bad": [...],
    "anti_models": [...],
    "signature_moves": [...],
    "positive_voice_rules": [...],
    "sample_sentences_in_voice": [...],
    "persuasive_posture_by_persona": {...}
  },
  "max_chars_advisory": {
    "<concept_id>.<slot_key>": <int>
  }
}
```

## Key fields the copywriter must consult

**section_job** — the feeling-led brief for each section. Lead-with-emotion, not lead-with-facts. Examples:
- "Make a parent feel that their kid will be loved here and want to come back"
- "Tell a person walking through a hard season that they don't have to be okay to come here"
- "Disarm the awkwardness of a first visit"

**tagline_strategy** (hero sections only) — `informational` (factual qualifier), `hook` (persuasive promise), `omit` (utility pages).

**persuasive_posture_by_persona** — for the page's primary_persona, the writer's directive:
- `fear_to_disarm` — what to acknowledge then disarm
- `desire_to_name` — the visitor's actual want
- `proof_to_offer` — concrete proofs (saved for downstream sections, not the hero)
- `register_notes` — how to sound for this persona

**signature_moves + sample_sentences_in_voice** — the voice card's writer's brief. Sentence patterns the brand uses + concrete examples. Output should feel adjacent.

**atoms with content_quality** — atoms marked `raw_form_output` were demoted to `verbatim=false` by the normalizer. Free to clean and recompose. Atoms marked `clean` with `verbatim=true` lift exactly.

**max_chars_advisory** — write naturally and aim short. The formatter handles final fitting.

## What's NOT in the brief

- Brixies template schemas (slot names, max_chars enforcement) — the formatter handles those
- Mechanical scan rules (em-dashes, triads, banned terms) — the reviewer handles those
- JSON output schema — copywriter outputs prose, not JSON

If you're seeing template schemas or audit checklists in the brief, the orchestrator made an error. Stick to your job: read the brief, write the copy.

---

## Snippets manifest (added in v0.2)

If the brief includes a `snippets_manifest` section, it contains two parts:

```json
{
  "snippets_manifest": {
    "globals": {
      "church_name":          "Riverwood Chapel",
      "church_short_name":    "Riverwood",
      "address":              "...",
      "city_state":           "Kent, OH",
      "phone":                "...",
      "email":                "...",
      "denomination":         "Non-denominational",
      "pastor_name":          "...",
      "primary_service_time": "9:00 AM Sunday",
      "all_service_times":    "9:00, 10:15, 11:30 AM Sunday",
      "social_facebook_url":  "...",
      "social_instagram_url": "...",
      "social_youtube_url":   "...",
      "social_tiktok_url":    null,
      "social_twitter_url":   null,
      "social_linkedin_url":  null
    },
    "snippets": [
      {
        "token":       "kids_check_in_url",
        "label":       "Kids check-in link",
        "expansion":   "https://...",
        "description": "Used in Kids Wing pre-register CTAs",
        "tags":        ["cta", "kids"]
      }
    ]
  }
}
```

**What the copywriter does with it:** mostly nothing. Write naturally. Reference the church by name, list the service times, name the pastor — the formatter will tokenize literals into `{{church_name}}`, `{{all_service_times}}`, `{{pastor_name}}` etc. automatically.

If you want to use a token directly in your prose (e.g., `{{kids_check_in_url}}` as a CTA target), you can — but you don't have to. Soft preference, not enforcement.

**The reviewer will flag** literals that should have been tokens AND will surface candidate snippets — values you used 2+ times across the page that aren't yet in the manifest. That's the reviewer's job, not yours.
