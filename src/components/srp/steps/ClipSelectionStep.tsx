/**
 * Step 4 — Clip selection + per-clip caption setup (combined).
 *
 * 1. Coach generates AI clip suggestions from the transcript.
 * 2. Coach picks N clips matching the reel count.
 * 3. For each picked clip, inline panel shows:
 *    - Editable caption text (defaults to the quote)
 *    - Caption style picker (23 styles from Duane)
 *    - "Use last week's style" shortcut from clip_templates
 * Continue is gated on selecting the correct reel count AND each clip
 * having a caption style chosen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Loader2, Scissors, Sparkles,
  Check, X, ChevronDown, ChevronUp, Clock, Pin, PinOff,
  Lightbulb, Zap, MessageSquare, Play, EyeOff,
} from 'lucide-react'
import { useSrpWorkflow } from '../../../contexts/SrpWorkflowContext'
import { SrpButton } from '../_shared/SrpButton'
import { callSrpApi } from '../../../lib/srpApi'
import { STEP_LABELS, STEP_DESCRIPTIONS } from '../../../lib/srpSessions'
import { isSrpReelDeliverable, type SrpClipSelection } from '../../../types/database'
import { buildAccountContext } from '../../../lib/accountContext'
import { srpPipeline } from '../../../lib/srpSessions'

// ── Caption styles from Duane ────────────────────────────────────────────────

interface CaptionStyleMeta {
  slug: string
  label: string
  group: 'Traditional' | 'Elevated' | 'Reference' | 'Basic'
}

const CAPTION_STYLES: CaptionStyleMeta[] = [
  { slug: 'cap01-hormozi-pill',       label: 'Spotlight Pill',      group: 'Traditional' },
  { slug: 'cap02-mrbeast-pop',        label: 'MrBeast Pop',         group: 'Traditional' },
  { slug: 'cap03-youtube-bar',        label: 'YouTube Bar',         group: 'Traditional' },
  { slug: 'cap04-outline-classic',    label: 'Outline Classic',     group: 'Traditional' },
  { slug: 'cap05-word-punch',         label: 'Word Punch',          group: 'Traditional' },
  { slug: 'cap06-fade-fill',          label: 'Fade Fill',           group: 'Traditional' },
  { slug: 'cap07-fade-slide-up',      label: 'Fade + Slide Up',     group: 'Traditional' },
  { slug: 'cap08-typewriter',         label: 'Typewriter',          group: 'Traditional' },
  { slug: 'cap09-brand-italic',       label: 'Brand Italic',        group: 'Traditional' },
  { slug: 'cap11-liquid-morph',       label: 'Liquid Morph',        group: 'Elevated'    },
  { slug: 'cap14-stamped',            label: 'Stamped',             group: 'Elevated'    },
  { slug: 'cap15-typewriter-glitch',  label: 'Typewriter Glitch',   group: 'Elevated'    },
  { slug: 'cap16-chip-row',           label: 'Chip Row',            group: 'Elevated'    },
  { slug: 'cap20-confession-quote',   label: 'Confession Quote',    group: 'Elevated'    },
  { slug: 'cap22-index-card-stack',   label: 'Index Card Stack',    group: 'Elevated'    },
  { slug: 'cap23-neon-glow',          label: 'Neon Glow',           group: 'Elevated'    },
  { slug: 'cap24-cinematic-fade',     label: 'Cinematic Fade',      group: 'Elevated'    },
  { slug: 'cap25-caret-cursor',       label: 'Caret Cursor',        group: 'Elevated'    },
  { slug: 'cap26-vinyl-tracking',     label: 'Vinyl Tracking',      group: 'Elevated'    },
  { slug: 'cap31-outline-pop',        label: 'Outline Pop',         group: 'Reference'   },
  { slug: 'cap32-framed-card',        label: 'Framed Card',         group: 'Reference'   },
  { slug: 'cap33-bold-emphasis',      label: 'Bold Emphasis',       group: 'Reference'   },
  { slug: 'cap40-simple-clean',       label: 'Simple Clean',        group: 'Basic'       },
  { slug: 'cap41-simple-boxed',       label: 'Simple Boxed',        group: 'Basic'       },
  { slug: 'cap42-bold-statement',     label: 'Bold Statement',      group: 'Basic'       },
]

const GROUPS: CaptionStyleMeta['group'][] = ['Traditional', 'Elevated', 'Reference', 'Basic']

const CATEGORY_COLORS: Record<string, string> = {
  'Profound Ideas':        'bg-[#EDE9FC] text-[#341756]',
  'Practical Application': 'bg-[#D6F0E6] text-[#0F5132]',
  'Challenges':            'bg-[#FCE9E9] text-[#7A1F1F]',
  'Encouragement':         'bg-[#FFF1D6] text-[#7A5A0F]',
  'Life of Jesus':         'bg-[#E0E8FA] text-[#1F3A7A]',
}

// ── Video preview helpers ────────────────────────────────────────────────────

function mmssToSeconds(ts: string | undefined): number {
  if (!ts) return 0
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0]
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
    }
  } catch { /* invalid URL */ }
  return null
}

