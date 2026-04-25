/**
 * Library — Supabase-side data layer.
 *
 * Doc-hub *content* is read/written via the strategy-notion edge function
 * (see `strategyNotion.ts`). This module owns the operational layer that
 * sits on top of Notion: per-user read receipts (`strategy_wiki_reads`)
 * and per-department verifier routing (`strategy_wiki_verifier_defaults`).
 */

import { supabase } from './supabase'
import type {
  Department, EmployeeRef, VerifierActive, VerifierDefault,
} from '../types/strategy'

// ── Mark Read (2b) ────────────────────────────────────────────────────────

/** Insert a "read" row for the current user. Idempotent — a re-mark is a
 *  no-op (unique constraint catches it). Returns the resolved
 *  `marked_read_at` timestamp on success. */
export async function markDocAsRead(employeeId: string, docNotionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('strategy_wiki_reads')
    .upsert(
      { user_id: employeeId, doc_notion_id: docNotionId },
      { onConflict: 'user_id,doc_notion_id', ignoreDuplicates: true },
    )
    .select('marked_read_at')
    .maybeSingle()
  if (error) throw error
  return data?.marked_read_at ?? new Date().toISOString()
}

/** Read receipts for one user — returned as a Set for O(1) "is doc X read?"
 *  checks. */
export async function listMyReads(employeeId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('strategy_wiki_reads')
    .select('doc_notion_id')
    .eq('user_id', employeeId)
  if (error) throw error
  return new Set((data ?? []).map(r => r.doc_notion_id as string))
}

/** All read receipts across the team. Used by the team-progress widget on
 *  the Library home (directors/VP) to show who's behind on reading. */
export async function listAllReads(): Promise<Array<{ user_id: string; doc_notion_id: string }>> {
  const { data, error } = await supabase
    .from('strategy_wiki_reads')
    .select('user_id, doc_notion_id')
  if (error) throw error
  return data ?? []
}

// ── Verifier defaults (2a, 2f, 2g) ────────────────────────────────────────

interface VerifierDefaultRow {
  dept: string
  director_employee_id: string
  delegate_employee_id: string | null
  delegation_until: string | null
  notes: string | null
  updated_at: string
  updated_by: string
}

function rowToDefault(r: VerifierDefaultRow): VerifierDefault {
  return {
    dept:                 r.dept as Department,
    directorEmployeeId:   r.director_employee_id,
    delegateEmployeeId:   r.delegate_employee_id,
    delegationUntil:      r.delegation_until,
    notes:                r.notes,
    updatedAt:            r.updated_at,
    updatedBy:            r.updated_by,
  }
}

export async function listVerifierDefaults(): Promise<VerifierDefault[]> {
  const { data, error } = await supabase
    .from('strategy_wiki_verifier_defaults')
    .select('*')
    .order('dept')
  if (error) throw error
  return (data ?? []).map(rowToDefault as (r: VerifierDefaultRow) => VerifierDefault)
}

/** Resolve the active verifier for a department, given the loaded
 *  defaults. Pure JS — the routing rule is the single point of truth that
 *  every UI surface (Add Doc routing banner, Review Queue grouping, doc
 *  detail "routed to" indicator) reads from. */
export function getActiveVerifier(
  defaults: VerifierDefault[],
  dept: Department,
): VerifierActive | null {
  const row = defaults.find(d => d.dept === dept)
  if (!row) return null
  const now = Date.now()
  const delegationActive =
    !!row.delegateEmployeeId &&
    (!row.delegationUntil || new Date(row.delegationUntil).getTime() > now)
  return delegationActive
    ? { employeeId: row.delegateEmployeeId!, isDelegate: true }
    : { employeeId: row.directorEmployeeId, isDelegate: false }
}

export async function setDirector(
  dept: Department,
  newDirectorEmployeeId: string,
  callerEmployeeId: string,
): Promise<VerifierDefault> {
  const { data, error } = await supabase
    .from('strategy_wiki_verifier_defaults')
    .update({
      director_employee_id: newDirectorEmployeeId,
      updated_at: new Date().toISOString(),
      updated_by: callerEmployeeId,
    })
    .eq('dept', dept)
    .select('*')
    .single()
  if (error) throw error
  return rowToDefault(data as VerifierDefaultRow)
}

