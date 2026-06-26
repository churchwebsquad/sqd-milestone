#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Thin wrapper around src/lib/acfFormationPlan/render.ts. Reads a
 * formation-plan JSON dumped by dump-formation-plan.ts, calls the
 * shared render functions, writes the markdown + content-import
 * sidecar next to the source JSON.
 *
 * The pure render code lives in the library so the DevHandoffWorkspace
 * UI uses byte-identical output.
 *
 * Usage:
 *   tsx scripts/translate-formation-plan.ts <path-to-json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import {
  buildContentImport,
  renderPlanAsMarkdown,
} from '../src/lib/acfFormationPlan/render'
import type { ContentModelPlan } from '../src/lib/acfFormationPlan/types'

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: tsx scripts/translate-formation-plan.ts <path-to-json>')
    process.exit(1)
  }
  const plan = JSON.parse(readFileSync(inputPath, 'utf8')) as ContentModelPlan
  const mdOutPath      = inputPath.replace(/\.json$/, '.md')
  const contentOutPath = inputPath.replace(/\.json$/, '.content-import.json')

  writeFileSync(mdOutPath,      renderPlanAsMarkdown(plan, { sourceHint: basename(inputPath) }))
  writeFileSync(contentOutPath, JSON.stringify(buildContentImport(plan), null, 2))
  console.log(`Wrote ${mdOutPath}`)
  console.log(`Wrote ${contentOutPath}`)
}

main()
