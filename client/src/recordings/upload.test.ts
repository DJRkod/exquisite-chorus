import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { envelope, fakeApi } from '../test/fakeApi.ts'
import { FakeXHR } from '../test/fakeMedia.ts'
import {
  checkAudioFile,
  MAX_UPLOAD_BYTES,
  measureDuration,
  NOT_AUDIO,
  postToS3,
  saveTake,
  SaveError,
  SESSION_EXPIRED,
  TOO_LARGE,
  UPLOAD_FAILED,
} from './upload.ts'

const XHR = FakeXHR as unknown as typeof XMLHttpRequest
const TARGET = {
  url: 'https://bucket.s3.example.com/',
  fields: { key: 'pending/u1/abc', 'Content-Type': 'audio/webm', Policy: 'p', 'X-Amz-Signature': 's' },
}
const READY = {
  id: 'r1',
  ownerId: 'u1',
  status: 'ready',
  contentType: 'audio/webm',
  size: 10,
  durationMs: 3200,
  createdAt: '2026-11-14T12:00:00.000Z',
}

beforeEach(() => {
  FakeXHR.instances = []
  FakeXHR.statuses = []
})

describe('checkAudioFile', () => {
  it('rejects non-audio types and files over 20 MB', () => {
    expect(checkAudioFile({ type: 'video/mp4', size: 100 })).toBe(NOT_AUDIO)
    expect(checkAudioFile({ type: '', size: 100 })).toBe(NOT_AUDIO)
    expect(checkAudioFile({ type: 'audio/mpeg', size: 25 * 1024 * 1024 })).toBe(TOO_LARGE)
    expect(checkAudioFile({ type: 'audio/mpeg', size: 0 })).not.toBeNull()
    expect(checkAudioFile({ type: 'audio/mpeg', size: MAX_UPLOAD_BYTES })).toBeNull()
  })
})

describe('postToS3', () => {
  it('posts every field in order and the file last, reporting progress', async () => {
    const onProgress = vi.fn()
    const blob = new Blob(['abc'], { type: 'audio/webm' })

    await postToS3(TARGET, blob, { onProgress, XHR })

    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe(TARGET.url)
    const names = [...xhr.body!.keys()]
    expect(names).toEqual(['key', 'Content-Type', 'Policy', 'X-Amz-Signature', 'file'])
    expect(xhr.body!.get('Content-Type')).toBe('audio/webm')
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([50, 100])
  })

  it('rejects when S3 refuses the upload or the network fails', async () => {
    FakeXHR.statuses = [403, 0]
    const blob = new Blob(['abc'], { type: 'audio/webm' })
    await expect(postToS3(TARGET, blob, { XHR })).rejects.toThrow()
    await expect(postToS3(TARGET, blob, { XHR })).rejects.toThrow()
  })

  it('sets a size-scaled timeout and rejects when the upload stalls', async () => {
    FakeXHR.statuses = [-1]
    const blob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'audio/webm' })
    await expect(postToS3(TARGET, blob, { XHR })).rejects.toThrow(UPLOAD_FAILED)
    // 120 s base plus 30 s per MB.
    expect(FakeXHR.instances[0].timeout).toBe(180_000)
  })
})

describe('measureDuration', () => {
  function fakeAudio(duration: number, event = 'loadedmetadata') {
    const audio = new EventTarget() as EventTarget & { src: string; preload: string; duration: number; load: () => void }
    audio.duration = duration
    audio.load = () => queueMicrotask(() => audio.dispatchEvent(new Event(event)))
    return audio as unknown as HTMLAudioElement
  }
  const urls = { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() }
  const blob = new Blob(['abc'], { type: 'audio/mpeg' })

  it('reads the duration from metadata without decoding', async () => {
    const decode = vi.fn()
    expect(await measureDuration(blob, { ...urls, createAudio: () => fakeAudio(3.2004), decode })).toBe(3200)
    expect(decode).not.toHaveBeenCalled()
  })

  it('falls back to decoding when metadata reports Infinity', async () => {
    const decode = vi.fn().mockResolvedValue(4.5)
    expect(await measureDuration(blob, { ...urls, createAudio: () => fakeAudio(Infinity), decode })).toBe(4500)
  })

  it('gives up quietly when decoding fails too', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('bad'))
    expect(await measureDuration(blob, { ...urls, createAudio: () => fakeAudio(NaN, 'error'), decode })).toBeUndefined()
  })
})

