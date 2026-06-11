/**
 * Build the `accountContext` object passed to every generate-* endpoint.
 *
 * Centralized so every AI call gets the SAME shape of brand-voice +
 * audience + sermon-metadata signals. Mirrors srp-generator-main's
 * approach exactly so the prompts the model sees are identical.
 */

import type { SquadAccount, SrpSermonSubmission } from '../types/database'

export interface AccountContext {
  churchName?:         string
  memberId?:           number
  speakAs?:            string
  bibleTranslation?:   string
  platforms?:          string
  smsNotes?:           string
  seriesTitle?:        string
  seriesDescription?:  string
  sermonTitle?:        string
  sermonDescription?: string
}

export function buildAccountContext(
  acct: SquadAccount | null | undefined,
  sermon?: SrpSermonSubmission | null,
): AccountContext | undefined {
  if (!acct) return undefined
  const ctx: AccountContext = {
    churchName:       acct.church_name,
    memberId:         acct.member,
    speakAs:          acct.speak_to_audience_as_from_discovery ?? undefined,
    bibleTranslation: acct.preferred_bible_translation ?? undefined,
    platforms:        acct.which_social_media_platforms_do_you_want_us_to_post_to_from_all ?? undefined,
    smsNotes:         acct.sms_notes ?? undefined,
  }
  if (sermon) {
    if (sermon.series_title)       ctx.seriesTitle       = sermon.series_title
    if (sermon.series_description) ctx.seriesDescription = sermon.series_description
    if (sermon.sermon_title)       ctx.sermonTitle       = sermon.sermon_title
    if (sermon.sermon_description) ctx.sermonDescription = sermon.sermon_description
  }
  return ctx
}
