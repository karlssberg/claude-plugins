import { describe, expect, test } from 'claude-code/testing'
import {
  applyStepDiffs,
  formatLoadResult,
  fragmentPathFor,
  isFragmentPathFor,
  isModelPath,
  resolvableStack,
} from '../hooks/drill-down'
import type { BehaviourModel } from '../hooks/model/behaviour-model'
import { initialNavigation } from '../hooks/panel/navigation'
import { prSmallJson } from './fixtures/models'
import { CWD, MODEL_PATH, callTool, clone, load, mountPane, sourcesFor, world, written } from './fixtures/world'

const model = (): BehaviourModel => clone(load(prSmallJson))
const filesOf = (m: BehaviourModel): Record<string, string> => ({ ...sourcesFor(m), [MODEL_PATH]: JSON.stringify(m) })

describe('model paths', () => {
  test('modelPath must be <…>/how/<hex 7-64>.json', () => {
    expect(isModelPath(MODEL_PATH)).toBe(true)
    expect(isModelPath('/r/.git/how/abcdef1.json')).toBe(true)
    expect(isModelPath('/r/.git/how/abcdef.json')).toBe(false)
    expect(isModelPath(`/r/how/${'a'.repeat(65)}.json`)).toBe(false)
    expect(isModelPath('/r/.git/how/zzzzzzz.json')).toBe(false)
    expect(isModelPath('/etc/passwd')).toBe(false)
    expect(isModelPath('/r/how/abcdef1.json.bak')).toBe(false)
    expect(isModelPath(42)).toBe(false)
  })
  test('a fragment sits beside the model with its stem and ends .fragment.json', () => {
    const f = fragmentPathFor(MODEL_PATH, { kind: 'seam', subjectId: 'src/a.ts:Foo', behaviourId: 'b' })
    expect(f).toBe(`${CWD}/.git/how/9be2d41c7a85.seam_src_a_ts_Foo.fragment.json`)
    expect(isFragmentPathFor(f, MODEL_PATH)).toBe(true)
    expect(isFragmentPathFor(`${CWD}/.git/how/9be2d41c7a85.x.json`, MODEL_PATH)).toBe(false)
    expect(isFragmentPathFor(`${CWD}/.git/how/9be2d41c7a85.a/../../x.fragment.json`, MODEL_PATH)).toBe(false)
    expect(isFragmentPathFor(`${CWD}/.git/how/other.x.fragment.json`, MODEL_PATH)).toBe(false)
    expect(isFragmentPathFor(`${CWD}/.git/how/9be2d41c7a85..fragment.json`, MODEL_PATH)).toBe(false)
  })
})

describe('pure helpers', () => {
  test('formatLoadResult lists at most 10 dropped then …', () => {
    const m = model()
    expect(formatLoadResult(m, [])).toBe('2 Behaviours, 0 elements dropped')
    const dropped = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, reason: 'file missing: x' }))
    const r = formatLoadResult(m, dropped)
    expect(r.startsWith('2 Behaviours, 12 elements dropped: e0: file missing: x; e1:')).toBe(true)
    expect(r).toContain('e9: file missing: x; …')
    expect(r).not.toContain('e10')
  })
  test('applyStepDiffs is idempotent', () => {
    const m = model()
    m.behaviours[0]!.steps = m.behaviours[0]!.steps.filter(s => s.id !== 's6')
    const once = applyStepDiffs(m)
    expect(once.behaviours[0]!.steps.filter(s => s.diff === 'removed').map(s => s.id)).toEqual(['base:s6'])
    expect(applyStepDiffs(once)).toEqual(once)
  })
  test('resolvableStack cuts at the first view that no longer resolves', () => {
    const m = model()
    const nav = {
      ...initialNavigation(),
      stack: [{ kind: 'map' as const }, { kind: 'behaviour' as const, behaviourId: 'gone' }, { kind: 'behaviour' as const, behaviourId: 'b-place' }],
    }
    expect(resolvableStack(nav, m).stack).toEqual([{ kind: 'map' }])
    const ok = { ...nav, stack: [nav.stack[0]!, nav.stack[2]!] }
    expect(resolvableStack(ok, m)).toEqual(ok)
  })
})

