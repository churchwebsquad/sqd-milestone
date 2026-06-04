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

// ── STAGE 4 — Page outlines ────────────────────────────────────
// One model call PER PAGE. Two reasons:
//   1. Output budget. The batched call hit the 16k/20k output cap
//      mid-emission for 17 pages × ~4 sections each. Per-page keeps
//      each request small (~2-3k output) so we never truncate.
//   2. Focus. The user's whole pipeline thesis is "separate each step
//      into focused sections to prevent rule overload." A model
//      writing outlines for ONE page at a time can stay tight against
//      that page's job; the batched version has to context-switch.
async function runStage4() {
  console.log(`\n━━━ Stage 4 — Page outlines ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')
  const roadmapState = (project.roadmap_state ?? {}) as any
  if (!roadmapState.stage_1 || !roadmapState.stage_2 || !roadmapState.stage_3) {
    throw new Error('Stage 4 requires stages 1, 2, 3.')
  }

  const [atomsRes, factsRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body').eq('web_project_id', PROJECT_ID),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', PROJECT_ID),
  ])
  const atoms = (atomsRes.data ?? []) as any[]
  const facts = (factsRes.data ?? []) as any[]
  const pages = (roadmapState.stage_2.pages ?? []) as any[]
  const atomById = new Map(atoms.map(a => [a.id, a]))
  const factById = new Map(facts.map(f => [f.id, f]))
  console.log(`Inputs: ${pages.length} pages · ${atoms.length} atoms · ${facts.length} facts · ${(roadmapState.stage_3.atom_placements ?? []).length} placements`)

  const DISPLAY_OPTIONS = [
    'card_grid','split_column','accordion','tabs','timeline',
    'cta_hero','feature_strip','staff_grid','gallery','rich_text_long','process_steps',
  ]

  // Per-page tool: one page worth of sections, much more tractable.
  const PAGE_TOOL_SCHEMA: any = {
    type: 'object',
    properties: {
      sections: { type: 'array', items: { type: 'object',
        properties: {
          section_id:      { type: 'string' },
          section_job:     { type: 'string' },
          content_summary: { type: 'string' },
          display_options: { type: 'array', items: { type: 'object',
            properties: {
              kind:       { type: 'string', enum: DISPLAY_OPTIONS },
              rationale:  { type: 'string' },
              fits_count: { type: 'number' },
            },
            required: ['kind','rationale'],
          }},
          atoms_used:  { type: 'array', items: { type: 'string' } },
          voice_notes: { type: ['string','null'] },
        },
        required: ['section_id','section_job','content_summary','display_options','atoms_used'],
      }},
      voice_notes: { type: ['string','null'] },
    },
    required: ['sections'],
  }

  // Index atom placements by page_slug so each per-page call only
  // sees the atoms routed there in Stage 3 (plus the strategy + the
  // page's own row).
  type Placement = { source_id: string; source_kind: 'atom'|'fact'; primary_page_slug: string; suggested_treatment: string; rationale: string }
  const placementsByPage = new Map<string, Placement[]>()
  for (const p of (roadmapState.stage_3.atom_placements ?? []) as Placement[]) {
    const slug = p.primary_page_slug
    if (!placementsByPage.has(slug)) placementsByPage.set(slug, [])
    placementsByPage.get(slug)!.push(p)
  }
  for (const p of (roadmapState.stage_3.fact_placements ?? []) as Placement[]) {
    const slug = p.primary_page_slug
    if (!placementsByPage.has(slug)) placementsByPage.set(slug, [])
    placementsByPage.get(slug)!.push(p)
  }

  const pageOutlines: any[] = []
  let totalIn = 0, totalOut = 0

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const slug = page.slug
    const placements = placementsByPage.get(slug) ?? []
    const pageAtoms = placements
      .filter(p => p.source_kind === 'atom')
      .map(p => ({ ...atomById.get(p.source_id), placement: p }))
      .filter(a => a.id)
    const pageFacts = placements
      .filter(p => p.source_kind === 'fact')
      .map(p => ({ ...factById.get(p.source_id), placement: p }))
      .filter(f => f.id)

    const userText = [
      `# Drafting outline for ONE page: ${page.name} (/${slug})`,
      `# Page metadata\n${JSON.stringify(page, null, 2)}`,
      `# Stage 1 strategy (project-wide context)\n${JSON.stringify(roadmapState.stage_1, null, 2)}`,
      `# Atoms placed on THIS page (Stage 3)\n${JSON.stringify(pageAtoms, null, 2)}`,
      `# Facts placed on THIS page (Stage 3)\n${JSON.stringify(pageFacts, null, 2)}`,
      `\nDraft section outlines for THIS page only. Use the placed atoms + facts as the content backbone. Each section needs a clear section_job + content_summary + 2-3 display_options.`,
    ].join('\n\n')

    process.stdout.write(`  [${i+1}/${pages.length}] /${slug} ... `)
    const t0 = Date.now()
    try {
      const result = await generateText({
        model: 'anthropic/claude-opus-4-7',
        maxOutputTokens: 6000,
        system: FALLBACK_PROMPTS.outlines,
        messages: [{ role: 'user', content: userText }],
        tools: {
          submit_page_outline: tool({
            description: 'Submit ONE page worth of section outlines.',
            inputSchema: jsonSchema(PAGE_TOOL_SCHEMA),
          }),
        },
        toolChoice: { type: 'tool', toolName: 'submit_page_outline' },
        maxRetries: 3,
      })
      totalIn  += result.usage?.inputTokens  ?? 0
      totalOut += result.usage?.outputTokens ?? 0
      const out = result.toolCalls?.[0]?.input as any
      const sections = out?.sections ?? []
      pageOutlines.push({ page_slug: slug, sections, voice_notes: out?.voice_notes ?? null })
      console.log(`${sections.length} sections (${((Date.now()-t0)/1000).toFixed(1)}s, out=${result.usage?.outputTokens})`)
    } catch (e) {
      console.log(`FAILED — ${e instanceof Error ? e.message : 'unknown'}`)
      pageOutlines.push({ page_slug: slug, sections: [], voice_notes: null, error: e instanceof Error ? e.message : String(e) })
    }
  }

  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_4: {
        page_outlines: pageOutlines,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: totalIn, output_tokens: totalOut },
          source: 'test-pipeline-stages script (per-page)',
        },
      },
    },
  }).eq('id', PROJECT_ID)

  const totalSections = pageOutlines.reduce((sum, o) => sum + (o.sections?.length ?? 0), 0)
  const pagesWithErrors = pageOutlines.filter(o => o.error).length
  console.log(`\nStage 4 summary:`)
  console.log(`  pages outlined:    ${pageOutlines.length - pagesWithErrors}/${pages.length}`)
  console.log(`  total sections:    ${totalSections}`)
  console.log(`  total tokens:      in=${totalIn}, out=${totalOut}`)
  if (pagesWithErrors > 0) console.log(`  pages with errors: ${pagesWithErrors}`)
  return { page_outlines: pageOutlines }
}

