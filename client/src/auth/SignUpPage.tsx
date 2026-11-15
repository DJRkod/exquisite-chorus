import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { errorMessage } from './errorMessage.ts'
import { returnTo, useAuth } from './useAuth.ts'

// Mirrors the server's limits (server/src/auth/routes.ts) so most mistakes are
// caught before a round trip; the server still decides.
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

export default function SignUpPage() {
  const { status, signUp } = useAuth()
  const location = useLocation()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading') return <p role="status">Loading…</p>
  if (status === 'signedIn') return <Navigate to={returnTo(location.state)} replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signUp({ displayName, email, password })
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="signup-name">Display name</label>
        <input
          id="signup-name"
          autoComplete="nickname"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          aria-describedby="signup-password-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p id="signup-password-hint" className="hint">
          At least {PASSWORD_MIN} characters.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          Create account
        </button>
      </form>
      <p>
        Already have an account?{' '}
        <Link to="/signin" state={location.state}>
          Sign in
        </Link>
      </p>
    </main>
  )
}
