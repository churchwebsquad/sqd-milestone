/**
 * Cowork artifact → markdown converters.
 *
 * Each Tier 1 artifact has a pure function that takes its raw JSON
 * (as stored in roadmap_state) and emits a strategist-readable
 * markdown string. The Cowork artifact drawer renders this with an
 * inline markdown renderer.
 *
 * Pure data → string. No React, no Supabase, no side effects.
 * Easy to test, easy to evolve when an artifact shape changes.
 *
 * Conventions used across all converters:
 *   - `#` for the artifact title, `##` for top-level sections,
 *     `###` for sub-items (e.g. each persona, each directive)
 *   - `>` blockquote for verbatim phrases (voice exemplars, problem
 *     lines, standout lines)
 *   - Bullet lists for collections of short items
 *   - Definition-style label/value via **bold**: "**Confidence**: 0.85"
 *   - Empty sections are skipped (don't render "Personas (none)" —
 *     skip the section header entirely)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { normalizeStage1ForCowork } from './normalizeStage1.js'

const NL  = '\n'
const NL2 = '\n\n'

/** Helper: emit a blockquote for a multi-line string. Each line gets
 *  `> ` prefix; preserves internal line breaks. */
function quote(text: string): string {
  if (!text) return ''
  return text.split('\n').map(line => `> ${line}`).join(NL)
}

/** Helper: drop empty/whitespace-only sections, join with double-newline. */
function joinSections(parts: Array<string | null | undefined>): string {
  return parts.filter(p => p && p.trim().length > 0).join(NL2)
}

// ───────────────────────────────────────────────────────────────────
//  stage_1 — synthesize-strategy output
// ───────────────────────────────────────────────────────────────────

