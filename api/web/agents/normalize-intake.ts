/**
 * Vercel Serverless Function — /api/web/agents/normalize-intake
 *
 * Stage 0 of the copywriting pipeline. Atomizes raw intake into
 * content_atoms + church_facts that Stages 3 + 6 consume. Same
 * intake pre-flight as Stage 1 (strategy brief required; brand
 * source from either published guide OR handoff_brand_form).
 *
 * Idempotent: deletes any previously-emitted atoms + facts for the
 * project before writing new ones. Strategist can re-run as many
 * times as needed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'

// 800s = max Vercel allows on the Fluid Compute Pro tier. normalize-intake
// fetches every web_intake_documents file (4-5 docs on a typical project),
// dumps them all into an Opus prompt for atomization, and writes hundreds
// of atoms + facts + topics back to Supabase. Total wall-clock with a
// content_collection-heavy project (4 CSVs + 1 markdown brief) sits in
// the 4-7 minute range. The previous 300s ceiling was hitting
// FUNCTION_INVOCATION_TIMEOUT on real projects (3734 hit 504 today).
export const maxDuration = 800
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 32000  // bumped from 24k after Stage 0 truncated facts when ingesting full crawl topics

const TEXT_FORMATS = new Set(['text/plain','text/markdown','text/x-markdown','text/csv'])
const PDF_FORMAT = 'application/pdf'

const TOOL = {
  description: 'Submit normalized intake — atoms + facts.',
  input_schema: {
    type: 'object',
    properties: {
      atoms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: [
                'persona','voice_rule','mission_statement','vision_statement',
                'x_factor','denominational_signal','recommended_page',
                'tone_descriptor','prose_snippet','voice_sample','ethos',
                'story','value_statement',
              ],
            },
            body:        { type: 'string' },
            metadata:    { type: 'object', additionalProperties: true },
            source_kind: { type: 'string', enum:
              ['strategy_brief','brand_handoff','discovery_questionnaire','am_handoff',
               'content_collection','site_crawl','existing_snippet'] },
            source_ref:  { type: 'string' },
            verbatim:    { type: 'boolean' },
            confidence:  { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['topic','body','source_kind','verbatim','confidence'],
        },
      },
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: [
                'service_time','campus','ministry','staff','belief',
                'program','milestone','contact_method','branded_term',
                'audience','location_detail','partnership','testimonial',
              ],
            },
            data:        { type: 'object', additionalProperties: true },
            source_kind: { type: 'string' },
            source_ref:  { type: 'string' },
          },
          required: ['topic','data','source_kind'],
        },
      },
      summary: {
        type: 'object',
        properties: {
          atom_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
          fact_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
          gaps_noted:          { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['atoms','facts'],
  },
}

interface LoadedFile {
  category:    string
  filename:    string
  mime_type:   string | null
  storage_url: string
  text?:       string
  base64?:     string
}

interface LoadResult {
  loaded: LoadedFile[]
  /** Files we COULDN'T load (storage 404, parse error, unsupported MIME).
   *  Returned alongside loaded files so the handler can FAIL LOUDLY rather
   *  than silently dropping intake. Zero-loss contract: if ANY file is in
   *  this list, normalize-intake refuses to run. */
  failed: Array<{ category: string; filename: string; mime_type: string | null; error: string }>
}

