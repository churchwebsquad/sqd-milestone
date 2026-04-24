/**
 * Data loader + markdown exporter for the staff-only brand handoff doc
 * surface at `/branding/{portal_token}`.
 *
 * Reuses existing helpers where possible (`loadMainGuideByMember`,
 * `isGoogleFont`, `buildGoogleFontsUrls`) — the loader exists to aggregate
 * brand-guide data with two NEW data sources that the partner portal
 * doesn't touch: `strategy_church_intel` (for the Social tab) and a
 * `task_details`-based past-work query (for the Graphics & Video tab).
 */

import { supabase } from './supabase'
import { loadMainGuideByMember } from './brandGuide'
import type {
  BrandHandoffPayload, HandoffTaskCard, HandoffIntelDigest,
  StrategyBrandGuide, StrategyBrandColor, StrategyBrandLogo,
  StrategyBrandTypography, StrategyBrandVoiceAttribute,
  StrategyBrandVoiceGuideline, StrategyBrandAttribute,
} from '../types/database'

/** Statuses we treat as "approved / delivered" for the past-work feed.
 *  Matches what the squads actually set when a task is done — pulled from
 *  `task_details.current_status` values observed in production. */
const APPROVED_STATUSES = ['Closed', 'complete', 'final files delivered', 'approved']

/** List names relevant to the handoff. Anything outside this set is
 *  filtered out of the past-work feed — avoids showing e.g. "Meetings"
 *  or "Team Time Tracking" in the designer-facing view. */
export const HANDOFF_LIST_NAMES = [
  'Graphics & Video',
  'Video - SRP Tasks',
  'Branding 🔒',
  'Social Media',
  'Website',
  'Web - All In Template',
] as const

/**
 * Fetch the full handoff payload for a church identified by `portal_token`.
 * Returns null when the token doesn't resolve to a church.
 */
export async function loadHandoff(portalToken: string): Promise<BrandHandoffPayload | null> {
  // 1. Resolve token → member + church_name
  const { data: church } = await supabase
    .from('strategy_account_progress')
    .select('member, church_name, portal_token')
    .eq('portal_token', portalToken)
    .maybeSingle()

  if (!church) return null
  const memberId = (church as { member: number }).member

  // 2. Parallel fetch: brand guide bundle, intel, past-work tasks
  const [guideBundle, intelRes, tasksRes] = await Promise.all([
    loadMainGuideByMember(memberId),
    supabase
      .from('strategy_church_intel')
      .select('intel_profile, intel_version, intel_updated_at')
      .eq('member', memberId)
      .maybeSingle(),
    fetchPastWork(memberId),
  ])

  const intel: HandoffIntelDigest | null = intelRes.data
    ? {
        intel_version: (intelRes.data as { intel_version: number | null }).intel_version,
        intel_updated_at: (intelRes.data as { intel_updated_at: string | null }).intel_updated_at,
        profile: (intelRes.data as { intel_profile: Record<string, unknown> | null }).intel_profile ?? null,
      }
    : null

  return {
    church: {
      member: memberId,
      church_name: (church as { church_name: string | null }).church_name,
      portal_token: (church as { portal_token: string }).portal_token,
    },
    guide: guideBundle?.guide ?? null,
    logos: guideBundle?.logos ?? [],
    colors: guideBundle?.colors ?? [],
    typography: guideBundle?.typography ?? [],
    elements: guideBundle?.elements ?? [],
    voice_attributes: guideBundle?.voiceAttributes ?? [],
    voice_guidelines: guideBundle?.voiceGuidelines ?? [],
    attributes: guideBundle?.attributes ?? [],
    intel,
    pastWork: tasksRes,
  }
}

/**
 * Past-work feed: approved tasks for this church across the handoff-relevant
 * list names, newest-first. Joins `task_details` (which already has the
 * richer columns we want) to `view_task_account` for the church-scope filter.
 */
