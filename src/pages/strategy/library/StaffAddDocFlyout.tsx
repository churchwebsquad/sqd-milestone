/**
 * Right-side drawer for the regular "Add a new doc" flow. Replaces the
 * old centered AddDocModal for `mode='add'` callers — the centered
 * modal felt cramped and didn't carry the Director Doc-Manager
 * affordances staff have come to associate with a "real" doc surface.
 *
 * Visual parity with DocFlyout (the director read/edit drawer): same
 * width, same header layout, same action-bar pattern, same Properties
 * panel. Differences vs DocFlyout:
 *
 *   - Excluded: Audience toggles (Onboarding / Required reading),
 *     Verify, Flag outdated, Archive — all of those are post-creation
 *     director controls, not creation-time concerns.
 *   - Notion link is disabled until the doc is created (no page yet).
 *   - The verification badge is fixed at "Needs Review" — directors
 *     own the verification flip.
 *   - The body editor is a single textarea pre-create (no DocBlock
 *     editor since there's no Notion page to bind blocks to). Once the
 *     doc is created the flyover closes and the user re-opens the doc
 *     from the library to drop into the full block editor.
 */

import { useEffect, useState } from 'react'
import {
  ExternalLink, Loader2, Pencil, Send, Sparkles, X,
} from 'lucide-react'
import { createDoc } from '../../../lib/strategyNotion'
import { useLibraryData } from '../../../components/library/LibraryDataContext'
import {
  DocTypeIcon, DeptPill, VerifBadge,
} from '../../../components/library/LibraryShell'
import {
  groupMilestones, loadMilestones, type MilestoneDef, type SquadGroup,
} from '../../../lib/milestoneCatalog'
import type {
  Department, VerifierActive, VerifierDefault,
} from '../../../types/strategy'

const DEPTS: Array<{ value: Department; label: string }> = [
  { value: 'all-in',   label: 'All In' },
  { value: 'web',      label: 'Web' },
  { value: 'branding', label: 'Branding' },
  { value: 'social',   label: 'Social' },
]

const TYPES = ['SOP', 'Guide', 'Template', 'Onboarding & Offboarding', 'Partner-facing']

const GROUPS = [
  'Process & Workflows',
  'Resources & Tools',
  'Culture & Policies',
  'Strategy & Planning',
  'Draft',
]

const INTERNAL_WORKFLOW_STEPS = [
  'Internal: Team Onboarding',
  'Internal: Partner Onboarding',
  'Internal: Offboarding',
] as const

