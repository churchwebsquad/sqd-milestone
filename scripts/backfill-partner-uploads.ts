/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off backfill — process every existing partner-upload attachment
 * through the ingest-partner-upload edge function.
 *
 * Run with:
 *   npx tsx scripts/backfill-partner-uploads.ts
 *
 * Reads attachments with parsed_at IS NULL (or --force to re-process
 * all), fires the API endpoint serially, and writes a summary at the
 * end. Existing partner uploads (e.g. partner 3249's small_groups CSV)
 * surface as parsed rows without needing a re-upload.
 */
/* eslint-disable no-console */
// @ts-ignore TS2882 — dotenv types not in this tsconfig
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE_URL        = process.env.INGEST_BASE_URL || 'https://strategy.thesqd.com'
const INGEST_TOKEN    = process.env.INGEST_AUTH_TOKEN

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!INGEST_TOKEN) {
  console.error('Missing INGEST_AUTH_TOKEN — set it in .env to match the server-side env var.')
  process.exit(1)
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const retryFailed = args.includes('--retry-failed')

async function main() {
  const sb = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })

  let query = sb
    .from('strategy_content_collection_attachments')
    .select('id, file_name, mime_type, target_path, parsed_at, parsed_destination, parse_error')
    .order('uploaded_at', { ascending: true })
    .limit(2000)
  if (force) {
    // process every row regardless
  } else if (retryFailed) {
    // pick up rows that never ran OR previously errored
    query = query.or('parsed_at.is.null,parse_error.not.is.null')
  } else {
    query = query.is('parsed_at', null)
  }

  const { data, error } = await query
  if (error) {
    console.error('Load failed:', error.message)
    process.exit(1)
  }
  const rows = (data ?? []) as Array<{
    id: string; file_name: string; mime_type: string | null;
    target_path: string | null; parsed_at: string | null;
    parsed_destination: string | null; parse_error: string | null;
  }>
  console.log(`Found ${rows.length} attachments ${force ? '(force=true, ALL)' : '(parsed_at is null)'}`)
  if (rows.length === 0) {
    console.log('Nothing to backfill.')
    return
  }
  if (dryRun) {
    for (const r of rows) {
      console.log(`  [dry] ${r.id}  ${r.file_name}  (${r.mime_type ?? '?'})  target=${r.target_path ?? '—'}`)
    }
    return
  }

  const tally = { parsed: 0, pending: 0, failed: 0, unsupported: 0, rejected: 0, skipped: 0 }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    process.stdout.write(`  [${i + 1}/${rows.length}] ${r.file_name.slice(0, 50).padEnd(50)} → `)
    try {
      const resp = await fetch(`${BASE_URL}/api/web/cowork/ingest-partner-upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingest-token': INGEST_TOKEN!,
        },
        body: JSON.stringify({ attachment_id: r.id, force }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        console.log(`FAIL ${resp.status} ${JSON.stringify(body).slice(0, 80)}`)
        tally.failed++
        continue
      }
      if (body.skipped) {
        console.log('skip (already parsed)')
        tally.skipped++
        continue
      }
      const dest = body.destination as string
      if (dest === 'church_facts' || dest === 'content_atoms') {
        console.log(`parsed → ${dest} · ${body.inserted_count} rows`)
        tally.parsed++
      } else {
        console.log(`${dest ?? 'unknown'}`)
        if (dest === 'unsupported') tally.unsupported++
        else if (dest === 'failed') tally.failed++
        else tally.rejected++
      }
    } catch (e) {
      console.log('error', e instanceof Error ? e.message : String(e))
      tally.failed++
    }
    // Be polite to the API + gateway.
    await new Promise(r => setTimeout(r, 250))
  }

  console.log()
  console.log('Summary:', tally)
}

main().catch(e => {
  console.error('Backfill crashed:', e)
  process.exit(1)
})
