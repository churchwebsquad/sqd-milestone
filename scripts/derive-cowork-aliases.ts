/**
 * One-time backfill — derive `cowork_alias_map` for every published
 * Brixies template by reading its `fields[]` and applying heuristics.
 *
 * Run with:
 *   npx tsx scripts/derive-cowork-aliases.ts          # dry run
 *   npx tsx scripts/derive-cowork-aliases.ts --apply  # write to DB
 *
 * The alias map is the contract between cowork's uniform vocabulary
 * (primary_heading / body / items / buttons / etc.) and the Brixies
 * template's actual field shape. Without it, the handoff has to
 * guess which Brixies field carries which uniform slot — that
 * guessing has produced the silent-binding-loss bugs documented in
 * commits c317199 / 0ffa7d0 / 2a0e525.
 *
 * Heuristic per template:
 *   • scan top-level fields[]:
 *     - slot + key='heading'             → primary_heading
 *     - slot + key='tagline'             → tagline
 *     - slot + key='description'         → body  (richtext only)
 *     - slot + key='accent_description'  → accent_body
 *     - group + key='buttons'            → buttons (subfield names
 *       come from item_schema; nesting='contact' when the schema
 *       wraps a 'contact' slot)
 *     - first OTHER group that isn't an image-only/decorative group
 *       → items. Subfields derived from item_schema OR from the
 *       referenced Card template's item_schema.
 *
 * Special inversions handled inline:
 *   • cta_callout-style templates that use `image` field for buttons
 *     (e.g. cta-section-52) — detected when a top-level `image`
 *     group's item_schema has url + label subfields and the template
 *     family is CTA Section.
 */
/* eslint-disable no-console */
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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

// ── Types ──────────────────────────────────────────────────────────

interface FieldDef {
  key:        string
  kind:       'slot' | 'group'
  type?:      'text' | 'richtext' | 'image' | 'cta' | string
  layer_name?:string
  required?:  boolean
  max_chars?: number
  default_count?: number
  item_schema?: FieldDef[]
  // Component-reference variant — the group references another
  // template's item_schema rather than declaring its own.
  referenced_template_id?: string
  referenced_kind?: string
  referenced_family?: string
}

interface ItemsAlias {
  field:        string
  subfields: {
    item_heading?:    string
    item_body?:       string
    item_meta?:       string
    item_cta_label?:  string
    item_cta_url?:    string
    item_image?:      string
  }
  referenced_template_id?: string
  max_items?: number
  /** When the template splits items across two parallel groups (e.g.
   *  accordion_left / accordion_right), the handoff distributes the
   *  cowork-emitted items[] across both. The translator already
   *  understands this shape from the previous manifest. */
  split?: { groups: string[]; rule: 'alternate' | 'halve' }
  /** When the items live nested inside another group (e.g.
   *  team-section-14: row_grid → card_team subfields), the bind has
   *  to wrap each row in the inner group's name before writing. */
  inner_group_field?: string
  /** How many items pack into each row when inner_group_field is
   *  set. Drawn from the inner group's `default_count`. team-section-14
   *  has card_team.default_count=3 so 8 staff become 3 rows
   *  ([3, 3, 2]). When absent, each item is its own row. */
  inner_group_default_count?: number
}

interface CoworkAliasMap {
  primary_heading?: string
  tagline?:         string
  body?:            string
  accent_body?:     string
  items?: ItemsAlias
  buttons?: {
    field:     string
    subfields: { label?: string; url?: string }
    nesting:   'flat' | 'contact' | 'cta_slot'
    max_items?: number
    /** When the buttons slot is a single CTA slot (not a group), the
     *  handoff writes ONE button object directly to field_values.<field>
     *  instead of an array. */
    is_slot?:  boolean
  }
  notes?: string
}

interface Template {
  id:     string
  family: string | null
  fields: FieldDef[] | null
  kind:   string | null
}

// ── Heuristics ─────────────────────────────────────────────────────

/** Slot-level field heuristics: name + type → cowork uniform slot. */
function aliasForSlot(f: FieldDef): keyof CoworkAliasMap | null {
  const k = f.key.toLowerCase()
  if (k === 'heading')                                      return 'primary_heading'
  if (k === 'tagline')                                      return 'tagline'
  if (k === 'description' && f.type === 'richtext')         return 'body'
  if (k === 'accent_description' && f.type === 'richtext')  return 'accent_body'
  // Allowance: plain-text 'description' counts as body when no richtext desc exists.
  if (k === 'description' && f.type === 'text')             return 'body'
  return null
}

