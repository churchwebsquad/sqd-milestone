/**
 * Polls /version.json to detect when a newer build has been deployed.
 *
 * Why: Vite's hashed filenames cache-bust assets correctly, but a user
 * who keeps the app open across a deploy keeps running the previous
 * bundle until they reload. Without a prompt, they silently miss every
 * new feature (e.g. the Step 4 subject-line picker — staff reported
 * not seeing it because their tab predated the deploy). Worse, if they
 * navigate to a route whose lazy chunk was deleted by the deploy, the
 * dynamic import 404s — staff have reported losing in-progress work
 * when this happens silently.
 *
 * The hook fires its first poll IMMEDIATELY on mount (so the warning
 * appears within seconds of a deploy, not a minute later), then every
 * minute while the tab is visible. Background tabs pause polling so
 * we don't hammer the server. Once an update is detected the flag
 * latches and a module-scoped function lets unrelated code (the
 * vite:preloadError handler in main.tsx, for example) trip the same
 * flag the moment a chunk fails to load.
 *
 * Dev mode: the version stamp is inlined as the local git SHA, but the
 * dev server has no /version.json — the hook short-circuits.
 */

import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 60_000  // 1 minute

/** Module-level listener list. Components calling useAppVersionCheck
 *  subscribe here; markUpdateAvailable() pokes every subscriber so any
 *  signal (poll mismatch, chunk-load failure, manual trigger) lights
 *  up the toast immediately. */
const listeners = new Set<(latest: string | null) => void>()
let latched = false
let cachedLatest: string | null = null

/** Programmatically mark an update as available — called by the
 *  vite:preloadError handler in main.tsx when a hashed chunk 404s
 *  (the classic post-deploy failure mode). Idempotent. */
export function markUpdateAvailable(reason: string = 'chunk-load failure'): void {
  if (latched) return
  latched = true
  cachedLatest = cachedLatest ?? `manual:${reason}`
  for (const fn of listeners) fn(cachedLatest)
}

export function useAppVersionCheck(): { updateAvailable: boolean; latestVersion: string | null } {
  const [updateAvailable, setUpdateAvailable] = useState(latched)
  const [latestVersion, setLatestVersion] = useState<string | null>(cachedLatest)

  useEffect(() => {
    // Subscribe to module-level updates so any caller of
    // markUpdateAvailable() trips this consumer too.
    const listener = (latest: string | null) => {
      setLatestVersion(latest)
      setUpdateAvailable(true)
    }
    listeners.add(listener)

    // Disabled in dev — no version.json is served and a stamp mismatch
    // would just spam the prompt every reload.
    if (import.meta.env.DEV) {
      return () => { listeners.delete(listener) }
    }

    const currentVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null
    if (!currentVersion) {
      return () => { listeners.delete(listener) }
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = async () => {
      // Once we've found a newer version, stop polling — the toast is
      // showing and we don't want to ping forever.
      if (cancelled || latched) return
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { version?: string }
        if (cancelled || !data?.version) return
        if (data.version !== currentVersion) {
          cachedLatest = data.version
          latched = true
          for (const fn of listeners) fn(data.version)
          return
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
      if (document.visibilityState === 'visible' && !latched) {
        // First visibility flip schedules the next poll; in-flight
        // timers are no-ops.
        schedule()
      }
    }

    // Fire the FIRST poll immediately so users see the prompt within
    // seconds of a deploy, not a full minute later. The recurring
    // schedule kicks in inside check() once the response lands.
    void check()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      listeners.delete(listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { updateAvailable, latestVersion }
}
