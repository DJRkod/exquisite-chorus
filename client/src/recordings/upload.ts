// Upload flow (KTD7, KTD8): check the file, presign, POST the multipart form
// straight to S3 with progress, then confirm with the measured duration.
// Each step can be resumed: a failed confirm retries confirm alone.
import type { CreateUploadResponse, RecordingDto } from '@exquisite-chorus/shared'
import { ApiError, confirmUpload, createUpload } from '../api/client.ts'
import { errorMessage } from '../auth/errorMessage.ts'
import { audioContextClass } from './playback.ts'
import { toDurationMs, type Take } from './recorder.ts'

/** Matches the server's presigned POST policy (20 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const NOT_AUDIO = 'That isn’t an audio file. Pick an audio file instead.'
export const TOO_LARGE = 'That file is over 20 MB. Pick a smaller one.'
export const EMPTY_FILE = 'That file is empty. Pick another one.'
export const UPLOAD_FAILED = 'The upload failed. Check your connection and retry.'
export const SESSION_EXPIRED = 'Your session expired — sign in again to finish saving'
const METADATA_TIMEOUT_MS = 4_000
/** S3 upload timeout: 120 s plus 30 s per MB, so a stalled upload fails instead of hanging. */
const UPLOAD_BASE_TIMEOUT_MS = 120_000
const UPLOAD_TIMEOUT_MS_PER_MB = 30_000

function uploadTimeoutMs(bytes: number): number {
  return UPLOAD_BASE_TIMEOUT_MS + Math.ceil((bytes / (1024 * 1024)) * UPLOAD_TIMEOUT_MS_PER_MB)
}

/** A message to show, or null when the file may be uploaded. */
export function checkAudioFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('audio/')) return NOT_AUDIO
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE
  if (file.size < 1) return EMPTY_FILE
  return null
}

export interface MeasureDeps {
  createAudio?: () => HTMLAudioElement
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  /** Decodes the bytes and returns seconds. */
  decode?: (data: ArrayBuffer) => Promise<number>
  timeoutMs?: number
}

function metadataSeconds(blob: Blob, deps: Required<Omit<MeasureDeps, 'decode'>>): Promise<number> {
  const url = deps.createObjectURL(blob)
  const audio = deps.createAudio()
  return new Promise<number>((resolve) => {
    const done = (seconds: number) => {
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
      audio.removeAttribute?.('src')
      deps.revokeObjectURL(url)
      resolve(seconds)
    }
    const onLoaded = () => done(audio.duration)
    const onError = () => done(NaN)
    const timer = setTimeout(() => done(NaN), deps.timeoutMs)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('error', onError)
    audio.preload = 'metadata'
    audio.src = url
    audio.load()
  })
}

async function decodeSeconds(data: ArrayBuffer): Promise<number> {
  const Context = audioContextClass()
  if (!Context) throw new Error('Web Audio is unavailable')
  const ctx = new Context()
  try {
    return (await ctx.decodeAudioData(data)).duration
  } finally {
    void ctx.close?.()
  }
}

/**
 * Duration of a picked file in whole ms: metadata first, a full decode only
 * when metadata has no finite duration (MediaRecorder WebM reports Infinity),
 * and undefined when neither works. The server treats duration as optional.
 */
export async function measureDuration(blob: Blob, deps: MeasureDeps = {}): Promise<number | undefined> {
  const seconds = await metadataSeconds(blob, {
    createAudio: deps.createAudio ?? (() => new Audio()),
    createObjectURL: deps.createObjectURL ?? ((b) => URL.createObjectURL(b)),
    revokeObjectURL: deps.revokeObjectURL ?? ((u) => URL.revokeObjectURL(u)),
    timeoutMs: deps.timeoutMs ?? METADATA_TIMEOUT_MS,
  })
  if (Number.isFinite(seconds) && seconds > 0) return toDurationMs(seconds * 1000)
  try {
    const decoded = await (deps.decode ?? decodeSeconds)(await blob.arrayBuffer())
    return toDurationMs(decoded * 1000)
  } catch {
    return undefined
  }
}

