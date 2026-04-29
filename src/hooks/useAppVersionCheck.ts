/**
 * Polls /version.json to detect when a newer build has been deployed.
 *
 * Why: Vite's hashed filenames cache-bust assets correctly, but a user
 * who keeps the app open across a deploy keeps running the previous
 * bundle until they reload. Without a prompt, they silently miss every
 * new feature (e.g. the Step 4 subject-line picker — staff reported
 * not seeing it because their tab predated the deploy).
 *
 * The hook fires the first poll a minute after mount, then every minute
 * while the tab is visible. Background tabs pause polling so we don't
 * hammer the server. Once an update is detected the hook latches —
 * subsequent polls won't override the flag, and the user has the choice
 * to reload now or finish what they're doing.
 *
 * Dev mode: the version stamp is inlined as the local git SHA, but the
 * dev server has no /version.json — the hook short-circuits.
 */

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 60_000  // 1 minute

export function useAppVersionCheck(): { updateAvailable: boolean; latestVersion: string | null } {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  useEffect(() => {
    // Disabled in dev — no version.json is served and a stamp mismatch
    // would just spam the prompt every reload.
    if (import.meta.env.DEV) return

    const currentVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null
    if (!currentVersion) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = async () => {
      // Once we've found a newer version, stop polling — the toast is
      // showing and we don't want to ping forever.
      if (cancelled) return
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { version?: string }
        if (cancelled || !data?.version) return
        if (data.version !== currentVersion) {
          setLatestVersion(data.version)
          setUpdateAvailable(true)
          return  // latch — no further scheduling
        }
      } catch {
        // Network blip or offline; try again next tick.
      }
      schedule()
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') {
          check()
        } else {
          // Reschedule when the tab comes back to the foreground; don't
          // burn requests on background tabs.
          schedule()
        }
      }, POLL_INTERVAL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !updateAvailable) {
        // First visibility flip schedules the first poll; subsequent
        // ones are no-ops while a timer is already pending.
        schedule()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // updateAvailable intentionally omitted — re-running the effect on
    // latch would tear down the working timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { updateAvailable, latestVersion }
}
