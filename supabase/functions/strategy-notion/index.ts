// strategy-notion — Supabase Edge Function
//
// One function, N ops, matching the pattern established by
// `send-clickup-message` and `brand-voice-prefill`. Hand-rolls fetch calls
// to Notion's REST API (no @notionhq/client — Deno + npm SDKs are a
// compatibility tax we don't need for 4 endpoints).
//
// All ops POST with `{ op: string, ...args }`. Errors return a JSON body
// with `{ error, message }`; setup-required errors additionally carry
// `{ missing: string[] }` so the UI can banner a "set up Notion" message.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { NotionSetupError } from './_lib/notion.ts'
import { listInitiatives } from './_lib/ops/list-initiatives.ts'
import { listMilestones } from './_lib/ops/list-milestones.ts'
import { listProgress } from './_lib/ops/list-progress.ts'
import { getInitiative } from './_lib/ops/get-initiative.ts'
import { commandCenterBundle, myDashboardBundle } from './_lib/ops/bundles.ts'
import { resolveNotionUserId } from './_lib/ops/resolve-user.ts'
import { listDocs } from './_lib/ops/list-docs.ts'
import { updateInitiative } from './_lib/ops/update-initiative.ts'
import { updateMilestone } from './_lib/ops/update-milestone.ts'
import { updateProgress } from './_lib/ops/update-progress.ts'
import { updateDoc } from './_lib/ops/update-doc.ts'
import { createInitiative } from './_lib/ops/create-initiative.ts'
import { createMilestone } from './_lib/ops/create-milestone.ts'
import { createProgress } from './_lib/ops/create-progress.ts'
import { markCheckIn } from './_lib/ops/mark-check-in.ts'
import { archivePage } from './_lib/ops/archive-page.ts'
import { listNotionUsers } from './_lib/ops/list-notion-users.ts'
import { createDoc } from './_lib/ops/create-doc.ts'
import { verifyDoc } from './_lib/ops/verify-doc.ts'
import { requestDocChanges } from './_lib/ops/request-doc-changes.ts'
import { getDocContent } from './_lib/ops/get-doc-content.ts'
import { updateDocBlock } from './_lib/ops/update-doc-block.ts'
import type { EditableBlockType } from './_lib/ops/update-doc-block.ts'
import { appendDocBlock } from './_lib/ops/append-doc-block.ts'
import { archiveDocBlock } from './_lib/ops/archive-doc-block.ts'
import { flagDocOutdated } from './_lib/ops/flag-doc-outdated.ts'
import { syncWorkflowStepOptions } from './_lib/ops/sync-workflow-step-options.ts'
import { listDocComments, listDocCommentsBulk } from './_lib/ops/list-doc-comments.ts'
import { markActionItemComplete } from './_lib/ops/mark-action-item-complete.ts'
import { suggestActionItem } from './_lib/ops/suggest-action-item.ts'
import { promoteActionItem } from './_lib/ops/promote-action-item.ts'
import { getActionItemContent } from './_lib/ops/get-action-item.ts'
import type {
  InitiativeWritable, InitiativeCreate, MilestoneWritable, MilestoneCreate,
  ProgressWritable, ProgressCreate, DocWritable, DocCreate, StrategyEntity,
} from './_lib/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Resolve the caller's email from the bearer JWT. Returns null when
 *  unauthenticated — not fatal for most ops, but `my-dashboard-bundle`
 *  falls back to "no initiatives owned" in that case. */
