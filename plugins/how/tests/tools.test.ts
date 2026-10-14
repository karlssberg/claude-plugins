import { describe, expect, test } from 'claude-code/testing'
import {
  applyStepDiffs,
  cachePathFor,
  formatLoadResult,
  fragmentNameFor,
  isCacheDir,
  isFragmentPathFor,
  isFullShaModelPath,
  isModelPath,
  resolvableStack,
} from '../hooks/drill-down'
import type { BehaviourModel } from '../hooks/model/behaviour-model'
import { initialNavigation } from '../hooks/panel/navigation'
import { codebaseSmallJson, prSmallJson } from './fixtures/models'
import { CWD, MODEL_PATH, callTool, clone, load, mountPane, sourcesFor, world, written } from './fixtures/world'

const model = (): BehaviourModel => clone(load(prSmallJson))
/** A full-sha staging copy and its cache file; `<git dir>/HEAD` proves the cache folder's parent is a git dir. */
const SHA = `9be2d41c7a85${'0'.repeat(28)}`
const STAGING = `/var/folders/x/T/how/${SHA}.json`
const CACHE_DIR = `${CWD}/.git/how`
const CACHE = `${CACHE_DIR}/${SHA}.json`
const GIT_HEAD = { [`${CWD}/.git/HEAD`]: 'ref: refs/heads/main\n' }
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
  test('a fragment is named <model sha>.<subject>.fragment.json', () => {
    expect(fragmentNameFor(MODEL_PATH, { kind: 'seam', subjectId: 'src/a.ts:Foo', behaviourId: 'b' })).toBe(
      '9be2d41c7a85.seam_src_a_ts_Foo.fragment.json',
    )
  })
  test('a fragment path is any <…>/how/<model sha>.<pending subject>.fragment.json without ..', () => {
    const seam = { kind: 'seam' as const, subjectId: 'src/a.ts:Foo', behaviourId: 'b' }
    const pending = [seam]
    const name = fragmentNameFor(MODEL_PATH, seam)
    expect(isFragmentPathFor(`/var/folders/x/T/how/${name}`, MODEL_PATH, pending)).toBe(true)
    expect(isFragmentPathFor(`${CWD}/.git/how/${name}`, MODEL_PATH, pending)).toBe(true)
    // parent folder must be `how`
    expect(isFragmentPathFor(`/var/folders/x/T/${name}`, MODEL_PATH, pending)).toBe(false)
    expect(isFragmentPathFor(`/tmp/hows/${name}`, MODEL_PATH, pending)).toBe(false)
    // no .. segment anywhere
    expect(isFragmentPathFor(`/tmp/how/../how/${name}`, MODEL_PATH, pending)).toBe(false)
    // wrong sha, wrong or not pending subject, wrong suffix
    expect(isFragmentPathFor(`/tmp/how/deadbeef1.seam_src_a_ts_Foo.fragment.json`, MODEL_PATH, pending)).toBe(false)
    expect(isFragmentPathFor(`/tmp/how/9be2d41c7a85.seam_other.fragment.json`, MODEL_PATH, pending)).toBe(false)
    expect(isFragmentPathFor(`/tmp/how/${name}`, MODEL_PATH, [])).toBe(false)
    expect(isFragmentPathFor(`/tmp/how/9be2d41c7a85.seam_src_a_ts_Foo.json`, MODEL_PATH, pending)).toBe(false)
    expect(isFragmentPathFor(42, MODEL_PATH, pending)).toBe(false)
    expect(isFragmentPathFor(`how/${name}`, MODEL_PATH, pending)).toBe(false)
  })
  test('cacheDir must be an absolute </…/.git or …x.git>/how with no . , .. or empty segment', () => {
    expect(isCacheDir(`${CWD}/.git/how`)).toBe(true)
    expect(isCacheDir('/srv/repo.git/how')).toBe(true)
    for (const bad of [
      `${CWD}/how`, `${CWD}/.git/hooks`, `${CWD}/.git/how/`, `${CWD}/.git/../how`, `${CWD}/git/how`, 'how', '', 42, undefined,
      'work/repo/.git/how', '.git/how', `${CWD}/./.git/how`, `/work//repo/.git/how`,
    ]) {
      expect(isCacheDir(bad)).toBe(false)
    }
    expect(cachePathFor(CACHE_DIR, STAGING)).toBe(CACHE)
  })
  test('a model staged for the cache must be named for a full 40- or 64-hex sha', () => {
    expect(isFullShaModelPath(STAGING)).toBe(true)
    expect(isFullShaModelPath(`/t/how/${'a'.repeat(64)}.json`)).toBe(true)
    expect(isFullShaModelPath(MODEL_PATH)).toBe(false)
    expect(isFullShaModelPath(`/t/how/${'a'.repeat(41)}.json`)).toBe(false)
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
  test('PR mode: a built Behaviour with no base twin keeps its Steps unchanged unless its Entry point changed', () => {
    const m = model() // b-cancel has no base twin
    const cancel = (x: BehaviourModel) => x.behaviours.find(b => b.id === 'b-cancel')!
    cancel(m).steps[0]!.diff = 'changed'
    cancel(m).errorFlows = [{ id: 'f', originStepId: cancel(m).steps[0]!.id, transforms: [], isSwallowed: true, isCatchAll: false, diff: 'added' }]
    const kept = cancel(applyStepDiffs(m))
    expect(kept.steps.map(s => s.diff)).toEqual(['unchanged', 'unchanged', 'unchanged'])
    expect(kept.errorFlows.map(f => f.diff)).toEqual(['unchanged'])
    m.elements['order-service']!.evidence[0]!.hunk = '@@ -0,0 +1,3 @@'
    const fresh = cancel(applyStepDiffs(m))
    expect(fresh.steps.map(s => s.diff)).toEqual(['added', 'added', 'added'])
    expect(fresh.errorFlows.map(f => f.diff)).toEqual(['added'])
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

  test('open with cacheDir reads the staging file and writes the verified model to the cache', async ($, on) => {
    const m = load(codebaseSmallJson) // b-refund is pending
    const w = world(on, { files: { ...sourcesFor(m), ...GIT_HEAD, [STAGING]: JSON.stringify(m) } })
    const r = await callTool($, 'open', { modelPath: STAGING, cacheDir: CACHE_DIR })
    expect(r.deny).toBeUndefined()
    expect(r.result).toMatch(/^3 Behaviours, 0 elements dropped/)
    expect(w.writes.map(x => x.path)).toEqual([CACHE])
    expect(written(w, CACHE).version).toBe(1)
    // The stored path is the cache: a build writes its status there and names it to the builder.
    const ui = await mountPane($)
    await ui.press({ key: 'behaviour-b-refund' })
    await ui.press({ key: 'build' })
    expect(w.spawns[0]!.prompt).toContain(`Behaviour model at ${CACHE}.`)
    expect(w.writes.every(x => x.path === CACHE)).toBe(true)
    expect(written(w, CACHE).behaviours.find(b => b.id === 'b-refund')!.status).toBe('building')
    await ui.unmount()
  })

  test('after an open with cacheDir, a refresh naming the staging copy is denied and writes nothing', async ($, on) => {
    const m = model()
    const w = world(on, { files: { ...sourcesFor(m), ...GIT_HEAD, [STAGING]: JSON.stringify(m) } })
    await callTool($, 'open', { modelPath: STAGING, cacheDir: CACHE_DIR })
    const before = w.writes.length
    const r = await callTool($, 'refresh', { modelPath: STAGING })
    expect(r.deny).toMatch(/modelPath must be the Behaviour model the panel holds/)
    expect(r.deny).toMatch(/stop, do not retry/)
    expect(w.writes.length).toBe(before)
    const ok = await callTool($, 'refresh', { modelPath: CACHE })
    expect(ok.deny).toBeUndefined()
    expect(w.writes.every(x => x.path === CACHE)).toBe(true)
  })

  test('a refresh before any open is denied', async ($, on) => {
    const w = world(on, { files: filesOf(model()) })
    const r = await callTool($, 'refresh', { modelPath: MODEL_PATH })
    expect(r.deny).toMatch(/modelPath must be the Behaviour model the panel holds/)
    expect(r.deny).toMatch(/stop, do not retry/)
    expect(w.reads).toEqual([])
  })

  test('reload after a failed open with cacheDir re-reads the staging file and writes the cache', async ($, on) => {
    const w = world(on, { files: { ...sourcesFor(model()), ...GIT_HEAD, [STAGING]: '{ not json' } })
    const r = await callTool($, 'open', { modelPath: STAGING, cacheDir: CACHE_DIR })
    expect(r.deny).toMatch(/not valid JSON/)
    expect(w.writes).toEqual([])
    w.files[STAGING] = JSON.stringify(model())
    const ui = await mountPane($)
    await ui.press({ key: 'reload' })
    expect(await ui.find({ key: 'behaviour-b-place' })).toBeDefined()
    expect(w.writes.map(x => x.path)).toEqual([CACHE])
    await ui.unmount()
  })

  test('a bad cacheDir, a cacheDir without a git HEAD, or a short sha is rejected without reading or writing', async ($, on) => {
    const w = world(on, {
      files: { ...filesOf(model()), [STAGING]: JSON.stringify(model()), '/srv/fake.git/how/x': '', [`/var/folders/x/T/how/9be2d41c7a85.json`]: '{}' },
    })
    for (const cacheDir of [`${CWD}/how`, `${CWD}/.git/hooks`, `${CWD}/.git/../how`, '/tmp/how', 42, CACHE_DIR, '/srv/fake.git/how']) {
      const r = await callTool($, 'open', { modelPath: STAGING, cacheDir })
      expect(r.deny).toMatch(/cacheDir must/)
    }
    w.files[`${CWD}/.git/HEAD`] = 'ref: refs/heads/main\n'
    const short = await callTool($, 'open', { modelPath: '/var/folders/x/T/how/9be2d41c7a85.json', cacheDir: CACHE_DIR })
    expect(short.deny).toMatch(/full 40- or 64-hex/)
    expect(w.reads).toEqual([])
    expect(w.writes).toEqual([])
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

describe('a dropped head Step and its base twin (R25a)', () => {
  test('a head Step with bad Evidence leaves no removed twin, and a second open writes the identical model', async ($, on) => {
    const m = model()
    m.behaviours[0]!.steps.find(s => s.id === 's4')!.evidence = [
      { file: 'src/gone.ts', startLine: 1, endLine: 2, symbol: 'gone', status: 'unchecked' },
    ]
    const { 'src/gone.ts': _gone, ...files } = filesOf(m)
    const w = world(on, { files })
    const r = await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(String(r.result)).toContain('s4: file missing: src/gone.ts')
    const first = written(w)
    const steps = first.behaviours[0]!.steps
    expect(steps.some(s => s.id === 's4' || s.id === 'base:s4')).toBe(false)
    expect(steps.filter(s => s.diff === 'removed')).toEqual([])
    expect(first.baseBehaviours![0]!.steps.some(s => s.id === 's4')).toBe(false)
    const firstText = w.writes.filter(x => x.path === MODEL_PATH).at(-1)!.text
    await callTool($, 'open', { modelPath: MODEL_PATH })
    expect(w.writes.filter(x => x.path === MODEL_PATH).at(-1)!.text).toBe(firstText)
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
    expect(specs.find(s => s.name === 'open').inputSchema.properties.cacheDir).toBeDefined()
    expect(specs.find(s => s.name === 'open').inputSchema.required).toEqual(['modelPath'])
  })

  test('a refused tool registration is logged and toasted, not swallowed', async ($, on) => {
    const logs: string[] = []
    const toasts: string[] = []
    world(on)
    on('tool.register', async () => ({ deny: 'Failed to start server. Is port 0 in use?' }) as any)
    on('ui.log', async (_$, e) => {
      logs.push((e as { text: string }).text)
      return { value: undefined } as any
    })
    on('ui.toast', async (_$, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as any
    })
    await $.session.start({ cwd: CWD, surface: null, isInteractive: false })
    expect(toasts).toEqual(['how: tools unavailable — Failed to start server. Is port 0 in use?'])
    expect(logs.some(l => l.includes('Failed to start server. Is port 0 in use?'))).toBe(true)
  })
})
