import { cached, TTL } from '../cache.ts'
import { listUsersAll } from '../notion.ts'
import type { NotionUserOption } from '../types.ts'

/** Cached, lightweight Notion-workspace user list for the EditablePerson
 *  picker. Filters out bots; trims to id/name/email/avatar. Cached on the
 *  same 1h TTL as the email index so the two share a refresh cycle. */
export async function listNotionUsers(): Promise<NotionUserOption[]> {
  return cached('users:options', TTL.userResolve, async () => {
    const users = await listUsersAll()
    return users
      .filter(u => u.type !== 'bot')
      .map<NotionUserOption>(u => ({
        id:       u.id,
        name:     u.name,
        email:    u.person?.email ?? null,
        avatarUrl: u.avatar_url,
      }))
  })
}
