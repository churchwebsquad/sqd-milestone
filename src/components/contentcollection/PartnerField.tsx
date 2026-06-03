/**
 * Partner-facing form primitives — geometry + state model adapted from
 * the Essential Forms & Controls UI Kit, with our brand tokens swapped
 * in (Deep Plum text, Lavender borders, Primary Purple focus, Lavender
 * Tint fills) instead of the kit's neutral grays.
 *
 * Conventions:
 *   • Style 2 layout — label sits ABOVE the field, not inside it.
 *   • 8px border-radius across every control.
 *   • Outline decoration default (white surface, 1px Lavender border).
 *   • States: default · focus (Primary Purple border) · filled · error
 *     (red border + red helper) · disabled. Helper text always lives
 *     in the same slot beneath the field for layout stability.
 *   • Typography: 14px Inter label/helper, 16px input value.
 *
 * One source of truth for the partner-form look-and-feel. The Content
 * Collection page imports these instead of hand-rolling input markup
 * per field — keeps the form reading as one system.
 */
import { type ReactNode, useId } from 'react'
import { AlertCircle } from 'lucide-react'

// ── Field-level frame ────────────────────────────────────────────────

interface FrameProps {
  label?:        string
  helper?:       ReactNode
  required?:     boolean
  optional?:     boolean
  error?:        string | null
  /** Inline content rendered after the label (e.g. a chip / counter). */
  labelAdornment?: ReactNode
  children:      ReactNode
  className?:    string
  htmlFor?:      string
}

/** Outer chrome (label + helper) shared by every PartnerField primitive.
 *  Renders the label-above pattern + a stable helper-text row so fields
 *  don't reflow when validation messages appear. */
function FieldFrame({
  label, helper, required, optional, error, labelAdornment, children, className, htmlFor,
}: FrameProps) {
  return (
    <div className={`flex flex-col gap-1.5 w-full ${className ?? ''}`}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={htmlFor}
            className="text-[14px] font-medium text-deep-plum"
          >
            {label}
            {required && <span className="text-red-600 ml-1">*</span>}
            {optional && (
              <span className="text-purple-gray font-normal ml-1.5 text-[12px]">(optional)</span>
            )}
          </label>
          {labelAdornment && (
            <div className="shrink-0">{labelAdornment}</div>
          )}
        </div>
      )}
      {children}
      {(helper || error) && (
        <p className={`text-[13px] leading-snug ${error ? 'text-red-600 inline-flex items-center gap-1' : 'text-purple-gray'}`}>
          {error && <AlertCircle size={11} className="shrink-0" />}
          {error ?? helper}
        </p>
      )}
    </div>
  )
}

// Shared input chrome — applied to text inputs, textareas, selects.
// Outline decoration: white surface, 1px Lavender border, 8px radius;
// focus pushes the border to Primary Purple + adds a soft ring.
const fieldShellCls = (error: boolean, disabled: boolean) => [
  'w-full rounded-lg border bg-white',
  'text-[16px] text-deep-plum placeholder:text-purple-gray/70',
  'transition-colors',
  error
    ? 'border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-100'
    : 'border-lavender focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/15',
  disabled ? 'opacity-60 cursor-not-allowed bg-lavender-tint/40' : '',
  'outline-none',
].join(' ')

// ── Text input ───────────────────────────────────────────────────────

export interface PartnerTextInputProps {
  label?:       string
  labelAdornment?: ReactNode
  helper?:      ReactNode
  required?:    boolean
  optional?:    boolean
  error?:       string | null
  placeholder?: string
  value:        string | null
  onChange:     (v: string) => void
  onBlur?:      () => void
  disabled?:    boolean
  type?:        'text' | 'email' | 'url' | 'tel'
  /** Visual length variants for layout density. 'compact' = 36px, 'default' = 44px. */
  size?:        'compact' | 'default'
  className?:   string
}

