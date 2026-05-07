import { useRef, useState } from 'react'
import { Plus, Trash2, Upload, Loader2, RefreshCw, AlertCircle, FileText } from 'lucide-react'
import type { StepProps, AssetRow } from './types'
import { ASSET_TYPES, ASSET_TYPE_LABELS } from './types'
import type { AssetType } from '../../types/database'
import StepNav from './StepNav'
import {
  uploadAttachment, removeAttachment, pathFromPublicUrl, AttachmentError,
} from '../../lib/attachmentUpload'

const ACCEPT_ATTACHMENT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url)
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() ?? ''
    // Storage paths start with `{timestamp}-slug.ext` — strip the timestamp prefix for display.
    return decodeURIComponent(last.replace(/^\d{10,}-/, ''))
  } catch {
    return 'file'
  }
}

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

interface UploadState {
  uploading: boolean
  progress: number
  error: string | null
}

export default function Step5Assets({ formData, updateForm, onNext, onBack }: StepProps) {
  const assets = formData.assets
  const memberNumber = Number(formData.memberNumber) || 0

  // Per-row upload state; keyed by row id.
  const [uploadState, setUploadState] = useState<Record<string, UploadState>>({})

  const addRow = () => updateForm({ assets: [...assets, newRow()] })

  const removeRow = (id: string) => {
    const row = assets.find(a => a.id === id)
    if (row?.type === 'attachment' && row.url) {
      const path = pathFromPublicUrl(row.url)
      if (path) removeAttachment(path)
    }
    setUploadState(s => { const n = { ...s }; delete n[id]; return n })
    updateForm({ assets: assets.filter(a => a.id !== id) })
  }

  const updateRow = (id: string, patch: Partial<AssetRow>) => {
    updateForm({ assets: assets.map(a => (a.id === id ? { ...a, ...patch } : a)) })
  }

  const setRowState = (id: string, patch: Partial<UploadState>) => {
    setUploadState(s => {
      const prev: UploadState = s[id] ?? { uploading: false, progress: 0, error: null }
      return { ...s, [id]: { ...prev, ...patch } }
    })
  }

  const handleFilePicked = async (id: string, file: File) => {
    // If replacing, best-effort clean up the prior upload first.
    const existing = assets.find(a => a.id === id)
    if (existing?.url) {
      const prior = pathFromPublicUrl(existing.url)
      if (prior) removeAttachment(prior)
    }

    setRowState(id, { uploading: true, progress: 0, error: null })
    try {
      const result = await uploadAttachment(file, memberNumber, pct => {
        setRowState(id, { progress: pct })
      })
      updateRow(id, {
        url: result.url,
        // Autofill label from the filename if the user hasn't typed one.
        label: existing?.label?.trim() ? existing.label : result.filename.replace(/\.[^.]+$/, ''),
      })
      setRowState(id, { uploading: false, progress: 100, error: null })
    } catch (err) {
      const msg = err instanceof AttachmentError
        ? err.message
        : (err as { message?: string })?.message ?? 'Upload failed'
      setRowState(id, { uploading: false, progress: 0, error: msg })
    }
  }

  const allUrlsValid = assets.every(a => !a.url || isValidUrl(a.url))
  const hasFilledRows = assets.some(a => a.url.trim())
  const anyUploading = Object.values(uploadState).some(s => s?.uploading)

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
          {assets.map((asset, idx) => (
            <AssetRowCard
              key={asset.id}
              asset={asset}
              index={idx}
              state={uploadState[asset.id]}
              memberNumber={memberNumber}
              onType={(type) => updateRow(asset.id, { type })}
              onUrl={(url) => updateRow(asset.id, { url })}
              onLabel={(label) => updateRow(asset.id, { label })}
              onFile={(file) => handleFilePicked(asset.id, file)}
              onClearUpload={() => {
                const path = asset.url ? pathFromPublicUrl(asset.url) : null
                if (path) removeAttachment(path)
                updateRow(asset.id, { url: '' })
                setRowState(asset.id, { uploading: false, progress: 0, error: null })
              }}
              onRemove={() => removeRow(asset.id)}
            />
          ))}

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
        nextDisabled={anyUploading || !allUrlsValid || (assets.length > 0 && !hasFilledRows && assets.some(a => !a.url))}
      />
    </div>
  )
}

// ── Row card ────────────────────────────────────────────────────────────────

interface RowProps {
  asset: AssetRow
  index: number
  state: UploadState | undefined
  memberNumber: number
  onType: (type: AssetType) => void
  onUrl: (url: string) => void
  onLabel: (label: string) => void
  onFile: (file: File) => void
  onClearUpload: () => void
  onRemove: () => void
}

