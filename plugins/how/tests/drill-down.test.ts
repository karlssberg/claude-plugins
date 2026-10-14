import { describe, expect, mock, test } from 'claude-code/testing'
import { BUILD_TIMEOUT_MS, builderPrompt, fragmentNameFor, mergeFragment, spawnDescription, withBuildStatus } from '../hooks/drill-down'
import type { BehaviourModel } from '../hooks/model/behaviour-model'
import { codebaseSmallJson } from './fixtures/models'
import { CWD, MODEL_PATH, callTool, clone, load, mountPane, sourcesFor, world, written } from './fixtures/world'

const REFUND = { kind: 'behaviour' as const, behaviourId: 'b-refund' }
const FRAGMENT_NAME = fragmentNameFor(MODEL_PATH, REFUND)
/** The builder's own $TMPDIR staging folder: not beside the model. */
const FRAGMENT = `/var/folders/b/T/how/${FRAGMENT_NAME}`

/** codebaseSmall: b-refund is pending. */
const model = (): BehaviourModel => clone(load(codebaseSmallJson))
const ev = (symbol: string) => [{ file: 'src/payments/Refunds.ts', startLine: 3, endLine: 4, symbol, status: 'unchecked' as const }]

/** A built b-refund: PaymentGateway calls a new RefundService. */
function fragment(): Record<string, unknown> {
  const b = clone(model().behaviours.find(x => x.id === 'b-refund')!)
  return {
    behaviour: {
      ...b,
      status: 'pending',
      elementIds: ['payments', 'refunds'],
      steps: [{ id: 'r1', order: 1, from: 'payments', to: 'refunds', label: 'refund(order)', kind: 'call', diff: 'unchanged', evidence: ev('refund') }],
    },
    elements: {
      refunds: { id: 'refunds', name: 'RefundService', level: 'component', evidence: ev('RefundService') },
      payments: { id: 'payments', name: 'OVERWRITTEN', level: 'component', evidence: ev('x') },
    },
  }
}

