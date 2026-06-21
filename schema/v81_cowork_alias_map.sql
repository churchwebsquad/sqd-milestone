-- v81 — Schema-driven cowork↔Brixies translation contract.
--
-- Each Brixies template (web_content_templates) now carries its own
-- cowork_alias_map: a per-template declaration of which Brixies field
-- receives which cowork uniform slot (primary_heading / tagline /
-- body / accent_body / items / buttons). Single source of truth —
-- replaces the per-template uniform_to_brixies block that used to
-- live in the standalone strategy.cowork_templates manifest.
--
-- The map is auto-derived by scripts/derive-cowork-aliases.ts from
-- each template's fields[] schema using heuristics:
--   • slot key='heading' → primary_heading
--   • slot key='description' (richtext) → body
--   • first non-decorative non-buttons group → items
--   • group key='buttons' (or CTA-family inverted 'image') → buttons
--   • nested groups (row_grid → card_team) descended one level
--   • split-group pairs (accordion_left + _right) emit split rule
--   • single CTA slot acts as a single-button bucket
--
-- The handoff (api/web/cowork/handoff-to-pages.ts) reads
-- cowork_alias_map directly per section's resolved template_id,
-- ending the divergence between what cowork emitted, what the
-- manifest claimed, and what Brixies actually supports.
--
-- Dependency audit 2026-06-21: web_content_templates has one
-- set_updated_at trigger + outbound FKs from web_sections and
-- strategy_web_projects (primary_header_template_id /
-- primary_footer_template_id) — no view, no matview, no FK pointing
-- IN that targets a specific column shape. Safe additive.

ALTER TABLE web_content_templates
  ADD COLUMN IF NOT EXISTS cowork_alias_map jsonb;

COMMENT ON COLUMN web_content_templates.cowork_alias_map IS
  'Schema-driven translator (v81). Each Brixies template declares which of its fields receives which cowork uniform slot. Replaces the standalone canonical-templates manifest. Derived by scripts/derive-cowork-aliases.ts; editable for known special cases. Shape:
{
  primary_heading?: string,
  tagline?:         string,
  body?:            string,
  accent_body?:     string,
  items?: {
    field:      string,
    subfields:  { item_heading?, item_body?, item_meta?, item_cta_label?, item_cta_url?, item_image? },
    referenced_template_id?: string,
    max_items?: number,
    split?:     { groups: [string, string], rule: "alternate" | "halve" },
    inner_group_field?: string
  },
  buttons?: {
    field:     string,
    subfields: { label?: string; url?: string },
    nesting:   "flat" | "contact" | "cta_slot",
    max_items?: number,
    is_slot?:  boolean
  }
}';