/** Subfield → uniform item_X key. Uses substring matching so
 *  variant-specific suffixes like `_card` / `_element_timeline` /
 *  `_team` / `_member` all resolve correctly. */
function aliasForItemSubfield(f: FieldDef): keyof ItemsAlias['subfields'] | null {
  const k = f.key.toLowerCase()
  if (f.type === 'cta')                                                                   return 'item_cta_label'
  if (f.type === 'image' || k.includes('image'))                                          return 'item_image'
  // Heading-likes
  if (k === 'name' || k.endsWith('_name') || k.includes('heading') || k === 'title' || k.endsWith('_title')) return 'item_heading'
  // Body-likes
  if (k.includes('description') || k.includes('bio') || k === 'body' || k.endsWith('_body')) return 'item_body'
  // Meta-likes (role, position, caption, etc.)
  if (k === 'role' || k.endsWith('_role') || k.includes('position') || k === 'meta' || k.includes('caption') || k === 'subtitle') return 'item_meta'
  return null
}

/** Subfield → uniform button label/url key. */
function aliasForButtonSubfield(f: FieldDef): 'label' | 'url' | null {
  const k = f.key.toLowerCase()
  if (k === 'label' || k === 'contact')                  return 'label'
  if (k === 'url' || k === 'link' || k === 'href')       return 'url'
  // CTA-type slots carry both label + url in the value object; we
  // expose them as { label, url } subfields.
  if (f.type === 'cta')                                  return 'label'
  return null
}

/** True when a group looks decorative-only (image gallery, counters
 *  with no semantic content). We never alias these as items. */
function isDecorativeGroup(f: FieldDef): boolean {
  const k = f.key.toLowerCase()
  if (k === 'image' || k === 'images' || k === 'gallery')     return true
  if (k === 'counter' || k === 'counters' || k === 'stat')    return true
  // image-only inner schemas
  const inner = collectInnerSchema(f)
  if (inner.length > 0 && inner.every(s => s.type === 'image')) return true
  return false
}

/** Get the item_schema, resolving referenced templates when present.
 *  This is async-safe: callers can pre-resolve before deriving. */
function collectInnerSchema(f: FieldDef): FieldDef[] {
  if (Array.isArray(f.item_schema)) return f.item_schema
  return []
}

// ── Per-template derivation ────────────────────────────────────────