export function stage1ToMarkdown(raw: unknown): string {
  const s = normalizeStage1ForCowork(raw)
  if (!s) return '_No strategic foundation yet._'

  const sections: Array<string | null> = ['# Strategic Foundation']

  // Project goals — carried from strategic_goals snapshot (post-Phase-2)
  const projectGoals: unknown = (s as any).project_goals
  if (Array.isArray(projectGoals) && projectGoals.length > 0) {
    const items = (projectGoals as unknown[])
      .filter((g): g is string => typeof g === 'string' && g.trim() !== '')
      .map(g => `- ${g}`)
    if (items.length) sections.push(`## Project goals${NL2}${items.join(NL)}`)
  }

  // Vision statement — from approved church_vision
  const vision: unknown = (s as any).vision_statement
  if (typeof vision === 'string' && vision.trim()) {
    sections.push(`## Vision statement${NL2}${quote(vision)}`)
  }

  // Key message — from approved one_key_message
  const keyMsg: unknown = (s as any).key_message
  if (typeof keyMsg === 'string' && keyMsg.trim()) {
    sections.push(`## Key message${NL2}${quote(keyMsg)}`)
  }

  // x_factor — string OR legacy object {top_attribute, messaging_focus}
  if (s.x_factor) {
    const xf: any = s.x_factor
    if (typeof xf === 'string') {
      sections.push(`## The x-factor${NL2}${xf}`)
    } else if (typeof xf === 'object') {
      const top  = xf.top_attribute ?? ''
      const msg  = xf.messaging_focus ?? ''
      sections.push(
        `## The x-factor${top ? NL2 + `> ${top}` : ''}${msg ? NL2 + msg : ''}`,
      )
    }
  }

  // ethos
  if (typeof s.ethos_summary === 'string' && s.ethos_summary.trim()) {
    sections.push(`## Ethos${NL2}${s.ethos_summary}`)
  }

  // personas
  if (Array.isArray(s.personas) && s.personas.length > 0) {
    const personaBlocks = s.personas.map((p: any) => {
      const name      = p.name ?? '(unnamed persona)'
      const archetype = p.archetype ? ` — ${p.archetype}` : ''
      const bio       = p.bio_one_line ?? p.description ?? ''
      const desire    = p.desire ?? p.goals ?? p.motivations ?? ''
      const barrier   = p.barrier ?? p.challenges ?? ''
      const message   = p.message ?? ''
      const entryPts  = Array.isArray(p.likely_entry_points) ? p.likely_entry_points : []

      const lines: string[] = [`### ${name}${archetype}`]
      if (bio)              lines.push(bio)
      if (desire)           lines.push(`**Wants**: ${desire}`)
      if (barrier)          lines.push(`**Barrier**: ${barrier}`)
      if (entryPts.length)  lines.push(`**Likely entry pages**: ${entryPts.join(', ')}`)
      if (message)          lines.push(`**Posture toward them**:` + NL2 + quote(message))
      return lines.join(NL2)
    })
    sections.push(`## Personas (${s.personas.length})${NL2}${personaBlocks.join(NL2)}`)
  }

  // voice exemplars — phrases to imitate
  if (Array.isArray(s.voice_exemplars) && s.voice_exemplars.length > 0) {
    const lines = s.voice_exemplars.map((e: any) => {
      const phrase = e.phrase ?? ''
      const source = e.source ?? ''
      const why    = e.why_it_works ?? e.why_exemplar ?? ''
      const parts  = [quote(phrase)]
      if (source) parts.push(`— ${source}`)
      if (why)    parts.push(`*${why}*`)
      return parts.join(NL2)
    })
    sections.push(`## Voice exemplars (${s.voice_exemplars.length})${NL2}${lines.join(NL2)}`)
  }

  // voice anti-exemplars — what to avoid
  if (Array.isArray(s.voice_anti_exemplars) && s.voice_anti_exemplars.length > 0) {
    const lines = s.voice_anti_exemplars.map((e: any) => {
      const phrase = e.phrase ?? e.pattern ?? ''
      const why    = e.why_it_breaks ?? e.why_avoid ?? ''
      const kind   = e.kind ?? e.source ?? ''
      const parts  = [quote(phrase)]
      if (kind)   parts.push(`— ${kind}`)
      if (why)    parts.push(`*${why}*`)
      return parts.join(NL2)
    })
    sections.push(`## What this church doesn't sound like (${s.voice_anti_exemplars.length})${NL2}${lines.join(NL2)}`)
  }

  // voice characteristics (legacy field — top_attributes + tone examples)
  const vc: any = (s as any).voice_characteristics
  if (vc && typeof vc === 'object') {
    const lines: string[] = []
    if (Array.isArray(vc.top_attributes) && vc.top_attributes.length) {
      lines.push(`**Top attributes**: ${vc.top_attributes.join(', ')}`)
    }
    if (Array.isArray(vc.tone_examples_do) && vc.tone_examples_do.length) {
      lines.push(`**Do**:` + NL + vc.tone_examples_do.map((d: string) => `- ${d}`).join(NL))
    }
    if (Array.isArray(vc.tone_examples_dont) && vc.tone_examples_dont.length) {
      lines.push(`**Don't**:` + NL + vc.tone_examples_dont.map((d: string) => `- ${d}`).join(NL))
    }
    if (lines.length) sections.push(`## Voice characteristics${NL2}${lines.join(NL2)}`)
  }

  // persuasive posture per persona (cowork shape) OR derived map
  const ppp: any = s.persuasive_posture_by_persona
  if (ppp && typeof ppp === 'object' && Object.keys(ppp).length > 0) {
    const lines = Object.entries(ppp as Record<string, string>).map(
      ([name, posture]) => `**${name}**: ${posture}`,
    )
    sections.push(`## Posture toward each persona${NL2}${lines.join(NL2)}`)
  }

  // topic coverage plan — page mapping
  const tcp: any = (s as any).topic_coverage_plan
  if (Array.isArray(tcp) && tcp.length > 0) {
    const lines = tcp.map((entry: any) => {
      const topic = entry.topic_label ?? entry.topic_key ?? '(unnamed)'
      const dest  = entry.destination_page ?? entry.absorbed_into ?? '(unmapped)'
      const kind  = entry.destination_kind ? ` (${entry.destination_kind})` : ''
      return `- **${topic}** → ${dest}${kind}`
    })
    sections.push(`## Topic coverage plan (${tcp.length})${NL2}${lines.join(NL)}`)
  }

  return joinSections(sections)
}