export class S3UploadError extends Error {
  /** S3's HTTP status, or 0 when the request never completed. */
  readonly status: number

  constructor(status: number) {
    super(UPLOAD_FAILED)
    this.status = status
    this.name = 'S3UploadError'
  }
}

export interface PostDeps {
  /** Percent of bytes sent, 0–100. */
  onProgress?: (percent: number) => void
  XHR?: typeof XMLHttpRequest
}

/** POSTs the presigned form to S3: every policy field first, the file last. */
export function postToS3(
  target: Pick<CreateUploadResponse, 'url' | 'fields'>,
  blob: Blob,
  { onProgress, XHR = XMLHttpRequest }: PostDeps = {},
): Promise<void> {
  const form = new FormData()
  for (const [name, value] of Object.entries(target.fields)) form.append(name, value)
  form.append('file', blob, blob instanceof File ? blob.name : 'recording')

  return new Promise<void>((resolve, reject) => {
    const xhr = new XHR()
    xhr.open('POST', target.url)
    xhr.timeout = uploadTimeoutMs(blob.size)
    let lastPercent: number | undefined
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.round((event.loaded / event.total) * 100)
      if (percent === lastPercent) return
      lastPercent = percent
      onProgress?.(percent)
    })
    // S3 answers 204 No Content on success.
    xhr.addEventListener('load', () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new S3UploadError(xhr.status)),
    )
    xhr.addEventListener('error', () => reject(new S3UploadError(0)))
    xhr.addEventListener('timeout', () => reject(new S3UploadError(0)))
    xhr.addEventListener('abort', () => reject(new S3UploadError(0)))
    xhr.send(form)
  })
}

/** Where saveTake starts: from scratch, or at confirm for an uploaded take. */
export type SaveFrom = { step: 'upload' } | { step: 'confirm'; recordingId: string }

export class SaveError extends Error {
  /** The step a retry should start from. */
  readonly step: 'upload' | 'confirm'
  /** Set when the bytes are in S3 and only confirm remains. */
  readonly recordingId?: string
  readonly sessionExpired: boolean

  constructor(message: string, step: 'upload' | 'confirm', recordingId?: string, sessionExpired = false) {
    super(message)
    this.step = step
    this.recordingId = recordingId
    this.sessionExpired = sessionExpired
    this.name = 'SaveError'
  }
}

export interface SaveDeps extends PostDeps {
  /** Called once the bytes are in S3 and confirm starts. */
  onFinalizing?: (recordingId: string) => void
}

/** Runs the upload from `from` to the end. Rejects with a SaveError naming the step to resume. */
export async function saveTake(take: Take, from: SaveFrom, deps: SaveDeps = {}): Promise<RecordingDto> {
  let recordingId: string
  if (from.step === 'confirm') {
    recordingId = from.recordingId
  } else {
    try {
      const target = await createUpload({ contentType: take.contentType, size: take.blob.size })
      recordingId = target.recordingId
      deps.onProgress?.(0)
      await postToS3(target, take.blob, deps)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new SaveError(SESSION_EXPIRED, 'upload', undefined, true)
      }
      throw new SaveError(errorMessage(err, UPLOAD_FAILED), 'upload')
    }
  }

  deps.onFinalizing?.(recordingId)
  try {
    return await confirmUpload(recordingId, take.durationMs === undefined ? {} : { durationMs: take.durationMs })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new SaveError(SESSION_EXPIRED, 'confirm', recordingId, true)
    }
    // A rejected upload cannot be confirmed again; start over with a new one.
    if (err instanceof ApiError && err.status === 422) throw new SaveError(err.message, 'upload')
    throw new SaveError(errorMessage(err, 'Saving failed. Retry to finish.'), 'confirm', recordingId)
  }
}
