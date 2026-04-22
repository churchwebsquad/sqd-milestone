import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

type Step = 'email' | 'code'

const SUPABASE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export default function LoginPage() {
  const { user, staffProfile, isLoading, authError, clearAuthError } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)

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
      if (!res.ok) throw new Error(body?.error ?? 'Failed to send code')
      setStep('code')
      setResendCountdown(60)
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Something went wrong')
    } finally {
      setSending(false)
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
              disabled={sending || !email.trim()}
              className="w-full rounded-full bg-deep-plum text-white text-sm font-semibold py-3 px-6 hover:bg-primary-purple transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Sending code…
                </>
              ) : 'Send code via Slack →'}
            </button>
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
