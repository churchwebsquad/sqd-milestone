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
    const stage1 = await runStage1()
    const stage2 = await runStage2(stage1)
    console.log('\n✓ Both stages completed.')
    process.exit(0)
  } catch (e) {
    console.error('\n✗ FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
})()
