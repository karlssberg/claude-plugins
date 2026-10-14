import { describe, expect, test } from 'claude-code/testing'
import type { Element } from '../hooks/model/behaviour-model'
import { foldToBudget } from '../hooks/model/budget'

function build(n: number, parents: number) {
  const elements: Record<string, Element> = {}
  for (let p = 0; p < parents; p++) {
    elements[`p${p}`] = { id: `p${p}`, name: `Pkg${p}`, level: 'container', evidence: [] }
  }
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const id = `e${String(i).padStart(2, '0')}`
    elements[id] = {
      id,
      name: `E${i}`,
      level: 'component',
      ...(parents > 0 ? { parentId: `p${i % parents}` } : {}),
      evidence: [],
    }
    ids.push(id)
  }
  return { elements, ids }
}
const opts = (pinned: string[]) => ({ budget: 12, cap: 20, pinned })

describe('foldToBudget', () => {
  test('11 elements fold nothing', async () => {
    const { elements, ids } = build(11, 2)
    const r = foldToBudget(ids, elements, opts([]))
    expect(r.visibleIds).toEqual(ids)
    expect(r.groups).toEqual([])
  })

  test('30 elements fold to <=12 visible', async () => {
    const { elements, ids } = build(30, 3)
    const r = foldToBudget(ids, elements, opts([ids[0]!]))
    expect(r.visibleIds.length + r.groups.length).toBeLessThanOrEqual(12)
    expect(r.visibleIds).toContain(ids[0]!)
    const all = [...r.visibleIds, ...r.groups.flatMap(g => g.memberIds)].sort()
    expect(all).toEqual([...ids].sort())
    expect(foldToBudget(ids, elements, opts([ids[0]!]))).toEqual(r)
  })

  test('pinned elements are never folded', async () => {
    const { elements, ids } = build(30, 3)
    const pinned = ['e01', 'e02', 'e03', 'e29']
    const r = foldToBudget(ids, elements, opts(pinned))
    for (const p of pinned) expect(r.visibleIds).toContain(p)
    for (const g of r.groups) for (const p of pinned) expect(g.memberIds).not.toContain(p)
  })

  test('15 pinned elements yields <=20 visible', async () => {
    const { elements, ids } = build(40, 4)
    const pinned = ids.slice(0, 15)
    const r = foldToBudget(ids, elements, opts(pinned))
    expect(r.visibleIds.length + r.groups.length).toBeLessThanOrEqual(20)
    expect(r.visibleIds.length).toBeGreaterThanOrEqual(15)
    for (const p of pinned) expect(r.visibleIds).toContain(p)
  })

  test('group label counts members', async () => {
    const { elements, ids } = build(30, 3)
    const r = foldToBudget(ids, elements, opts([]))
    expect(r.groups.length).toBeGreaterThan(0)
    for (const g of r.groups) {
      expect(g.id.startsWith('group:p')).toBe(true)
      expect(g.label).toBe(`${elements[g.id.slice(6)]!.name} (${g.memberIds.length})`)
    }
  })

  test('elements without a parent fold into Other', async () => {
    const { elements, ids } = build(14, 0)
    const r = foldToBudget(ids, elements, opts([]))
    expect(r.groups.length).toBe(1)
    expect(r.groups[0]!.id).toBe('group:other')
    expect(r.groups[0]!.label).toBe(`Other (${r.groups[0]!.memberIds.length})`)
    expect(r.visibleIds.length + r.groups.length).toBeLessThanOrEqual(12)
  })

  test('30 elements over 15 parents still draw <=12 nodes', async () => {
    const { elements, ids } = build(30, 15)
    const r = foldToBudget(ids, elements, opts([ids[0]!]))
    expect(r.visibleIds.length + r.groups.length).toBeLessThanOrEqual(12)
    expect(r.visibleIds).toContain(ids[0]!)
    const all = [...r.visibleIds, ...r.groups.flatMap(g => g.memberIds)].sort()
    expect(all).toEqual([...ids].sort())
    expect(r.groups.every(g => g.label.endsWith(`(${g.memberIds.length})`))).toBe(true)
    expect(foldToBudget(ids, elements, opts([ids[0]!]))).toEqual(r)
  })
})