function AssetRowCard({ asset, index, state, memberNumber, onType, onUrl, onLabel, onFile, onClearUpload, onRemove }: RowProps) {
  const urlInvalid = asset.url && asset.type !== 'attachment' && !isValidUrl(asset.url)
  const isAttachment = asset.type === 'attachment'

  return (
    <div className="rounded-xl border border-lavender p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-purple-gray uppercase tracking-wide">
          Asset {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
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
            onChange={e => onType(e.target.value as AssetType)}
            className="w-full rounded-lg border border-lavender px-2.5 py-2 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          >
            {ASSET_TYPES.map(t => (
              <option key={t} value={t}>{ASSET_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          {isAttachment ? (
            <AttachmentField
              asset={asset}
              state={state}
              memberNumber={memberNumber}
              onFile={onFile}
              onClear={onClearUpload}
            />
          ) : (
            <>
              <label className="block text-xs font-medium text-purple-gray mb-1">URL</label>
              <input
                type="url"
                value={asset.url}
                onChange={e => onUrl(e.target.value)}
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
            </>
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
          onChange={e => onLabel(e.target.value)}
          placeholder={isAttachment ? 'e.g. Homepage hero mockup' : 'e.g. Homepage Loom Walkthrough'}
          className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
        />
      </div>
    </div>
  )
}

// ── Attachment field (file picker + preview) ───────────────────────────────

interface AttachmentFieldProps {
  asset: AssetRow
  state: UploadState | undefined
  memberNumber: number
  onFile: (file: File) => void
  onClear: () => void
}

function AttachmentField({ asset, state, memberNumber, onFile, onClear }: AttachmentFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploaded = !!asset.url
  const uploading = state?.uploading === true
  const error = state?.error ?? null
  const progress = state?.progress ?? 0

  const pick = () => inputRef.current?.click()
  const onChoose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    // Reset so the same file can be reselected after a remove.
    e.target.value = ''
  }

  const disabled = !memberNumber || memberNumber === 0

  return (
    <div>
      <label className="block text-xs font-medium text-purple-gray mb-1">Image or PDF</label>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTACHMENT}
        onChange={onChoose}
        className="hidden"
      />

      {uploaded && !uploading && (
        <div className="flex items-center gap-3 rounded-lg border border-lavender p-2 bg-lavender-tint/20">
          {isPdfUrl(asset.url) ? (
            <div className="h-16 w-16 rounded-md border border-lavender bg-white flex flex-col items-center justify-center shrink-0">
              <FileText size={22} className="text-primary-purple" />
              <span className="text-[9px] font-bold text-primary-purple mt-0.5 tracking-wider">PDF</span>
            </div>
          ) : (
            <img
              src={asset.url}
              alt={asset.label || 'Attachment'}
              className="h-16 w-16 object-cover rounded-md border border-lavender shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-deep-plum truncate">
              {asset.label || filenameFromUrl(asset.url)}
            </p>
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-primary-purple hover:underline truncate block"
            >
              Open in new tab ↗
            </a>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={pick}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border border-lavender bg-white text-deep-plum px-2.5 py-1 hover:bg-lavender-tint disabled:opacity-40"
            >
              <RefreshCw size={10} /> Replace
            </button>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border border-red-200 bg-white text-red-700 px-2.5 py-1 hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {uploading && (
        <div className="rounded-lg border border-lavender bg-lavender-tint/30 p-3">
          <div className="flex items-center gap-2 text-xs text-deep-plum">
            <Loader2 size={13} className="animate-spin text-primary-purple" />
            Uploading… {progress}%
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-lavender/40 overflow-hidden">
            <div className="h-full bg-primary-purple transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {!uploaded && !uploading && (
        <button
          type="button"
          onClick={pick}
          disabled={disabled}
          className="w-full rounded-lg border-2 border-dashed border-lavender py-3 text-sm text-purple-gray hover:border-primary-purple hover:text-primary-purple hover:bg-lavender-tint/30 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={disabled ? 'Pick a partner in Step 1 first' : 'Choose an image or PDF from your computer'}
        >
          <Upload size={14} /> Choose file
        </button>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={pick} className="font-semibold hover:underline shrink-0">
            Try again
          </button>
        </div>
      )}

      <p className="text-[11px] text-purple-gray/70 mt-1">
        JPEG, PNG, WebP, GIF, or PDF · up to 20 MB · images over 2000 px or 10 MB are resized; smaller files upload as-is.
      </p>
    </div>
  )
}