// ── STAGE 5 — Bind to Brixies ──────────────────────────────────
// Picks a Brixies template per section + rephrases the section's
// Stage 4 content_summary into field_values that fit the template's
// slots. Writes web_pages + web_sections so the result is renderable
// in the Pages workspace immediately.
//
// One model call per page (page-scoped batch — manageable output
// size since each page is ~4-9 sections). Limited to the first N
// pages via argv[4] for test runs.
async function runStage5(limit?: number) {
  console.log(`\n━━━ Stage 5 — Bind to Brixies ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')
  const roadmapState = (project.roadmap_state ?? {}) as any
  if (!roadmapState.stage_4) throw new Error('Stage 5 requires stage_4 outlines.')

  const allOutlines = (roadmapState.stage_4.page_outlines ?? []) as any[]
  const outlines = limit ? allOutlines.slice(0, limit) : allOutlines
  console.log(`Binding ${outlines.length}/${allOutlines.length} pages…`)

  // Display kind → Brixies family. Used to filter the candidate pool
  // per section before passing to the model.
  const KIND_TO_FAMILY: Record<string, string[]> = {
    cta_hero:        ['Hero Section', 'CTA Section', 'Banner Section'],
    split_column:    ['Content Section', 'Intro Section', 'Feature Section'],
    rich_text_long:  ['Content Section', 'Intro Section'],
    card_grid:       ['Feature Section'],
    feature_strip:   ['Feature Section', 'Banner Section'],
    accordion:       ['FAQ Section'],
    tabs:            ['Feature Section'],
    timeline:        ['Timeline Section', 'Process Section'],
    process_steps:   ['Process Section'],
    staff_grid:      ['Team Section'],
    gallery:         ['Gallery Section', 'Feature Section'],
  }

  // Idempotent reset of any prior Stage 5 output for the chosen pages.
  const pageSlugs = outlines.map(o => o.page_slug)
  const { data: existingPages } = await sb.from('web_pages')
    .select('id, slug').eq('web_project_id', PROJECT_ID).in('slug', pageSlugs)
  if (existingPages?.length) {
    const ids = existingPages.map(p => p.id as string)
    await sb.from('web_sections').delete().in('web_page_id', ids)
    await sb.from('web_pages').delete().in('id', ids)
  }

  // Fetch full template catalog (content kind only) so we can filter
  // per section. Includes the `fields` schema so the model can emit
  // slot-valid field_values.
  const { data: templatesRaw } = await sb.from('web_content_templates')
    .select('id, layer_name, family, variant, fields')
    .eq('is_published', true)
    .eq('kind', 'content')
  type Template = { id: string; layer_name: string; family: string; variant: string | null; fields: any[] }
  const templates = (templatesRaw ?? []) as Template[]
  const templatesByFamily = new Map<string, Template[]>()
  for (const t of templates) {
    if (!templatesByFamily.has(t.family)) templatesByFamily.set(t.family, [])
    templatesByFamily.get(t.family)!.push(t)
  }

  // Pool size cap per section — keeps the model's input manageable.
  const POOL_PER_SECTION = 5

  type PerPageResult = { page_slug: string; web_page_id: string; sections: any[]; error?: string }
  const pageResults: PerPageResult[] = []

  // Load atoms once for atom-body lookups across all pages.
  const { data: atomsAll } = await sb.from('content_atoms')
    .select('id, body').eq('web_project_id', PROJECT_ID)
  const atomById = new Map((atomsAll ?? []).map((a: any) => [a.id, a.body as string]))

  for (let i = 0; i < outlines.length; i++) {
    const outline = outlines[i]
    const slug = outline.page_slug
    const stage2Page = (roadmapState.stage_2.pages ?? []).find((p: any) => p.slug === slug)
    if (!stage2Page) {
      pageResults.push({ page_slug: slug, web_page_id: '', sections: [], error: 'no stage_2 page found' })
      continue
    }

    process.stdout.write(`  [${i+1}/${outlines.length}] /${slug} ... `)

    // Insert the page row first; sections reference its id.
    const { data: newPage, error: pageErr } = await sb.from('web_pages').insert({
      web_project_id:   PROJECT_ID,
      name:             stage2Page.name,
      slug,
      phase:            stage2Page.phase ?? '1',
      sort_order:       i + 1,
      content_status:   'draft',
      ai_drafted_at:    new Date().toISOString(),
      ai_drafted_by_stage: 'bind',
    }).select('id').single()
    if (pageErr || !newPage) {
      console.log(`page insert FAILED: ${pageErr?.message}`)
      pageResults.push({ page_slug: slug, web_page_id: '', sections: [], error: pageErr?.message })
      continue
    }
    const pageId = newPage.id as string

    // Build per-section candidate pools.
    type SectionInput = {
      section_id:      string
      section_job:     string
      content_summary: string
      atoms_used:      string[]
      atom_bodies:     string[]
      voice_notes:     string | null
      candidates:      Array<{ id: string; layer_name: string; family: string; fields: any[] }>
    }
    const sectionInputs: SectionInput[] = []
    for (const s of (outline.sections ?? [])) {
      const firstKind = s.display_options?.[0]?.kind as string | undefined
      const families = firstKind ? KIND_TO_FAMILY[firstKind] ?? ['Content Section'] : ['Content Section']
      const candidates: Template[] = []
      for (const fam of families) {
        const pool = (templatesByFamily.get(fam) ?? []).slice(0, POOL_PER_SECTION - candidates.length)
        candidates.push(...pool)
        if (candidates.length >= POOL_PER_SECTION) break
      }
      sectionInputs.push({
        section_id:      s.section_id,
        section_job:     s.section_job,
        content_summary: s.content_summary,
        atoms_used:      s.atoms_used ?? [],
        atom_bodies:     (s.atoms_used ?? []).map((id: string) => atomById.get(id)).filter(Boolean) as string[],
        voice_notes:     s.voice_notes ?? null,
        candidates,
      })
    }

    if (sectionInputs.length === 0) {
      console.log('no sections in outline')
      pageResults.push({ page_slug: slug, web_page_id: pageId, sections: [] })
      continue
    }

    // Per-page bind tool: one pick per section + field_values, plus
    // a page-level seo object derived from Stage 1's targets.
    const PAGE_BIND_TOOL: any = {
      type: 'object',
      properties: {
        section_picks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              section_id:    { type: 'string' },
              template_id:   { type: 'string' },
              rationale:     { type: 'string' },
              field_values:  { type: 'object', additionalProperties: true },
            },
            required: ['section_id','template_id','field_values'],
          },
        },
        page_seo: {
          type: 'object',
          properties: {
            seo: {
              type: 'object',
              properties: {
                title:            { type: 'string' },
                meta_description: { type: 'string' },
                focus_keywords:   { type: 'array', items: { type: 'string' } },
              },
              required: ['title','meta_description'],
            },
            aeo: {
              type: 'object',
              properties: {
                answer_intent:  { type: 'string' },
                structured_qa:  { type: 'array', items: { type: 'object',
                  properties: { question: { type: 'string' }, answer: { type: 'string' } },
                  required: ['question','answer'] } },
              },
            },
            geo: {
              type: 'object',
              properties: {
                service_areas:   { type: 'array', items: { type: 'string' } },
                local_keywords:  { type: 'array', items: { type: 'string' } },
                local_landmarks: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['seo'],
        },
      },
      required: ['section_picks','page_seo'],
    }

    // Pass Stage 1's full seo_aeo_geo_targets so the model can match
    // the right topic cluster to this page when emitting page_seo.
    const stage1SeoTargets = (roadmapState.stage_1?.seo_aeo_geo_targets ?? [])
    const pageAeoKeywords  = (stage2Page.aeo_keywords ?? [])
    // The full slug list from the Stage 2 sitemap. Used to enforce the
    // "no broken internal links" rule in the system prompt — every
    // internal href in field_values must reference one of these.
    const validSlugs = ((roadmapState.stage_2.pages ?? []) as any[])
      .map(p => p.slug)
      .filter(Boolean)
    // Vocabulary decisions from Stage 2 (e.g. nav uses "Visit" not
    // "Plan a Visit"). Bind agent must apply these to button labels,
    // card titles, and other label-shaped slots.
    const vocabularyDecisions = roadmapState.stage_2?.vocabulary_decisions ?? []

    const userText = [
      `# Page: ${stage2Page.name} (/${slug})`,
      `# valid_slugs — every internal href MUST point to one of these (anchor "#section" optional)\n${JSON.stringify(validSlugs, null, 2)}`,
      `# vocabulary_decisions — button labels, card titles, and nav-shaped slots MUST use the "we_chose" term, not "instead_of"\n${JSON.stringify(vocabularyDecisions, null, 2)}`,
      `# Stage 1 SEO/AEO/GEO targets (compose page_seo from the most relevant entries)\n${JSON.stringify(stage1SeoTargets, null, 2)}`,
      `# Page-level AEO keywords (from Stage 2 sitemap)\n${JSON.stringify(pageAeoKeywords, null, 2)}`,
      `# Sections to bind (${sectionInputs.length})`,
      sectionInputs.map(s => {
        const candidatesSlim = s.candidates.map(c => ({
          id: c.id,
          layer_name: c.layer_name,
          family: c.family,
          // Strip palette refs + heavy nested item_schemas to keep the
          // prompt small. Keep slot keys + types + max_chars + labels.
          slots: (c.fields ?? []).map((f: any) => ({
            key: f.key,
            kind: f.kind,
            type: f.type,
            label: f.label,
            max_chars: f.max_chars,
            required: f.required,
          })),
        }))
        return [
          `## Section ${s.section_id}`,
          `Job: ${s.section_job}`,
          `Content summary: ${s.content_summary}`,
          s.voice_notes ? `Voice notes: ${s.voice_notes}` : '',
          `Atoms placed here (${s.atom_bodies.length}):\n${s.atom_bodies.slice(0, 8).map((b, i) => `  ${i+1}. ${b.slice(0, 200)}`).join('\n')}`,
          `Candidate templates:\n${JSON.stringify(candidatesSlim, null, 2)}`,
        ].filter(Boolean).join('\n')
      }).join('\n\n---\n\n'),
    ].join('\n\n')

    const t0 = Date.now()
    try {
      const result = await generateText({
        model: 'anthropic/claude-opus-4-7',
        maxOutputTokens: 8000,
        system: FALLBACK_PROMPTS.bind,
        messages: [{ role: 'user', content: userText }],
        tools: {
          submit_page_bind: tool({
            description: 'Submit template picks + field_values for every section on this page.',
            inputSchema: jsonSchema(PAGE_BIND_TOOL),
          }),
        },
        toolChoice: { type: 'tool', toolName: 'submit_page_bind' },
        maxRetries: 3,
      })
      const out = result.toolCalls?.[0]?.input as any
      const picks = (out?.section_picks ?? []) as Array<{ section_id: string; template_id: string; field_values: Record<string, unknown>; rationale?: string }>
      const pageSeo = out?.page_seo ?? null

      // Write seo onto the page row. Belt-and-suspenders alongside
      // the per-page emission requirement — if the model returns
      // nothing here, we leave the page without seo and let Stage 8
      // flag it.
      if (pageSeo) {
        await sb.from('web_pages').update({ seo: pageSeo }).eq('id', pageId)
      }

      // Write web_sections in the same order as the outline.
      const rows = sectionInputs.map((s, idx) => {
        const pick = picks.find(p => p.section_id === s.section_id)
        if (!pick) return null
        // Belt-and-suspenders defense: even with the prompt rule, scrub
        // any stray {{merge_field}} tokens from string-valued slots
        // before persisting. Image-shaped tokens turn into empty
        // strings (the renderer treats blank as "no image"); other
        // tokens we keep in case they ARE legitimate snippet refs.
        const fv = scrubUnresolvedTokens(pick.field_values ?? {})
        // Build a minimal source_markdown from the field_values'
        // text/richtext leaves. Stage 5 isn't running through the
        // ContentDocument round-trip, so we synthesize a readable
        // dump for the Text view here.
        const md = fieldValuesToMarkdownLite(fv)
        return {
          web_page_id:         pageId,
          content_template_id: pick.template_id,
          field_values:        fv,
          source_field_values: fv,
          source_markdown:     md,
          sort_order:          idx,
          content_status:      'draft',
        }
      }).filter(Boolean)

      if (rows.length > 0) {
        const { error: secErr } = await sb.from('web_sections').insert(rows as never)
        if (secErr) {
          console.log(`sections insert FAILED: ${secErr.message}`)
          pageResults.push({ page_slug: slug, web_page_id: pageId, sections: [], error: secErr.message })
          continue
        }
      }
      console.log(`${rows.length}/${sectionInputs.length} sections bound (${((Date.now()-t0)/1000).toFixed(1)}s, out=${result.usage?.outputTokens})`)
      pageResults.push({ page_slug: slug, web_page_id: pageId, sections: picks })
    } catch (e) {
      console.log(`FAILED — ${e instanceof Error ? e.message : 'unknown'}`)
      pageResults.push({ page_slug: slug, web_page_id: pageId, sections: [], error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Persist Stage 5 _meta.
  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_5: {
        page_results: pageResults,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          source: 'test-pipeline-stages script (per-page bind, test limit)',
          limited_to_pages: outlines.length,
        },
      },
    },
  }).eq('id', PROJECT_ID)

  const totalSections = pageResults.reduce((sum, r) => sum + (r.sections?.length ?? 0), 0)
  console.log(`\nStage 5 summary:`)
  console.log(`  pages bound:       ${pageResults.filter(r => !r.error).length}/${pageResults.length}`)
  console.log(`  sections written:  ${totalSections}`)
  console.log(`  pages with errors: ${pageResults.filter(r => r.error).length}`)
  return { page_results: pageResults }
}

