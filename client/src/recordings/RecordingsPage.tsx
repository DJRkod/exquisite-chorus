// The signed-in home: record or pick audio, preview and upload it, and play
// recordings alone or together. Capture moves idle → recording → recorded →
// uploading → finalizing → done (back to idle), or to error with a Retry that
// resumes from the step that failed.
import type { RecordingDto } from '@exquisite-chorus/shared'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { getPlaybackUrl, listRecordings } from '../api/client.ts'
import { errorMessage, GENERIC_ERROR } from '../auth/errorMessage.ts'
import { useAuth } from '../auth/useAuth.ts'
import {
  audioContextClass,
  isUnlockClip,
  loadGroup,
  playTrack,
  startGroup,
  TrackLoadError,
  type PlayingGroup,
} from './playback.ts'
import { RECORDING_FAILED, RecorderError, startRecording, type ActiveRecording, type Take } from './recorder.ts'
import { checkAudioFile, measureDuration, saveTake, SaveError, type SaveFrom } from './upload.ts'

interface PreviewTake extends Take {
  previewUrl: string
}

type Capture =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'recording'; startedAt: number }
  | { step: 'preparing' }
  | { step: 'recorded'; take: PreviewTake }
  | { step: 'uploading'; take: PreviewTake; percent: number }
  | { step: 'finalizing'; take: PreviewTake }
  | { step: 'error'; take: PreviewTake; message: string; from: SaveFrom; sessionExpired: boolean }

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: RecordingDto[] }

/** m:ss, or an em dash when unknown. */
function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

function describe(rec: RecordingDto): string {
  return `${rec.ownerDisplayName || 'Unknown'}’s recording from ${formatDate(rec.createdAt)}`
}

/** Per-row play button text and aria-label prefix, by that row's playback phase. */
const PLAY_BUTTON = {
  idle: { text: 'Play', aria: 'Play' },
  loading: { text: 'Loading…', aria: 'Loading' },
  playing: { text: 'Stop', aria: 'Stop' },
} as const

/** "Play together" button text and aria-label, by group playback state. */
const TOGETHER_BUTTON = {
  idle: { text: 'Play together', aria: undefined },
  loading: { text: 'Loading…', aria: undefined },
  playing: { text: 'Stop', aria: 'Stop playing together' },
} as const

const fetchPlaybackUrl = (id: string) => getPlaybackUrl(id).then((playback) => playback.url)

