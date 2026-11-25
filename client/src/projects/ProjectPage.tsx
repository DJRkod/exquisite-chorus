// A project: its header, tags and needs, and the version tree. The data comes
// through a ProjectSource, so the same page serves the real API and the demo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client.ts'
import { errorMessage } from '../auth/errorMessage.ts'
import { playTrack } from '../recordings/playback.ts'
import { layoutTree } from './treeLayout.ts'
import type { ProjectData, ProjectSource, VersionNode } from './types.ts'
import VersionCard, { type PlayState } from './VersionCard.tsx'
import VersionTree from './VersionTree.tsx'
import { buildTree, defaultVersion, lineage } from './versionTree.ts'
import './projectPage.css'

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'notFound' }
  | { status: 'ready'; data: ProjectData; defaultV: number | null }

const WIDE = '(min-width: 900px)'

function useWide(): boolean {
  const query = () => globalThis.matchMedia?.(WIDE).matches ?? true
  const [wide, setWide] = useState(query)
  useEffect(() => {
    const mq = globalThis.matchMedia?.(WIDE)
    if (!mq) return
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

const isAbort = (err: unknown) => (err as { name?: unknown } | null)?.name === 'AbortError'

export default function ProjectPage({ source }: { source: ProjectSource }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [params, setParams] = useSearchParams()
  const [pending, setPending] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<{ version: number; text: string } | null>(null)
  const [announce, setAnnounce] = useState('')
  const [playState, setPlayState] = useState<PlayState>('idle')
  const [downloading, setDownloading] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const playCtl = useRef<AbortController | null>(null)
  const wide = useWide()

  useEffect(() => {
    const ctl = new AbortController()
    source.load(ctl.signal).then(
      (data) => {
        if (ctl.signal.aborted) return
        // The default is chosen once, so later approvals never move the reader.
        setLoad({ status: 'ready', data, defaultV: defaultVersion(buildTree(data.versions)) })
      },
      (err: unknown) => {
        if (ctl.signal.aborted || isAbort(err)) return
        if (err instanceof ApiError && err.status === 404) setLoad({ status: 'notFound' })
        else setLoad({ status: 'error', message: errorMessage(err) })
      },
    )
    return () => ctl.abort()
  }, [source, attempt])

  const stopPlayback = useCallback(() => {
    playCtl.current?.abort()
    playCtl.current = null
    audioRef.current?.pause()
    setPlayState('idle')
  }, [])

  useEffect(() => stopPlayback, [stopPlayback])

  const data = load.status === 'ready' ? load.data : null
  const tree = useMemo(() => buildTree(data?.versions ?? []), [data])
  const layout = useMemo(() => layoutTree(tree), [tree])

  const asked = Number(params.get('v'))
  const fallback = load.status === 'ready' ? load.defaultV : null
  const open = tree.get(asked) ? asked : fallback !== null && tree.get(fallback) ? fallback : (tree.root?.version ?? null)
  const openNode = open !== null ? tree.get(open)! : null

  if (load.status === 'loading') return <Shell source={source}><p role="status">Loading project…</p></Shell>
  if (load.status === 'notFound')
    return (
      <Shell source={source}>
        <h1>Project not found</h1>
        <p>This project doesn't exist, or it was removed.</p>
      </Shell>
    )
  if (load.status === 'error')
    return (
      <Shell source={source}>
        <p role="alert">Couldn't load this project. {load.message}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLoad({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          Retry
        </button>
      </Shell>
    )

  const { project } = load.data
  const isOwner = source.viewerId !== null && source.viewerId === project.ownerId
  const ownerName = project.ownerDisplayName ?? null

  function select(version: number) {
    const node = tree.get(version)!
    // Opening another version stops what was playing.
    if (version !== open) stopPlayback()
    setMessage(null)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('v', String(version))
        return next
      },
      { replace: true },
    )
    setAnnounce(`Opened v${version} by ${node.contributorDisplayName ?? 'someone'}`)
  }

  function patchVersion(version: number, approved: boolean) {
    setLoad((cur) =>
      cur.status !== 'ready'
        ? cur
        : {
            ...cur,
            data: {
              ...cur.data,
              versions: cur.data.versions.map((v): VersionNode => (v.version === version ? { ...v, approved } : v)),
            },
          },
    )
  }

  async function toggleApprove(node: VersionNode) {
    const version = node.version
    const next = !node.approved
    const verb = next ? 'approve' : 'unapprove'
    setPending((s) => new Set(s).add(version))
    setMessage(null)
    patchVersion(version, next)
    try {
      await source.setApproved(version, next)
      setAnnounce(`${next ? 'Approved' : 'Unapproved'} v${version}.`)
    } catch {
      patchVersion(version, !next)
      const text = `Couldn't ${verb} v${version}.`
      setMessage({ version, text })
      setAnnounce(text)
    } finally {
      setPending((s) => {
        const copy = new Set(s)
        copy.delete(version)
        return copy
      })
    }
  }

  function togglePlay(node: VersionNode) {
    const audio = audioRef.current
    if (!audio || !node.recordingId) return
    if (playState !== 'idle') {
      stopPlayback()
      return
    }
    const recordingId = node.recordingId
    const ctl = new AbortController()
    playCtl.current = ctl
    setPlayState('loading')
    setMessage(null)
    // Called straight from the click so Safari lets the element play.
    playTrack(audio, () => source.recordingUrl(recordingId), ctl.signal).then(
      () => !ctl.signal.aborted && setPlayState('playing'),
      (err: unknown) => {
        if (ctl.signal.aborted || isAbort(err)) return
        setPlayState('idle')
        setMessage({ version: node.version, text: `Couldn't play v${node.version}.` })
      },
    )
  }

  async function download(node: VersionNode) {
    if (!node.recordingId) return
    setDownloading(true)
    setMessage(null)
    let url: string
    try {
      url = await source.recordingUrl(node.recordingId)
    } catch {
      setDownloading(false)
      setMessage({ version: node.version, text: `Couldn't download v${node.version}.` })
      return
    }
    try {
      // A cross-origin link ignores `download`, so fetch the file and save it locally.
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = URL.createObjectURL(await response.blob())
      const a = document.createElement('a')
      a.href = blob
      a.download = `${project.title} v${node.version}`
      a.click()
      URL.revokeObjectURL(blob)
    } catch {
      window.open(url, '_blank', 'noopener')
    } finally {
      setDownloading(false)
    }
  }

  function addPart(node: VersionNode) {
    const text = `You'd be building on v${node.version}. Uploading a new part is coming soon.`
    setMessage({ version: node.version, text })
    setAnnounce(text)
  }

  const tags = [project.bpm !== null ? `${project.bpm} BPM` : null, project.musicalKey, project.genre, project.mood].filter(
    (t): t is string => !!t,
  )

  return (
    <Shell source={source}>
      <header className="pp-head">
        <h1>{project.title}</h1>
        {ownerName && <p className="pp-owner">by {ownerName}</p>}
        {project.description && <p className="pp-desc">{project.description}</p>}
        {tags.length > 0 && (
          <ul className="pp-tags" aria-label="Tags">
            {tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <div className="pp-needs">
          <span>Needs</span>
          <ul aria-label="Needs">
            {project.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </header>

      {openNode && open !== null ? (
        <VersionTree
          tree={tree}
          layout={layout}
          open={open}
          lineage={lineage(tree, open)}
          ownerName={ownerName}
          onSelect={select}
          wide={wide}
          card={
            <VersionCard
              node={openNode}
              isRoot={open === tree.root!.version}
              parentVersion={tree.parentOf(open)}
              childCount={tree.children(open).length}
              ownerName={ownerName}
              isOwner={isOwner}
              approvePending={pending.has(open)}
              playState={playState}
              downloading={downloading}
              message={message?.version === open ? message.text : null}
              onTogglePlay={() => togglePlay(openNode)}
              onDownload={() => void download(openNode)}
              onAddPart={() => addPart(openNode)}
              onToggleApprove={() => void toggleApprove(openNode)}
            />
          }
        />
      ) : (
        <p className="pp-empty">No versions yet.</p>
      )}

      <audio ref={audioRef} onEnded={() => setPlayState('idle')} hidden />
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </Shell>
  )
}

function Shell({ source, children }: { source: ProjectSource; children: React.ReactNode }) {
  return (
    <main className="project-page">
      {source.demoLabel && <p className="pp-demo">{source.demoLabel}</p>}
      {children}
    </main>
  )
}
