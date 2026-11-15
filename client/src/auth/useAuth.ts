import type { PublicUser, SignInRequest, SignUpRequest } from '@exquisite-chorus/shared'
import { createContext, useContext } from 'react'

export interface AuthState {
  status: 'loading' | 'signedIn' | 'signedOut'
  user: PublicUser | null
  /** Each rejects with an ApiError carrying the server's message. */
  signIn: (input: SignInRequest) => Promise<void>
  signUp: (input: SignUpRequest) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}

/** Where RequireAuth was headed when it sent the visitor to sign in. */
export interface FromState {
  from?: { pathname: string; search: string; hash: string }
}

/** The route to return to after signing in or up. */
export function returnTo(state: unknown): string {
  const from = (state as FromState | null)?.from
  return from ? `${from.pathname}${from.search}${from.hash}` : '/'
}