describe('saveTake', () => {
  const take = { blob: new Blob(['abc'], { type: 'audio/webm' }), contentType: 'audio/webm', durationMs: 3200 }

  it('presigns, uploads, then confirms with the duration', async () => {
    const { fetch } = fakeApi({
      'POST /api/recordings': envelope(201, 'Upload URL created', { recordingId: 'r1', ...TARGET }),
      'POST /api/recordings/r1/confirm': envelope(200, 'OK', READY),
    })
    const onFinalizing = vi.fn()

    const saved = await saveTake(take, { step: 'upload' }, { XHR, onFinalizing })

    expect(saved).toEqual(READY)
    expect(onFinalizing).toHaveBeenCalledWith('r1')
    const bodies = fetch.mock.calls.map(([input, init]) => [String(input), JSON.parse(String(init?.body))])
    expect(bodies).toEqual([
      ['/api/recordings', { contentType: 'audio/webm', size: 3 }],
      ['/api/recordings/r1/confirm', { durationMs: 3200 }],
    ])
  })

  it('resumes from confirm without presigning or uploading again', async () => {
    const { fetch } = fakeApi({ 'POST /api/recordings/r1/confirm': envelope(200, 'OK', READY) })
    await saveTake({ ...take, durationMs: undefined }, { step: 'confirm', recordingId: 'r1' }, { XHR })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({})
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('reports which step failed', async () => {
    fakeApi({
      'POST /api/recordings': envelope(201, 'Upload URL created', { recordingId: 'r1', ...TARGET }),
      'POST /api/recordings/r1/confirm': envelope(401, 'Not signed in'),
    })
    FakeXHR.statuses = [500]
    const upload = await saveTake(take, { step: 'upload' }, { XHR }).catch((e: unknown) => e)
    expect(upload).toBeInstanceOf(SaveError)
    expect((upload as SaveError).resume).toEqual({ step: 'upload' })

    const confirm = await saveTake(take, { step: 'upload' }, { XHR }).catch((e: unknown) => e)
    expect(confirm).toBeInstanceOf(SaveError)
    expect((confirm as SaveError).resume).toEqual({ step: 'confirm', recordingId: 'r1' })
    expect((confirm as SaveError).sessionExpired).toBe(true)
  })

  it('flags an expired session when presigning answers 401', async () => {
    fakeApi({ 'POST /api/recordings': envelope(401, 'Not signed in') })
    const err = await saveTake(take, { step: 'upload' }, { XHR }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveError)
    expect((err as SaveError).resume).toEqual({ step: 'upload' })
    expect((err as SaveError).sessionExpired).toBe(true)
    expect((err as SaveError).message).toBe(SESSION_EXPIRED)
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('restarts from upload when confirm rejects the upload with 422', async () => {
    fakeApi({
      'POST /api/recordings': envelope(201, 'Upload URL created', { recordingId: 'r1', ...TARGET }),
      'POST /api/recordings/r1/confirm': envelope(422, 'The upload did not match'),
    })
    const err = await saveTake(take, { step: 'upload' }, { XHR }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveError)
    expect((err as SaveError).resume).toEqual({ step: 'upload' })
    expect((err as SaveError).sessionExpired).toBe(false)
    expect((err as SaveError).message).toBe('The upload did not match')
  })
})

afterEach(() => {
  FakeXHR.statuses = []
})
