/**
 * Per-slot "Suggest copy" action.
 *
 * Clicking the sparkle button POSTs to the `slot-copy-suggest` edge
 * function with the slot's spec, the strategist's current value, and
 * the surrounding sibling slots' values. The function returns three
 * AI-written alternatives constrained to the slot's natural character
 * budget. The popover shows them as click-to-apply rows.
 *
 * Action mode is auto-selected from the current copy's length:
 *   • empty / placeholder → 'generate'
 *   • way over budget     → 'tighten'
 *   • way under budget    → 'loosen'
 *   • otherwise           → 'rewrite'
 *
 * The strategist can override via the action dropdown in the popover.
 */
import { useState, useRef, useEffect } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

type Action = 'generate' | 'tighten' | 'loosen' | 'rewrite'

interface Props {
  /** The slot spec — passed straight to the edge function. */
  slot: {
    layer_name?: string
    type?: string
    max_chars?: number
    scope?: string
    heading_level?: number
  }
  /** Plain-text current value. For richtext, pre-strip tags before
   *  passing in so the AI doesn't try to interpret HTML. */
  current: string
  /** Apply the chosen suggestion to the slot. Caller decides how to
   *  wrap it (e.g. richtext slots should wrap in `<p>`). */
  onApply: (text: string) => void
  /** Best-effort context for prompt grounding. */
  context?: {
    section_layer?: string
    siblings?: Array<{ layer_name?: string; value?: string }>
    brand_voice?: string
    church_name?: string
  }
}

function inferAction(current: string, max?: number): Action {
  const len = current.trim().length
  if (len === 0) return 'generate'
  if (/lorem ipsum|consectetur|adipisicing|adipiscing/i.test(current)) return 'generate'
  if (max && len > max) return 'tighten'
  if (max && len < max * 0.4) return 'loosen'
  return 'rewrite'
}

const ACTION_LABEL: Record<Action, string> = {
  generate: 'Generate',
  tighten:  'Tighten',
  loosen:   'Loosen',
  rewrite:  'Rewrite',
}

export function SuggestCopyButton({ slot, current, onApply, context }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [action, setAction] = useState<Action>(() => inferAction(current, slot.max_chars))
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const run = async (chosen: Action) => {
    setLoading(true)
    setError(null)
    setSuggestions([])
    setAction(chosen)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('slot-copy-suggest', {
        body: { slot, current, action: chosen, context: context ?? {} },
      })
      if (invokeErr) throw invokeErr
      const list = Array.isArray(data?.suggestions) ? data.suggestions : []
      if (list.length === 0) setError('No suggestions came back. Try a different action or refine the brand voice.')
      setSuggestions(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    const inferred = inferAction(current, slot.max_chars)
    setAction(inferred)
    void run(inferred)
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        title="Suggest copy (AI)"
        className={[
          'inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-semibold transition-colors',
          open
            ? 'bg-wm-accent text-white'
            : 'text-wm-accent hover:bg-wm-accent-tint',
        ].join(' ')}
      >
        <Sparkles size={10} />
        Suggest
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-80 rounded-md border border-wm-border bg-wm-bg-elevated shadow-lg p-2">
          {/* Action selector */}
          <div className="flex items-center gap-1 mb-2">
            {(Object.keys(ACTION_LABEL) as Action[]).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => run(a)}
                disabled={loading}
                className={[
                  'flex-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded transition-colors',
                  action === a
                    ? 'bg-wm-accent text-white'
                    : 'bg-wm-bg-hover text-wm-text-muted hover:bg-wm-accent-tint hover:text-wm-accent-strong',
                ].join(' ')}
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
          </div>

          {/* Body */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-wm-text-muted">
              <Loader2 size={12} className="animate-spin" />
              Generating…
            </div>
          ) : error ? (
            <p className="text-[11px] text-wm-danger px-1 py-2">{error}</p>
          ) : suggestions.length === 0 ? (
            <p className="text-[11px] text-wm-text-muted italic px-1 py-2">No suggestions yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {suggestions.map((s, i) => {
                const len = s.length
                const max = slot.max_chars
                const over = max ? len > max : false
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => { onApply(s); setOpen(false) }}
                      className="w-full text-left rounded-md border border-wm-border bg-wm-bg p-2 hover:border-wm-accent hover:bg-wm-accent-tint transition-colors"
                    >
                      <p className="text-[12px] text-wm-text leading-snug">{s}</p>
                      <p className="mt-1 text-[10px] font-mono text-wm-text-subtle flex items-center justify-between">
                        <span>{len}{max ? `/${max}` : ''} chars</span>
                        {over && <span className="text-wm-warning font-semibold">over budget</span>}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