export function StaffAddDocFlyout({
  defaultDept,
  defaults,
  activeVerifier,
  onClose,
}: {
  defaultDept?: Department | null
  defaults?: VerifierDefault[]
  activeVerifier?: (dept: Department) => VerifierActive | null
  onClose: () => void
}) {
  const {
    applyDocCreated,
    defaults: ctxDefaults,
    activeVerifier: ctxActiveVerifier,
  } = useLibraryData()
  const effectiveDefaults = defaults ?? ctxDefaults
  const effectiveActiveVerifier = activeVerifier ?? ctxActiveVerifier

  const [title, setTitle] = useState('')
  const [dept, setDept] = useState<Department>(defaultDept ?? 'all-in')
  const [group, setGroup] = useState<string>('Process & Workflows')
  const [type, setType] = useState<string>('SOP')
  const [workflowStep, setWorkflowStep] = useState<string>('')
  const [body, setBody] = useState('')
  const [editBody, setEditBody] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [milestoneGroups, setMilestoneGroups] = useState<SquadGroup[]>([])

  useEffect(() => {
    loadMilestones()
      .then(defs => setMilestoneGroups(groupMilestones(defs)))
      .catch(() => {/* picker falls back to internal-only options */})
  }, [])

  const verifier = effectiveActiveVerifier(dept)
  const verifierLabel = useVerifierLabel(verifier, effectiveDefaults, dept)

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return }
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
      })
      applyDocCreated(doc)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <aside
        className="w-full max-w-3xl h-full overflow-y-auto bg-white shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — title + status badges, mirrors DocFlyout layout. */}
        <div className="sticky top-0 bg-white border-b border-[var(--color-lib-border)] px-5 py-3 flex items-start gap-3 z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <DocTypeIcon type={type} size={14} />
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Untitled doc"
                autoFocus
                className="flex-1 text-base font-semibold text-[var(--color-lib-text)] bg-transparent outline-none border-b border-transparent focus:border-[var(--color-lib-accent)] py-0.5"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <DeptPill dept={dept} />
              <VerifBadge status="needs-verification" />
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-lib-accent)] text-white text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 shrink-0">
                <Sparkles size={10} />
                New
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-lib-text-subtle)] hover:text-[var(--color-lib-text)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action bar — matches DocFlyout's pattern but only the actions
            that make sense pre-creation. Verify / Flag outdated /
            Archive are deliberately absent (post-creation director
            actions); Audience toggles also live in the director surface
            so we don't expose them here. */}
        <div className="border-b border-[var(--color-lib-border)] px-5 py-2.5 bg-[var(--color-lib-bg)] flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setEditBody(b => !b)}
            className={[
              'inline-flex items-center gap-1 rounded-sm border text-xs font-medium px-3 py-1.5',
              editBody
                ? 'bg-[var(--color-lib-accent)] text-white border-[var(--color-lib-accent)]'
                : 'border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text)] hover:border-[var(--color-lib-border-strong)]',
            ].join(' ')}
          >
            <Pencil size={11} />
            {editBody ? 'Done editing' : 'Edit body'}
          </button>
          <button
            type="button"
            disabled
            title="Available after the doc is created — Submit for review first."
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--color-lib-border)] bg-white text-[var(--color-lib-text-subtle)] text-xs font-medium px-3 py-1.5 cursor-not-allowed opacity-60"
          >
            <ExternalLink size={11} />
            Notion
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs font-medium text-[var(--color-lib-text)] px-3 py-1.5 hover:bg-[var(--color-lib-bg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !title.trim()}
            className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-lib-accent)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[var(--color-lib-accent-hover)] disabled:opacity-50"
          >
            {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
        </div>

        {/* Body container */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {/* Heads-up notice — explains the routing so staff know
                exactly what happens when they hit Submit. */}
            <div className="rounded-md border border-[var(--color-lib-accent)] bg-[var(--color-lib-accent-soft)] px-4 py-3 flex items-start gap-2">
              <Send size={14} className="mt-0.5 text-[var(--color-lib-accent)] shrink-0" />
              <div className="text-sm text-[var(--color-lib-text)] leading-relaxed">
                This document will be created with status <strong>Needs Verification</strong>.{' '}
                <strong>{verifierLabel}</strong> will be notified to take a look and verify the content.
              </div>
            </div>

            {/* Properties panel — same layout as DocFlyout's
                PropertiesSection, minus Verification (fixed) and
                Audience (director-only). */}
            <div className="rounded-md border border-[var(--color-lib-border)] bg-[var(--color-lib-bg)] p-3 space-y-2">
              <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">
                Properties
              </p>
              <FieldRow label="Department">
                <select
                  value={dept}
                  onChange={e => setDept(e.target.value as Department)}
                  className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
                >
                  {DEPTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Group">
                <select
                  value={group}
                  onChange={e => {
                    const next = e.target.value
                    setGroup(next)
                    // Workflow Step renders only for Process & Workflows
                    // — clear any stale step when the user picks a
                    // different group so submission doesn't persist a
                    // tag the form is no longer showing.
                    if (next !== 'Process & Workflows') setWorkflowStep('')
                  }}
                  className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
                >
                  {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Type">
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
                >
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FieldRow>
              {group === 'Process & Workflows' && (
                <FieldRow label="Workflow Step">
                  <select
                    value={workflowStep}
                    onChange={e => setWorkflowStep(e.target.value)}
                    className="rounded-sm border border-[var(--color-lib-border)] bg-white text-xs px-2 py-1 outline-none flex-1"
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
                </FieldRow>
              )}
            </div>

            {/* Body — toggle between an empty preview state and an
                inline textarea. Pre-create the body has to be plain
                text; once the doc lands in Notion the user can re-open
                and use the full block editor. We surface the
                "Click Edit body" CTA prominently when the body is empty
                so the affordance reads. */}
            <div>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)] mb-2">
                Body
              </p>
              {editBody ? (
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  autoFocus
                  rows={10}
                  placeholder={'Write the body in plain text. Notion-style formatting is added after the doc is created.\n\nKeep it focused — what does someone need to know to follow this process? Examples, links, and step-by-step are all welcome.'}
                  className="w-full rounded-md border border-[var(--color-lib-accent)] bg-white px-3 py-2 text-sm text-[var(--color-lib-text)] outline-none focus:ring-2 focus:ring-[var(--color-lib-accent)]/30 leading-relaxed"
                />
              ) : body.trim() ? (
                <div className="rounded-md border border-[var(--color-lib-border)] bg-white px-4 py-3 text-sm text-[var(--color-lib-text)] whitespace-pre-wrap leading-relaxed">
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditBody(true)}
                  className="w-full rounded-md border border-dashed border-[var(--color-lib-border)] bg-white px-4 py-6 text-sm text-[var(--color-lib-text-subtle)] italic hover:border-[var(--color-lib-accent)] hover:text-[var(--color-lib-accent)] transition-colors text-left"
                >
                  No body content yet. Click <em>Edit body</em> above (or this prompt) to write the doc inline.
                </button>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-[var(--color-lib-text-subtle)]">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

/** Resolve a verifier's display name. Mirrors AddDocModal's helper —
 *  shared util might be a future refactor. */
function useVerifierLabel(
  verifier: VerifierActive | null,
  defaults: VerifierDefault[],
  dept: Department,
): string {
  if (!verifier) return 'the department director'
  const row = defaults.find(d => d.dept === dept)
  if (!row) return 'the department director'
  if (verifier.isDelegate) return 'the delegated reviewer (out of office coverage)'
  if (dept === 'all-in') return 'the VP of Strategy'
  return `the ${labelDept(dept)} Squad director`
}

function labelDept(d: Department): string {
  return { 'all-in': 'All In', social: 'Social', branding: 'Brand', web: 'Web' }[d]
}

