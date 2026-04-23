import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, AlertCircle, Check, Link as LinkIcon, Loader2, Plus, Trash2, Upload, X,
  Palette, Type as TypeIcon, Image as ImageIcon, Sparkles, MessageCircle,
  Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type {
  StrategyAccountProgress, StrategyBrandGuide,
  BrandColorTier, BrandLogoKind, BrandTypographyTier, BrandElementKind,
} from '../types/database'
import {
  loadMainGuideByMember, loadGuideBySlug, loadSubbrandsFor,
  createMainGuide, createSubbrand, updateGuideMeta,
  subbrandShortSlug,
  saveLogos, saveColors, saveColorCombinations, saveTypography,
  saveElements, saveVoiceAttributes, saveVoiceGuidelines, saveBrandAttributes,
  type BrandGuideBundle, type LogoDraft, type ColorDraft, type CombinationDraft,
  type TypographyDraft, type ElementDraft, type VoiceAttributeDraft,
  type VoiceGuidelineDraft, type AttributeDraft,
} from '../lib/brandGuide'
import { uploadAttachment, AttachmentError } from '../lib/attachmentUpload'
import { isGoogleFont } from '../lib/googleFonts'

const BRAND_BUCKET = 'brand-assets'
const LOGO_MIME = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4']
const PATTERN_MIME = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
const FONT_MIME = ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/octet-stream']

// Shape returned by the brand-voice-prefill edge function. Mirrors the
// normalize() output there — kept here so sections can consume it without
// a shared types package.
interface BrandVoicePrefill {
  voice_overview: string
  brand_statement: string
  tone_characteristics: Array<{ title: string; description: string }>
  voice_guidelines: Array<{ title: string; description: string }>
  brand_attributes: Array<{ label: string; description: string }>
}

export default function BrandGuideEditorPage() {
  const { memberId, subSlug } = useParams<{ memberId: string; subSlug?: string }>()
  const memberNum = Number(memberId)
  const navigate = useNavigate()
  const { user, staffProfile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [church, setChurch] = useState<StrategyAccountProgress | null>(null)
  const [bundle, setBundle] = useState<BrandGuideBundle | null>(null)
  const [subbrands, setSubbrands] = useState<StrategyBrandGuide[]>([])
  const [parentGuide, setParentGuide] = useState<StrategyBrandGuide | null>(null)
  const [parentBundle, setParentBundle] = useState<BrandGuideBundle | null>(null)

  // When editing a subbrand, the `bundle` refers to the subbrand; the parent
  // row is held separately so we can show breadcrumb / list context.
  const isSubbrand = Boolean(subSlug)

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!memberNum) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const churchRes = await supabase.from('strategy_account_progress')
          .select('*').eq('member', memberNum).maybeSingle()
        if (cancelled) return
        setChurch(churchRes.data as StrategyAccountProgress | null)

        if (subSlug) {
          // Editing a subbrand. The URL carries the short (ministry-only)
          // slug — compose it against the parent's slug to find the row.
          const parent = await loadMainGuideByMember(memberNum)
          if (cancelled) return
          if (!parent) {
            setError('No main brand guide for this church yet — create one before adding ministries.')
            setBundle(null); setParentGuide(null); setParentBundle(null); setSubbrands([])
            return
          }
          // Try the composite `{parent}/{ministry}` slug first (current format),
          // falling back to the flat `{ministry}` slug for legacy rows that
          // haven't been normalized yet.
          let sub = await loadGuideBySlug(`${parent.guide.slug}/${subSlug}`)
          if (!sub) sub = await loadGuideBySlug(subSlug)
          if (cancelled) return
          if (!sub || sub.guide.parent_id !== parent.guide.id) {
            setError('Subbrand not found for this church.')
            setBundle(null); setParentGuide(null); setParentBundle(null); setSubbrands([])
            return
          }
          setBundle(sub)
          setParentGuide(parent.guide)
          setParentBundle(parent)
          setSubbrands([])
        } else {
          // Editing the main guide: load it + list its subbrands.
          const main = await loadMainGuideByMember(memberNum)
          if (cancelled) return
          setBundle(main)
          setParentGuide(null)
          setParentBundle(null)
          if (main) {
            const kids = await loadSubbrandsFor(main.guide.id)
            if (cancelled) return
            setSubbrands(kids)
          } else {
            setSubbrands([])
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as { message?: string })?.message ?? 'Failed to load brand guide')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [memberNum, subSlug])

  const reload = async () => {
    if (subSlug) {
      const parent = parentGuide ?? (await loadMainGuideByMember(memberNum))?.guide ?? null
      if (!parent) { setBundle(null); return }
      const sub = await loadGuideBySlug(`${parent.slug}/${subSlug}`)
      setBundle(sub)
    } else {
      const main = await loadMainGuideByMember(memberNum)
      setBundle(main)
      if (main) {
        const kids = await loadSubbrandsFor(main.guide.id)
        setSubbrands(kids)
      }
    }
  }

  const reloadSubbrands = async () => {
    if (!bundle || isSubbrand) return
    setSubbrands(await loadSubbrandsFor(bundle.guide.id))
  }

  const handleCreate = async () => {
    if (!church) return
    const name = church.church_name ?? `Member ${memberNum}`
    try {
      await createMainGuide({ memberId: memberNum, displayName: name, createdBy: user?.id ?? null })
      await reload()
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to create brand guide')
    }
  }

  // ── Render states ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-5xl mx-auto">
        <div className="h-10 w-1/3 bg-lavender-tint rounded-lg animate-pulse mb-4" />
        <div className="h-64 bg-lavender-tint rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <BackLink />
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <BackLink />
        <div className="bg-white border border-lavender rounded-2xl p-8 shadow-sm text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-primary-purple mb-1">Brand Guide</p>
          <h1 className="text-2xl font-semibold text-deep-plum mb-2">
            {church?.church_name ?? `Member #${memberNum}`}
          </h1>
          <p className="text-sm text-purple-gray mb-6">
            No brand guide exists for this church yet. Create one to start saving logos, colors, typography, and voice.
          </p>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2.5 hover:bg-primary-purple transition-colors"
          >
            <Plus size={14} /> Create brand guide
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-5xl mx-auto">
        <BackLink />

        {isSubbrand && parentGuide && (
          <div className="mb-4 rounded-xl border border-lavender bg-lavender-tint/30 px-4 py-2.5 text-xs text-deep-plum flex items-center gap-2 flex-wrap">
            <span className="font-bold uppercase tracking-widest text-[10px] text-primary-purple">Ministry</span>
            <span>•</span>
            <span>Part of</span>
            <button
              type="button"
              onClick={() => navigate(`/churches/${memberNum}/brand`)}
              className="font-semibold text-primary-purple hover:underline"
            >
              {parentGuide.display_name}
            </button>
          </div>
        )}

        <MetaCard
          guide={bundle.guide}
          churchName={church?.church_name ?? null}
          onChange={(next) => setBundle({ ...bundle, guide: next })}
          onError={setError}
        />

        <LogosSection bundle={bundle} staffName={staffProfile?.full_name ?? null} onSaved={reload} onError={setError} />
        <ColorsSection bundle={bundle} parentBundle={parentBundle} onSaved={reload} onError={setError} />
        <ColorCombinationsSection bundle={bundle} onSaved={reload} onError={setError} />
        <TypographySection bundle={bundle} parentBundle={parentBundle} onSaved={reload} onError={setError} />
        <ElementsSection bundle={bundle} onSaved={reload} onError={setError} />
        {!isSubbrand && (
          <>
            <VoicePrefillCard
              bundle={bundle}
              onPrefilled={reload}
              onError={setError}
            />
            <VoiceSection guide={bundle.guide} onChange={(g) => setBundle({ ...bundle, guide: g })} onError={setError} />
            <VoiceAttributesSection bundle={bundle} onSaved={reload} onError={setError} />
            <VoiceGuidelinesSection bundle={bundle} onSaved={reload} onError={setError} />
            <BrandAttributesSection bundle={bundle} onSaved={reload} onError={setError} />
          </>
        )}
        {!isSubbrand && (
          <MinistriesSection
            parentGuide={bundle.guide}
            subbrands={subbrands}
            createdBy={user?.id ?? null}
            onSaved={reloadSubbrands}
            onError={setError}
            onOpen={(shortSlug) => navigate(`/churches/${memberNum}/brand/${shortSlug}`)}
          />
        )}

        {error && (
          <div className="mt-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <X size={16} className="text-red-600 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-xs text-red-700 hover:underline">Dismiss</button>
          </div>
        )}
      </div>
    </div>
  )

  function BackLink() {
    const label = isSubbrand ? 'Back to parent guide' : 'Back to Church'
    const href = isSubbrand ? `/churches/${memberNum}/brand` : `/churches/${memberNum}`
    return (
      <button
        type="button"
        onClick={() => navigate(href)}
        className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
      >
        <ArrowLeft size={14} /> {label}
      </button>
    )
  }
}