function deriveAliasMap(
  tpl: Template,
  resolveReferencedSchema: (refId: string) => FieldDef[] | null,
): CoworkAliasMap {
  const map: CoworkAliasMap = {}
  if (!Array.isArray(tpl.fields)) return map
  const fields = tpl.fields

  // Pass 1 — scalar slot aliases.
  for (const f of fields) {
    if (f.kind !== 'slot') continue
    const alias = aliasForSlot(f)
    if (alias === 'primary_heading' && !map.primary_heading) map.primary_heading = f.key
    else if (alias === 'tagline'         && !map.tagline)         map.tagline         = f.key
    else if (alias === 'body'            && !map.body)            map.body            = f.key
    else if (alias === 'accent_body'     && !map.accent_body)     map.accent_body     = f.key
  }

  // Pass 2 — single CTA slot acts as a single-button bucket. Common
  // on CTA-section templates (e.g. cta-section-52 has
  // `buttons` as kind='slot', type='cta' instead of a group).
  for (const f of fields) {
    if (map.buttons) break
    if (f.kind === 'slot' && f.type === 'cta'
        && (f.key.toLowerCase() === 'buttons' || f.key.toLowerCase() === 'cta')) {
      map.buttons = {
        field: f.key,
        subfields: { label: 'label', url: 'url' },
        nesting: 'cta_slot',
        is_slot: true,
        max_items: 1,
      }
    }
  }

  // Pass 3 — group aliases. Tracks which groups remain unmatched so
  // we can promote PAIRS of `*_left` / `*_right` (or similar) into a
  // split-items rule (e.g. faq-section-10 accordion_left + _right).
  const familyIsCta = (tpl.family ?? '').toLowerCase().includes('cta')
  const groupFields = fields.filter(f => f.kind === 'group')
  const groupAliasable: FieldDef[] = []

  for (const f of groupFields) {
    const k = f.key.toLowerCase()
    const inner = f.referenced_template_id
      ? (resolveReferencedSchema(f.referenced_template_id) ?? collectInnerSchema(f))
      : collectInnerSchema(f)

    // Buttons branch
    const looksLikeButtonsByName  = (k === 'buttons')
    const looksLikeButtonsByShape = inner.some(s => aliasForButtonSubfield(s) === 'label')
                                 && inner.some(s => aliasForButtonSubfield(s) === 'url' || s.type === 'cta')
    if (!map.buttons && (looksLikeButtonsByName || (familyIsCta && k === 'image' && looksLikeButtonsByShape))) {
      const subLabel = inner.find(s => aliasForButtonSubfield(s) === 'label')
      const subUrl   = inner.find(s => aliasForButtonSubfield(s) === 'url')
      // Single 'contact' / 'cta' subfield → { contact: { url, label } }
      const onlyContact = inner.length === 1 && inner[0].kind === 'slot'
                       && (inner[0].key === 'contact' || inner[0].type === 'cta')
      map.buttons = {
        field: f.key,
        subfields: {
          label: subLabel?.key ?? (onlyContact ? inner[0].key : 'label'),
          url:   subUrl?.key   ?? (onlyContact ? inner[0].key : 'url'),
        },
        nesting: onlyContact ? 'contact' : 'flat',
        max_items: f.default_count,
      }
      continue
    }

    if (looksLikeButtonsByName)                                continue
    if (familyIsCta && k === 'image' && looksLikeButtonsByShape) continue
    if (isDecorativeGroup(f))                                  continue

    // This group is a candidate for the items alias. Defer the
    // single-vs-split decision to the next loop so we can spot pairs.
    groupAliasable.push(f)
  }

  // Split detection — two same-suffix groups whose only difference is
  // a `_left`/`_right` or `_a`/`_b` suffix. (faq-section-10 case.)
  if (groupAliasable.length >= 2) {
    const sortedByLen = [...groupAliasable].sort((a, b) => a.key.length - b.key.length)
    for (let i = 0; i < sortedByLen.length; i++) {
      for (let j = i + 1; j < sortedByLen.length; j++) {
        const a = sortedByLen[i].key
        const b = sortedByLen[j].key
        const stemA = a.replace(/_(left|right|a|b|1|2|primary|secondary)$/i, '')
        const stemB = b.replace(/_(left|right|a|b|1|2|primary|secondary)$/i, '')
        if (stemA === stemB && stemA !== a && stemA !== b) {
          // Treat as split. Use first group's subfields as canonical.
          const ref = sortedByLen[i]
          const refInner = ref.referenced_template_id
            ? (resolveReferencedSchema(ref.referenced_template_id) ?? collectInnerSchema(ref))
            : collectInnerSchema(ref)
          const subs = buildItemSubfields(refInner)
          if (subs.item_heading || subs.item_body) {
            const totalDefault = (sortedByLen[i].default_count ?? 0) + (sortedByLen[j].default_count ?? 0)
            map.items = {
              field: a,
              subfields: subs,
              referenced_template_id: ref.referenced_template_id,
              max_items: totalDefault || undefined,
              split: { groups: [a, b], rule: 'alternate' },
            }
            // Mark both as consumed
            groupAliasable.splice(groupAliasable.indexOf(sortedByLen[j]), 1)
            groupAliasable.splice(groupAliasable.indexOf(sortedByLen[i]), 1)
            break
          }
        }
      }
      if (map.items) break
    }
  }

  // Single items group — pick the first remaining candidate.
  if (!map.items) {
    for (const f of groupAliasable) {
      const inner = f.referenced_template_id
        ? (resolveReferencedSchema(f.referenced_template_id) ?? collectInnerSchema(f))
        : collectInnerSchema(f)
      // Nested-group descent: when the outer group's item_schema is
      // a single group (team-section-14: row_grid → card_team) OR
      // has a single non-decorative group child alongside decorative
      // siblings (content-section-89: column_list → image slot + card
      // group), descend into the meaningful group's item_schema for
      // the real subfields. The handoff translator wraps each row in
      // the inner_group_field at bind time.
      let workingInner = inner
      let inner_group_field: string | undefined
      let inner_group_default_count: number | undefined
      const innerGroups = inner.filter(s => s.kind === 'group')
      const innerNonDecorativeSlots = inner.filter(s =>
        s.kind === 'slot' && s.type !== 'image' && s.type !== 'cta',
      )
      if (innerGroups.length === 1 && innerNonDecorativeSlots.length === 0) {
        inner_group_field = innerGroups[0].key
        inner_group_default_count = innerGroups[0].default_count
        workingInner = innerGroups[0].item_schema ?? []
      }

      const subs = buildItemSubfields(workingInner)
      if (subs.item_heading || subs.item_body) {
        map.items = {
          field: f.key,
          subfields: subs,
          referenced_template_id: f.referenced_template_id,
          max_items: f.default_count,
          ...(inner_group_field ? { inner_group_field } : {}),
          ...(inner_group_default_count ? { inner_group_default_count } : {}),
        }
        break
      }
    }
  }

  return map
}

