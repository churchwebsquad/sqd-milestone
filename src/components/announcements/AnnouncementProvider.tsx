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

  // Re-fetch on auth change + on every route change. The latter keeps
  // the popup feeling fresh for users who leave a tab open across
  // posting cycles.
  useEffect(() => {
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
  }, [user?.id, staffProfile?.department, location.pathname])

  const handleDismiss = async () => {
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
