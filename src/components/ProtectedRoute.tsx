import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-lavender border-t-primary-purple" />
      </div>
    )
  }

  // Require a valid Supabase session. Domain check in AuthContext already
  // enforces @churchmediasquad.com. staffProfile may be null if the
  // clickup_users RLS hasn't been configured yet — don't block on that.
  //
  // Pass the originally-requested URL so LoginPage can return the user
  // there after they sign in (preserves the deep link they were trying
  // to reach — review links, project URLs, etc.). The `state.from`
  // shape is the React Router convention; LoginPage also reads `?next=`
  // as a fallback for OAuth round-trips that don't preserve state.
  if (!user) {
    const next = `${location.pathname}${location.search}${location.hash}`
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(next)}`}
        state={{ from: location }}
        replace
      />
    )
  }

  return <>{children}</>
}
