// The "growing tree": every version is a dot above the one it was built on,
// branches thicken with what is built on them, and the open version's card
// floats beside the tree (wide screens) or sits under it (narrow ones).
// Keyboard: the tree is one tab stop; arrows move between dots.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { firstName, timeAgo, versionLabel, who } from './format.ts'
import type { TreeLayout } from './treeLayout.ts'
import type { VersionNode } from './types.ts'
import type { VersionTree as Tree } from './versionTree.ts'

const CARD_W = 300
const CARD_GAP = 70

export interface VersionTreeProps {
  tree: Tree
  layout: TreeLayout
  open: number
  lineage: number[]
  ownerName: string | null
  onSelect: (version: number) => void
  /** The open version's card. */
  card: ReactElement
  /** Float the card beside the tree (true) or put it under (false). */
  wide: boolean
}

function dotSize(node: VersionNode, isRoot: boolean) {
  return isRoot ? 22 : node.approved ? 19 : 15
}

export default function VersionTree({ tree, layout, open, lineage, ownerName, onSelect, card, wide }: VersionTreeProps) {
  const [focusV, setFocusV] = useState(open)
  const [focusFor, setFocusFor] = useState(open)
  const [pop, setPop] = useState<number | null>(null)
  const [listView, setListView] = useState(false)
  const [cardH, setCardH] = useState(0)
  const lastPointer = useRef<string>('mouse')
  const dots = useRef(new Map<number, HTMLButtonElement>())
  const cardBox = useRef<HTMLDivElement>(null)
  const below = useRef<HTMLDivElement>(null)
  const rootV = tree.root!.version
  const onLineage = useMemo(() => new Set(lineage), [lineage])

  // A newly opened version becomes the tab stop.
  if (focusFor !== open) {
    setFocusFor(open)
    setFocusV(open)
  }

  // Bring the open dot into view, and on narrow screens the card too.
  useEffect(() => {
    dots.current.get(open)?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    if (!wide) below.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open, wide])

  // The floating card's height decides where it sits next to its dot.
  useLayoutEffect(() => {
    const box = cardBox.current
    if (!wide || !box || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setCardH(box.offsetHeight))
    observer.observe(box)
    return () => observer.disconnect()
  }, [wide, listView])

  const openPos = layout.pos.get(open)!
  const stageW = layout.width + (wide ? CARD_W + CARD_GAP : 0)
  const stageH = Math.max(layout.height, wide ? cardH + 40 : 0)
  const cardX = layout.width + CARD_GAP - 30
  const cardY = Math.max(20, Math.min(stageH - cardH - 20, openPos.y - cardH / 2))
  const leaderY = Math.max(cardY + 24, Math.min(cardY + cardH - 24, openPos.y))

  function move(from: number, key: string): number | null {
    if (key === 'ArrowDown') return tree.parentOf(from)
    if (key === 'ArrowUp') {
      const kids = tree.children(from).map((k) => k.version)
      kids.sort((a, b) => layout.pos.get(a)!.x - layout.pos.get(b)!.x)
      return kids.length ? kids[Math.floor((kids.length - 1) / 2)] : null
    }
    if (key === 'Home') return rootV
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const row = layout.rows.find((r) => r.includes(from))!
      const i = row.indexOf(from) + (key === 'ArrowLeft' ? -1 : 1)
      return row[i] ?? null
    }
    return null
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, version: number) {
    if (e.key === 'Escape') {
      setPop(null)
      return
    }
    const next = move(version, e.key)
    if (e.key.startsWith('Arrow') || e.key === 'Home') e.preventDefault()
    if (next === null) return
    setFocusV(next)
    dots.current.get(next)?.focus()
  }

  const popNode = pop !== null ? tree.get(pop) : undefined
  const popPos = pop !== null ? layout.pos.get(pop) : undefined
  const popLeft = popPos && popPos.x + 250 > stageW

  return (
    <section className="version-tree" aria-label="Versions">
      <div className="vt-head">
        <h2>Versions</h2>
        <p className="vt-legend">
          <span className="key approved" /> approved <span className="key lin" /> path to the open version
        </p>
        <button type="button" className="btn small" aria-pressed={listView} onClick={() => setListView((on) => !on)}>
          List view
        </button>
      </div>

      {listView ? (
        <VersionList tree={tree} version={rootV} open={open} onSelect={onSelect} />
      ) : (
        <div className="vt-pane">
          <div className="vt-stage" style={{ width: stageW, height: stageH }}>
            <svg className="vt-svg" width={stageW} height={stageH} aria-hidden="true">
              <line x1={20} x2={layout.width - 20} y1={layout.ground} y2={layout.ground} className="vt-ground" />
              <text x={layout.pos.get(rootV)!.x} y={layout.ground + 22} textAnchor="middle" className="vt-caption">
                {tree.root!.contributorDisplayName ? `${firstName(who(tree.root!))}’s original` : 'The original'} ·{' '}
                {timeAgo(tree.root!.createdAt)}
              </text>
              <path
                d={`M${layout.pos.get(rootV)!.x} ${layout.ground} L${layout.pos.get(rootV)!.x} ${layout.pos.get(rootV)!.y}`}
                className="vt-branch lin"
                strokeWidth={layout.trunkWidth}
              />
              {layout.edges.map((e) => {
                const child = tree.get(e.to)!
                const cls = child.approved ? 'approved' : onLineage.has(e.to) ? 'lin' : 'rest'
                return <path key={e.to} d={e.d} className={`vt-branch ${cls}`} strokeWidth={e.width} />
              })}
              {wide && cardH > 0 && (
                <path
                  d={`M${openPos.x + 14} ${openPos.y} L${cardX} ${leaderY}`}
                  className="vt-leader"
                  data-testid="leader"
                />
              )}
            </svg>

            {tree.nodes.map((node) => {
              const p = layout.pos.get(node.version)!
              const isRoot = node.version === rootV
              const cls = [
                'vt-dot',
                node.approved && 'approved',
                isRoot && 'orig',
                node.version === open && 'sel',
                onLineage.has(node.version) && 'lin',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={node.version}
                  ref={(el) => {
                    if (el) dots.current.set(node.version, el)
                    else dots.current.delete(node.version)
                  }}
                  type="button"
                  className={cls}
                  style={{ left: p.x, top: p.y, ['--s' as string]: `${dotSize(node, isRoot)}px` }}
                  tabIndex={node.version === focusV ? 0 : -1}
                  aria-label={versionLabel(node, isRoot)}
                  aria-current={node.version === open || undefined}
                  aria-describedby={pop === node.version ? 'vt-popout' : undefined}
                  onPointerDown={(e) => (lastPointer.current = e.pointerType)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setPop(node.version)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setPop((cur) => (cur === node.version ? null : cur))}
                  onFocus={() => {
                    setFocusV(node.version)
                    if (lastPointer.current !== 'touch') setPop(node.version)
                  }}
                  onBlur={() => setPop((cur) => (cur === node.version ? null : cur))}
                  onKeyDown={(e) => {
                    lastPointer.current = 'keyboard'
                    onKeyDown(e, node.version)
                  }}
                  onClick={() => {
                    if (lastPointer.current === 'touch') setPop(null)
                    onSelect(node.version)
                  }}
                >
                  <i />
                </button>
              )
            })}

            {popNode && popPos && (
              <div
                id="vt-popout"
                role="tooltip"
                className={`vt-pop${popLeft ? ' left' : ''}`}
                style={{ left: popLeft ? popPos.x - 22 : popPos.x + 22, top: popPos.y }}
              >
                <strong>
                  v{popNode.version} · {who(popNode)}
                </strong>
                <span className="vt-pop-meta">{timeAgo(popNode.createdAt)}</span>
                {popNode.skillsAdded?.length ? <span>+ {popNode.skillsAdded.join(', ')}</span> : null}
                {popNode.note && <span className="vt-pop-note">{popNode.note}</span>}
                {popNode.approved && (
                  <span className="badge">Approved{ownerName ? ` by ${firstName(ownerName)}` : ''}</span>
                )}
              </div>
            )}

            {wide && (
              <div ref={cardBox} className="vt-float" style={{ left: cardX, top: cardY, width: CARD_W }}>
                {card}
              </div>
            )}
          </div>
        </div>
      )}

      {(!wide || listView) && (
        <div ref={below} className="vt-below">
          {card}
        </div>
      )}
    </section>
  )
}

function VersionList({
  tree,
  version,
  open,
  onSelect,
}: {
  tree: Tree
  version: number
  open: number
  onSelect: (version: number) => void
}) {
  const node = tree.get(version)!
  const kids = tree.children(version)
  return (
    <ul className="vt-list">
      <li>
        <button type="button" aria-current={version === open || undefined} onClick={() => onSelect(version)}>
          v{version} · {who(node)}
          {node.skillsAdded?.length ? ` · + ${node.skillsAdded.join(', ')}` : ''}
          {node.approved ? ' · Approved' : ''}
        </button>
        {kids.length > 0 &&
          kids.map((k) => <VersionList key={k.version} tree={tree} version={k.version} open={open} onSelect={onSelect} />)}
      </li>
    </ul>
  )
}
