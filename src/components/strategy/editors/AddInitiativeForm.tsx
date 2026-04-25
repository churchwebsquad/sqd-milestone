import { useState } from 'react'
import { X } from 'lucide-react'
import { createInitiative } from '../../../lib/strategyNotion'
import type { Department, Initiative, InitiativeCreate, Priority } from '../../../types/strategy'

const DEPTS: Array<{ value: Department; label: string }> = [
  { value: 'all-in',   label: 'All In' },
  { value: 'social',   label: 'Social' },
  { value: 'branding', label: 'Branding' },
  { value: 'web',      label: 'Web' },
]

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

/** Modal for creating a new Initiative. Only the most-asked fields are on
 *  the form — Status defaults to Proposed (Notion's default). The rest are
 *  edited inline on the detail page after creation. */
export function AddInitiativeForm({ onCreated, onCancel }: {
  onCreated: (initiative: Initiative) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [department, setDepartment] = useState<Department | ''>('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSubmitting(true)
    setError(null)
    try {
      const payload: InitiativeCreate = { name: name.trim() }
      if (summary.trim()) payload.summary = summary.trim()
      if (department) payload.department = department
      if (priority) payload.priority = priority
      const initiative = await createInitiative(payload)
      onCreated(initiative)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-deep-plum">New Initiative</h2>
          <button onClick={onCancel} className="text-purple-gray/60 hover:text-deep-plum" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div>
          <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="What is this initiative?"
            autoFocus
            className="mt-1 w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </div>

        <div>
          <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">Summary</label>
          <textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="One or two sentences: what + why"
            rows={3}
            className="mt-1 w-full rounded border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">Department</label>
            <select
              value={department}
              onChange={e => setDepartment(e.target.value as Department | '')}
              className="mt-1 w-full rounded border border-lavender bg-white px-2 py-2 text-sm text-deep-plum"
            >
              <option value="">—</option>
              {DEPTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-purple-gray uppercase tracking-widest">Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as Priority | '')}
              className="mt-1 w-full rounded border border-lavender bg-white px-2 py-2 text-sm text-deep-plum"
            >
              <option value="">—</option>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-4 py-2 hover:bg-lavender-tint"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="rounded-full bg-primary-purple text-white text-xs font-semibold px-4 py-2 hover:bg-deep-plum disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create initiative'}
          </button>
        </div>
      </div>
    </div>
  )
}
