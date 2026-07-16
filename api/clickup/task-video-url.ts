/**
 * GET /api/clickup/task-video-url?taskId=abc123
 *
 * Searches a ClickUp task's description and comments for a video URL
 * (YouTube, Vimeo, Dropbox, Google Drive, or direct video file).
 * Returns { videoUrl, source } or { videoUrl: null }.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const maxDuration = 15

const ALL_VIDEO_PATTERN =
  /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/|(?:www\.)?vimeo\.com\/|(?:www\.)?dropbox\.com\/|drive\.google\.com\/file\/|docs\.google\.com\/|[^\s"'<>]+\.(?:mp4|mov|m4v|mkv|webm))[^\s"'<>]*/gi

const PREFERRED_PATTERN =
  /https?:\/\/(?:(?:www\.)?youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/|(?:www\.)?vimeo\.com\/)[^\s"'<>]*/gi

function extractVideoUrl(text: string): string | null {
  if (!text) return null
  // Always prefer YouTube / Vimeo over Dropbox / Drive / raw files
  PREFERRED_PATTERN.lastIndex = 0
  const preferred = PREFERRED_PATTERN.exec(text)
  if (preferred) return preferred[0].replace(/[.,;)]+$/, '')

  ALL_VIDEO_PATTERN.lastIndex = 0
  const any = ALL_VIDEO_PATTERN.exec(text)
  return any ? any[0].replace(/[.,;)]+$/, '') : null
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const taskId = String(req.query.taskId ?? '').trim()
  if (!taskId) return res.status(400).json({ error: 'Missing taskId' })

  const token = process.env.CLICKUP_API_TOKEN
  if (!token) return res.status(500).json({ error: 'CLICKUP_API_TOKEN not set' })

  try {
    // Fetch task description and comments in parallel
    const [taskRes, commentsRes] = await Promise.all([
      fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
        headers: { Authorization: token },
      }),
      fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
        headers: { Authorization: token },
      }),
    ])

    if (!taskRes.ok) throw new Error(`ClickUp task API error: ${taskRes.status}`)

    const task = await taskRes.json()
    const description = task.description ?? ''

    // Check custom fields first (e.g. "Publicly Shared Link")
    let videoUrl: string | null = null
    let source = 'custom_field'
    const customFields: any[] = task.custom_fields ?? []
    for (const field of customFields) {
      const name = (field.name ?? '').toLowerCase()
      if (name.includes('publicly') || name.includes('shared link') || name.includes('video url') || name.includes('video link')) {
        const val = field.value ?? ''
        if (typeof val === 'string' && val.trim()) {
          videoUrl = val.trim()
          break
        }
      }
    }

    // Then check description
    if (!videoUrl) {
      videoUrl = extractVideoUrl(description)
      source = 'description'
    }

    // Then check comments if not found
    if (!videoUrl && commentsRes.ok) {
      const commentsData = await commentsRes.json()
      const comments: any[] = commentsData.comments ?? []
      for (const comment of comments) {
        const text = comment.comment_text ?? ''
        videoUrl = extractVideoUrl(text)
        if (videoUrl) { source = 'comment'; break }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json({ videoUrl, source: videoUrl ? source : null })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch task' })
  }
}
