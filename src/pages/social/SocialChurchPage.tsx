/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Brain, Sparkles, CalendarDays, ArrowLeft, ExternalLink, Wand2, X, ChevronRight, User, Video, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SocialIntelProfileView from '../../components/intel/SocialIntelProfileView'
import { createSession, srpPipeline, suggestDeliverablesFromText, type SrpSessionListRow } from '../../lib/srpSessions'
import { useAuth } from '../../contexts/AuthContext'
import type React from 'react'

type Tab = 'profile' | 'intel' | 'srp' | 'calendar'

// ── Types ────────────────────────────────────────────────────────────────────

interface Church {
  member: number
  church_name: string | null
  css_rep: string | null
  church_website: string | null
  reel_submitted_this_week: boolean | null
  last_reel_submission: string | null
  recent_series_srp: string | null
  instagram: string | null
  facebook: string | null
  youtube: string | null
  custom_gpt: string | null
  photos_link: string | null
  bible_translation: string | null
  preferred_bible_translation: string | null
  which_social_media_platforms_do_you_want_us_to_post_to_from_all: string | null
  sms_notes: string | null
  social_coach: string | null
  branded_carousel_task: string | null
  branded_carousel_dropbox_file: string | null
  vista_social_email_from_discovery: string | null
  notion_dashboard: string | null
  sermon_recap_form: string | null
  strategy_brief: string | null
  plan: string | null
}

interface SavedIntel {
  id: string
  intel_profile: object
  intel_version: number
  intel_updated_at: string
  intel_updated_by: string
}

interface CuTask {
  id: string
  name: string
  status: string
  date_created: string
  updatedAt?: string
  assignees: string[]
  url: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ExternalLinkBtn({ href, label }: { href: string; label: string }) {
  if (!href) return null
  const url = href.startsWith('http') ? href : `https://${href}`
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[#513DE5] text-sm hover:underline">
      {label} <ExternalLink size={12} />
    </a>
  )
}


function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="mb-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      {value ? <p className="text-sm text-[#341756]">{value}</p> : <p className="text-sm text-gray-300">—</p>}
    </div>
  )
}

