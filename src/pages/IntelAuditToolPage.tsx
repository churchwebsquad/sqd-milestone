import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, Upload, X, Check, RefreshCw, FileText, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { StrategyChurchIntel, ChurchIntelProfile } from '../types/database'
import IntelProfileView from '../components/intel/IntelProfileView'

// ── Types ────────────────────────────────────────────────────────────────────

interface ChurchOption {
  member: number
  church_name: string | null
  church_website: string | null
  instagram: string | null
  facebook: string | null
  youtube: string | null
  twitter: string | null
  linkedin: string | null
  css_rep: string | null
}

interface UploadedFile {
  name: string
  mediaType: string
  base64: string
  isPdf: boolean
}

type Mode = 'new' | 'update'
type Screen = 'form' | 'loading' | 'profile' | 'view' | 'error'

const REFRESH_SCOPES = [
  { key: 'tone', title: 'Tone & Captions', desc: 'Brand voice, caption style, FB posts' },
  { key: 'performance', title: 'What Performs Well', desc: 'Content themes, engagement insights' },
  { key: 'design', title: 'Design & Visuals', desc: 'Colors, style, carousel design notes' },
  { key: 'full', title: 'Full Refresh', desc: 'Regenerate everything from scratch' },
]

// ── Freshness helper ─────────────────────────────────────────────────────────

