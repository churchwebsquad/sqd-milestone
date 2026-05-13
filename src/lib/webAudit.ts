/**
 * Web Manager — Audit engine.
 *
 * Lightweight rule-based scanner that surfaces heuristic violations
 * on a page's authored content (concatenated from all sections'
 * field_values). Feeds the Assistant Rail's Audit tab.
 *
 * Rules mirror the global writing rules — em-dashes, filler
 * intensifiers, AI cliché vocabulary, "We/Our" framing in body copy,
 * H1 word count, etc. Per-project rules layer on top in Phase C.
 *
 * Each finding carries enough context for the rail to render + offer
 * a jump-to action back into the editor. Section + field locators are
 * structural keys (not DOM IDs) so the editor host can decide how to
 * scroll / highlight.
 */

import { supabase } from './supabase'
import type { WebSection, WebContentTemplate, WebFieldDef } from '../types/database'

export type AuditSeverity = 'high' | 'medium' | 'low'

export interface AuditFinding {
  id: string                     // unique key for React + dedupe
  rule_id: string                // 'em_dash', 'we_opener', etc.
  rule_label: string             // short headline
  severity: AuditSeverity
  message: string                // full description of the violation
  suggestion?: string            // optional one-line fix hint
  /** Where the violation lives — used for jump-to-source */
  location: {
    section_id: string
    section_label: string        // template's layer_name for the rail
    field_key: string
    item_index?: number          // when field is a group item
    matched_text: string         // the offending snippet
  }
}

interface ScanInput {
  section: WebSection
  template: WebContentTemplate
}

/** Run every rule across every section's authored text and return the
 *  flat list of findings, sorted by severity then rule. */
export async function runAudit(pageId: string): Promise<AuditFinding[]> {
  const { data: sectionRows } = await supabase
    .from('web_sections')
    .select('*')
    .eq('web_page_id', pageId)
    .order('sort_order')

  const sections = (sectionRows ?? []) as WebSection[]
  if (sections.length === 0) return []

  const tplIds = [...new Set(sections.map(s => s.content_template_id))]
  const { data: tplRows } = await supabase
    .from('web_content_templates')
    .select('id, layer_name, fields')
    .in('id', tplIds)
  const templateById: Record<string, WebContentTemplate> = {}
  for (const t of (tplRows ?? []) as WebContentTemplate[]) templateById[t.id] = t

  const inputs: ScanInput[] = sections
    .filter(s => templateById[s.content_template_id])
    .map(s => ({ section: s, template: templateById[s.content_template_id] }))

  const findings: AuditFinding[] = []
  for (const input of inputs) {
    findings.push(...scanSection(input))
  }

  const sev: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => sev[a.severity] - sev[b.severity] || a.rule_id.localeCompare(b.rule_id))
  return findings
}

// ── Section scanner ───────────────────────────────────────────────────

function scanSection({ section, template }: ScanInput): AuditFinding[] {
  const out: AuditFinding[] = []
  const values = (section.field_values ?? {}) as Record<string, unknown>
  const sectionLabel = template.layer_name

  for (const field of template.fields) {
    out.push(...scanField(field, values[field.key], section.id, sectionLabel))
  }

  return out
}

function scanField(
  field: WebFieldDef,
  value: unknown,
  sectionId: string,
  sectionLabel: string,
  itemIndex?: number,
): AuditFinding[] {
  if (field.kind === 'group') {
    if (!Array.isArray(value)) return []
    const out: AuditFinding[] = []
    value.forEach((item, idx) => {
      if (typeof item !== 'object' || item === null) return
      for (const subField of field.item_schema) {
        out.push(...scanField(subField, (item as Record<string, unknown>)[subField.key], sectionId, sectionLabel, idx))
      }
    })
    return out
  }

  // Slot — collect text from each supported field type
  const text = extractText(value, field.type)
  if (!text || text.trim().length === 0) return []

  return RULES.flatMap(rule => rule.check({
    text,
    fieldKey: field.key,
    fieldType: field.type,
    headingLevel: field.heading_level ?? null,
    sectionId,
    sectionLabel,
    itemIndex,
  }))
}

