/**
 * Vercel Serverless Function — /api/web/agents/page-draft
 *
 * One model call per page. Reads the page's brief + Stage 1 voice
 * exemplars + the page's content atoms, and writes section-by-section
 * voice-true copy. Replaces the old outlines + bind + voice_pass
 * sequence with a single embodied draft.
 *
 * Why this exists: the legacy outline→bind→voice_pass chain deferred
 * voice transformation to the end, after structure was locked. By
 * then the model could only paraphrase, not re-imagine. Page Draft
 * does everything at once with the brand voice baked into the system
 * prompt as exemplars (not rules).
 *
 * Output: per-section drafts written to roadmap_state.page_drafts.
 * Each section declares an archetype (hero, two_up, cards_grid, etc.)
 * that the slim bind agent maps to a Brixies template.
 *
 * Input shape:
 *   { projectId, pageSlug, feedback? }
 * - feedback: optional Director directive note for re-drafts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'
import { resolvePromptServer } from './_lib/resolvePrompt.js'
import { loadSnippetsForAgent } from './_lib/loadSnippets.js'

export const maxDuration = 300
const MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_OUTPUT_TOKENS = 8000

const TOOL = {
  description: 'Submit voice-true page draft as a sequence of archetype-tagged sections.',
  input_schema: {
    type: 'object',
    required: ['sections'],
    properties: {
      sections: {
        type: 'array',
        description: 'Ordered list of sections for this page. One entry per section_targets.archetypes[] from the brief, unless you have strong reason to deviate (note the deviation).',
        items: {
          type: 'object',
          required: ['archetype','copy'],
          properties: {
            archetype: {
              type: 'string',
              enum: [
                'hero','tagline_band','two_up','three_up','cards_grid',
                'featured_card','image_text_split','accordion','cta_band',
                'testimonial_block','stat_block','steps_row','contact_band',
                'footer_cta','intro_paragraph','rich_body',
              ],
            },
            copy: {
              type: 'object',
              description: 'Slot-shaped copy for this section. Fill the keys that apply to the archetype. Skip keys that do not apply rather than emitting empty strings.',
              properties: {
                eyebrow:     { type: ['string','null'], description: 'Optional 1-4 word label above the heading. Uppercase tracking style. Leave null when not used.' },
                heading:     { type: ['string','null'], description: 'Section headline. Under 8 words. No question marks. No "X, not Y." parallel-clause shape.' },
                tagline:     { type: ['string','null'], description: 'Short supporting line under the heading.' },
                description: { type: ['string','null'], description: 'Section description / lead paragraph. 1-3 sentences typical.' },
                body:        { type: ['string','null'], description: 'Longer prose body when the archetype supports it (rich_body, intro_paragraph).' },
                cta:         {
                  type: ['object','null'],
                  description: 'Primary call-to-action for this section, when applicable.',
                  properties: {
                    label:    { type: 'string' },
                    intent:   { type: 'string', description: 'What the visitor accomplishes by clicking. E.g. "plan_a_visit", "join_group", "give".' },
                  },
                },
                cards: {
                  type: ['array','null'],
                  description: 'For cards_grid / two_up / three_up archetypes. Each card has heading + description + optional cta.',
                  items: {
                    type: 'object',
                    properties: {
                      heading:     { type: 'string' },
                      description: { type: 'string' },
                      cta_label:   { type: ['string','null'] },
                    },
                  },
                },
                items: {
                  type: ['array','null'],
                  description: 'For accordion / steps_row archetypes. Each item has heading + body.',
                  items: {
                    type: 'object',
                    properties: {
                      heading: { type: 'string' },
                      body:    { type: 'string' },
                    },
                  },
                },
              },
            },
            atoms_used: {
              type: 'array',
              description: 'atom_ids from the brief consumed in this section. Lets the Director verify coverage.',
              items: { type: 'string' },
            },
            voice_notes: {
              type: 'string',
              description: 'Optional one-line note: which voice exemplar shaped this section, or which anti-exemplar you actively avoided. Helps the Director judge voice fit.',
            },
          },
        },
      },
      deviation_note: {
        type: ['string','null'],
        description: 'When the section count/order differs from section_targets.archetypes in the brief, explain why in one sentence. Null when you followed the brief.',
      },
    },
  },
}

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

  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const pageSlug  = typeof req.body?.pageSlug  === 'string' ? req.body.pageSlug  : null
  const feedback  = typeof req.body?.feedback  === 'string' ? req.body.feedback.trim() : ''
  if (!projectId || !pageSlug) {
    return res.status(400).json({ error: 'projectId and pageSlug required' })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: project } = await sb.from('strategy_web_projects')
    .select('*').eq('id', projectId).maybeSingle()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const roadmapState = (project.roadmap_state ?? {}) as Record<string, any>
  const stage1        = roadmapState.stage_1
  const stage2        = roadmapState.stage_2
  // Prefer the new page_outlines (rich, atom-UUID keyed) over the
  // legacy page_briefs (slug-keyed atom refs that didn't resolve).
  // page_briefs is deleted in the orchestrator-wiring commit; this
  // dual-read keeps the agent backward-compatible until then.
  const outline       = roadmapState.page_outlines?.[pageSlug] as any | undefined
  const briefs        = roadmapState.page_briefs
  const brief         = briefs?.[pageSlug]
  const siteStrategy  = roadmapState.site_strategy as any | undefined
  const ministryModel = roadmapState.ministry_model as any | undefined
  if (!stage1 || !stage2 || (!outline && !brief)) {
    return res.status(400).json({
      error: 'Synthesize + Sitemap + (Page Outline OR Page Brief) must all be complete before page-draft.',
      hint:  'Prefer running page-outlines (new path). page-briefs is a legacy fallback during the refactor.',
    })
  }

  // Atom resolution — new outline path uses real UUIDs in
  // sections[].atom_assignments[]; legacy brief path uses fabricated
  // slug strings that never resolved (the bug behind 3886's empty-
  // atoms problem). When the outline is present, pull EVERY atom
  // it references; when only the brief is present, fall back to the
  // legacy attempt (which will likely return 0 — flagged at output).
  let atomIdsUsed: string[] = []
  if (outline) {
    const ids = new Set<string>()
    for (const s of (outline.sections ?? [])) {
      for (const aa of (s.atom_assignments ?? [])) {
        if (typeof aa?.atom_id === 'string' && aa.atom_id) ids.add(aa.atom_id)
      }
    }
    atomIdsUsed = [...ids]
  } else if (brief) {
    atomIdsUsed = [
      ...(brief.atoms_assigned ?? []).map((a: any) => a.atom_id).filter(Boolean),
      ...(brief.reference_atoms ?? []).map((a: any) => a.atom_id).filter(Boolean),
    ]
  }
  const { data: atoms } = atomIdsUsed.length
    ? await sb.from('content_atoms')
        .select('id, topic, body, metadata, source_kind, verbatim')
        .in('id', atomIdsUsed)
    : { data: [] as any[] }

  const previousDraft = roadmapState.page_drafts?.[pageSlug]
  const resolved = await resolvePromptServer(sb, 'page_draft', projectId)

  // Load project snippets — BOTH the 16 global merge fields on
  // strategy_web_projects AND the custom rows in web_project_snippets.
  // The prior implementation only loaded the custom table, which is
  // why the copywriter kept writing "Desert Springs" as a literal:
  // church_name/church_short_name/address/etc. live as columns on the
  // project row, not as snippet table rows. Shared loader keeps the
  // 4 copywriting agents (page-draft, slot-edit, reorg, content-
  // collection) in sync.
  const snippets = await loadSnippetsForAgent(sb, projectId)

  const stage1Slim = {
    audience:             stage1.audience,
    voice_characteristics: stage1.voice_characteristics,
    voice_exemplars:      stage1.voice_exemplars,
    voice_anti_exemplars: stage1.voice_anti_exemplars,
    personas:             stage1.personas,
    x_factor:             stage1.x_factor,
  }

  // Build a per-section atom lookup so the user message can show
  // each section's assigned atom BODY + treatment signal inline,
  // not as a separate atoms[] dump the model has to cross-reference.
  const atomById = new Map<string, any>()
  for (const a of (atoms ?? [])) atomById.set(String(a.id), a)

  const outlineSectionsRich = outline
    ? (outline.sections ?? []).map((s: any) => ({
        section_ix:  s.section_ix,
        archetype:   s.archetype,
        section_job: s.section_job,
        flow_role:   s.flow_role,
        primary_cta: s.primary_cta ?? null,
        cms_managed: s.cms_managed ?? null,
        voice_anchor:           s.voice_anchor ?? null,
        anti_pattern_to_avoid:  s.anti_pattern_to_avoid ?? null,
        atom_assignments: (s.atom_assignments ?? []).map((aa: any) => {
          const atom = atomById.get(String(aa.atom_id))
          return {
            atom_id:       aa.atom_id,
            treatment:     aa.treatment,
            role_in_section: aa.role_in_section ?? null,
            // Inline the source body so the model sees what to imitate /
            // quote / paraphrase without an extra lookup.
            source_body:   atom?.body ?? null,
            source_topic:  atom?.topic ?? null,
            source_kind:   atom?.source_kind ?? null,
            verbatim_in_source: atom?.verbatim ?? false,
          }
        }),
      }))
    : null

  // Ministry model + site strategy are the SPINE — they tell the
  // writer what register to write in for this church.
  const ministrySlim = ministryModel ? {
    model:           ministryModel.model,
    secondary_blend: ministryModel.secondary_blend,
    blend_notes:     ministryModel.blend_notes,
    cta_default:     ministryModel.cta_default,
  } : null

  const userText = [
    `# Project voice (full Stage 1 slim — voice exemplars + anti-exemplars + personas + x-factor)`,
    JSON.stringify(stage1Slim, null, 2),
    ``,
    ministrySlim ? `# Ministry model (the SPINE — register + CTA defaults flow from here)` : '',
    ministrySlim ? JSON.stringify(ministrySlim, null, 2) : '',
    ``,
    outline ? [
      `# Page outline — THE CONTRACT.`,
      `Each section below tells you EXACTLY what to write:`,
      `  - archetype: the section shape`,
      `  - section_job: what this section does for the persona`,
      `  - flow_role: where in the page's narrative this lands`,
      `  - atom_assignments[]: the source content for this section, each with a TREATMENT signal:`,
      `      · verbatim     → quote the source_body exactly. No edits.`,
      `      · light_edit   → preserve meaning, polish voice. Same length range.`,
      `      · heavy_edit   → restructure freely while staying accurate to the facts.`,
      `      · synthesize   → use as source material to compose new copy.`,
      `  - voice_anchor: an example sentence from the voice card to imitate in shape, not content.`,
      `  - anti_pattern_to_avoid: one thing this section MUST NOT do.`,
      `  - primary_cta: when set, this section owns the page's main CTA.`,
      `  - cms_managed: when set, this section sources from a CPT — write copy that frames the dynamic content (the dev will wire the actual repeater).`,
      ``,
      `You are the brand voice champion. Atoms are the contract. Voice is the wrapper. Never invent facts.`,
      `If a section's atom_assignments is empty, the section's job is to provide flow / persona reassurance using voice exemplars only — do not fabricate factual content.`,
      ``,
      'Persona journey for this page:',
      JSON.stringify(outline.persona_journey_for_this_page ?? null, null, 2),
      ``,
      'Sections (in order):',
      JSON.stringify(outlineSectionsRich, null, 2),
    ].join('\n') : '',
    ``,
    !outline && brief ? `# Legacy brief (fallback — page-outlines preferred)\n${JSON.stringify(brief, null, 2)}` : '',
    ``,
    !outline ? `# Atoms available to this page (loaded as fallback when no outline exists)\n${JSON.stringify(atoms ?? [], null, 2)}` : '',
    ``,
    siteStrategy?.persona_journeys ? `# Site-wide persona journeys (for context — your page is one stop on these journeys)\n${JSON.stringify(siteStrategy.persona_journeys, null, 2)}` : '',
    ``,
    snippets.length > 0
      ? [
          `# Project snippets (use the {{token}} form in your copy where these values appear — don't type the literal)`,
          ...snippets.map(s => `- {{${s.token}}} -> "${s.expansion}"`),
        ].join('\n')
      : '',
    ``,
    previousDraft && !feedback
      ? `# Previous draft exists for this page — overwrite it cleanly with a fresh draft.\n${JSON.stringify(previousDraft.sections ?? [], null, 2)}`
      : '',
    previousDraft && feedback
      ? `# Previous draft to refine\n${JSON.stringify(previousDraft.sections ?? [], null, 2)}`
      : '',
    feedback
      ? `\n# Director feedback (apply targeted changes, preserve what isn't called out)\n${feedback}`
      : '',
    ``,
    `Write the draft for page "${pageSlug}". Submit via submit_page_draft.`,
  ].filter(Boolean).join('\n')

  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: resolved.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      tools: {
        submit_page_draft: tool({
          description: TOOL.description,
          inputSchema: jsonSchema(TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_page_draft' },
    })
    usage = { input_tokens: result.usage?.inputTokens, output_tokens: result.usage?.outputTokens }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_page_draft') {
      throw new Error('Model did not return the expected tool call')
    }
    toolResult = toolCall.input as Record<string, unknown>
  } catch (err: any) {
    console.error('[page-draft] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  const sections = Array.isArray((toolResult as any)?.sections) ? (toolResult as any).sections : []
  // Post-write snippet enforcement. The model is instructed to use
  // {{token}} form for known snippets, but slip-throughs are common
  // (e.g. writes "Desert Springs" instead of {{church_short_name}}).
  // We deterministically replace literal expansions with their token
  // and log each replacement so the strategist can see what happened.
  const snippetReplacements = enforceSnippets(sections, snippets)

  const validation = validatePageDraft(sections, brief)
  if (snippetReplacements.length > 0) {
    if (!Array.isArray(validation.flags)) validation.flags = []
    validation.flags.push(...snippetReplacements.map(r =>
      `Snippet substitution: "${r.expansion}" → {{${r.token}}} in ${r.where} (${r.count}×). The copywriter wrote the literal value; we replaced it so future snippet edits propagate.`,
    ))
  }

  // Outline coverage telemetry — did every section in the outline
  // come back with copy? The auto-iterate loop reads this to know
  // whether to retry per section. No-half-done-pages rule: a page
  // isn't complete until every outline section has a corresponding
  // drafted section (or is explicitly flagged unresolved).
  const outlineSectionsCount = outline ? (outline.sections?.length ?? 0) : 0
  const draftedSectionsCount = Array.isArray(sections) ? sections.length : 0
  const sectionsMatch        = outline ? draftedSectionsCount >= outlineSectionsCount : true
  const atomIdsRequested     = atomIdsUsed.length
  const atomIdsResolved      = atomById.size
  const atomResolutionRate   = atomIdsRequested > 0 ? atomIdsResolved / atomIdsRequested : 1
  const outputTokensCount    = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  const truncationSuspected  = outputTokensCount >= MAX_OUTPUT_TOKENS * 0.9

  const draft = {
    sections,
    deviation_note: (toolResult as any)?.deviation_note ?? null,
    validation,
    _meta: {
      generated_at: new Date().toISOString(),
      model: MODEL,
      prompt_source: resolved.globalSource,
      has_project_addendum: resolved.hasProjectAddendum,
      feedback: feedback || null,
      redo_count: typeof previousDraft?._meta?.redo_count === 'number'
        ? previousDraft._meta.redo_count + (feedback ? 1 : 0)
        : 0,
      usage,
      // Resolution telemetry — drives the auto-iterate-until-resolved
      // logic. A page is "complete" only when:
      //   - sections_match (output count >= outline expected)
      //   - atom_resolution_rate is ≥ 0.95 (≥ 95% of requested atoms
      //     actually loaded from DB; lower = brief had fabricated IDs
      //     OR atoms were deleted between outline + draft)
      //   - truncation_suspected is false
      //   - validation.flags is empty
      used_outline:         !!outline,
      outline_sections:     outlineSectionsCount,
      drafted_sections:     draftedSectionsCount,
      sections_match:       sectionsMatch,
      atom_ids_requested:   atomIdsRequested,
      atom_ids_resolved:    atomIdsResolved,
      atom_resolution_rate: Math.round(atomResolutionRate * 100) / 100,
      truncation_suspected: truncationSuspected,
      truncation_pct:       outputTokensCount > 0 ? Math.round((outputTokensCount / MAX_OUTPUT_TOKENS) * 100) : 0,
    },
  }

  const prevPageDrafts = roadmapState.page_drafts ?? {}
  const { error: writeErr } = await sb.from('strategy_web_projects')
    .update({
      roadmap_state: {
        ...roadmapState,
        page_drafts: { ...prevPageDrafts, [pageSlug]: draft },
      },
    })
    .eq('id', projectId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({ ok: true, draft, validation, usage })
}

// ── Validation — same family of checks the legacy voice-pass uses,
// applied to fresh drafts. Anything that fails surfaces in the
// validation report so the Director can decide whether to re-draft.

const EM_DASH_RE = /—|–|--/g
const PARALLEL_CLAUSE_RE = /^[A-Z]\S*(?:\s\S+){0,2},\s+(not|but|and|yet|or)\s+\S+\.?$/i
const MAX_HEADING_WORDS = 8

function validatePageDraft(sections: any[], brief: any): {
  ok: boolean
  flags: Array<{ section_ix: number; kind: string; field: string; value: string }>
  unused_atoms: string[]
} {
  const flags: Array<{ section_ix: number; kind: string; field: string; value: string }> = []
  const usedAtomIds = new Set<string>()

  sections.forEach((s, ix) => {
    const copy = s?.copy ?? {}
    const heading = String(copy.heading ?? '').trim()
    if (heading) {
      const wc = heading.split(/\s+/).filter(Boolean).length
      if (wc > MAX_HEADING_WORDS) flags.push({ section_ix: ix, kind: 'heading_too_long', field: 'heading', value: heading })
      if (heading.includes('?')) flags.push({ section_ix: ix, kind: 'heading_has_question_mark', field: 'heading', value: heading })
      if (PARALLEL_CLAUSE_RE.test(heading)) flags.push({ section_ix: ix, kind: 'parallel_clause_heading', field: 'heading', value: heading })
    }

    const slotEmDashes: Array<[string, string]> = [
      ['heading', String(copy.heading ?? '')],
      ['tagline', String(copy.tagline ?? '')],
      ['description', String(copy.description ?? '')],
      ['body', String(copy.body ?? '')],
    ]
    for (const [field, val] of slotEmDashes) {
      const count = (val.match(EM_DASH_RE) ?? []).length
      if (count >= 2) flags.push({ section_ix: ix, kind: 'em_dash_overload', field, value: val })
    }

    for (const aid of (s?.atoms_used ?? [])) usedAtomIds.add(String(aid))
  })

  const assignedAtomIds = (brief?.atoms_assigned ?? []).map((a: any) => String(a.atom_id ?? '')).filter(Boolean)
  const unused = assignedAtomIds.filter((aid: string) => !usedAtomIds.has(aid))

  return { ok: flags.length === 0, flags, unused_atoms: unused }
}

/** Walk every text slot in every section and replace literal snippet
 *  expansions with `{{token}}`. Only triggers for snippet expansions
 *  that are unambiguous proper-noun-ish strings (length ≥ 3, contains
 *  a capital letter OR a digit, and is not a common English word).
 *  This keeps the substitution from over-replacing generic words.
 *
 *  Returns the list of substitutions made so the caller can log them
 *  as validation flags — the strategist sees that the copywriter
 *  wrote the literal and we cleaned it up. */
