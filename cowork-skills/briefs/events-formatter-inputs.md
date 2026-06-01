# Formatter Inputs — /events (Events)

Riverwood Chapel · Project 3490

After **web-page-copywriter** has produced prose for /events, invoke `/format-page` and paste this file. The formatter will map the copywriter's structural markers to Brixies `field_values` JSON using these bound template schemas.

## Bound Templates (one per section)

```json
[
  {
    "section_sort_order": 1,
    "concept_id": "hero_inner",
    "tagline_strategy": "omit",
    "section_job": "Let a visitor scan one page and feel the pace and texture of what's happening at the church right now",
    "template_id": "hero-section-1",
    "template_layer_name": "Hero Section 1",
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
      },
      {
        "key": "image",
        "kind": "slot",
        "type": "image",
        "layer_name": "Image"
      }
    ]
  },
  {
    "section_sort_order": 2,
    "concept_id": "archive_filter",
    "tagline_strategy": null,
    "section_job": "Help the visitor find one event in the next few weeks where they could show up and meet someone",
    "template_id": "blog-section-18",
    "template_layer_name": "Blog Section 18",
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
        "key": "card_blog",
        "kind": "group",
        "layer_name": "Card blog",
        "item_schema": [
          {
            "key": "image_card_blog",
            "kind": "slot",
            "type": "image",
            "layer_name": "Image"
          },
          {
            "key": "heading_card_blog",
            "kind": "slot",
            "type": "text",
            "required": true,
            "max_chars": 100,
            "layer_name": "Heading",
            "heading_level": 2
          },
          {
            "key": "time_read_card_blog",
            "kind": "slot",
            "type": "text",
            "label": "Reading time",
            "scope": "post",
            "max_chars": 20,
            "layer_name": "Time read"
          },
          {
            "key": "buttons_card_blog",
            "kind": "slot",
            "type": "cta",
            "label": "CTA",
            "layer_name": "Buttons"
          }
        ],
        "default_count": 4
      }
    ]
  },
  {
    "section_sort_order": 3,
    "concept_id": "contact_section",
    "tagline_strategy": null,
    "section_job": "Give a visitor with a logistical question about an event a real person to write to instead of guessing",
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
  }
]
```

## Page Metadata (for strategic_setup if requested)

```json
{
  "page_slug": "/events",
  "name": "Events",
  "primary_persona": "The Suburban Family",
  "keywords": {
    "primary": [
      "Riverwood Chapel events",
      "Kent Ohio church events",
      "Riverwood Chapel calendar"
    ],
    "secondary": [
      "Community events Kent Ohio church",
      "Riverwood VBS",
      "Sports camp Kent OH",
      "Church events Portage County"
    ],
    "long_tail": [
      "What events are happening at Riverwood Chapel",
      "Upcoming events Riverwood Chapel"
    ],
    "local": [
      "Family events Kent Ohio church"
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
