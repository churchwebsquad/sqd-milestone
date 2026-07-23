/**
 * Copies the caption bundle from the VidDrop repo into public/captions/.
 * Run this whenever VidDrop's caption styles change (assets/*.jsx), then
 * bump CAPTION_ASSETS_V in src/lib/captionEngine.ts to bust the browser cache.
 *
 * Usage: npm run build:captions
 *
 * VidDrop must be cloned as a sibling directory: ../viddrop
 * (or set VIDDROP_PATH env var to override)
 */

import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root      = join(__dirname, '..')

const viddropPath = process.env.VIDDROP_PATH ?? join(root, '..', 'viddrop')
const srcDir      = join(viddropPath, 'public', 'captions')
const destDir     = join(root, 'public', 'captions')

if (!existsSync(srcDir)) {
  console.error(`VidDrop captions source not found at: ${srcDir}`)
  console.error('Clone the viddrop repo as a sibling directory, or set VIDDROP_PATH.')
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

const files = ['captions-bundle.js', 'chunker.js', 'colors_and_type.css']
for (const f of files) {
  copyFileSync(join(srcDir, f), join(destDir, f))
  console.log(`  copied ${f}`)
}

// Copy fonts directory
const fontsDir = join(srcDir, 'fonts')
if (existsSync(fontsDir)) {
  cpSync(fontsDir, join(destDir, 'fonts'), { recursive: true })
  console.log('  copied fonts/')
}

console.log('\nDone. Remember to bump CAPTION_ASSETS_V in src/lib/captionEngine.ts to bust the browser cache.')