async function loadIntakeFiles(docs: any[]): Promise<LoadResult> {
  const loaded: LoadedFile[] = []
  const failed: LoadResult['failed'] = []
  await Promise.all(docs.map(async (doc: any) => {
    const base: LoadedFile = {
      category:    doc.category,
      filename:    doc.filename,
      mime_type:   doc.mime_type ?? null,
      storage_url: doc.storage_url,
    }
    try {
      const r = await fetch(doc.storage_url)
      if (!r.ok) {
        failed.push({ ...base, error: `Fetch failed: HTTP ${r.status}` })
        return
      }
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        const text = await r.text()
        if (text.trim().length === 0) {
          failed.push({ ...base, error: 'File loaded but body is empty (0 chars after trim)' })
          return
        }
        loaded.push({ ...base, text })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        if (ab.byteLength === 0) {
          failed.push({ ...base, error: 'PDF loaded but byteLength=0' })
          return
        }
        loaded.push({ ...base, base64: Buffer.from(ab).toString('base64') })
      } else {
        failed.push({ ...base, error: `Unsupported MIME type for normalize-intake: ${doc.mime_type ?? '(none)'}` })
      }
    } catch (e: any) {
      failed.push({ ...base, error: `Load error: ${e?.message ?? 'unknown'}` })
    }
  }))
  return { loaded, failed }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const anonKey         = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey      = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes, topicsRes, contentSessionRes, snippetsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, handoff_brand_form').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', projectId).eq('archived', false),
    // The crawler's per-topic inventory of the partner's current site —
    // each row has passages (verbatim quotes from the live pages),
    // source URLs, coverage status, and topic group. This is the
    // primary source of "what does this church actually do today"
    // information and was missing from Stage 0 before now.
    sb.from('web_project_topics').select('*').eq('web_project_id', projectId),
    // Partner-supplied content collection session — includes per-page
    // preferences, sermon/event/group source-of-truth URLs, and the
    // inventory_snapshot (frozen crawl). Mostly metadata around the
    // crawl but adds partner intent on top of factual inventory.
    sb.from('strategy_content_collection_sessions').select('*').eq('member', member).order('submitted_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    // Project snippets already in the system (typically pre-resolved
    // tokens like address/service-time). Each one is a piece of
    // partner-confirmed content the binder can later use verbatim.
    sb.from('web_project_snippets').select('token, label, expansion, description, tags, source').eq('web_project_id', projectId).eq('archived', false),
  ])

  const brandHandoffForm = accountRes.data?.handoff_brand_form ?? null
  const brandGuide       = brandRes.data ?? null
  const intakeDocs       = intakeDocsRes.data ?? []
  const crawlTopics      = (topicsRes.data ?? []) as any[]
  const contentSession   = contentSessionRes.data ?? null
  const projectSnippets  = (snippetsRes.data ?? []) as any[]

  // Minimum-intake pre-flight. Each gate has a primary source AND a
  // fallback so projects that arrived pre-workflow (no brand handoff
  // in our system) or were imported from external content-collection
  // tools can still normalize.
  //
  // Fallback semantics: content_collection-category intake docs are
  // typically partner-supplied voice + ministry + strategy material
  // and can stand in for the formal brand source / strategy brief
  // when those don't exist. The LLM extracts whatever's available;
  // the gate is just preventing "literally no usable intake".
  const missing: string[] = []
  const hasContentCollection = intakeDocs.some(d => d.category === 'content_collection')
  if (!discoveryRes.data && !intakeDocs.some(d => d.category === 'discovery_questionnaire_supplemental')) {
    missing.push('Discovery questionnaire')
  }
  if (!brandGuide && !brandHandoffForm && !hasContentCollection) {
    missing.push('Brand source (published guide, handoff_brand_form, OR content collection docs)')
  }
  if (!intakeDocs.some(d => d.category === 'strategy_brief') && !hasContentCollection) {
    missing.push('Strategy brief OR content collection docs')
  }
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Required intake sources missing', missing })
  }

  const { loaded: filesLoaded, failed: filesFailed } = await loadIntakeFiles(intakeDocs)
  // ZERO-LOSS contract: if ANY intake file failed to load, refuse to
  // run rather than silently dropping content. The strategist sees
  // exactly which file(s) failed and why, and can either re-upload OR
  // explicitly skip (we'd need a separate "force_skip_unreadable: true"
  // body param to opt out — not exposed yet, by design).
  if (filesFailed.length > 0) {
    return res.status(422).json({
      error: 'Intake files failed to load — refusing to run to avoid silent content loss.',
      failed: filesFailed,
      hint: 'Re-upload the failed files (check storage URLs and MIME types) and re-run. If a file is intentionally unparseable (e.g. an image with no text), archive it via web_intake_documents before re-running.',
    })
  }
  const resolved    = await resolvePromptServer(sb, 'normalize', projectId)
  const previous    = redoContext
    ? (project.roadmap_state as Record<string, unknown>)?.stage_0
    : undefined

  // Build user content — all intake sources stacked.
  const userBlocks: Array<{ type: 'text', text: string } | { type: 'file', data: string, mediaType: string }> = []
  userBlocks.push({ type: 'text', text: `# Project\n${JSON.stringify({
    id: project.id, member: project.member, name: project.name, kind: project.kind,
  }, null, 2)}` })
  if (accountRes.data?.handoff_web_form) {
    userBlocks.push({ type: 'text', text: `# AM handoff (web)\n\`\`\`json\n${JSON.stringify(accountRes.data.handoff_web_form, null, 2)}\n\`\`\`` })
  }
  if (brandGuide) {
    userBlocks.push({ type: 'text', text: `# Brand guide (Brand Squad)\n\`\`\`json\n${JSON.stringify(brandGuide, null, 2)}\n\`\`\`` })
  } else if (brandHandoffForm) {
    userBlocks.push({ type: 'text', text: `# Brand handoff (AM intake)\n\`\`\`json\n${JSON.stringify(brandHandoffForm, null, 2)}\n\`\`\`` })
  }
  if (discoveryRes.data) {
    userBlocks.push({ type: 'text', text: `# Discovery questionnaire\n\`\`\`json\n${JSON.stringify(discoveryRes.data, null, 2)}\n\`\`\`` })
  }
  // Site crawl topics — the partner's live website, broken down by
  // topic with verbatim passages and source URLs. This is intentionally
  // surfaced BEFORE the intake files so the model treats it as ground
  // truth for "what this church actually does today" and uses the
  // intake files as the strategic + voice overlay.
  if (crawlTopics.length > 0) {
    // Strip very large/unhelpful nested storage blobs to keep token
    // counts in check. Keep passages + items + source URLs which is
    // where the real content lives.
    const slim = crawlTopics
      .filter(t => (t.passages && Array.isArray(t.passages) && t.passages.length > 0)
                || (t.items && Array.isArray(t.items) && t.items.length > 0)
                || (t.source_page_urls && t.source_page_urls.length > 0))
      .map(t => ({
        topic_key:        t.topic_key,
        topic_label:      t.topic_label,
        topic_group:      t.topic_group,
        coverage_status:  t.coverage_status,
        inventory_kind:   t.inventory_kind,
        passages:         t.passages,
        items:            t.items,
        source_page_urls: t.source_page_urls,
      }))
    userBlocks.push({ type: 'text', text:
      `# Site crawl topics (the partner's CURRENT website)\n` +
      `Each entry is a topic surfaced by the crawler with verbatim passages from live pages. ` +
      `Treat these as the canonical inventory of what the church does today — atomize every distinct ` +
      `program, ministry, event, value, and offering you find here. The intake forms describe what ` +
      `the redesign should accomplish; this is what the redesign has to actually represent.\n\n` +
      `\`\`\`json\n${JSON.stringify(slim, null, 2)}\n\`\`\``
    })
  }
  if (contentSession) {
    // Drop the inventory_snapshot (already covered by crawlTopics) but
    // keep partner-supplied preferences + per-section context.
    const { inventory_snapshot: _ignored, ...sessionMeta } = contentSession as any
    userBlocks.push({ type: 'text', text:
      `# Content collection session (partner-supplied per-topic preferences)\n` +
      `\`\`\`json\n${JSON.stringify(sessionMeta, null, 2)}\n\`\`\``
    })
  }
  if (projectSnippets.length > 0) {
    userBlocks.push({ type: 'text', text:
      `# Existing project snippets (already-resolved partner content)\n` +
      `Each snippet is partner-confirmed content. Atomize each one — it's a piece of the partner's ` +
      `voice or factual story already locked in. Do not invent new content that contradicts these.\n\n` +
      `\`\`\`json\n${JSON.stringify(projectSnippets, null, 2)}\n\`\`\``
    })
  }
  for (const f of filesLoaded) {
    if (f.text) {
      userBlocks.push({ type: 'text', text: `# Intake file (${f.category}): ${f.filename}\n\n${f.text}` })
    } else if (f.base64) {
      userBlocks.push({ type: 'file', data: f.base64, mediaType: f.mime_type ?? 'application/pdf' })
    }
  }
  if (previous) {
    userBlocks.push({ type: 'text', text: `# Previous normalization (refine, don't restart)\n\`\`\`json\n${JSON.stringify(previous, null, 2)}\n\`\`\`` })
  }
  if (redoContext) {
    userBlocks.push({ type: 'text', text: `# Strategist redo feedback\n${redoContext}` })
  }

  let toolResult: { atoms: any[]; facts: any[]; summary?: any } | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userBlocks as any }],
      tools: {
        submit_normalized_intake: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_normalized_intake' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_normalized_intake') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as { atoms: any[]; facts: any[]; summary?: any }
  } catch (err: any) {
    console.error('[normalize-intake] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Snapshot the prior atoms+facts BEFORE we delete them, so a re-run
  // that produces fewer rows (model variance, truncation, etc.) can
  // be diagnosed against the prior state — and so the strategist
  // can recover anything that dropped. Snapshot lives in
  // roadmap_state.stage_0._prior_runs[] (capped at 3 entries).
  const [{ data: priorAtoms }, { data: priorFacts }] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body, metadata, source_kind, source_ref, verbatim, confidence').eq('web_project_id', projectId),
    sb.from('church_facts').select('id, topic, data, source_kind, source_ref').eq('web_project_id', projectId),
  ])
  const priorSnapshot = {
    snapshotted_at: new Date().toISOString(),
    atom_count:     Array.isArray(priorAtoms) ? priorAtoms.length : 0,
    fact_count:     Array.isArray(priorFacts) ? priorFacts.length : 0,
    atoms:          priorAtoms ?? [],
    facts:          priorFacts ?? [],
  }

  // Idempotent write: blow away prior rows for this project, then insert.
  await sb.from('content_atoms').delete().eq('web_project_id', projectId)
  await sb.from('church_facts').delete().eq('web_project_id', projectId)

  const atomRows = (toolResult?.atoms ?? []).map(a => ({
    web_project_id: projectId,
    topic:          a.topic,
    body:           a.body,
    metadata:       a.metadata ?? null,
    source_kind:    a.source_kind ?? null,
    source_ref:     a.source_ref ?? null,
    verbatim:       a.verbatim === true,
    confidence:     typeof a.confidence === 'number' ? a.confidence : null,
  }))
  const factRows = (toolResult?.facts ?? []).map(f => ({
    web_project_id: projectId,
    topic:          f.topic,
    data:           f.data,
    source_kind:    f.source_kind ?? null,
    source_ref:     f.source_ref ?? null,
  }))

  if (atomRows.length > 0) {
    const { error } = await sb.from('content_atoms').insert(atomRows as never)
    if (error) return res.status(500).json({ error: `atoms insert: ${error.message}` })
  }
  if (factRows.length > 0) {
    const { error } = await sb.from('church_facts').insert(factRows as never)
    if (error) return res.status(500).json({ error: `facts insert: ${error.message}` })
  }

  // ── Coverage telemetry: atoms + facts broken down by source_kind.
  // Surfaces in stage_0._meta so the strategist can confirm at a
  // glance that EVERY source contributed. If e.g. content_collection
  // contributes 0 atoms, that's a signal that the partner's Page 2
  // answers got dropped — the strategist sees it instead of
  // discovering it 4 stages downstream.
  const atomsBySource: Record<string, number> = {}
  const factsBySource: Record<string, number> = {}
  for (const a of atomRows) atomsBySource[a.source_kind ?? 'unknown'] = (atomsBySource[a.source_kind ?? 'unknown'] ?? 0) + 1
  for (const f of factRows) factsBySource[f.source_kind ?? 'unknown'] = (factsBySource[f.source_kind ?? 'unknown'] ?? 0) + 1

  // ── Truncation suspicion: if the model used >= 90% of MAX_OUTPUT_TOKENS,
  // the response may have been cut mid-write. Surface as a warning
  // flag in meta so the strategist (and future audit jobs) can
  // re-run if the count looks low.
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const truncationSuspected = outputTokens >= MAX_OUTPUT_TOKENS * 0.9
  // ── Delta against prior run: how many atoms/facts did we GAIN or LOSE?
  // A re-run that produces materially fewer rows than the prior run is
  // a red flag (could be model variance, could be truncation, could be
  // a real refactor — but the strategist should know).
  const atomsDelta = atomRows.length - priorSnapshot.atom_count
  const factsDelta = factRows.length - priorSnapshot.fact_count
  const significantDrop = priorSnapshot.atom_count > 0 && (atomsDelta < 0 && Math.abs(atomsDelta) >= priorSnapshot.atom_count * 0.2)

  const meta = {
    status: 'draft',
    generated_at: new Date().toISOString(),
    model: MODEL,
    prompt_source: resolved.globalSource,
    has_project_addendum: resolved.hasProjectAddendum,
    redo_count: typeof (previous as any)?._meta?.redo_count === 'number'
      ? (previous as any)._meta.redo_count + (redoContext ? 1 : 0)
      : 0,
    usage,
    atom_count: atomRows.length,
    fact_count: factRows.length,
    // Per-source coverage — strategist can confirm every uploaded
    // file + the crawl + the content collection session contributed.
    // Zero atoms from a source that DID land in the user message is
    // a red flag the strategist needs to see immediately.
    atoms_by_source: atomsBySource,
    facts_by_source: factsBySource,
    sources_loaded: {
      strategy_brief:    intakeDocs.some(d => d.category === 'strategy_brief'),
      discovery:         !!discoveryRes.data || intakeDocs.some(d => d.category === 'discovery_questionnaire_supplemental'),
      am_handoff:        !!accountRes.data?.handoff_web_form,
      brand_guide:       !!brandGuide,
      brand_handoff:     !!brandHandoffForm,
      content_collection_session: !!contentSession,
      content_collection_files:   intakeDocs.filter(d => d.category === 'content_collection').length,
      crawl_topics:      crawlTopics.length,
      project_snippets:  projectSnippets.length,
      intake_files_total: intakeDocs.length,
    },
    // Truncation + delta flags. UI surfaces these as "re-run
    // suggested" warnings so the strategist doesn't silently
    // proceed on a partial extraction.
    truncation_suspected: truncationSuspected,
    truncation_pct:       outputTokens > 0 ? Math.round((outputTokens / MAX_OUTPUT_TOKENS) * 100) : 0,
    atoms_delta_vs_prior: atomsDelta,
    facts_delta_vs_prior: factsDelta,
    significant_drop_vs_prior: significantDrop,
  }

  // Persist meta + summary + the prior-run snapshot. The snapshot is
  // capped at 3 entries (oldest dropped) so the JSONB doesn't grow
  // unboundedly across many re-runs.
  const prevStage0 = ((project.roadmap_state ?? {}) as any).stage_0 ?? {}
  const priorRuns = Array.isArray(prevStage0._prior_runs) ? prevStage0._prior_runs : []
  const nextPriorRuns = priorSnapshot.atom_count > 0 || priorSnapshot.fact_count > 0
    ? [priorSnapshot, ...priorRuns].slice(0, 3)
    : priorRuns

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...(project.roadmap_state ?? {}),
        stage_0: {
          summary:      toolResult?.summary ?? null,
          _meta:        meta,
          _prior_runs:  nextPriorRuns,
        },
      },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `state write: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    atoms: atomRows.length,
    facts: factRows.length,
    summary: toolResult?.summary ?? null,
    sources_loaded: meta.sources_loaded,
    atoms_by_source: atomsBySource,
    facts_by_source: factsBySource,
    truncation_suspected: truncationSuspected,
    significant_drop_vs_prior: significantDrop,
    atoms_delta_vs_prior: atomsDelta,
    facts_delta_vs_prior: factsDelta,
    usage,
  })
}
