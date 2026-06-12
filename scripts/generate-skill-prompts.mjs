#!/usr/bin/env node
/**
 * Generate `src/lib/cowork/skillPrompts.generated.ts` from the
 * cowork-skills/*​/SKILL.md files (and each skill's declared
 * references).
 *
 * Why generate vs. inline at write time:
 *   1. The .md files are the source of truth that humans edit. Inlining
 *      the same prose into TS endpoint files creates two copies that
 *      will silently drift.
 *   2. Per-skill assembled prompt = SKILL.md body + concatenated
 *      reference files (canonical-templates.json, ministry-model
 *      patterns, storybrand-and-flow.md, audit-criteria.md, ...).
 *      Generating means an endpoint loads ONE constant and gets the
 *      complete prompt the skill was designed for.
 *   3. The generated module also emits each skill's `model` from
 *      frontmatter — endpoints never hardcode model strings, which
 *      kills the Opus-vs-Fable drift class of bugs.
 *   4. Per-skill content hash → into artifact _meta for provenance.
 *      A given output traces back to a specific prompt snapshot.
 *
 * Modes:
 *   node scripts/generate-skill-prompts.mjs           → write generated TS
 *   node scripts/generate-skill-prompts.mjs --check   → exit 1 if stale
 *
 * Frontmatter contract (SKILL.md YAML):
 *   name:        kebab-case skill id (matches directory name)
 *   description: free text (carried through for docs)
 *   model:       AI Gateway model id, e.g. 'anthropic/claude-opus-4-7'
 *   version:     skill semver
 *   references:  optional array of file paths relative to the SKILL.md
 *                file. Each file's content is appended to the system
 *                prompt with a clear delimiter.
 *
 * Output (src/lib/cowork/skillPrompts.generated.ts):
 *   export const COWORK_SKILL_NAMES = […] as const
 *   export type CoworkSkillName = typeof COWORK_SKILL_NAMES[number]
 *   export interface CoworkSkillBundle {
 *     name: CoworkSkillName
 *     model: string
 *     version: string
 *     systemPrompt: string
 *     contentHash: string         // sha256, first 16 hex chars
 *     references: string[]        // paths relative to repo root
 *   }
 *   export const COWORK_SKILL_BUNDLES: Record<CoworkSkillName, CoworkSkillBundle>
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const SKILLS_DIR = join(REPO_ROOT, 'cowork-skills')
const OUTPUT_FILE = join(REPO_ROOT, 'src', 'lib', 'cowork', 'skillPrompts.generated.ts')

const CHECK_ONLY = process.argv.includes('--check')

/** Minimal YAML frontmatter parser — handles the small subset our
 *  SKILL.md files use: top-level scalar fields + a `references:` block
 *  list. Doesn't try to be js-yaml; deliberate. */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return { frontmatter: {}, body: raw }
  const yamlText = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const fm = {}
  const lines = yamlText.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue }
    // block list: `key:` then `- value` lines
    const blockListMatch = line.match(/^([a-zA-Z_][\w-]*):\s*$/)
    if (blockListMatch) {
      const key = blockListMatch[1]
      const list = []
      i++
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        list.push(lines[i].replace(/^\s+-\s+/, '').trim())
        i++
      }
      fm[key] = list
      continue
    }
    // block scalar: `key: |` then indented lines
    const blockScalarMatch = line.match(/^([a-zA-Z_][\w-]*):\s*\|\s*$/)
    if (blockScalarMatch) {
      const key = blockScalarMatch[1]
      const buf = []
      i++
      while (i < lines.length && /^\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s\s/, ''))
        i++
      }
      fm[key] = buf.join('\n').trim()
      continue
    }
    // inline: `key: value`
    const inlineMatch = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/)
    if (inlineMatch) {
      const [, key, rawVal] = inlineMatch
      const v = rawVal.trim().replace(/^['"]|['"]$/g, '')
      fm[key] = v
      i++
      continue
    }
    i++
  }
  return { frontmatter: fm, body }
}

