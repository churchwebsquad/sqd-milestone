/**
 * SitemapFeedbackPage — /web/:projectId/sitemap-feedback
 *
 * Post-Phase-B (2026-07): thin wrapper that renders the same
 * SitemapReviewEditor the Content Engine mounts as a modal, in
 * embed mode as a full-page surface. Preserves the URL so existing
 * Slack notification links and bookmarks keep resolving; the strategist
 * now lands on ONE editor with ONE set of actions no matter which
 * entry point they used.
 *
 * The old divergent implementation (500+ lines of separate feedback
 * rendering + cowork prompt builder) has been retired. Its
 * cowork-prompt-to-copy affordance lives inside the composer now via
 * the CoworkPromptPanel component.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SitemapReviewEditor } from '../../components/wm/sitemapReview/SitemapReviewEditor'

interface ProjectSummary {
  id:          string
  member:      number | null
  name:        string | null
  church_name: string | null
}

export default function SitemapFeedbackPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) { setLoading(false); return } // eslint-disable-line react-hooks/set-state-in-effect
    let cancelled = false
    void (async () => {
      const res = await supabase
        .from('strategy_web_projects')
        .select('id, member, name, church_name')
        .eq('id', projectId)
        .maybeSingle<ProjectSummary>()
      if (cancelled) return
      if (res.error) setError(res.error.message)
      setProject(res.data ?? null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [projectId])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8 flex items-center gap-2 text-wm-text-muted text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading content strategy review…
      </div>
    )
  }
  if (error || !projectId) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-wm-danger">{error ?? 'No project id in the URL.'}</p>
        <Link to="/" className="text-wm-accent underline text-sm">Back home</Link>
      </div>
    )
  }

  const churchName = project?.church_name ?? project?.name ?? null

  return (
    <div className="min-h-screen bg-wm-bg flex flex-col">
      <div className="border-b border-wm-border px-4 py-2 flex items-center gap-3 text-[12px]">
        <button
          type="button"
          onClick={() => navigate(`/web/${projectId}?tab=cowork`)}
          className="inline-flex items-center gap-1 text-wm-text-muted hover:text-wm-text font-semibold"
        >
          <ArrowLeft size={13} /> Back to Content Engine
        </button>
        <span className="text-wm-text-subtle">·</span>
        <span className="text-wm-text font-semibold">{churchName ?? 'Content Strategy Review'}</span>
      </div>
      <div className="flex-1 min-h-0">
        <SitemapReviewEditor
          projectId={projectId}
          embed
          churchName={churchName ?? undefined}
        />
      </div>
    </div>
  )
}
