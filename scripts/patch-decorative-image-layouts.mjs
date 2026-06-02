// One-off: patch source_html for Brixies templates whose decorative
// image clusters render incorrectly because the canonical Webflow
// CSS provided height/positioning we don't have access to (we only
// have inline styles).
//
// CTA 52 + Hero 44 are the canonical failures:
//
//   • CTA 52's `Image list` parent has 6 absolute-positioned imgs
//     but no explicit height. In a column-flex parent it collapses
//     to 0px and the next sibling (Container info) renders BEHIND
//     the imgs. We add min-height so it reserves the right space.
//
//   • Hero 44's 3 imgs are flex children of a column-flex Container.
//     The Brixies design has them HORIZONTALLY fanned via class CSS
//     we don't have. Wrap the 3 imgs in an absolute-positioned
//     horizontal flex container so they sit side-by-side instead of
//     stacking vertically. Each img keeps its own rotation transform.
//
// Idempotent — checks for the patch marker before re-applying.
//
// Usage:
//   node scripts/patch-decorative-image-layouts.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
      if (!m) continue
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

loadEnv()

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

// ── CTA 52: give Image list a min-height so absolute imgs reserve space ─

async function patchCta52() {
  const { data, error } = await supabase
    .from('web_content_templates')
    .select('id, source_html')
    .eq('layer_name', 'CTA Section 52')
    .single()
  if (error) { console.error('CTA 52 fetch:', error.message); return false }
  let html = data.source_html
  const MARKER = '/* mcms:image-list-min-height */'
  if (html.includes(MARKER)) { console.log('CTA 52 already patched'); return true }

  // Image list height = max(child height + |min_top|). Tallest img is
  // 146.67px tall, min top is -3.66, max top is +4.02 — total vertical
  // reach ~155px. Add 10px breathing room.
  html = html.replace(
    /(data-layer="Image list"[\s\S]*?style=")([^"]*?)(")/,
    (_m, pre, style, post) => {
      const cleaned = style.replace(/;\s*$/, '')
      return `${pre}${cleaned}; min-height: 165px; ${MARKER}${post}`
    },
  )

  const { error: updErr } = await supabase
    .from('web_content_templates')
    .update({ source_html: html })
    .eq('id', data.id)
  if (updErr) { console.error('CTA 52 update:', updErr.message); return false }
  console.log('CTA 52 patched (min-height on Image list)')
  return true
}

// ── Hero 44: wrap 3 imgs in a horizontal absolute container ────────────

async function patchHero44() {
  const { data, error } = await supabase
    .from('web_content_templates')
    .select('id, source_html')
    .eq('layer_name', 'Hero Section 44')
    .single()
  if (error) { console.error('Hero 44 fetch:', error.message); return false }
  let html = data.source_html
  const MARKER = '<!-- mcms:image-fan-wrapper -->'
  if (html.includes(MARKER)) { console.log('Hero 44 already patched'); return true }

  // Replace the 3 standalone `<img data-layer="Image">` siblings with a
  // wrapper that lays them out horizontally with overlap. Each img
  // keeps its own transform style for the rotation effect.
  //
  // Match the 3 sequential <img data-layer="Image"> blocks (whitespace
  // between them is intentional from the canonical export). We splice
  // in a single wrapper.
  const imgRe = /<img\s+[^>]*?data-layer="Image"[^>]*?>/g
  const imgMatches = [...html.matchAll(imgRe)]
  if (imgMatches.length < 3) {
    console.log(`Hero 44 has ${imgMatches.length} imgs, expected 3 — skipping`)
    return false
  }

  // Rewrite each img: replace its inline `transform: rotate(...)` style
  // with a placement that fans them. Drop transform-origin: top left
  // (it shifts the rotated bbox unpredictably under absolute placement).
  const fanned = imgMatches.slice(0, 3).map((m, i) => {
    // Center img i with horizontal offset and rotation. Tilted left/
    // right/center mirrors the Brixies canonical fan.
    const left = i === 0 ? '-30%' : i === 1 ? '0%' : '30%'
    const rotate = i === 0 ? '-12deg' : i === 1 ? '0deg' : '12deg'
    const zIndex = i === 1 ? 2 : 1
    const translate = i === 1 ? 'translateY(-10px)' : 'translateY(10px)'
    return `<img data-layer="Image" class="Image" style="width: 280px; height: 374px; position: absolute; left: 50%; top: 0; transform: translateX(calc(-50% + ${left})) ${translate} rotate(${rotate}); border-radius: 8px; border: 1px solid rgba(22,22,22,0.1); z-index: ${zIndex};" src="https://placehold.co/280x374">`
  }).join('\n      ')

  // Replace the original 3 imgs (and the whitespace between them) with
  // the wrapper. Slice from the FIRST img start to AFTER the LAST img.
  const firstStart = imgMatches[0].index
  const last = imgMatches[2]
  const lastEnd = last.index + last[0].length

  const wrapper =
    `<div data-layer="Image fan" style="position: relative; width: 100%; max-width: 900px; height: 420px; display: block;"> ${MARKER}\n      ${fanned}\n    </div>`

  html = html.slice(0, firstStart) + wrapper + html.slice(lastEnd)

  const { error: updErr } = await supabase
    .from('web_content_templates')
    .update({ source_html: html })
    .eq('id', data.id)
  if (updErr) { console.error('Hero 44 update:', updErr.message); return false }
  console.log('Hero 44 patched (3 imgs wrapped in horizontal fan container)')
  return true
}

await patchCta52()
await patchHero44()