/** Strip unresolved {{merge_field}} tokens from string-shaped slot
 *  values. Image-likely keys (image, photo, video, src, url) get
 *  blanked entirely when their value is JUST a token — leaving the
 *  template to render its placeholder. Text-likely keys keep the
 *  token only when it's likely a real snippet ref (lowercase
 *  underscore_case with no asset hints in the name). The fall-back
 *  is conservative: when in doubt, prefer blank over a literal
 *  "{{...}}" rendering on the page. */
function scrubUnresolvedTokens<T>(values: T): T {
  if (Array.isArray(values)) {
    return values.map(v => scrubUnresolvedTokens(v)) as unknown as T
  }
  if (values && typeof values === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      out[k] = scrubField(k, v as never)
    }
    return out as T
  }
  return values
}

function scrubField(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    const justAToken = /^\s*\{\{[^}]+\}\}\s*$/.test(value)
    const looksLikeAsset = /image|photo|video|src|url|file|asset/i.test(key)
    if (justAToken && looksLikeAsset) return ''
    if (justAToken) return ''  // stay conservative — blank is safer than literal "{{x}}"
  }
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return scrubUnresolvedTokens(value as never)
  }
  return value
}

/** Minimal field_values → markdown. Walks text/richtext slot values
 *  and concatenates them with headings. Used only by Stage 5 since
 *  this script doesn't go through computeSectionBind's IR pipeline. */
