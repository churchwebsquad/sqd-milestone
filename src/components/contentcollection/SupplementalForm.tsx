/**
 * SupplementalForm — partner-facing "Page 2" of the content collection.
 *
 * When the church's current site doesn't reflect where they're headed,
 * this is where they paste fresh content. Each block is a rich-text
 * field with a `kind` tag so downstream tools (atomizer, prompt
 * builder, sitemap, design handoff) can route the content. Structure
 * at the OUTER level (kind + label), free-form at the INNER level
 * (markdown body).
 *
 * Autosaves on blur. Submit stamps `supplemental_submitted_at` on the
 * session so staff can see the page is sealed.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, ArrowRight, ArrowLeft, EyeOff, Paperclip } from 'lucide-react'
import { WMRichTextEditor } from '../wm/RichTextEditor'
import { PARTNER_GROUPS } from '../../lib/webPartnerGroups'
import { FileUploadField } from './FileUploadField'
import type { AttachmentMetadata } from '../../lib/contentCollectionAttachments'
import type { Mark, SaveMark } from '../wm/inventory/InventoryView'

export type SupplementalBlockKind =
  | 'vision_prose'
  | 'who_we_are'
  | 'gospel_or_beliefs'
  | 'ministry_outline'
  | 'rhythms_and_events'
  | 'next_steps'
  | 'key_page_request'
  | 'references'
  | 'notes_for_team'

export interface SupplementalBlock {
  kind:          SupplementalBlockKind
  label?:        string | null
  body_markdown: string
  updated_at?:   string
}

interface BlockDef {
  kind:        SupplementalBlockKind
  title:       string
  prompt:      string
  placeholder: string
}

/** Canonical block list. Order is the rendering order. Each block's
 *  prompt is the partner-facing question; downstream pipelines key off
 *  the `kind` to know what to do with the content. */
const BLOCKS: BlockDef[] = [
  {
    kind:        'vision_prose',
    title:       'Where you\'re headed',
    prompt:      'Big-picture vision for the new site. What\'s the church about NOW that your current site doesn\'t say well? Paste from a doc if you have one.',
    placeholder: 'We\'re a church that…',
  },
  {
    kind:        'who_we_are',
    title:       'Who you are',
    prompt:      'About / DNA / culture copy. What makes your church distinct? How would a member describe you to a friend?',
    placeholder: 'Our church is rooted in…',
  },
  {
    kind:        'gospel_or_beliefs',
    title:       'Gospel & what you believe',
    prompt:      'Your statement of faith, gospel framing, or doctrinal beliefs. Drop in your standard language if you have it.',
    placeholder: 'We believe…',
  },
  {
    kind:        'ministry_outline',
    title:       'Ministries',
    prompt:      'Each ministry you want on the new site, with a sentence or two about what it is and who it serves. One per line is fine.',
    placeholder: '• Youth — middle school + high school, Wednesday nights\n• Women\'s — monthly gatherings, weekly Bible study\n• …',
  },
  {
    kind:        'rhythms_and_events',
    title:       'Weekly rhythms & annual events',
    prompt:      'Weekly cadence (services, midweek, kids\' programs) + the big annual events that anchor the year.',
    placeholder: 'Sundays at 9 + 11 AM\nWednesday nights — kids program + youth + adult electives\nAnnual: Easter at the park, fall family camp, Christmas Eve',
  },
  {
    kind:        'next_steps',
    title:       'Next steps & pathway',
    prompt:      'How someone moves from first-time visitor → regular attender → member → serving + leading. What are the steps you want surfaced on the new site?',
    placeholder: 'New here → Connect Card → Newcomers Lunch → Membership Class → Group + Serve',
  },
  {
    kind:        'key_page_request',
    title:       'Key pages you need',
    prompt:      'Pages that have to exist on the new site. Anything special (interactive, template-driven, blog-style) — flag it here so the team knows what to scope.',
    placeholder: '• An interactive page someone could use to share the gospel with a friend\n• A staff-editable daily Bible reading plan (blog-style)\n• A simple membership signup page\n• …',
  },
  {
    kind:        'references',
    title:       'Inspiration & references',
    prompt:      'Other church sites or examples that capture what you\'re going for. Paste links + a note on what specifically you like.',
    placeholder: 'https://example.com/their-membership-page — the way they walk visitors through membership',
  },
  {
    kind:        'notes_for_team',
    title:       'Anything else',
    prompt:      'Anything we missed. Quirks, partner contact preferences, scope concerns, integration gotchas.',
    placeholder: 'Heads-up: we\'re also planning a name change in Q4 — let\'s coordinate.',
  },
]