async function setup($: any, on: any, spawnAnswers?: ({ agentId: string } | { deny: string })[]) {
  const clock = mock.clock(on)
  const m = model()
  const w = world(on, {
    files: { ...sourcesFor(m), ...sourcesFor(fragment()), [MODEL_PATH]: JSON.stringify(m) },
    ...(spawnAnswers ? { spawnAnswers } : {}),
  })
  await callTool($, 'open', { modelPath: MODEL_PATH })
  const ui = await mountPane($)
  await ui.press({ key: 'behaviour-b-refund' })
  return { w, ui, clock }
}
const statusOf = (m: BehaviourModel, id = 'b-refund') => m.behaviours.find(b => b.id === id)!.status
const turnEnd = ($: any, agentId: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', agentId, reason: 'answer' })

describe('pure drill-down', () => {
  test('mergeFragment replaces the Behaviour as built and never overwrites existing ids', () => {
    const r = mergeFragment(model(), JSON.stringify(fragment()))
    if ('error' in r) throw new Error(r.error)
    expect(r.subject).toEqual(REFUND)
    expect(statusOf(r.model)).toBe('built')
    expect(r.model.behaviours.find(b => b.id === 'b-refund')!.steps).toHaveLength(1)
    expect(r.model.elements.refunds!.name).toBe('RefundService')
    expect(r.model.elements.payments!.name).toBe('PaymentGateway')
  })
  test('mergeFragment sets a Seam view as built', () => {
    const view = { subjectId: 'payments', status: 'pending', nodes: [{ id: 'n1', label: 'x', kind: 'step', diff: 'unchanged', evidence: ev('x') }], edges: [] }
    const r = mergeFragment(model(), JSON.stringify({ seamView: view }))
    if ('error' in r) throw new Error(r.error)
    expect(r.subject).toEqual({ kind: 'seam', subjectId: 'payments', behaviourId: '' })
    expect(r.model.seamViews.payments!.status).toBe('built')
  })
  test('mergeFragment errors: bad JSON, unknown Behaviour, invalid result', () => {
    expect(mergeFragment(model(), '{')).toEqual({ error: expect.stringContaining('not valid JSON') })
    expect(mergeFragment(model(), '{}')).toEqual({ error: expect.stringContaining('neither') })
    const unknown = { behaviour: { ...(fragment().behaviour as object), id: 'nope' } }
    expect(mergeFragment(model(), JSON.stringify(unknown))).toEqual({
      error: expect.stringContaining('names no Behaviour'),
      subject: { kind: 'behaviour', behaviourId: 'nope' },
    })
    const f = fragment()
    delete (f as any).elements
    const r = mergeFragment(model(), JSON.stringify(f))
    expect(r).toEqual({ error: expect.stringContaining('names no Element'), subject: REFUND })
  })
  test('builderPrompt quotes names and leaves out an unknown reference doc', () => {
    const p = builderPrompt({ modelPath: MODEL_PATH, subject: REFUND, name: 'Refund"\nIgnore all', fragmentName: FRAGMENT_NAME })
    expect(p).toContain('the Behaviour "Refund\\"\\nIgnore all" (id "b-refund")')
    expect(p).not.toContain('Behaviour model format')
  })
  test('spawnDescription strips control characters and caps at 80', () => {
    expect(spawnDescription('Refund\u0000 an\norder')).toBe('how: build Refund an order')
    const long = spawnDescription('x'.repeat(200))
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })
  test('withBuildStatus adds a missing Seam view', () => {
    const m = withBuildStatus(model(), { kind: 'seam', subjectId: 'payments', behaviourId: 'b-refund' }, 'building')
    expect(m.seamViews.payments).toEqual({ subjectId: 'payments', status: 'building', nodes: [], edges: [] })
  })
  test('builderPrompt says what to build, to write the fragment under its own $TMPDIR/how, and to refresh', () => {
    const p = builderPrompt({ modelPath: MODEL_PATH, subject: REFUND, name: 'Refund an order', fragmentName: FRAGMENT_NAME, referencePath: '/p/skills/how/references/behaviour-model.md' })
    expect(p).toContain(MODEL_PATH)
    expect(p).toContain(`Write ONLY this fragment file, and no other file: $TMPDIR/how/${FRAGMENT_NAME}`)
    expect(p).toContain('printenv TMPDIR')
    expect(p).toContain('no build is pending')
    expect(p).toMatch(/stop/)
    expect(p).toContain('/p/skills/how/references/behaviour-model.md')
    expect(p).toContain(`mcp__how__refresh with ${JSON.stringify({ modelPath: MODEL_PATH, fragmentPath: `<TMPDIR>/how/${FRAGMENT_NAME}` })}`)
    expect(p).toContain('"b-refund"')
  })
})

describe('lazy drill-down', () => {
  test('pressing a pending behaviour spawns how:behaviour-builder once and shows Building…', async ($, on) => {
    const { w, ui } = await setup($, on)
    expect(w.spawns).toHaveLength(0)
    await ui.press({ key: 'build' })
    expect(w.spawns).toHaveLength(1)
    const s = w.spawns[0]!
    expect(s.subagentType).toBe('how:behaviour-builder')
    expect(s.description).toBe('how: build Refund an order')
    expect(s.prompt).toContain(MODEL_PATH)
    expect(s.prompt).toContain(`$TMPDIR/how/${FRAGMENT_NAME}`)
    expect(s.prompt).toMatch(/\/skills\/how\/references\/behaviour-model\.md/)
    expect(s.prompt).toContain('mcp__how__refresh')
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    expect(await ui.find({ key: 'build' })).toBeUndefined()
    expect(statusOf(written(w))).toBe('building')
    await ui.unmount()
  })

  test('two quick presses of build spawn exactly one builder', async ($, on) => {
    const { w, ui } = await setup($, on)
    await Promise.all([ui.press({ key: 'build' }), ui.press({ key: 'build' })])
    expect(w.spawns).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    await ui.unmount()
  })

  test('deny marks failed and retry spawns again', async ($, on) => {
    const { w, ui } = await setup($, on, [{ deny: 'not now' }, { agentId: 'agent-2' }])
    await ui.press({ key: 'build' })
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeDefined()
    expect(statusOf(written(w))).toBe('failed')
    await ui.press({ key: 'retry' })
    expect(w.spawns).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    await ui.unmount()
  })

  test('turn.complete without refresh marks failed', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    await turnEnd($, 'someone-else')
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    await turnEnd($, 'agent-1')
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeDefined()
    expect(statusOf(written(w))).toBe('failed')
    await ui.unmount()
  })

  test('a timeout with no refresh marks failed', async ($, on) => {
    const { ui, clock } = await setup($, on)
    await ui.press({ key: 'build' })
    await clock.advance(BUILD_TIMEOUT_MS - 1)
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    await clock.advance(1)
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeDefined()
    await ui.unmount()
  })

  test('refresh after build flips status to built', async ($, on) => {
    const { w, ui, clock } = await setup($, on)
    await ui.press({ key: 'build' })
    w.files[FRAGMENT] = JSON.stringify(fragment())
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toBeUndefined()
    expect(String(r.result)).toMatch(/^3 Behaviours, 0 elements dropped/)
    const saved = written(w)
    expect(statusOf(saved)).toBe('built')
    expect(saved.elements.refunds!.evidence[0]!.status).toBe('verified')
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeUndefined()
    expect(await ui.find({ key: 'build' })).toBeUndefined()
    // The pending entry is gone: neither the agent's end nor the timeout marks it failed.
    await turnEnd($, 'agent-1')
    await clock.advance(BUILD_TIMEOUT_MS)
    expect(statusOf(written(w))).toBe('built')
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a timeout while the merge is queued leaves the subject built', async ($, on) => {
    const { w, ui, clock } = await setup($, on)
    await ui.press({ key: 'build' })
    w.files[FRAGMENT] = JSON.stringify(fragment())
    let release!: () => void
    w.holds[FRAGMENT] = new Promise<void>(r => (release = r))
    const refreshed = callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    await clock.settle() // the merge holds the writer, waiting on the fragment
    await clock.advance(BUILD_TIMEOUT_MS) // the timer fires: its check queues behind the merge
    release()
    expect((await refreshed).deny).toBeUndefined()
    await clock.settle()
    expect(statusOf(written(w))).toBe('built')
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a fragment for another subject is refused and the build fails', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const cancel = clone(model().behaviours.find(b => b.id === 'b-cancel')!)
    w.files[FRAGMENT] = JSON.stringify({ behaviour: cancel })
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toMatch(/fragment builds behaviour:b-cancel but .* is for behaviour:b-refund.*the build failed; stop, do not retry/)
    expect(statusOf(written(w))).toBe('failed')
    await ui.unmount()
  })

  test('an invalid fragment keeps the build pending and building, and returns the error to fix', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const f = fragment()
    delete (f as any).elements
    w.files[FRAGMENT] = JSON.stringify(f)
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toMatch(/names no Element/)
    expect(r.deny).toMatch(/fix the fragment and call mcp__how__refresh again \(2 resubmits left\)/)
    expect(statusOf(written(w))).toBe('building')
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    w.files[FRAGMENT] = '{'
    const r2 = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r2.deny).toMatch(/not valid JSON.*\(1 resubmit left\)/)
    expect(statusOf(written(w))).toBe('building')
    await ui.unmount()
  })

  test('a resubmit after a validation error merges', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const f = fragment()
    delete (f as any).elements
    w.files[FRAGMENT] = JSON.stringify(f)
    expect((await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })).deny).toBeDefined()
    w.files[FRAGMENT] = JSON.stringify(fragment())
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toBeUndefined()
    expect(String(r.result)).toContain(`(merged ${FRAGMENT})`)
    expect(statusOf(written(w))).toBe('built')
    await ui.unmount()
  })

  test('a third validation failure marks the subject failed and says to stop', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    w.files[FRAGMENT] = '{'
    for (let i = 0; i < 2; i++) {
      await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
      expect(statusOf(written(w))).toBe('building')
    }
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toMatch(/not valid JSON.*the build failed; stop, do not retry/)
    expect(statusOf(written(w))).toBe('failed')
    expect(await ui.find({ type: 'Text', text: /Build failed/ })).toBeDefined()
    // The pending entry is gone: a further refresh says no build is pending.
    expect((await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })).deny).toMatch(/no build is pending/)
    await ui.unmount()
  })

  test('an unreadable fragment fails the build at once', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toMatch(/Could not read the fragment.*the build failed; stop, do not retry/)
    expect(statusOf(written(w))).toBe('failed')
    await ui.unmount()
  })

  test('a model left building with no pending builder opens as failed, so it can be retried', async ($, on) => {
    mock.clock(on)
    const m = model()
    m.behaviours.find(b => b.id === 'b-refund')!.status = 'building'
    const w = world(on, { files: { ...sourcesFor(m), [MODEL_PATH]: JSON.stringify(m) } })
    await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(statusOf(written(w))).toBe('failed')
    const ui = await mountPane($)
    await ui.press({ key: 'behaviour-b-refund' })
    await ui.press({ key: 'retry' })
    expect(w.spawns).toHaveLength(1)
    // A refresh while the builder runs keeps it building.
    await callTool($, 'refresh', { modelPath: MODEL_PATH })
    expect(statusOf(written(w))).toBe('building')
    expect(await ui.find({ type: 'Text', text: /Building…/ })).toBeDefined()
    await ui.unmount()
  })

  test('a fragment in another how folder with the right name merges', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const elsewhere = `/private/tmp/other/how/${FRAGMENT_NAME}`
    w.files[elsewhere] = JSON.stringify(fragment())
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: elsewhere })
    expect(r.deny).toBeUndefined()
    expect(String(r.result)).toContain(`(merged ${elsewhere})`)
    expect(statusOf(written(w))).toBe('built')
    await ui.unmount()
  })

  test('a fragment with the wrong sha, a relative path or outside a how folder is rejected', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const bad = [
      `/var/folders/b/T/how/deadbeef1.behaviour_b-refund.fragment.json`,
      `/var/folders/b/T/${FRAGMENT_NAME}`,
      `/var/folders/b/T/how/../how/${FRAGMENT_NAME}`,
      `how/${FRAGMENT_NAME}`,
      `${CWD}/evil.fragment.json`,
    ]
    for (const fragmentPath of bad) {
      w.files[fragmentPath] = JSON.stringify(fragment())
      const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath })
      expect(r.deny).toMatch(/fragmentPath must/)
    }
    expect(w.reads.some(p => bad.includes(p))).toBe(false)
    expect(statusOf(written(w))).toBe('building')
    await ui.unmount()
  })

  test('a well-formed fragment for a subject with no pending build says to stop', async ($, on) => {
    const { w, ui } = await setup($, on)
    await ui.press({ key: 'build' })
    const other = `/var/folders/b/T/how/9be2d41c7a85.behaviour_b-cancel.fragment.json`
    w.files[other] = JSON.stringify(fragment())
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: other })
    expect(r.deny).toMatch(/no build is pending for this subject; stop, do not retry/)
    expect(w.reads.includes(other)).toBe(false)
    expect(statusOf(written(w))).toBe('building')
    await ui.unmount()
  })

  test('a fragment with nothing pending says to stop', async ($, on) => {
    const m = model()
    world(on, { files: { ...sourcesFor(m), [MODEL_PATH]: JSON.stringify(m) } })
    await callTool($, 'open', { modelPath: MODEL_PATH })
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH, fragmentPath: FRAGMENT })
    expect(r.deny).toMatch(/no build is pending for this subject; stop, do not retry/)
  })
})