function fieldValuesToMarkdownLite(values: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value === 'string' && value.trim()) {
      const looksLikeHeading = /^(heading|title|tagline)/i.test(key)
      parts.push(looksLikeHeading ? `## ${value.trim()}` : value.trim())
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) parts.push(`- ${item.trim()}`)
        else if (item && typeof item === 'object') {
          const itemMd = fieldValuesToMarkdownLite(item as Record<string, unknown>)
          if (itemMd) parts.push(itemMd)
        }
      }
    } else if (value && typeof value === 'object') {
      const objMd = fieldValuesToMarkdownLite(value as Record<string, unknown>)
      if (objMd) parts.push(objMd)
    }
  }
  return parts.join('\n\n')
}

// ── STAGE 6 — Coverage QA ──────────────────────────────────────
// Audits whether every atom + fact landed somewhere in the bound
// sections. Read-only — just reports landed / partial / orphaned.
async function runStage6() {
  console.log(`\n━━━ Stage 6 — Coverage QA ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')

  const [atomsRes, factsRes, pagesRes] = await Promise.all([
    sb.from('content_atoms').select('id, topic, body').eq('web_project_id', PROJECT_ID),
    sb.from('church_facts').select('id, topic, data').eq('web_project_id', PROJECT_ID),
    sb.from('web_pages').select('id, slug, name').eq('web_project_id', PROJECT_ID),
  ])
  const atoms   = (atomsRes.data ?? []) as any[]
  const facts   = (factsRes.data ?? []) as any[]
  const pages   = (pagesRes.data ?? []) as any[]
  const pageIds = pages.map(p => p.id)
  if (pageIds.length === 0) throw new Error('No bound pages — run Stage 5 first.')

  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, sort_order')
    .in('web_page_id', pageIds)
    .order('sort_order')
  const sectionsArr = (sections ?? []) as any[]
  console.log(`Auditing: ${atoms.length} atoms · ${facts.length} facts · ${sectionsArr.length} bound sections across ${pages.length} pages`)

  const TOOL_SCHEMA: any = {
    type: 'object',
    properties: {
      landed:           { type: 'array', items: { type: 'object',
        properties: { source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['atom','fact'] },
          landed_in: { type: 'array', items: { type: 'object',
            properties: { web_section_id: { type: 'string' }, field_key: { type: 'string' }, snippet: { type: 'string' } },
            required: ['web_section_id','field_key','snippet'] } } },
        required: ['source_id','source_kind','landed_in'] } },
      partially_landed: { type: 'array', items: { type: 'object',
        properties: { source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['atom','fact'] },
          landed_in: { type: 'array', items: { type: 'object', properties: {
            web_section_id: { type: 'string' }, field_key: { type: 'string' }, snippet: { type: 'string' } },
            required: ['web_section_id','field_key','snippet'] } },
          missing_info: { type: 'string' } },
        required: ['source_id','source_kind','landed_in','missing_info'] } },
      orphaned:         { type: 'array', items: { type: 'object',
        properties: { source_id: { type: 'string' }, source_kind: { type: 'string', enum: ['atom','fact'] },
          rationale: { type: 'string' },
          suggested_remedy: { type: 'string', enum: ['reroute','request_partner_content','archive','add_new_section'] } },
        required: ['source_id','source_kind','rationale','suggested_remedy'] } },
      total_score: { type: 'number' },
    },
    required: ['landed','partially_landed','orphaned','total_score'],
  }

  // Only consider atoms/facts that were routed in Stage 3 to one of
  // our 5 bound pages. Atoms routed to unbound pages aren't fair to
  // count as orphans in this limited test run.
  const boundSlugs = new Set(pages.map(p => p.slug))
  const stage3 = (project.roadmap_state as any).stage_3 ?? {}
  const atomPlacements = (stage3.atom_placements ?? []) as Array<{ source_id: string; primary_page_slug: string }>
  const factPlacements = (stage3.fact_placements ?? []) as Array<{ source_id: string; primary_page_slug: string }>
  const inScopeAtomIds = new Set(atomPlacements.filter(p => boundSlugs.has(p.primary_page_slug)).map(p => p.source_id))
  const inScopeFactIds = new Set(factPlacements.filter(p => boundSlugs.has(p.primary_page_slug)).map(p => p.source_id))
  const atomsToAudit   = atoms.filter(a => inScopeAtomIds.has(a.id))
  const factsToAudit   = facts.filter(f => inScopeFactIds.has(f.id))
  console.log(`In-scope (placed on bound pages): ${atomsToAudit.length} atoms · ${factsToAudit.length} facts`)

  const userText = [
    `# Bound pages\n${JSON.stringify(pages, null, 2)}`,
    `# Bound sections (id, page_id, template_id, field_values)\n${JSON.stringify(sectionsArr, null, 2)}`,
    `# Atoms placed on bound pages (Stage 3)\n${JSON.stringify(atomsToAudit, null, 2)}`,
    `# Facts placed on bound pages (Stage 3)\n${JSON.stringify(factsToAudit, null, 2)}`,
  ].join('\n\n')

  console.log('Calling anthropic/claude-opus-4-7…')
  const t0 = Date.now()
  const result = await generateText({
    model: 'anthropic/claude-opus-4-7',
    maxOutputTokens: 16000,
    system: FALLBACK_PROMPTS.coverage_qa,
    messages: [{ role: 'user', content: userText }],
    tools: {
      submit_coverage_audit: tool({
        description: 'Submit coverage audit results.',
        inputSchema: jsonSchema(TOOL_SCHEMA),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_coverage_audit' },
    maxRetries: 3,
  })
  console.log(`Returned in ${((Date.now()-t0)/1000).toFixed(1)}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  const out = result.toolCalls?.[0]?.input as any
  if (!out) throw new Error('No tool call returned')

  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_6: {
        ...out,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          source: 'test-pipeline-stages script (limited to bound pages)',
          atoms_audited: atomsToAudit.length,
          facts_audited: factsToAudit.length,
        },
      },
    },
  }).eq('id', PROJECT_ID)

  console.log(`\nStage 6 summary:`)
  console.log(`  landed:           ${(out.landed ?? []).length}`)
  console.log(`  partially landed: ${(out.partially_landed ?? []).length}`)
  console.log(`  orphaned:         ${(out.orphaned ?? []).length}`)
  console.log(`  total score:      ${out.total_score}%`)
  return out
}

// ── STAGE 7 — Voice pass ───────────────────────────────────────
// For each bound page, the model rewrites text/richtext slot values
// to better match the project's voice card. Two-step: (1) generate
// the rewrite manifest per page, (2) apply non-override rewrites to
// web_sections. Per-page to keep prompts manageable.
async function runStage7() {
  console.log(`\n━━━ Stage 7 — Voice pass ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')
  const roadmapState = (project.roadmap_state ?? {}) as any
  if (!roadmapState.stage_1) throw new Error('Stage 7 needs stage_1 voice card')

  const voiceCard = roadmapState.stage_1.voice_characteristics
  const personas  = roadmapState.stage_1.personas

  const { data: brandGuide } = await sb.from('strategy_brand_guides')
    .select('voice_overview, brand_statement').eq('member', project.member).eq('is_published', true).maybeSingle()
  const brandHandoff = (await sb.from('strategy_account_progress').select('handoff_brand_form').eq('member', project.member).maybeSingle()).data?.handoff_brand_form

  const { data: pages } = await sb.from('web_pages').select('id, slug, name').eq('web_project_id', PROJECT_ID).order('sort_order')
  const pagesArr = (pages ?? []) as any[]
  if (pagesArr.length === 0) throw new Error('No bound pages — run Stage 5 first.')

  const allRewrites: Array<{ web_section_id: string; field_key: string; old_value: string; new_value: string; voice_alignment_score: number; rationale: string }> = []
  const allSkipped:  Array<{ web_section_id: string; field_key: string; reason: string }> = []
  let totalIn = 0, totalOut = 0

  const TOOL_SCHEMA: any = {
    type: 'object',
    properties: {
      rewrites: { type: 'array', items: { type: 'object',
        properties: {
          web_section_id: { type: 'string' }, field_key: { type: 'string' },
          old_value: { type: 'string' }, new_value: { type: 'string' },
          voice_alignment_score: { type: 'number' }, rationale: { type: 'string' },
        },
        required: ['web_section_id','field_key','old_value','new_value','voice_alignment_score','rationale'] } },
      skipped: { type: 'array', items: { type: 'object',
        properties: {
          web_section_id: { type: 'string' }, field_key: { type: 'string' },
          reason: { type: 'string', enum: ['already_on_voice','override_locked','over_budget_after_rewrite','structured_slot_not_supported'] },
        },
        required: ['web_section_id','field_key','reason'] } },
    },
    required: ['rewrites','skipped'],
  }

  for (let i = 0; i < pagesArr.length; i++) {
    const page = pagesArr[i]
    const { data: pageSections } = await sb.from('web_sections')
      .select('id, content_template_id, field_values, field_provenance, sort_order')
      .eq('web_page_id', page.id).order('sort_order')

    process.stdout.write(`  [${i+1}/${pagesArr.length}] /${page.slug} ... `)
    const t0 = Date.now()
    try {
      const result = await generateText({
        model: 'anthropic/claude-opus-4-7',
        maxOutputTokens: 12000,
        system: FALLBACK_PROMPTS.voice_pass,
        messages: [{ role: 'user', content: [
          `# Voice card\n${JSON.stringify(voiceCard, null, 2)}`,
          `# Personas\n${JSON.stringify(personas, null, 2)}`,
          brandGuide ? `# Brand guide\n${JSON.stringify(brandGuide, null, 2)}` : '',
          brandHandoff ? `# Brand handoff (AM intake)\n${JSON.stringify(brandHandoff, null, 2)}` : '',
          `# Page being polished: ${page.name} (/${page.slug})`,
          `# Sections (with current field_values + provenance)\n${JSON.stringify(pageSections, null, 2)}`,
        ].filter(Boolean).join('\n\n') }],
        tools: {
          submit_voice_rewrites: tool({
            description: 'Submit voice-pass rewrites + skips for one page.',
            inputSchema: jsonSchema(TOOL_SCHEMA),
          }),
        },
        toolChoice: { type: 'tool', toolName: 'submit_voice_rewrites' },
        maxRetries: 3,
      })
      totalIn  += result.usage?.inputTokens  ?? 0
      totalOut += result.usage?.outputTokens ?? 0
      const out = result.toolCalls?.[0]?.input as any
      const r = (out?.rewrites ?? []) as typeof allRewrites
      const s = (out?.skipped  ?? []) as typeof allSkipped
      allRewrites.push(...r)
      allSkipped.push(...s)
      console.log(`${r.length} rewrites · ${s.length} skipped (${((Date.now()-t0)/1000).toFixed(1)}s, out=${result.usage?.outputTokens})`)
    } catch (e) {
      console.log(`FAILED — ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  // Persist the manifest
  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_7: {
        rewrites: allRewrites,
        skipped:  allSkipped,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: totalIn, output_tokens: totalOut },
          source: 'test-pipeline-stages script',
        },
      },
    },
  }).eq('id', PROJECT_ID)

  // Apply: write each rewrite back to web_sections.field_values, skipping
  // any field marked field_provenance='override'. Also reject any
  // rewrite that would clobber an array or object slot with a string —
  // the voice agent occasionally emits a rewrite for a structured slot
  // (grid_row, row_list, accordion) which would corrupt the renderer.
  console.log(`\nApplying ${allRewrites.length} rewrites to web_sections…`)
  let applied = 0, blockedByOverride = 0, blockedByShape = 0, failed = 0
  for (const r of allRewrites) {
    const { data: sec } = await sb.from('web_sections')
      .select('field_values, field_provenance').eq('id', r.web_section_id).maybeSingle()
    if (!sec) { failed++; continue }
    const prov = (sec.field_provenance ?? {}) as Record<string, { source?: string }>
    if (prov[r.field_key]?.source === 'override') { blockedByOverride++; continue }
    const fv = sec.field_values as Record<string, unknown>
    const existing = fv[r.field_key]
    // Defense: only rewrite slots whose current value is a string (or
    // missing). Array/object slots have structured shapes that a string
    // rewrite would destroy.
    if (existing !== undefined && existing !== null && typeof existing !== 'string') {
      blockedByShape++
      continue
    }
    const nextValues = { ...fv, [r.field_key]: r.new_value }
    const nextProv   = { ...prov, [r.field_key]: { ...(prov[r.field_key] ?? {}), source: 'voice_pass' } }
    const { error } = await sb.from('web_sections')
      .update({ field_values: nextValues, field_provenance: nextProv })
      .eq('id', r.web_section_id)
    if (error) failed++; else applied++
  }

  console.log(`\nStage 7 summary:`)
  console.log(`  total rewrites:   ${allRewrites.length}`)
  console.log(`  applied:          ${applied}`)
  console.log(`  blocked override: ${blockedByOverride}`)
  console.log(`  blocked shape:    ${blockedByShape}`)
  console.log(`  failed:           ${failed}`)
  console.log(`  skipped (model):  ${allSkipped.length}`)
  return { rewrites: allRewrites, skipped: allSkipped }
}

// ── STAGE 8 — Final QA ─────────────────────────────────────────
async function runStage8() {
  console.log(`\n━━━ Stage 8 — Final QA ━━━`)

  const { data: project } = await sb.from('strategy_web_projects').select('*').eq('id', PROJECT_ID).maybeSingle()
  if (!project) throw new Error('Project not found')
  const roadmapState = (project.roadmap_state ?? {}) as any

  const { data: pages } = await sb.from('web_pages').select('id, slug, name, seo').eq('web_project_id', PROJECT_ID).order('sort_order')
  const pagesArr = (pages ?? []) as any[]
  const pageIds = pagesArr.map(p => p.id)
  const { data: sections } = await sb.from('web_sections')
    .select('id, web_page_id, content_template_id, field_values, sort_order')
    .in('web_page_id', pageIds)
    .order('sort_order')

  const TOOL_SCHEMA: any = {
    type: 'object',
    properties: {
      findings: { type: 'array', items: { type: 'object',
        properties: {
          severity:       { type: 'string', enum: ['blocker','warning','nit'] },
          page_slug:      { type: ['string','null'] },
          web_section_id: { type: ['string','null'] },
          category:       { type: 'string', enum: ['nav_parity','persona_coverage','voice_drift','merge_field','seo'] },
          issue:          { type: 'string' },
          suggested_fix:  { type: 'string' },
        },
        required: ['severity','category','issue','suggested_fix'] } },
      scores: { type: 'object',
        properties: {
          nav_parity:             { type: 'number' },
          persona_coverage:       { type: 'number' },
          voice_consistency:      { type: 'number' },
          merge_field_resolution: { type: 'number' },
          seo_completeness:       { type: 'number' },
          overall:                { type: 'number' },
        },
        required: ['nav_parity','persona_coverage','voice_consistency','merge_field_resolution','seo_completeness','overall'] },
    },
    required: ['findings','scores'],
  }

  const userText = [
    `# Stage 1 strategy\n${JSON.stringify(roadmapState.stage_1, null, 2)}`,
    `# Stage 2 sitemap (note: only ${pagesArr.length} of these pages are actually bound for this test)\n${JSON.stringify(roadmapState.stage_2, null, 2)}`,
    `# Bound pages (${pagesArr.length})\n${JSON.stringify(pagesArr, null, 2)}`,
    `# Bound sections (${(sections ?? []).length})\n${JSON.stringify(sections, null, 2)}`,
  ].join('\n\n')

  console.log('Calling anthropic/claude-opus-4-7…')
  const t0 = Date.now()
  const result = await generateText({
    model: 'anthropic/claude-opus-4-7',
    maxOutputTokens: 8000,
    system: FALLBACK_PROMPTS.final_qa,
    messages: [{ role: 'user', content: userText }],
    tools: {
      submit_final_qa: tool({
        description: 'Submit final-QA findings + scores.',
        inputSchema: jsonSchema(TOOL_SCHEMA),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'submit_final_qa' },
    maxRetries: 3,
  })
  console.log(`Returned in ${((Date.now()-t0)/1000).toFixed(1)}s  · in=${result.usage?.inputTokens}  out=${result.usage?.outputTokens}`)

  const out = result.toolCalls?.[0]?.input as any
  if (!out) throw new Error('No tool call returned')

  await sb.from('strategy_web_projects').update({
    roadmap_state: {
      ...(project.roadmap_state ?? {}),
      stage_8: {
        ...out,
        _meta: {
          status: 'draft',
          generated_at: new Date().toISOString(),
          model: 'anthropic/claude-opus-4-7',
          usage: { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens },
          source: 'test-pipeline-stages script (limited scope)',
        },
      },
    },
  }).eq('id', PROJECT_ID)

  const findings = (out.findings ?? []) as any[]
  const scores = out.scores ?? {}
  console.log(`\nStage 8 summary:`)
  console.log(`  findings:              ${findings.length}`)
  console.log(`    blockers:            ${findings.filter((f: any) => f.severity === 'blocker').length}`)
  console.log(`    warnings:            ${findings.filter((f: any) => f.severity === 'warning').length}`)
  console.log(`    nits:                ${findings.filter((f: any) => f.severity === 'nit').length}`)
  console.log(`  scores:`)
  console.log(`    nav parity:          ${scores.nav_parity}%`)
  console.log(`    persona coverage:    ${scores.persona_coverage}%`)
  console.log(`    voice consistency:   ${scores.voice_consistency}%`)
  console.log(`    merge field:         ${scores.merge_field_resolution}%`)
  console.log(`    seo completeness:    ${scores.seo_completeness}%`)
  console.log(`    overall:             ${scores.overall}%`)
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
    if (want('outlines',       '4')) await runStage4()
    if (want('bind',           '5')) {
      // Optional page limit for test runs — argv[4]
      const limitArg = process.argv[4]
      const limit = limitArg ? Number(limitArg) : undefined
      await runStage5(Number.isFinite(limit) && limit! > 0 ? limit : undefined)
    }
    if (want('coverage_qa',    '6')) await runStage6()
    if (want('voice_pass',     '7')) await runStage7()
    if (want('final_qa',       '8')) await runStage8()
    console.log('\n✓ Done.')
    process.exit(0)
  } catch (e) {
    console.error('\n✗ FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
})()
