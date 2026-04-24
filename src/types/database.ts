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
export type BrandColorTier = 'primary' | 'secondary' | 'accent' | 'background' | 'text' | 'light' | 'dark'
export type BrandTypographyTier = 'primary' | 'secondary' | 'accent'
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
  hex: string
  cmyk: string | null
  rgb: string | null
  pms: string | null
  proportion_pct: number | null
  on_color_logo_url: string | null
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

export interface StrategyBrandAttribute {
  id: string
  brand_guide_id: string
  label: string
  description: string | null
  sort_order: number
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
