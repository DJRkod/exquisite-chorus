import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envelope, type Reply, type Routes } from '../test/fakeApi.ts'
import { domError, FakeAudioContext, FakeMediaRecorder, FakeXHR, installMedia } from '../test/fakeMedia.ts'
import { renderApp } from '../test/renderApp.tsx'
import { RECORDING_FAILED } from './recorder.ts'

const ADA = { id: 'u1', email: 'ada@example.com', displayName: 'Ada Lovelace' }
const S3 = 'https://bucket.s3.example.com/'
const FIELDS = { key: 'pending/u1/abc', 'Content-Type': 'audio/mpeg', Policy: 'p', 'X-Amz-Signature': 's' }

function rec(id: string, owner: string, durationMs: number | null, createdAt: string) {
  return {
    id,
    ownerId: `owner-${id}`,
    ownerDisplayName: owner,
    status: 'ready',
    contentType: 'audio/webm',
    size: 100,
    durationMs,
    createdAt,
  }
}
const GRACE = rec('g1', 'Grace Hopper', 65_000, '2026-11-13T12:00:00.000Z')
const ALAN = rec('a1', 'Alan Turing', null, '2026-11-12T12:00:00.000Z')

function page(routes: Routes = {}, list: unknown[] = [GRACE, ALAN]) {
  return renderApp('/', {
    'GET /api/auth/me': envelope(200, 'OK', ADA),
    'GET /api/recordings': envelope(200, 'OK', list),
    'GET /api/recordings/g1/playback-url': envelope(200, 'OK', { url: 'https://s3/g1', expiresAt: 'x' }),
    'GET /api/recordings/a1/playback-url': envelope(200, 'OK', { url: 'https://s3/a1', expiresAt: 'x' }),
    'GET https://s3/g1': { status: 200, body: 'bytes' },
    'GET https://s3/a1': { status: 200, body: 'bytes' },
    ...routes,
  })
}

const presigned = (contentType = 'audio/mpeg') =>
  envelope(201, 'Upload URL created', { recordingId: 'new1', url: S3, fields: { ...FIELDS, 'Content-Type': contentType } })
const confirmed = (contentType = 'audio/mpeg') =>
  envelope(200, 'OK', { ...rec('new1', '', 3200, '2026-11-14T12:00:00.000Z'), ownerId: 'u1', contentType, ownerDisplayName: undefined })

const mp3 = () => new File(['mp3-bytes'], 'song.mp3', { type: 'audio/mpeg' })
const rows = () => within(screen.getByRole('list', { name: 'Recordings' })).getAllByRole('listitem')
const rowFor = (name: string) => rows().find((row) => within(row).queryByText(name))!
/** Lets pending promises, fake fetches, and React updates run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

/** A route that answers only when released. */
function held(reply: Reply) {
  let release: () => void = () => {}
  const route = () => new Promise<Reply>((resolve) => (release = () => resolve(reply)))
  return { route, release: () => release() }
}

