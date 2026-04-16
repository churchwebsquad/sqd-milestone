import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Send, FileText, LayoutDashboard, User, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const NAV_LINKS = [
  { to: '/', label: 'My Dashboard', icon: User, end: true },
  { to: '/submit', label: 'Submit Milestone', icon: Send, end: false },
  { to: '/dashboard', label: 'Partner Dashboard', icon: LayoutDashboard, end: false },
  { to: '/templates', label: 'Template Editor', icon: FileText, end: false },
]

export default function AppLayout() {
  const { staffProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const displayName =
    staffProfile?.full_name ??
    staffProfile?.name ??
    staffProfile?.email ??
    'Staff'

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
          {/* Close button — mobile only */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-white/60 hover:text-white"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4">
          {NAV_LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 py-2.5 text-sm font-medium transition-colors',
                  'border-l-[3px]',
                  isActive
                    ? 'bg-lavender-tint text-primary-purple border-primary-purple pl-[21px] pr-4'
                    : 'text-white/80 hover:bg-white/10 hover:text-white border-transparent pl-[21px] pr-4',
                ].join(' ')
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
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
