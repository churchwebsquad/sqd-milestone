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

  // Resolve from the project root. process.cwd() in Vercel functions
  // is the deployment root, which includes the committed cowork-skills/
  // directory.
  const filePath = path.resolve(process.cwd(), raw)
  const skillName = raw.split('/')[1] ?? 'skill'

  try {
    const body = await readFile(filePath, 'utf8')
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${skillName}.SKILL.md"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'read failed'
    return res.status(404).json({ error: 'not_found', detail: msg })
  }
}
