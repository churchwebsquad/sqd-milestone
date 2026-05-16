/**
 * Web Manager — Sitemap proposal banner.
 *
 * Surfaces the AI Stage 2 sitemap proposal at the top of the Pages
 * workspace: shows when a proposal exists (committed or not), lets
 * the strategist expand to see the full Stage 2 view, commit pages
 * from the proposal, or redo with feedback.
 *
 * Mid-flight (roadmap_stage = drafting_sitemap), shows a streaming
 * status card instead so the user knows the agent is working.
 *
 * Extracted from the old SitemapWorkspace when page-tree management
 * folded into Pages (Phase 2 of the workspace restructure). The
 * banner now lives in PagesWorkspace's editor area so it's visible
 * regardless of which page (if any) is selected.
 */
import { useState } from 'react'
import {
  Sparkles, CheckCircle2, RotateCw, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react'
import { WMCard } from './Card'
import { WMButton } from './Button'
import { WMStatusPill } from './StatusPill'
import { Stage2SitemapView } from './Stage2SitemapView'
import { RedoModal } from './RedoModal'
import { commitSitemapToPages } from '../../lib/webSitemap'
import { draftSitemap } from '../../lib/webAgents'
import type { StrategyWebProject } from '../../types/database'

interface Props {
  project: StrategyWebProject
  onCommitted: () => void | Promise<void>
  onRefreshed: () => void | Promise<void>
}

export function SitemapProposalBanner({ project, onCommitted, onRefreshed }: Props) {
  const stage2 = (project.roadmap_state as { stage_2?: Record<string, unknown> } | null)?.stage_2
  const hasData = !!stage2 && Object.keys(stage2).some(k => k !== '_meta')
  const meta = stage2?._meta as Record<string, unknown> | undefined
  const committedAt = meta?.committed_at as string | undefined
  const phaseSummary = stage2?.phase_summary as Record<string, unknown> | undefined
  const totalPages = phaseSummary?.total as number | undefined

  const [expanded, setExpanded] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [redoOpen, setRedoOpen] = useState(false)
  const [redoing, setRedoing] = useState(false)
  const [redoMsg, setRedoMsg] = useState<string | null>(null)

  const agentRunning = redoing || project.roadmap_stage === 'drafting_sitemap'

  if (!hasData && !agentRunning) return null

  if (agentRunning) {
    return (
      <WMCard padding="loose" className="mb-5 border-wm-ai-border bg-wm-ai-bg/40">
        <div className="flex items-center gap-3">
          <Loader2 size={16} className="text-wm-accent-strong animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-wm-text">
              {redoing ? 'Refining sitemap proposal…' : 'AI drafting sitemap…'}
            </p>
            <p className="text-[12px] text-wm-text-muted mt-0.5">
              Opus is reading your previous proposal + feedback and applying changes.
              This usually takes 60–180s. You can leave this tab — progress is auto-saved.
            </p>
          </div>
        </div>
      </WMCard>
    )
  }

  const handleCommit = async () => {
    if (!confirm('Create web_pages records from the AI proposal? Existing pages with the same slug will be skipped.')) return
    setCommitting(true)
    setCommitMsg(null)
    const { result, error } = await commitSitemapToPages(project.id)
    setCommitting(false)
    if (error) {
      setCommitMsg(`Error: ${error.error}`)
      return
    }
    if (result) {
      setCommitMsg(`Created ${result.created} page${result.created === 1 ? '' : 's'}${result.skipped ? ` · skipped ${result.skipped} duplicate slug${result.skipped === 1 ? '' : 's'}` : ''}.`)
      await onCommitted()
    }
  }

  const alreadyCommitted = !!committedAt

  const handleRedo = async (context: string) => {
    setRedoOpen(false)
    setRedoing(true)
    setRedoMsg(null)
    try {
      const { result, error } = await draftSitemap(project.id, context)
      if (error) {
        setRedoMsg(`Error: ${error.error}`)
        return
      }
      if (result) {
        setRedoMsg('Proposal refined.')
        await onRefreshed()
      }
    } catch (e) {
      setRedoMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRedoing(false)
    }
  }

  return (
    <WMCard padding="loose" className="mb-5 border-wm-ai-border bg-wm-ai-bg/40">
      <div className="flex items-start gap-3 flex-wrap">
        <Sparkles size={18} className="text-wm-accent-strong shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-semibold text-wm-text">
              Sitemap proposal{totalPages ? ` · ${totalPages} pages` : ''}
            </p>
            {alreadyCommitted && (
              <WMStatusPill tone="success" size="sm" icon={<CheckCircle2 size={10} />}>
                Committed
              </WMStatusPill>
            )}
            {!alreadyCommitted && (
              <WMStatusPill tone="ai" size="sm">Awaiting approval</WMStatusPill>
            )}
          </div>
          <p className="text-[12px] text-wm-text-muted mt-0.5">
            {alreadyCommitted
              ? `Committed to web pages ${new Date(committedAt!).toLocaleString()}. Proposal stays available for reference.`
              : 'Review the full proposal, then commit the pages so they appear in the tree and in this tab.'}
          </p>
          {commitMsg && (
            <p className="text-[12px] mt-2 text-wm-accent-strong">{commitMsg}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <WMButton
            variant="ghost"
            size="sm"
            iconLeft={expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            onClick={() => setExpanded(o => !o)}
          >
            {expanded ? 'Hide proposal' : 'View proposal'}
          </WMButton>
          {!alreadyCommitted && (
            <>
              <WMButton
                variant="primary"
                size="sm"
                onClick={handleCommit}
                loading={committing}
                disabled={committing}
              >
                Approve &amp; commit pages
              </WMButton>
              <WMButton
                variant="ghost"
                size="sm"
                iconLeft={<RotateCw size={11} />}
                onClick={() => setRedoOpen(true)}
                disabled={redoing}
              >
                Redo with changes
              </WMButton>
            </>
          )}
        </div>
      </div>
      {redoMsg && (
        <p className="text-[12px] mt-3 text-wm-accent-strong">{redoMsg}</p>
      )}
      {expanded && (
        <div className="mt-5 pt-5 border-t border-wm-border">
          <Stage2SitemapView data={stage2!} viewMode="author" />
        </div>
      )}
      {redoOpen && (
        <RedoModal
          stageNum={2}
          stageTitle="Sitemap"
          loading={redoing}
          onClose={() => setRedoOpen(false)}
          onSubmit={handleRedo}
        />
      )}
    </WMCard>
  )
}
