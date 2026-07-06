// ============================================================================
// Database types matching ALL Supabase tables
// 4 existing read-only tables + 5 new strategy_ tables
// ============================================================================

export type AssetType =
  | 'loom_video'
  | 'brand_guide'
  | 'markup_review'
  | 'figma_file'
  | 'dropbox_folder'
  | 'style_guide'
  | 'mood_board'
  | 'contentsnare'
  | 'website_link'
  | 'document'
  | 'vista_social'
  | 'form'
  | 'attachment'
  | 'partner_review_link'
  | 'other'

/** ClickUp message delivery status (did the message send successfully?) */
export type SubmissionStatus = 'draft' | 'sent' | 'failed'

/**
 * Milestone workflow status — tracks where a partner's milestone
 * stands in the feedback/revision cycle AFTER initial delivery.
 */
export type MilestoneStatus =
  | 'sent'              // delivered, awaiting partner
  | 'waiting_on_partner' // explicitly marked as waiting
  | 'partner_replied'   // cron detected a reply from partner
  | 'in_revision'       // team is actively revising
  | 'approved'          // partner approved deliverable
  | 'escalated'         // flagged for manager attention

/** Manual triage classification applied to partner replies. */
export type TriageCategory = 'quick_fix' | 'larger_revision' | 'start_over' | 'no_action_needed'

export type Squad = 'brand' | 'web' | 'social'

// ============================================================================
// EXISTING READ-ONLY TABLES
// ============================================================================

export interface StrategyAccountProgress {
  member: number
  church_name: string | null
  first_name_of_primary: string | null
  css_rep: string | null
  web_designer: string | null
  web_strategist: string | null
  portal_token: string | null
  // Churches Dashboard fields
  plan: string | null
  cohort: string | null
  website: string | null
  handoff_brand_form: Record<string, unknown> | null
  handoff_web_form: Record<string, unknown> | null
  [key: string]: unknown
}

export interface ClickupChatChannel {
  id: string
  memberid: string | null
  [key: string]: unknown
}

export interface ClickupUser {
  clickup_id: number
  email: string | null
  username: string | null
  account_id: number | null
  employee: string | null
  [key: string]: unknown
}

export interface Employee {
  id: string
  email: string | null
  name: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  department: string | null
  role: string | null
  status: string | null
  clickup_id: number | null
  slack_id: string | null
  avatar_url: string | null
  airtable_rec_id: string
  [key: string]: unknown
}

export interface PrfBrandGuide {
  account: number | null
  [key: string]: unknown
}

export interface StrategySocialProProfile {
  member:      number
  church_name: string | null
  css_rep:     string | null
  plan:        string | null
  website:     string | null
  notes:       string | null
  created_by:  string | null
  created_at:  string
  updated_at:  string
}

// ============================================================================
// EXISTING READ-ONLY TABLES — ClickUp / task pipeline
// ============================================================================

export interface Account {
  account: number
  church_name: string | null
  status: string | null
  folder_id: number | null
  website: string | null
  facebook: string | null
  instagram: string | null
  primary_email: string[] | null
  current_sub_start: string | null
  original_sub_start: string | null
  timezone: string | null
  address: string | null
  attendance: number | null
  campuses: number | null
  monthly_rate: number | null
  dropbox_folder_id: string | null
  high_usage: boolean | null
  comms_rep: string | null
  acc_airtable_data: Record<string, unknown> | null
  pa_preferences: Record<string, unknown> | null
  row_created: string
  row_updated: string | null
  [key: string]: unknown
}

export interface ClickupFolder {
  id: number
  name: string | null
  space_id: number | null
  account: number | null
  created_at: string
  [key: string]: unknown
}

export interface ClickupList {
  id: number
  name: string
  folder: number | null
  space: number | null
  account: number | null
  department: string | null
  list_type: string | null
  active: boolean | null
  created_at: string
  [key: string]: unknown
}

export interface ClickupTask {
  task_id: string
  name: string
  created_at: string | null
  list_id: number | null
  task_archived: boolean | null
  row_created: string
  linked_tasks: string[] | null
  [key: string]: unknown
}

export interface StatusHistory {
  task_id: string
  status_after: string
  changed_at: string
  [key: string]: unknown
}

export interface AssigneeHistory {
  task_id: string
  assignee: number | null
  change_type: string | null
  [key: string]: unknown
}

export interface TaskDeletion {
  task_id: string
  [key: string]: unknown
}

export interface WebsiteSupportAudit {
  airtable_id: string
  name: string
  reason_code: string | null
  websites_allowed: string | null
  website_accounts: string | null
  [key: string]: unknown
}

// ============================================================================
// NEW STRATEGY_ TABLES
// ============================================================================

/** Church Intelligence Profile — Social's intel layer per church */
export interface StrategyChurchIntel {
  id: string
  member: number
  notion_page_id: string | null
  notion_page_url: string | null
  intel_profile: ChurchIntelProfile | null
  intel_version: number
  intel_updated_at: string
  intel_updated_by: string | null
  homepage_screenshot_path: string | null
  status: 'draft' | 'live' | 'needs_refresh'
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyChurchIntelHistory {
  id: string
  church_intel_id: string
  version: number
  intel_profile: ChurchIntelProfile | null
  author_email: string | null
  reason: string | null
  created_at: string
  [key: string]: unknown
}

/** The JSON shape Amber's Church Intel prompt produces */
export interface ChurchIntelProfile {
  church_name?: string
  church_number?: string
  website?: string
  tagline_or_mission?: string
  pastor_name?: string | null
  denomination?: string
  audience?: {
    primary?: string
    secondary?: string | null
    content_implication?: string
  }
  campus_locations?: string
  brand_voice?: {
    tone_summary?: string
    attributes?: Array<{
      name: string
      description: string
      write_with_this_in_mind: string
    }>
    vocabulary?: string[]
    avoid?: string[]
  }
  design?: {
    primary_colors?: string
    accent_colors?: string
    visual_style?: string
    adobe_fonts?: string[]
  }
  sermon_recap_videos?: {
    clip_selection_guidance?: string
    caption_style?: string
    cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] }
    music_preference?: string
    cover_frame?: string
    hook_approach?: string
    worship_reels?: { recommendation?: string; reasoning?: string }
  }
  carousel_post?: {
    tone?: string
    slide_structure?: string
    design_notes?: string
    cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] }
  }
  photo_recap_post?: {
    caption_tone?: string
    caption_example?: string
    what_to_highlight?: string
    cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] }
  }
  sunday_invite_post?: {
    tone?: string
    caption_pattern?: string
    caption_example?: string
    cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] }
  }
  caption_cta_patterns?: {
    observed_pattern?: string
    examples?: string[]
    recommendation?: string
  }
  facebook_text_post?: {
    style?: string
    engagement_approach?: string
    example?: string
    cta?: { consistent?: boolean; pattern?: string | null; observed_examples?: string[] }
  }
  what_performs_well?: {
    summary?: string
    themes?: string[]
    avoid_content?: string
  }
  upcoming_opportunities?: string
  week1_tip?: string
}

