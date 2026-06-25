/**
 * Tool-URL detection for partner-added CTAs in content collection.
 *
 * Mountain Life's session showed partners routinely pasting Church
 * Center / Planning Center / Subsplash / Vimeo / YouTube URLs into
 * the "Add an item" form when what they actually mean is "this is a
 * call-to-action that points at our [tool]." We can detect the tool
 * from the URL host + path, surface it back to the partner so they
 * can confirm the intent, and persist the tool tag alongside the
 * mark so downstream readers don't have to re-detect.
 *
 * Heuristics are intentionally generous — we'd rather over-detect
 * (and let the partner override) than miss a tool the partner
 * relies on.
 */

export type DetectedTool =
  | 'church_center'
  | 'planning_center'
  | 'subsplash'
  | 'tithely'
  | 'vimeo'
  | 'youtube'
  | 'facebook'
  | 'instagram'
  | 'spotify'
  | 'apple_podcasts'
  | 'spotify_podcasts'
  | 'apple_music'
  | null

export interface ToolDetection {
  tool:         DetectedTool
  /** Short human label for the detected tool ("Church Center"). */
  label:        string | null
  /** Best-guess of what the URL lets a visitor DO ("Browse small groups",
   *  "Submit a prayer request"). Used as the placeholder for the
   *  action-title prompt in CTA mode. NULL when we can't infer. */
  actionHint:   string | null
  /** True when the URL appears to be a Church Center / Planning Center
   *  form URL (people/forms/N) — these are nearly always CTAs and we
   *  use this signal to nudge the partner into CTA mode automatically. */
  isFormish:    boolean
}

/** Detect tool + heuristic action hint from a pasted URL. Best-effort;
 *  returns nulls in the result when nothing matches. */
export function detectToolFromUrl(raw: string | null | undefined): ToolDetection {
  const empty: ToolDetection = { tool: null, label: null, actionHint: null, isFormish: false }
  if (!raw || typeof raw !== 'string') return empty
  const trimmed = raw.trim()
  if (!trimmed) return empty

  let url: URL
  try {
    // Prepend protocol if missing — partners often paste "mlc.churchcenter.com/..."
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return empty
  }
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  // ── Church Center (mlc.churchcenter.com, etc.) ─────────────────────
  if (host.endsWith('.churchcenter.com') || host === 'churchcenter.com') {
    const isFormish = /^\/people\/forms\//.test(path)
    let actionHint: string | null = null
    if (isFormish)                       actionHint = 'Submit this form'
    else if (path.startsWith('/groups')) actionHint = 'Browse our small groups'
    else if (path.startsWith('/calendar'))     actionHint = 'See our calendar'
    else if (path.startsWith('/events'))       actionHint = 'See our events'
    else if (path.startsWith('/giving'))       actionHint = 'Give online'
    else if (path.startsWith('/registrations'))actionHint = 'Register for an event'
    return { tool: 'church_center', label: 'Church Center', actionHint, isFormish }
  }

  // ── Planning Center (planningcenteronline.com) ─────────────────────
  if (host.endsWith('.planningcenteronline.com') || host === 'planningcenteronline.com') {
    const isFormish = /\/forms\//.test(path) || /\/registrations\//.test(path)
    return { tool: 'planning_center', label: 'Planning Center', actionHint: isFormish ? 'Submit this form' : null, isFormish }
  }

  // ── Subsplash (subsplash.com, app.subsplash.com) ───────────────────
  if (host.endsWith('subsplash.com')) {
    return {
      tool: 'subsplash',
      label: 'Subsplash',
      actionHint: path.includes('/give') ? 'Give online'
        : path.includes('/sermon') ? 'Watch our sermons'
        : 'Open our Subsplash page',
      isFormish: false,
    }
  }

  // ── Tithely (tithe.ly) ─────────────────────────────────────────────
  if (host === 'tithe.ly' || host.endsWith('.tithe.ly')) {
    return { tool: 'tithely', label: 'Tithely', actionHint: 'Give online', isFormish: false }
  }

  // ── Video platforms ────────────────────────────────────────────────
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    return { tool: 'vimeo', label: 'Vimeo', actionHint: 'Watch this video', isFormish: false }
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    return { tool: 'youtube', label: 'YouTube', actionHint: 'Watch on YouTube', isFormish: false }
  }

  // ── Social ─────────────────────────────────────────────────────────
  if (host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com' || host.endsWith('.facebook.com')) {
    return { tool: 'facebook', label: 'Facebook', actionHint: 'Visit us on Facebook', isFormish: false }
  }
  if (host === 'instagram.com' || host === 'www.instagram.com' || host.endsWith('.instagram.com')) {
    return { tool: 'instagram', label: 'Instagram', actionHint: 'Follow us on Instagram', isFormish: false }
  }

  // ── Podcasts / streaming ───────────────────────────────────────────
  if (host === 'open.spotify.com' || host === 'spotify.com' || host.endsWith('.spotify.com')) {
    return {
      tool: path.startsWith('/show') ? 'spotify_podcasts' : 'spotify',
      label: path.startsWith('/show') ? 'Spotify (podcast)' : 'Spotify',
      actionHint: path.startsWith('/show') ? 'Listen to our podcast' : 'Listen on Spotify',
      isFormish: false,
    }
  }
  if (host === 'podcasts.apple.com') {
    return { tool: 'apple_podcasts', label: 'Apple Podcasts', actionHint: 'Listen on Apple Podcasts', isFormish: false }
  }
  if (host === 'music.apple.com') {
    return { tool: 'apple_music', label: 'Apple Music', actionHint: 'Listen on Apple Music', isFormish: false }
  }

  return empty
}
