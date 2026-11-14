// Auth request and response shapes for /api/auth/*.

/** A user as the API returns it. Never carries the password hash. */
export interface PublicUser {
  id: string
  email: string
  displayName: string
}

/** POST /api/auth/signup body. */
export interface SignUpRequest {
  email: string
  password: string
  displayName: string
}

/** POST /api/auth/login body. */
export interface SignInRequest {
  email: string
  password: string
}
