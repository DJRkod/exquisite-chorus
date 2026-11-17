// Auth request and response shapes for /api/auth/*.
import type { Skill } from './vocabulary.js'

/** A user as the API returns it. Never carries the password hash. */
export interface PublicUser {
  id: string
  email: string
  displayName: string
  /** What the user plays or does, from the shared vocabulary. */
  skills: Skill[]
}

/** POST /api/auth/signup body. Skills are picked on the sign-up form. */
export interface SignUpRequest {
  email: string
  password: string
  displayName: string
  skills?: Skill[]
}

/** POST /api/auth/login body. */
export interface SignInRequest {
  email: string
  password: string
}