// ───────────────────────────────────────────────────────────────────
//  ministry_model — classify-ministry output
// ───────────────────────────────────────────────────────────────────

export function ministryModelToMarkdown(raw: unknown): string {
  const m: any = raw
  if (!m || typeof m !== 'object') return '_No ministry-style verdict yet._'

  const sections: string[] = ['# Ministry style']

  // model + confidence
  const model      = m.model ?? '(unknown)'
  const confidence = typeof m.confidence === 'number' ? `${Math.round(m.confidence * 100)}%` : null
  const secondary  = m.secondary_blend
  const lines: string[] = [
    `**Primary**: ${model}` + (confidence ? ` · ${confidence} confidence` : ''),
  ]
  if (secondary) {
    lines.push(`**Secondary blend**: ${secondary}`)
  }
  if (m.blend_notes) {
    lines.push(`**Blend notes**: ${m.blend_notes}`)
  }
  sections.push(lines.join(NL))

  // rationale
  if (m.rationale) {
    sections.push(`## Rationale${NL2}${m.rationale}`)
  }

  // evidence
  if (Array.isArray(m.evidence) && m.evidence.length) {
    const items = m.evidence.map((e: any) => {
      const text = typeof e === 'string' ? e : (e.snippet ?? JSON.stringify(e))
      return quote(text)
    })
    sections.push(`## Evidence (${m.evidence.length})${NL2}${items.join(NL2)}`)
  }

  // cta_default
  if (m.cta_default) {
    sections.push(`## Default call-to-action voice${NL2}${quote(m.cta_default)}`)
  }

  return joinSections(sections)
}

// ───────────────────────────────────────────────────────────────────
//  site_strategy — plan-site-strategy output
// ───────────────────────────────────────────────────────────────────

