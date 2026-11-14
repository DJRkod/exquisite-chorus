// Playback (KTD9, KTD10). Presigned GET URLs are fetched at play time and
// refreshed once on failure. One track plays through <audio>; "play together"
// decodes every track into one AudioContext and starts all sources at the same
// instant, because separate <audio> elements drift.

/** Seconds between scheduling and the shared start, so every source makes it. */
export const START_DELAY_S = 0.1

/** The browser's AudioContext constructor (webkit-prefixed on older Safari), if any. */
export function audioContextClass(): typeof AudioContext | undefined {
  return (
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  )
}

type Playable = Pick<HTMLAudioElement, 'play' | 'addEventListener' | 'removeEventListener'> & { src: string }

/** Plays once: resolves when playback starts, rejects on a media error or a refused play(). */
function attempt(audio: Playable, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const settle = (fn: () => void) => {
      audio.removeEventListener('error', onError)
      fn()
    }
    const onError = () => settle(() => reject(new Error('The recording could not be loaded')))
    audio.addEventListener('error', onError)
    audio.src = url
    Promise.resolve(audio.play()).then(
      () => settle(resolve),
      (err: unknown) => settle(() => reject(err)),
    )
  })
}

/** A 1-sample silent WAV as a blob: URL (the CSP allows blob:, not data:). */
function silentWavUrl(): string {
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 38, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 16000, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, 2, true) // one 16-bit sample of silence follows
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

const unlocked = new WeakSet<object>()

/**
 * Safari only lets an element play from inside the click that asked for it,
 * and playTrack awaits a playback URL first. Playing a silent clip
 * synchronously within the gesture unlocks the element for the real play()
 * that follows the await. Call this before any await in a click handler.
 */
function unlockForGesture(audio: Playable): void {
  if (unlocked.has(audio) || typeof URL.createObjectURL !== 'function') return
  unlocked.add(audio)
  const url = silentWavUrl()
  audio.src = url
  Promise.resolve(audio.play())
    .catch(() => {})
    .finally(() => URL.revokeObjectURL(url))
}

/**
 * Plays one recording through `audio`. A media error (an expired or refused
 * URL) gets exactly one fresh URL and another try; autoplay refusals do not.
 * Call it directly from the click handler so the Safari unlock runs within
 * the user gesture.
 */
export async function playTrack(audio: Playable, fetchUrl: () => Promise<string>): Promise<void> {
  unlockForGesture(audio)
  try {
    await attempt(audio, await fetchUrl())
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'NotAllowedError') throw err
    await attempt(audio, await fetchUrl())
  }
}

export interface GroupTrack {
  id: string
  /** How to name the track if it fails, e.g. "Ada Lovelace's recording from Nov 14". */
  label: string
}

export class TrackLoadError extends Error {
  readonly track: GroupTrack

  constructor(track: GroupTrack) {
    super(`Couldn't load ${track.label}.`)
    this.track = track
    this.name = 'TrackLoadError'
  }
}

export interface LoadDeps {
  fetchUrl: (id: string) => Promise<string>
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

async function loadOne(
  ctx: AudioContext,
  track: GroupTrack,
  { fetchUrl, fetch = globalThis.fetch.bind(globalThis) }: LoadDeps,
  signal: AbortSignal,
): Promise<AudioBuffer> {
  const once = async () => {
    const response = await fetch(await fetchUrl(track.id), { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return ctx.decodeAudioData(await response.arrayBuffer())
  }
  try {
    try {
      return await once()
    } catch {
      if (signal.aborted) throw new Error('aborted')
      return await once()
    }
  } catch {
    throw new TrackLoadError(track)
  }
}

/**
 * Fetches and decodes every track. If one fails (after one URL refresh), the
 * rest are abandoned and this rejects with a TrackLoadError naming it.
 */
export async function loadGroup(ctx: AudioContext, tracks: GroupTrack[], deps: LoadDeps): Promise<AudioBuffer[]> {
  const controller = new AbortController()
  try {
    return await Promise.all(tracks.map((track) => loadOne(ctx, track, deps, controller.signal)))
  } catch (err) {
    controller.abort()
    throw err
  }
}

export interface PlayingGroup {
  /** The shared AudioContext time every source starts at. */
  when: number
  stop(): void
}

/** Starts every buffer at the same `ctx.currentTime + START_DELAY_S`. */
export function startGroup(ctx: AudioContext, buffers: AudioBuffer[], onEnded?: () => void): PlayingGroup {
  const when = ctx.currentTime + START_DELAY_S
  let remaining = buffers.length
  let stopped = false
  const sources = buffers.map((buffer) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => {
      remaining -= 1
      if (remaining === 0 && !stopped) onEnded?.()
    }
    return source
  })
  for (const source of sources) source.start(when)
  return {
    when,
    stop() {
      stopped = true
      for (const source of sources) {
        try {
          source.stop()
        } catch {
          // Already stopped.
        }
      }
    },
  }
}
