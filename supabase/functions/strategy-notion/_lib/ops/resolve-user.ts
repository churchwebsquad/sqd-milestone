import { cached, TTL } from '../cache.ts'
import { listUsersAll } from '../notion.ts'

/**
 * Build a `lowercase(email) → notionUserId` map for all workspace users.
 * Cached for an hour — resolving "my initiatives" should be constant-time
 * after the first hit of the day.
 */
async function buildEmailIndex(): Promise<Map<string, string>> {
  return cached('users:email-index', TTL.userResolve, async () => {
    const users = await listUsersAll()
    const idx = new Map<string, string>()
    for (const u of users) {
      const email = u.person?.email?.toLowerCase().trim()
      if (email) idx.set(email, u.id)
    }
    return idx
  })
}

export async function resolveNotionUserId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const idx = await buildEmailIndex()
  return idx.get(email.toLowerCase().trim()) ?? null
}
