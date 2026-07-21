import { useEffect, useRef } from 'react'

interface SkipRange { from: number; to: number }

interface Props {
  src: string
  startSec: number | null
  endSec: number | null
  nonce: number
  skipRanges?: SkipRange[]
  tailBufferSec?: number
  onTimeUpdate?: (currentSec: number) => void
}

export function DirectClipLoopPlayer({ src, startSec, endSec, nonce, skipRanges, tailBufferSec = 1.0, onTimeUpdate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (startSec === null) { try { video.pause() } catch { /* ignore */ }; return }
    const skips = (skipRanges || []).slice().sort((a, b) => a.from - b.from)
    const startInSkip = skips.find((s) => startSec >= s.from && startSec < s.to)
    const effectiveStart = startInSkip ? startInSkip.to : startSec
    const seekAndPlay = () => {
      try {
        video.currentTime = effectiveStart
        const p = video.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch { /* ignore */ }
    }
    if (video.readyState >= 1) {
      seekAndPlay()
    } else {
      const onLoaded = () => { seekAndPlay(); video.removeEventListener('loadedmetadata', onLoaded) }
      video.addEventListener('loadedmetadata', onLoaded)
      const t = setTimeout(seekAndPlay, 800)
      return () => { clearTimeout(t); video.removeEventListener('loadedmetadata', onLoaded) }
    }
    const onTime = () => {
      const t = video.currentTime
      if (onTimeUpdate) onTimeUpdate(t)
      const inSkip = skips.find((s) => t >= s.from && t < s.to)
      if (inSkip) { video.currentTime = inSkip.to; return }
      if (endSec !== null && endSec > startSec && t >= endSec + tailBufferSec) {
        video.currentTime = startSec
        const p = video.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      }
    }
    const onEnded = () => {
      if (startSec !== null) {
        video.currentTime = startSec
        const p = video.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      }
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, endSec, nonce, skipRanges, tailBufferSec, onTimeUpdate])

  return <video ref={videoRef} src={src} controls preload="metadata" playsInline className="w-full h-full object-contain bg-black" />
}
