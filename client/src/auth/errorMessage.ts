import { ApiError } from '../api/client.ts'

/** A message fit to show under a form. ApiError messages come from the server. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}
