// Inventory-layer diagnosis (v1.6).
//
// Reads `web_project_topics.items` BEFORE template binding and emits
// the same DiscoverySection-shaped output the bound-layer diagnostic
// emits, so dev handoff surfaces schemas that exist in source even
// when no bound section has been created yet.
//
// Why this matters: cowork's uniform 5-slot bound shape compresses
// rich source fields (bio, email, meeting_locations, etc.) at the
// binding step. The bound-layer diagnostic can only see what survived
// compression. The inventory-layer diagnostic sees the SOURCE — so
// real upstream drops are visible.
//
// Also used by:
// - The inventory-vs-bound comparator (see compareInventoryToBound)
//   which surfaces fields-present-in-source-but-missing-from-bound as
//   real library_coverage_gap build-time issues.

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySchema } from './classifySchema'
import type { DiscoverySection } from './types'

/** One row from web_project_topics, narrowed to fields we use. */
interface InventoryTopicRow {
  topic_key:     string
  topic_label:   string
  topic_group:   string | null
  inventory_kind: string | null
  items:         unknown
  source_page_urls: string[] | null
}

/** Inventory item — shape varies by `kind` field. We accept any shape
 *  and normalize at the per-kind layer. */
interface InventoryItem {
  kind?: string
  name?: string
  title?: string
  label?: string
  description?: string
  role?: string
  email?: string | null
  phone?: string | null
  bio?: string | null
  photo_url?: string | null
  profile_url?: string | null
  credentials?: string | null
  url?: string
  value?: string
  question?: string
  answer?: string
  text?: string
  reference?: string
  passages?: unknown[]
  items?: unknown[]
  source_url?: string
  [key: string]: unknown
}

export async function loadInventoryTopics(
  webProjectId: string,
  sb: SupabaseClient,
): Promise<InventoryTopicRow[]> {
  const { data, error } = await sb
    .from('web_project_topics')
    .select('topic_key, topic_label, topic_group, inventory_kind, items, source_page_urls')
    .eq('web_project_id', webProjectId)
  if (error) throw error
  return (data ?? []) as InventoryTopicRow[]
}

/** Topic keys whose semantic page-slug differs from the topic key
 *  (e.g. topic_key='location_contact' but the page slug a partner
 *  uses is 'contact'). The classifier reads slug as a signal; a
 *  good mapping improves classification. */
const TOPIC_KEY_TO_PAGE_SLUG: Record<string, string> = {
  location_contact: 'contact',
  connect_groups:   'groups',
  plan_visit:       'plan-visit',
  new_here:         'new',
  worship_music:    'worship',
  leadership:       'team',
  about:            'about',
  sundays:          'sundays',
  beliefs:          'beliefs',
  sermons:          'sermons',
  events:           'events',
  kids:             'kids',
  students:         'students',
  adults:           'adults',
  college:          'college',
  missions:         'missions',
  serve:            'serve',
  care:             'care',
  giving:           'give',
  capital_campaign: 'give',
  special_needs:    'special-needs',
  counseling:       'counseling',
  school:           'school',
  blog_news:        'blog',
  testimonies:      'testimonies',
  newsletter_bulletin: 'resources',
}

/** Synthesized "primary group" extracted from an inventory topic.
 *  The dominant content kind's items become the items the classifier
 *  reads. */
interface SynthesizedGroup {
  /** Topic the group came from. */
  topic_key:   string
  /** Topic label — used as the section heading. */
  topic_label: string
  /** Derived page slug (synthetic; pre-binding there's no real page yet). */
  page_slug:   string
  /** Synthesized items with canonical-field-style keys (`name`,
   *  `role`, `bio`, `headshot`, etc.). */
  items:       Array<Record<string, unknown>>
  /** Item count BEFORE we narrowed to the dominant kind. Used in the
   *  comparator to track "items the partner has on this concept". */
  total_item_count: number
  /** What `kind` filter we applied to get items (or null if all kept). */
  dominant_kind: string | null
}

export function synthesizeInventoryGroups(topics: InventoryTopicRow[]): SynthesizedGroup[] {
  const out: SynthesizedGroup[] = []
  for (const topic of topics) {
    const items = Array.isArray(topic.items) ? (topic.items as InventoryItem[]) : []
    if (items.length === 0) continue
    const groups = groupItemsByDominantKind(items)
    for (const { kind, items: kindItems } of groups) {
      out.push({
        topic_key:   topic.topic_key,
        topic_label: topic.topic_label,
        page_slug:   TOPIC_KEY_TO_PAGE_SLUG[topic.topic_key] ?? topic.topic_key,
        items:       kindItems.map(normalizeInventoryItem),
        total_item_count: items.length,
        dominant_kind: kind,
      })
    }
  }
  return out
}

/** Partition items by `kind`. Returns the kinds whose item count
 *  is ≥ 2 (likely a repeating-item set), in descending count order.
 *  Single items don't drive classification (they're trivial). */
