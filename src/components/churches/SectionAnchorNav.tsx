import { useState, useEffect } from 'react'
import { Pencil, Check } from 'lucide-react'

interface Props {
  sections: { id: string; label: string }[]
  editing: boolean
  onToggleEdit: () => void
  saving?: boolean
}

export default function SectionAnchorNav({ sections, editing, onToggleEdit, saving }: Props) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    )

    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [sections])

  return (
    <nav className="sticky top-6 bg-white border border-lavender rounded-xl shadow-sm p-3">
      <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest px-2 mb-2">Sections</p>
      <ul className="space-y-0.5 mb-3">
        {sections.map(s => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={e => {
                e.preventDefault()
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={[
                'block px-2 py-1.5 rounded-lg text-xs font-medium transition-colors border-l-2',
                activeId === s.id
                  ? 'border-primary-purple bg-lavender-tint text-primary-purple'
                  : 'border-transparent text-purple-gray hover:text-deep-plum hover:bg-lavender-tint/50',
              ].join(' ')}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>

      {/* Edit / Save toggle */}
      <div className="border-t border-lavender/50 pt-3 px-1">
        <button
          type="button"
          onClick={onToggleEdit}
          disabled={saving}
          className={[
            'w-full flex items-center justify-center gap-1.5 rounded-full text-xs font-semibold py-2 transition-colors',
            editing
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-deep-plum text-white hover:bg-primary-purple',
            saving ? 'opacity-50 cursor-not-allowed' : '',
          ].join(' ')}
        >
          {saving ? (
            <span className="h-3 w-3 rounded-full border border-white/30 border-t-white animate-spin" />
          ) : editing ? (
            <Check size={13} />
          ) : (
            <Pencil size={13} />
          )}
          {editing ? 'Done Editing' : 'Edit Details'}
        </button>
      </div>
    </nav>
  )
}
