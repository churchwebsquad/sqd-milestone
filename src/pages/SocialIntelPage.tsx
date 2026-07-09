import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SocialIntelProfileView from '../components/intel/SocialIntelProfileView'

interface ChurchOption {
  member: number
  church_name: string | null
  church_website: string | null
}

interface SavedProfile {
  id: string
  member: number
  intel_profile: object
  intel_version: number
  intel_updated_at: string
  intel_updated_by: string
  status: string
}

type Screen = 'form' | 'loading' | 'profile' | 'error' | 'list'

export default function SocialIntelPage() {
  const [searchParams] = useSearchParams()
  const [churches, setChurches] = useState<ChurchOption[]>([])
  const [filtered, setFiltered] = useState<ChurchOption[]>([])
  const [search, setSearch] = useState('')
  const [selectedMember, setSelectedMember] = useState<number | null>(null)
  const [amNotes, setAmNotes] = useState('')
  const [screen, setScreen] = useState<Screen>('form')
  const [profile, setProfile] = useState<object | null>(null)
  const [profileMeta, setProfileMeta] = useState<Record<string, string> | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [wasEdited, setWasEdited] = useState(false)
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('strategy_account_progress')
      .select('member, church_name, church_website')
      .order('church_name', { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as ChurchOption[]
        setChurches(list)
        setFiltered(list)

        const memberParam = searchParams.get('member')
        if (memberParam) {
          const found = list.find(c => String(c.member) === memberParam)
          if (found) setSelectedMember(found.member)
        }
      })
  }, [searchParams])

  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(
      q
        ? churches.filter(
            c =>
              (c.church_name ?? '').toLowerCase().includes(q) ||
              String(c.member).includes(q)
          )
        : churches
    )
  }, [search, churches])

  const selectedChurch = churches.find(c => c.member === selectedMember) ?? null

  const loadSavedProfiles = useCallback(async () => {
    setListLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      const { data } = await db
        .from('strategy_church_intel')
        .select('id, member, intel_profile, intel_version, intel_updated_at, intel_updated_by, status')
        .eq('status', 'live')
        .order('intel_updated_at', { ascending: false })
      setSavedProfiles((data ?? []) as SavedProfile[])
    } finally {
      setListLoading(false)
    }
  }, [])

  const openList = useCallback(async () => {
    setScreen('list')
    await loadSavedProfiles()
  }, [loadSavedProfiles])

  const openSavedProfile = (saved: SavedProfile) => {
    const church = churches.find(c => c.member === saved.member)
    setSelectedMember(saved.member)
    setProfile(saved.intel_profile)
    setCurrentProfileId(saved.id)
    setProfileMeta(null)
    setSaved(true)
    setEditMode(false)
    setWasEdited(false)
    setScreen('profile')
    // Pre-fill search to match the church
    if (church?.church_name) setSearch(church.church_name)
  }

  const generate = useCallback(async () => {
    if (!selectedMember) return
    setScreen('loading')
    setProfile(null)
    setErrorMsg('')
    setSaved(false)
    setEditMode(false)
    setWasEdited(false)
    setCurrentProfileId(null)

    try {
      const { data, error } = await supabase.functions.invoke('social-intel-generate', {
        body: { memberId: selectedMember, amNotes: amNotes.trim() || undefined },
      })
      if (error) throw new Error(error.message ?? 'Generation failed')
      setProfile(data.profile)
      setProfileMeta(data.meta ?? null)
      setScreen('profile')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(msg)
      setScreen('error')
    }
  }, [selectedMember, amNotes])

  const saveProfile = async () => {
    if (!profile || !selectedMember) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email ?? 'unknown'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any

      // Use currentProfileId if we loaded from saved, otherwise look up by member
      let existing: { id: string; intel_version: number } | null = null
      if (currentProfileId) {
        existing = { id: currentProfileId, intel_version: 0 }
        const { data } = await db.from('strategy_church_intel').select('id, intel_version').eq('id', currentProfileId).maybeSingle()
        if (data) existing = data
      } else {
        const { data } = await db
          .from('strategy_church_intel')
          .select('id, intel_version')
          .eq('member', selectedMember)
          .maybeSingle()
        existing = data ?? null
      }

      const version = (existing?.intel_version ?? 0) + 1
      const reason = wasEdited
        ? 'Manual edit'
        : existing
        ? 'Social Intel Profile regenerated'
        : 'Initial Social Intel Profile generated'

      if (existing) {
        await db.from('strategy_church_intel').update({
          intel_profile: profile,
          intel_version: version,
          intel_updated_at: new Date().toISOString(),
          intel_updated_by: email,
          status: 'live',
        }).eq('id', existing.id)

        await db.from('strategy_church_intel_history').insert({
          church_intel_id: existing.id,
          version,
          intel_profile: profile,
          author_email: email,
          reason,
        })
        setCurrentProfileId(existing.id)
      } else {
        const { data: inserted } = await db.from('strategy_church_intel').insert({
          member: selectedMember,
          intel_profile: profile,
          intel_version: 1,
          intel_updated_at: new Date().toISOString(),
          intel_updated_by: email,
          status: 'live',
        }).select('id').single()

        if (inserted) {
          await db.from('strategy_church_intel_history').insert({
            church_intel_id: inserted.id,
            version: 1,
            intel_profile: profile,
            author_email: email,
            reason,
          })
          setCurrentProfileId(inserted.id)
        }
      }

      setSaved(true)
      setWasEdited(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      alert(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleProfileChange = (updated: object) => {
    setProfile(updated)
    setSaved(false)
    setWasEdited(true)
  }

  const churchNameForMember = (member: number) =>
    churches.find(c => c.member === member)?.church_name ?? `Member ${member}`

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#341756]">Social Church Intel</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Enter a church ID — the tool researches their website, social profiles, and current content, then builds a complete writing guide for your team.
          </p>
        </div>
        {screen !== 'list' && (
          <button
            onClick={openList}
            className="border border-[#513DE5] text-[#513DE5] font-semibold px-4 py-2 rounded-xl hover:bg-[#F9F5F1] transition-colors text-sm whitespace-nowrap"
          >
            View Saved Profiles
          </button>
        )}
      </div>

      {/* Saved Profiles List screen */}
      {screen === 'list' && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setScreen('form')}
              className="border border-gray-200 text-gray-600 font-semibold px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors text-sm"
            >
              ← Back
            </button>
            <h2 className="text-lg font-bold text-[#341756]">Saved Profiles</h2>
          </div>

          {listLoading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading profiles…</div>
          ) : savedProfiles.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#CFC9F8] p-12 text-center">
              <p className="text-gray-400 text-sm">No saved profiles yet. Generate and save one first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {savedProfiles.map(sp => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const churchName = (sp.intel_profile as any)?.church_overview?.church_name ?? churchNameForMember(sp.member)
                const updatedDate = new Date(sp.intel_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <button
                    key={sp.id}
                    onClick={() => openSavedProfile(sp)}
                    className="bg-white border border-[#CFC9F8] rounded-2xl p-5 text-left hover:border-[#513DE5] hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-[#341756] group-hover:text-[#513DE5] transition-colors">{churchName}</p>
                      <span className="text-xs bg-[#EDE9FC] text-[#513DE5] px-2 py-0.5 rounded-full whitespace-nowrap">v{sp.intel_version}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">#{sp.member} · Updated {updatedDate}</p>
                    <p className="text-xs text-gray-400">by {sp.intel_updated_by}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Form screen */}
      {screen === 'form' && (
        <div className="bg-white rounded-2xl border border-[#CFC9F8] p-6 shadow-sm">
          <div className="mb-6">
            <label className="block text-sm font-semibold text-[#341756] mb-2">
              Search by church name or ID
            </label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type a name or ID number..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5]"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-[#341756] mb-2">
              Select church
            </label>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {filtered.length === 0 && (
                <p className="text-sm text-gray-400 px-3 py-4 text-center">No churches found</p>
              )}
              {filtered.map(c => (
                <button
                  key={c.member}
                  onClick={() => setSelectedMember(c.member)}
                  className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between transition-colors ${
                    selectedMember === c.member
                      ? 'bg-[#513DE5] text-white'
                      : 'hover:bg-[#F9F5F1] text-[#341756]'
                  }`}
                >
                  <span>{c.church_name ?? `Member ${c.member}`}</span>
                  <span className={`text-xs ${selectedMember === c.member ? 'text-white/70' : 'text-gray-400'}`}>
                    #{c.member}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedChurch && (
            <div className="mb-6 bg-[#F9F5F1] rounded-lg p-3 text-sm">
              <p className="font-semibold text-[#341756]">{selectedChurch.church_name}</p>
              {selectedChurch.church_website && (
                <p className="text-gray-500 text-xs mt-0.5">{selectedChurch.church_website}</p>
              )}
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-semibold text-[#341756] mb-2">
              AM Notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={amNotes}
              onChange={e => setAmNotes(e.target.value)}
              placeholder="Any context from the Account Manager — new pastor, rebrand, upcoming event, preferences..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#513DE5] min-h-[80px] resize-y"
            />
          </div>

          <button
            onClick={generate}
            disabled={!selectedMember}
            className="w-full bg-[#513DE5] text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Build Social Intel Profile
          </button>
        </div>
      )}

      {/* Loading screen */}
      {screen === 'loading' && (
        <div className="bg-white rounded-2xl border border-[#CFC9F8] p-12 shadow-sm text-center">
          <div className="w-12 h-12 border-4 border-[#513DE5] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <h2 className="text-lg font-bold text-[#341756] mb-2">Building your intel profile…</h2>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Crawling their website, researching Instagram, Facebook, and YouTube, then building the full 8-section profile. This takes about 60–90 seconds.
          </p>
        </div>
      )}

      {/* Profile screen */}
      {screen === 'profile' && profile && (
        <div>
          {profileMeta && (
            <div className="flex flex-wrap gap-2 mb-4 text-xs">
              {profileMeta.instagram && (
                <a href={profileMeta.instagram.startsWith('http') ? profileMeta.instagram : `https://${profileMeta.instagram}`} target="_blank" rel="noopener noreferrer" className="bg-[#CFC9F8] text-[#341756] px-2 py-1 rounded-full">Instagram found ✓</a>
              )}
              {profileMeta.facebook && (
                <a href={profileMeta.facebook.startsWith('http') ? profileMeta.facebook : `https://${profileMeta.facebook}`} target="_blank" rel="noopener noreferrer" className="bg-[#CFC9F8] text-[#341756] px-2 py-1 rounded-full">Facebook found ✓</a>
              )}
              {profileMeta.youtube && (
                <a href={profileMeta.youtube.startsWith('http') ? profileMeta.youtube : `https://${profileMeta.youtube}`} target="_blank" rel="noopener noreferrer" className="bg-[#CFC9F8] text-[#341756] px-2 py-1 rounded-full">YouTube found ✓</a>
              )}
            </div>
          )}

          <div className="flex gap-3 mb-6 flex-wrap items-center">
            <button
              onClick={saveProfile}
              disabled={saving || (saved && !wasEdited)}
              className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 text-sm"
            >
              {saving ? 'Saving…' : saved && !wasEdited ? 'Saved ✓' : wasEdited ? 'Save Changes' : 'Save Profile'}
            </button>
            <button
              onClick={() => {
                setEditMode(e => !e)
              }}
              className={`font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors ${
                editMode
                  ? 'bg-[#EDE9FC] text-[#513DE5] border border-[#513DE5]'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {editMode ? 'Done Editing' : 'Edit Profile'}
            </button>
            <button
              onClick={() => { setScreen('form'); setProfile(null); setSaved(false); setEditMode(false); setWasEdited(false); setCurrentProfileId(null) }}
              className="border border-gray-200 text-gray-600 font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-sm"
            >
              Start Over
            </button>
            <button
              onClick={generate}
              className="border border-[#513DE5] text-[#513DE5] font-semibold px-5 py-2.5 rounded-xl hover:bg-[#F9F5F1] transition-colors text-sm"
            >
              Regenerate
            </button>
            {editMode && (
              <p className="text-xs text-[#513DE5] bg-[#EDE9FC] px-3 py-1.5 rounded-lg">
                Editing — click any field to change it, then Save Changes
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#CFC9F8] p-6 shadow-sm">
            <SocialIntelProfileView
              profile={profile as Parameters<typeof SocialIntelProfileView>[0]['profile']}
              editMode={editMode}
              onProfileChange={handleProfileChange}
            />
          </div>
        </div>
      )}

      {/* Error screen */}
      {screen === 'error' && (
        <div className="bg-white rounded-2xl border border-red-200 p-8 shadow-sm text-center">
          <p className="text-red-600 font-semibold mb-2">Something went wrong</p>
          <p className="text-sm text-gray-500 mb-6">{errorMsg}</p>
          <button
            onClick={() => setScreen('form')}
            className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 text-sm"
          >
            Try Again
          </button>
        </div>
      )}

    </div>
  )
}
