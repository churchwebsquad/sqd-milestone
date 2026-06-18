/**
 * Helpers for linking a Team Section 14 card to a per-staff bio page.
 *
 * Data model (no new tables, no new columns):
 *  - Source of truth for shared staff content lives in `church_facts`
 *    rows where `topic = 'staff'`. Each row's id is the `staff_fact_id`
 *    other surfaces reference. The `data` jsonb holds name, role, bio,
 *    avatar_url, email, etc.
 *  - Team 14 items hold two meta fields in their field_values:
 *      _display_mode: 'inline' | 'linked'
 *      _staff_fact_id: uuid (when linked)
 *  - Single Team Section 6 sections store the same _staff_fact_id in
 *    field_values for the renderer to read.
 *  - Per-staff bio pages have slug `staff/<kebab-name>`. The workspace
 *    sidebar filters these out via .not('slug','like','staff/%').
 *
 * On flip inline → linked:
 *   findOrCreateStaffFact() finds a church_facts row matching the
 *   staff's name within the project (creates one with seed data if
 *   missing), then ensurePerStaffPage() creates the per-staff web_page
 *   if needed, then appendSingleTeamSection() inserts a Single Team
 *   Section 6 row pointed at the staff_fact_id. The caller writes the
 *   resulting fact_id back into the Team 14 item.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Minimal shape we read out of church_facts. */
export interface StaffFact {
  id:     string
  name:   string
  role:   string
  bio:    string
  email?: string
  avatar_url?: string
}

/** kebab-case a staff name for a URL slug. "Lewis Galloway" → "lewis-galloway" */
export function staffSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Look up an existing `church_facts` row for this staff member within
 *  the project, or insert a new one seeded with the Team 14 item's
 *  current name/role/bio. Returns the row's uuid. */
export async function findOrCreateStaffFact(
  sb:           SupabaseClient,
  projectId:    string,
  seed:         { name: string; role?: string; bio?: string; avatar_url?: string },
): Promise<string> {
  if (!seed.name?.trim()) {
    throw new Error('staff name required to link Team 14 card')
  }
  const cleanName = seed.name.trim()

  // First try exact-name match within the project.
  const { data: existing } = await sb
    .from('church_facts')
    .select('id, data')
    .eq('web_project_id', projectId)
    .eq('topic', 'staff')
    .eq('data->>name', cleanName)
    .limit(1)
  const hit = (existing ?? [])[0] as { id: string; data: Record<string, unknown> } | undefined
  if (hit) {
    // Merge any new seed fields (role/bio/avatar_url) into existing data
    // — preserve already-set values, only fill blanks.
    const next: Record<string, unknown> = { ...(hit.data ?? {}) }
    if (!next.role && seed.role)             next.role = seed.role
    if (!next.bio && seed.bio)               next.bio = seed.bio
    if (!next.avatar_url && seed.avatar_url) next.avatar_url = seed.avatar_url
    if (JSON.stringify(next) !== JSON.stringify(hit.data ?? {})) {
      await sb.from('church_facts').update({ data: next }).eq('id', hit.id)
    }
    return hit.id
  }

  // Create a fresh row.
  const data: Record<string, unknown> = { name: cleanName }
  if (seed.role)       data.role       = seed.role
  if (seed.bio)        data.bio        = seed.bio
  if (seed.avatar_url) data.avatar_url = seed.avatar_url
  const { data: inserted, error: insErr } = await sb
    .from('church_facts')
    .insert({
      web_project_id:    projectId,
      topic:             'staff',
      data,
      source_kind:       'workspace_link',
      display_label:     cleanName,
      is_snippet:        false,
    })
    .select('id')
    .single()
  if (insErr || !inserted) throw insErr ?? new Error('failed to insert church_facts')
  return (inserted as { id: string }).id
}

