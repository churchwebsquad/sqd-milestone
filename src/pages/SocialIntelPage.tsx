import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SocialIntelProfileView from '../components/intel/SocialIntelProfileView'

interface ChurchOption {
  member: number
  church_name: string | null
  church_website: string | null
}

type Screen = 'form' | 'loading' | 'profile' | 'error'

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

  const generate = useCallback(async () => {
    if (!selectedMember) return
    setScreen('loading')
    setProfile(null)
    setErrorMsg('')
    setSaved(false)

    try {
      const res = await fetch('/api/church-intel/generate-social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: selectedMember, amNotes: amNotes.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
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
      const { data: existing } = await db
        .from('strategy_church_intel')
        .select('id, intel_version')
        .eq('member', selectedMember)
        .maybeSingle()

      const version = (existing?.intel_version ?? 0) + 1

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
          reason: 'Social Intel Profile generated',
        })
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
            reason: 'Initial Social Intel Profile generated',
          })
        }
      }

      setSaved(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      alert(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#341756]">Social Church Intel</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Enter a church ID — the tool researches their website, social profiles, and current content, then builds a complete writing guide for your team.
        </p>
      </div>

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

          <div className="flex gap-3 mb-6 flex-wrap">
            <button
              onClick={saveProfile}
              disabled={saving || saved}
              className="bg-[#513DE5] text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-60 text-sm"
            >
              {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Profile'}
            </button>
            <button
              onClick={() => { setScreen('form'); setProfile(null); setSaved(false) }}
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
          </div>

          <div className="bg-white rounded-2xl border border-[#CFC9F8] p-6 shadow-sm">
            <SocialIntelProfileView profile={profile as Parameters<typeof SocialIntelProfileView>[0]['profile']} />
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
