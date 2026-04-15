import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronRight, Plus, Check, AlertCircle, X, Info,
  ArrowUp, ArrowDown, Settings,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { StrategyMilestoneDefinition, StrategyMessageTemplate } from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS } from '../components/submit/types'

// ── Constants ────────────────────────────────────────────────────────────────

const MERGE_FIELDS = [
  { field: '{{church_name}}', description: 'Partner church name' },
  { field: '{{first_name_of_primary}}', description: 'Primary contact first name' },
  { field: '{{step_name}}', description: 'Current milestone step name' },
  { field: '{{section_group}}', description: 'Milestone section group (e.g. review label)' },
  { field: '{{submitter_name}}', description: 'Staff member submitting the update' },
  { field: '{{account_manager}}', description: 'Account manager name (css_rep)' },
  { field: '{{partner_contact_name}}', description: '@mentioned contact — resolved in Step 4' },
  { field: '{{asset_links}}', description: 'Auto-generated asset links — resolved in Step 6' },
  { field: '{{next_step_name}}', description: 'Name of the next upcoming milestone' },
]

const SQUAD_ORDER = ['brand', 'web', 'social']

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-2.5 ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors focus:outline-none ${
          checked ? 'bg-primary-purple' : 'bg-lavender'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="text-sm text-deep-plum">{label}</span>
    </label>
  )
}

// ── MilestoneSettingsCard ────────────────────────────────────────────────────

