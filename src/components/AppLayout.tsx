import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  Send, FileText, LayoutDashboard, User, LogOut, Menu, X,
  Building2, Sparkles, Search, CalendarDays, Palette,
  ChevronDown, Target, Library,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useCollapsibleGroups } from '../hooks/useCollapsibleGroups'

// ── Nav data types ────────────────────────────────────────────────────────

interface NavItem { kind: 'item'; to: string; label: string; icon: LucideIcon; end: boolean }
interface NavSubheading { kind: 'subheading'; label: string }
type GroupChild = NavItem | NavSubheading
interface NavGroup { kind: 'group'; heading: string; collapsible: boolean; items: GroupChild[] }
type NavEntry = NavGroup

// All top-level entries are groups — the app now uses altitude-based
// grouping (Personal / Execution / Tools / Strategy) as its navigation
// mental model. Top-level standalone items aren't used.
const NAV_STRUCTURE: NavEntry[] = [
  {
    kind: 'group',
    heading: 'Personal',
    collapsible: false, // always expanded
    items: [
      { kind: 'item', to: '/',         label: 'My Dashboard',        icon: User,      end: true },
      { kind: 'item', to: '/churches', label: 'Churches Dashboard',  icon: Building2, end: false },
    ],
  },
  {
    kind: 'group',
    heading: 'All In Journey Milestones',
    collapsible: true,
    items: [
      // Pathway Viewer used to be a top-level entry. It's now a view mode
      // on Churches Dashboard (Table / Pathway toggle); the standalone
      // route still exists but isn't listed in the nav.
      { kind: 'item', to: '/submit',    label: 'Submit Milestone',      icon: Send,             end: false },
      { kind: 'item', to: '/dashboard', label: 'Milestone Submissions', icon: LayoutDashboard,  end: false },
      { kind: 'item', to: '/templates', label: 'Template Editor',       icon: FileText,         end: false },
    ],
  },
  {
    kind: 'group',
    heading: 'Tools',
    collapsible: true,
    items: [
      { kind: 'item', to: '/branding', label: 'Brand Handoffs', icon: Palette, end: false },
      { kind: 'subheading', label: 'Social' },
      // Prompt Settings used to be a sibling — it's now nested under the
      // SRP Generator (the only tool that consumes it).
      { kind: 'item', to: '/social/srp',     label: 'SRP Generator',      icon: Sparkles,     end: false },
      { kind: 'item', to: '/social/intel',   label: 'Intel Audit Tool',   icon: Search,       end: false },
      { kind: 'item', to: '/social/planner', label: 'Planning Calendar',  icon: CalendarDays, end: false },
    ],
  },
  {
    kind: 'group',
    heading: 'Strategy',
    collapsible: true,
    items: [
      // Roadmap + Progress are now tabs inside the Initiatives page.
      { kind: 'item', to: '/strategy/initiatives',  label: 'Initiatives',    icon: Target,   end: false },
      { kind: 'item', to: '/strategy/library',      label: 'Library',        icon: Library,  end: false },
    ],
  },
]

// ── Pieces ────────────────────────────────────────────────────────────────

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const { to, label, icon: Icon, end } = item
  /** "Active also on these prefixes" — used so Initiatives stays
   *  highlighted while the user is in Roadmap or Progress (now tabs of
   *  the same surface). */
  const ALSO_ACTIVE: Record<string, string[]> = {
    '/strategy/initiatives': ['/strategy/roadmap', '/strategy/progress'],
  }
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => {
        const path = window.location.pathname
        const alsoActive = (ALSO_ACTIVE[to] ?? []).some(p => path === p || path.startsWith(p + '/'))
        const active = isActive || alsoActive
        return [
          'flex items-center gap-3 py-2.5 text-sm font-medium transition-colors',
          'border-l-[3px]',
          active
            ? 'bg-lavender-tint text-primary-purple border-primary-purple pl-[21px] pr-4'
            : 'text-white/80 hover:bg-white/10 hover:text-white border-transparent pl-[21px] pr-4',
        ].join(' ')
      }}
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

function Subheading({ label }: { label: string }) {
  return (
    <p className="px-6 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
      {label}
    </p>
  )
}

/** Group heading — either a plain label (non-collapsible groups like
 *  Personal) or a button with a chevron that toggles collapse. */
function GroupHeading({ heading, collapsible, collapsed, onToggle }: {
  heading: string
  collapsible: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const label = (
    <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
      {heading}
    </span>
  )
  if (!collapsible) {
    return <div className="px-6 pb-1.5 pt-3">{label}</div>
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-6 pb-1.5 pt-3 hover:text-white group"
      aria-expanded={!collapsed}
    >
      {label}
      <ChevronDown
        size={12}
        className={`text-white/40 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      />
    </button>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const { staffProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { isCollapsed, toggle } = useCollapsibleGroups()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const displayName =
    staffProfile?.full_name ??
    staffProfile?.name ??
    staffProfile?.email ??
    'Staff'

  const closeMobile = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-deep-plum',
          'transition-transform duration-200 ease-in-out',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <img
            src="/brand/Style=Primary.svg"
            alt="Church Media Squad"
            className="h-7 w-auto brightness-0 invert"
          />
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-white/60 hover:text-white"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_STRUCTURE.map((group, idx) => {
            const collapsed = group.collapsible && isCollapsed(group.heading)
            return (
              <div key={group.heading} className={idx > 0 ? 'mt-1' : ''}>
                <GroupHeading
                  heading={group.heading}
                  collapsible={group.collapsible}
                  collapsed={collapsed}
                  onToggle={() => toggle(group.heading)}
                />
                {!collapsed && group.items.map(child =>
                  child.kind === 'subheading' ? (
                    <Subheading key={child.label} label={child.label} />
                  ) : (
                    <SidebarLink key={child.to} item={child} onNavigate={closeMobile} />
                  )
                )}
              </div>
            )
          })}
        </nav>

        {/* User + sign out */}
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-white/50 text-xs mb-0.5">Signed in as</p>
          <p className="text-white text-sm font-medium truncate">{displayName}</p>
          <button
            onClick={handleSignOut}
            className="mt-3 flex items-center gap-1.5 text-white/50 text-xs hover:text-white transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="flex items-center h-14 shrink-0 border-b border-lavender px-4 bg-deep-plum md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-white"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <img
            src="/brand/Style=Primary.svg"
            alt="Church Media Squad"
            className="h-6 w-auto brightness-0 invert ml-3"
          />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-cream">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
