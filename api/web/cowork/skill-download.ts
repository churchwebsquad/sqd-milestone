/**
 * Vercel Serverless Function — /api/web/cowork/skill-download
 *
 * Streams a `SKILL.md` from `cowork-skills/<skill-name>/` back to the
 * browser with `Content-Disposition: attachment` so clicking the
 * Cowork-step "Download SKILL" button drops a file the strategist can
 * load into Claude Desktop, instead of opening the GitHub blob view.
 *
 *   GET /api/web/cowork/skill-download?path=cowork-skills/<name>/SKILL.md
 *   → 200 text/markdown  (Content-Disposition: attachment)
 *
 * Path validation: only `cowork-skills/<single-segment>/SKILL.md` is
 * accepted. Any traversal attempt (`..`, absolute paths, deeper
 * nesting) returns 400. The file must already exist.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const ALLOWED_PATTERN = /^cowork-skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const raw = typeof req.query.path === 'string' ? req.query.path : ''
  if (!ALLOWED_PATTERN.test(raw)) {
    return res.status(400).json({ error: 'invalid_path', detail: 'Path must be cowork-skills/<name>/SKILL.md' })
  }

  const stepNumberRaw = typeof req.query.step === 'string' ? req.query.step : ''

  // Resolve from the project root. process.cwd() in Vercel functions
  // is the deployment root, which includes the committed cowork-skills/
  // directory.
  const filePath = path.resolve(process.cwd(), raw)
  const skillName = raw.split('/')[1] ?? 'skill'

  try {
    const body = await readFile(filePath, 'utf8')
    // Self-identifying banner prepended to every served SKILL.md so the
    // strategist's Claude Desktop session reads the source of the file
    // unambiguously, even when the strategist has renamed it locally.
    // Prevents the "the file is named X but the contents look like Y"
    // confusion that bit Desert Springs (2026-06-15).
    const stepLabel = stepNumberRaw ? `Step ${stepNumberRaw} — ` : ''
    const banner =
      `<!-- AUTO-PREPENDED by skill-download endpoint. Source-of-truth: ${raw} -->\n` +
      `<!-- This file is a CHURCH MEDIA SQUAD cowork pipeline skill. NOT a milestone-comms doc. -->\n\n` +
      `> **Cowork pipeline skill — ${stepLabel}\`${skillName}\`**.\n` +
      `> Loaded into Claude Desktop by a strategist for the web-copy pipeline.\n` +
      `> Source: \`${raw}\` (sqd-milestone repo).\n\n` +
      `---\n\n`
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    const stepPrefix = stepNumberRaw ? `step-${String(stepNumberRaw).padStart(2, '0')}.` : ''
    res.setHeader('Content-Disposition', `attachment; filename="cowork-pipeline.${stepPrefix}${skillName}.SKILL.md"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(banner + body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'read failed'
    return res.status(404).json({ error: 'not_found', detail: msg })
  }
}