function enforceSnippets(
  sections: any[],
  snippets: Array<{ token: string; expansion: string }>,
): Array<{ token: string; expansion: string; where: string; count: number }> {
  if (!Array.isArray(sections) || snippets.length === 0) return []
  // Only replace expansions that LOOK like values worth tokenizing.
  // Skip generic words and very short strings to avoid over-replacement.
  const COMMON_WORDS = new Set([
    'the','and','a','an','our','your','their','of','to','for','in','on','at',
    'as','by','with','from','is','are','be','we','us','i','you','they',
    'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
    'church','god','jesus','christ','bible','faith','community','family',
    'love','hope','peace','joy','grace','mercy','prayer','worship','service',
  ])
  const eligible = snippets
    .filter(s => typeof s.expansion === 'string' && s.expansion.trim().length >= 3)
    .filter(s => !COMMON_WORDS.has(s.expansion.trim().toLowerCase()))
    .filter(s => /[A-Z]|\d/.test(s.expansion))   // proper noun / number / etc.
    // Sort by expansion length DESC so we replace longer expansions first
    // (e.g. "Desert Springs Church" before "Desert Springs"), preventing
    // a shorter match from clobbering a longer one.
    .sort((a, b) => b.expansion.length - a.expansion.length)
  if (eligible.length === 0) return []

  const replacements: Array<{ token: string; expansion: string; where: string; count: number }> = []

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const replaceInString = (raw: string, where: string): string => {
    let next = raw
    for (const s of eligible) {
      // Skip if already tokenized form is present — the model already
      // used the snippet correctly on at least one occurrence.
      const tokenLit = `{{${s.token}}}`
      // Use word-boundary regex so "Desert Springs" doesn't match
      // inside "Desert Springsteen" or similar.
      const re = new RegExp(`(?<![A-Za-z0-9_{}])${escapeRegex(s.expansion)}(?![A-Za-z0-9_])`, 'g')
      const matches = next.match(re)
      if (!matches || matches.length === 0) continue
      next = next.replace(re, tokenLit)
      replacements.push({ token: s.token, expansion: s.expansion, where, count: matches.length })
    }
    return next
  }

  const walkValue = (value: unknown, where: string): unknown => {
    if (typeof value === 'string') return replaceInString(value, where)
    if (Array.isArray(value)) return value.map((v, i) => walkValue(v, `${where}[${i}]`))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = walkValue(v, `${where}.${k}`)
      return out
    }
    return value
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (!s || typeof s !== 'object') continue
    if (s.copy && typeof s.copy === 'object') {
      s.copy = walkValue(s.copy, `section[${i}].copy`)
    }
  }
  return replacements
}
