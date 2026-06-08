/**
 * Shared Anthropic helper for the SRP generator endpoints. Mirrors the
 * call shape used by api/church-intel/generate.ts (plain fetch, no SDK).
 *
 * Reads ANTHROPIC_API_KEY from Vercel env. Returns the assistant's
 * first text block. Throws on non-200 with the raw error body.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

export interface AnthropicCallInput {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxTokens?: number
  /** When set, the API is told to start the assistant's reply with this
   *  string. Use to coerce JSON-mode without tool_use. */
  prefill?: string
}

export interface AnthropicCallResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export async function callAnthropic(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: input.userPrompt },
  ]
  if (input.prefill) messages.push({ role: 'assistant', content: input.prefill })

  const r = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:       input.model ?? DEFAULT_MODEL,
      max_tokens:  input.maxTokens ?? 2048,
      system:      input.systemPrompt,
      messages,
    }),
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`Anthropic ${r.status}: ${body.slice(0, 500)}`)
  }
  const data = await r.json() as any
  const block = data?.content?.[0]
  const text = String(block?.text ?? '')
  const usage = data?.usage ?? {}
  // When a prefill is sent, Claude continues from the prefill text;
  // re-prepend it so callers parse a complete JSON object.
  const fullText = input.prefill ? input.prefill + text : text
  return {
    text: fullText,
    inputTokens:  Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
  }
}

/** Resolve a single named prompt from sms_prompt_settings (override)
 *  with no fallback. Server-side equivalent of src/lib/srpPrompts.ts. */
export async function resolvePromptOverride(
  sb: any,
  promptKey: string,
): Promise<string | null> {
  const { data } = await sb
    .from('sms_prompt_settings')
    .select('prompt_text')
    .eq('prompt_key', promptKey)
    .maybeSingle()
  const text = (data?.prompt_text as string | undefined)?.trim()
  return text && text.length > 0 ? text : null
}