export function siteStrategyToMarkdown(raw: unknown): string {
  const ss: any = raw
  if (!ss || typeof ss !== 'object') return '_No sitemap and navigation plan yet._'

  const sections: Array<string | null> = ['# Sitemap and navigation']

  // pages
  if (Array.isArray(ss.pages) && ss.pages.length > 0) {
    const pageBlocks = ss.pages.map((p: any) => {
      const lines: string[] = [`### \`${p.slug ?? '(no slug)'}\` — ${p.name ?? p.title ?? ''}`.trimEnd()]
      if (p.purpose)          lines.push(p.purpose)
      if (p.primary_audience) lines.push(`**Primary audience**: ${p.primary_audience}`)
      if (p.primary_funnel)   lines.push(`**Funnel stage**: ${p.primary_funnel}`)
      if (p.nav_strategy)     lines.push(`**Nav placement**: ${p.nav_strategy}`)
      return lines.join(NL2)
    })
    sections.push(`## Pages (${ss.pages.length})${NL2}${pageBlocks.join(NL2)}`)
  }

  // nav structure (primary / footer / cta_only)
  if (ss.nav && typeof ss.nav === 'object') {
    const navLines: string[] = []
    if (Array.isArray(ss.nav.primary) && ss.nav.primary.length) {
      const primary = ss.nav.primary.map((n: any) => {
        const children = Array.isArray(n.children) && n.children.length ? ` → (${n.children.join(', ')})` : ''
        return `- ${n.slug}${children}`
      })
      navLines.push(`**Primary nav**:` + NL + primary.join(NL))
    }
    if (Array.isArray(ss.nav.footer) && ss.nav.footer.length) {
      navLines.push(`**Footer**: ${ss.nav.footer.join(', ')}`)
    }
    if (Array.isArray(ss.nav.cta_only) && ss.nav.cta_only.length) {
      navLines.push(`**CTA-only (sticky/inline)**: ${ss.nav.cta_only.join(', ')}`)
    }
    if (navLines.length) sections.push(`## Navigation${NL2}${navLines.join(NL2)}`)
  }

  // nav presentation — the richer "what the visitor SEES at rest"
  // block. Legacy pipeline (stage_2.nav_presentation) carried this;
  // new cowork plan-site-strategy doesn't emit it yet, so the drawer
  // splices in stage_2.nav_presentation as a fallback before
  // dispatching here.
  const np: any = ss.nav_presentation
  if (np && typeof np === 'object') {
    const npLines: string[] = []
    if (typeof np.shell === 'string') {
      const shellLabels: Record<string, string> = {
        standard_dropdowns: 'Standard dropdowns',
        megamenu:           'Mega menu',
        offcanvas:          'Off-canvas / hamburger',
      }
      npLines.push(`**Shell**: ${shellLabels[np.shell as string] ?? np.shell}`)
    }
    if (typeof np.presentation_rationale === 'string' && np.presentation_rationale.trim()) {
      npLines.push(np.presentation_rationale)
    }

    // Visible top-level — what shows at rest
    if (Array.isArray(np.visible_top_level) && np.visible_top_level.length > 0) {
      const items = np.visible_top_level.map((it: any) => {
        const label = it.label ?? it.group_label ?? it.slug ?? '(unlabeled)'
        const kind  = it.kind ? ` *(${it.kind})*` : ''
        return `- ${label}${kind}`
      })
      npLines.push(`**Visible top-level (at rest)**:` + NL + items.join(NL))
    }

    // Standard dropdowns
    if (np.standard_dropdowns && Array.isArray(np.standard_dropdowns.groups) && np.standard_dropdowns.groups.length > 0) {
      const groups = np.standard_dropdowns.groups.map((g: any) => {
        const head  = g.group_label ?? '(unnamed group)'
        const links = Array.isArray(g.children)
          ? g.children.map((c: any) => `  - ${c.label ?? c.slug ?? ''}${c.one_line_description ? ` — *${c.one_line_description}*` : ''}`).join(NL)
          : ''
        return `**${head}**${links ? NL + links : ''}`
      })
      npLines.push(`**Dropdowns**:` + NL2 + groups.join(NL2))
    }

    // Megamenu panels — one per top-level hover, columns + featured tile
    if (Array.isArray(np.megamenu_panels) && np.megamenu_panels.length > 0) {
      const panels = np.megamenu_panels.map((panel: any) => {
        const trigger = panel.triggered_by ?? '(unnamed)'
        const lines: string[] = [`### Panel: "${trigger}"`]
        if (Array.isArray(panel.columns) && panel.columns.length > 0) {
          for (const col of panel.columns) {
            const head = col.heading ?? '(column)'
            const desc = col.description ? ` — *${col.description}*` : ''
            const links = Array.isArray(col.links)
              ? col.links.map((l: any) => `  - ${l.label ?? l.slug ?? ''}${l.one_line_description ? ` — *${l.one_line_description}*` : ''}`).join(NL)
              : ''
            lines.push(`**${head}**${desc}${links ? NL + links : ''}`)
          }
        }
        if (panel.featured_tile && typeof panel.featured_tile === 'object') {
          const ft = panel.featured_tile
          const kind  = ft.kind ? ` *(${ft.kind})*` : ''
          const head  = ft.heading ?? ''
          const body  = ft.body ?? ''
          const link  = ft.link_label ? `  → **${ft.link_label}**` : ''
          lines.push(`**Featured tile**${kind}${head ? NL + head : ''}${body ? NL + body : ''}${link ? NL + link : ''}`)
        }
        return lines.join(NL2)
      })
      npLines.push(`**Megamenu panels** — one per top-level hover` + NL2 + panels.join(NL2))
    }

    // Off-canvas overlay
    if (np.offcanvas_overlay && typeof np.offcanvas_overlay === 'object') {
      const ov = np.offcanvas_overlay
      const ovLines: string[] = []
      if (ov.hero_message)   ovLines.push(`*Hero*: ${ov.hero_message}`)
      if (Array.isArray(ov.sections) && ov.sections.length > 0) {
        for (const s of ov.sections) {
          const head  = s.section_label ?? '(section)'
          const links = Array.isArray(s.links)
            ? s.links.map((l: any) => `  - ${l.label ?? l.slug ?? ''}`).join(NL)
            : ''
          ovLines.push(`**${head}**${links ? NL + links : ''}`)
        }
      }
      if (ov.surfaced_facts && typeof ov.surfaced_facts === 'object') {
        const sf = ov.surfaced_facts
        const facts: string[] = []
        if (sf.service_times) facts.push(`service times: ${sf.service_times}`)
        if (sf.address)       facts.push(`address: ${sf.address}`)
        if (sf.search === true) facts.push('search enabled')
        if (Array.isArray(sf.socials) && sf.socials.length > 0) {
          facts.push(`socials: ${sf.socials.map((x: any) => x.platform).filter(Boolean).join(', ')}`)
        }
        if (facts.length) ovLines.push(`**Surfaced facts**: ${facts.join(' · ')}`)
      }
      if (ovLines.length) npLines.push(`**Off-canvas overlay**:` + NL2 + ovLines.join(NL2))
    }

    if (npLines.length) sections.push(`## Nav presentation${NL2}${npLines.join(NL2)}`)
  }

  // persona journeys
  if (Array.isArray(ss.persona_journeys) && ss.persona_journeys.length > 0) {
    const journeys = ss.persona_journeys.map((j: any) => {
      const persona = j.persona ?? j.persona_name ?? '(unnamed)'
      const lines: string[] = [`### ${persona}`]
      if (Array.isArray(j.entry_points) && j.entry_points.length) {
        lines.push(`**Enters at**: ${j.entry_points.join(' / ')}`)
      }
      if (Array.isArray(j.journey) && j.journey.length) {
        lines.push(`**Walks**: ${j.journey.join(' → ')}`)
      } else if (Array.isArray(j.journey_arc) && j.journey_arc.length) {
        lines.push(`**Walks**: ${j.journey_arc.join(' → ')}`)
      }
      const dor = j.drop_off_risk
      if (dor && typeof dor === 'object') {
        const at  = dor.at_slug ?? '(unknown page)'
        const why = dor.reason ?? ''
        const fix = dor.mitigation ?? ''
        lines.push(`**Risk of drop-off at \`${at}\`**: ${why}` + (fix ? NL2 + `*Mitigation*: ${fix}` : ''))
      }
      if (Array.isArray(j.barriers_addressed) && j.barriers_addressed.length) {
        lines.push(`**Barriers addressed**: ${j.barriers_addressed.join(', ')}`)
      }
      return lines.join(NL2)
    })
    sections.push(`## Persona journeys (${ss.persona_journeys.length})${NL2}${journeys.join(NL2)}`)
  }

  // pages considered + dropped
  if (Array.isArray(ss.pages_considered_dropped) && ss.pages_considered_dropped.length > 0) {
    const items = ss.pages_considered_dropped.map((p: any) =>
      `- \`${p.slug}\` — ${p.reason}`,
    )
    sections.push(`## Pages we considered but dropped (${ss.pages_considered_dropped.length})${NL2}${items.join(NL)}`)
  }

  return joinSections(sections)
}

