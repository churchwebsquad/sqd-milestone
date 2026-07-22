import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT: any
    onYouTubeIframeAPIReady: () => void
  }
}

interface SkipRange { from: number; to: number }

interface Props {
  videoId: string
  startSec: number | null
  endSec: number | null
  nonce: number
  muted?: boolean
  skipRanges?: SkipRange[]
  tailBufferSec?: number
  onTimeUpdate?: (currentSec: number) => void
}

let ytApiPromise: Promise<typeof window.YT> | null = null
function loadYouTubeApi(): Promise<typeof window.YT> {
  if (typeof window === 'undefined') return Promise.reject('no window')
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    const first = document.getElementsByTagName('script')[0]
    first.parentNode?.insertBefore(tag, first)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev()
      resolve(window.YT)
    }
  })
  return ytApiPromise
}

interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
  getCurrentTime: () => number
  destroy: () => void
}

export function ClipLoopPlayer({ videoId, startSec, endSec, nonce, skipRanges, tailBufferSec = 1.0, onTimeUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const targetsRef = useRef<{ start: number | null; end: number | null; nonce: number; skips: SkipRange[]; tailBuffer: number; onTime?: (s: number) => void }>({
    start: null, end: null, nonce: -1, skips: [], tailBuffer: 1.0,
  })

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return
      const host = document.createElement('div')
      containerRef.current.appendChild(host)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playerRef.current = new (YT as any).Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 0, rel: 0, modestbranding: 1, enablejsapi: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            if (e.data === 0 && targetsRef.current.start !== null) {
              playerRef.current?.seekTo?.(targetsRef.current.start, true)
              playerRef.current?.playVideo?.()
            }
          },
        },
      })
    })
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
      try { playerRef.current?.destroy?.() } catch { /* ignore */ }
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const player = playerRef.current
    const skips = (skipRanges || []).slice().sort((a, b) => a.from - b.from)
    targetsRef.current = { start: startSec, end: endSec, nonce, skips, tailBuffer: tailBufferSec, onTime: onTimeUpdate }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (!player) return
    if (startSec === null) { try { player.pauseVideo?.() } catch { /* ignore */ }; return }
    const startInSkip = skips.find((s) => startSec >= s.from && startSec < s.to)
    const effectiveStart = startInSkip ? startInSkip.to : startSec
    const seekAndPlay = () => {
      try { player.seekTo?.(effectiveStart, true); player.playVideo?.() } catch { /* ignore */ }
    }
    if (typeof player.seekTo === 'function') { seekAndPlay() }
    else { const t = setTimeout(seekAndPlay, 600); return () => clearTimeout(t) }
    intervalRef.current = setInterval(() => {
      try {
        const t = player.getCurrentTime?.() ?? 0
        if (onTimeUpdate) onTimeUpdate(t)
        const inSkip = skips.find((s) => t >= s.from && t < s.to)
        if (inSkip) { player.seekTo(inSkip.to, true); return }
        if (endSec !== null && endSec > startSec && t >= endSec + tailBufferSec) {
          player.seekTo(startSec, true); player.playVideo()
        }
      } catch { /* ignore */ }
    }, 250)
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, endSec, nonce, skipRanges, tailBufferSec, onTimeUpdate])

  return <div ref={containerRef} className="w-full h-full" />
}
