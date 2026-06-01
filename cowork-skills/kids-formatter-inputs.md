# Formatter Inputs — /kids

After **web-page-copywriter** has produced prose for /kids, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

## Bound Templates (one per section)

```json
[
  {
    "section_sort_order": 1,
    "concept_id": "hero_inner",
    "tagline_strategy": "informational",
    "section_job": "Make a parent feel that their kid will be loved here and want to come back. Address the parent's actual desire (a child who loves church and is known by name), not their logistics question",
    "template_id": "hero-section-102",
    "template_layer_name": "Hero Section 102",
    "fields": [
      {
        "key": "tagline",
        "kind": "slot",
        "type": "text",
        "max_chars": 60,
        "layer_name": "Tagline"
      },
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "buttons",
        "kind": "group",
        "layer_name": "Buttons",
        "item_schema": [
          {
            "key": "contact",
            "kind": "slot",
            "type": "text",
            "label": "Button label",
            "scope": "button",
            "max_chars": 30,
            "layer_name": "Contact"
          }
        ],
        "default_count": 2
      }
    ]
  },
  {
    "section_sort_order": 2,
    "concept_id": "content_image_text",
    "tagline_strategy": null,
    "section_job": "Help a parent feel that what their kid hears on Sunday is the real thing, taught by people who are actually partnering with them as parents",
    "template_id": "content-section-1",
    "template_layer_name": "Content Section 1",
    "fields": [
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "buttons",
        "kind": "slot",
        "type": "cta",
        "label": "CTA",
        "layer_name": "Buttons"
      }
    ]
  },
  {
    "section_sort_order": 3,
    "concept_id": "feature_card_grid",
    "tagline_strategy": null,
    "section_job": "Let each parent see their kid on this page — at their age, in their stage — so they know the church has thought specifically about who their child is",
    "template_id": "feature-section-14",
    "template_layer_name": "Feature section 14",
    "fields": [
      {
        "key": "heading",
        "kind": "slot",
        "type": "text",
        "required": true,
        "max_chars": 100,
        "layer_name": "Heading",
        "heading_level": 2
      },
      {
        "key": "description",
        "kind": "slot",
        "type": "richtext",
        "max_chars": 400,
        "layer_name": "Description"
      },
      {
        "key": "image",
        "kind": "slot",
        "type": "image",
        "layer_name": "Image"
      },
      {
        "key": "card",
        "kind": "group",
        "layer_name": "Card",
        "item_schema": [
          {
            "key": "heading_card",
            "kind": "slot",
            "type": "text",
            "required": true,
            "max_chars": 100,
            "layer_name": "Heading",
            "heading_level": 2
          },
          {
            "key": "description_card",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Description"
          },
          {
            "key": "buttons_card",
            "kind": "slot",
            "type": "cta",
            "label": "CTA",
            "layer_name": "Buttons"
          }
        ],
        "default_count": 3
      }
    ]
  },
  {
    "section_sort_order": 4,
    "concept_id": "feature_unique",
    "tagline_strategy": null,
    "section_job": "Walk a nervous parent through the exact moment of Sunday morning when their hand will leave their kid's, and make it feel okay",
    "template_id": "feature-section-1",
    "template_layer_name": "Feature Section 1",
    "fields": [
      {
        "key": "container_left",
        "kind": "group",
        "layer_name": "Container left",
        "item_schema": [
          {
            "key": "heading",
            "kind": "slot",
            "type": "text",
            "required": true,
            "max_chars": 100,
            "layer_name": "Heading",
            "heading_level": 2
          },
          {
            "key": "description",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Description"
          }
        ],
        "default_count": 2
      }
    ]
  },
  {
    "section_sort_order": 5,
    "concept_id": "cta_simple",
    "tagline_strategy": null,
    "section_job": "Turn a parent's 'we're going to try it' into a small action right now that means Sunday morning is already easier",
    "template_id": "banner-section-1",
    "template_layer_name": "Banner Section 1",
    "fields": [
      {
        "key": "info_wrapper",
        "kind": "group",
        "layer_name": "Info wrapper",
        "item_schema": [
          {
            "key": "description",
            "kind": "slot",
            "type": "richtext",
            "max_chars": 400,
            "layer_name": "Info"
          }
        ],
        "default_count": 6
      }
    ]
  }
]
```

## Page Metadata (for strategic_setup if requested)

```json
{
  "page_slug": "/kids",
  "name": "Kids at Riverwood",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel kids",
      "Kids ministry Kent Ohio",
      "Children's church Kent"
    ],
    "secondary": [
      "Riverwood nursery",
      "Sunday school Kent Ohio",
      "Kids check-in Riverwood Chapel",
      "Gospel Project curriculum Kent",
      "Kids Wing Kent church",
      "Children Sunday programs Kent OH"
    ],
    "long_tail": [
      "Where is the kids wing at Riverwood Chapel",
      "Pre-register Riverwood Chapel kids",
      "Age groups Riverwood kids ministry"
    ],
    "local": [
      "Family church Kent OH",
      "Kids programs Portage County",
      "Kent Ohio Sunday school"
    ]
  }
}
```

The formatter's job is mechanical: parse the prose, map markers to slot keys, apply max_chars (trim safely or flag), output JSON. No creative rewriting. If a slot needs structural shortening, kick back to the copywriter.

After the formatter produces JSON, invoke **web-page-reviewer** with the formatted JSON + the voice card from the original brief to get the verdict.
