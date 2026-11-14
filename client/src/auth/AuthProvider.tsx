// Holds the signed-in user. The server session cookie (KTD3) is the source of
// truth: on mount this asks /api/auth/me, and a 401 there just means signed out.
import type { PublicUser, SignInRequest, SignUpRequest } from '@exquisite-chorus/shared'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../api/client.ts'
import { AuthContext, type AuthState } from './useAuth.ts'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthState['status']; user: PublicUser | null }>({
    status: 'loading',
    user: null,
  })

  useEffect(() => {
    let current = true
    api.getMe().then(
      (user) => current && setState({ status: 'signedIn', user }),
      // 401 is the normal signed-out answer. Any other failure also leaves the
      // visitor signed out; the sign-in form then surfaces real server errors.
      () => current && setState({ status: 'signedOut', user: null }),
    )
    return () => {
      current = false
    }
  }, [])

  const signIn = useCallback(async (input: SignInRequest) => {
    const user = await api.signIn(input)
    setState({ status: 'signedIn', user })
  }, [])

  const signUp = useCallback(async (input: SignUpRequest) => {
    const user = await api.signUp(input)
    setState({ status: 'signedIn', user })
  }, [])

  const signOut = useCallback(async () => {
    await api.signOut()
    setState({ status: 'signedOut', user: null })
  }, [])

  const value = useMemo<AuthState>(
    () => ({ ...state, signIn, signUp, signOut }),
    [state, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