function sha256Short(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

function toIdentifier(skillName) {
  // 'outline-page' → 'outline_page'
  return skillName.replace(/-/g, '_')
}

const skills = []

for (const entry of readdirSync(SKILLS_DIR)) {
  const skillDir = join(SKILLS_DIR, entry)
  let dirStat
  try { dirStat = statSync(skillDir) } catch { continue }
  if (!dirStat.isDirectory()) continue
  const skillFile = join(skillDir, 'SKILL.md')
  if (!existsSync(skillFile)) continue

  const raw = readFileSync(skillFile, 'utf8')
  const { frontmatter, body } = parseFrontmatter(raw)
  if (!frontmatter.name) {
    console.warn(`skip: ${entry}/SKILL.md has no 'name' in frontmatter`)
    continue
  }
  if (frontmatter.name !== entry) {
    console.warn(`warning: ${entry}/SKILL.md name '${frontmatter.name}' differs from directory '${entry}'`)
  }
  if (!frontmatter.model) {
    console.warn(`warning: ${entry}/SKILL.md has no 'model' — endpoint will have to specify`)
  }

  // Assemble prompt: SKILL.md body + each reference file with a
  // delimiter that the model can use to navigate the bundle.
  const parts = [body.trim()]
  const referencePathsAbs = []
  const referencesList = Array.isArray(frontmatter.references) ? frontmatter.references : []
  for (const ref of referencesList) {
    const refPath = resolve(skillDir, ref)
    if (!existsSync(refPath)) {
      console.warn(`warning: ${entry}/SKILL.md references missing file ${ref} (resolved: ${refPath})`)
      continue
    }
    const refRel = relative(REPO_ROOT, refPath)
    referencePathsAbs.push(refRel)
    const refRaw = readFileSync(refPath, 'utf8')
    const delim = `\n\n---\n\n## Reference: ${refRel}\n\n`
    parts.push(delim + refRaw.trim())
  }

  const systemPrompt = parts.join('').trim() + '\n'
  const contentHash  = sha256Short(systemPrompt)

  skills.push({
    name:         frontmatter.name,
    identifier:   toIdentifier(frontmatter.name),
    model:        frontmatter.model ?? '',
    version:      frontmatter.version ?? '0.0.0',
    references:   referencePathsAbs,
    systemPrompt,
    contentHash,
  })
}

// Stable ordering: directory-name alpha.
skills.sort((a, b) => a.name.localeCompare(b.name))

if (skills.length === 0) {
  console.error('no SKILL.md files found under cowork-skills/*/')
  process.exit(1)
}

// Build the TS module text.
const header = `/* eslint-disable */
// =========================================================================
//                        AUTO-GENERATED FILE — DO NOT EDIT
//
// Source: cowork-skills/<skill>/SKILL.md + each skill's declared
// references in frontmatter.
//
// Regenerate:    npm run check:skill-prompts:write
// Verify:        npm run check:skill-prompts        (exits 1 on drift)
//
// Drift policy: CI runs check:skill-prompts. An edited .md file with a
// stale bundle fails the check; run :write to refresh + commit.
// =========================================================================
`

const namesArr = skills.map(s => `  '${s.name}'`).join(',\n')
const bundlesEntries = skills.map(s => {
  // Embed the system prompt as a backtick template literal. Escape
  // backticks + backslashes + ${ to keep template-literal contents safe.
  const escaped = s.systemPrompt
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
  const refsArr = s.references.length === 0
    ? '[]'
    : '[\n      ' + s.references.map(r => `'${r}'`).join(',\n      ') + ',\n    ]'
  return `  '${s.name}': {
    name:         '${s.name}',
    model:        '${s.model}',
    version:      '${s.version}',
    contentHash:  '${s.contentHash}',
    references:   ${refsArr},
    systemPrompt: \`${escaped}\`,
  }`
}).join(',\n')

const moduleText = `${header}
export const COWORK_SKILL_NAMES = [
${namesArr},
] as const

export type CoworkSkillName = typeof COWORK_SKILL_NAMES[number]

export interface CoworkSkillBundle {
  /** kebab-case name; matches the directory under cowork-skills/. */
  name:         CoworkSkillName
  /** AI Gateway model identifier (e.g. 'anthropic/claude-opus-4-7'). */
  model:        string
  /** Skill semver from frontmatter. */
  version:      string
  /** First 16 hex chars of sha256(systemPrompt). Stamp into artifact
   *  _meta so each output is traceable to a specific prompt snapshot. */
  contentHash:  string
  /** Reference files concatenated into systemPrompt (repo-relative). */
  references:   string[]
  /** Fully assembled system prompt — SKILL.md body + every reference. */
  systemPrompt: string
}

export const COWORK_SKILL_BUNDLES: Record<CoworkSkillName, CoworkSkillBundle> = {
${bundlesEntries},
}

export function getCoworkSkill(name: CoworkSkillName): CoworkSkillBundle {
  const bundle = COWORK_SKILL_BUNDLES[name]
  if (!bundle) throw new Error(\`Unknown cowork skill: \${name}\`)
  return bundle
}
`

if (CHECK_ONLY) {
  if (!existsSync(OUTPUT_FILE)) {
    console.error(`✗ skill-prompts drift: generated bundle missing (${relative(REPO_ROOT, OUTPUT_FILE)})`)
    console.error('  run: npm run check:skill-prompts:write')
    process.exit(1)
  }
  const existing = readFileSync(OUTPUT_FILE, 'utf8')
  if (existing !== moduleText) {
    console.error(`✗ skill-prompts drift: ${relative(REPO_ROOT, OUTPUT_FILE)} is stale relative to cowork-skills/*​/SKILL.md`)
    console.error('  run: npm run check:skill-prompts:write')
    // Show a brief diff hint
    const oldSkills = (existing.match(/contentHash:\s+'([0-9a-f]{16})'/g) ?? []).map(m => m.slice(17, 33))
    const newSkills = skills.map(s => s.contentHash)
    const changed = []
    for (let i = 0; i < Math.max(oldSkills.length, newSkills.length); i++) {
      if (oldSkills[i] !== newSkills[i]) changed.push(skills[i]?.name ?? `(missing@${i})`)
    }
    if (changed.length) console.error(`  changed: ${changed.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ skill-prompts: ${skills.length} skills in sync`)
  process.exit(0)
}

writeFileSync(OUTPUT_FILE, moduleText, 'utf8')
console.log(`✓ wrote ${relative(REPO_ROOT, OUTPUT_FILE)} (${skills.length} skills, ${moduleText.length.toLocaleString()} bytes)`)
for (const s of skills) {
  const refCount = s.references.length
  console.log(`  · ${s.name.padEnd(28)} ${s.model.padEnd(32)} ${s.contentHash}  refs=${refCount}`)
}
