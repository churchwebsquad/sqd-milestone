import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types/database'

const ALLOWED_DOMAIN = 'churchmediasquad.com'

function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.toLowerCase().split('@')[1] === ALLOWED_DOMAIN
}

interface AuthContextValue {
  user: User | null
  staffProfile: Employee | null
  isAdmin: boolean
  isLoading: boolean
  authError: string | null
  clearAuthError: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchStaffProfile(email: string): Promise<Employee | null> {
  const normalizedEmail = email.toLowerCase().trim()
  // Tolerate duplicate rows on the same email (HR sync occasionally
  // leaves both a legal-name + preferred-name row, or a current row
  // alongside a "No Longer Employed" historical row). .maybeSingle()
  // errors on 2+ matches with a 406 and the user ends up seeing
  // "wasn't found in the staff directory."
  //
  // Fetch all matches, then pick:
  //   1. Active / Full-time row wins over NULL status
  //   2. NULL status wins over "No Longer Employed"
  //   3. Tiebreak: most recently updated
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .ilike('email', normalizedEmail)
  if (error) {
    console.error('[fetchStaffProfile] employees query error:', error)
    throw error
  }
  const rows = (data ?? []) as Employee[]
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]
  const statusRank = (s: unknown): number => {
    if (typeof s !== 'string') return 1
    const t = s.toLowerCase()
    if (t.includes('no longer')) return 2
    return 0  // Full-time / Active / anything else with content
  }
  const sorted = [...rows].sort((a, b) => {
    const sa = statusRank((a as { status?: unknown }).status)
    const sb = statusRank((b as { status?: unknown }).status)
    if (sa !== sb) return sa - sb
    const aUpd = (a as { updated_at?: string }).updated_at ?? ''
    const bUpd = (b as { updated_at?: string }).updated_at ?? ''
    return bUpd.localeCompare(aUpd)
  })
  return sorted[0]
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [staffProfile, setStaffProfile] = useState<Employee | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const email = session.user.email ?? ''

          // ── Domain check ─────────────────────────────────────────────────
          if (!isAllowedEmail(email)) {
            await supabase.auth.signOut()
            setAuthError(
              `This app is restricted to Church Media Squad staff. ` +
              `Sign in with your @${ALLOWED_DOMAIN} account.`
            )
            setUser(null)
            setStaffProfile(null)
            setIsLoading(false)
            return
          }

          // ── Valid domain — unblock the app immediately, fetch profile async ─
          setAuthError(null)
          setUser(session.user)
          setIsLoading(false)   // don't hold the load screen for the DB query

          fetchStaffProfile(email)
            .then(profile => {
              if (!profile) {
                // Authenticated but not in employees — sign them out and surface
                // an error. They'll briefly see the app before being redirected;
                // that's acceptable vs hanging on the load screen indefinitely.
                supabase.auth.signOut()
                setAuthError(
                  `Your account (${email}) wasn't found in the staff directory. ` +
                  `Contact your account manager to get set up.`
                )
                setUser(null)
                setStaffProfile(null)
                return
              }
              setStaffProfile(profile)
            })
            .catch(err => {
              console.error('[AuthContext] staff profile fetch failed:', err)
              setStaffProfile(null)
            })
        } else {
          // Signed out or session expired
          setUser(null)
          setStaffProfile(null)
          setIsLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setStaffProfile(null)
  }

  const clearAuthError = () => setAuthError(null)

  // V1: all verified staff are admins
  const isAdmin = staffProfile !== null

  return (
    <AuthContext.Provider value={{ user, staffProfile, isAdmin, isLoading, authError, clearAuthError, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
