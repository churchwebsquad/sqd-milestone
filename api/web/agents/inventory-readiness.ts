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

  // Pull the project inventory in parallel. Cheaper than six sequential round-trips.
  // ccDocsRes counts uploaded content_collection files — those count as
  // crawl-equivalent coverage even when the structured Page 2 session is
  // empty (partner uploaded their own content doc rather than filling
  // out the portal).
  const [pillarsRes, factsRes, topicsRes, ccRes, ccDocsRes, projRes] = await Promise.all([
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
    sb.from('web_intake_documents')
      .select('id', { count: 'exact', head: true })
      .eq('web_project_id', projectId)
      .eq('category', 'content_collection')
      .eq('archived', false),
    sb.from('strategy_web_projects')
      .select('roadmap_state')
      .eq('id', projectId)
      .maybeSingle(),
  ])

  if (pillarsRes.error) return res.status(500).json({ error: `content_atoms load failed: ${pillarsRes.error.message}` })
  if (factsRes.error)   return res.status(500).json({ error: `church_facts load failed: ${factsRes.error.message}` })
  if (topicsRes.error)  return res.status(500).json({ error: `web_project_topics load failed: ${topicsRes.error.message}` })
  if (ccRes.error)      return res.status(500).json({ error: `content_collection load failed: ${ccRes.error.message}` })
  if (ccDocsRes.error)  return res.status(500).json({ error: `content_collection docs load failed: ${ccDocsRes.error.message}` })
  if (projRes.error)    return res.status(500).json({ error: `strategy_web_projects load failed: ${projRes.error.message}` })

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

  // Page 2 of the CC portal is the strategic configuration form (events/
  // sermons/groups display, CMS-managed types, ministries content,
  // discipleship pathway, maintenance context). When the partner uploads
  // a CC file in foundations OR fills out Page 1 but skips Page 2, these
  // strategic decisions are missing. Surface the unanswered Page 2 fields
  // as a list the strategist can fill in or follow up with the partner.
  const CC_PAGE2_FIELDS: Array<{ key: string; label: string }> = [
    { key: 'events_display_preference',      label: 'Events display preference' },
    { key: 'sermons_display_preference',     label: 'Sermons display preference' },
    { key: 'groups_display_preference',      label: 'Groups display preference' },
    { key: 'cms_managed_types',              label: 'CMS-managed content types' },
    { key: 'ministries_list_html',           label: 'Ministries list (content)' },
    { key: 'discipleship_pathway_html',      label: 'Discipleship pathway (content)' },
    { key: 'ministries_to_grow',             label: 'Ministries to grow' },
    { key: 'high_maintenance_pages_context', label: 'High-maintenance pages context' },
  ]
  const cc_page2_unanswered = ccRow
    ? CC_PAGE2_FIELDS.filter(f => {
        const v = (ccRow as any)[f.key]
        return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
      }).map(f => ({ key: f.key, label: f.label }))
    : CC_PAGE2_FIELDS.map(f => ({ key: f.key, label: f.label }))

  const cc_files_uploaded = ccDocsRes.count ?? 0

  const roadmap = ((projRes.data as any)?.roadmap_state ?? {}) as Record<string, unknown>
  const strategic_goals = (roadmap.strategic_goals && typeof roadmap.strategic_goals === 'object')
    ? (roadmap.strategic_goals as InventoryReadinessInput['strategic_goals'])
    : undefined

  const input: InventoryReadinessInput = {
    pillars:    (pillarsRes.data ?? []) as any,
    facts:      (factsRes.data ?? []) as any,
    crawl_topics,
    content_collection_fields,
    cc_files_uploaded,
    cc_page2_unanswered,
    strategic_goals,
  }

  const report = buildInventoryReadinessReport(input)
  return res.status(200).json(report)
}
