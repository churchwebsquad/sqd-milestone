/**
 * Mounts the "What's New" popup globally for any signed-in user that
 * has a pending, undismissed announcement targeted at their dept.
 *
 * Wraps the AppLayout's authed branch (above <Outlet />) so the popup
 * shows up regardless of which page the user lands on. On every route
 * change we re-query — staff often have a single-tab session that
 * spans days, so a fresh announcement should land on their next
 * navigation, not require a full reload.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { dismissAnnouncement, listPendingAnnouncement } from '../../lib/announcements'
import { employeeDepartmentToStrategy } from '../../lib/library'
import type { StrategyAnnouncement } from '../../types/database'
import { AnnouncementPopup } from './AnnouncementPopup'

export function AnnouncementProvider({ children }: { children: React.ReactNode }) {
  const { user, staffProfile } = useAuth()
  const location = useLocation()
  const [pending, setPending] = useState<StrategyAnnouncement | null>(null)

  // ── Local preview mode ─────────────────────────────────────────────
  // Add `?preview-announcement=1` to any URL while running the dev
  // server (`npm run dev`) to render a fake announcement without
  // writing anything to Supabase. Dismiss closes the popup locally;
  // append `?preview-announcement=1` to a fresh URL to re-show it.
  // Gated on `import.meta.env.DEV` so the preview branch is dead-code
  // eliminated from production builds — there's no way for this to
  // surface to real staff.
  const isPreview = import.meta.env.DEV &&
    new URLSearchParams(location.search).get('preview-announcement') === '1'

  // Re-fetch on auth change + on every route change. The latter keeps
  // the popup feeling fresh for users who leave a tab open across
  // posting cycles.
  useEffect(() => {
    if (isPreview) {
      setPending(PREVIEW_ANNOUNCEMENT)
      return
    }
    if (!user?.id) {
      setPending(null)
      return
    }
    let cancelled = false
    const dept = employeeDepartmentToStrategy(staffProfile?.department ?? null)
    listPendingAnnouncement(user.id, dept).then(row => {
      if (!cancelled) setPending(row)
    })
    return () => { cancelled = true }
  }, [user?.id, staffProfile?.department, location.pathname, isPreview])

  const handleDismiss = async () => {
    if (isPreview) {
      // Preview-only: just clear the local state, no DB write. Reload
      // the page to see it again (or remove the query param).
      setPending(null)
      return
    }
    if (!pending || !user?.id) return
    const id = pending.id
    setPending(null) // optimistic — the popup vanishes immediately
    try {
      await dismissAnnouncement(id, user.id)
    } catch (err) {
      // If the dismiss write failed, the popup will reappear on the
      // next route change. Acceptable; the alternative (silently
      // pretending the dismiss landed) would lose the user's intent.
      console.warn('[announcements] dismiss failed, will retry on next view:', err)
    }
    // Look for the next pending announcement (newest-first). If none,
    // the popup stays hidden until something new lands.
    const dept = employeeDepartmentToStrategy(staffProfile?.department ?? null)
    const next = await listPendingAnnouncement(user.id, dept)
    setPending(next)
  }

  return (
    <>
      {children}
      {pending && (
        <AnnouncementPopup
          announcement={pending}
          onDismiss={handleDismiss}
        />
      )}
    </>
  )
}

/** Hardcoded sample announcement used by the `?preview-announcement=1`
 *  dev-only mode. Mirrors the shape that comes back from Supabase so
 *  the popup renders identically — including a couple of linked-doc
 *  buttons so the layout is exercised end-to-end. */
const PREVIEW_ANNOUNCEMENT: StrategyAnnouncement = {
  id: 'preview-only-not-persisted',
  progress_notion_id: 'preview-progress-id',
  initiative_notion_id: 'preview-initiative-id',
  initiative_name: 'Strategy OS App',
  initiative_department: 'all-in',
  headline: 'New SOPs are live',
  body: 'We just shipped guides for using the Strategy OS app. Take a few minutes to skim — they\'re in the Library under Process & Workflows.\n\nThis is a local preview — nothing is being broadcast.',
  linked_docs: [
    { notion_id: 'preview-doc-1', title: 'How to verify a doc' },
    { notion_id: 'preview-doc-2', title: 'Posting an Initiative progress update' },
  ],
  created_by_employee_id: null,
  created_at: new Date().toISOString(),
  is_active: true,
  retired_at: null,
}
