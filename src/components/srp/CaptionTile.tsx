import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadCaptionEngine, getCaptionComponent } from '../../lib/captionEngine'
import type { CaptionStyleConfig } from '../../lib/captionEngine'
import type { CaptionStyleMeta } from '../../lib/captionStyles'

/**
 * One animated picker tile — renders the real caption component in mode="picker"
 * (260×462 reference frame), scaled to fill the grid cell. Mirrors VidDrop's
 * CaptionTile exactly so tiles animate word-by-word just like Duane's app.
 */
export function CaptionTile({
  meta,
  selected,
  onSelect,
  style,
  label,
}: {
  meta:     CaptionStyleMeta
  selected: boolean
  onSelect: () => void
  style?:   CaptionStyleConfig
  label?:   string
}) {
  const [ready, setReady]   = useState(false)
  const boxRef              = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW]     = useState(0)

  useEffect(() => {
    let alive = true
    loadCaptionEngine().then(() => alive && setReady(true)).catch(console.error)
    return () => { alive = false }
  }, [])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setBoxW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = boxW / 260
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Comp  = ready ? getCaptionComponent((meta as any).component ?? meta.slug) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'group relative flex flex-col rounded-xl overflow-hidden transition-all text-left',
        selected
          ? 'ring-2 ring-[var(--color-primary-purple)] ring-offset-2 border border-[var(--color-primary-purple)]'
          : 'border border-[var(--color-lavender)] hover:border-[var(--color-primary-purple)]/60',
      ].join(' ')}
    >
      {/* 9:16 frame */}
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden bg-[#0d0820]"
        style={{ aspectRatio: '9 / 16' }}
      >
        {Comp && boxW > 0 ? (
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 260, height: 462 }}>
            {React.createElement(Comp, { mode: 'picker', style })}
          </div>
        ) : (
          <div className="w-full h-full animate-pulse bg-[#1c1030]" />
        )}

        {selected && (
          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-[var(--color-primary-purple)] flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-white" />
          </div>
        )}
      </div>

      {/* Label */}
      <div className={[
        'px-2 py-1.5 text-[11px] font-semibold text-center w-full transition-colors',
        selected
          ? 'bg-[var(--color-lavender-tint)] text-[var(--color-primary-purple)]'
          : 'bg-white text-[var(--color-deep-plum)] group-hover:text-[var(--color-primary-purple)]',
      ].join(' ')}>
        {label ?? meta.label}
      </div>
    </button>
  )
}
