import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, AlertCircle, Check, Link as LinkIcon, Loader2, Plus, Trash2, Upload, X,
  Palette, Type as TypeIcon, Image as ImageIcon, Sparkles, MessageCircle,
  Layers, FileText,
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
  subbrandShortSlug, slugify,
  saveLogos, saveColors, saveColorCombinations, saveTypography,
  saveElements, saveVoiceAttributes, saveVoiceGuidelines, saveBrandAttributes,
  createCustomSection, updateCustomSection, deleteCustomSection, saveCustomSectionEntries,
  type BrandGuideBundle, type LogoDraft, type ColorDraft, type CombinationDraft,
  type TypographyDraft, type ElementDraft, type VoiceAttributeDraft,
  type VoiceGuidelineDraft, type AttributeDraft,
  type CustomSectionEntryDraft,
} from '../lib/brandGuide'
import { uploadAttachment, AttachmentError } from '../lib/attachmentUpload'
import { isGoogleFont } from '../lib/googleFonts'
import { buildPortalUrl } from '../lib/portalUrl'
import { STYLE_TAG_OPTIONS } from '../lib/brandStyleTags'

const BRAND_BUCKET = 'brand-assets'
const LOGO_MIME = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
// Per-logo motion file. Lottie ships as JSON; videos / WebP+GIF
// covered for partners that didn't deliver a Lottie. Cap is enforced
// at upload time (40 MB).
const LOGO_ANIMATION_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'image/gif', 'application/json']
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
        <ColorsSection
          bundle={bundle}
          parentBundle={parentBundle}
          onGuideChange={(g) => setBundle({ ...bundle, guide: g })}
          onSaved={reload}
          onError={setError}
        />
        <ColorCombinationsSection bundle={bundle} onSaved={reload} onError={setError} />
        <TypographySection bundle={bundle} parentBundle={parentBundle} onSaved={reload} onError={setError} />
        <ElementsSection bundle={bundle} onSaved={reload} onError={setError} />
        {!isSubbrand && (
          <>
            <HandoffMetaSection
              guide={bundle.guide}
              onChange={(g) => setBundle({ ...bundle, guide: g })}
              onError={setError}
            />
            <VoicePrefillCard
              bundle={bundle}
              onPrefilled={reload}
              onError={setError}
            />
            <VoiceSection guide={bundle.guide} onChange={(g) => setBundle({ ...bundle, guide: g })} onError={setError} />
            <VoiceAttributesSection bundle={bundle} onSaved={reload} onError={setError} />
            <VoiceGuidelinesSection bundle={bundle} onSaved={reload} onError={setError} />
            <BrandAttributesSection bundle={bundle} onSaved={reload} onError={setError} />
            <CustomSectionsSection bundle={bundle} onSaved={reload} onError={setError} />
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

  const portalUrl = buildPortalUrl(guide.slug)

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

      {/* Animations URL — external link (Dropbox / Drive). Animations
          don't fit inside the bulk zip (file size cap), so we keep them
          as a separate URL field that renders as its own affordance
          on the portal. */}
      <AnimationsUrlField
        guide={guide}
        onChange={onChange}
        onError={() => { /* handled by parent error banner */ }}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-purple-gray flex items-center gap-2 flex-wrap">
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
          {/* Edit URL affordance: staff-only, unpublished-only. Published
              guides are out in the wild (partner emails, business cards)
              — we never rename those. Subbrand slugs also stay locked
              because re-slugging the parent or any sibling would cascade
              in ways the editor doesn't show today; this MVP scopes to
              renaming MAIN guides only. */}
          {!guide.is_published && !guide.parent_id && (
            <SlugRenameAffordance guide={guide} onChange={onChange} onError={onError} />
          )}
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

// ── Slug rename affordance (unpublished main guides only) ─────────────────
//
// Lets staff change the URL of an unpublished brand guide before it goes
// public. Published guides are locked — their URLs are out in partner
// emails, business cards, etc. Subbrand guides are also locked here
// (rename would cascade through the parent's slug); MVP scopes to main
// guides only.
//
// Collision handling is identical to generateUniqueSlug's chain — the
// user types a base; we check for collisions and either accept the
// typed slug or surface the conflict. We do NOT auto-suffix the user's
// input because they're typing the URL they want; surfacing the
// collision lets them pick a different name.

function SlugRenameAffordance({
  guide, onChange, onError,
}: {
  guide:    StrategyBrandGuide
  onChange: (guide: StrategyBrandGuide) => void
  onError:  (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(guide.slug)
  const [saving, setSaving] = useState(false)
  const [validationErr, setValidationErr] = useState<string | null>(null)

  // Reset the draft + clear error when the popover opens, in case the
  // slug got updated externally (e.g. another tab saved a change).
  useEffect(() => {
    if (open) {
      setDraft(guide.slug)
      setValidationErr(null)
    }
  }, [open, guide.slug])

  const trimmed = draft.trim()
  const changed = trimmed !== guide.slug
  // Allow letters, digits, hyphens, and slashes (for state-prefixed
  // shapes like tx/lakeway). Reject any other character so we don't
  // accidentally write a malformed slug to the DB.
  const looksValid = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(trimmed) && trimmed.length > 0

  const save = async () => {
    if (!changed) { setOpen(false); return }
    if (!looksValid) {
      setValidationErr('Slug can only include lowercase letters, digits, hyphens, and slashes.')
      return
    }
    setSaving(true)
    setValidationErr(null)
    try {
      // Check collision: any OTHER guide already using this exact slug?
      const { data: collision } = await supabase
        .from('strategy_brand_guides')
        .select('id')
        .eq('slug', trimmed)
        .neq('id', guide.id)
        .maybeSingle()
      if (collision) {
        setValidationErr(`Another guide already uses ${trimmed}. Pick a different name.`)
        setSaving(false)
        return
      }
      const next = await updateGuideMeta(guide.id, { slug: trimmed } as Partial<StrategyBrandGuide>)
      onChange(next)
      setOpen(false)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to rename slug')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-primary-purple hover:underline font-semibold"
        title="Rename the slug for this draft guide. Disabled once published."
      >
        Edit URL
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 bg-white border border-lavender rounded-lg px-2 py-1">
      <span className="text-[10px] text-purple-gray">/brand/</span>
      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value.toLowerCase()); setValidationErr(null) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void save() }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
        }}
        autoFocus
        spellCheck={false}
        className="text-[11px] font-mono text-deep-plum bg-transparent outline-none min-w-[160px]"
        placeholder="tx/lakeway"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !changed}
        className="text-[10px] font-semibold text-primary-purple hover:text-deep-plum disabled:opacity-40"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] text-purple-gray hover:text-deep-plum"
      >
        Cancel
      </button>
      {validationErr && (
        <span className="text-[10px] text-red-600 ml-1">{validationErr}</span>
      )}
      {!validationErr && changed && looksValid && (
        <span className="text-[10px] text-purple-gray ml-1">
          Suggested: <code className="bg-lavender-tint px-1 rounded">{slugify(trimmed) || trimmed}</code>
        </span>
      )}
    </div>
  )
}

