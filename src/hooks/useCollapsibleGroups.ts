import { useCallback, useEffect, useState } from 'react'

/**
 * LocalStorage-backed collapse state for sidebar groups. Keyed per group
 * heading so each group remembers its own open/closed state. Initial read
 * is lazy (via the useState initializer) which runs once on mount — we're
 * Vite client-only so there's no SSR hydration flash to worry about.
 */
const STORAGE_PREFIX = 'sidebar.collapsed.'

function read(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  const out: Record<string, boolean> = {}
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue
    const val = window.localStorage.getItem(key)
    out[key.slice(STORAGE_PREFIX.length)] = val === '1'
  }
  return out
}

function write(heading: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_PREFIX + heading, collapsed ? '1' : '0')
}

export function useCollapsibleGroups(): {
  isCollapsed: (heading: string) => boolean
  toggle: (heading: string) => void
} {
  const [state, setState] = useState<Record<string, boolean>>(() => read())

  // Rehydrate on mount in case localStorage was modified outside React
  // (e.g., in another tab). Cheap; runs once.
  useEffect(() => { setState(read()) }, [])

  const isCollapsed = useCallback((heading: string) => !!state[heading], [state])
  const toggle = useCallback((heading: string) => {
    setState(prev => {
      const next = { ...prev, [heading]: !prev[heading] }
      write(heading, next[heading])
      return next
    })
  }, [])

  return { isCollapsed, toggle }
}