async function fetchPastWork(memberId: number): Promise<HandoffTaskCard[]> {
  // view_task_account and task_details aren't in the generated Database types
  // — cast via `as 'tasks'` matches the pattern used in ClickUpTasksSection.
  // Get task_ids scoped to this church first, then pull their details.
  const { data: accountTasks } = await supabase
    .from('view_task_account' as 'tasks')
    .select('task_id, account')
    .eq('account', memberId)

  const ids = (accountTasks ?? []).map(r => (r as unknown as { task_id: string }).task_id).filter(Boolean)
  if (ids.length === 0) return []

  const { data: details } = await supabase
    .from('task_details' as 'tasks')
    .select('task_id, task_name, list_name, current_status, status_changed_at, assignee_names, tags')
    .in('task_id', ids)
    .in('current_status', APPROVED_STATUSES)
    .in('list_name', HANDOFF_LIST_NAMES as unknown as string[])
    .order('status_changed_at', { ascending: false, nullsFirst: false })
    .limit(60)

  return (details ?? []).map(r => {
    const row = r as {
      task_id: string
      task_name: string | null
      list_name: string | null
      current_status: string | null
      status_changed_at: string | null
      assignee_names: string[] | null
      tags: string[] | null
    }
    return {
      task_id: row.task_id,
      task_name: row.task_name ?? '(untitled task)',
      list_name: row.list_name,
      current_status: row.current_status,
      status_changed_at: row.status_changed_at,
      assignee_names: row.assignee_names,
      tags: row.tags,
    }
  })
}

// ── Markdown export ─────────────────────────────────────────────────────────

/**
 * Compile the full handoff into an AI-ready markdown document. Intended for
 * pasting into Claude/ChatGPT when briefing the model for content
 * generation — covers brand essentials, voice, style direction, and a
 * digest of the church intel profile.
 */
export function buildHandoffMarkdown(payload: BrandHandoffPayload): string {
  const lines: string[] = []
  const churchName = payload.church.church_name ?? `Member ${payload.church.member}`
  const guide = payload.guide

  lines.push(`# ${churchName} — Brand Handoff`)
  lines.push('')
  if (guide?.display_name && guide.display_name !== churchName) {
    lines.push(`**Brand name:** ${guide.display_name}`)
  }
  lines.push(`**Member #:** ${payload.church.member}`)
  if (guide?.style_tags && guide.style_tags.length > 0) {
    lines.push(`**Style tags:** ${guide.style_tags.join(', ')}`)
  }
  lines.push('')

  if (guide?.handoff_notes) {
    lines.push('## Designer notes from the brand squad')
    lines.push('')
    lines.push(guide.handoff_notes.trim())
    lines.push('')
  }

  mdSectionBrandStatement(lines, guide)
  mdSectionVoice(lines, guide, payload.voice_attributes, payload.voice_guidelines)
  mdSectionAttributes(lines, payload.attributes)
  mdSectionColors(lines, payload.colors)
  mdSectionTypography(lines, payload.typography)
  mdSectionLogos(lines, payload.logos, guide?.assets_zip_url ?? null, guide?.ase_swatch_url ?? null)
  mdSectionIntel(lines, payload.intel)

  lines.push('')
  lines.push('---')
  lines.push(`*Exported for AI briefing · ${new Date().toISOString().slice(0, 10)}*`)
  return lines.join('\n')
}

function mdSectionBrandStatement(lines: string[], guide: StrategyBrandGuide | null) {
  if (!guide?.brand_statement) return
  lines.push('## Brand statement')
  lines.push('')
  lines.push(`> ${guide.brand_statement.trim()}`)
  lines.push('')
}

function mdSectionVoice(
  lines: string[],
  guide: StrategyBrandGuide | null,
  toneChars: StrategyBrandVoiceAttribute[],
  voiceGuidelines: StrategyBrandVoiceGuideline[],
) {
  if (!guide?.voice_overview && toneChars.length === 0 && voiceGuidelines.length === 0) return
  lines.push('## Voice')
  lines.push('')
  if (guide?.voice_overview) {
    lines.push(guide.voice_overview.trim())
    lines.push('')
  }
  if (toneChars.length > 0) {
    lines.push('### Tone characteristics')
    lines.push('')
    for (const t of toneChars) {
      lines.push(`- **${t.title}** — ${t.description}`)
    }
    lines.push('')
  }
  if (voiceGuidelines.length > 0) {
    lines.push('### Voice guidelines')
    lines.push('')
    for (const g of voiceGuidelines) {
      lines.push(`- **${g.title}** — ${g.description}`)
    }
    lines.push('')
  }
}

function mdSectionAttributes(lines: string[], attrs: StrategyBrandAttribute[]) {
  if (attrs.length === 0) return
  lines.push('## Brand attributes')
  lines.push('')
  for (const a of attrs) {
    if (a.description) {
      lines.push(`- **${a.label}** — ${a.description}`)
    } else {
      lines.push(`- ${a.label}`)
    }
  }
  lines.push('')
}

