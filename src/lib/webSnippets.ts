/**
 * Web Manager — snippet resolution helpers.
 *
 * Two stores feed the snippet popover in the editor:
 *   1. The 16 global merge field columns on strategy_web_projects (+ a
 *      system-derived {{current_year}}). Tokens here use the underscore-
 *      based form already standardized in v28 (church_name, phone, etc.).
 *   2. The web_project_snippets table for project-scoped custom tokens.
 *
 * This module folds both into a single sorted list shaped for the
 * editor's WMSnippetOption interface, with each entry carrying its
 * current resolved value so the chip can render a preview.
 */

import { supabase } from './supabase'
import type { StrategyWebProject, WebProjectSnippet } from '../types/database'
import type { WMSnippetOption } from '../components/wm/RichTextEditor'

interface GlobalFieldDef {
  column: keyof StrategyWebProject
  token: string
  label: string
}

const GLOBAL_FIELDS: GlobalFieldDef[] = [
  { column: 'church_name',          token: 'church_name',          label: 'Church name' },
  { column: 'church_short_name',    token: 'church_short_name',    label: 'Short / common name' },
  { column: 'address',              token: 'address',              label: 'Street address' },
  { column: 'city_state',           token: 'city_state',           label: 'City, state' },
  { column: 'phone',                token: 'phone',                label: 'Phone' },
  { column: 'email',                token: 'email',                label: 'General contact email' },
  { column: 'denomination',         token: 'denomination',         label: 'Denomination' },
  { column: 'pastor_name',          token: 'pastor_name',          label: 'Lead pastor' },
  { column: 'primary_service_time', token: 'primary_service_time', label: 'Primary service time' },
  { column: 'all_service_times',    token: 'all_service_times',    label: 'All service times' },
  { column: 'social_facebook_url',  token: 'social_facebook_url',  label: 'Facebook URL' },
  { column: 'social_instagram_url', token: 'social_instagram_url', label: 'Instagram URL' },
  { column: 'social_youtube_url',   token: 'social_youtube_url',   label: 'YouTube URL' },
  { column: 'social_tiktok_url',    token: 'social_tiktok_url',    label: 'TikTok URL' },
  { column: 'social_twitter_url',   token: 'social_twitter_url',   label: 'X / Twitter URL' },
  { column: 'social_linkedin_url',  token: 'social_linkedin_url',  label: 'LinkedIn URL' },
]

/** Build the editor-ready snippet list for a project. Includes empty
 *  globals so the strategist still sees them (the popover will mark
 *  them as "(empty)") — easier to spot missing fields than to lose
 *  them. */
export async function loadEditorSnippets(project: StrategyWebProject): Promise<WMSnippetOption[]> {
  const globals: WMSnippetOption[] = GLOBAL_FIELDS.map(f => ({
    token: f.token,
    label: f.label,
    resolvedValue: (project[f.column] as string | null) ?? '',
    source: 'global',
  }))

  // Plus the always-available system snippet
  globals.push({
    token: 'current_year',
    label: 'Current year',
    resolvedValue: String(new Date().getFullYear()),
    source: 'global',
    description: 'System-derived; updates automatically each year.',
  })

  const { data: customs } = await supabase
    .from('web_project_snippets')
    .select('*')
    .eq('web_project_id', project.id)
    .eq('archived', false)
    .order('used_count', { ascending: false })
    .order('label')

  const customList: WMSnippetOption[] = ((customs ?? []) as WebProjectSnippet[]).map(s => ({
    token: s.token,
    label: s.label,
    resolvedValue: s.expansion,
    source: 'custom',
    description: s.description ?? undefined,
  }))

  return [...globals, ...customList]
}
