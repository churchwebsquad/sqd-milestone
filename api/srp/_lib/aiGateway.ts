/**
 * Vercel AI Gateway helper for SRP endpoints.
 *
 * Single concern: make a Chat Completions request through Vercel's AI
 * Gateway with a FORCED single tool call, and return the parsed tool
 * arguments. This is the reliability discipline that eliminates the
 * "Model returned non-JSON output" failure mode of the previous
 * prose-prefill-JSON.parse approach — the model literally cannot
 * return non-conforming JSON when tool_choice forces a strict schema.
 *
 * Wire shape: OpenAI-compatible Chat Completions. Provider routes to
 * Google for the gemini-* model strings.
 *
 * Configured via:
 *   - AI_GATEWAY_API_KEY  (Vercel project secret)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'

/**
 * Model registry. Centralized so a model bump is one line.
 *
 * MODEL_CONTENT is the most advanced text-gen Gemini available on the
 * Gateway as of 2026-06-11. It carries a "preview" suffix — when Google
 * promotes it to `gemini-3-pro` we bump.
 *
 * MODEL_TRANSCRIPTION is the same family Sermon Studio App uses for
 * transcription; cheaper and multimodal-capable.
 */
export const MODEL_CONTENT       = 'google/gemini-3-pro-preview'
export const MODEL_TRANSCRIPTION = 'google/gemini-2.5-flash'

/**
 * A JSON Schema describing the shape of the tool's input. Every object
 * MUST set `additionalProperties: false` and list explicit `required`
 * fields — this is what makes the gateway refuse to return malformed
 * arguments.
 */
export type ToolSchema = {
  type: 'object'
  properties: Record<string, any>
  required: string[]
  additionalProperties: false
}

export interface GatewayCallInput<T = Record<string, any>> {
  /** Model ID. Defaults to MODEL_CONTENT. */
  model?: string
  /** System prompt — sets persona + rules. */
  system: string
  /** User prompt — the task-specific instruction. */
  user: string
  /** Name of the (single) tool the model will be forced to call. */
  toolName: string
  /** Brief description of the tool. The model uses this to know what to call. */
  toolDescription: string
  /** Strict JSON Schema. additionalProperties MUST be false; required MUST list every load-bearing field. */
  toolSchema: ToolSchema
  /** Hard ceiling on output tokens. Default 1500. */
  maxTokens?: number
  /**
   * Phantom generic — TS keeps T flowing into the return type. Pass an
   * object literal (or omit) so TS doesn't widen to {}.
   */
  _t?: T
}

export interface GatewayCallResult<T = Record<string, any>> {
  /** The parsed tool arguments, conforming to your schema. */
  args: T
  /** Token usage reported by the gateway (provider-normalized). */
  usage: {
    inputTokens: number
    outputTokens: number
  }
  /** Echo of the model that actually served the request. */
  model: string
}

/** Thrown when the gateway responds 429 (rate limit). Caller may surface to UI as a soft error. */
export class GatewayRateLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'GatewayRateLimitError' }
}

/** Thrown when the gateway responds 5xx (transient). Caller may retry. */
export class GatewayTransientError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message); this.name = 'GatewayTransientError'; this.status = status
  }
}

/** Thrown when the gateway response is malformed (missing tool_call, invalid JSON args, etc.). Bug, not retriable. */
export class GatewayContractError extends Error {
  constructor(message: string) { super(message); this.name = 'GatewayContractError' }
}