export async function setDelegate(
  dept: Department,
  delegateEmployeeId: string,
  delegationUntil: string | null,
  callerEmployeeId: string,
): Promise<VerifierDefault> {
  const { data, error } = await supabase
    .from('strategy_wiki_verifier_defaults')
    .update({
      delegate_employee_id: delegateEmployeeId,
      delegation_until: delegationUntil,
      updated_at: new Date().toISOString(),
      updated_by: callerEmployeeId,
    })
    .eq('dept', dept)
    .select('*')
    .single()
  if (error) throw error
  return rowToDefault(data as VerifierDefaultRow)
}

export async function endDelegation(
  dept: Department,
  callerEmployeeId: string,
): Promise<VerifierDefault> {
  const { data, error } = await supabase
    .from('strategy_wiki_verifier_defaults')
    .update({
      delegate_employee_id: null,
      delegation_until: null,
      updated_at: new Date().toISOString(),
      updated_by: callerEmployeeId,
    })
    .eq('dept', dept)
    .select('*')
    .single()
  if (error) throw error
  return rowToDefault(data as VerifierDefaultRow)
}

// ── Employees (used by Verification Settings + verifier display) ──────────

interface EmployeeRow {
  id: string
  full_name: string | null
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  email: string | null
  department: string | null
  role: string | null
  avatar_url: string | null
}

/** Resolve a display name from any of the name columns. The HR table is
 *  inconsistent — some employees only have `full_name`, others only `name`,
 *  others first/last separately. Anyone with no name at all falls back to
 *  the bit before "@" in their email so they still render. */
function displayName(row: EmployeeRow): string | null {
  if (row.full_name?.trim()) return row.full_name.trim()
  if (row.name?.trim()) return row.name.trim()
  const composed = [row.first_name?.trim(), row.last_name?.trim()].filter(Boolean).join(' ')
  if (composed) return composed
  if (row.email) return row.email.split('@')[0]
  return null
}

export async function listStaffEmployees(): Promise<EmployeeRef[]> {
  // Pulls currently-employed staff. The `employees.status` field has free-
  // text values; we exclude the two that mean "not currently here". Open
  // positions and ex-employees both shouldn't appear in verifier pickers.
  // We don't filter by null full_name — some rows only carry `name` or
  // first/last, and `displayName()` resolves whichever is populated.
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, name, first_name, last_name, email, department, role, avatar_url, status')
    .not('status', 'in', '("No Longer Employed","OPEN Position")')
    .order('email')
  if (error) throw error
  return (data ?? [])
    .map<EmployeeRef | null>(e => {
      const row = e as EmployeeRow & { status?: string }
      const name = displayName(row)
      if (!name) return null
      return {
        id: row.id,
        fullName: name,
        email: row.email,
        department: row.department,
        role: row.role,
        avatarUrl: row.avatar_url,
      }
    })
    .filter((x): x is EmployeeRef => x !== null)
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))
}

/** Lookup an employee by their lowercased email. Used to resolve the
 *  signed-in user → employees(id) for read-receipt writes. */
export async function lookupEmployeeByEmail(email: string): Promise<EmployeeRef | null> {
  const lc = email.toLowerCase().trim()
  if (!lc) return null
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, email, department, role, avatar_url')
    .ilike('email', lc)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as EmployeeRow
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    department: row.department,
    role: row.role,
    avatarUrl: row.avatar_url,
  }
}

/** Map free-text `employees.department` to the canonical Strategy
 *  `Department` enum. Only the four squad departments line up with
 *  Strategy departments (Brand Squad, Website Squad, Social Media Squad).
 *  Cross-functional groups (Exec, Customer Experience, Design Squad,
 *  Video Squad, etc.) return null — they're not part of the Strategy
 *  team-progress widgets, even though some of their members may be VP
 *  or directors of a Strategy department. */
