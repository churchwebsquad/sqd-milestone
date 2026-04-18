import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  title: string
  data: Record<string, unknown> | null
  defaultOpen?: boolean
}

export default function JsonAccordion({ title, data, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  if (!data) {
    return (
      <div className="border border-lavender rounded-xl px-4 py-3">
        <p className="text-sm text-purple-gray/50 italic">{title}: No data available</p>
      </div>
    )
  }

  return (
    <div className="border border-lavender rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-lavender-tint/30 transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-primary-purple shrink-0" /> : <ChevronRight size={14} className="text-purple-gray shrink-0" />}
        <span className="text-sm font-semibold text-deep-plum">{title}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-lavender/50">
          <JsonEntries data={data} depth={0} />
        </div>
      )}
    </div>
  )
}

function JsonEntries({ data, depth }: { data: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '')

  if (entries.length === 0) {
    return <p className="text-xs text-purple-gray/50 italic">Empty</p>
  }

  return (
    <div className={`space-y-2 ${depth > 0 ? 'ml-3 pl-3 border-l border-lavender/40' : ''}`}>
      {entries.map(([key, value]) => (
        <div key={key}>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide">
            {key.replace(/_/g, ' ')}
          </p>
          <JsonValue value={value} depth={depth} />
        </div>
      ))}
    </div>
  )
}

function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined) return null

  if (typeof value === 'boolean') {
    return <p className="text-sm text-deep-plum">{value ? 'Yes' : 'No'}</p>
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return <p className="text-sm text-deep-plum break-words">{String(value)}</p>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-xs text-purple-gray/50 italic">None</p>
    return (
      <ul className="list-disc list-inside text-sm text-deep-plum space-y-0.5">
        {value.map((item, i) => (
          <li key={i}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
        ))}
      </ul>
    )
  }

  if (typeof value === 'object') {
    return <JsonEntries data={value as Record<string, unknown>} depth={depth + 1} />
  }

  return <p className="text-sm text-deep-plum">{String(value)}</p>
}