function mdSectionColors(lines: string[], colors: StrategyBrandColor[]) {
  if (colors.length === 0) return
  lines.push('## Colors')
  lines.push('')
  for (const c of colors) {
    const parts = [`**${c.name ?? c.hex.toUpperCase()}** (${c.tier})`, `hex ${c.hex.toUpperCase()}`]
    if (c.rgb) parts.push(`rgb ${c.rgb}`)
    if (c.cmyk) parts.push(`cmyk ${c.cmyk}`)
    if (typeof c.proportion_pct === 'number') parts.push(`${c.proportion_pct}%`)
    lines.push(`- ${parts.join(' · ')}`)
  }
  lines.push('')
}

function mdSectionTypography(lines: string[], typography: StrategyBrandTypography[]) {
  if (typography.length === 0) return
  lines.push('## Typography')
  lines.push('')
  for (const t of typography) {
    const parts = [`**${t.family_name}** (${t.tier})`]
    if (t.weight_label) parts.push(`weight ${t.weight_label}`)
    if (t.weight) parts.push(`(${t.weight})`)
    if (t.letter_case) parts.push(`set in ${t.letter_case}`)
    if (t.suggested_use) parts.push(t.suggested_use)
    lines.push(`- ${parts.join(' · ')}`)
    if (t.font_url) lines.push(`  - Open-source source: ${t.font_url}`)
    if (t.custom_font_purchase_url) lines.push(`  - Purchase license: ${t.custom_font_purchase_url}`)
    if (t.free_alt_family) {
      const alt = t.free_alt_font_url
        ? `${t.free_alt_family} (${t.free_alt_font_url})`
        : t.free_alt_family
      lines.push(`  - Free alternative: ${alt}`)
    }
    if (t.web_font_family) lines.push(`  - Web font family: ${t.web_font_family}`)
  }
  lines.push('')
}

function mdSectionLogos(
  lines: string[],
  logos: StrategyBrandLogo[],
  zipUrl: string | null,
  aseUrl: string | null,
) {
  if (logos.length === 0 && !zipUrl && !aseUrl) return
  lines.push('## Logos & assets')
  lines.push('')
  for (const l of logos) {
    const name = l.label ?? l.kind
    const url = l.download_url ?? l.preview_url
    lines.push(`- **${name}** (${l.kind}) — ${url}`)
  }
  if (zipUrl) {
    lines.push(`- **Full asset package (zip)** — ${zipUrl}`)
  }
  if (aseUrl) {
    lines.push(`- **Adobe Swatch Exchange (.ase)** — ${aseUrl}`)
  }
  lines.push('')
}

function mdSectionIntel(lines: string[], intel: HandoffIntelDigest | null) {
  if (!intel?.profile) return
  // Surface the keys most useful for AI briefing. Free-form values render as
  // blockquotes; arrays render as bulleted lists.
  const relevantKeys = [
    'audience', 'design', 'brand_voice',
    'what_performs_well', 'caption_cta_patterns',
    'tagline_or_mission', 'upcoming_opportunities',
  ]
  const profile = intel.profile
  const present = relevantKeys.filter(k => profile[k] != null)
  if (present.length === 0) return
  lines.push('## Church intel digest')
  lines.push('')
  for (const k of present) {
    lines.push(`### ${prettifyKey(k)}`)
    lines.push('')
    lines.push(formatIntelValue(profile[k]))
    lines.push('')
  }
}

function prettifyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatIntelValue(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) {
    return v.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
  }
  if (v && typeof v === 'object') {
    return '```\n' + JSON.stringify(v, null, 2) + '\n```'
  }
  return String(v ?? '')
}

// ── Design-system JSON export (Web tab) ─────────────────────────────────────

