/**
 * Vercel Serverless Function — /api/web/pages/import-from-url
 *
 * Mid-build escape hatch for pages the cowork pipeline missed.
 *
 * Use case: a partner sees you halfway through laying out their site
 * and asks "where's our future-fund campaign page?" — that content
 * already lives on their current site and there's no need to re-write
 * it. Drop the URL in, get a Brixies page that preserves the original
 * copy verbatim.
 *
 * Flow:
 *   1. Firecrawl /scrape on the target URL (markdown + html + links).
 *   2. Segment the markdown into cowork-shape sections:
 *        • Section 0: hero_inner — H1 + lead paragraph + top-of-page CTAs
 *        • Section 1: content_image_text_b — everything else as one
 *          long prose block (images stripped, inline links preserved)
 *        • Section 2 (optional): cta_callout — trailing standalone
 *          buttons cowork can re-anchor at the bottom
 *   3. For each section: bind through the schema-driven binder
 *      (composeFromCoworkAliasMap) which has all the recovery + non-
 *      canonical fold logic we added during the Arvada work.
 *   4. Insert web_pages + web_sections in one transaction-shaped batch.
 *
 * No writes to roadmap_state — this is a one-shot import, not a
 * cowork artifact. The page lands at content_status='draft' so the
 * strategist can review + tweak before partner sign-off.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import {
  composeFromCoworkAliasMap,
  type BrixiesTemplate,
  type BindResult,
} from '../cowork/handoff-to-pages.js'

export const maxDuration = 60

interface ScrapeResponse {
  ok?: boolean
  pages?: Array<{
    url: string
    title?: string
    content?: string   // markdown
    html?: string
    links?: string[]
    metadata?: Record<string, unknown>
  }>
  error?: string
}

interface SegmentedSection {
  template_key: string
  slot_values: Record<string, unknown>
}

interface ImportResult {
  ok:       true
  page_id:  string
  slug:     string
  name:     string
  sections: Array<{
    sort_order:        number
    content_template_id: string
    bind_quality:      'perfect' | 'partial'
    gaps_count:        number
  }>
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' })
  }

  const jwt = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer /, '') ?? null
  if (!jwt) return res.status(401).json({ error: 'Missing Authorization bearer token' })
  const { data: userData, error: userErr } = await createClient(supabaseUrl, anonKey).auth.getUser(jwt)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' })

  const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null
  const url       = typeof req.body?.url === 'string'        ? req.body.url.trim() : null
  const phase     = typeof req.body?.phase === 'string'      ? req.body.phase      : '1'
  const slugOverride = typeof req.body?.slug === 'string' && req.body.slug.trim()
    ? req.body.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    : null
  const nameOverride = typeof req.body?.name === 'string' && req.body.name.trim()
    ? req.body.name.trim()
    : null

  if (!projectId) return res.status(400).json({ error: 'project_id required' })
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'valid url required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  // ── Scrape ──────────────────────────────────────────────────────
  // Reuse the existing manual-scrape edge function (single URL path
  // with no commit/deeper-crawl). Faster than re-implementing the
  // Firecrawl wrapper here.
  const scrapeRes = await fetch(`${supabaseUrl}/functions/v1/manual-scrape`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ urls: [url] }),
  })
  if (!scrapeRes.ok) {
    const text = await scrapeRes.text()
    return res.status(502).json({ error: 'scrape_failed', detail: text.slice(0, 500) })
  }
  const scrape = await scrapeRes.json() as ScrapeResponse
  const page = scrape.pages?.[0]
  if (!page || !page.content) {
    return res.status(502).json({ error: 'scrape_empty', detail: 'Firecrawl returned no markdown for that URL.' })
  }

  // ── Derive page name + slug ─────────────────────────────────────
  const derivedSlug = slugFromUrl(url)
  const finalSlug = slugOverride ?? derivedSlug
  if (!finalSlug) return res.status(400).json({ error: 'slug_empty', detail: 'Could not derive a slug from the URL.' })

  const firstHeading = extractFirstHeading(page.content) || page.title || titleCase(finalSlug)
  const finalName = nameOverride ?? firstHeading

  // ── Slug uniqueness check ───────────────────────────────────────
  const { data: existing, error: existingErr } = await sb
    .from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('archived', false)
  if (existingErr) return res.status(500).json({ error: 'web_pages_load_failed', detail: existingErr.message })
  if ((existing ?? []).some(p => (p as { slug: string }).slug === finalSlug)) {
    return res.status(409).json({ error: 'slug_in_use', slug: finalSlug })
  }
  const nextSortOrder = (existing ?? []).length
    ? Math.max(...((existing ?? []) as Array<{ sort_order?: number }>).map(p => p.sort_order ?? 0)) + 1
    : 0

  // ── Segment markdown into cowork-shape sections ─────────────────
  const sections = segmentMarkdown(page.content, page.title ?? finalName)

  // ── Load Brixies templates + manifest ───────────────────────────
  const [manifestRes, brixiesRes] = await Promise.all([
    sb.schema('strategy').from('cowork_templates')
      .select('version, manifest')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('web_content_templates')
      .select('id, fields, cowork_alias_map')
      .eq('is_published', true),
  ])
  if (manifestRes.error || !manifestRes.data) {
    return res.status(500).json({ error: 'manifest_missing', detail: manifestRes.error?.message })
  }
  if (brixiesRes.error) {
    return res.status(500).json({ error: 'brixies_load_failed', detail: brixiesRes.error.message })
  }
  const manifest = (manifestRes.data as any).manifest as {
    page_section_templates: Record<string, { template_id: string; required_slots?: string[] }>
  }
  const templates = manifest?.page_section_templates ?? {}
  const brixiesById = new Map<string, BrixiesTemplate>(
    ((brixiesRes.data ?? []) as BrixiesTemplate[]).map(t => [t.id, t]),
  )

  // ── Bind each section ───────────────────────────────────────────
  const newPageId = crypto.randomUUID()
  const sectionRowsToInsert: Array<{
    id: string
    web_page_id: string
    content_template_id: string
    field_values: Record<string, unknown>
    sort_order: number
    content_status: string
    cowork_slot_values: Record<string, unknown>
    cowork_section_meta: Record<string, unknown>
    source_markdown: string
  }> = []
  const sectionAudits: ImportResult['sections'] = []

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]
    const entry = templates[sec.template_key]
    if (!entry) {
      return res.status(500).json({
        error: 'template_key_missing',
        detail: `Manifest has no entry for '${sec.template_key}' — cannot bind.`,
      })
    }
    const brixies = brixiesById.get(entry.template_id)
    if (!brixies) {
      return res.status(500).json({
        error: 'brixies_template_missing',
        detail: `web_content_templates has no '${entry.template_id}' for archetype '${sec.template_key}'.`,
      })
    }
    const bound: BindResult = composeFromCoworkAliasMap(
      sec.slot_values,
      brixies,
      sec.template_key,
      entry.required_slots ?? [],
    )

    sectionRowsToInsert.push({
      id: crypto.randomUUID(),
      web_page_id: newPageId,
      content_template_id: entry.template_id,
      field_values: bound.field_values,
      sort_order: i,
      content_status: 'draft',
      cowork_slot_values: sec.slot_values,
      cowork_section_meta: {
        template_key:    sec.template_key,
        bind_quality:    bound.bind_quality,
        gaps:            bound.gaps,
        source:          'imported_from_crawl',
        source_url:      url,
        dropped_content: bound.dropped_content,
      },
      source_markdown: '', // raw section markdown captured below
    })
    sectionAudits.push({
      sort_order: i,
      content_template_id: entry.template_id,
      bind_quality: bound.bind_quality,
      gaps_count:   bound.gaps.length,
    })
  }

  // ── Insert page + sections ──────────────────────────────────────
  const { error: pageInsErr } = await sb.from('web_pages').insert({
    id: newPageId,
    web_project_id: projectId,
    name: finalName,
    slug: finalSlug,
    phase,
    sort_order: nextSortOrder,
    archived: false,
    content_status: 'draft',
    cowork_handoff_meta: {
      source:     'imported_from_crawl',
      source_url: url,
      imported_at: new Date().toISOString(),
      section_count: sections.length,
    },
  })
  if (pageInsErr) {
    return res.status(500).json({ error: 'page_insert_failed', detail: pageInsErr.message })
  }
  const { error: secInsErr } = await sb.from('web_sections').insert(
    sectionRowsToInsert.map(({ source_markdown: _, ...row }) => row),
  )
  if (secInsErr) {
    // Roll back the page row if sections failed — keeps the project clean.
    await sb.from('web_pages').delete().eq('id', newPageId)
    return res.status(500).json({ error: 'sections_insert_failed', detail: secInsErr.message })
  }

  const result: ImportResult = {
    ok: true,
    page_id:  newPageId,
    slug:     finalSlug,
    name:     finalName,
    sections: sectionAudits,
  }
  return res.status(200).json(result)
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Derive the slug from a URL's pathname — last non-empty segment.
 *  "https://example.com/give/future-fund/" → "future-fund". */
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const last  = parts[parts.length - 1] ?? ''
    return last.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  } catch {
    return ''
  }
}

