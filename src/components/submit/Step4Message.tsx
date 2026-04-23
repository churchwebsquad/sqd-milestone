import { useState, useEffect, useRef } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Info, ToggleLeft, ToggleRight, Bold, Italic, Code, List, ListOrdered, Minus, Link as LinkIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { resolveMergeFields } from '../../lib/mergeFields'
import { loadAppConfig, DEFAULT_APP_CONFIG } from '../../lib/appConfig'
import { insertMarkdownLink } from '../../lib/markdownInsertLink'
import type { AppConfig } from '../../types/database'
import type { StepProps } from './types'
import type { StrategyMessageTemplate } from '../../types/database'
import StepNav from './StepNav'

// Note: {{first_name_of_primary}} is still a valid merge field (resolved in
// lib/mergeFields.ts) — hidden here because staff found it confusing
// alongside {{partner_contact_name}}. Existing templates continue to work.
const MERGE_FIELDS = [
  { field: '{{church_name}}', note: 'Partner church name' },
  { field: '{{step_name}}', note: 'Current milestone step name' },
  { field: '{{section_group}}', note: 'Milestone section group' },
  { field: '{{submitter_name}}', note: 'Staff member submitting' },
  { field: '{{account_manager}}', note: 'Account manager (css_rep)' },
  { field: '{{partner_contact_name}}', note: '@email tag — set in Step 4' },
  { field: '{{next_step_name}}', note: 'Next upcoming milestone' },
  { field: '{{asset_links}}', note: 'Asset links — resolves in Step 6' },
]


function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}  /* keep textarea focus/selection */
      onClick={onClick}
      title={label}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-purple-gray hover:bg-white hover:text-primary-purple transition-colors"
    >
      {children}
    </button>
  )
}