function groupItemsByDominantKind(items: InventoryItem[]): Array<{ kind: string | null; items: InventoryItem[] }> {
  const byKind = new Map<string, InventoryItem[]>()
  for (const item of items) {
    const k = item.kind ?? 'unknown'
    const list = byKind.get(k) ?? []
    list.push(item)
    byKind.set(k, list)
  }
  // Exclude scaffolding kinds — these never make for "content cards".
  const SCAFFOLDING_KINDS = new Set(['key_phrase', 'scripture', 'cta', 'unknown'])
  const groups: Array<{ kind: string | null; items: InventoryItem[] }> = []
  for (const [kind, list] of byKind.entries()) {
    if (SCAFFOLDING_KINDS.has(kind)) continue
    if (list.length < 2) continue
    groups.push({ kind, items: list })
  }
  return groups.sort((a, b) => b.items.length - a.items.length)
}

/** Map an inventory item's kind-specific shape to canonical schema
 *  field keys. The bound-layer items use Brixies slot names
 *  (heading_card / description_card); inventory items use semantic
 *  names (name / role / bio). The classifier already handles both
 *  via aliases, so this normalization is light — mostly preserves
 *  the inventory's richer shape verbatim, but folds nested `items`
 *  arrays of `kind: 'detail'` rows into flat key=value entries. */
function normalizeInventoryItem(item: InventoryItem): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // Lift all top-level fields verbatim (preserves bio, email, phone,
  // role, etc.). Drop nullish + the `kind` discriminator (already
  // used at the group level).
  for (const [k, v] of Object.entries(item)) {
    if (k === 'kind' || k === 'source_url' || k === 'passages' || k === 'items') continue
    if (v == null || v === '') continue
    out[k] = v
  }
  // Photo aliases — normalize to `headshot` so classifier's person_card
  // discriminator picks it up directly.
  if (item.photo_url && !out.headshot) out.headshot = item.photo_url
  else if (item.profile_url && !out.headshot) out.headshot = item.profile_url
  // Detail rows nested under `items` (the cowork-extracted pattern):
  // e.g. { kind:'program', name:'Elders', items:[{kind:'detail', label:'Role', value:'…'}] }
  // Lift each detail row as a top-level key with snake_cased label.
  if (Array.isArray(item.items)) {
    for (const sub of item.items as InventoryItem[]) {
      if (sub.kind === 'detail' && typeof sub.label === 'string' && sub.value != null) {
        const key = sub.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        if (!(key in out)) out[key] = sub.value
      } else if (sub.kind === 'cta' && typeof sub.url === 'string') {
        if (!out.cta_url)   out.cta_url   = sub.url
        if (!out.cta_label) out.cta_label = sub.label
      }
    }
  }
  return out
}

/** A DiscoverySection-shaped record produced from the inventory
 *  layer. Distinguishable from bound-layer rows by `source: 'inventory'`. */
export interface InventoryDiscoveryRow extends Omit<DiscoverySection,
  'section_id' | 'web_page_id' | 'page_name' | 'section_role' | 'cpt_subroutine_ref' | 'target_hint'
> {
  source:              'inventory'
  /** Synthetic ID — there's no real web_section. Use `inv:{topic_key}:{kind}`. */
  section_id:          string
  /** No bound web_page yet. Empty string. */
  web_page_id:         string
  page_name:           string
  section_role:        null
  cpt_subroutine_ref:  null
  target_hint:         DiscoverySection['target_hint']
  /** Inventory item count BEFORE narrowing to the dominant kind. */
  total_topic_items:   number
  /** Which kind filter produced the items in this row. */
  dominant_kind:       string | null
}

/** Build per-topic inventory diagnosis rows. One row per dominant
 *  content kind found in each topic. */
export function buildInventoryDiscoverySections(
  topics: InventoryTopicRow[],
): InventoryDiscoveryRow[] {
  const groups = synthesizeInventoryGroups(topics)
  const out: InventoryDiscoveryRow[] = []
  for (const g of groups) {
    // Classifier reads inventory items with their semantic keys (name,
    // role, bio, …) — no template_field_keys to compare against, so
    // pass an empty array. in_bound_template flags will be all false;
    // the bound-vs-inventory comparator will fix that.
    const diag = classifySchema({
      page_slug:           g.page_slug,
      heading:             g.topic_label,
      section_role:        null,
      items:               g.items,
      template_field_keys: [],
      template_id:         '(inventory)',
    })
    const itemKeys = Array.from(new Set(g.items.flatMap(i => Object.keys(i))))
    out.push({
      source:              'inventory',
      section_id:          `inv:${g.topic_key}:${g.dominant_kind ?? 'all'}`,
      web_page_id:         '',
      page_slug:           g.page_slug,
      page_name:           g.topic_label,
      heading:             g.topic_label,
      section_role:        null,
      item_count:          g.items.length,
      schema:              itemKeys,
      sample_names:        g.items.slice(0, 3).map(item => firstStringValue(item)).filter((v): v is string => !!v),
      sample_record:       g.items[0] ?? null,
      target_hint:         'unknown',
      cpt_subroutine_ref:  null,
      total_topic_items:   g.total_item_count,
      dominant_kind:       g.dominant_kind,
      schema_name:              diag.schema_name,
      schema_confidence:        diag.schema_confidence,
      schema_field_diagnostics: diag.schema_field_diagnostics,
      cta_target_breakdown:     diag.cta_target_breakdown,
      build_time_issues:        diag.build_time_issues,
    })
  }
  return out
}

function firstStringValue(item: Record<string, unknown>): string | null {
  for (const key of ['name', 'title', 'label', 'question', 'heading']) {
    const v = item[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80)
  }
  return null
}
