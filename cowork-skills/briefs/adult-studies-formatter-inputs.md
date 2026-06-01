# Formatter Inputs — /adult-studies (Adult Studies & Classes)

Riverwood Chapel · Project 3490

After **web-page-copywriter** has produced prose for /adult-studies, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

## Bound Templates (one per section)

```json
[
  {
    "section_sort_order": 1,
    "concept_id": "hero_inner",
    "tagline_strategy": "informational",
    "section_job": "Make an adult feel that life at this church doesn't end when Sunday does — that there are rooms full of people who want to know them by name",
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
    "concept_id": "feature_card_grid",
    "tagline_strategy": null,
    "section_job": "Let each adult see the small-group option that fits their season — single, married, mid-life, post-kids, in a hard place — without having to translate",
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
    "section_sort_order": 3,
    "concept_id": "accordion_faq",
    "tagline_strategy": null,
    "section_job": "Quietly answer the awkward questions about small groups (do I have to host, do I have to share, can I leave) so a hesitant adult can sign up without anxiety",
    "template_id": "faq-section-1",
    "template_layer_name": "FAQ Section 1",
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
      }
    ]
  }
]
```

## Page Metadata (for strategic_setup if requested)

```json
{
  "page_slug": "/adult-studies",
  "name": "Adult Studies & Classes",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel life groups",
      "Bible study Kent Ohio",
      "Adult Bible study Kent"
    ],
    "secondary": [
      "Men's group Kent OH",
      "Women's Bible study Kent",
      "Small group Kent Ohio church",
      "Discipleship class Riverwood",
      "Five investments framework"
    ],
    "long_tail": [
      "Where to join a Bible study in Kent",
      "How to find a life group at Riverwood"
    ],
    "local": [
      "Bible studies Kent Ohio"
    ]
  }
}
```

## Snippets Manifest (for tokenization step)

The formatter's tokenization step replaces literal values with `{tokens}` using this manifest:

```json
{
  "globals": {
    "church_name": "Riverwood Chapel",
    "church_short_name": "Riverwood",
    "address": null,
    "city_state": "Kent, OH",
    "phone": "330.678.7000",
    "email": "Info@riverwoodchapel.org",
    "denomination": "Non-denominational",
    "pastor_name": "Cole Tawney",
    "primary_service_time": "7:45 Sunday",
    "all_service_times": "7:45, 9:00, 10:15 and 11:30 Sunday",
    "social_facebook_url": null,
    "social_instagram_url": null,
    "social_youtube_url": null,
    "social_tiktok_url": null,
    "social_twitter_url": null,
    "social_linkedin_url": null
  },
  "snippets": [
    {
      "token": "kids_check_in_url",
      "label": "Kids check-in link",
      "expansion": "https://riverwoodchapel.churchcenter.com/registrations",
      "description": "Pre-registration link for the Kids Wing — used in Kids Wing CTAs.",
      "tags": [
        "cta",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "worship_pastor_name",
      "label": "Worship Pastor name",
      "expansion": "Jim Bossler",
      "description": "Name of the worship pastor at Riverwood.",
      "tags": [
        "staff",
        "worship"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "worship_pastor_email",
      "label": "Worship Pastor email",
      "expansion": "jim.bossler@riverwoodchapel.org",
      "description": "Email contact for the worship pastor.",
      "tags": [
        "staff",
        "contact",
        "worship"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "care_pastor_name",
      "label": "Care Pastor name",
      "expansion": "Jeff Haynes",
      "description": "Name of the care pastor at Riverwood.",
      "tags": [
        "staff",
        "care"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "care_pastor_email",
      "label": "Care Pastor email",
      "expansion": "jeff.haynes@riverwoodchapel.org",
      "description": "Email contact for the care pastor.",
      "tags": [
        "staff",
        "contact",
        "care"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "kids_pastor_name",
      "label": "Kids Pastor name",
      "expansion": "Josh Miller",
      "description": "Name of the kids pastor at Riverwood.",
      "tags": [
        "staff",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "kids_pastor_email",
      "label": "Kids Pastor email",
      "expansion": "josh.miller@riverwoodchapel.org",
      "description": "Email contact for the kids pastor.",
      "tags": [
        "staff",
        "contact",
        "kids"
      ],
      "source": "extracted_from_intake"
    },
    {
      "token": "livestream_url",
      "label": "Sunday livestream",
      "expansion": "https://www.youtube.com/live/hBK_Mzo64h4?si=zLC5KbRKjA_onIso",
      "description": "Where the Sunday service streams live.",
      "tags": [
        "cta",
        "watch"
      ],
      "source": "extracted_from_intake"
    }
  ]
}
```

After the formatter produces JSON, invoke **web-page-reviewer** with the formatted JSON + the voice card + this snippets manifest to get the verdict. The reviewer will surface any literals that should have been tokenized AND propose new snippet candidates.
