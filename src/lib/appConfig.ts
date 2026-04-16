import { supabase } from './supabase'
import type { AppConfig } from '../types/database'

export const DEFAULT_APP_CONFIG: AppConfig = {
  id: 1,
  standard_footer:
    'If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}.',
  recap_header: 'All In Updates Recap:',
  recap_brand_current_label: '🎨 Branding Current Milestone:',
  recap_brand_next_label: '🎨 Branding Next Up:',
  recap_web_current_label: '🌐 Website Current Milestone:',
  recap_web_next_label: '🌐 Website Next Up:',
  recap_portal_label: '📍 View Your Milestone History:',
  updated_at: new Date().toISOString(),
  updated_by: null,
}

export async function loadAppConfig(): Promise<AppConfig> {
  const { data, error } = await supabase
    .from('strategy_app_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) {
    console.warn('[appConfig] Using defaults — load failed:', error?.message)
    return DEFAULT_APP_CONFIG
  }

  return data as AppConfig
}

export async function saveAppConfig(
  updates: Partial<Omit<AppConfig, 'id' | 'updated_at'>>,
  updatedBy: string,
): Promise<AppConfig> {
  const { data, error } = await supabase
    .from('strategy_app_config')
    .upsert({ id: 1, ...updates, updated_by: updatedBy } as Record<string, unknown>)
    .select()
    .maybeSingle()

  if (error || !data) throw error ?? new Error('Save returned no rows')
  return data as AppConfig
}
