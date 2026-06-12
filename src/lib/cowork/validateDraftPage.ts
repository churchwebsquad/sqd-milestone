/**
 * Deterministic validator for CoworkPageDraft (the artifact produced
 * by run-draft-page).
 *
 * Same shape as validateAllocationPlan + validatePageOutline — returns
 * {ok, failures, byCheck, summary} so the importer can return 422 with
 * a machine-readable failure list AND run-draft-page can run a ONE-shot
 * repair pass before giving up.
 *
 * Layers of correctness this enforces (the contract draft-page output
 * has to meet before it lands):
 *
 *   1. page_slug matches what the endpoint was called for.
 *   2. sections.length matches the outline (no silent dropping; deviations
 *      must be named in deviation_note).
 *   3. archetype on each section is a key in canonical_templates.
 *      (The outline already named the archetype; draft-page should not
 *      change it. If draft-page deviates, validator catches it; deviation
 *      must be explained via deviation_note.)
 *   4. copy keys are subset of archetype.cowork_writable_slots.
 *      (No invented slot names.)
 *   5. max_chars respected on every text-shaped slot value.
 *   6. atoms_used IDs exist in the project's active+draft content_atoms.
 *      (Hallucinated atom_ids in atoms_used = unknown_atom_ref.)
 *   7. Every verbatim atom that was assigned to this section in the
 *      outline appears as a substring of the section's drafted copy
 *      (somewhere — drafter picks the slot). Verbatim preservation
 *      is non-negotiable per the draft-page SKILL hard rules.
 *   8. dash_strip._meta integrity — if dash_strip.count > 0, samples[]
 *      MUST be populated (drafter wrote about stripping but didn't
 *      record what; can't verify the strip happened).
 *   9. atom_resolution_rate in _meta matches actual atoms_used vs
 *      atom_ids_requested.
 *  10. No em-dashes (`—` U+2014, `–` U+2013, `--`) in any text-shaped
 *      slot value. This is the floor of the "no AI tells" contract;
 *      critique-page does deeper voice-character work later, but this
 *      sanity-floor lives in the draft validator too.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CoworkPageDraft } from '../../types/coworkBundle.js'
import type {
  CanonicalTemplateManifest,
} from './validatePageOutline.js'

export interface DraftPageValidationManifest {
  /** active+draft atom_ids the project has. */
  atom_ids: string[]
  /** subset of atom_ids that are flagged verbatim=true; draft MUST
   *  preserve these exactly somewhere in the section that was outlined
   *  to receive them. */
  verbatim_atoms: Record<string, string>          // atom_id → body
  /** From outline-page output that draft-page is rendering. Used to
   *  cross-foot section count + verify draft didn't silently drop. */
  outline_section_count: number
  /** Per-section: archetype the outline picked + atom_ids the outline
   *  assigned. validator uses these to (a) confirm draft kept the
   *  archetype, (b) verify verbatim atoms landed in the section that
   *  was outlined to receive them. */
  outline_sections: Array<{
    section_index: number
    archetype:     string
    atom_ids:      string[]   // all atom_ids the outline assigned to this section
  }>
  canonical_templates: CanonicalTemplateManifest
  expected_page_slug:  string
}

export interface DraftPageValidationFailure {
  check:  string
  detail: string
}

export interface DraftPageValidationResult {
  ok:        boolean
  failures:  DraftPageValidationFailure[]
  byCheck:   Record<string, string[]>
  summary:   string
}

// ─── Em-dash + mechanical-floor patterns ──────────────────────────────────
// Critique-page does the deep voice check. Draft's validator just
// catches the floor: any em-dash anywhere in a drafted value is an
// instant fail. (em-dash = U+2014, en-dash = U+2013, double-hyphen
// surrogate.)
const EM_DASH_PATTERN = /[—–]|--/g

function walkCopyForStrings(copy: unknown, prefix: string, out: Array<{ path: string; value: string }>): void {
  if (copy == null) return
  if (typeof copy === 'string') {
    out.push({ path: prefix, value: copy })
    return
  }
  if (Array.isArray(copy)) {
    for (const [i, v] of copy.entries()) walkCopyForStrings(v, `${prefix}[${i}]`, out)
    return
  }
  if (typeof copy === 'object') {
    for (const [k, v] of Object.entries(copy as Record<string, unknown>)) {
      walkCopyForStrings(v, prefix ? `${prefix}.${k}` : k, out)
    }
  }
}

