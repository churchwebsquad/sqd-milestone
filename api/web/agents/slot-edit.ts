/**
 * Vercel Serverless Function — /api/web/agents/slot-edit
 *
 * Targeted, single-slot rewrite. The director's iterate loop calls
 * this when a directive's fix_kind is "slot_edit" — for issues that
 * are contained to ONE element (a heading, a CTA label, a card body)
 * and don't need the whole page to be re-drafted.
 *
 * Why this exists: re-running page-draft for a one-slot fix is
 * destructive — it can recreate problems on the OTHER slots the
 * writer had right. slot-edit reads the current draft + brief + Stage
 * 1 voice context, rewrites exactly one slot, and writes the new
 * value back in place. Everything else is preserved byte-for-byte.
 *
 * Input shape:
 *   { projectId, pageSlug, sectionIx, slotKey, instruction }
 * - sectionIx: zero-indexed against page_drafts[slug].sections
 * - slotKey: top-level slot ("heading", "description", "cta", ...) OR
 *            nested-form ("cards[0].heading", "items[2].body") for
 *            grouped slots
 * - instruction: concrete edit directive from the director or
 *                strategist (e.g., "Heading reads like an ad slogan —
 *                anchor on the discovery Q14 phrase 'starting line,
 *                not a finish'")
 *
 * Output: writes the new slot value back into roadmap_state.page_drafts.
 * Stamps section._meta.last_slot_edit with the slot_key, instruction,
 * and the old + new values for telemetry.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { loadSnippetsForAgent } from './_lib/loadSnippets.js'
import { stripDashesFromValue, type DashStripReport } from './_lib/stripDashes.js'

export const maxDuration = 60

// Sonnet — slot rewrites are narrow, fast, and shouldn't pay Opus
// pricing. The narrow context (one section + voice card + brief)
// fits comfortably in Sonnet's strengths.
const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 2000

const TOOL = {
  description: 'Submit the rewritten slot value. Output is either a string (for text/richtext/label slots) or a structured object (for CTA slots).',
  input_schema: {
    type: 'object',
    required: ['new_value', 'rationale'],
    properties: {
      new_value: {
        // Allow string OR object so the same agent serves both text
        // slots (heading, description) and CTA slots ({label, intent}).
        type: ['string', 'object'],
        description: 'The replacement value for the slot. Match the SHAPE of the original value: if the slot held a string, return a string; if it held a {label, intent} object, return the same shape.',
      },
      rationale: {
        type: 'string',
        description: 'One sentence: how this rewrite addresses the instruction without drifting from the project voice. Surfaces in section._meta.last_slot_edit.',
      },
      voice_notes: {
        type: 'string',
        description: 'Optional: any voice-card observations that shaped this edit. Helps the next critique loop see your reasoning.',
      },
    },
  },
}

const SYSTEM_PROMPT = [
  'You are a slot-level copy editor. Your scope is ONE specific text element on ONE page.',
  '',
  'Rules:',
  '- Rewrite ONLY the slot specified. Do not propose changes to other slots, sections, or the page structure.',
  '- Match the project voice — read the voice_exemplars and avoid the voice_anti_exemplars exactly. Lift phrasing shapes, not literal sentences.',
  '- Respect slot conventions:',
  '    · heading: 8 words max, declarative (no question marks unless the existing slot uses them), no parallel-clause tics ("X, not Y"), no em-dash overload.',
  '    · eyebrow: 1-4 words, uppercase-style label. Sentence-cased input still acceptable.',
  '    · tagline: 6-12 words, one beat.',
  '    · description / body: 1-3 sentences for description, longer for body. No hedge words ("perhaps", "might", "could possibly").',
  '    · cta {label, intent}: label 2-4 words, action verb first. intent describes what the click promises (e.g., "Open contact form").',
  '- Snippets: when the project has merge-field snippets (church_name, address, primary_phone, etc.), USE the `{{token}}` form rather than typing out the literal value. This keeps spelling/punctuation consistent across every page. Only inline a literal value when the slot needs a variant the snippet doesn\'t cover.',
  '- Preserve the original value\'s shape: if the slot held a string, return a string. If it held an object, return the same keys.',
  '- If the instruction asks for something you can\'t deliver without breaking voice (e.g., "make it punchier" when the existing line is already 3 words), explain in rationale and return the existing value unchanged.',
].join('\n')

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey     = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !gatewayKey) {
    return res.status(500).json({ error: 'Missing env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId   = typeof req.body?.projectId   === 'string' ? req.body.projectId   : null
  const pageSlug    = typeof req.body?.pageSlug    === 'string' ? req.body.pageSlug    : null
  const sectionIx   = typeof req.body?.sectionIx   === 'number' ? req.body.sectionIx   : null
  const slotKey     = typeof req.body?.slotKey     === 'string' ? req.body.slotKey     : null
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
  if (!projectId || !pageSlug || sectionIx === null || !slotKey || !instruction) {
    return res.status(400).json({
      error: 'projectId, pageSlug, sectionIx (number), slotKey, instruction all required',
    })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('id, member, roadmap_state').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const state  = (project.roadmap_state ?? {}) as Record<string, any>
  const stage1 = state.stage_1
  const draft  = state.page_drafts?.[pageSlug]
  const brief  = state.page_briefs?.[pageSlug]
  const sections = Array.isArray(draft?.sections) ? draft.sections : []
  const section  = sections[sectionIx]
  if (!stage1) return res.status(400).json({ error: 'Synthesize must be complete before slot-edit.' })
  if (!draft)  return res.status(404).json({ error: `No draft for page "${pageSlug}".` })
  if (!section) return res.status(404).json({ error: `No section at index ${sectionIx} on page "${pageSlug}".` })

  // Snippets — pull the project's merge-field inventory so the agent
  // can reach for {{church_name}} / {{address}} / etc. instead of
  // typing literals. Failure to load is non-fatal; the rewrite still
  // works without them, just without snippet-awareness.
  const snippets = await loadSnippetsForAgent(sb, projectId)

  const copy = (section.copy ?? {}) as Record<string, any>
  const oldValue = readSlotValue(copy, slotKey)
  if (oldValue === undefined) {
    return res.status(404).json({
      error: `Slot "${slotKey}" not found in section ${sectionIx} (archetype: ${section.archetype ?? 'unknown'}).`,
      hint: 'Use a top-level key like "heading"/"description"/"cta" or nested form like "cards[0].heading".',
    })
  }

  const stage1Slim = {
    voice_exemplars:      stage1.voice_exemplars,
    voice_anti_exemplars: stage1.voice_anti_exemplars,
    voice_characteristics: stage1.voice_characteristics,
    personas:             stage1.personas,
    x_factor:             stage1.x_factor,
  }
  const briefSlim = brief ? {
    page_job:                  brief.page_job,
    persona_focus:             brief.persona_focus,
    voice_exemplars_to_imitate: brief.voice_exemplars_to_imitate,
    voice_anti_exemplars_to_avoid: brief.voice_anti_exemplars_to_avoid,
  } : null

  const userText = [
    `# Project voice (Stage 1, slim)`,
    JSON.stringify(stage1Slim, null, 2),
    ``,
    briefSlim && `# Page brief (slim)\n${JSON.stringify(briefSlim, null, 2)}`,
    ``,
    `# Section context (page="${pageSlug}", section_ix=${sectionIx}, archetype=${section.archetype})`,
    JSON.stringify({ archetype: section.archetype, copy }, null, 2),
    ``,
    `# Slot to edit: "${slotKey}"`,
    `Current value: ${JSON.stringify(oldValue, null, 2)}`,
    ``,
    snippets.length > 0 && [
      `# Available snippets (use the {{token}} form in your rewrite where appropriate)`,
      ...snippets.map(s => `- {{${s.token}}} → "${s.expansion}"`),
    ].join('\n'),
    ``,
    `# Edit instruction`,
    instruction,
    ``,
    `Rewrite slot "${slotKey}" per the instruction. Preserve the value's shape. Submit via submit_slot_edit.`,
  ].filter(Boolean).join('\n')

  let toolInput: { new_value: unknown; rationale: string; voice_notes?: string } | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_slot_edit: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_slot_edit' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_slot_edit') {
      throw new Error('Model did not return the expected tool call')
    }
    toolInput = toolCall.input as { new_value: unknown; rationale: string; voice_notes?: string }
  } catch (err: any) {
    console.error('[slot-edit] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // Deterministic dash strip before persisting. The slot-edit prompt
  // tells the model not to use em-dashes, but it sometimes injects
  // them anyway (especially when "regularizing" a description). We
  // strip mechanically here so a slot-edit can never reintroduce a
  // dash the Director will flag on the next pass.
  const dashReport: DashStripReport = { count: 0, samples: [] }
  const cleanedNewValue = stripDashesFromValue(toolInput.new_value, `slot[${slotKey}]`, dashReport)

  // Write back into the draft. Apply at the exact locator path so
  // grouped slots ("cards[0].heading") only update that one entry.
  const nextSections = [...sections]
  const nextSection = { ...section, copy: { ...(section.copy ?? {}) } }
  writeSlotValue(nextSection.copy as Record<string, any>, slotKey, cleanedNewValue)
  // Append edit log to section._meta.slot_edits so re-runs see the
  // history (Director can decide whether to escalate to page_redraft
  // if a slot keeps getting touched without converging).
  const prevMeta = (nextSection._meta ?? {}) as Record<string, any>
  const prevEdits = Array.isArray(prevMeta.slot_edits) ? prevMeta.slot_edits : []
  nextSection._meta = {
    ...prevMeta,
    last_slot_edit: {
      slot_key:    slotKey,
      instruction,
      rationale:   toolInput.rationale,
      old_value:   oldValue,
      new_value:   cleanedNewValue,
      raw_new_value_pre_dash_strip: dashReport.count > 0 ? toolInput.new_value : undefined,
      dash_strip:  { count: dashReport.count, samples: dashReport.samples },
      edited_at:   new Date().toISOString(),
      edited_by:   userData.user.email ?? userData.user.id,
    },
    slot_edits: [
      ...prevEdits,
      { slot_key: slotKey, edited_at: new Date().toISOString() },
    ].slice(-10),  // cap log
  }
  nextSections[sectionIx] = nextSection

  const nextDrafts = {
    ...(state.page_drafts ?? {}),
    [pageSlug]: {
      ...draft,
      sections: nextSections,
      _meta: {
        ...((draft._meta ?? {})),
        last_slot_edit_at: new Date().toISOString(),
      },
    },
  }

  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({ roadmap_state: { ...state, page_drafts: nextDrafts } })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  // Re-read verification. The old iterate loop trusted slot-edit's
  // success response and re-critiqued without confirming the slot
  // actually changed. When a slot_key path was malformed or another
  // concurrent write trampled this one (the run_engine race we just
  // fixed elsewhere), the Director re-saw the SAME bad value and
  // flagged it again, burning iterate loops. Verify the write by
  // reading the slot back from DB and comparing to what we just wrote.
  const { data: postWrite } = await sb.from('strategy_web_projects')
    .select('roadmap_state').eq('id', projectId).maybeSingle()
  const postState   = (postWrite?.roadmap_state ?? {}) as Record<string, any>
  const postDrafts  = (postState.page_drafts ?? {}) as Record<string, any>
  const postDraft   = postDrafts[pageSlug] ?? {}
  const postSection = Array.isArray(postDraft.sections) ? postDraft.sections[sectionIx] : null
  const persistedValue = postSection?.copy
    ? readSlotValue(postSection.copy as Record<string, any>, slotKey)
    : undefined
  const verified = JSON.stringify(persistedValue) === JSON.stringify(cleanedNewValue)
  if (!verified) {
    // The write didn't land where we expected. Most likely cause: a
    // sibling write to roadmap_state landed between our read and our
    // write (read-modify-write race) OR the slotKey path the Director
    // supplied doesn't match the draft's actual structure. Surface
    // both possibilities so the iterate loop can decide whether to
    // retry or escalate to page_redraft.
    console.error('[slot-edit] verification failed', {
      pageSlug, sectionIx, slotKey,
      expected: cleanedNewValue,
      actual:   persistedValue,
    })
    return res.status(200).json({
      ok: false,
      verified: false,
      verification_failure_reason: persistedValue === undefined
        ? 'slot_path_not_found'   // slotKey doesn't address a real field on the section
        : 'write_was_overwritten', // value exists but doesn't match — likely a race
      page_slug: pageSlug,
      section_ix: sectionIx,
      slot_key: slotKey,
      old_value: oldValue,
      expected_new_value: cleanedNewValue,
      actual_value: persistedValue,
      dash_strip: dashReport,
      rationale: toolInput.rationale,
      usage,
    })
  }

  return res.status(200).json({
    ok: true,
    verified: true,
    page_slug: pageSlug,
    section_ix: sectionIx,
    slot_key: slotKey,
    old_value: oldValue,
    new_value: cleanedNewValue,
    dash_strip: dashReport,
    rationale: toolInput.rationale,
    usage,
  })
}

/** Parse a slot locator into a path. Supports top-level keys
 *  ("heading", "cta") and nested-array form ("cards[2].body"). */
