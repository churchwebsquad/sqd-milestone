// Module-level TTL cache. Warm across invocations on the same instance.
// Cache keys are strings; values are JSON-serializable.

interface Entry<T> {
  data: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    store.delete(key)
    return null
  }
  return hit.data as T
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function cacheInvalidate(keyPrefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(keyPrefix)) store.delete(k)
  }
}

/** Get-or-compute pattern. Returns cached value if fresh, else runs
 *  `fetcher()` and caches the result for `ttlMs`. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key)
  if (hit !== null) return hit
  const data = await fetcher()
  cacheSet(key, data, ttlMs)
  return data
}

export const TTL = {
  initiatives:    60_000,
  milestones:     60_000,
  progress:       20_000,
  initiativeDetail: 30_000,
  userResolve:  3_600_000, // 1h
  docs:        120_000,
} as const
