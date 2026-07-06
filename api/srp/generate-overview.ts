/**
 * Vercel Serverless Function — /api/srp/generate-overview
 *
 * Generates a structured service overview from a sermon transcript.
 * Returns summary, main points, key insights, Bible verses, worship songs,
 * and announcements.
 *
 *   POST { transcript, churchName?, speakerName?, sermonTitle?, seriesName? }
 *   → 200 { overview }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { callGateway, GatewayRateLimitError, GatewayTransientError, type ToolSchema } from './_lib/aiGateway.js'

export const maxDuration = 60

const TOOL_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    summary:       { type: 'string', description: '2–3 sentence plain-English summary of the core message.' },
    mainPoints:    { type: 'array', items: { type: 'string' }, description: '3–6 main points as complete sentences.' },
    keyInsights:   { type: 'array', items: { type: 'string' }, description: '2–4 key insights — what someone most needs to remember.' },
    bibleVerses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          text:      { type: 'string' },
        },
        required: ['reference', 'text'],
        additionalProperties: false,
      },
    },
    worshipSongs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title:  { type: 'string' },
          artist: { type: 'string' },
          notes:  { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    announcements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title:   { type: 'string' },
          details: { type: 'string' },
        },
        required: ['title', 'details'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'mainPoints', 'keyInsights', 'bibleVerses', 'worshipSongs', 'announcements'],
  additionalProperties: false,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const transcript  = typeof req.body?.transcript   === 'string' ? req.body.transcript   : ''
  const churchName  = typeof req.body?.churchName   === 'string' ? req.body.churchName   : ''
  const speakerName = typeof req.body?.speakerName  === 'string' ? req.body.speakerName  : ''
  const sermonTitle = typeof req.body?.sermonTitle  === 'string' ? req.body.sermonTitle  : ''
  const seriesName  = typeof req.body?.seriesName   === 'string' ? req.body.seriesName   : ''

  if (!transcript || transcript.trim().length < 200) {
    return res.status(400).json({ error: 'transcript required (min ~200 chars)' })
  }

  const ctx = [
    churchName  && `Church: ${churchName}`,
    speakerName && `Speaker: ${speakerName}`,
    sermonTitle && `Sermon: ${sermonTitle}`,
    seriesName  && `Series: ${seriesName}`,
  ].filter(Boolean).join('\n')

  try {
    const result = await callGateway<any>({
      system: `You are analyzing a church service recording. Extract a structured overview from the transcript. Return only what is actually present — do not fabricate details. Worship songs and announcements should be empty arrays if not found in the transcript.`,
      user: `${ctx ? ctx + '\n\n' : ''}Transcript:\n${transcript.slice(0, 60000)}`,
      toolName: 'generate_overview',
      toolDescription: 'Return a structured overview of the church service.',
      toolSchema: TOOL_SCHEMA,
      maxTokens: 3000,
    })

    return res.status(200).json({ overview: result.args })
  } catch (e) {
    if (e instanceof GatewayRateLimitError) return res.status(429).json({ error: 'Rate limit exceeded.' })
    if (e instanceof GatewayTransientError) return res.status(502).json({ error: e.message })
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Overview generation failed' })
  }
}
