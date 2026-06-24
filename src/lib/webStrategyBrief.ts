/**
 * Strategy-brief markdown loader + section parser.
 *
 * The strategy brief is uploaded to `web_intake_documents` (category =
 * 'strategy_brief') as a markdown file. It's the authoritative source
 * for Mission / Vision / Values + several other identity statements
 * partners reviewed during the strategy phase. We use it to prefill
 * the Content Collection inventory's mission_beliefs baselines so the
 * partner sees the right text without retyping it.
 *
 * Parsing is lenient — the brief follows a consistent heading pattern
 * (### Mission, ### Vision, ### Values, ...) but the body can be
 * arbitrary markdown (paragraphs, blockquotes, bullet lists). Each
 * section's body is returned verbatim so partners see exactly what
 * was written in the brief, with markdown intact.
 */
import { supabase } from './supabase'

export interface StrategyBriefSections {
  mission?:  string
  vision?:   string
  values?:   string
  /** How and why the church started — typically lives under
   *  "Historical Reflections" or "Founding Story" / "Our Story" /
   *  "History" headings. Falls back to first match across that list. */
  founding_story?: string
  /** Short slogans / tagline-shaped sentences the church reuses.
   *  Sourced from "Brand Statement" + "Value Proposition" sections
   *  joined with a blank line so the partner sees both as candidate
   *  taglines and can edit down to the one(s) they actually repeat. */
  taglines?: string
  /** Full markdown of all sections we found, keyed by lowercased
   *  heading title — useful for future prefill additions. */
  byHeading: Record<string, string>
}

/** Load + parse the latest non-archived strategy brief for a project.
 *  Returns `null` if no brief exists or the file can't be fetched.
 *  The brief is fetched via the Storage public URL — works for both
 *  partner (anon) and staff sessions. */
export async function loadStrategyBriefSections(webProjectId: string): Promise<StrategyBriefSections | null> {
  const { data: doc } = await supabase
    .from('web_intake_documents')
    .select('storage_path')
    .eq('web_project_id', webProjectId)
    .eq('category', 'strategy_brief')
    .eq('archived', false)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!doc?.storage_path) return null

  // Strategy brief markdowns live in the `brand-assets` bucket under
  // a `web-intake/<projectId>/strategy_brief/<filename>` prefix — the
  // `storage_path` column already includes that prefix. Bucket is
  // public-read so anon + auth both work; flip to `createSignedUrl`
  // if it goes private later.
  const { data: urlData } = supabase.storage.from('brand-assets').getPublicUrl(doc.storage_path)
  const url = urlData?.publicUrl
  if (!url) return null

  try {
    // Cache-bust so the partner / staff can re-upload a brief and
    // hit Refresh without the browser HTTP cache serving the prior
    // version. Without this, staff would have to hard-reload the
    // page after uploading.
    const cacheBust = `?t=${Date.now()}`
    const res = await fetch(`${url}${cacheBust}`, { cache: 'no-store' })
    if (!res.ok) return null
    const md = await res.text()
    return parseStrategyBriefSections(md)
  } catch {
    return null
  }
}

/** Split markdown into sections by any level-2-or-deeper heading
 *  (##, ###, ####). Earlier versions only matched `### ` and missed
 *  briefs where Notion exports inconsistently rendered Vision /
 *  Values as `## ` siblings — those sections were silently absent
 *  from the prefill set and partners never saw them. We treat any
 *  `##+ Heading` line AND `---` as a boundary; the title is
 *  normalized (lowercased, markdown-bold/italic stripped, trimmed)
 *  before keying so `## **Values**` and `### Values` both map to
 *  `values`.
 *
 *  Returned `mission` / `vision` / `values` are the trimmed body of
 *  each matching section, markdown intact (blockquotes, bullets, etc.). */
