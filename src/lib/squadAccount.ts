/**
 * SquadAccount data loader.
 *
 * Fetches the rich per-account context the SRP UI needs:
 *  - strategy_account_progress row (member, church_name, links, etc.)
 *  - latest prf_brand_guides row (brand guide URL for the Quick Links)
 *  - srp_pipeline.clip_templates row for THIS member (brand voice +
 *    creative direction defaults — these are OUR writes, not back to
 *    strategy_account_progress)
 *
 * Read-only against the strategy_* tables per CLAUDE.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { supabase } from './supabase'
import { srpPipeline } from './srpSessions'
import type { SquadAccount } from '../types/database'

const STRATEGY_COLUMNS = [
  'member',
  'church_name',
  // Quick Links surface
  'instagram',
  'instagram_link',
  'facebook',
  'facebook_link',
  'youtube',
  'church_website',
  'strategy_brief',
  'photos_link',
  'photos_from_all_in_discovery_form',
  'custom_gpt',
  'carousel_templates',
  // Detail rows
  'speak_to_audience_as_from_discovery',
  'preferred_bible_translation',
  'which_social_media_platforms_do_you_want_us_to_post_to_from_all',
  'sms_notes',
  'plan',
  'time_zone',
  'recent_series_srp',
  'notion_dashboard',
].join(', ')

export async function loadSquadAccount(member: number): Promise<SquadAccount | null> {
  if (!Number.isFinite(member)) return null

  const [progressRes, brandRes, templateRes] = await Promise.all([
    supabase
      .from('strategy_account_progress')
      .select(STRATEGY_COLUMNS)
      .eq('member', member)
      .maybeSingle(),
    supabase
      .from('prf_brand_guides')
      .select('*')
      .eq('account', member)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
    srpPipeline
      .from('clip_templates')
      .select('brand_voice_guidelines')
      .eq('member', member)
      .eq('template_name', 'Default')
      .maybeSingle(),
  ])

  const p = progressRes.data as Record<string, unknown> | null
  if (!p) return null

  // Brand guide URL — prefer a stable public-facing share link if the
  // guide has one, otherwise fall through to whatever column is set.
  const brandGuide = brandRes.data as Record<string, unknown> | null
  const brandGuideUrl =
    (typeof brandGuide?.public_url === 'string' ? brandGuide.public_url : null) ??
    (typeof brandGuide?.guide_url === 'string' ? brandGuide.guide_url : null) ??
    (typeof brandGuide?.link === 'string' ? brandGuide.link : null) ??
    null

  const brandVoice =
    (templateRes.data as { brand_voice_guidelines?: string | null } | null)?.brand_voice_guidelines ?? null

  return {
    member: Number(p.member),
    church_name: String(p.church_name ?? ''),
    instagram:                            (p.instagram ?? null) as string | null,
    instagram_link:                       (p.instagram_link ?? null) as string | null,
    facebook:                             (p.facebook ?? null) as string | null,
    facebook_link:                        (p.facebook_link ?? null) as string | null,
    youtube:                              (p.youtube ?? null) as string | null,
    church_website:                       (p.church_website ?? null) as string | null,
    strategy_brief:                       (p.strategy_brief ?? null) as string | null,
    photos_link:                          (p.photos_link ?? null) as string | null,
    photos_from_all_in_discovery_form:    (p.photos_from_all_in_discovery_form ?? null) as string | null,
    custom_gpt:                           (p.custom_gpt ?? null) as string | null,
    carousel_templates:                   (p.carousel_templates ?? null) as string | null,
    speak_to_audience_as_from_discovery:  (p.speak_to_audience_as_from_discovery ?? null) as string | null,
    preferred_bible_translation:          (p.preferred_bible_translation ?? null) as string | null,
    which_social_media_platforms_do_you_want_us_to_post_to_from_all:
                                          (p.which_social_media_platforms_do_you_want_us_to_post_to_from_all ?? null) as string | null,
    sms_notes:                            (p.sms_notes ?? null) as string | null,
    plan:                                 (p.plan ?? null) as string | null,
    time_zone:                            (p.time_zone ?? null) as string | null,
    recent_series_srp:                    (p.recent_series_srp ?? null) as string | null,
    notion_dashboard:                     (p.notion_dashboard ?? null) as string | null,
    brand_guide_url:                      brandGuideUrl,
    brand_voice_guidelines:               brandVoice,
  }
}

/**
 * Save the per-account brand voice text. Writes to
 * srp_pipeline.clip_templates (NOT strategy_account_progress — that
 * table is read-only per CLAUDE.md).
 */
export async function saveBrandVoice(member: number, brandVoice: string): Promise<void> {
  const { error } = await srpPipeline
    .from('clip_templates')
    .upsert(
      {
        member,
        template_name: 'Default',
        brand_voice_guidelines: brandVoice,
        is_default: true,
      },
      { onConflict: 'member,template_name' },
    )
  if (error) throw new Error(`saveBrandVoice failed: ${error.message}`)
}
