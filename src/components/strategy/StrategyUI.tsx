/**
 * Shared primitives for the Strategy module.
 *
 *  - DepartmentBadge — pill with dept hue (soft bg + ink fg)
 *  - StatusDot       — colored dot + text (never a filled pill)
 *  - PriorityMark    — small colored square + text
 *  - CategoryPill    — soft bg + ink fg pill for Progress entry categories
 *  - SidebarSubheading — small uppercase label for subgroups inside a nav group
 */

import type { Department, InitiativeStatus, Priority, ProgressCategory, StrategyNotionSetupError } from '../../types/strategy'

// ── Department ────────────────────────────────────────────────────────────

const DEPT_LABELS: Record<Department, string> = {
  'all-in':   'All In',
  social:     'Social',
  branding:   'Branding',
  web:        'Web',
}

/** Tailwind classes for a department badge — soft bg + ink fg. Pulls from
 *  the `dept-*` tokens in index.css. */
const DEPT_CLASSES: Record<Department, string> = {
  'all-in':   'bg-dept-allin-soft text-dept-allin',
  social:     'bg-dept-social-soft text-dept-social',
  branding:   'bg-dept-branding-soft text-dept-branding',
  web:        'bg-dept-web-soft text-dept-web',
}

const DEPT_HEX: Record<Department, string> = {
  'all-in':   '#C2410C',
  social:     '#BE123C',
  branding:   '#1D4ED8',
  web:        '#047857',
}

export function departmentColor(dept: Department | null | undefined): string {
  return dept ? DEPT_HEX[dept] : '#6B6180'
}

export function DepartmentBadge({ department, size = 'sm' }: {
  department: Department | null | undefined
  size?: 'xs' | 'sm'
}) {
  if (!department) return null
  const cls = DEPT_CLASSES[department]
  const sz = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
  return (
    <span className={`inline-flex items-center rounded-full font-semibold uppercase tracking-wide ${sz} ${cls}`}>
      {DEPT_LABELS[department]}
    </span>
  )
}

// ── Status ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed:      'Proposed',
  scoping:       'Scoping',
  'in-progress': 'In Progress',
  testing:       'Testing',
  blocked:       'Blocked',
  'in-review':   'In Review',
  launched:      'Launched',
  paused:        'Paused',
  archived:      'Archived',
}

const STATUS_COLOR: Record<InitiativeStatus, string> = {
  proposed:      'bg-status-proposed',
  scoping:       'bg-status-scoping',
  'in-progress': 'bg-status-inprogress',
  testing:       'bg-status-testing',
  blocked:       'bg-status-blocked',
  'in-review':   'bg-status-inreview',
  launched:      'bg-status-launched',
  paused:        'bg-status-paused',
  archived:      'bg-status-archived',
}

export function StatusDot({ status }: { status: InitiativeStatus | null | undefined }) {
  if (!status) return <span className="text-purple-gray/60 text-xs">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-purple-gray">
      <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── Priority ─────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_COLOR: Record<Priority, string> = {
  high:   'bg-priority-high',
  medium: 'bg-priority-medium',
  low:    'bg-priority-low',
}

export function PriorityMark({ priority }: { priority: Priority | null | undefined }) {
  if (!priority) return <span className="text-purple-gray/60 text-xs">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-purple-gray">
      <span className={`w-2 h-2 rounded-sm ${PRIORITY_COLOR[priority]}`} />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

// ── Progress category pill ────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ProgressCategory, string> = {
  progress: 'Progress',
  decision: 'Decision',
  resource: 'Resource',
  feedback: 'Feedback',
  intel:    'Intel',
  blocker:  'Blocker',
}

const CATEGORY_CLASSES: Record<ProgressCategory, string> = {
  progress: 'bg-cat-progress-bg text-cat-progress-fg',
  decision: 'bg-cat-decision-bg text-cat-decision-fg',
  resource: 'bg-cat-resource-bg text-cat-resource-fg',
  feedback: 'bg-cat-feedback-bg text-cat-feedback-fg',
  intel:    'bg-cat-intel-bg text-cat-intel-fg',
  blocker:  'bg-cat-blocker-bg text-cat-blocker-fg',
}

export function CategoryPill({ category }: { category: ProgressCategory }) {
  return (
    <span className={`inline-flex items-center rounded text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 ${CATEGORY_CLASSES[category]}`}>
      {CATEGORY_LABEL[category]}
    </span>
  )
}

// ── Sidebar subheading ────────────────────────────────────────────────────

/** Small lighter label rendered inside an expanded sidebar group. Used for
 *  "Social" under the Tools group. No icon, no hover state — pure label. */
export function SidebarSubheading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
      {children}
    </p>
  )
}

// ── Setup + empty + loading states ───────────────────────────────────────

/** Rendered on every Strategy page when the edge function returns a
 *  `setup-required` error. The body branches on which capability is missing
 *  — read setup vs the Phase 2 write-capability case. */
export function StrategyNotionSetupBanner({ error }: { error: StrategyNotionSetupError }) {
  const writeOnly = error.missing.length === 1 && error.missing[0] === 'write-capability'
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
      <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest mb-2">
        {writeOnly
          ? 'Notion integration needs write access'
          : 'Notion integration not set up'}
      </p>
      <p className="text-sm text-amber-900 mb-3">{error.message}</p>

      {writeOnly ? (
        <ol className="text-xs text-amber-900/90 list-decimal ml-5 space-y-1">
          <li>Open Notion → Settings → Connections → your strategy integration.</li>
          <li>Under <strong>Capabilities</strong>, enable both <strong>Update content</strong> and <strong>Insert content</strong>.</li>
          <li>Save and retry the action — no redeploy needed.</li>
        </ol>
      ) : (
        <ol className="text-xs text-amber-900/90 list-decimal ml-5 space-y-1">
          <li>Create a Notion internal integration and copy its secret.</li>
          <li>Share the Initiatives, Milestones, Progress, and Doc Hub databases with it.</li>
          <li>
            Set the secret: <code className="bg-white px-1 rounded">supabase secrets set NOTION_TOKEN=secret_…</code>
          </li>
          <li>
            Deploy: <code className="bg-white px-1 rounded">supabase functions deploy strategy-notion</code>
          </li>
        </ol>
      )}
    </div>
  )
}

/** Small centered message for empty collections + loading — keeps page
 *  bodies consistent. */
export function StrategyEmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-8 text-center">
      <p className="text-sm text-[var(--color-lib-text-muted)]">{children}</p>
    </div>
  )
}

export function StrategyLoadingCard({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-surface)] p-8 text-center">
      <p className="text-sm text-[var(--color-lib-text-muted)] animate-pulse">{label}</p>
    </div>
  )
}