function AppendToggle({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-lavender-tint/50 transition-colors"
    >
      {enabled
        ? <ToggleRight size={20} className="text-primary-purple shrink-0" />
        : <ToggleLeft size={20} className="text-purple-gray/40 shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-semibold ${enabled ? 'text-deep-plum' : 'text-purple-gray/60'}`}>
          {label}
        </span>
        <span className="text-xs text-purple-gray/60 ml-2" dangerouslySetInnerHTML={{ __html: description }} />
      </div>
      <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
        enabled ? 'bg-primary-purple/10 text-primary-purple' : 'bg-lavender/60 text-purple-gray/60'
      }`}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

/** Warns when critical merge fields are missing from what will be sent.
 *  The footer is included in the scan because the default standard footer
 *  already contains `{{submitter_name}}` — so the warning only fires when
 *  it's genuinely absent from the final message. Non-blocking: staff can
 *  still proceed, but the amber card makes it obvious those pieces of data
 *  won't appear even though they were "set" elsewhere. */
const REQUIRED_FIELDS: Array<{ field: string; label: string; hint: string }> = [
  { field: '{{submitter_name}}',        label: 'Your name',            hint: 'staff name set at login' },
  { field: '{{partner_contact_name}}',  label: 'Partner @mention',     hint: 'contact you select on this step' },
  { field: '{{asset_links}}',           label: 'Asset links',          hint: 'URLs added on the Assets step' },
]

function MissingMergeFieldsWarning({
  messageBody, includeFooter, footerText,
}: {
  messageBody: string
  includeFooter: boolean
  footerText: string
}) {
  const finalMessage = includeFooter ? `${messageBody}\n${footerText}` : messageBody
  const missing = REQUIRED_FIELDS.filter(f => !finalMessage.includes(f.field))
  if (missing.length === 0) return null
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
      <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-900">
          These merge fields aren't in your message — the values won't appear just because you set them elsewhere.
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {missing.map(f => (
            <li key={f.field} className="text-xs text-amber-900">
              <code className="font-mono text-[11px] bg-amber-100 px-1.5 py-0.5 rounded">{f.field}</code>
              <span className="ml-1.5">
                <span className="font-semibold">{f.label}</span>
                <span className="text-amber-900/70"> — {f.hint}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] text-amber-900/80">
          Add the placeholder(s) where you want them to appear, or turn on the Standard Footer if it carries them for you.
        </p>
      </div>
    </div>
  )
}

function MergeFieldsPanel({ footer }: { footer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-lavender overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-lavender-tint transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Info size={13} className="text-primary-purple" />
          <span className="text-xs font-semibold text-deep-plum">Merge field reference</span>
        </div>
        {open
          ? <ChevronDown size={13} className="text-purple-gray" />
          : <ChevronRight size={13} className="text-purple-gray" />
        }
      </button>
      {open && (
        <div className="border-t border-lavender bg-white px-4 py-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {MERGE_FIELDS.map(({ field, note }) => (
              <div key={field} className="flex items-start gap-2">
                <code className="shrink-0 text-[11px] bg-lavender-tint text-primary-purple px-1.5 py-0.5 rounded font-mono leading-relaxed">
                  {field}
                </code>
                <span className="text-xs text-purple-gray leading-relaxed">{note}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-lavender">
            <p className="text-xs font-semibold text-purple-gray mb-1">Standard footer <span className="font-normal text-purple-gray/60">(appended to every message)</span></p>
            <p className="text-[11px] font-mono text-purple-gray/80 bg-lavender-tint/50 rounded px-2.5 py-2 leading-relaxed">
              {footer}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Step4Message({ formData, updateForm, onNext, onBack, allMilestones }: StepProps) {
  const { staffProfile } = useAuth()
  const [templates, setTemplates] = useState<StrategyMessageTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG)
  const configLoadedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Rich-text toolbar helpers ──────────────────────────────────────────────

  /** Wrap the currently selected text in the textarea with before/after markers. */
  const wrapSelection = (before: string, after: string = before, placeholder = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const value = ta.value
    const selected = value.slice(start, end) || placeholder
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    updateForm({ messageBody: next })
    // Restore selection inside the newly wrapped text on next tick
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + before.length
      ta.setSelectionRange(pos, pos + selected.length)
    })
  }

  /** Prepend a marker to the start of each line in the selection (or current line). */
  const prependLines = (marker: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const value = ta.value
    // Expand start to the beginning of its line
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const block = value.slice(lineStart, end || start)
    const lines = block.split('\n')
    const hasSelection = end > start
    const target = hasSelection ? lines : [lines[0] || '']
    const transformed = target.map(l => l.startsWith(marker) ? l : `${marker}${l}`).join('\n')
    const next = value.slice(0, lineStart) + transformed + value.slice(hasSelection ? end : start)
    updateForm({ messageBody: next })
    requestAnimationFrame(() => {
      ta.focus()
      const newEnd = lineStart + transformed.length
      ta.setSelectionRange(newEnd, newEnd)
    })
  }

  /** Insert a block of text at the current caret, surrounded by newlines. */
  const insertBlock = (block: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const value = ta.value
    const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
    const suffix = value[start] !== '\n' ? '\n' : ''
    const insert = prefix + block + suffix
    const next = value.slice(0, start) + insert + value.slice(start)
    updateForm({ messageBody: next })
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + insert.length
      ta.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (configLoadedRef.current) return
    configLoadedRef.current = true
    loadAppConfig().then(setAppConfig)
  }, [])

  const submitterName = staffProfile?.full_name ?? staffProfile?.name ?? ''
  const nextMilestone = allMilestones.find(m => m.id === formData.nextMilestoneId)

  const mergeData = {
    church_name: formData.partner?.church_name,
    first_name_of_primary: formData.partner?.first_name_of_primary,
    step_name: formData.selectedMilestone?.step_name,
    section_group: formData.selectedMilestone?.section_group,
    submitter_name: submitterName,
    account_manager: formData.partner?.css_rep,
    partner_contact_name: formData.partnerContactName || null,
    next_step_name: nextMilestone?.step_name,
  }

  const applyTemplate = (template: StrategyMessageTemplate) => {
    setSelectedTemplateId(template.id)
    const body = resolveMergeFields(template.template_body, mergeData)
    // Templates can set defaults for the footer + recap toggles. Default to
    // true if the field is missing (pre-migration templates).
    updateForm({
      messageBody: body,
      includeFooter: template.include_footer ?? true,
      includeRecap: template.include_recap ?? true,
    })
  }

  const handleFooterToggle = (include: boolean) => {
    updateForm({ includeFooter: include })
  }

  const handleRecapToggle = (include: boolean) => {
    updateForm({ includeRecap: include })
  }

  // Reload templates whenever the selected milestone changes
  useEffect(() => {
    if (!formData.selectedMilestone) return

    setLoading(true)
    setTemplates([])
    setSelectedTemplateId(null)

    supabase
      .from('strategy_message_templates')
      .select('*')
      .eq('milestone_id', formData.selectedMilestone.id)
      .eq('is_active', true)
      .order('created_at')
      .then(({ data, error }) => {
        console.log('[Templates] milestone_id:', formData.selectedMilestone!.id)
        console.log('[Templates] error:', error)
        console.log('[Templates] count:', data?.length ?? 0, '| data:', data)

        const loaded = (data ?? []) as StrategyMessageTemplate[]
        setTemplates(loaded)

        // Auto-apply the best matching template if no message drafted yet
        if (!formData.messageBody) {
          const variant = formData.isContinuation ? 'continuation' : 'default'
          const best =
            loaded.find(t => t.template_variant === variant) ??
            loaded.find(t => t.template_variant === 'default') ??
            loaded[0]
          if (best) applyTemplate(best)
        }

        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.selectedMilestone?.id, formData.isContinuation])

  const variantLabel = (v: string) => {
    if (v === 'default') return 'Default'
    if (v === 'continuation') return 'Continuation'
    return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 5 — Draft Message</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-5">
        Choose a template or edit the message below.{' '}
        <code className="text-xs bg-lavender-tint text-primary-purple px-1 py-0.5 rounded">{'{{asset_links}}'}</code>
        {' '}resolves in the next step.
      </p>

      {loading ? (
        <div className="flex items-center justify-center h-48 rounded-xl bg-lavender-tint mb-5">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
        </div>
      ) : (
        <>
          {/* Template picker */}
          {templates.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs font-semibold text-purple-gray uppercase tracking-wide mb-2">
                Templates for this milestone
              </p>
              <div className="flex flex-wrap gap-2">
                {templates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className={[
                      'rounded-full border text-sm font-medium px-4 py-1.5 transition-colors',
                      selectedTemplateId === t.id
                        ? 'bg-primary-purple border-primary-purple text-white'
                        : 'border-lavender text-deep-plum hover:border-primary-purple hover:text-primary-purple',
                    ].join(' ')}
                  >
                    {variantLabel(t.template_variant)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-800">
                No templates found for this milestone — write the message manually below.
              </p>
            </div>
          )}

          {/* Merge field reference */}
          <div className="mb-4">
            <MergeFieldsPanel footer={appConfig.standard_footer} />
          </div>

          {/* Message editor — toolbar + textarea */}
          <div className="rounded-xl border border-lavender overflow-hidden focus-within:border-primary-purple focus-within:ring-2 focus-within:ring-primary-purple/20 transition-colors">
            {/* Toolbar */}
            <div className="flex items-center gap-0.5 px-2 py-1.5 bg-lavender-tint/40 border-b border-lavender">
              <ToolbarButton label="Bold (**text**)" onClick={() => wrapSelection('**', '**', 'bold')}>
                <Bold size={13} />
              </ToolbarButton>
              <ToolbarButton label="Italic (_text_)" onClick={() => wrapSelection('_', '_', 'italic')}>
                <Italic size={13} />
              </ToolbarButton>
              <ToolbarButton label="Inline code (`text`)" onClick={() => wrapSelection('`', '`', 'code')}>
                <Code size={13} />
              </ToolbarButton>
              <ToolbarButton
                label="Link ([text](url))"
                onClick={() => {
                  const ta = textareaRef.current
                  if (!ta) return
                  insertMarkdownLink(ta, formData.messageBody, next => updateForm({ messageBody: next }))
                }}
              >
                <LinkIcon size={13} />
              </ToolbarButton>
              <div className="w-px h-5 bg-lavender mx-1" />
              <ToolbarButton label="Bulleted list" onClick={() => prependLines('- ')}>
                <List size={13} />
              </ToolbarButton>
              <ToolbarButton label="Numbered list" onClick={() => prependLines('1. ')}>
                <ListOrdered size={13} />
              </ToolbarButton>
              <ToolbarButton label="Divider (---)" onClick={() => insertBlock('---')}>
                <Minus size={13} />
              </ToolbarButton>
            </div>
            <textarea
              ref={textareaRef}
              value={formData.messageBody}
              onChange={e => updateForm({ messageBody: e.target.value })}
              rows={14}
              placeholder="Write the message here, or select a template above…"
              className="w-full px-4 py-3 text-sm text-deep-plum placeholder-purple-gray/50 outline-none resize-y leading-relaxed font-sans border-0"
            />
          </div>
          <p className="text-xs text-purple-gray mt-1 text-right">
            {formData.messageBody.length} characters · Markdown: **bold**, _italic_, `code`, - bullets, 1. numbered, --- divider
          </p>

          {/* Missing-merge-field warning — these get set/resolved in later
               steps, but only if the placeholder is actually in the message
               (or in the footer, for submitter_name). Staff kept assuming
               the values would be auto-inserted. */}
          <MissingMergeFieldsWarning
            messageBody={formData.messageBody}
            includeFooter={formData.includeFooter}
            footerText={appConfig.standard_footer}
          />

          {/* Append toggles */}
          <div className="mt-3 rounded-xl border border-lavender bg-lavender-tint/30 divide-y divide-lavender/60">
            <AppendToggle
              label="Standard Footer"
              description="&ldquo;If you have questions or additional feedback…&rdquo;"
              enabled={formData.includeFooter}
              onToggle={handleFooterToggle}
            />
            <AppendToggle
              label="All-In Updates Recap"
              description="Cross-squad current &amp; next milestone summary"
              enabled={formData.includeRecap}
              onToggle={handleRecapToggle}
            />
          </div>
        </>
      )}

      <StepNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!formData.messageBody.trim() || loading}
      />
    </div>
  )
}
