import { describe, expect, it } from 'vitest'
import type { VersionNode } from './types.ts'
import { buildTree, defaultVersion, descendantCounts, lineage } from './versionTree.ts'

let day = 0
function v(version: number, extra: Partial<VersionNode> = {}): VersionNode {
  day += 1
  return {
    id: `c${version}-${day}`,
    projectId: 'p1',
    contributorId: 'u1',
    version,
    note: null,
    recordingId: null,
    createdAt: new Date(Date.UTC(2026, 10, day)).toISOString(),
    ...extra,
  }
}

describe('buildTree', () => {
  it('chains versions with no parent into a straight trunk', () => {
    const tree = buildTree([1, 2, 3, 4, 5].map((n) => v(n)))
    expect(tree.root?.version).toBe(1)
    expect([1, 2, 3, 4].map((n) => tree.children(n).map((c) => c.version))).toEqual([[2], [3], [4], [5]])
    expect(tree.children(5)).toEqual([])
  })

  it('branches on explicit parents', () => {
    const tree = buildTree([v(1), v(2), v(3, { parentVersion: 2 }), v(4, { parentVersion: 2 })])
    expect(tree.children(2).map((c) => c.version)).toEqual([3, 4])
    expect(tree.parentOf(4)).toBe(2)
  })

  it('falls back to the version below for a missing or later parent', () => {
    const tree = buildTree([v(1), v(2), v(3, { parentVersion: 9 }), v(4, { parentVersion: 4 }), v(5, { parentVersion: 6 }), v(6)])
    expect(tree.parentOf(3)).toBe(2)
    expect(tree.parentOf(4)).toBe(3)
    expect(tree.parentOf(5)).toBe(4)
  })

  it('attaches to the root when the version below is missing too', () => {
    const tree = buildTree([v(1), v(4, { parentVersion: 9 })])
    expect(tree.parentOf(4)).toBe(1)
  })

  it('keeps the earliest of two versions with the same number', () => {
    const first = v(2, { note: 'first' })
    const tree = buildTree([v(1), v(2, { note: 'second', createdAt: '2027-01-01T00:00:00.000Z' }), first])
    expect(tree.get(2)?.note).toBe('first')
    expect(tree.nodes).toHaveLength(2)
  })

  it('roots at the lowest version when there is no v1', () => {
    const tree = buildTree([v(3), v(5)])
    expect(tree.root?.version).toBe(3)
    expect(tree.parentOf(3)).toBeNull()
    expect(tree.parentOf(5)).toBe(3)
  })

  it('has no root for an empty list', () => {
    const tree = buildTree([])
    expect(tree.root).toBeNull()
    expect(tree.nodes).toEqual([])
  })
})

describe('defaultVersion', () => {
  it('opens the newest approved version', () => {
    const tree = buildTree([
      v(1),
      v(6, { parentVersion: 1, approved: true, createdAt: '2026-11-10T00:00:00.000Z' }),
      v(9, { parentVersion: 1, approved: true, createdAt: '2026-11-12T00:00:00.000Z' }),
      v(10, { parentVersion: 1, createdAt: '2026-11-20T00:00:00.000Z' }),
    ])
    expect(defaultVersion(tree)).toBe(9)
  })

  it('breaks a tie on time with the higher version', () => {
    const at = '2026-11-12T00:00:00.000Z'
    const tree = buildTree([v(1), v(2, { approved: true, createdAt: at }), v(3, { approved: true, createdAt: at })])
    expect(defaultVersion(tree)).toBe(3)
  })

  it('opens the original when nothing is approved', () => {
    expect(defaultVersion(buildTree([v(1), v(2), v(3)]))).toBe(1)
  })

  it('is null with no versions', () => {
    expect(defaultVersion(buildTree([]))).toBeNull()
  })
})

describe('lineage and descendants', () => {
  const tree = buildTree([
    v(1),
    v(2, { parentVersion: 1 }),
    v(3, { parentVersion: 2 }),
    v(4, { parentVersion: 1 }),
    v(7, { parentVersion: 3 }),
  ])

  it('walks from a version down to the root', () => {
    expect(lineage(tree, 7)).toEqual([7, 3, 2, 1])
    expect(lineage(tree, 1)).toEqual([1])
  })

  it('counts everything built on a version', () => {
    expect(descendantCounts(tree).get(1)).toBe(4)
    expect(descendantCounts(tree).get(2)).toBe(2)
    expect(descendantCounts(tree).get(7)).toBe(0)
  })
})
