import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cacheInvalidate } from '../cache.ts'
import { fetchDatabase, patchDatabase } from '../notion.ts'
import { DOC_PROP } from '../parsers.ts'
import { DB } from './data-sources.ts'

interface MilestoneRow {
  step_name: string
}

interface CurrentOption {
  id?: string
  name: string
  color?: string
}

const INTERNAL_OPTIONS = [
  'Internal: Team Onboarding',
  'Internal: Partner Onboarding',
  'Internal: Offboarding',
] as const

/** Reconcile the Doc Hub `Workflow Step` multi-select with the milestone
 *  catalog. Three cohorts of options after reconcile:
 *
 *    - **Kept**:    catalog name that already existed in Notion (preserves
 *                   the option id so existing pages keep their tag intact)
 *    - **Added**:   catalog name not yet in Notion (Notion assigns a new id)
 *    - **Dropped**: existed in Notion but neither in the catalog nor the
 *                   internal-only list. We exclude these from the next
 *                   payload, which Notion will treat as a removal —
 *                   *unless* an option is currently used on a page, in
 *                   which case Notion rejects the whole PATCH. To keep
 *                   the call safe + deterministic, we *don't* attempt
 *                   removal here; instead we surface them to the caller
 *                   so a human can decide whether to retag manually.
 *
 *  Returns the lists so the caller can show "added X, kept Y, would-drop Z"
 *  feedback. */
export async function syncWorkflowStepOptions(): Promise<{
  added: string[]
  kept: string[]
  candidatesToDrop: string[]
  ok: true
}> {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !anon) throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY not configured for sync-workflow-step-options')
  const sb = createClient(url, anon)
  const { data, error } = await sb
    .from('strategy_milestone_definitions')
    .select('step_name')
    .eq('is_active', true)
  if (error) throw error

  const catalogNames = new Set<string>()
  for (const row of (data ?? []) as MilestoneRow[]) {
    if (row.step_name?.trim()) catalogNames.add(row.step_name.trim())
  }
  for (const n of INTERNAL_OPTIONS) catalogNames.add(n)
  const desired = [...catalogNames].sort((a, b) => a.localeCompare(b))

  const db = await fetchDatabase(DB.DOC_HUB)
  const wsProp = db.properties[DOC_PROP.WORKFLOW_STEP] as
    { type: 'multi_select'; multi_select: { options: CurrentOption[] } } | undefined
  if (!wsProp || wsProp.type !== 'multi_select') {
    throw new Error(`Doc Hub property "${DOC_PROP.WORKFLOW_STEP}" is not a multi_select.`)
  }

  const currentByName = new Map(wsProp.multi_select.options.map(o => [o.name, o]))
  const kept: string[] = []
  const added: string[] = []
  // Additive sync: include every existing option (so Notion doesn't try
  // to drop one that's in use, which fails the entire PATCH) AND every
  // catalog option that isn't there yet. The "candidatesToDrop" list is
  // returned so the caller can flag stale tags to a human operator —
  // dropping happens manually in Notion (or after pages are retagged)
  // because the API rejects deletion of in-use options.
  const newOptions: Array<{ id?: string; name: string; color?: string }> = []
  for (const opt of wsProp.multi_select.options) {
    newOptions.push({ id: opt.id, name: opt.name, color: opt.color })
    if (catalogNames.has(opt.name)) kept.push(opt.name)
  }
  for (const name of desired) {
    if (!currentByName.has(name)) {
      added.push(name)
      newOptions.push({ name })
    }
  }

  const candidatesToDrop = wsProp.multi_select.options
    .map(o => o.name)
    .filter(n => !catalogNames.has(n))

  await patchDatabase(DB.DOC_HUB, {
    properties: {
      [DOC_PROP.WORKFLOW_STEP]: { multi_select: { options: newOptions } },
    },
  })

  cacheInvalidate('docs:')
  return { added, kept, candidatesToDrop, ok: true }
}