export function parseStrategyBriefSections(md: string): StrategyBriefSections {
  const out: StrategyBriefSections = { byHeading: {} }
  if (!md) return out

  // Normalize line endings + collapse trailing whitespace on each line
  // so the split below isn't tripped by CRLF or stray spaces.
  const lines = md.replace(/\r\n/g, '\n').split('\n')

  // Walk lines, tracking the current heading. When a new heading
  // (or "---" rule) is hit, flush the buffer to the previous section.
  let currentTitle: string | null = null
  let buffer: string[] = []

  const flush = () => {
    if (!currentTitle) return
    const body = trimBlockBody(buffer.join('\n'))
    const key = normalizeHeading(currentTitle)
    if (body && key) out.byHeading[key] = body
    buffer = []
  }

  for (const raw of lines) {
    const line = raw
    const m = line.match(/^(#{2,6})\s+(.+?)\s*$/)
    if (m) {
      flush()
      currentTitle = m[2].trim()
      continue
    }
    // `---` horizontal rule between sections ends the current section.
    if (/^\s*---+\s*$/.test(line)) {
      flush()
      currentTitle = null
      continue
    }
    if (currentTitle) buffer.push(line)
  }
  flush()

  // Direct field mappings — exact heading first, then substring fall-
  // backs so briefs with non-canonical headings ("Our Mission",
  // "Vision & Calling", etc.) still parse.
  out.mission = pickByHeading(out.byHeading, ['mission'], /\bmission\b/)
  out.vision  = pickByHeading(out.byHeading, ['vision'],  /\bvision\b/)
  out.values  = pickByHeading(out.byHeading, ['values', 'core values'], /\b(values|core values)\b/)

  // Founding story: try a wide net of heading keywords. Picks the
  // FIRST matching section so briefs with multiple history blocks
  // surface the most prominent one. Falls back to body keyword scan
  // if no heading matches.
  out.founding_story = pickByHeading(
    out.byHeading,
    [
      'founding story', 'our story', 'origin story', 'history',
      'historical reflections', 'background', 'our background',
      'heritage', 'where we started',
    ],
    /\b(found|origin|history|background|heritage|our story|where we (started|began))\b/,
  )
  // Final fallback: scan section BODIES for "founded in YYYY" /
  // "started in YYYY" patterns. Picks the first section whose body
  // mentions the founding cue.
  if (!out.founding_story) {
    for (const [, body] of Object.entries(out.byHeading)) {
      if (/\b(founded|established|started|began|planted)\s+(in\s+\d{4}|by\b)/i.test(body)) {
        out.founding_story = body
        break
      }
    }
  }

  // Taglines: most briefs don't carry a literal "Repeated taglines"
  // heading, but the Brand Statement + Value Proposition sections
  // both encode short tagline-shaped sentences the church repeats
  // across messaging. Join with a blank line so the partner sees
  // both as candidate taglines and trims down to what they actually
  // use. Falls back to an explicit "Taglines" / "Slogans" section if
  // a brief ships one.
  const explicitTaglines =
    out.byHeading['repeated taglines'] ??
    out.byHeading['taglines'] ??
    out.byHeading['slogans']
  if (explicitTaglines) {
    out.taglines = explicitTaglines
  } else {
    const brandStatement = out.byHeading['brand statement']
    const valueProp      = out.byHeading['value proposition']
    const elevatorPitch  = out.byHeading['elevator pitch']
    const parts = [brandStatement, valueProp, elevatorPitch].filter(Boolean) as string[]
    if (parts.length > 0) out.taglines = parts.join('\n\n')
  }

  return out
}

/** Heading text → normalized key. Strips markdown bold/italic
 *  (`**Values**` → `values`), lowercases, trims. Returns empty for
 *  titles that look like icon-decorated section anchors (`#
 *  :heart-icon: Your Community`) so they don't pollute the heading
 *  map. */
function normalizeHeading(s: string): string {
  return s
    .replace(/[*_`]+/g, '')           // strip markdown emphasis markers
    .replace(/:[\w-]+:/g, '')          // strip Notion `:icon-name:` shortcodes
    .trim()
    .toLowerCase()
}

/** Strip leading / trailing blank lines, leave inner markdown alone. */
function trimBlockBody(text: string): string {
  return text.replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '')
}

/** Pick a section body from the parsed heading map. Tries exact-match
 *  keys first (case-insensitive — keys are already normalized), then
 *  falls back to a regex sweep of all heading keys. Returns the first
 *  non-empty body or undefined. */
function pickByHeading(
  byHeading: Record<string, string>,
  exactKeys: string[],
  fallbackPattern: RegExp,
): string | undefined {
  for (const k of exactKeys) {
    if (byHeading[k]) return byHeading[k]
  }
  for (const k of Object.keys(byHeading)) {
    if (fallbackPattern.test(k) && byHeading[k]) return byHeading[k]
  }
  return undefined
}

/** Build the externalPrefills entries the inventory cares about from a
 *  parsed brief. Returns `{}` when no brief / no relevant sections. */
export function strategyBriefToExternalPrefills(brief: StrategyBriefSections | null): Record<string, string> {
  if (!brief) return {}
  const out: Record<string, string> = {}
  if (brief.mission)        out['mission_beliefs/mission_statement'] = brief.mission
  if (brief.vision)         out['mission_beliefs/vision_statement']  = brief.vision
  if (brief.values)         out['mission_beliefs/values']            = brief.values
  if (brief.founding_story) out['origins_lingo/founding_story']      = brief.founding_story
  if (brief.taglines)       out['origins_lingo/taglines']            = brief.taglines
  return out
}