export function PartnerTextInput({
  label, labelAdornment, helper, required, optional, error,
  placeholder, value, onChange, onBlur, disabled,
  type = 'text', size = 'default', className,
}: PartnerTextInputProps) {
  const id = useId()
  const isError = Boolean(error)
  return (
    <FieldFrame
      label={label} labelAdornment={labelAdornment}
      helper={helper} required={required} optional={optional}
      error={error} htmlFor={id} className={className}
    >
      <input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={`${fieldShellCls(isError, Boolean(disabled))} ${size === 'compact' ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}
      />
    </FieldFrame>
  )
}

// ── Textarea ─────────────────────────────────────────────────────────

export interface PartnerTextAreaProps extends Omit<PartnerTextInputProps, 'type' | 'size'> {
  rows?:       number
  /** Pixel min-height — useful for rich-style placeholders (e.g. 150px). */
  minHeight?:  number
}

export function PartnerTextArea({
  label, labelAdornment, helper, required, optional, error,
  placeholder, value, onChange, onBlur, disabled,
  rows = 3, minHeight, className,
}: PartnerTextAreaProps) {
  const id = useId()
  const isError = Boolean(error)
  return (
    <FieldFrame
      label={label} labelAdornment={labelAdornment}
      helper={helper} required={required} optional={optional}
      error={error} htmlFor={id} className={className}
    >
      <textarea
        id={id}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        style={minHeight ? { minHeight } : undefined}
        className={`${fieldShellCls(isError, Boolean(disabled))} px-3.5 py-2.5 resize-y`}
      />
    </FieldFrame>
  )
}

// ── Select ───────────────────────────────────────────────────────────

export interface PartnerSelectProps<T extends string> {
  label?:       string
  helper?:      ReactNode
  required?:    boolean
  optional?:    boolean
  error?:       string | null
  value:        T | null
  onChange:     (v: T) => void
  options:      ReadonlyArray<{ value: T; label: string }>
  placeholder?: string
  disabled?:    boolean
  className?:   string
}

export function PartnerSelect<T extends string>({
  label, helper, required, optional, error,
  value, onChange, options, placeholder, disabled, className,
}: PartnerSelectProps<T>) {
  const id = useId()
  const isError = Boolean(error)
  return (
    <FieldFrame
      label={label} helper={helper} required={required} optional={optional}
      error={error} htmlFor={id} className={className}
    >
      <select
        id={id}
        value={value ?? ''}
        onChange={e => onChange(e.target.value as T)}
        disabled={disabled}
        className={`${fieldShellCls(isError, Boolean(disabled))} px-3 py-2.5 appearance-none bg-no-repeat bg-[right_0.75rem_center] pr-9 bg-[length:14px_14px]`}
        style={{
          backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236B6180' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e")`,
        }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldFrame>
  )
}

// ── Radio group ──────────────────────────────────────────────────────
//
// One <fieldset> wrapping radio options. Each option renders as a
// pill-style card so the selection state reads from across the screen
// — matches the kit's "selected vs unselected" visual contrast.

export interface PartnerRadioOption<T extends string> {
  value:    T
  label:    string
  /** Sub-text shown below the label inside the option card. */
  help?:    string
  /** Content rendered beneath the option when it's selected — e.g.
   *  a follow-up field. Keeps related questions visually grouped. */
  followUp?: ReactNode
  disabled?: boolean
  /** Inline pill next to the label — used by sermon/event tier
   *  questions to signal complexity ("Easiest" / "Recommended" /
   *  "Most Complex") at the same level as the option text. */
  badge?: { label: string; tone: 'green' | 'purple' | 'amber' }
}

export interface PartnerRadioGroupProps<T extends string> {
  label?:     string
  helper?:    ReactNode
  required?:  boolean
  optional?:  boolean
  error?:     string | null
  name:       string
  value:      T | null
  onChange:   (v: T) => void
  options:    ReadonlyArray<PartnerRadioOption<T>>
  className?: string
}

export function PartnerRadioGroup<T extends string>({
  label, helper, required, optional, error,
  name, value, onChange, options, className,
}: PartnerRadioGroupProps<T>) {
  return (
    <FieldFrame
      label={label} helper={helper} required={required} optional={optional}
      error={error} className={className}
    >
      <div role="radiogroup" className="flex flex-col gap-2">
        {options.map(opt => {
          const checked = value === opt.value
          return (
            <div key={opt.value}>
              <label
                className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors ${
                  checked
                    ? 'border-primary-purple bg-lavender-tint/40'
                    : 'border-lavender bg-white hover:border-primary-purple/40 hover:bg-cream/30'
                } ${opt.disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`mt-0.5 shrink-0 grid place-items-center h-5 w-5 rounded-full border-2 transition-colors ${
                    checked ? 'border-primary-purple' : 'border-lavender'
                  }`}
                  aria-hidden
                >
                  {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary-purple" />}
                </span>
                <input
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={checked}
                  onChange={() => onChange(opt.value)}
                  disabled={opt.disabled}
                  className="sr-only"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] text-deep-plum">{opt.label}</p>
                    {opt.badge && (
                      <span className={[
                        'inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 border',
                        opt.badge.tone === 'green'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : opt.badge.tone === 'purple'
                            ? 'bg-primary-purple/10 text-primary-purple border-primary-purple/20'
                            : 'bg-amber-50 text-amber-800 border-amber-200',
                      ].join(' ')}>
                        {opt.badge.label}
                      </span>
                    )}
                  </div>
                  {opt.help && (
                    <p className="text-[12px] text-purple-gray mt-0.5 leading-snug">{opt.help}</p>
                  )}
                </div>
              </label>
              {checked && opt.followUp && (
                <div className="mt-2 ml-8">{opt.followUp}</div>
              )}
            </div>
          )
        })}
      </div>
    </FieldFrame>
  )
}

// ── Checkbox group ───────────────────────────────────────────────────

export interface PartnerCheckboxOption<T extends string> {
  value:    T
  label:    string
  help?:    string
  /** Right-aligned text/chip next to the label (e.g. "Found on site"). */
  meta?:    ReactNode
  /** Rendered beneath the option when checked — e.g. a CSV upload. */
  followUp?: ReactNode
  disabled?: boolean
}

