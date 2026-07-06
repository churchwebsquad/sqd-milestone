/**
 * Vista Social CSV export.
 *
 * Builds a CSV that the team can upload into Vista Social as a batch
 * of draft posts. Used by the Approved step when the direct push API
 * (/api/srp/push-to-vista) isn't configured.
 *
 * Columns: Channel, Caption, Scheduled Date, Media URL
 */

import type { SrpPipelineSession, SrpClipSelection } from '../types/database'

interface CsvRow {
  channel:  string
  caption:  string
  date:     string
  mediaUrl: string
}

interface VistaCsvInput {
  session: Pick<SrpPipelineSession,
    | 'facebook_post' | 'sunday_invite' | 'photo_recap_caption'
    | 'carousel_caption' | 'church_name' | 'session_id'
  >
  /** All selected clips with social_caption populated. */
  clipSelections?: SrpClipSelection[]
  /** Rendered clip results from clipcutter_jobs, matched by clip_id. */
  renderedClips?: SrpClipSelection[]
}

export function buildVistaCsv({ session, clipSelections = [], renderedClips = [] }: VistaCsvInput): string {
  const rows: CsvRow[] = []

  if (session.facebook_post) {
    rows.push({ channel: 'Facebook',  caption: session.facebook_post, date: '', mediaUrl: '' })
  }
  if (session.sunday_invite) {
    rows.push({ channel: 'Facebook',  caption: session.sunday_invite, date: '', mediaUrl: '' })
    rows.push({ channel: 'Instagram', caption: session.sunday_invite, date: '', mediaUrl: '' })
  }
  if (session.photo_recap_caption) {
    rows.push({ channel: 'Instagram', caption: session.photo_recap_caption, date: '', mediaUrl: '' })
    rows.push({ channel: 'Facebook',  caption: session.photo_recap_caption, date: '', mediaUrl: '' })
  }
  if (session.carousel_caption) {
    rows.push({ channel: 'Instagram', caption: session.carousel_caption, date: '', mediaUrl: '' })
  }

  clipSelections.forEach((clip, i) => {
    const caption = clip.social_caption
    if (!caption) return
    const rendered = renderedClips.find(r => r.clip_id === clip.clip_id) ?? renderedClips[i]
    const mediaUrl = rendered?.video_url ?? ''
    rows.push({ channel: 'Instagram', caption, date: '', mediaUrl })
    rows.push({ channel: 'TikTok',    caption, date: '', mediaUrl })
  })

  const escape = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }

  const header = ['Channel', 'Caption', 'Scheduled Date', 'Media URL'].join(',')
  const body = rows
    .map(r => [r.channel, r.caption, r.date, r.mediaUrl].map(escape).join(','))
    .join('\n')

  return `${header}\n${body}\n`
}

/** Trigger a browser download of the built CSV. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