/** Read a staff fact by id; returns null when missing. */
export async function readStaffFact(
  sb: SupabaseClient,
  factId: string,
): Promise<StaffFact | null> {
  const { data } = await sb
    .from('church_facts')
    .select('id, data')
    .eq('id', factId)
    .single()
  if (!data) return null
  const row = data as { id: string; data: Record<string, unknown> }
  return {
    id:        row.id,
    name:      String(row.data?.name ?? ''),
    role:      String(row.data?.role ?? ''),
    bio:       String(row.data?.bio ?? ''),
    email:     row.data?.email      ? String(row.data.email)      : undefined,
    avatar_url:row.data?.avatar_url ? String(row.data.avatar_url) : undefined,
  }
}

/** Merge new values into a church_facts row's `data` jsonb. Used by
 *  the two-way sync (Phase 3) — strategist edits flow through here. */
export async function updateStaffFact(
  sb:       SupabaseClient,
  factId:   string,
  patch:    Partial<Pick<StaffFact, 'name' | 'role' | 'bio' | 'email' | 'avatar_url'>>,
): Promise<void> {
  const { data: existing } = await sb
    .from('church_facts')
    .select('data')
    .eq('id', factId)
    .single()
  const current = (existing as { data: Record<string, unknown> } | null)?.data ?? {}
  const next = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue
    next[k] = v
  }
  await sb.from('church_facts').update({ data: next, display_label: String(next.name ?? '') }).eq('id', factId)
}

/** Find or create the per-staff bio page (`slug = staff/<kebab-name>`).
 *  Returns { pageId, isNew }. The page is created with archived=false +
 *  the same web_project_id as the calling section. Slug is unique
 *  within the project; if a same-named staff already has a page, we
 *  return its id rather than creating a duplicate. */
