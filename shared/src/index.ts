// API payload types shared by client and server.
// Types only: this package has no build step and no runtime code, so consumers
// must use `import type { ... } from '@exquisite-chorus/shared'`.

/** Every API response body has this shape. */
export interface ApiEnvelope<T> {
  message: string
  data: T
}

export type { PublicUser, SignInRequest, SignUpRequest } from './auth.js'