export default function RecordingsPage() {
  const { user } = useAuth()
  const [capture, setCapture] = useState<Capture>({ step: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [single, setSingle] = useState<{ id: string; phase: 'loading' | 'playing' } | null>(null)
  const [together, setTogether] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [playError, setPlayError] = useState<string | null>(null)

  const activeRef = useRef<ActiveRecording | null>(null)
  const previewRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const groupRef = useRef<PlayingGroup | null>(null)
  // The latest playback request: Stop, a newer Play, or unmounting aborts it,
  // so a superseded request changes nothing.
  const pendingPlay = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  // Release the mic, the preview URL, and any playing audio on the way out.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pendingPlay.current?.abort()
      activeRef.current?.cancel()
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      groupRef.current?.stop()
      void ctxRef.current?.close?.()
    }
  }, [])

  const fetchList = useCallback(() => {
    listRecordings().then(
      (items) => mounted.current && setList({ status: 'ready', items }),
      (err: unknown) => mounted.current && setList({ status: 'error', message: errorMessage(err) }),
    )
  }, [])

  useEffect(fetchList, [fetchList])

  function reloadList() {
    setList({ status: 'loading' })
    fetchList()
  }

  // ---- capture ----

  function showTake(take: Take) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const previewUrl = URL.createObjectURL(take.blob)
    previewRef.current = previewUrl
    setCapture({ step: 'recorded', take: { ...take, previewUrl } })
  }

  function dropTake() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setCapture({ step: 'idle' })
  }

  async function handleRecord() {
    setNotice(null)
    setCapture({ step: 'starting' })
    try {
      const active = await startRecording()
      // Unmounted while the permission prompt was open: release the mic.
      if (!mounted.current) {
        active.cancel()
        return
      }
      activeRef.current = active
      setCapture({ step: 'recording', startedAt: Date.now() })
    } catch (err) {
      setNotice(err instanceof RecorderError ? err.message : RECORDING_FAILED)
      setCapture({ step: 'idle' })
    }
  }

  async function handleStop() {
    const active = activeRef.current
    activeRef.current = null
    if (!active) return
    setCapture({ step: 'preparing' })
    let take: Take
    try {
      take = await active.stop()
    } catch {
      if (!mounted.current) return
      setNotice(RECORDING_FAILED)
      setCapture({ step: 'idle' })
      return
    }
    if (mounted.current) showTake(take)
  }

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = checkAudioFile(file)
    if (problem) {
      setNotice(problem)
      return
    }
    setNotice(null)
    setCapture({ step: 'preparing' })
    const durationMs = await measureDuration(file)
    if (!mounted.current) return
    showTake({ blob: file, contentType: file.type, ...(durationMs === undefined ? {} : { durationMs }) })
  }

  async function upload(take: PreviewTake, from: SaveFrom) {
    setCapture(from.step === 'upload' ? { step: 'uploading', take, percent: 0 } : { step: 'finalizing', take })
    try {
      const saved = await saveTake(take, from, {
        // Same take at the same percent: return the current state so React skips the render.
        onProgress: (percent) =>
          mounted.current &&
          setCapture((current) =>
            current.step === 'uploading' && current.take === take && current.percent === percent
              ? current
              : { step: 'uploading', take, percent },
          ),
        onFinalizing: () => mounted.current && setCapture({ step: 'finalizing', take }),
      })
      if (!mounted.current) return
      const entry = { ...saved, ownerDisplayName: saved.ownerDisplayName || user?.displayName || '' }
      setList((current) =>
        current.status === 'ready'
          ? { status: 'ready', items: [entry, ...current.items.filter((item) => item.id !== entry.id)] }
          : { status: 'ready', items: [entry] },
      )
      dropTake()
    } catch (err) {
      if (!mounted.current) return
      // saveTake only rejects with SaveError; anything else restarts the upload.
      const failure = err instanceof SaveError ? err : null
      setCapture({
        step: 'error',
        take,
        message: failure?.message ?? GENERIC_ERROR,
        from: failure?.resume ?? { step: 'upload' },
        sessionExpired: failure?.sessionExpired ?? false,
      })
    }
  }

  // ---- playback ----

  /** Supersedes (aborts) any in-flight play request. */
  function cancelPendingPlay() {
    pendingPlay.current?.abort()
    pendingPlay.current = null
  }

  /**
   * A fresh request and the signal that cancels it. Every supersede path aborts
   * the pending controller, so the request is current exactly while its signal
   * is not aborted. settle() returns false for a stale request; otherwise it
   * marks the request finished and returns true.
   */
  function beginPlay() {
    cancelPendingPlay()
    const controller = new AbortController()
    pendingPlay.current = controller
    return {
      signal: controller.signal,
      settle: () => {
        if (controller.signal.aborted) return false
        pendingPlay.current = null
        return true
      },
    }
  }

  function stopSingle() {
    cancelPendingPlay()
    audioRef.current?.pause()
    setSingle(null)
  }

  function stopTogether() {
    cancelPendingPlay()
    groupRef.current?.stop()
    groupRef.current = null
    setTogether('idle')
  }

  async function handlePlay(rec: RecordingDto) {
    const audio = audioRef.current
    if (!audio) return
    if (single?.id === rec.id) {
      stopSingle()
      return
    }
    stopTogether()
    audio.pause()
    const request = beginPlay()
    setPlayError(null)
    setSingle({ id: rec.id, phase: 'loading' })
    try {
      await playTrack(audio, () => fetchPlaybackUrl(rec.id), request.signal)
      if (!request.settle()) return
      setSingle({ id: rec.id, phase: 'playing' })
    } catch {
      if (!request.settle()) return
      setSingle(null)
      setPlayError(`Couldn't play ${describe(rec)}. Try again.`)
    }
  }

  async function handlePlayTogether(items: RecordingDto[]) {
    if (together === 'playing') {
      stopTogether()
      return
    }
    const Context = audioContextClass()
    if (!Context) {
      setPlayError("This browser can't play recordings together.")
      return
    }
    // Create and resume inside the click so the browser counts it as a gesture.
    const ctx = ctxRef.current ?? new Context()
    ctxRef.current = ctx
    void ctx.resume()

    stopSingle()
    const request = beginPlay()
    setPlayError(null)
    setTogether('loading')
    const tracks = items.map((rec) => ({ id: rec.id, label: describe(rec) }))
    try {
      const buffers = await loadGroup(ctx, tracks, { fetchUrl: fetchPlaybackUrl }, request.signal)
      // Stopped, superseded, or unmounted while loading: start nothing.
      if (!request.settle()) return
      const group = startGroup(ctx, buffers, () => {
        if (groupRef.current !== group) return
        groupRef.current = null
        if (mounted.current) setTogether('idle')
      })
      groupRef.current = group
      setTogether('playing')
    } catch (err) {
      if (!request.settle()) return
      setTogether('idle')
      setPlayError(
        err instanceof TrackLoadError
          ? `Couldn't load ${err.track.label}, so nothing was played. Try again.`
          : "Couldn't play these recordings together. Try again.",
      )
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- render ----

  const busy = capture.step !== 'idle' && capture.step !== 'recorded' && capture.step !== 'error'
  const items = list.status === 'ready' ? list.items : []
  const chosen = items.filter((rec) => selected.has(rec.id))

  return (
    <main className="recordings-page">
      <h1>Recordings</h1>

      <section className="capture" aria-labelledby="capture-heading">
        <h2 id="capture-heading">New recording</h2>
        <div className="capture-controls">
          {capture.step === 'recording' ? (
            <button type="button" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={handleRecord} disabled={busy}>
              Record
            </button>
          )}
          <label className="file-pick">
            Pick an audio file
            <input type="file" accept="audio/*" onChange={handlePick} disabled={busy} />
          </label>
        </div>

        <p role="status" className="capture-status">
          {capture.step === 'starting' && 'Waiting for the microphone…'}
          {capture.step === 'recording' && <RecordingClock startedAt={capture.startedAt} />}
          {capture.step === 'preparing' && 'Preparing the take…'}
          {capture.step === 'uploading' && `Uploading… ${capture.percent}%`}
          {capture.step === 'finalizing' && 'Saving…'}
        </p>
        {notice && (
          <p className="form-error" role="alert">
            {notice}
          </p>
        )}

        {(capture.step === 'recorded' ||
          capture.step === 'uploading' ||
          capture.step === 'finalizing' ||
          capture.step === 'error') && (
          <div className="take">
            <audio controls src={capture.take.previewUrl} aria-label="Preview" />
            <span>{formatDuration(capture.take.durationMs)}</span>
            {capture.step === 'uploading' && (
              <progress max={100} value={capture.percent} aria-label="Upload progress" />
            )}
            {capture.step === 'recorded' && (
              <>
                <button type="button" onClick={() => upload(capture.take, { step: 'upload' })}>
                  Upload
                </button>
                <button type="button" onClick={dropTake}>
                  Discard
                </button>
              </>
            )}
            {capture.step === 'error' && (
              <>
                <p className="form-error" role="alert">
                  {capture.message}
                </p>
                {capture.sessionExpired && <ReauthForm onSignedIn={() => upload(capture.take, capture.from)} />}
                <button type="button" onClick={() => upload(capture.take, capture.from)}>
                  Retry
                </button>
                <button type="button" onClick={dropTake}>
                  Discard
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="library" aria-labelledby="library-heading">
        <h2 id="library-heading">All recordings</h2>
        <div className="together">
          <button
            type="button"
            onClick={() => handlePlayTogether(chosen)}
            disabled={together === 'loading' || (together === 'idle' && chosen.length < 2)}
            aria-label={TOGETHER_BUTTON[together].aria}
          >
            {TOGETHER_BUTTON[together].text}
          </button>
          <span role="status">
            {together === 'idle' && chosen.length < 2 && 'Select two or more recordings to play them together.'}
            {together === 'loading' && 'Loading recordings to play together…'}
            {together === 'playing' && `Playing ${chosen.length} recordings together.`}
          </span>
        </div>
        {playError && (
          <p className="form-error" role="alert">
            {playError}
          </p>
        )}
        {/* One shared element for single-track playback. */}
        <audio
          ref={audioRef}
          hidden
          onEnded={(event) => {
            // The Safari unlock's silent clip ends too; that is not the recording.
            if (!isUnlockClip(event.currentTarget)) setSingle(null)
          }}
        />

        {list.status === 'loading' && <p role="status">Loading recordings…</p>}
        {list.status === 'error' && (
          <div>
            <p className="form-error" role="alert">
              {list.message}
            </p>
            <button type="button" onClick={reloadList}>
              Try again
            </button>
          </div>
        )}
        {list.status === 'ready' && items.length === 0 && <p>No recordings yet — record or pick a file to start.</p>}
        {items.length > 0 && (
          <ul className="recording-list" aria-label="Recordings">
            {items.map((rec) => {
              const label = describe(rec)
              const state = single?.id === rec.id ? single.phase : 'idle'
              const button = PLAY_BUTTON[state]
              return (
                <li key={rec.id}>
                  <span className="owner">{rec.ownerDisplayName || 'Unknown'}</span>
                  <span className="duration">{formatDuration(rec.durationMs)}</span>
                  <time dateTime={rec.createdAt}>{formatDate(rec.createdAt)}</time>
                  <button
                    type="button"
                    onClick={() => handlePlay(rec)}
                    disabled={state === 'loading'}
                    aria-label={`${button.aria} ${label}`}
                  >
                    {button.text}
                  </button>
                  <label className="select">
                    <input
                      type="checkbox"
                      checked={selected.has(rec.id)}
                      onChange={() => toggleSelected(rec.id)}
                      aria-label={`Select ${label} to play together`}
                    />
                    Select
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

/**
 * "Recording m:ss" for the take in progress. It ticks on its own so the page
 * does not re-render; whole seconds only change once a second, so React skips
 * the identical updates in between.
 */
function RecordingClock({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 250)
    return () => clearInterval(timer)
  }, [startedAt])
  return `Recording ${formatDuration(seconds * 1000)}`
}

/** Signs back in without leaving the page, so a pending take is not lost. */
function ReauthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { user, signIn } = useAuth()
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn({ email, password })
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
      setSubmitting(false)
      return
    }
    onSignedIn()
  }

  return (
    <form className="reauth" onSubmit={handleSubmit}>
      <label htmlFor="reauth-email">Email</label>
      <input
        id="reauth-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="reauth-password">Password</label>
      <input
        id="reauth-password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        Sign in and save
      </button>
    </form>
  )
}
