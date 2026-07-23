/**
 * Caption engine loader — identical to VidDrop's engine.ts.
 * Loads public/captions/captions-bundle.js + chunker.js so components
 * self-register on window and can be rendered inside our React tree.
 */
import React from 'react'
import ReactDOM from 'react-dom'

export interface CaptionWord {
  word:  string
  start: number
  end:   number
}

export interface CaptionChunk {
  words:     CaptionWord[]
  showFrom:  number
  showUntil: number
}

export interface CaptionStyleConfig {
  fontFamily?:      string
  scale?:           number
  textColor?:       string
  highlightColor?:  string
  bgColor?:         string
  bgOpacity?:       number
  position?:        'top' | 'center' | 'bottom'
  offset?:          number
  textCase?:        'upper' | 'lower' | 'title' | 'as_typed'
  reverentCaps?:    boolean
  fontSizePx?:      number
  fontWeight?:      number
  letterSpacingEm?: number
  lineHeight?:      number
}

declare global {
  interface Window {
    React:           typeof React
    ReactDOM:        typeof ReactDOM
    chunkWords?:     (words: CaptionWord[], opts?: Record<string, unknown>) => CaptionChunk[]
    chunkAt?:        (chunks: CaptionChunk[], t: number) => CaptionChunk | null
    buildTimes?:     (words: CaptionWord[]) => Array<{ word: string; start: number; end: number; dur: number }>
    captionHiddenAt?:(t: number, times: unknown, maxHold?: number) => boolean
    applyTextCase?:  (words: CaptionWord[], mode?: string) => CaptionWord[]
    applySacredCaps?:(words: CaptionWord[]) => CaptionWord[]
    [key: string]:   unknown
  }
}

const CAPTION_ASSETS_V = '10'

let loadPromise: Promise<void> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-caption-src="${src}"]`) as HTMLScriptElement | null
    if (existing?.dataset.loaded === 'true') return resolve()
    const s = existing ?? document.createElement('script')
    s.src = src
    s.dataset.captionSrc = src
    s.onload  = () => { s.dataset.loaded = 'true'; resolve() }
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    if (!existing) document.head.appendChild(s)
  })
}

function injectCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel  = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

export function loadCaptionEngine(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    window.React    = React
    window.ReactDOM = ReactDOM
    injectCss(`/captions/colors_and_type.css?v=${CAPTION_ASSETS_V}`)
    await injectScript(`/captions/chunker.js?v=${CAPTION_ASSETS_V}`)
    await injectScript(`/captions/captions-bundle.js?v=${CAPTION_ASSETS_V}`)
    if (!window['Cap01_HormoziPill']) {
      throw new Error('caption bundle loaded but components not registered')
    }
  })().catch((e) => {
    loadPromise = null
    throw e
  })
  return loadPromise
}

export function getCaptionComponent(componentName: string): React.ComponentType<{
  t?:         number
  words?:     CaptionWord[]
  style?:     CaptionStyleConfig
  mode?:      'picker' | 'render'
  showFrom?:  number
  showUntil?: number
}> | null {
  const comp = window[componentName]
  return typeof comp === 'function' ? (comp as never) : null
}

export function chunkWords(words: CaptionWord[], opts?: { wordsPerSegment?: number }): CaptionChunk[] {
  if (!window.chunkWords) throw new Error('caption engine not loaded')
  return window.chunkWords(words, opts)
}

export function chunkAt(chunks: CaptionChunk[], t: number): CaptionChunk | null {
  if (!window.chunkAt) throw new Error('caption engine not loaded')
  return window.chunkAt(chunks, t)
}

export function captionHiddenAt(words: CaptionWord[], t: number, maxHold = 2): boolean {
  if (!window.buildTimes || !window.captionHiddenAt) return false
  return window.captionHiddenAt(t, window.buildTimes(words), maxHold)
}

export function applyTextCase(words: CaptionWord[], mode?: string): CaptionWord[] {
  if (!window.applyTextCase || !mode) return words
  return window.applyTextCase(words, mode)
}

export function applySacredCaps(words: CaptionWord[], on?: boolean): CaptionWord[] {
  if (!on || !window.applySacredCaps) return words
  return window.applySacredCaps(words)
}

/** Synthesize evenly-spaced word timings from text + duration (preview only). */
export function synthesizePreviewWords(text: string, durationSec: number): CaptionWord[] {
  const tokens = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (tokens.length === 0 || !Number.isFinite(durationSec) || durationSec <= 0) return []
  const per = durationSec / tokens.length
  return tokens.map((word, i) => ({
    word,
    start: +(i * per).toFixed(3),
    end:   +((i + 1) * per).toFixed(3),
  }))
}