export interface StrategyMilestoneDefinition {
  id: string
  squad: Squad
  pathway: string
  step_number: number
  step_name: string
  section_group: string | null
  is_partner_facing: boolean
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyMessageTemplate {
  id: string
  milestone_id: string
  template_variant: string
  subject_line: string | null
  template_body: string
  is_active: boolean
  /** Default for the Standard Footer toggle when this template is applied. */
  include_footer: boolean
  /** Default for the All-In Updates Recap toggle when this template is applied. */
  include_recap: boolean
  last_edited_by: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyMilestoneSubmission {
  id: string
  member: number
  milestone_id: string
  template_id: string | null
  is_continuation: boolean
  continuation_of: string | null
  /** Optional track label within a pathway (e.g. "Kids Ministry" subbrand).
   *  NULL for single-track pathways like Brand New, Web Redesign, etc. */
  track_name: string | null
  current_milestone_id: string
  next_milestone_id: string | null
  rendered_message: string
  clickup_channel_id: string | null
  clickup_message_id: string | null
  clickup_thread_url: string | null
  partner_contact_name: string | null
  partner_contact_clickup_id: number | null
  submitted_by_email: string
  submitted_by_name: string | null
  submitted_at: string
  updated_at: string
  status: SubmissionStatus          // ClickUp delivery status
  milestone_status: MilestoneStatus // workflow status (default 'sent')
  /** Soft-delete flag. Archived rows (`false`) are hidden from the
   *  partner portal, dashboards, continuation lookups, and reply
   *  scrubbing — but still visible to staff via the AccountLog
   *  "Show archived" toggle for restore. */
  is_active: boolean
  [key: string]: unknown
}

export interface StrategySubmissionAsset {
  id: string
  submission_id: string
  asset_type: AssetType
  asset_url: string
  asset_label: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyMilestoneReply {
  id: string
  submission_id: string
  reply_text: string
  reply_author_name: string
  reply_author_email: string | null
  is_partner_reply: boolean
  triage_category: TriageCategory | null
  edit_task_url: string | null      // set by n8n after ClickUp task creation
  source: string                   // 'clickup_thread' | 'markup_review'
  detected_at: string              // timestamptz
  clickup_reply_id: string | null
  /** markup_review replies are auto-grouped under a folder row (is_folder=true).
   *  Staff triage the folder; children are auto-set to 'no_action_needed' and
   *  render as collapsible context under the folder. ClickUp replies stay as
   *  standalone rows (is_folder=false, folder_id=null). */
  is_folder: boolean
  folder_id: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

// ============================================================================
// COPY REVIEW — partner-facing website copy review surface
// ============================================================================

export type CopyReviewStatus = 'draft' | 'open' | 'submitted' | 'finalized'
export type CopyReviewDecision = 'approved' | 'edit_requested'
export type CopyReviewAuthorKind = 'partner' | 'staff'

/** Parsed tree produced by src/lib/parseCopyReviewHtml.ts */
export interface ParsedCopyReviewBlock {
  id: string                      // Notion <p id="…"> uuid (stable)
  kind: 'copy' | 'metadata'
  label: string | null            // "H1", "Primary CTA Button", "Metadata Title", etc.
  text: string
}
export interface ParsedCopyReviewSection {
  id: string                      // H3 element uuid, or synthetic "intro"
  label: string
  blocks: ParsedCopyReviewBlock[]
}
export interface ParsedCopyReviewPage {
  id: string                      // slug of label
  label: string
  url: string | null
  emoji: string | null
  sections: ParsedCopyReviewSection[]
}
export interface ParsedCopyReview {
  title: string
  pages: ParsedCopyReviewPage[]
}

export interface StrategyCopyReview {
  id: string
  member: number
  title: string
  status: CopyReviewStatus
  source_html: string
  parsed: ParsedCopyReview
  submitted_at: string | null
  finalized_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyCopyReviewDecision {
  id: string
  review_id: string
  block_id: string
  decision: CopyReviewDecision
  decided_at: string
  [key: string]: unknown
}

export interface StrategyCopyReviewComment {
  id: string
  review_id: string
  block_id: string
  author_kind: CopyReviewAuthorKind
  author_name: string | null
  author_uid: string | null
  body: string
  resolved: boolean
  client_id: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyCopyReviewEdit {
  id: string
  review_id: string
  block_id: string
  proposed_text: string
  author_kind: CopyReviewAuthorKind
  created_at: string
  [key: string]: unknown
}

/** Shape returned by get_copy_review_by_token RPC */
export interface CopyReviewPortalPayload {
  review: {
    id: string
    member: number
    title: string
    status: CopyReviewStatus
    parsed: ParsedCopyReview
    submitted_at: string | null
    finalized_at: string | null
    created_at: string
  }
  decisions: Array<{
    block_id: string
    decision: CopyReviewDecision
    decided_at: string
  }>
  comments: Array<{
    id: string
    block_id: string
    author_kind: CopyReviewAuthorKind
    author_name: string | null
    body: string
    resolved: boolean
    client_id: string | null
    created_at: string
    updated_at: string
  }>
}

// ============================================================================
// BRAND GUIDES — online brand portal + PDF export
// ============================================================================

export type BrandLogoKind = 'primary' | 'secondary' | 'badge' | 'icon'
/** Partner-facing categorization for a brand color. Surfaced as the
 *  section heading on the portal palette. Staff-only "this color is
 *  used for page background / body text" metadata lives on the
 *  separate `interface_role` field — it's not partner-visible. */
export type BrandColorTier = 'primary' | 'secondary' | 'accent' | 'light' | 'dark'

/** Staff-only interface metadata — flags which palette swatch should
 *  be used as the page background / body text on the portal theme
 *  itself. Does NOT affect the partner-facing palette categorization
 *  (that's `tier`). Nullable: most colors don't carry an interface
 *  role; a brand typically has one of each at most. */
export type BrandColorInterfaceRole = 'background' | 'text'
export type BrandTypographyTier = 'primary' | 'subheading' | 'secondary' | 'accent'
export type BrandElementKind = 'pattern' | 'texture' | 'application'

export interface StrategyBrandGuide {
  id: string
  member: number
  parent_id: string | null
  slug: string
  display_name: string
  contact_name: string | null
  contact_email: string | null
  voice_overview: string | null
  brand_statement: string | null
  assets_zip_url: string | null
  /** External link (Dropbox / Drive / Cloudinary / etc.) to the brand's
   *  animations. Animations don't fit inside the bulk-assets zip (too
   *  large), so we stash the URL here and render it as a separate
   *  "Animations" affordance on the portal. */
  animations_url: string | null
  is_published: boolean
  last_updated_at: string | null
  created_by: string | null
  /** Optional Adobe Swatch Exchange (.ase) file — opens in
   *  Photoshop/Illustrator to import the palette in one step. Renders as a
   *  download button on the public portal's Color section and the handoff
   *  Overview tab. */
  ase_swatch_url: string | null
  /** Controlled-vocabulary tags for internal handoff classification (minimal,
   *  bold, colorful, etc.). Managed in the staff editor; surfaces on the
   *  handoff doc Overview tab. Not exposed on the partner-facing portal. */
  style_tags: string[]
  /** Short designer-facing brief (1–3 sentences) from the brand squad.
   *  Staff-only — not in the public RPC payload. */
  handoff_notes: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface StrategyBrandLogo {
  id: string
  brand_guide_id: string
  kind: BrandLogoKind
  label: string | null
  preview_url: string
  download_url: string | null
  /** Optional animation file (mp4/webm/Lottie JSON) for this specific
   *  logo variant. Surfaced as a video tile alongside the still logo
   *  on the public portal + brand handoff. NULL when the variant has
   *  no motion version. */
  animation_url: string | null
  /** Optional background color (hex) used behind this logo in the
   *  portal render. Useful for light/inverse logos that would
   *  disappear against the default white card. NULL → use white. */
  background_color: string | null
  clear_space_note: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandColor {
  id: string
  brand_guide_id: string
  name: string | null
  tier: BrandColorTier
  /** Staff-only interface metadata — null for most palette colors;
   *  set to 'background' or 'text' to mark which swatch should drive
   *  the portal theme's page bg / body text. NOT surfaced on the
   *  partner palette display (tier handles that). */
  interface_role: BrandColorInterfaceRole | null
  hex: string
  cmyk: string | null
  rgb: string | null
  pms: string | null
  proportion_pct: number | null
  on_color_logo_url: string | null
  /** Scale (percent, 10-200) applied to the on-color logo when
   *  rendered against this color's background on the portal. Default
   *  100 = native size. Used to balance varied logo sizes across the
   *  on-color grid. */
  on_color_logo_scale_pct: number | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandColorCombination {
  id: string
  brand_guide_id: string
  bg_color_id: string | null
  fg_color_id: string | null
  override_logo_url: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandTypography {
  id: string
  brand_guide_id: string
  tier: BrandTypographyTier
  family_name: string
  weight: string | null
  /** Friendly weight description shown to partners/designers — e.g. "Bold",
   *  "Semibold", "Medium only". The `weight` column remains the technical
   *  source (numeric list like "400, 700"). */
  weight_label: string | null
  suggested_use: string | null
  /** How the typeface should be set — e.g. "UPPERCASE", "Title Case",
   *  "Sentence case". Free text. */
  letter_case: string | null
  /** Open-source source — Google Fonts URL or uploaded webfont file URL.
   *  When this is a Google Fonts URL, the editor auto-prefills
   *  `web_font_family` from `family_name`. */
  font_url: string | null
  /** Where to purchase a license for the custom / paid font. Presence of
   *  this URL signals "the family_name is a paid typeface"; the editor
   *  then flags `free_alt_*` as required. */
  custom_font_purchase_url: string | null
  /** Royalty-free alternative used when the paid font isn't licensed. */
  free_alt_family: string | null
  free_alt_font_url: string | null
  /** CSS family the online brand guide + downstream web projects render
   *  text in. Required on every row — auto-prefilled by the editor when
   *  `font_url` is a Google Fonts URL. */
  web_font_family: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandElement {
  id: string
  brand_guide_id: string
  kind: BrandElementKind
  label: string | null
  preview_url: string | null
  download_url: string | null
  /** Optional background color (hex) for the element preview tile in
   *  the portal. Useful for low-opacity patterns/textures that vanish
   *  against the default white background. NULL → use white. */
  pattern_background_color: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandVoiceAttribute {
  id: string
  brand_guide_id: string
  title: string
  description: string
  sort_order: number
  created_at: string
  [key: string]: unknown
}

/** Same shape as StrategyBrandVoiceAttribute. Portal renders voice_attributes
 *  as "Tone Characteristics" and voice_guidelines as "Voice Guidelines". */
export interface StrategyBrandVoiceGuideline {
  id: string
  brand_guide_id: string
  title: string
  description: string
  sort_order: number
  created_at: string
  [key: string]: unknown
}

/** User-defined open-ended brand-guide section. Each section has its own
 *  heading + optional description + a list of title/body entries
 *  inside. Used for "General Rules"-style content where the section
 *  heading varies per brand. The partner portal renders entries in a
 *  `column_count`-wide grid similar to Tone Characteristics. */
export interface StrategyBrandCustomSection {
  id: string
  brand_guide_id: string
  heading: string
  description: string | null
  column_count: number
  sort_order: number
  created_at: string
  updated_at: string
  /** Embedded in the partner portal's payload (via get_brand_guide_by_slug)
   *  so the renderer doesn't need a second round-trip. Editor lib loads
   *  entries separately when editing. */
  entries?: StrategyBrandCustomSectionEntry[]
  [key: string]: unknown
}

export interface StrategyBrandCustomSectionEntry {
  id: string
  custom_section_id: string
  title: string
  body: string
  sort_order: number
  created_at: string
  [key: string]: unknown
}

export interface StrategyBrandAttribute {
  id: string
  brand_guide_id: string
  label: string
  description: string | null
  sort_order: number
  created_at: string
  [key: string]: unknown
}

// ── Phase 3 — Strategy Library tables ────────────────────────────────────

/** Per-user-per-doc read receipt for the Library's "Mark as Read" flow.
 *  One row per user per doc the user has marked read. v1 is one-way:
 *  there's no unmark; an upsert-with-ignore catches re-marks. */
export interface StrategyWikiRead {
  id: string
  user_id: string
  doc_notion_id: string
  marked_read_at: string
  [key: string]: unknown
}

/** Per-department default verifier (director) + optional delegate. The
 *  single source of truth for routing logic — `getActiveVerifier()` reads
 *  this row to decide who a "Needs Verification" doc routes to. */
export interface StrategyWikiVerifierDefault {
  dept: 'all-in' | 'web' | 'branding' | 'social'
  director_employee_id: string
  delegate_employee_id: string | null
  delegation_until: string | null
  notes: string | null
  updated_at: string
  updated_by: string
  [key: string]: unknown
}

/** Presence-based table — if a Notion doc id is in this table, the doc
 *  is flagged as required reading (surfaces on Recent Updates, drives
 *  the Attention Needed panel on My Dashboard). */
export interface StrategyRequiredReading {
  doc_notion_id: string
  set_by: string
  set_at?: string
  [key: string]: unknown
}

/** Onboarding + ongoing-reading-list assignments. Three scopes (global,
 *  department, user) × two kinds (onboarding, reading-list). Soft-delete
 *  via `is_active = false` keeps an audit trail. */
export interface StrategyOnboardingAssignment {
  id: string
  doc_notion_id: string
  scope: 'global' | 'department' | 'user'
  kind: 'onboarding' | 'reading-list'
  department: string | null
  employee_id: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
  notes: string | null
  [key: string]: unknown
}

/** "What's New" popup announcements generated from initiative progress
 *  entries. Title / body / dept are denormalized off the Notion
 *  Progress page so the popup loads without a Notion fetch.
 *  - `initiative_department = 'all-in'` (or null) → shown to everyone.
 *  - Otherwise → shown only to staff in the matching strategy dept. */
export interface StrategyAnnouncement {
  id: string
  progress_notion_id: string
  initiative_notion_id: string
  initiative_name: string
  initiative_department: 'all-in' | 'social' | 'branding' | 'web' | null
  headline: string
  body: string | null
  /** Optional Library docs the author linked from the announcement.
   *  The popup renders one button per linked doc that navigates to
   *  /strategy/library/doc/{notion_id} — reading there is
   *  auto-tracked via strategy_wiki_reads, so no extra wiring is
   *  needed for "mark as read." Title is denormalized at create time
   *  so the popup doesn't need a side fetch to label the buttons. */
  linked_docs: Array<{ notion_id: string; title: string }>
  created_by_employee_id: string | null
  created_at: string
  is_active: boolean
  retired_at: string | null
  [key: string]: unknown
}

/** Per-user dismissal record so each announcement only popups once. */
export interface StrategyAnnouncementDismissal {
  announcement_id: string
  user_id: string
  dismissed_at: string
  [key: string]: unknown
}

/** A partner Discovery Questionnaire submission. Hybrid storage:
 *  typed columns for the answers downstream tools query directly +
 *  `raw_payload` JSONB for everything else. Ingested by an n8n
 *  workflow (Airtable migration today, FillOut webhook tomorrow). */
export interface StrategyDiscoveryQuestionnaire {
  id: string
  /** Nullable: webhook arrivals may land before staff has linked the
   *  partner to a member number. Resolved later via staff action. */
  member: number | null
  submission_id: string | null
  airtable_record_id: string | null
  source: 'airtable_legacy' | 'fillout_webhook' | 'fillout_webhook_unmatched' | 'native'
  submitted_at: string
  cohort: string | null
  discovery_call_booking: string | null

  primary_contact_name: string | null
  primary_contact_email: string | null
  primary_contact_role: string | null
  primary_contact_phone: string | null

  how_heard_about_us: string | null

  church_name_meaning: string | null
  mission_vision_statement: string | null
  service_terminology: string | null
  defining_milestones: string | null
  identity_phrase_or_verse: string | null

  next_12_months_success: string | null

  typical_audience_description: string | null
  online_audience_difference: string | null
  ideal_in_person_experience: string | null
  ideal_website_experience: string | null
  best_outreach_methods: string | null

  audience_voice_style: string | null
  current_voice_assessment: string | null
  one_key_message: string | null
  desired_emotions: string | null
  words_tones_to_avoid: string | null
  communication_tone_consistency: string | null
  recurring_message_theme: string | null

  visual_simple_to_intricate: number | null
  visual_classic_to_modern: number | null
  visual_timeless_to_trendy: number | null
  visual_function_to_form: number | null
  storytelling_literal_to_abstract: number | null

  brand_redesign_needs: string | null
  font_preferences: string | null
  symbols_or_imagery: string | null
  inspirational_brands: string | null
  brands_to_avoid: string | null
  inspirational_websites: string | null
  exceptional_communicators: string | null
  branding_additional_notes: string | null
  logo_upload_url: string | null
  brand_guide_upload_url: string | null
  ministry_subbrand_needs: string | null
  photo_library_url: string | null
  additional_creative_direction: string | null

  current_website_url: string | null
  current_website_platforms: string[] | null
  software_in_use: string | null
  google_business_claimed: string | null
  website_redesign_needs: string | null
  parts_to_refresh: string[] | null
  website_comments: string | null
  copy_approach: string | null
  current_platform_satisfaction: string | null
  weekly_maintenance_hours: string | null
  top_website_priority: string | null
  top_3_website_goals: string | null
  current_navigation_satisfaction: number | null
  initial_web_support_preferences: string[] | null
  high_maintenance_pages: string | null

  social_platforms: string[] | null
  other_social_platforms: string | null
  speaking_pastor_reference: string | null
  social_scheduling_email: string | null

  current_video_use: string | null
  desired_video_formats: string | null
  storytelling_approach: string | null
  video_communication_avoidances: string | null
  produced_vs_authentic_preference: string | null
  exemplary_video_moment: string | null

  internal_decision_makers: string | null
  timeframe_alignment: string | null
  blackout_dates: string | null
  six_month_measurable_win: string | null

  bible_translations: string[] | null
  deviates_from_primary_translation: string | null

  raw_payload: Record<string, unknown>
  legacy_links: Record<string, string | null> | null

  created_at: string
  updated_at: string
  [key: string]: unknown
}

/** Anchors a Website Manager engagement for a partner. Each row is
 *  one website project — most churches have a single active project
 *  at a time, but the explicit `web_project_id` allows multiples
 *  (e.g., a 2026 redesign + a later micro-site) without losing the
 *  history.
 *
 *  Phase 1 of the Web Manager build only consumes the basics; later
 *  phases attach Brixies content templates, pages, and per-tool
 *  outputs to this `id`. */
// ── Website Manager scheduler (v58) ──────────────────────────
// Per-phase hour baselines + AI-assist multipliers live as JSONB on
// strategy_web_projects. Multiplier is a fraction of baseline hours
// remaining when AI tooling is engaged for that phase (1.0 = no AI
// help, 0.4 = AI cuts the phase to 40% of baseline). 0 < value <= 1
// enforced at write-time in the editor, not by a DB constraint, so
// the shape stays flexible.
export type PhaseEstimates = Partial<Record<WebProjectPhase, number>>
export type AiAssistMultipliers = Partial<Record<WebProjectPhase, number>>
/** Per-phase fraction complete (0..1). 0 = not started, 1 = done. */
export type PhaseProgress = Partial<Record<WebProjectPhase, number>>

export type ProjectSubStatus =
  | 'on_track'
  | 'ahead'
  | 'off_track'
  | 'blocked'
  | 'complete'

export interface StrategyDevWeeklyAllocation {
  id:             string
  week_starting:  string          // date ISO
  web_project_id: string
  hours:          number
  slot:           'primary' | 'secondary' | 'tertiary'
  notes:          string | null
  created_at:     string
  updated_at:     string
}

export interface StrategyDevCapacityOverride {
  id:              string
  week_starting:   string
  employee_id:     string
  hours_available: number
  note:            string | null
  created_at:      string
  updated_at:      string
}

export interface StrategyWebPhaseMap {
  pathway:     string
  step_number: number
  phase:       WebProjectPhase
}

// ── v59 Feasibility + AM Q&A scaffolding ──────────────────
export type TalkingPointCategory =
  | 'process_value'
  | 'value_prop'
  | 'cadence'
  | 'objections'
  | 'differentiator'

export interface StrategyTalkingPoint {
  id:           string
  category:     TalkingPointCategory
  title:        string
  body:         string                          // markdown
  tags:         string[]
  applies_when: Record<string, unknown>
  is_active:    boolean
  sort_order:   number
  updated_by:   string | null
  updated_at:   string
  created_at:   string
}

export interface DetectedProjectRef {
  member_id:        number | null
  church_name:      string | null
  matched_project_id: string | null
  confidence:       'high' | 'medium' | 'low'
  target_dates:     Array<{ iso: string | null; raw: string; hardness: 'hard' | 'ideal' | 'soft' }>
}

export interface StrategyAmQuestionDraft {
  id:                  string
  employee_id:         string | null
  message_in:          string
  response_md:         string
  projects:            DetectedProjectRef[]
  talking_points_used: string[]
  created_at:          string
}

export type WebProjectKind = 'redesign' | 'audit' | 'new_build' | string
export type WebProjectPhase = 'intake' | 'content' | 'design' | 'dev' | 'review' | 'launched' | string

export interface StrategyWebProject {
  id: string
  member: number
  name: string
  kind: WebProjectKind
  current_phase: WebProjectPhase
  archived: boolean
  created_at: string
  updated_at: string
  created_by_employee_id: string | null

  // ── Card palette (2–4 Card N template ids chosen at brand-design phase) ──
  card_palette: string[]

  // ── Chrome designation (primary header/footer + alt nav references) ──
  primary_header_template_id: string | null
  primary_footer_template_id: string | null
  megamenu_template_ids: string[]
  offcanvas_template_ids: string[]
  nav_items: unknown[]                  // jsonb — authored nav structure

  // ── Curated Brixies library (v34) — concept_id → [template_id, …] ──
  // Drives the Global Elements workspace and the AI auto-bind pass.
  curated_library: Record<string, string[]>

  // ── Design system spec — brand anchors → ACSS / Figma variables ──
  // Authored in the Design workspace. Shape: see DesignSystemSpec in
  // src/lib/designSystemSpec.ts. Drives Tokens Studio JSON export and
  // (downstream) ACSS CSS export. Null until the strategist fills it in.
  design_system: unknown | null

  // ── Chrome auto-populated fields (footer legal blocks) ──
  cookies_policy_text:  string | null
  privacy_policy_text:  string | null
  credit_text:          string | null
  legal_notice_text:    string | null
  terms_text:           string | null

  // ── Global site snippets (merge fields available in body copy) ──
  church_name:          string | null
  church_short_name:    string | null
  address:              string | null
  city_state:           string | null
  phone:                string | null
  email:                string | null
  primary_service_time: string | null
  all_service_times:    string | null
  denomination:         string | null
  pastor_name:          string | null
  social_facebook_url:  string | null
  social_instagram_url: string | null
  social_youtube_url:   string | null
  social_tiktok_url:    string | null
  social_twitter_url:   string | null
  social_linkedin_url:  string | null

  // ── Intake — optional URLs paired with file uploads (v29) ──
  strategy_brief_notion_url:  string | null
  external_brand_guide_url:   string | null

  // ── Notion-audit branch (v74) ──
  // Set when copywriting is already in progress in a Notion database.
  // When present, the cowork pipeline collapses steps 7-10 into the
  // autonomous audit-external-copy skill (walks the sitemap, scores
  // existing Notion copy on the 5 axes, flags formatting gaps),
  // then auto-fires supplemental-page-authoring for sitemap pages
  // with no Notion match.
  notion_database_id:   string | null
  notion_database_url:  string | null

  // ── Content Manager — Roadmap deliverable + AI pipeline state (v30) ──
  roadmap_opening_paragraph:  string | null
  roadmap_properties:         Record<string, unknown>
  roadmap_milestone_overview: string | null
  roadmap_internal_flags:     Record<string, unknown>
  roadmap_stage:              WMRoadmapStage
  roadmap_state:              Record<string, unknown>
  project_writing_rules:      string | null
  denominational_filter:      string | null
  personas:                   WebPersona[]

  // ── v58 — Website Manager scheduler ────────────────────────
  // Target launch date (the calendar promise to the partner) and
  // overall dev-hours budget. Phase-level estimates + AI-assist
  // multipliers live in JSONB so the shape can evolve without
  // adding columns. owner_employee_id assigns a Web team member;
  // sub_status caches the last computed health pill so list-page
  // queries don't have to recompute on every render.
  launch_date:                string | null    // date (ISO yyyy-mm-dd)
  priority_order:             number | null
  dev_hours_estimate:         number | null
  phase_estimates:            PhaseEstimates
  ai_assist_multipliers:      AiAssistMultipliers
  owner_employee_id:          string | null
  sub_status:                 ProjectSubStatus | null

  // ── v60 — manual progress overrides ────────────────────
  // Fraction complete per phase (0..1). When set, beats the
  // milestone-derived progress. Missing key = 0.
  phase_progress:             PhaseProgress
  // Explicit override that wins over the phase math. When set,
  // computeProjectHealth uses this number as `remaining` directly.
  manual_remaining_hours:     number | null
  // Markdown the strategist writes about "what's done, what's left,
  // what's blocking." Surfaced on the side panel + board row.
  status_note:                string | null

  // ── v77 — audit branch global footer ─────────────────────
  // Partner-written global footer extracted from the Notion DB
  // (Type=Footer row body, or "## GLOBAL FOOTER" block on Homepage).
  // One per project, consumed once by the site layout. See
  // CoworkGlobalFooter for the canonical shape; null pre-audit.
  global_footer: CoworkGlobalFooter | null

  [key: string]: unknown
}

/** Audit branch — partner-written global footer block extracted
 *  from Notion. Persisted to strategy_web_projects.global_footer
 *  by the handoff endpoint. Shape is open so the SKILL can capture
 *  whatever the partner wrote without losing structure.
 *
 *  - `raw_block`: verbatim markdown source (for audit / re-extraction).
 *  - `columns[]`: parsed column blocks (one per "### Footer Column N"
 *    heading), each with a heading + arbitrary content blocks.
 *  - `footer_notes[]`: developer/strategist notes from the trailing
 *    "FOOTER NOTES FOR DEVELOPER" block (anchors, preserved URLs, etc).
 *  - `bottom_bar`: the © / address / tagline line below columns.
 */
export interface CoworkGlobalFooter {
  raw_block:     string
  columns:       Array<{
    heading:     string
    blocks:      Array<{
      kind:      'identity' | 'links' | 'social' | 'newsletter' | 'free_text'
      label?:    string
      items?:    Array<{ label: string; url: string }>
      lines?:    string[]
      raw?:      string
    }>
  }>
  bottom_bar:    string | null
  footer_notes:  string[]
}

/** AI pipeline stages from intake → all pages drafted. */
export type WMRoadmapStage =
  | 'pre_intake'
  | 'ready'
  | 'extracting_strategy'  | 'strategy_done'
  | 'drafting_sitemap'     | 'sitemap_done'
  | 'drafting_journey'     | 'journey_done'
  | 'drafting_roadmap'     | 'roadmap_done'
  | 'drafting_pages'       | 'all_done'

/** Per-project persona pulled from the strategy brief at Stage 1.
 *  Editable per-project. Not global. */
export interface WebPersona {
  id: string
  name: string                    // 'Jordan'
  archetype: string               // 'The Gritty Builder'
  description: string
  goals?: string
  challenges?: string
  motivations?: string
  message?: string                // Direct address to this persona
}

/** Project-scoped reusable snippet. Text-expander style; rendered as
 *  `{{token}}` in body copy and resolved at render. Separate from the
 *  17 global merge fields on strategy_web_projects. */
export interface WebProjectSnippet {
  id: string
  web_project_id: string
  token: string
  label: string
  expansion: string
  description: string | null
  tags: string[]
  source: 'manual' | 'ai_suggested' | 'extracted_from_intake'
  used_count: number
  archived: boolean
  created_at: string
  updated_at: string
  created_by_employee_id: string | null
}

/** AI chat / interaction message persisted per project. */
export interface WebAIMessage {
  id: string
  web_project_id: string
  thread_key: string            // 'roadmap' | 'page:<slug>' | 'section:<id>' | 'global'
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

/** AI's pending proposal — surfaces in the Assistant Rail's Ideas tab. */
export interface WebAIIdea {
  id: string
  web_project_id: string
  scope: string                 // 'global' | 'page:<slug>' | 'section:<id>' | 'sitemap'
  category: 'add_page' | 'add_section' | 'rewrite' | 'snippet' | 'reorder' | 'other'
  title: string
  proposal: Record<string, unknown>
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed'
  reason: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  resolved_by_employee_id: string | null
}

/** Categories of files uploaded during Intake. Each maps to a section
 *  on the Intake page; some categories also have alternate sources
 *  (Discovery questionnaire is normally in strategy_discovery_questionnaire,
 *  but a supplemental file can be uploaded when it isn't). */
export type WebIntakeCategory =
  | 'strategy_brief'
  | 'content_strategy'                       // optional pre-written content strategy doc — pipeline lifts sitemap + personas + x_factor 1:1 when present
  | 'content_collection'
  | 'discovery_questionnaire_supplemental'
  | 'am_handoff_supplemental'

export interface WebIntakeDocument {
  id: string
  web_project_id: string
  category: WebIntakeCategory
  filename: string
  storage_path: string
  storage_url: string
  file_size_bytes: number | null
  mime_type: string | null
  notes: string | null
  uploaded_at: string
  uploaded_by_employee_id: string | null
  archived: boolean
  [key: string]: unknown
}

/** Section-type enum (v28 bedrock).
 *  - content       — hand-authored body sections
 *  - chrome        — Header / Footer / Megamenu / Offcanvas / Banner
 *  - functional    — Filter / Search / Pagination / Sort
 *  - media         — video / audio / gallery-led sections
 *  - embed         — first-class page block (NOT a Brixies template); see WebEmbedBlock
 *  - component     — reusable card library (the 59 Card N variants)
 *  - post_template — Single Event/Team/Post/Career/Sermon Section detail pages */
export type WebTemplateKind =
  | 'content'
  | 'chrome'
  | 'functional'
  | 'media'
  | 'embed'
  | 'component'
  | 'post_template'

/** Field-type vocabulary the Content Manager editor knows how to render.
 *  Expanded for the v28 slot/group model. */
export type WebFieldType =
  | 'text'
  | 'richtext'
  | 'cta'
  | 'image'
  | 'url'
  | 'email'
  | 'phone'
  | 'datetime'
  | 'form-input'
  | 'map'
  | 'boolean'

/** A single slot in a template's `fields` array. Slots are leaf nodes
 *  the strategist authors directly. */
export interface WebSlotDef {
  kind: 'slot'
  key: string
  layer_name: string
  type: WebFieldType
  label?: string
  required?: boolean
  optional?: boolean
  max_chars?: number
  scope?: string
  heading_level?: 1 | 2 | 3 | 4 | 5 | 6
  default_value?: string
  source?: string                  // global_site_snippet, project metadata column, etc.
  auto_populated?: boolean
  unmapped?: boolean               // taxonomy fallback marker
  control?: 'text' | 'select' | 'checkbox'
  description?: string
}

/** A repeating group in a template's `fields` array. `item_schema` is
 *  the recursive shape of each instance. `default_count` is how many
 *  instances the Brixies starter template ships; strategists can add
 *  or remove items freely. */
export interface WebGroupDef {
  kind: 'group'
  key: string
  layer_name: string
  default_count: number
  item_schema: WebFieldDef[]
  // Component / section reference markers — emitted when the group's
  // item shape comes from the project's card palette or a referenced
  // chrome template rather than authored content.
  item_template_ref?: 'from_palette' | 'section_ref'
  referenced_template_id?: string
  referenced_family?: string
  referenced_kind?: WebTemplateKind
  // Set when Brixies inconsistently numbered the sibling instances
  // (`List Element 1`, `List Element 5`, etc.) and the parser
  // structurally grouped them via stripped-form matching.
  numbered_sibling_variants?: boolean
  // Single-instance group container that the parser detected via
  // group_container_hints rather than 2+ siblings.
  single_instance_hint?: boolean
}

export type WebFieldDef = WebSlotDef | WebGroupDef

/** One entry in the global Brixies catalog. Same row drives AI
 *  generation, the wireframe renderer, the Figma plugin, and the
 *  WordPress / ACF import — one schema, four downstream consumers. */
export interface WebContentTemplate {
  id: string
  layer_name: string
  family: string
  variant: string | null
  kind: WebTemplateKind
  preview_image_url: string | null
  source_html: string
  fields: WebFieldDef[]
  // For listing templates (Team Section, Blog Section, etc.) — the
  // canonical family name of the paired single-* detail page. Auto-
  // pair fires only when the project's display mode for that listing
  // is 'wordpress' (Option 3 of the sermons-events-groups rule).
  paired_post_template: string | null
  paired_url_pattern: string | null
  /** Figma team-library component key (40-char hex). When present, the
   *  Style Guide + Page assembler plugin uses
   *  `figma.importComponentByKeyAsync(key)` to instantiate the design
   *  from the team library instead of cloning local nodes. Null means
   *  no Figma component has been bound yet. */
  figma_component_key: string | null
  is_published: boolean
  created_at: string
  updated_at: string
  [key: string]: unknown
}

/** A single page on a web project. The 'global' phase is an implicit
 *  per-project page that holds chrome (header/footer) and functional
 *  (filter/search) sections — strategist doesn't manually create it. */
export interface WebPage {
  id: string
  web_project_id: string
  name: string
  slug: string
  phase: 'global' | '1' | '2' | 'nav-only' | string
  user_journey_step: number | null
  sort_order: number
  archived: boolean
  created_at: string
  updated_at: string
  // ── Content Manager workflow status (v30) ──
  content_status: WebPageContentStatus
  ai_drafted_at: string | null
  ai_drafted_by_stage: string | null
  edited_since_ai: boolean
  /** SEO / AEO (answer engine) / GEO (geo-targeting) authoring per
   *  page. Shape is open — see WebPageSeo for the canonical keys. */
  seo: WebPageSeo | null

  // ── Cowork → Pages handoff provenance (v75) ──
  /** Full mirror of outline._meta + critique._meta + page-level audit
   *  info from /api/web/cowork/handoff-to-pages. Read by the Pages
   *  workspace audit/scan tab. NULL when this page predates the handoff. */
  cowork_handoff_meta: CoworkHandoffPageMeta | null
  /** Provenance source. Narrow + queryable. NULL pre-handoff. */
  audit_source: 'notion' | 'notion-gap' | 'generated' | 'generated-supplemental' | null
  /** Click-through to Notion when audit_source = 'notion'. */
  notion_url: string | null
  /** Timestamp of the most recent handoff write. NULL pre-handoff. */
  cowork_handoff_at: string | null

  // ── v77 — audit branch verbatim SEO + partner-flagged gaps ──
  /** Partner-authored SEO block extracted verbatim from the page-top
   *  `# SEO` block in Notion. Lossless — every keyword, the AEO
   *  snippet, and the raw markdown source are preserved. The existing
   *  `seo: WebPageSeo` field is the strategist-edited canonical view
   *  derived from this; never overwrite this verbatim source. */
  seo_metadata: CoworkSeoMetadata | null
  /** Partner-authored gap markers from the page-final `## GAPS FLAGGED`
   *  block in Notion. Surfaced to the strategist alongside the SKILL-
   *  generated critique directives so partner intent stays visible. */
  partner_gaps_flagged: Array<{ note: string; kind: 'partner_flagged' }> | null

  [key: string]: unknown
}

/** Audit branch — verbatim partner-written SEO block extracted from
 *  the page-top `# SEO` H1 block in Notion. Persisted to
 *  web_pages.seo_metadata. Different from `web_pages.seo`: this is
 *  the immutable source, that one is the strategist-edited canonical
 *  view derived from this. */
export interface CoworkSeoMetadata {
  raw_block:           string
  primary_keywords:    string[]
  secondary_keywords:  string[]
  local_keywords:      string[]
  meta_title:          string | null
  meta_description:    string | null
  aeo_snippet:         string | null
}

/** Page-level cowork handoff metadata. Mirrors the shape the handoff
 *  endpoint writes to web_pages.cowork_handoff_meta. Shape is intentionally
 *  open so cowork can evolve outputs without schema changes — the audit
 *  tab renders defensively. */
export interface CoworkHandoffPageMeta {
  /** Branch this handoff came from. */
  branch: 'audit' | 'from-scratch'
  /** Mirrored from page_outlines.<slug>._meta. */
  outline_meta: Record<string, unknown> & {
    generated_at?:     string
    model?:            string
    audit_source?:     'notion' | 'notion-gap' | 'generated' | 'generated-supplemental'
    notion_page_id?:   string
    notion_url?:       string
    handoff_note?:     string
  }
  /** Mirrored from page_critiques.<slug>._meta. */
  critique_meta: Record<string, unknown> & {
    generated_at?:     string
    model?:            string
    handoff_note?:     string
    audit_source?:     string
  }
  /** Overall band from the critique (green / yellow / red / gap). */
  overall_band:    'green' | 'yellow' | 'red' | 'gap' | null
  /** Page-level directives from the critique (formatting violations,
   *  required-slot gaps, partner-input asks, etc.). */
  directives:      Array<{
    kind:          string
    severity:      'info' | 'warning' | 'blocker'
    detail:        string
    section?:      string
    slot?:         string
  }>
  /** Round-trip preservation summary written by the handoff endpoint.
   *  any_loss = false is the no-information-loss guarantee. */
  round_trip: {
    sections_in_draft:     number
    sections_written:      number
    atoms_in_drafts:       number
    atoms_preserved:       number
    facts_in_drafts:       number
    facts_preserved:       number
    crawl_topics_in_drafts: number
    crawl_topics_preserved: number
    deferred_total:        number
    split_groups:          number
    any_loss:              boolean
    losses?:               string[]
  }
}

/** CTA value bound to a `slot.type === 'cta'` field. Backwards-
 *  compatible reader (`normalizeCtaValue` in src/lib/cta.ts) accepts
 *  the legacy `{ label, url }` and string-only shapes. The `kind`
 *  field lets editors validate against the right context — internal
 *  routes pick from a project-pages dropdown, external URLs validate
 *  scheme, etc. */
export type CtaKind =
  | 'internal_route'
  | 'external_url'
  | 'anchor'
  | 'mailto'
  | 'tel'
  /** Snippet token like `{{directions_url}}` — the actual URL is
   *  resolved at render-time from the project's snippet map. Treated
   *  as opaque by validation; the snippet itself is validated when
   *  added to the project snippet list. */
  | 'snippet'

export interface CtaValue {
  label:  string
  url:    string
  kind:   CtaKind
  /** '_self' opens in the same tab; '_blank' opens a new tab. When
   *  omitted, the renderer infers based on kind (external → _blank). */
  target?: '_self' | '_blank'
}

/** Canonical (but flexible) shape of web_pages.seo. Strategists can
 *  add ad-hoc keys; the SEO panel renders the canonical fields below
 *  with explicit inputs and exposes the rest as a raw editor row. */
export interface WebPageSeo {
  seo?: {
    title?:            string
    meta_description?: string
    focus_keywords?:   string[]
    canonical_url?:    string
  }
  aeo?: {
    /** What question is this page intended to answer? */
    answer_intent?:    string
    /** Q&A blocks that map cleanly to answer engines + FAQ schema. */
    structured_qa?:    Array<{ q: string; a: string }>
  }
  geo?: {
    /** "Kent, OH", "Akron, OH" — drives local pack relevance. */
    service_areas?:    string[]
    local_keywords?:   string[]
    /** Free text for landmarks, neighborhoods, regional context. */
    local_landmarks?:  string
  }
  [key: string]: unknown
}

/** Page review lifecycle. Renamed from the legacy
 *  draft/in_review/approved trio to make the partner vs internal
 *  flavor of "in review" explicit, and to clarify that approval is
 *  a partner-driven concept. */
export type WebPageContentStatus =
  | 'draft'
  | 'internal_review'
  | 'partner_review'
  | 'partner_approved'
  | 'archived'

/** One section instance on a page, bound to a content template. The
 *  typed `field_values` object matches the template's `fields` —
 *  slot values are scalar, group values are arrays of items matching
 *  the group's `item_schema`. */
export interface WebSection {
  id: string
  web_page_id: string
  /** Brixies content template binding. NULL for user-authored freehand
   *  sections (a TipTap-only body block with no structured slots).
   *  AI agents MUST always set this; freehand is strictly user-facing. */
  content_template_id: string | null
  field_values: Record<string, unknown>
  /** Original imported shape from the copywriter page bundle, frozen at
   *  import time. Read on variant swap to re-derive `field_values`
   *  against a new template without compounding content loss. NULL for
   *  freehand-created sections and for sections imported before v36. */
  source_field_values: Record<string, unknown> | null
  /** Writer's canonical prose for this section, in markdown. Source of
   *  truth for the Text view. NULL until a markdown-aware import lands;
   *  the matcher in webContentDocument re-parses this on edit so
   *  node_ids in ir_snapshot survive reorders and small content edits.
   *  Added in v54. */
  source_markdown: string | null
  /** ContentDocument snapshot captured at last parse, with stable
   *  `node_id` on every block/item. The matcher carries IDs forward by
   *  content similarity so field_provenance.ir_path stays resolvable
   *  across re-parses. NULL for pre-v54 sections. */
  ir_snapshot: import('../lib/webContentDocument').ContentDocument | null
  /** Per-field provenance tags. Keyed by the same field key as
   *  field_values. `source: auto` = bound from ir_snapshot via ir_path
   *  (free to overwrite on rebind). `override` = staff edit (preserved
   *  on rebind). `default` = template placeholder. `unbound` = template
   *  required a value but none was bound. Added in v54. */
  field_provenance: FieldProvenanceMap | null

  // ── Cowork → Pages handoff provenance (v75) ──
  /** Full provenance bundle from the cowork artifact triplet (outline +
   *  draft + critique) for this section. Read by the Pages workspace
   *  audit/scan tab; never read by Brixies render path. NULL for
   *  pre-v75 sections + freehand author sections. */
  cowork_section_meta: CoworkHandoffSectionMeta | null
  /** Uniform-named slot values from cowork (primary_heading, body,
   *  items, buttons, tagline, accent_body). The Brixies-named version
   *  lives in field_values, derived from this at handoff time via
   *  canonical_templates.uniform_to_brixies. Round-tripping here lets
   *  re-translations happen without re-running cowork. */
  cowork_slot_values: Record<string, unknown> | null
  /** When audit-branch overflow SPLIT one Notion section into N
   *  web_sections (e.g. 6 staff → 3× feature_team), siblings share
   *  this uuid. NULL means standalone section. */
  split_group_id: string | null
  /** 1-based position within the split_group. NULL when split_group_id IS NULL. */
  split_position: number | null

  sort_order: number
  content_status: 'draft' | 'internal_review' | 'partner_review' | 'partner_approved' | string
  notes: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

/** Section-level cowork handoff metadata. Populated by
 *  /api/web/cowork/handoff-to-pages — mirrors the outline section +
 *  draft section + critique section data that named this row. */
export interface CoworkHandoffSectionMeta {
  /** From page_outlines.<slug>.sections[].section_intent_id — the
   *  stable id strategists + cowork share to refer to "this section". */
  section_intent_id:        string
  /** From page_outlines.<slug>.sections[].section_job — one-line
   *  description of what this section is supposed to do. */
  section_intent_text:      string
  /** Voice exemplar atom_id(s) this section's voice anchors against. */
  voice_anchor_atom_ids:    string[]
  /** Target verbatim band from strategic_goals copy_approach. */
  intended_verbatim_band:   'high' | 'mid' | 'low' | null
  /** Measured verbatim ratio from the draft (0.00 - 1.00). */
  actual_verbatim_ratio:    number | null
  /** Source atoms referenced by this section. */
  atom_ids_used:            string[]
  /** Source facts referenced by this section. */
  fact_ids_used:            string[]
  /** Source crawl topics referenced by this section. */
  crawl_topic_keys_used:    string[]
  /** Items the audit TRUNCATED out of this section because the
   *  canonical template couldn't hold them. Strategist can promote
   *  any item to a new section or dismiss. */
  deferred_items:           Array<{
    kind:           string    // e.g. 'staff_member', 'partnership', 'belief_article'
    source_ref?:    string    // atom_id / fact_id / topic_key it came from
    title?:         string
    body?:          string
    reason:         string    // 'cap_overage' | 'unmatched_template' | etc.
    why_truncated?: string    // human-readable explanation
  }>
  /** voice_notes string from the draft section (annotation per section). */
  voice_notes:              string | null
  /** Per-axis scores from the critique. */
  axes: {
    dignity?:           { score: number; pass: boolean; rationale?: string }
    voice_character?:   { score: number; pass: boolean; rationale?: string }
    persona_fit?:       { score: number; pass: boolean; rationale?: string }
    source_coverage?:   { score: number; pass: boolean; rationale?: string }
    claim_plausibility?:{ score: number; pass: boolean; rationale?: string }
  } | null
  /** Critique directives scoped to this section. */
  directives:               Array<{
    kind:     string
    severity: 'info' | 'warning' | 'blocker'
    detail:   string
    slot?:    string
  }>
  /** Audit-branch provenance — present when this section came from
   *  Notion. NULL for from-scratch / generated-supplemental sections. */
  notion_page_id:           string | null
  notion_url:               string | null
  /** When audit-branch overflow split happened, this marker lets the
   *  audit tab show "split from <original heading>" + lets the
   *  importer group siblings via split_group_id. */
  split_from:               string | null
  /** Bind verdict from the v2 translator. `perfect` = every required
   *  Brixies slot populated, no lorem fallbacks; `partial` = at least
   *  one gap (uniform slot the picked template can't hold, required
   *  slot cowork didn't fill, button missing label/url, items overflow).
   *  Partial sections still push — the Rich Companion side panel gives
   *  the strategist the durable source-of-truth view + variant picker. */
  bind_quality?:            'perfect' | 'partial'
  /** Per-gap diagnostic emitted by the v2 translator. Surfaced in the
   *  cowork audit panel; aggregated into project-level perfect_rate. */
  gaps?: Array<{
    kind:     string                            // e.g. 'required_slot_missing', 'uniform_slot_not_supported_by_template'
    severity: 'info' | 'warning' | 'blocker'
    detail:   string
    slot?:    string
  }>
  /** Canonical-templates manifest version this section was bound under. */
  manifest_version?:        string

  // ── v77 — Notion audit-branch verbatim preservation ────────────
  /** Verbatim Notion markdown for this section — the exact substring
   *  the SKILL parsed slots from. Used for audit diff ("what was in
   *  Notion?" vs "what landed?") + re-extraction when the parser
   *  evolves. Always present for audit-branch sections; null for
   *  from-scratch / generated sections. */
  source_block?:            string | null
  /** Partner-marked preservation flag from `*Preservation: source-
   *  verbatim*` runs in the Notion body. When `source-verbatim`,
   *  downstream tools (variant swap, translator overrides, AI rewrites)
   *  MUST NOT paraphrase this section's content. */
  preservation?:            'source-verbatim' | null
  /** Partner-written image direction from italic markers like
   *  `*[Image or video: photo of Pastor Jane …]*`. Preserved
   *  verbatim — the Brixies image slot stays designer-bound, but
   *  the partner's stated intent is visible in the Rich Companion
   *  + the design phase handoff. */
  image_direction?:         string | null
  /** Raw embed directive from `*[Map embed: <iframe…>]*` or similar.
   *  Includes the full iframe markup verbatim so the build can drop
   *  it in (e.g. Google Maps for the church address). */
  embed_directive?:         string | null
  /** Italic block directive like `*[This section features 3 to 4
   *  upcoming events pulled from the events calendar.]*` —
   *  copywriter's instruction to the developer about how a section
   *  should behave (dynamic / manual / placeholder). */
  dynamic_directive?:       string | null
  /** Catch-all for italic-bracketed annotations that didn't match a
   *  specific directive type. Preserves the partner's note verbatim
   *  + tags which slot it appeared near, for the Rich Companion to
   *  show "near `primary_heading`: …" hints. */
  inline_annotations?:      Array<{ note: string; near_slot?: string }>
  /** Trailing-parenthetical annotations from per-CTA markers like
   *  `*Button: View Bulletin (right now it is set up as an upload
   *  to their site, can we replicate this or improve …)*`. One
   *  entry per button index (or null when that button had no
   *  annotation). Length matches buttons[] in cowork_slot_values. */
  button_annotations?:      Array<string | null>
}

/** Per-field provenance tag. Lives at `web_sections.field_provenance[fieldKey]`.
 *  The override flag is the load-bearing bit — markdown re-flow only
 *  overwrites fields where `source === 'auto'`, so staff polish in the
 *  Layout view survives writer edits to the Text view. */
export interface FieldProvenance {
  source: 'auto' | 'override' | 'default' | 'unbound'
  /** When `source === 'auto'`, the node_id-anchored IR path the value
   *  was bound from (e.g. `lists{node_id=list:abc}.items{node_id=step:def}.body`).
   *  Used to refresh this field's value when the IR re-parses. */
  ir_path?: string
  /** The kind of the source IR block ("heading", "tagline", "cta", "items"…)
   *  — for the inspector's "from: heading" badge. Display-only, derived
   *  at bind time so the inspector doesn't have to walk the IR. */
  ir_kind?: string
  /** First ~80 chars of the source IR block's text, for inspector
   *  display: "from: heading · 'Where Faith Starts Young'". Display-only;
   *  the canonical source is the IR snapshot resolved via `ir_path`. */
  ir_text_snippet?: string
  override_at?: string
  override_by?: string
}

export type FieldProvenanceMap = Record<string, FieldProvenance>

// ── Reviews ──────────────────────────────────────────────────────────
//
// Project-scoped review sessions with per-page / per-section /
// per-field comments and edit proposals. Two kinds: `internal`
// (staff-only, multiple can be open in parallel) and `partner` (one
// open at a time; partners access via /portal/review/<token>).
//
// Comments distinguish:
//   • `comment`   — general note, no proposed change
//   • `suggested` — staff-authored edit (can be overridden / dismissed)
//   • `requested` — partner-authored edit (must be resolved, dismissal
//                   requires a resolution_note)

/** Board-level status for a review, surfaced as a status pill on each
 *  feedback board column. Legacy 'open'/'closed' remain valid in the
 *  DB until migration v40 retires them; the loader normalizes them on
 *  read to 'open_for_review' / 'completed'. */
export type BoardStatus =
  | 'no_status'
  | 'open_for_review'
  | 'editing_content'
  | 'on_hold'
  | 'completed'

/** Wire format (what the DB still accepts during the transition). */
export type WebReviewStatus = BoardStatus | 'open' | 'closed'

export interface WebReview {
  id: string
  web_project_id: string
  kind: 'internal' | 'partner'
  status: WebReviewStatus
  /** Sequential round number within (web_project_id, kind). Auto-assigned
   *  by trigger on insert; never reused after deletes. */
  round_number: number
  started_at: string
  started_by_user_id: string | null
  /** Display name of the staff member who started the review. Snapshotted
   *  at start time via employees lookup so the inbox doesn't need a join. */
  started_by_name: string | null
  /** Captured on first partner-portal visit. Null until then. */
  partner_name: string | null
  /** Opaque token used in /portal/review/<token>. Only set when kind='partner'. */
  partner_token: string | null
  closed_at: string | null
  closed_by_user_id: string | null
  closed_by_name: string | null
  /** If this review was kicked off in response to a staff-to-staff
   *  request, the request row id. Null otherwise. */
  review_request_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Staff-to-staff review request. One staff member asks another to
 *  do an internal review with optional notes; the assignee sees the
 *  request on their Review tab and can start the review from there. */
export interface WebReviewRequest {
  id: string
  web_project_id: string
  requester_user_id: string
  requester_name: string | null
  /** Email of the staff member being asked. We match by email
   *  because the employees table doesn't carry an auth.users link;
   *  every staff lookup in the app already goes through email. */
  assignee_email: string
  assignee_name: string | null
  notes: string | null
  status: 'pending' | 'started' | 'completed' | 'cancelled'
  started_review_id: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

/** Field-level edit log entry. Captured when staff edits a section
 *  field while their internal review is open — gives the next person
 *  to work the queue an audit trail of what already changed during
 *  the review. */
export interface WebReviewEdit {
  id: string
  review_id: string
  web_section_id: string
  web_page_id: string
  field_path: string
  field_label: string | null
  before_value: unknown
  after_value: unknown
  edited_by_user_id: string | null
  edited_by_name: string | null
  edited_at: string
}

export type WebReviewCommentKind = 'comment' | 'suggested' | 'requested'
export type WebReviewCommentStatus = 'open' | 'applied' | 'amended' | 'dismissed'
/** Card-applied tag from the feedback board UI. */
export type WebReviewCommentCategory = 'design' | 'content'

export interface WebReviewComment {
  id: string
  review_id: string
  web_page_id: string
  /** Null = page-level general comment. */
  web_section_id: string | null
  /** Null when comment is section-level (not pinned to a field). */
  field_key: string | null
  author_kind: 'staff' | 'partner'
  author_user_id: string | null
  /** Captured for partner authors (name they entered on the portal). */
  author_external_name: string | null
  kind: WebReviewCommentKind
  body: string | null
  /** Snapshot of the field value at the time the suggestion was created. */
  original_value: unknown
  /** Proposed value. Same shape as the underlying slot type. */
  suggested_value: unknown
  status: WebReviewCommentStatus
  resolved_by_user_id: string | null
  /** Display-name snapshot of resolved_by_user_id, populated when Apply /
   *  Amend / Dismiss fires. Avoids joins for the resolution banner. */
  resolved_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
  /** Strategist-applied tag from the feedback board UI. */
  category: WebReviewCommentCategory | null
  /** Staff member responsible for resolving this comment. Snapshot
   *  pattern (id + name + email) so the card renders without a join. */
  assignee_user_id: string | null
  assignee_name: string | null
  assignee_email: string | null
  /** Optional due date shown in the feedback card footer. */
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface WebReviewAttachment {
  id: string
  comment_id: string
  storage_path: string
  storage_url: string
  filename: string | null
  mime_type: string | null
  file_size_bytes: number | null
  created_at: string
}

/** First-class embed block — NOT a Brixies template. Renders as a
 *  tagged placeholder card in the wireframe (category + title +
 *  what's-included). The developer replaces the placeholder with the
 *  actual iframe / feed / widget code at build time. */
export type WebEmbedCategory =
  | 'event'
  | 'forms'
  | 'giving'
  | 'groups'
  | 'instagram'
  | 'maps'
  | 'prayer'
  | 'sermon'
  | 'youtube_playlist'

export interface WebEmbedBlock {
  id: string
  web_project_id: string
  web_page_id: string | null
  category: WebEmbedCategory
  title: string
  whats_included: string | null
  source_url: string | null
  embed_code: string | null
  source_notes: string | null
  sort_order: number
  archived: boolean
  created_at: string
  updated_at: string
  [key: string]: unknown
}

/** A file attached to a Discovery Questionnaire (logo, brand guide,
 *  or the generated submission PDF). Stored in the private
 *  'discovery-questionnaire' Supabase Storage bucket. */
export interface StrategyDiscoveryQuestionnaireFile {
  id: string
  questionnaire_id: string
  file_kind: 'logo' | 'brand_guide' | 'submission_pdf' | 'other'
  filename: string | null
  storage_path: string | null
  source_url: string | null
  mime_type: string | null
  size_bytes: number | null
  created_at: string
  [key: string]: unknown
}

/** Shape returned by get_brand_guide_by_slug RPC */
export interface BrandGuidePortalPayload {
  guide: {
    id: string
    member: number
    parent_id: string | null
    slug: string
    display_name: string
    contact_name: string | null
    contact_email: string | null
    voice_overview: string | null
    brand_statement: string | null
    assets_zip_url: string | null
    animations_url: string | null
    ase_swatch_url: string | null
    last_updated_at: string | null
    updated_at: string
  }
  logos: StrategyBrandLogo[]
  colors: StrategyBrandColor[]
  color_combinations: StrategyBrandColorCombination[]
  typography: StrategyBrandTypography[]
  elements: StrategyBrandElement[]
  voice_attributes: StrategyBrandVoiceAttribute[]
  voice_guidelines: StrategyBrandVoiceGuideline[]
  attributes: StrategyBrandAttribute[]
  custom_sections: StrategyBrandCustomSection[]
  subbrands: Array<{ slug: string; display_name: string }>
  /** Set when the loaded guide is a subbrand — null for main guides. */
  parent: { slug: string; display_name: string } | null
  /** Peer subbrands under the same parent, excluding the current guide. Empty
   *  array for main guides. */
  siblings: Array<{ slug: string; display_name: string }>
}

// ============================================================================
// BRAND HANDOFF — staff-side quick-reference for Graphics / Social / Web / Video squads
// ============================================================================

/** Compact task card for the handoff's past-work feed. Derived from
 *  task_details + view_task_account. Filtered server-side to approved-ish
 *  statuses for the active church. */
export interface HandoffTaskCard {
  task_id: string
  task_name: string
  list_name: string | null
  current_status: string | null
  status_changed_at: string | null
  assignee_names: string[] | null
  tags: string[] | null
}

/** Digested church intel — only the keys the handoff Social tab consumes.
 *  Typed loosely (unknown) so we can surface whatever the intel_profile
 *  currently has without breaking when the schema drifts. */
export interface HandoffIntelDigest {
  intel_version: number | null
  intel_updated_at: string | null
  profile: Record<string, unknown> | null
}

/** Everything the handoff page needs in one payload. `guide` is null for a
 *  church that has a portal_token but no brand guide yet. */
export interface BrandHandoffPayload {
  church: {
    member: number
    church_name: string | null
    portal_token: string
  }
  guide: StrategyBrandGuide | null
  logos: StrategyBrandLogo[]
  colors: StrategyBrandColor[]
  typography: StrategyBrandTypography[]
  elements: StrategyBrandElement[]
  voice_attributes: StrategyBrandVoiceAttribute[]
  voice_guidelines: StrategyBrandVoiceGuideline[]
  attributes: StrategyBrandAttribute[]
  intel: HandoffIntelDigest | null
  pastWork: HandoffTaskCard[]
}

// ============================================================================
// GLOBAL APP CONFIG (single-row editable settings)
// ============================================================================

export interface AppConfig {
  id: number
  standard_footer: string
  recap_header: string
  recap_brand_current_label: string
  recap_brand_next_label: string
  recap_web_current_label: string
  recap_web_next_label: string
  recap_portal_label: string
  updated_at: string
  updated_by: string | null
  [key: string]: unknown
}

// ============================================================================
// Social Media Squad — SRP Generator (sms_srp_generation, sms_prompt_settings)
// ============================================================================

/** One row per SRP generation session. All deliverable text fields are
 *  free-form text — structured deliverables (selected_deliverables,
 *  clip_selections, carousel_slides) are stored as JSON-encoded strings.
 *  Helpers in src/lib/srpSessions.ts handle the JSON round-trip. */
export interface SmsSrpGeneration {
  id: number
  session_id: string                     // e.g. "1802_Mosaic_20260608120000"
  member: string | null                  // partner member number (text)
  church_name: string | null
  user_email: string | null
  created_at: string | null
  updated_at: string | null

  current_step: SrpStep | null
  status: 'in_progress' | 'completed' | 'archived' | null

  selected_deliverables: string | null   // JSON-encoded SrpDeliverableKey[]

  video_url: string | null
  transcript: string | null

  clip_selections: string | null         // JSON-encoded ClipSelection[]
  reel1_caption: string | null
  reel2_caption: string | null

  facebook_post: string | null
  sunday_invite: string | null
  photo_recap_caption: string | null

  carousel_slides: string | null         // JSON-encoded CarouselSlide[]
  carousel_caption: string | null

  clickup_task_id: string | null
  clickup_url: string | null
}

/** Legacy 4-step model — `sms_srp_generation` still uses these. Kept so
 *  existing rows + the dashboard read path don't blow up while we port. */
export type SrpStep =
  | 'account'
  | 'deliverables'
  | 'sermon'
  | 'review'
  | 'approved'
  | 'reelCaptions'                       // legacy step name from older rows

/** Legacy deliverable model. */
export type SrpDeliverableKey =
  | 'facebook_post'
  | 'sunday_invite'
  | 'photo_recap'
  | 'carousel_slides'
  | 'reel_captions'                      // deferred (Phase 3)

// ============================================================================
// SRP Pipeline (new — srp_pipeline.* schema, 12-step workflow)
// Replaces sms_srp_generation. See docs/SRP_PORT_PLAN.md.
// ============================================================================

/** 12-step workflow. Conditional visibility based on selectedDeliverables —
 *  see visibleSteps in src/contexts/SrpWorkflowContext.tsx. */
export type SrpWorkflowStep =
  | 'account'
  | 'deliverables'
  | 'sermon'
  | 'overview'
  | 'clips'
  | 'preRenderEdit'
  | 'reelCaptions'
  | 'carousel'
  | 'facebook'
  | 'sundayInvite'
  | 'photoRecap'
  | 'clipProcessing'
  | 'approved'

/** Individual deliverable. Reels are split into 8 numbered slots so the
 *  coach can pick "Sermon Reels × N" (1-8). */
export type SrpDeliverable =
  | 'reel1' | 'reel2' | 'reel3' | 'reel4'
  | 'reel5' | 'reel6' | 'reel7' | 'reel8'
  | 'facebook' | 'carousel' | 'sundayInvite' | 'photoRecap'

export const SRP_REEL_DELIVERABLES: SrpDeliverable[] = ['reel1', 'reel2', 'reel3', 'reel4', 'reel5']
export const SRP_MAX_REELS = 5
export const isSrpReelDeliverable = (d: string): d is SrpDeliverable => /^reel[1-8]$/.test(d)

export interface SrpClipCut {
  start_ms: number
  end_ms: number
}

export interface SrpClipSelection {
  /** clip_id is added when persisted to clipcutter_jobs; suggestions have no id. */
  clip_id?: string
  clip_name?: string
  startTime?: string
  endTime?: string
  quote?: string
  category?: string
  wordCount?: number
  estimatedSeconds?: number
  /** Internal title (5-8 words) identifying the moment. */
  clip_title?: string
  /** Why this moment works as a standalone clip. */
  why_this_clip?: string
  /** 5-10 word text overlay suggestion for the first 2 seconds. */
  suggested_hook?: string
  /** One-sentence angle suggestion for the post caption writer. */
  caption_angle?: string
  /** Coach-editable transcript text for this clip's captions. Defaults to quote. */
  caption_text?: string
  /** Caption style slug from Duane's 23 styles (e.g. "cap01-hormozi-pill"). */
  caption_slug?: string
  /** Font name from the preset list (e.g. "Montserrat"). */
  caption_font?: string
  /** URL to a custom uploaded font file (.ttf / .otf / .woff2). */
  caption_font_url?: string
  /** Font size in pixels (e.g. 48). */
  caption_font_size?: number
  /** Vertical position of captions on screen. */
  caption_position?: 'top' | 'center' | 'bottom'
  /** Per-element color overrides (hex strings). */
  caption_colors?: {
    text?:        string   // main caption text color
    background?:  string   // pill / box background color ('transparent' allowed)
    outline?:     string   // text stroke / outline color
    highlight?:   string   // active/karaoke word highlight color
  }
  /** Pinned clips are locked and excluded from regeneration. */
  pinned?: boolean
  /** Title screen shown at the start of the clip. */
  title_screen?: {
    enabled:    boolean
    type:       'text' | 'image'
    text?:      string
    image_url?: string
  }
  /** Whether to include the church's outro logo animation on this clip. */
  outro_enabled?: boolean
  /** Background music track for this clip. null = no music. */
  background_track?: {
    id:     string
    name:   string
    artist?: string
    genre:  string
    url:    string    // Wasabi/S3 URL — used for preview and passed to clipcutter
  } | null
  /** Optional regions to cut out of the middle of this clip. Times are
   *  clip-local ms (0 = clip start). The clipcutter joins kept segments
   *  on output; if absent, the clip cuts as a single range. */
  cuts?: SrpClipCut[]
  /** Instagram/Facebook caption for this reel's social post. */
  social_caption?: string | null
  /** Populated by the clipcutter callback. */
  video_url?: string | null
  srt_url?: string | null
  processing_status?: 'queued' | 'done' | 'failed' | null
}

export interface SrpCarouselSlide {
  slide_number: number
  /** kind is free-form because the AI returns slot-style strings like
   *  "hook" / "verse" / "quote" / "application" / "cta". */
  kind?: string
  text: string
}

/** Per-step input bundles persisted to JSONB columns on srp_pipeline.sessions. */
export interface SrpReelGuidanceMap { [reelIdx: number]: string }
export interface SrpSundayInviteInput {
  guidance?: string
  lookingAhead?: string
  selectedIdx?: number | null
  selectedCitation?: string
  selectedTags?: string[]
}
export interface SrpFacebookInput {
  guidance?: string
  selectedIdx?: number | null
  selectedCitation?: string
  selectedTags?: string[]
}
export interface SrpCarouselInput {
  slidesGuidance?: string
  captionGuidance?: string
  selectedIdx?: number | null
  selectedCitations?: string[]
  selectedTags?: string[]
  slidesApproved?: boolean
}
export interface SrpPhotoRecapInput {
  promptType?: 'highlights' | 'teaching'
  lookingBack?: string
  guidance?: string
  selectedIdx?: number | null
  selectedTags?: string[]
}

/** Row shape for srp_pipeline.sessions. Matches the schema applied in v69
 *  (sessions table is fully realized — see schema/v69_srp_pipeline.sql for
 *  the column list). Fields stored as JSONB are typed as the parsed shape. */
export interface SrpPipelineSession {
  id: string                            // UUID
  session_id: string                    // human-readable slug
  member: number | null
  church_name: string | null
  user_email: string | null
  current_step: SrpWorkflowStep | null
  status: 'in_progress' | 'submitting' | 'completed' | 'submit_failed' | 'archived' | null
  created_at: string | null
  updated_at: string | null

  selected_deliverables: SrpDeliverable[] | null

  video_url: string | null
  video_source_type: 'youtube' | 'dropbox' | 'vimeo' | 'google_drive' | 'direct' | 'unknown' | null
  transcript_job_id: string | null      // UUID
  transcript: string | null
  transcript_words: unknown[] | null
  has_timecodes: boolean | null

  clip_suggestions: SrpClipSelection[] | null
  clip_selections:  SrpClipSelection[] | null

  reel1_caption: string | null
  reel1_clip:    SrpClipSelection | null
  reel2_caption: string | null
  reel2_clip:    SrpClipSelection | null

  carousel_slides:    SrpCarouselSlide[] | null
  carousel_caption:   string | null
  facebook_post:      string | null
  sunday_invite:      string | null
  photo_recap_caption: string | null

  // Creative Direction
  srp_template:     string | null
  background_music: boolean | null
  designer_notes:   string | null

  // Clip processing
  clipcutter_job_id:      string | null   // UUID
  clip_processing_status: string | null

  // ClickUp
  clickup_task_id:       string | null
  clickup_url:           string | null
  srp_task_id_override:  string | null

  // Sermon metadata (mirrored from strategy_sermon_data when paired)
  series_title:        string | null
  series_description:  string | null
  sermon_title:        string | null
  sermon_description:  string | null

  // Per-step input persistence
  reel_guidance:       SrpReelGuidanceMap | null
  sunday_invite_input: SrpSundayInviteInput | null
  facebook_input:      SrpFacebookInput | null
  carousel_input:      SrpCarouselInput | null
  photo_recap_input:   SrpPhotoRecapInput | null
}

/** SquadAccount aggregates strategy_account_progress + prf_brand_guides
 *  for an account. Read-only. Powers the AccountInfoPanel, Quick Links,
 *  and accountContext used by every generate-* endpoint. */
export interface SquadAccount {
  member:                              number
  church_name:                         string
  // links the sidebar Quick Links panel surfaces
  instagram:                           string | null
  instagram_link:                      string | null
  facebook:                            string | null
  facebook_link:                       string | null
  youtube:                             string | null
  church_website:                      string | null
  strategy_brief:                      string | null
  photos_link:                         string | null
  photos_from_all_in_discovery_form:   string | null
  custom_gpt:                          string | null
  brand_guide_url:                     string | null
  carousel_templates:                  string | null
  // detail rows shown on the AccountInfoPanel
  speak_to_audience_as_from_discovery: string | null
  preferred_bible_translation:         string | null
  which_social_media_platforms_do_you_want_us_to_post_to_from_all: string | null
  sms_notes:                           string | null
  plan:                                string | null
  time_zone:                           string | null
  recent_series_srp:                   string | null
  notion_dashboard:                    string | null
  /** Per-account brand voice. Stored in srp_pipeline.clip_templates by
   *  the new save-brand-voice endpoint, NOT in strategy_account_progress
   *  (CLAUDE.md forbids us from writing to that table). */
  brand_voice_guidelines:              string | null
}

/** Sermon submission row paired via clickup_task_id. */
export interface SrpSermonSubmission {
  account:             number
  created_at:          string
  series_title:        string | null
  series_description:  string | null
  sermon_title:        string | null
  sermon_description:  string | null
  srp_info_selection:  string | null
  clickup_task_id:     string | null
  video_url:           string | null
  external_link:       string | null
  is_this_week?:       boolean
}

export interface SmsPromptSetting {
  id: string
  prompt_key: string
  prompt_text: string
  updated_at: string
  updated_by: string | null
}

// ============================================================================
// Supabase Database generic type (for typed client)
// ============================================================================

export interface Database {
  public: {
    Tables: {
      strategy_account_progress: {
        Row: StrategyAccountProgress
        Insert: Partial<StrategyAccountProgress>
        Update: Partial<StrategyAccountProgress>
        Relationships: []
      }
      sms_srp_generation: {
        Row: SmsSrpGeneration
        Insert: Partial<SmsSrpGeneration>
        Update: Partial<SmsSrpGeneration>
        Relationships: []
      }
      sms_prompt_settings: {
        Row: SmsPromptSetting
        Insert: Partial<SmsPromptSetting>
        Update: Partial<SmsPromptSetting>
        Relationships: []
      }
      clickup_chat_channels: {
        Row: ClickupChatChannel
        Insert: Partial<ClickupChatChannel>
        Update: Partial<ClickupChatChannel>
        Relationships: []
      }
      clickup_users: {
        Row: ClickupUser
        Insert: Partial<ClickupUser>
        Update: Partial<ClickupUser>
        Relationships: []
      }
      employees: {
        Row: Employee
        Insert: Partial<Employee>
        Update: Partial<Employee>
        Relationships: []
      }
      prf_brand_guides: {
        Row: PrfBrandGuide
        Insert: Partial<PrfBrandGuide>
        Update: Partial<PrfBrandGuide>
        Relationships: []
      }
      accounts: {
        Row: Account
        Insert: Partial<Account>
        Update: Partial<Account>
        Relationships: []
      }
      clickup_folders: {
        Row: ClickupFolder
        Insert: Partial<ClickupFolder>
        Update: Partial<ClickupFolder>
        Relationships: []
      }
      clickup_lists: {
        Row: ClickupList
        Insert: Partial<ClickupList>
        Update: Partial<ClickupList>
        Relationships: []
      }
      tasks: {
        Row: ClickupTask
        Insert: Partial<ClickupTask>
        Update: Partial<ClickupTask>
        Relationships: []
      }
      status_history: {
        Row: StatusHistory
        Insert: Partial<StatusHistory>
        Update: Partial<StatusHistory>
        Relationships: []
      }
      assignee_history: {
        Row: AssigneeHistory
        Insert: Partial<AssigneeHistory>
        Update: Partial<AssigneeHistory>
        Relationships: []
      }
      task_deletions: {
        Row: TaskDeletion
        Insert: Partial<TaskDeletion>
        Update: Partial<TaskDeletion>
        Relationships: []
      }
      website_support_audit: {
        Row: WebsiteSupportAudit
        Insert: Partial<WebsiteSupportAudit>
        Update: Partial<WebsiteSupportAudit>
        Relationships: []
      }
      strategy_milestone_definitions: {
        Row: StrategyMilestoneDefinition
        Insert: Omit<StrategyMilestoneDefinition, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyMilestoneDefinition, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_message_templates: {
        Row: StrategyMessageTemplate
        Insert: Omit<StrategyMessageTemplate, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyMessageTemplate, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_milestone_submissions: {
        Row: StrategyMilestoneSubmission
        // milestone_status omitted from Insert — it defaults to 'sent' in the DB
        Insert: Omit<StrategyMilestoneSubmission, 'id' | 'submitted_at' | 'updated_at' | 'milestone_status'>
          & { milestone_status?: MilestoneStatus }
        Update: Partial<Omit<StrategyMilestoneSubmission, 'id'>>
        Relationships: []
      }
      strategy_submission_assets: {
        Row: StrategySubmissionAsset
        Insert: Omit<StrategySubmissionAsset, 'id' | 'created_at'>
        Update: Partial<Omit<StrategySubmissionAsset, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_milestone_replies: {
        Row: StrategyMilestoneReply
        Insert: Omit<StrategyMilestoneReply, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyMilestoneReply, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_app_config: {
        Row: AppConfig
        Insert: Partial<AppConfig>
        Update: Partial<Omit<AppConfig, 'id'>>
        Relationships: []
      }
      strategy_church_intel: {
        Row: StrategyChurchIntel
        Insert: Omit<StrategyChurchIntel, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyChurchIntel, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_church_intel_history: {
        Row: StrategyChurchIntelHistory
        Insert: Omit<StrategyChurchIntelHistory, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyChurchIntelHistory, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_copy_reviews: {
        Row: StrategyCopyReview
        Insert: Omit<StrategyCopyReview, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyCopyReview, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_copy_review_decisions: {
        Row: StrategyCopyReviewDecision
        Insert: Omit<StrategyCopyReviewDecision, 'id' | 'decided_at'>
        Update: Partial<Omit<StrategyCopyReviewDecision, 'id'>>
        Relationships: []
      }
      strategy_copy_review_comments: {
        Row: StrategyCopyReviewComment
        Insert: Omit<StrategyCopyReviewComment, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyCopyReviewComment, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_copy_review_edits: {
        Row: StrategyCopyReviewEdit
        Insert: Omit<StrategyCopyReviewEdit, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyCopyReviewEdit, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_guides: {
        Row: StrategyBrandGuide
        Insert: Omit<StrategyBrandGuide, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<StrategyBrandGuide, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_logos: {
        Row: StrategyBrandLogo
        Insert: Omit<StrategyBrandLogo, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandLogo, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_colors: {
        Row: StrategyBrandColor
        Insert: Omit<StrategyBrandColor, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandColor, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_color_combinations: {
        Row: StrategyBrandColorCombination
        Insert: Omit<StrategyBrandColorCombination, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandColorCombination, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_typography: {
        Row: StrategyBrandTypography
        Insert: Omit<StrategyBrandTypography, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandTypography, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_elements: {
        Row: StrategyBrandElement
        Insert: Omit<StrategyBrandElement, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandElement, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_voice_attributes: {
        Row: StrategyBrandVoiceAttribute
        Insert: Omit<StrategyBrandVoiceAttribute, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandVoiceAttribute, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_voice_guidelines: {
        Row: StrategyBrandVoiceGuideline
        Insert: Omit<StrategyBrandVoiceGuideline, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandVoiceGuideline, 'id' | 'created_at'>>
        Relationships: []
      }
      strategy_brand_attributes: {
        Row: StrategyBrandAttribute
        Insert: Omit<StrategyBrandAttribute, 'id' | 'created_at'>
        Update: Partial<Omit<StrategyBrandAttribute, 'id' | 'created_at'>>
        Relationships: []
      }
      // Phase 3 — Strategy Library
      strategy_wiki_reads: {
        Row: StrategyWikiRead
        Insert: Partial<StrategyWikiRead>
        Update: Partial<StrategyWikiRead>
        Relationships: []
      }
      strategy_wiki_verifier_defaults: {
        Row: StrategyWikiVerifierDefault
        Insert: Partial<StrategyWikiVerifierDefault>
        Update: Partial<StrategyWikiVerifierDefault>
        Relationships: []
      }
      strategy_required_reading: {
        Row: StrategyRequiredReading
        Insert: Partial<StrategyRequiredReading>
        Update: Partial<StrategyRequiredReading>
        Relationships: []
      }
      strategy_onboarding_assignments: {
        Row: StrategyOnboardingAssignment
        Insert: Partial<StrategyOnboardingAssignment>
        Update: Partial<StrategyOnboardingAssignment>
        Relationships: []
      }
      strategy_announcements: {
        Row: StrategyAnnouncement
        Insert: Partial<StrategyAnnouncement>
        Update: Partial<StrategyAnnouncement>
        Relationships: []
      }
      strategy_announcement_dismissals: {
        Row: StrategyAnnouncementDismissal
        Insert: Partial<StrategyAnnouncementDismissal>
        Update: Partial<StrategyAnnouncementDismissal>
        Relationships: []
      }
      strategy_discovery_questionnaire: {
        Row: StrategyDiscoveryQuestionnaire
        Insert: Partial<StrategyDiscoveryQuestionnaire>
        Update: Partial<StrategyDiscoveryQuestionnaire>
        Relationships: []
      }
      strategy_discovery_questionnaire_files: {
        Row: StrategyDiscoveryQuestionnaireFile
        Insert: Partial<StrategyDiscoveryQuestionnaireFile>
        Update: Partial<StrategyDiscoveryQuestionnaireFile>
        Relationships: []
      }
      strategy_web_projects: {
        Row: StrategyWebProject
        Insert: Partial<StrategyWebProject>
        Update: Partial<StrategyWebProject>
        Relationships: []
      }
      web_content_templates: {
        Row: WebContentTemplate
        Insert: Partial<WebContentTemplate>
        Update: Partial<WebContentTemplate>
        Relationships: []
      }
      web_pages: {
        Row: WebPage
        Insert: Partial<WebPage>
        Update: Partial<WebPage>
        Relationships: []
      }
      web_sections: {
        Row: WebSection
        Insert: Partial<WebSection>
        Update: Partial<WebSection>
        Relationships: []
      }
      web_embed_blocks: {
        Row: WebEmbedBlock
        Insert: Partial<WebEmbedBlock>
        Update: Partial<WebEmbedBlock>
        Relationships: []
      }
      web_intake_documents: {
        Row: WebIntakeDocument
        Insert: Partial<WebIntakeDocument>
        Update: Partial<WebIntakeDocument>
        Relationships: []
      }
      web_project_snippets: {
        Row: WebProjectSnippet
        Insert: Partial<WebProjectSnippet>
        Update: Partial<WebProjectSnippet>
        Relationships: []
      }
      web_ai_messages: {
        Row: WebAIMessage
        Insert: Partial<WebAIMessage>
        Update: Partial<WebAIMessage>
        Relationships: []
      }
      web_ai_ideas: {
        Row: WebAIIdea
        Insert: Partial<WebAIIdea>
        Update: Partial<WebAIIdea>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      get_copy_review_by_token: {
        Args: { p_token: string }
        Returns: CopyReviewPortalPayload | null
      }
      upsert_copy_review_decision: {
        Args: { p_token: string; p_review_id: string; p_block_id: string; p_decision: CopyReviewDecision }
        Returns: boolean
      }
      insert_copy_review_comment: {
        Args: {
          p_token: string
          p_review_id: string
          p_block_id: string
          p_body: string
          p_author_name: string | null
          p_client_id: string
        }
        Returns: string | null
      }
      update_copy_review_comment: {
        Args: { p_token: string; p_comment_id: string; p_client_id: string; p_body: string }
        Returns: boolean
      }
      delete_copy_review_comment: {
        Args: { p_token: string; p_comment_id: string; p_client_id: string }
        Returns: boolean
      }
      submit_copy_review: {
        Args: { p_token: string; p_review_id: string }
        Returns: boolean
      }
      get_brand_guide_by_slug: {
        Args: { p_slug: string }
        Returns: BrandGuidePortalPayload | null
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
