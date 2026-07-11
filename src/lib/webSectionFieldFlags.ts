/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Section-field flag helpers.
 *
 * A "flag" is Squad saying "we need the partner to give us the value
 * for THIS specific field" (Summit registration URL, Facebook link,
 * campus phone number, etc.). Flags are section-scoped and persist
 * across review rounds — an open flag stays open until the partner
 * supplies a value or staff dismisses it.
 *
 * Table: web_section_field_flags (see v121 migration).
 * Partner resolves via the token-gated RPC resolve_flag_by_partner_token.
 *
 * Design + rejected alternatives: /Users/.claude/plans/moonlit-leaping-summit.md.
 */

import { supabase } from './supabase'
import type { WebSectionFieldFlag } from '../types/database'
import { resolveStaffName } from './webReviews'

// ── Public helpers ──────────────────────────────────────────────────

/** Create (or refresh the prompt on) a flag for a specific field.
 *  Uses the partial-unique index (section_id, field_key) WHERE
 *  status='open' — if a flag is already open on this field, we UPDATE
 *  the prompt instead of inserting a duplicate row (which would
 *  violate the constraint). Applied/dismissed history rows for the
 *  same field are left untouched. */
export async function flagField(opts: {
  webProjectId:  string
  webPageId:     string
  webSectionId:  string
  fieldKey:      string
  prompt:        string
}): Promise<{ ok: true; flag: WebSectionFieldFlag } | { ok: false; error: string }> {
  const trimmedPrompt = opts.prompt.trim()
  if (!trimmedPrompt) return { ok: false, error: 'Prompt is required.' }

  const { data: user } = await supabase.auth.getUser()
  const creatorName = await resolveStaffName(user?.user?.email ?? null)

  // First check for an existing open flag on this field.
  const { data: existing, error: readErr } = await supabase
    .from('web_section_field_flags')
    .select('*')
    .eq('web_section_id', opts.webSectionId)
    .eq('field_key', opts.fieldKey)
    .eq('status', 'open')
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }

  if (existing) {
    // Update the prompt in place.
    const { data: updated, error: updErr } = await supabase
      .from('web_section_field_flags')
      .update({ prompt: trimmedPrompt } as never)
      .eq('id', (existing as WebSectionFieldFlag).id)
      .select('*')
      .single()
    if (updErr) return { ok: false, error: updErr.message }
    return { ok: true, flag: updated as WebSectionFieldFlag }
  }

  // Insert a fresh flag.
  const { data: inserted, error: insErr } = await supabase
    .from('web_section_field_flags')
    .insert({
      web_project_id:     opts.webProjectId,
      web_page_id:        opts.webPageId,
      web_section_id:     opts.webSectionId,
      field_key:          opts.fieldKey,
      prompt:             trimmedPrompt,
      status:             'open',
      created_by_user_id: user?.user?.id ?? null,
      created_by_name:    creatorName,
    } as never)
    .select('*')
    .single()
  if (insErr) return { ok: false, error: insErr.message }
  return { ok: true, flag: inserted as WebSectionFieldFlag }
}

/** Dismiss (staff cancels the flag — never mind, don't need this from
 *  the partner anymore). Preserves the row for audit. */
export async function dismissFlag(flagId: string): Promise<boolean> {
  const { data: user } = await supabase.auth.getUser()
  const staffName = await resolveStaffName(user?.user?.email ?? null)
  const { error } = await supabase
    .from('web_section_field_flags')
    .update({
      status:              'dismissed',
      resolved_by_user_id: user?.user?.id ?? null,
      resolved_by_name:    staffName,
      resolved_at:         new Date().toISOString(),
    } as never)
    .eq('id', flagId)
  if (error) {
    console.error('[flags] dismissFlag failed:', error.message)
    return false
  }
  return true
}

/** Load every flag (any status) for a section. Section editors call
 *  this alongside comments to render inline flag state per field. */
export async function loadFlagsForSection(webSectionId: string): Promise<WebSectionFieldFlag[]> {
  const { data, error } = await supabase
    .from('web_section_field_flags')
    .select('*')
    .eq('web_section_id', webSectionId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[flags] loadFlagsForSection failed:', error.message)
    return []
  }
  return (data as WebSectionFieldFlag[] | null) ?? []
}

/** Load every flag for a project. `status` filter defaults to 'open'
 *  because that's what the partner portal + staff dashboard rollup
 *  need — pass null explicitly to get every status. */
export async function loadFlagsForProject(
  webProjectId: string,
  opts: { status?: 'open' | 'applied' | 'dismissed' | null } = {},
): Promise<WebSectionFieldFlag[]> {
  let q = supabase
    .from('web_section_field_flags')
    .select('*')
    .eq('web_project_id', webProjectId)
    .order('created_at', { ascending: false })
  const statusFilter = opts.status === undefined ? 'open' : opts.status
  if (statusFilter !== null) q = q.eq('status', statusFilter)
  const { data, error } = await q
  if (error) {
    console.error('[flags] loadFlagsForProject failed:', error.message)
    return []
  }
  return (data as WebSectionFieldFlag[] | null) ?? []
}

/** Partner-side: submit the value the partner typed in for a flag.
 *  Hits the token-gated RPC which verifies the token → open partner
 *  review linkage, patches web_sections.field_values at the flag's
 *  dotted field_key, and closes the flag as applied. */
export async function resolveFlagByPartnerToken(opts: {
  partnerToken:  string
  flagId:        string
  value:         unknown
  partnerName:   string | null
}): Promise<{ ok: true; sectionId: string; fieldKey: string } | { ok: false; error: string }> {
  const { data, error } = await (supabase as any).rpc('resolve_flag_by_partner_token', {
    p_token:        opts.partnerToken,
    p_flag_id:      opts.flagId,
    p_value:        opts.value,
    p_partner_name: opts.partnerName ?? null,
  })
  if (error) return { ok: false, error: error.message }
  const row = data as { ok?: boolean; section_id?: string; field_key?: string } | null
  if (!row?.ok) return { ok: false, error: 'RPC returned an unexpected shape' }
  return {
    ok:        true,
    sectionId: row.section_id ?? '',
    fieldKey:  row.field_key ?? '',
  }
}

/** Quick lookup: is this specific field flagged open? Used by
 *  SlotEditor/GroupEditor to render the correct button state. */
export function findOpenFlag(
  flags: WebSectionFieldFlag[],
  fieldKey: string,
): WebSectionFieldFlag | null {
  return flags.find(f => f.status === 'open' && f.field_key === fieldKey) ?? null
}

/** Group flags by section_id for the partner-portal top-of-page
 *  rollup. Preserves per-section insertion order. */
export function groupFlagsBySection(
  flags: WebSectionFieldFlag[],
): Map<string, WebSectionFieldFlag[]> {
  const m = new Map<string, WebSectionFieldFlag[]>()
  for (const f of flags) {
    const list = m.get(f.web_section_id) ?? []
    list.push(f)
    m.set(f.web_section_id, list)
  }
  return m
}