describe('mcp__how__open', () => {
  test('open loads, verifies, opens pane and reports dropped count', async ($, on) => {
    const m = model()
    m.elements['order-repo']!.evidence = [{ file: 'src/missing.ts', startLine: 1, endLine: 1, symbol: 'X', status: 'unchecked' }]
    const { 'src/missing.ts': _gone, ...files } = filesOf(m)
    const w = world(on, { files })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(r.deny).toBeUndefined()
    expect(r.result).toBe(
      '2 Behaviours, 3 elements dropped: order-repo: file missing: src/missing.ts; s5: touches dropped element "order-repo"; c3: touches dropped element "order-repo"',
    )
    expect(w.opened).toEqual([{ id: 'how', title: 'how' }])
    const saved = written(w)
    expect(saved.elements['order-repo']).toBeUndefined()
    expect(saved.elements['orders-api']!.evidence[0]!.status).toBe('verified')
    expect(w.writes.find(x => x.path === MODEL_PATH)!.text).toContain('\n  "version": 1')
    const ui = await mountPane($)
    expect(await ui.find({ key: 'behaviour-b-place' })).toBeDefined()
    await ui.unmount()
  })

  test('open with corrupt file sets model.error and still opens pane', async ($, on) => {
    const w = world(on, { files: { [MODEL_PATH]: '{ not json' } })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(r.deny).toMatch(/not valid JSON/)
    expect(w.opened).toHaveLength(1)
    expect(w.writes).toHaveLength(0)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /not valid JSON/ })).toBeDefined()
    expect(await ui.find({ key: 'reload' })).toBeDefined()
    // Fixed on disk: Reload re-runs open on the stored path.
    Object.assign(w.files, filesOf(model()))
    await ui.press({ key: 'reload' })
    expect(await ui.find({ key: 'behaviour-b-place' })).toBeDefined()
    await ui.unmount()
  })

  test('open with a missing file sets model.error', async ($, on) => {
    const w = world(on)
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(r.deny).toMatch(/Could not read the Behaviour model/)
    expect(w.opened).toHaveLength(1)
  })

  test('a bad modelPath is rejected without reading', async ($, on) => {
    const w = world(on, { files: { '/etc/passwd': 'root' } })
    for (const modelPath of ['/etc/passwd', '/work/repo/model.json', '/x/how/zz.json', undefined]) {
      const r = await callTool($, 'open', { modelPath })
      expect(r.deny).toMatch(/modelPath must/)
      const rr = await callTool($, 'refresh', { modelPath })
      expect(rr.deny).toMatch(/modelPath must/)
    }
    expect(w.reads).toEqual([])
    expect(w.opened).toEqual([])
  })

  test('containment rejects a cited /etc/passwd and a symlink that leads outside', async ($, on) => {
    const m = model()
    m.elements['order-repo']!.evidence = [{ file: '/etc/passwd', startLine: 1, endLine: 1, symbol: 'root', status: 'unchecked' }]
    m.elements['error-mw']!.evidence = [{ file: 'src/link.ts', startLine: 1, endLine: 1, symbol: 'secret', status: 'unchecked' }]
    const w = world(on, {
      files: { ...filesOf(m), '/etc/passwd': 'root', 'src/link.ts': 'secret' },
      links: { 'src/link.ts': '/etc/secret' },
    })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(String(r.result)).toContain('order-repo: file missing: /etc/passwd')
    expect(String(r.result)).toContain('error-mw: file missing: src/link.ts')
    expect(w.reads.some(p => p === '/etc/passwd' || p.endsWith('/link.ts'))).toBe(false)
  })

  test('markStepDiffs is applied on open: a base-only Step appears as removed', async ($, on) => {
    const m = model()
    m.behaviours[0]!.steps = m.behaviours[0]!.steps.filter(s => s.id !== 's6')
    const w = world(on, { files: filesOf(m) })
    await callTool($, 'open', { modelPath: MODEL_PATH })
    const steps = written(w).behaviours[0]!.steps
    expect(steps.find(s => s.id === 'base:s6')?.diff).toBe('removed')
    expect(steps.find(s => s.id === 's1')?.diff).toBe('unchanged')
    // Re-opening what was written keeps one removed Step, not two.
    await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(written(w).behaviours[0]!.steps.filter(s => s.diff === 'removed')).toHaveLength(1)
  })
})

