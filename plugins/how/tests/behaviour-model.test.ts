import { describe, expect, test } from 'claude-code/testing'
import { parseBehaviourModel } from '../hooks/model/behaviour-model'
import { codebaseSmallJson, prSmallJson } from './fixtures/models'

const clone = () => JSON.parse(prSmallJson)
const errorOf = (v: unknown) => {
  const r = parseBehaviourModel(typeof v === 'string' ? v : JSON.stringify(v))
  return 'error' in r ? r.error : undefined
}

describe('parseBehaviourModel', () => {
  test('parses pr-small fixture', async () => {
    const r = parseBehaviourModel(prSmallJson)
    if (!('model' in r)) throw new Error(r.error)
    expect(r.model.behaviours.length).toBe(2)
    expect(r.model.incidentalChanges.length).toBe(1)
    expect(r.model.baseBehaviours?.length).toBe(1)
  })

  test('parses codebase-small fixture', async () => {
    const r = parseBehaviourModel(codebaseSmallJson)
    if (!('model' in r)) throw new Error(r.error)
    expect(r.model.scope.mode).toBe('codebase')
    expect(r.model.behaviours.map(b => b.status)).toContain('pending')
  })

  test('rejects version 2', async () => {
    const m = clone()
    m.version = 2
    expect(errorOf(m)).toBe('unsupported Behaviour model version 2')
  })

  test('rejects invalid JSON with an error, never throws', async () => {
    expect(errorOf('{nope')).toContain('not valid JSON')
    expect(errorOf('null')).toBeDefined()
  })

  test('rejects a step whose from/to names no element', async () => {
    const m = clone()
    m.behaviours[0].steps[1].to = 'ghost'
    const e = errorOf(m)
    expect(e).toContain('s2')
    expect(e).toContain('ghost')
  })

  test('rejects a Behaviour without entryPointId in elementIds', async () => {
    const m = clone()
    m.behaviours[1].elementIds = ['client']
    const e = errorOf(m)
    expect(e).toContain('b-cancel')
    expect(e).toContain('entry point')
  })

  test('rejects an invalid baseBehaviours entry', async () => {
    const m = clone()
    m.baseBehaviours[0].steps[0].from = 'ghost'
    expect(errorOf(m)).toContain('s1')
  })

  test('rejects an Error flow whose origin step does not exist', async () => {
    const m = clone()
    m.behaviours[0].errorFlows[0].originStepId = 'zzz'
    expect(errorOf(m)).toContain('ef1')
  })

  test('ids that name Object.prototype members name nothing', async () => {
    for (const ghost of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const step = clone()
      step.behaviours[0].steps[1].to = ghost
      expect(errorOf(step)).toContain(`"to" "${ghost}" names no Element`)
      const seam = clone()
      seam.behaviours[0].steps[2].seamId = ghost
      expect(errorOf(seam)).toContain(`seamId "${ghost}" names no Seam`)
      const listed = clone()
      listed.behaviours[0].elementIds.push(ghost)
      expect(errorOf(listed)).toContain(`lists elementId "${ghost}" that names no Element`)
      const parent = clone()
      parent.elements.client.parentId = ghost
      expect(errorOf(parent)).toContain(`parentId "${ghost}" names no Element`)
      const view = clone()
      view.seamViews['order-service'].subjectId = ghost
      expect(errorOf(view)).toContain(`subject "${ghost}" names no Element or Seam`)
      const handler = clone()
      handler.behaviours[0].errorFlows[0].handler = { elementId: ghost, evidence: [] }
      expect(errorOf(handler)).toContain(`elementId "${ghost}" names no Element`)
      const transform = clone()
      transform.behaviours[0].errorFlows[0].transforms[0].seamId = ghost
      expect(errorOf(transform)).toContain(`seamId "${ghost}" names no Seam`)
    }
  })

  test('rejects duplicate error-flow ids within a Behaviour', async () => {
    const m = clone()
    const flows = m.behaviours[0].errorFlows
    flows.push({ ...flows[0] })
    expect(errorOf(m)).toContain('duplicate error flow id "ef1"')
  })

  test('rejects duplicate baseBehaviours ids', async () => {
    const m = clone()
    m.baseBehaviours.push(JSON.parse(JSON.stringify(m.baseBehaviours[0])))
    expect(errorOf(m)).toContain(`duplicate base Behaviour id "${m.baseBehaviours[0].id}"`)
  })
})
