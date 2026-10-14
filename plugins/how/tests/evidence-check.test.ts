import { describe, expect, test } from 'claude-code/testing'
import { parseBehaviourModel, type BehaviourModel, type Evidence } from '../hooks/model/behaviour-model'
import { verifyEvidence } from '../hooks/model/evidence-check'
import { prSmallJson } from './fixtures/models'

const load = (): BehaviourModel => {
  const r = parseBehaviourModel(prSmallJson)
  if (!('model' in r)) throw new Error(r.error)
  return r.model
}
const ev = (file: string, startLine: number, endLine: number, symbol: string): Evidence => ({
  file,
  startLine,
  endLine,
  symbol,
  status: 'unchecked',
})
// 20-line file with "needle" on line 10 only.
const file20 = Array.from({ length: 20 }, (_, i) => (i === 9 ? 'function needle() {}' : `// line ${i + 1}`)).join('\n')

function tiny(a: Evidence[], b: Evidence[], stepEv: Evidence[]): BehaviourModel {
  const m = load()
  const base = m.behaviours[0]
  return {
    ...m,
    intentMismatches: [],
    seams: {},
    seamViews: {},
    baseBehaviours: undefined,
    elements: {
      a: { id: 'a', name: 'A', level: 'component', evidence: a },
      b: { id: 'b', name: 'B', level: 'component', evidence: b },
    },
    behaviours: [
      {
        ...base,
        id: 'bh',
        entryPointId: 'a',
        elementIds: ['a', 'b'],
        seamIds: [],
        errorFlows: [],
        steps: [
          { id: 's1', order: 1, from: 'a', to: 'b', label: 'x', kind: 'call', diff: 'unchanged', evidence: stepEv },
        ],
      },
    ],
  }
}

describe('verifyEvidence', () => {
  test('marks evidence verified when symbol is on the cited lines', async () => {
    const m = tiny([ev('x.ts', 10, 11, 'needle')], [ev('x.ts', 12, 12, 'needle')], [ev('x.ts', 8, 9, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.dropped.length).toBe(0)
    expect(r.model.elements.a.evidence[0].status).toBe('verified')
    expect(r.model.elements.b.evidence[0].status).toBe('verified') // within +-3
    expect(r.model.behaviours[0].steps[0].evidence[0].status).toBe('verified')
    expect(m.elements.a.evidence[0].status).toBe('unchecked') // input not mutated
  })

  test('marks inferred when symbol is elsewhere in the file', async () => {
    const m = tiny([ev('x.ts', 1, 2, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.elements.a.evidence[0].status).toBe('inferred')
    expect(r.dropped.length).toBe(0)
  })

  test('drops a Step whose only evidence is in a missing file and reports why', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('gone.ts', 1, 2, 'q')])
    const r = await verifyEvidence(m, async p => (p === 'x.ts' ? file20 : undefined))
    expect(r.model.behaviours[0].steps.length).toBe(0)
    expect(r.dropped).toEqual([{ id: 's1', reason: 'file missing: gone.ts' }])
  })

  test('drops Steps touching a dropped element', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'nope')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.elements.b).toBeUndefined()
    expect(r.model.behaviours[0].elementIds).toEqual(['a'])
    expect(r.model.behaviours[0].steps.length).toBe(0)
    const ids = r.dropped.map(d => d.id)
    expect(ids).toContain('b')
    expect(ids).toContain('s1')
    expect(new Set(ids).size).toBe(ids.length)
    expect(r.dropped.find(d => d.id === 'b')?.reason).toBe('symbol "nope" not found in x.ts')
  })

  test('keeps verifying after a file read returns undefined (oversized)', async () => {
    const m = tiny(
      [ev('big.ts', 1, 1, 'z')],
      [ev('x.ts', 10, 10, 'needle')],
      [ev('x.ts', 10, 10, 'needle')],
    )
    const r = await verifyEvidence(m, async p => (p === 'x.ts' ? file20 : undefined))
    expect(r.model.elements.a).toBeUndefined()
    expect(r.model.elements.b.evidence[0].status).toBe('verified')
    expect(r.dropped.some(d => d.id === 'a')).toBe(true)
  })

  test('line range past EOF is invalid, not a throw', async () => {
    const m = tiny([ev('x.ts', 900, 910, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.dropped.find(d => d.id === 'a')?.reason).toBe('line range 900-910 past end of x.ts (20 lines)')
  })

  test('removes invalid Evidence from non-element owners but keeps the owner', async () => {
    const m = load()
    const r = await verifyEvidence(m, async () => undefined)
    const seam = r.model.seams['seam-inventory']
    expect(seam).toBeDefined()
    expect(seam.contract.evidence.length).toBe(0)
    expect(seam.enablingPoint).toBeUndefined()
    expect(r.dropped.length).toBeGreaterThan(0)
  })
})
