import { describe, expect, it } from 'vitest'
import { DEMO_PROJECT } from './demoProject.ts'
import { HIT, layoutTree } from './treeLayout.ts'
import type { VersionNode } from './types.ts'
import { buildTree } from './versionTree.ts'

function v(version: number, parentVersion?: number): VersionNode {
  return {
    id: `c${version}`,
    projectId: 'p1',
    contributorId: 'u1',
    version,
    note: null,
    recordingId: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    parentVersion,
  }
}

describe('layoutTree', () => {
  it('puts a lone original at the bottom centre with no branches', () => {
    const layout = layoutTree(buildTree([v(1)]))
    const root = layout.pos.get(1)!
    expect(layout.edges).toEqual([])
    expect(root.x).toBeCloseTo(layout.width / 2)
    expect(root.y).toBeLessThan(layout.ground)
    expect(layout.ground).toBeLessThan(layout.height)
  })

  it('draws every child above its parent', () => {
    const tree = buildTree([v(1), v(2, 1), v(3, 2), v(4, 1), v(5, 4)])
    const layout = layoutTree(tree)
    for (const node of tree.nodes) {
      const p = tree.parentOf(node.version)
      if (p !== null) expect(layout.pos.get(node.version)!.y).toBeLessThan(layout.pos.get(p)!.y)
    }
  })

  it('keeps the largest branch in the middle', () => {
    // v2 holds 1 version, v3 holds 4, v4 holds 2.
    const tree = buildTree([v(1), v(2, 1), v(3, 1), v(4, 1), v(5, 3), v(6, 5), v(7, 6), v(8, 4)])
    const layout = layoutTree(tree)
    const xs = [2, 3, 4].map((n) => layout.pos.get(n)!.x).sort((a, b) => a - b)
    expect(layout.pos.get(3)!.x).toBe(xs[1])
  })

  it('centres a parent over its first and last child', () => {
    const tree = buildTree([v(1), v(2, 1), v(3, 1), v(4, 1)])
    const layout = layoutTree(tree)
    const xs = [2, 3, 4].map((n) => layout.pos.get(n)!.x)
    expect(layout.pos.get(1)!.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2)
  })

  it('makes a branch thicker the more is built on it', () => {
    const tree = buildTree([v(1), v(2, 1), v(3, 2), v(4, 3), v(5, 1)])
    const layout = layoutTree(tree)
    const into = (n: number) => layout.edges.find((e) => e.to === n)!
    expect(into(2).width).toBeGreaterThan(into(5).width)
    expect(layout.trunkWidth).toBeGreaterThan(into(2).width)
  })

  it('never lets two dots in a row overlap their tap areas', () => {
    const layout = layoutTree(buildTree(DEMO_PROJECT.versions))
    for (const row of layout.rows) {
      const xs = row.map((n) => layout.pos.get(n)!.x)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(HIT)
    }
  })

  it('lists each row left to right by drawn position', () => {
    const layout = layoutTree(buildTree(DEMO_PROJECT.versions))
    expect(layout.rows[0]).toEqual([1])
    for (const row of layout.rows) {
      const xs = row.map((n) => layout.pos.get(n)!.x)
      expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    }
    expect(layout.rows.flat().sort((a, b) => a - b)).toEqual(DEMO_PROJECT.versions.map((n) => n.version))
  })

  it('has no layout for an empty tree', () => {
    const layout = layoutTree(buildTree([]))
    expect(layout.pos.size).toBe(0)
    expect(layout.rows).toEqual([])
  })
})