/**
 * Combined design-token export in Figma's native Variables Import/Export
 * plugin format — reverse-engineered from a known-working file Figma
 * itself produced.
 *
 * Shape: one JSON file with two top-level collections (`Color`,
 * `Font family`). The plugin imports one collection per run, so the user
 * picks which one from the plugin's UI each time — both collections live
 * in the same download.
 *
 *     {
 *       "Color": {
 *         "Primary": {
 *           "$type": "color",
 *           "$value": {
 *             "colorSpace": "srgb",
 *             "components": [0.96, 0.36, 0.14],
 *             "alpha": 1,
 *             "hex": "#F15B23"
 *           },
 *           "$extensions": { "com.figma.scopes": ["ALL_SCOPES"] }
 *         },
 *         "$extensions": { "com.figma.modeName": "Mode 1" }
 *       },
 *       "Font family": {
 *         "Primary Font": {
 *           "$type": "string",
 *           "$value": "Geist",
 *           "$extensions": {
 *             "com.figma.type": "string",
 *             "com.figma.scopes": ["ALL_SCOPES"]
 *           }
 *         },
 *         "$extensions": { "com.figma.modeName": "Mode 1" }
 *       }
 *     }
 *
 * Format details that matter (confirmed against Figma's own export):
 *  - Color `$value` is an OBJECT with colorSpace/components/alpha/hex.
 *    Hex-string values silently fail.
 *  - Font tokens use `$type: "string"` (not `"fontFamily"`) with the
 *    `com.figma.type: "string"` extension hint.
 *  - Each collection has its own `$extensions.com.figma.modeName` at its
 *    own root — mode naming is per-collection.
 *  - Tokens live directly under their collection; no further grouping.
 */
export function buildDesignTokens(payload: BrandHandoffPayload): string {
  const colorCollection = buildColorCollection(payload.colors)
  const fontCollection = buildFontFamilyCollection(payload.typography)

  const out: Record<string, unknown> = {}
  if (Object.keys(colorCollection).length > 1) {
    // > 1 because an empty collection is just the modeName `$extensions`.
    out['Color'] = colorCollection
  }
  if (Object.keys(fontCollection).length > 1) {
    out['Font family'] = fontCollection
  }
  return JSON.stringify(out, null, 2)
}

function buildColorCollection(colors: BrandHandoffPayload['colors']): Record<string, unknown> {
  const collection: Record<string, unknown> = {}
  const used = new Set<string>()
  for (const c of colors) {
    const base = c.name?.trim() || capitalize(c.tier) || c.hex.toUpperCase()
    const key = allocateKey(base, used)
    const { components, alpha, hex } = hexToFigmaColor(c.hex)
    collection[key] = {
      $type: 'color',
      $value: { colorSpace: 'srgb', components, alpha, hex },
      $extensions: { 'com.figma.scopes': ['ALL_SCOPES'] },
    }
  }
  if (Object.keys(collection).length > 0) {
    collection.$extensions = { 'com.figma.modeName': 'Mode 1' }
  }
  return collection
}

function buildFontFamilyCollection(typography: BrandHandoffPayload['typography']): Record<string, unknown> {
  const collection: Record<string, unknown> = {}
  const used = new Set<string>()
  for (const t of typography) {
    const base = `${FONT_ROLE_LABEL[t.tier] ?? capitalize(t.tier)} Font`
    const key = allocateKey(base, used)
    collection[key] = {
      $type: 'string',
      $value: t.family_name,
      $extensions: {
        'com.figma.type': 'string',
        'com.figma.scopes': ['ALL_SCOPES'],
      },
    }
  }
  if (Object.keys(collection).length > 0) {
    collection.$extensions = { 'com.figma.modeName': 'Mode 1' }
  }
  return collection
}

const FONT_ROLE_LABEL: Record<string, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
}

/** Expand hex → Figma's srgb color-value shape. */
function hexToFigmaColor(hex: string): {
  components: [number, number, number]
  alpha: number
  hex: string
} {
  const cleaned = hex.replace('#', '').trim()
  const expanded = cleaned.length === 3
    ? cleaned.split('').map(c => c + c).join('')
    : cleaned
  if (expanded.length !== 6 && expanded.length !== 8) {
    return { components: [0, 0, 0], alpha: 1, hex: '#000000' }
  }
  return {
    components: [
      parseInt(expanded.slice(0, 2), 16) / 255,
      parseInt(expanded.slice(2, 4), 16) / 255,
      parseInt(expanded.slice(4, 6), 16) / 255,
    ],
    alpha: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    hex: '#' + expanded.slice(0, 6).toUpperCase(),
  }
}

/** Return `base`, or `base 2` / `base 3` if base is already used. Uses a
 *  space separator so collision suffixes read as human names in Figma. */
function allocateKey(base: string, used: Set<string>): string {
  let key = base
  let i = 2
  while (used.has(key)) { key = `${base} ${i}`; i++ }
  used.add(key)
  return key
}

function capitalize(s: string | null | undefined): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