export function validateDraftPage(
  draft: CoworkPageDraft,
  mf:    DraftPageValidationManifest,
): DraftPageValidationResult {
  const failures: DraftPageValidationFailure[] = []
  const fail = (check: string, detail: string): void => {
    failures.push({ check, detail })
  }

  const atomSet = new Set(mf.atom_ids)
  const archetypes = mf.canonical_templates?.page_section_templates ?? {}

  // — Top-level —
  if (draft.page_slug !== mf.expected_page_slug) {
    fail('wrong_page_slug',
      `draft emits page_slug='${draft.page_slug}' but endpoint was called for '${mf.expected_page_slug}'`)
  }

  const sections = Array.isArray(draft.sections) ? draft.sections : []
  if (sections.length === 0) {
    fail('no_sections', `draft has zero sections`)
  }

  // — Section count vs outline (with explicit deviation_note as escape) —
  if (sections.length !== mf.outline_section_count) {
    const deviation = String(draft.deviation_note ?? '').trim()
    if (!deviation) {
      fail('section_count_mismatch',
        `draft has ${sections.length} sections, outline had ${mf.outline_section_count} — and no deviation_note explains the difference`)
    }
    // If deviation_note IS present, deviation is allowed — strategist
    // reviews it. We surface a soft signal via section_count_mismatch
    // only when unexplained.
  }

  // — Per-section checks —
  const allDraftedAtomIds = new Set<string>()
  for (const [ix, s] of sections.entries()) {
    const label = `${draft.page_slug}[${ix}]`

    // archetype existence
    const archetypeDef = archetypes[s.archetype]
    if (!archetypeDef) {
      fail('unknown_archetype',
        `${label} uses archetype '${s.archetype}' not in canonical_templates.page_section_templates`)
      continue   // can't check slots without archetype
    }
    const slotDefs = archetypeDef.cowork_writable_slots ?? {}

    // archetype agreement with outline (if outline declared one for
    // this section_index)
    const outlineSection = mf.outline_sections.find(os => os.section_index === ix)
    if (outlineSection && outlineSection.archetype !== s.archetype) {
      const deviation = String(draft.deviation_note ?? '').trim()
      if (!deviation) {
        fail('archetype_deviation',
          `${label} draft archetype '${s.archetype}' differs from outline archetype '${outlineSection.archetype}' — and no deviation_note explains why`)
      }
    }

    // copy keys are subset of archetype slots
    if (s.copy && typeof s.copy === 'object' && !Array.isArray(s.copy)) {
      for (const slotKey of Object.keys(s.copy as Record<string, unknown>)) {
        if (!(slotKey in slotDefs)) {
          fail('unknown_slot_in_copy',
            `${label} copy.${slotKey}: slot '${slotKey}' not declared on archetype '${s.archetype}'`)
        }
      }
    } else if (s.copy != null) {
      fail('bad_copy_shape', `${label} copy must be an object map (slot_name → value); got ${typeof s.copy}`)
    }

    // max_chars per text-shaped slot value
    const strings: Array<{ path: string; value: string }> = []
    walkCopyForStrings(s.copy, '', strings)
    for (const { path, value } of strings) {
      const topSlot = path.replace(/\[\d+\]\..*$/, '').split('.')[0]
      const slotDef = slotDefs[topSlot]
      if (!slotDef) continue   // already failed via unknown_slot_in_copy if unknown
      // For array slots with item_subfields, the per-subfield max_chars
      // lives in item_subfields[sub].max_chars. Resolve.
      let maxChars: number | undefined = slotDef.max_chars
      const subMatch = path.match(/\[\d+\]\.([\w-]+)$/)
      if (subMatch && slotDef.item_subfields) {
        const sub = slotDef.item_subfields[subMatch[1]]
        if (sub && typeof sub.max_chars === 'number') maxChars = sub.max_chars
      }
      if (typeof maxChars === 'number' && value.length > maxChars) {
        fail('max_chars_violation',
          `${label} copy.${path}: ${value.length} chars > slot's max_chars ${maxChars} (preview: ${value.slice(0, 80)}…)`)
      }
    }

    // em-dash floor + filler-intensifier floor (light: just em-dashes
    // here; full mechanical scan lives in critique-page)
    for (const { path, value } of strings) {
      const hits = [...value.matchAll(EM_DASH_PATTERN)]
      if (hits.length > 0) {
        fail('em_dash_present',
          `${label} copy.${path}: em-dash/en-dash present (${hits.length} hit${hits.length > 1 ? 's' : ''}) — should be stripped before draft lands`)
      }
    }

    // atoms_used UUID existence
    const atomsUsed = Array.isArray(s.atoms_used) ? s.atoms_used : []
    for (const aid of atomsUsed) {
      if (!atomSet.has(aid)) {
        fail('unknown_atom_ref',
          `${label} atoms_used references atom_id='${aid}' not present in project's content_atoms`)
      }
      allDraftedAtomIds.add(aid)
    }

    // voice_notes presence (≥10 chars, drafter MUST name the imitation
    // anchor or the section's voice is untraceable)
    const vn = String(s.voice_notes ?? '').trim()
    if (vn.length < 10) {
      fail('missing_voice_notes',
        `${label} voice_notes is missing or trivially short (${vn.length} chars) — every section must name which exemplar it imitates`)
    }
  }

  // — Verbatim preservation —
  // For every verbatim atom that the OUTLINE assigned to a section,
  // the atom's body MUST appear as a substring somewhere in that
  // section's copy. (Drafter chooses which slot; validator just checks
  // it landed somewhere in the same section.)
  for (const os of mf.outline_sections) {
    const draftSection = sections[os.section_index]
    if (!draftSection) continue   // already caught via section_count_mismatch
    const sectionStringsArr: Array<{ path: string; value: string }> = []
    walkCopyForStrings(draftSection.copy, '', sectionStringsArr)
    const concat = sectionStringsArr.map(s => s.value).join('\n')
    for (const aid of os.atom_ids) {
      const verbatimBody = mf.verbatim_atoms[aid]
      if (!verbatimBody) continue   // not a verbatim atom; non-verbatim atoms are free to be compressed
      if (!concat.includes(verbatimBody)) {
        fail('verbatim_atom_dropped',
          `draft[${os.section_index}]: verbatim atom ${aid} body not present in section copy — verbatim atoms MUST appear exactly (no compression, no rewording)`)
      }
    }
  }

  // — _meta cross-foot —
  const meta = draft._meta ?? {} as any
  if (typeof meta.drafted_sections === 'number' && meta.drafted_sections !== sections.length) {
    fail('drafted_sections_mismatch',
      `_meta.drafted_sections=${meta.drafted_sections} but sections.length=${sections.length}`)
  }
  if (typeof meta.atom_ids_resolved === 'number' && meta.atom_ids_resolved !== allDraftedAtomIds.size) {
    fail('atom_resolution_mismatch',
      `_meta.atom_ids_resolved=${meta.atom_ids_resolved} but unique atoms_used across sections=${allDraftedAtomIds.size}`)
  }
  // dash_strip integrity
  if (meta.dash_strip && typeof meta.dash_strip === 'object') {
    const cnt = (meta.dash_strip as any).count
    const samples = (meta.dash_strip as any).samples
    if (typeof cnt === 'number' && cnt > 0 && (!Array.isArray(samples) || samples.length === 0)) {
      fail('dash_strip_no_samples',
        `_meta.dash_strip.count=${cnt} but samples[] is empty — drafter claims to have stripped dashes without recording what`)
    }
  }

  // — validation block integrity —
  if (!draft.validation || typeof draft.validation !== 'object') {
    fail('missing_validation_block',
      `_meta-adjacent validation block missing — drafter MUST report flags[] + unused_atoms[]`)
  } else {
    if (!Array.isArray(draft.validation.flags)) {
      fail('bad_validation_flags', `validation.flags must be an array`)
    }
    if (!Array.isArray(draft.validation.unused_atoms)) {
      fail('bad_validation_unused', `validation.unused_atoms must be an array`)
    }
  }

  // Group failures + format summary
  const byCheck: Record<string, string[]> = {}
  for (const f of failures) (byCheck[f.check] ??= []).push(f.detail)
  const summaryLines: string[] = []
  for (const check of Object.keys(byCheck).sort()) {
    const details = byCheck[check]
    summaryLines.push(`FAIL ${check} (${details.length})`)
    for (const d of details.slice(0, 8)) summaryLines.push(`   - ${d}`)
    if (details.length > 8) summaryLines.push(`   … +${details.length - 8} more`)
  }
  summaryLines.push(failures.length === 0 ? 'ALL CHECKS PASS' : `${failures.length} FAILURES`)

  return {
    ok:      failures.length === 0,
    failures,
    byCheck,
    summary: summaryLines.join('\n'),
  }
}
