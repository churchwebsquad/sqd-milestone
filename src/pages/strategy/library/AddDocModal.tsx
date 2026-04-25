import { useEffect, useMemo, useState } from 'react'
import { Send, X } from 'lucide-react'
import { createDoc } from '../../../lib/strategyNotion'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import { groupMilestones, loadMilestones, type MilestoneDef, type SquadGroup } from '../../../lib/milestoneCatalog'
import type { Department, VerifierActive, VerifierDefault } from '../../../types/strategy'

const DEPTS: Array<{ value: Department; label: string }> = [
  { value: 'all-in',   label: 'All In' },
  { value: 'web',      label: 'Web' },
  { value: 'branding', label: 'Branding' },
  { value: 'social',   label: 'Social' },
]

const TYPES = ['SOP', 'Guide', 'Template', 'Onboarding & Offboarding', 'Partner-facing'] as const

const GROUPS = [
  'Process & Workflows',
  'Resources & Tools',
  'Culture & Policies',
  'Strategy & Planning',
  'Draft',
] as const

/** Internal-only workflow steps that aren't represented in the milestone
 *  definitions table — kept on the picker so onboarding/offboarding docs
 *  can still be tagged. The rest of the options come from the live
 *  milestone catalog (same source of truth as the Template Editor). */
const INTERNAL_WORKFLOW_STEPS = [
  'Internal: Team Onboarding',
  'Internal: Partner Onboarding',
  'Internal: Offboarding',
] as const

/** Creates a new Doc Hub doc with status `Needs Verification`. The
 *  routing-info banner shows the active verifier in real time as the
 *  Department selection changes.
 *
 *  Three modes:
 *  - `add` (default) — staff/director creates a real doc; body is the
 *    seed text they'll flesh out in Notion.
 *  - `suggest` — VP-only flow. The "Note to the director" field is
 *    required and posts as a Notion page comment after creation so the
 *    director sees the framing in the discussion panel.
 *  - `onboarding` — director/VP flow. Pre-fills the workflow step to
 *    "Internal: Team Onboarding" and forces Priority Doc on, so the new
 *    doc appears on Start Here for the targeted dept the moment it
 *    publishes. Used by the Director Tools panel on the Start Here page.
 */
