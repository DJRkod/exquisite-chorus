import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, type FromState } from './useAuth.ts'

/** Renders children for a signed-in user; otherwise sends them to sign in. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <p role="status">Loading…</p>
  if (status === 'signedOut') {
    const state: FromState = {
      from: { pathname: location.pathname, search: location.search, hash: location.hash },
    }
    return <Navigate to="/signin" replace state={state} />
  }
  return <>{children}</>
}
