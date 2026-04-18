import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import type { StrategyAccountProgress } from '../../types/database'
import type { HandoffForm } from '../../types/churches'

interface Props {
  church: StrategyAccountProgress
}

/** Pill badge for pathway / status values */
function Pill({ label, color = 'purple' }: { label: string; color?: 'purple' | 'green' | 'amber' }) {
  const colors = {
    purple: 'bg-primary-purple/10 text-primary-purple border-primary-purple/20',
    green: 'bg-green-100 text-green-700 border-green-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
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

/** Collapsible section within a handoff card */
function HandoffAccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-lavender/40">
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
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

/** Recursively render form values in a human-friendly way */
function FormEntries({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '' && v !== false)
  if (entries.length === 0) return <p className="text-xs text-purple-gray/50 italic">Empty</p>

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => {
        // Skip internal keys
        if (key === 'form' || key === 'selectedPathway' || key === 'selectedPathways') return null
        const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

        if (typeof value === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-purple-gray">{label}:</span>
              <span className="text-xs text-deep-plum font-medium">{value ? 'Yes' : 'No'}</span>
            </div>
          )
        }
        if (typeof value === 'string' || typeof value === 'number') {
          const str = String(value)
          if (str.startsWith('http')) {
            return <div key={key}><LinkButton label={label} url={str} /></div>
          }
          return (
            <div key={key}>
              <p className="text-xs text-purple-gray">{label}</p>
              <p className="text-sm text-deep-plum whitespace-pre-wrap">{str}</p>
            </div>
          )
        }
        if (Array.isArray(value)) {
          return (
            <div key={key}>
              <p className="text-xs text-purple-gray mb-1">{label}</p>
              <div className="flex flex-wrap gap-1.5">
                {value.map((item, i) => (
                  <span key={i} className="text-xs bg-lavender-tint text-deep-plum rounded-full px-2 py-0.5">{String(item)}</span>
                ))}
              </div>
            </div>
          )
        }
        if (typeof value === 'object' && value !== null) {
          return (
            <div key={key}>
              <p className="text-xs text-purple-gray font-semibold mb-1">{label}</p>
              <div className="ml-3 pl-3 border-l-2 border-lavender/40">
                <FormEntries data={value as Record<string, unknown>} />
              </div>
            </div>
          )
        }
        return null
      })}
    </div>
  )
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

  const form = (data as HandoffForm).form ?? data
  const rawPathways = form.selectedPathways ?? form.selectedPathway
  const pathways: string[] | null = rawPathways
    ? (Array.isArray(rawPathways) ? rawPathways.map(String) : [String(rawPathways)])
    : null
  const status = (data as Record<string, unknown>).status as string | undefined

  // Build section groups from the form data
  const sectionKeys = Object.keys(form).filter(k =>
    k !== 'selectedPathways' && k !== 'selectedPathway' && k !== 'status'
    && typeof form[k] === 'object' && form[k] !== null && !Array.isArray(form[k])
  )
  const topLevelKeys = Object.keys(form).filter(k =>
    k !== 'selectedPathways' && k !== 'selectedPathway' && k !== 'status'
    && (typeof form[k] !== 'object' || form[k] === null || Array.isArray(form[k]))
  )

  return (
    <div className="border border-lavender rounded-xl overflow-hidden">
      <div className="px-5 py-4 bg-lavender-tint/30">
        <h3 className="text-sm font-bold text-deep-plum mb-2">{title}</h3>
        <div className="flex flex-wrap gap-2">
          {pathways && pathways.map(p => <Pill key={p} label={p} />)}
          {status && <Pill label={status} color="green" />}
        </div>
        <div className="flex items-center gap-2 mt-3">
          {linkUrl && <LinkButton label={linkLabel} url={linkUrl} />}
          {lastUpdated && (
            <span className="text-[10px] text-purple-gray">Last updated: {lastUpdated}</span>
          )}
        </div>
      </div>

      <div className="px-5">
        {/* Top-level scalar fields */}
        {topLevelKeys.length > 0 && (
          <HandoffAccordionItem title="Primary Goals">
            <FormEntries data={Object.fromEntries(topLevelKeys.map(k => [k, form[k]]))} />
          </HandoffAccordionItem>
        )}

        {/* Grouped sections */}
        {sectionKeys.map(key => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
          return (
            <HandoffAccordionItem key={key} title={label}>
              <FormEntries data={form[key] as Record<string, unknown>} />
            </HandoffAccordionItem>
          )
        })}
      </div>
    </div>
  )
}

export default function HandoffSection({ church }: Props) {
  const raw = church as Record<string, unknown>

  return (
    <section id="account-manager-handoff" className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6">
      <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider mb-4">Account Manager Handoff</h2>

      <a
        href="https://amhandoffnotes.lovable.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-deep-plum text-white text-sm font-semibold px-5 py-2 hover:bg-primary-purple transition-colors mb-5"
      >
        Fill Out Account Handoff Form <ExternalLink size={13} />
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
