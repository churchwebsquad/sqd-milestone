# Formatter Inputs — /story-beliefs (Our Story & Beliefs)

Riverwood Chapel · Project 3490

After **web-page-copywriter** has produced prose for /story-beliefs, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

## Bound Templates (one per section)

```json
[
  {
    "section_sort_order": 1,
    "concept_id": "hero_inner",
    "tagline_strategy": "hook",
    "section_job": "Make a visitor sense that this church has been here long enough to be trusted, and is clear enough about what it believes to be honest with",
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
    "section_job": "Let the visitor read the mission and feel that this church actually lives it — that the sentence describes what they'd find here next Sunday",
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
    "concept_id": "timeline_story",
    "tagline_strategy": null,
    "section_job": "Let the visitor see that the church is older than them and still moving, so joining it means joining something already in motion",
    "template_id": "timeline-section-16",
    "template_layer_name": "Timeline Section 16",
    "fields": [
      {
        "key": "image",
        "kind": "slot",
        "type": "image",
        "layer_name": "Image"
      },
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
        "key": "slide",
        "kind": "group",
        "layer_name": "Slide",
        "item_schema": [
          {
            "key": "card",
            "kind": "group",
            "layer_name": "Card",
            "item_schema": [
              {
                "key": "description_card",
                "kind": "slot",
                "type": "richtext",
                "max_chars": 400,
                "layer_name": "Description"
              },
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
                "key": "year_card",
                "kind": "slot",
                "type": "text",
                "max_chars": 100,
                "layer_name": "Year",
                "heading_level": 2
              }
            ],
            "default_count": 1,
            "single_instance_hint": true
          }
        ],
        "default_count": 3
      }
    ]
  },
  {
    "section_sort_order": 4,
    "concept_id": "feature_card_grid",
    "tagline_strategy": null,
    "section_job": "Make the visitor feel the values as a description of the church's personality — what they'd notice if they sat through a Sunday and a small group and a Wednesday night",
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
    "section_sort_order": 5,
    "concept_id": "accordion_faq",
    "tagline_strategy": null,
    "section_job": "Let a visitor with theological caution see exactly what's believed here without having to ask anyone, so they can decide for themselves whether it fits",
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
  "page_slug": "/story-beliefs",
  "name": "Our Story & Beliefs",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel beliefs",
      "Riverwood Chapel statement of faith",
      "Riverwood Chapel history"
    ],
    "secondary": [
      "What does Riverwood believe",
      "Statement of faith Kent Ohio church",
      "Non-denominational evangelical beliefs Kent",
      "Riverwood Chapel since 1991",
      "Riverwood doctrine"
    ],
    "long_tail": [
      "What does Riverwood Chapel teach about salvation",
      "Riverwood Chapel statement of beliefs",
      "Christian beliefs Kent Ohio"
    ],
    "local": [
      "Kent Ohio Christian beliefs"
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