export interface PartnerCheckboxGroupProps<T extends string> {
  label?:     string
  helper?:    ReactNode
  required?:  boolean
  optional?:  boolean
  error?:     string | null
  value:      T[]
  onChange:   (v: T[]) => void
  options:    ReadonlyArray<PartnerCheckboxOption<T>>
  /** Render in a grid (2-col on sm+) instead of a vertical stack. */
  grid?:      boolean
  className?: string
}

export function PartnerCheckboxGroup<T extends string>({
  label, helper, required, optional, error,
  value, onChange, options, grid, className,
}: PartnerCheckboxGroupProps<T>) {
  const set = new Set(value)
  const toggle = (v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(Array.from(next))
  }
  return (
    <FieldFrame
      label={label} helper={helper} required={required} optional={optional}
      error={error} className={className}
    >
      <div className={grid ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
        {options.map(opt => {
          const checked = set.has(opt.value)
          return (
            <div key={opt.value}>
              <label
                className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors ${
                  checked
                    ? 'border-primary-purple bg-lavender-tint/40'
                    : 'border-lavender bg-white hover:border-primary-purple/40 hover:bg-cream/30'
                } ${opt.disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`mt-0.5 shrink-0 grid place-items-center h-5 w-5 rounded-[5px] border-2 transition-colors ${
                    checked ? 'border-primary-purple bg-primary-purple' : 'border-lavender bg-white'
                  }`}
                  aria-hidden
                >
                  {checked && (
                    <svg viewBox="0 0 20 20" className="h-3 w-3 text-white" aria-hidden>
                      <path d="M5 10l3.5 3.5L15 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  disabled={opt.disabled}
                  className="sr-only"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-deep-plum">{opt.label}</p>
                  {opt.help && (
                    <p className="text-[12px] text-purple-gray mt-0.5 leading-snug">{opt.help}</p>
                  )}
                </div>
                {opt.meta && <div className="shrink-0">{opt.meta}</div>}
              </label>
              {checked && opt.followUp && (
                <div className="mt-2 ml-8">{opt.followUp}</div>
              )}
            </div>
          )
        })}
      </div>
    </FieldFrame>
  )
}

// ── Yes / No toggle ──────────────────────────────────────────────────

export interface PartnerYesNoProps {
  label?:     string
  helper?:    ReactNode
  required?:  boolean
  error?:     string | null
  value:      boolean | null
  onChange:   (v: boolean) => void
  className?: string
}

export function PartnerYesNo({
  label, helper, required, error, value, onChange, className,
}: PartnerYesNoProps) {
  return (
    <FieldFrame
      label={label} helper={helper} required={required}
      error={error} className={className}
    >
      <div className="flex gap-2">
        {[
          { v: true,  label: 'Yes' },
          { v: false, label: 'No'  },
        ].map(opt => {
          const checked = value === opt.v
          return (
            <button
              key={opt.label}
              type="button"
              role="switch"
              aria-checked={checked}
              onClick={() => onChange(opt.v)}
              className={`rounded-lg border px-4 py-2 text-[14px] font-semibold transition-colors ${
                checked
                  ? 'border-primary-purple bg-primary-purple text-white'
                  : 'border-lavender bg-white text-deep-plum hover:border-primary-purple/40 hover:bg-lavender-tint/30'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </FieldFrame>
  )
}

// ── Rich-text wrapper ────────────────────────────────────────────────
//
// Wraps a TipTap editor (or any rich editor children) in the same
// outline shell as the text inputs so the form reads cohesively.

export function PartnerRichTextField({
  label, labelAdornment, helper, required, optional, error, children, minHeight = 120, className,
}: {
  label?:     string
  labelAdornment?: ReactNode
  helper?:    ReactNode
  required?:  boolean
  optional?:  boolean
  error?:     string | null
  children:   ReactNode
  /** Pixel min-height on the editable area (.ProseMirror). */
  minHeight?: number
  className?: string
}) {
  const isError = Boolean(error)
  return (
    <FieldFrame
      label={label} labelAdornment={labelAdornment}
      helper={helper} required={required} optional={optional}
      error={error} className={className}
    >
      <div
        className={`rounded-lg border bg-white overflow-hidden focus-within:ring-2 transition-colors ${
          isError
            ? 'border-red-500 focus-within:border-red-500 focus-within:ring-red-100'
            : 'border-lavender focus-within:border-primary-purple focus-within:ring-primary-purple/15'
        }`}
        style={{ ['--partner-rte-min-h' as string]: `${minHeight}px` }}
      >
        <div className="[&_.ProseMirror]:min-h-[var(--partner-rte-min-h)] [&_.ProseMirror]:px-3.5 [&_.ProseMirror]:py-2.5 [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:text-deep-plum">
          {children}
        </div>
      </div>
    </FieldFrame>
  )
}
