/**
 * Stage 2 (Sitemap) output renderer.
 *
 * Reads `roadmap_state.stage_2` and renders the full proposal:
 * nav strategy + tree, phase summary, Phase 1 / Phase 2 page cards
 * with hero direction + sections, vocabulary decisions, AEO/GEO
 * keyword targets, CS flags, sources used, provenance footer.
 *
 * Used by:
 *   - SitemapWorkspace (canonical home — shows before approval as
 *     the proposal, after approval real `web_pages` records take over)
 *   - Future: a partner-facing export view
 */

import { Compass } from 'lucide-react'

type ViewMode = 'staff' | 'partner' | 'author' | 'preview'

export function Stage2SitemapView({
  data, viewMode,
}: { data: Record<string, unknown>; viewMode: ViewMode }) {
  const navStrategy   = data.nav_strategy        as string | undefined
  const voiceRegister = data.nav_voice_register  as string | undefined
  const navPattern    = data.nav_pattern         as string | undefined
  const phaseSummary  = data.phase_summary       as Record<string, unknown> | undefined
  const pages         = data.pages               as Array<Record<string, unknown>> | undefined
  const navItems      = data.nav_items           as Array<Record<string, unknown>> | undefined
  const absorbed      = data.absorbed_content    as Array<Record<string, unknown>> | undefined
  const vocabulary    = data.vocabulary_decisions as Array<Record<string, unknown>> | undefined
  const aeo           = data.aeo_keywords        as Record<string, unknown> | undefined
  const csFlags       = data.cs_flags            as Record<string, unknown> | undefined
  const sources       = data.sources_used        as Record<string, unknown> | undefined
  const meta          = data._meta               as Record<string, unknown> | undefined

  const isStaff = viewMode === 'staff' || viewMode === 'author'
  const phase1Pages  = pages?.filter(p => p.phase === '1') ?? []
  const phase2Pages  = pages?.filter(p => p.phase === '2') ?? []
  const navOnlyPages = pages?.filter(p => p.phase === 'nav-only') ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
        <Compass size={11} /> Sitemap proposal
        {meta?.extracted_at && (
          <span className="text-wm-text-subtle font-normal normal-case">
            · {new Date(meta.extracted_at as string).toLocaleString()}
          </span>
        )}
      </div>

      {(navStrategy || voiceRegister || navPattern) && (
        <Section title="Nav strategy">
          {navStrategy && <p className="text-sm text-wm-text leading-relaxed mb-2">{navStrategy}</p>}
          <KVGrid pairs={[
            ['Voice register', voiceRegister ? String(voiceRegister) : ''],
            ['Nav pattern',    navPattern ? formatPattern(navPattern) : ''],
          ]} />
        </Section>
      )}

      {navItems && navItems.length > 0 && (
        <Section title="Primary navigation">
          <div className="rounded-md bg-wm-bg-elevated border border-wm-border p-3">
            <NavTree items={navItems} />
          </div>
        </Section>
      )}

      {phaseSummary && (
        <Section title="Phase summary">
          <KVGrid pairs={[
            ['Phase 1 pages', String(phaseSummary.phase_1_count ?? '')],
            ['Phase 2 pages', String(phaseSummary.phase_2_count ?? '')],
            ['Total',         String(phaseSummary.total ?? '')],
          ]} />
          {phaseSummary.rationale && (
            <p className="text-[12px] text-wm-text-muted leading-relaxed mt-2">{String(phaseSummary.rationale)}</p>
          )}
        </Section>
      )}

      {phase1Pages.length > 0 && (
        <Section title={`Phase 1 pages · ${phase1Pages.length}`}>
          <div className="space-y-2">
            {phase1Pages.map((p, i) => <PageCard key={i} page={p} />)}
          </div>
        </Section>
      )}

      {phase2Pages.length > 0 && (
        <Section title={`Phase 2 pages · ${phase2Pages.length}`}>
          <div className="space-y-2">
            {phase2Pages.map((p, i) => <PageCard key={i} page={p} />)}
          </div>
        </Section>
      )}

      {navOnlyPages.length > 0 && (
        <Section title={`Nav-only · ${navOnlyPages.length}`}>
          <div className="space-y-2">
            {navOnlyPages.map((p, i) => <PageCard key={i} page={p} compact />)}
          </div>
        </Section>
      )}

      {isStaff && absorbed && absorbed.length > 0 && (
        <Section title="Absorbed content (nested or dropped)">
          <ul className="space-y-1.5">
            {absorbed.map((a, i) => (
              <li key={i} className="text-[12px] text-wm-text-muted">
                <span className="text-wm-text font-medium">{String(a.content_item ?? '')}</span>
                {a.absorbed_into
                  ? <> → <code className="text-wm-accent-strong">{String(a.absorbed_into)}</code></>
                  : <> · <span className="text-wm-danger">dropped</span></>}
                {a.rationale && <> · {String(a.rationale)}</>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {vocabulary && vocabulary.length > 0 && (
        <Section title="Vocabulary decisions">
          <ul className="space-y-1.5">
            {vocabulary.map((v, i) => (
              <li key={i} className="text-[12px] text-wm-text-muted">
                {v.instead_of && <><s className="text-wm-text-subtle">{String(v.instead_of)}</s> → </>}
                <span className="text-wm-text font-medium">{String(v.we_chose ?? '')}</span>
                {v.why && <> · {String(v.why)}</>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isStaff && aeo && (
        <Section title="AEO / GEO keyword targets">
          <KVGrid pairs={[
            ['Primary',   formatList(aeo.primary)],
            ['Secondary', formatList(aeo.secondary)],
            ['Long-tail', formatList(aeo.long_tail)],
          ]} />
        </Section>
      )}

      {isStaff && csFlags && (
        (Array.isArray(csFlags.hard_blockers) && csFlags.hard_blockers.length > 0)
        || (Array.isArray(csFlags.soft_assumptions) && csFlags.soft_assumptions.length > 0)
        || (Array.isArray(csFlags.design_flags) && csFlags.design_flags.length > 0)
      ) && (
        <Section title="CS flags">
          {Array.isArray(csFlags.hard_blockers) && csFlags.hard_blockers.length > 0 && (
            <FlagList tone="danger" label="Hard blockers" items={csFlags.hard_blockers as string[]} />
          )}
          {Array.isArray(csFlags.soft_assumptions) && csFlags.soft_assumptions.length > 0 && (
            <FlagList tone="warning" label="Soft assumptions" items={csFlags.soft_assumptions as string[]} />
          )}
          {Array.isArray(csFlags.design_flags) && csFlags.design_flags.length > 0 && (
            <FlagList tone="info" label="Design / build flags" items={csFlags.design_flags as string[]} />
          )}
        </Section>
      )}

      {isStaff && sources && (
        <Section title="Sources used (Stage 2)">
          <KVGrid pairs={[
            ['Stage 1',                 String(sources.stage_1 ?? '—')],
            ['Strategy brief',          String(sources.strategy_brief ?? '—')],
            ['AM handoff',              String(sources.am_handoff ?? '—')],
            ['Discovery questionnaire', String(sources.discovery_questionnaire ?? '—')],
            ['Brand handoff',           String(sources.brand_handoff ?? '—')],
            ['Content collection',      String(sources.content_collection ?? '—')],
          ]} />
          {Array.isArray(sources.conflicts_resolved) && sources.conflicts_resolved.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Conflicts resolved</p>
              <ul className="space-y-1">
                {(sources.conflicts_resolved as string[]).map((c, i) => (
                  <li key={i} className="text-[12px] text-wm-text-muted">· {c}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {isStaff && meta && (
        <div className="text-[10px] text-wm-text-subtle pt-2 border-t border-wm-border">
          Model: <code>{String(meta.model)}</code>
          {meta.usage && typeof meta.usage === 'object' && (
            <> · Tokens: {((meta.usage as Record<string, number>).input_tokens ?? 0).toLocaleString()} in / {((meta.usage as Record<string, number>).output_tokens ?? 0).toLocaleString()} out</>
          )}
        </div>
      )}
    </div>
  )
}

// ── Internals ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest font-bold text-wm-text-subtle mb-2">{title}</p>
      <div>{children}</div>
    </div>
  )
}

function KVGrid({ pairs }: { pairs: Array<[string, string]> }) {
  const visible = pairs.filter(([, v]) => v && v !== '—')
  if (visible.length === 0) return null
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
      {visible.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-wm-text-subtle whitespace-nowrap">{k}</dt>
          <dd className="text-wm-text">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function NavTree({ items, depth = 0 }: { items: Array<Record<string, unknown>>; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'space-y-1.5' : 'space-y-1 ml-4 mt-1'}>
      {items.map((item, i) => {
        const isGroup = item.kind === 'group'
        const children = Array.isArray(item.children) ? item.children as Array<Record<string, unknown>> : []
        return (
          <li key={i} className="text-[13px] text-wm-text">
            <div className="flex items-baseline gap-2">
              {isGroup
                ? <span className="text-wm-text-subtle">▾</span>
                : <span className="text-wm-accent-strong">·</span>}
              <span className={isGroup ? 'font-semibold' : ''}>{String(item.label ?? '')}</span>
              {!isGroup && item.slug && (
                <code className="text-[11px] text-wm-text-subtle">/{String(item.slug)}</code>
              )}
            </div>
            {isGroup && children.length > 0 && <NavTree items={children} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}

function PageCard({ page, compact = false }: { page: Record<string, unknown>; compact?: boolean }) {
  const sections = Array.isArray(page.sections) ? page.sections as Array<Record<string, unknown>> : []
  const hero = page.hero as Record<string, unknown> | undefined
  const cta = hero?.primary_cta as Record<string, unknown> | undefined

  return (
    <div className="rounded-md bg-wm-bg-elevated border border-wm-border p-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h4 className="text-[14px] font-semibold text-wm-text">{String(page.name ?? '')}</h4>
        <code className="text-[11px] text-wm-text-subtle">/{String(page.slug ?? '')}</code>
        {page.density && (
          <span className={[
            'text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded',
            page.density === 'high'   ? 'bg-wm-success-bg text-wm-success' :
            page.density === 'medium' ? 'bg-wm-warning-bg text-wm-warning' :
                                         'bg-wm-danger-bg text-wm-danger',
          ].join(' ')}>{String(page.density)}</span>
        )}
      </div>
      {page.strategic_purpose && (
        <p className="text-[12px] text-wm-text mt-1 italic">{String(page.strategic_purpose)}</p>
      )}
      {!compact && page.rationale && (
        <p className="text-[12px] text-wm-text-muted mt-1 leading-snug">{String(page.rationale)}</p>
      )}
      {!compact && hero?.headline_direction && (
        <div className="mt-2 pl-3 border-l-2 border-wm-accent/30">
          <p className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle mb-1">Hero direction</p>
          <p className="text-[12px] text-wm-text">{String(hero.headline_direction)}</p>
          {cta?.label && (
            <p className="text-[11px] text-wm-accent-strong mt-1">→ {String(cta.label)}</p>
          )}
        </div>
      )}
      {!compact && sections.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] text-wm-text-muted cursor-pointer hover:text-wm-text">
            {sections.length} section{sections.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5 space-y-1 pl-3">
            {sections.map((s, i) => (
              <li key={i} className="text-[12px] text-wm-text">
                <span className="font-medium">{String(s.name ?? '')}</span>
                {s.contains && <span className="text-wm-text-muted"> — {String(s.contains)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function FlagList({ tone, label, items }: { tone: 'danger' | 'warning' | 'info'; label: string; items: string[] }) {
  const toneClass = tone === 'danger'  ? 'border-wm-danger/20 bg-wm-danger-bg'
                  : tone === 'warning' ? 'border-wm-warning/20 bg-wm-warning-bg'
                                       : 'border-wm-border bg-wm-bg-elevated'
  const labelClass = tone === 'danger'  ? 'text-wm-danger'
                   : tone === 'warning' ? 'text-wm-warning'
                                        : 'text-wm-text-muted'
  return (
    <div className={['rounded-md border p-2.5 mb-2 last:mb-0', toneClass].join(' ')}>
      <p className={['text-[10px] uppercase tracking-widest font-bold mb-1.5', labelClass].join(' ')}>{label}</p>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="text-[12px] text-wm-text">· {it}</li>)}
      </ul>
    </div>
  )
}

function formatList(v: unknown): string {
  if (!Array.isArray(v)) return ''
  return v.join(' · ')
}

function formatPattern(p: string): string {
  const map: Record<string, string> = {
    flat: 'Flat (each item is a page)',
    grouped_dropdowns: 'Grouped dropdowns',
    thematic_groups: 'Thematic groups (Reality LA style)',
    thematic_verbs: 'Thematic verbs (Austin Stone style)',
    offcanvas: 'Offcanvas (slide-in menu)',
    megamenu: 'Megamenu',
  }
  return map[p] ?? p
}