export function employeeDepartmentToStrategy(dept: string | null): Department | null {
  if (!dept) return null
  const trimmed = dept.trim().toLowerCase()
  if (trimmed === 'brand squad')         return 'branding'
  if (trimmed === 'website squad')       return 'web'
  if (trimmed === 'social media squad')  return 'social'
  return null
}

/** The reverse — Strategy `Department` → `employees.department` text used
 *  to query active staff for the Squad Progress widget. */
export function strategyDeptToEmployeeDepartment(d: Department): string | null {
  switch (d) {
    case 'branding': return 'Brand Squad'
    case 'web':      return 'Website Squad'
    case 'social':   return 'Social Media Squad'
    case 'all-in':   return null   // no squad equivalent
  }
}

/** Email that identifies the VP of Strategy. Hardcoded for v1 — moves to a
 *  per-org config when the app grows. The VP can manage verification
 *  routing for every Strategy department. */
export const VP_OF_STRATEGY_EMAIL = 'ashley@churchmediasquad.com'

export function isVPByEmail(email: string | null): boolean {
  if (!email) return false
  return email.toLowerCase().trim() === VP_OF_STRATEGY_EMAIL
}

/** True if the given employee id is the seated director (or active
 *  delegate) for any Strategy department. The verifier_defaults table is
 *  the source of truth for who counts as a "director" in the app. */
export function isDirectorByEmployeeId(
  employeeId: string | null,
  defaults: VerifierDefault[],
): boolean {
  if (!employeeId) return false
  const now = Date.now()
  return defaults.some(d => {
    if (d.directorEmployeeId === employeeId) return true
    if (
      d.delegateEmployeeId === employeeId &&
      (!d.delegationUntil || new Date(d.delegationUntil).getTime() > now)
    ) return true
    return false
  })
}

/** Strategy departments where the given employee is the active verifier
 *  (director or delegate). Drives the Manage Squad widget — a director
 *  who hops between roles sees roll-ups for every department they cover.
 *
 *  VP scope adds `all-in` as a separate section so the VP can manage
 *  org-wide onboarding + reading-list assignments alongside the per-
 *  squad cards. Directors don't get `all-in` as a managed section —
 *  they can't change global assignments, but they still see the effect
 *  of org-wide docs because dept onboarding cards include `all-in`-
 *  tagged docs. */
export function strategyDepartmentsLed(
  employeeId: string | null,
  defaults: VerifierDefault[],
  isVP: boolean,
): Department[] {
  if (isVP) {
    return ['web', 'branding', 'social', 'all-in']
  }
  if (!employeeId) return []
  const now = Date.now()
  const out: Department[] = []
  for (const d of defaults) {
    if (d.dept === 'all-in') continue   // all-in has no squad employees
    const delegationActive =
      !!d.delegateEmployeeId &&
      (!d.delegationUntil || new Date(d.delegationUntil).getTime() > now)
    const activeVerifier = delegationActive ? d.delegateEmployeeId : d.directorEmployeeId
    if (activeVerifier === employeeId) out.push(d.dept)
  }
  return out
}

// ── Milestone catalog CRUD (Doc Manager + Template Editor) ──────────────
//
// `strategy_milestone_definitions` is the single source of truth for the
// squad → pathway → step hierarchy that powers the Workflow Step picker
// in Doc Hub and the Template Editor's structure. The Doc Manager exposes
// add/update/reorder/delete so directors can keep the catalog in sync
// with how the squads actually work without leaving the app.

export interface MilestoneDefinitionRow {
  id: string
  squad: string
  pathway: string
  step_number: number
  step_name: string
  section_group: string | null
  is_partner_facing: boolean
  is_active: boolean
}

export interface MilestoneDefinitionInput {
  squad: string
  pathway: string
  step_number: number
  step_name: string
  section_group?: string | null
  is_partner_facing?: boolean
}