function extractText(value: unknown, type: string): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    // For richtext, strip HTML tags but keep text content
    if (type === 'richtext' && value.includes('<')) {
      return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    }
    return value
  }
  if (typeof value === 'object') {
    // CTA: { label, url } — return label only (URL isn't language)
    const obj = value as Record<string, unknown>
    if (typeof obj.label === 'string') return obj.label
  }
  return ''
}

// ── Rule definitions ─────────────────────────────────────────────────

interface RuleContext {
  text: string
  fieldKey: string
  fieldType: string
  headingLevel: number | null
  sectionId: string
  sectionLabel: string
  itemIndex?: number
}

interface Rule {
  id: string
  label: string
  severity: AuditSeverity
  check: (ctx: RuleContext) => AuditFinding[]
}

const AI_CLICHES = [
  'delve', 'tapestry', 'unlock', 'unleash', 'elevate', 'beacon',
  'embark', 'resonate', 'dynamic', 'synergistic', 'game-changer',
  'testament', 'in a world where', 'at the heart of', 'journey of faith',
]

const FILLER_INTENSIFIERS = [
  'truly', 'really', 'deeply', 'incredibly', 'very', 'amazing', 'just', 'simply',
]

const RULES: Rule[] = [
  {
    id: 'em_dash',
    label: 'No em-dashes',
    severity: 'high',
    check: ({ text, ...loc }) => findMatches(text, /[—–]/g, {
      ...loc,
      makeFinding: (match) => ({
        rule_id: 'em_dash',
        rule_label: 'No em-dashes',
        severity: 'high',
        message: 'Em-dashes (— or –) are banned in body copy. Use a period or comma instead.',
        suggestion: 'Replace with a period or comma',
        matched_text: match,
      }),
    }),
  },

  {
    id: 'ai_cliches',
    label: 'AI cliché vocabulary',
    severity: 'high',
    check: ({ text, ...loc }) => {
      const out: AuditFinding[] = []
      for (const cliche of AI_CLICHES) {
        const re = new RegExp(`\\b${escapeRegex(cliche)}\\b`, 'gi')
        out.push(...findMatches(text, re, {
          ...loc,
          makeFinding: (match) => ({
            rule_id: 'ai_cliches',
            rule_label: 'AI cliché vocabulary',
            severity: 'high',
            message: `"${match}" is on the global avoid-list — reads as generic AI output.`,
            matched_text: match,
          }),
        }))
      }
      return out
    },
  },

  {
    id: 'we_opener',
    label: '"We/Our" framing',
    severity: 'medium',
    check: ({ text, fieldType, fieldKey, ...loc }) => {
      // Skip slot keys that legitimately use "we" (e.g. titles)
      if (fieldType !== 'richtext' && fieldType !== 'text') return []
      const sentences = text.split(/(?<=[.!?])\s+/)
      const out: AuditFinding[] = []
      for (const s of sentences) {
        if (/^(We|Our)\b/.test(s.trim())) {
          out.push({
            id: cryptoRandom(),
            rule_id: 'we_opener',
            rule_label: '"We/Our" framing',
            severity: 'medium',
            message: 'Body copy avoids "We / Our" — refer to the church by name or "this community."',
            suggestion: 'Replace with the church name or "this community"',
            location: {
              section_id: loc.sectionId,
              section_label: loc.sectionLabel,
              field_key: fieldKey,
              item_index: loc.itemIndex,
              matched_text: s.slice(0, 60) + (s.length > 60 ? '…' : ''),
            },
          })
        }
      }
      return out
    },
  },

  {
    id: 'filler_intensifier',
    label: 'Filler intensifier',
    severity: 'low',
    check: ({ text, ...loc }) => {
      const out: AuditFinding[] = []
      for (const word of FILLER_INTENSIFIERS) {
        const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi')
        out.push(...findMatches(text, re, {
          ...loc,
          makeFinding: (match) => ({
            rule_id: 'filler_intensifier',
            rule_label: 'Filler intensifier',
            severity: 'low',
            message: `"${match}" is a filler intensifier — cut for stronger language.`,
            matched_text: match,
          }),
        }))
      }
      return out
    },
  },

  {
    id: 'h1_word_count',
    label: 'H1 is 4–7 words',
    severity: 'medium',
    check: ({ text, headingLevel, ...loc }) => {
      if (headingLevel !== 1) return []
      const words = text.trim().split(/\s+/).filter(Boolean).length
      if (words >= 4 && words <= 7) return []
      return [{
        id: cryptoRandom(),
        rule_id: 'h1_word_count',
        rule_label: 'H1 is 4–7 words',
        severity: 'medium',
        message: `H1 has ${words} word${words === 1 ? '' : 's'}. Target 4–7 so it renders cleanly on mobile.`,
        location: {
          section_id: loc.sectionId,
          section_label: loc.sectionLabel,
          field_key: loc.fieldKey,
          item_index: loc.itemIndex,
          matched_text: text.slice(0, 60),
        },
      }]
    },
  },

  {
    id: 'em_in_meta',
    label: 'Meta title length',
    severity: 'low',
    check: ({ text, fieldKey, ...loc }) => {
      if (!fieldKey.includes('meta_title') && fieldKey !== 'meta_title') return []
      if (text.length <= 60) return []
      return [{
        id: cryptoRandom(),
        rule_id: 'em_in_meta',
        rule_label: 'Meta title length',
        severity: 'low',
        message: `Meta title is ${text.length} characters — keep ≤ 60.`,
        location: {
          section_id: loc.sectionId,
          section_label: loc.sectionLabel,
          field_key: fieldKey,
          item_index: loc.itemIndex,
          matched_text: text.slice(0, 60) + '…',
        },
      }]
    },
  },

  {
    id: 'triple_adjective',
    label: 'Three-adjective cluster',
    severity: 'low',
    check: ({ text, ...loc }) => {
      // Heuristic: three adjective-shaped words separated by commas/and
      // (this is imprecise without a real POS tagger, so we err toward
      // false negatives over false positives — only fires on the most
      // egregious "X, Y, Z" patterns with three short descriptors)
      const re = /\b([a-z]{4,12}),\s+([a-z]{4,12}),?\s+(?:and\s+)?([a-z]{4,12})\b/gi
      return findMatches(text, re, {
        ...loc,
        makeFinding: (match) => ({
          rule_id: 'triple_adjective',
          rule_label: 'Possible three-adjective cluster',
          severity: 'low',
          message: `"${match}" — three adjectives in a row read as fluff. Pick the strongest one.`,
          matched_text: match,
        }),
      })
    },
  },
]

// ── Helpers ───────────────────────────────────────────────────────────

interface MakeFindingArgs {
  rule_id: string
  rule_label: string
  severity: AuditSeverity
  message: string
  suggestion?: string
  matched_text: string
}

function findMatches(
  text: string,
  re: RegExp,
  opts: {
    fieldKey: string
    sectionId: string
    sectionLabel: string
    itemIndex?: number
    makeFinding: (match: string) => MakeFindingArgs
  },
): AuditFinding[] {
  const out: AuditFinding[] = []
  for (const m of text.matchAll(re)) {
    const matched = m[0]
    const args = opts.makeFinding(matched)
    out.push({
      id: cryptoRandom(),
      rule_id: args.rule_id,
      rule_label: args.rule_label,
      severity: args.severity,
      message: args.message,
      suggestion: args.suggestion,
      location: {
        section_id: opts.sectionId,
        section_label: opts.sectionLabel,
        field_key: opts.fieldKey,
        item_index: opts.itemIndex,
        matched_text: args.matched_text,
      },
    })
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cryptoRandom(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID()
  }
  return Math.random().toString(36).slice(2)
}
