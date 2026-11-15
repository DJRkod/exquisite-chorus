// Gates the app on /api/health. The free Render instance sleeps when idle
// (KTD2), so the first request can take up to a minute: after a short wait
// this says so, and if health never answers it offers a retry.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getHealth } from '../api/client.ts'

export const SLOW_AFTER_MS = 3_000

type Phase = 'checking' | 'slow' | 'failed' | 'ready'

interface Props {
  children: ReactNode
  /** The health check; defaults to GET /api/health with a 90 s timeout. */
  check?: () => Promise<unknown>
}

export default function WakeBanner({ children, check = getHealth }: Props) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const slow = setTimeout(() => {
      if (current) setPhase((p) => (p === 'checking' ? 'slow' : p))
    }, SLOW_AFTER_MS)
    check().then(
      () => current && setPhase('ready'),
      () => current && setPhase('failed'),
    )
    return () => {
      current = false
      clearTimeout(slow)
    }
    // Runs once per attempt; a new `check` identity alone must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = useCallback(() => {
    setPhase('checking')
    setAttempt((n) => n + 1)
  }, [])

  if (phase === 'ready') return <>{children}</>

  return (
    <div className="wake-banner" role="status">
      {phase === 'slow' && <p>Waking the server, this can take up to a minute…</p>}
      {phase === 'failed' && (
        <>
          <p>The server didn't respond.</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </>
      )}
    </div>
  )
}
