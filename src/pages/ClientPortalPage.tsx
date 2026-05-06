import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Check, ExternalLink, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  Squad,
  StrategyMilestoneDefinition,
  StrategyMilestoneSubmission,
  StrategySubmissionAsset,
} from '../types/database'
import { SQUAD_LABELS, PATHWAY_LABELS, ASSET_TYPE_LABELS } from '../components/submit/types'

// ── Local types ───────────────────────────────────────────────────────────────

interface PartnerInfo {
  member: number
  church_name: string | null
}

// Slim reference used during pathway detection — only what we need
interface MilestoneRef {
  id: string
  squad: Squad
  pathway: string
  step_number: number
}

/** One submission's rollup — each round (original + continuations) is a Round. */
interface Round {
  submissionId: string
  submittedAt: string
  assets: StrategySubmissionAsset[]
  threadUrl: string | null
}

interface TimelineItem {
  definition: StrategyMilestoneDefinition
  status: 'completed' | 'current' | 'upcoming'
  /** Rounds ordered oldest → newest. First is Round 1, second is Round 2, etc. */
  rounds: Round[]
}

interface PathwayData {
  squad: Squad
  pathway: string
  /** Optional track/subbrand label. Shown in the pathway header when present. */
  trackName: string | null
  items: TimelineItem[]
}