function MilestoneSettingsCard({
  milestone,
  isAdmin,
  onSaved,
}: {
  milestone: StrategyMilestoneDefinition
  isAdmin: boolean
  onSaved: (updated: StrategyMilestoneDefinition) => void
}) {
  const [stepName, setStepName] = useState(milestone.step_name)
  const [sectionGroup, setSectionGroup] = useState(milestone.section_group ?? '')
  const [description, setDescription] = useState((milestone.description as string | null) ?? '')
  const [isPartnerFacing, setIsPartnerFacing] = useState(milestone.is_partner_facing)
  const [isActive, setIsActive] = useState(milestone.is_active)

  const [saved, setSaved] = useState({
    stepName: milestone.step_name,
    sectionGroup: milestone.section_group ?? '',
    description: (milestone.description as string | null) ?? '',
    isPartnerFacing: milestone.is_partner_facing,
    isActive: milestone.is_active,
  })

  // Sync fields when the selected milestone changes
  useEffect(() => {
    setStepName(milestone.step_name)
    setSectionGroup(milestone.section_group ?? '')
    setDescription((milestone.description as string | null) ?? '')
    setIsPartnerFacing(milestone.is_partner_facing)
    setIsActive(milestone.is_active)
    setSaved({
      stepName: milestone.step_name,
      sectionGroup: milestone.section_group ?? '',
      description: (milestone.description as string | null) ?? '',
      isPartnerFacing: milestone.is_partner_facing,
      isActive: milestone.is_active,
    })
  }, [milestone.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    stepName !== saved.stepName ||
    sectionGroup !== saved.sectionGroup ||
    description !== saved.description ||
    isPartnerFacing !== saved.isPartnerFacing ||
    isActive !== saved.isActive

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!stepName.trim()) { setError('Step name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const updates = {
        step_name: stepName.trim(),
        section_group: sectionGroup.trim() || null,
        description: description.trim() || null,
        is_partner_facing: isPartnerFacing,
        is_active: isActive,
      }
      const { data, error: saveError } = await supabase
        .from('strategy_milestone_definitions')
        .update(updates as Record<string, unknown>)
        .eq('id', milestone.id)
        .select()
        .maybeSingle()

      if (saveError) throw saveError
      if (!data) throw new Error('Update returned no rows — you may not have permission to edit this record.')

      const updated = data as StrategyMilestoneDefinition
      setSaved({
        stepName: updated.step_name,
        sectionGroup: updated.section_group ?? '',
        description: (updated.description as string | null) ?? '',
        isPartnerFacing: updated.is_partner_facing,
        isActive: updated.is_active,
      })
      setSaveStatus('saved')
      onSaved(updated)
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Save failed')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-lavender rounded-xl overflow-hidden shadow-sm mb-5">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-lavender-tint border-b border-lavender flex-wrap">
        <div className="flex items-center gap-2">
          <Settings size={13} className="text-primary-purple" />
          <span className="text-xs font-bold text-deep-plum uppercase tracking-wider">Milestone Settings</span>
          {!milestone.is_active && (
            <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
              Inactive
            </span>
          )}
          {milestone.is_active && !milestone.is_partner_facing && (
            <span className="rounded-full bg-lavender text-purple-gray text-[10px] font-medium px-2 py-0.5">
              Internal only
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              saveStatus === 'saved'
                ? 'bg-green-100 text-green-700'
                : saveStatus === 'error'
                ? 'bg-red-100 text-red-700'
                : isDirty
                ? 'bg-deep-plum text-white hover:bg-primary-purple'
                : 'bg-lavender/60 text-purple-gray cursor-not-allowed'
            }`}
          >
            {saving ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : saveStatus === 'saved' ? (
              <Check size={12} />
            ) : saveStatus === 'error' ? (
              <AlertCircle size={12} />
            ) : null}
            {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save Milestone'}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Step Name
            </label>
            <input
              value={stepName}
              onChange={e => setStepName(e.target.value)}
              disabled={!isAdmin}
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60 disabled:bg-lavender-tint/50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Section Group <span className="font-normal">(optional)</span>
            </label>
            <input
              value={sectionGroup}
              onChange={e => setSectionGroup(e.target.value)}
              disabled={!isAdmin}
              placeholder="e.g. Phase 1, Review"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60 disabled:bg-lavender-tint/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
            Description <span className="font-normal">(optional — internal notes)</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={!isAdmin}
            rows={3}
            placeholder="What happens at this step? Any notes for staff…"
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y disabled:opacity-60 disabled:bg-lavender-tint/50"
          />
        </div>

        <div className="flex flex-wrap gap-6 pt-1">
          <Toggle
            label="Partner Facing"
            checked={isPartnerFacing}
            onChange={setIsPartnerFacing}
            disabled={!isAdmin}
          />
          <Toggle
            label="Active"
            checked={isActive}
            onChange={setIsActive}
            disabled={!isAdmin}
          />
        </div>
        {isAdmin && (
          <p className="text-xs text-purple-gray/60">
            <strong>Partner Facing</strong> — shows on the client progress portal.{' '}
            <strong>Active</strong> — appears in the milestone submission form. Deactivating keeps historical submissions intact.
          </p>
        )}
      </div>
    </div>
  )
}

// ── TemplateCard ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: StrategyMessageTemplate
  submitterName: string
  isAdmin: boolean
  onSaved: (updated: StrategyMessageTemplate) => void
}

function TemplateCard({ template, submitterName, isAdmin, onSaved }: TemplateCardProps) {
  const [variant, setVariant] = useState(template.template_variant)
  const [subject, setSubject] = useState(template.subject_line ?? '')
  const [body, setBody] = useState(template.template_body)
  const [isActive, setIsActive] = useState(template.is_active)

  const [saved, setSaved] = useState({
    variant: template.template_variant,
    subject: template.subject_line ?? '',
    body: template.template_body,
    isActive: template.is_active,
  })

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const isDirty =
    variant !== saved.variant ||
    subject !== saved.subject ||
    body !== saved.body ||
    isActive !== saved.isActive

  const handleSave = async () => {
    if (!variant.trim()) { setError('Variant key cannot be empty'); return }
    setSaving(true)
    setError(null)
    try {
      const updates = {
        template_variant: variant.trim(),
        subject_line: subject.trim() || null,
        template_body: body,
        is_active: isActive,
        last_edited_by: submitterName || null,
      }
      const { data, error: saveError } = await supabase
        .from('strategy_message_templates')
        .update(updates)
        .eq('id', template.id)
        .select()
        .maybeSingle()

      if (saveError) throw saveError
      if (!data) throw new Error('Update returned no rows — you may not have permission to edit this record.')

      const updated = data as StrategyMessageTemplate
      setSaved({
        variant: updated.template_variant,
        subject: updated.subject_line ?? '',
        body: updated.template_body,
        isActive: updated.is_active,
      })
      setSaveStatus('saved')
      onSaved(updated)
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? 'Save failed'
      setError(msg)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    } finally {
      setSaving(false)
    }
  }

  const variantDisplay = { default: 'Default', continuation: 'Continuation' }[variant] ?? variant

  return (
    <div className="bg-white border border-lavender rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-lavender-tint border-b border-lavender flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-primary-purple uppercase tracking-wider">
            {variantDisplay}
          </span>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setIsActive(a => !a)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-lavender text-purple-gray hover:bg-lavender/70'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-purple-gray/40'}`} />
              {isActive ? 'Active' : 'Inactive'}
            </button>
          ) : (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isActive ? 'bg-green-100 text-green-700' : 'bg-lavender text-purple-gray'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-purple-gray/40'}`} />
              {isActive ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {template.last_edited_by && (
            <span className="text-xs text-purple-gray hidden sm:block">
              {template.last_edited_by} · {formatDateTime(template.updated_at)}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                saveStatus === 'saved'
                  ? 'bg-green-100 text-green-700'
                  : saveStatus === 'error'
                  ? 'bg-red-100 text-red-700'
                  : isDirty
                  ? 'bg-deep-plum text-white hover:bg-primary-purple'
                  : 'bg-lavender/60 text-purple-gray cursor-not-allowed'
              }`}
            >
              {saving ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : saveStatus === 'saved' ? (
                <Check size={12} />
              ) : saveStatus === 'error' ? (
                <AlertCircle size={12} />
              ) : null}
              {saving ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Variant Key
            </label>
            <input
              value={variant}
              onChange={e => setVariant(e.target.value)}
              disabled={!isAdmin}
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum font-mono focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60 disabled:bg-lavender-tint/50"
            />
            <p className="text-xs text-purple-gray/70 mt-1">Used in code to select this variant</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Subject Line <span className="font-normal">(optional)</span>
            </label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={!isAdmin}
              placeholder="e.g. Your Brand Guide is Ready"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 disabled:opacity-60 disabled:bg-lavender-tint/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
            Message Body
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={!isAdmin}
            rows={12}
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum font-mono focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y leading-relaxed disabled:opacity-60 disabled:bg-lavender-tint/50"
          />
          <p className="text-xs text-purple-gray mt-1 text-right">{body.length} chars</p>
        </div>
      </div>
    </div>
  )
}

// ── NewTemplateForm ───────────────────────────────────────────────────────────

interface NewTemplateFormProps {
  milestoneId: string
  existingVariants: string[]
  submitterName: string
  onCreated: (template: StrategyMessageTemplate) => void
  onCancel: () => void
}

function NewTemplateForm({ milestoneId, existingVariants, submitterName, onCreated, onCancel }: NewTemplateFormProps) {
  const suggestedVariant = existingVariants.includes('default') ? '' : 'default'
  const [variant, setVariant] = useState(suggestedVariant)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!variant.trim()) { setError('Variant key is required'); return }
    if (!body.trim()) { setError('Message body is required'); return }
    if (existingVariants.includes(variant.trim())) {
      setError(`A template with variant "${variant.trim()}" already exists for this milestone`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const { data, error: insertError } = await supabase
        .from('strategy_message_templates')
        .insert({
          milestone_id: milestoneId,
          template_variant: variant.trim(),
          subject_line: subject.trim() || null,
          template_body: body.trim(),
          is_active: true,
          last_edited_by: submitterName || null,
        })
        .select()
        .single()

      if (insertError || !data) throw insertError ?? new Error('Insert returned no data')
      onCreated(data as StrategyMessageTemplate)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to create template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-2 border-dashed border-primary-purple/40 rounded-xl p-4 bg-lavender-tint/30">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-deep-plum">New Template</h3>
        <button type="button" onClick={onCancel} className="text-purple-gray hover:text-deep-plum transition-colors">
          <X size={16} />
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Variant Key *
            </label>
            <input
              value={variant}
              onChange={e => setVariant(e.target.value)}
              placeholder="default, continuation, vip…"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum font-mono focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
            {existingVariants.length > 0 && (
              <p className="text-xs text-purple-gray/70 mt-1">
                Existing: {existingVariants.map(v => `"${v}"`).join(', ')}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
              Subject Line <span className="font-normal">(optional)</span>
            </label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Your Brand Guide is Ready"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
            Message Body *
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={8}
            placeholder={`Write your template here.\n\nUse merge fields like {{church_name}}, {{step_name}}, etc.\n\nDon't forget the standard footer.`}
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum font-mono focus:outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2 hover:bg-primary-purple transition-colors disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create Template'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-lavender text-deep-plum text-sm px-4 py-2 hover:bg-lavender-tint transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MergeFieldsPanel ─────────────────────────────────────────────────────────

function MergeFieldsPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white border border-lavender rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-lavender-tint transition-colors"
      >
        <div className="flex items-center gap-2">
          <Info size={14} className="text-primary-purple" />
          <span className="text-sm font-semibold text-deep-plum">Merge Field Reference</span>
        </div>
        {open ? <ChevronDown size={14} className="text-purple-gray" /> : <ChevronRight size={14} className="text-purple-gray" />}
      </button>

      {open && (
        <div className="border-t border-lavender px-4 py-4 space-y-2.5">
          {MERGE_FIELDS.map(({ field, description }) => (
            <div key={field} className="flex items-start gap-3">
              <code className="shrink-0 text-xs bg-lavender-tint text-primary-purple px-1.5 py-0.5 rounded font-mono leading-relaxed">
                {field}
              </code>
              <span className="text-xs text-purple-gray leading-relaxed">{description}</span>
            </div>
          ))}
          <div className="pt-3 mt-1 border-t border-lavender">
            <p className="text-xs font-semibold text-purple-gray mb-1.5">Standard Footer (include in all templates)</p>
            <p className="text-xs text-purple-gray/80 font-mono leading-relaxed bg-lavender-tint/50 rounded-lg px-3 py-2">
              {'If you have questions or additional feedback, feel free to tag {{submitter_name}} or your account manager {{account_manager}}.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AddPathwayForm ────────────────────────────────────────────────────────────

function AddPathwayForm({
  squad,
  existingPathways,
  onCreated,
  onCancel,
}: {
  squad: string
  existingPathways: string[]
  onCreated: (milestone: StrategyMilestoneDefinition) => void
  onCancel: () => void
}) {
  const [pathwayKey, setPathwayKey] = useState('')
  const [firstStepName, setFirstStepName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    const key = pathwayKey.trim().toLowerCase().replace(/\s+/g, '_')
    if (!key) { setError('Pathway key is required'); return }
    if (!firstStepName.trim()) { setError('First step name is required'); return }
    if (existingPathways.includes(key)) { setError(`Pathway "${key}" already exists in this squad`); return }

    setSaving(true)
    setError(null)
    try {
      const { data, error: insertError } = await supabase
        .from('strategy_milestone_definitions')
        .insert({
          squad,
          pathway: key,
          step_number: 1,
          step_name: firstStepName.trim(),
          section_group: null,
          description: null,
          is_partner_facing: false,
          is_active: false,
        } as Record<string, unknown>)
        .select()
        .single()

      if (insertError || !data) throw insertError ?? new Error('Insert returned no data')
      onCreated(data as StrategyMilestoneDefinition)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to create pathway')
      setSaving(false)
    }
  }

  return (
    <div className="mx-2 mb-2 border border-dashed border-primary-purple/40 rounded-lg p-3 bg-lavender-tint/30">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold text-deep-plum">New Pathway</p>
        <button type="button" onClick={onCancel} className="text-purple-gray hover:text-deep-plum">
          <X size={13} />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      <div className="space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
            Pathway Key
          </label>
          <input
            value={pathwayKey}
            onChange={e => setPathwayKey(e.target.value)}
            placeholder="e.g. refresh, audit_plus"
            className="w-full rounded border border-lavender px-2 py-1.5 text-xs text-deep-plum font-mono focus:outline-none focus:border-primary-purple"
          />
          <p className="text-[10px] text-purple-gray/60 mt-0.5">Spaces → underscores, lowercase</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">
            First Step Name
          </label>
          <input
            value={firstStepName}
            onChange={e => setFirstStepName(e.target.value)}
            placeholder="e.g. Onboarding"
            className="w-full rounded border border-lavender px-2 py-1.5 text-xs text-deep-plum focus:outline-none focus:border-primary-purple"
          />
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-lavender text-deep-plum text-xs px-3 py-1.5 hover:bg-lavender-tint transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TemplateEditorPage() {
  const { staffProfile, isAdmin } = useAuth()
  const [milestones, setMilestones] = useState<StrategyMilestoneDefinition[]>([])
  const [templateCounts, setTemplateCounts] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<StrategyMessageTemplate[]>([])
  const [loadingMilestones, setLoadingMilestones] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [expandedSquads, setExpandedSquads] = useState<Record<string, boolean>>({})
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [addingPathwayForSquad, setAddingPathwayForSquad] = useState<string | null>(null)

  const submitterName = staffProfile?.full_name ?? staffProfile?.name ?? ''

  // ── Load all milestones (no is_active filter — editor shows everything) ───
  useEffect(() => {
    const load = async () => {
      const [{ data: mData }, { data: tData }] = await Promise.all([
        supabase
          .from('strategy_milestone_definitions')
          .select('*')
          .order('squad')
          .order('pathway')
          .order('step_number'),
        supabase
          .from('strategy_message_templates')
          .select('milestone_id'),
      ])

      if (mData) {
        setMilestones(mData as StrategyMilestoneDefinition[])
        const squads = [...new Set((mData as StrategyMilestoneDefinition[]).map(m => m.squad))]
        setExpandedSquads(Object.fromEntries(squads.map(s => [s, true])))
      }
      if (tData) {
        const counts: Record<string, number> = {}
        for (const row of tData as { milestone_id: string }[]) {
          counts[row.milestone_id] = (counts[row.milestone_id] ?? 0) + 1
        }
        setTemplateCounts(counts)
      }
      setLoadingMilestones(false)
    }
    load()
  }, [])

  // ── Load templates when a milestone is selected ───────────────────────────
  useEffect(() => {
    if (!selectedId) return
    setLoadingTemplates(true)
    setShowNewForm(false)
    supabase
      .from('strategy_message_templates')
      .select('*')
      .eq('milestone_id', selectedId)
      .order('created_at')
      .then(({ data }) => {
        setTemplates((data ?? []) as StrategyMessageTemplate[])
        setLoadingTemplates(false)
      })
  }, [selectedId])

  const selectedMilestone = milestones.find(m => m.id === selectedId)

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleTemplateUpdated = (updated: StrategyMessageTemplate) => {
    setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const handleTemplateCreated = (created: StrategyMessageTemplate) => {
    setTemplates(prev => [...prev, created])
    setTemplateCounts(prev => ({
      ...prev,
      [created.milestone_id]: (prev[created.milestone_id] ?? 0) + 1,
    }))
    setShowNewForm(false)
  }

  const handleMilestoneSelect = (id: string) => {
    setSelectedId(id)
    setMobileSidebarOpen(false)
  }

  const handleMilestoneSaved = (updated: StrategyMilestoneDefinition) => {
    // Merge only the fields the settings card owns — DO NOT overwrite step_number,
    // which may have been changed by a concurrent reorder optimistic update.
    setMilestones(prev => prev.map(m =>
      m.id === updated.id
        ? {
            ...m,
            step_name: updated.step_name,
            section_group: updated.section_group,
            description: updated.description,
            is_partner_facing: updated.is_partner_facing,
            is_active: updated.is_active,
            updated_at: updated.updated_at,
          }
        : m
    ))
  }

  // Create a new milestone at the end of the given pathway
  const handleAddMilestone = async (squad: string, pathway: string) => {
    const pathwayMs = milestones.filter(m => m.squad === squad && m.pathway === pathway)
    const nextStep = pathwayMs.length > 0
      ? Math.max(...pathwayMs.map(m => m.step_number)) + 1
      : 1

    const { data, error } = await supabase
      .from('strategy_milestone_definitions')
      .insert({
        squad,
        pathway,
        step_number: nextStep,
        step_name: 'New Milestone',
        section_group: null,
        description: null,
        is_partner_facing: false,
        is_active: false,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error || !data) {
      console.error('[AddMilestone]', error?.message)
      return
    }

    const created = data as StrategyMilestoneDefinition
    setMilestones(prev =>
      [...prev, created].sort((a, b) => {
        if (a.squad !== b.squad) return a.squad.localeCompare(b.squad)
        if (a.pathway !== b.pathway) return a.pathway.localeCompare(b.pathway)
        return a.step_number - b.step_number
      })
    )
    setSelectedId(created.id)
    setMobileSidebarOpen(false)
  }

  // Swap step_numbers between a milestone and its neighbor in the same pathway
  const handleReorder = async (milestoneId: string, direction: 'up' | 'down') => {
    const milestone = milestones.find(m => m.id === milestoneId)
    if (!milestone || reordering) return

    const pathwayMs = milestones
      .filter(m => m.squad === milestone.squad && m.pathway === milestone.pathway)
      .sort((a, b) => a.step_number - b.step_number)

    const idx = pathwayMs.findIndex(m => m.id === milestoneId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= pathwayMs.length) return

    const swapTarget = pathwayMs[swapIdx]
    const newStep = swapTarget.step_number
    const oldStep = milestone.step_number

    // Snapshot for rollback on DB failure
    const snapshot = milestones

    // Optimistic update
    setMilestones(prev =>
      prev
        .map(m => {
          if (m.id === milestoneId) return { ...m, step_number: newStep }
          if (m.id === swapTarget.id) return { ...m, step_number: oldStep }
          return m
        })
        .sort((a, b) => {
          if (a.squad !== b.squad) return a.squad.localeCompare(b.squad)
          if (a.pathway !== b.pathway) return a.pathway.localeCompare(b.pathway)
          return a.step_number - b.step_number
        })
    )

    setReordering(true)
    try {
      // Sequential updates via a temporary step_number to avoid unique-constraint
      // conflicts: concurrent Promise.all would have both rows holding the same
      // step_number momentarily, causing Postgres to reject one of the writes.
      // 99999 is safely out of range for any real step_number (1–20 typical).
      const TEMP = 99999
      const r1 = await supabase
        .from('strategy_milestone_definitions')
        .update({ step_number: TEMP } as Record<string, unknown>)
        .eq('id', milestoneId)
      if (r1.error) throw r1.error

      const r2 = await supabase
        .from('strategy_milestone_definitions')
        .update({ step_number: oldStep } as Record<string, unknown>)
        .eq('id', swapTarget.id)
      if (r2.error) throw r2.error

      const r3 = await supabase
        .from('strategy_milestone_definitions')
        .update({ step_number: newStep } as Record<string, unknown>)
        .eq('id', milestoneId)
      if (r3.error) throw r3.error
    } catch (err) {
      // Roll back the optimistic update so the UI stays consistent with DB state
      setMilestones(snapshot)
      console.error('[handleReorder] DB swap failed, reverting:', (err as { message?: string })?.message ?? err)
    } finally {
      setReordering(false)
    }
  }

  // Create a brand-new pathway (and its first milestone) under a squad
  const handlePathwayCreated = (created: StrategyMilestoneDefinition) => {
    setMilestones(prev =>
      [...prev, created].sort((a, b) => {
        if (a.squad !== b.squad) return a.squad.localeCompare(b.squad)
        if (a.pathway !== b.pathway) return a.pathway.localeCompare(b.pathway)
        return a.step_number - b.step_number
      })
    )
    setSelectedId(created.id)
    setAddingPathwayForSquad(null)
    setMobileSidebarOpen(false)
  }

  // ── Group milestones by squad → pathway ───────────────────────────────────
  const grouped = milestones.reduce<Record<string, Record<string, StrategyMilestoneDefinition[]>>>((acc, m) => {
    if (!acc[m.squad]) acc[m.squad] = {}
    if (!acc[m.squad][m.pathway]) acc[m.squad][m.pathway] = []
    acc[m.squad][m.pathway].push(m)
    return acc
  }, {})

  // All squads present (from DB) merged with SQUAD_ORDER for consistent ordering
  const allSquads = [
    ...SQUAD_ORDER.filter(s => grouped[s]),
    ...Object.keys(grouped).filter(s => !SQUAD_ORDER.includes(s)),
  ]

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="flex-none px-4 py-3 border-b border-lavender">
        <p className="text-xs font-bold text-deep-plum uppercase tracking-wide">Milestones</p>
        {!loadingMilestones && (
          <p className="text-xs text-purple-gray mt-0.5">{milestones.length} total</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loadingMilestones ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
          </div>
        ) : (
          allSquads.map(squad => (
            <div key={squad}>
              {/* Squad header */}
              <button
                type="button"
                onClick={() => setExpandedSquads(prev => ({ ...prev, [squad]: !prev[squad] }))}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-lavender-tint transition-colors"
              >
                <span className="text-xs font-bold text-deep-plum uppercase tracking-wide">
                  {SQUAD_LABELS[squad] ?? squad}
                </span>
                {expandedSquads[squad]
                  ? <ChevronDown size={13} className="text-purple-gray" />
                  : <ChevronRight size={13} className="text-purple-gray" />
                }
              </button>

              {expandedSquads[squad] && (
                <>
                  {Object.entries(grouped[squad] ?? {}).map(([pathway, steps]) => {
                    const sortedSteps = [...steps].sort((a, b) => a.step_number - b.step_number)
                    return (
                      <div key={pathway}>
                        <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-purple-gray uppercase tracking-wide">
                          {PATHWAY_LABELS[pathway] ?? pathway}
                        </p>

                        {sortedSteps.map((m, idx) => {
                          const isSelected = m.id === selectedId
                          const count = templateCounts[m.id] ?? 0
                          const isFirst = idx === 0
                          const isLast = idx === sortedSteps.length - 1

                          return (
                            <div key={m.id} className="flex items-center group">
                              <button
                                type="button"
                                onClick={() => handleMilestoneSelect(m.id)}
                                className={`flex-1 flex items-center gap-2 py-1.5 text-left transition-colors border-l-[3px] pl-[13px] pr-2 min-w-0 ${
                                  isSelected
                                    ? 'bg-lavender-tint border-primary-purple'
                                    : 'border-transparent hover:bg-lavender/20'
                                } ${!m.is_active ? 'opacity-50' : ''}`}
                              >
                                <span className={`shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                  isSelected ? 'bg-primary-purple text-white' : 'bg-lavender text-purple-gray'
                                }`}>
                                  {m.step_number}
                                </span>
                                <span className={`flex-1 text-xs truncate ${
                                  isSelected ? 'text-primary-purple font-semibold' : 'text-deep-plum'
                                }`}>
                                  {m.step_name}
                                </span>
                                {!m.is_active && (
                                  <span className="shrink-0 text-[9px] text-amber-600 font-semibold">OFF</span>
                                )}
                                {count > 0 ? (
                                  <span className="shrink-0 text-[10px] text-purple-gray bg-lavender rounded-full px-1.5 py-0.5 font-medium">
                                    {count}
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-[10px] text-purple-gray/40">—</span>
                                )}
                              </button>

                              {/* Reorder arrows — admin only */}
                              {isAdmin && (
                                <div className="shrink-0 flex flex-col pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() => handleReorder(m.id, 'up')}
                                    disabled={isFirst || reordering}
                                    className="p-0.5 text-purple-gray hover:text-primary-purple disabled:opacity-20 disabled:cursor-not-allowed"
                                    title="Move up"
                                  >
                                    <ArrowUp size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReorder(m.id, 'down')}
                                    disabled={isLast || reordering}
                                    className="p-0.5 text-purple-gray hover:text-primary-purple disabled:opacity-20 disabled:cursor-not-allowed"
                                    title="Move down"
                                  >
                                    <ArrowDown size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Add Milestone — admin only */}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleAddMilestone(squad, pathway)}
                            className="flex items-center gap-1.5 w-full px-4 py-1.5 text-[11px] text-purple-gray hover:text-primary-purple hover:bg-lavender-tint transition-colors"
                          >
                            <Plus size={11} />
                            Add Milestone
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Add Pathway — admin only */}
                  {isAdmin && (
                    addingPathwayForSquad === squad ? (
                      <AddPathwayForm
                        squad={squad}
                        existingPathways={Object.keys(grouped[squad] ?? {})}
                        onCreated={handlePathwayCreated}
                        onCancel={() => setAddingPathwayForSquad(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingPathwayForSquad(squad)}
                        className="flex items-center gap-1.5 w-full px-4 py-2 text-[11px] text-purple-gray/60 hover:text-primary-purple hover:bg-lavender-tint transition-colors border-t border-lavender/40 mt-1"
                      >
                        <Plus size={11} />
                        Add Pathway
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-full">
      {/* Page header */}
      <div className="flex-none px-4 md:px-6 py-5 bg-white border-b border-lavender">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-deep-plum">Template Editor</h1>
            <p className="text-sm text-purple-gray mt-0.5">
              Manage milestone definitions and message templates.
              {!isAdmin && <span className="ml-1 text-purple-gray/60">(View only)</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(v => !v)}
            className="md:hidden rounded-full border border-lavender px-3 py-1.5 text-sm text-deep-plum hover:bg-lavender-tint transition-colors"
          >
            {mobileSidebarOpen ? 'Close' : 'Select Milestone'}
          </button>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`flex-none md:w-[260px] bg-white border-lavender md:block md:border-r md:h-full ${
            mobileSidebarOpen ? 'block border-b' : 'hidden'
          }`}
          style={{ maxHeight: mobileSidebarOpen ? '60vh' : undefined }}
        >
          {sidebar}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-cream">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-lavender text-center">
              <p className="text-sm font-medium text-purple-gray">Select a milestone from the sidebar</p>
              <p className="text-xs text-purple-gray/60 mt-1">Settings and templates will appear here</p>
            </div>
          ) : (
            <div className="max-w-3xl">
              {/* Breadcrumb */}
              <p className="text-xs font-bold text-primary-purple uppercase tracking-wider mb-1">
                {SQUAD_LABELS[selectedMilestone?.squad ?? ''] ?? ''} ·{' '}
                {PATHWAY_LABELS[selectedMilestone?.pathway ?? ''] ?? selectedMilestone?.pathway}
              </p>
              <h2 className="text-lg font-semibold text-deep-plum mb-5">
                Step {selectedMilestone?.step_number} — {selectedMilestone?.step_name}
              </h2>

              {/* ── Milestone Settings ── */}
              {selectedMilestone && (
                <MilestoneSettingsCard
                  key={selectedMilestone.id}
                  milestone={selectedMilestone}
                  isAdmin={isAdmin}
                  onSaved={handleMilestoneSaved}
                />
              )}

              {/* ── Templates ── */}
              <div className="mb-2">
                <p className="text-xs font-bold text-purple-gray uppercase tracking-wide mb-4">
                  Message Templates
                  <span className="ml-2 font-normal normal-case">
                    ({templates.length} template{templates.length !== 1 ? 's' : ''})
                  </span>
                </p>
              </div>

              {loadingTemplates ? (
                <div className="flex justify-center py-16">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
                </div>
              ) : (
                <div className="space-y-4">
                  {templates.length === 0 && !showNewForm && (
                    <div className="rounded-xl border-2 border-dashed border-lavender p-8 text-center">
                      <p className="text-sm text-purple-gray">No templates yet for this milestone.</p>
                      {isAdmin && (
                        <p className="text-xs text-purple-gray/60 mt-1">Add one below to get started.</p>
                      )}
                    </div>
                  )}

                  {templates.map(t => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      submitterName={submitterName}
                      isAdmin={isAdmin}
                      onSaved={handleTemplateUpdated}
                    />
                  ))}

                  {isAdmin && (
                    showNewForm ? (
                      <NewTemplateForm
                        milestoneId={selectedId}
                        existingVariants={templates.map(t => t.template_variant)}
                        submitterName={submitterName}
                        onCreated={handleTemplateCreated}
                        onCancel={() => setShowNewForm(false)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowNewForm(true)}
                        className="flex items-center gap-2 rounded-full border border-lavender px-4 py-2 text-sm text-deep-plum hover:bg-lavender-tint transition-colors"
                      >
                        <Plus size={15} />
                        Add Template
                      </button>
                    )
                  )}

                  <div className="pt-2">
                    <MergeFieldsPanel />
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
