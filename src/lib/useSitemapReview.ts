/**
 * React hook — subscribes to a project's sitemap review status. Used
 * by downstream workspaces (PagesWorkspace, CopyEngine, DevHandoff) to
 * surface "there's an approved review — its data is authoritative"
 * banners AND to read per-page approved purposes for display alongside
 * the raw web_pages data.
 *
 * Returns the review (any status) or null when none exists. Consumers
 * decide whether to prefer/fall back based on review.status.
 */

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadSitemapReview, type SitemapReview } from './sitemapReview'

interface State {
  review: SitemapReview | null
  loading: boolean
  error: string | null
}

export function useSitemapReview(projectId: string | null | undefined): State {
  const [state, setState] = useState<State>({ review: null, loading: true, error: null })

  useEffect(() => {
    if (!projectId) {
      setState({ review: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    ;(async () => {
      try {
        const review = await loadSitemapReview(supabase, projectId)
        if (cancelled) return
        setState({ review, loading: false, error: null })
      } catch (e) {
        if (cancelled) return
        setState({ review: null, loading: false, error: (e as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [projectId])

  return state
}

/** Returns the review only when it's status=approved — the strict
 *  form downstream tools should read when they need canonical data. */
export function useApprovedSitemapReview(projectId: string | null | undefined): SitemapReview | null {
  const { review } = useSitemapReview(projectId)
  return review?.status === 'approved' ? review : null
}

/** Map from page slug → approved purpose text. Empty map when no
 *  approved review exists. Consumers use this to overlay the approved
 *  purpose onto their existing page render without changing the base
 *  data source. */
export function useApprovedPagePurposesBySlug(projectId: string | null | undefined): Map<string, string> {
  const approved = useApprovedSitemapReview(projectId)
  const map = new Map<string, string>()
  if (!approved) return map
  for (const p of (approved.pages ?? [])) {
    if (p.slug && p.purpose && p.purpose.trim()) map.set(p.slug, p.purpose.trim())
  }
  return map
}
