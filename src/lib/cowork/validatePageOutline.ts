/**
 * Deterministic validator for CoworkPageOutline output (the artifact
 * produced by the outline-page skill).
 *
 * Same shape as validateAllocationPlan: returns ok|failures so the
 * importer can return 422 + machine-readable failure list on bad
 * input, AND the endpoint can run a ONE-SHOT repair pass before
 * giving up.
 *
 * Three things this validates (the user's call-out on what "real
 * validator, not pass-through" means):
 *
 *   1. atom_assignments[].atom_id ∈ project's active+draft content_atoms.
 *      Hallucinated UUIDs are the #1 way outline-page can produce a
 *      plausible-looking outline that bricks at draft time.
 *
 *   2. Every section's `archetype` is a key in canonical-templates.json.
 *      No raw Brixies slugs, no invented archetype names.
 *
 *   3. Every required slot in the archetype's slot map is covered by
 *      at least one atom_assignment whose slot_hint points at it.
 *      Required slots empty at outline time = the empty-slot prevention
 *      doctrine from canonical-templates.json fails at this layer.
 *
 * Additional structural checks: section_ix monotonicity, atom_count_used
 * cross-foot, no two assignments to the same required slot (would
 * conflict at draft time), unresolved_inputs has paired what+where.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FLOW_ROLES, type CoworkPageOutline } from '../../types/coworkBundle.js'

export interface PageOutlineValidationManifest {
  /** active+draft atom_ids the project has. */
  atom_ids: string[]
  /** atom_id → topic mapping for active+draft atoms. Used to detect
   *  voice-topic atoms (voice_rule / voice_sample / tone_descriptor)
   *  appearing in atom_assignments — those belong on
   *  section.voice_anchor (the imitation pointer), not in
   *  atom_assignments (which drives literal slot binding via the
   *  draft). Surfaced 2026-06-12 during the paratots draft fire: the
   *  outline assigned voice_rule + voice_sample atoms to ~12 slots
   *  × 4 sections, causing Fable 5 to (correctly) imitate instead
   *  of paste, which the verbatim validator (also correctly)
   *  flagged. Topic-aware skip in the draft validator is the permissive
   *  fix; this check is the architectural fix. */
  atom_topics: Record<string, string>
  /** canonical-templates.json under the project's manifest version.
   *  The keys of `page_section_templates` are the valid archetype
   *  names. */
  canonical_templates: CanonicalTemplateManifest
  /** The page_slug this outline is FOR — used to confirm the outline
   *  emits the right slug. */
  expected_page_slug: string
}

/** Topics whose atoms are stylistic guidance for the drafter to
 *  imitate, never literal slot content. Mirrors the same set used by
 *  validateDraftPage's verbatim-skip rule (single source for the
 *  semantic). */
export const VOICE_TOPICS_NOT_FOR_ASSIGNMENTS = new Set([
  'voice_rule',
  'voice_sample',
  'tone_descriptor',
])
// NOTE: fact_ids removed. CoworkPageOutline.sections[].atom_assignments
// is the only binding shape today — facts arrive on the page via the
// allocation slice but are referenced at draft time by id-lookup, not
// from outline output. Re-add when outline-page output grows fact bindings.

export interface CanonicalTemplateManifest {
  version: string
  /** Keyed by archetype name (e.g. 'hero_inner', 'cards_split'). */
  page_section_templates: Record<string, {
    template_id: string
    concept:     string
    family:      string
    variant:     string
    /** uniform slot vocabulary key → constraints */
    cowork_writable_slots: Record<string, {
      required?:  boolean
      max_chars?: number
      max_items?: number
      type?:      string
      /** Only present for array slots like `buttons` / `items` — describes
       *  the inner shape (e.g. {label, url}). */
      item_subfields?: Record<string, {
        max_chars?: number
        type?:      string
        required?:  boolean
      }>
    }>
    design_handoff_image_count?: number
  }>
}

export interface PageOutlineValidationFailure {
  check:  string
  detail: string
}

export interface PageOutlineValidationResult {
  ok:        boolean
  failures:  PageOutlineValidationFailure[]
  byCheck:   Record<string, string[]>
  summary:   string
}

