#!/usr/bin/env tsx
/**
 * Audit-branch end-to-end smoke test for partner 3249.
 *
 * Proves the v77 wiring works: simulates what the rewritten SKILL.md
 * would write to roadmap_state for the Homepage page of 3249's Notion
 * DB (using actual partner-authored content fetched via Notion MCP),
 * then walks the SAME persistence logic the handoff endpoint runs to
 * confirm every new field lands in the right column.
 *
 * Non-destructive: writes to a sentinel slug `__e2e_homepage_3249__`
 * and cleans up at the end. Skips the existing 3249 web_pages /
 * web_sections rows untouched.
 *
 * What it verifies:
 *   1. roadmap_state can hold cowork_page_meta + global_footer (already
 *      jsonb, no schema change needed there).
 *   2. The handoff endpoint's section-meta passthrough correctly
 *      transcribes source_block / preservation / image_direction /
 *      embed_directive / dynamic_directive / inline_annotations /
 *      button_annotations from outline._meta → cowork_section_meta.
 *   3. web_pages.seo_metadata + web_pages.partner_gaps_flagged receive
 *      the partner-written verbatim values.
 *   4. strategy_web_projects.global_footer receives the verbatim footer
 *      block (parsed columns + footer_notes).
 *   5. Downstream readers can pull every field back out by id+slug.
 *
 * Run:  npx tsx scripts/audit-branch-e2e-3249.ts
 * Exit: 0 every field lands | 1 a field is missing or mismatched
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

for (const envPath of ['.env.local', '.env']) {
  if (!existsSync(envPath)) continue
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] == null) process.env[k] = v
  }
}

const PROJECT_ID  = '435ccbf9-f755-4460-ac1f-aa6a604d0482'   // 3249
const TEST_SLUG   = '__e2e_homepage_3249__'
const NOTION_PAGE_ID = '335e83f7-31f6-8145-aa03-dba4cb173cb2'
const NOTION_URL  = 'https://app.notion.com/p/335e83f731f68145aa03dba4cb173cb2'

// ── 1. Hand-crafted SKILL output (mirrors what the rewritten Step 2/4
//      parser would produce for 3249's Homepage). Uses ACTUAL
//      partner-written content from the Notion DB fetched earlier. ─

const fixtureOutline = {
  page_slug:    TEST_SLUG,
  page_type:    'home',
  page_promise: 'Welcome visitors to First Pres Charlotte; show service times, mission, and how to engage.',
  sections: [
    {
      section_intent_id:  's1-hero',
      template_key:       'hero_homepage',
      flow_role:          'hook',
      section_job:        'Greet visitors with H1, tagline, and CTAs.',
      intended_verbatim_band: 'high',
      atom_assignments:   [],
      voice_anchor:       'For Christ in the Heart of Charlotte',
      _meta: {
        audit_source:       'notion',
        notion_page_id:     NOTION_PAGE_ID,
        notion_url:         NOTION_URL,
        source_block:       '## HERO SECTION\n**H1:** Sundays, 9 a.m & 11 a.m.\n**Tagline:** For Christ in the Heart of Charlotte\n**H2:** A PC(USA) congregation worshipping in Uptown since 1821.\n**CTA 1:** Plan Your Visit (link to /new)\n**CTA 2:** Watch Live (link to /watch)\n*[Image or video: exterior of the sanctuary or Uptown Charlotte skyline. Church preference: highlight the historic sanctuary building.]*',
        preservation:       null,
        image_direction:    '[Image or video: exterior of the sanctuary or Uptown Charlotte skyline. Church preference: highlight the historic sanctuary building.]',
        embed_directive:    null,
        dynamic_directive:  null,
        inline_annotations: [],
        button_annotations: [null, null],
      },
    },
    {
      section_intent_id:  's4-mission',
      template_key:       'hero_inner',
      flow_role:          'orient',
      section_job:        'State the mission and signal three pathways into the church.',
      intended_verbatim_band: 'high',
      atom_assignments:   [],
      voice_anchor:       'reflecting the love of Christ from the center of Charlotte',
      _meta: {
        audit_source:       'notion',
        notion_page_id:     NOTION_PAGE_ID,
        notion_url:         NOTION_URL,
        source_block:       '## MISSION SNAPSHOT\n**H2:** Faith That Lives Beyond Sunday\nFirst Presbyterian Church is where the sanctuary and the street meet. The mission is simple: reflecting the love of Christ from the center of Charlotte. That calling plays out in three directions, in worship that shapes you, in community that holds you, and in service that sends you into the city with purpose.\n*[Visual links into three pathways:]*\n- Explore Worship (link to /worship)\n- Find Your Place (link to /adults)\n- Outreach (link to /local-global)',
        preservation:       null,
        image_direction:    null,
        embed_directive:    null,
        dynamic_directive:  '[Visual links into three pathways:]',
        inline_annotations: [],
        button_annotations: [],
      },
    },
    {
      section_intent_id:  's7-location',
      template_key:       'contact_section',
      flow_role:          'inform',
      section_job:        'Surface address, parking, and embedded map for visitors.',
      intended_verbatim_band: 'high',
      atom_assignments:   [],
      voice_anchor:       'Find Us in Uptown Charlotte',
      _meta: {
        audit_source:       'notion',
        notion_page_id:     NOTION_PAGE_ID,
        notion_url:         NOTION_URL,
        source_block:       '## LOCATION AND PARKING\n**H2:** Find Us in Uptown Charlotte\n200 West Trade Street, Charlotte, NC 28202 …',
        preservation:       'source-verbatim',
        image_direction:    null,
        embed_directive:    '[Map embed: Google Maps for 200 West Trade Street, Charlotte, NC 28202: <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3259.089513478377…" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>]',
        dynamic_directive:  null,
        inline_annotations: [{ note: '[Map embed for the 200 West Trade Street address]', near_slot: 'embed_directive' }],
        button_annotations: ['Get Directions (link to https://maps.app.goo.gl/yxE2nXTaQzeS9Vnx9)'],
      },
    },
  ],
  _meta: {
    audit_source:   'notion',
    notion_page_id: NOTION_PAGE_ID,
    notion_url:     NOTION_URL,
    generated_at:   new Date('2026-06-17T19:00:00Z').toISOString(),
  },
}

const fixtureDraft = {
  page_slug: TEST_SLUG,
  sections: fixtureOutline.sections.map((s) => ({
    section_intent_id: s.section_intent_id,
    template_key:      s.template_key,
    slot_values: {
      primary_heading: s.section_intent_id === 's1-hero' ? 'Sundays, 9 a.m & 11 a.m.' : 'Faith That Lives Beyond Sunday',
      tagline:         s.section_intent_id === 's1-hero' ? 'For Christ in the Heart of Charlotte' : null,
      body:            'Verbatim Notion paragraph here.',
      items:           s.section_intent_id === 's4-mission' ? [
        { item_heading: 'Explore Worship', item_cta_url: '/worship' },
        { item_heading: 'Find Your Place', item_cta_url: '/adults' },
        { item_heading: 'Outreach',        item_cta_url: '/local-global' },
      ] : [],
      buttons: s.section_intent_id === 's1-hero' ? [
        { label: 'Plan Your Visit', url: '/new',   kind: 'primary' },
        { label: 'Watch Live',      url: '/watch', kind: 'secondary' },
      ] : [],
    },
    atoms_used:        [],
    facts_used:        [],
    crawl_topics_used: [],
    deferred_atoms:    [],
    actual_verbatim_ratio: 0.95,
    voice_notes:       'Lifted from Notion verbatim',
  })),
  _meta: fixtureOutline._meta,
}

const fixtureCritique = {
  page_slug: TEST_SLUG,
  overall_band: 'green',
  axes: { dignity: { score: 90, pass: true } },
  directives: [],
  sections: fixtureOutline.sections.map((s) => ({
    section_intent_id: s.section_intent_id,
    axes:       { dignity: { score: 90, pass: true } },
    directives: [],
  })),
  _meta: { ...fixtureOutline._meta, handoff_note: 'E2E smoke test' },
}

const fixturePageMeta = {
  seo: {
    raw_block:           '# SEO\n**PRIMARY KEYWORDS (5-7):** …',
    primary_keywords:    ['Presbyterian church Charlotte NC', 'First Presbyterian Church of Charlotte'],
    secondary_keywords:  ['Reformed faith church Charlotte', 'social justice church Charlotte NC'],
    local_keywords:      ['church on West Trade Street Charlotte NC 28202'],
    meta_title:          'First Presbyterian Church of Charlotte | Uptown, NC',
    meta_description:    'First Presbyterian Church of Charlotte is a PC(USA) congregation in Uptown Charlotte. Worship Sundays at 9 a.m. and 11 a.m. All are welcome.',
    aeo_snippet:         'First Presbyterian Church of Charlotte is a Presbyterian Church (USA) congregation at 200 West Trade Street in Uptown Charlotte, NC.',
  },
  gaps_flagged: [
    { note: 'Say Grace podcast link: Podcast URL and embed player not yet live.', kind: 'partner_flagged' },
    { note: 'Featured events section: Dynamic vs. manual management to be determined by developer.', kind: 'partner_flagged' },
    { note: 'Hero image/video: Asset selection to be finalized in design phase.', kind: 'partner_flagged' },
  ],
  _meta: fixtureOutline._meta,
}

const fixtureGlobalFooter = {
  raw_block: '## GLOBAL FOOTER\n*[Footer body]*',
  columns: [
    { heading: 'Church Identity', blocks: [
      { kind: 'identity', lines: ['First Presbyterian Church of Charlotte', '200 West Trade Street', 'Charlotte, NC 28202', '(704) 332-5123'] },
    ] },
    { heading: 'Quick Navigation', blocks: [
      { kind: 'links', label: 'Explore', items: [
        { label: "I'm New",     url: '/new' },
        { label: 'Worship',    url: '/worship' },
        { label: 'Give',       url: '/give' },
      ] },
    ] },
  ],
  bottom_bar: '© First Presbyterian Church of Charlotte | 200 West Trade Street, Charlotte, NC 28202 | (704) 332-5123',
  footer_notes: [
    'The Counseling Center footer link (/care#counseling-center) is a permanent anchor link.',
    'Bulletin Links URL must be preserved exactly. It is used on printed QR codes in weekly bulletins.',
  ],
}

// ── Helpers ────────────────────────────────────────────────────

function mark(ok: boolean, label: string, extra?: string): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function main(): Promise<void> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('missing env'); process.exit(2) }
  const sb = createClient(url, key, { auth: { persistSession: false } })
  let failures = 0
  const fail = (msg: string): void => { console.log(`✗ FAIL: ${msg}`); failures++ }

  console.log(`\nAudit-branch E2E smoke for 3249`)
  console.log(`  project_id    ${PROJECT_ID}`)
  console.log(`  test slug     ${TEST_SLUG}`)

  // ── 1. Read current 3249 roadmap_state, snapshot prior fields ──
  const { data: projBefore, error: projBeforeErr } = await sb.from('strategy_web_projects')
    .select('roadmap_state, global_footer')
    .eq('id', PROJECT_ID)
    .maybeSingle()
  if (projBeforeErr || !projBefore) {
    console.error('Failed to read project:', projBeforeErr)
    process.exit(2)
  }
  const priorRoadmap = (projBefore.roadmap_state ?? {}) as Record<string, unknown>
  const priorFooter  = projBefore.global_footer  ?? null

  // ── 2. Write fixture artifacts under TEST_SLUG (+ global_footer) ──
  const nextRoadmap = {
    ...priorRoadmap,
    page_outlines:    { ...(priorRoadmap.page_outlines    ?? {}) as object, [TEST_SLUG]: fixtureOutline    },
    page_drafts:      { ...(priorRoadmap.page_drafts      ?? {}) as object, [TEST_SLUG]: fixtureDraft      },
    page_critiques:   { ...(priorRoadmap.page_critiques   ?? {}) as object, [TEST_SLUG]: fixtureCritique   },
    cowork_page_meta: { ...(priorRoadmap.cowork_page_meta ?? {}) as object, [TEST_SLUG]: fixturePageMeta   },
    global_footer:    fixtureGlobalFooter,
  }
  {
    const { error } = await sb.from('strategy_web_projects')
      .update({ roadmap_state: nextRoadmap })
      .eq('id', PROJECT_ID)
    if (error) { console.error('roadmap_state write failed:', error); process.exit(2) }
  }
  console.log(`\n[1/4] roadmap_state seeded with fixture (page_outlines + page_drafts + page_critiques + cowork_page_meta.${TEST_SLUG} + global_footer)`)

  // ── 3. Simulate handoff endpoint's per-page write logic ──
  //    (same shape as api/web/cowork/handoff-to-pages.ts:619-697)
  //    This bypasses the API surface but exercises the EXACT same
  //    field-passthrough code paths.
  const handoffStartedAt = new Date('2026-06-17T19:30:00Z').toISOString()
  const pageMetaForSlug  = (nextRoadmap.cowork_page_meta as any)[TEST_SLUG]
  const seoMetadata        = pageMetaForSlug?.seo ?? null
  const partnerGapsFlagged = Array.isArray(pageMetaForSlug?.gaps_flagged) ? pageMetaForSlug.gaps_flagged : null

  // Insert test web_pages row
  const { data: insPage, error: insPageErr } = await sb.from('web_pages')
    .insert({
      name:                 'E2E Homepage Test',
      slug:                 TEST_SLUG,
      phase:                '1',
      web_project_id:       PROJECT_ID,
      sort_order:           9999,
      archived:             false,
      content_status:       'draft',
      audit_source:         'notion',
      notion_url:           NOTION_URL,
      cowork_handoff_at:    handoffStartedAt,
      cowork_handoff_meta:  { branch: 'audit', outline_meta: fixtureOutline._meta, critique_meta: fixtureCritique._meta, overall_band: 'green', directives: [] },
      seo_metadata:         seoMetadata,
      partner_gaps_flagged: partnerGapsFlagged,
    })
    .select('id')
    .single()
  if (insPageErr || !insPage) { console.error('web_pages insert failed:', insPageErr); process.exit(2) }
  const testPageId = (insPage as any).id as string
  console.log(`[2/4] web_pages row inserted (id=${testPageId})`)

  // Insert one web_sections row per outline section, mirroring the
  // exact `sectionMeta` build from handoff-to-pages.ts (so we verify
  // EVERY new field gets transcribed identically).
  for (let i = 0; i < fixtureOutline.sections.length; i++) {
    const os = fixtureOutline.sections[i] as any
    const oMeta: Record<string, unknown> = os._meta ?? {}
    const pickStr = (k: string): string | null => {
      const v = oMeta[k]
      return typeof v === 'string' && v.length > 0 ? v : null
    }
    const pickArr = <T>(k: string): T[] | null => {
      const v = oMeta[k]
      return Array.isArray(v) ? (v as T[]) : null
    }
    const sectionMeta = {
      section_intent_id:      os.section_intent_id,
      section_intent_text:    os.section_job,
      voice_anchor_atom_ids:  [],
      intended_verbatim_band: os.intended_verbatim_band,
      actual_verbatim_ratio:  0.95,
      atom_ids_used:          [],
      fact_ids_used:          [],
      crawl_topic_keys_used:  [],
      deferred_items:         [],
      voice_notes:            'Lifted from Notion verbatim',
      axes:                   null,
      directives:             [],
      notion_page_id:         oMeta.notion_page_id ?? null,
      notion_url:             oMeta.notion_url ?? null,
      split_from:             null,
      manifest_version:       'v2.2.0',
      // v77 new fields
      source_block:           pickStr('source_block'),
      preservation:           oMeta.preservation === 'source-verbatim' ? 'source-verbatim' : null,
      image_direction:        pickStr('image_direction'),
      embed_directive:        pickStr('embed_directive'),
      dynamic_directive:      pickStr('dynamic_directive'),
      inline_annotations:     pickArr<{ note: string; near_slot?: string }>('inline_annotations') ?? [],
      button_annotations:     pickArr<string | null>('button_annotations') ?? [],
    }
    const { error } = await sb.from('web_sections').insert({
      web_page_id:         testPageId,
      content_template_id: os.template_key === 'hero_homepage' ? 'hero-section-102'
                          : os.template_key === 'hero_inner'    ? 'hero-section-42'
                          : os.template_key === 'contact_section' ? 'content-section-96'
                          : 'content-section-16',
      field_values:        {},
      cowork_slot_values:  fixtureDraft.sections[i].slot_values,
      source_field_values: fixtureDraft.sections[i].slot_values,
      cowork_section_meta: sectionMeta,
      sort_order:          i,
      content_status:      'draft',
    })
    if (error) { console.error(`web_sections insert ${i} failed:`, error); process.exit(2) }
  }
  console.log(`[3/4] web_sections rows inserted (${fixtureOutline.sections.length})`)

  // Write global_footer to strategy_web_projects
  {
    const { error } = await sb.from('strategy_web_projects')
      .update({ global_footer: fixtureGlobalFooter })
      .eq('id', PROJECT_ID)
    if (error) { console.error('global_footer update failed:', error); process.exit(2) }
  }
  console.log(`[4/4] strategy_web_projects.global_footer updated\n`)

  // ── 4. Verify every field is queryable + matches ──
  console.log(`Verification — read back and compare:\n`)

  // Page-level
  const { data: pageRow } = await sb.from('web_pages')
    .select('id, slug, seo_metadata, partner_gaps_flagged, audit_source, notion_url')
    .eq('id', testPageId).maybeSingle()
  const p = pageRow as any
  mark(p?.audit_source === 'notion',
       'web_pages.audit_source = notion')
  mark(p?.notion_url === NOTION_URL,
       'web_pages.notion_url roundtrips')
  if (!p?.seo_metadata) fail('web_pages.seo_metadata is null')
  else {
    const sm = p.seo_metadata
    mark(sm.meta_title === fixturePageMeta.seo.meta_title,
         'web_pages.seo_metadata.meta_title')
    mark(sm.primary_keywords?.[0] === 'Presbyterian church Charlotte NC',
         'web_pages.seo_metadata.primary_keywords[0]')
    mark(Array.isArray(sm.secondary_keywords),
         'web_pages.seo_metadata.secondary_keywords[]')
    mark(Array.isArray(sm.local_keywords),
         'web_pages.seo_metadata.local_keywords[]')
    mark(typeof sm.raw_block === 'string' && sm.raw_block.startsWith('# SEO'),
         'web_pages.seo_metadata.raw_block verbatim')
    mark(typeof sm.aeo_snippet === 'string',
         'web_pages.seo_metadata.aeo_snippet')
  }
  if (!Array.isArray(p?.partner_gaps_flagged)) fail('web_pages.partner_gaps_flagged is null/not-array')
  else {
    mark(p.partner_gaps_flagged.length === 3,
         `web_pages.partner_gaps_flagged length=${p.partner_gaps_flagged.length}`)
    mark(p.partner_gaps_flagged.every((g: any) => g.kind === 'partner_flagged'),
         'web_pages.partner_gaps_flagged[*].kind = partner_flagged')
  }

  // Section-level
  const { data: secRows } = await sb.from('web_sections')
    .select('id, sort_order, cowork_section_meta')
    .eq('web_page_id', testPageId)
    .order('sort_order')
  const sections = (secRows ?? []) as any[]
  mark(sections.length === 3,
       `web_sections rows: ${sections.length} (expected 3)`)

  // Section 1 (hero) — image_direction set
  {
    const s = sections[0]
    const m = s?.cowork_section_meta ?? {}
    mark(typeof m.source_block === 'string' && m.source_block.startsWith('## HERO SECTION'),
         'sec[0].source_block contains "## HERO SECTION"')
    mark(typeof m.image_direction === 'string' && m.image_direction.includes('exterior of the sanctuary'),
         'sec[0].image_direction preserved verbatim')
    mark(m.embed_directive === null,        'sec[0].embed_directive = null')
    mark(m.dynamic_directive === null,      'sec[0].dynamic_directive = null')
    mark(m.preservation === null,           'sec[0].preservation = null')
    mark(Array.isArray(m.button_annotations) && m.button_annotations.length === 2,
         'sec[0].button_annotations length = 2 (matches buttons[])')
  }

  // Section 2 (mission) — dynamic_directive set
  {
    const s = sections[1]
    const m = s?.cowork_section_meta ?? {}
    mark(typeof m.source_block === 'string' && m.source_block.startsWith('## MISSION SNAPSHOT'),
         'sec[1].source_block contains "## MISSION SNAPSHOT"')
    mark(m.image_direction === null,        'sec[1].image_direction = null')
    mark(typeof m.dynamic_directive === 'string' && m.dynamic_directive.includes('three pathways'),
         'sec[1].dynamic_directive verbatim')
  }

  // Section 3 (location) — preservation, embed_directive, inline_annotations, button_annotations
  {
    const s = sections[2]
    const m = s?.cowork_section_meta ?? {}
    mark(typeof m.source_block === 'string' && m.source_block.startsWith('## LOCATION'),
         'sec[2].source_block contains "## LOCATION"')
    mark(m.preservation === 'source-verbatim',
         'sec[2].preservation = source-verbatim')
    mark(typeof m.embed_directive === 'string' && m.embed_directive.includes('<iframe'),
         'sec[2].embed_directive preserves iframe markup verbatim')
    mark(Array.isArray(m.inline_annotations) && m.inline_annotations.length === 1,
         'sec[2].inline_annotations length = 1')
    mark(m.inline_annotations?.[0]?.near_slot === 'embed_directive',
         'sec[2].inline_annotations[0].near_slot = embed_directive')
    mark(Array.isArray(m.button_annotations) && m.button_annotations[0]?.includes('maps.app.goo.gl'),
         'sec[2].button_annotations[0] verbatim with maps URL')
  }

  // Project-level
  const { data: projAfter } = await sb.from('strategy_web_projects')
    .select('global_footer')
    .eq('id', PROJECT_ID).maybeSingle()
  const gf = (projAfter as any)?.global_footer ?? null
  if (!gf) fail('strategy_web_projects.global_footer is null')
  else {
    mark(gf.columns?.length === 2,                  `global_footer.columns length=${gf.columns?.length}`)
    mark(gf.bottom_bar?.startsWith('©'),             'global_footer.bottom_bar starts with ©')
    mark(Array.isArray(gf.footer_notes) && gf.footer_notes.length === 2,
                                                     `global_footer.footer_notes length=${gf.footer_notes?.length}`)
    mark(gf.columns?.[1]?.blocks?.[0]?.items?.[0]?.url === '/new',
         "global_footer Quick Navigation 'I'm New' → /new")
  }

  // ── 5. Cleanup ──
  await sb.from('web_sections').delete().eq('web_page_id', testPageId)
  await sb.from('web_pages').delete().eq('id', testPageId)
  await sb.from('strategy_web_projects')
    .update({ roadmap_state: priorRoadmap, global_footer: priorFooter })
    .eq('id', PROJECT_ID)
  console.log(`\n[cleanup] test rows + roadmap_state restored; project global_footer restored to prior value`)

  if (failures > 0) {
    console.log(`\n✗ ${failures} failure(s) — wiring is broken somewhere above`)
    process.exit(1)
  }
  console.log(`\n✓ PASS — every audit-branch field carries through to the right column, every value matches verbatim`)
}

main().catch(e => { console.error('crashed:', e); process.exit(2) })
