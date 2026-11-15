import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { errorMessage } from '../auth/errorMessage.ts'
import { useAuth } from '../auth/useAuth.ts'

/** The signed-in shell: header with the user's name and Sign out. */
export default function Layout() {
  const { user, signOut } = useAuth()
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    setError(null)
    try {
      await signOut()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <header className="app-header">
        <span className="app-name">Exquisite Chorus</span>
        <span className="user-name">{user?.displayName}</span>
        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </header>
      <Outlet />
    </>
  )
}
