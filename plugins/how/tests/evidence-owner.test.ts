import { describe, expect, test } from 'claude-code/testing'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import { resolveEvidenceOwner } from '../hooks/panel/evidence-owner'
import { prSmallJson } from './fixtures/models'

const load = (json: string): BehaviourModel => {
  const r = parseBehaviourModel(json)
  if ('error' in r) throw new Error(r.error)
  return r.model
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('resolveEvidenceOwner', () => {
  test('element:<id> is the Element and its Evidence', () => {
    const r = resolveEvidenceOwner(load(prSmallJson), 'element:order-service')
    expect(r?.label).toBe('OrderService')
    expect(r?.evidence[0]?.symbol).toBe('OrderService')
  })

  test('step:<behaviourId>:<stepId> picks the Step of that Behaviour even when Step ids collide', () => {
    const m = clone(load(prSmallJson))
    // Make b-cancel reuse b-place's Step id s1 with different Evidence.
    m.behaviours[1]!.steps[0]!.id = 's1'
    const place = resolveEvidenceOwner(m, 'step:b-place:s1')
    const cancel = resolveEvidenceOwner(m, 'step:b-cancel:s1')
    expect(place?.label).toBe('POST /orders')
    expect(place?.evidence[0]?.symbol).toBe('OrdersController.create')
    expect(cancel?.label).toBe('DELETE /orders/:id')
    expect(cancel?.evidence[0]?.symbol).toBe('OrdersController.cancel')
  })

  test('seam:<id> is the Contract Evidence', () => {
    const r = resolveEvidenceOwner(load(prSmallJson), 'seam:seam-inventory')
    expect(r?.label).toBe('Inventory reservation')
    expect(r?.evidence[0]?.symbol).toBe('InventoryClient.reserve')
  })

  test('flow:<subjectId>:<nodeId> is the flow node of that Seam view', () => {
    const m = clone(load(prSmallJson))
    m.seamViews['seam-repo'] = { ...clone(m.seamViews['order-service']!), subjectId: 'seam-repo' }
    m.seamViews['seam-repo']!.nodes[0]!.evidence = [{ file: 'src/other.ts', startLine: 1, endLine: 1, symbol: 'other', status: 'verified' }]
    expect(resolveEvidenceOwner(m, 'flow:order-service:n1')?.evidence[0]?.symbol).toBe('OrderService.place')
    expect(resolveEvidenceOwner(m, 'flow:seam-repo:n1')?.evidence[0]?.symbol).toBe('other')
    expect(resolveEvidenceOwner(m, 'flow:order-service:n1')?.label).toBe('validate order')
  })

  test('error:<behaviourId>:<flowId> is transform then handler Evidence, in order', () => {
    const r = resolveEvidenceOwner(load(prSmallJson), 'error:b-place:ef1')
    expect(r?.evidence.map(e => e.symbol)).toEqual(['InventoryClient.reserve', 'ErrorMiddleware.handle'])
    expect(r?.label).toContain('OutOfStockError')
  })

  test('unknown prefix, Behaviour, id or a raw id resolve to undefined', () => {
    const m = load(prSmallJson)
    for (const id of ['s1', 'order-service', 'element:nope', 'step:b-nope:s1', 'step:b-place:nope', 'seam:nope', 'flow:nope:n1', 'flow:order-service:nope', 'error:b-place:nope', 'other:x', 'step:b-place']) {
      expect(resolveEvidenceOwner(m, id)).toBeUndefined()
    }
  })
})
