/**
 * Vercel Serverless Function — /api/web/agents/inventory-readiness
 *
 * Loads a project's full intake inventory from Supabase and runs the
 * P5 inventory readiness gate (src/lib/cowork/inventoryReadiness.ts).
 *
 * The workspace UI calls this BEFORE letting the strategist launch
 * cowork on the project. Blockers force a human ack/fix; warnings
 * surface for review but don't gate the launch.
 *
 *   POST { project_id }
 *   → 200 InventoryReadinessReport
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import {
  buildInventoryReadinessReport,
  type InventoryReadinessInput,
} from '../../../src/lib/cowork/inventoryReadiness.js'

export const maxDuration = 30

const PASSAGE_SAMPLE_BYTES = 10_000   // pass this much per topic to the noise scanner

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  if (!projectId) return res.status(400).json({ error: 'project_id required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // Pull the project inventory in parallel. Cheaper than four sequential round-trips.
  const [pillarsRes, factsRes, topicsRes, ccRes] = await Promise.all([
    sb.from('content_atoms')
      // duplicate_of dropped from select 2026-06-13 — the column was
      // referenced in anticipation of a dedup feature that never landed
      // (no downstream reader). Re-add when content_atoms gains the
      // column AND a dedup writer populates it.
      .select('id, topic, body, status, source_kind, source_ref, verbatim')
      .eq('web_project_id', projectId),
    sb.from('church_facts')
      // metadata dropped from select 2026-06-13 — same dead-reference
      // pattern as duplicate_of on content_atoms above. Column doesn't
      // exist on the live schema; nothing in this endpoint reads it.
      .select('id, topic, data, status')
      .eq('web_project_id', projectId),
    sb.from('web_project_topics')
      .select('topic_key, topic_label, coverage_status, passages, items')
      .eq('web_project_id', projectId),
    sb.from('strategy_content_collection_sessions')
      .select('*')
      .eq('web_project_id', projectId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (pillarsRes.error) return res.status(500).json({ error: `content_atoms load failed: ${pillarsRes.error.message}` })
  if (factsRes.error)   return res.status(500).json({ error: `church_facts load failed: ${factsRes.error.message}` })
  if (topicsRes.error)  return res.status(500).json({ error: `web_project_topics load failed: ${topicsRes.error.message}` })
  if (ccRes.error)      return res.status(500).json({ error: `content_collection load failed: ${ccRes.error.message}` })

  // Compress crawl topics: sum passages byte length + extract a noise-scan sample.
  const crawl_topics = (topicsRes.data ?? []).map((t: any) => {
    const passages = Array.isArray(t.passages) ? t.passages : []
    const items    = Array.isArray(t.items)    ? t.items    : []
    let totalBytes = 0
    let sample     = ''
    for (const p of passages) {
      const text = typeof p === 'string' ? p : (typeof p?.text === 'string' ? p.text : JSON.stringify(p))
      totalBytes += text.length
      if (sample.length < PASSAGE_SAMPLE_BYTES) {
        sample += (sample ? '\n' : '') + text.slice(0, PASSAGE_SAMPLE_BYTES - sample.length)
      }
    }
    return {
      topic_key:       String(t.topic_key),
      topic_label:     t.topic_label ?? undefined,
      coverage_status: t.coverage_status ?? undefined,
      passages_bytes:  totalBytes,
      item_count:      items.length,
      sample_text:     sample,
    }
  })

  // Content collection field keys: every non-null column on the latest
  // session row (filtering out the meta columns).
  const ccRow = ccRes.data as Record<string, unknown> | null
  const META_COLUMNS = new Set([
    'id', 'web_project_id', 'created_at', 'updated_at', 'submitted_at', 'member', 'status',
  ])
  const content_collection_fields = ccRow
    ? Object.entries(ccRow)
        .filter(([k, v]) => !META_COLUMNS.has(k) && v !== null && v !== undefined && v !== '')
        .map(([k]) => k)
    : []

  const input: InventoryReadinessInput = {
    pillars:    (pillarsRes.data ?? []) as any,
    facts:      (factsRes.data ?? []) as any,
    crawl_topics,
    content_collection_fields,
  }

  const report = buildInventoryReadinessReport(input)
  return res.status(200).json(report)
}