const MULTI_TRACK_PATHWAYS = new Set(['ministry_subbrand'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── TimelineNode ──────────────────────────────────────────────────────────────

function TimelineNode({ item, isLast }: { item: TimelineItem; isLast: boolean }) {
  const { definition, status, rounds } = item
  const isCompleted = status === 'completed'
  const isCurrent = status === 'current'
  const isUpcoming = status === 'upcoming'
  const hasRounds = rounds.length > 0
  const latestSubmittedAt = hasRounds ? rounds[rounds.length - 1].submittedAt : null
  const showRoundLabels = rounds.length > 1

  return (
    <div className="flex gap-3 sm:gap-4">
      {/* Left column: node + connecting line */}
      <div className="flex flex-col items-center" style={{ width: '32px' }}>
        <div
          className={[
            'flex-none h-8 w-8 rounded-full flex items-center justify-center z-10',
            isCompleted
              ? 'bg-deep-plum'
              : isCurrent
              ? 'bg-primary-purple ring-4 ring-primary-purple/15 shadow-md shadow-primary-purple/25'
              : 'bg-cream border-2 border-lavender',
          ].join(' ')}
        >
          {isCompleted && <Check size={13} className="text-white" strokeWidth={3} />}
          {isCurrent && <div className="h-2.5 w-2.5 rounded-full bg-white" />}
        </div>
        {!isLast && (
          <div
            className={[
              'w-px flex-1 mt-1 min-h-[32px]',
              isCompleted ? 'bg-deep-plum/20' : 'bg-lavender',
            ].join(' ')}
          />
        )}
      </div>

      {/* Right column: content */}
      <div className={['flex-1 pt-0.5', isLast ? 'pb-0' : 'pb-6'].join(' ')}>
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={[
              'font-semibold leading-snug',
              isUpcoming
                ? 'text-purple-gray/60'
                : isCurrent
                ? 'text-primary-purple text-[15px]'
                : 'text-deep-plum',
            ].join(' ')}
          >
            {definition.step_name}
          </p>
          {rounds.length > 1 && (
            <span className="text-[10px] font-bold text-primary-purple bg-primary-purple/10 rounded-full px-2 py-0.5">
              {rounds.length} rounds
            </span>
          )}
        </div>

        {latestSubmittedAt && (isCompleted || isCurrent) && (
          <p className="text-xs text-purple-gray mt-0.5">
            {isCompleted ? 'Completed ' : 'Last updated '}
            {formatDate(latestSubmittedAt)}
          </p>
        )}

        {/* Rounds — each submission gets its own block */}
        {hasRounds && (
          <div className="mt-3 space-y-3">
            {rounds.map((round, i) => (
              <RoundBlock
                key={round.submissionId}
                round={round}
                label={showRoundLabels ? `Round ${i + 1}` : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── RoundBlock ────────────────────────────────────────────────────────────────

function RoundBlock({ round, label }: { round: Round; label: string | null }) {
  const { assets, threadUrl, submittedAt } = round
  return (
    <div className={label ? 'rounded-lg bg-lavender-tint/30 border border-lavender/40 px-3 py-2.5' : ''}>
      {label && (
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-primary-purple uppercase tracking-widest">
            {label}
          </p>
          <p className="text-[10px] text-purple-gray">{formatDate(submittedAt)}</p>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <p className="text-[10px] font-semibold text-purple-gray/70 uppercase tracking-wide mb-1.5">
            Attached Assets
          </p>
          {assets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {assets.map(asset => (
                <a
                  key={asset.id}
                  href={asset.asset_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-lavender-tint border border-lavender text-primary-purple text-xs font-medium px-2.5 py-1 hover:bg-lavender/60 transition-colors"
                >
                  <ExternalLink size={10} />
                  {ASSET_TYPE_LABELS[asset.asset_type]}
                  {asset.asset_label ? ` — ${asset.asset_label}` : ''}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-purple-gray/50 italic">No assets attached</p>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold text-purple-gray/70 uppercase tracking-wide mb-1.5">
            View in ClickUp
          </p>
          {threadUrl ? (
            <a
              href={threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-lavender text-purple-gray text-xs font-medium px-2.5 py-1 hover:border-primary-purple hover:text-primary-purple transition-colors"
            >
              <ExternalLink size={10} />
              Open message thread
            </a>
          ) : (
            <p className="text-xs text-purple-gray/50 italic">Link not available</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PathwayTimeline ───────────────────────────────────────────────────────────

function PathwayTimeline({ data }: { data: PathwayData }) {
  const { squad, pathway, trackName, items } = data

  // Group consecutive items by section_group for visual dividers
  const sections: Array<{ group: string | null; items: TimelineItem[] }> = []
  for (const item of items) {
    const group = item.definition.section_group
    const last = sections[sections.length - 1]
    if (last && last.group === group) {
      last.items.push(item)
    } else {
      sections.push({ group, items: [item] })
    }
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl shadow-sm overflow-hidden">
      {/* Pathway header */}
      <div className="px-5 py-4 border-b border-lavender bg-lavender-tint/40">
        <p className="text-xs font-bold text-primary-purple uppercase tracking-wider mb-0.5">
          {SQUAD_LABELS[squad] ?? squad}
          {trackName && <span className="ml-1.5 text-primary-purple/70">· {trackName}</span>}
        </p>
        <h3 className="text-base font-semibold text-deep-plum">
          {PATHWAY_LABELS[pathway] ?? pathway}
        </h3>
      </div>

      <div className="px-5 py-6">
        {sections.map((section, si) => (
          <div key={si}>
            {/* Section group divider */}
            {section.group && (
              <div className="flex items-center gap-3 mt-1 mb-4" style={{ marginTop: si === 0 ? 0 : undefined }}>
                <div className="h-px flex-1 bg-lavender" />
                <span className="text-[11px] font-bold text-purple-gray uppercase tracking-widest whitespace-nowrap px-1">
                  {section.group}
                </span>
                <div className="h-px flex-1 bg-lavender" />
              </div>
            )}
            {section.items.map(item => {
              const globalIdx = items.indexOf(item)
              return (
                <TimelineNode
                  key={item.definition.id}
                  item={item}
                  isLast={globalIdx === items.length - 1}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Portal header / shell ─────────────────────────────────────────────────────

function PortalHeader({ churchName }: { churchName: string | null }) {
  return (
    <header className="bg-hero-gradient px-6 pt-10 pb-12 text-center">
      <img
        src="/brand/Style=Circle Badge Filled.svg"
        alt="Church Media Squad"
        className="h-11 w-11 brightness-0 invert mx-auto mb-4"
      />
      <p className="text-white/50 text-[11px] font-bold uppercase tracking-widest mb-3">
        Church Media Squad
      </p>
      <h1 className="text-white text-2xl sm:text-3xl font-bold leading-tight">
        {churchName ?? 'Your Project'}
      </h1>
      <p className="text-white/50 text-sm mt-2">All-In Milestone Progress</p>
    </header>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [partner, setPartner] = useState<PartnerInfo | null>(null)
  const [pathways, setPathways] = useState<PathwayData[]>([])

  useEffect(() => {
    if (!token) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const load = async () => {
      try {
        // ── 1. Look up partner by opaque portal token ───────────────────────
        const { data: partnerData } = await supabase
          .from('strategy_account_progress')
          .select('member, church_name')
          .eq('portal_token', token)
          .maybeSingle()

        if (!partnerData) {
          setNotFound(true)
          return
        }

        setPartner(partnerData as PartnerInfo)

        // ── 2. Load submissions for this member ────────────────────────────
        const { data: submissionsData } = await supabase
          .from('strategy_milestone_submissions')
          .select('*')
          .eq('member', partnerData.member)
          .eq('is_active', true)
          .order('submitted_at', { ascending: false })

        const submissions = (submissionsData ?? []) as StrategyMilestoneSubmission[]

        if (submissions.length === 0) {
          setPathways([])
          return
        }

        // ── 2. Collect all milestone IDs referenced by submissions ──────────
        const milestoneIds = [
          ...new Set([
            ...submissions.map(s => s.milestone_id),
            ...submissions
              .map(s => s.current_milestone_id)
              .filter((id): id is string => !!id && id !== ''),
            ...submissions
              .map(s => s.next_milestone_id)
              .filter((id): id is string => !!id),
          ]),
        ]

        const submissionIds = submissions.map(s => s.id)

        // ── 3. Milestone refs + assets in parallel ──────────────────────────
        const [{ data: milestoneRefsData }, { data: assetsData }] = await Promise.all([
          supabase
            .from('strategy_milestone_definitions')
            .select('id, squad, pathway, step_number')
            .in('id', milestoneIds),
          supabase
            .from('strategy_submission_assets')
            .select('*')
            .in('submission_id', submissionIds)
            .order('sort_order'),
        ])

        // Build quick-lookup maps
        // Cast via unknown: the Supabase select returns squad as string, but we
        // know the values are Squad literals and we need Squad for typed .eq() calls.
        const milestoneRefsById: Record<string, MilestoneRef> = {}
        for (const ref of (milestoneRefsData ?? []) as unknown as MilestoneRef[]) {
          milestoneRefsById[ref.id] = ref
        }

        const assetsBySubmissionId: Record<string, StrategySubmissionAsset[]> = {}
        for (const asset of (assetsData ?? []) as StrategySubmissionAsset[]) {
          if (!assetsBySubmissionId[asset.submission_id]) {
            assetsBySubmissionId[asset.submission_id] = []
          }
          assetsBySubmissionId[asset.submission_id].push(asset)
        }

        // ── 4. Determine unique pathway combos (preserves most-recent-first order) ──
        // For multi-track pathways (ministry_subbrand), each track becomes its own
        // timeline. For single-track pathways, trackName is null.
        const pathwayMap = new Map<string, { squad: Squad; pathway: string; trackName: string | null }>()
        for (const sub of submissions) {
          const ref = milestoneRefsById[sub.milestone_id]
          if (!ref) continue
          const isMulti = MULTI_TRACK_PATHWAYS.has(ref.pathway)
          const trackName = isMulti ? (sub.track_name ?? null) : null
          const key = `${ref.squad}:${ref.pathway}:${trackName ?? ''}`
          if (!pathwayMap.has(key)) {
            pathwayMap.set(key, { squad: ref.squad, pathway: ref.pathway, trackName })
          }
        }
        const pathwayCombos = [...pathwayMap.values()]

        // ── 5. Fetch partner-facing milestones for each pathway in parallel ──
        // Dedupe by pathway so we don't re-query the same defs per track
        const uniquePathways = new Map<string, { squad: Squad; pathway: string }>()
        for (const c of pathwayCombos) {
          const key = `${c.squad}:${c.pathway}`
          if (!uniquePathways.has(key)) uniquePathways.set(key, { squad: c.squad, pathway: c.pathway })
        }
        const uniquePathwayKeys = [...uniquePathways.keys()]
        const pathwayMilestonesArr = await Promise.all(
          uniquePathwayKeys.map(key => {
            const { squad, pathway } = uniquePathways.get(key)!
            return supabase
              .from('strategy_milestone_definitions')
              .select('*')
              .eq('squad', squad)
              .eq('pathway', pathway)
              .eq('is_partner_facing', true)
              .eq('is_active', true)
              .order('step_number')
          })
        )
        const defsByPathwayKey = new Map<string, StrategyMilestoneDefinition[]>()
        uniquePathwayKeys.forEach((key, i) => {
          defsByPathwayKey.set(key, (pathwayMilestonesArr[i].data ?? []) as StrategyMilestoneDefinition[])
        })

        // ── 6. Build lookup maps for status computation ─────────────────────

        // Build track-scoped lookups: key = `${milestone_id}:${trackName||''}`
        const trackKey = (milestoneId: string, trackName: string | null) =>
          `${milestoneId}:${trackName ?? ''}`

        // (milestone_id, track_name) → most recent submission
        const submissionByTrackKey: Record<string, StrategyMilestoneSubmission> = {}
        for (const sub of submissions) {
          const ref = milestoneRefsById[sub.milestone_id]
          if (!ref) continue
          const isMulti = MULTI_TRACK_PATHWAYS.has(ref.pathway)
          const t = isMulti ? (sub.track_name ?? null) : null
          const key = trackKey(sub.milestone_id, t)
          if (!submissionByTrackKey[key]) submissionByTrackKey[key] = sub
        }

        // (milestone_id, track_name) → all submissions oldest → newest (for rounds)
        const submissionsByTrackKey: Record<string, StrategyMilestoneSubmission[]> = {}
        for (const sub of submissions) {
          const ref = milestoneRefsById[sub.milestone_id]
          if (!ref) continue
          const isMulti = MULTI_TRACK_PATHWAYS.has(ref.pathway)
          const t = isMulti ? (sub.track_name ?? null) : null
          const key = trackKey(sub.milestone_id, t)
          if (!submissionsByTrackKey[key]) submissionsByTrackKey[key] = []
          submissionsByTrackKey[key].push(sub)
        }
        for (const key of Object.keys(submissionsByTrackKey)) {
          submissionsByTrackKey[key].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
        }

        // (squad, pathway, track_name) → most recent submission (for current step)
        const mostRecentByPathwayTrack: Record<string, StrategyMilestoneSubmission> = {}
        for (const sub of submissions) {
          const ref = milestoneRefsById[sub.milestone_id]
          if (!ref) continue
          const isMulti = MULTI_TRACK_PATHWAYS.has(ref.pathway)
          const t = isMulti ? (sub.track_name ?? null) : null
          const key = `${ref.squad}:${ref.pathway}:${t ?? ''}`
          if (!mostRecentByPathwayTrack[key]) mostRecentByPathwayTrack[key] = sub
        }

        // ── 7. Build PathwayData — one timeline per (squad, pathway, trackName) ──
        const pathwaysResult: PathwayData[] = pathwayCombos.map(({ squad, pathway, trackName }) => {
          const defs = defsByPathwayKey.get(`${squad}:${pathway}`) ?? []
          const mostRecent = mostRecentByPathwayTrack[`${squad}:${pathway}:${trackName ?? ''}`]

          const youAreHereId = mostRecent?.next_milestone_id?.trim() || null
          const youAreHereStepNumber = youAreHereId
            ? (milestoneRefsById[youAreHereId]?.step_number ?? null)
            : null

          const items: TimelineItem[] = defs.map(def => {
            const tKey = `${def.id}:${trackName ?? ''}`
            const submission = submissionByTrackKey[tKey] ?? null

            let status: 'completed' | 'current' | 'upcoming'
            if (youAreHereId && def.id === youAreHereId) {
              status = 'current'
            } else if (submission !== null) {
              status = 'completed'
            } else if (youAreHereStepNumber !== null && def.step_number < youAreHereStepNumber) {
              status = 'completed'
            } else {
              status = 'upcoming'
            }

            const allForTrack = submissionsByTrackKey[tKey] ?? []
            const rounds: Round[] = allForTrack.map(s => ({
              submissionId: s.id,
              submittedAt: s.submitted_at,
              assets: assetsBySubmissionId[s.id] ?? [],
              threadUrl: s.clickup_thread_url ?? null,
            }))

            return { definition: def, status, rounds }
          })

          return { squad, pathway, trackName, items }
        })

        setPathways(pathwaysResult)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load portal data')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [token])

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!loading && notFound) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <div className="bg-hero-gradient px-6 py-10 flex flex-col items-center">
          <img
            src="/brand/Style=Circle Badge Filled.svg"
            alt="Church Media Squad"
            className="h-10 w-10 brightness-0 invert"
          />
        </div>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <h1 className="text-deep-plum font-semibold text-lg mb-2">Portal not found</h1>
            <p className="text-purple-gray text-sm leading-relaxed">
              This link doesn't appear to be valid. Please contact your account manager at
              Church Media Squad for help finding your project portal.
            </p>
          </div>
        </main>
        <footer className="py-5 text-center text-purple-gray/40 text-xs">
          © Church Media Squad. All rights reserved.
        </footer>
      </div>
    )
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex flex-col">
        <div className="bg-hero-gradient px-6 pt-10 pb-12 text-center">
          <img
            src="/brand/Style=Circle Badge Filled.svg"
            alt="Church Media Squad"
            className="h-11 w-11 brightness-0 invert mx-auto mb-4"
          />
          <p className="text-white/50 text-[11px] font-bold uppercase tracking-widest mb-3">
            Church Media Squad
          </p>
          <div className="h-8 w-48 rounded-full bg-white/10 mx-auto" />
          <div className="h-4 w-28 rounded-full bg-white/10 mx-auto mt-3" />
        </div>
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-lavender border-t-primary-purple" />
          </div>
        </main>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <PortalHeader churchName={partner?.church_name ?? null} />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-5">
        {loadError ? (
          <div className="bg-white border border-lavender rounded-2xl p-6 text-center shadow-sm">
            <p className="text-deep-plum font-medium mb-1">
              Couldn't load your project progress
            </p>
            <p className="text-sm text-purple-gray">
              Please try refreshing the page. If the problem continues, contact
              your account manager.
            </p>
          </div>
        ) : pathways.length === 0 ? (
          <div className="bg-white border border-lavender rounded-2xl p-8 text-center shadow-sm">
            <div className="h-14 w-14 rounded-full bg-lavender-tint flex items-center justify-center mx-auto mb-4">
              <Clock size={24} className="text-primary-purple" />
            </div>
            <h2 className="text-deep-plum font-semibold mb-2">
              Your project journey starts here
            </h2>
            <p className="text-purple-gray text-sm max-w-sm mx-auto leading-relaxed">
              Milestone updates will appear here as your project progresses. Check
              back soon to track your project's journey with our team.
            </p>
          </div>
        ) : (
          pathways.map(pw => (
            <PathwayTimeline key={`${pw.squad}:${pw.pathway}`} data={pw} />
          ))
        )}
      </main>

      <footer className="py-6 text-center text-purple-gray/40 text-xs">
        © Church Media Squad. All rights reserved.
      </footer>
    </div>
  )
}