function buildItemSubfields(inner: FieldDef[]): ItemsAlias['subfields'] {
  const out: ItemsAlias['subfields'] = {}
  for (const s of inner) {
    if (s.kind !== 'slot') continue
    const alias = aliasForItemSubfield(s)
    if (alias && !out[alias]) out[alias] = s.key
  }
  // Item CTA URL — when an item_cta_label exists, look for a sibling
  // URL slot (often same key + '_url' suffix or any 'url'-named slot).
  if (out.item_cta_label && !out.item_cta_url) {
    const u = inner.find(s => s.kind === 'slot' && (s.key.toLowerCase().includes('url') || s.key.toLowerCase().includes('link')))
    if (u) out.item_cta_url = u.key
  }
  return out
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const sb = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })

  // Load every published template.
  const { data, error } = await sb
    .from('web_content_templates')
    .select('id, family, fields, kind')
    .eq('is_published', true)
    .limit(5000)
  if (error) { console.error(error.message); process.exit(1) }
  const templates = (data ?? []) as Template[]
  console.log(`Loaded ${templates.length} published templates.`)

  // Build a quick index for resolving referenced_template_id during
  // derivation (e.g. feature-section-2.card → card-213.item_schema).
  const byId = new Map(templates.map(t => [t.id, t]))
  const resolveReferencedSchema = (refId: string): FieldDef[] | null => {
    const t = byId.get(refId)
    if (!t || !Array.isArray(t.fields)) return null
    // Card-family templates put their content inside a top-level
    // 'card' group whose item_schema is the actual subfield list.
    const cardGroup = t.fields.find(f => f.kind === 'group' && f.key === 'card')
    if (cardGroup?.item_schema) return cardGroup.item_schema
    return t.fields
  }

  let tallies = { covered: 0, partial: 0, empty: 0 }
  const updates: Array<{ id: string; map: CoworkAliasMap }> = []
  for (const t of templates) {
    const map = deriveAliasMap(t, resolveReferencedSchema)
    const hasContent = !!(map.primary_heading || map.body || map.items || map.buttons)
    const isCovered  = !!(map.primary_heading && (map.body || map.items || map.buttons))
    if (isCovered)        tallies.covered++
    else if (hasContent)  tallies.partial++
    else                  tallies.empty++
    updates.push({ id: t.id, map })
  }

  console.log()
  console.log('Coverage tallies:', tallies)
  console.log()

  // Show a sample so we can sanity-check before --apply
  for (const sample of ['feature-section-2','feature-section-6','feature-section-14','content-section-45','cta-section-52','team-section-14','timeline-section-6','faq-section-10']) {
    const u = updates.find(x => x.id === sample)
    if (u) console.log(sample.padEnd(28), JSON.stringify(u.map))
  }

  if (!APPLY) {
    console.log()
    console.log('Dry run only. Re-run with --apply to write to DB.')
    return
  }

  console.log()
  console.log('Applying…')
  let i = 0
  for (const u of updates) {
    const { error: e } = await sb
      .from('web_content_templates')
      .update({ cowork_alias_map: u.map })
      .eq('id', u.id)
    if (e) {
      console.error(`  ${u.id}: ${e.message}`)
    } else {
      i++
      if (i % 50 === 0) console.log(`  …${i}/${updates.length}`)
    }
  }
  console.log(`Wrote cowork_alias_map for ${i}/${updates.length} templates.`)
}

main().catch(e => { console.error(e); process.exit(1) })
