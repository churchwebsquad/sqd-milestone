import { Plus, Trash2 } from 'lucide-react'
import type { StepProps, AssetRow } from './types'
import { ASSET_TYPES, ASSET_TYPE_LABELS } from './types'
import type { AssetType } from '../../types/database'
import StepNav from './StepNav'

function isValidUrl(url: string): boolean {
  if (!url) return true // empty is valid (optional field)
  try {
    const p = new URL(url)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

function newRow(): AssetRow {
  return { id: crypto.randomUUID(), type: 'loom_video', url: '', label: '' }
}

export default function Step5Assets({ formData, updateForm, onNext, onBack }: StepProps) {
  const assets = formData.assets

  const addRow = () => updateForm({ assets: [...assets, newRow()] })

  const removeRow = (id: string) => updateForm({ assets: assets.filter(a => a.id !== id) })

  const updateRow = (id: string, patch: Partial<AssetRow>) => {
    updateForm({ assets: assets.map(a => (a.id === id ? { ...a, ...patch } : a)) })
  }

  const allUrlsValid = assets.every(a => !a.url || isValidUrl(a.url))
  const hasFilledRows = assets.some(a => a.url.trim())

  return (
    <div className="bg-white border border-lavender rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-deep-plum">Step 6 — Attach Assets</h2>
      <p className="text-sm text-purple-gray mt-0.5 mb-5">
        Add any links to deliverables, videos, or files for this milestone. All URLs must be publicly accessible.
      </p>

      {assets.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-lavender p-8 text-center mb-4">
          <p className="text-sm text-purple-gray mb-3">No assets attached yet.</p>
          <button
            type="button"
            onClick={addRow}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2 hover:bg-primary-purple transition-colors inline-flex items-center gap-2"
          >
            <Plus size={15} /> Add Asset
          </button>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {assets.map((asset, idx) => {
            const urlInvalid = asset.url && !isValidUrl(asset.url)
            return (
              <div key={asset.id} className="rounded-xl border border-lavender p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-gray uppercase tracking-wide">
                    Asset {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(asset.id)}
                    className="text-purple-gray hover:text-red-500 transition-colors"
                    aria-label="Remove asset"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-purple-gray mb-1">Type</label>
                    <select
                      value={asset.type}
                      onChange={e => updateRow(asset.id, { type: e.target.value as AssetType })}
                      className="w-full rounded-lg border border-lavender px-2.5 py-2 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
                    >
                      {ASSET_TYPES.map(t => (
                        <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-purple-gray mb-1">URL</label>
                    <input
                      type="url"
                      value={asset.url}
                      onChange={e => updateRow(asset.id, { url: e.target.value })}
                      placeholder="https://…"
                      className={[
                        'w-full rounded-lg border px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:ring-2 transition',
                        urlInvalid
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                          : 'border-lavender focus:border-primary-purple focus:ring-primary-purple/20',
                      ].join(' ')}
                    />
                    {urlInvalid && (
                      <p className="text-xs text-red-600 mt-0.5">Must be a valid http/https URL.</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-purple-gray mb-1">
                    Label <span className="font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={asset.label}
                    onChange={e => updateRow(asset.id, { label: e.target.value })}
                    placeholder="e.g. Homepage Loom Walkthrough"
                    className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
                  />
                </div>
              </div>
            )
          })}

          <button
            type="button"
            onClick={addRow}
            className="w-full rounded-xl border-2 border-dashed border-lavender py-2.5 text-sm text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Add another asset
          </button>
        </div>
      )}

      <StepNav
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!allUrlsValid || (assets.length > 0 && !hasFilledRows && assets.some(a => !a.url))}
      />
    </div>
  )
}
