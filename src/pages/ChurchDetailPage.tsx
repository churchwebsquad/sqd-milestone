import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Link, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  StrategyAccountProgress, Account, StrategyMilestoneSubmission,
  StrategyMilestoneDefinition, StrategySubmissionAsset, PrfBrandGuide,
  ClickupFolder, ClickupList, WebsiteSupportAudit, StrategyChurchIntel,
} from '../types/database'
import { DETAIL_SECTIONS } from '../types/churches'
import SectionAnchorNav from '../components/churches/SectionAnchorNav'
import ChurchInfoSection from '../components/churches/ChurchInfoSection'
import AssetsSection from '../components/churches/AssetsSection'
import HandoffSection from '../components/churches/HandoffSection'
import BrandSquadSection from '../components/churches/BrandSquadSection'
import BrandVoiceSection from '../components/churches/BrandVoiceSection'
import WebSquadSection from '../components/churches/WebSquadSection'
import SocialMediaSection from '../components/churches/SocialMediaSection'
import ClickUpTasksSection from '../components/churches/ClickUpTasksSection'

// ── Enriched submission (same pattern as AccountLogPage) ─────────────────────
export interface EnrichedSubmission {
  submission: StrategyMilestoneSubmission
  milestone: StrategyMilestoneDefinition | null
  assets: StrategySubmissionAsset[]
}

