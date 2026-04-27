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

/** A single selected partner contact — can be an existing clickup_users row
 *  or a hand-typed name. When clickupId is null the mention falls back to
 *  plain text in the rendered ClickUp message. */
export interface SelectedContact {
  name: string
  clickupId: number | null
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
  /** Optional track label within a pathway. Required for ministry_subbrand
   *  so multiple parallel subbrands per church stay distinct. Null otherwise. */
  trackName: string | null
  // Step 3
  currentMilestoneId: string
  nextMilestoneId: string | null
  // Step 4
  messageBody: string
  includeFooter: boolean
  includeRecap: boolean
  /** Subject-line source the user picked on the Message step:
   *   - 'milestone' (default): use the milestone step name (with optional
   *     trackName prefix) — same behavior the page had before this field
   *     existed, so legacy submissions match.
   *   - 'template': use the applied template's `subject_line`. Tracked
   *     via `templateSubjectLine` because the template object isn't
   *     persisted across step navigations.
   *   - 'custom': use `customSubject` verbatim (merge fields resolve at
   *     submit time). */
  subjectMode: 'milestone' | 'template' | 'custom'
  /** Subject from the most recently applied template. Stamped when a
   *  template is picked in Step 5; null if no template has been applied
   *  or the template doesn't define a subject. */
  templateSubjectLine: string | null
  /** User-typed subject when `subjectMode === 'custom'`. */
  customSubject: string
  // Step 5
  assets: AssetRow[]
  // Step 6 — partnerContactName/partnerContactClickupId are derived from
  // partnerContacts (joined mention text; first contact's id) for merge field
  // resolution and DB storage. partnerContacts is the source of truth.
  partnerContactName: string
  partnerContactClickupId: number | null
  partnerContacts: SelectedContact[]
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
  trackName: null,
  currentMilestoneId: '',
  nextMilestoneId: null,
  messageBody: '',
  includeFooter: true,
  includeRecap: true,
  subjectMode: 'milestone',
  templateSubjectLine: null,
  customSubject: '',
  assets: [],
  partnerContactName: '',
  partnerContactClickupId: null,
  partnerContacts: [],
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
  form: 'Form',
  attachment: 'Attachment',
  other: 'Other',
}

export const ASSET_TYPES = Object.keys(ASSET_TYPE_LABELS) as AssetType[]
