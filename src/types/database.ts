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
  created_at: string
  updated_at: string
  [key: string]: unknown
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
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
