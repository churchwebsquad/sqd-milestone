import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ExternalLink, Wrench, FileText, ArrowUpRight } from 'lucide-react'

// ── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  /** Right-side action (button, link, etc.) */
  action?: ReactNode
  /** Color theme — informational (default), brand, web, social, tasks */
  theme?: 'default' | 'brand' | 'web' | 'social' | 'tasks' | 'intel'
}

const THEME_STYLES: Record<NonNullable<SectionHeaderProps['theme']>, { bg: string; fg: string }> = {
  default: { bg: 'bg-lavender-tint', fg: 'text-primary-purple' },
  brand:   { bg: 'bg-primary-purple/10', fg: 'text-primary-purple' },
  web:     { bg: 'bg-blue-100', fg: 'text-blue-700' },
  social:  { bg: 'bg-pink-100', fg: 'text-pink-700' },
  tasks:   { bg: 'bg-green-100', fg: 'text-green-700' },
  intel:   { bg: 'bg-amber-100', fg: 'text-amber-700' },
}

export function SectionHeader({ icon: Icon, title, action, theme = 'default' }: SectionHeaderProps) {
  const t = THEME_STYLES[theme]
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <div className="flex items-center gap-2.5">
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${t.bg}`}>
          <Icon size={14} className={t.fg} />
        </div>
        <h2 className="text-sm font-bold text-deep-plum uppercase tracking-wider">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// ── SubSectionLabel ──────────────────────────────────────────────────────────

interface SubSectionLabelProps {
  label: string
  icon?: LucideIcon
  variant?: 'default' | 'tools' | 'docs' | 'action'
}

const SUBSECTION_VARIANTS = {
  default: 'text-purple-gray',
  tools:   'text-amber-700',
  docs:    'text-purple-gray',
  action:  'text-primary-purple',
}

export function SubSectionLabel({ label, icon: Icon, variant = 'default' }: SubSectionLabelProps) {
  return (
    <div className={`flex items-center gap-1.5 mb-2 ${SUBSECTION_VARIANTS[variant]}`}>
      {Icon && <Icon size={11} />}
      <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
    </div>
  )
}

// ── ToolLink — external third-party apps (Vista Social, ContentSnare, etc.) ──

export function ToolLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 text-xs text-amber-900 font-medium px-3 py-1.5 hover:bg-amber-100 hover:border-amber-400 transition-colors"
    >
      <Wrench size={10} className="shrink-0 text-amber-700" />
      {label}
      <ExternalLink size={9} className="shrink-0 text-amber-600" />
    </a>
  )
}

// ── DocLink — documents, assets, static files (discovery, strategy brief, etc.) ──

interface DocLinkProps {
  label: string
  url: string
  icon?: LucideIcon
}

export function DocLink({ label, url, icon: Icon = FileText }: DocLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-lavender bg-white text-xs text-deep-plum px-3 py-1.5 hover:bg-lavender-tint transition-colors"
    >
      <Icon size={10} className="shrink-0 text-purple-gray" />
      {label}
    </a>
  )
}

// ── AppLink — internal app navigation / primary actions ──────────────────────

interface AppLinkProps {
  label: string
  onClick?: () => void
  url?: string
  icon?: LucideIcon
  variant?: 'primary' | 'ghost'
}

export function AppLink({ label, onClick, url, icon: Icon, variant = 'primary' }: AppLinkProps) {
  const baseCls = variant === 'primary'
    ? 'bg-primary-purple/10 border border-primary-purple/20 text-primary-purple hover:bg-primary-purple/20'
    : 'border border-lavender bg-white text-deep-plum hover:bg-lavender-tint'
  const cls = `inline-flex items-center gap-1.5 rounded-full text-xs font-semibold px-3 py-1.5 transition-colors ${baseCls}`

  if (url) {
    return (
      <a href={url} className={cls}>
        {Icon && <Icon size={10} className="shrink-0" />}
        {label}
        <ArrowUpRight size={10} className="shrink-0" />
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {Icon && <Icon size={10} className="shrink-0" />}
      {label}
      <ArrowUpRight size={10} className="shrink-0" />
    </button>
  )
}

// ── InfoCard — quiet container for grouped data fields ──────────────────────

export function InfoCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-lavender/60 bg-lavender-tint/20 px-4 py-3 ${className}`}>
      {children}
    </div>
  )
}