export function validatePageOutline(
  outline: CoworkPageOutline,
  mf:      PageOutlineValidationManifest,
): PageOutlineValidationResult {
  const failures: PageOutlineValidationFailure[] = []
  const fail = (check: string, detail: string): void => {
    failures.push({ check, detail })
  }

  const atomSet  = new Set(mf.atom_ids)
  const archetypes = mf.canonical_templates?.page_section_templates ?? {}

  // — Top-level shape —
  if (outline.page_slug !== mf.expected_page_slug) {
    fail('wrong_page_slug',
      `outline emits page_slug='${outline.page_slug}' but the endpoint was called for '${mf.expected_page_slug}'`)
  }

  const sections = Array.isArray(outline.sections) ? outline.sections : []
  if (sections.length === 0) {
    fail('no_sections', `outline has zero sections — at minimum a hero+CTA pair is expected per page`)
  }

  // — Per-section checks —
  for (const [ix, s] of sections.entries()) {
    const sectionLabel = `${outline.page_slug}[${ix}]`

    // section_ix monotonicity — strict 0..N-1, no gaps, no duplicates
    if (s.section_ix !== ix) {
      fail('section_ix_misaligned',
        `${sectionLabel} declares section_ix=${s.section_ix} but its position is ${ix}`)
    }

    // archetype existence in canonical-templates
    const archetypeDef = archetypes[s.archetype]
    if (!archetypeDef) {
      fail('unknown_archetype',
        `${sectionLabel} uses archetype '${s.archetype}' not present in canonical_templates.page_section_templates`)
      continue   // can't check slots without an archetype
    }

    const slotDefs = archetypeDef.cowork_writable_slots ?? {}
    const requiredSlotKeys = Object.keys(slotDefs).filter(k => slotDefs[k]?.required === true)
    const slotsCoveredByAtoms = new Set<string>()

    // atom_assignments — every atom_id MUST resolve; slot_hint MUST map to a real slot
    const assignments = Array.isArray(s.atom_assignments) ? s.atom_assignments : []
    for (const [aix, a] of assignments.entries()) {
      const assignLabel = `${sectionLabel}.atom_assignments[${aix}]`

      // atom_id existence
      if (!a.atom_id || !atomSet.has(a.atom_id)) {
        fail('unknown_atom_ref',
          `${assignLabel} references atom_id='${a.atom_id ?? '(missing)'}' not present in project's content_atoms (hallucinated UUID?)`)
      } else {
        // Voice atoms must NOT appear in atom_assignments. They're
        // stylistic guidance the drafter imitates via the section's
        // voice_anchor field. Putting them in atom_assignments drives
        // them into the draft's atoms_used + the verbatim check,
        // which then trips on every section that "should" carry them
        // (paratots fire showed 12 trips × 4 sections). The
        // architectural fix.
        // Defensive: fixtures persisted before atom_topics existed
        // may not include the field. Older fixtures skip this check
        // (topic comes back undefined → no fail). The runtime
        // importer + endpoint builders populate it; only old test
        // fixtures lack it.
        const topic = mf.atom_topics?.[a.atom_id]
        if (topic && VOICE_TOPICS_NOT_FOR_ASSIGNMENTS.has(topic)) {
          fail('voice_atom_in_assignments',
            `${assignLabel} references atom_id='${a.atom_id}' with topic='${topic}'. Voice-topic atoms (voice_rule, voice_sample, tone_descriptor) are imitation material — route them to section.voice_anchor (the exemplar pointer), never atom_assignments.`)
        }
      }

      // slot_hint must point at a real slot OR a known group_dot pattern
      // (e.g. 'cards[0].body' means the cards group → first item's body).
      // For v1 we accept either a top-level slot match OR a 'group_name[N].slot' pattern
      // where group_name is a real top-level slot.
      const hint = String(a.slot_hint ?? '').trim()
      if (!hint) {
        fail('missing_slot_hint', `${assignLabel} has no slot_hint`)
        continue
      }

      const topLevelSlot = hint.replace(/\[\d+\]\..*$/, '')   // 'cards[0].body' → 'cards'
      if (!(topLevelSlot in slotDefs)) {
        fail('bad_slot_hint',
          `${assignLabel} slot_hint='${hint}' resolves to top-level slot '${topLevelSlot}' which is not declared on archetype '${s.archetype}'`)
        continue
      }

      slotsCoveredByAtoms.add(topLevelSlot)
    }

    // Required-slot coverage. cms_managed sections opt out (they read from
    // ACF at render time, not from copy).
    if (!s.cms_managed) {
      for (const req of requiredSlotKeys) {
        if (!slotsCoveredByAtoms.has(req)) {
          // Check unresolved_inputs as the escape hatch — outline is
          // allowed to surface 'I couldn't fill this; here's why' as
          // long as it's named.
          const surfaced = (outline.unresolved_inputs ?? []).some(u =>
            (u.what ?? '').toLowerCase().includes(req.toLowerCase()) ||
            (u.where ?? '').toLowerCase().includes(req.toLowerCase()))
          if (!surfaced) {
            fail('required_slot_uncovered',
              `${sectionLabel} archetype='${s.archetype}' has required slot '${req}' but no atom_assignment covers it (and not in unresolved_inputs)`)
          }
        }
      }
    }

    // section_job must be non-trivial (≥10 chars)
    const job = String(s.section_job ?? '').trim()
    if (job.length < 10) {
      fail('weak_section_job',
        `${sectionLabel} section_job='${job}' is missing or trivially short — every section must declare its job`)
    }

    // flow_role must be one of FLOW_ROLES (sourced from coworkBundle.ts;
    // any drift trips check:skill-prompts before this code ever runs).
    if (!(FLOW_ROLES as readonly string[]).includes(s.flow_role)) {
      fail('bad_flow_role',
        `${sectionLabel} flow_role='${s.flow_role}' not in valid set ${FLOW_ROLES.join('|')}`)
    }

    // voice_anchor + anti_pattern_to_avoid must be non-empty (they feed
    // draft-page directly — empty here means drafter has nothing to imitate)
    if (!String(s.voice_anchor ?? '').trim()) {
      fail('missing_voice_anchor', `${sectionLabel} has empty voice_anchor`)
    }
    if (!String(s.anti_pattern_to_avoid ?? '').trim()) {
      fail('missing_anti_pattern', `${sectionLabel} has empty anti_pattern_to_avoid`)
    }
  }

  // — Cross-section invariants —

  // atom_count_used in _meta must match unique atom_ids across sections
  const allAtomIds = new Set<string>()
  for (const s of sections) {
    for (const a of (s.atom_assignments ?? [])) {
      if (a.atom_id) allAtomIds.add(a.atom_id)
    }
  }
  const claimedAtomCount = outline._meta?.atom_count_used
  if (typeof claimedAtomCount === 'number' && claimedAtomCount !== allAtomIds.size) {
    fail('atom_count_mismatch',
      `_meta.atom_count_used=${claimedAtomCount} but actual unique atom_ids across sections=${allAtomIds.size}`)
  }

  // sections_count cross-foot
  const claimedSectionCount = outline._meta?.sections_count
  if (typeof claimedSectionCount === 'number' && claimedSectionCount !== sections.length) {
    fail('sections_count_mismatch',
      `_meta.sections_count=${claimedSectionCount} but sections.length=${sections.length}`)
  }

  // unresolved_inputs structural check
  for (const [uix, u] of (outline.unresolved_inputs ?? []).entries()) {
    if (!u.what?.trim() || !u.where?.trim()) {
      fail('unresolved_input_incomplete',
        `unresolved_inputs[${uix}] missing what or where field`)
    }
  }

  // Group failures by check + format summary
  const byCheck: Record<string, string[]> = {}
  for (const f of failures) {
    (byCheck[f.check] ??= []).push(f.detail)
  }
  const summaryLines: string[] = []
  for (const check of Object.keys(byCheck).sort()) {
    const details = byCheck[check]
    summaryLines.push(`FAIL ${check} (${details.length})`)
    for (const d of details.slice(0, 8)) summaryLines.push(`   - ${d}`)
    if (details.length > 8) summaryLines.push(`   … +${details.length - 8} more`)
  }
  summaryLines.push(failures.length === 0 ? 'ALL CHECKS PASS' : `${failures.length} FAILURES`)

  return {
    ok:       failures.length === 0,
    failures,
    byCheck,
    summary:  summaryLines.join('\n'),
  }
}
