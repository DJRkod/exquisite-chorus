import { describe, expect, it, vi } from 'vitest'
import { FakeAudioContext } from '../test/fakeMedia.ts'
import { isUnlockClip, loadGroup, playTrack, START_DELAY_S, startGroup, TrackLoadError } from './playback.ts'

function fakeAudio(failures: number) {
  let left = failures
  const audio = new EventTarget() as EventTarget & { src: string; play: () => Promise<void> }
  audio.src = ''
  audio.play = vi.fn(async () => {
    // The Safari unlock plays a silent blob: clip first; it always succeeds.
    if (audio.src.startsWith('blob:')) return
    if (left > 0) {
      left -= 1
      queueMicrotask(() => audio.dispatchEvent(new Event('error')))
      // Like a browser, the play promise never resolves for a broken source.
      return new Promise<void>(() => {})
    }
  })
  return audio
}

describe('playTrack', () => {
  it('unlocks the element with a silent clip before awaiting the URL (Safari gesture rule)', async () => {
    const audio = fakeAudio(0)
    let release: (url: string) => void = () => {}
    const fetchUrl = vi.fn(() => new Promise<string>((resolve) => (release = resolve)))

    const playing = playTrack(audio as unknown as HTMLAudioElement, fetchUrl)

    // Synchronously, before the URL arrives: one play() on a blob: source.
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toMatch(/^blob:/)
    release('https://s3/x')
    await playing
    expect(audio.src).toBe('https://s3/x')
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('refetches the URL exactly once after a media error and plays again', async () => {
    const audio = fakeAudio(1)
    const fetchUrl = vi.fn().mockResolvedValueOnce('https://s3/old').mockResolvedValueOnce('https://s3/new')

    await playTrack(audio as unknown as HTMLAudioElement, fetchUrl)

    expect(fetchUrl).toHaveBeenCalledTimes(2)
    expect(audio.play).toHaveBeenCalledTimes(3) // silent unlock + two real attempts
    expect(audio.src).toBe('https://s3/new')
  })

  it('gives up after the one refresh fails too', async () => {
    const audio = fakeAudio(2)
    const fetchUrl = vi.fn().mockResolvedValue('https://s3/x')
    await expect(playTrack(audio as unknown as HTMLAudioElement, fetchUrl)).rejects.toThrow()
    expect(fetchUrl).toHaveBeenCalledTimes(2)
  })

  it('stops without touching the element or refreshing the URL when aborted while the URL is pending', async () => {
    const audio = fakeAudio(0)
    let release: (url: string) => void = () => {}
    const fetchUrl = vi.fn(() => new Promise<string>((resolve) => (release = resolve)))
    const controller = new AbortController()

    const playing = playTrack(audio as unknown as HTMLAudioElement, fetchUrl, controller.signal)
    const unlockSrc = audio.src
    controller.abort()
    release('https://s3/x')

    await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
    expect(audio.src).toBe(unlockSrc)
    expect(fetchUrl).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(1) // only the silent unlock
  })

  it('rethrows an AbortError from play() without refreshing the URL', async () => {
    const audio = fakeAudio(0)
    audio.play = vi.fn(async () => {
      if (audio.src.startsWith('blob:')) return
      throw new DOMException('interrupted by a new load request', 'AbortError')
    })
    const fetchUrl = vi.fn().mockResolvedValue('https://s3/x')

    await expect(playTrack(audio as unknown as HTMLAudioElement, fetchUrl)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchUrl).toHaveBeenCalledTimes(1)
  })

  it('reports when the element is playing the silent unlock clip', async () => {
    const audio = fakeAudio(0)
    let release: (url: string) => void = () => {}
    const playing = playTrack(audio as unknown as HTMLAudioElement, () => new Promise<string>((r) => (release = r)))
    expect(isUnlockClip(audio as unknown as HTMLAudioElement)).toBe(true)
    release('https://s3/x')
    await playing
    expect(isUnlockClip(audio as unknown as HTMLAudioElement)).toBe(false)
  })
})

describe('play together', () => {
  const tracks = [
    { id: 'a', label: 'Ada' },
    { id: 'b', label: 'Grace' },
  ]
  const okFetch = vi.fn(async () => new Response('bytes'))

  it('decodes both tracks and starts every source at the same time', async () => {
    const ctx = new FakeAudioContext()
    const buffers = await loadGroup(ctx as unknown as AudioContext, tracks, {
      fetchUrl: async (id) => `https://s3/${id}`,
      fetch: okFetch,
    })
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2)

    const group = startGroup(ctx as unknown as AudioContext, buffers)
    expect(ctx.sources).toHaveLength(2)
    const whens = ctx.sources.map((s) => s.start.mock.calls[0][0])
    expect(whens).toEqual([5 + START_DELAY_S, 5 + START_DELAY_S])
    expect(group.when).toBe(5 + START_DELAY_S)

    group.stop()
    for (const source of ctx.sources) expect(source.stop).toHaveBeenCalled()
  })

  it('fails the whole group after one URL refresh, naming the failed track', async () => {
    const ctx = new FakeAudioContext()
    const fetchUrl = vi.fn(async (id: string) => `https://s3/${id}`)
    const fetch = vi.fn(async (url: string) => (url.endsWith('/b') ? new Response('', { status: 403 }) : new Response('x')))

    const err = await loadGroup(ctx as unknown as AudioContext, tracks, { fetchUrl, fetch }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(TrackLoadError)
    expect((err as TrackLoadError).track).toEqual(tracks[1])
    expect(fetchUrl.mock.calls.filter(([id]) => id === 'b')).toHaveLength(2)
    expect(ctx.sources).toHaveLength(0)
  })

  it('stops fetching and decoding when the caller aborts, rejecting with an AbortError', async () => {
    const ctx = new FakeAudioContext()
    const controller = new AbortController()
    let release: (url: string) => void = () => {}
    const fetchUrl = vi.fn(() => new Promise<string>((resolve) => (release = resolve)))
    const fetch = vi.fn(async () => new Response('bytes'))

    const loading = loadGroup(ctx as unknown as AudioContext, tracks, { fetchUrl, fetch }, controller.signal)
    controller.abort()
    release('https://s3/late')

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(ctx.decodeAudioData).not.toHaveBeenCalled()
  })
})
