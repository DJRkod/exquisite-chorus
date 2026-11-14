import { ApiError } from '../api/client.ts'

export const GENERIC_ERROR = 'Something went wrong. Try again.'

/** A message fit to show under a form. ApiError messages come from the server. */
export function errorMessage(err: unknown, fallback = GENERIC_ERROR): string {
  return err instanceof ApiError ? err.message : fallback
}
