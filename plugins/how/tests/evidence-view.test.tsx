import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import { containedPath } from '../hooks/model/paths'
import { absolutePath, sliceSnippet } from '../hooks/panel/evidence-view'
import { prSmallJson } from './fixtures/models'

const load = (json: string): BehaviourModel => {
  const r = parseBehaviourModel(json)
  if ('error' in r) throw new Error(r.error)
  return r.model
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const props = (columns = 80) => ({
  title: 'how',
  isFocused: true,
  bodyColumns: columns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
})

const FILE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
const HUNK = '@@ -10,2 +10,2 @@\n line 10\n-old 11\n+line 11'
const OWNER = 'step:b-place:s1'

/** prSmall with Step s1 holding two Evidence items (the first with a hunk and a read-able file). */
function model(): BehaviourModel {
  const m = clone(load(prSmallJson))
  const s1 = m.behaviours[0]!.steps.find(s => s.id === 's1')!
  s1.evidence = [
    { file: 'src/orders.ts', startLine: 10, endLine: 11, symbol: 'create', status: 'verified', hunk: HUNK },
    { file: 'src/other.ts', startLine: 2, endLine: 2, symbol: 'other', status: 'inferred' },
  ]
  return m
}

type Seed = { model: BehaviourModel; nav: object | null; snippets: object | null; files: Record<string, string>; cwd: string | undefined }
const seed: Seed = { model: model(), nav: null, snippets: null, files: {}, cwd: '/work/repo' }

/** Answers the reads of `how/model` (Task 10 writes it), optionally seeds nav/snippets, fs.read and session.cwd. */
async function mount($: any, on: On | undefined, surface: string, s: Partial<Seed> = {}) {
  Object.assign(seed, { model: model(), nav: null, snippets: null, files: { 'src/orders.ts': FILE }, cwd: '/work/repo' }, s)
  if (on) {
  on('state.get', async (_$, e, next) => {
    if (e.plugin !== 'how') return next(e)
    if (e.key === 'model') return { value: { value: { model: seed.model }, version: 1 } }
    if (e.key === 'nav' && seed.nav) return { value: { value: seed.nav, version: 1 } }
    if (e.key === 'snippets' && seed.snippets) return { value: { value: seed.snippets, version: 1 } }
    return next(e)
  })
  on('fs.read', async (_$, e, next) => {
    // The engine resolves a relative path against the cwd before the hook sees it: match by suffix.
    const path = String((e as any).path)
    const text = Object.entries(seed.files).find(([f]) => path.endsWith(`/${f}`))?.[1]
    return text === undefined ? { deny: `ENOENT: ${(e as any).path}` } : { value: text }
  })
  on('session.cwd', async (_$, _e, next) => (seed.cwd === undefined ? next(_e) : { value: seed.cwd }))
  }
  return $.ui.mount({ plugin: 'how', surface, component: 'Pane', requestId: 'how', props: props() })
}

/** The source (not diff) Code of `path`, if drawn. */
const sourceCode = async (ui: any, path: string) =>
  (await ui.findAll({ type: 'Code' })).find((c: any) => c.props.path === path && c.props.format !== 'diff')

const navAt = (index: number, ownerId = OWNER) => ({
  stack: [{ kind: 'map' }, { kind: 'evidence', ownerId, index }],
  showErrors: false,
  expandedGroups: [],
  showAll: false,
})
const SNIPPET = { 'src/orders.ts:10-11': { source: 'line 7\nline 8\nline 9\nline 10\nline 11\nline 12\nline 13\nline 14', startLine: 7 } }

describe('slice helpers', () => {
  test('sliceSnippet keeps the cited lines +-3 and clamps at the file edges', () => {
    expect(sliceSnippet(FILE, 10, 11, 'f')).toEqual({ source: SNIPPET['src/orders.ts:10-11'].source, startLine: 7 })
    expect((sliceSnippet(FILE, 1, 1, 'f') as any).startLine).toBe(1)
    expect((sliceSnippet(FILE, 30, 30, 'f') as any).source.split('\n').pop()).toBe('line 30')
  })
  test('lines beyond the end of the file are an error; CRLF and a trailing newline are handled', () => {
    expect(sliceSnippet(FILE, 40, 41, 'f.ts')).toEqual({ error: 'lines 40-41 are beyond the end of f.ts (30 lines)' })
    expect(sliceSnippet('a\nb', 5, 4, 'f.ts')).toEqual({ error: 'lines 5-4 are beyond the end of f.ts (2 lines)' })
    expect(sliceSnippet('a\r\nb\r\n', 2, 2, 'f')).toEqual({ source: 'a\nb', startLine: 1 })
  })
  test('a long range is capped at 200 lines with a count of the rest', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i + 1}`).join('\n')
    const r = sliceSnippet(big, 10, 400, 'f') as any
    expect(r.source.split('\n')).toHaveLength(200)
    expect(r.more).toBe(403 - 7 + 1 - 200)
  })
  test('absolutePath joins the cwd and normalised path; outside is undefined', () => {
    expect(absolutePath('/work/repo/', 'src/./a.ts')).toBe('/work/repo/src/a.ts')
    expect(absolutePath('/work/repo', '/etc/x')).toBeUndefined()
  })
})

describe('containedPath', () => {
  test('relative, absolute and missing-cwd cases', () => {
    expect(containedPath('a/../b', '/w')).toBe('b')
    expect(containedPath('./src/x.ts', '/w')).toBe('src/x.ts')
    expect(containedPath('../x', '/w')).toBeUndefined()
    expect(containedPath('a/../../x', '/w')).toBeUndefined()
    expect(containedPath('/etc/passwd', '/w')).toBeUndefined()
    expect(containedPath('/w/src/x.ts', '/w')).toBe('src/x.ts')
    expect(containedPath('/w/../etc/x', '/w')).toBeUndefined()
    expect(containedPath('/wx/y', '/w')).toBeUndefined()
    expect(containedPath('src/x.ts', undefined)).toBe('src/x.ts')
    expect(containedPath('/w/src/x.ts', undefined)).toBeUndefined()
  })
})

describe('Evidence view', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows cited lines with startLine gutter (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { nav: navAt(0), snippets: SNIPPET })
      const code = await sourceCode(ui, 'src/orders.ts')
      expect(code.props.startLine).toBe(7)
      expect(code.props.source).toContain('line 10\nline 11')
      expect(code.props.format).toBeUndefined()
      expect((await ui.find({ key: 'crumb-1' }))?.text).toContain('Evidence')
      expect(await ui.find({ type: 'Text', text: /POST \/orders/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^verified$/ })).toBeDefined()
      await ui.unmount()
    })

    test(`shows diff hunk when present (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { nav: navAt(0), snippets: SNIPPET })
      const diff = (await ui.findAll({ type: 'Code' })).find((c: any) => c.props.format === 'diff')
      expect(diff.props.source).toBe(HUNK)
      await ui.unmount()
      // No hunk: only the source Code, and the inferred chip.
      const ui2 = await mount($, undefined, surface, { nav: navAt(1), snippets: { 'src/other.ts:2-2': { source: 'x', startLine: 1 } } })
      expect((await ui2.findAll({ type: 'Code' })).filter((c: any) => c.props.format === 'diff')).toHaveLength(0)
      expect(await ui2.find({ type: 'Text', text: /inferred \(not proven by the code\)/ })).toBeDefined()
      await ui2.unmount()
    })

    test(`unreadable file shows "source unavailable" not a throw (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { nav: navAt(0), snippets: { 'src/orders.ts:10-11': { error: 'ENOENT: src/orders.ts' } } })
      expect(await ui.find({ type: 'Text', text: /source unavailable/ })).toBeDefined()
      expect(await sourceCode(ui, 'src/orders.ts')).toBeUndefined()
      await ui.unmount()
    })
  }

  test('terminal has editor link, desktop has none', async ($, on) => {
    const ui = await mount($, on, 'terminal', { nav: navAt(0), snippets: SNIPPET })
    expect((await ui.find({ type: 'Link' })).props.href).toBe('vscode://file//work/repo/src/orders.ts:10')
    await ui.unmount()
    const ui2 = await mount($, undefined, 'desktop', { nav: navAt(0), snippets: SNIPPET })
    expect(await ui2.find({ type: 'Link' })).toBeUndefined()
    await ui2.unmount()
  })

  test('openEvidence stores the snippet and pushes the view; prev/next switch index without stacking', async ($, on) => {
    const ui = await mount($, on, 'terminal', { files: { 'src/orders.ts': FILE, 'src/other.ts': 'a\nb\nc\nd' } })
    await ui.press({ key: 'behaviour-b-place' })
    await ui.press({ key: `evidence-${OWNER}-0` })
    expect((await ui.find({ key: 'crumb-2' }))?.text).toContain('Evidence')
    const code = await sourceCode(ui, 'src/orders.ts')
    expect(code.props.startLine).toBe(7)
    expect(code.props.source).toBe(SNIPPET['src/orders.ts:10-11'].source)
    expect(await ui.find({ key: 'prev-evidence' })).toBeUndefined()
    await ui.press({ key: 'next-evidence' })
    expect(await ui.find({ key: 'crumb-3' })).toBeUndefined()
    expect((await sourceCode(ui, 'src/other.ts')).props.source).toBe('a\nb\nc\nd')
    expect(await ui.find({ key: 'next-evidence' })).toBeUndefined()
    await ui.press({ key: 'prev-evidence' })
    expect(await sourceCode(ui, 'src/orders.ts')).toBeDefined()
    await ui.unmount()
  })

  test('openEvidence with an unreadable file still opens the view', async ($, on) => {
    const ui = await mount($, on, 'terminal', { files: {} })
    await ui.press({ key: 'behaviour-b-place' })
    await ui.press({ key: `evidence-${OWNER}-0` })
    expect(await ui.find({ type: 'Text', text: /source unavailable/ })).toBeDefined()
    await ui.unmount()
  })

  test('a cited path outside the repository is never read', async ($, on) => {
    const m = model()
    m.behaviours[0]!.steps.find(st => st.id === 's1')!.evidence[0]!.file = '../../.ssh/id'
    const ui = await mount($, on, 'terminal', { model: m, files: { '.ssh/id': 'SECRET' } })
    await ui.press({ key: 'behaviour-b-place' })
    await ui.press({ key: `evidence-${OWNER}-0` })
    expect(await ui.find({ type: 'Text', text: /path outside the repository: \.\.\/\.\.\/\.ssh\/id/ })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  })

  test('lines beyond the end of the file show source unavailable', async ($, on) => {
    const ui = await mount($, on, 'terminal', { files: { 'src/orders.ts': 'only\none' } })
    await ui.press({ key: 'behaviour-b-place' })
    await ui.press({ key: `evidence-${OWNER}-0` })
    expect(await ui.find({ type: 'Text', text: /beyond the end of src\/orders\.ts \(2 lines\)/ })).toBeDefined()
    await ui.unmount()
  })

  test('no cwd means no editor link', async ($, on) => {
    const ui = await mount($, on, 'terminal', { nav: navAt(0), snippets: SNIPPET, cwd: undefined })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  })
})
