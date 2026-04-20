import type { StrategyMilestoneDefinition, AssetType } from '../../types/database'

export interface AssetRow {
  id: string
  type: AssetType
  url: string
  label: string
}

export interface PartnerRow {
  member: number
  church_name: string | null
  first_name_of_primary: string | null
  css_rep: string | null
  portal_token: string | null
}

export interface ContactRow {
  clickup_id: number
  email: string | null
  username: string | null
}

export interface FormState {
  // Step 1
  memberNumber: string
  partner: PartnerRow | null
  channelId: string | null
  contacts: ContactRow[]
  // Step 2
  selectedMilestone: StrategyMilestoneDefinition | null
  isContinuation: boolean
  continuationOfId: string | null
  /** When true, continuation messages post as a reply inside the original thread
   *  instead of creating a new top-level message in the channel. */
  postAsThreadReply: boolean
  // Step 3
  currentMilestoneId: string
  nextMilestoneId: string | null
  // Step 4
  messageBody: string
  includeFooter: boolean
  includeRecap: boolean
  // Step 5
  assets: AssetRow[]
  // Step 6
  partnerContactName: string
  partnerContactClickupId: number | null
}

export const INITIAL_FORM_STATE: FormState = {
  memberNumber: '',
  partner: null,
  channelId: null,
  contacts: [],
  selectedMilestone: null,
  isContinuation: false,
  continuationOfId: null,
  postAsThreadReply: true,
  currentMilestoneId: '',
  nextMilestoneId: null,
  messageBody: '',
  includeFooter: true,
  includeRecap: true,
  assets: [],
  partnerContactName: '',
  partnerContactClickupId: null,
}

export interface StepProps {
  formData: FormState
  updateForm: (updates: Partial<FormState>) => void
  onNext: () => void
  onBack: () => void
  allMilestones: StrategyMilestoneDefinition[]
  milestonesLoading?: boolean
  onReset?: () => void
}

export const SQUAD_LABELS: Record<string, string> = {
  brand: 'Brand',
  web: 'Web',
  social: 'Social',
}

export const PATHWAY_LABELS: Record<string, string> = {
  new_brand: 'New Brand',
  existing_brand: 'Existing Brand',
  ministry_subbrand: 'Ministry Subbrand',
  redesign: 'Redesign',
  audit: 'Audit',
  refresh: 'Refresh',
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  loom_video: 'Loom Video',
  brand_guide: 'Brand Guide',
  markup_review: 'Markup Review',
  figma_file: 'Figma File',
  dropbox_folder: 'Dropbox Folder',
  style_guide: 'Style Guide',
  mood_board: 'Mood Board',
  contentsnare: 'ContentSnare',
  website_link: 'Website Link',
  document: 'Document',
  vista_social: 'Vista Social',
  other: 'Other',
}

export const ASSET_TYPES = Object.keys(ASSET_TYPE_LABELS) as AssetType[]