function extractFirstHeading(markdown: string): string | null {
  const m = markdown.match(/^#{1,3}\s+(.+?)\s*$/m)
  return m ? m[1].trim() : null
}

function titleCase(slug: string): string {
  return slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/** Strip image markdown and surrounding empty lines. */
function stripImages(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n')
}

/** Decide whether a markdown link is a standalone button (short label,
 *  alone on a line, no surrounding prose) vs an inline link inside a
 *  paragraph. Standalone buttons become section.buttons[]; inline
 *  links stay in the prose. */
const BUTTON_LABEL_MAX = 40

interface ExtractedButton { label: string; url: string }

/** Walk lines; extract button-shaped links and return remaining body
 *  with the button lines removed. A "button line" is a line whose
 *  ONLY non-whitespace content is one or more `[label](url)` links
 *  (possibly separated by " · " or " | "). */
function extractButtons(md: string): { body: string; buttons: ExtractedButton[] } {
  const buttons: ExtractedButton[] = []
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
  const lines = md.split(/\r?\n/)
  const keptLines: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { keptLines.push(raw); continue }
    // Re-test: every non-link character on the line should be whitespace,
    // a bullet marker (- * •), or a CTA separator (· | →).
    let allLinks = true
    let cursor = 0
    const matches: Array<{ label: string; url: string; i: number; j: number }> = []
    let m: RegExpExecArray | null
    linkPattern.lastIndex = 0
    while ((m = linkPattern.exec(line)) !== null) {
      // Gap between cursor and this match must be filler-only.
      const filler = line.slice(cursor, m.index)
      if (filler && !/^[\s\-*•·|→\s]*$/.test(filler)) { allLinks = false; break }
      matches.push({ label: m[1].trim(), url: m[2].trim(), i: m.index, j: m.index + m[0].length })
      cursor = m.index + m[0].length
    }
    const trailing = line.slice(cursor)
    if (allLinks && matches.length > 0 && /^[\s\-*•·|→\s]*$/.test(trailing)
        && matches.every(x => x.label.length <= BUTTON_LABEL_MAX && /^https?:\/\/|^\/|^mailto:|^tel:/.test(x.url))) {
      for (const x of matches) buttons.push({ label: x.label, url: x.url })
      continue   // drop the line from body
    }
    keptLines.push(raw)
  }
  return {
    body: keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    buttons,
  }
}

/** Convert markdown to an HTML approximation suitable for richtext
 *  binding. Keeps headings as <h2>, paragraphs as <p>, inline links
 *  as <a>, lists as <ul>/<ol>/<li>. Strips images (already stripped
 *  upstream). Not a full CommonMark renderer — just enough that
 *  Brixies renderers don't show raw markdown to partners. */
function markdownToHtml(md: string): string {
  if (!md.trim()) return ''
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let paragraphBuf: string[] = []
  let listBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return
    const joined = paragraphBuf.join(' ').trim()
    if (joined) out.push(`<p>${inline(joined)}</p>`)
    paragraphBuf = []
  }
  const flushList = () => {
    if (listBuf.length === 0 || !listType) return
    out.push(`<${listType}>${listBuf.map(li => `<li>${inline(li)}</li>`).join('')}</${listType}>`)
    listBuf = []
    listType = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (h) {
      flushParagraph(); flushList()
      const level = Math.min(6, Math.max(2, h[1].length))   // demote H1 → h2 (page heading handled separately)
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    const ul = line.match(/^\s*[-*•]\s+(.+)$/)
    if (ul) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listBuf.push(ul[1])
      continue
    }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ol) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listBuf.push(ol[1])
      continue
    }
    flushList()
    paragraphBuf.push(line.trim())
  }
  flushParagraph()
  flushList()
  return out.join('\n')
}

