/**
 * Vercel Serverless Function — /api/srp/generate-carousel
 *
 * Generates a 5-slide Instagram carousel + a short caption. The
 * structure is mission-critical and was the second-loudest complaint
 * on the Loom: hook → Bible verse → pastor quote → application → CTA.
 * Returned as structured JSON so the UI can render each slide.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { callAnthropic, resolvePromptOverride } from './_lib/anthropic.js'

export const maxDuration = 60

const SLIDES_DEFAULT = `You are a social media content strategist for churches. Create Instagram carousel slide concepts from sermon content.

STRUCTURE — mission-critical. Every carousel MUST follow this 5-slide layout:

Slide 1 — HOOK: a single bold statement (8 words or fewer). This is a punchy declarative that stops the scroll. Title case.
Slide 2 — BIBLE VERSE: the relevant scripture verbatim with translation name appended (e.g. "Romans 8:28 ESV"). No commentary on this slide.
Slide 3 — PASTOR QUOTE: a direct quote from the sermon, word-for-word from the transcript. In quotation marks. Attribute as "— [Pastor Name]" if known.
Slide 4 — APPLICATION: 1-3 short sentences applying the verse + quote to everyday life. Conversational, not preachy.
Slide 5 — CALL TO ACTION: a single sentence inviting reflection, conversation, or attendance at Sunday service.

Return exactly 5 slides. Do not add or remove slides. Avoid em dashes — use periods or commas.

Output JSON: { "slides": [{ "slide_number": 1, "kind": "hook", "text": "..." }, ...] }
Return ONLY valid JSON.`

const CAPTION_DEFAULT = `You are a social media copywriter for churches. Write concise, Instagram-friendly carousel captions.

STYLE RULES:
- Keep captions short and punchy. 2-3 sentences max before hashtags.
- Avoid em dashes. Use periods, commas, or line breaks instead.
- Be relatable and warm, not preachy.
- Vary your approach: question, call to action, practical takeaway, or short list.

Return ONLY the caption text.`

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: 'Missing Supabase env vars' })

  const sessionId  = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null
  const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : ''
  const pastorName = typeof req.body?.pastorName === 'string' ? req.body.pastorName : ''
  const churchName = typeof req.body?.churchName === 'string' ? req.body.churchName : ''
  const sermonTitle = typeof req.body?.sermonTitle === 'string' ? req.body.sermonTitle : ''
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const slidesOverride  = await resolvePromptOverride(sb, 'carousel_slides')
  const captionOverride = await resolvePromptOverride(sb, 'carousel_caption')
  const slidesPrompt  = slidesOverride ?? SLIDES_DEFAULT
  const captionPrompt = captionOverride ?? CAPTION_DEFAULT

  const sharedContext = [
    churchName ? `Church: ${churchName}` : '',
    sermonTitle ? `Sermon title: ${sermonTitle}` : '',
    pastorName ? `Pastor: ${pastorName}` : '',
    transcript ? `Sermon transcript:\n${transcript.slice(0, 18000)}` : '',
  ].filter(Boolean).join('\n\n')

  let slidesResult
  try {
    slidesResult = await callAnthropic({
      systemPrompt: slidesPrompt,
      userPrompt: sharedContext + '\n\nGenerate the 5 slides as structured JSON.',
      prefill: '{',
      maxTokens: 1500,
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Carousel slides call failed' })
  }

  let slidesParsed: { slides?: Array<{ slide_number: number; kind: string; text: string }> } | null = null
  try { slidesParsed = JSON.parse(slidesResult.text) }
  catch { return res.status(502).json({ error: 'Slides model returned non-JSON output' }) }

  const slides = Array.isArray(slidesParsed?.slides) ? slidesParsed.slides : []
  if (slides.length !== 5) {
    return res.status(502).json({ error: `Expected 5 slides, got ${slides.length}` })
  }

  let captionResult
  try {
    captionResult = await callAnthropic({
      systemPrompt: captionPrompt,
      userPrompt: sharedContext + '\n\nThese are the 5 slides we generated:\n' + slides.map(s => `${s.slide_number}. [${s.kind}] ${s.text}`).join('\n') + '\n\nWrite a short carousel caption (2-3 sentences) that complements the slides.',
      maxTokens: 600,
    })
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Caption call failed' })
  }

  const caption = captionResult.text.trim()
  const slidesJson = JSON.stringify(slides)

  const { error: writeErr } = await sb
    .from('sms_srp_generation')
    .update({
      carousel_slides:  slidesJson,
      carousel_caption: caption,
      updated_at:       new Date().toISOString(),
    })
    .eq('session_id', sessionId)
  if (writeErr) return res.status(500).json({ error: `DB write failed: ${writeErr.message}` })

  return res.status(200).json({
    ok: true,
    slides,
    caption,
    usage: {
      input_tokens:  slidesResult.inputTokens + captionResult.inputTokens,
      output_tokens: slidesResult.outputTokens + captionResult.outputTokens,
    },
  })
}