export async function listAllMilestoneDefinitions(): Promise<MilestoneDefinitionRow[]> {
  const { data, error } = await supabase
    .from('strategy_milestone_definitions')
    .select('id, squad, pathway, step_number, step_name, section_group, is_partner_facing, is_active')
    .order('squad')
    .order('pathway')
    .order('step_number')
  if (error) throw error
  return (data ?? []) as MilestoneDefinitionRow[]
}

export async function addMilestoneDefinition(input: MilestoneDefinitionInput): Promise<MilestoneDefinitionRow> {
  const { data, error } = await supabase
    .from('strategy_milestone_definitions')
    .insert({ ...input, is_active: true })
    .select('*')
    .single()
  if (error) throw error
  return data as MilestoneDefinitionRow
}

export async function updateMilestoneDefinition(
  id: string,
  patch: Partial<MilestoneDefinitionInput> & { is_active?: boolean },
): Promise<MilestoneDefinitionRow> {
  const { data, error } = await supabase
    .from('strategy_milestone_definitions')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as MilestoneDefinitionRow
}

/** Soft-delete (sets `is_active = false`). Existing docs tagged with the
 *  step keep their tag — it just stops appearing in the workflow. The catalog
 *  loader ignores inactive rows. */
export async function archiveMilestoneDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_milestone_definitions')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw error
}

/** Reorder by sending an array of `{ id, step_number }` pairs.
 *
 *  Implementation note: the table has a `UNIQUE (squad, pathway,
 *  step_number)` constraint, so writing the new positions in one pass
 *  trips the constraint mid-flight (two rows briefly share a number).
 *  Sidestep that with a two-pass approach:
 *    1. Bump every reordered row to a temp value far above any
 *       legitimate step_number (using +100000 makes a collision
 *       essentially impossible — pathways don't have 100k steps).
 *    2. Write the real target step_numbers.
 *  Both passes pre-stage unique values so the constraint never sees
 *  a conflict. */
export async function reorderMilestoneDefinitions(
  pairs: Array<{ id: string; step_number: number }>,
): Promise<void> {
  // Pass 1: park each row at a distinct out-of-band value.
  for (let i = 0; i < pairs.length; i++) {
    const tempStep = 100000 + i
    const { error } = await supabase
      .from('strategy_milestone_definitions')
      .update({ step_number: tempStep })
      .eq('id', pairs[i].id)
    if (error) throw error
  }
  // Pass 2: write the real target positions.
  for (const p of pairs) {
    const { error } = await supabase
      .from('strategy_milestone_definitions')
      .update({ step_number: p.step_number })
      .eq('id', p.id)
    if (error) throw error
  }
}

// ── Required reading (Recent Updates feed gating) ───────────────────────
//
// Directors + VP flag docs as "required reading". Required docs always
// appear on Recent Updates / division progress; non-required ones are
// quieter (filtered out unless the viewer asks for everything). A simple
// presence-based table — if a doc id is in the table, it's required.

export async function listRequiredReading(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('strategy_required_reading')
    .select('doc_notion_id')
  if (error) throw error
  return new Set((data ?? []).map(r => r.doc_notion_id as string))
}

export async function setDocRequired(docNotionId: string, callerEmployeeId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_required_reading')
    .upsert({ doc_notion_id: docNotionId, set_by: callerEmployeeId }, { onConflict: 'doc_notion_id' })
  if (error) throw error
}

export async function unsetDocRequired(docNotionId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_required_reading')
    .delete()
    .eq('doc_notion_id', docNotionId)
  if (error) throw error
}

// ── Onboarding assignments (Start Here Director Tools) ──────────────────

/** A row in `strategy_onboarding_assignments`. Three scopes:
 *   - 'global'      → required for every new hire (set by VP)
 *   - 'department'  → required for everyone in that dept (set by director)
 *   - 'user'        → required for one specific employee (set by director
 *                     or VP for fine-tuning, e.g. role-specific reading) */
/** Two distinct assignment kinds, both stored in the same table:
 *   - **onboarding**: Start Here flow (new-hire focus). Limited surface
 *     usually completed in the first weeks.
 *   - **reading-list**: Ongoing required reading. Stays on a staff
 *     member's plate beyond onboarding. */