interface Props {
  initialBlocks:    SupplementalBlock[]
  /** Save a single block by kind. Autosave on field blur. */
  saveBlock:        (kind: SupplementalBlockKind, body_markdown: string) => Promise<void>
  /** Existing inventory marks — used to render the "Pages to drop"
   *  checklist with the current omit state per bucket. Same shape +
   *  same storage as the per-card omit affordance on Step 1, so the
   *  two views stay in sync. */
  marks:            Map<string, Mark>
  saveMark:         SaveMark
  /** When set, the form is read-only (already submitted). */
  submittedAt?:     string | null
  /** Continue forward in the flow (Step 3 = technical details). The
   *  parent's handler is expected to stamp supplemental_submitted_at
   *  at the same time, so this Continue click implicitly seals the
   *  page — there's no separate Submit button. */
  onContinue?:      () => void | Promise<void>
  /** Step back (e.g., Step 1 = inventory). */
  onBack?:          () => void
  /** Required when the Attachments section should render. Caller owns
   *  the session-wide attachment list; this component filters to the
   *  `supplemental` kind for display + add/remove. */
  sessionId?:           string
  attachments?:         AttachmentMetadata[]
  onAttachmentChange?:  (updater: (prev: AttachmentMetadata[]) => AttachmentMetadata[]) => void
}

