#!/usr/bin/env node
/**
 * lint-ratchet — ESLint error baseline enforcer.
 *
 * Same shape as typecheck-ratchet.mjs but for ESLint. We track ERRORS only
 * (severity 2). Warnings (severity 1) appear in eslint output but don't
 * count toward the ratchet — they're informational.
 *
 * How it works:
 *   1. Run `eslint . --format json`.
 *   2. Parse the JSON; count severity=2 messages per file.
 *   3. Compare against scripts/lint-baseline.json.
 *   4. PASS if every file's current error count <= baseline count.
 *   5. FAIL with a precise per-file diff if any file regressed.
 *
 * Refreshing the baseline (after you've fixed some errors):
 *   node scripts/lint-ratchet.mjs --update
 *   Then commit scripts/lint-baseline.json.
 *
 * Exit codes: 0 = clean (or update succeeded). 1 = regression.
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const BASELINE_PATH = join(__dirname, 'lint-baseline.json')
const UPDATE_MODE = process.argv.includes('--update')

let raw = ''
try {
  raw = execSync('npx eslint . --format json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
} catch (e) {
  // eslint exits 1 when there are errors; the JSON still prints on stdout.
  raw = e.stdout?.toString() ?? ''
  if (!raw) {
    console.error('eslint produced no output. stderr:')
    console.error(e.stderr?.toString() ?? '<empty>')
    process.exit(1)
  }
}

let results
try {
  results = JSON.parse(raw)
} catch (e) {
  console.error('Failed to parse eslint JSON output:', e.message)
  console.error(raw.slice(0, 500))
  process.exit(1)
}

const currentByFile = new Map()
for (const r of results) {
  const errorCount = (r.messages ?? []).filter(m => m.severity === 2).length
  if (errorCount === 0) continue
  // Normalize absolute paths to repo-relative.
  const relPath = relative(REPO_ROOT, r.filePath).split('\\').join('/')
  currentByFile.set(relPath, errorCount)
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
  console.error(`Generate one: node scripts/lint-ratchet.mjs --update`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0)

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
  console.log(`   Run: node scripts/lint-ratchet.mjs --update — to bake these into the baseline.`)
  console.log('')
}

if (regressions.length > 0) {
  console.error(`❌ ESLint ratchet failed — ${regressions.length} file${regressions.length === 1 ? '' : 's'} regressed:`)
  for (const { file, current, allowed } of regressions) {
    const delta = current - allowed
    console.error(`   ${file}: ${current} errors (baseline ${allowed}, +${delta} new)`)
  }
  console.error('')
  console.error(`Fix the new errors, or use eslint-disable comments only when justified.`)
  console.error(`To see the actual error messages, run: npm run lint`)
  process.exit(1)
}

console.log(`✅ ESLint ratchet passed. ${currentTotal} errors (baseline ${baselineTotal}).`)
