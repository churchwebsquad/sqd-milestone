import { useState } from 'react'
import { updateSession, parseCarouselSlides, stringifyCarouselSlides, type CarouselSlide } from '../../../lib/srpSessions'
import type { SmsSrpGeneration } from '../../../types/database'
import { GeneratorShell } from './GeneratorShell'
import { useSrpGenerator } from './useSrpGenerator'

const SLIDE_LABELS: Record<string, string> = {
  hook:        'Hook',
  verse:       'Bible verse',
  quote:       'Pastor quote',
  application: 'Application',
  cta:         'Call to action',
}

export function CarouselGenerator({ session, onChange }: {
  session: SmsSrpGeneration
  onChange: () => void
}) {
  const [pastorName, setPastorName] = useState('')
  const { busy, error, lastTook, call } = useSrpGenerator()

  const slides = parseCarouselSlides(session.carousel_slides)

  return (
    <div className="space-y-3">
      <GeneratorShell
        title="Carousel — caption"
        description="5-slide structure rendered below the caption. Each slide is independently editable."
        value={session.carousel_caption ?? ''}
        busy={busy}
        error={error}
        lastTook={lastTook}
        extraControls={
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-wm-text-subtle">Pastor name <span className="text-wm-text-muted normal-case font-normal">(optional, for slide 3 attribution)</span></span>
            <input
              type="text"
              value={pastorName}
              onChange={e => setPastorName(e.target.value)}
              placeholder="e.g. Pastor Sam"
              className="mt-1 w-full rounded-md border border-wm-border bg-wm-bg px-3 py-1.5 text-[13px] focus:outline-none focus:border-wm-accent"
            />
          </label>
        }
        onGenerate={async () => {
          const result = await call('generate-carousel', {
            sessionId:  session.session_id,
            transcript: session.transcript ?? '',
            pastorName,
            churchName: session.church_name ?? '',
          })
          if (result) onChange()
        }}
        onSave={async next => {
          await updateSession(session.session_id, { carousel_caption: next })
          onChange()
        }}
      />

      {slides.length > 0 && (
        <CarouselSlidesEditor session={session} slides={slides} onChange={onChange} />
      )}
    </div>
  )
}

function CarouselSlidesEditor({ session, slides, onChange }: {
  session: SmsSrpGeneration
  slides: CarouselSlide[]
  onChange: () => void
}) {
  const [draft, setDraft] = useState<CarouselSlide[]>(slides)
  const [savingIx, setSavingIx] = useState<number | null>(null)

  const save = async (ix: number, next: string) => {
    setSavingIx(ix)
    const updated = draft.map((s, i) => i === ix ? { ...s, text: next } : s)
    setDraft(updated)
    try {
      await updateSession(session.session_id, { carousel_slides: stringifyCarouselSlides(updated) })
      onChange()
    } finally { setSavingIx(null) }
  }

  return (
    <div className="rounded-lg border border-wm-border bg-wm-bg-elevated">
      <header className="px-4 py-3 border-b border-wm-border">
        <h3 className="text-[14px] font-semibold text-wm-text">Carousel — 5 slides</h3>
        <p className="text-[11px] text-wm-text-muted mt-0.5">Edit each slide individually. Saves on blur.</p>
      </header>
      <div className="p-4 space-y-3">
        {draft.map((s, i) => (
          <div key={i} className="rounded-md border border-wm-border bg-wm-bg p-3">
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-widest font-bold text-wm-accent-strong">
                Slide {s.slide_number ?? i + 1} · {SLIDE_LABELS[s.kind] ?? s.kind}
              </p>
              {savingIx === i && <span className="text-[10px] text-wm-text-subtle">Saving…</span>}
            </div>
            <textarea
              value={s.text}
              onChange={e => setDraft(d => d.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
              onBlur={e => { if (e.target.value !== slides[i]?.text) void save(i, e.target.value) }}
              rows={Math.min(6, Math.max(2, s.text.split('\n').length + 1))}
              className="w-full rounded-md border border-wm-border bg-wm-bg px-3 py-2 text-[13px] focus:outline-none focus:border-wm-accent whitespace-pre-wrap"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