function parseSlotPath(slotKey: string): { group?: string; index?: number; field?: string; top?: string } {
  // "cards[0].heading" → group="cards", index=0, field="heading"
  const m = /^([A-Za-z_]+)\[(\d+)\]\.([A-Za-z_]+)$/.exec(slotKey)
  if (m) return { group: m[1], index: Number(m[2]), field: m[3] }
  return { top: slotKey }
}

function readSlotValue(copy: Record<string, any>, slotKey: string): unknown {
  const p = parseSlotPath(slotKey)
  if (p.top != null) return Object.prototype.hasOwnProperty.call(copy, p.top) ? copy[p.top] : undefined
  if (p.group && Array.isArray(copy[p.group])) {
    const item = copy[p.group][p.index!]
    if (item && typeof item === 'object' && p.field) {
      return Object.prototype.hasOwnProperty.call(item, p.field) ? item[p.field] : undefined
    }
  }
  return undefined
}

function writeSlotValue(copy: Record<string, any>, slotKey: string, value: unknown): void {
  const p = parseSlotPath(slotKey)
  if (p.top != null) { copy[p.top] = value; return }
  if (p.group && Array.isArray(copy[p.group]) && p.field) {
    const arr = [...copy[p.group]]
    arr[p.index!] = { ...arr[p.index!], [p.field]: value }
    copy[p.group] = arr
  }
}

// Snippet loading moved to ./_lib/loadSnippets.ts so all 4 copywriting
// agents (page-draft, slot-edit, reorg, content-collection) share one
// implementation that pulls both the 16 global merge-field columns on
// strategy_web_projects AND the custom rows in web_project_snippets.