function freshnessBadge(updatedAt: string | null): { label: string; cls: string } {
  if (!updatedAt) return { label: 'No intel', cls: 'bg-purple-gray/10 text-purple-gray' }
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 60) return { label: `${days}d ago`, cls: 'bg-green-100 text-green-700' }
  if (days < 120) return { label: `${days}d ago`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${days}d ago`, cls: 'bg-red-100 text-red-700' }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IntelAuditToolPage() {
  const { staffProfile } = useAuth()
  const [searchParams] = useSearchParams()
  const preselectedMember = searchParams.get('member')

  const [screen, setScreen] = useState<Screen>('form')
  const [mode, setMode] = useState<Mode>(preselectedMember ? 'update' : 'new')
  const [loadingMsg, setLoadingMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Church list
  const [churches, setChurches] = useState<ChurchOption[]>([])
  const [churchSearch, setChurchSearch] = useState('')
  const [selectedChurch, setSelectedChurch] = useState<ChurchOption | null>(null)
  const [existingIntel, setExistingIntel] = useState<StrategyChurchIntel | null>(null)
  const [intelHistory, setIntelHistory] = useState<{ version: number; author_email: string | null; reason: string | null; created_at: string }[]>([])
  const [churchesLoading, setChurchesLoading] = useState(true)

  // Church detail overrides (editable by user if empty or wrong)
  const [overrideWebsite, setOverrideWebsite] = useState('')
  const [overrideInstagram, setOverrideInstagram] = useState('')
  const [overrideFacebook, setOverrideFacebook] = useState('')
  const [overrideYoutube, setOverrideYoutube] = useState('')
  const [overrideTwitter, setOverrideTwitter] = useState('')
  const [overrideLinkedin, setOverrideLinkedin] = useState('')

  // New form
  const [denomination, setDenomination] = useState('')
  const [platforms, setPlatforms] = useState(['Instagram', 'Facebook'])
  const [pastWork, setPastWork] = useState('')
  const [focusNotes, setFocusNotes] = useState('')
  const [homepageScreenshot, setHomepageScreenshot] = useState<UploadedFile | null>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const homepageRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  // Update form
  const [feedback, setFeedback] = useState('')
  const [learned, setLearned] = useState('')
  const [scopes, setScopes] = useState<string[]>(['tone', 'performance'])
  const [updateFiles, setUpdateFiles] = useState<UploadedFile[]>([])
  const updateFilesRef = useRef<HTMLInputElement>(null)

  // Result
  const [profile, setProfile] = useState<ChurchIntelProfile | null>(null)
  const [isUpdate, setIsUpdate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // ── Load churches ──────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [progressRes, acctRes] = await Promise.all([
        supabase.from('strategy_account_progress').select('member, church_name, church_website, css_rep'),
        supabase.from('accounts').select('account, instagram, facebook'),
      ])

      const progress = (progressRes.data ?? []) as { member: number; church_name: string | null; church_website: string | null; css_rep: string | null }[]
      const accts = (acctRes.data ?? []) as { account: number; instagram: string | null; facebook: string | null }[]
      const acctMap = new Map<number, typeof accts[0]>()
      for (const a of accts) acctMap.set(a.account, a)

      const options: ChurchOption[] = progress.map(p => {
        const acct = acctMap.get(p.member) as Record<string, unknown> | undefined
        return {
          member: p.member,
          church_name: p.church_name,
          church_website: (p as Record<string, unknown>).church_website as string | null,
          instagram: (acct?.instagram as string) ?? null,
          facebook: (acct?.facebook as string) ?? null,
          youtube: null,
          twitter: null,
          linkedin: null,
          css_rep: p.css_rep,
        }
      })

      setChurches(options)
      setChurchesLoading(false)

      // Pre-select if member query param provided — auto-view if intel exists
      if (preselectedMember) {
        const match = options.find(o => o.member === Number(preselectedMember))
        if (match) selectChurch(match, true)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Select church + load existing intel ────────────────────────────────────
  const selectChurch = async (church: ChurchOption, autoView = false) => {
    setSelectedChurch(church)
    // Pre-fill overrides from existing data
    setOverrideWebsite(church.church_website ?? '')
    setOverrideInstagram(church.instagram ?? '')
    setOverrideFacebook(church.facebook ?? '')
    setOverrideYoutube(church.youtube ?? '')
    setOverrideTwitter(church.twitter ?? '')
    setOverrideLinkedin(church.linkedin ?? '')

    const [intelRes, historyRes] = await Promise.all([
      supabase.from('strategy_church_intel').select('*').eq('member', church.member).maybeSingle(),
      supabase.from('strategy_church_intel_history').select('version, author_email, reason, created_at').eq('church_intel_id', church.member.toString()).order('created_at', { ascending: false }).limit(10),
    ])

    const intel = intelRes.data as StrategyChurchIntel | null
    setExistingIntel(intel)
    setIntelHistory((historyRes.data ?? []) as typeof intelHistory)

    if (intel) {
      setMode('update')
      // Auto-show the saved profile when deeplinked
      if (autoView) setScreen('view')
    }
  }

  // ── File handlers ──────────────────────────────────────────────────────────

  /** Resize an image to fit within maxWidth × maxHeight, export as JPEG. */
  const resizeImage = (file: File, maxDim = 1600, quality = 0.85): Promise<{ mediaType: string; base64: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas context unavailable'))
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const base64 = dataUrl.split(',')[1]
        resolve({ mediaType: 'image/jpeg', base64 })
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
      img.src = url
    })
  }

  const processFile = useCallback(async (file: File): Promise<UploadedFile | null> => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowed.includes(file.type)) return null

    // PDFs: read as-is (no resizing possible in browser)
    if (file.type === 'application/pdf') {
      return new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = e => {
          const base64 = (e.target!.result as string).split(',')[1]
          resolve({ name: file.name, mediaType: file.type, base64, isPdf: true })
        }
        reader.readAsDataURL(file)
      })
    }

    // Images: resize to stay under Vercel's 4.5MB body limit
    try {
      const { mediaType, base64 } = await resizeImage(file)
      return { name: file.name, mediaType, base64, isPdf: false }
    } catch (err) {
      console.error('[processFile] resize failed:', err)
      return null
    }
  }, [])

  const handleHomepageUpload = async (fileList: FileList) => {
    const file = [...fileList].find(f => ['image/jpeg', 'image/png'].includes(f.type))
    if (!file) return
    const result = await processFile(file)
    if (result) setHomepageScreenshot(result)
  }

  const handleFilesUpload = async (fileList: FileList, setter: (fn: (prev: UploadedFile[]) => UploadedFile[]) => void) => {
    for (const file of fileList) {
      const result = await processFile(file)
      if (result) setter(prev => prev.length < 5 ? [...prev, result] : prev)
    }
  }

  // ── Generate / Update ──────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedChurch) return
    if (mode === 'new' && !homepageScreenshot) {
      setErrorMsg('Please upload a homepage screenshot — required for accurate color detection.')
      setScreen('error')
      return
    }

    setIsUpdate(mode === 'update')
    setScreen('loading')
    setLoadingMsg(mode === 'update'
      ? `Updating intel for ${selectedChurch.church_name}…`
      : `Researching ${selectedChurch.church_name}…`)

    try {
      const res = await fetch('/api/church-intel/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          churchName: selectedChurch.church_name,
          churchNumber: String(selectedChurch.member),
          denomination,
          websiteUrl: overrideWebsite || selectedChurch.church_website,
          instagram: overrideInstagram || selectedChurch.instagram,
          facebook: overrideFacebook || selectedChurch.facebook,
          youtube: overrideYoutube || selectedChurch.youtube,
          twitter: overrideTwitter || null,
          linkedin: overrideLinkedin || null,
          platforms: platforms.join(', '),
          pastWork,
          focusNotes,
          homepageScreenshot: homepageScreenshot ? { mediaType: homepageScreenshot.mediaType, base64: homepageScreenshot.base64 } : null,
          files: (mode === 'update' ? updateFiles : files).map(f => ({ mediaType: f.mediaType, base64: f.base64, isPdf: f.isPdf })),
          existingProfile: existingIntel?.intel_profile ?? null,
          feedback: mode === 'update' ? feedback : null,
          learned: mode === 'update' ? learned : null,
          scopes: mode === 'update' ? scopes : null,
        }),
      })

      // Read response as text first so we can surface non-JSON errors (413, HTML pages, etc.)
      const rawText = await res.text()
      let data: { profile?: ChurchIntelProfile; error?: string } = {}
      try { data = JSON.parse(rawText) } catch {
        if (res.status === 413) throw new Error('Upload too large. Try a smaller homepage screenshot or fewer additional files.')
        throw new Error(`Server error ${res.status}: ${rawText.slice(0, 200)}`)
      }
      if (!res.ok || data.error) throw new Error(data.error || `Generation failed (${res.status})`)

      setProfile(data.profile as ChurchIntelProfile)
      setScreen('profile')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Generation failed')
      setScreen('error')
    }
  }

  // ── Save to strategy_church_intel ──────────────────────────────────────────
  const handleSave = async () => {
    if (!profile || !selectedChurch) return
    setSaving(true)
    setSaveStatus('idle')

    try {
      const email = staffProfile?.email ?? null
      const version = (existingIntel?.intel_version ?? 0) + 1
      const now = new Date().toISOString()

      if (existingIntel) {
        // Update existing
        const { data: updated, error: err } = await supabase
          .from('strategy_church_intel')
          .update({
            intel_profile: profile as unknown as Record<string, unknown>,
            intel_version: version,
            intel_updated_at: now,
            intel_updated_by: email,
            status: 'live',
          } as Record<string, unknown>)
          .eq('id', existingIntel.id)
          .select()
          .maybeSingle()
        if (err) throw err

        // Save history
        await supabase.from('strategy_church_intel_history').insert({
          church_intel_id: existingIntel.id,
          version,
          intel_profile: profile as unknown as Record<string, unknown>,
          author_email: email,
          reason: isUpdate ? `Refresh: ${scopes.join(', ')}` : 'Updated profile',
        } as Record<string, unknown>)

        if (updated) setExistingIntel(updated as StrategyChurchIntel)
      } else {
        // Insert new
        const { data: inserted, error: err } = await supabase
          .from('strategy_church_intel')
          .insert({
            member: selectedChurch.member,
            intel_profile: profile as unknown as Record<string, unknown>,
            intel_version: 1,
            intel_updated_at: now,
            intel_updated_by: email,
            status: 'live',
          } as Record<string, unknown>)
          .select()
          .maybeSingle()
        if (err) throw err

        const newIntel = inserted as StrategyChurchIntel | null
        if (newIntel) {
          setExistingIntel(newIntel)
          // Save initial history entry
          await supabase.from('strategy_church_intel_history').insert({
            church_intel_id: newIntel.id,
            version: 1,
            intel_profile: profile as unknown as Record<string, unknown>,
            author_email: email,
            reason: 'Initial generation',
          } as Record<string, unknown>)
        }
      }

      setSaveStatus('saved')
    } catch (err) {
      console.error('[IntelAudit] Save failed:', err)
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  // ── Filtered church list ───────────────────────────────────────────────────
  const filteredChurches = churchSearch.trim()
    ? churches.filter(c =>
        c.church_name?.toLowerCase().includes(churchSearch.toLowerCase())
        || String(c.member).includes(churchSearch)
      )
    : churches.slice(0, 20)

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto text-center">
        <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Intel Audit Tool</p>
        <p className="text-sm text-purple-gray mb-6">{loadingMsg}</p>
        <div className="flex justify-center gap-1.5 py-8">
          {[0, 0.2, 0.4].map((d, i) => (
            <span key={i} className="w-2 h-2 bg-primary-purple/40 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
        <p className="text-xs text-purple-gray/50 mt-4">This can take 30–60 seconds. Claude is researching the church's website, social media, and sermon content.</p>
      </div>
    )
  }

  // ── Error screen ───────────────────────────────────────────────────────────
  if (screen === 'error') {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
          <AlertTriangle size={14} className="inline mr-1.5" />
          {errorMsg}
        </div>
        <button type="button" onClick={() => setScreen('form')} className="text-sm text-primary-purple hover:underline">
          ← Back to form
        </button>
      </div>
    )
  }

  // ── View saved profile screen ───────────────────────────────────────────────
  if (screen === 'view' && existingIntel?.intel_profile) {
    const savedProfile = existingIntel.intel_profile as ChurchIntelProfile
    const freshness = freshnessBadge(existingIntel.intel_updated_at)

    return (
      <div className="px-4 md:px-6 py-6 max-w-3xl mx-auto pb-20">
        <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Intel Audit Tool</p>
        <h1 className="text-2xl font-semibold text-deep-plum mb-1">
          {selectedChurch?.church_name ?? 'Church Intel'}
        </h1>
        <div className="flex items-center gap-2 mb-6">
          <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 ${freshness.cls}`}>
            {freshness.label}
          </span>
          <span className="text-xs text-purple-gray">
            v{existingIntel.intel_version} · by {existingIntel.intel_updated_by ?? 'unknown'} · {existingIntel.status}
          </span>
        </div>

        <IntelProfileView profile={savedProfile} />

        {/* Version history */}
        {intelHistory.length > 0 && (
          <div className="mt-6 bg-white border border-lavender rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold text-purple-gray uppercase tracking-widest mb-2">Version History</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {intelHistory.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-lavender/30 last:border-0">
                  <div>
                    <span className="font-semibold text-deep-plum">v{h.version}</span>
                    <span className="text-purple-gray ml-2">{h.reason ?? 'No reason'}</span>
                  </div>
                  <div className="text-purple-gray/60 shrink-0">
                    {h.author_email?.split('@')[0] ?? '—'} · {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => setScreen('form')}
            className="rounded-full border border-lavender text-sm text-purple-gray px-4 py-2 hover:bg-lavender-tint transition-colors"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => { setMode('update'); setScreen('form') }}
            className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2 hover:bg-primary-purple transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Update Profile
          </button>
        </div>
      </div>
    )
  }

  // ── Profile result screen (post-generation, unsaved) ──────────────────────
  if (screen === 'profile' && profile) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-3xl mx-auto pb-20">
        <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Intel Audit Tool</p>
        <h1 className="text-2xl font-semibold text-deep-plum mb-1">
          {isUpdate ? 'Updated Profile' : 'Generated Profile'}
        </h1>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block mb-6">
          Not saved yet — review and save below
        </p>

        <IntelProfileView profile={profile} isUpdate={isUpdate} />

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => { setScreen('form'); setProfile(null); setSaveStatus('idle') }}
            className="rounded-full border border-lavender text-sm text-purple-gray px-4 py-2 hover:bg-lavender-tint transition-colors"
          >
            ← Back to form
          </button>

          {saveStatus === 'saved' ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-green-700 bg-green-100 rounded-full px-4 py-2">
              <Check size={14} /> Saved to database
            </span>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2 hover:bg-primary-purple transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save to Database →'}
            </button>
          )}

          {saveStatus === 'error' && (
            <span className="text-xs text-red-600">Save failed — try again</span>
          )}
        </div>
      </div>
    )
  }

  // ── Form screen ────────────────────────────────────────────────────────────
  return (
    <div className="px-4 md:px-6 py-6 max-w-3xl mx-auto pb-20">
      <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Intel Audit Tool</p>
      <h1 className="text-2xl font-semibold text-deep-plum mb-1">Church Intelligence</h1>
      <p className="text-sm text-purple-gray mb-6">
        Generate or refresh a detailed content strategy profile for a church.
      </p>

      {/* Mode tabs */}
      <div className="flex bg-white border border-lavender rounded-xl p-1 mb-6 shadow-sm">
        {(['new', 'update'] as Mode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              mode === m ? 'bg-lavender-tint text-primary-purple' : 'text-purple-gray hover:text-deep-plum'
            }`}
          >
            {m === 'new' ? 'New Profile' : 'Update Existing'}
          </button>
        ))}
      </div>

      {/* Church picker */}
      <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
        <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">Select a Church</p>

        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-gray/50" />
          <input
            type="text"
            value={churchSearch}
            onChange={e => setChurchSearch(e.target.value)}
            placeholder="Search by church name or member #"
            className="w-full rounded-lg border border-lavender pl-7 pr-3 py-2 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
          />
        </div>

        {churchesLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {filteredChurches.map(c => {
              const selected = selectedChurch?.member === c.member
              return (
                <button
                  key={c.member}
                  type="button"
                  onClick={() => selectChurch(c)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
                    selected
                      ? 'border-primary-purple bg-lavender-tint'
                      : 'border-lavender hover:border-primary-purple/50 hover:bg-lavender-tint/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-deep-plum">{c.church_name ?? `Member #${c.member}`}</p>
                      <p className="text-xs text-purple-gray">#{c.member} · {c.css_rep ?? 'No AM'}</p>
                    </div>
                    {selected && (
                      <div className="w-5 h-5 rounded-full bg-primary-purple flex items-center justify-center shrink-0">
                        <Check size={11} className="text-white" />
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
            {filteredChurches.length === 0 && (
              <p className="text-xs text-purple-gray/50 text-center py-4">No churches match your search.</p>
            )}
          </div>
        )}

        {/* Existing intel — view button + freshness */}
        {selectedChurch && existingIntel && (
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <FileText size={12} className="text-primary-purple" />
              <span className="text-purple-gray">
                Intel v{existingIntel.intel_version} ·{' '}
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${freshnessBadge(existingIntel.intel_updated_at).cls}`}>
                  {freshnessBadge(existingIntel.intel_updated_at).label}
                </span>
                {' · '}{existingIntel.intel_updated_by?.split('@')[0] ?? ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setScreen('view')}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-purple/10 text-xs font-semibold text-primary-purple px-3 py-1.5 hover:bg-primary-purple/20 transition-colors"
            >
              <FileText size={11} /> View Saved Profile
            </button>
          </div>
        )}

        {/* No intel yet */}
        {selectedChurch && !existingIntel && !churchesLoading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-purple-gray/50">
            <AlertTriangle size={12} />
            No intel profile generated yet for this church.
          </div>
        )}
      </div>

      {/* Church details card — always visible when a church is selected */}
      {selectedChurch && (
        <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
          <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">Church Details</p>
          <p className="text-[10px] text-purple-gray mb-3">
            Pre-filled from our database. Edit any field to override what's sent to the AI.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
            {/* Church name + member (read-only) */}
            <div className="py-1.5">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">Church Name</p>
              <p className="text-sm text-deep-plum font-medium">{selectedChurch.church_name ?? '—'}</p>
            </div>
            <div className="py-1.5">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">Member #</p>
              <p className="text-sm text-deep-plum font-mono">{selectedChurch.member}</p>
            </div>
            <div className="py-1.5">
              <p className="text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">Account Manager</p>
              <p className="text-sm text-deep-plum">{selectedChurch.css_rep ?? <span className="text-purple-gray/40 italic">Not set</span>}</p>
            </div>

            {/* Editable fields */}
            <InlineEditField label="Website URL" value={overrideWebsite} onChange={setOverrideWebsite} placeholder="https://churchwebsite.com" type="url" />
            <InlineEditField label="Instagram" value={overrideInstagram} onChange={setOverrideInstagram} placeholder="@churchhandle or URL" />
            <InlineEditField label="Facebook" value={overrideFacebook} onChange={setOverrideFacebook} placeholder="facebook.com/churchpage" />
            <InlineEditField label="YouTube" value={overrideYoutube} onChange={setOverrideYoutube} placeholder="youtube.com/@church" />
            <InlineEditField label="Twitter / X" value={overrideTwitter} onChange={setOverrideTwitter} placeholder="@handle" />
            <InlineEditField label="LinkedIn" value={overrideLinkedin} onChange={setOverrideLinkedin} placeholder="linkedin.com/company/..." />
          </div>
        </div>
      )}

      {/* Form content based on mode */}
      {selectedChurch && mode === 'new' && (
        <>
          {/* Context */}
          <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
            <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">Context</p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Denomination</label>
                <input
                  type="text"
                  value={denomination}
                  onChange={e => setDenomination(e.target.value)}
                  placeholder="e.g. Non-denominational"
                  className="w-full rounded-lg border border-lavender px-3 py-1.5 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20"
                />
              </div>
            </div>

            <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Platforms</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {['Instagram', 'Facebook', 'TikTok', 'YouTube Shorts'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                  className={`rounded-full border text-xs font-medium px-3 py-1.5 transition-colors ${
                    platforms.includes(p)
                      ? 'bg-primary-purple/10 border-primary-purple/20 text-primary-purple'
                      : 'border-lavender text-purple-gray hover:border-primary-purple/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Past Work Notes</label>
            <textarea
              value={pastWork}
              onChange={e => setPastWork(e.target.value)}
              rows={3}
              placeholder="e.g. Created a 4-week Advent series with dark green + gold palette."
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y mb-3"
            />

            <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Focus Notes</label>
            <textarea
              value={focusNotes}
              onChange={e => setFocusNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Big Easter series coming up."
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y"
            />
          </div>

          {/* Homepage Screenshot */}
          <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide">Homepage Screenshot</p>
              <span className="text-[10px] font-semibold bg-red-100 text-red-700 rounded-full px-2 py-0.5">Required</span>
            </div>
            <p className="text-xs text-purple-gray mb-3">Used to detect exact brand colors from their homepage.</p>

            {!homepageScreenshot ? (
              <button
                type="button"
                onClick={() => homepageRef.current?.click()}
                className="w-full border-2 border-dashed border-lavender rounded-xl py-8 text-center hover:border-primary-purple/50 hover:bg-lavender-tint/20 transition-colors"
              >
                <Upload size={20} className="text-lavender mx-auto mb-2" />
                <p className="text-xs font-medium text-purple-gray">Click to upload JPG or PNG</p>
                <input ref={homepageRef} type="file" accept=".jpg,.jpeg,.png" className="hidden" onChange={e => e.target.files && handleHomepageUpload(e.target.files)} />
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <Check size={14} className="text-green-600 shrink-0" />
                <span className="text-xs font-medium text-green-700 flex-1 truncate">{homepageScreenshot.name}</span>
                <button type="button" onClick={() => setHomepageScreenshot(null)} className="text-purple-gray hover:text-red-600 transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Additional files */}
          <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
            <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">Additional Files <span className="font-normal text-purple-gray/60">(optional)</span></p>
            {files.length < 5 && (
              <button
                type="button"
                onClick={() => filesRef.current?.click()}
                className="w-full border-2 border-dashed border-lavender rounded-xl py-6 text-center hover:border-primary-purple/50 hover:bg-lavender-tint/20 transition-colors mb-2"
              >
                <Upload size={16} className="text-lavender mx-auto mb-1" />
                <p className="text-xs text-purple-gray">Past work, brand guides — up to 5 files</p>
                <input ref={filesRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => e.target.files && handleFilesUpload(e.target.files, setFiles)} />
              </button>
            )}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 bg-lavender-tint/40 text-xs text-deep-plum rounded-full px-2.5 py-1">
                    {f.name}
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-purple-gray hover:text-red-600"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedChurch || !homepageScreenshot}
            className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Generate Church Intelligence Profile →
          </button>
        </>
      )}

      {selectedChurch && mode === 'update' && (
        <>
          {/* Existing profile — full inline view */}
          {existingIntel?.intel_profile && (
            <ExistingProfilePanel intel={existingIntel} />
          )}

          {/* Feedback */}
          <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
            <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">What's Changed?</p>

            <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">Feedback from the Church</label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={3}
              placeholder="e.g. They want shorter captions — felt too long."
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y mb-3"
            />

            <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-1">What the Team Learned</label>
            <textarea
              value={learned}
              onChange={e => setLearned(e.target.value)}
              rows={3}
              placeholder="e.g. Their audience engages way more on reels than carousels."
              className="w-full rounded-lg border border-lavender px-3 py-2 text-sm text-deep-plum placeholder-purple-gray/40 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 resize-y mb-3"
            />

            {/* Update files */}
            {updateFiles.length < 5 && (
              <button
                type="button"
                onClick={() => updateFilesRef.current?.click()}
                className="w-full border-2 border-dashed border-lavender rounded-xl py-4 text-center hover:border-primary-purple/50 hover:bg-lavender-tint/20 transition-colors mb-2"
              >
                <Upload size={14} className="text-lavender mx-auto mb-1" />
                <p className="text-xs text-purple-gray">Brand guides, reference files</p>
                <input ref={updateFilesRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => e.target.files && handleFilesUpload(e.target.files, setUpdateFiles)} />
              </button>
            )}
            {updateFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {updateFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 bg-lavender-tint/40 text-xs text-deep-plum rounded-full px-2.5 py-1">
                    {f.name}
                    <button type="button" onClick={() => setUpdateFiles(prev => prev.filter((_, j) => j !== i))} className="text-purple-gray hover:text-red-600"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Scope picker */}
          <div className="bg-white border border-lavender rounded-xl p-5 shadow-sm mb-4">
            <p className="text-xs font-semibold text-deep-plum uppercase tracking-wide mb-3">What to Refresh</p>
            <div className="grid grid-cols-2 gap-2">
              {REFRESH_SCOPES.map(({ key, title, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScopes(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])}
                  className={`text-left rounded-lg px-3 py-2.5 border transition-colors ${
                    scopes.includes(key)
                      ? 'border-primary-purple bg-lavender-tint'
                      : 'border-lavender hover:border-primary-purple/50'
                  }`}
                >
                  <p className="text-xs font-semibold text-deep-plum">{title}</p>
                  <p className="text-[10px] text-purple-gray mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Update button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedChurch || (!feedback && !learned)}
            className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 hover:bg-primary-purple transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <RefreshCw size={14} />
            Regenerate Profile with Updates →
          </button>
        </>
      )}
    </div>
  )
}

// ── Existing profile panel (collapsible, shown in update mode) ────────────────

function ExistingProfilePanel({ intel }: { intel: StrategyChurchIntel }) {
  const [expanded, setExpanded] = useState(true)
  const profile = intel.intel_profile as ChurchIntelProfile
  const freshness = freshnessBadge(intel.intel_updated_at)

  return (
    <div className="bg-white border border-lavender rounded-xl shadow-sm mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-lavender-tint/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown size={16} className="text-primary-purple shrink-0" />
            : <ChevronRight size={16} className="text-purple-gray shrink-0" />}
          <div className="text-left">
            <p className="text-xs font-bold text-deep-plum uppercase tracking-wide">Current Saved Profile</p>
            <p className="text-xs text-purple-gray mt-0.5">
              v{intel.intel_version} · {intel.intel_updated_by?.split('@')[0] ?? 'unknown'} ·{' '}
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${freshness.cls}`}>
                {freshness.label}
              </span>
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold text-purple-gray/50">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-lavender px-2 pb-2">
          <IntelProfileView profile={profile} />
        </div>
      )}
    </div>
  )
}

// ── Inline editable field for church details ─────────────────────────────────

function InlineEditField({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string
}) {
  const hasValue = value.trim().length > 0
  return (
    <div className="py-1.5">
      <label className="block text-[10px] font-semibold text-purple-gray uppercase tracking-wide mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition-colors ${
          hasValue
            ? 'border-lavender text-deep-plum bg-white focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20'
            : 'border-dashed border-lavender/70 text-purple-gray bg-lavender-tint/20 placeholder-purple-gray/40 focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 focus:bg-white focus:border-solid'
        }`}
      />
    </div>
  )
}
