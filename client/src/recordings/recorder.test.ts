import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { domError, fakeStream, FakeMediaRecorder } from '../test/fakeMedia.ts'
import { MIC_BLOCKED, NO_MIC, pickMimeType, RecorderError, startRecording, type Take } from './recorder.ts'

const only = (...types: string[]) => (type: string) => types.includes(type)

describe('pickMimeType', () => {
  it('selects webm/opus when it is the only supported type', () => {
    expect(pickMimeType(only('audio/webm;codecs=opus'))).toBe('audio/webm;codecs=opus')
  })

  it('prefers mp4 when it is supported', () => {
    expect(pickMimeType(only('audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'))).toBe('audio/mp4')
  })

  it('falls back to ogg, then to none', () => {
    expect(pickMimeType(only('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus')
    expect(pickMimeType(only())).toBeUndefined()
  })
})

describe('startRecording', () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = []
    FakeMediaRecorder.supported = ['audio/webm;codecs=opus']
    FakeMediaRecorder.actualMimeType = null
  })
  afterEach(() => {
    FakeMediaRecorder.actualMimeType = null
  })

  const Recorder = FakeMediaRecorder as unknown as typeof MediaRecorder

  async function caught(promise: Promise<unknown>): Promise<RecorderError> {
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(RecorderError)
      return err as RecorderError
    }
    throw new Error('expected startRecording to fail')
  }

  it('maps a blocked microphone to the permission message', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError('NotAllowedError'))
    const err = await caught(startRecording({ getUserMedia, MediaRecorder: Recorder }))
    expect(err.message).toBe(MIC_BLOCKED)
  })

  it('maps a missing microphone to the no-mic message', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError('NotFoundError'))
    const err = await caught(startRecording({ getUserMedia, MediaRecorder: Recorder }))
    expect(err.message).toBe(NO_MIC)
  })

  it('records with the picked type, keeps the actual type, times the take, and stops the mic', async () => {
    FakeMediaRecorder.actualMimeType = 'audio/webm;codecs="opus"'
    const { stream, track } = fakeStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(4_250.4)

    const active = await startRecording({ getUserMedia, MediaRecorder: Recorder, now })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(FakeMediaRecorder.instances[0].requestedType).toBe('audio/webm;codecs=opus')
    expect(active.mimeType).toBe('audio/webm;codecs="opus"')

    const take = await active.stop()
    expect(take.contentType).toBe('audio/webm;codecs="opus"')
    expect(take.blob.type).toBe('audio/webm;codecs="opus"')
    expect(take.blob.size).toBeGreaterThan(0)
    expect(take.durationMs).toBe(3250)
    expect(track.stop).toHaveBeenCalled()
  })

  /** Settles within 100 ms, or reports 'pending'. */
  const settled = <T>(promise: Promise<T>) =>
    Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100))])

  it('resolves stop() with the take when the recorder already ended on its own (mic track ended)', async () => {
    const { stream, track } = fakeStream()
    const active = await startRecording({ getUserMedia: vi.fn().mockResolvedValue(stream), MediaRecorder: Recorder })
    FakeMediaRecorder.instances[0].stop() // the browser ends the recording itself

    const take = await settled(active.stop())

    expect(take).not.toBe('pending')
    expect((take as Take).blob.size).toBeGreaterThan(0)
    expect(track.stop).toHaveBeenCalled()
  })

  it('rejects stop() with a RecorderError when the recorder errors', async () => {
    const { stream, track } = fakeStream()
    const active = await startRecording({ getUserMedia: vi.fn().mockResolvedValue(stream), MediaRecorder: Recorder })
    FakeMediaRecorder.instances[0].fail()

    const result = await settled(active.stop().catch((err: unknown) => err))

    expect(result).toBeInstanceOf(RecorderError)
    expect(track.stop).toHaveBeenCalled()
  })
})
