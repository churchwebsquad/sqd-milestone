/**
 * Web Manager — Shell. The chrome wrapper that hosts every Content
 * Manager (and later Design/Dev/Reviewer) workspace.
 *
 * Layout:
 *   ┌── HEADER ────────────────────────────────────────────────────┐
 *   │  breadcrumb · project name · AI status · share / actions    │
 *   ├── TAB STRIP (sticky) ───────────────────────────────────────┤
 *   ├──────────────────────────────────┬──────────────────────────┤
 *   │  WORKSPACE                        │  ASSISTANT RAIL          │
 *   │  (active view)                    │  (collapsible)           │
 *   └──────────────────────────────────┴──────────────────────────┘
 *
 * The wm-theme class on the root wraps every descendant in the
 * Web Manager visual language (warm bg, near-black text, soft accent
 * tint). All Web Manager pages should mount this shell.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { WMIconButton } from './IconButton'
import { WMAIStatusBadge } from './AIStatusBadge'
import type { WMAIStatusBadgeProps } from './AIStatusBadge'
import { WMTabs } from './Tabs'
import type { WMTabItem } from './Tabs'

export interface WMShellProps<T extends string> {
  /** Project name displayed in the header */
  projectName: string
  /** Project id used for routing back / sub-routes */
  projectId: string

  /** Breadcrumb labels — earliest first, current last */
  breadcrumb?: Array<{ label: string; to?: string }>

  /** AI status indicator in the header — null hides it entirely */
  aiStatus?: WMAIStatusBadgeProps | null
  onClickAIStatus?: () => void

  /** Top-level tabs (workspace switcher) */
  tabs: readonly WMTabItem<T>[]
  activeTab: T
  onTabChange: (key: T) => void

  /** Right rail content. When `null`, rail is hidden. */
  rail?: ReactNode
  railOpen?: boolean
  onRailToggle?: (open: boolean) => void

  /** Optional header-right actions slot (Share button, etc.) */
  headerActions?: ReactNode

  /** Workspace content for the active tab */
  children: ReactNode
}

export function WebManagerShell<T extends string>({
  projectName, projectId,
  breadcrumb = [],
  aiStatus, onClickAIStatus,
  tabs, activeTab, onTabChange,
  rail, railOpen = true, onRailToggle,
  headerActions,
  children,
}: WMShellProps<T>) {
  const hasRail = rail !== undefined && rail !== null

  return (
    <div className="wm-theme min-h-full bg-wm-bg text-wm-text">
      {/* ── Header (sticky) ─────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-wm-bg-elevated border-b border-wm-border">
        <div className="px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex items-center gap-2 text-[12px] text-wm-text-muted">
            <Link to="/web" className="hover:text-wm-text transition-colors">Website Manager</Link>
            <ChevronRight size={11} className="opacity-50" />
            <Link to={`/web/${projectId}`} className="hover:text-wm-text transition-colors truncate max-w-[200px]">{projectName}</Link>
            {breadcrumb.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                <ChevronRight size={11} className="opacity-50" />
                {b.to
                  ? <Link to={b.to} className="hover:text-wm-text transition-colors truncate max-w-[160px]">{b.label}</Link>
                  : <span className="text-wm-text font-medium truncate max-w-[160px]">{b.label}</span>
                }
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {aiStatus && <WMAIStatusBadge {...aiStatus} onClick={onClickAIStatus} />}
            {headerActions}
            {hasRail && onRailToggle && (
              <WMIconButton
                label={railOpen ? 'Hide assistant' : 'Show assistant'}
                onClick={() => onRailToggle(!railOpen)}
              >
                {railOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </WMIconButton>
            )}
          </div>
        </div>

        {/* ── Tab strip ─────────────────────────────────────────── */}
        <div className="px-4 md:px-6">
          <WMTabs items={tabs} active={activeTab} onChange={onTabChange} />
        </div>
      </header>

      {/* ── Body: workspace + rail ─────────────────────────────── */}
      <div className="flex">
        <main className="flex-1 min-w-0">{children}</main>
        {hasRail && railOpen && (
          <aside
            className="w-[440px] shrink-0 border-l border-wm-border bg-wm-bg-elevated sticky self-start overflow-y-auto"
            style={{ top: 'var(--wm-header-h, 88px)', height: 'calc(100vh - var(--wm-header-h, 88px))' }}
          >
            {rail}
          </aside>
        )}
      </div>
    </div>
  )
}
