/**
 * One-shot pipeline runner for Stages 1 + 2 against the test
 * sandbox project. Bypasses the Vercel HTTP wrapper (no JWT)
 * and uses the service-role client; runs the SAME prompt +
 * tool schema the production agents use by importing them.
 *
 * Usage:
 *   npx tsx scripts/test-pipeline-stages.ts <projectId>
 *
 * Reports the structured result to stdout + writes it to
 * roadmap_state.stage_1 / .stage_2 (same as the production
 * agents do).
 */

// Minimal .env loader — vendored to avoid the dotenv dep
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
for (const f of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), f)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const v = m[2].replace(/^["']|["']$/g, '')
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import {
  buildSystemPrompt as buildStage1Prompt,
  buildUserContent as buildStage1Content,
  EXTRACTION_TOOL,
} from '../api/web/agents/extract-strategy'
import {
  buildSystemPrompt as buildStage2Prompt,
  buildUserContent as buildStage2Content,
  SITEMAP_TOOL,
} from '../api/web/agents/draft-sitemap'
import { FALLBACK_PROMPTS } from '../src/lib/pipelinePromptsCore'

const PROJECT_ID = process.argv[2]
if (!PROJECT_ID) {
  console.error('Usage: npx tsx scripts/test-pipeline-stages.ts <projectId>')
  process.exit(1)
}

const supabaseUrl    = process.env.VITE_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const gatewayKey     = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
if (!supabaseUrl || !serviceRoleKey || !gatewayKey) {
  console.error('Missing required env vars (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_GATEWAY_API_KEY)')
  process.exit(1)
}

const STAGE1_MODEL = 'anthropic/claude-opus-4-7'
const STAGE2_MODEL = 'anthropic/claude-opus-4-7'

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

// ── File loading helpers (mirror extract-strategy.ts pre-flight) ──
const TEXT_FORMATS = new Set(['text/plain','text/markdown','text/x-markdown','text/csv'])
const PDF_FORMAT = 'application/pdf'

async function loadIntakeFiles(docs: any[]) {
  const loaded: any[] = []
  await Promise.all(docs.map(async (doc: any) => {
    const base = {
      category: doc.category, filename: doc.filename,
      mime_type: doc.mime_type, storage_url: doc.storage_url,
    }
    try {
      const r = await fetch(doc.storage_url)
      if (!r.ok) throw new Error(`Fetch ${r.status}`)
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        loaded.push({ ...base, text: await r.text() })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        loaded.push({ ...base, base64: Buffer.from(ab).toString('base64') })
      }
    } catch (e) {
      console.warn(`[skip] ${doc.filename}: ${e instanceof Error ? e.message : 'load failed'}`)
    }
  }))
  return loaded
}

// ── STAGE 0 — Normalize intake ─────────────────────────────────
async function runStage0() {
  console.log(`\n━━━ Stage 0 — Normalize intake ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')

  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, handoff_brand_form').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', PROJECT_ID).eq('archived', false),
  ])

  const filesLoaded = await loadIntakeFiles(intakeDocsRes.data ?? [])
  const brandHandoffForm = accountRes.data?.handoff_brand_form ?? null
  const brandGuide       = brandRes.data ?? null

  const userBlocks: any[] = []
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
  for (const f of filesLoaded) {
    if (f.text) userBlocks.push({ type: 'text', text: `# Intake file (${f.category}): ${f.filename}\n\n${f.text}` })
    else if (f.base64) userBlocks.push({ type: 'file', data: f.base64, mediaType: f.mime_type ?? 'application/pdf' })
  }

  const TOOL_INPUT_SCHEMA: any = {
    type: 'object',
    properties: {
      atoms: { type: 'array', items: { type: 'object',
        properties: {
          topic: { type: 'string', enum:
            ['persona','voice_rule','mission_statement','vision_statement','x_factor','denominational_signal','recommended_page','tone_descriptor','prose_snippet','voice_sample','ethos','story','value_statement'] },
          body: { type: 'string' }, metadata: { type: 'object', additionalProperties: true },
          source_kind: { type: 'string', enum:
            ['strategy_brief','brand_handoff','discovery_questionnaire','am_handoff','content_collection'] },
          source_ref: { type: 'string' }, verbatim: { type: 'boolean' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topic','body','source_kind','verbatim','confidence'],
      }},
      facts: { type: 'array', items: { type: 'object',
        properties: {
          topic: { type: 'string', enum:
            ['service_time','campus','ministry','staff','belief','program','milestone','contact_method','branded_term','audience','location_detail','partnership','testimonial'] },
          data: { type: 'object', additionalProperties: true },
          source_kind: { type: 'string' }, source_ref: { type: 'string' },
        },
        required: ['topic','data','source_kind'],
      }},
      summary: { type: 'object', properties: {
        atom_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
        fact_count_by_topic: { type: 'object', additionalProperties: { type: 'number' } },
        gaps_noted: { type: 'array', items: { type: 'string' } },
      }},
    },
    required: ['atoms','facts'],
  }

  console.log('Calling anthropic/claude-opus-4-7…')
  const t0 = Date.now()
  const result = await generateText({
    model: 'anthropic/claude-opus-4-7',
    maxOutputTokens: 24000,
    system: FALLBACK_PROMPTS.normalize,
    messages: [{ role: 'user', content: userBlocks as any }],
    tools: {
      submit_normalized_intake: tool({
        description: 'Submit normalized intake — atoms + facts.',
        inputSchema: jsonSchema(TOOL_INPUT_SCHEMA),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_normalized_intake' },
  })
  console.log(`Returned in ${((Date.now()-t0)/1000).toFixed(1)}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  const out = result.toolCalls?.[0]?.input as any
  if (!out) throw new Error('No tool call returned')

  // Idempotent reset
  await sb.from('content_atoms').delete().eq('web_project_id', PROJECT_ID)
  await sb.from('church_facts').delete().eq('web_project_id', PROJECT_ID)

  const atomRows = (out.atoms ?? []).map((a: any) => ({
    web_project_id: PROJECT_ID,
    topic: a.topic, body: a.body, metadata: a.metadata ?? null,
    source_kind: a.source_kind, source_ref: a.source_ref ?? null,
    verbatim: a.verbatim === true,
    confidence: typeof a.confidence === 'number' ? a.confidence : null,
  }))
  const factRows = (out.facts ?? []).map((f: any) => ({
    web_project_id: PROJECT_ID,
    topic: f.topic, data: f.data,
    source_kind: f.source_kind ?? null, source_ref: f.source_ref ?? null,
  }))

  if (atomRows.length) {
    const { error } = await sb.from('content_atoms').insert(atomRows as never)
    if (error) throw new Error(`atoms insert: ${error.message}`)
  }
  if (factRows.length) {
    const { error } = await sb.from('church_facts').insert(factRows as never)
    if (error) throw new Error(`facts insert: ${error.message}`)
  }

  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_0: {
        summary: out.summary ?? null,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          source: 'test-pipeline-stages script',
          atom_count: atomRows.length,
          fact_count: factRows.length,
        },
      },
    },
  }).eq('id', PROJECT_ID)

  console.log(`\nStage 0 summary:`)
  console.log(`  atoms inserted: ${atomRows.length}`)
  console.log(`  facts inserted: ${factRows.length}`)
  if (out.summary?.gaps_noted?.length) {
    console.log(`  gaps noted:     ${out.summary.gaps_noted.length}`)
  }
}

// ── STAGE 3 — Page inventory ───────────────────────────────────
async function runStage3() {
  console.log(`\n━━━ Stage 3 — Page inventory ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')
  const roadmapState = (project.roadmap_state ?? {}) as any
  if (!roadmapState.stage_1 || !roadmapState.stage_2) {
    throw new Error('Stage 3 requires stage_1 + stage_2 to be present.')
  }

  const [atomsRes, factsRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body, source_kind, confidence').eq('web_project_id', PROJECT_ID),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', PROJECT_ID),
  ])
  const atoms = (atomsRes.data ?? []) as any[]
  const facts = (factsRes.data ?? []) as any[]
  if (atoms.length === 0 && facts.length === 0) {
    throw new Error('No atoms or facts found. Run Stage 0 first.')
  }
  console.log(`Inputs: ${atoms.length} atoms · ${facts.length} facts · ${(roadmapState.stage_2.pages ?? []).length} pages`)

  const TOOL_INPUT_SCHEMA: any = {
    type: 'object',
    properties: {
      atom_placements: { type: 'array', items: { type: 'object',
        properties: {
          source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['atom'] },
          primary_page_slug: { type: 'string' },
          reference_pages: { type: 'array', items: { type: 'object',
            properties: { slug: { type: 'string' },
              treatment: { type: 'string', enum: ['hero_anchor','section_body','card_in_grid','sidebar_callout','footer_link','cta_button','schema_only'] } },
            required: ['slug','treatment'] } },
          suggested_treatment: { type: 'string', enum:
            ['hero_anchor','section_body','card_in_grid','sidebar_callout','footer_link','cta_button','schema_only'] },
          rationale: { type: 'string' },
        },
        required: ['source_id','source_kind','primary_page_slug','suggested_treatment','rationale'],
      }},
      fact_placements: { type: 'array', items: { type: 'object',
        properties: {
          source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['fact'] },
          primary_page_slug: { type: 'string' },
          reference_pages: { type: 'array', items: { type: 'object',
            properties: { slug: { type: 'string' }, treatment: { type: 'string' } },
            required: ['slug','treatment'] } },
          suggested_treatment: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['source_id','source_kind','primary_page_slug','suggested_treatment','rationale'],
      }},
      orphans: { type: 'array', items: { type: 'object',
        properties: {
          source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['atom','fact'] },
          rationale: { type: 'string' },
          suggested_action: { type: 'string', enum: ['archive','request_more_content','reroute_to_global_snippet'] },
        },
        required: ['source_id','source_kind','rationale','suggested_action'],
      }},
      per_page_atom_count: { type: 'object', additionalProperties: { type: 'number' } },
    },
    required: ['atom_placements','fact_placements','orphans','per_page_atom_count'],
  }

  const userText = [
    `# Project\n${JSON.stringify({ id: project.id, member: project.member, name: project.name }, null, 2)}`,
    `# Stage 1 — Strategy\n${JSON.stringify(roadmapState.stage_1, null, 2)}`,
    `# Stage 2 — Sitemap\n${JSON.stringify(roadmapState.stage_2, null, 2)}`,
    `# Content atoms (${atoms.length})\n${JSON.stringify(atoms, null, 2)}`,
    `# Church facts (${facts.length})\n${JSON.stringify(facts, null, 2)}`,
  ].join('\n\n')

  console.log('Calling anthropic/claude-opus-4-7…')
  const t0 = Date.now()
  const result = await generateText({
    model: 'anthropic/claude-opus-4-7',
    maxOutputTokens: 24000,
    system: FALLBACK_PROMPTS.page_inventory,
    messages: [{ role: 'user', content: userText }],
    tools: {
      submit_page_inventory: tool({
        description: 'Submit the page-inventory mapping for this project.',
        inputSchema: jsonSchema(TOOL_INPUT_SCHEMA),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_page_inventory' },
  })
  console.log(`Returned in ${((Date.now()-t0)/1000).toFixed(1)}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  const out = result.toolCalls?.[0]?.input as any
  if (!out) throw new Error('No tool call returned')

  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_3: {
        ...out,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          source: 'test-pipeline-stages script',
        },
      },
    },
  }).eq('id', PROJECT_ID)

  console.log(`\nStage 3 summary:`)
  console.log(`  atoms placed:  ${(out.atom_placements ?? []).length}`)
  console.log(`  facts placed:  ${(out.fact_placements ?? []).length}`)
  console.log(`  orphans:       ${(out.orphans ?? []).length}`)
  console.log(`  per-page counts:`)
  const counts = out.per_page_atom_count ?? {}
  for (const [slug, n] of Object.entries(counts).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log(`    ${slug.padEnd(28)} ${n}`)
  }
  return out
}

// ── STAGE 1 ────────────────────────────────────────────────────
async function runStage1() {
  console.log(`\n━━━ Stage 1 — Synthesize ━━━`)

  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (projErr || !project) throw new Error(projErr?.message ?? 'Project not found')

  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, handoff_brand_form').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', PROJECT_ID).eq('archived', false).order('uploaded_at', { ascending: false }),
  ])

  const filesLoaded = await loadIntakeFiles(intakeDocsRes.data ?? [])
  console.log(`Loaded ${filesLoaded.length} intake file(s); brand_handoff: ${accountRes.data?.handoff_brand_form ? 'yes' : 'no'}; brand_guide: ${brandRes.data ? 'yes' : 'no'}; discovery: ${discoveryRes.data ? 'yes' : 'no'}`)

  const userContent = buildStage1Content({
    project,
    accountHandoff: accountRes.data?.handoff_web_form ?? null,
    brandGuide: brandRes.data ?? null,
    brandHandoffForm: accountRes.data?.handoff_brand_form ?? null,
    discoveryQuestionnaire: discoveryRes.data ?? null,
    filesLoaded,
    redoContext: '',
    previousStage1: null,
  })

  console.log(`Calling ${STAGE1_MODEL}…`)
  const t0 = Date.now()
  const result = await generateText({
    model: STAGE1_MODEL,
    maxOutputTokens: 16000,
    system: buildStage1Prompt(),
    messages: [{ role: 'user', content: userContent as any }],
    tools: {
      submit_strategy_extraction: tool({
        description: EXTRACTION_TOOL.description,
        inputSchema: jsonSchema(EXTRACTION_TOOL.input_schema as any),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_strategy_extraction' },
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`Returned in ${elapsed}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  let extraction = result.toolCalls?.[0]?.input as any
  if (extraction && Object.keys(extraction).length === 1 && extraction.strategy) {
    extraction = extraction.strategy
  }

  // Persist
  const { error: writeErr } = await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_1: {
        ...extraction,
        _meta: {
          model: STAGE1_MODEL,
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          extracted_at: new Date().toISOString(),
          source: 'test-pipeline-stages script',
        },
      },
    },
    roadmap_stage: 'strategy_done',
  }).eq('id', PROJECT_ID)
  if (writeErr) throw new Error(`DB write failed: ${writeErr.message}`)

  console.log(`\nStage 1 summary:`)
  console.log(`  total_page_count:  ${extraction?.total_page_count ?? '(missing)'}`)
  console.log(`  recommended pages: ${(extraction?.recommended_pages ?? []).join(', ') || '(none)'}`)
  console.log(`  personas:          ${(extraction?.personas ?? []).length}`)
  console.log(`  carry-forward:     ${(extraction?.existing_pages_to_carry_forward ?? []).length}`)
  console.log(`  seo targets:       ${(extraction?.seo_aeo_geo_targets ?? []).length}`)
  return extraction
}

// ── STAGE 2 ────────────────────────────────────────────────────
async function runStage2(stage1: any) {
  console.log(`\n━━━ Stage 2 — Sitemap ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')

  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes, accountChurchRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, handoff_brand_form, church_name').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', PROJECT_ID).eq('archived', false).order('uploaded_at', { ascending: false }),
    sb.from('strategy_account_progress').select('church_name').eq('member', member).maybeSingle(),
  ])

  const filesLoaded = await loadIntakeFiles(intakeDocsRes.data ?? [])

  const userContent = buildStage2Content({
    project,
    churchName: accountChurchRes.data?.church_name ?? null,
    accountHandoff: accountRes.data?.handoff_web_form ?? null,
    brandGuide: brandRes.data ?? null,
    discoveryQuestionnaire: discoveryRes.data ?? null,
    stage1,
    filesLoaded,
    redoContext: '',
    previousStage2: null,
  })

  console.log(`Calling ${STAGE2_MODEL}…`)
  const t0 = Date.now()
  const result = await generateText({
    model: STAGE2_MODEL,
    maxOutputTokens: 16000,
    system: buildStage2Prompt(),
    messages: [{ role: 'user', content: userContent as any }],
    tools: {
      submit_sitemap: tool({
        description: SITEMAP_TOOL.description,
        inputSchema: jsonSchema(SITEMAP_TOOL.input_schema as any),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_sitemap' },
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`Returned in ${elapsed}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  let sitemap = result.toolCalls?.[0]?.input as any
  if (sitemap && Object.keys(sitemap).length === 1 && sitemap.sitemap) {
    sitemap = sitemap.sitemap
  }

  const { error: writeErr } = await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_2: {
        ...sitemap,
        _meta: {
          model: STAGE2_MODEL,
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          drafted_at: new Date().toISOString(),
          source: 'test-pipeline-stages script',
        },
      },
    },
    roadmap_stage: 'sitemap_done',
  }).eq('id', PROJECT_ID)
  if (writeErr) throw new Error(`DB write failed: ${writeErr.message}`)

  console.log(`\nStage 2 summary:`)
  console.log(`  pages:        ${(sitemap?.pages ?? []).length}`)
  console.log(`  header nav:   ${(sitemap?.header_nav ?? []).map((n: any) => n.label).join(' · ') || '(empty)'}`)
  console.log(`  footer nav:   ${(sitemap?.footer_nav ?? []).map((n: any) => n.label).join(' · ') || '(empty)'}`)
  return sitemap
}

// ── Main ────────────────────────────────────────────────────────
;(async () => {
  try {
    const onlyStage = process.argv[3]
    const want = (stage: string, num: string) => !onlyStage || onlyStage === stage || onlyStage === num
    if (want('normalize',      '0')) await runStage0()
    if (want('synthesize',     '1')) await runStage1()
    if (want('sitemap',        '2')) {
      const { data: project } = await sb.from('strategy_web_projects').select('roadmap_state').eq('id', PROJECT_ID).maybeSingle()
      const stage1 = (project?.roadmap_state as any)?.stage_1
      if (!stage1) throw new Error('Stage 2 needs stage_1')
      await runStage2(stage1)
    }
    if (want('page_inventory', '3')) await runStage3()
    console.log('\n✓ Done.')
    process.exit(0)
  } catch (e) {
    console.error('\n✗ FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
})()