export type AssignmentKind = 'onboarding' | 'reading-list'

export interface OnboardingAssignment {
  id: string
  docNotionId: string
  scope: 'global' | 'department' | 'user'
  kind: AssignmentKind
  department: Department | null
  employeeId: string | null
  isActive: boolean
  createdAt: string
  createdBy: string | null
  notes: string | null
}

interface AssignmentRow {
  id: string
  doc_notion_id: string
  scope: 'global' | 'department' | 'user'
  kind: AssignmentKind
  department: string | null
  employee_id: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
  notes: string | null
}

function rowToAssignment(r: AssignmentRow): OnboardingAssignment {
  return {
    id: r.id,
    docNotionId: r.doc_notion_id,
    scope: r.scope,
    kind: r.kind ?? 'onboarding',
    department: r.department as Department | null,
    employeeId: r.employee_id,
    isActive: r.is_active,
    createdAt: r.created_at,
    createdBy: r.created_by,
    notes: r.notes,
  }
}

/** Load every active onboarding assignment. Cheap query (a few hundred
 *  rows in the upper bound) — kept simple instead of paged. */
export async function listOnboardingAssignments(): Promise<OnboardingAssignment[]> {
  const { data, error } = await supabase
    .from('strategy_onboarding_assignments')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToAssignment as (r: AssignmentRow) => OnboardingAssignment)
}

export interface AddAssignmentInput {
  docNotionId: string
  scope: 'global' | 'department' | 'user'
  /** Defaults to 'onboarding' for backwards compatibility — older callers
   *  haven't been updated yet. New callers should pass 'reading-list' for
   *  ongoing required reading assignments. */
  kind?: AssignmentKind
  department?: Department | null
  employeeId?: string | null
  notes?: string | null
  callerEmployeeId: string
}

export async function addOnboardingAssignment(input: AddAssignmentInput): Promise<OnboardingAssignment> {
  const row: Partial<AssignmentRow> = {
    doc_notion_id: input.docNotionId,
    scope: input.scope,
    kind: input.kind ?? 'onboarding',
    department: input.scope === 'department' ? (input.department ?? null) : null,
    employee_id: input.scope === 'user' ? (input.employeeId ?? null) : null,
    notes: input.notes ?? null,
    created_by: input.callerEmployeeId,
    is_active: true,
  }
  const { data, error } = await supabase
    .from('strategy_onboarding_assignments')
    .insert(row as AssignmentRow)
    .select('*')
    .single()
  if (error) throw error
  return rowToAssignment(data as AssignmentRow)
}

/** Soft-delete (sets `is_active = false`) so we keep an audit trail of
 *  who added/removed which doc. The unique constraint allows a future
 *  re-add of the same scope+doc pair. */
export async function removeOnboardingAssignment(id: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_onboarding_assignments')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw error
}

// ── End onboarding assignments ────────────────────────────────────────────

/** Active staff in a single Strategy squad. Excludes "No Longer Employed"
 *  and "OPEN Position" — keeps Contractor + Onboarding + Full-time. Names
 *  resolve via `displayName()` so rows with only `name` or first/last
 *  populated (e.g. Andrew Finch, Delaney Bergner) still appear. */
export async function listSquadStaff(strategyDept: Department): Promise<EmployeeRef[]> {
  const empDept = strategyDeptToEmployeeDepartment(strategyDept)
  if (!empDept) return []
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, name, first_name, last_name, email, department, role, avatar_url, status')
    .eq('department', empDept)
    .not('status', 'in', '("No Longer Employed","OPEN Position")')
  if (error) throw error
  return (data ?? [])
    .map<EmployeeRef | null>(e => {
      const row = e as EmployeeRow & { status?: string }
      const name = displayName(row)
      if (!name) return null
      return {
        id: row.id,
        fullName: name,
        email: row.email,
        department: row.department,
        role: row.role,
        avatarUrl: row.avatar_url,
      }
    })
    .filter((x): x is EmployeeRef => x !== null)
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))
}
