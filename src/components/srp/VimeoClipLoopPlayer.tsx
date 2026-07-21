import { useEffect, useRef } from 'react'
import Player from '@vimeo/player'

interface SkipRange { from: number; to: number }

interface Props {
  vimeoId: string
  startSec: number | null
  endSec: number | null
  nonce: number
  skipRanges?: SkipRange[]
  tailBufferSec?: number
  onTimeUpdate?: (currentSec: number) => void
}

export function VimeoClipLoopPlayer({ vimeoId, startSec, endSec, nonce, skipRanges, tailBufferSec = 1.0, onTimeUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const targetsRef = useRef<{ start: number | null; end: number | null; skips: SkipRange[]; tailBuffer: number; onTime?: (s: number) => void }>({
    start: null, end: null, skips: [], tailBuffer: 1.0,
  })

  useEffect(() => {
    if (!containerRef.current) return
    const player = new Player(containerRef.current, { id: Number(vimeoId), responsive: true, controls: true, autoplay: false })
    playerRef.current = player
    const onPlayerTime = ({ seconds }: { seconds: number }) => {
      const t = seconds
      const { start, end, skips, tailBuffer, onTime } = targetsRef.current
      if (onTime) onTime(t)
      if (start === null) return
      const inSkip = skips.find((s) => t >= s.from && t < s.to)
      if (inSkip) { player.setCurrentTime(inSkip.to).catch(() => {}); return }
      if (end !== null && end > start && t >= end + tailBuffer) {
        player.setCurrentTime(start).then(() => player.play()).catch(() => {})
      }
    }
    const onEnded = () => {
      const { start } = targetsRef.current
      if (start !== null) player.setCurrentTime(start).then(() => player.play()).catch(() => {})
    }
    player.on('timeupdate', onPlayerTime)
    player.on('ended', onEnded)
    return () => {
      try { player.off('timeupdate', onPlayerTime) } catch { /* ignore */ }
      try { player.off('ended', onEnded) } catch { /* ignore */ }
      try { player.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const player = playerRef.current
    const skips = (skipRanges || []).slice().sort((a, b) => a.from - b.from)
    targetsRef.current = { start: startSec, end: endSec, skips, tailBuffer: tailBufferSec, onTime: onTimeUpdate }
    if (!player) return
    if (startSec === null) { player.pause().catch(() => {}); return }
    const startInSkip = skips.find((s) => startSec >= s.from && startSec < s.to)
    const effectiveStart = startInSkip ? startInSkip.to : startSec
    player.setCurrentTime(effectiveStart).then(() => player.play()).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, endSec, nonce, skipRanges, tailBufferSec, onTimeUpdate])

  return <div ref={containerRef} className="w-full h-full" />
}
