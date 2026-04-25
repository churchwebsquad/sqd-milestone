import { useCallback, useState } from 'react'

/**
 * Lightweight optimistic-save hook for Strategy mutations.
 *
 * Pattern (modeled on the triage save in MyDashboardPage):
 *   1. Caller passes a `mutate` function that hits the edge function and
 *      returns the canonical server-side entity.
 *   2. `run(args, optimistic)` flips `pending` to true, fires the call.
 *   3. On success, returns the server entity. On failure, exposes `error`
 *      and re-throws so the caller can revert local state if needed.
 *
 * Reverting is the caller's job, not the hook's — local state lives in the
 * page component, and only it knows what the prior value was. Keeping this
 * hook stateless about *what* changed avoids a generic-soup API.
 */
export function useStrategyMutate<TArgs extends unknown[], TResult>(
  mutate: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult>
  pending: boolean
  error: string | null
  clearError: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (...args: TArgs) => {
    setPending(true)
    setError(null)
    try {
      return await mutate(...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    } finally {
      setPending(false)
    }
  }, [mutate])

  const clearError = useCallback(() => setError(null), [])

  return { run, pending, error, clearError }
}