async function resolveCallerEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!url || !anon) return null
    const sb = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data } = await sb.auth.getUser()
    return data.user?.email ?? null
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { op, ...args } = await req.json() as { op?: string; [k: string]: unknown }
    if (!op) return json400('Missing "op" in request body.')

    switch (op) {
      case 'list-initiatives':
        return json({ initiatives: await listInitiatives() })

      case 'list-milestones':
        return json({ milestones: await listMilestones() })

      case 'list-progress':
        return json({ entries: await listProgress(args as { limit?: number; sinceISO?: string; initiativeId?: string }) })

      case 'get-initiative': {
        const id = (args as { id?: string }).id
        if (!id) return json400('Missing "id" for get-initiative.')
        const bundle = await getInitiative(id)
        if (!bundle) return json({ error: 'not-found', message: `Initiative ${id} not found.` }, 404)
        return json(bundle)
      }

      case 'command-center-bundle':
        return json(await commandCenterBundle())

      case 'my-dashboard-bundle': {
        const email = await resolveCallerEmail(req)
        return json(await myDashboardBundle(email))
      }

      case 'resolve-notion-user': {
        const email = (args as { email?: string }).email ?? await resolveCallerEmail(req)
        return json({ notionUserId: await resolveNotionUserId(email) })
      }

      // Temporary diagnostic — surfaces what Notion's /users endpoint
      // is actually returning so the "couldn't match your email"
      // failures are debuggable. Returns the caller's email, the
      // total count + with-email count, and a sanitized sample
      // (names + email domain only) so we don't leak addresses.
      case 'diagnose-user-resolution': {
        const callerEmail = await resolveCallerEmail(req)
        const { listUsersAll } = await import('./_lib/notion.ts')
        const users = await listUsersAll()
        const withEmail = users.filter(u => u.person?.email)
        const lc = (callerEmail ?? '').toLowerCase().trim()
        const found = withEmail.some(u =>
          (u.person?.email ?? '').toLowerCase().trim() === lc,
        )
        const sample = users.slice(0, 30).map(u => ({
          name: u.name,
          type: u.type ?? null,
          hasEmail: !!u.person?.email,
          // Last 4 chars + domain only — enough to spot Ashley without
          // leaking the full list to the browser console.
          emailHint: u.person?.email
            ? `…${u.person.email.slice(-Math.min(u.person.email.length, 18))}`
            : null,
        }))
        return json({
          callerEmail,
          callerEmailFoundInIndex: found,
          totalUsers: users.length,
          usersWithEmail: withEmail.length,
          sample,
        })
      }

      case 'list-docs':
        return json({ docs: await listDocs() })

      case 'list-notion-users':
        return json({ users: await listNotionUsers() })

      // ── Phase 2 writes ────────────────────────────────────────────────

      case 'update-initiative': {
        const { id, updates } = args as { id?: string; updates?: InitiativeWritable }
        if (!id || !updates) return json400('Missing "id" or "updates" for update-initiative.')
        return json(await updateInitiative(id, updates))
      }

      case 'update-milestone': {
        const { id, updates } = args as { id?: string; updates?: MilestoneWritable }
        if (!id || !updates) return json400('Missing "id" or "updates" for update-milestone.')
        return json(await updateMilestone(id, updates))
      }

      case 'update-progress': {
        const { id, updates } = args as { id?: string; updates?: ProgressWritable }
        if (!id || !updates) return json400('Missing "id" or "updates" for update-progress.')
        return json(await updateProgress(id, updates))
      }

      case 'update-doc': {
        const { id, updates } = args as { id?: string; updates?: DocWritable }
        if (!id || !updates) return json400('Missing "id" or "updates" for update-doc.')
        return json(await updateDoc(id, updates))
      }

      case 'create-initiative': {
        const { updates } = args as { updates?: InitiativeCreate }
        if (!updates?.name) return json400('Missing "updates.name" for create-initiative.')
        return json(await createInitiative(updates))
      }

      case 'create-milestone': {
        const { updates } = args as { updates?: MilestoneCreate }
        if (!updates?.name || !updates?.initiativeIds || updates.initiativeIds.length === 0) {
          return json400('Missing "updates.name" or empty "updates.initiativeIds" for create-milestone.')
        }
        return json(await createMilestone(updates))
      }

      case 'create-progress': {
        const { updates } = args as { updates?: ProgressCreate }
        if (!updates?.title || !updates?.initiativeId) {
          return json400('Missing "updates.title" or "updates.initiativeId" for create-progress.')
        }
        const email = await resolveCallerEmail(req)
        return json(await createProgress(updates, email))
      }

      case 'mark-check-in': {
        const { initiativeId, note } = args as { initiativeId?: string; note?: string | null }
        if (!initiativeId) return json400('Missing "initiativeId" for mark-check-in.')
        const email = await resolveCallerEmail(req)
        return json(await markCheckIn(initiativeId, note ?? null, email))
      }

      case 'archive-page': {
        const { id, entity } = args as { id?: string; entity?: StrategyEntity }
        if (!id || !entity) return json400('Missing "id" or "entity" for archive-page.')
        return json(await archivePage(id, entity))
      }

      // ── Library writes (Phase 2c–2e) ─────────────────────────────────

      case 'create-doc': {
        const { updates } = args as { updates?: DocCreate }
        if (!updates?.title || !updates?.department || !updates?.groups?.length) {
          return json400('Missing "updates.title", "updates.department", or "updates.groups" for create-doc.')
        }
        return json(await createDoc(updates))
      }

      case 'verify-doc': {
        const { id } = args as { id?: string }
        if (!id) return json400('Missing "id" for verify-doc.')
        const email = await resolveCallerEmail(req)
        return json(await verifyDoc(id, email))
      }

      case 'request-doc-changes': {
        const { id, reviewerName, comments } = args as { id?: string; reviewerName?: string; comments?: string }
        if (!id || !reviewerName || !comments) {
          return json400('Missing "id", "reviewerName", or "comments" for request-doc-changes.')
        }
        return json(await requestDocChanges(id, reviewerName, comments))
      }

      case 'get-doc-content': {
        const { id } = args as { id?: string }
        if (!id) return json400('Missing "id" for get-doc-content.')
        const content = await getDocContent(id)
        if (!content) return json({ error: 'not-found', message: `Doc ${id} not found.` }, 404)
        return json(content)
      }

      case 'update-doc-block': {
        const { docId, blockId, type, text, meta, isDirector } =
          args as { docId?: string; blockId?: string; type?: EditableBlockType; text?: string; meta?: { checked?: boolean }; isDirector?: boolean }
        if (!docId || !blockId || !type || typeof text !== 'string') {
          return json400('Missing "docId", "blockId", "type", or "text" for update-doc-block.')
        }
        return json(await updateDocBlock(docId, blockId, type, text, meta, isDirector === true))
      }

      case 'append-doc-block': {
        const { docId, type, text } =
          args as { docId?: string; type?: EditableBlockType; text?: string }
        if (!docId || !type || typeof text !== 'string') {
          return json400('Missing "docId", "type", or "text" for append-doc-block.')
        }
        return json(await appendDocBlock(docId, type, text))
      }

      case 'archive-doc-block': {
        const { docId, blockId } = args as { docId?: string; blockId?: string }
        if (!docId || !blockId) return json400('Missing "docId" or "blockId" for archive-doc-block.')
        return json(await archiveDocBlock(docId, blockId))
      }

      case 'flag-doc-outdated': {
        const { id, flaggerName, reason } =
          args as { id?: string; flaggerName?: string; reason?: string }
        if (!id || !flaggerName || !reason) {
          return json400('Missing "id", "flaggerName", or "reason" for flag-doc-outdated.')
        }
        return json(await flagDocOutdated(id, flaggerName, reason))
      }

      case 'sync-workflow-step-options':
        return json(await syncWorkflowStepOptions())

      case 'list-doc-comments': {
        const { id } = args as { id?: string }
        if (!id) return json400('Missing "id" for list-doc-comments.')
        return json({ comments: await listDocComments(id) })
      }

      case 'list-doc-comments-bulk': {
        const { ids } = args as { ids?: string[] }
        if (!Array.isArray(ids)) return json400('Missing "ids" array for list-doc-comments-bulk.')
        return json({ commentsByDoc: await listDocCommentsBulk(ids) })
      }

      // ── Action Items (Phase 2.5) ──────────────────────────────────────

      case 'mark-action-item-complete': {
        const { id } = args as { id?: string }
        if (!id) return json400('Missing "id" for mark-action-item-complete.')
        return json(await markActionItemComplete(id))
      }

      case 'suggest-action-item': {
        const { suggestedById, title, targetDate, notes } =
          args as { suggestedById?: string; title?: string; targetDate?: string | null; notes?: string | null }
        if (!suggestedById || !title) {
          return json400('Missing "suggestedById" or "title" for suggest-action-item.')
        }
        return json(await suggestActionItem(suggestedById, {
          title,
          targetDate: targetDate ?? null,
          notes: notes ?? null,
        }))
      }

      case 'promote-action-item': {
        const { id, nextOrder } = args as { id?: string; nextOrder?: number }
        if (!id || typeof nextOrder !== 'number') {
          return json400('Missing "id" or "nextOrder" for promote-action-item.')
        }
        return json(await promoteActionItem(id, nextOrder))
      }

      case 'get-action-item': {
        const { id } = args as { id?: string }
        if (!id) return json400('Missing "id" for get-action-item.')
        const content = await getActionItemContent(id)
        if (!content) return json({ error: 'not-found', message: `Action Item ${id} not found.` }, 404)
        return json(content)
      }

      default:
        return json400(`Unknown op "${op}".`)
    }
  } catch (err) {
    if (err instanceof NotionSetupError) {
      return json({
        error: 'setup-required',
        missing: err.missing,
        message: err.message,
        detail: err.detail,
      }, 503)
    }
    console.error('[strategy-notion] error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: 'internal', message: message.slice(0, 500) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function json400(message: string): Response {
  return json({ error: 'bad-request', message }, 400)
}