export default function ChurchDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const navigate = useNavigate()
  const memberNum = Number(memberId)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  // Data
  const [church, setChurch] = useState<StrategyAccountProgress | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [submissions, setSubmissions] = useState<EnrichedSubmission[]>([])
  const [brandGuides, setBrandGuides] = useState<PrfBrandGuide[]>([])
  const [clickupFolder, setClickupFolder] = useState<ClickupFolder | null>(null)
  const [clickupLists, setClickupLists] = useState<ClickupList[]>([])
  const [websiteAudits, setWebsiteAudits] = useState<WebsiteSupportAudit[]>([])
  const [churchIntel, setChurchIntel] = useState<StrategyChurchIntel | null>(null)

  // Portal copy
  const [portalCopied, setPortalCopied] = useState(false)

  // ── Load all data in parallel ──────────────────────────────────────────────
  useEffect(() => {
    if (!memberNum) return

    const load = async () => {
      try {
        const [churchRes, acctRes, subRes, defsRes, guidesRes, folderRes, listsRes, auditRes, intelRes] = await Promise.all([
          supabase.from('strategy_account_progress').select('*').eq('member', memberNum).maybeSingle(),
          supabase.from('accounts').select('*').eq('account', memberNum).maybeSingle(),
          supabase.from('strategy_milestone_submissions').select('*').eq('member', memberNum).eq('is_active', true).order('submitted_at', { ascending: false }),
          supabase.from('strategy_milestone_definitions').select('*'),
          supabase.from('prf_brand_guides').select('*').eq('account', memberNum),
          supabase.from('clickup_folders').select('*').eq('account', memberNum).eq('space_id', 90171129510).maybeSingle(),
          supabase.from('clickup_lists').select('*').eq('account', memberNum).eq('active', true),
          // Load ALL website_support_audit rows — filter client-side by comma-separated website_accounts
          supabase.from('website_support_audit').select('name, website_accounts'),
          supabase.from('strategy_church_intel').select('*').eq('member', memberNum).maybeSingle(),
        ])

        if (churchRes.error) throw churchRes.error

        setChurch(churchRes.data as StrategyAccountProgress | null)
        setAccount(acctRes.data as Account | null)
        setBrandGuides((guidesRes.data ?? []) as PrfBrandGuide[])
        setClickupFolder(folderRes.data as ClickupFolder | null)
        setClickupLists((listsRes.data ?? []) as ClickupList[])

        // Client-side filter: split website_accounts by comma, check if memberNum is in the list
        const allAudits = (auditRes.data ?? []) as WebsiteSupportAudit[]
        const matched = allAudits.filter(a => {
          if (!a.website_accounts) return false
          const members = a.website_accounts.split(',').map(s => s.trim())
          return members.includes(String(memberNum))
        })
        setWebsiteAudits(matched)
        setChurchIntel(intelRes.data as StrategyChurchIntel | null)

        // Enrich submissions
        const subs = (subRes.data ?? []) as StrategyMilestoneSubmission[]
        const defs = (defsRes.data ?? []) as StrategyMilestoneDefinition[]
        const defMap = new Map<string, StrategyMilestoneDefinition>()
        for (const d of defs) defMap.set(d.id, d)

        // Fetch assets for all submissions
        const subIds = subs.map(s => s.id)
        let allAssets: StrategySubmissionAsset[] = []
        if (subIds.length > 0) {
          const { data: assetData } = await supabase
            .from('strategy_submission_assets')
            .select('*')
            .in('submission_id', subIds)
            .order('sort_order')
          allAssets = (assetData ?? []) as StrategySubmissionAsset[]
        }
        const assetsBySubmission = new Map<string, StrategySubmissionAsset[]>()
        for (const a of allAssets) {
          const arr = assetsBySubmission.get(a.submission_id) ?? []
          arr.push(a)
          assetsBySubmission.set(a.submission_id, arr)
        }

        const enriched: EnrichedSubmission[] = subs.map(s => ({
          submission: s,
          milestone: defMap.get(s.current_milestone_id) ?? null,
          assets: assetsBySubmission.get(s.id) ?? [],
        }))
        setSubmissions(enriched)
      } catch (err) {
        setError((err as { message?: string })?.message ?? 'Failed to load church details')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [memberNum])

  // ── Save handler for editable fields ───────────────────────────────────────
  const handleSave = async (field: string, value: unknown) => {
    const { error: err } = await supabase
      .from('strategy_account_progress')
      .update({ [field]: value } as Record<string, unknown>)
      .eq('member', memberNum)
    if (err) throw err
    setChurch(prev => prev ? { ...prev, [field]: value } : prev)
  }

  const handleCopyPortal = () => {
    const token = church?.portal_token ?? memberNum
    const url = `${window.location.origin}/portal/${token}`
    navigator.clipboard.writeText(url).then(() => {
      setPortalCopied(true)
      setTimeout(() => setPortalCopied(false), 2000)
    })
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-5xl mx-auto">
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-lavender rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    )
  }

  if (!church) {
    return (
      <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Church with member #{memberId} not found.
        </div>
      </div>
    )
  }

  const brandSubmissions = submissions.filter(e => e.milestone?.squad === 'brand')
  const webSubmissions = submissions.filter(e => e.milestone?.squad === 'web')

  return (
    <div className="min-h-full py-6 px-4 md:px-6">
      <div className="max-w-6xl mx-auto">

        {/* Back + header */}
        <button
          type="button"
          onClick={() => navigate('/churches')}
          className="inline-flex items-center gap-1.5 text-sm text-purple-gray hover:text-primary-purple transition-colors mb-4"
        >
          <ArrowLeft size={14} /> Back to Churches
        </button>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">Church Detail</p>
            <h1 className="text-2xl font-semibold text-deep-plum">
              {church.church_name ?? `Member #${memberNum}`}
            </h1>
            <p className="text-sm text-purple-gray mt-0.5">
              Member #{memberNum} · {church.css_rep ?? 'No account manager'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyPortal}
            className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors shrink-0 mt-1"
          >
            {portalCopied ? <Check size={12} className="text-green-600" /> : <Link size={12} />}
            {portalCopied ? 'Copied!' : 'Partner Milestone Portal'}
          </button>
        </div>

        {/* Content layout: anchor nav + sections */}
        <div className="flex gap-6">
          {/* Sticky anchor nav (desktop only) */}
          <div className="hidden lg:block w-48 shrink-0">
            <SectionAnchorNav
              sections={DETAIL_SECTIONS as unknown as { id: string; label: string }[]}
              editing={editing}
              onToggleEdit={() => setEditing(v => !v)}
            />
          </div>

          {/* Sections */}
          <div className="flex-1 min-w-0 space-y-6">
            <ChurchInfoSection church={church} account={account} onSave={handleSave} editing={editing} />
            <AssetsSection church={church} submissions={submissions} />
            <HandoffSection church={church} />
            <BrandSquadSection
              church={church}
              submissions={brandSubmissions}
              brandGuides={brandGuides}
              portalToken={church.portal_token}
              memberId={memberNum}
            />
            <BrandVoiceSection church={church} onSave={handleSave} editing={editing} />
            <WebSquadSection
              church={church}
              submissions={webSubmissions}
              websiteAudits={websiteAudits}
              onSave={handleSave}
              editing={editing}
              portalToken={church.portal_token}
              memberId={memberNum}
            />
            <SocialMediaSection church={church} account={account} churchIntel={churchIntel} />
            <ClickUpTasksSection
              memberId={memberNum}
              clickupLists={clickupLists}
              clickupFolder={clickupFolder}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