/** Convert inline markdown (links, bold, italic) to HTML. Order
 *  matters: links first, then bold, then italic, so emphasis inside
 *  link labels survives. */
function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      `<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

/** Walk the scraped markdown and produce N cowork-shape sections.
 *  Defaults: H1 + lead → hero, then ONE content_image_text_b section
 *  per H2 block (the original spec produced one big mush, which buried
 *  the structure the partner already authored). Per-block CTAs stay
 *  with their section; site-nav junk H2s ("About", "Connect", footer
 *  links) are dropped before any section gets emitted. */
function segmentMarkdown(rawMd: string, pageTitle: string): SegmentedSection[] {
  const md = stripImages(rawMd)
  const lines = md.split(/\r?\n/)

  // Find the first H1 (or first heading of any level). Everything
  // before it is preamble; everything from heading onwards is content.
  let firstHeadingIdx = lines.findIndex(l => /^#{1,3}\s+/.test(l))
  if (firstHeadingIdx === -1) firstHeadingIdx = 0
  const headingLine = lines[firstHeadingIdx]
  const headingMatch = headingLine?.match(/^#{1,3}\s+(.+?)\s*$/)
  const heroHeading = headingMatch?.[1]?.trim() || pageTitle || 'Untitled'

  // Lead paragraph = first non-empty paragraph AFTER the heading.
  let leadEndIdx = firstHeadingIdx + 1
  const leadBuf: string[] = []
  while (leadEndIdx < lines.length && !lines[leadEndIdx].trim()) leadEndIdx++
  while (leadEndIdx < lines.length) {
    const l = lines[leadEndIdx]
    if (!l.trim()) break
    if (/^#{1,3}\s+/.test(l)) break
    leadBuf.push(l.trim())
    leadEndIdx++
  }
  const leadText = leadBuf.join(' ').trim()

  // Pull buttons out of the lead first — site-wide nav buttons usually
  // appear AFTER the page content, so anything attached to the lead is
  // legitimately a hero CTA.
  const { body: leadBodyClean, buttons: heroButtons } = extractButtons(leadText)

  // The remainder is everything from leadEndIdx onwards. Walk it,
  // splitting on H2 boundaries — each H2 starts a new content block.
  const remainderLines = lines.slice(leadEndIdx)
  const h2Blocks: Array<{ heading: string; bodyLines: string[] }> = []
  let currentHeading: string | null = null
  let currentBody: string[] = []
  for (const raw of remainderLines) {
    const h2 = raw.match(/^##\s+(.+?)\s*#*$/)
    if (h2) {
      // Flush previous block when we hit a new H2.
      if (currentHeading !== null) {
        h2Blocks.push({ heading: currentHeading, bodyLines: currentBody })
      }
      currentHeading = h2[1].trim()
      currentBody = []
    } else {
      currentBody.push(raw)
    }
  }
  if (currentHeading !== null) {
    h2Blocks.push({ heading: currentHeading, bodyLines: currentBody })
  }

  // Filter junk H2 blocks. Common pattern: scraped pages include the
  // site nav as a trailing run of standalone heading-only H2s ("About",
  // "Connect", "Friends & Partners") plus a site-name brand H2. They
  // have no body content of their own — dropping them is safe because
  // a real content section always has prose under its heading.
  const cleanBlocks = h2Blocks.filter(b => {
    const bodyMd = b.bodyLines.join('\n').trim()
    // Drop entirely if no body text. Single-line H2-only blocks are
    // always site nav (a real content H2 introduces at least one
    // paragraph beneath itself).
    if (!bodyMd) return false
    // Drop when the body is only links + filler — that's a nav menu
    // disguised as a section ("More" → list of nav links).
    const bodyMinusLinks = bodyMd.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[\s\-*•·|→]+/g, '')
    if (bodyMinusLinks.length < 8) return false
    return true
  })

  const sections: SegmentedSection[] = []

  // Hero
  const heroSlots: Record<string, unknown> = { primary_heading: heroHeading }
  if (leadBodyClean) heroSlots.body = leadBodyClean
  if (heroButtons.length > 0) {
    heroSlots.buttons = heroButtons.map((b, i) => ({
      label: b.label, url: b.url,
      kind: i === 0 ? 'primary' : 'secondary',
    }))
  }
  sections.push({ template_key: 'hero_inner', slot_values: heroSlots })

  // One content section per H2 block. Buttons stay with their parent
  // block — the per-block extractButtons call routes them correctly.
  for (const block of cleanBlocks) {
    const blockMd = block.bodyLines.join('\n').trim()
    const { body: bodyClean, buttons } = extractButtons(blockMd)
    if (!bodyClean && buttons.length === 0) continue   // empty after CTA strip
    const slots: Record<string, unknown> = {
      primary_heading: block.heading,
    }
    if (bodyClean) slots.body = markdownToHtml(bodyClean)
    if (buttons.length > 0) {
      slots.buttons = buttons.map((b, i) => ({
        label: b.label, url: b.url,
        kind: i === 0 ? 'primary' : 'secondary',
      }))
    }
    sections.push({ template_key: 'content_image_text_b', slot_values: slots })
  }

  // No-H2 case: page is a single flat block. Keep the original
  // behavior — one content_image_text_b under the hero.
  if (cleanBlocks.length === 0) {
    const remainderMd = remainderLines.join('\n').trim()
    const { body: remainderClean, buttons: remainderButtons } = extractButtons(remainderMd)
    if (remainderClean.length > 0) {
      const slots: Record<string, unknown> = { body: markdownToHtml(remainderClean) }
      if (remainderButtons.length > 0) {
        slots.buttons = remainderButtons.map((b, i) => ({
          label: b.label, url: b.url,
          kind: i === 0 ? 'primary' : 'secondary',
        }))
      }
      sections.push({ template_key: 'content_image_text_b', slot_values: slots })
    } else if (remainderButtons.length > 0) {
      sections.push({
        template_key: 'cta_callout',
        slot_values: {
          primary_heading: 'Take the next step',
          buttons: remainderButtons.map((b, i) => ({
            label: b.label, url: b.url,
            kind: i === 0 ? 'primary' : 'secondary',
          })),
        },
      })
    }
  }

  return sections
}
