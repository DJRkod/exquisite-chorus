// Stand-ins for the browser media APIs jsdom lacks: MediaRecorder,
// getUserMedia, XMLHttpRequest uploads to S3, Web Audio, and blob URLs.
import { vi } from 'vitest'

/** A MediaRecorder that records one chunk and stops on demand. */
export class FakeMediaRecorder extends EventTarget {
  static supported: string[] = ['audio/webm;codecs=opus']
  static instances: FakeMediaRecorder[] = []
  /** What the browser reports after start; defaults to the requested type. */
  static actualMimeType: string | null = null

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type)
  }

  readonly stream: MediaStream
  readonly requestedType: string
  mimeType: string
  state: 'inactive' | 'recording' = 'inactive'

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.stream = stream
    this.requestedType = options?.mimeType ?? ''
    this.mimeType = this.requestedType
    FakeMediaRecorder.instances.push(this)
  }

  start() {
    this.state = 'recording'
    this.mimeType = FakeMediaRecorder.actualMimeType ?? this.requestedType
    this.dispatchEvent(new Event('start'))
  }

  /** Like a browser, stopping an inactive recorder does nothing. */
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    const data = Object.assign(new Event('dataavailable'), {
      data: new Blob(['take-bytes'], { type: this.mimeType }),
    })
    this.dispatchEvent(data)
    this.dispatchEvent(new Event('stop'))
  }

  /** A recording error: the recorder goes inactive and fires 'error'. */
  fail() {
    this.state = 'inactive'
    this.dispatchEvent(new Event('error'))
  }
}

export function fakeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

/** An XHR that answers each send with the next queued status (default 204). */
export class FakeXHR extends EventTarget {
  static instances: FakeXHR[] = []
  /** Statuses for upcoming sends; 0 means a network error. */
  static statuses: number[] = []

  readonly upload = new EventTarget()
  method = ''
  url = ''
  body: FormData | null = null
  status = 0

  constructor() {
    super()
    FakeXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: FormData) {
    this.body = body
    const status = FakeXHR.statuses.shift() ?? 204
    queueMicrotask(() => {
      for (const loaded of [50, 100]) {
        this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded, total: 100 }))
      }
      this.status = status
      this.dispatchEvent(new Event(status === 0 ? 'error' : 'load'))
    })
  }

  abort() {}
}

export interface FakeSource {
  buffer: unknown
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onended: (() => void) | null
}

/** A Web Audio context whose decode and sources are spies. */
export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 5
  state = 'suspended'
  destination = {}
  sources: FakeSource[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {})
  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => ({ duration: 2.5 }) as unknown as AudioBuffer)

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createBufferSource() {
    const source: FakeSource = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
    this.sources.push(source)
    return source
  }
}

/**
 * Installs every fake on the globals and returns a restore function.
 * Media elements report `durationSeconds` once metadata "loads".
 */
export function installMedia({ durationSeconds = 3.2 }: { durationSeconds?: number } = {}) {
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.supported = ['audio/webm;codecs=opus']
  FakeMediaRecorder.actualMimeType = null
  FakeXHR.instances = []
  FakeXHR.statuses = []
  FakeAudioContext.instances = []

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('AudioContext', FakeAudioContext)

  const saved = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  }
  let urls = 0
  const createObjectURL = vi.fn(() => `blob:take-${++urls}`)
  const revokeObjectURL = vi.fn()
  const { stream, track } = fakeStream()
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })

  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(durationSeconds)

  const restore = () => {
    vi.unstubAllGlobals()
    const put = (target: object, name: string, desc: PropertyDescriptor | undefined) => {
      if (desc) Object.defineProperty(target, name, desc)
      else Reflect.deleteProperty(target, name)
    }
    put(navigator, 'mediaDevices', saved.mediaDevices)
    put(URL, 'createObjectURL', saved.createObjectURL)
    put(URL, 'revokeObjectURL', saved.revokeObjectURL)
  }
  return { getUserMedia, stream, track, play, pause, createObjectURL, revokeObjectURL, restore }
}

/** A DOMException-like error with the given name, as getUserMedia rejects. */
export function domError(name: string): Error {
  return new DOMException('denied', name)
}
