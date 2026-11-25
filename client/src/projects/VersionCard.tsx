import { forwardRef } from 'react'
import { approvedLabel, timeAgo, who } from './format.ts'
import type { VersionNode } from './types.ts'

export type PlayState = 'idle' | 'loading' | 'playing'

export interface VersionCardProps {
  node: VersionNode
  isRoot: boolean
  parentVersion: number | null
  childCount: number
  ownerName: string | null
  isOwner: boolean
  approvePending: boolean
  playState: PlayState
  downloading: boolean
  /** A result or error to show on the card, e.g. "Couldn't approve v3." */
  message: string | null
  onTogglePlay: () => void
  onDownload: () => void
  onAddPart: () => void
  onToggleApprove: () => void
  className?: string
  style?: React.CSSProperties
}

/** The open version in full: details, Play, Download, and the owner's Approve. */
const VersionCard = forwardRef<HTMLElement, VersionCardProps>(function VersionCard(props, ref) {
  const { node, isRoot, parentVersion, childCount, ownerName, isOwner, playState } = props
  const v = `v${node.version}`
  const noRecording = node.recordingId === null
  const meta = [
    timeAgo(node.createdAt),
    parentVersion !== null ? `built on v${parentVersion}` : null,
    childCount ? `${childCount} built on this` : null,
  ].filter(Boolean)

  return (
    <article
      ref={ref}
      className={`version-card${node.approved ? ' approved' : ''}${props.className ? ` ${props.className}` : ''}`}
      style={props.style}
      aria-label={`Open version: ${v}`}
    >
      <div className="vc-line1">
        <span className="vc-num">{v}</span>
        {isRoot && <span className="badge start">Original</span>}
        {node.approved && (
          <span className="badge">{approvedLabel(ownerName)}</span>
        )}
      </div>
      <h3>
        {who(node)}
        {isRoot ? '’s original' : ''}
      </h3>
      <p className="vc-meta">{meta.join(' · ')}</p>
      {node.skillsAdded?.length ? (
        <ul className="chips" aria-label="Added">
          {node.skillsAdded.map((s) => (
            <li key={s}>+ {s}</li>
          ))}
        </ul>
      ) : null}
      {node.note && <p className="vc-note">{node.note}</p>}

      <div className="vc-actions">
        <button type="button" className="btn primary" onClick={props.onAddPart}>
          Add your part on top of {v}
        </button>
        <div className="vc-row">
          <button
            type="button"
            className="btn"
            onClick={props.onTogglePlay}
            disabled={noRecording}
            aria-busy={playState === 'loading' || undefined}
            aria-describedby={noRecording ? `norec-${node.version}` : undefined}
          >
            {playState === 'playing' ? `Pause ${v}` : playState === 'loading' ? 'Loading…' : `Play ${v}`}
          </button>
          <button
            type="button"
            className="btn"
            onClick={props.onDownload}
            disabled={noRecording || props.downloading}
            aria-busy={props.downloading || undefined}
            aria-describedby={noRecording ? `norec-${node.version}` : undefined}
          >
            {props.downloading ? 'Downloading…' : 'Download'}
          </button>
          {isOwner && (
            <button
              type="button"
              className="btn approve"
              aria-pressed={!!node.approved}
              onClick={props.onToggleApprove}
              disabled={props.approvePending}
              aria-busy={props.approvePending || undefined}
            >
              {node.approved ? `Unapprove ${v}` : `Approve ${v}`}
            </button>
          )}
        </div>
        {noRecording && (
          <p className="vc-hint" id={`norec-${node.version}`}>
            No recording yet
          </p>
        )}
        {props.message && <p className="vc-message">{props.message}</p>}
      </div>
    </article>
  )
})

export default VersionCard
