#!/usr/bin/env node
/**
 * typecheck-ratchet — TypeScript error baseline enforcer.
 *
 * The repo has a stock of pre-existing TS errors (Supabase typed-client
 * `never` issues, etc.) that the team agreed to fix incrementally rather
 * than all-at-once. This script enforces that the count can only go DOWN,
 * never UP.
 *
 * How it works:
 *   1. Run `tsc -b` and parse errors as { file → count }.
 *   2. Compare against scripts/typecheck-baseline.json.
 *   3. PASS if every file's current count <= baseline count.
 *   4. FAIL with a precise per-file diff if any file has more errors
 *      than its baseline (or a NEW file has any errors at all — new
 *      code is held to zero).
 *
 * Refreshing the baseline (after you've fixed some errors):
 *   node scripts/typecheck-ratchet.mjs --update
 *   Commit the new scripts/typecheck-baseline.json. CI never auto-updates;
 *   improvements have to be explicitly recorded so the floor moves.
 *
 * Exit codes: 0 = clean (or update succeeded). 1 = regression.
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = join(__dirname, 'typecheck-baseline.json')
const UPDATE_MODE = process.argv.includes('--update')

// Run tsc -b. It exits non-zero on errors but still prints them, so we
// capture either path. stdio piped so we can read both stdout + stderr.
let raw = ''
try {
  raw = execSync('npx tsc -b', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
} catch (e) {
  raw = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
}

// Parse: "src/foo/bar.ts(line,col): error TS1234: message"
const ERROR_LINE_RE = /^([^()]+?)\(\d+,\d+\): error TS\d+:/
const currentByFile = new Map()
for (const line of raw.split('\n')) {
  const m = ERROR_LINE_RE.exec(line)
  if (!m) continue
  const file = m[1].trim()
  currentByFile.set(file, (currentByFile.get(file) ?? 0) + 1)
}

const currentTotal = [...currentByFile.values()].reduce((a, b) => a + b, 0)

if (UPDATE_MODE) {
  const next = Object.fromEntries([...currentByFile.entries()].sort())
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n')
  console.log(`✅ Baseline updated. ${currentTotal} errors across ${currentByFile.size} files.`)
  console.log(`   Commit ${BASELINE_PATH} to record the new floor.`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`No baseline at ${BASELINE_PATH}.`)
  console.error(`Generate one: node scripts/typecheck-ratchet.mjs --update`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0)

// Compare current vs baseline.
const regressions = []
const improvements = []

for (const [file, count] of currentByFile) {
  const allowed = baseline[file] ?? 0
  if (count > allowed) regressions.push({ file, current: count, allowed })
  else if (count < allowed) improvements.push({ file, current: count, allowed })
}
for (const file of Object.keys(baseline)) {
  if (!currentByFile.has(file) && baseline[file] > 0) {
    improvements.push({ file, current: 0, allowed: baseline[file] })
  }
}

if (improvements.length > 0) {
  console.log(`✅ Improvements (${improvements.length} file${improvements.length === 1 ? '' : 's'}):`)
  for (const { file, current, allowed } of improvements) {
    console.log(`   ${file}: ${current} errors (was ${allowed}, ${allowed - current} fewer)`)
  }
  console.log(`   Run: node scripts/typecheck-ratchet.mjs --update — to bake these into the baseline.`)
  console.log('')
}

if (regressions.length > 0) {
  console.error(`❌ TypeScript ratchet failed — ${regressions.length} file${regressions.length === 1 ? '' : 's'} regressed:`)
  for (const { file, current, allowed } of regressions) {
    const delta = current - allowed
    console.error(`   ${file}: ${current} errors (baseline ${allowed}, +${delta} new)`)
  }
  console.error('')
  console.error(`Fix the new errors, or — if a regression is real and intentional — discuss before raising the baseline.`)
  console.error(`To see the actual error messages, run: npx tsc -b`)
  process.exit(1)
}

console.log(`✅ TypeScript ratchet passed. ${currentTotal} errors (baseline ${baselineTotal}).`)