export function AddDocModal({
  defaultDept,
  defaults,
  activeVerifier,
  onClose,
  onCancel,
  presetDept,
  mode = 'add',
}: {
  defaultDept?: Department | null
  defaults?: VerifierDefault[]
  activeVerifier?: (dept: Department) => VerifierActive | null
  /** Either-or with `onCancel`. Both are accepted because the original
   *  callers used `onCancel` and the Start Here Director Tools call uses
   *  the more-conventional `onClose`. */
  onClose?: () => void
  onCancel?: () => void
  /** Forces the dept select on open without disabling change. Used by
   *  the onboarding mode so a director's dept is pre-selected. */
  presetDept?: Department | null
  mode?: 'add' | 'suggest' | 'onboarding'
}) {
  const close = onClose ?? onCancel ?? (() => {/* no-op */})
  const isSuggestMode = mode === 'suggest'
  const isOnboardingMode = mode === 'onboarding'
  const { applyDocCreated, defaults: ctxDefaults, activeVerifier: ctxActiveVerifier } = useLibraryData()
  const effectiveDefaults = defaults ?? ctxDefaults
  const effectiveActiveVerifier = activeVerifier ?? ctxActiveVerifier
  const [title, setTitle] = useState('')
  const [dept, setDept] = useState<Department>(presetDept ?? defaultDept ?? 'all-in')
  const [group, setGroup] = useState<string>('Process & Workflows')
  const [type, setType] = useState<string>('SOP')
  const [workflowStep, setWorkflowStep] = useState<string>(
    isOnboardingMode ? 'Internal: Team Onboarding' : '',
  )
  const [body, setBody] = useState('')
  const [vpNote, setVpNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [milestoneGroups, setMilestoneGroups] = useState<SquadGroup[]>([])

  useEffect(() => {
    loadMilestones()
      .then(defs => setMilestoneGroups(groupMilestones(defs)))
      .catch(() => {/* picker just falls back to internal-only options */})
  }, [])

  const verifier = effectiveActiveVerifier(dept)
  const verifierLabel = useVerifierLabel(verifier, effectiveDefaults, dept)

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return }
    if (isSuggestMode && !vpNote.trim()) {
      setError('Note to the director is required for a suggested doc')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const doc = await createDoc({
        title: title.trim(),
        department: dept,
        groups: [group],
        types: [type],
        workflowSteps: workflowStep ? [workflowStep] : [],
        body: body.trim() || undefined,
        priorityDoc: isOnboardingMode ? true : undefined,
        vpNote: isSuggestMode && vpNote.trim() ? vpNote.trim() : undefined,
      })
      applyDocCreated(doc)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4"
      onClick={close}
    >
      <div
        className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--color-lib-text)]">
            {isSuggestMode
              ? 'Suggest a doc to a director'
              : isOnboardingMode
                ? 'Create an onboarding doc'
                : 'Add a new doc'}
          </h2>
          <button onClick={close} className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-[var(--color-lib-text-muted)] mb-5">
          {isSuggestMode
            ? 'Drafts a placeholder doc with your note posted as a Notion comment. The assigned director sees it in their review queue, opens it in Notion to write the content, then submits for verification.'
            : isOnboardingMode
              ? <>Saved as <strong>Needs Verification</strong> with <em>Priority Doc</em> + <em>Internal: Team Onboarding</em> pre-set so it shows on Start Here as soon as it's verified.</>
              : <>It'll be saved as <strong>Needs Verification</strong> and routed to the department director for review before it's published.</>}
        </p>

        {isSuggestMode && (
          <Field label="Note for the director (required)">
            <textarea
              value={vpNote}
              onChange={e => setVpNote(e.target.value)}
              autoFocus
              rows={4}
              placeholder="What should this doc cover? Why does it matter? Any references or boundaries to keep in mind?"
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
            />
          </Field>
        )}

        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus={!isSuggestMode}
            placeholder={isSuggestMode
              ? "e.g. Brand Squad — 2026 Service Offerings"
              : "e.g. New Partner Onboarding SOP"}
            className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <select
              value={dept}
              onChange={e => setDept(e.target.value as Department)}
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-2 py-2 text-sm"
            >
              {DEPTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-2 py-2 text-sm"
            >
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Document group">
            <select
              value={group}
              onChange={e => setGroup(e.target.value)}
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-2 py-2 text-sm"
            >
              {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Workflow step (optional)">
            <select
              value={workflowStep}
              onChange={e => setWorkflowStep(e.target.value)}
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-2 py-2 text-sm"
            >
              <option value="">— None —</option>
              {milestoneGroups.map(squad => (
                <optgroup key={squad.squad} label={squad.squadLabel}>
                  {squad.pathways.flatMap((path: { pathway: string; pathwayLabel: string; steps: MilestoneDef[] }) =>
                    path.steps.map((step: MilestoneDef) => (
                      <option key={step.id} value={step.step_name}>
                        {path.pathwayLabel} — {step.step_number}. {step.step_name}
                      </option>
                    )),
                  )}
                </optgroup>
              ))}
              <optgroup label="Internal">
                {INTERNAL_WORKFLOW_STEPS.map(s => (
                  <option key={s} value={s}>{s.replace('Internal: ', '')}</option>
                ))}
              </optgroup>
            </select>
          </Field>
        </div>

        {!isSuggestMode && (
          <Field label="Body (optional)">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Plain text seed for the doc body. You can flesh it out in Notion afterward."
              rows={4}
              className="w-full rounded-md border border-[var(--color-lib-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-lib-accent)]"
            />
          </Field>
        )}

        <div className="rounded-md border border-[#D8CCF4] bg-[var(--color-lib-accent-soft)] px-3 py-2.5 text-sm text-[var(--color-lib-text)] flex items-start gap-2 mb-4">
          <Send size={14} className="mt-0.5 text-[var(--color-lib-accent)] shrink-0" />
          <span>
            {isSuggestMode
              ? <>Will land in <strong>{verifierLabel}</strong>'s review queue as a draft. They'll see your note and write the content.</>
              : <>Will be routed to <strong>{verifierLabel}</strong> for verification.</>}
          </span>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="rounded-md border border-[var(--color-lib-border)] bg-white text-sm font-medium text-[var(--color-lib-text)] px-4 py-2 hover:bg-[var(--color-lib-bg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !title.trim() || (isSuggestMode && !vpNote.trim())}
            className="rounded-md bg-[var(--color-lib-accent)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
          >
            {submitting
              ? (isSuggestMode ? 'Sending…' : 'Submitting…')
              : (isSuggestMode ? 'Send to director' : 'Submit for review')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--color-lib-text-subtle)] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Resolve a verifier's display name. The verifier table holds a UUID; we
 *  match it to the seed defaults' director or delegate field. The actual
 *  resolution to a name happens via the employees row, which we don't load
 *  here — fall back to "the department director". */
function useVerifierLabel(
  verifier: VerifierActive | null,
  defaults: VerifierDefault[],
  dept: Department,
): string {
  return useMemo(() => {
    if (!verifier) return 'the department director'
    const row = defaults.find(d => d.dept === dept)
    if (!row) return 'the department director'
    if (verifier.isDelegate) return 'the delegated reviewer (out of office coverage)'
    // All In docs route to the VP of Strategy (no separate "All In Squad
    // director" exists). Other departments route to their squad director.
    if (dept === 'all-in') return 'the VP of Strategy'
    return `the ${labelDept(dept)} Squad director`
  }, [verifier, defaults, dept])
}

function labelDept(d: Department): string {
  return { 'all-in': 'All In', social: 'Social', branding: 'Brand', web: 'Web' }[d]
}
