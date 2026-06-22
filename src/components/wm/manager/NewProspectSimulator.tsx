/**
 * Collapsible simulator on /web — answers "when can this prospect
 * launch?" without creating a project. Sandboxed; nothing is written.
 *
 * Reads the live queue (every active project's hours + priority +
 * page counts) and inserts a hypothetical project at the chosen
 * priority slot, runs computeDevQueue, and surfaces:
 *   - the new project's earliest feasible launch
 *   - per-existing-project cascade impact in days
 *
 * Triggered from a "Simulate a new launch" button at the top of the
 * Web Manager page; collapsed by default so the page stays clean.
 */
import { useMemo, useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react'
import { simulateNewProjectLaunch } from '../../../lib/webNewProjectSimulator'
import type { StrategyWebProject } from '../../../types/database'
import { fromIsoDate, daysBetween } from '../../../lib/dateRange'

interface Props {
  /** Active project rows from /web — used as the existing queue. */
  rows:               StrategyWebProject[]
  /** Team weekly dev capacity. Pulled from settings; default 35. */
  capacityPerWeek?:   number
}

export function NewProspectSimulator({ rows, capacityPerWeek = 35 }: Props) {
  const [open, setOpen] = useState(false)
  const [churchName, setChurchName]           = useState('')
  const [expectedPages, setExpectedPages]     = useState<number>(20)
  const [devHoursPerPage, setDevHoursPerPage] = useState<number>(3.0)
  const [usesNovamira, setUsesNovamira]       = useState(true)
  const [devEditsToDesigner, setDevEditsToDesigner] = useState(false)
  const [assistHoursPerWeek, setAssistHoursPerWeek] = useState<number>(0)
  const [desiredPriority, setDesiredPriority] = useState<number>(
    Math.max(1, ...(rows.map(r => r.priority_order ?? 0))) + 1,
  )
  const [targetDate, setTargetDate] = useState<string>('')

  // Recompute on every change. computeDevQueue is fast for ~30 rows.
  const result = useMemo(() => {
    return simulateNewProjectLaunch({
      expectedPageCount:    expectedPages,
      devHoursPerPage,
      usesNovamira,
      devEditsToDesigner,
      assistHoursPerWeek,
      desiredPriority,
      capacityPerWeek,
      existingProjects:     rows,
      today:                new Date(),
    })
  }, [
    expectedPages, devHoursPerPage, usesNovamira, devEditsToDesigner,
    assistHoursPerWeek, desiredPriority, capacityPerWeek, rows,
  ])

  const targetGapDays = useMemo(() => {
    if (!targetDate || !result.earliestLaunch) return null
    const t = fromIsoDate(targetDate)
    const e = fromIsoDate(result.earliestLaunch)
    if (!t || !e) return null
    return daysBetween(e, t)   // positive = earliest is BEFORE target → fits
  }, [targetDate, result.earliestLaunch])

  return (
    <div className="rounded-2xl border border-lavender bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-lavender-tint/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-primary-purple shrink-0" />
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-deep-plum">
              Simulate a new launch
            </p>
            <p className="text-[11px] text-purple-gray">
              "When could this church launch?" — sandbox, nothing is saved.
            </p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-purple-gray" /> : <ChevronDown size={16} className="text-purple-gray" />}
      </button>

      {open && (
        <div className="border-t border-lavender px-4 py-4 bg-cream/40">
          {/* Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <FieldText label="Church name (optional)" value={churchName} onChange={setChurchName} placeholder="e.g. WoodCreek Church" />
            <FieldNumber label="Expected page count" value={expectedPages} min={1} onChange={(v) => setExpectedPages(v ?? 1)} />
            <FieldNumber label="Dev hours per page" value={devHoursPerPage} min={0} step={0.5} onChange={(v) => setDevHoursPerPage(v ?? 3.0)} />
            <FieldNumber label="Desired priority slot" value={desiredPriority} min={1} onChange={(v) => setDesiredPriority(v ?? 1)} />
            <FieldNumber label="Assist hrs / week" value={assistHoursPerWeek} min={0} onChange={(v) => setAssistHoursPerWeek(v ?? 0)} />
            <FieldDate label="Target launch (optional)" value={targetDate} onChange={setTargetDate} />
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <ToggleInline label="Uses Novamira" checked={usesNovamira} onChange={setUsesNovamira} />
            <ToggleInline label="Dev edits route to designer" checked={devEditsToDesigner} onChange={setDevEditsToDesigner} />
          </div>

          {/* Answer */}
          <div className="mt-4 rounded-xl border border-primary-purple/30 bg-primary-purple/5 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Stat
                label="Dev hours needed"
                value={`${result.hoursNeeded}h`}
                note={result.hoursNote}
              />
              <Stat
                label="Earliest dev start"
                value={result.earliestDevStart ? formatDate(result.earliestDevStart) : '—'}
                note={`Priority slot #${desiredPriority} given the current queue.`}
              />
              <Stat
                label="Earliest launch"
                value={result.earliestLaunch ? formatDate(result.earliestLaunch) : '—'}
                note={targetGapDays == null
                  ? 'Set a target above to compare.'
                  : targetGapDays >= 0
                    ? `${targetGapDays}d cushion vs your target.`
                    : `${Math.abs(targetGapDays)}d past your target — infeasible without intervention.`}
                tone={targetGapDays == null
                  ? 'neutral'
                  : targetGapDays >= 0 ? 'good' : 'bad'}
              />
            </div>
          </div>

          {/* Cascade */}
          {result.cascadeImpact.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-2">
                Impact on existing queue
              </p>
              <ul className="space-y-1.5">
                {result.cascadeImpact.map(r => (
                  <li key={r.projectId} className="flex items-center justify-between gap-2 text-xs text-deep-plum bg-white border border-lavender/60 rounded-md px-3 py-1.5">
                    <span className="font-semibold truncate">{r.projectName}</span>
                    <span className={r.deltaDays > 0 ? 'text-red-600' : 'text-green-600'}>
                      <ArrowDown size={11} className={`inline mr-1 ${r.deltaDays > 0 ? '' : 'rotate-180'}`} />
                      {r.deltaDays > 0 ? '+' : ''}{r.deltaDays}d
                      <span className="text-purple-gray font-normal ml-2">({formatDate(r.beforeDevEnd)} → {formatDate(r.afterDevEnd)})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Weekly hours preview */}
          {Object.keys(result.weeklyHours).length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray mb-2">
                Weekly dev hours this prospect would consume
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.weeklyHours)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([wk, h]) => (
                    <span key={wk} className="text-[11px] font-mono px-2 py-1 rounded bg-white border border-lavender">
                      {formatDate(wk)}: <span className="font-bold text-deep-plum">{h}h</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function FieldText({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none"
      />
    </label>
  )
}

function FieldNumber({
  label, value, min, step = 1, onChange,
}: { label: string; value: number; min?: number; step?: number; onChange: (v: number | null) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={e => {
          const next = e.target.value.trim() === '' ? null : Number(e.target.value)
          onChange(Number.isFinite(next as number) ? next : null)
        }}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white font-mono tabular-nums focus:border-primary-purple focus:outline-none"
      />
    </label>
  )
}

function FieldDate({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full text-[12px] px-2 py-1.5 rounded-md border border-lavender bg-white focus:border-primary-purple focus:outline-none"
      />
    </label>
  )
}

function ToggleInline({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs text-deep-plum">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-lavender text-primary-purple focus:ring-primary-purple"
      />
      {label}
    </label>
  )
}

function Stat({
  label, value, note, tone = 'neutral',
}: { label: string; value: string; note: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const valueClass =
    tone === 'good' ? 'text-green-700' :
    tone === 'bad'  ? 'text-red-700' :
                      'text-deep-plum'
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest font-bold text-purple-gray">{label}</p>
      <p className={`text-xl font-semibold ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-purple-gray mt-0.5 leading-snug">{note}</p>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
