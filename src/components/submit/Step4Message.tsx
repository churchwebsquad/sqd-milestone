import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { resolveMergeFields, STANDARD_FOOTER } from '../../lib/mergeFields'
import type { StepProps } from './types'
import type { StrategyMessageTemplate } from '../../types/database'
import StepNav from './StepNav'

const MERGE_FIELDS = [
  { field: '{{church_name}}', note: 'Partner church name' },
  { field: '{{first_name_of_primary}}', note: 'Primary contact first name' },
  { field: '{{step_name}}', note: 'Current milestone step name' },
  { field: '{{section_group}}', note: 'Milestone section group' },
  { field: '{{submitter_name}}', note: 'Staff member submitting' },
  { field: '{{account_manager}}', note: 'Account manager (css_rep)' },
  { field: '{{partner_contact_name}}', note: '@email tag — set in Step 4' },
  { field: '{{next_step_name}}', note: 'Next upcoming milestone' },
  { field: '{{asset_links}}', note: 'Asset links — resolves in Step 6' },
]

// ── HighlightedTextarea ───────────────────────────────────────────────────────
// Renders {{token}} patterns in a distinct visual style while keeping the
// underlying textarea fully editable. Technique: an absolute-positioned mirror
// div renders colored spans for tokens; the textarea sits on top with
// transparent text so the mirror shows through, leaving only the caret visible.

const TOKEN_RE = /(\{\{[^}]+\}\})/g

function buildHighlightedHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const highlighted = escaped.replace(
    // Re-escape any HTML entities in the match then wrap in styled span
    /(\{\{[^}]+\}\})/g,
    '<span style="background:#EDE9FC;color:#513DE5;border-radius:4px;padding:0 3px;font-weight:600;">$1</span>'
  )

  // Preserve newlines for the div, add trailing space to stop the last line collapsing
  return highlighted.replace(/\n/g, '<br>') + '&nbsp;'
}

function HighlightedTextarea({
  value,
  onChange,
  placeholder,
  rows = 14,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  const syncScroll = () => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  // Shared visual style applied to both layers
  const sharedStyle: React.CSSProperties = {
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    fontSize: '0.875rem',   // text-sm
    lineHeight: '1.625',    // leading-relaxed
    padding: '0.75rem 1rem', // px-4 py-3
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  }

  return (
    <div className="relative rounded-xl border border-lavender focus-within:border-primary-purple focus-within:ring-2 focus-within:ring-primary-purple/20 transition bg-white overflow-hidden">
      {/* Mirror layer — renders the colored token spans */}
      <div
        ref={mirrorRef}
        aria-hidden
        className="absolute inset-0 pointer-events-none select-none overflow-hidden text-deep-plum"
        style={sharedStyle}
        dangerouslySetInnerHTML={{ __html: buildHighlightedHtml(value) }}
      />

      {/* Editable textarea — transparent text reveals mirror; caret stays visible */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        placeholder={placeholder}
        rows={rows}
        style={{
          ...sharedStyle,
          color: 'transparent',
          caretColor: '#341756', // deep-plum
          background: 'transparent',
          resize: 'vertical',
          position: 'relative',
          display: 'block',
        }}
        className="w-full outline-none placeholder-purple-gray/50"
      />
    </div>
  )
}

// Keep TOKEN_RE available for potential future use (declared but linter-safe)
void TOKEN_RE

function MergeFieldsPanel() {
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
            <p className="text-xs font-semibold text-purple-gray mb-1">Standard footer</p>
            <p className="text-[11px] font-mono text-purple-gray/80 bg-lavender-tint/50 rounded px-2.5 py-2 leading-relaxed">
              {'If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}.'}
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
    let body = resolveMergeFields(template.template_body, mergeData)
    const footer = resolveMergeFields(STANDARD_FOOTER, mergeData)
    if (!body.toLowerCase().includes('feel free to tag')) {
      body = `${body}\n\n${footer}`
    }
    updateForm({ messageBody: body })
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
            <MergeFieldsPanel />
          </div>

          {/* Message textarea */}
          <div className="relative">
            <textarea
              value={formData.messageBody}
              onChange={e => updateForm({ messageBody: e.target.value })}
              rows={14}
              placeholder="Write the message here, or select a template above…"
              className="w-full rounded-xl border border-lavender px-4 py-3 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y leading-relaxed font-sans"
            />
            <p className="text-xs text-purple-gray mt-1 text-right">
              {formData.messageBody.length} characters
            </p>
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
