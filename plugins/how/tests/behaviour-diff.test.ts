import { describe, expect, test } from 'claude-code/testing'
import { parseBehaviourModel, type Behaviour, type BehaviourModel } from '../hooks/model/behaviour-model'
import { markStepDiffs } from '../hooks/model/behaviour-diff'
import { prSmallJson } from './fixtures/models'

const load = (): BehaviourModel => {
  const r = parseBehaviourModel(prSmallJson)
  if (!('model' in r)) throw new Error(r.error)
  return r.model
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('markStepDiffs', () => {
  test('identical Behaviours are all unchanged', async () => {
    const m = load()
    const base = clone(m.baseBehaviours![0]!)
    const head = clone(base)
    head.steps.forEach(s => (s.diff = 'added'))
    const out = markStepDiffs(base, head, m.elements)
    expect(out.steps.map(s => s.diff)).toEqual(head.steps.map(() => 'unchanged'))
    expect(out.steps.length).toBe(6)
  })

  test('new step is added', async () => {
    const m = load()
    const base = m.baseBehaviours![0]!
    const head = clone(base)
    head.steps.splice(3, 0, { ...clone(head.steps[3]!), id: 'sx', label: 'audit log', to: 'order-repo' })
    const out = markStepDiffs(base, head, m.elements)
    expect(out.steps.find(s => s.id === 'sx')!.diff).toBe('added')
    expect(out.steps.filter(s => s.diff === 'unchanged').length).toBe(6)
  })

  test('missing step is removed and kept in order', async () => {
    const m = load()
    const base = m.baseBehaviours![0]!
    const head = clone(base)
    head.steps = head.steps.filter(s => s.id !== 's4')
    const out = markStepDiffs(base, head, m.elements)
    const idx = out.steps.findIndex(s => s.id === 'base:s4')
    expect(idx).toBe(3)
    expect(out.steps[idx]!.diff).toBe('removed')
    expect(out.steps[idx]!.label).toBe('capture payment')
    expect(out.steps.map(s => s.order)).toEqual([...out.steps.map(s => s.order)].sort((a, b) => a - b))
    expect(base.steps.length).toBe(6)
    expect(head.steps.length).toBe(5)
  })

  test('same endpoints new label is changed', async () => {
    const m = load()
    const base = m.baseBehaviours![0]!
    const head = clone(base)
    head.steps[2]!.label = 'reserve stock (409 aware)'
    const out = markStepDiffs(base, head, m.elements)
    expect(out.steps.find(s => s.id === 's3')!.diff).toBe('changed')
    expect(out.steps.some(s => s.diff === 'removed')).toBe(false)
  })

  test('rerouted call is changed', async () => {
    const m = load()
    const base = m.baseBehaviours![0]!
    const head = clone(base)
    head.steps[3]!.to = 'inventory'
    const out = markStepDiffs(base, head, m.elements)
    expect(out.steps.find(s => s.id === 's4')!.diff).toBe('changed')
    expect(out.steps.some(s => s.diff === 'removed' || s.diff === 'added')).toBe(false)
  })

  test('no base marks all added', async () => {
    const m = load()
    const head: Behaviour = m.behaviours[1]!
    const out = markStepDiffs(undefined, head, m.elements)
    expect(out.steps.every(s => s.diff === 'added')).toBe(true)
    expect(out.errorFlows.every(f => f.diff === 'added')).toBe(true)
    expect(head.steps[0]!.diff).toBe('unchanged')
  })

  test('error flow with new handler is changed', async () => {
    const m = load()
    const base = clone(m.behaviours[0]!)
    const head = clone(base)
    head.errorFlows[0]!.handler!.elementId = 'orders-api'
    const out = markStepDiffs(base, head, m.elements)
    expect(out.errorFlows.length).toBe(1)
    expect(out.errorFlows[0]!.diff).toBe('changed')
    const same = markStepDiffs(base, clone(base), m.elements)
    expect(same.errorFlows[0]!.diff).toBe('unchanged')
  })

  test('error flow only in base is re-inserted as removed', async () => {
    const m = load()
    const base = clone(m.behaviours[0]!)
    const head = clone(base)
    head.errorFlows = []
    const out = markStepDiffs(base, head, m.elements)
    expect(out.errorFlows.length).toBe(1)
    expect(out.errorFlows[0]!.id).toBe('base:ef1')
    expect(out.errorFlows[0]!.diff).toBe('removed')
    expect(out.errorFlows[0]!.originStepId).toBe('s3')
  })
})