function dropboxDirectUrl(url: string): string {
  // Convert dropbox share link to raw direct download URL for <video> playback
  return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace(/[?&]dl=\d/, '')
}

function ClipVideoPreview({
  videoUrl, videoSourceType, startTime, endTime,
}: {
  videoUrl: string
  videoSourceType: string | null | undefined
  startTime: string | undefined
  endTime:   string | undefined
}) {
  const startSecs = mmssToSeconds(startTime)
  const endSecs   = mmssToSeconds(endTime)

  if (videoSourceType === 'youtube') {
    const videoId = extractYouTubeId(videoUrl)
    if (!videoId) return <UnsupportedPreview reason="Couldn't parse YouTube ID" />
    const src = `https://www.youtube.com/embed/${videoId}?start=${startSecs}&autoplay=1&rel=0&modestbranding=1`
    return (
      <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
        <iframe
          src={src}
          className="w-full h-full"
          allow="autoplay; encrypted-media"
          allowFullScreen
          title="Clip preview"
        />
      </div>
    )
  }

  if (videoSourceType === 'dropbox') {
    const direct = dropboxDirectUrl(videoUrl)
    const srcWithTime = endSecs > startSecs
      ? `${direct}#t=${startSecs},${endSecs}`
      : `${direct}#t=${startSecs}`
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        key={srcWithTime}
        src={srcWithTime}
        controls
        autoPlay
        className="w-full rounded-lg bg-black"
        style={{ maxHeight: 360 }}
      />
    )
  }

  if (videoSourceType === 'vimeo') {
    try {
      const u = new URL(videoUrl)
      const videoId = u.pathname.split('/').filter(Boolean).pop()
      if (!videoId) return <UnsupportedPreview reason="Couldn't parse Vimeo ID" />
      const src = `https://player.vimeo.com/video/${videoId}?autoplay=1#t=${startSecs}s`
      return (
        <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
          <iframe
            src={src}
            className="w-full h-full"
            allow="autoplay; fullscreen"
            allowFullScreen
            title="Clip preview"
          />
        </div>
      )
    } catch {
      return <UnsupportedPreview reason="Invalid Vimeo URL" />
    }
  }

  if (videoSourceType === 'direct') {
    const srcWithTime = endSecs > startSecs
      ? `${videoUrl}#t=${startSecs},${endSecs}`
      : `${videoUrl}#t=${startSecs}`
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        key={srcWithTime}
        src={srcWithTime}
        controls
        autoPlay
        className="w-full rounded-lg bg-black"
        style={{ maxHeight: 360 }}
      />
    )
  }

  return <UnsupportedPreview reason={`Preview not supported for source type: ${videoSourceType ?? 'unknown'}`} />
}

function UnsupportedPreview({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-lavender)] bg-[var(--color-lavender-tint)]/40 px-4 py-3 text-[11px] text-[var(--color-purple-gray)]">
      {reason}
    </div>
  )
}

// ── Generate clips response ──────────────────────────────────────────────────

