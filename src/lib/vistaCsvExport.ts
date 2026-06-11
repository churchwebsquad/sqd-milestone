/**
 * Vista Social CSV export.
 *
 * Builds a CSV that the team can upload into Vista Social as a batch
 * of draft posts. Used by the Approved step when the direct push API
 * (/api/srp/push-to-vista) isn't configured.
 *
 * Columns: Channel, Caption, Scheduled Date, Media URL
 *  - Channel       — platform per row (Instagram / Facebook / TikTok / YouTube)
 *  - Caption       — the deliverable's final text
 *  - Scheduled Date — left blank; coach fills before importing into Vista
 *  - Media URL     — for reels, the rendered MP4 URL from clipcutter_jobs.clip_results
 *
 * One row per deliverable per platform. Reel captions get their video_url
 * if rendered; otherwise the URL column is empty so Vista will still
 * accept the row as text-only draft.
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
    | 'carousel_caption' | 'reel1_caption' | 'reel2_caption' | 'church_name'
    | 'session_id'
  >
  /** Rendered clip results from srp_pipeline.clipcutter_jobs.clip_results, in
   *  the same order as the reel slot (index 0 → reel1, index 1 → reel2). */
  renderedClips?: SrpClipSelection[]
}

export function buildVistaCsv({ session, renderedClips = [] }: VistaCsvInput): string {
  const rows: CsvRow[] = []

  const reelUrlByIdx: Record<number, string | undefined> = {
    0: renderedClips[0]?.video_url ?? undefined,
    1: renderedClips[1]?.video_url ?? undefined,
  }

  if (session.facebook_post) {
    rows.push({ channel: 'Facebook',  caption: session.facebook_post,  date: '', mediaUrl: '' })
  }
  if (session.sunday_invite) {
    rows.push({ channel: 'Facebook',  caption: session.sunday_invite,  date: '', mediaUrl: '' })
    rows.push({ channel: 'Instagram', caption: session.sunday_invite,  date: '', mediaUrl: '' })
  }
  if (session.photo_recap_caption) {
    rows.push({ channel: 'Instagram', caption: session.photo_recap_caption, date: '', mediaUrl: '' })
    rows.push({ channel: 'Facebook',  caption: session.photo_recap_caption, date: '', mediaUrl: '' })
  }
  if (session.carousel_caption) {
    rows.push({ channel: 'Instagram', caption: session.carousel_caption, date: '', mediaUrl: '' })
  }
  if (session.reel1_caption) {
    rows.push({ channel: 'Instagram', caption: session.reel1_caption, date: '', mediaUrl: reelUrlByIdx[0] ?? '' })
    rows.push({ channel: 'TikTok',    caption: session.reel1_caption, date: '', mediaUrl: reelUrlByIdx[0] ?? '' })
  }
  if (session.reel2_caption) {
    rows.push({ channel: 'Instagram', caption: session.reel2_caption, date: '', mediaUrl: reelUrlByIdx[1] ?? '' })
    rows.push({ channel: 'TikTok',    caption: session.reel2_caption, date: '', mediaUrl: reelUrlByIdx[1] ?? '' })
  }

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
