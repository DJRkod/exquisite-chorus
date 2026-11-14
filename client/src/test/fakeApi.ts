import { vi } from 'vitest'

export interface Reply {
  status: number
  /** JSON body; omitted for 204. */
  body?: unknown
}

/** A reply, or a function of the request that returns one (or never settles). */
export type Route = Reply | ((init: RequestInit) => Reply | Promise<Reply>)

/** Keys look like 'GET /api/auth/me'. */
export type Routes = Record<string, Route>

export function envelope(status: number, message: string, data: unknown = null): Reply {
  return { status, body: { message, data } }
}

export const HEALTHY = envelope(200, 'OK', { db: 'connected' })
export const NOT_SIGNED_IN = envelope(401, 'Not signed in')

export function toResponse({ status, body }: Reply): Response {
  if (body === undefined) return new Response(null, { status })
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Replaces global fetch with a tiny fake API. Health answers 200 and /me
 * answers 401 unless overridden; unknown routes answer the server's 404.
 * Routes can be changed after install through the returned `routes` object.
 */
export function fakeApi(overrides: Routes = {}) {
  const routes: Routes = {
    'GET /api/health': HEALTHY,
    'GET /api/auth/me': NOT_SIGNED_IN,
    ...overrides,
  }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const key = `${init.method ?? 'GET'} ${url}`
    const route = routes[key] ?? envelope(404, 'Endpoint not found')
    const reply = typeof route === 'function' ? route(init) : route
    // Like real fetch, a pending request rejects when its signal aborts.
    const aborted = new Promise<never>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    return toResponse(await Promise.race([reply, aborted]))
  })
  return { fetch, routes }
}

/** The parsed JSON body of the first call to the given route. */
export function sentBody(fetch: ReturnType<typeof fakeApi>['fetch'], key: string): unknown {
  const call = fetch.mock.calls.find(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}` === key)
  if (!call) throw new Error(`No request to ${key}`)
  return JSON.parse(String(call[1]?.body))
}
