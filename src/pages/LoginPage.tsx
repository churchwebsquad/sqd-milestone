import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { user, staffProfile, isLoading, authError, clearAuthError } = useAuth()
  const navigate = useNavigate()
  const [signingIn, setSigningIn] = useState(false)

  // Redirect once AuthContext confirms the user is staff
  useEffect(() => {
    if (!isLoading && user && staffProfile) {
      navigate('/', { replace: true })
    }
  }, [user, staffProfile, isLoading, navigate])

  const handleGoogleSignIn = async () => {
    clearAuthError()
    setSigningIn(true)
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      })
      // Browser will redirect — no further action needed here
    } catch {
      setSigningIn(false)
    }
  }

  return (
    <div className="min-h-screen bg-hero-gradient flex flex-col items-center justify-center px-4">

      {/* Primary wordmark */}
      <img
        src="/brand/Style=Primary.svg"
        alt="Church Media Squad"
        className="h-10 w-auto brightness-0 invert mb-8"
      />

      {/* Login card */}
      <div className="w-full max-w-sm bg-white border border-lavender rounded-2xl shadow-lg px-8 py-8">
        <h1 className="text-xl font-semibold text-deep-plum mb-1 text-center">Milestone Communications Portal</h1>
        <p className="text-sm text-purple-gray mb-6 text-center">Staff login</p>

        {authError && (
          <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{authError}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={signingIn}
          className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 px-6 hover:bg-primary-purple transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {/* Google "G" mark */}
          {!signingIn && (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#fff"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
              />
              <path
                fill="rgba(255,255,255,0.75)"
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
              />
              <path
                fill="rgba(255,255,255,0.75)"
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
              />
              <path
                fill="rgba(255,255,255,0.75)"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
              />
            </svg>
          )}
          {signingIn
            ? 'Redirecting to Google…'
            : 'Sign in with Google'
          }
        </button>
      </div>

      <p className="mt-6 text-white/40 text-xs">Church Media Squad internal tool</p>
    </div>
  )
}