export async function ensurePerStaffPage(
  sb:           SupabaseClient,
  projectId:    string,
  staffName:    string,
  staffSlugOverride?: string,
): Promise<{ pageId: string; pageSlug: string; isNew: boolean }> {
  const slug = `staff/${staffSlugOverride?.trim() || staffSlug(staffName)}`
  if (slug === 'staff/') throw new Error('cannot derive slug from blank name')

  const { data: existing } = await sb
    .from('web_pages')
    .select('id, slug')
    .eq('web_project_id', projectId)
    .eq('slug', slug)
    .limit(1)
  const hit = (existing ?? [])[0] as { id: string; slug: string } | undefined
  if (hit) return { pageId: hit.id, pageSlug: hit.slug, isNew: false }

  // Compute a sort_order at the END of the project's pages so the
  // new staff page sorts last (it's hidden from the sidebar anyway).
  const { data: tail } = await sb
    .from('web_pages')
    .select('sort_order')
    .eq('web_project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextSort = ((tail?.[0]?.sort_order ?? 0) as number) + 1

  const { data: inserted, error: insErr } = await sb
    .from('web_pages')
    .insert({
      web_project_id: projectId,
      name:           staffName,
      slug,
      phase:          '1',
      sort_order:     nextSort,
      archived:       false,
      content_status: 'draft',
    })
    .select('id, slug')
    .single()
  if (insErr || !inserted) throw insErr ?? new Error('failed to create per-staff page')
  return { pageId: (inserted as { id: string }).id, pageSlug: (inserted as { slug: string }).slug, isNew: true }
}

/** One staff update extracted from a section's field_values. The
 *  syncStaffLinkOnSave path produces these per linked card / section
 *  and propagates them to church_facts + every other linked section
 *  in the project. */
export interface StaffUpdate {
  factId: string
  name:   string
  role:   string
  bio:    string
}

/** Extract one StaffUpdate per linked card / section from the given
 *  field_values, based on the bound template's shape.
 *
 *  - team-section-14: walks row_grid → card_team. One update per card
 *    that has a non-blank _staff_fact_id. Card fields:
 *      team_name        → name
 *      team_position    → role
 *      team_description → bio
 *  - single-team-section-6: a single update from the top-level fields
 *    if _staff_fact_id is set. Top-level fields:
 *      heading     → name
 *      tagline     → role
 *      description → bio
 *  - any other template_id returns []. */
export function extractStaffUpdates(
  templateId: string | null,
  fieldValues: Record<string, unknown>,
): StaffUpdate[] {
  if (!templateId) return []
  if (templateId === 'team-section-14') {
    const out: StaffUpdate[] = []
    const rowGrid = Array.isArray(fieldValues.row_grid) ? (fieldValues.row_grid as Array<Record<string, unknown>>) : []
    for (const row of rowGrid) {
      const cards = Array.isArray(row?.card_team) ? (row.card_team as Array<Record<string, unknown>>) : []
      for (const cell of cards) {
        const factId = typeof cell._staff_fact_id === 'string' ? cell._staff_fact_id : ''
        if (!factId) continue
        out.push({
          factId,
          name: String(cell.team_name ?? '').trim(),
          role: String(cell.team_position ?? '').trim(),
          bio:  typeof cell.team_description === 'string' ? cell.team_description : '',
        })
      }
    }
    return out
  }
  if (templateId === 'single-team-section-6') {
    const factId = typeof fieldValues._staff_fact_id === 'string' ? fieldValues._staff_fact_id : ''
    if (!factId) return []
    return [{
      factId,
      name: String(fieldValues.heading ?? '').trim(),
      role: String(fieldValues.tagline ?? '').trim(),
      bio:  typeof fieldValues.description === 'string' ? fieldValues.description : '',
    }]
  }
  return []
}

/** Apply a list of StaffUpdates to a section's field_values, returning
 *  a new field_values object when ANY change lands. Returns null when
 *  the section either references none of the updates' factIds or the
 *  values were already identical (no-op write). */
export function applyStaffUpdatesToSection(
  templateId: string | null,
  fieldValues: Record<string, unknown>,
  updates: StaffUpdate[],
): Record<string, unknown> | null {
  if (updates.length === 0 || !templateId) return null
  const byFactId = new Map(updates.map(u => [u.factId, u]))

  if (templateId === 'team-section-14') {
    let changed = false
    const next = { ...fieldValues }
    const rowGrid = Array.isArray(next.row_grid) ? [...(next.row_grid as Array<Record<string, unknown>>)] : []
    for (let r = 0; r < rowGrid.length; r++) {
      const row = { ...(rowGrid[r] ?? {}) }
      const cards = Array.isArray(row.card_team) ? [...(row.card_team as Array<Record<string, unknown>>)] : []
      let rowChanged = false
      for (let c = 0; c < cards.length; c++) {
        const cell = cards[c] ?? {}
        const factId = typeof cell._staff_fact_id === 'string' ? cell._staff_fact_id : ''
        const upd = factId ? byFactId.get(factId) : undefined
        if (!upd) continue
        const nextCell: Record<string, unknown> = { ...cell }
        let cellChanged = false
        if (upd.name && nextCell.team_name        !== upd.name) { nextCell.team_name        = upd.name; cellChanged = true }
        if (upd.role && nextCell.team_position    !== upd.role) { nextCell.team_position    = upd.role; cellChanged = true }
        if (upd.bio  && nextCell.team_description !== upd.bio)  { nextCell.team_description = upd.bio;  cellChanged = true }
        if (cellChanged) {
          cards[c] = nextCell
          rowChanged = true
        }
      }
      if (rowChanged) {
        row.card_team = cards
        rowGrid[r] = row
        changed = true
      }
    }
    if (!changed) return null
    next.row_grid = rowGrid
    return next
  }

  if (templateId === 'single-team-section-6') {
    const factId = typeof fieldValues._staff_fact_id === 'string' ? fieldValues._staff_fact_id : ''
    const upd = factId ? byFactId.get(factId) : undefined
    if (!upd) return null
    const next = { ...fieldValues }
    let changed = false
    if (upd.name && next.heading     !== upd.name) { next.heading     = upd.name; changed = true }
    if (upd.role && next.tagline     !== upd.role) { next.tagline     = upd.role; changed = true }
    if (upd.bio  && next.description !== upd.bio)  { next.description = upd.bio;  changed = true }
    return changed ? next : null
  }

  return null
}

/** Two-way sync entry point — call from the page editor's
 *  updateSection() RIGHT BEFORE persisting the local row. Steps:
 *    1. Extract StaffUpdates from the local section's new values.
 *    2. Write each one to church_facts.data via updateStaffFact.
 *    3. Find every OTHER section in the project linking those same
 *       fact_ids and propagate the new name/role/bio into their
 *       field_values (in the right schema shape per template).
 *  Returns nothing — failures are logged but never throw so the
 *  primary save path stays robust. */
export async function syncStaffLinkOnSave(
  sb:               SupabaseClient,
  projectId:        string,
  selfSectionId:    string,
  selfTemplateId:   string | null,
  selfFieldValues:  Record<string, unknown>,
): Promise<void> {
  try {
    const updates = extractStaffUpdates(selfTemplateId, selfFieldValues)
    if (updates.length === 0) return

    // 1. Write each update to church_facts.data
    await Promise.all(updates.map(u =>
      updateStaffFact(sb, u.factId, { name: u.name, role: u.role, bio: u.bio })
    ))

    // 2. Find every other section in the project — keep the query
    // simple, filter in JS rather than building a complex jsonb query.
    const { data: peerRows } = await sb
      .from('web_sections')
      .select('id, content_template_id, field_values, web_page_id, web_pages!inner(web_project_id)')
      .eq('web_pages.web_project_id', projectId)
      .neq('id', selfSectionId)
    const peers = (peerRows ?? []) as Array<{
      id: string
      content_template_id: string | null
      field_values: Record<string, unknown> | null
    }>

    // 3. Patch each peer that references any of our fact ids
    for (const peer of peers) {
      const peerValues = (peer.field_values ?? {}) as Record<string, unknown>
      const patched = applyStaffUpdatesToSection(peer.content_template_id, peerValues, updates)
      if (!patched) continue
      const { error } = await sb.from('web_sections').update({ field_values: patched }).eq('id', peer.id)
      if (error) console.error('[staff-link sync] peer update failed', peer.id, error)
    }
  } catch (e) {
    console.error('[staff-link sync] failed', e)
  }
}

/** Append a Single Team Section 6 to the given per-staff page, with
 *  the staff_fact_id embedded in field_values so the renderer + the
 *  edit panel know which church_facts row to mirror. Returns the new
 *  section's id so the caller can store it back on the Team 14 item. */
export async function appendSingleTeamSection(
  sb:           SupabaseClient,
  targetPageId: string,
  staffFactId:  string,
  seed:         { name: string; role?: string; bio?: string },
): Promise<string> {
  // Sort_order = max + 1 on the target page.
  const { data: tail } = await sb
    .from('web_sections')
    .select('sort_order')
    .eq('web_page_id', targetPageId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextSort = ((tail?.[0]?.sort_order ?? 0) as number) + 1

  const { data: inserted, error: insErr } = await sb
    .from('web_sections')
    .insert({
      web_page_id:         targetPageId,
      content_template_id: 'single-team-section-6',
      sort_order:          nextSort,
      field_values: {
        _staff_fact_id: staffFactId,
        // Seed the visible slots so the section renders something
        // meaningful before the strategist edits the per-staff page.
        // Two-way sync (Phase 3) keeps these in lockstep with the
        // church_facts row.
        heading:     seed.name,
        tagline:     seed.role ?? '',
        description: seed.bio  ?? '',
      } as Record<string, unknown>,
    })
    .select('id')
    .single()
  if (insErr || !inserted) throw insErr ?? new Error('failed to insert single-team-section-6')
  return (inserted as { id: string }).id
}
