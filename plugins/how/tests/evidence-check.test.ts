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
  const base = m.behaviours[0]!
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
    expect(r.model.elements.a?.evidence[0]?.status).toBe('verified')
    expect(r.model.elements.b?.evidence[0]?.status).toBe('verified') // within +-3
    expect(r.model.behaviours[0]?.steps[0]?.evidence[0]?.status).toBe('verified')
    expect(m.elements.a?.evidence[0]?.status).toBe('unchecked') // input not mutated
  })

  test('marks inferred when symbol is elsewhere in the file', async () => {
    const m = tiny([ev('x.ts', 1, 2, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.elements.a?.evidence[0]?.status).toBe('inferred')
    expect(r.dropped.length).toBe(0)
  })

  test('drops a Step whose only evidence is in a missing file and reports why', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('gone.ts', 1, 2, 'q')])
    const r = await verifyEvidence(m, async p => (p === 'x.ts' ? file20 : undefined))
    expect(r.model.behaviours[0]?.steps.length).toBe(0)
    expect(r.dropped).toEqual([{ id: 's1', reason: 'file missing: gone.ts' }])
  })

  test('drops Steps touching a dropped element', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'nope')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.elements.b).toBeUndefined()
    expect(r.model.behaviours[0]?.elementIds).toEqual(['a'])
    expect(r.model.behaviours[0]?.steps.length).toBe(0)
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
    expect(r.model.elements.b?.evidence[0]?.status).toBe('verified')
    expect(r.dropped.some(d => d.id === 'a')).toBe(true)
  })

  test('line range past EOF is invalid, not a throw', async () => {
    const m = tiny([ev('x.ts', 900, 910, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.dropped.find(d => d.id === 'a')?.reason).toBe('line range 900-910 past end of x.ts (20 lines)')
  })

  test('removes invalid Evidence from a Seam that keeps valid contract Evidence, and keeps the Seam', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    m.seams = {
      sg: {
        id: 'sg',
        name: 'G',
        kind: 'interface',
        contract: { text: 'c', evidence: [ev('x.ts', 10, 10, 'needle'), ev('gone.ts', 1, 1, 'q')] },
        enablingPoint: ev('gone.ts', 1, 1, 'q'),
        isContractChanged: false,
      },
    }
    const r = await verifyEvidence(m, async p => (p === 'x.ts' ? file20 : undefined))
    const seam = r.model.seams.sg!
    expect(seam.contract.evidence.length).toBe(1)
    expect(seam.enablingPoint).toBeUndefined()
    expect(r.dropped.find(d => d.id === 'sg')?.reason).toBe('file missing: gone.ts')
  })

  test('a fabricated Seam is dropped with its Step references, transforms and Seam view, and the model re-parses', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    m.seams = {
      sx: { id: 'sx', name: 'Fabricated', kind: 'network', contract: { text: 'c', evidence: [ev('x.ts', 10, 10, 'nope')] }, isContractChanged: true },
      sy: { id: 'sy', name: 'Uncited', kind: 'network', contract: { text: 'c', evidence: [] }, isContractChanged: false },
    }
    const b = m.behaviours[0]!
    b.seamIds = ['sx', 'sy']
    b.steps[0]!.seamId = 'sx'
    b.errorFlows = [
      {
        id: 'f1',
        originStepId: 's1',
        transforms: [{ seamId: 'sx', into: 'Err', evidence: [ev('x.ts', 10, 10, 'needle')] }],
        isSwallowed: false,
        isCatchAll: false,
        diff: 'unchanged',
      },
    ]
    m.seamViews = { sx: { subjectId: 'sx', status: 'built', nodes: [], edges: [] } }
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.seams).toEqual({})
    const out = r.model.behaviours[0]!
    expect(out.seamIds).toEqual([])
    expect(out.steps).toHaveLength(1)
    expect(out.steps[0]!.seamId).toBeUndefined()
    expect('seamId' in out.steps[0]!).toBe(false)
    expect(out.errorFlows[0]!.transforms).toEqual([])
    expect(r.model.seamViews).toEqual({})
    const ids = r.dropped.map(d => d.id)
    expect(ids).toContain('sx')
    expect(ids).toContain('sy')
    expect(ids).toContain('f1')
    expect(r.dropped.find(d => d.id === 'sy')?.reason).toBe('no evidence cited')
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('a FlowNode without valid Evidence is dropped with its edges', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const node = (id: string, evidence: Evidence[]) => ({ id, label: id, kind: 'step' as const, diff: 'unchanged' as const, evidence })
    m.seamViews = {
      a: {
        subjectId: 'a',
        status: 'built',
        nodes: [node('n1', [ev('x.ts', 10, 10, 'needle')]), node('n2', []), node('n3', [ev('x.ts', 10, 10, 'needle')]), node('n4', [ev('x.ts', 10, 10, 'nope')])],
        edges: [
          { from: 'n1', to: 'n2', isError: false },
          { from: 'n2', to: 'n3', isError: false },
          { from: 'n1', to: 'n3', isError: false },
          { from: 'n3', to: 'n4', isError: true },
        ],
      },
    }
    const r = await verifyEvidence(m, async () => file20)
    const view = r.model.seamViews.a!
    expect(view.nodes.map(n => n.id)).toEqual(['n1', 'n3'])
    expect(view.edges).toEqual([{ from: 'n1', to: 'n3', isError: false }])
    expect(r.dropped.find(d => d.id === 'n2')?.reason).toBe('no evidence cited')
    expect(r.dropped.find(d => d.id === 'n4')?.reason).toBe('symbol "nope" not found in x.ts')
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('an error-flow transform or handler without valid Evidence is dropped', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    m.seams = { sg: { id: 'sg', name: 'G', kind: 'interface', contract: { text: 'c', evidence: [ev('x.ts', 10, 10, 'needle')] }, isContractChanged: false } }
    m.behaviours[0]!.seamIds = ['sg']
    m.behaviours[0]!.errorFlows = [
      {
        id: 'f1',
        originStepId: 's1',
        transforms: [
          { seamId: 'sg', into: 'Uncited', evidence: [] },
          { seamId: 'sg', into: 'Kept', evidence: [ev('x.ts', 10, 10, 'needle')] },
          { seamId: 'sg', into: 'Wrong', evidence: [ev('x.ts', 10, 10, 'nope')] },
        ],
        handler: { elementId: 'b', evidence: [ev('x.ts', 10, 10, 'nope')] },
        isSwallowed: false,
        isCatchAll: false,
        diff: 'unchanged',
      },
    ]
    const r = await verifyEvidence(m, async () => file20)
    const f = r.model.behaviours[0]!.errorFlows[0]!
    expect(f.transforms.map(t => t.into)).toEqual(['Kept'])
    expect(f.handler).toBeUndefined()
    expect('handler' in f).toBe(false)
    const reason = r.dropped.find(d => d.id === 'f1')?.reason ?? ''
    expect(reason).toContain('transform into "Uncited": no evidence cited')
    expect(reason).toContain('transform into "Wrong": symbol "nope" not found in x.ts')
    expect(reason).toContain('handler "b": symbol "nope" not found in x.ts')
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('a pr-small model with no readable file keeps no Seam and still parses', async () => {
    const r = await verifyEvidence(load(), async () => undefined)
    expect(r.model.seams).toEqual({})
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('output still parses when the entry point Element is dropped', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'nope')], [ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'needle')])
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.behaviours.length).toBe(0)
    expect(r.dropped.some(d => d.id === 'bh')).toBe(true)
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('drops a Seam view whose subject Element was dropped and still parses', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'nope')], [ev('x.ts', 10, 10, 'needle')])
    m.seamViews = { b: { subjectId: 'b', status: 'built', nodes: [], edges: [] } }
    const r = await verifyEvidence(m, async () => file20)
    expect(Object.keys(r.model.seamViews).length).toBe(0)
    expect(r.dropped.some(d => d.id === 'b')).toBe(true)
    const parsed = parseBehaviourModel(JSON.stringify(r.model))
    expect('model' in parsed).toBe(true)
  })

  test('drops a baseBehaviours entry whose entry point is a dropped head Element and still parses', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('x.ts', 10, 10, 'nope')], [ev('x.ts', 10, 10, 'needle')])
    const b = m.behaviours[0]!
    m.baseBehaviours = [{ ...b, id: 'base', entryPointId: 'b', elementIds: ['b'], steps: [] }]
    const r = await verifyEvidence(m, async () => file20)
    expect(r.model.elements.b).toBeUndefined()
    expect(r.model.baseBehaviours?.length).toBe(0)
    expect(r.dropped.some(d => d.id === 'base')).toBe(true)
    expect('model' in parseBehaviourModel(JSON.stringify(r.model))).toBe(true)
  })

  test('a symbol matches only on identifier boundaries, in range and in the whole file', async () => {
    const text = ['const valid = isValid(x)', 'const target = 1', 'this.cancel(order)', '$id = 2', 'const id_x = 3'].join('\n')
    const status = async (symbol: string) => {
      const m = tiny([ev('x.ts', 1, 1, symbol)], [ev('x.ts', 1, 1, 'valid')], [ev('x.ts', 1, 1, 'valid')])
      const r = await verifyEvidence(m, async () => text)
      return r.model.elements.a?.evidence[0]?.status ?? 'dropped'
    }
    expect(await status('id')).toBe('dropped') // not in valid, isValid, $id or id_x
    expect(await status('get')).toBe('dropped') // not in target
    expect(await status('OrderService.cancel')).toBe('verified') // last segment: cancel(
    expect(await status('valid')).toBe('verified')
    expect(await status('target')).toBe('verified')
    expect(await status('id_x')).toBe('inferred') // whole-file fallback, line 5
    expect(await status('Order.id_x')).toBe('inferred')
  })

  test('base-only Elements and base Steps are not checked against head files', async () => {
    const m = tiny([ev('x.ts', 10, 10, 'needle')], [ev('gone.ts', 1, 2, 'Old')], [ev('gone.ts', 1, 2, 'Old')])
    const b = m.behaviours[0]!
    m.behaviours = [{ ...b, elementIds: ['a'], steps: [] }]
    m.baseBehaviours = [b]
    const reads: string[] = []
    const r = await verifyEvidence(m, async f => (reads.push(f), f === 'x.ts' ? file20 : undefined))
    expect(r.dropped).toEqual([])
    expect(r.model.elements.b!.evidence[0]!.status).toBe('unchecked')
    expect(r.model.baseBehaviours![0]!.steps[0]!.evidence[0]!.status).toBe('unchecked')
    expect(reads).toEqual(['x.ts'])
  })
})
