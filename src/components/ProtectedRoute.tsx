import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const { user, isLoading } = useAuth()

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
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
