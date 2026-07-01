/**
 * Small banner surfacing "this project has an approved sitemap review"
 * on downstream workspaces (PagesWorkspace, CopyEngineWorkspace,
 * DevHandoffWorkspace). Mounts anywhere a "downstream tools should
 * respect this" reminder makes sense; clicking the banner reopens
 * the editor overlay so staff can review it without hunting.
 */

import { useState } from 'react'
import { SitemapReviewEditor } from './SitemapReviewEditor'
import { useSitemapReview } from '../../../lib/useSitemapReview'

interface Props {
  projectId: string
  churchName?: string | null
  /** When true, the banner also renders for non-approved statuses
   *  (draft / published / partner_reviewed) so staff can see the
   *  review's state at a glance. When false (default), only shows
   *  once approved. */
  showAllStatuses?: boolean
}

export function ApprovedSitemapBanner({ projectId, churchName, showAllStatuses }: Props) {
  const { review, loading } = useSitemapReview(projectId)
  const [open, setOpen] = useState(false)
  if (loading || !review) return null
  if (!showAllStatuses && review.status !== 'approved') return null

  const config = {
    draft: {
      classes: 'border-wm-border bg-wm-bg-elevated text-wm-text-muted',
      label:   'Sitemap review — draft (not yet published)',
    },
    published: {
      classes: 'border-blue-300 bg-blue-50 text-blue-800',
      label:   'Sitemap review — published, awaiting partner',
    },
    partner_reviewed: {
      classes: 'border-amber-300 bg-amber-50 text-amber-800',
      label:   'Sitemap review — partner made edits, staff review pending',
    },
    approved: {
      classes: 'border-green-400 bg-green-50 text-green-800',
      label:   'Sitemap review — approved, canonical for downstream tools',
    },
  }[review.status]

  return (
    <>
      {open && (
        <SitemapReviewEditor
          projectId={projectId}
          churchName={churchName}
          onClose={() => setOpen(false)}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-md border px-3 py-2 text-[12px] font-medium ${config.classes} hover:brightness-95 transition`}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-current mr-2 opacity-60" />
        {config.label} — click to view/edit
      </button>
    </>
  )
}