/** Extract a JSON object from a text response (handles ```json ... ``` blocks and bare JSON). */
function extractJsonFromText(text: string): Record<string, any> | null {
  // Strip markdown code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : text.trim()
  // Find the outermost { ... }
  const start = candidate.indexOf('{')
  const end   = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Call the Vercel AI Gateway and return the parsed tool arguments.
 *
 * Reliability discipline:
 *   1. tools: [{ type: "function", function: { ... } }]            ← single tool
 *   2. tool_choice: { type: "function", function: { name } }       ← FORCED
 *   3. toolSchema.additionalProperties = false + explicit required ← strict
 *   4. JSON.parse only on response.choices[0].message.tool_calls[0].function.arguments
 *      (which is itself a JSON string — never on free-form text)
 *
 * If the gateway returns prose instead of a tool_call (shouldn't happen
 * with tool_choice forced, but defense-in-depth), we throw
 * GatewayContractError so the caller surfaces a 502, not silently
 * succeeds with garbage.
 */
export async function callGateway<T extends Record<string, any> = Record<string, any>>(
  input: GatewayCallInput<T>,
): Promise<GatewayCallResult<T>> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new GatewayContractError('AI_GATEWAY_API_KEY is not set')

  const model = input.model ?? MODEL_CONTENT
  const maxTokens = input.maxTokens ?? 1500

  // Forced tool_choice — the gateway translates this to the underlying
  // provider's strict-tool mode where supported. Worked on every model
  // we ship against today (Opus 4.6/4.7/4.8, Sonnet 4.5/4.6, Haiku 4.5).
  //
  // Historical note (2026-06-12 → 2026-06-12): claude-fable-5 briefly
  // required tool_choice='auto' + a prompt-level "you MUST call the
  // tool" workaround because its gateway entry rejected forced
  // tool_choice. Fable 5 was subsequently removed from Vercel AI
  // Gateway's catalog (12 Anthropic entries listed; zero "fable"
  // matches). With Fable gone from this path, the workaround branch
  // was dead scaffolding — the kind of prompt-embedded drift the
  // vocab checker can't see. Removed in the same commit that swapped
  // draft-page to claude-opus-4-8.
  const tool_choice = { type: 'function' as const, function: { name: input.toolName } }

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user',   content: input.user   },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: input.toolName,
          description: input.toolDescription,
          parameters: input.toolSchema,
        },
      },
    ],
    tool_choice,
  }

  let r: Response
  try {
    r = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new GatewayTransientError(0, `Gateway network error: ${e instanceof Error ? e.message : 'unknown'}`)
  }

  if (r.status === 429) {
    const txt = await r.text().catch(() => '')
    throw new GatewayRateLimitError(`Gateway rate-limited: ${txt.slice(0, 300)}`)
  }
  if (r.status >= 500) {
    const txt = await r.text().catch(() => '')
    throw new GatewayTransientError(r.status, `Gateway ${r.status}: ${txt.slice(0, 300)}`)
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new GatewayContractError(`Gateway ${r.status}: ${txt.slice(0, 500)}`)
  }

  let data: any
  try {
    data = await r.json()
  } catch {
    throw new GatewayContractError('Gateway returned non-JSON body')
  }

  const message = data?.choices?.[0]?.message
  const toolCall = message?.tool_calls?.[0]
  if (!toolCall || toolCall.type !== 'function' || toolCall.function?.name !== input.toolName) {
    // Gemini sometimes ignores forced tool_choice and returns JSON in a text
    // code block. Extract it as a fallback before giving up.
    const text = typeof message?.content === 'string' ? message.content : ''
    if (text) {
      const extracted = extractJsonFromText(text)
      if (extracted !== null) {
        const usage = data?.usage ?? {}
        return {
          args:  extracted as T,
          usage: { inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0, outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0 },
          model: data?.model ?? input.model ?? MODEL_CONTENT,
        }
      }
    }
    throw new GatewayContractError(
      `Expected forced tool call "${input.toolName}", got: ` +
      (toolCall ? `${toolCall.function?.name ?? toolCall.type}` : `text="${text.slice(0, 300)}"`),
    )
  }

  const argsRaw = toolCall.function?.arguments
  if (typeof argsRaw !== 'string') {
    throw new GatewayContractError('Tool call arguments missing or non-string')
  }

  let args: T
  try {
    args = JSON.parse(argsRaw) as T
  } catch (e) {
    throw new GatewayContractError(
      `Tool call arguments are not valid JSON: ${e instanceof Error ? e.message : 'parse failed'}`,
    )
  }

  const usage = data?.usage ?? {}
  return {
    args,
    usage: {
      inputTokens:  Number(usage.prompt_tokens     ?? usage.input_tokens  ?? 0),
      outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    },
    model: typeof data?.model === 'string' ? data.model : model,
  }
}

/**
 * Resolve a prompt override from `srp_pipeline.prompt_settings`.
 * Returns the override text or null if no row / empty text.
 *
 * Callers typically write:
 *   const override = await resolvePrompt(sb, 'reel_caption')
 *   const systemPrompt = override ?? DEFAULT_REEL_CAPTION_PROMPT
 *
 * The override pattern lets admins tune prompts via the UI without
 * redeploying. Defaults live as constants in each generate-* endpoint
 * so the system still works if the DB has no overrides.
 */
export async function resolvePrompt(
  sb: any,
  promptKey: string,
): Promise<string | null> {
  const { data } = await sb
    .schema('srp_pipeline')
    .from('prompt_settings')
    .select('prompt_text')
    .eq('prompt_key', promptKey)
    .maybeSingle()
  const text = (data?.prompt_text as string | undefined)?.trim()
  return text && text.length > 0 ? text : null
}

/**
 * Standard tag that every generator appends to its system prompt.
 *
 * Asking the model to return the EXACT source phrases it pulled from
 * (e.g. "Guidelines: warm, real", "Speaks as: friend & teacher", "Bible: ESV")
 * gives the coach transparent provenance: badges below each option
 * showing exactly which brand-voice instruction shaped the output.
 *
 * Lifted verbatim from sermon-studio-app — proven across reel captions,
 * carousels, FB posts, Sunday invites, photo recaps.
 */
export const BRAND_VOICE_TAGS_BLOCK = `
TRANSPARENT BRAND VOICE TAGS
For each piece of content you generate, also return 2-5 short tags that quote the EXACT source phrase that shaped your choices. Format each tag as a labeled snippet, e.g.:
  - "Guidelines: warm, real, and a little bit funny"
  - "Speaks as: friend & teacher, conversation style"
  - "Bible: ESV"
  - "Notes: avoid 'lost' to describe people outside the church"

Only include tags you actually drew from. Do NOT invent constraints the inputs didn't state.
`.trim()
