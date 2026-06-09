/**
 * Export actions in the Review step. Two ways to ship the deliverables
 * out of the SRP tool:
 *
 *   1. Vista CSV download — generates client-side, one row per deliverable.
 *      Columns match what the team's existing scheduler import expects.
 *   2. ClickUp comment — posts all deliverables as a single comment on a
 *      partner-facing ClickUp task. Task ID picked inline.
 */

import { useState } from 'react'
import { Download, Loader2, MessageSquare, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { parseCarouselSlides, updateSession } from '../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../types/database'

export function ExportActions({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const [clickupTaskId, setClickupTaskId] = useState(session.clickup_task_id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pushingVista, setPushingVista] = useState(false)
  const [vistaMsg, setVistaMsg] = useState<{ kind: 'ok' | 'err' | 'config'; text: string; detail?: any } | null>(null)

  const handleCsv = () => {
    const csv = buildVistaCsv(session)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.session_id}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleVistaPush = async () => {
    setPushingVista(true); setVistaMsg(null)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/srp/push-to-vista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ sessionId: session.session_id }),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      if (res.status === 503) {
        setVistaMsg({ kind: 'config', text: json?.error ?? 'Vista push not configured', detail: json })
        return
      }
      if (!res.ok) {
        setVistaMsg({ kind: 'err', text: json?.error ?? `HTTP ${res.status}`, detail: json })
        return
      }
      const okCount = Number(json?.pushed ?? 0)
      const failCount = Number(json?.failed ?? 0)
      setVistaMsg({
        kind: failCount === 0 ? 'ok' : 'err',
        text: `Pushed ${okCount} deliverable${okCount === 1 ? '' : 's'} to Vista${failCount > 0 ? ` · ${failCount} failed` : ''}.`,
        detail: json,
      })
    } catch (e) {
      setVistaMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Push failed' })
    } finally { setPushingVista(false) }
  }

  const handleClickupSubmit = async () => {
    const taskId = clickupTaskId.trim()
    if (!taskId) {
      setSubmitMsg({ kind: 'err', text: 'Paste a ClickUp task ID first.' })
      return
    }
    setSubmitting(true); setSubmitMsg(null)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const jwt = authSession?.access_token
      if (!jwt) throw new Error('Not authenticated')
      const res = await fetch('/api/srp/submit-to-clickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ sessionId: session.session_id, clickupTaskId: taskId }),
      })
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      await updateSession(session.session_id, { clickup_task_id: taskId, clickup_url: `https://app.clickup.com/t/${taskId}` })
      onChange()
      setSubmitMsg({ kind: 'ok', text: `Comment posted to ClickUp · task ${taskId}` })
    } catch (e) {
      setSubmitMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Submission failed' })
    } finally { setSubmitting(false) }
  }

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated p-4 space-y-4">
      <header>
        <h3 className="text-[14px] font-semibold text-wm-text">Ship it</h3>
        <p className="text-[11px] text-wm-text-muted mt-0.5">Export to CSV for the Vista Social scheduler, or post all deliverables to a ClickUp task.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={handleCsv}
          className="rounded-md border border-wm-border bg-wm-bg hover:bg-wm-accent/5 px-3 py-3 text-left"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Download size={14} className="text-wm-accent-strong" />
            <span className="text-[13px] font-semibold text-wm-text">Download CSV</span>
          </div>
          <p className="text-[11px] text-wm-text-muted leading-snug">One row per deliverable. Manual import into Vista Social.</p>
        </button>

        <div className="rounded-md border border-wm-border bg-wm-bg px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Send size={14} className="text-wm-accent-strong" />
            <span className="text-[13px] font-semibold text-wm-text">Push to Vista</span>
          </div>
          <p className="text-[11px] text-wm-text-muted leading-snug mb-2">
            Ship every deliverable directly to the church's connected Vista profiles as drafts.
          </p>
          <button
            type="button"
            onClick={() => void handleVistaPush()}
            disabled={pushingVista}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-full bg-wm-accent px-3 py-1 text-[12px] text-white font-semibold disabled:opacity-50"
          >
            {pushingVista ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Push to Vista
          </button>
        </div>

        <div className="rounded-md border border-wm-border bg-wm-bg px-3 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare size={14} className="text-wm-accent-strong" />
            <span className="text-[13px] font-semibold text-wm-text">Post to ClickUp</span>
          </div>
          <input
            type="text"
            value={clickupTaskId}
            onChange={e => setClickupTaskId(e.target.value)}
            placeholder="ClickUp task ID (e.g. 86qz8w4kv)"
            className="w-full rounded-md border border-wm-border bg-wm-bg-elevated px-2 py-1 text-[12px] font-mono focus:outline-none focus:border-wm-accent"
          />
          <button
            onClick={() => void handleClickupSubmit()}
            disabled={submitting || !clickupTaskId.trim()}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-full bg-wm-accent px-3 py-1 text-[12px] text-white font-semibold disabled:opacity-50"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
            Post comment
          </button>
        </div>
      </div>

      {submitMsg && (
        <div className={[
          'text-[12px] rounded-md px-3 py-2 border',
          submitMsg.kind === 'ok' ? 'border-wm-success/30 bg-wm-success-bg text-wm-success' : 'border-wm-danger/30 bg-wm-danger-bg text-wm-danger',
        ].join(' ')}>
          {submitMsg.text}
          {session.clickup_url && submitMsg.kind === 'ok' && (
            <> · <a href={session.clickup_url} target="_blank" rel="noreferrer" className="underline">open task</a></>
          )}
        </div>
      )}

      {vistaMsg && (
        <div className={[
          'text-[12px] rounded-md px-3 py-2 border space-y-1',
          vistaMsg.kind === 'ok'     ? 'border-wm-success/30 bg-wm-success-bg text-wm-success'
          : vistaMsg.kind === 'config' ? 'border-wm-warning/30 bg-wm-warning-bg text-wm-warning'
          : 'border-wm-danger/30 bg-wm-danger-bg text-wm-danger',
        ].join(' ')}>
          <p>{vistaMsg.text}</p>
          {vistaMsg.kind === 'config' && vistaMsg.detail?.fallback && (
            <p className="text-wm-text-muted">{vistaMsg.detail.fallback}</p>
          )}
          {Array.isArray(vistaMsg.detail?.missing_env_vars) && vistaMsg.detail.missing_env_vars.length > 0 && (
            <p className="text-wm-text-muted">Missing env: <span className="font-mono">{vistaMsg.detail.missing_env_vars.join(', ')}</span></p>
          )}
          {Array.isArray(vistaMsg.detail?.results) && vistaMsg.detail.results.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-wm-text-muted">Per-deliverable results ({vistaMsg.detail.results.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {vistaMsg.detail.results.map((r: any, i: number) => (
                  <li key={i} className="text-wm-text-muted">
                    {r.ok ? '✓' : '✗'} {r.kind} · {r.platform}
                    {r.detail && typeof r.detail === 'string' && <span className="text-wm-text-subtle"> — {r.detail.slice(0, 120)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function buildVistaCsv(s: SmsSrpGeneration): string {
  const rows: Array<{ deliverable: string; content: string }> = []
  if (s.facebook_post) rows.push({ deliverable: 'Facebook Post', content: s.facebook_post })
  if (s.sunday_invite) rows.push({ deliverable: 'Sunday Invite', content: s.sunday_invite })
  if (s.carousel_caption) rows.push({ deliverable: 'Carousel Caption', content: s.carousel_caption })
  const slides = parseCarouselSlides(s.carousel_slides)
  slides.forEach(slide => rows.push({
    deliverable: `Carousel Slide ${slide.slide_number} (${slide.kind})`,
    content: slide.text,
  }))
  if (s.photo_recap_caption) rows.push({ deliverable: 'Photo Recap', content: s.photo_recap_caption })
  if (s.reel1_caption) rows.push({ deliverable: 'Reel 1', content: s.reel1_caption })
  if (s.reel2_caption) rows.push({ deliverable: 'Reel 2', content: s.reel2_caption })

  const header = ['Church', 'Member', 'Session ID', 'Deliverable', 'Content']
  const escape = (val: string): string => {
    if (val == null) return ''
    const needs = /[",\n\r]/.test(val)
    return needs ? `"${val.replace(/"/g, '""')}"` : val
  }
  const lines: string[] = [header.join(',')]
  rows.forEach(r => {
    lines.push([
      escape(s.church_name ?? ''),
      escape(s.member ?? ''),
      escape(s.session_id),
      escape(r.deliverable),
      escape(r.content),
    ].join(','))
  })
  return lines.join('\r\n')
}