const calls = (fetch: ReturnType<typeof renderApp>['fetch'], key: string) =>
  fetch.mock.calls.filter(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}` === key)

let media: ReturnType<typeof installMedia>
beforeEach(() => {
  media = installMedia({ durationSeconds: 3.2 })
})
afterEach(() => media.restore())

describe('RecordingsPage list', () => {
  it('shows an empty state when there are no recordings', async () => {
    page({}, [])
    expect(await screen.findByText('No recordings yet — record or pick a file to start.')).toBeInTheDocument()
  })

  it('lists owner, duration, and date, and fetches no playback URLs on load', async () => {
    const { fetch } = page()
    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
    expect(within(rowFor('Grace Hopper')).getByText('1:05')).toBeInTheDocument()
    expect(within(rowFor('Alan Turing')).getByText('—')).toBeInTheDocument()
    expect(fetch.mock.calls.some(([input]) => String(input).includes('playback-url'))).toBe(false)
  })

  it('enables Play together only with two or more selected', async () => {
    page()
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    const together = screen.getByRole('button', { name: 'Play together' })
    expect(together).toBeDisabled()

    await user.click(within(rowFor('Grace Hopper')).getByRole('checkbox'))
    expect(together).toBeDisabled()
    await user.click(within(rowFor('Alan Turing')).getByRole('checkbox'))
    expect(together).toBeEnabled()
  })
})

describe('RecordingsPage capture and upload', () => {
  it('shows the permission message and keeps the file picker when the mic is blocked', async () => {
    media.getUserMedia.mockRejectedValueOnce(domError('NotAllowedError'))
    page()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Record' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Microphone access was blocked. Allow it in your browser, or pick a file instead.',
    )
    expect(screen.getByLabelText('Pick an audio file')).toBeInTheDocument()
  })

  it('uploads a picked file with fields before the file, confirms with its duration, and lists it first', async () => {
    const { fetch } = page({
      'POST /api/recordings': presigned(),
      'POST /api/recordings/new1/confirm': confirmed(),
    })
    const user = userEvent.setup()

    await user.upload(await screen.findByLabelText('Pick an audio file'), mp3())
    expect(await screen.findByLabelText('Preview')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(within(rows()[0]).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(rows()[0]).getByText('0:03')).toBeInTheDocument()

    const xhr = FakeXHR.instances[0]
    expect(xhr.url).toBe(S3)
    expect([...xhr.body!.keys()]).toEqual([...Object.keys(FIELDS), 'file'])
    expect((xhr.body!.get('file') as File).type).toBe('audio/mpeg')
    expect(JSON.parse(String(calls(fetch, 'POST /api/recordings')[0][1]?.body))).toEqual({
      contentType: 'audio/mpeg',
      size: 9,
    })
    expect(JSON.parse(String(calls(fetch, 'POST /api/recordings/new1/confirm')[0][1]?.body))).toEqual({
      durationMs: 3200,
    })
    // Back to idle.
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Preview')).not.toBeInTheDocument()
  })

  it('records from the mic and uploads with the recorder’s actual MIME type', async () => {
    FakeMediaRecorder.actualMimeType = 'audio/webm;codecs=opus'
    const { fetch } = page({
      'POST /api/recordings': presigned('audio/webm;codecs=opus'),
      'POST /api/recordings/new1/confirm': confirmed('audio/webm;codecs=opus'),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Record' }))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(media.track.stop).toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(rows()).toHaveLength(3))
    const body = JSON.parse(String(calls(fetch, 'POST /api/recordings')[0][1]?.body)) as { contentType: string }
    expect(body.contentType).toBe('audio/webm;codecs=opus')
    expect((FakeXHR.instances[0].body!.get('file') as File).type).toBe('audio/webm;codecs=opus')
  })

  it('releases the mic when the page unmounts while permission is pending', async () => {
    let grant: () => void = () => {}
    media.getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((resolve) => (grant = () => resolve(media.stream))),
    )
    const { unmount } = page()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record' }))
    expect(media.getUserMedia).toHaveBeenCalled()

    unmount()
    grant()

    await waitFor(() => expect(media.track.stop).toHaveBeenCalled())
  })

  it('shows the recording-failed notice and returns to idle when the recorder errors', async () => {
    page()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Record' }))
    const stop = await screen.findByRole('button', { name: 'Stop' })

    act(() => FakeMediaRecorder.instances[0].fail())
    await user.click(stop)

    expect(await screen.findByRole('alert')).toHaveTextContent(RECORDING_FAILED)
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled()
    expect(screen.queryByText('Preparing the take…')).not.toBeInTheDocument()
  })

  it.each([
    ['a 25 MB file', () => Object.defineProperty(mp3(), 'size', { value: 25 * 1024 * 1024 }), /over 20 MB/],
    ['a video file', () => new File(['v'], 'clip.mp4', { type: 'video/mp4' }), /audio file/],
  ])('rejects %s client-side with no API call', async (_name, makeFile, message) => {
    const { fetch } = page()
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(await screen.findByLabelText('Pick an audio file'), makeFile())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('surfaces an S3 failure and Retry presigns and uploads again', async () => {
    FakeXHR.statuses = [403, 204]
    const { fetch } = page({
      'POST /api/recordings': presigned(),
      'POST /api/recordings/new1/confirm': confirmed(),
    })
    const user = userEvent.setup()

    await user.upload(await screen.findByLabelText('Pick an audio file'), mp3())
    await user.click(await screen.findByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/upload failed/i)
    expect(calls(fetch, 'POST /api/recordings/new1/confirm')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(calls(fetch, 'POST /api/recordings')).toHaveLength(2)
    expect(FakeXHR.instances).toHaveLength(2)
  })

  it('shows the upload error with Retry when the S3 upload times out', async () => {
    FakeXHR.statuses = [-1, 204]
    page({
      'POST /api/recordings': presigned(),
      'POST /api/recordings/new1/confirm': confirmed(),
    })
    const user = userEvent.setup()

    await user.upload(await screen.findByLabelText('Pick an audio file'), mp3())
    await user.click(await screen.findByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/upload failed/i)
    expect(FakeXHR.instances[0].timeout).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(rows()).toHaveLength(3))
  })

  it('asks to sign in again when presigning answers 401, then presigns and uploads', async () => {
    let presigns = 0
    const presign = (): Reply => (++presigns === 1 ? envelope(401, 'Not signed in') : presigned())
    const { fetch } = page({
      'POST /api/recordings': presign,
      'POST /api/recordings/new1/confirm': confirmed(),
      'POST /api/auth/login': envelope(200, 'Signed in', ADA),
    })
    const user = userEvent.setup()

    await user.upload(await screen.findByLabelText('Pick an audio file'), mp3())
    await user.click(await screen.findByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session expired — sign in again to finish saving')
    expect(FakeXHR.instances).toHaveLength(0)
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Sign in and save' }))

    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(presigns).toBe(2)
    expect(FakeXHR.instances).toHaveLength(1)
    expect(calls(fetch, 'POST /api/recordings/new1/confirm')).toHaveLength(1)
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/)
  })

  it('keeps the upload pending on a confirm 401 and re-confirms after signing in again', async () => {
    let confirms = 0
    const confirm = (): Reply => (++confirms === 1 ? envelope(401, 'Not signed in') : confirmed())
    const { fetch } = page({
      'POST /api/recordings': presigned(),
      'POST /api/recordings/new1/confirm': confirm,
      'POST /api/auth/login': envelope(200, 'Signed in', ADA),
    })
    const user = userEvent.setup()

    await user.upload(await screen.findByLabelText('Pick an audio file'), mp3())
    await user.click(await screen.findByRole('button', { name: 'Upload' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session expired — sign in again to finish saving')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Sign in and save' }))

    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(confirms).toBe(2)
    expect(calls(fetch, 'POST /api/recordings')).toHaveLength(1)
    expect(FakeXHR.instances).toHaveLength(1)
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/)
  })
})

describe('RecordingsPage playback', () => {
  it('refetches the playback URL once when the media errors', async () => {
    let first = true
    media.play.mockImplementation(function (this: HTMLMediaElement) {
      // The Safari unlock plays a silent blob: clip first; it always succeeds.
      if (this.src.startsWith('blob:')) return Promise.resolve()
      if (first) {
        first = false
        queueMicrotask(() => this.dispatchEvent(new Event('error')))
        return new Promise<void>(() => {})
      }
      return Promise.resolve()
    })
    const { fetch } = page()
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')

    await user.click(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Play/ }))

    expect(await within(rowFor('Grace Hopper')).findByRole('button', { name: /^Stop/ })).toBeInTheDocument()
    expect(calls(fetch, 'GET /api/recordings/g1/playback-url')).toHaveLength(2)
    expect(media.play).toHaveBeenCalledTimes(3) // silent unlock + two real attempts
  })

  it('plays only the latest row when Play on row B supersedes row A’s pending URL', async () => {
    const played: string[] = []
    media.play.mockImplementation(function (this: HTMLMediaElement) {
      played.push(this.src)
      return Promise.resolve()
    })
    const grace = held(envelope(200, 'OK', { url: 'https://s3/g1', expiresAt: 'x' }))
    page({ 'GET /api/recordings/g1/playback-url': grace.route })
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    const audio = document.querySelector('audio[hidden]') as HTMLAudioElement

    await user.click(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Play/ }))
    await user.click(within(rowFor('Alan Turing')).getByRole('button', { name: /^Play/ }))
    expect(await within(rowFor('Alan Turing')).findByRole('button', { name: /^Stop/ })).toBeInTheDocument()

    grace.release()
    await settle()

    expect(audio.src).toBe('https://s3/a1')
    expect(played).not.toContain('https://s3/g1')
    expect(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Play/ })).toBeEnabled()
    expect(within(rowFor('Alan Turing')).getByRole('button', { name: /^Stop/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('starts no group when a row Play interrupts a Play together load', async () => {
    const alanBytes = held({ status: 200, body: 'bytes' })
    page({ 'GET https://s3/a1': alanBytes.route })
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    await user.click(within(rowFor('Grace Hopper')).getByRole('checkbox'))
    await user.click(within(rowFor('Alan Turing')).getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: 'Play together' }))
    expect(await screen.findByText('Loading recordings to play together…')).toBeInTheDocument()
    await user.click(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Play/ }))
    alanBytes.release()
    await settle()

    expect(FakeAudioContext.instances[0].sources).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Play together' })).toBeEnabled()
    expect(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Stop/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores the silent unlock clip ending while the URL is pending, then shows Stop', async () => {
    const grace = held(envelope(200, 'OK', { url: 'https://s3/g1', expiresAt: 'x' }))
    page({ 'GET /api/recordings/g1/playback-url': grace.route })
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    const audio = document.querySelector('audio[hidden]') as HTMLAudioElement

    await user.click(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Play/ }))
    expect(audio.src).toMatch(/^blob:/)
    act(() => {
      audio.dispatchEvent(new Event('ended'))
    })
    expect(within(rowFor('Grace Hopper')).getByRole('button', { name: /^Loading/ })).toBeDisabled()

    grace.release()
    expect(await within(rowFor('Grace Hopper')).findByRole('button', { name: /^Stop/ })).toBeInTheDocument()
  })

  it('plays two selected recordings starting together, then stops them', async () => {
    page()
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    await user.click(within(rowFor('Grace Hopper')).getByRole('checkbox'))
    await user.click(within(rowFor('Alan Turing')).getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: 'Play together' }))

    const stop = await screen.findByRole('button', { name: 'Stop playing together' })
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.sources.map((s) => s.start.mock.calls[0][0])).toEqual([5.1, 5.1])

    await user.click(stop)
    for (const source of ctx.sources) expect(source.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Play together' })).toBeInTheDocument()
  })

  it('aborts Play together and names the recording that failed', async () => {
    page({ 'GET https://s3/a1': { status: 403, body: 'denied' } })
    const user = userEvent.setup()
    await screen.findByText('Grace Hopper')
    await user.click(within(rowFor('Grace Hopper')).getByRole('checkbox'))
    await user.click(within(rowFor('Alan Turing')).getByRole('checkbox'))

    await user.click(screen.getByRole('button', { name: 'Play together' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Alan Turing/)
    expect(FakeAudioContext.instances[0].sources).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Play together' })).toBeEnabled()
  })
})