function TaskRow({ task }: { task: CuTask }) {
  const statusColor: Record<string, string> = {
    closed: 'bg-green-100 text-green-700',
    complete: 'bg-green-100 text-green-700',
    'waiting feedback': 'bg-amber-50 text-amber-600',
    'more info need': 'bg-blue-50 text-blue-600',
    'in progress': 'bg-blue-50 text-blue-600',
  }
  const color = statusColor[task.status?.toLowerCase()] ?? 'bg-gray-100 text-gray-500'
  const date = task.date_created
    ? new Date(Number(task.date_created)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''
  return (
    <div className="flex items-start justify-between gap-3 bg-white border border-[#CFC9F8] rounded-xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#341756] leading-tight">{task.name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{task.status}</span>
          {task.assignees.length > 0 && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <User size={10} /> {task.assignees.join(', ')}
            </span>
          )}
          {date && <span className="text-xs text-gray-400">Created: {date}</span>}
        </div>
      </div>
      {task.url && (
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="text-[#513DE5] hover:opacity-70 flex-shrink-0 mt-0.5">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SocialChurchPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const member = Number(memberId)

  const [tab, setTab] = useState<Tab>('profile')
  const [church, setChurch] = useState<Church | null>(null)
  const [churchLoading, setChurchLoading] = useState(true)

  // ── Social links edit state ──────────────────────────────────────────────
  const [editingLinks, setEditingLinks] = useState(false)
  const [linkDraft, setLinkDraft] = useState({ instagram: '', facebook: '', youtube: '', branded_carousel_task: '', branded_carousel_dropbox_file: '', brand_guide_link: '', notion_dashboard: '' })
  const [linkSaving, setLinkSaving] = useState(false)

  // ── Management fields edit state ─────────────────────────────────────────
  const [editingMgmt, setEditingMgmt] = useState(false)
  const [mgmtDraft, setMgmtDraft] = useState({ social_coach: '', css_rep: '', sms_notes: '' })
  const [mgmtSaving, setMgmtSaving] = useState(false)

  // ── Intel state ──────────────────────────────────────────────────────────
  const [intelScreen, setIntelScreen] = useState<'loading' | 'generating' | 'profile' | 'error'>('loading')
  const [savedIntel, setSavedIntel] = useState<SavedIntel | null>(null)
  const [profile, setProfile] = useState<object | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [intelSaved, setIntelSaved] = useState(false)
  const [intelSaving, setIntelSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [wasEdited, setWasEdited] = useState(false)
  const [intelError, setIntelError] = useState('')
  const [amNotes, setAmNotes] = useState('')
  const [showAmNotes, setShowAmNotes] = useState(false)
  const [brandGuideUrl, setBrandGuideUrl] = useState('')
  const [brandGuideOnFile, setBrandGuideOnFile] = useState<string | null>(null)
  const [showAiUpdate, setShowAiUpdate] = useState(false)
  const [aiUpdateDesc, setAiUpdateDesc] = useState('')
  const [aiUpdating, setAiUpdating] = useState(false)
  const [aiUpdateError, setAiUpdateError] = useState('')

  const [refreshingNow, setRefreshingNow] = useState(false)
  const [srpNoIntelWarning, setSrpNoIntelWarning] = useState(false)

  // ── SRP state ────────────────────────────────────────────────────────────
  const [srpSessions, setSrpSessions] = useState<SrpSessionListRow[]>([])
  const [srpLoading, setSrpLoading] = useState(false)
  const [srpCreating, setSrpCreating] = useState(false)

  // ── ClickUp tasks ────────────────────────────────────────────────────────
  const [srpTasks, setSrpTasks] = useState<CuTask[]>([])
  const [sermonTasks, setSermonTasks] = useState<CuTask[]>([])
  const [carouselTasks, setCarouselTasks] = useState<CuTask[]>([])
  const [cuLoading, setCuLoading] = useState(false)

  // ── Load church ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!member) return
    supabase
      .from('strategy_account_progress')
      .select('member, church_name, css_rep, church_website, reel_submitted_this_week, last_reel_submission, recent_series_srp, instagram, facebook, youtube, custom_gpt, photos_link, legacy_photo_library, photos_from_all_in_discovery_form, bible_translation, preferred_bible_translation, which_social_media_platforms_do_you_want_us_to_post_to_from_all, sms_notes, social_coach, branded_carousel_task, branded_carousel_dropbox_file, vista_social_email_from_discovery, notion_dashboard, sermon_recap_form, strategy_brief, plan')
      .eq('member', member)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          // Cascade photo library fields
          const photoUrl = (data as any).photos_link ?? (data as any).legacy_photo_library ?? (data as any).photos_from_all_in_discovery_form ?? null
          // Fetch instagram/facebook from accounts table if not in strategy_account_progress
          let instagram = (data as any).instagram
          let facebook  = (data as any).facebook
          if (!instagram || !facebook) {
            const { data: acct } = await (supabase as any)
              .from('accounts')
              .select('instagram, facebook')
              .eq('account', member)
              .maybeSingle()
            if (acct) {
              instagram = instagram ?? acct.instagram
              facebook  = facebook  ?? acct.facebook
            }
          }
          setChurch({ ...(data as object), photos_link: photoUrl, instagram, facebook } as Church | null)
        } else {
          // Fallback — check strategy_social_pro_profiles for Social Pro churches
          const { data: proData } = await (supabase as any)
            .from('strategy_social_pro_profiles')
            .select('member, church_name, css_rep, website')
            .eq('member', member)
            .maybeSingle()
          if (proData) {
            setChurch({ member: proData.member, church_name: proData.church_name, css_rep: proData.css_rep } as Church)
          }
        }
        setChurchLoading(false)
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any)
      .from('prf_brand_guides')
      .select('brand_guide_link')
      .eq('account', member)
      .maybeSingle()
      .then(({ data }: { data: { brand_guide_link: string | null } | null }) => {
        if (data?.brand_guide_link) setBrandGuideOnFile(data.brand_guide_link)
      })
  }, [member])

  // ── Load ClickUp tasks for this church ──────────────────────────────────
  useEffect(() => {
    if (tab !== 'profile' && tab !== 'srp') return
    setCuLoading(true)
    Promise.allSettled([
      (supabase as any)
        .from('strategy_srp_hub_cache')
        .select('data')
        .eq('cache_key', 'srp_tasks')
        .single()
        .then(({ data: row }: { data: { data: { allTasks?: CuTask[] } } | null }) => {
          const all: CuTask[] = ((row?.data?.allTasks ?? []) as (CuTask & { member: number })[])
            .filter(t => t.member === member)
          setSrpTasks(tab === 'srp' ? all : all.slice(0, 3))
        }),
      fetch(`/api/clickup/church-tasks?member=${member}`)
        .then(r => r.ok ? r.json() : { sermonTasks: [], carouselTasks: [] })
        .then(data => {
          setSermonTasks(data.sermonTasks ?? [])
          setCarouselTasks(data.carouselTasks ?? [])
        }),
    ]).finally(() => setCuLoading(false))
  }, [tab, member])

  // ── Load intel ───────────────────────────────────────────────────────────
  const loadIntel = useCallback(async () => {
    if (!member) return
    setIntelScreen('loading')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data } = await db
      .from('strategy_church_intel')
      .select('id, intel_profile, intel_version, intel_updated_at, intel_updated_by')
      .eq('member', member).eq('status', 'live').maybeSingle()
    if (data) {
      setSavedIntel(data as SavedIntel)
      setProfile(data.intel_profile)
      setProfileId(data.id)
      setIntelSaved(true)
    } else {
      setSavedIntel(null); setProfile(null); setProfileId(null); setIntelSaved(false)
    }
    setIntelScreen(data ? 'profile' : 'error')
  }, [member])

  useEffect(() => { void loadIntel() }, [loadIntel])

  // ── Load SRP sessions ────────────────────────────────────────────────────
  const loadSrp = useCallback(async () => {
    if (!member) return
    setSrpLoading(true)
    const { data } = await srpPipeline
      .from('sessions')
      .select('id, session_id, church_name, member, user_email, current_step, status, sermon_title, clickup_task_id, created_at, updated_at')
      .eq('member', member)
      .not('status', 'eq', 'archived')
      .order('updated_at', { ascending: false })
      .limit(20)
    setSrpSessions((data ?? []) as SrpSessionListRow[])
    setSrpLoading(false)
  }, [member])

  useEffect(() => { if (tab === 'srp') void loadSrp() }, [tab, loadSrp])

  // ── Social links edit ────────────────────────────────────────────────────
  const startEditLinks = () => {
    setLinkDraft({
      instagram: church?.instagram ?? '',
      facebook: church?.facebook ?? '',
      youtube: church?.youtube ?? '',
      branded_carousel_task: church?.branded_carousel_task ?? '',
      branded_carousel_dropbox_file: church?.branded_carousel_dropbox_file ?? '',
      brand_guide_link: brandGuideOnFile ?? '',
      notion_dashboard: church?.notion_dashboard ?? '',
    })
    setEditingLinks(true)
  }

  const saveLinks = async () => {
    if (!member) return
    setLinkSaving(true)
    const updates = {
      instagram: linkDraft.instagram.trim() || null,
      facebook:  linkDraft.facebook.trim()  || null,
      youtube:   linkDraft.youtube.trim()   || null,
      branded_carousel_task: linkDraft.branded_carousel_task.trim() || null,
      branded_carousel_dropbox_file: linkDraft.branded_carousel_dropbox_file.trim() || null,
      notion_dashboard: linkDraft.notion_dashboard.trim() || null,
    }
    const [{ error }, brandErr] = await Promise.all([
      (supabase as any).from('strategy_account_progress').update(updates).eq('member', member),
      linkDraft.brand_guide_link.trim()
        ? (supabase as any).from('prf_brand_guides').upsert({ account: member, brand_guide_link: linkDraft.brand_guide_link.trim() }, { onConflict: 'account' })
        : Promise.resolve({ error: null }),
    ])
    if (!error && !brandErr?.error) {
      setChurch(prev => prev ? { ...prev, ...updates } : prev)
      if (linkDraft.brand_guide_link.trim()) setBrandGuideOnFile(linkDraft.brand_guide_link.trim())
      setEditingLinks(false)
    } else {
      alert(`Save failed: ${(error ?? brandErr?.error)?.message}`)
    }
    setLinkSaving(false)
  }

  const startEditMgmt = () => {
    setMgmtDraft({
      social_coach: church?.social_coach ?? '',
      css_rep:      church?.css_rep ?? '',
      sms_notes:    church?.sms_notes ?? '',
    })
    setEditingMgmt(true)
  }

  const saveMgmt = async () => {
    if (!member) return
    setMgmtSaving(true)
    const updates = {
      social_coach: mgmtDraft.social_coach.trim() || null,
      css_rep:      mgmtDraft.css_rep.trim() || null,
      sms_notes:    mgmtDraft.sms_notes.trim() || null,
    }
    const { error } = await (supabase as any).from('strategy_account_progress').update(updates).eq('member', member)
    if (!error) {
      setChurch(prev => prev ? { ...prev, ...updates } : prev)
      setEditingMgmt(false)
    } else {
      alert(`Save failed: ${error.message}`)
    }
    setMgmtSaving(false)
  }

  // ── Intel actions ────────────────────────────────────────────────────────
  const generateIntel = useCallback(async () => {
    if (!member) return
    setIntelScreen('generating'); setProfile(null); setIntelError(''); setIntelSaved(false); setEditMode(false); setWasEdited(false)
    try {
      const { data, error } = await supabase.functions.invoke('social-intel-generate', {
        body: {
          memberId: member,
          amNotes: amNotes.trim() || undefined,
          brandGuideUrl: brandGuideUrl.trim() || undefined,
        },
      })
      if (error) throw new Error(error.message ?? 'Generation failed')
      if (!data?.profile) throw new Error('No profile returned from function')
      setProfile(data.profile); setIntelScreen('profile')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[Intel] generate failed:', msg)
      setIntelError(msg)
      setIntelScreen('error')
    }
  }, [member, amNotes])

  const saveIntel = async () => {
    if (!profile || !member) return
    setIntelSaving(true)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const email = authUser?.email ?? 'unknown'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      let existing: { id: string; intel_version: number } | null = null
      if (profileId) {
        const { data } = await db.from('strategy_church_intel').select('id, intel_version').eq('id', profileId).maybeSingle()
        existing = data ?? null
      }
      if (!existing) {
        const { data } = await db.from('strategy_church_intel').select('id, intel_version').eq('member', member).maybeSingle()
        existing = data ?? null
      }
      const version = (existing?.intel_version ?? 0) + 1
      const reason = wasEdited ? 'Manual edit' : existing ? 'Regenerated' : 'Initial profile generated'
      if (existing) {
        await db.from('strategy_church_intel').update({ intel_profile: profile, intel_version: version, intel_updated_at: new Date().toISOString(), intel_updated_by: email, status: 'live' }).eq('id', existing.id)
        await db.from('strategy_church_intel_history').insert({ church_intel_id: existing.id, version, intel_profile: profile, author_email: email, reason })
        setProfileId(existing.id)
      } else {
        const { data: inserted } = await db.from('strategy_church_intel').insert({ member, intel_profile: profile, intel_version: 1, intel_updated_at: new Date().toISOString(), intel_updated_by: email, status: 'live' }).select('id').single()
        if (inserted) {
          await db.from('strategy_church_intel_history').insert({ church_intel_id: inserted.id, version: 1, intel_profile: profile, author_email: email, reason })
          setProfileId(inserted.id)
        }
      }
      setIntelSaved(true); setWasEdited(false)
      await loadIntel()
    } catch (err: unknown) {
      alert(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIntelSaving(false)
    }
  }

  const handleAiUpdate = async () => {
    if (!profile || !aiUpdateDesc.trim()) return
    setAiUpdating(true); setAiUpdateError('')
    try {
      const { data, error } = await supabase.functions.invoke('social-intel-update', {
        body: { memberId: member, updateDescription: aiUpdateDesc.trim(), currentProfile: profile },
      })
      if (error) throw new Error(error.message ?? 'AI update failed')
      setProfile(data.profile); setIntelSaved(false); setWasEdited(true); setShowAiUpdate(false); setAiUpdateDesc('')
    } catch (err: unknown) {
      setAiUpdateError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setAiUpdating(false)
    }
  }

  const refreshWhatsHappeningNow = async () => {
    if (!profile || !member) return
    setRefreshingNow(true)
    try {
      const { data, error } = await supabase.functions.invoke('social-intel-generate', {
        body: { memberId: member, section: 'whats_happening_now' },
      })
      if (error) throw new Error(error.message ?? 'Refresh failed')
      if (!data?.whats_happening_now) throw new Error('No data returned')
      // Preserve am_notes from existing profile, merge refreshed data
      const existing = (profile as Record<string, unknown>).whats_happening_now as Record<string, unknown> ?? {}
      const merged = { ...existing, ...data.whats_happening_now, am_notes: existing.am_notes }
      const updated = { ...(profile as Record<string, unknown>), whats_happening_now: merged }
      setProfile(updated); setIntelSaved(false); setWasEdited(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setRefreshingNow(false)
    }
  }


  if (churchLoading) return (
    <div className="flex items-center justify-center py-32">
      <div className="w-8 h-8 border-4 border-[#513DE5] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const churchName = church?.church_name ?? `Member #${member}`
  const bibleTranslation = church?.preferred_bible_translation || church?.bible_translation
  const platforms = church?.which_social_media_platforms_do_you_want_us_to_post_to_from_all

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Back + header */}
      <div className="mb-6">
        <Link to="/social" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#513DE5] transition-colors mb-3">
          <ArrowLeft size={13} /> All churches
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-widest mb-0.5">#{member}</p>
            <h1 className="text-2xl font-bold text-[#341756]">{churchName}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              {church?.css_rep && <span className="text-xs text-gray-400">AM: {church.css_rep}</span>}
              {church?.plan && (
                <span className="text-xs bg-[#EDE9FC] text-[#513DE5] font-medium px-2 py-0.5 rounded-full">{church.plan}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-8 border-b border-gray-100">
        {([
          { id: 'profile',  label: 'Church Profile',  icon: User },
          { id: 'intel',    label: 'Intel',            icon: Brain },
          { id: 'srp',      label: 'SRP Generator',   icon: Sparkles },
          { id: 'calendar', label: 'Calendar',         icon: CalendarDays },
        ] as { id: Tab; label: string; icon: React.ElementType }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id ? 'border-[#513DE5] text-[#513DE5]' : 'border-transparent text-gray-500 hover:text-[#341756]'
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {t.id === 'calendar' && <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">Soon</span>}
          </button>
        ))}
      </div>

      {/* ── CHURCH PROFILE TAB ─────────────────────────────────────────── */}
      {tab === 'profile' && (
        <div className="space-y-8">

          {/* Social Media Details — full width, two-column interior grid */}
          <div className="bg-white border border-[#CFC9F8] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-[#513DE5] uppercase tracking-widest">Social Media Details</h3>
              {!editingLinks ? (
                <button onClick={startEditLinks} className="text-xs text-[#513DE5] hover:underline">Edit links</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={saveLinks} disabled={linkSaving}
                    className="text-xs bg-[#513DE5] text-white px-3 py-1 rounded-lg disabled:opacity-60">
                    {linkSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingLinks(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              {/* Left column */}
              <div>
                <Field label="Platforms" value={platforms} />
                <Field label="Bible Translation" value={bibleTranslation} />

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-0.5">Photo Library</p>
                  {church?.photos_link ? <ExternalLinkBtn href={church.photos_link} label="View Photo Library" /> : <span className="text-sm text-gray-300">—</span>}
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-0.5">Website</p>
                  {church?.church_website
                    ? <ExternalLinkBtn href={church.church_website.startsWith('http') ? church.church_website : `https://${church.church_website}`} label={church.church_website.replace(/^https?:\/\//, '')} />
                    : <span className="text-sm text-gray-300">—</span>}
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Link2 size={11} /> Instagram</p>
                  {editingLinks ? (
                    <input value={linkDraft.instagram} onChange={e => setLinkDraft(d => ({ ...d, instagram: e.target.value }))}
                      placeholder="https://instagram.com/..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                  ) : church?.instagram ? (
                    <ExternalLinkBtn href={church.instagram} label={church.instagram.replace(/^https?:\/\//, '')} />
                  ) : <span className="text-sm text-gray-300">—</span>}
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Link2 size={11} /> Facebook</p>
                  {editingLinks ? (
                    <input value={linkDraft.facebook} onChange={e => setLinkDraft(d => ({ ...d, facebook: e.target.value }))}
                      placeholder="https://facebook.com/..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                  ) : church?.facebook ? (
                    <ExternalLinkBtn href={church.facebook} label={church.facebook.replace(/^https?:\/\//, '')} />
                  ) : <span className="text-sm text-gray-300">—</span>}
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Video size={11} /> YouTube</p>
                  {editingLinks ? (
                    <input value={linkDraft.youtube} onChange={e => setLinkDraft(d => ({ ...d, youtube: e.target.value }))}
                      placeholder="https://youtube.com/..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                  ) : church?.youtube ? (
                    <ExternalLinkBtn href={church.youtube} label={church.youtube.replace(/^https?:\/\//, '')} />
                  ) : <span className="text-sm text-gray-300">—</span>}
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-0.5">Custom GPT</p>
                  {church?.custom_gpt ? <ExternalLinkBtn href={church.custom_gpt} label="Open Custom GPT" /> : <span className="text-sm text-gray-300">—</span>}
                </div>
              </div>

              {/* Right column */}
              <div>
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#341756] mb-2">Branded Carousels</p>
                  <div className="mb-2">
                    <p className="text-xs text-gray-400 mb-0.5">Carousel Task</p>
                    {editingLinks ? (
                      <input value={linkDraft.branded_carousel_task} onChange={e => setLinkDraft(d => ({ ...d, branded_carousel_task: e.target.value }))}
                        placeholder="https://app.clickup.com/..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                    ) : church?.branded_carousel_task ? (
                      <ExternalLinkBtn href={church.branded_carousel_task} label="View Carousel Task" />
                    ) : <span className="text-sm text-gray-300">—</span>}
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Dropbox File</p>
                    {editingLinks ? (
                      <input value={linkDraft.branded_carousel_dropbox_file} onChange={e => setLinkDraft(d => ({ ...d, branded_carousel_dropbox_file: e.target.value }))}
                        placeholder="https://www.dropbox.com/..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                    ) : church?.branded_carousel_dropbox_file ? (
                      <ExternalLinkBtn href={church.branded_carousel_dropbox_file} label="View Dropbox File" />
                    ) : <span className="text-sm text-gray-300">—</span>}
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4 space-y-2">
                  <p className="text-xs font-semibold text-[#341756] mb-2">Quick Links</p>
                  {editingLinks && (
                    <div className="space-y-2 mb-3 p-3 bg-[#EDE9FC] rounded-xl">
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Brand Guide URL</p>
                        <input value={linkDraft.brand_guide_link} onChange={e => setLinkDraft(d => ({ ...d, brand_guide_link: e.target.value }))}
                          placeholder="https://..."
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] bg-white" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-0.5">Notion Dashboard URL</p>
                        <input value={linkDraft.notion_dashboard} onChange={e => setLinkDraft(d => ({ ...d, notion_dashboard: e.target.value }))}
                          placeholder="https://notion.so/..."
                          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] bg-white" />
                      </div>
                    </div>
                  )}
                  {church?.strategy_brief
                    ? <a href={church.strategy_brief.startsWith('http') ? church.strategy_brief : `https://${church.strategy_brief}`} target="_blank" rel="noopener noreferrer"
                        className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-[#341756] hover:border-[#513DE5] hover:text-[#513DE5] transition-colors">
                        Strategy Brief <ExternalLink size={13} />
                      </a>
                    : <div className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-300">
                        Strategy Brief <ExternalLink size={13} />
                      </div>}
                  {(editingLinks ? linkDraft.notion_dashboard.trim() : church?.notion_dashboard)
                    ? <a href={(editingLinks ? linkDraft.notion_dashboard.trim() : church?.notion_dashboard)!} target="_blank" rel="noopener noreferrer"
                        className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-[#341756] hover:border-[#513DE5] hover:text-[#513DE5] transition-colors">
                        Notion Dashboard <ExternalLink size={13} />
                      </a>
                    : <div className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-300">
                        Notion Dashboard <ExternalLink size={13} />
                      </div>}
                  {(editingLinks ? linkDraft.brand_guide_link.trim() : brandGuideOnFile)
                    ? <a href={editingLinks ? linkDraft.brand_guide_link.trim() : brandGuideOnFile!} target="_blank" rel="noopener noreferrer"
                        className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-[#341756] hover:border-[#513DE5] hover:text-[#513DE5] transition-colors">
                        Brand Guide <ExternalLink size={13} />
                      </a>
                    : <div className="w-full flex items-center justify-between px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-300">
                        Brand Guide <ExternalLink size={13} />
                      </div>}
                </div>
              </div>
            </div>
          </div>

          {/* Social Media Management */}
          <div className="bg-white border border-[#CFC9F8] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-[#513DE5] uppercase tracking-widest">Social Media Management</h3>
              {!editingMgmt
                ? <button onClick={startEditMgmt} className="text-xs text-[#513DE5] hover:underline">Edit</button>
                : <div className="flex gap-2">
                    <button onClick={saveMgmt} disabled={mgmtSaving}
                      className="text-xs bg-[#513DE5] text-white px-3 py-1 rounded-full hover:opacity-90 disabled:opacity-50">
                      {mgmtSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditingMgmt(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">Social Manager</p>
                {editingMgmt
                  ? <input value={mgmtDraft.social_coach} onChange={e => setMgmtDraft(d => ({ ...d, social_coach: e.target.value }))}
                      placeholder="Name"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                  : church?.social_coach && !church.social_coach.startsWith('rec')
                    ? <p className="text-sm text-[#341756]">{church.social_coach}</p>
                    : <p className="text-sm text-gray-300">—</p>}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Account Manager</p>
                {editingMgmt
                  ? <input value={mgmtDraft.css_rep} onChange={e => setMgmtDraft(d => ({ ...d, css_rep: e.target.value }))}
                      placeholder="Name"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]" />
                  : church?.css_rep
                    ? <p className="text-sm text-[#341756]">{church.css_rep}</p>
                    : <p className="text-sm text-gray-300">—</p>}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">SMS Notes</p>
              {editingMgmt
                ? <textarea value={mgmtDraft.sms_notes} onChange={e => setMgmtDraft(d => ({ ...d, sms_notes: e.target.value }))}
                    placeholder="Notes about this church's social strategy…"
                    rows={4}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] resize-y" />
                : church?.sms_notes
                  ? <div className="bg-[#EDE9FC] rounded-xl px-4 py-3 text-sm text-[#341756] whitespace-pre-wrap">{church.sms_notes}</div>
                  : <p className="text-sm text-gray-300">—</p>}
            </div>
          </div>

          {/* ClickUp Task Sections */}
          {cuLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <div className="w-4 h-4 border-2 border-[#513DE5] border-t-transparent rounded-full animate-spin" />
              Loading ClickUp tasks…
            </div>
          ) : (
            <div className="space-y-8">

              <div>
                <h3 className="text-xs font-bold text-[#513DE5] uppercase tracking-widest mb-3">Latest SRP Tasks</h3>
                {srpTasks.length === 0 ? (
                  <p className="text-sm text-gray-400">No SRP tasks found for this church.</p>
                ) : (
                  <div className="space-y-2">
                    {srpTasks.map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#513DE5] uppercase tracking-widest mb-3">Sermon Tasks — Last 120 Days</h3>
                {sermonTasks.length === 0 ? (
                  <p className="text-sm text-gray-400">No sermon tasks in the last 120 days.</p>
                ) : (
                  <div className="space-y-2">
                    {sermonTasks.map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold text-[#513DE5] uppercase tracking-widest mb-3">Carousel Template Tasks — Last 120 Days</h3>
                {carouselTasks.length === 0 ? (
                  <p className="text-sm text-gray-400">No carousel template tasks in the last 120 days.</p>
                ) : (
                  <div className="space-y-2">
                    {carouselTasks.map(t => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      )}

      {/* ── INTEL TAB ──────────────────────────────────────────────────── */}
      {tab === 'intel' && (
        <div>
          {intelScreen === 'error' && !profile && (
            <div className="bg-white rounded-2xl border border-[#CFC9F8] p-10 text-center">
              <Brain size={32} className="text-[#CFC9F8] mx-auto mb-4" />
              <h2 className="font-bold text-[#341756] mb-2">No intel profile yet</h2>
              <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">Generate a profile and we'll research their website, social accounts, brand voice, and current series.</p>
              <div className="max-w-sm mx-auto mb-4 text-left">
                <label className="text-xs text-gray-400 block mb-1">Brand guide URL <span className="text-gray-300">(optional — Dropbox, Drive, or web link)</span></label>
                <input
                  value={brandGuideUrl}
                  onChange={e => setBrandGuideUrl(e.target.value)}
                  placeholder={brandGuideOnFile ?? 'https://…'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]"
                />
                {brandGuideOnFile && !brandGuideUrl && (
                  <p className="text-xs text-[#513DE5] mt-1">On file: will be used automatically</p>
                )}
              </div>

              <button onClick={() => setShowAmNotes(v => !v)} className="text-xs text-[#513DE5] underline mb-4 block mx-auto">
                {showAmNotes ? 'Hide AM notes' : 'Add AM notes before generating'}
              </button>
              {showAmNotes && (
                <textarea value={amNotes} onChange={e => setAmNotes(e.target.value)}
                  placeholder="Any context — new pastor, rebrand, upcoming event…"
                  className="w-full max-w-sm mx-auto block border border-gray-200 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#513DE5] resize-y min-h-[80px]" />
              )}
              {intelError && (
                <p className="text-xs text-red-500 mb-4 max-w-sm mx-auto bg-red-50 rounded-lg px-3 py-2">{intelError}</p>
              )}
              <button onClick={generateIntel} className="bg-[#513DE5] text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity">
                Build Social Intel Profile →
              </button>
            </div>
          )}

          {intelScreen === 'generating' && (
            <div className="bg-white rounded-2xl border border-[#CFC9F8] p-12 text-center">
              <div className="w-12 h-12 border-4 border-[#513DE5] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
              <h2 className="text-lg font-bold text-[#341756] mb-2">Building intel profile…</h2>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">Researching their website, social profiles, brand voice, and current series. Takes about 60–90 seconds.</p>
            </div>
          )}

          {intelScreen === 'profile' && profile && (
            <div>
              {savedIntel && (
                <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
                  <span className="bg-[#EDE9FC] text-[#513DE5] px-2 py-0.5 rounded-full font-medium">Intel saved</span>
                  <span>Last updated {new Date(savedIntel.intel_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} by {savedIntel.intel_updated_by}</span>
                </div>
              )}
              <div className="flex gap-3 mb-4 flex-wrap items-center">
                <button onClick={saveIntel} disabled={intelSaving || (intelSaved && !wasEdited)}
                  className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 text-sm">
                  {intelSaving ? 'Saving…' : intelSaved && !wasEdited ? 'Saved ✓' : wasEdited ? 'Save Changes' : 'Save Profile'}
                </button>
                <button onClick={() => { setShowAiUpdate(v => !v); setShowAmNotes(false) }}
                  className={`inline-flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors ${showAiUpdate ? 'bg-[#EDE9FC] text-[#513DE5] border border-[#513DE5]' : 'border border-[#513DE5] text-[#513DE5] hover:bg-[#F9F5F1]'}`}>
                  <Wand2 size={14} /> AI Update
                </button>
                <button onClick={() => setEditMode(e => !e)}
                  className={`font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors ${editMode ? 'bg-[#EDE9FC] text-[#513DE5] border border-[#513DE5]' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {editMode ? 'Done Editing' : 'Edit Profile'}
                </button>
                <button onClick={() => { setShowAmNotes(v => !v); setShowAiUpdate(false) }}
                  className="border border-gray-200 text-gray-600 font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-sm">
                  Regenerate
                </button>
              </div>

              {showAiUpdate && (
                <div className="bg-[#EDE9FC] border border-[#CFC9F8] rounded-2xl p-5 mb-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-[#341756] flex items-center gap-2"><Wand2 size={15} className="text-[#513DE5]" /> Tell me what changed</p>
                      <p className="text-xs text-[#6B6180] mt-0.5">Describe it in plain English — I'll update only the relevant fields.</p>
                    </div>
                    <button onClick={() => { setShowAiUpdate(false); setAiUpdateError('') }} className="text-gray-400 hover:text-gray-600 p-1"><X size={15} /></button>
                  </div>
                  <textarea value={aiUpdateDesc} onChange={e => setAiUpdateDesc(e.target.value)} placeholder="Describe what changed…" rows={3}
                    className="w-full border border-[#CFC9F8] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] resize-y bg-white mt-3 mb-3" />
                  {aiUpdateError && <p className="text-xs text-red-600 mb-2">{aiUpdateError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleAiUpdate} disabled={aiUpdating || !aiUpdateDesc.trim()}
                      className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 text-sm flex items-center gap-2">
                      {aiUpdating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Updating…</> : <><Wand2 size={13} />Update Profile</>}
                    </button>
                    <button onClick={() => { setShowAiUpdate(false); setAiUpdateError('') }}
                      className="border border-[#CFC9F8] text-gray-500 font-semibold px-4 py-2.5 rounded-xl hover:bg-white text-sm">Cancel</button>
                  </div>
                </div>
              )}

              {showAmNotes && (
                <div className="bg-[#F9F5F1] rounded-xl p-4 mb-6">
                  <p className="text-sm font-semibold text-[#341756] mb-2">Regenerate with AM notes</p>
                  <textarea value={amNotes} onChange={e => setAmNotes(e.target.value)} placeholder="What's changed? New pastor, rebrand, upcoming series…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] min-h-[80px] resize-y mb-3" />
                  <button onClick={generateIntel} className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 text-sm">Regenerate →</button>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-[#CFC9F8] p-6 shadow-sm">
                <SocialIntelProfileView
                  profile={profile as Parameters<typeof SocialIntelProfileView>[0]['profile']}
                  editMode={editMode}
                  onProfileChange={updated => { setProfile(updated); setIntelSaved(false); setWasEdited(true) }}
                  onRefreshNow={refreshWhatsHappeningNow}
                  refreshingNow={refreshingNow}
                />
              </div>
            </div>
          )}

          {intelScreen === 'loading' && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-[#513DE5] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* ── SRP TAB ────────────────────────────────────────────────────── */}
      {tab === 'srp' && (() => {
        const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000
        const recentSrpTasks = (srpTasks as (CuTask & { member: number })[])
          .concat(([] as (CuTask & { member: number })[]))
          // Squad API often omits timestamps — if both are missing, include the task
          // rather than silently dropping it (the cache itself is the recency filter).
          .filter(t => {
            const created = Number(t.date_created) || 0
            const updated = new Date(t.updatedAt || 0).getTime() || 0
            if (!created && !updated) return true
            return created >= since30 || updated >= since30
          })

        // Build a map of clickup_task_id → session for quick lookup
        const sessionByTaskId = new Map<string, SrpSessionListRow>()
        for (const s of srpSessions) {
          if ((s as unknown as Record<string, unknown>).clickup_task_id) {
            sessionByTaskId.set((s as unknown as Record<string, unknown>).clickup_task_id as string, s)
          }
        }

        const handleTaskClick = async (task: CuTask & { member: number }) => {
          const existing = sessionByTaskId.get(task.id)
          if (existing) {
            navigate(`/social/srp/${encodeURIComponent(existing.session_id)}`)
            return
          }
          if (!church || !user?.email) return
          setSrpCreating(true)
          try {
            // Fetch intel profile for brand voice
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: intelData } = await (supabase as any)
              .from('strategy_church_intel')
              .select('intel_profile')
              .eq('member', member)
              .eq('status', 'live')
              .maybeSingle()

            if (!intelData?.intel_profile) {
              setSrpCreating(false)
              setSrpNoIntelWarning(true)
              return
            }
            setSrpNoIntelWarning(false)

            // Format brand voice from intel profile
            const bv = intelData.intel_profile?.brand_voice
            const lines: string[] = []
            if (bv?.tone_summary) lines.push(`Tone: ${bv.tone_summary}`)
            if (bv?.casual_to_formal_spectrum) lines.push(`Voice spectrum: ${bv.casual_to_formal_spectrum}`)
            if (Array.isArray(bv?.attributes)) {
              for (const attr of bv.attributes) {
                lines.push(`- ${attr.name}: ${attr.definition ?? ''}`)
                if (attr.write_with_this_in_mind) lines.push(`  Write with this in mind: ${attr.write_with_this_in_mind}`)
                if (Array.isArray(attr.use) && attr.use.length)     lines.push(`  Use: ${attr.use.join(', ')}`)
                if (Array.isArray(attr.avoid) && attr.avoid.length) lines.push(`  Avoid: ${attr.avoid.join(', ')}`)
              }
            }
            const brandVoiceGuidelines = lines.join('\n').trim() || null

            // Fetch full task details to auto-select deliverables from description
            let suggestedDeliverables = suggestDeliverablesFromText(task.name)
            try {
              const tdRes = await fetch(`/api/clickup/task-detail?taskId=${encodeURIComponent(task.id)}`)
              if (tdRes.ok) {
                const td = await tdRes.json()
                const combined = `${task.name} ${td.description ?? ''}`
                suggestedDeliverables = suggestDeliverablesFromText(combined)
              }
            } catch {
              // fall back to name-only suggestions already set above
            }

            const sermonTitle = task.name.replace(/^\d+\s*-\s*/, '').trim()
            const { session_id } = await createSession({
              member: String(member),
              churchName: church.church_name ?? `Member ${member}`,
              userEmail: user.email,
              clickupTaskId: task.id,
              sermonTitle,
              brandVoiceGuidelines,
              suggestedDeliverables: suggestedDeliverables.length ? suggestedDeliverables : null,
            })
            navigate(`/social/srp/${encodeURIComponent(session_id)}`)
          } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to create SRP session')
          } finally {
            setSrpCreating(false)
          }
        }

        return (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-bold text-[#341756]">SRP Generator</h2>
                <p className="text-xs text-gray-400 mt-0.5">ClickUp tasks tagged <span className="font-mono">sms-sermon-recap</span> · last 30 days</p>
              </div>
            </div>

            {srpNoIntelWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-4">
                <span className="text-amber-500 text-xl mt-0.5">⚠</span>
                <div className="flex-1">
                  <p className="font-semibold text-amber-800 text-sm mb-1">Intel profile required before starting an SRP</p>
                  <p className="text-xs text-amber-700 mb-3">The SRP generator uses the church's brand voice from their Intel document to write captions and content. {churchName} doesn't have one yet — you'll need to build it first.</p>
                  <button
                    onClick={() => { setSrpNoIntelWarning(false); setTab('intel') }}
                    className="text-xs bg-amber-500 text-white font-semibold px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
                  >
                    Go build Intel profile →
                  </button>
                </div>
              </div>
            )}

            {cuLoading || srpLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
                <div className="w-4 h-4 border-2 border-[#513DE5] border-t-transparent rounded-full animate-spin" />
                Loading tasks…
              </div>
            ) : recentSrpTasks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#CFC9F8] p-10 text-center">
                <Sparkles size={32} className="text-[#CFC9F8] mx-auto mb-4" />
                <h3 className="font-bold text-[#341756] mb-2">No SRP tasks in the last 30 days</h3>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">ClickUp tasks tagged <span className="font-mono text-xs">sms-sermon-recap</span> for this church will appear here.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#CFC9F8] overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-gray-100 bg-[#F9F5F1]">
                  <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider">Task</p>
                  <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider w-20 text-center">Date</p>
                  <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider w-24 text-center">Status</p>
                  <p className="text-xs font-semibold text-[#513DE5] uppercase tracking-wider w-28 text-center">SRP</p>
                </div>

                {recentSrpTasks.map((task, i) => {
                  const session = sessionByTaskId.get(task.id)
                  const isDone = session?.status === 'completed'
                  const hasSession = !!session
                  const dateMs = Number(task.date_created) || new Date(task.updatedAt || '').getTime() || 0
                  const date = dateMs ? new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
                  const title = task.name.replace(/^\d+\s*-\s*/, '').trim()

                  return (
                    <button
                      key={task.id}
                      onClick={() => handleTaskClick(task as CuTask & { member: number })}
                      disabled={srpCreating}
                      className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-4 text-left hover:bg-[#EDE9FC] transition-colors disabled:opacity-60 ${i < recentSrpTasks.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#341756] truncate">{title}</p>
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">#{task.id}</p>
                      </div>
                      <p className="text-xs text-gray-500 w-20 text-center self-center">{date}</p>
                      <div className="w-24 flex justify-center self-center">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{task.status || '—'}</span>
                      </div>
                      <div className="w-28 flex justify-center self-center">
                        {isDone ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium">Complete ✓</span>
                        ) : hasSession ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600 font-medium flex items-center gap-1">In progress <ChevronRight size={10} /></span>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-[#513DE5] text-white font-medium flex items-center gap-1">Start SRP <ChevronRight size={10} /></span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── CALENDAR TAB ───────────────────────────────────────────────── */}
      {tab === 'calendar' && (
        <div className="bg-white rounded-2xl border border-[#CFC9F8] p-12 text-center">
          <CalendarDays size={40} className="text-[#CFC9F8] mx-auto mb-4" />
          <h2 className="font-bold text-[#341756] mb-2">Social Calendar</h2>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            The social content calendar for {churchName} is coming soon.
          </p>
        </div>
      )}

    </div>
  )
}