describe('base Evidence (R25)', () => {
  const AUDIT = 'src/audit/AuditLog.ts'
  /** prSmall whose base Place an order also wrote an audit entry, in a file the PR deleted. */
  const withRemovedAudit = (): BehaviourModel => {
    const m = model()
    m.elements['audit-log'] = {
      id: 'audit-log',
      name: 'AuditLog',
      level: 'component',
      evidence: [{ file: AUDIT, startLine: 3, endLine: 20, symbol: 'AuditLog', status: 'unchecked' }],
    }
    const base = m.baseBehaviours![0]!
    base.elementIds = [...base.elementIds, 'audit-log']
    base.steps = [
      ...base.steps,
      {
        id: 's7', order: 7, from: 'order-service', to: 'audit-log', label: 'write audit entry', kind: 'effect', diff: 'unchanged',
        evidence: [{ file: AUDIT, startLine: 8, endLine: 9, symbol: 'AuditLog.write', status: 'unchecked', hunk: '@@ -8,2 +7,0 @@\n-write(e) {\n-}' }],
      },
    ]
    return m
  }

  test('a removed Step in a file deleted at head survives open and shows as removed', async ($, on) => {
    const m = withRemovedAudit()
    const { [AUDIT]: _deleted, ...files } = filesOf(m)
    const w = world(on, { files })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(r.result).toBe('2 Behaviours, 0 elements dropped')
    const saved = written(w)
    const removed = saved.behaviours[0]!.steps.find(s => s.id === 'base:s7')
    expect(removed?.diff).toBe('removed')
    expect(removed?.evidence[0]!.status).toBe('unchecked')
    expect(saved.elements['audit-log']?.evidence[0]!.status).toBe('unchecked')
    expect(saved.baseBehaviours![0]!.steps.some(s => s.id === 's7')).toBe(true)
    expect(w.reads.some(p => p.endsWith(AUDIT))).toBe(false)
    // Re-opening what was written keeps it.
    await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(written(w).behaviours[0]!.steps.filter(s => s.id === 'base:s7')).toHaveLength(1)
  })

  test('an unchanged Step still drops when its file is missing', async ($, on) => {
    const m = withRemovedAudit()
    m.behaviours[0]!.steps.find(s => s.id === 's4')!.evidence = [
      { file: 'src/gone.ts', startLine: 1, endLine: 2, symbol: 'gone', status: 'unchecked' },
    ]
    const { [AUDIT]: _deleted, 'src/gone.ts': _gone, ...files } = filesOf(m)
    const w = world(on, { files })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(String(r.result)).toContain('s4: file missing: src/gone.ts')
    expect(written(w).behaviours[0]!.steps.some(s => s.id === 's4')).toBe(false)
  })
})

describe('mcp__how__refresh', () => {
  test('refresh keeps navigation stack', async ($, on) => {
    const w = world(on, { files: filesOf(model()) })
    await callTool($, 'open', { modelPath: MODEL_PATH })
    const ui = await mountPane($)
    await ui.press({ key: 'behaviour-b-cancel' })
    expect(await ui.find({ key: 'crumb-1' })).toBeDefined()
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH })
    expect(r.result).toBe('2 Behaviours, 0 elements dropped')
    expect(await ui.find({ key: 'crumb-1' })).toBeDefined()
    // A Behaviour gone from the file truncates the stack to what still resolves.
    const m = model()
    m.behaviours = m.behaviours.filter(b => b.id !== 'b-cancel')
    w.files[MODEL_PATH] = JSON.stringify(m)
    await callTool($, 'refresh', { modelPath: MODEL_PATH })
    expect(await ui.find({ key: 'crumb-1' })).toBeUndefined()
    // open resets to the map.
    await ui.press({ key: 'behaviour-b-place' })
    await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(await ui.find({ key: 'crumb-1' })).toBeUndefined()
    await ui.unmount()
  })

  test('tools are registered at session.start, not deferred', async ($, on) => {
    const specs: any[] = []
    world(on)
    on('tool.register', async (_$, e) => {
      specs.push(e)
      return { value: { tool: `mcp__how__${(e as { name: string }).name}` } } as any
    })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    expect(specs.map(s => s.name).sort()).toEqual(['open', 'refresh'])
    for (const s of specs) {
      expect(s.isDeferred).toBe(false)
      expect(s.inputSchema.required).toContain('modelPath')
    }
    expect(specs.find(s => s.name === 'refresh').inputSchema.properties.fragmentPath).toBeDefined()
  })
})