interface GenerateClipsResponse {
  clips: SrpClipSelection[]
  has_timecodes: boolean
  usage?: { input_tokens: number; output_tokens: number }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClipSelectionStep() {
  const {
    account, sermonSubmission, brandVoice,
    selectedDeliverables,
    transcript, hasTimecodes,
    keyInsights,
    clipSuggestions, setClipSuggestions,
    clipSelections, setClipSelections,
    videoUrl, videoSourceType,
    visibleSteps,
    goToNextStep, goToPrevStep,
  } = useSrpWorkflow()

  const [generating, setGenerating]         = useState(false)
  const [genError, setGenError]             = useState<string | null>(null)
  const [expandedClipId, setExpandedClipId] = useState<string | null>(null)
  const [lastWeekSlug, setLastWeekSlug]     = useState<string | null>(null)
  const [lastWeekLabel, setLastWeekLabel]   = useState<string | null>(null)
  const [pinnedIds, setPinnedIds]           = useState<Set<string>>(new Set())
  const [previewKey, setPreviewKey]         = useState<string | null>(null)

  const stepNum   = visibleSteps.indexOf('clips') + 1
  const reelCount = useMemo(
    () => selectedDeliverables.filter(isSrpReelDeliverable).length,
    [selectedDeliverables],
  )

  // Load last week's caption style from clip_templates for this church
  useEffect(() => {
    const member = account?.member
    if (!member) return
    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(srpPipeline as any)
      .from('clip_templates')
      .select('animated_captions')
      .eq('member', member)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any }) => {
        if (cancelled || !data?.animated_captions?.default?.motion_slug) return
        const slug = data.animated_captions.default.motion_slug as string
        const style = CAPTION_STYLES.find(s => s.slug === slug)
        setLastWeekSlug(slug)
        setLastWeekLabel(style?.label ?? slug)
      })
    return () => { cancelled = true }
  }, [account?.member])

  // ── Clip generation ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!transcript || transcript.trim().length < 200) {
      setGenError('Transcript too short. Go back to Step 3.')
      return
    }
    setGenerating(true); setGenError(null)
    // Pass pinned clips' quotes so the AI avoids regenerating the same moments
    const pinnedQuotes = clipSelections
      .filter(c => c.clip_id && pinnedIds.has(c.clip_id) && c.quote)
      .map(c => c.quote!)
    try {
      const r = await callSrpApi<GenerateClipsResponse>('generate-clips', {
        transcript,
        brandVoice,
        accountContext: buildAccountContext(account, sermonSubmission),
        hasTimecodes,
        pinnedQuotes,
        keyInsights: keyInsights.length ? keyInsights : undefined,
      })
      setClipSuggestions(r.clips ?? [])
    } catch (e) {
      const err = e as Error & { errorCode?: string }
      setGenError(err.errorCode ? `${err.errorCode}: ${err.message}` : err.message)
    } finally {
      setGenerating(false)
    }
  }, [transcript, brandVoice, account, sermonSubmission, hasTimecodes, clipSelections, pinnedIds, setClipSuggestions])

  const togglePin = useCallback((clipId: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(clipId)) next.delete(clipId)
      else next.add(clipId)
      return next
    })
  }, [])

  // ── Pick / unpick ────────────────────────────────────────────────────────

  const togglePick = useCallback((clip: SrpClipSelection) => {
    const idx = clipSelections.findIndex(c =>
      c.quote === clip.quote && (c.category ?? '') === (clip.category ?? ''),
    )
    if (idx >= 0) {
      setClipSelections(clipSelections.filter((_, i) => i !== idx))
      return
    }
    if (clipSelections.length >= reelCount) {
      const next = [...clipSelections.slice(0, reelCount - 1), assignClipId(clip, reelCount)]
      setClipSelections(next)
      return
    }
    const picked = assignClipId(clip, clipSelections.length + 1)
    setClipSelections([...clipSelections, picked])
    setExpandedClipId(picked.clip_id ?? null)
  }, [clipSelections, reelCount, setClipSelections])

  const isPicked = useCallback((clip: SrpClipSelection): boolean =>
    clipSelections.some(c =>
      c.quote === clip.quote && (c.category ?? '') === (clip.category ?? ''),
    ), [clipSelections])

  // ── Per-clip updates (caption text, style) ────────────────────────────────

  const updateClip = useCallback((clipId: string, patch: Partial<SrpClipSelection>) => {
    setClipSelections(clipSelections.map(c =>
      c.clip_id === clipId ? { ...c, ...patch } : c,
    ))
  }, [clipSelections, setClipSelections])

  const applyLastWeekStyle = useCallback((clipId: string) => {
    if (!lastWeekSlug) return
    updateClip(clipId, { caption_slug: lastWeekSlug })
  }, [lastWeekSlug, updateClip])

  // Continue requires correct clip count + every clip has a style chosen
  const continueReady = clipSelections.length === reelCount &&
    reelCount > 0 &&
    clipSelections.every(c => !!c.caption_slug)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--color-primary-purple)]">
          Step {stepNum} of {visibleSteps.length}
        </p>
        <h2 className="text-[22px] font-semibold text-[var(--color-deep-plum)] mt-0.5">
          {STEP_LABELS.clips}
        </h2>
        <p className="text-[13px] text-[var(--color-purple-gray)] mt-1">
          {STEP_DESCRIPTIONS.clips} · Pick {reelCount} clip{reelCount === 1 ? '' : 's'}, then set captions for each.
        </p>
      </header>

      {/* Generate button */}
      <section className="rounded-xl border border-[var(--color-lavender)] bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--color-deep-plum)]">
            {clipSuggestions.length > 0 ? `${clipSuggestions.length} suggestions ready` : 'No suggestions yet'}
          </p>
          <p className="text-[11px] text-[var(--color-purple-gray)] mt-0.5">
            {hasTimecodes
              ? '30-70 second clips with MM:SS ranges from the transcript.'
              : '100-140 word clips (≈50-70 sec) by word count.'}
          </p>
        </div>
        <SrpButton
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generating || !transcript}
          leadingIcon={generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        >
          {generating
            ? 'Generating…'
            : clipSuggestions.length > 0
              ? pinnedIds.size > 0
                ? `Regenerate (keeping ${pinnedIds.size} pinned)`
                : 'Regenerate'
              : 'Generate suggestions'}
        </SrpButton>
      </section>

      {genError && (
        <div className="rounded-lg border border-wm-danger/30 bg-wm-danger-bg px-4 py-3 text-[12px] text-wm-danger">
          {genError}
        </div>
      )}

      {/* Picked clips with inline caption editor */}
      {clipSelections.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-primary-purple)]">
            Picked {clipSelections.length} of {reelCount} · Set captions for each
          </p>
          {clipSelections.map((clip, i) => {
            const isExpanded = expandedClipId === clip.clip_id
            const hasStyle   = !!clip.caption_slug
            const styleLabel = CAPTION_STYLES.find(s => s.slug === clip.caption_slug)?.label
            const isPinned   = !!clip.clip_id && pinnedIds.has(clip.clip_id)

            return (
              <div
                key={clip.clip_id ?? `picked-${i}`}
                className="rounded-xl border border-[var(--color-primary-purple)]/40 bg-white overflow-hidden"
              >
                {/* Clip header */}
                <div className="flex items-start gap-3 p-4">
                  <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-primary-purple)] text-white text-[10px] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {clip.category && (
                        <span className={['text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5', CATEGORY_COLORS[clip.category] ?? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'].join(' ')}>
                          {clip.category}
                        </span>
                      )}
                      {clip.startTime && clip.endTime && (
                        <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                          {clip.startTime} → {clip.endTime}
                        </span>
                      )}
                      {hasStyle && (
                        <span className="text-[10px] text-[var(--color-primary-purple)] font-semibold">
                          {styleLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--color-deep-plum)] line-clamp-2 leading-snug">
                      "{clip.caption_text ?? clip.quote}"
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => togglePin(clip.clip_id!)}
                      className={[
                        'transition-colors p-1',
                        isPinned
                          ? 'text-[var(--color-primary-purple)]'
                          : 'text-[var(--color-purple-gray)] hover:text-[var(--color-primary-purple)]',
                      ].join(' ')}
                      aria-label={isPinned ? 'Unpin clip' : 'Pin clip — keeps this when regenerating'}
                      title={isPinned ? 'Pinned — will not be replaced on regenerate' : 'Pin to keep on regenerate'}
                    >
                      {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedClipId(isExpanded ? null : (clip.clip_id ?? null))}
                      className="text-[var(--color-purple-gray)] hover:text-[var(--color-deep-plum)] transition-colors p-1"
                      aria-label={isExpanded ? 'Collapse' : 'Edit captions'}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {!isPinned && (
                      <button
                        type="button"
                        onClick={() => togglePick(clip)}
                        className="text-[var(--color-purple-gray)] hover:text-wm-danger transition-colors p-1"
                        aria-label="Remove clip"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline caption editor */}
                {isExpanded && (
                  <div className="border-t border-[var(--color-lavender)] px-4 pb-4 pt-3 space-y-4 bg-[var(--color-lavender-tint)]/30">

                    {/* Caption text */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Caption text
                      </label>
                      <textarea
                        rows={3}
                        value={clip.caption_text ?? clip.quote ?? ''}
                        onChange={e => updateClip(clip.clip_id!, { caption_text: e.target.value })}
                        className="w-full rounded-lg border border-[var(--color-lavender)] bg-white px-3 py-2 text-[12px] text-[var(--color-deep-plum)] font-mono focus:outline-none focus:border-[var(--color-primary-purple)] focus:ring-2 focus:ring-[var(--color-lavender)] resize-y"
                        placeholder="Edit the transcript text that will appear as captions on this reel…"
                      />
                    </div>

                    {/* Last week shortcut */}
                    {lastWeekSlug && (
                      <div className="flex items-center gap-2">
                        <Clock size={11} className="text-[var(--color-purple-gray)] shrink-0" />
                        <span className="text-[11px] text-[var(--color-purple-gray)]">
                          Last week: <span className="font-semibold text-[var(--color-deep-plum)]">{lastWeekLabel}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => applyLastWeekStyle(clip.clip_id!)}
                          className={[
                            'text-[10px] font-semibold px-2.5 py-0.5 rounded-full border transition-colors',
                            clip.caption_slug === lastWeekSlug
                              ? 'bg-[var(--color-primary-purple)] text-white border-[var(--color-primary-purple)]'
                              : 'border-[var(--color-lavender)] text-[var(--color-primary-purple)] hover:bg-[var(--color-lavender-tint)]',
                          ].join(' ')}
                        >
                          {clip.caption_slug === lastWeekSlug ? '✓ Applied' : 'Use same'}
                        </button>
                      </div>
                    )}

                    {/* Style picker */}
                    <div className="space-y-2.5">
                      <label className="block text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
                        Caption style
                      </label>
                      {GROUPS.map(group => {
                        const styles = CAPTION_STYLES.filter(s => s.group === group)
                        return (
                          <div key={group}>
                            <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]/60 mb-1.5">
                              {group}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {styles.map(style => {
                                const selected = clip.caption_slug === style.slug
                                return (
                                  <button
                                    key={style.slug}
                                    type="button"
                                    onClick={() => updateClip(clip.clip_id!, { caption_slug: style.slug })}
                                    className={[
                                      'text-[11px] px-3 py-1 rounded-full border transition-colors font-medium',
                                      selected
                                        ? 'bg-[var(--color-primary-purple)] text-white border-[var(--color-primary-purple)]'
                                        : 'border-[var(--color-lavender)] text-[var(--color-deep-plum)] hover:bg-[var(--color-lavender-tint)] bg-white',
                                    ].join(' ')}
                                  >
                                    {selected && <Check size={10} className="inline mr-1" strokeWidth={3} />}
                                    {style.label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Suggestions list */}
      {clipSuggestions.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)]">
            {clipSuggestions.length} suggestions — ranked by social potential · pick {reelCount}
          </p>
          <ul className="space-y-3">
            {clipSuggestions.map((c, i) => {
              const picked   = isPicked(c)
              const catColor = CATEGORY_COLORS[c.category ?? ''] ?? 'bg-[var(--color-lavender-tint)] text-[var(--color-deep-plum)]'
              return (
                <li key={`${i}-${c.quote?.slice(0, 40)}`}>
                  <div
                    className={[
                      'rounded-xl border overflow-hidden transition-colors',
                      picked
                        ? 'border-[var(--color-primary-purple)] bg-[var(--color-lavender-tint)]'
                        : 'border-[var(--color-lavender)] bg-white',
                    ].join(' ')}
                  >
                    {/* Clickable header row */}
                    <button
                      type="button"
                      onClick={() => togglePick(c)}
                      className="w-full text-left px-4 pt-3 pb-2 hover:bg-[var(--color-lavender-tint)]/40 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <span className={[
                          'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full mt-0.5',
                          picked
                            ? 'bg-[var(--color-primary-purple)] text-white'
                            : 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]',
                        ].join(' ')}>
                          {picked ? <Check size={11} strokeWidth={3} /> : <span className="text-[10px] font-bold">{i + 1}</span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            {c.category && (
                              <span className={['text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5', catColor].join(' ')}>
                                {c.category}
                              </span>
                            )}
                            {c.startTime && c.endTime && (
                              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                                {c.startTime} → {c.endTime}
                              </span>
                            )}
                            {typeof (c as any).duration === 'number' && (
                              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                                {(c as any).duration}s
                              </span>
                            )}
                            {typeof c.estimatedSeconds === 'number' && !(c as any).duration && (
                              <span className="text-[10px] font-mono text-[var(--color-purple-gray)]">
                                ≈ {c.estimatedSeconds}s
                              </span>
                            )}
                          </div>
                          {(c as any).clip_title && (
                            <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--color-purple-gray)] mb-1">
                              {(c as any).clip_title}
                            </p>
                          )}
                          <p className="text-[13px] text-[var(--color-deep-plum)] leading-snug">
                            "{c.quote}"
                          </p>
                        </div>
                      </div>
                    </button>

                    {/* AI insight pills */}
                    {((c as any).suggested_hook || (c as any).why_this_clip || (c as any).caption_angle) && (
                      <div className="px-4 pb-3 space-y-1.5 pl-13">
                        {(c as any).suggested_hook && (
                          <div className="flex items-start gap-1.5">
                            <Zap size={10} className="text-[var(--color-primary-purple)] mt-0.5 shrink-0" />
                            <p className="text-[11px] text-[var(--color-deep-plum)] font-semibold">
                              Hook: <span className="font-normal italic">"{(c as any).suggested_hook}"</span>
                            </p>
                          </div>
                        )}
                        {(c as any).why_this_clip && (
                          <div className="flex items-start gap-1.5">
                            <Lightbulb size={10} className="text-amber-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-[var(--color-purple-gray)]">{(c as any).why_this_clip}</p>
                          </div>
                        )}
                        {(c as any).caption_angle && (
                          <div className="flex items-start gap-1.5">
                            <MessageSquare size={10} className="text-[var(--color-purple-gray)] mt-0.5 shrink-0" />
                            <p className="text-[11px] text-[var(--color-purple-gray)] italic">{(c as any).caption_angle}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Video preview toggle */}
                    {videoUrl && c.startTime && (
                      <div className="px-4 pb-3">
                        <button
                          type="button"
                          onClick={() => {
                            const key = `${i}-${c.startTime}`
                            setPreviewKey(prev => prev === key ? null : key)
                          }}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-primary-purple)] hover:text-[var(--color-deep-plum)] transition-colors"
                        >
                          {previewKey === `${i}-${c.startTime}`
                            ? <><EyeOff size={11} /> Hide preview</>
                            : <><Play size={11} /> Preview clip</>
                          }
                        </button>
                        {previewKey === `${i}-${c.startTime}` && (
                          <div className="mt-2">
                            <ClipVideoPreview
                              videoUrl={videoUrl}
                              videoSourceType={videoSourceType}
                              startTime={c.startTime}
                              endTime={c.endTime}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <SrpButton variant="ghost" onClick={goToPrevStep} leadingIcon={<ArrowLeft size={14} />}>
          Back
        </SrpButton>
        <SrpButton
          disabled={!continueReady}
          onClick={goToNextStep}
          trailingIcon={<ArrowRight size={14} />}
        >
          {continueReady
            ? 'Continue'
            : clipSelections.length < reelCount
              ? `Continue (${clipSelections.length}/${reelCount} picked)`
              : 'Pick a style for each clip'}
        </SrpButton>
      </div>
    </div>
  )
}

function assignClipId(clip: SrpClipSelection, slotNumber: number): SrpClipSelection {
  return {
    ...clip,
    clip_id:      clip.clip_id ?? `clip_${slotNumber}_${Date.now().toString(36)}`,
    caption_text: clip.caption_text ?? clip.quote ?? '',
  }
}
