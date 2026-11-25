import { describe, expect, it, vi } from 'vitest'
import { envelope, fakeApi, sentBody } from '../test/fakeApi.ts'
import {
  ApiError,
  approveVersion,
  getHealth,
  getMe,
  getProject,
  listVersions,
  request,
  signIn,
  signOut,
  signUp,
  unapproveVersion,
} from './client.ts'

const USER = { id: 'u1', email: 'ada@example.com', displayName: 'Ada' }

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('request', () => {
  it('unwraps the envelope into data and sends JSON with same-origin credentials', async () => {
    const { fetch } = fakeApi({ 'POST /api/auth/login': envelope(200, 'Signed in', USER) })

    const user = await signIn({ email: 'ada@example.com', password: 'hunter22!' })

    expect(user).toEqual(USER)
    const [, init] = fetch.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(sentBody(fetch, 'POST /api/auth/login')).toEqual({
      email: 'ada@example.com',
      password: 'hunter22!',
    })
  })

  it('sends no body or Content-Type when there is no body', async () => {
    const { fetch } = fakeApi({ 'GET /api/auth/me': envelope(200, 'OK', USER) })

    await expect(getMe()).resolves.toEqual(USER)

    const [, init] = fetch.mock.calls[0]
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
    expect(init?.credentials).toBe('same-origin')
  })

  it('turns an error envelope into an ApiError with the status and server message', async () => {
    fakeApi({ 'POST /api/auth/login': envelope(401, 'Invalid email or password') })

    const err = await caught(signIn({ email: 'ada@example.com', password: 'wrong-pass' }))

    expect(err).toMatchObject({ status: 401, message: 'Invalid email or password', kind: 'http' })
  })

  it('falls back to a generic message when an error response is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))

    const err = await caught(getHealth())

    expect(err.status).toBe(502)
    expect(err.kind).toBe('http')
    expect(err.message).toMatch(/502/)
  })

  it('resolves 204 to undefined', async () => {
    fakeApi({ 'POST /api/auth/logout': { status: 204 } })

    await expect(signOut()).resolves.toBeUndefined()
  })

  it('turns a network failure into an ApiError of kind network', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    const err = await caught(getMe())

    expect(err).toMatchObject({ status: 0, kind: 'network' })
  })

  it('aborts after the timeout and reports a timeout kind', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const pending = caught(request('GET', '/api/auth/me', undefined, { timeoutMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1000)
    const err = await pending

    expect(err).toMatchObject({ status: 0, kind: 'timeout' })
  })

  it('gives health a 90 second timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          signal = init?.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const pending = caught(getHealth())
    await vi.advanceTimersByTimeAsync(89_000)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)

    expect((await pending).kind).toBe('timeout')
  })

  it('posts sign-up input to the signup route', async () => {
    const { fetch } = fakeApi({ 'POST /api/auth/signup': envelope(201, 'Account created', USER) })
    const input = { email: 'ada@example.com', password: 'hunter22!', displayName: 'Ada' }

    await expect(signUp(input)).resolves.toEqual(USER)
    expect(sentBody(fetch, 'POST /api/auth/signup')).toEqual(input)
  })
})

describe('projects', () => {
  it('encodes the project id in the path', async () => {
    const { fetch } = fakeApi({ 'GET /api/projects/a%2Fb': envelope(200, 'OK', { id: 'a/b' }) })

    await expect(getProject('a/b')).resolves.toEqual({ id: 'a/b' })
    expect(String(fetch.mock.calls[0][0])).toBe('/api/projects/a%2Fb')
  })

  it('lists versions from the contributions route', async () => {
    fakeApi({ 'GET /api/projects/p1/contributions': envelope(200, 'OK', [{ version: 1 }]) })

    await expect(listVersions('p1')).resolves.toEqual([{ version: 1 }])
  })

  it('approves with PUT and unapproves with DELETE on the version', async () => {
    const { fetch } = fakeApi({
      'PUT /api/projects/p1/contributions/3/approval': { status: 204 },
      'DELETE /api/projects/p1/contributions/3/approval': { status: 204 },
    })

    await approveVersion('p1', 3)
    await unapproveVersion('p1', 3)
    expect(fetch.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual([
      'PUT /api/projects/p1/contributions/3/approval',
      'DELETE /api/projects/p1/contributions/3/approval',
    ])
  })

  it('rejects an unknown project with a 404 ApiError', async () => {
    fakeApi({ 'GET /api/projects/nope': envelope(404, 'Project not found') })

    const err = await caught(getProject('nope'))
    expect(err.status).toBe(404)
  })
})
