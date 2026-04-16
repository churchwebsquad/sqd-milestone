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
// NEW STRATEGY_ TABLES
// ============================================================================

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
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
