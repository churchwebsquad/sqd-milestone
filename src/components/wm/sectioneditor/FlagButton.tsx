/**
 * Inline "flag this field for the partner" button + editor popover.
 *
 * Rendered next to each editable field in the section editor. When
 * no flag is open on the field, clicking opens a small form with a
 * prompt textarea prefilled based on the field's type + label. When
 * a flag is already open, the button state is filled and clicking
 * opens the same form to edit the prompt or dismiss.
 *
 * Coordinates via SectionFlagsContext — renders nothing when there's
 * no provider (partner portal preview, unpersisted sections, etc.).
 */
import { useState } from 'react'
import { Flag, Loader2 } from 'lucide-react'
import { useSectionFlags } from './SectionFlagsContext'
import type { WebSlotDef } from '../../../types/database'

interface Props {
  fieldPath: string
  /** Human-readable label for the field, used to pre-fill the prompt
   *  ("Add your Registration URL"). */
  label:     string
  /** Type hint for prompt pre-fill. When absent, prompt defaults to a
   *  generic "Please provide the value for <label>." */
  fieldType?: WebSlotDef['type']
}

export function FlagButton({ fieldPath, label, fieldType }: Props) {
  const ctx = useSectionFlags()
  const [open,    setOpen]    = useState(false)
  const [prompt,  setPrompt]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  if (!ctx || !ctx.enabled) return null
  const existing = ctx.openFlagFor(fieldPath)

  const openForm = () => {
    setPrompt(existing?.prompt ?? defaultPrompt(fieldType, label))
    setError(null)
    setOpen(true)
  }

  const save = async () => {
    setError(null)
    setSaving(true)
    const res = await ctx.flag(fieldPath, prompt)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setOpen(false)
  }

  const dismiss = async () => {
    if (!existing) return
    if (!window.confirm('Remove this flag? The partner will no longer be asked to supply this value.')) return
    setSaving(true)
    await ctx.dismiss(existing.id)
    setSaving(false)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={openForm}
        title={existing
          ? `Flagged for partner: ${existing.prompt}`
          : 'Flag this field as needing input from the partner.'}
        className={
          'inline-flex items-center gap-1 h-5 px-1 rounded text-[10px] font-semibold transition-colors ' +
          (existing
            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300'
            : 'text-wm-text-subtle hover:text-amber-700 hover:bg-amber-50 border border-transparent hover:border-amber-200')
        }
      >
        <Flag size={10} />
        {existing ? 'Flagged' : 'Flag'}
      </button>
      {open && (
        <div className="col-span-full mt-1.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-amber-800">
            {existing ? 'Edit partner ask' : 'Ask the partner for this'}
          </p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={saving}
            rows={2}
            placeholder={defaultPrompt(fieldType, label)}
            className="w-full text-[12px] text-wm-text bg-white border border-amber-200 rounded px-2 py-1 focus:outline-none focus:border-amber-500 disabled:opacity-50"
          />
          {error && <div className="text-[11px] text-wm-danger">{error}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !prompt.trim()}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
              {existing ? 'Update flag' : 'Send to partner'}
            </button>
            {existing && (
              <button
                type="button"
                onClick={() => void dismiss()}
                disabled={saving}
                className="text-[11px] font-semibold text-wm-text-muted hover:text-wm-danger disabled:opacity-50"
              >
                Remove flag
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="ml-auto text-[11px] text-wm-text-muted hover:text-wm-text disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function defaultPrompt(fieldType: WebSlotDef['type'] | undefined, label: string): string {
  const l = label.trim() || 'this field'
  switch (fieldType) {
    case 'url':      return `Add your ${l} URL.`
    case 'email':    return `Add your ${l} email address.`
    case 'phone':    return `Add your ${l} phone number.`
    case 'datetime': return `Add your ${l} date/time.`
    case 'richtext': return `Add your copy for ${l}.`
    case 'cta':      return `Add the label + URL for ${l}.`
    default:         return `Please provide the value for ${l}.`
  }
}