// ── Meta card ───────────────────────────────────────────────────────────────

function MetaCard({ guide, churchName, onChange, onError }: {
  guide: StrategyBrandGuide
  churchName: string | null
  onChange: (next: StrategyBrandGuide) => void
  onError: (msg: string) => void
}) {
  const [displayName, setDisplayName] = useState(guide.display_name)
  const [contactName, setContactName] = useState(guide.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(guide.contact_email ?? '')
  const [publishing, setPublishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [uploadingZip, setUploadingZip] = useState(false)
  const zipInputRef = useRef<HTMLInputElement | null>(null)

  const portalUrl = `${window.location.origin}/brand/${guide.slug}`

  const pickZip = () => zipInputRef.current?.click()
  const handleZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingZip(true)
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${guide.id}/zip`,
        allowedMime: ['application/zip', 'application/x-zip-compressed'],
        maxBytes: 200 * 1024 * 1024,
      })
      const next = await updateGuideMeta(guide.id, { assets_zip_url: result.url })
      onChange(next)
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploadingZip(false)
    }
  }
  const clearZip = async () => {
    try {
      const next = await updateGuideMeta(guide.id, { assets_zip_url: null })
      onChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to clear zip')
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await updateGuideMeta(guide.id, {
        display_name: displayName.trim() || guide.display_name,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
      })
      onChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const togglePublished = async () => {
    setPublishing(true)
    try {
      const next = await updateGuideMeta(guide.id, { is_published: !guide.is_published })
      onChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to toggle publish state')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Brand Guide</p>
          <h1 className="text-2xl font-semibold text-deep-plum">{guide.display_name}</h1>
          {churchName && churchName !== guide.display_name && (
            <p className="text-xs text-purple-gray mt-0.5">Church: {churchName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-1 ${
            guide.is_published ? 'bg-green-100 text-green-700' : 'bg-purple-gray/10 text-purple-gray'
          }`}>
            {guide.is_published ? 'Published' : 'Draft'}
          </span>
          <button
            type="button"
            onClick={togglePublished}
            disabled={publishing}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
              guide.is_published
                ? 'border-lavender bg-white text-deep-plum hover:bg-lavender-tint'
                : 'bg-deep-plum text-white border-deep-plum hover:bg-primary-purple'
            }`}
          >
            {publishing ? <Loader2 size={11} className="animate-spin inline" /> : null}
            {guide.is_published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <Field label="Display name">
          <input
            type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </Field>
        <Field label="Contact name">
          <input
            type="text" value={contactName} onChange={e => setContactName(e.target.value)}
            placeholder="e.g. Pastor Mike"
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </Field>
        <Field label="Contact email">
          <input
            type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
            placeholder="mike@church.com"
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </Field>
      </div>

      {/* Bulk assets zip */}
      <div className="rounded-xl border border-lavender/70 bg-lavender-tint/20 p-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
        <input ref={zipInputRef} type="file" className="hidden" accept=".zip,application/zip" onChange={handleZip} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray">Bulk assets zip</p>
          <p className="text-xs text-deep-plum mt-0.5">
            {guide.assets_zip_url ? 'Uploaded — visible as "Download all assets" on the public portal.' : 'Optional — upload a zip containing all logos/fonts/assets. Shows up on the public portal as a single download button.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {guide.assets_zip_url && (
            <a href={guide.assets_zip_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary-purple hover:underline font-semibold">
              View current
            </a>
          )}
          <button type="button" onClick={pickZip} disabled={uploadingZip}
            className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint disabled:opacity-50">
            {uploadingZip ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {guide.assets_zip_url ? 'Replace' : 'Upload zip'}
          </button>
          {guide.assets_zip_url && (
            <button type="button" onClick={clearZip}
              className="text-[11px] text-purple-gray hover:text-red-500 px-2 py-1">Clear</button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-purple-gray flex items-center gap-2">
          <span className="font-semibold">Portal URL:</span>
          <code className="bg-lavender-tint px-1.5 py-0.5 rounded text-primary-purple">{portalUrl}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(portalUrl).then(() => {
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2000)
              })
            }}
            className="inline-flex items-center justify-center h-6 w-6 rounded-full hover:bg-lavender-tint text-purple-gray hover:text-primary-purple transition-colors"
            title="Copy portal URL"
          >
            {linkCopied ? <Check size={11} className="text-green-600" /> : <LinkIcon size={11} />}
          </button>
          {!guide.is_published && (
            <span className="text-amber-700">(hidden until published)</span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save meta
        </button>
      </div>
    </div>
  )
}

// ── Generic section shell ──────────────────────────────────────────────────

/** Amber banner offering to append rows from the parent church guide. Shown
 *  only when editing a subbrand. The user reviews the appended rows and hits
 *  Save on the section — nothing is written to the DB until then. */
function LoadFromParentBar({ parentName, label, disabled, onLoad }: {
  parentName: string
  label: string
  disabled: boolean
  onLoad: () => void
}) {
  return (
    <div className="rounded-xl border border-primary-purple/30 bg-primary-purple/5 px-3 py-2.5 text-xs text-deep-plum mb-4 flex items-center justify-between gap-3 flex-wrap">
      <span>
        <span className="font-semibold">{label} {parentName}</span>
        <span className="text-purple-gray"> — appends to this ministry for review before you save.</span>
      </span>
      <button
        type="button"
        onClick={onLoad}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple text-white text-xs font-semibold px-3 py-1.5 hover:bg-deep-plum transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        <Plus size={11} /> Load from main church
      </button>
    </div>
  )
}

function SectionCard({ icon: Icon, title, description, children }: {
  icon: typeof Palette
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-lavender rounded-2xl p-5 md:p-6 shadow-sm mb-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-8 w-8 rounded-lg bg-lavender-tint flex items-center justify-center shrink-0">
          <Icon size={15} className="text-primary-purple" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-deep-plum">{title}</h2>
          {description && <p className="text-xs text-purple-gray mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1">{label}</label>
      {children}
    </div>
  )
}

function SectionFooter({ dirty, saving, onSave, onReset }: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onReset: () => void
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      {dirty && !saving && (
        <button type="button" onClick={onReset} className="text-xs text-purple-gray hover:text-deep-plum px-2 py-1.5">
          Discard changes
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-1.5 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        {saving ? 'Saving…' : dirty ? 'Save section' : 'Saved'}
      </button>
    </div>
  )
}

// ── Logos ──────────────────────────────────────────────────────────────────

const LOGO_KINDS: BrandLogoKind[] = ['primary', 'secondary', 'badge', 'icon']
const LOGO_KIND_LABEL: Record<BrandLogoKind, string> = {
  primary: 'Primary', secondary: 'Secondary', badge: 'Badge', icon: 'Icon',
}

function LogosSection({ bundle, staffName, onSaved, onError }: {
  bundle: BrandGuideBundle
  staffName: string | null
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<LogoDraft[]>(bundle.logos)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  useEffect(() => { setDraft(bundle.logos) }, [bundle.logos])

  const dirty = !rowsEqual(draft, bundle.logos, ['kind', 'label', 'preview_url', 'download_url', 'clear_space_note'])

  const save = async () => {
    setSaving(true)
    try {
      await saveLogos(bundle.guide.id, draft, bundle.logos.map(l => l.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save logos') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { kind: 'primary', label: staffName ? `${staffName}'s Logo` : 'Logo', preview_url: '', download_url: null, clear_space_note: null }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<LogoDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const pickFile = (i: number) => { setUploadingIdx(i); fileInputRef.current?.click() }
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploadingIdx == null) return
    const idx = uploadingIdx
    setUploadingIdx(idx)
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${bundle.guide.id}/logos`,
        allowedMime: LOGO_MIME,
        maxBytes: 20 * 1024 * 1024,
      })
      updateRow(idx, { preview_url: result.url })
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploadingIdx(null)
    }
  }

  return (
    <SectionCard
      icon={ImageIcon}
      title="Logos"
      description="Primary, secondary, badge, and icon lockups. Preview image renders on the public portal; Dropbox link is the full-res pack."
    >
      <input
        ref={fileInputRef} type="file" className="hidden"
        accept={LOGO_MIME.join(',')}
        onChange={handleFile}
      />

      <div className="space-y-3">
        {draft.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender p-3 grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-3 items-start">
            <div className="h-24 rounded-lg border border-lavender bg-lavender-tint/30 flex items-center justify-center overflow-hidden">
              {row.preview_url ? (
                row.preview_url.endsWith('.mp4')
                  ? <video src={row.preview_url} className="max-h-full max-w-full" muted loop />
                  : <img src={row.preview_url} alt={row.label ?? 'Logo'} className="max-h-20 max-w-full object-contain" />
              ) : (
                <button type="button" onClick={() => pickFile(i)} className="text-xs text-purple-gray hover:text-primary-purple font-semibold flex flex-col items-center gap-1">
                  {uploadingIdx === i ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingIdx === i ? 'Uploading…' : 'Upload'}
                </button>
              )}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Kind">
                  <select value={row.kind} onChange={e => updateRow(i, { kind: e.target.value as BrandLogoKind })}
                    className="w-full rounded-lg border border-lavender px-2 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple">
                    {LOGO_KINDS.map(k => <option key={k} value={k}>{LOGO_KIND_LABEL[k]}</option>)}
                  </select>
                </Field>
                <Field label="Label">
                  <input type="text" value={row.label ?? ''} onChange={e => updateRow(i, { label: e.target.value })}
                    placeholder="e.g. Real Life Primary Wordmark"
                    className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
                </Field>
              </div>
              <Field label="Download URL (Dropbox or similar)">
                <input type="url" value={row.download_url ?? ''} onChange={e => updateRow(i, { download_url: e.target.value || null })}
                  placeholder="https://www.dropbox.com/…"
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
              </Field>
              <Field label="Clear space note (optional)">
                <input type="text" value={row.clear_space_note ?? ''} onChange={e => updateRow(i, { clear_space_note: e.target.value || null })}
                  placeholder="Maintain clear space equal to the height of the 'R' on all sides."
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
              </Field>
              {row.preview_url && (
                <button type="button" onClick={() => pickFile(i)} className="text-[11px] text-primary-purple hover:underline font-semibold">
                  Replace image
                </button>
              )}
            </div>
            <button type="button" onClick={() => removeRow(i)} className="text-purple-gray hover:text-red-500 p-1.5" aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        <button type="button" onClick={addRow} className="w-full rounded-xl border-2 border-dashed border-lavender py-2 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add logo
        </button>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.logos)} />
    </SectionCard>
  )
}

// ── Colors ─────────────────────────────────────────────────────────────────

const COLOR_TIERS: BrandColorTier[] = ['primary', 'secondary', 'accent', 'background', 'text', 'light', 'dark']
const TIER_LABEL: Record<BrandColorTier, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  background: 'Background', text: 'Text', light: 'Light', dark: 'Dark',
}

function ColorsSection({ bundle, parentBundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  parentBundle?: BrandGuideBundle | null
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<ColorDraft[]>(bundle.colors)
  const [saving, setSaving] = useState(false)
  const [newHex, setNewHex] = useState('#')
  const [newTier, setNewTier] = useState<BrandColorTier>('primary')
  const [newName, setNewName] = useState('')
  const onColorInputRef = useRef<HTMLInputElement | null>(null)
  const [onColorIdx, setOnColorIdx] = useState<number | null>(null)

  useEffect(() => { setDraft(bundle.colors) }, [bundle.colors])

  const dirty = !rowsEqual(draft, bundle.colors, ['name', 'tier', 'hex', 'cmyk', 'rgb', 'pms', 'proportion_pct', 'on_color_logo_url'])

  const pickOnColor = (i: number) => { setOnColorIdx(i); onColorInputRef.current?.click() }
  const handleOnColor = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || onColorIdx == null) return
    const idx = onColorIdx
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${bundle.guide.id}/on-color`,
        allowedMime: LOGO_MIME,
        maxBytes: 20 * 1024 * 1024,
      })
      setDraft(prev => prev.map((r, k) => k === idx ? { ...r, on_color_logo_url: result.url } : r))
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setOnColorIdx(null)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await saveColors(bundle.guide.id, draft, bundle.colors.map(c => c.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save colors') }
    finally { setSaving(false) }
  }

  const addColor = () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(newHex)) return
    setDraft([...draft, {
      name: newName.trim() || null, tier: newTier, hex: newHex.toLowerCase(),
      cmyk: null, rgb: null, pms: null, proportion_pct: null, on_color_logo_url: null,
    }])
    setNewHex('#')
    setNewName('')
  }

  const removeColor = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateColor = (i: number, patch: Partial<ColorDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const hasBackground = draft.some(c => c.tier === 'background')
  const hasText = draft.some(c => c.tier === 'text')
  const missingCore = !hasBackground || !hasText

  return (
    <SectionCard
      icon={Palette}
      title="Color Palette"
      description="Tier drives hierarchy on the public portal and in the PDF. Primary / Secondary / Accent / Light / Dark carry the brand; Background / Text are required for the portal to theme itself correctly."
    >
      {parentBundle && (
        <LoadFromParentBar
          parentName={parentBundle.guide.display_name}
          disabled={parentBundle.colors.length === 0}
          label="Load colors from"
          onLoad={() => {
            setDraft(prev => [
              ...prev,
              ...parentBundle.colors.map(c => ({
                name: c.name, tier: c.tier, hex: c.hex, cmyk: c.cmyk, rgb: c.rgb,
                pms: c.pms, proportion_pct: c.proportion_pct,
                on_color_logo_url: c.on_color_logo_url,
              })),
            ])
          }}
        />
      )}
      {missingCore && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 mb-4 flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-700" />
          <div>
            <p className="font-semibold">Heads up — mark a background and text color.</p>
            <p className="mt-0.5">
              The public brand guide uses the <span className="font-semibold">background</span> tier for its page color and the <span className="font-semibold">text</span> tier for body copy. Without these tiers set, the portal falls back to a neutral off-white and near-black, which usually isn't what you want.
              {!hasBackground && <> <span className="font-semibold">Background is missing.</span></>}
              {!hasText && <> <span className="font-semibold">Text is missing.</span></>}
            </p>
          </div>
        </div>
      )}

      {/* Swatch grid */}
      {draft.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-4">
            {draft.map((c, i) => (
              <div key={c.id ?? `new-${i}`} className="flex flex-col items-center text-center group">
                <div
                  className="h-16 w-16 rounded-full border border-lavender shadow-sm"
                  style={{ backgroundColor: c.hex }}
                />
                <input type="text" value={c.hex} onChange={e => updateColor(i, { hex: e.target.value })}
                  className="mt-2 w-20 text-center text-[11px] font-mono text-deep-plum bg-transparent outline-none focus:bg-lavender-tint/40 rounded px-1" />
                <select value={c.tier} onChange={e => updateColor(i, { tier: e.target.value as BrandColorTier })}
                  className="text-[10px] text-purple-gray bg-transparent outline-none hover:text-deep-plum">
                  {COLOR_TIERS.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                </select>
                <input type="text" value={c.name ?? ''} onChange={e => updateColor(i, { name: e.target.value || null })}
                  placeholder="Name (optional)"
                  className="mt-1 w-24 text-center text-[10px] text-deep-plum bg-transparent outline-none focus:bg-lavender-tint/40 rounded px-1" />
                <button type="button" onClick={() => removeColor(i)} className="opacity-0 group-hover:opacity-100 text-purple-gray hover:text-red-500 mt-1 transition-opacity">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>

          {/* Color hierarchy — proportion_pct per color */}
          <div className="rounded-xl border border-lavender/60 bg-lavender-tint/20 p-3 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-2">Color Hierarchy</p>
            <p className="text-[11px] text-purple-gray mb-3">
              Suggested usage % across the brand. Optional — renders as a proportion bar on the public portal when set. Doesn't have to sum to 100.
            </p>
            <div className="space-y-2">
              {draft.map((c, i) => (
                <div key={`prop-${c.id ?? i}`} className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full border border-lavender shrink-0" style={{ backgroundColor: c.hex }} />
                  <span className="text-xs text-deep-plum min-w-[120px] truncate">{c.name ?? c.hex}</span>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={c.proportion_pct ?? 0}
                    onChange={e => updateColor(i, { proportion_pct: Number(e.target.value) || null })}
                    className="flex-1 accent-primary-purple"
                  />
                  <input
                    type="number" min={0} max={100}
                    value={c.proportion_pct ?? ''}
                    onChange={e => updateColor(i, { proportion_pct: e.target.value === '' ? null : Number(e.target.value) })}
                    className="w-16 rounded border border-lavender px-2 py-0.5 text-xs text-deep-plum text-center outline-none focus:border-primary-purple"
                  />
                  <span className="text-[10px] text-purple-gray">%</span>
                </div>
              ))}
            </div>
          </div>

          {/* On-Color Logos — per-color logo for the portal's On Color showcase */}
          <div className="rounded-xl border border-lavender/60 bg-lavender-tint/20 p-3 mb-4">
            <input ref={onColorInputRef} type="file" className="hidden" accept={LOGO_MIME.join(',')} onChange={handleOnColor} />
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1">On-Color Logos</p>
            <p className="text-[11px] text-purple-gray mb-3">
              Pick which logo variant sits on each color. Upload a dark logo for light backgrounds and a light logo for dark ones so nothing vanishes into its background. Colors without an on-color logo are skipped in the portal's On Color showcase.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {draft.map((c, i) => (
                <div key={`onc-${c.id ?? i}`} className="flex items-center gap-2 rounded-lg border border-lavender/60 bg-white p-2">
                  <div
                    className="h-12 w-12 rounded shrink-0 flex items-center justify-center overflow-hidden border border-lavender/50"
                    style={{ backgroundColor: c.hex }}
                  >
                    {c.on_color_logo_url ? (
                      c.on_color_logo_url.endsWith('.mp4')
                        ? <video src={c.on_color_logo_url} className="max-h-10 max-w-full" muted loop autoPlay playsInline />
                        : <img src={c.on_color_logo_url} alt="on-color logo" className="max-h-10 max-w-full object-contain" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-deep-plum truncate">{c.name ?? c.hex}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <button type="button" onClick={() => pickOnColor(i)}
                        className="text-[11px] text-primary-purple hover:underline font-semibold inline-flex items-center gap-0.5">
                        {onColorIdx === i ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                        {c.on_color_logo_url ? 'Replace' : 'Upload'}
                      </button>
                      {c.on_color_logo_url && (
                        <button type="button" onClick={() => updateColor(i, { on_color_logo_url: null })}
                          className="text-[10px] text-purple-gray hover:text-red-500">Clear</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add row */}
      <div className="rounded-xl border-2 border-dashed border-lavender p-3 flex items-center gap-2 flex-wrap">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(newHex) ? newHex : '#513DE5'} onChange={e => setNewHex(e.target.value)}
          className="h-9 w-9 rounded border border-lavender cursor-pointer" />
        <input type="text" value={newHex} onChange={e => setNewHex(e.target.value)} placeholder="#341756"
          className="rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum font-mono w-28 outline-none focus:border-primary-purple" />
        <select value={newTier} onChange={e => setNewTier(e.target.value as BrandColorTier)}
          className="rounded-lg border border-lavender px-2.5 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple">
          {COLOR_TIERS.map(t => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </select>
        <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name (optional)"
          className="flex-1 min-w-[140px] rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
        <button type="button" onClick={addColor} disabled={!/^#[0-9a-fA-F]{6}$/.test(newHex)}
          className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint disabled:opacity-40">
          <Plus size={12} /> Add
        </button>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.colors)} />
    </SectionCard>
  )
}

// ── Color combinations ─────────────────────────────────────────────────────

function ColorCombinationsSection({ bundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<CombinationDraft[]>(bundle.colorCombinations)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(bundle.colorCombinations) }, [bundle.colorCombinations])

  // override_logo_url is deprecated in the editor UI (moved to per-color on_color_logo_url).
  // Still tracked in the data model for backward compat, but changes aren't expected here.
  const dirty = !rowsEqual(draft, bundle.colorCombinations, ['bg_color_id', 'fg_color_id'])
  const colorsById = new Map(bundle.colors.map(c => [c.id, c]))

  const save = async () => {
    setSaving(true)
    try {
      await saveColorCombinations(bundle.guide.id, draft, bundle.colorCombinations.map(k => k.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save combinations') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { bg_color_id: null, fg_color_id: null, override_logo_url: null }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<CombinationDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard
      icon={Layers}
      title="Color Combinations"
      description="Approved background + foreground pairings. Shows up as the Combinations grid on the portal. On-color logos are managed per color in the Color Palette section above."
    >
      {bundle.colors.length === 0 ? (
        <p className="text-xs text-purple-gray">Add colors above to build combinations.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {draft.map((row, i) => {
            const bg = row.bg_color_id ? colorsById.get(row.bg_color_id) : undefined
            const fg = row.fg_color_id ? colorsById.get(row.fg_color_id) : undefined
            return (
              <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender overflow-hidden">
                <div className="h-32 flex items-center justify-center" style={{ backgroundColor: bg?.hex ?? '#f9f5f1' }}>
                  <div className="h-10 w-16 rounded" style={{ backgroundColor: fg?.hex ?? '#ffffff' }} />
                </div>
                <div className="p-2 space-y-1.5">
                  <select value={row.bg_color_id ?? ''} onChange={e => updateRow(i, { bg_color_id: e.target.value || null })}
                    className="w-full rounded border border-lavender px-2 py-1 text-[11px] text-deep-plum bg-white outline-none focus:border-primary-purple">
                    <option value="">— Background —</option>
                    {bundle.colors.map(c => <option key={c.id} value={c.id}>{c.name ?? c.hex}</option>)}
                  </select>
                  <select value={row.fg_color_id ?? ''} onChange={e => updateRow(i, { fg_color_id: e.target.value || null })}
                    className="w-full rounded border border-lavender px-2 py-1 text-[11px] text-deep-plum bg-white outline-none focus:border-primary-purple">
                    <option value="">— Foreground —</option>
                    {bundle.colors.map(c => <option key={c.id} value={c.id}>{c.name ?? c.hex}</option>)}
                  </select>
                  <button type="button" onClick={() => removeRow(i)} className="w-full text-[10px] text-purple-gray hover:text-red-500 py-0.5">
                    Remove pairing
                  </button>
                </div>
              </div>
            )
          })}
          <button type="button" onClick={addRow}
            className="rounded-xl border-2 border-dashed border-lavender py-12 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
            <Plus size={12} /> Add pairing
          </button>
        </div>
      )}

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.colorCombinations)} />
    </SectionCard>
  )
}

// ── Typography ─────────────────────────────────────────────────────────────

const TYPE_TIERS: BrandTypographyTier[] = ['primary', 'secondary', 'accent']
const TYPE_TIER_LABEL: Record<BrandTypographyTier, string> = {
  primary: 'Heading', secondary: 'Body', accent: 'Accent',
}

type FontRowStatus = 'google' | 'google-url' | 'uploaded-file' | 'remote-url' | 'custom-none'

function detectFontStatus(row: TypographyDraft): FontRowStatus {
  const url = row.font_url ?? ''
  if (/fonts\.googleapis\.com/i.test(url)) return 'google-url'
  if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 'uploaded-file'
  if (url) return 'remote-url'
  if (isGoogleFont(row.family_name)) return 'google'
  return 'custom-none'
}

function TypographySection({ bundle, parentBundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  parentBundle?: BrandGuideBundle | null
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<TypographyDraft[]>(bundle.typography)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(bundle.typography) }, [bundle.typography])

  const dirty = !rowsEqual(draft, bundle.typography, ['tier', 'family_name', 'weight', 'suggested_use', 'web_font_family', 'font_url'])

  const save = async () => {
    setSaving(true)
    try {
      await saveTypography(bundle.guide.id, draft, bundle.typography.map(t => t.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save typography') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { tier: 'primary', family_name: '', weight: null, suggested_use: null, web_font_family: null, font_url: null }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TypographyDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard
      icon={TypeIcon}
      title="Typography"
      description="One row per font role. Google Fonts auto-load from the family name; non-Google fonts need a licensed webfont file before the portal can show a sample."
    >
      {parentBundle && (
        <LoadFromParentBar
          parentName={parentBundle.guide.display_name}
          disabled={parentBundle.typography.length === 0}
          label="Load fonts from"
          onLoad={() => {
            setDraft(prev => [
              ...prev,
              ...parentBundle.typography.map(t => ({
                tier: t.tier, family_name: t.family_name, weight: t.weight,
                suggested_use: t.suggested_use, web_font_family: t.web_font_family,
                font_url: t.font_url,
              })),
            ])
          }}
        />
      )}
      <div className="space-y-2">
        {draft.map((row, i) => (
          <FontRow
            key={row.id ?? `new-${i}`}
            row={row}
            guideId={bundle.guide.id}
            onChange={(patch) => updateRow(i, patch)}
            onRemove={() => removeRow(i)}
            onError={onError}
          />
        ))}

        <button type="button" onClick={addRow}
          className="w-full rounded-xl border-2 border-dashed border-lavender py-2 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add font row
        </button>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.typography)} />
    </SectionCard>
  )
}

function FontRow({ row, guideId, onChange, onRemove, onError }: {
  row: TypographyDraft
  guideId: string
  onChange: (patch: Partial<TypographyDraft>) => void
  onRemove: () => void
  onError: (msg: string) => void
}) {
  const status = detectFontStatus(row)
  const [licenseOk, setLicenseOk] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${guideId}/fonts`,
        allowedMime: FONT_MIME,
        maxBytes: 5 * 1024 * 1024,
      })
      // Set web_font_family to the typed family_name so the @font-face rule
      // on the portal binds correctly. If family_name is empty, derive from
      // the filename.
      const fallbackName = file.name.replace(/\.[^.]+$/, '')
      onChange({
        font_url: result.url,
        web_font_family: row.web_font_family || row.family_name || fallbackName,
        family_name: row.family_name || fallbackName,
      })
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-lavender p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Family">
            <input type="text" value={row.family_name} onChange={e => onChange({ family_name: e.target.value })}
              placeholder="Neue Haas Grotesk"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          </Field>
          <Field label="Tier">
            <select value={row.tier} onChange={e => onChange({ tier: e.target.value as BrandTypographyTier })}
              className="w-full rounded-lg border border-lavender px-2 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple">
              {TYPE_TIERS.map(t => <option key={t} value={t}>{TYPE_TIER_LABEL[t]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weights">
            <input type="text" value={row.weight ?? ''} onChange={e => onChange({ weight: e.target.value || null })}
              placeholder="400, 700"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          </Field>
          <Field label="Suggested use">
            <input type="text" value={row.suggested_use ?? ''} onChange={e => onChange({ suggested_use: e.target.value || null })}
              placeholder="Headlines"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          </Field>
        </div>

        <FontStatusRow status={status} family={row.family_name} fontUrl={row.font_url} />

        {status === 'custom-none' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-xs text-amber-900">
              <AlertCircle size={12} className="inline -mt-0.5 mr-1" />
              <strong>Custom font detected.</strong> We can't display this font on the public guide without a proper webfont license. Upload a licensed webfont file (WOFF/WOFF2/TTF/OTF), or leave empty — the sample will be hidden and only the font name will show.
            </p>
            <label className="flex items-start gap-2 text-[11px] text-amber-900 cursor-pointer">
              <input
                type="checkbox"
                checked={licenseOk}
                onChange={e => setLicenseOk(e.target.checked)}
                className="mt-0.5 accent-amber-600"
              />
              <span>I confirm this church has a valid webfont license for <strong>{row.family_name || 'this font'}</strong>.</span>
            </label>
            <input ref={uploadInputRef} type="file" className="hidden"
              accept={FONT_MIME.join(',') + ',.woff,.woff2,.ttf,.otf'}
              onChange={handleUpload}
            />
            <button
              type="button"
              disabled={!licenseOk || uploading}
              onClick={() => uploadInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-amber-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Upload licensed webfont
            </button>
          </div>
        )}

        <details className="text-[11px]">
          <summary className="cursor-pointer text-purple-gray hover:text-deep-plum">Advanced (font URL / web family override)</summary>
          <div className="mt-2 space-y-2">
            <Field label="Font URL (Google Fonts / Adobe Fonts / uploaded file)">
              <input type="url" value={row.font_url ?? ''} onChange={e => onChange({ font_url: e.target.value || null })}
                placeholder="https://fonts.googleapis.com/css2?family=…"
                className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple font-mono text-xs" />
            </Field>
            <Field label="Web font override (optional)">
              <input type="text" value={row.web_font_family ?? ''} onChange={e => onChange({ web_font_family: e.target.value || null })}
                placeholder="Inter"
                className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
            </Field>
          </div>
        </details>
      </div>
      <button type="button" onClick={onRemove} className="text-purple-gray hover:text-red-500 p-1.5" aria-label="Remove">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function FontStatusRow({ status, family, fontUrl }: { status: FontRowStatus; family: string; fontUrl: string | null }) {
  if (!family && !fontUrl) return null
  if (status === 'google' || status === 'google-url') {
    return (
      <p className="text-[11px] text-green-700 flex items-center gap-1">
        <Check size={11} /> Google Font detected — will auto-load on the public guide.
      </p>
    )
  }
  if (status === 'uploaded-file') {
    return (
      <p className="text-[11px] text-green-700 flex items-center gap-1">
        <Check size={11} /> Licensed webfont uploaded — sample will render on the public guide.
      </p>
    )
  }
  if (status === 'remote-url') {
    return (
      <p className="text-[11px] text-deep-plum flex items-center gap-1">
        <LinkIcon size={11} /> External font URL — will attempt to load on the public guide.
      </p>
    )
  }
  return null
}

// ── Elements (patterns / textures / applications) ──────────────────────────

const ELEMENT_KINDS: BrandElementKind[] = ['pattern', 'texture', 'application']
const ELEMENT_LABEL: Record<BrandElementKind, string> = {
  pattern: 'Pattern', texture: 'Texture', application: 'Application Example',
}

function ElementsSection({ bundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<ElementDraft[]>(bundle.elements)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  useEffect(() => { setDraft(bundle.elements) }, [bundle.elements])

  const dirty = !rowsEqual(draft, bundle.elements, ['kind', 'label', 'preview_url', 'download_url'])

  const save = async () => {
    setSaving(true)
    try {
      await saveElements(bundle.guide.id, draft, bundle.elements.map(e => e.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save elements') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { kind: 'pattern', label: null, preview_url: null, download_url: null }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<ElementDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const pickFile = (i: number) => { setUploadingIdx(i); fileInputRef.current?.click() }
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploadingIdx == null) return
    const idx = uploadingIdx
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${bundle.guide.id}/elements`,
        allowedMime: PATTERN_MIME,
        maxBytes: 20 * 1024 * 1024,
      })
      updateRow(idx, { preview_url: result.url })
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploadingIdx(null)
    }
  }

  return (
    <SectionCard
      icon={Sparkles}
      title="Elements & Application"
      description="Patterns, textures, and application examples. Upload a preview for the portal; link Dropbox for the full source."
    >
      <input ref={fileInputRef} type="file" className="hidden" accept={PATTERN_MIME.join(',')} onChange={handleFile} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {draft.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender p-3 space-y-2">
            <div className="h-28 rounded-lg border border-lavender bg-lavender-tint/30 flex items-center justify-center overflow-hidden">
              {row.preview_url ? (
                <img src={row.preview_url} alt={row.label ?? 'Element'} className="max-h-full max-w-full object-contain" />
              ) : (
                <button type="button" onClick={() => pickFile(i)} className="text-xs text-purple-gray hover:text-primary-purple font-semibold flex flex-col items-center gap-1">
                  {uploadingIdx === i ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingIdx === i ? 'Uploading…' : 'Upload preview'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={row.kind} onChange={e => updateRow(i, { kind: e.target.value as BrandElementKind })}
                className="rounded-lg border border-lavender px-2 py-1.5 text-sm text-deep-plum bg-white outline-none focus:border-primary-purple">
                {ELEMENT_KINDS.map(k => <option key={k} value={k}>{ELEMENT_LABEL[k]}</option>)}
              </select>
              <input type="text" value={row.label ?? ''} onChange={e => updateRow(i, { label: e.target.value || null })}
                placeholder="Label"
                className="rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
            </div>
            <input type="url" value={row.download_url ?? ''} onChange={e => updateRow(i, { download_url: e.target.value || null })}
              placeholder="Dropbox URL (optional)"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
            <div className="flex items-center justify-between gap-2">
              {row.preview_url && (
                <button type="button" onClick={() => pickFile(i)} className="text-[11px] text-primary-purple hover:underline font-semibold">
                  Replace image
                </button>
              )}
              <button type="button" onClick={() => removeRow(i)} className="text-purple-gray hover:text-red-500 text-[11px] ml-auto">
                Remove
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addRow}
          className="rounded-xl border-2 border-dashed border-lavender py-8 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add element
        </button>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.elements)} />
    </SectionCard>
  )
}

// ── Voice (paragraphs) ─────────────────────────────────────────────────────

/**
 * Upload-and-commit flow for AI prefill.
 *
 * The card calls the brand-voice-prefill edge function, receives the parsed
 * payload, and immediately commits everything to the database — voice
 * overview + brand statement only when those fields are currently empty (so
 * we don't clobber manual work), and new rows appended for tone
 * characteristics, voice guidelines, and brand attributes. After commit it
 * calls `onPrefilled()` which reloads the bundle; the section components
 * then re-seed their drafts from the fresh DB state and everything stays in
 * sync. The user reviews/edits/deletes in place — no in-memory prefill
 * state to lose when they save one section at a time.
 */
function VoicePrefillCard({ bundle, onPrefilled, onError }: {
  bundle: BrandGuideBundle
  onPrefilled: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [lastFilename, setLastFilename] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pickFile = () => inputRef.current?.click()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      onError('Please upload a .md strategy brief exported from Notion.')
      return
    }
    setLoading(true)
    try {
      const markdown = await file.text()
      const { data, error } = await supabase.functions.invoke<{ prefill: BrandVoicePrefill; error?: string }>(
        'brand-voice-prefill',
        { body: { markdown } },
      )
      if (error) throw error
      if (!data?.prefill) throw new Error(data?.error ?? 'No prefill returned from AI')
      await commitPrefill(bundle, data.prefill)
      await onPrefilled()
      setLastFilename(file.name)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Prefill failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-primary-purple/30 bg-primary-purple/5 p-4 md:p-5 mb-4">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        onChange={handleFile}
      />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary-purple mb-1">AI prefill</p>
          <h3 className="text-sm font-bold text-deep-plum mb-1">Prefill "How we sound" from a strategy brief</h3>
          <p className="text-xs text-purple-gray">
            Upload the Notion strategy-brief export (.md). Claude extracts the voice overview, tone characteristics, voice guidelines, brand attributes, and brand statement, and prepends them to the sections below for review. Nothing saves until you click Save on each section.
          </p>
          {lastFilename && !loading && (
            <p className="text-[11px] text-green-700 mt-1.5 flex items-center gap-1">
              <Check size={11} /> Prefilled from <strong>{lastFilename}</strong>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={pickFile}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary-purple text-white text-xs font-semibold px-4 py-2 hover:bg-deep-plum transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {loading ? 'Extracting…' : 'Upload strategy brief'}
        </button>
      </div>
    </section>
  )
}

/**
 * Commit an AI prefill to the database for all four "How we sound" sections.
 *
 *  - Voice overview + brand statement: only filled when the current value is
 *    empty, so manual entries aren't overwritten.
 *  - Tone characteristics, voice guidelines, brand attributes: new rows are
 *    appended AFTER existing rows (keeping every persisted row by passing its
 *    id through unchanged). The prefill rows come in without ids so the save
 *    helpers insert them as fresh records.
 *
 *  Errors propagate to the caller so the card can surface them in the error
 *  banner and decide whether to mark the filename as successfully processed.
 */
async function commitPrefill(bundle: BrandGuideBundle, prefill: BrandVoicePrefill): Promise<void> {
  const guideId = bundle.guide.id

  // Patch the root guide row only with fields we have content for AND that
  // are currently empty. Skip the call entirely if there's nothing to patch.
  const metaPatch: { voice_overview?: string | null; brand_statement?: string | null } = {}
  if (prefill.voice_overview && !bundle.guide.voice_overview) {
    metaPatch.voice_overview = prefill.voice_overview
  }
  if (prefill.brand_statement && !bundle.guide.brand_statement) {
    metaPatch.brand_statement = prefill.brand_statement
  }
  if (Object.keys(metaPatch).length > 0) {
    await updateGuideMeta(guideId, metaPatch)
  }

  if (prefill.tone_characteristics.length > 0) {
    const existing: VoiceAttributeDraft[] = bundle.voiceAttributes.map(v => ({
      id: v.id, title: v.title, description: v.description,
    }))
    const additions: VoiceAttributeDraft[] = prefill.tone_characteristics.map(r => ({
      title: r.title, description: r.description,
    }))
    await saveVoiceAttributes(guideId, [...existing, ...additions], bundle.voiceAttributes.map(v => v.id))
  }

  if (prefill.voice_guidelines.length > 0) {
    const existing: VoiceGuidelineDraft[] = bundle.voiceGuidelines.map(v => ({
      id: v.id, title: v.title, description: v.description,
    }))
    const additions: VoiceGuidelineDraft[] = prefill.voice_guidelines.map(r => ({
      title: r.title, description: r.description,
    }))
    await saveVoiceGuidelines(guideId, [...existing, ...additions], bundle.voiceGuidelines.map(v => v.id))
  }

  if (prefill.brand_attributes.length > 0) {
    const existing: AttributeDraft[] = bundle.attributes.map(a => ({
      id: a.id, label: a.label, description: a.description,
    }))
    const additions: AttributeDraft[] = prefill.brand_attributes.map(r => ({
      label: r.label, description: r.description || null,
    }))
    await saveBrandAttributes(guideId, [...existing, ...additions], bundle.attributes.map(a => a.id))
  }
}

function VoiceSection({ guide, onChange, onError }: {
  guide: StrategyBrandGuide
  onChange: (g: StrategyBrandGuide) => void
  onError: (msg: string) => void
}) {
  const [overview, setOverview] = useState(guide.voice_overview ?? '')
  const [statement, setStatement] = useState(guide.brand_statement ?? '')
  const [saving, setSaving] = useState(false)

  // Sync when the parent bundle refreshes (e.g. after prefill writes
  // directly to the DB and triggers a reload).
  useEffect(() => { setOverview(guide.voice_overview ?? '') }, [guide.voice_overview])
  useEffect(() => { setStatement(guide.brand_statement ?? '') }, [guide.brand_statement])

  const dirty =
    overview !== (guide.voice_overview ?? '') ||
    statement !== (guide.brand_statement ?? '')

  const save = async () => {
    setSaving(true)
    try {
      const next = await updateGuideMeta(guide.id, {
        voice_overview: overview.trim() || null,
        brand_statement: statement.trim() || null,
      })
      onChange(next)
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save voice') }
    finally { setSaving(false) }
  }

  const reset = () => {
    setOverview(guide.voice_overview ?? '')
    setStatement(guide.brand_statement ?? '')
  }

  return (
    <SectionCard icon={MessageCircle} title="Brand Voice" description="Voice overview + brand statement. Tone Characteristics and Voice Guidelines go in their own sections below.">
      <div className="space-y-3">
        <Field label="Voice overview">
          <textarea value={overview} onChange={e => setOverview(e.target.value)} rows={3}
            placeholder="Our voice feels like home — warm, welcoming, rooted in the everyday…"
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y" />
        </Field>
        <Field label="Brand statement">
          <textarea value={statement} onChange={e => setStatement(e.target.value)} rows={2}
            placeholder="A single sentence that captures the brand."
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y" />
        </Field>
      </div>
      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </SectionCard>
  )
}

// ── Voice Attributes (2x2 cards) ───────────────────────────────────────────

function VoiceAttributesSection({ bundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<VoiceAttributeDraft[]>(bundle.voiceAttributes)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(bundle.voiceAttributes) }, [bundle.voiceAttributes])

  const dirty = !rowsEqual(draft, bundle.voiceAttributes, ['title', 'description'])

  const save = async () => {
    setSaving(true)
    try {
      await saveVoiceAttributes(bundle.guide.id, draft, bundle.voiceAttributes.map(v => v.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save voice attributes') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { title: '', description: '' }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<VoiceAttributeDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard
      icon={MessageCircle}
      title="Tone Characteristics"
      description="The short descriptors that set tone. Renders as a 2x2 grid on the public portal labeled Tone Characteristics."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {draft.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender p-3 space-y-2">
            <input type="text" value={row.title} onChange={e => updateRow(i, { title: e.target.value })}
              placeholder="e.g. Warm"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm font-semibold text-deep-plum outline-none focus:border-primary-purple" />
            <textarea value={row.description} onChange={e => updateRow(i, { description: e.target.value })} rows={4}
              placeholder="What does this tone sound like in practice?"
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y" />
            <div className="text-right">
              <button type="button" onClick={() => removeRow(i)} className="text-[11px] text-purple-gray hover:text-red-500">Remove</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="rounded-xl border-2 border-dashed border-lavender py-8 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add tone characteristic
        </button>
      </div>
      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.voiceAttributes)} />
    </SectionCard>
  )
}

// ── Voice Guidelines (2x2 cards, parallel to Tone Characteristics) ────────

function VoiceGuidelinesSection({ bundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<VoiceGuidelineDraft[]>(bundle.voiceGuidelines)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(bundle.voiceGuidelines) }, [bundle.voiceGuidelines])

  const dirty = !rowsEqual(draft, bundle.voiceGuidelines, ['title', 'description'])

  const save = async () => {
    setSaving(true)
    try {
      await saveVoiceGuidelines(bundle.guide.id, draft, bundle.voiceGuidelines.map(v => v.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save voice guidelines') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { title: '', description: '' }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<VoiceGuidelineDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard
      icon={MessageCircle}
      title="Voice Guidelines"
      description="Longer-form voice principles (e.g. Sound Like Family on the Palouse). Renders as a 2x2 grid on the public portal labeled Voice Guidelines."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {draft.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender p-3 space-y-2">
            <input type="text" value={row.title} onChange={e => updateRow(i, { title: e.target.value })}
              placeholder="e.g. Sound Like Family on the Palouse"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm font-semibold text-deep-plum outline-none focus:border-primary-purple" />
            <textarea value={row.description} onChange={e => updateRow(i, { description: e.target.value })} rows={4}
              placeholder="Describe this voice principle — when it applies, what it sounds like, what to avoid."
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y" />
            <div className="text-right">
              <button type="button" onClick={() => removeRow(i)} className="text-[11px] text-purple-gray hover:text-red-500">Remove</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="rounded-xl border-2 border-dashed border-lavender py-8 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add voice guideline
        </button>
      </div>
      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.voiceGuidelines)} />
    </SectionCard>
  )
}

// ── Brand Attributes (short word list) ─────────────────────────────────────

function BrandAttributesSection({ bundle, onSaved, onError }: {
  bundle: BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [draft, setDraft] = useState<AttributeDraft[]>(bundle.attributes)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(bundle.attributes) }, [bundle.attributes])

  const dirty = !rowsEqual(draft, bundle.attributes, ['label', 'description'])

  const save = async () => {
    setSaving(true)
    try {
      await saveBrandAttributes(bundle.guide.id, draft, bundle.attributes.map(a => a.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save brand attributes') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { label: '', description: null }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<AttributeDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard icon={Sparkles} title="Brand Attributes" description="Short labeled attributes (Trustworthy, Playful, etc.). Optional descriptions.">
      <div className="space-y-2">
        {draft.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="rounded-xl border border-lavender p-3 grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-2 items-start">
            <input type="text" value={row.label} onChange={e => updateRow(i, { label: e.target.value })}
              placeholder="Trustworthy"
              className="rounded-lg border border-lavender px-3 py-1.5 text-sm font-semibold text-deep-plum outline-none focus:border-primary-purple" />
            <input type="text" value={row.description ?? ''} onChange={e => updateRow(i, { description: e.target.value || null })}
              placeholder="Optional description"
              className="rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
            <button type="button" onClick={() => removeRow(i)} className="text-purple-gray hover:text-red-500 p-1.5">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow}
          className="w-full rounded-xl border-2 border-dashed border-lavender py-2 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5">
          <Plus size={12} /> Add attribute
        </button>
      </div>
      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={() => setDraft(bundle.attributes)} />
    </SectionCard>
  )
}

// ── Ministries / subbrands ────────────────────────────────────────────────

function MinistriesSection({
  parentGuide, subbrands, createdBy, onSaved, onError, onOpen,
}: {
  parentGuide: StrategyBrandGuide
  subbrands: StrategyBrandGuide[]
  createdBy: string | null
  onSaved: () => Promise<void>
  onError: (msg: string) => void
  onOpen: (shortSlug: string) => void
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      const sub = await createSubbrand({
        parentGuide,
        displayName: trimmed,
        createdBy,
      })
      setName('')
      await onSaved()
      onOpen(subbrandShortSlug(sub))
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to create ministry')
    } finally {
      setCreating(false)
    }
  }

  return (
    <SectionCard
      icon={Layers}
      title="Ministries & Subbrands"
      description="Nested brand guides for Kids, Students, Preschool, and other ministry pages. Each has its own slug and public portal."
    >
      <div className="space-y-2 mb-4">
        {subbrands.length === 0 ? (
          <p className="text-xs text-purple-gray italic">No ministries yet. Add one below.</p>
        ) : (
          subbrands.map(sb => (
            <div
              key={sb.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-lavender bg-lavender-tint/20 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-deep-plum truncate">{sb.display_name}</p>
                <p className="text-[11px] text-purple-gray truncate">/brand/{sb.slug}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${
                  sb.is_published ? 'bg-green-100 text-green-700' : 'bg-purple-gray/10 text-purple-gray'
                }`}>
                  {sb.is_published ? 'Published' : 'Draft'}
                </span>
                <button
                  type="button"
                  onClick={() => onOpen(subbrandShortSlug(sb))}
                  className="inline-flex items-center gap-1 rounded-full bg-white border border-lavender text-deep-plum text-xs font-semibold px-3 py-1 hover:bg-lavender-tint transition-colors"
                >
                  Edit <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder="Ministry name (e.g. Kids, Students)"
          className="flex-1 min-w-[200px] rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || creating}
          className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-white text-xs font-semibold px-4 py-2 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add ministry
        </button>
      </div>
    </SectionCard>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compare two arrays of rows by id + specified string keys. Accepts arrays
 *  with any shape — only the listed keys are compared, and both sides must
 *  have them. Used to detect per-section dirty state without caring about
 *  Draft vs persisted row types. */
function rowsEqual(a: readonly unknown[], b: readonly unknown[], keys: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as Record<string, unknown>
    const bi = b[i] as Record<string, unknown>
    if (ai.id !== bi.id) return false
    for (const k of keys) {
      if (ai[k] !== bi[k]) return false
    }
  }
  return true
}
