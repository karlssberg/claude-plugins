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
    const b = JSON.parse(JSON.stringify((m.behaviours[0]!))) as typeof m.behaviours[0]
    b.steps[0]!.label = 'x'.repeat(250)
    const l = layoutBehaviourView(b, m, opts)
    const label = l.edges[0]!.label
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThan(60)
  })

  test('showErrors adds one error row per hop after the origin step', () => {
    const m = load()
    const b = m.behaviours[0]!
    const off = layoutBehaviourView(b, m, opts)
    const on = layoutBehaviourView(b, m, { ...opts, showErrors: true })
    expect(on.edges.length).toBe(off.edges.length + 2)
    const ids = on.edges.map(e => e.id)
    const i = ids.indexOf('error:ef1:0')
    expect(i).toBe(ids.indexOf('s3') + 1)
    expect(ids[i + 1]).toBe('error:ef1:1')
    const [hop, handled] = [on.edges[i]!, on.edges[i + 1]!]
    expect([hop.from, hop.to, hop.label, hop.style.isSeamCrossing]).toEqual(['inventory', 'order-service', 'OutOfStockError', true])
    expect([handled.from, handled.to, handled.label]).toEqual(['order-service', 'error-mw', 'handled'])
    expect(hop.style.isError).toBe(true)
    expect(handled.points[0]!.row).toBeGreaterThan(hop.points[0]!.row)
  })

  test('multi-transform flow without handler walks back across seams then self-loops unhandled', () => {
    const m = load()
    const b = JSON.parse(JSON.stringify(m.behaviours[0]!)) as typeof m.behaviours[0]
    b!.errorFlows = [
      { id: 'efx', originStepId: 's5', transforms: [{ seamId: 'seam-repo', into: 'DbError', evidence: [] }, { seamId: 'seam-nope', into: 'Lost', evidence: [] }], isSwallowed: true, isCatchAll: false, diff: 'added' },
    ]
    const l = layoutBehaviourView(b!, m, { ...opts, showErrors: true })
    const rows = l.edges.filter(e => e.id.startsWith('error:efx'))
    expect(rows.map(e => e.id)).toEqual(['error:efx:0', 'error:efx:1', 'error:efx:2'])
    expect(rows.map(e => e.label)).toEqual(['DbError', 'Lost', 'unhandled'])
    expect(rows[0]!.from).toBe('order-repo')
    expect(rows[0]!.to).toBe('order-service')
    expect(rows[1]!.from).toBe(rows[1]!.to)
    expect(rows[2]!.from).toBe(rows[2]!.to)
    expect(rows[2]!.style.isSwallowed).toBe(true)
  })

  test('error rows follow their own origin even when errorFlows are out of order', () => {
    const m = load()
    const b = JSON.parse(JSON.stringify(m.behaviours[0]!)) as typeof m.behaviours[0]
    const mk = (id: string, origin: string) => ({ id, originStepId: origin, transforms: [], isSwallowed: false, isCatchAll: false, diff: 'unchanged' as const })
    b!.errorFlows = [mk('late', 's5'), mk('early', 's2')]
    const ids = layoutBehaviourView(b!, m, { ...opts, showErrors: true }).edges.map(e => e.id)
    expect(ids.indexOf('error:early:0')).toBe(ids.indexOf('s2') + 1)
    expect(ids.indexOf('error:late:0')).toBe(ids.indexOf('s5') + 1)
  })

  test('12+ pinned lifelines at maxCols 40 stay within width with legible headers', () => {
    const m = load()
    const elements = { ...m.elements }
    const ids: string[] = []
    const steps = []
    for (let i = 0; i < 13; i++) {
      elements[`y${i}`] = { id: `y${i}`, name: `Svc${i}`, level: 'code', evidence: [] }
      ids.push(`y${i}`)
      if (i) steps.push({ ...m.behaviours[0]!.steps[0]!, id: `t${i}`, order: i, from: `y${i - 1}`, to: `y${i}`, label: 'call', diff: 'changed' as const })
    }
    const b = { ...m.behaviours[0]!, entryPointId: 'y0', elementIds: ids, steps, errorFlows: [] }
    const l = layoutBehaviourView(b, { ...m, elements }, { maxCols: 40, showErrors: false })
    expect(l.cols).toBeLessThanOrEqual(40)
    for (const n of l.nodes) expect(n.rect.col + n.rect.cols).toBeLessThanOrEqual(40)
    expect(l.nodes.some(n => n.label !== '…')).toBe(true)
  })

  test('a Step with no Evidence is drawn as Inferred', () => {
    const m = load()
    const b = JSON.parse(JSON.stringify(m.behaviours[0]!)) as typeof m.behaviours[0]
    b.steps[0]!.evidence = []
    const l = layoutBehaviourView(b, m, opts)
    expect(l.edges.find(e => e.id === b.steps[0]!.id)!.style.isInferred).toBe(true)
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
    const b = { ...JSON.parse(JSON.stringify((m.behaviours[0]!))) as typeof m.behaviours[0], elementIds: ['client', 'orders-api', 'order-service', 'inventory', 'payments', 'error-mw'] }
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

describe('group expansion', () => {
  test('expanding group:other from the first fold shows its members', () => {
    const m = load()
    const elements = { ...m.elements }
    const ids = ['client', 'orders-api']
    for (let i = 0; i < 20; i++) {
      elements[`z${i}`] = { id: `z${i}`, name: `Z${i}`, level: 'code', evidence: [] }
      ids.push(`z${i}`)
    }
    const b = { ...m.behaviours[0]!, elementIds: ids, steps: [m.behaviours[0]!.steps[0]!], errorFlows: [] }
    const model = { ...m, elements }
    const first = layoutBehaviourView(b, model, opts)
    const other = first.nodes.find(n => n.style.isGroup)!
    expect(other.id).toBe('group:other')
    const again = layoutBehaviourView(b, model, { ...opts, expandedGroups: [other.id] })
    expect(again.nodes.some(n => n.id === 'z0')).toBe(true)
    expect(again.nodes.some(n => n.id === other.id)).toBe(false)
  })
})
