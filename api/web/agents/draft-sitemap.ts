/**
 * Vercel Serverless Function — /api/web/agents/draft-sitemap
 *
 * Phase C-2: Stage 2 of the Content Manager AI pipeline.
 * Consumes Stage 1's strategic foundation + all intake sources and
 * proposes a strategic sitemap: page list with rationale + outlines,
 * navigation structure, vocabulary decisions, AEO/GEO keyword targets,
 * and CS flags.
 *
 * Adapts the team's sitemap-generator skill (see
 * references/sitemap-strategy.md). The Notion delivery sub-steps and
 * partner-facing artifact assembly don't apply — this endpoint writes
 * structured JSON to strategy_web_projects.roadmap_state.stage_2 for
 * downstream stages and the Sitemap workspace to consume.
 *
 * Authentication: AI_GATEWAY_API_KEY (local) or VERCEL_OIDC_TOKEN
 * (auto-injected on Vercel deploys), same pattern as Stage 1.
 *
 * Stage transition: strategy_done → drafting_sitemap → sitemap_done.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { generateText, jsonSchema, tool } from 'ai'

// Vercel serverless functions default to a short timeout (10s Hobby / 60s
// Pro). Stage 2's full intake + 20K output ceiling can exceed that on
// cold-start runs. Opt into the Pro 300s ceiling so the agent has room.
export const maxDuration = 300

// Stage 2 makes voice-critical decisions (nav structure, page naming
// vocabulary) AND must rigorously account for every fact in the content
// collection. That's the same shape as Stage 1 (foundational synthesis) —
// Opus 4.7 handles it noticeably better than Sonnet on early testing
// (Sonnet emitted duplicate-label nav structures like "About > About,
// Beliefs" that Opus catches as malformed). With the lean schema (~5K
// output target) Opus has plenty of headroom under its output cap.
const MODEL = 'anthropic/claude-opus-4-7'
const MAX_OUTPUT_TOKENS = 12000

const TEXT_FORMATS = new Set([
  'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv',
])
const PDF_FORMAT = 'application/pdf'
const UNSUPPORTED_FORMATS = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

interface PreflightFile {
  category: string
  filename: string
  mime_type: string | null
  storage_url: string
  text?: string
  base64?: string
  error?: string
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  const missing: string[] = []
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!gatewayKey) missing.push('AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN on Vercel)')
  if (missing.length) {
    return res.status(500).json({ error: `Missing required environment variables: ${missing.join(', ')}` })
  }

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization']
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })

  const authClient = createClient(supabaseUrl, anonKey)
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  // ── Input ───────────────────────────────────────────────────────────
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null
  const redoContext = typeof req.body?.redoContext === 'string' ? req.body.redoContext.trim() : ''
  const mock = req.body?.mock === true
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Load project ────────────────────────────────────────────────────
  const { data: project, error: projErr } = await sb
    .from('strategy_web_projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) return res.status(404).json({ error: projErr?.message ?? 'Project not found' })

  const roadmapState = project.roadmap_state as { stage_1?: Record<string, unknown>; stage_2?: Record<string, unknown> } | null
  const stage1 = roadmapState?.stage_1
  if (!stage1) {
    return res.status(400).json({ error: 'Stage 1 extraction must be complete before Stage 2 can run.' })
  }
  // If a redo is happening and a previous proposal exists, include it as
  // context so the model refines rather than rewriting from scratch.
  const previousStage2 = redoContext ? roadmapState?.stage_2 : null

  // ── Mock short-circuit ──────────────────────────────────────────────
  if (mock) {
    const canned = buildMockSitemap(project, stage1)
    const { error: writeErr } = await sb
      .from('strategy_web_projects')
      .update({
        roadmap_state: {
          ...(project.roadmap_state ?? {}),
          stage_2: {
            ...canned,
            _meta: {
              model: 'mock',
              usage: { input_tokens: 0, output_tokens: 0 },
              extracted_at: new Date().toISOString(),
              redo_context: null,
              mocked: true,
            },
          },
        },
        roadmap_stage: 'sitemap_done',
      })
      .eq('id', projectId)
    if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
    return res.status(200).json({ ok: true, sitemap: canned, usage: { input_tokens: 0, output_tokens: 0 }, mock: true })
  }

  // ── Load intake from DB ─────────────────────────────────────────────
  const member = project.member as number
  const [accountRes, brandRes, discoveryRes, intakeDocsRes] = await Promise.all([
    sb.from('strategy_account_progress').select('member, handoff_web_form, church_name').eq('member', member).maybeSingle(),
    sb.from('strategy_brand_guides').select('*').eq('member', member).eq('is_published', true).order('last_updated_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('strategy_discovery_questionnaire').select('*').eq('member', member).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('web_intake_documents').select('*').eq('web_project_id', projectId).eq('archived', false).order('uploaded_at', { ascending: false }),
  ])

  const accountHandoff = accountRes.data?.handoff_web_form ?? null
  const churchName = (accountRes.data as any)?.church_name ?? null
  const brandGuide = brandRes.data ?? null
  const discoveryQuestionnaire = discoveryRes.data ?? null
  const intakeDocs = intakeDocsRes.data ?? []

  // ── Pre-flight: load all uploaded files ─────────────────────────────
  const filesLoaded: PreflightFile[] = []
  const filesFailed: PreflightFile[] = []

  await Promise.all(intakeDocs.map(async (doc: any) => {
    const base: PreflightFile = {
      category: doc.category,
      filename: doc.filename,
      mime_type: doc.mime_type,
      storage_url: doc.storage_url,
    }
    try {
      if (UNSUPPORTED_FORMATS.has(doc.mime_type ?? '')) {
        filesFailed.push({ ...base, error: `Format not yet supported: ${doc.mime_type}. Convert to .pdf or .md.` })
        return
      }
      const r = await fetch(doc.storage_url)
      if (!r.ok) throw new Error(`Fetch ${r.status}`)
      if (TEXT_FORMATS.has(doc.mime_type ?? '') || /\.(md|txt|csv|markdown)$/i.test(doc.filename)) {
        const text = await r.text()
        filesLoaded.push({ ...base, text })
      } else if (doc.mime_type === PDF_FORMAT || doc.filename.toLowerCase().endsWith('.pdf')) {
        const ab = await r.arrayBuffer()
        filesLoaded.push({ ...base, base64: Buffer.from(ab).toString('base64') })
      } else {
        filesFailed.push({ ...base, error: `Unrecognized format: ${doc.mime_type ?? 'unknown'}` })
      }
    } catch (e) {
      filesFailed.push({ ...base, error: e instanceof Error ? e.message : 'Read failed' })
    }
  }))

  if (filesFailed.length > 0) {
    return res.status(400).json({
      error: 'One or more intake files could not be read.',
      files_failed: filesFailed.map(f => ({ category: f.category, filename: f.filename, mime_type: f.mime_type, error: f.error })),
    })
  }

  // ── Mark stage as drafting ──────────────────────────────────────────
  await sb.from('strategy_web_projects').update({ roadmap_stage: 'drafting_sitemap' }).eq('id', projectId)

  // ── Build prompt + content blocks ───────────────────────────────────
  const systemPrompt = buildSystemPrompt()
  const userContent = buildUserContent({
    project, churchName, accountHandoff, brandGuide, discoveryQuestionnaire, stage1,
    filesLoaded, redoContext, previousStage2,
  })

  // ── Call model via AI Gateway ───────────────────────────────────────
  let toolResult: Record<string, unknown> | null = null
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const result = await generateText({
      model: MODEL,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent as any }],
      tools: {
        submit_sitemap: tool({
          description: SITEMAP_TOOL.description,
          inputSchema: jsonSchema(SITEMAP_TOOL.input_schema as any),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'submit_sitemap' },
    })
    usage = {
      input_tokens: result.usage?.inputTokens,
      output_tokens: result.usage?.outputTokens,
    }
    const toolCall = result.toolCalls?.[0]
    if (!toolCall || toolCall.toolName !== 'submit_sitemap') {
      throw new Error('Model did not return the expected tool call')
    }
    let raw = toolCall.input as Record<string, unknown>
    // Unwrap potential redundant top-level envelope (same pattern as Stage 1)
    if (
      raw && typeof raw === 'object'
      && Object.keys(raw).length === 1
      && raw.sitemap && typeof raw.sitemap === 'object'
    ) {
      raw = raw.sitemap as Record<string, unknown>
    }
    toolResult = raw
  } catch (err: any) {
    // Roll back so user can retry
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'strategy_done' }).eq('id', projectId)
    console.error('[draft-sitemap] gateway error:', err?.message)
    return res.status(502).json({ error: `AI Gateway error: ${err?.message ?? 'unknown'}` })
  }

  // ── Persist + advance stage ─────────────────────────────────────────
  const patch = {
    stage_2: {
      ...toolResult,
      _meta: {
        model: MODEL,
        usage,
        extracted_at: new Date().toISOString(),
        redo_context: redoContext || null,
        files_loaded: filesLoaded.map(f => ({ category: f.category, filename: f.filename })),
      },
    },
  }

  const { error: writeErr } = await sb
    .from('strategy_web_projects')
    .update({
      roadmap_state: { ...(project.roadmap_state ?? {}), ...patch },
      roadmap_stage: 'sitemap_done',
    })
    .eq('id', projectId)

  if (writeErr) {
    await sb.from('strategy_web_projects').update({ roadmap_stage: 'strategy_done' }).eq('id', projectId)
    return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })
  }

  return res.status(200).json({
    ok: true,
    sitemap: toolResult,
    usage,
    files_loaded: filesLoaded.map(f => ({ category: f.category, filename: f.filename })),
  })
}

// ── System prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are the Sitemap Architect for Church Media Squad's Content Manager pipeline. Stage 2 of 5. You receive Stage 1's strategic foundation (audience, voice, personas, x-factor, project goals, sitemap signals, sources) plus the original intake sources, and you propose a LEAN strategic sitemap.

# Scope (important)
Your output is the SITEMAP only:
- The page list (which pages, what phase, what they're for)
- The navigation structure
- Vocabulary decisions (why "Sundays" instead of "Plan a Visit", etc.)
- AEO/GEO keyword targets
- CS flags (blockers, assumptions, design notes)

You do NOT write page outlines (hero headlines, section structure, CTAs).
That's Stage 4's job, one page at a time, with prompt caching and full
attention budget per page. Keep your per-page output tight: one sentence
of strategic_purpose + one sentence of rationale + density label. The
strategist reads this to approve the page set, then Stage 4 expands each.

# Core principles

**1. Less is more.** Aim for the smallest page count that gives every important content item a home. Stage 1's recommended_pages is a first proposal — challenge it. Density-driven nesting beats page proliferation.

**2. Phase 1 vs Phase 2 is a LAUNCH SEQUENCING decision, not a nav structure decision.**

The proposed nav tree must reflect the FULL site (Phase 1 + Phase 2 pages together), exactly as visitors will see it post-Phase 2. Phase 2 pages are real pages on the real site; they belong in the nav with appropriate parents and groupings. Don't bury Phase 2 pages under arbitrary "future" groupings just because they're not launching first.

Phase 1 selection (which pages launch first):

Mandatory 4 (always Phase 1, no exceptions):
- Homepage
- Plan a Visit / Next Steps (whatever the church names it)
- Sermons / Watch / Messages (whatever the church names it)
- Give / Generosity (whatever the church names it)

Pick 2 more from: About / Our Story, Kids Ministry, What We Believe / Beliefs, Meet Our Team / Staff. Choose based on the church's primary audience and stated goals. Only pick 2 → Phase 1 totals 6.

**Bilingual override:** Any Spanish-language or non-English congregation gets a dedicated Phase 1 page (legitimate path to 7).

**3. Phase 2 = everything else.** Cap total Phase 1 + Phase 2 at 20 pages. Consolidate when count threatens to exceed:
- Combine Men's + Women's → "Adults" with sections
- Combine Local + Global Outreach → "Outreach"
- Roll Baptism + New Believer into Discipleship / Next Steps
- Move Membership into an About section

Note every consolidation in absorbed_content.

**4. Vocabulary fits the voice.** Default names like "Plan a Visit," "About Us," "Sermons" are safe but generic. Match the church's voice register from Stage 1's voice_characteristics.top_attributes:

- Bold / city / grit voice → "Sundays," "Who We Are," "Listen"
- Formal / traditional → "Visit," "Our Story," "Sermons"
- Conversational → "First Time?," "Us," "Watch"
- Thematic groupings (Reality LA pattern) → "Jesus / You / Us"
- Action verbs (Austin Stone pattern) → "Take / Attend / Join / Go / Learn / Lead / Serve"
- Minimal → "Visit," "About," "Watch," "Give"

When voice is unclear, default conservative. Don't force novelty. Record every non-default choice in vocabulary_decisions.

**5. Nav patterns.** Pick one that fits:
- flat: each item is a page. Best for simple sites.
- grouped_dropdowns: parent labels reveal child pages. Best for 10+ pages.
- thematic_groups: themed parent labels (Reality LA's Jesus / You / Us).
- thematic_verbs: action labels (Austin Stone's Take / Attend / Join).
- offcanvas: slide-in menu for 15+ pages.
- megamenu: wide grid dropdown for large churches.

Default conservative: flat or grouped_dropdowns. Reserve thematic patterns for churches whose voice register supports it.

Primary nav max 6 items.

**Nav structure rules — these are non-negotiable:**

a) **Never label a dropdown parent with the same word as one of its children.**
   ❌ "About" dropdown containing { About, Beliefs, Our Team } — duplicates the parent word as a child page.
   ✅ "About" as a STANDALONE PAGE that links inline to Beliefs / Our Team within its content.
   ✅ "Who We Are" (or "Our Church", or "The Story") as a dropdown PARENT label containing { About / Story, Beliefs, Team }.
   The parent label must describe the grouping, not duplicate a child.

b) **Don't create a dropdown for fewer than 3 meaningful children.** If you have 2 or fewer children, make the parent a flat page and let the child concepts live inline as sections. Dropdowns are for scannable groupings, not for showing off.

c) **Semantic categorization — distinguish current-state from commitment pathway.**

   Pages serve two distinct purposes that frequently get confused:

   **Commitment pathway** (labels: "Next Steps", "Pathway", "Grow", "Get Connected"):
   - Grow Tracks, Baptism, Membership, Serve / Volunteer, Join a Group
   - Mental model: "I'm here. What's deeper?"

   **Current state** (labels: "Community", "What's Happening", "Life"):
   - Events, Stories / Testimonies, News, Recent baptisms, Life-change highlights
   - Mental model: "What's alive at this church right now?"

   These do not belong in the same dropdown:
   ❌ Events under "Next Steps" → Events are current state, not commitment depth. A first-time visitor looking for "Kingdom Women Conference" isn't taking a next step, they're browsing what's alive at the church. Put Events under "Community" / "What's Happening" / standalone.
   ❌ Stories / testimonies under "Next Steps" → Stories are proof of community + life change, not commitment pathway. They belong under "Community" / "Stories" / "About".

   Special signal: if AM handoff or content collection emphasizes FOMO as a strategy lever (curated clips, healthy in-person attendance, life-change stories driving visitors in), promote Events and Stories to higher nav prominence — top-level or under "Community" — not buried under "Next Steps".

   Other common categorization failures:
   ❌ Teens grouped under "Kids" → Teens and kids are distinct audiences. Group as "Kids & Students" or "Generations" or as separate items.
   ❌ Blog under "Sermons" → Sermon blog can live there if labeled clearly, but a general blog belongs elsewhere or footer.
   ❌ "Membership" as primary nav → Almost always footer or About-page section.

   Every grouping must pass: "If a visitor asked 'why are these together?', would the answer be obvious?"

   **Audience-specific pages stay distinct.** Each age group / audience served has its own page with its own context:
   - Kids ministry → its own page
   - Teens / Students → its own page
   - Young Adults → its own page (if church serves them)
   - Men's ministry → its own page (if church serves them)
   - Women's ministry → its own page (if church serves them)
   - Adults / Marrieds → its own page
   - Care / Counseling / Recovery → its own page (or combined if related)

   ❌ Consolidating Kids + Teens + Adults + Care into a generic "Ministries" page → drops the distinct audience context. Each group has different content needs, different parent concerns, different next steps.
   ✅ Keep them as separate pages, group them under a "Ministries" or "Community" dropdown in the nav.

   Only consolidate when content density is genuinely thin AND the audiences overlap (e.g. "Men's" and "Women's" combined into "Adults" only when each has fewer than ~3 sections of unique content). Default is separate pages.

d) **Voice-match audit (CRITICAL).** Before submitting, audit EVERY nav label against Stage 1's voice_characteristics.top_attributes and the X-factor. A label that contradicts the voice is a failure even if it's grammatical.
   Examples:
   ❌ "Listen" when Stage 1 voice says "This isn't a church you watch. It's a church you build with." → passive verb directly contradicts the active voice. Use "Messages" or "Sermons" instead.
   ❌ Generic "About" when X-factor is "Relational Community" → Use "Our Church" or "Community" or "Who We Are" to honor the X-factor.
   ❌ "Get Involved" when voice is "Grit / Direct" → too soft. Use "Serve" or "Build With Us".
   The X-factor (from x_factor.top_attribute) should be a nav vocabulary driver. If X-factor is "Relational Community", "Community" is the natural dropdown label. If X-factor is "Honest Welcome", that shapes the visit page name.

e) **Goal-match audit.** If discovery_questionnaire or project_goals include "help first-time visitors find information easily" (or similar), then INSIDER LANGUAGE in primary nav is a failure:
   ❌ "ECC Kids" (insider branding) in nav → use "Kids" / "Children". Insider branding goes on the page, not in nav.
   ❌ "Our Story" / "What We Believe" when goal is visitor-clarity → use "About" / "Beliefs" or even more concrete like "Find a Church" / "First Time".
   When the partner's stated goal is visitor accessibility, default nav names beat clever insider names.

f) **Match the voice register on vocabulary when goal supports it.** If Stage 1's top_attributes include words like "Bold", "Grit", "Direct" AND the goal is NOT pure visitor-clarity, push to:
   - "About" → "Who We Are" or "The Story"
   - "Sermons" → "Messages" (use partner vocabulary if they call them "Messages")
   - "Plan a Visit" → "Sundays" or "First Time"
   - "Get Involved" → "Serve" or "Build With Us"
   But the bolder name MUST pass rules (d) and (e). If voice says bold but goal says visitor-clarity, visitor-clarity wins.

f.5) **Partner vocabulary alignment — use their terms inside dropdowns.** When the church has a specific term for a concept (e.g., "Grow Tracks" for discipleship, "Disciples Serve" for volunteering, "ECC Littles" for the youngest kids), use THEIR term as the page label inside a dropdown. Don't use the generic concept name as both parent and child.

   Example for Evangel (whose discipleship pathway is called "Grow Tracks"):
   ❌ "Next Steps" dropdown containing { "Grow Tracks & Baptism" } → clunky pairing; the child label fights the parent label by repeating the next-step concept. Also: if the page lives at /next-steps, the parent dropdown and child slug collapse into the same idea.
   ✅ "Grow" dropdown containing { "Grow Tracks", "Baptism", "Serve" } → uses partner vocabulary, aligns with their footer "Grow" section.
   ✅ "Next Steps" dropdown containing { "Get Baptized", "Join a Grow Track", "Find Your Place" } → action-oriented children that don't duplicate the parent concept.

   The principle: the dropdown PARENT names the destination type, the child labels name specific actions or partner-terminology pages.

g) **Footer / header vocabulary coherence.** If you create a footer section called "Grow" (containing pathway pages), don't use a different word in the header for the same concept. Pick ONE term per concept and use it consistently across header_nav and footer_nav. Same rule for "Community", "About", "Connect", "Watch", etc. Inconsistency makes the strategist's job harder when they reconcile the two trees.

h) **Visitor language wins over insider language.** Visitor searches for "find a church" not "I'm New." Visitor types "kids ministry" not "next gen." When in doubt, pick the term a visitor would type into Google.

i) **Avoid generic dropdowns like "Resources" or "More."** They hide content instead of organizing it. If you can't name a grouping with specific intent, the pages shouldn't be grouped.

j) **Every page must be in EITHER the header OR the footer.** No page may be unaccounted for in the nav structure. If a page isn't in the primary header nav, it must appear in footer_nav (with a section like "Connect" / "Resources" / "About"). This includes: Contact, Privacy Policy, Share Your Story (if not primary), Sermon Blog (if not primary), Membership, Job openings, Newsletter signup, etc. The strategist should never have to ask "where does X live?" — the answer is always visible in header_nav or footer_nav.

**6. Density signals:**
- high = enough unique content for a robust page
- medium = adequate; may need section work
- low = absorb into a parent page or drop

**7. Phase tagging:**
- '1' = MVP launch
- '2' = post-launch parking lot
- 'nav-only' = item in nav, page not built (external link/archive)
- 'global' = chrome

# AEO / GEO

For each page, think:
- Direct answer structure (who/what/where/when questions)
- Entity clarity (church name + city + state)
- Intent matching (visitor language, not insider language)

Surface AEO notes on Plan a Visit, Contact, Sermons, Kids, Beliefs at minimum.

Provide aeo_keywords:
- primary: 2–3 high-intent local terms
- secondary: 5–7 semantic variations
- long_tail: specific question phrases this church can own

Ground in church's actual location + denomination + audience. "Church near me" is not useful. Specific local terms are.

# Per-page fields (lean)

Every page in pages[] needs:
- name (display name, e.g., "Plan a Visit", "Sundays")
- slug (URL slug, e.g., "plan-a-visit")
- nav_label (what shows in nav; often same as name)
- phase ('1' | '2' | 'nav-only' | 'global')
- parent_slug (null for top-level; parent slug for nested)
- page_type ('content' | 'chrome' | 'functional')
- strategic_purpose (ONE sentence: what this page does for the visitor)
- rationale (ONE sentence: why this page exists, why named this way)
- content_sources (short list — which intake source(s) feed this page)
- density ('high' | 'medium' | 'low')

Do NOT emit hero direction, sections, or page-level CTAs. Those come
in Stage 4 per-page.

# Strategic discipline

- Be strategic, not literal. Challenge content collection where it lists 5 thin sub-pages.
- Every page traces to a source. Speculative pages → cs_flags.soft_assumptions.
- Use partner vocabulary (e.g., "Disciples Serve" if that's their volunteer term, "Messages" if that's their sermon term).
- Vocabulary decisions explained in vocabulary_decisions.

# Coverage audit (CRITICAL — do not skip)

Before submitting, walk through the content collection and list every
concrete content item — every ministry name, every service time, every
program, every staff role, every event type, every external platform
mentioned. For each, populate \`content_coverage_audit\` with:

- \`content_item\`: the name as it appears in the content collection
- \`landed_on\`: the slug of the page where it lives, OR a parent page +
  section if nested, OR \`null\` if dropped/absorbed
- \`status\`: \`'placed'\` (got a page), \`'nested'\` (lives as section on
  another page), \`'navonly'\` (in nav but no built page), or \`'dropped'\`
  (intentionally not included — strategy brief said so, or duplicate)
- \`note\` (optional): rationale for nested/dropped status

Every named item in the content collection must appear in this audit.
If you find yourself unable to account for something, add it to
\`cs_flags.soft_assumptions\` for the strategist to verify. Dropping
content silently is the failure mode this audit prevents.

**content_coverage_audit is REQUIRED. Empty or missing array = failure.** Walk the content collection systematically:
- Every ministry name (ECC Littles, ECC Kids, ECC Teens, ECC Women, ECC Men, ECC Marrieds, Celebrate Recovery, Healing Rooms, Care Team, Life Groups, etc.)
- Every program (Grow Tracks, baptism process, Disciples Serve volunteer track)
- Every service time and special service mentioned
- Every staff person / role mentioned
- Every event series or type (First Fridays, Kingdom Women Conference, etc.)
- Every external platform (YouTube, Pressable, Mailchimp, Clover, Apple Podcast)
- Every giving method / payment platform
- Address, phone, contact details

Each gets one row in content_coverage_audit. The audit is how the strategist verifies you haven't dropped anything.

# CS flags

- hard_blockers: copy cannot be written without resolving. Specific page + what's missing.
- soft_assumptions: verify with partner/AM. What was assumed + how to verify.
- design_flags: route to Web Director. Page + technical consideration.

# Voice rules (carry from Stage 1)

Apply to every string you emit:
- No em-dashes (— or –). Periods or commas instead.
- No three-adjective clusters. Pick the single strongest word.
- No filler intensifiers: truly, really, deeply, incredibly, very, amazing, just, simply.
- No AI clichés: delve, tapestry, unlock, unleash, elevate, beacon, embark, resonate, dynamic, synergistic, game-changer, seamless, robust, leverage, transformative, vibrant, foster, pivotal, paramount.
- No church clichés: "come as you are," "life-changing," "vibrant community," "spiritual journey," "walk with God."
- No "We / Our" framing for partner-facing copy. Refer to church by name.
- Jesus is the destination. Programs are the vehicle. Name Jesus explicitly at least once across the page outlines.

# Output

Submit your complete sitemap via the submit_sitemap tool. Cover every required field.`
}

// ── User content assembly ─────────────────────────────────────────────

interface UserContentInputs {
  project: any
  churchName: string | null
  accountHandoff: unknown
  brandGuide: any
  discoveryQuestionnaire: any
  stage1: Record<string, unknown>
  filesLoaded: PreflightFile[]
  redoContext: string
  /** Previous Stage 2 proposal — only set on redo. When present, the
   *  model refines that proposal rather than rewriting from scratch. */
  previousStage2: Record<string, unknown> | null | undefined
}

