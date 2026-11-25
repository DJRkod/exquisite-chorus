// Turns a project's versions into a tree the page can draw. The data may be
// incomplete or inconsistent (no parent links yet, repeated version numbers),
// so this repairs it first: every parent has a lower version number than its
// child, which rules out cycles, and every version ends up under one root.
import type { VersionNode } from './types.ts'

export interface VersionTree {
  /** The original (lowest version), or null when there are no versions. */
  root: VersionNode | null
  /** Every version, oldest number first. */
  nodes: VersionNode[]
  get(version: number): VersionNode | undefined
  /** The version this one was built on; null for the root. */
  parentOf(version: number): number | null
  /** Versions built directly on this one, lowest number first. */
  children(version: number): VersionNode[]
}

const time = (node: VersionNode) => Date.parse(node.createdAt) || 0

export function buildTree(versions: VersionNode[]): VersionTree {
  // One node per version number; the earliest upload wins a repeat.
  const byVersion = new Map<number, VersionNode>()
  for (const node of versions) {
    const seen = byVersion.get(node.version)
    if (!seen || time(node) < time(seen)) byVersion.set(node.version, node)
  }
  const nodes = [...byVersion.values()].sort((a, b) => a.version - b.version)
  const root = nodes[0] ?? null

  const parent = new Map<number, number | null>()
  const kids = new Map<number, VersionNode[]>()
  for (const node of nodes) {
    kids.set(node.version, [])
    if (node === root) {
      parent.set(node.version, null)
      continue
    }
    const stated = node.parentVersion
    const below = node.version - 1
    const p =
      stated != null && stated < node.version && byVersion.has(stated)
        ? stated
        : byVersion.has(below)
          ? below
          : root!.version
    parent.set(node.version, p)
    kids.get(p)!.push(node)
  }

  return {
    root,
    nodes,
    get: (version) => byVersion.get(version),
    parentOf: (version) => parent.get(version) ?? null,
    children: (version) => kids.get(version) ?? [],
  }
}

/** The version the page opens on: the newest approved one, else the original. */
export function defaultVersion(tree: VersionTree): number | null {
  let best: VersionNode | null = null
  for (const node of tree.nodes) {
    if (!node.approved) continue
    if (!best || time(node) > time(best) || (time(node) === time(best) && node.version > best.version)) best = node
  }
  return best?.version ?? tree.root?.version ?? null
}

/** From a version down to the original, e.g. [7, 3, 2, 1]. */
export function lineage(tree: VersionTree, version: number): number[] {
  const out: number[] = []
  for (let v: number | null = tree.get(version) ? version : null; v !== null; v = tree.parentOf(v)) out.push(v)
  return out
}

/** How many versions are built on this one, directly or further up. */
export function descendantCount(tree: VersionTree, version: number): number {
  return tree.children(version).reduce((sum, child) => sum + 1 + descendantCount(tree, child.version), 0)
}
