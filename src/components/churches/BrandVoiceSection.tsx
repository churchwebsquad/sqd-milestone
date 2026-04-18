import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'

interface Props {
  church: StrategyAccountProgress
  onSave: (field: string, value: unknown) => Promise<void>
  editing?: boolean
}

export default function BrandVoiceSection({ church, onSave, editing }: Props) {
  const raw = church as Record<string, unknown>

  const brandVoice = raw.brand_voice_guidelines as string | null ?? null
  const bibleTranslation = raw.bible_translation as string | null
    ?? raw.preferred_bible_translation as string | null ?? null
  const brandSchedulingNotes = raw.brand_scheduling_notes as string | null ?? null

  const [editingVoice, setEditingVoice] = useState(false)
  const [draft, setDraft] = useState(brandVoice ?? '')
  const [saving, setSaving] = useState(false)

  const isEditing = editingVoice || editing

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave('brand_voice_guidelines', draft)
      setEditingVoice(false)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft(brandVoice ?? '')
    setEditingVoice(false)
  }

  return (
    <section id="brand-voice" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider mb-4">Brand Voice</h2>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide">Brand Voice Guidelines</p>
            {!isEditing && (
              <button
                type="button"
                onClick={() => { setDraft(brandVoice ?? ''); setEditingVoice(true) }}
                className="text-purple-gray hover:text-primary-purple transition-colors"
                title="Edit"
              >
                <Pencil size={12} />
              </button>
            )}
          </div>

          {isEditing ? (
            <div>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={8}
                className="w-full max-h-64 rounded-xl border border-lavender bg-lavender-tint/40 px-4 py-3 text-sm text-deep-plum leading-relaxed outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-full bg-deep-plum text-white text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-50"
                >
                  {saving
                    ? <span className="h-3 w-3 rounded-full border border-white/30 border-t-white animate-spin" />
                    : <Check size={12} />}
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
            </div>
          ) : brandVoice ? (
            <div className="max-h-64 overflow-y-scroll bg-lavender-tint/40 rounded-xl px-4 py-3 border border-lavender/50">
              <p className="text-sm text-deep-plum leading-relaxed whitespace-pre-wrap">{brandVoice}</p>
            </div>
          ) : (
            <p className="text-xs text-purple-gray/50 italic">No brand voice guidelines recorded.</p>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Bible Translation</p>
          <p className="text-sm text-deep-plum">{bibleTranslation ?? <span className="text-purple-gray/50 italic">Not set</span>}</p>
        </div>

        {brandSchedulingNotes && (
          <div>
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-wide mb-1">Brand Scheduling Notes</p>
            <p className="text-sm text-deep-plum leading-relaxed whitespace-pre-wrap">{brandSchedulingNotes}</p>
          </div>
        )}
      </div>
    </section>
  )
}
