import { useState, useEffect } from 'react'
import { Pencil, Lock, X, Check, ExternalLink } from 'lucide-react'

interface Props {
  label: string
  value: string | null | undefined
  locked?: boolean
  type?: 'text' | 'url' | 'email' | 'date' | 'textarea'
  onSave: (value: string) => Promise<void>
  /** When true, field starts in edit mode (controlled by parent edit toggle) */
  forceEdit?: boolean
}

export default function EditableField({ label, value, locked, type = 'text', onSave, forceEdit }: Props) {
  const [editing, setEditing] = useState(false)

  // Sync editing state when parent toggles forceEdit
  useEffect(() => {
    if (locked) return
    if (forceEdit !== undefined) setEditing(forceEdit)
  }, [forceEdit, locked])
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(value ?? '')
    setEditing(false)
    setError(null)
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-0.5">
        <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide">{label}</p>
        {locked && <Lock size={10} className="text-purple-gray/40" />}
      </div>

      {locked || !editing ? (
        <div className="flex items-center gap-2 group">
          {type === 'url' && value ? (
            <a
              href={normalizeHref(value)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1 hover:bg-lavender-tint transition-colors"
              title={value}
            >
              <ExternalLink size={10} className="shrink-0" />
              {label}
            </a>
          ) : (
            <p className="text-sm text-deep-plum">{value || <span className="text-purple-gray/40 italic">Not set</span>}</p>
          )}
          {!locked && (
            <button
              type="button"
              onClick={() => { setDraft(value ?? ''); setEditing(true) }}
              className="opacity-0 group-hover:opacity-100 text-purple-gray hover:text-primary-purple transition-all"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          {type === 'textarea' ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={3}
              className="flex-1 rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y"
            />
          ) : (
            <input
              type={type}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-50"
          >
            {saving ? (
              <span className="h-3 w-3 rounded-full border border-white/30 border-t-white animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center rounded-full border border-lavender text-purple-gray text-xs px-2.5 py-1.5 hover:bg-lavender-tint transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

// Browsers treat `href="example.com"` as a relative path and resolve
// it under the current origin (→ 404). Force absolute when needed.
function normalizeHref(raw: string): string {
  const v = raw.trim()
  if (!v) return v
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('mailto:') || v.startsWith('tel:')) return v
  return `https://${v.replace(/^\/+/, '')}`
}
