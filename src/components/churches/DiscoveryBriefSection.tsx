/**
 * Read-only display of a partner's most recent Discovery Questionnaire.
 *
 * Sits on AccountLogPage alongside the existing handoff/intel sections.
 * The data is ingested by an n8n workflow; the app is read-only here.
 *
 * Visual lineage: matches HandoffSection's section-card + accordion
 * pattern (`SectionHeader` from ChurchUI, `bg-white border border-lavender
 * rounded-xl` shell, lavender-tint pills). Sections default closed
 * except the Snapshot, which surfaces the basics without a click.
 */

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from 'lucide-react'
import { SectionHeader } from './ChurchUI'
import {
  getLatestQuestionnaireForMember,
  listQuestionnaireFiles,
  getQuestionnaireFileUrl,
} from '../../lib/discoveryQuestionnaire'
import type {
  StrategyDiscoveryQuestionnaire,
  StrategyDiscoveryQuestionnaireFile,
} from '../../types/database'

interface Props {
  member: number
  /** When true, every accordion opens by default (useful on the
   *  dedicated /discovery-brief page where it's the entire view). The
   *  default behavior — Snapshot open, rest closed — keeps the section
   *  scannable when it's one of many on the same page. */
  defaultExpanded?: boolean
}

export default function DiscoveryBriefSection({ member, defaultExpanded = false }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [row, setRow] = useState<StrategyDiscoveryQuestionnaire | null>(null)
  const [files, setFiles] = useState<StrategyDiscoveryQuestionnaireFile[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getLatestQuestionnaireForMember(member)
      .then(async r => {
        if (cancelled) return
        setRow(r)
        if (r) {
          try {
            const fs = await listQuestionnaireFiles(r.id)
            if (!cancelled) setFiles(fs)
          } catch {
            if (!cancelled) setFiles([])
          }
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [member])

  return (
    <section
      id="discovery-brief"
      className="bg-white border border-lavender rounded-xl p-5 shadow-sm scroll-mt-6"
    >
      <SectionHeader icon={ClipboardList} title="Discovery Brief" />

      {loading && (
        <p className="text-sm text-purple-gray/70 italic">Loading…</p>
      )}
      {error && !loading && (
        <p className="text-sm text-red-700">Couldn't load discovery brief: {error}</p>
      )}
      {!loading && !error && !row && (
        <p className="text-sm text-purple-gray/70 italic">
          No discovery questionnaire on file.
        </p>
      )}
      {!loading && !error && row && (
        <Brief row={row} files={files} defaultExpanded={defaultExpanded} />
      )}
    </section>
  )
}

// ── Body ──────────────────────────────────────────────────────────────────

function Brief({
  row,
  files,
  defaultExpanded,
}: {
  row: StrategyDiscoveryQuestionnaire
  files: StrategyDiscoveryQuestionnaireFile[]
  defaultExpanded: boolean
}) {
  // When defaultExpanded, every accordion below opens by default; the
  // Snapshot section opens either way.
  const open = defaultExpanded
  return (
    <div>
      <Header row={row} />

      <div className="border border-lavender rounded-xl overflow-hidden mt-4">
        <Accordion title="Snapshot" defaultOpen>
          <Field label="Primary contact">
            <ContactBlock row={row} />
          </Field>
          <Field label="Submitted">{formatDate(row.submitted_at)}</Field>
          <Field label="Cohort">{row.cohort}</Field>
          <Field label="Discovery call">{formatDate(row.discovery_call_booking)}</Field>
          <Field label="How they heard about us">{row.how_heard_about_us}</Field>
        </Accordion>

        <Accordion title="Identity & vision" defaultOpen={open}>
          <Field label="What the church name means">{row.church_name_meaning}</Field>
          <Field label="Mission / vision">{row.mission_vision_statement}</Field>
          <Field label="What they call services">{row.service_terminology}</Field>
          <Field label="Defining milestones">{row.defining_milestones}</Field>
          <Field label="Identity phrase or verse">{row.identity_phrase_or_verse}</Field>
          <Field label="Next 12 months — success">{row.next_12_months_success}</Field>
        </Accordion>

        <Accordion title="Audience" defaultOpen={open}>
          <Field label="Who they serve">{row.typical_audience_description}</Field>
          <Field label="Online vs in-person audience">{row.online_audience_difference}</Field>
          <Field label="Ideal in-person experience">{row.ideal_in_person_experience}</Field>
          <Field label="Ideal website experience">{row.ideal_website_experience}</Field>
          <Field label="Outreach methods that work">{row.best_outreach_methods}</Field>
        </Accordion>

        <Accordion title="Voice & messaging" defaultOpen={open}>
          <Field label="Voice style">{row.audience_voice_style}</Field>
          <Field label="How they feel about their current voice">{row.current_voice_assessment}</Field>
          <Field label="One key message">{row.one_key_message}</Field>
          <Field label="Emotions to evoke">{row.desired_emotions}</Field>
          <Field label="Words / tones to avoid">{row.words_tones_to_avoid}</Field>
          <Field label="Tone consistency (online / stage / camera)">{row.communication_tone_consistency}</Field>
          <Field label="Recurring ministry theme">{row.recurring_message_theme}</Field>
        </Accordion>

        <Accordion title="Visual scales" defaultOpen={open}>
          <ScaleRow label="Simple ⇄ Intricate" value={row.visual_simple_to_intricate} max={5} />
          <ScaleRow label="Classic ⇄ Modern" value={row.visual_classic_to_modern} max={5} />
          <ScaleRow label="Timeless ⇄ Trendy" value={row.visual_timeless_to_trendy} max={5} />
          <ScaleRow label="Function-First ⇄ Form-First" value={row.visual_function_to_form} max={5} />
          <ScaleRow label="Storytelling: Literal ⇄ Abstract" value={row.storytelling_literal_to_abstract} max={5} />
        </Accordion>

        <Accordion title="Brand specifics" defaultOpen={open}>
          <Field label="Brand redesign needs">{row.brand_redesign_needs}</Field>
          <Field label="Font preferences">{row.font_preferences}</Field>
          <Field label="Symbols or imagery that feel like them">{row.symbols_or_imagery}</Field>
          <Field label="Inspirational brands">{row.inspirational_brands}</Field>
          <Field label="Brands to avoid">{row.brands_to_avoid}</Field>
          <Field label="Inspirational websites">{row.inspirational_websites}</Field>
          <Field label="Exceptional communicators">{row.exceptional_communicators}</Field>
          <Field label="Additional branding notes">{row.branding_additional_notes}</Field>
        </Accordion>

        <Accordion title="Web" defaultOpen={open}>
          <Field label="Current website">
            {row.current_website_url ? <UrlLink url={row.current_website_url} /> : null}
          </Field>
          <Field label="Current platform(s)">
            <PillList items={row.current_website_platforms} />
          </Field>
          <Field label="Website redesign needs">{row.website_redesign_needs}</Field>
          <Field label="Parts to refresh">
            <PillList items={row.parts_to_refresh} />
          </Field>
          <Field label="Copy approach">{row.copy_approach}</Field>
          <Field label="Current platform satisfaction">{row.current_platform_satisfaction}</Field>
          <Field label="Navigation satisfaction (1–10)">
            <ScaleValue value={row.current_navigation_satisfaction} max={10} />
          </Field>
          <Field label="Top 3 website goals">{row.top_3_website_goals}</Field>
          <Field label="Top website priority">{row.top_website_priority}</Field>
          <Field label="Weekly maintenance hours">{row.weekly_maintenance_hours}</Field>
          <Field label="Initial web support preferences">
            <PillList items={row.initial_web_support_preferences} />
          </Field>
          <Field label="Software in use">{row.software_in_use}</Field>
          <Field label="Google My Business claimed">{row.google_business_claimed}</Field>
          <Field label="Website comments">{row.website_comments}</Field>
        </Accordion>

        <Accordion title="Social" defaultOpen={open}>
          <Field label="Platforms to post to">
            <PillList items={row.social_platforms} />
          </Field>
          <Field label="How they refer to the speaking pastor">{row.speaking_pastor_reference}</Field>
          <Field label="Scheduling email">{row.social_scheduling_email}</Field>
        </Accordion>

        <Accordion title="Video" defaultOpen={open}>
          <Field label="Current video use">{row.current_video_use}</Field>
          <Field label="Desired video formats">{row.desired_video_formats}</Field>
          <Field label="Storytelling approach">{row.storytelling_approach}</Field>
          <Field label="Communication habits to avoid">{row.video_communication_avoidances}</Field>
          <Field label="Produced vs authentic preference">{row.produced_vs_authentic_preference}</Field>
          <Field label="A moment that felt right">{row.exemplary_video_moment}</Field>
        </Accordion>

        <Accordion title="Bible" defaultOpen={open}>
          <Field label="Translations">
            <PillList items={row.bible_translations} />
          </Field>
          <Field label="Deviates from primary translation">{row.deviates_from_primary_translation}</Field>
        </Accordion>

        <Accordion title="Decision makers" defaultOpen={open}>
          <Field label="Internal decision makers">{row.internal_decision_makers}</Field>
        </Accordion>

        <Accordion title={`Files${files.length > 0 ? ` (${files.length})` : ''}`} defaultOpen={open}>
          <FileList files={files} />
        </Accordion>
      </div>
    </div>
  )
}

// ── Header (above accordion) ──────────────────────────────────────────────

function Header({ row }: { row: StrategyDiscoveryQuestionnaire }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.cohort && <Pill label={row.cohort} />}
      {row.source !== 'native' && (
        <Pill label={row.source === 'airtable_legacy' ? 'Migrated' : 'Form'} />
      )}
      <span className="text-xs text-purple-gray">
        Submitted {formatDate(row.submitted_at)}
      </span>
    </div>
  )
}

function ContactBlock({ row }: { row: StrategyDiscoveryQuestionnaire }) {
  const parts = [
    row.primary_contact_name,
    row.primary_contact_role,
  ].filter(Boolean) as string[]
  return (
    <div className="space-y-0.5">
      {parts.length > 0 && <div className="text-sm text-deep-plum">{parts.join(' · ')}</div>}
      {row.primary_contact_email && (
        <a
          href={`mailto:${row.primary_contact_email}`}
          className="text-xs text-primary-purple underline hover:text-deep-plum"
        >
          {row.primary_contact_email}
        </a>
      )}
      {row.primary_contact_phone && (
        <div className="text-xs text-purple-gray">{row.primary_contact_phone}</div>
      )}
      {parts.length === 0 && !row.primary_contact_email && !row.primary_contact_phone && (
        <Empty />
      )}
    </div>
  )
}

// ── Files ─────────────────────────────────────────────────────────────────

function FileList({ files }: { files: StrategyDiscoveryQuestionnaireFile[] }) {
  if (files.length === 0) {
    return <Empty />
  }
  return (
    <ul className="space-y-1.5">
      {files.map(f => (
        <li key={f.id}>
          <FileItem file={f} />
        </li>
      ))}
    </ul>
  )
}

function FileItem({ file }: { file: StrategyDiscoveryQuestionnaireFile }) {
  const [resolving, setResolving] = useState(false)
  const Icon = file.file_kind === 'logo' ? ImageIcon
    : file.file_kind === 'submission_pdf' ? FileText
    : Paperclip

  const label = file.filename || file.file_kind
  const kindLabel = ({
    logo: 'Logo',
    brand_guide: 'Brand guide',
    submission_pdf: 'Submission PDF',
    other: 'File',
  } as const)[file.file_kind] ?? 'File'

  const onClick = async (e: React.MouseEvent) => {
    if (!file.storage_path) return
    e.preventDefault()
    setResolving(true)
    const url = await getQuestionnaireFileUrl(file.storage_path)
    setResolving(false)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Legacy row not yet migrated to Storage — fall back to source_url if
  // we have one, otherwise render disabled.
  if (!file.storage_path) {
    if (file.source_url) {
      return (
        <a
          href={file.source_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Pre-migration source URL — may have expired"
          className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs font-semibold text-amber-900 hover:border-amber-300"
        >
          <Icon size={12} className="text-amber-700 shrink-0" />
          <span className="text-[10px] uppercase tracking-wide font-bold text-amber-700/80">{kindLabel}</span>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          <ExternalLink size={10} className="text-amber-700/70 shrink-0" />
        </a>
      )
    }
    return (
      <div
        title="File not yet ingested into Storage"
        className="flex items-center gap-2 rounded-md border border-lavender bg-lavender-tint/30 px-3 py-2 text-xs text-purple-gray/70"
      >
        <Icon size={12} className="shrink-0" />
        <span className="text-[10px] uppercase tracking-wide font-bold">{kindLabel}</span>
        <span className="flex-1 min-w-0 truncate italic">{label}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={resolving}
      className="w-full flex items-center gap-2 rounded-md border border-lavender bg-white px-3 py-2 text-xs font-semibold text-deep-plum hover:border-primary-purple hover:text-primary-purple hover:bg-lavender-tint/40 transition-colors disabled:opacity-60"
    >
      <Icon size={12} className="text-primary-purple shrink-0" />
      <span className="text-[10px] uppercase tracking-wide font-bold text-purple-gray">{kindLabel}</span>
      <span className="flex-1 min-w-0 truncate text-left">{label}</span>
      <ExternalLink size={10} className="text-purple-gray/60 shrink-0" />
    </button>
  )
}

// ── Field / accordion / scale primitives ──────────────────────────────────

function Accordion({
  title,
  defaultOpen = false,
  children,
}: {
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
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-lavender-tint/30 transition-colors"
      >
        <span className="text-sm font-semibold text-deep-plum">{title}</span>
        {open
          ? <ChevronDown size={16} className="text-primary-purple shrink-0" />
          : <ChevronRight size={16} className="text-purple-gray shrink-0" />}
      </button>
      {open && <div className="px-5 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children?: React.ReactNode
}) {
  // Distinguish "field exists but value missing" from "field intentionally blank".
  const hasValue = children !== null && children !== undefined && children !== ''
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide font-semibold text-purple-gray/80 mb-0.5">
        {label}
      </p>
      {hasValue
        ? typeof children === 'string'
          ? <p className="text-sm text-deep-plum whitespace-pre-wrap leading-relaxed">{children}</p>
          : <div className="text-sm text-deep-plum">{children}</div>
        : <Empty />}
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-purple-gray/40">—</p>
}

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-0.5 bg-primary-purple/10 text-primary-purple border border-primary-purple/20">
      {label}
    </span>
  )
}

function PillList({ items }: { items: string[] | null }) {
  if (!items || items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span
          key={i}
          className="text-xs bg-lavender-tint text-deep-plum rounded-full px-2 py-0.5"
        >
          {it}
        </span>
      ))}
    </div>
  )
}

function UrlLink({ url }: { url: string }) {
  const href = url.startsWith('http') ? url : `https://${url}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-primary-purple underline hover:text-deep-plum"
    >
      {url}
      <ExternalLink size={11} className="shrink-0" />
    </a>
  )
}

function ScaleRow({ label, value, max }: { label: string; value: number | null; max: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-deep-plum">{label}</span>
      <ScaleValue value={value} max={max} />
    </div>
  )
}

function ScaleValue({ value, max }: { value: number | null; max: number }) {
  if (value == null) return <Empty />
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value
        return (
          <span
            key={i}
            className={`h-2 w-2 rounded-full ${filled ? 'bg-primary-purple' : 'bg-lavender'}`}
          />
        )
      })}
      <span className="ml-1.5 text-[11px] font-semibold text-purple-gray">
        {value}/{max}
      </span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