// ───────────────────────────────────────────────────────────────────
//  page_critique — critique-page output (per page)
// ───────────────────────────────────────────────────────────────────

export function pageCritiqueToMarkdown(raw: unknown): string {
  const c: any = raw
  if (!c || typeof c !== 'object') return '_No page review yet._'

  const sections: string[] = [`# Page review: \`${c.page_slug ?? '(unknown page)'}\``]

  // 5-axis scores
  const scoreLines = [
    `- **Dignity**: ${c.dignity ?? '—'}`,
    `- **Voice character**: ${c.voice_character ?? '—'}`,
    `- **Persona fit**: ${c.persona_fit ?? '—'}`,
    `- **Source coverage**: ${c.source_coverage ?? '—'}`,
    `- **Claim plausibility**: ${c.claim_plausibility ?? '—'}`,
  ]
  sections.push(`## Scores (out of 100)${NL2}${scoreLines.join(NL)}`)

  // summary
  if (c.summary) {
    sections.push(`## Summary${NL2}${c.summary}`)
  }

  // directives by severity
  if (Array.isArray(c.directives) && c.directives.length > 0) {
    const blockers = c.directives.filter((d: any) => d.severity === 'blocker')
    const warnings = c.directives.filter((d: any) => d.severity === 'warning')
    const nits     = c.directives.filter((d: any) => d.severity === 'nit')

    const fmt = (d: any) => {
      const axis     = d.axis ? ` · _${d.axis}_` : ''
      const sec      = (typeof d.section_ix === 'number') ? ` · section ${d.section_ix}` : ''
      const slot     = d.slot_key ? ` · \`${d.slot_key}\`` : ''
      const fixKind  = d.fix_kind ? `${d.fix_kind}: ` : ''
      return `- **${fixKind}**${d.note}${axis}${sec}${slot}`
    }
    if (blockers.length) sections.push(`### Blockers (${blockers.length})${NL2}${blockers.map(fmt).join(NL)}`)
    if (warnings.length) sections.push(`### Warnings (${warnings.length})${NL2}${warnings.map(fmt).join(NL)}`)
    if (nits.length)     sections.push(`### Nits (${nits.length})${NL2}${nits.map(fmt).join(NL)}`)
  }

  // standout lines (what's working)
  if (Array.isArray(c.standout_lines) && c.standout_lines.length > 0) {
    sections.push(`## Lines that landed${NL2}${c.standout_lines.map((l: string) => quote(l)).join(NL2)}`)
  }

  // problem lines (what to revise)
  if (Array.isArray(c.problem_lines) && c.problem_lines.length > 0) {
    sections.push(`## Lines that need revision${NL2}${c.problem_lines.map((l: string) => quote(l)).join(NL2)}`)
  }

  return joinSections(sections)
}