export function SupplementalForm({
  initialBlocks, saveBlock, marks, saveMark, submittedAt, onContinue, onBack,
  sessionId, attachments, onAttachmentChange,
}: Props) {
  const supplementalAttachments = useMemo(
    () => (attachments ?? []).filter(a => a.kind === 'supplemental'),
    [attachments],
  )
  const canAttach = !!sessionId && !!onAttachmentChange
  // Per-block draft state, keyed by kind. Initialized from the saved
  // blocks; resyncs only when the underlying value changes from outside.
  const blocksByKind = useMemo(() => {
    const m = new Map<SupplementalBlockKind, SupplementalBlock>()
    for (const b of initialBlocks) m.set(b.kind, b)
    return m
  }, [initialBlocks])

  const [drafts, setDrafts] = useState<Record<SupplementalBlockKind, string>>(() => {
    const out: Record<string, string> = {}
    for (const b of BLOCKS) out[b.kind] = blocksByKind.get(b.kind)?.body_markdown ?? ''
    return out as Record<SupplementalBlockKind, string>
  })
  const [savingKind, setSavingKind] = useState<SupplementalBlockKind | null>(null)
  const [savedKind,  setSavedKind]  = useState<SupplementalBlockKind | null>(null)
  const [continuing, setContinuing] = useState(false)

  // Re-sync drafts when a fresh initialBlocks arrives (e.g. on first
  // load after the page mounts). After that, partner edits stay local.
  useEffect(() => {
    setDrafts(prev => {
      const next = { ...prev }
      for (const b of BLOCKS) {
        const saved = blocksByKind.get(b.kind)?.body_markdown ?? ''
        if (prev[b.kind] === '' && saved !== '') next[b.kind] = saved
      }
      return next
    })
  }, [blocksByKind])

  const readonly = !!submittedAt
  const commit = async (kind: SupplementalBlockKind) => {
    if (readonly) return
    const current = blocksByKind.get(kind)?.body_markdown ?? ''
    const draft = drafts[kind] ?? ''
    if (draft === current) return
    setSavingKind(kind)
    try {
      await saveBlock(kind, draft)
      setSavedKind(kind)
      setTimeout(() => setSavedKind(s => (s === kind ? null : s)), 1500)
    } finally {
      setSavingKind(null)
    }
  }

  return (
    <div className="bg-white border border-lavender rounded-2xl overflow-hidden">
      <header className="px-5 py-4 border-b border-lavender bg-lavender-tint/30">
        <p className="text-[10px] uppercase tracking-widest font-bold text-primary-purple">Supplemental content</p>
        <h2 className="font-serif italic text-[22px] text-deep-plum mt-1 leading-tight">
          Supply the content you want to lead with.
        </h2>
        <p className="text-sm text-purple-gray mt-2 max-w-2xl leading-relaxed">
          When your current site doesn't quite reflect where you're headed, use this page to drop in fresh
          content. Each section is optional — fill what's useful, leave the rest blank. Paste from a doc,
          write fresh, link out — whatever's easiest. Saves automatically as you go.
        </p>
        {submittedAt && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
            <Check size={12} /> Submitted on {new Date(submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </header>

      <div className="p-5 md:p-6 space-y-6">
        {/* ── Pages to drop checklist ───────────────────────────────────
            Bulk-omit affordance. Same storage as the per-card "Skip on
            new site" toggle the partner sees on Step 1 — both write
            bucket-level omit marks on strategy_content_collection_marks
            so the views stay in sync. */}
        <section>
          <div className="mb-2">
            <h3 className="text-[15px] font-semibold text-deep-plum">Pages to drop on the new site</h3>
            <p className="text-[12.5px] text-purple-gray mt-0.5 leading-snug">
              Tick anything from the current site that should NOT carry over. Any section you skip here is excluded
              from the new site's content collection, your squad won't use it when crafting your new site.
            </p>
          </div>
          <div className="rounded-lg border border-lavender bg-cream/40 divide-y divide-lavender/50">
            {PARTNER_GROUPS.flatMap(g => g.buckets).map(b => {
              const path     = `bucket:${b.key}`
              const omitted  = marks.get(path)?.status === 'omit'
              return (
                <label
                  key={b.key}
                  className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-lavender-tint/30 ${
                    omitted ? 'bg-cream/60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={omitted}
                    disabled={readonly}
                    onChange={e => {
                      void saveMark(
                        path,
                        'topic_item',
                        e.target.checked ? 'omit' : 'approved',
                        null,
                      )
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-lavender accent-purple-gray cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-semibold ${omitted ? 'text-purple-gray line-through' : 'text-deep-plum'}`}>
                      {b.label}
                    </p>
                    {b.helpText && (
                      <p className="text-[11px] text-purple-gray mt-0.5 leading-snug">{b.helpText}</p>
                    )}
                  </div>
                  {omitted && (
                    <span className="text-[10px] uppercase tracking-widest font-bold text-purple-gray bg-cream border border-purple-gray/30 rounded-full px-2 py-0.5 inline-flex items-center gap-1 shrink-0">
                      <EyeOff size={10} /> Skip
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </section>

        {BLOCKS.map(b => (
          <section key={b.kind}>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <h3 className="text-[15px] font-semibold text-deep-plum">{b.title}</h3>
              <div className="text-[10.5px] text-purple-gray flex items-center gap-1.5 shrink-0">
                {savingKind === b.kind && <><Loader2 size={10} className="animate-spin" /> Saving</>}
                {savedKind  === b.kind && savingKind !== b.kind && <><Check size={10} className="text-emerald-600" /> Saved</>}
              </div>
            </div>
            <p className="text-[12.5px] text-purple-gray mb-2 leading-snug">{b.prompt}</p>
            <div
              onBlur={() => void commit(b.kind)}
              // Tailwind descendant utility: bump the ProseMirror
              // editor area so partners have real room to paste — the
              // editor's native min-height of ~3 lines felt cramped
              // for prose-heavy fields like vision + about + gospel.
              className="[&_.ProseMirror]:min-h-[160px]"
            >
              <WMRichTextEditor
                value={drafts[b.kind] ?? ''}
                onChange={v => setDrafts(prev => ({ ...prev, [b.kind]: v }))}
                placeholder={b.placeholder}
                readOnly={readonly}
              />
            </div>
          </section>
        ))}

        {/* ── Attachments ──────────────────────────────────────────────
            CSVs, source docs, PDFs, screenshots — anything that backs
            up the supplemental content above. Common case: a directory
            CSV (staff, volunteers) or a vision doc the church wants
            the team to read in full. */}
        {canAttach && (
          <section>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <h3 className="text-[15px] font-semibold text-deep-plum inline-flex items-center gap-2">
                <Paperclip size={14} className="text-primary-purple" />
                Attachments
              </h3>
            </div>
            <p className="text-[12.5px] text-purple-gray mb-2 leading-snug">
              Drop in CSV exports (staff, ministries, groups), source docs,
              PDFs, or images that back up anything you wrote above. Files
              save the moment you upload — no need to hit Continue first.
            </p>
            <div className="rounded-lg border border-lavender bg-cream/30 p-3">
              <FileUploadField
                sessionId={sessionId!}
                kind="supplemental"
                attachments={supplementalAttachments}
                onUploaded={a => onAttachmentChange!(prev => [a, ...prev])}
                onDeleted={id => onAttachmentChange!(prev => prev.filter(p => p.id !== id))}
                help="CSV, DOCX, PDF, or images. Up to 50 MB per file."
              />
            </div>
          </section>
        )}
      </div>

      {/* Footer nav. The supplemental page can't be skipped past
          Step 3 from here — clicking Continue stamps the supplemental
          as submitted AND advances. There is no standalone Submit
          affordance; we don't want partners to think they can
          "submit + done" without completing the setup questions. */}
      <div className="px-5 py-4 border-t border-lavender bg-lavender-tint/15 flex items-center justify-between gap-3 flex-wrap">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-purple-gray hover:text-deep-plum px-3 py-2 rounded-full"
          >
            <ArrowLeft size={13} /> Back to inventory
          </button>
        ) : <span />}
        {onContinue && (
          <button
            type="button"
            disabled={continuing}
            onClick={async () => {
              setContinuing(true)
              try { await onContinue() }
              finally { setContinuing(false) }
            }}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-primary-purple hover:bg-deep-plum disabled:opacity-50 px-4 py-2 rounded-full"
          >
            {continuing ? <Loader2 size={12} className="animate-spin" /> : null}
            Continue <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
