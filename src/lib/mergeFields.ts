import type { AssetRow } from '../components/submit/types'

export interface MergeData {
  church_name?: string | null
  first_name_of_primary?: string | null
  step_name?: string | null
  section_group?: string | null
  submitter_name?: string | null
  account_manager?: string | null
  partner_contact_name?: string | null
  asset_links?: string | null
  next_step_name?: string | null
}

export const STANDARD_FOOTER =
  'If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}.'

export function resolveMergeFields(template: string, data: MergeData): string {
  const replacements: [string, string | null | undefined][] = [
    ['{{church_name}}', data.church_name],
    ['{{first_name_of_primary}}', data.first_name_of_primary],
    ['{{step_name}}', data.step_name],
    ['{{section_group}}', data.section_group],
    ['{{submitter_name}}', data.submitter_name],
    ['{{account_manager}}', data.account_manager],
    ['{{partner_contact_name}}', data.partner_contact_name],
    ['{{asset_links}}', data.asset_links],
    ['{{next_step_name}}', data.next_step_name],
  ]
  return replacements.reduce((text, [field, value]) => {
    // undefined → field was not provided at all; leave the token intact for a
    // later resolution pass (e.g. {{asset_links}} is deferred until Step 7).
    // null/'' → field was explicitly provided but has no value; erase the token.
    if (value === undefined) return text
    return text.replaceAll(field, value ?? '')
  }, template)
}

export function formatAssetLinks(assets: AssetRow[]): string {
  if (assets.length === 0) return ''
  // Emit markdown link syntax when a label is present so the ClickUp
  // rich-text pipeline renders the label as a clickable hyperlink instead
  // of showing the raw URL. Labelless assets stay as bare URLs — ClickUp
  // auto-linkifies those.
  return assets
    .filter(a => a.url.trim())
    .map(a => (a.label ? `[${a.label}](${a.url})` : a.url))
    .join('\n')
}