// ── Animations URL field ──────────────────────────────────────────────────
//
// Brand team can't fit animations inside the bulk-assets zip (200 MB cap
// on upload + animations are routinely larger than that). Instead they
// drop a Dropbox / Drive / Cloudinary link here and the partner portal
// renders it as its own affordance. URL field only — no file upload,
// no parsing.

function AnimationsUrlField({ guide, onChange, onError }: {
  guide:    StrategyBrandGuide
  onChange: (guide: StrategyBrandGuide) => void
  onError:  (msg: string) => void
}) {
  const [draft, setDraft] = useState(guide.animations_url ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(guide.animations_url ?? '') }, [guide.animations_url])

  const dirty = (draft.trim() || null) !== (guide.animations_url ?? null)

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const next = await updateGuideMeta(guide.id, { animations_url: draft.trim() || null })
      onChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to save animations URL')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-lavender/70 bg-lavender-tint/20 p-3 mb-3">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray">Animations link</p>
          <p className="text-xs text-deep-plum mt-0.5">
            {guide.animations_url
              ? 'Linked — visible as "View animations" on the public portal.'
              : 'Optional — Dropbox / Drive / Cloudinary link. Animations are too big for the bulk zip, so we link out instead.'}
          </p>
        </div>
        {guide.animations_url && (
          <a href={guide.animations_url} target="_blank" rel="noopener noreferrer"
            className="shrink-0 text-[11px] text-primary-purple hover:underline font-semibold">
            View current
          </a>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="url"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="https://www.dropbox.com/sh/…  or  https://drive.google.com/drive/folders/…"
          className="flex-1 min-w-[260px] rounded-lg border border-lavender bg-white px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1 rounded-full bg-deep-plum text-cream text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save
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

/** On-color examples editor — staff curates WHICH brand colors get an
 *  on-color logo example for the portal. Tiles render only for
 *  colors with a logo uploaded; an "Add" affordance opens a palette
 *  picker for staff to choose the next color to upload against, and a
 *  Remove button per tile clears the example.
 *
 *  Storage stays the existing per-color `on_color_logo_url` /
 *  `on_color_logo_scale_pct` columns — no new table. Adding == clicking
 *  a color tile, which triggers the file upload for that color row.
 *  Removing == setting the URL back to null. */
function OnColorExamplesEditor({
  draft, onColorIdx, pickOnColor, updateColor, onColorInputRef, handleOnColor,
}: {
  draft:           ColorDraft[]
  onColorIdx:      number | null
  pickOnColor:     (i: number) => void
  updateColor:     (i: number, patch: Partial<ColorDraft>) => void
  onColorInputRef: React.RefObject<HTMLInputElement | null>
  handleOnColor:   (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const [adding, setAdding] = useState(false)
  // Reasonable pseudo-StrategyBrandColor list to feed the picker. We
  // re-shape ColorDraft (which lacks `id` for new rows) so the picker's
  // key-by-id contract stays consistent. New (unsaved) colors aren't
  // pickable until they have an id from the DB save.
  const pickableColors = draft.filter(c => c.id) as unknown as import('../types/database').StrategyBrandColor[]

  const populated = draft
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => Boolean(c.on_color_logo_url))

  const onPickColorForAdd = (hex: string | null) => {
    if (!hex) return
    const targetIdx = draft.findIndex(d => d.hex && d.hex.toLowerCase() === hex.toLowerCase())
    if (targetIdx === -1) return
    pickOnColor(targetIdx)   // sets state + triggers file picker
    setAdding(false)
  }

  return (
    <div className="rounded-xl border border-lavender/60 bg-lavender-tint/20 p-3 mb-4">
      <input ref={onColorInputRef} type="file" className="hidden" accept={LOGO_MIME.join(',')} onChange={handleOnColor} />
      <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray mb-1">On-Color Logos</p>
      <p className="text-[11px] text-purple-gray mb-3">
        Show the logo as it should appear on specific brand colors. Add the colors that need a custom on-color logo — light logos on dark backgrounds, dark logos on light, etc. Colors without a tile here are skipped on the portal.
      </p>

      {populated.length === 0 && !adding && (
        <p className="text-[11px] italic text-purple-gray mb-2">
          No on-color examples yet.
        </p>
      )}

      {populated.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-2">
          {populated.map(({ c, i }) => (
            <div key={`onc-${c.id ?? i}`} className="flex items-center gap-2 rounded-lg border border-lavender/60 bg-white p-2">
              <div
                className="h-12 w-12 rounded shrink-0 flex items-center justify-center overflow-hidden border border-lavender/50"
                style={{ backgroundColor: c.hex }}
              >
                {c.on_color_logo_url!.endsWith('.mp4')
                  ? <video src={c.on_color_logo_url!} className="max-h-10 max-w-full" muted loop autoPlay playsInline />
                  : <img src={c.on_color_logo_url!} alt="on-color logo" className="max-h-10 max-w-full object-contain" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-deep-plum truncate">{c.name ?? c.hex}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    type="button"
                    onClick={() => pickOnColor(i)}
                    className="text-[11px] text-primary-purple hover:underline font-semibold inline-flex items-center gap-0.5"
                  >
                    {onColorIdx === i ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => updateColor(i, { on_color_logo_url: null })}
                    className="text-[11px] text-purple-gray hover:text-red-500 inline-flex items-center gap-0.5"
                    title="Remove this on-color example"
                  >
                    <Trash2 size={10} /> Remove
                  </button>
                </div>
                {/* Scale slider — 25-150% to balance varied logo sizes
                    across the on-color grid. */}
                <div className="mt-1 flex items-center gap-1.5">
                  <label className="text-[10px] text-purple-gray uppercase tracking-wider font-bold">Scale</label>
                  <input
                    type="range"
                    min={25}
                    max={150}
                    step={5}
                    value={c.on_color_logo_scale_pct ?? 100}
                    onChange={e => updateColor(i, { on_color_logo_scale_pct: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-primary-purple"
                    title={`${c.on_color_logo_scale_pct ?? 100}%`}
                  />
                  <span className="text-[10px] text-purple-gray font-mono w-9 text-right">
                    {c.on_color_logo_scale_pct ?? 100}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add affordance — palette swatch picker (only the colors not
          already on the on-color list) → click a swatch opens the
          file upload for that color row. */}
      {adding ? (
        <div className="rounded-lg border border-primary-purple/30 bg-white p-2.5">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary-purple">
              Pick a brand color
            </p>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[11px] text-purple-gray hover:text-deep-plum"
            >
              Cancel
            </button>
          </div>
          {pickableColors.filter(c => !c.on_color_logo_url).length === 0 ? (
            <p className="text-[11px] italic text-purple-gray">
              All brand colors already have an on-color logo. Remove one first to swap.
            </p>
          ) : (
            <BrandPaletteSwatchPicker
              value={null}
              colors={pickableColors.filter(c => !c.on_color_logo_url)}
              onChange={onPickColorForAdd}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={pickableColors.filter(c => !c.on_color_logo_url).length === 0}
          className="w-full rounded-lg border-2 border-dashed border-lavender py-2.5 text-xs font-semibold text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title={pickableColors.filter(c => !c.on_color_logo_url).length === 0
            ? 'All saved brand colors already have an on-color logo'
            : undefined}
        >
          <Plus size={12} /> Add on-color example
        </button>
      )}
    </div>
  )
}

/** Horizontal row of swatches sourced from the brand's color palette.
 *  Click a swatch to set the value; click the currently selected one
 *  again to clear (null). Includes a small "no color / default" tile
 *  at the start so partners can explicitly opt out of a custom bg
 *  without leaving the picker mid-state.
 *
 *  Used by:
 *    • Logo display-background picker (LogosSection)
 *    • On-color logo bg picker (ColorsSection)
 *  Pulls from `bundle.colors` so the picker always reflects the
 *  brand's current palette — colors added or removed in the Color
 *  section appear/disappear here automatically. */
function BrandPaletteSwatchPicker({
  value, colors, onChange,
}: {
  value:    string | null
  colors:   import('../types/database').StrategyBrandColor[]
  onChange: (hex: string | null) => void
}) {
  const normalized = (value ?? '').toLowerCase()
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Default / clear tile — gridded white with diagonal slash. */}
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Default (white)"
        aria-pressed={!value}
        className={`relative h-8 w-8 rounded-full transition-all overflow-hidden ${
          !value
            ? 'ring-2 ring-primary-purple ring-offset-1 scale-110'
            : 'ring-1 ring-lavender hover:ring-primary-purple/40'
        }`}
        style={{ background: '#ffffff' }}
      >
        <span
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to top right, transparent 47%, rgba(168,168,184,0.7) 48%, rgba(168,168,184,0.7) 52%, transparent 53%)',
          }}
        />
      </button>
      {colors.length === 0 && (
        <span className="text-[11px] italic text-purple-gray ml-1">
          Add brand colors first to pick from your palette.
        </span>
      )}
      {colors.map(c => {
        const isSelected = c.hex && c.hex.toLowerCase() === normalized
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(isSelected ? null : c.hex)}
            title={`${c.name ?? c.hex} (${c.hex})`}
            aria-pressed={isSelected}
            className={`h-8 w-8 rounded-full transition-all ${
              isSelected
                ? 'ring-2 ring-primary-purple ring-offset-1 scale-110'
                : 'ring-1 ring-lavender hover:ring-primary-purple/40'
            }`}
            style={{ backgroundColor: c.hex }}
          />
        )
      })}
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
  const animationInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)
  const [uploadingAnimationIdx, setUploadingAnimationIdx] = useState<number | null>(null)

  useEffect(() => { setDraft(bundle.logos) }, [bundle.logos])

  const dirty = !rowsEqual(draft, bundle.logos, ['kind', 'label', 'preview_url', 'download_url', 'animation_url', 'background_color', 'clear_space_note'])

  const save = async () => {
    setSaving(true)
    try {
      await saveLogos(bundle.guide.id, draft, bundle.logos.map(l => l.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save logos') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { kind: 'primary', label: staffName ? `${staffName}'s Logo` : 'Logo', preview_url: '', download_url: null, animation_url: null, background_color: null, clear_space_note: null }])
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

  // Animation upload — separate path so the still preview and the
  // motion file are tracked independently. Larger size cap (40 MB)
  // because partner-supplied motion logos are routinely heavier than
  // a still SVG/PNG.
  const pickAnimation = (i: number) => { setUploadingAnimationIdx(i); animationInputRef.current?.click() }
  const handleAnimation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploadingAnimationIdx == null) return
    const idx = uploadingAnimationIdx
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${bundle.guide.id}/logos/animations`,
        allowedMime: LOGO_ANIMATION_MIME,
        maxBytes: 40 * 1024 * 1024,
      })
      updateRow(idx, { animation_url: result.url })
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploadingAnimationIdx(null)
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
      <input
        ref={animationInputRef} type="file" className="hidden"
        accept={LOGO_ANIMATION_MIME.join(',')}
        onChange={handleAnimation}
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
              <Field label="Download URL (optional)">
                <input type="url" value={row.download_url ?? ''} onChange={e => updateRow(i, { download_url: e.target.value || null })}
                  placeholder="https://www.dropbox.com/…"
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
                <p className="mt-1 text-[11px] text-purple-gray/80">
                  We'll automatically use the uploaded preview as the download. Set this to override with a Dropbox / Drive link if you want partners to grab a different file.
                </p>
              </Field>
              <Field label="Clear space note (optional)">
                <input type="text" value={row.clear_space_note ?? ''} onChange={e => updateRow(i, { clear_space_note: e.target.value || null })}
                  placeholder="Maintain clear space equal to the height of the 'R' on all sides."
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
              </Field>
              {/* Display background — render this logo against the
                  chosen color on the public portal. Picks from the
                  brand palette so on-brand colors stay consistent
                  across logo cards and on-color showcases. */}
              <Field label="Display background (optional)">
                <BrandPaletteSwatchPicker
                  value={row.background_color}
                  colors={bundle.colors}
                  onChange={hex => updateRow(i, { background_color: hex })}
                />
                <p className="mt-1 text-[11px] text-purple-gray/80">
                  Defaults to white on the portal. Pick a brand color when the logo needs contrast (e.g. white logo on navy). Click the selected color again to clear.
                </p>
              </Field>
              {/* Per-logo animation file. Optional — partners often
                  ship motion versions for the primary + the badge but
                  not every variant. Renders as a video tile alongside
                  the still on the public portal + handoff. */}
              <Field label="Logo animation (optional)">
                <div className="flex items-center gap-2 flex-wrap">
                  {row.animation_url ? (
                    <>
                      <a
                        href={row.animation_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-primary-purple hover:underline font-semibold truncate max-w-[200px]"
                      >
                        {row.animation_url.split('/').pop() ?? 'Animation file'}
                      </a>
                      <button
                        type="button"
                        onClick={() => pickAnimation(i)}
                        disabled={uploadingAnimationIdx === i}
                        className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-[11px] font-semibold text-deep-plum px-2.5 py-1 hover:border-primary-purple hover:text-primary-purple disabled:opacity-60"
                      >
                        {uploadingAnimationIdx === i ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        {uploadingAnimationIdx === i ? 'Uploading…' : 'Replace'}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRow(i, { animation_url: null })}
                        className="text-[11px] text-purple-gray hover:text-red-500"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => pickAnimation(i)}
                      disabled={uploadingAnimationIdx === i}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-lavender bg-white text-[11px] font-semibold text-deep-plum px-3 py-1 hover:border-primary-purple hover:text-primary-purple disabled:opacity-60"
                    >
                      {uploadingAnimationIdx === i ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      {uploadingAnimationIdx === i ? 'Uploading…' : 'Upload animation (mp4 / webm / Lottie JSON)'}
                    </button>
                  )}
                </div>
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

// Partner-facing tier values only — `background` / `text` are now
// staff-only `interface_role` flags (see ColorDraft.interface_role).
const COLOR_TIERS: BrandColorTier[] = ['primary', 'secondary', 'accent', 'light', 'dark']
const TIER_LABEL: Record<BrandColorTier, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  light: 'Light', dark: 'Dark',
}

const INTERFACE_ROLES: Array<'background' | 'text'> = ['background', 'text']
const INTERFACE_ROLE_LABEL: Record<'background' | 'text', string> = {
  background: 'Page background',
  text:       'Body text',
}

function ColorsSection({ bundle, parentBundle, onGuideChange, onSaved, onError }: {
  bundle: BrandGuideBundle
  parentBundle?: BrandGuideBundle | null
  /** Direct guide-row patch channel — used by the ASE swatch upload, which
   *  writes to `strategy_brand_guides.ase_swatch_url` rather than to the
   *  color rows themselves. */
  onGuideChange: (next: import('../types/database').StrategyBrandGuide) => void
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
  // ── .ase swatch upload (Adobe Swatch Exchange) ─────────────────────────
  const [uploadingAse, setUploadingAse] = useState(false)
  const aseInputRef = useRef<HTMLInputElement | null>(null)

  const pickAse = () => aseInputRef.current?.click()
  const handleAse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Browsers almost never send a useful MIME for .ase — they report empty
    // string or application/octet-stream. Validate on extension.
    if (!/\.ase$/i.test(file.name)) {
      onError('Please select an Adobe Swatch Exchange (.ase) file.')
      return
    }
    setUploadingAse(true)
    try {
      const result = await uploadAttachment(file, null, undefined, {
        bucket: BRAND_BUCKET,
        pathPrefix: `${bundle.guide.id}/swatch`,
        allowedMime: ['application/octet-stream', ''],
        maxBytes: 2 * 1024 * 1024,
      })
      const next = await updateGuideMeta(bundle.guide.id, { ase_swatch_url: result.url })
      onGuideChange(next)
    } catch (err) {
      const msg = err instanceof AttachmentError ? err.message : (err as { message?: string })?.message ?? 'Upload failed'
      onError(msg)
    } finally {
      setUploadingAse(false)
    }
  }
  const clearAse = async () => {
    try {
      const next = await updateGuideMeta(bundle.guide.id, { ase_swatch_url: null })
      onGuideChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to clear swatch')
    }
  }

  useEffect(() => { setDraft(bundle.colors) }, [bundle.colors])

  const dirty = !rowsEqual(draft, bundle.colors, ['name', 'tier', 'hex', 'cmyk', 'rgb', 'pms', 'proportion_pct', 'on_color_logo_url', 'on_color_logo_scale_pct'])

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
      name: newName.trim() || null, tier: newTier, interface_role: null,
      hex: newHex.toLowerCase(),
      cmyk: null, rgb: null, pms: null, proportion_pct: null,
      on_color_logo_url: null, on_color_logo_scale_pct: 100,
    }])
    setNewHex('#')
    setNewName('')
  }

  const removeColor = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateColor = (i: number, patch: Partial<ColorDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  // Switched from tier='background'/'text' to interface_role —
  // partner-facing tier and staff-only interface role are now decoupled.
  const hasBackground = draft.some(c => c.interface_role === 'background')
  const hasText       = draft.some(c => c.interface_role === 'text')
  const missingCore = !hasBackground || !hasText

  return (
    <SectionCard
      icon={Palette}
      title="Color Palette"
      description="Tier drives the hierarchy partners see on the public portal (Primary / Secondary / Accent / Light / Dark). The per-color interface role (Page background / Body text) is a separate, staff-only setting that controls how the portal themes itself — it doesn't relabel the color on the public palette."
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
                name: c.name, tier: c.tier, interface_role: c.interface_role,
                hex: c.hex, cmyk: c.cmyk, rgb: c.rgb,
                pms: c.pms, proportion_pct: c.proportion_pct,
                on_color_logo_url: c.on_color_logo_url,
                on_color_logo_scale_pct: c.on_color_logo_scale_pct,
              })),
            ])
          }}
        />
      )}
      {missingCore && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 mb-4 flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-700" />
          <div>
            <p className="font-semibold">Heads up — set the interface role for one background + one text color.</p>
            <p className="mt-0.5">
              The public portal uses these flags to theme itself (page background + body text). They don't change how the colors appear in the partner palette — pick whichever swatch should drive the portal's own chrome.
              {!hasBackground && <> <span className="font-semibold">Background role unset.</span></>}
              {!hasText && <> <span className="font-semibold">Text role unset.</span></>}
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
                {/* Staff-only interface role — does NOT affect the
                    partner-facing tier label. */}
                <select
                  value={c.interface_role ?? ''}
                  onChange={e => updateColor(i, { interface_role: (e.target.value || null) as ColorDraft['interface_role'] })}
                  className="mt-1 text-[10px] text-purple-gray bg-transparent outline-none hover:text-deep-plum italic"
                  title="Staff-only — flag this swatch as the portal's page background or body text color. Doesn't change the partner palette label."
                >
                  <option value="">No interface role</option>
                  {INTERFACE_ROLES.map(r => <option key={r} value={r}>{INTERFACE_ROLE_LABEL[r]}</option>)}
                </select>
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

          {/* On-Color Logos — partner picks WHICH brand colors get an
              on-color logo example. Previously every color row showed
              an upload slot which cluttered the editor when only a
              couple of colors actually needed it. Now: tiles render
              only for colors that HAVE a logo set, with a Remove
              button per tile and a palette-picker affordance for
              adding new on-color examples. */}
          <OnColorExamplesEditor
            draft={draft}
            onColorIdx={onColorIdx}
            pickOnColor={pickOnColor}
            updateColor={updateColor}
            onColorInputRef={onColorInputRef}
            handleOnColor={handleOnColor}
          />
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

      {/* Adobe Swatch Exchange (.ase) — designer-friendly one-click palette import */}
      <div className="mt-4 rounded-xl border border-lavender/70 bg-lavender-tint/20 p-3 flex items-center justify-between gap-3 flex-wrap">
        <input ref={aseInputRef} type="file" className="hidden" accept=".ase,application/octet-stream" onChange={handleAse} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-gray">Color swatch (.ase)</p>
          <p className="text-xs text-deep-plum mt-0.5">
            {bundle.guide.ase_swatch_url ? 'Uploaded — designers can import the full palette into Photoshop / Illustrator in one click.' : 'Optional — Adobe Swatch Exchange file. Appears as a "Download .ase swatch" button on the public portal and internal handoff.'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {bundle.guide.ase_swatch_url && (
            <a href={bundle.guide.ase_swatch_url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary-purple hover:underline font-semibold">
              View current
            </a>
          )}
          <button type="button" onClick={pickAse} disabled={uploadingAse}
            className="inline-flex items-center gap-1 rounded-full border border-lavender bg-white text-xs font-semibold text-deep-plum px-3 py-1.5 hover:bg-lavender-tint disabled:opacity-50">
            {uploadingAse ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {bundle.guide.ase_swatch_url ? 'Replace' : 'Upload .ase'}
          </button>
          {bundle.guide.ase_swatch_url && (
            <button type="button" onClick={clearAse}
              className="text-[11px] text-purple-gray hover:text-red-500 px-2 py-1">Clear</button>
          )}
        </div>
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

const TYPE_TIERS: BrandTypographyTier[] = ['primary', 'subheading', 'secondary', 'accent']
const TYPE_TIER_LABEL: Record<BrandTypographyTier, string> = {
  primary: 'Heading', subheading: 'Sub-heading', secondary: 'Body', accent: 'Accent',
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

  const dirty = !rowsEqual(draft, bundle.typography, [
    'tier', 'family_name',
    'weight', 'weight_label',
    'suggested_use', 'letter_case',
    'font_url',
    'custom_font_purchase_url',
    'free_alt_family', 'free_alt_font_url',
    'web_font_family',
  ])

  const save = async () => {
    setSaving(true)
    try {
      await saveTypography(bundle.guide.id, draft, bundle.typography.map(t => t.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save typography') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, {
    tier: 'primary', family_name: '',
    weight: null, weight_label: null,
    suggested_use: null, letter_case: null,
    font_url: null,
    custom_font_purchase_url: null,
    free_alt_family: null, free_alt_font_url: null,
    web_font_family: null,
  }])
  const removeRow = (i: number) => setDraft(draft.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TypographyDraft>) => setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <SectionCard
      icon={TypeIcon}
      title="Typography"
      description="One row per font role. Google Fonts auto-load from the family name; non-Google fonts need a licensed webfont file before the portal can show a sample."
    >
      {/* Shared autocomplete suggestions for weight label + display case. */}
      <datalist id="weight-label-suggestions">
        <option value="Light" />
        <option value="Regular" />
        <option value="Medium" />
        <option value="Semibold" />
        <option value="Bold" />
        <option value="Extra Bold" />
        <option value="Black" />
      </datalist>
      <datalist id="letter-case-suggestions">
        <option value="UPPERCASE" />
        <option value="lowercase" />
        <option value="Title Case" />
        <option value="Sentence case" />
        <option value="Mixed" />
      </datalist>

      {parentBundle && (
        <LoadFromParentBar
          parentName={parentBundle.guide.display_name}
          disabled={parentBundle.typography.length === 0}
          label="Load fonts from"
          onLoad={() => {
            setDraft(prev => [
              ...prev,
              ...parentBundle.typography.map(t => ({
                tier: t.tier, family_name: t.family_name,
                weight: t.weight, weight_label: t.weight_label,
                suggested_use: t.suggested_use, letter_case: t.letter_case,
                font_url: t.font_url,
                custom_font_purchase_url: t.custom_font_purchase_url,
                free_alt_family: t.free_alt_family, free_alt_font_url: t.free_alt_font_url,
                web_font_family: t.web_font_family,
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

  // Auto-prefill web_font_family when either signal says "this family is a
  // Google Font" — the user pasted a Google Fonts URL, OR the family name
  // alone matches our known Google Fonts list. Only fires when the web
  // family is empty so manual entries are never overwritten.
  useEffect(() => {
    if (row.web_font_family?.trim()) return
    if (!row.family_name?.trim()) return
    const urlIsGoogle = row.font_url && /fonts\.googleapis\.com/i.test(row.font_url)
    const nameIsGoogleFont = isGoogleFont(row.family_name)
    if (!urlIsGoogle && !nameIsGoogleFont) return
    onChange({ web_font_family: row.family_name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.font_url, row.family_name])

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

  const hasCustomPurchase = !!row.custom_font_purchase_url?.trim()
  const freeAltMissing = hasCustomPurchase && !(row.free_alt_family?.trim() && row.free_alt_font_url?.trim())
  const webFontMissing = !row.web_font_family?.trim()

  return (
    <div className="rounded-xl border border-lavender p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-start">
      <div className="space-y-3">
        {/* ── Top metadata ─────────────────────────────────────── */}
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
          <Field label="Weights (technical)">
            <input type="text" value={row.weight ?? ''} onChange={e => onChange({ weight: e.target.value || null })}
              placeholder="400, 700"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          </Field>
          <Field label="Weight label (client-friendly)">
            <input
              type="text"
              list="weight-label-suggestions"
              value={row.weight_label ?? ''}
              onChange={e => onChange({ weight_label: e.target.value || null })}
              placeholder="Bold"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Suggested use">
            <input type="text" value={row.suggested_use ?? ''} onChange={e => onChange({ suggested_use: e.target.value || null })}
              placeholder="Headlines"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          </Field>
          <Field label="Display case">
            <input
              type="text"
              list="letter-case-suggestions"
              value={row.letter_case ?? ''}
              onChange={e => onChange({ letter_case: e.target.value || null })}
              placeholder="Title Case"
              className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple"
            />
          </Field>
        </div>

        <FontStatusRow status={status} family={row.family_name} fontUrl={row.font_url} />

        {/* ── 1. Open-source source ────────────────────────────── */}
        <div className="rounded-lg border border-lavender bg-white p-2.5 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-purple-gray">
              1. Open-source source
            </p>
            <p className="text-[10px] text-purple-gray/60">Google Font link or uploaded webfont file</p>
          </div>
          <input type="url" value={row.font_url ?? ''} onChange={e => onChange({ font_url: e.target.value || null })}
            placeholder="https://fonts.googleapis.com/css2?family=…"
            className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple font-mono text-xs" />
          {/* Inline upload flow (with license confirmation) for when the
               church is self-hosting a webfont file they have rights to. */}
          <details className="text-[11px]">
            <summary className="cursor-pointer text-purple-gray hover:text-deep-plum inline-flex items-center gap-1">
              <Upload size={10} /> Upload a webfont file instead
            </summary>
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 space-y-2">
              <label className="flex items-start gap-2 text-amber-900 cursor-pointer">
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
          </details>
        </div>

        {/* ── 2. Custom paid font ──────────────────────────────── */}
        <div className="rounded-lg border border-lavender bg-white p-2.5 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-purple-gray">
              2. Custom paid font <span className="text-purple-gray/60 font-normal">(optional)</span>
            </p>
          </div>
          <input type="url" value={row.custom_font_purchase_url ?? ''}
            onChange={e => onChange({ custom_font_purchase_url: e.target.value || null })}
            placeholder="https://typography.com/fonts/…"
            className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple font-mono text-xs" />
          <p className="text-[11px] text-purple-gray/80 leading-relaxed">
            If the brand uses a paid typeface, drop the purchase page here.
            Custom font licenses are a one-time investment that honors the
            typographer's craft and keeps the church's design work rights-clean.
            We'll show partners a friendly link to purchase when they visit
            the brand guide.
          </p>
        </div>

        {/* ── 3. Free alternative (only when paid font is specified) ── */}
        {hasCustomPurchase && (
          <div className={`rounded-lg border p-2.5 space-y-2 ${
            freeAltMissing ? 'border-amber-300 bg-amber-50' : 'border-lavender bg-white'
          }`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-purple-gray">
                3. Free alternative <span className="text-red-600 font-normal">required</span>
              </p>
            </div>
            <p className="text-[11px] text-purple-gray leading-relaxed">
              Royalty-free fallback for when the paid font isn't licensed.
              Downstream design + web work uses this when the license is missing.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Family name">
                <input type="text" value={row.free_alt_family ?? ''}
                  onChange={e => onChange({ free_alt_family: e.target.value || null })}
                  placeholder="Montserrat"
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
              </Field>
              <Field label="Download / Google Fonts URL">
                <input type="url" value={row.free_alt_font_url ?? ''}
                  onChange={e => onChange({ free_alt_font_url: e.target.value || null })}
                  placeholder="https://fonts.googleapis.com/css2?family=Montserrat"
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple font-mono text-xs" />
              </Field>
            </div>
            {freeAltMissing && (
              <p className="text-[11px] text-amber-900 flex items-center gap-1">
                <AlertCircle size={11} /> Both a family name and a download URL are needed.
              </p>
            )}
          </div>
        )}

        {/* ── 4. Web font family (always required) ─────────────── */}
        <div className={`rounded-lg border p-2.5 space-y-2 ${
          webFontMissing ? 'border-amber-300 bg-amber-50' : 'border-lavender bg-white'
        }`}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-purple-gray">
              4. Web font family <span className="text-red-600 font-normal">required</span>
            </p>
          </div>
          <p className="text-[11px] text-purple-gray leading-relaxed">
            The CSS family name the online brand guide and downstream web squad
            projects render text in. Auto-fills from the family name above when
            you paste a Google Fonts link in section 1.
          </p>
          <input type="text" value={row.web_font_family ?? ''}
            onChange={e => onChange({ web_font_family: e.target.value || null })}
            placeholder={row.family_name || 'Inter'}
            className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple" />
          {webFontMissing && (
            <p className="text-[11px] text-amber-900 flex items-center gap-1">
              <AlertCircle size={11} /> Please set this — the online guide can't render without a web family.
            </p>
          )}
        </div>
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

  const dirty = !rowsEqual(draft, bundle.elements, ['kind', 'label', 'preview_url', 'download_url', 'pattern_background_color'])

  const save = async () => {
    setSaving(true)
    try {
      await saveElements(bundle.guide.id, draft, bundle.elements.map(e => e.id))
      await onSaved()
    } catch (err) { onError((err as { message?: string })?.message ?? 'Failed to save elements') }
    finally { setSaving(false) }
  }

  const addRow = () => setDraft([...draft, { kind: 'pattern', label: null, preview_url: null, download_url: null, pattern_background_color: null }])
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
            {/* Preview tile honors `pattern_background_color` so low-
                opacity patterns stay visible against a real backdrop. */}
            <div
              className="h-28 rounded-lg border border-lavender flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: row.pattern_background_color ?? '' }}
            >
              {row.preview_url ? (
                <img src={row.preview_url} alt={row.label ?? 'Element'} className="max-h-full max-w-full object-contain" />
              ) : (
                <button type="button" onClick={() => pickFile(i)} className="text-xs text-purple-gray hover:text-primary-purple font-semibold flex flex-col items-center gap-1">
                  {uploadingIdx === i ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploadingIdx === i ? 'Uploading…' : 'Upload preview'}
                </button>
              )}
            </div>
            {/* Background-color picker for the preview tile (and the
                portal render). Optional — leave empty for the default
                lavender tint. */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-purple-gray shrink-0">Backdrop</label>
              <input
                type="color"
                value={row.pattern_background_color ?? '#ffffff'}
                onChange={e => updateRow(i, { pattern_background_color: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded border border-lavender p-0.5"
                title="Preview background"
              />
              <input
                type="text"
                value={row.pattern_background_color ?? ''}
                onChange={e => updateRow(i, { pattern_background_color: e.target.value || null })}
                placeholder="#hex (optional)"
                className="flex-1 rounded-lg border border-lavender px-2 py-1 text-[12px] font-mono text-deep-plum outline-none focus:border-primary-purple"
              />
              {row.pattern_background_color && (
                <button
                  type="button"
                  onClick={() => updateRow(i, { pattern_background_color: null })}
                  className="text-[10px] text-purple-gray hover:text-red-500"
                  title="Clear"
                >
                  Clear
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
 * Handoff metadata section — staff-only classifiers the brand squad sets
 * to help Graphics/Video/Social/Web squads pick up a project faster. Data
 * surfaces on the `/branding/{token}` handoff doc's Overview tab.
 *
 *  - Style tags: controlled vocabulary from STYLE_TAG_OPTIONS, rendered as
 *    toggleable chips. Nothing blocks a user from leaving it empty.
 *  - Handoff notes: short free-text brief (1–3 sentences) shown alongside
 *    the logo/color/font quick-reference.
 */
function HandoffMetaSection({ guide, onChange, onError }: {
  guide: StrategyBrandGuide
  onChange: (g: StrategyBrandGuide) => void
  onError: (msg: string) => void
}) {
  const initialTags = (guide.style_tags ?? []) as string[]
  const [tags, setTags] = useState<string[]>(initialTags)
  const [notes, setNotes] = useState(guide.handoff_notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setTags((guide.style_tags ?? []) as string[]) }, [guide.style_tags])
  useEffect(() => { setNotes(guide.handoff_notes ?? '') }, [guide.handoff_notes])

  const tagsEqual = tags.length === initialTags.length && tags.every(t => initialTags.includes(t))
  const dirty = !tagsEqual || notes !== (guide.handoff_notes ?? '')

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await updateGuideMeta(guide.id, {
        style_tags: tags,
        handoff_notes: notes.trim() || null,
      })
      onChange(next)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to save handoff metadata')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setTags((guide.style_tags ?? []) as string[])
    setNotes(guide.handoff_notes ?? '')
  }

  return (
    <SectionCard
      icon={Sparkles}
      title="Handoff metadata"
      description="Staff-only. Surfaces on the internal handoff doc (/branding) to help designers start faster."
    >
      <div className="space-y-4">
        <Field label="Style tags">
          <div className="flex flex-wrap gap-1.5">
            {STYLE_TAG_OPTIONS.map(tag => {
              const active = tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors ${
                    active
                      ? 'bg-primary-purple border-primary-purple text-white'
                      : 'border-lavender text-deep-plum hover:border-primary-purple hover:text-primary-purple'
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
          {tags.length === 0 && (
            <p className="text-[11px] text-purple-gray/70 mt-1.5">No tags set yet — tap any above.</p>
          )}
        </Field>

        <Field label="Handoff notes (1–3 sentences)">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. This brand leans warm and classic — prefer serif accents, avoid neon palettes."
            className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y"
          />
        </Field>
      </div>

      <SectionFooter dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </SectionCard>
  )
}

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
  const [pasteMode, setPasteMode]       = useState(false)
  const [pasted, setPasted]             = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pickFile = () => inputRef.current?.click()

  /** Run the prefill pipeline on a markdown string from any source —
   *  file upload or pasted text. Centralizes the invoke + commit so the
   *  two entry points share error handling. `sourceLabel` is the badge
   *  shown next to the green checkmark after success ("strategy.md" or
   *  "pasted text"). */
  const runPrefill = async (markdown: string, sourceLabel: string) => {
    if (!markdown.trim()) {
      onError('Strategy brief is empty.')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke<{ prefill: BrandVoicePrefill; error?: string }>(
        'brand-voice-prefill',
        { body: { markdown } },
      )
      if (error) {
        // supabase-js wraps non-2xx into a generic "Edge Function
        // returned a non-2xx status code" message that hides the
        // upstream reason (model retired, key missing, parse failure,
        // etc.). The error carries the Response under `context` —
        // pull the JSON body's `error` field so the strategist sees
        // the real failure mode.
        const ctx = (err => (err as { context?: Response }).context)(error)
        let detail = error.message
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json() as { error?: string }
            if (body?.error) detail = body.error
          } catch { /* body wasn't JSON — keep the generic message */ }
        }
        throw new Error(detail)
      }
      if (!data?.prefill) throw new Error(data?.error ?? 'No prefill returned from AI')
      await commitPrefill(bundle, data.prefill)
      await onPrefilled()
      setLastFilename(sourceLabel)
      setPasted('')
      setPasteMode(false)
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Prefill failed')
    } finally {
      setLoading(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      onError(
        `Please upload a .md, .markdown, or .txt file. (Notion exports the brief as a .zip — unzip it first to grab the .md inside, or click "Paste text instead" below.)`,
      )
      return
    }
    const markdown = await file.text()
    await runPrefill(markdown, file.name)
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
            Upload the Notion strategy-brief export (.md), or paste the text directly. Claude extracts the voice overview, tone characteristics, voice guidelines, brand attributes, and brand statement, and prepends them to the sections below for review. Nothing saves until you click Save on each section.
          </p>
          {lastFilename && !loading && (
            <p className="text-[11px] text-green-700 mt-1.5 flex items-center gap-1">
              <Check size={11} /> Prefilled from <strong>{lastFilename}</strong>
            </p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={pickFile}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple text-white text-xs font-semibold px-4 py-2 hover:bg-deep-plum transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {loading ? 'Extracting…' : 'Upload strategy brief'}
          </button>
          <button
            type="button"
            onClick={() => setPasteMode(p => !p)}
            disabled={loading}
            className="text-[11px] font-semibold text-primary-purple hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pasteMode ? 'Cancel paste' : 'Paste text instead'}
          </button>
        </div>
      </div>
      {pasteMode && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-purple-gray">
            Notion exports the brief as a <strong>.zip</strong> — unzip it to find the .md inside, or paste the contents here. Plain markdown works too.
          </p>
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            placeholder="Paste the strategy brief markdown here…"
            rows={10}
            className="w-full text-[12px] font-mono leading-relaxed text-deep-plum bg-white border border-lavender rounded-md p-3 focus:outline-none focus:border-primary-purple resize-y"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPasted(''); setPasteMode(false) }}
              disabled={loading}
              className="text-xs font-semibold text-purple-gray hover:text-deep-plum"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => runPrefill(pasted, 'pasted text')}
              disabled={loading || !pasted.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-deep-plum text-cream text-xs font-semibold px-4 py-2 hover:bg-purple-mid transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : null}
              {loading ? 'Extracting…' : 'Use pasted text'}
            </button>
          </div>
        </div>
      )}
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

// ── Custom sections (user-defined heading + entries) ──────────────────────
//
// Open-ended sections the partner can add to capture content that
// doesn't fit the fixed Voice/Color/Logo/Typography scaffolds — e.g.
// "General Rules" with bullet-style heading+body entries. Each section
// has its own card with its own Save / Delete buttons so they're
// genuinely independent.

function CustomSectionsSection({ bundle, onSaved, onError }: {
  bundle:  BrandGuideBundle
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [creating, setCreating] = useState(false)

  const addSection = async () => {
    setCreating(true)
    try {
      // Place new sections at the end. sort_order = max + 1 keeps
      // existing sections in their position without renumbering.
      const nextOrder = bundle.customSections.length > 0
        ? Math.max(...bundle.customSections.map(s => s.sort_order)) + 1
        : 0
      await createCustomSection(bundle.guide.id, 'New section', null, 2, nextOrder)
      await onSaved()
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to add custom section')
    } finally {
      setCreating(false)
    }
  }

  return (
    <SectionCard
      icon={FileText}
      title="Custom sections"
      description="Open-ended sections for brand-specific rules and guidance — e.g. General Rules, Typography Standards, Iconography Usage. Each section has its own heading and a list of title + body entries that render in a column grid on the public portal."
    >
      <div className="space-y-3">
        {bundle.customSections.map(section => (
          <CustomSectionCard
            key={section.id}
            section={section}
            onSaved={onSaved}
            onError={onError}
          />
        ))}
        <button
          type="button"
          onClick={addSection}
          disabled={creating}
          className="w-full rounded-xl border-2 border-dashed border-lavender py-4 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add custom section
        </button>
      </div>
    </SectionCard>
  )
}

function CustomSectionCard({ section, onSaved, onError }: {
  section: BrandGuideBundle['customSections'][number]
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  // Local draft state for the entire section (heading + meta + entries).
  // We diff on save against the persisted state and persist what changed.
  const [heading,     setHeading]     = useState(section.heading)
  const [description, setDescription] = useState(section.description ?? '')
  const [columnCount, setColumnCount] = useState(section.column_count)
  const [entries,     setEntries]     = useState<CustomSectionEntryDraft[]>(
    section.entries.map(e => ({ id: e.id, title: e.title, body: e.body })),
  )
  const [saving,  setSaving]  = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Re-seed when the parent reloads (e.g. after another section saved).
  useEffect(() => {
    setHeading(section.heading)
    setDescription(section.description ?? '')
    setColumnCount(section.column_count)
    setEntries(section.entries.map(e => ({ id: e.id, title: e.title, body: e.body })))
  }, [section])

  const metaDirty =
    heading !== section.heading
    || (description || null) !== (section.description ?? null)
    || columnCount !== section.column_count
  const entriesDirty = !rowsEqual(
    entries as readonly unknown[],
    section.entries as readonly unknown[],
    ['title', 'body'],
  )
  const dirty = metaDirty || entriesDirty

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      if (metaDirty) {
        await updateCustomSection(section.id, {
          heading,
          description: description.trim() || null,
          column_count: columnCount,
        })
      }
      if (entriesDirty) {
        await saveCustomSectionEntries(section.id, entries, section.entries.map(e => e.id))
      }
      await onSaved()
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to save section')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete section "${section.heading}" and all its entries? This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteCustomSection(section.id)
      await onSaved()
    } catch (err) {
      onError((err as { message?: string })?.message ?? 'Failed to delete section')
    } finally {
      setDeleting(false)
    }
  }

  const addEntry    = ()                                                    => setEntries([...entries, { title: '', body: '' }])
  const removeEntry = (i: number)                                           => setEntries(entries.filter((_, idx) => idx !== i))
  const updateEntry = (i: number, patch: Partial<CustomSectionEntryDraft>) => setEntries(entries.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  return (
    <div className="rounded-xl border border-lavender bg-white p-3 md:p-4 space-y-3">
      {/* Section meta — heading, description, columns */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={heading}
            onChange={e => setHeading(e.target.value)}
            placeholder="Section heading (e.g. General Rules)"
            className="flex-1 min-w-[200px] rounded-lg border border-lavender bg-white px-3 py-1.5 text-base font-semibold text-deep-plum outline-none focus:border-primary-purple"
          />
          <label className="text-[11px] font-bold uppercase tracking-wider text-purple-gray flex items-center gap-1.5">
            Columns
            <select
              value={columnCount}
              onChange={e => setColumnCount(parseInt(e.target.value, 10))}
              className="rounded-md border border-lavender bg-white px-2 py-1 text-xs text-deep-plum outline-none focus:border-primary-purple"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="text-purple-gray hover:text-red-500 p-1.5 rounded-md"
            title="Delete section"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional intro for the section (shown beneath the heading on the portal)."
          rows={2}
          className="w-full rounded-lg border border-lavender bg-white px-3 py-2 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y"
        />
      </div>

      {/* Entries grid */}
      <div className={
        columnCount === 1 ? 'grid grid-cols-1 gap-2'
        : columnCount === 3 ? 'grid grid-cols-1 md:grid-cols-3 gap-2'
        : 'grid grid-cols-1 md:grid-cols-2 gap-2'
      }>
        {entries.map((entry, i) => (
          <div key={entry.id ?? `new-${i}`} className="rounded-lg border border-lavender/70 bg-lavender-tint/20 p-2.5 space-y-1.5">
            <input
              type="text"
              value={entry.title}
              onChange={e => updateEntry(i, { title: e.target.value })}
              placeholder="Entry title (e.g. Keep it Simple)"
              className="w-full rounded-md border border-lavender bg-white px-2.5 py-1.5 text-sm font-semibold text-deep-plum outline-none focus:border-primary-purple"
            />
            <textarea
              value={entry.body}
              onChange={e => updateEntry(i, { body: e.target.value })}
              placeholder="Entry body — the guidance for this specific rule."
              rows={4}
              className="w-full rounded-md border border-lavender bg-white px-2.5 py-1.5 text-sm text-deep-plum outline-none focus:border-primary-purple resize-y"
            />
            <div className="text-right">
              <button type="button" onClick={() => removeEntry(i)} className="text-[11px] text-purple-gray hover:text-red-500">
                Remove entry
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addEntry}
          className="rounded-lg border-2 border-dashed border-lavender py-6 text-xs text-purple-gray hover:border-primary-purple hover:text-primary-purple transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={12} /> Add entry
        </button>
      </div>

      {/* Save footer */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-lavender/50">
        {dirty && (
          <span className="text-[11px] italic text-purple-gray mr-auto">Unsaved changes</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1 rounded-full bg-deep-plum text-cream text-xs font-semibold px-3 py-1.5 hover:bg-primary-purple disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save section
        </button>
      </div>
    </div>
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
