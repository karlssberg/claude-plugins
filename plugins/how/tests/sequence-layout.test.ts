import { describe, expect, test } from 'claude-code/testing'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import { HEADER } from '../hooks/layout/geometry'
import { layoutBehaviourView } from '../hooks/layout/sequence-layout'
import { prSmallJson } from './fixtures/models'

const load = (): BehaviourModel => {
  const r = parseBehaviourModel(prSmallJson)
  if ('error' in r) throw new Error(r.error)
  return r.model
}
const opts = { maxCols: 120, showErrors: false }

describe('layoutBehaviourView', () => {
  test('entry point is the first lifeline', () => {
    const m = load()
    const b = m.behaviours.find(x => x.id === 'b-cancel')! // entry order-service, first step from client
    const l = layoutBehaviourView(b, m, opts)
    expect(l.nodes[0]!.id).toBe('order-service')
    const cols = l.nodes.map(n => n.rect.col)
    expect(cols).toEqual([...cols].sort((a, c) => a - c))
  })

  test('one row per step in order', () => {
    const m = load()
    const b = m.behaviours[0]!
    const l = layoutBehaviourView(b, m, opts)
    expect(l.edges.map(e => e.id)).toEqual(b.steps.map(s => s.id))
    const rows = l.edges.map(e => e.points[0]!.row)
    expect(new Set(rows).size).toBe(rows.length)
    expect(rows).toEqual([...rows].sort((a, c) => a - c))
    expect(l.edges[2]!.style.isSeamCrossing).toBe(true)
    expect(l.edges[2]!.style.diff).toBe('changed')
    expect(l.edges[0]!.style.isSeamCrossing).toBe(false)
  })

  test('single-element behaviour with zero steps yields one lifeline and no edges', () => {
    const m = load()
    const b = { ...m.behaviours[0]!, elementIds: ['payments'], entryPointId: 'payments', steps: [], errorFlows: [] }
    const l = layoutBehaviourView(b, m, opts)
    expect(l.nodes.length).toBe(1)
    expect(l.edges.length).toBe(0)
    expect(l.rows).toBeGreaterThan(HEADER.rows)
  })

  test('250-char label is truncated with …', () => {
    const m = load()
    const b = structuredClone(m.behaviours[0]!)
    b.steps[0]!.label = 'x'.repeat(250)
    const l = layoutBehaviourView(b, m, opts)
    const label = l.edges[0]!.label
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThan(60)
  })

  test('showErrors adds dashed error rows after origin step', () => {
    const m = load()
    const b = m.behaviours[0]!
    const off = layoutBehaviourView(b, m, opts)
    const on = layoutBehaviourView(b, m, { ...opts, showErrors: true })
    expect(on.edges.length).toBe(off.edges.length + 1)
    const ids = on.edges.map(e => e.id)
    const i = ids.indexOf('error:ef1:0')
    expect(i).toBe(ids.indexOf('s3') + 1)
    const e = on.edges[i]!
    expect(e.style.isError).toBe(true)
    expect(e.to).toBe('error-mw')
    expect(e.points[0]!.row).toBeGreaterThan(on.edges[i - 1]!.points[0]!.row)
  })

  test('fits within maxCols', () => {
    const m = load()
    for (const maxCols of [40, 60, 120]) {
      const l = layoutBehaviourView(m.behaviours[0]!, m, { maxCols, showErrors: true })
      expect(l.cols).toBeLessThanOrEqual(maxCols)
      for (const n of l.nodes) expect(n.rect.col + n.rect.cols).toBeLessThanOrEqual(maxCols)
      for (const e of l.edges) for (const p of e.points) expect(p.col).toBeLessThanOrEqual(maxCols)
    }
  })

  test('elements outside the Behaviour elementIds that its Steps touch are drawn isFaded', () => {
    const m = load()
    const b = { ...structuredClone(m.behaviours[0]!), elementIds: ['client', 'orders-api', 'order-service', 'inventory', 'payments', 'error-mw'] }
    const l = layoutBehaviourView(b, m, opts)
    const repo = l.nodes.find(n => n.id === 'order-repo')!
    expect(repo.style.isFaded).toBe(true)
    expect(l.nodes.find(n => n.id === 'payments')!.style.isFaded).toBe(false)
  })

  test('folds beyond the node budget into a group lifeline with merged internal steps', () => {
    const m = load()
    const elements = { ...m.elements }
    const ids = ['client', 'orders-api']
    for (let i = 0; i < 20; i++) {
      elements[`x${i}`] = { id: `x${i}`, name: `X${i}`, level: 'code', parentId: 'pkg', evidence: [] }
      ids.push(`x${i}`)
    }
    elements.pkg = { id: 'pkg', name: 'Pkg', level: 'component', evidence: [] }
    const b = {
      ...m.behaviours[0]!,
      elementIds: ids,
      steps: [
        { ...m.behaviours[0]!.steps[0]! },
        { ...m.behaviours[0]!.steps[0]!, id: 'i1', from: 'x0', to: 'x1', label: 'a' },
        { ...m.behaviours[0]!.steps[0]!, id: 'i2', from: 'x1', to: 'x2', label: 'b' },
      ],
      errorFlows: [],
    }
    const l = layoutBehaviourView(b, { ...m, elements }, opts)
    const g = l.nodes.find(n => n.style.isGroup)!
    expect(g.id).toBe('group:pkg')
    expect(l.nodes.length).toBeLessThanOrEqual(12)
    const internal = l.edges.filter(e => e.from === g.id && e.to === g.id)
    expect(internal.length).toBe(1)
    expect(internal[0]!.label).toBe('2 internal steps')
    const expanded = layoutBehaviourView(b, { ...m, elements }, { ...opts, expandedGroups: ['group:pkg'] })
    expect(expanded.nodes.some(n => n.id === 'x0')).toBe(true)
  })
})
