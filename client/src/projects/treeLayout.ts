// Layout for the "growing tree": the original sits at the bottom on a ground
// line and versions grow upward, each above the one it was built on. Leaves
// take the next slot across, a parent is centred over its children, and each
// node's largest branch is kept in the middle so the tree grows a trunk.
// Pure math with fixed sizes, so it needs no DOM measurement.
import type { VersionNode } from './types.ts'
import { descendantCounts, type VersionTree } from './versionTree.ts'

/** Smallest tap area per dot; slots are wider, so neighbours never overlap. */
export const HIT = 44
/** Horizontal slot per leaf. */
export const SLOT = 120
/** Vertical distance between generations. */
export const STEP = 114
const PAD_X = 60
const PAD_TOP = 40
/** Space under the root for the ground line and its caption. */
const PAD_BOTTOM = 90
const GROUND_GAP = 44

export interface Point {
  x: number
  y: number
}

export interface Edge {
  to: number
  /** SVG path data for the branch. */
  d: string
  width: number
}

export interface TreeLayout {
  pos: Map<number, Point>
  width: number
  height: number
  /** y of the ground line. */
  ground: number
  edges: Edge[]
  trunkWidth: number
  /** Versions per generation, root row first, each row left to right. */
  rows: number[][]
}

/** Branch thickness for a version with `count` versions built on it. */
export const branchWidth = (count: number) => 2 + 2.3 * Math.sqrt(count + 1)

/** Children reordered so the biggest branch sits in the middle. */
function trunkOrder(kids: VersionNode[], size: Map<number, number>): VersionNode[] {
  const bySize = [...kids].sort((a, b) => size.get(b.version)! - size.get(a.version)!)
  const out: VersionNode[] = []
  bySize.forEach((k, i) => (i % 2 ? out.unshift(k) : out.push(k)))
  return out
}

/** A branch that leaves the parent straight up and bends into the child. */
function organic(a: Point, b: Point): string {
  const dy = a.y - b.y
  return `M${a.x} ${a.y} C${a.x} ${a.y - dy * 0.62} ${b.x} ${a.y - dy * 0.38} ${b.x} ${b.y}`
}

export function layoutTree(tree: VersionTree): TreeLayout {
  const empty: TreeLayout = { pos: new Map(), width: 0, height: 0, ground: 0, edges: [], trunkWidth: 0, rows: [] }
  if (!tree.root) return empty

  const size = descendantCounts(tree)

  const across = new Map<number, number>()
  const depth = new Map<number, number>()
  const shift = (version: number, dx: number) => {
    across.set(version, across.get(version)! + dx)
    for (const k of tree.children(version)) shift(k.version, dx)
  }
  // Returns the right edge of the subtree, starting at `cursor`.
  const walk = (node: VersionNode, d: number, cursor: number): number => {
    depth.set(node.version, d)
    const kids = trunkOrder(tree.children(node.version), size)
    if (!kids.length) {
      across.set(node.version, cursor + SLOT / 2)
      return cursor + SLOT
    }
    let right = cursor
    for (const k of kids) right = walk(k, d + 1, right)
    const mid = (across.get(kids[0].version)! + across.get(kids[kids.length - 1].version)!) / 2
    across.set(node.version, mid)
    if (mid - SLOT / 2 < cursor) {
      const dx = cursor - (mid - SLOT / 2)
      shift(node.version, dx)
      right += dx
    }
    return Math.max(right, across.get(node.version)! + SLOT / 2)
  }
  const treeWidth = walk(tree.root, 0, 0)
  const maxDepth = Math.max(...depth.values())

  const pos = new Map<number, Point>()
  for (const [version, d] of depth) {
    pos.set(version, { x: PAD_X + across.get(version)!, y: PAD_TOP + (maxDepth - d) * STEP })
  }
  const rootPos = pos.get(tree.root.version)!
  const ground = rootPos.y + GROUND_GAP

  const edges: Edge[] = []
  for (const node of tree.nodes) {
    const p = tree.parentOf(node.version)
    if (p === null) continue
    edges.push({
      to: node.version,
      d: organic(pos.get(p)!, pos.get(node.version)!),
      width: branchWidth(size.get(node.version)!),
    })
  }

  const rows: number[][] = Array.from({ length: maxDepth + 1 }, () => [])
  for (const [version, d] of depth) rows[d].push(version)
  for (const row of rows) row.sort((a, b) => pos.get(a)!.x - pos.get(b)!.x)

  return {
    pos,
    width: treeWidth + PAD_X * 2,
    height: rootPos.y + PAD_BOTTOM,
    ground,
    edges,
    trunkWidth: branchWidth(size.get(tree.root.version)!),
    rows,
  }
}
