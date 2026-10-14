import { describe, expect, test } from 'claude-code/testing'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import type { CellRect, NodeStyle } from '../hooks/layout/geometry'
import { layoutGraph, layoutSeamView } from '../hooks/layout/graph-layout'
import { prSmallJson } from './fixtures/models'

const style: NodeStyle = { diff: 'unchanged', isInferred: false, isGroup: false, isFaded: false }
const load = (): BehaviourModel => {
  const r = parseBehaviourModel(prSmallJson)
  if ('error' in r) throw new Error(r.error)
  return r.model
}
const overlap = (a: CellRect, b: CellRect) =>
  a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows

const expectDisjointWithin = (rects: CellRect[], maxCols: number) => {
  for (const r of rects) {
    expect(r.col).toBeGreaterThanOrEqual(0)
    expect(r.cols).toBeGreaterThanOrEqual(1)
    expect(r.col + r.cols).toBeLessThanOrEqual(maxCols)
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
}

describe('layoutGraph', () => {
  test('lays out 3 nodes with non-overlapping cell rects', async () => {
    const l = await layoutGraph(
      {
        nodes: ['a', 'b', 'c'].map(id => ({ id, label: `node ${id}`, style })),
        edges: [
          { id: 'e1', from: 'a', to: 'b', isError: false },
          { id: 'e2', from: 'a', to: 'c', isError: false },
        ],
      },
      { maxCols: 80, direction: 'DOWN' },
    )
    expect(l.nodes).toHaveLength(3)
    for (const n of l.nodes) {
      expect(Number.isInteger(n.rect.col) && Number.isInteger(n.rect.row)).toBe(true)
      expect(n.rect.col).toBeGreaterThanOrEqual(0)
      expect(n.rect.row).toBeGreaterThanOrEqual(0)
      expect(n.rect.rows).toBe(3)
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(l.nodes[i]!.rect, l.nodes[j]!.rect)).toBe(false)
  })

  test('edges have at least 2 points', async () => {
    const l = await layoutGraph(
      {
        nodes: ['a', 'b'].map(id => ({ id, label: id, style })),
        edges: [{ id: 'e1', from: 'a', to: 'b', label: 'go', isError: true }],
      },
      { maxCols: 80, direction: 'RIGHT' },
    )
    expect(l.edges[0]!.points.length).toBeGreaterThanOrEqual(2)
    expect(l.edges[0]!.label).toBe('go')
    expect(l.edges[0]!.style.isError).toBe(true)
  })

  test('fits maxCols, truncating labels', async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `a rather long label number ${i}`, style }))
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: 'n0', to: n.id, isError: false }))
    const l = await layoutGraph({ nodes, edges }, { maxCols: 60, direction: 'DOWN' })
    expect(l.cols).toBeLessThanOrEqual(60)
    for (const n of l.nodes) expect(n.rect.col + n.rect.cols).toBeLessThanOrEqual(60)
    expect(l.nodes.some(n => n.label.endsWith('…'))).toBe(true)
    for (let i = 0; i < l.nodes.length; i++)
      for (let j = i + 1; j < l.nodes.length; j++) expect(overlap(l.nodes[i]!.rect, l.nodes[j]!.rect)).toBe(false)
  })

  test('layout of 20 nodes completes', async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `node ${i}`, style }))
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${Math.floor(i / 2)}`, to: n.id, isError: false }))
    const l = await layoutGraph({ nodes, edges }, { maxCols: 120, direction: 'DOWN' })
    expect(l.nodes).toHaveLength(20)
    expectDisjointWithin(l.nodes.map(n => n.rect), 120)
    expect(l.edges).toHaveLength(19)
  })

  test('a single layer of 16 nodes squeezed into 40 cols stays disjoint and in bounds', async () => {
    const nodes = [{ id: 'root', label: 'root', style }, ...Array.from({ length: 16 }, (_, i) => ({ id: `k${i}`, label: `child number ${i}`, style }))]
    const edges = nodes.slice(1).map(n => ({ id: `e-${n.id}`, from: 'root', to: n.id, isError: false, isSeamCrossing: true }))
    const l = await layoutGraph({ nodes, edges }, { maxCols: 40, direction: 'DOWN' })
    expect(l.cols).toBeLessThanOrEqual(40)
    expectDisjointWithin(l.nodes.map(n => n.rect), 40)
    for (const e of l.edges) {
      expect(e.style.isSeamCrossing).toBe(true)
      for (const p of e.points) expect(p.col).toBeLessThan(40)
      const to = l.nodes.find(n => n.id === e.to)!.rect
      const last = e.points[e.points.length - 1]!
      expect(last.col >= to.col && last.col < to.col + to.cols).toBe(true)
    }
  })

  test('is deterministic', async () => {
    const input = {
      nodes: ['a', 'b', 'c'].map(id => ({ id, label: id, style })),
      edges: [{ id: 'e1', from: 'a', to: 'b', isError: false }, { id: 'e2', from: 'b', to: 'c', isError: false }],
    }
    const a = await layoutGraph(input, { maxCols: 80, direction: 'DOWN' })
    const b = await layoutGraph(input, { maxCols: 80, direction: 'DOWN' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('layoutSeamView', () => {
  test('a flow node with no Evidence is drawn as Inferred', async () => {
    const view = {
      subjectId: 'x',
      status: 'built' as const,
      nodes: [{ id: 'n1', label: 'n1', kind: 'step' as const, diff: 'unchanged' as const, evidence: [] }],
      edges: [],
    }
    const l = await layoutSeamView(view, { maxCols: 80, showErrors: true })
    expect(l.nodes.find(n => n.id === 'n1')!.style.isInferred).toBe(true)
  })

  test('hides isError edges and error-only nodes when showErrors is false', async () => {
    const view = load().seamViews['order-service']!
    const hidden = await layoutSeamView(view, { maxCols: 80, showErrors: false })
    expect(hidden.edges.some(e => e.style.isError)).toBe(false)
    expect(hidden.nodes.map(n => n.id)).not.toContain('n3')
    expect(hidden.nodes).toHaveLength(3)
    const shown = await layoutSeamView(view, { maxCols: 80, showErrors: true })
    expect(shown.nodes).toHaveLength(4)
    expect(shown.edges.filter(e => e.style.isError)).toHaveLength(1)
    expect(shown.nodes.find(n => n.id === 'n3')!.style.isError).toBe(true)
    expect(shown.nodes.find(n => n.id === 'n3')!.style.diff).toBe('added')
  })
})
