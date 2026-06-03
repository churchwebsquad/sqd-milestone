// slot-copy-suggest — Supabase Edge Function
//
// Returns 3 AI-written alternatives for a single layout slot,
// constrained to the slot's natural character budget. Powers the
// per-slot "Suggest copy" action in the section editor and the
// section-level "Tighten to fit" bulk pass.
//
// Inputs (POST body):
//   slot:        { layer_name, type, max_chars, scope?, heading_level? }
//   current:     string — the strategist's current copy (may be empty)
//   action:      'generate' | 'tighten' | 'loosen' | 'rewrite'
//   context: {                            // optional, all best-effort
//     section_layer?: string              // e.g. "Hero Section 32"
//     siblings?: Array<{ layer_name, value }>  // surrounding slot copy
//     brand_voice?: string                // 1-3 sentences from brand guide
//     church_name?: string
//   }
//
// Output:
//   { suggestions: string[] }             // 3 alternatives, ≤ max_chars
//
// Anthropic key lives in Supabase secrets, never in the browser.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ACTION_GUIDES: Record<string, string> = {
  generate: 'Write fresh, original copy for this slot. The current value may be a placeholder ("Lorem ipsum...") or empty — replace it with something real and on-brand.',
  tighten:  'The current copy is too long for the layout. Rewrite it tighter while preserving the core meaning. Aim for the budget — even shorter is fine if it reads naturally.',
  loosen:   'The current copy is too sparse for the slot. Add detail, warmth, or specificity to fill the space without padding.',
  rewrite:  'Rewrite the current copy in 3 distinct directions — same core meaning, different angles or tones.',
}

interface SlotSpec {
  layer_name?: string
  type?: string
  max_chars?: number
  scope?: string
  heading_level?: number
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const body = await req.json() as {
      slot?: SlotSpec
      current?: string
      action?: string
      context?: {
        section_layer?: string
        siblings?: Array<{ layer_name?: string; value?: string }>
        brand_voice?: string
        church_name?: string
      }
    }

    const slot = body.slot ?? {}
    const current = (body.current ?? '').toString()
    const action = body.action ?? 'generate'
    const ctx = body.context ?? {}
    const max = typeof slot.max_chars === 'number' ? slot.max_chars : 200

    const guide = ACTION_GUIDES[action] ?? ACTION_GUIDES.generate

    const isHeading = typeof slot.heading_level === 'number' && slot.heading_level <= 3
    const isButton = slot.scope === 'button' || slot.type === 'cta'

    const slotDescriptor = isButton
      ? `a button label (action-oriented verb phrase, 2-5 words)`
      : isHeading
        ? `an H${slot.heading_level ?? 2} section heading (one short line, no trailing punctuation)`
        : slot.type === 'richtext'
          ? `a body paragraph (1-3 sentences, plain prose — no markdown)`
          : `a short label (a phrase, no trailing punctuation)`

    const siblingsBlock = (ctx.siblings ?? [])
      .filter(s => s?.value && s.value.trim())
      .slice(0, 8)
      .map(s => `  • ${s.layer_name ?? 'slot'}: ${(s.value ?? '').slice(0, 240)}`)
      .join('\n')

    const SYSTEM = [
      'You are a copywriter generating church-website copy that fits a specific Brixies layout slot.',
      `The slot is ${slotDescriptor} with a natural budget of ${max} characters.`,
      'HARD RULE: every suggestion must be ≤ ' + max + ' characters. Count carefully. Suggestions over budget will be rejected.',
      'Write in plain prose. No markdown, no quotes around the output, no leading bullets.',
      ctx.brand_voice ? `Brand voice: ${ctx.brand_voice}` : '',
      ctx.church_name ? `Church name: ${ctx.church_name} (use it sparingly — once per suggestion at most).` : '',
      'Return ONLY a JSON object with this exact shape: {"suggestions":["a","b","c"]}. No prose before or after.',
    ].filter(Boolean).join('\n\n')

    const USER = [
      `Action: ${action}`,
      `Guidance: ${guide}`,
      ctx.section_layer ? `Section: ${ctx.section_layer}` : '',
      slot.layer_name ? `Slot layer: ${slot.layer_name}` : '',
      `Character budget: ${max}`,
      `Current copy: ${current ? JSON.stringify(current) : '(empty)'}`,
      siblingsBlock ? `\nSurrounding slots already filled in:\n${siblingsBlock}` : '',
      '\nReturn 3 distinct suggestions as JSON.',
    ].filter(Boolean).join('\n')

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: 'user', content: USER }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error(`Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 200)}`)
    }

    const data = await anthropicRes.json()
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('')

    const parsed = tryParseJson(text)
    let suggestions: string[] = []
    if (parsed && Array.isArray((parsed as { suggestions?: unknown }).suggestions)) {
      suggestions = ((parsed as { suggestions: unknown[] }).suggestions)
        .filter((s): s is string => typeof s === 'string')
        .map(s => s.trim())
        .filter(Boolean)
    }

    // Defensive filter — Anthropic occasionally exceeds the budget.
    // Drop the obvious offenders rather than returning them.
    suggestions = suggestions.filter(s => s.length <= max * 1.1)

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err), suggestions: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  try { return JSON.parse(trimmed) } catch { /* fall through */ }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { return null }
}