// ───────────────────────────────────────────────────────────────────
//  critique_rollup — synthesize-critique output (project-level)
// ───────────────────────────────────────────────────────────────────

export function critiqueRollupToMarkdown(raw: unknown): string {
  const r: any = raw
  if (!r || typeof r !== 'object') return '_No project-level review yet._'

  const sections: string[] = ['# Project review']

  // overall verdict
  const overall = r.overall_band ?? r.overall_verdict ?? 'unknown'
  sections.push(`**Overall**: ${overall}`)

  // voice consistency
  if (r.voice_consistency && typeof r.voice_consistency === 'object') {
    const vc = r.voice_consistency
    const lines: string[] = [`**Band**: ${vc.band ?? '—'}`]
    if (vc.note) lines.push(vc.note)
    if (Array.isArray(vc.drift_pages) && vc.drift_pages.length) {
      const items = vc.drift_pages.map((p: any) =>
        `- \`${p.page_slug}\` (${p.drift_axis}): ${p.note}`,
      )
      lines.push(`**Pages drifting** (${vc.drift_pages.length}):` + NL + items.join(NL))
    }
    sections.push(`## Voice consistency${NL2}${lines.join(NL2)}`)
  }

  // persona coverage
  if (r.persona_coverage && typeof r.persona_coverage === 'object') {
    const pc = r.persona_coverage
    const lines: string[] = [`**Band**: ${pc.band ?? '—'}`]
    if (Array.isArray(pc.per_persona) && pc.per_persona.length) {
      const rows = pc.per_persona.map((p: any) => {
        const parts = [`**${p.persona}**`,
                       `entry: ${p.entry_point_quality}`,
                       `commit: ${p.commit_endpoint_quality}`,
                       p.journey_walkable ? 'journey walkable' : 'journey breaks']
        let body = `- ${parts.join(' · ')}`
        if (p.barrier_unaddressed_note) body += NL + `  - *Barrier gap*: ${p.barrier_unaddressed_note}`
        return body
      })
      lines.push(`**Per persona**:` + NL + rows.join(NL))
    }
    sections.push(`## Persona coverage${NL2}${lines.join(NL2)}`)
  }

  // structural parity (nav, drafts)
  if (r.structural_parity && typeof r.structural_parity === 'object') {
    const sp = r.structural_parity
    const lines: string[] = [`**Band**: ${sp.band ?? '—'}`]
    if (Array.isArray(sp.pages_in_nav_but_undrafted) && sp.pages_in_nav_but_undrafted.length) {
      lines.push(`**In nav but undrafted**: ${sp.pages_in_nav_but_undrafted.join(', ')}`)
    }
    if (Array.isArray(sp.pages_drafted_but_unreachable) && sp.pages_drafted_but_unreachable.length) {
      lines.push(`**Drafted but unreachable**: ${sp.pages_drafted_but_unreachable.join(', ')}`)
    }
    if (Array.isArray(sp.nav_target_404s) && sp.nav_target_404s.length) {
      const items = sp.nav_target_404s.map((n: any) =>
        `- \`${n.from_slug}\` → \`${n.broken_target}\` ("${n.cta_label}")`,
      )
      lines.push(`**Broken nav links**:` + NL + items.join(NL))
    }
    sections.push(`## Structural parity${NL2}${lines.join(NL2)}`)
  }

  // source coverage (orphans + over-used)
  if (r.source_coverage && typeof r.source_coverage === 'object') {
    const sc = r.source_coverage
    const lines: string[] = [`**Band**: ${sc.band ?? '—'}`]
    if (Array.isArray(sc.project_orphans) && sc.project_orphans.length) {
      const items = sc.project_orphans.slice(0, 10).map((o: any) =>
        `- ${o.topic} \`${o.atom_id?.slice(0, 8)}\` (attempted: ${o.pages_attempted?.join(', ') || 'no pages'})`,
      )
      lines.push(`**Orphaned sources** (${sc.project_orphans.length}):` + NL + items.join(NL) +
        (sc.project_orphans.length > 10 ? NL + `  - … and ${sc.project_orphans.length - 10} more` : ''))
    }
    if (Array.isArray(sc.over_used) && sc.over_used.length) {
      const items = sc.over_used.map((o: any) =>
        `- \`${o.atom_id?.slice(0, 8)}\` appears on ${o.appears_on_pages?.length ?? 0} pages: ${o.appears_on_pages?.join(', ')}`,
      )
      lines.push(`**Over-used sources** (${sc.over_used.length}):` + NL + items.join(NL))
    }
    sections.push(`## Source coverage${NL2}${lines.join(NL2)}`)
  }

  // cross-page findings
  if (Array.isArray(r.cross_page_findings) && r.cross_page_findings.length > 0) {
    const items = r.cross_page_findings.map((f: any) => {
      const pages = Array.isArray(f.pages) && f.pages.length ? ` _(pages: ${f.pages.join(', ')})_` : ''
      return `- **${f.kind}**: ${f.description}${pages}`
    })
    sections.push(`## Cross-page findings (${r.cross_page_findings.length})${NL2}${items.join(NL)}`)
  }

  return joinSections(sections)
}

// ───────────────────────────────────────────────────────────────────
//  Dispatch
// ───────────────────────────────────────────────────────────────────

/** Maps an `output_key` (or nested key path like `page_critiques.<slug>`)
 *  to the converter that knows how to render it. Returns null when the
 *  key is Tier 2 (no custom converter — drawer falls back to JSON). */
export function getConverterForOutputKey(
  outputKey: string,
): ((raw: unknown) => string) | null {
  // Per-page critique nested key
  if (outputKey.startsWith('page_critiques.')) return pageCritiqueToMarkdown
  switch (outputKey) {
    case 'stage_1':                return stage1ToMarkdown
    case 'ministry_model':         return ministryModelToMarkdown
    case 'site_strategy':          return siteStrategyToMarkdown
    case 'critique_rollup':        return critiqueRollupToMarkdown
    default:                       return null
  }
}
