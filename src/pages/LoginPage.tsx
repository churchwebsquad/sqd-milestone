import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Step = 'email' | 'code'

const SUPABASE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ALLOWED_DOMAIN = 'churchmediasquad.com'

export default function LoginPage() {
  const { user, staffProfile, isLoading, authError, clearAuthError } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [googleSigningIn, setGoogleSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)

  // Show the Google sign-in button whenever the typed email belongs to
  // our domain. Mirrors the back-end gate: domain match OR employees-row
  // existence both qualify, but checking the domain client-side is
  // cheap and avoids a round-trip just to decide whether to show the
  // button. Staff with a non-company email still see the Slack path.
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  const canUseGoogle = domain === ALLOWED_DOMAIN

  // Redirect once AuthContext confirms the user is staff
  useEffect(() => {
    if (!isLoading && user && staffProfile) {
      navigate('/', { replace: true })
    }
  }, [user, staffProfile, isLoading, navigate])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCountdown <= 0) return
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCountdown])

  const handleSendCode = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!email.trim()) return
    clearAuthError()
    setError(null)
    setSending(true)
    try {
      const res = await fetch(`${SUPABASE_FN}/send-slack-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const body = await res.json()
      if (!res.ok) {
        // Edge function signals when the right path is Google OAuth
        // (no Slack ID, employee record missing but domain allowed,
        // etc.). Auto-route to Google instead of just showing the error.
        if (body?.use_google && canUseGoogle) {
          await handleGoogleSignIn()
          return
        }
        throw new Error(body?.error ?? 'Failed to send code')
      }
      setStep('code')
      setResendCountdown(60)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  const handleGoogleSignIn = async () => {
    clearAuthError()
    setError(null)
    setGoogleSigningIn(true)
    try {
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            // Hint the OAuth flow at the typed email so the user
            // doesn't have to pick from a Google account chooser
            // when they've already typed which account to use.
            login_hint: email.trim().toLowerCase(),
            prompt: 'select_account',
          },
        },
      })
      if (oauthErr) throw oauthErr
      // Browser is redirecting now — no need to clear `googleSigningIn`.
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Google sign-in failed')
      setGoogleSigningIn(false)
    }
  }

  const handleVerifyCode = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (code.length !== 6) return
    setError(null)
    setVerifying(true)
    try {
      const res = await fetch(`${SUPABASE_FN}/verify-slack-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Invalid or expired code')

      const { access_token, refresh_token } = body
      if (!access_token || !refresh_token) throw new Error('Invalid response from server')

      const { error: sessionErr } = await supabase.auth.setSession({ access_token, refresh_token })
      if (sessionErr) throw sessionErr
      // AuthContext picks up SIGNED_IN and redirects
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Verification failed')
      setVerifying(false)
    }
  }

  const displayError = error ?? authError

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
        <h1 className="text-xl font-semibold text-deep-plum mb-1 text-center">
          StrategyOS
        </h1>
        <p className="text-sm text-purple-gray mb-6 text-center">Staff login</p>

        {displayError && (
          <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{displayError}</p>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
                Work email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@churchmediasquad.com"
                autoComplete="email"
                required
                className="w-full rounded-xl border border-lavender bg-white px-4 py-2.5 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 transition"
              />
            </div>
            <button
              type="submit"
              disabled={sending || googleSigningIn || !email.trim()}
              className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 px-6 hover:bg-primary-purple transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Sending code…
                </>
              ) : 'Send code via Slack →'}
            </button>

            {/* Google sign-in fallback — visible whenever the typed
                email is a company-domain address. Staff whose Slack
                ID isn't configured, or whose employees row is mid-sync,
                can bypass the Slack path entirely. */}
            {canUseGoogle && (
              <>
                <div className="flex items-center gap-3 text-xs text-purple-gray">
                  <div className="h-px flex-1 bg-lavender" />
                  <span>or</span>
                  <div className="h-px flex-1 bg-lavender" />
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={sending || googleSigningIn || !email.trim()}
                  className="w-full rounded-full bg-white border border-lavender text-deep-plum text-sm font-semibold py-3 px-6 hover:bg-lavender-tint transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {googleSigningIn ? (
                    <>
                      <span className="h-4 w-4 rounded-full border-2 border-deep-plum/30 border-t-deep-plum animate-spin" />
                      Redirecting to Google…
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.183l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                        <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
                      </svg>
                      Sign in with Google
                    </>
                  )}
                </button>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="rounded-xl bg-lavender-tint/60 border border-lavender px-4 py-3 text-sm text-deep-plum">
              Code sent to <span className="font-semibold">{email}</span> via Slack DM.
            </div>
            <div>
              <label htmlFor="code" className="block text-xs font-semibold text-purple-gray uppercase tracking-wide mb-1.5">
                6-digit code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-xl border border-lavender bg-white px-4 py-2.5 text-sm text-deep-plum placeholder-purple-gray/50 outline-none focus:border-primary-purple focus:ring-2 focus:ring-primary-purple/20 transition tracking-widest text-center font-mono text-lg"
              />
            </div>
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 px-6 hover:bg-primary-purple transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {verifying ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Verifying…
                </>
              ) : 'Sign in →'}
            </button>
            <div className="flex items-center justify-between text-xs text-purple-gray">
              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError(null) }}
                className="hover:text-deep-plum transition-colors"
              >
                ← Wrong email
              </button>
              <button
                type="button"
                onClick={() => handleSendCode()}
                disabled={resendCountdown > 0 || sending}
                className="hover:text-deep-plum transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-6 text-white/40 text-xs">Church Media Squad internal tool</p>
    </div>
  )
}