function buildUserContent(inputs: UserContentInputs): unknown[] {
  const blocks: unknown[] = []

  blocks.push({
    type: 'text',
    text: `# Project: ${inputs.project.name}
Church: ${inputs.churchName ?? '(unknown)'}
Member: ${inputs.project.member}
Engagement type: ${inputs.project.kind ?? 'unknown'}`,
  })

  // Stage 1 — the most important input
  blocks.push({
    type: 'text',
    text: `# Stage 1 strategic foundation (THE PRIMARY INPUT)\n\nThis is the synthesized strategy from Stage 1. Use it to drive vocabulary, nav pattern, and page selection.\n\n\`\`\`json\n${JSON.stringify(stripMeta(inputs.stage1), null, 2)}\n\`\`\``,
  })

  // AM handoff
  if (inputs.accountHandoff && typeof inputs.accountHandoff === 'object' && Object.keys(inputs.accountHandoff).length > 0) {
    blocks.push({
      type: 'text',
      text: `# Source: AM Handoff\n\n\`\`\`json\n${JSON.stringify(inputs.accountHandoff, null, 2)}\n\`\`\``,
    })
  }

  appendCategoryFiles(blocks, inputs.filesLoaded, 'am_handoff_supplemental', 'AM Handoff supplemental upload')

  // Strategy brief
  blocks.push({ type: 'text', text: '# Source: Strategy Brief' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'strategy_brief', 'Strategy Brief file')

  // Discovery questionnaire
  if (inputs.discoveryQuestionnaire) {
    blocks.push({
      type: 'text',
      text: `# Source: Discovery Questionnaire\n\n\`\`\`json\n${JSON.stringify(redactNulls(inputs.discoveryQuestionnaire), null, 2)}\n\`\`\``,
    })
  }
  appendCategoryFiles(blocks, inputs.filesLoaded, 'discovery_questionnaire_supplemental', 'Discovery Questionnaire supplemental upload')

  // Brand handoff
  if (inputs.brandGuide) {
    const guide = inputs.brandGuide
    blocks.push({
      type: 'text',
      text: `# Source: Brand Handoff
Display name: ${guide.display_name ?? '—'}
Style tags: ${(guide.style_tags ?? []).join(', ') || '—'}
Brand statement: ${guide.brand_statement ?? '—'}

Voice overview:
${guide.voice_overview ?? '(none)'}`,
    })
  }

  // Content collection — most important for page density decisions
  blocks.push({ type: 'text', text: '# Source: Content Collection (drives page list + density decisions)' })
  appendCategoryFiles(blocks, inputs.filesLoaded, 'content_collection', 'Content Collection file')

  if (inputs.previousStage2) {
    // Strip _meta before sharing back to the model — it's bookkeeping
    const { _meta: _, ...prevWithoutMeta } = inputs.previousStage2 as { _meta?: unknown; [k: string]: unknown }
    void _
    blocks.push({
      type: 'text',
      text: `# Previous proposal (LOCKED — refine only what feedback names)\n\nThis is your previous proposal. It is the LOCKED BASELINE. The strategist's feedback follows in the next block.\n\n\`\`\`json\n${JSON.stringify(prevWithoutMeta, null, 2)}\n\`\`\``,
    })
  }

  if (inputs.redoContext) {
    blocks.push({
      type: 'text',
      text: `# Strategist's redo feedback\n\n${inputs.redoContext}\n\n# How to apply this feedback (read carefully)\n\n**The previous proposal is LOCKED except for the specific items the feedback names.**\n\nWhat that means concretely:\n\n1. **Page list:** Do not add, remove, rename, or consolidate any page unless the feedback explicitly says to. If the feedback mentions Events and Grow Tracks, only those change. Every other page (and its slug, name, parent, density, content_sources) stays IDENTICAL to the previous proposal — copy them through verbatim.\n\n2. **Nav structure:** Do not move, rename, or restructure any nav item, dropdown parent, or dropdown child unless the feedback names it. Header_nav and footer_nav stay byte-for-byte identical except where the feedback explicitly requests change.\n\n3. **Coverage audit, vocabulary decisions, AEO keywords, sources_used, cs_flags:** Carry forward verbatim from the previous proposal unless the feedback names them. If the previous proposal had a content_coverage_audit, COPY IT — do not regenerate it from scratch.\n\n4. **No "while I'm in here" improvements.** If you notice something you'd change but the strategist didn't mention, leave it. The strategist will request it in a future redo if they want it changed.\n\n5. **Test:** After drafting, walk every page in your output and ask "did the feedback explicitly name this for change?" If no, the page must match the previous proposal exactly. If you find yourself consolidating, renaming, or dropping a page that wasn't in the feedback — STOP and copy the previous version.\n\nThis is the most important rule of redo. Overstepping breaks the strategist's trust. The previous proposal had decisions you made for reasons — preserve them unless told otherwise.`,
    })
  }

  blocks.push({
    type: 'text',
    text: `Now propose the LEAN sitemap via the submit_sitemap tool.

Before submitting, run these audits in your head and revise until you pass each:

1. **Voice contradiction check.** Look at Stage 1's voice top_attributes and tone_examples_do. Does every nav label in header_nav and footer_nav honor that voice? If voice is participatory, no passive labels like "Listen" / "Watch". If voice is bold, no soft labels like "Get Involved".

2. **Goal contradiction check.** Look at the partner's stated primary goal. If it's about visitor accessibility / clarity, scrub insider language out of header_nav. Insider terms (ECC Kids, internal program names) belong on the page body, not in nav.

3. **X-factor leverage.** Is the X-factor reflected in nav vocabulary? If X-factor is "Relational Community", "Community" as a dropdown label is the natural move. If you didn't use it, justify in nav_strategy.

4. **Categorization sanity.** Walk every group and ask "would a visitor expect THIS child to live under THIS parent?". Events under Next Steps fails. Stories under Next Steps fails. Teens under Kids fails.

5. **Coverage check.** Every page must appear in header_nav OR footer_nav. Every concrete content collection item must appear in content_coverage_audit with a status. Nothing dropped silently.

6. **No duplicate parent labels.** No dropdown labeled the same word as one of its children.

Phase 1 = 6 pages (target). Total ≤ 20. Density-driven nesting. Flag every assumption.`,
  })

  return blocks
}

function appendCategoryFiles(blocks: unknown[], files: PreflightFile[], category: string, prefix: string) {
  const matched = files.filter(f => f.category === category)
  if (matched.length === 0) {
    blocks.push({ type: 'text', text: `(No ${prefix.toLowerCase()} files uploaded)` })
    return
  }
  for (const f of matched) {
    if (f.text != null) {
      blocks.push({ type: 'text', text: `## ${prefix}: ${f.filename}\n\n${f.text}` })
    } else if (f.base64) {
      blocks.push({ type: 'file', data: f.base64, mediaType: 'application/pdf' })
      blocks.push({ type: 'text', text: `(↑ ${prefix}: ${f.filename})` })
    }
  }
}

function redactNulls(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  const out: any = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    out[k] = typeof v === 'object' ? redactNulls(v) : v
  }
  return out
}

function stripMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const { _meta, ...rest } = obj as { _meta?: unknown; [k: string]: unknown }
  void _meta
  return rest
}

// ── Structured output tool ────────────────────────────────────────────

const SITEMAP_TOOL = {
  name: 'submit_sitemap',
  description: 'Submit the proposed strategic sitemap for this church website project.',
  input_schema: {
    type: 'object' as const,
    required: ['nav_strategy', 'nav_voice_register', 'nav_pattern', 'phase_summary', 'pages', 'header_nav', 'footer_nav', 'content_coverage_audit', 'sources_used'],
    properties: {
      nav_strategy: {
        type: 'string',
        description: '2-3 sentences explaining how this church\'s nav reflects voice + audience.',
      },
      nav_voice_register: {
        type: 'string',
        enum: ['formal', 'conversational', 'bold', 'minimal', 'thematic'],
      },
      nav_pattern: {
        type: 'string',
        enum: ['flat', 'grouped_dropdowns', 'thematic_groups', 'thematic_verbs', 'offcanvas', 'megamenu'],
      },
      phase_summary: {
        type: 'object',
        required: ['phase_1_count', 'phase_2_count', 'total', 'rationale'],
        properties: {
          phase_1_count: { type: 'integer' },
          phase_2_count: { type: 'integer' },
          total: { type: 'integer' },
          rationale: { type: 'string', description: 'Why these counts. Explain consolidations and what got nested.' },
        },
      },
      pages: {
        type: 'array',
        description: 'Every page in the sitemap. LEAN — no hero, sections, or CTAs. Those come in Stage 4 per-page.',
        items: {
          type: 'object',
          required: ['name', 'slug', 'phase', 'page_type', 'strategic_purpose', 'rationale', 'density'],
          properties: {
            name: { type: 'string', description: 'Display name (e.g., "Plan a Visit," "Sundays").' },
            slug: { type: 'string', description: 'URL slug (e.g., "plan-a-visit").' },
            nav_label: { type: 'string', description: 'Label shown in nav (often same as name).' },
            phase: { type: 'string', enum: ['1', '2', 'nav-only', 'global'] },
            parent_slug: { type: ['string', 'null'], description: 'Null for top-level; parent slug for nested.' },
            page_type: { type: 'string', enum: ['content', 'chrome', 'functional'] },
            strategic_purpose: { type: 'string', description: 'ONE sentence: what this page does for the visitor.' },
            rationale: { type: 'string', description: 'ONE sentence: why this page exists, why named this way.' },
            content_sources: { type: 'array', items: { type: 'string' }, description: 'Short list of intake sources that feed this page.' },
            density: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      header_nav: {
        type: 'array',
        description: 'The primary header navigation tree. Items can be pages (kind="page") or groupings (kind="group") with children. Max 6 top-level items.',
        items: {
          type: 'object',
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['page', 'group'] },
            slug: { type: 'string', description: 'Required when kind=page.' },
            rationale: { type: 'string' },
            children: {
              type: 'array',
              items: {
                type: 'object',
                required: ['label', 'kind'],
                properties: {
                  label: { type: 'string' },
                  kind: { type: 'string', enum: ['page', 'group'] },
                  slug: { type: 'string' },
                  rationale: { type: 'string' },
                },
              },
            },
          },
        },
      },
      footer_nav: {
        type: 'array',
        description: 'Footer navigation — required. Group pages into sections like "Connect" / "About" / "Resources". Every page not in header_nav MUST appear here. Includes utility (Contact, Privacy), secondary content (Blog, Share Your Story), tertiary (Membership, Jobs).',
        items: {
          type: 'object',
          required: ['section_label', 'items'],
          properties: {
            section_label: { type: 'string', description: 'E.g., "Connect", "About", "Resources".' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['label'],
                properties: {
                  label: { type: 'string' },
                  slug: { type: 'string', description: 'For internal pages. Omit for external links.' },
                  url: { type: 'string', description: 'For external links (e.g., social media).' },
                },
              },
            },
          },
        },
      },
      absorbed_content: {
        type: 'array',
        description: 'Content items that got nested into other pages instead of becoming their own page.',
        items: {
          type: 'object',
          required: ['content_item', 'rationale'],
          properties: {
            content_item: { type: 'string', description: 'What the content collection called this thing.' },
            absorbed_into: { type: ['string', 'null'], description: 'Slug of the page that absorbs it; null if dropped.' },
            rationale: { type: 'string' },
          },
        },
      },
      content_coverage_audit: {
        type: 'array',
        description: 'Required. Every concrete content item in the content collection, with its destination. The strategist uses this to verify nothing got silently dropped.',
        items: {
          type: 'object',
          required: ['content_item', 'status'],
          properties: {
            content_item: { type: 'string', description: 'Name as it appears in the content collection.' },
            landed_on: { type: ['string', 'null'], description: 'Page slug where it lives, or null if dropped.' },
            status: {
              type: 'string',
              enum: ['placed', 'nested', 'navonly', 'dropped'],
              description: 'placed = got a page; nested = section of another page; navonly = nav link only; dropped = intentionally excluded.',
            },
            note: { type: 'string', description: 'Why nested or dropped, when relevant.' },
          },
        },
      },
      vocabulary_decisions: {
        type: 'array',
        description: 'Non-default naming choices with rationale tied to Stage 1 voice.',
        items: {
          type: 'object',
          required: ['we_chose', 'why'],
          properties: {
            instead_of: { type: 'string', description: 'The default name we passed on.' },
            we_chose: { type: 'string' },
            why: { type: 'string' },
          },
        },
      },
      aeo_keywords: {
        type: 'object',
        properties: {
          primary: { type: 'array', items: { type: 'string' }, description: '2-3 high-intent local terms.' },
          secondary: { type: 'array', items: { type: 'string' }, description: '5-7 semantic variations.' },
          long_tail: { type: 'array', items: { type: 'string' }, description: 'Specific question phrases.' },
        },
      },
      cs_flags: {
        type: 'object',
        properties: {
          hard_blockers: { type: 'array', items: { type: 'string' } },
          soft_assumptions: { type: 'array', items: { type: 'string' } },
          design_flags: { type: 'array', items: { type: 'string' } },
        },
      },
      sources_used: {
        type: 'object',
        required: ['conflicts_resolved'],
        properties: {
          stage_1: { type: 'string', description: 'How Stage 1 drove choices.' },
          content_collection: { type: 'string' },
          am_handoff: { type: 'string' },
          discovery_questionnaire: { type: 'string' },
          brand_handoff: { type: 'string' },
          strategy_brief: { type: 'string' },
          conflicts_resolved: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

// ── Mock sitemap (used when ?mock=true) ──────────────────────────────

function buildMockSitemap(project: any, _stage1: Record<string, unknown>): Record<string, unknown> {
  void _stage1
  void project
  return {
    nav_strategy: 'Mock run. Flat nav with city-tuned vocabulary. Six primary items keep the header scannable while honoring the church\'s direct voice.',
    nav_voice_register: 'bold',
    nav_pattern: 'flat',
    phase_summary: {
      phase_1_count: 6,
      phase_2_count: 7,
      total: 13,
      rationale: 'Phase 1 covers the mandatory four plus About + Kids per audience priorities. Phase 2 nests Care, Outreach, and Discipleship pages. Ministry sub-pages collapsed into a single Adults page.',
    },
    pages: [
      { name: 'Home',    slug: 'home',    phase: '1', page_type: 'content', strategic_purpose: 'Welcome visitors and route them to their next step.', rationale: 'Always Phase 1. Anchors the brand refresh online.', density: 'high', content_sources: ['Strategy Brief', 'Content Collection'] },
      { name: 'Sundays', slug: 'sundays', phase: '1', page_type: 'content', strategic_purpose: 'Help first-time visitors plan their first Sunday.', rationale: 'Replaces "Plan a Visit" — bolder voice fit.', density: 'high', content_sources: ['Content Collection'] },
      { name: 'Listen',  slug: 'listen',  phase: '1', page_type: 'content', strategic_purpose: 'Surface the most recent message and curated clips.', rationale: 'Replaces "Sermons" — voice fit.', density: 'high', content_sources: ['AM Handoff', 'Content Collection'] },
      { name: 'Give',    slug: 'give',    phase: '1', page_type: 'content', strategic_purpose: 'Make giving frictionless and trust-building.', rationale: 'Mandatory Phase 1 across every project.', density: 'high', content_sources: ['Content Collection'] },
      { name: 'About',   slug: 'about',   phase: '1', page_type: 'content', strategic_purpose: 'Tell the church story and introduce the team.', rationale: 'Chosen as Phase 1 because trust-building is primary goal.', density: 'high', content_sources: ['Strategy Brief', 'Content Collection'] },
      { name: 'Kids',    slug: 'kids',    phase: '1', page_type: 'content', strategic_purpose: 'Reassure parents and pre-register for kids ministry.', rationale: 'Chosen as Phase 1 because families are explicit target.', density: 'high', content_sources: ['Content Collection'] },
    ],
    header_nav: [
      { label: 'Sundays',   kind: 'page', slug: 'sundays' },
      { label: 'Messages',  kind: 'page', slug: 'messages' },
      { label: 'Community', kind: 'group', children: [
        { label: 'About', kind: 'page', slug: 'about' },
        { label: 'Kids',  kind: 'page', slug: 'kids' },
      ]},
      { label: 'Give', kind: 'page', slug: 'give' },
    ],
    footer_nav: [
      { section_label: 'Connect', items: [{ label: 'Contact', slug: 'contact' }, { label: 'Share Your Story', slug: 'share-your-story' }] },
      { section_label: 'About',   items: [{ label: 'Our Beliefs', slug: 'beliefs' }] },
    ],
    content_coverage_audit: [
      { content_item: '(Mock run — full audit lands on real runs.)', status: 'placed', landed_on: 'home' },
    ],
    absorbed_content: [
      { content_item: 'Apple Podcast', absorbed_into: null, rationale: 'Mock — Strategy Brief said don\'t promote.' },
    ],
    vocabulary_decisions: [
      { instead_of: 'Plan a Visit', we_chose: 'Sundays', why: 'Mock — voice fit.' },
      { instead_of: 'Sermons', we_chose: 'Listen', why: 'Mock — voice fit.' },
    ],
    aeo_keywords: {
      primary: ['mock church city', 'mock services city'],
      secondary: ['mock'],
      long_tail: ['mock'],
    },
    cs_flags: { hard_blockers: [], soft_assumptions: ['(Mock run.)'], design_flags: [] },
    sources_used: {
      stage_1: '(Mock run.)',
      conflicts_resolved: ['(Mock run.)'],
    },
  }
}
