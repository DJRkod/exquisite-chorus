import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { envelope, fakeApi, HEALTHY } from '../test/fakeApi.ts'
import WakeBanner from './WakeBanner.tsx'

const WAKING = /waking the server, this can take up to a minute/i
const FAILED = "The server didn't respond."

function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderGate(check?: () => Promise<unknown>) {
  return render(
    <WakeBanner check={check}>
      <p>App content</p>
    </WakeBanner>,
  )
}

describe('WakeBanner', () => {
  it('stays hidden when health answers within 3 seconds', async () => {
    vi.useFakeTimers()
    const health = deferred()
    renderGate(() => health.promise)

    await act(() => vi.advanceTimersByTimeAsync(2_900))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()

    await act(async () => health.resolve())
    await act(() => vi.advanceTimersByTimeAsync(5_000))

    expect(screen.queryByText(WAKING)).not.toBeInTheDocument()
    expect(screen.getByText('App content')).toBeInTheDocument()
  })

  it('shows the waking message after 3 seconds without an answer, then the app', async () => {
    vi.useFakeTimers()
    const health = deferred()
    renderGate(() => health.promise)

    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(screen.getByRole('status')).toHaveTextContent(WAKING)
    expect(screen.queryByText('App content')).not.toBeInTheDocument()

    await act(async () => health.resolve())

    expect(screen.queryByText(WAKING)).not.toBeInTheDocument()
    expect(screen.getByText('App content')).toBeInTheDocument()
  })

  it('reports a failure after the 90 second health timeout and recovers on Retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // The real health call: the first request never answers, the retry does.
    const { fetch, routes } = fakeApi({ 'GET /api/health': () => new Promise(() => {}) })
    renderGate()

    await act(() => vi.advanceTimersByTimeAsync(90_000))

    expect(screen.getByRole('status')).toHaveTextContent(FAILED)
    expect(screen.queryByText(WAKING)).not.toBeInTheDocument()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()

    routes['GET /api/health'] = HEALTHY
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('App content')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reports a failure on a 5xx answer and recovers on Retry', async () => {
    const { routes } = fakeApi({ 'GET /api/health': envelope(503, 'Service unavailable') })
    renderGate()

    expect(await screen.findByText(FAILED)).toBeInTheDocument()

    routes['GET /api/health'] = HEALTHY
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('App content')).toBeInTheDocument()
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument()
  })
})
