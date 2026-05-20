import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronRight, HandHelping, Wrench } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'
import type { HandoffForm } from '../../types/churches'
import { SectionHeader } from './ChurchUI'

interface Props {
  church: StrategyAccountProgress
}

/** Pill badge for pathway / status values */
function Pill({ label, color = 'purple' }: { label: string; color?: 'purple' | 'green' | 'amber' }) {
  const colors = {
    purple: 'bg-primary-purple/10 text-primary-purple border-primary-purple/20',
    green:  'bg-green-100 text-green-700 border-green-200',
    amber:  'bg-amber-100 text-amber-700 border-amber-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-0.5 border ${colors[color]}`}>
      {label}
    </span>
  )
}

/** URL rendered as a compact icon button */
function LinkButton({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
    >
      <ExternalLink size={10} className="shrink-0" />
      {label}
    </a>
  )
}

/** Collapsible section within a handoff card. Collapsed by default
 *  — the brief is dense and the strategist usually opens just one
 *  section at a time. */
function HandoffAccordionItem({ title, defaultOpen = false, children }: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-lavender/40 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-0 py-3 text-left"
      >
        <span className="text-sm font-semibold text-deep-plum">{title}</span>
        {open
          ? <ChevronDown size={16} className="text-primary-purple shrink-0" />
          : <ChevronRight size={16} className="text-purple-gray shrink-0" />}
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}

// Preferred display order for known handoff form keys. Anything not
// listed renders after these in insertion order.
const KEY_ORDER = [
  'primaryGoals', 'contentNeeds', 'churchVision', 'timelineNotes',
  'auditTypes', 'refreshType', 'refreshTypeCategory',
  'micrositeExploration', 'nextStepPathway', 'pathwayNotes',
  'additionalClarifications',
]

// Keys handled by the header chrome — never render as accordion items.
const SKIP_KEYS = new Set(['selectedPathways', 'selectedPathway', 'status'])

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim()
}

/** Render a single handoff form value of any shape. */
function ValueRenderer({ value }: { value: unknown }) {
  if (value == null || value === '' || value === false) {
    return <p className="text-xs text-purple-gray/50 italic">Empty</p>
  }
  if (typeof value === 'boolean') {
    return <p className="text-sm text-deep-plum">{value ? 'Yes' : 'No'}</p>
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value)
    if (/^https?:\/\//i.test(str)) {
      return <LinkButton label={str} url={str} />
    }
    return (
      <p className="text-sm text-deep-plum whitespace-pre-wrap leading-relaxed">{str}</p>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="text-xs text-purple-gray/50 italic">Empty</p>
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {value.map((item, i) => (
          <span key={i} className="text-xs bg-lavender-tint text-deep-plum rounded-full px-2.5 py-1">
            {String(item)}
          </span>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '' && v !== false)
    if (entries.length === 0) {
      return <p className="text-xs text-purple-gray/50 italic">Empty</p>
    }
    return (
      <div className="space-y-2">
        {entries.map(([key, v]) => (
          <div key={key} className="flex items-baseline gap-2">
            <span className="text-xs text-purple-gray min-w-[120px]">{humanizeKey(key)}</span>
            <span className="text-sm text-deep-plum">
              {typeof v === 'boolean'
                ? (v ? 'Yes' : 'No')
                : Array.isArray(v)
                  ? v.join(', ')
                  : String(v)}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

function HandoffCard({ title, data, linkUrl, linkLabel, lastUpdated }: {
  title: string
  data: Record<string, unknown> | null
  linkUrl: string | null
  linkLabel: string
  lastUpdated: string | null
}) {
  if (!data) {
    return (
      <div className="border border-lavender rounded-xl p-4">
        <p className="text-sm text-purple-gray/50 italic">{title}: No handoff data</p>
      </div>
    )
  }

  const form = ((data as HandoffForm).form ?? data) as Record<string, unknown>
  const rawPathways = form.selectedPathways ?? form.selectedPathway
  const pathways: string[] | null = rawPathways
    ? (Array.isArray(rawPathways) ? rawPathways.map(String) : [String(rawPathways)])
    : null
  const status = (data as Record<string, unknown>).status as string | undefined

  // Build ordered list of (key, value) accordion items.
  const formKeys = Object.keys(form).filter(k => !SKIP_KEYS.has(k))
  const ordered = [
    ...KEY_ORDER.filter(k => formKeys.includes(k)),
    ...formKeys.filter(k => !KEY_ORDER.includes(k)),
  ]

  return (
    <div className="border border-lavender rounded-xl overflow-hidden">
      <div className="px-5 py-4 bg-lavender-tint/30">
        <h3 className="text-base font-bold text-deep-plum mb-2">{title}</h3>
        <div className="flex flex-wrap gap-2">
          {pathways && pathways.map(p => <Pill key={p} label={p} />)}
          {status && <Pill label={status} color="green" />}
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {linkUrl && <LinkButton label={linkLabel} url={linkUrl} />}
          {lastUpdated && (
            <span className="text-[10px] text-purple-gray">Last updated: {lastUpdated}</span>
          )}
        </div>
      </div>

      <div className="px-5">
        {ordered.length === 0 ? (
          <p className="py-4 text-xs text-purple-gray/50 italic">No handoff details captured.</p>
        ) : (
          ordered.map(key => (
            <HandoffAccordionItem key={key} title={humanizeKey(key)}>
              <ValueRenderer value={form[key]} />
            </HandoffAccordionItem>
          ))
        )}
      </div>
    </div>
  )
}

export default function HandoffSection({ church }: Props) {
  const raw = church as Record<string, unknown>

  return (
    <section id="account-manager-handoff" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <SectionHeader icon={HandHelping} title="Account Manager Handoff" />

      <a
        href="https://amhandoffnotes.lovable.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900 px-5 py-2 hover:bg-amber-100 hover:border-amber-400 transition-colors mb-5"
      >
        <Wrench size={13} className="text-amber-700" />
        Fill Out Account Handoff Form
        <ExternalLink size={12} className="text-amber-600" />
      </a>

      <div className="space-y-4">
        <HandoffCard
          title="Brand Handoff"
          data={church.handoff_brand_form as Record<string, unknown> | null}
          linkUrl={raw.handoff_brand_link as string | null}
          linkLabel="Sharable Handoff Link"
          lastUpdated={raw.handoff_brand_last_updated as string | null}
        />
        <HandoffCard
          title="Web Handoff"
          data={church.handoff_web_form as Record<string, unknown> | null}
          linkUrl={raw.handoff_web_link as string | null}
          linkLabel="Sharable Handoff Link"
          lastUpdated={raw.handoff_web_last_updated as string | null}
        />
      </div>
    </section>
  )
}
