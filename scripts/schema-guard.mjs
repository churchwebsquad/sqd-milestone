#!/usr/bin/env node
/**
 * schema-guard — the automated "no new tables" gate.
 *
 * Inspects the ADDED lines of any changed `.sql` file under `/schema/` in this
 * PR and FAILS the check if it finds a structural change a director isn't
 * allowed to make on their own:
 *   - CREATE TABLE         → must go through a "Request a table" issue + Ashley
 *   - DROP TABLE           → destructive, Ashley only
 *   - ALTER TABLE ... DROP COLUMN → destructive, Ashley only
 *
 * ALTER TABLE ... ADD COLUMN is explicitly ALLOWED — that's the one schema
 * change directors can ship via a reviewed migration file.
 *
 * It only looks at *added* lines (diff `+`), so existing CREATE TABLE
 * statements already in the repo don't trip it — only newly introduced ones.
 *
 * Base ref resolution (first that works):
 *   1. $SCHEMA_GUARD_BASE  (manual override)
 *   2. origin/$GITHUB_BASE_REF  (GitHub Actions PR context)
 *   3. origin/main
 *
 * Exit 0 = clean, exit 1 = violation found.
 */

import { execSync } from 'node:child_process'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

function resolveBase() {
  if (process.env.SCHEMA_GUARD_BASE) return process.env.SCHEMA_GUARD_BASE
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`
  return 'origin/main'
}

const base = resolveBase()

// Merge-base diff so we only see what THIS branch added, not unrelated commits
// that landed on the base after we branched. We diff the whole `schema`
// directory (a literal pathspec — no shell glob to expand) and filter to
// `.sql` files while parsing, which sidesteps glob/quoting surprises.
let diff
try {
  diff = sh(`git diff --unified=0 ${base}...HEAD -- schema`)
} catch {
  // Fallback for shallow clones / detached states where the triple-dot ref
  // isn't available: diff against the base tip directly.
  diff = sh(`git diff --unified=0 ${base} -- schema`)
}

if (!diff) {
  console.log('schema-guard: no changed SQL files under /schema/ — clean.')
  process.exit(0)
}

// Rules: [label, regex]. Tested against each ADDED line, whitespace-collapsed.
const BLOCKED = [
  ['CREATE TABLE (new table — open a "Request a table" issue)', /\bcreate\s+table\b/i],
  ['DROP TABLE (destructive — Ashley only)', /\bdrop\s+table\b/i],
  ['ALTER TABLE ... DROP COLUMN (destructive — Ashley only)', /\balter\s+table\b.*\bdrop\s+column\b/i],
]

const violations = []
let currentFile = null

for (const raw of diff.split('\n')) {
  // Track which file we're in via the diff header.
  const fileMatch = raw.match(/^\+\+\+ b\/(.+)$/)
  if (fileMatch) {
    currentFile = fileMatch[1]
    continue
  }
  // Only inspect added lines inside .sql files.
  if (!currentFile || !currentFile.endsWith('.sql')) continue
  // Only added lines (start with a single '+', not the '+++' header).
  if (!raw.startsWith('+') || raw.startsWith('+++')) continue

  const line = raw.slice(1).replace(/\s+/g, ' ').trim()
  if (!line || line.startsWith('--')) continue // skip blanks + SQL comments

  for (const [label, re] of BLOCKED) {
    if (re.test(line)) {
      violations.push({ file: currentFile, label, line: line.slice(0, 120) })
    }
  }
}

if (violations.length === 0) {
  console.log('schema-guard: schema changes are additive/safe — clean. ✅')
  process.exit(0)
}

console.error('\n❌ schema-guard found schema changes that need Ashley:\n')
for (const v of violations) {
  console.error(`  ${v.file}`)
  console.error(`    ↳ ${v.label}`)
  console.error(`    ↳ ${v.line}\n`)
}
console.error(
  'Directors may only ADD COLUMNs via a /schema migration. For a new table,\n' +
  'open a "Request a table" issue so Ashley can create it. See\n' +
  'docs/collab-governance-gameplan.md §3.6.\n',
)
process.exit(1)
