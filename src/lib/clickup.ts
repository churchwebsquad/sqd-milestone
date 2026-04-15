import { supabase } from './supabase'
import type { ClickUpCommentSegment } from './clickupComment'

export type { ClickUpCommentSegment }

export interface ClickUpSendResult {
  id: string
  threadUrl: string | null
}

/**
 * Send a ClickUp chat message via a Supabase Edge Function.
 *
 * Accepts a structured `comment` segment array (ClickUp rich-text format)
 * so that user @tags fire real notifications rather than appearing as flat text.
 *
 * The Edge Function proxies the request server-side, which avoids the CORS
 * block that occurs when the browser calls api.clickup.com directly. The
 * CLICKUP_STRATEGY_MILESTONE_TOKEN secret lives in Supabase and is never sent to the browser.
 *
 * Deploy: supabase/functions/send-clickup-message/index.ts
 */
export async function sendClickUpMessage(
  channelId: string,
  comment: ClickUpCommentSegment[],
): Promise<ClickUpSendResult> {
  const { data, error } = await supabase.functions.invoke('send-clickup-message', {
    body: { channelId, comment },
  })

  if (error) {
    // supabase.functions.invoke wraps non-2xx responses in a FunctionsHttpError
    // with the actual response body in error.context. Try to extract it.
    let message = error.message
    try {
      const body = await (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.()
      if (body?.error) message = body.error
    } catch {
      // context not parseable — fall back to generic message
    }
    throw new Error(message)
  }

  if (data?.error) {
    throw new Error(data.error as string)
  }

  return {
    id: (data?.id as string) ?? '',
    threadUrl: (data?.threadUrl as string | null) ?? null,
  }
}
