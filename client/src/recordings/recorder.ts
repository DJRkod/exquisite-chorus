// Microphone capture with MediaRecorder (KTD11). Formats are stored as
// recorded, so the take carries the recorder's actual MIME type. Browser APIs
// are injectable so jsdom tests can stand in for them.

/** In order of preference: Safari records mp4, Chrome webm, Firefox ogg or webm. */
export const MIME_PREFERENCES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'] as const

export const MIC_BLOCKED = 'Microphone access was blocked. Allow it in your browser, or pick a file instead.'
export const NO_MIC = 'No microphone found. Pick a file instead.'
export const RECORDING_UNSUPPORTED = "This browser can't record audio. Pick a file instead."
export const RECORDING_FAILED = "Couldn't start recording. Pick a file instead."

/** Longest take, in ms; matches the server's durationMs cap (30 minutes). */
export const MAX_DURATION_MS = 30 * 60 * 1000

/** A finished take, ready to preview and upload. */
export interface Take {
  blob: Blob
  /** The exact type to presign and upload with. */
  contentType: string
  durationMs?: number
}

export class RecorderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecorderError'
  }
}

export interface RecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  MediaRecorder?: typeof MediaRecorder
  now?: () => number
}

export interface ActiveRecording {
  /** The type the browser actually records, read after start. */
  readonly mimeType: string
  stop(): Promise<Take>
  /** Stops without keeping the take. */
  cancel(): void
}

export function pickMimeType(
  isTypeSupported: (type: string) => boolean = (type) => MediaRecorder.isTypeSupported(type),
): string | undefined {
  return MIME_PREFERENCES.find((type) => isTypeSupported(type))
}

/** A whole number of milliseconds the server accepts, or undefined. */
export function toDurationMs(ms: number): number | undefined {
  if (!Number.isFinite(ms)) return undefined
  const rounded = Math.round(ms)
  return rounded >= 1 && rounded <= MAX_DURATION_MS ? rounded : undefined
}

function micMessage(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_BLOCKED
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return NO_MIC
  return RECORDING_FAILED
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

/** Asks for the mic and starts recording. Rejects with a RecorderError. */
export async function startRecording(deps: RecorderDeps = {}): Promise<ActiveRecording> {
  const Recorder = deps.MediaRecorder ?? globalThis.MediaRecorder
  const getUserMedia =
    deps.getUserMedia ??
    (navigator.mediaDevices?.getUserMedia
      ? (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
      : undefined)
  const now = deps.now ?? (() => performance.now())
  if (!Recorder || !getUserMedia) throw new RecorderError(RECORDING_UNSUPPORTED)

  let stream: MediaStream
  try {
    stream = await getUserMedia({ audio: true })
  } catch (err) {
    throw new RecorderError(micMessage(err))
  }

  const picked = pickMimeType((type) => Recorder.isTypeSupported(type))
  let recorder: MediaRecorder
  try {
    recorder = new Recorder(stream, picked ? { mimeType: picked } : undefined)
    recorder.start()
  } catch {
    stopTracks(stream)
    throw new RecorderError(RECORDING_FAILED)
  }
  const startedAt = now()
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    const { data } = event as BlobEvent
    if (data && data.size > 0) chunks.push(data)
  })
  const mimeType = recorder.mimeType || picked || 'audio/webm'

  return {
    mimeType,
    stop() {
      return new Promise<Take>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            const durationMs = toDurationMs(now() - startedAt)
            stopTracks(stream)
            const blob = new Blob(chunks, { type: mimeType })
            resolve({ blob, contentType: mimeType, ...(durationMs === undefined ? {} : { durationMs }) })
          },
          { once: true },
        )
        recorder.stop()
      })
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      stopTracks(stream)
    },
  }
}
