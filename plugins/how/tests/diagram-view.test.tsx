import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { CELL_PX } from '../hooks/layout/geometry'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import { renderDiagramView } from '../hooks/panel/diagram-view'
import { initialNavigation, type Navigation, type ViewRef } from '../hooks/panel/navigation'
import { codebaseSmallJson, prSmallJson } from './fixtures/models'

const SURFACES = ['terminal', 'desktop'] as const

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

// Ways into a view from the Behaviour map, as presses: the nav state stays real.
const behaviourPath = (showErrors = false) => ['behaviour-b-place', ...(showErrors ? ['toggle-errors'] : [])]
const SEAM_PATH: Record<string, string[]> = {
  'seam-inventory': ['behaviour-b-place', 'edge-s3'],
  'seam-payments': ['behaviour-b-place', 'edge-s4'],
  'order-service': ['behaviour-b-place', 'node-order-service'],
}

// Same technique as behaviour-map.test.tsx: answer the read of `how/model` (Task 10 is its writer).
const seed: { model: object } = { model: {} }
/**
 * Mounts the Pane on `model` and presses `path` from the Behaviour map. Pass `on` on the first mount of a test
 * only (hooks register once per test); a later mount first presses crumb-0 back to the map.
 */
async function mount($: any, on: On | undefined, surface: string, model: BehaviourModel, path: string[], columns = 80) {
  seed.model = { model }
  if (on) {
    on('state.get', async (_$, e, next) =>
      e.plugin === 'how' && e.key === 'model' ? { value: { value: seed.model, version: 1 } } : next(e),
    )
  }
  const ui = await $.ui.mount({ plugin: 'how', surface, component: 'Pane', requestId: 'how', props: props(columns) })
  if (!on) await ui.press({ key: 'crumb-0' })
  for (const key of path) await ui.press({ key })
  return ui
}

const keysWith = async (ui: any, prefix: string): Promise<string[]> =>
  (await ui.findAll({ type: 'Button' })).map((b: { key?: string }) => b.key ?? '').filter((k: string) => k.startsWith(prefix))

/** 30 Elements in three parent packages, a chain of unchanged Steps: nothing pinned but the entry point. */
function wideModel(): BehaviourModel {
  const m = clone(load(prSmallJson))
  const ev = [{ file: 'src/x.ts', startLine: 1, endLine: 2, symbol: 'x', status: 'verified' as const }]
  for (const p of ['pkg-a', 'pkg-b', 'pkg-c']) m.elements[p] = { id: p, name: p.toUpperCase(), level: 'container', evidence: ev }
  const ids: string[] = []
  for (let i = 0; i < 30; i++) {
    const id = `e${i}`
    ids.push(id)
    m.elements[id] = { id, name: `Elem ${i}`, level: 'component', parentId: ['pkg-a', 'pkg-b', 'pkg-c'][Math.floor(i / 10)], evidence: ev }
  }
  m.behaviours = [
    {
      ...clone(m.behaviours[0]!),
      id: 'b-wide',
      name: 'Wide',
      entryPointId: 'e0',
      elementIds: ids,
      seamIds: [],
      errorFlows: [],
      steps: ids.slice(1).map((to, i) => ({
        id: `w${i}`, order: i, from: ids[i]!, to, label: `call ${i}`, kind: 'call' as const, diff: 'unchanged' as const, evidence: ev,
      })),
    },
  ]
  return m
}

describe('Behaviour view and Seam view', () => {
  for (const surface of SURFACES) {
    test(`behaviour view renders a node button per visible element (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, load(prSmallJson), behaviourPath())
      const nodes = await keysWith(ui, 'node-')
      expect(nodes.sort()).toEqual(
        ['client', 'orders-api', 'order-service', 'inventory', 'payments', 'order-repo', 'error-mw'].map(id => `node-${id}`).sort(),
      )
      expect((await ui.find({ key: 'node-order-service' }))?.text).toContain('OrderService')
      await ui.press({ key: 'node-order-service' })
      expect((await ui.find({ key: 'crumb-2' }))?.text).toContain('OrderService')
      expect((await ui.find({ key: 'seam-header' }))?.text).toContain('OrderService (component)')
      expect(await ui.find({ key: 'node-n1' })).toBeDefined()
      await ui.unmount()
    })

    test(`pressing a seam crossing opens seam view showing its contract (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, load(prSmallJson), behaviourPath())
      expect(await keysWith(ui, 'edge-')).toEqual(['edge-s3', 'edge-s4', 'edge-s5'])
      await ui.press({ key: 'edge-s3' })
      expect((await ui.find({ key: 'crumb-2' }))?.text).toContain('Inventory')
      const header = (await ui.find({ key: 'seam-header' }))?.text ?? ''
      expect(header).toContain('POST /reservations returns 201')
      expect(header).toContain('src/config/container.ts:22')
      // No Seam view built for it yet: a build Button (Task 10 starts the build).
      expect((await ui.find({ key: 'build-state' }))?.text).toContain('Not built yet')
      await ui.press({ key: 'build' })
      expect(await ui.find({ key: 'build' })).toBeDefined()
      await ui.unmount()
    })

    test(`toggle-errors shows error rows and swallowed badge (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.behaviours[0]!.errorFlows[0]!.isSwallowed = true
      const ui = await mount($, on, surface, m, behaviourPath())
      expect((await ui.find({ key: 'toggle-errors' }))?.text).toContain('Show errors')
      expect(await ui.find({ type: 'Text', text: /⚠/ })).toBeUndefined()
      await ui.press({ key: 'toggle-errors' })
      expect((await ui.find({ key: 'toggle-errors' }))?.text).toContain('Hide errors')
      expect(await ui.find({ type: 'Text', text: /⚠/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /swallowed/ })).toBeDefined()
      await ui.press({ key: 'toggle-errors' })
      expect(await ui.find({ type: 'Text', text: /⚠/ })).toBeUndefined()
      await ui.unmount()
    })

    test(`contract-changed seam is flagged (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, load(prSmallJson), SEAM_PATH['seam-inventory']!)
      expect((await ui.find({ key: 'seam-header' }))?.text).toContain('Contract changed')
      await ui.unmount()
      const ui2 = await mount($, undefined, surface, load(prSmallJson), SEAM_PATH['seam-payments']!)
      expect((await ui2.find({ key: 'seam-header' }))?.text).not.toContain('Contract changed')
      await ui2.unmount()
    })

    test(`30-element behaviour shows ≤12 node buttons plus group buttons; pressing a group expands it (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, wideModel(), ['behaviour-b-wide'])
      const nodes = await keysWith(ui, 'node-')
      expect(nodes.length).toBeLessThanOrEqual(12)
      const groups = nodes.filter(k => k.startsWith('node-group:'))
      expect(groups.length).toBeGreaterThan(0)
      await ui.press({ key: groups[0]! })
      const after = await keysWith(ui, 'node-')
      expect(after).not.toContain(groups[0])
      expect(after.length).toBeGreaterThan(nodes.length)
      const collapse = `collapse-${groups[0]!.slice('node-'.length)}`
      expect(await ui.find({ key: collapse })).toBeDefined()
      await ui.press({ key: collapse })
      expect(await keysWith(ui, 'node-')).toEqual(nodes)
      await ui.unmount()
    })

    test(`inferred element is marked (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      for (const e of m.elements.inventory!.evidence) e.status = 'inferred'
      const ui = await mount($, on, surface, m, behaviourPath())
      if (surface === 'desktop') {
        expect(String((await ui.find({ type: 'Svg' })).props.source)).toMatch(/class="node[^"]*inferred/)
      } else {
        expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      }
      expect(await ui.find({ text: /InventoryClient \(inferred\)/ })).toBeDefined()
      expect((await ui.find({ key: 'legend' }))?.text).toContain('dashed = Inferred')
      await ui.unmount()
    })

    test(`removed step shown (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.behaviours[0]!.steps[4]!.diff = 'removed'
      const ui = await mount($, on, surface, m, behaviourPath())
      if (surface === 'desktop') {
        expect(String((await ui.find({ type: 'Svg' })).props.source)).toMatch(/class="edge diff-removed/)
      } else {
        expect((await ui.find({ key: 'edge-s5' }))?.text).toMatch(/save order \[removed\]/)
      }
      expect((await ui.find({ key: 'legend' }))?.text).toMatch(/added.*removed.*changed/)
      await ui.unmount()
    })

    test(`changed error flow is marked in the overlay (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.behaviours[0]!.errorFlows[0]!.diff = 'changed'
      const ui = await mount($, on, surface, m, behaviourPath(true))
      expect(await ui.find({ type: 'Text', text: /⚠.*OutOfStockError \[changed\]/ })).toBeDefined()
      if (surface === 'desktop') {
        expect(String((await ui.find({ type: 'Svg' })).props.source)).toMatch(/class="edge diff-changed[^"]*error/)
      }
      await ui.unmount()
    })

    test(`failed seam view shows retry (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.seamViews['order-service']!.status = 'failed'
      const ui = await mount($, on, surface, m, SEAM_PATH['order-service']!)
      expect((await ui.find({ key: 'build-state' }))?.text).toContain('Build failed')
      expect(await ui.find({ key: 'retry' })).toBeDefined()
      await ui.press({ key: 'retry' })
      expect(await ui.find({ key: 'retry' })).toBeDefined()
      expect(await ui.find({ key: 'node-n1' })).toBeUndefined()
      await ui.unmount()
    })

    test(`building seam view and pending behaviour show their state (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.seamViews['order-service']!.status = 'building'
      const ui = await mount($, on, surface, m, SEAM_PATH['order-service']!)
      expect((await ui.find({ key: 'build-state' }))?.text).toContain('Building…')
      expect(await ui.find({ key: 'retry' })).toBeUndefined()
      expect(await ui.find({ key: 'build' })).toBeUndefined()
      await ui.unmount()
      const ui2 = await mount($, undefined, surface, load(codebaseSmallJson), ['behaviour-b-refund'])
      expect((await ui2.find({ key: 'build-state' }))?.text).toContain('Not built yet')
      expect(await ui2.find({ key: 'build' })).toBeDefined()
      await ui2.unmount()
    })

    test(`evidence buttons push the Evidence view (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, load(prSmallJson), behaviourPath())
      expect(await ui.find({ key: 'evidence-s3-0' })).toBeDefined()
      await ui.press({ key: 'evidence-s3-0' })
      expect((await ui.find({ key: 'crumb-2' }))?.text).toContain('Evidence')
      await ui.unmount()
      const ui2 = await mount($, undefined, surface, load(prSmallJson), SEAM_PATH['seam-inventory']!)
      expect(await ui2.find({ key: 'evidence-seam-inventory-0' })).toBeDefined()
      await ui2.unmount()
    })

    test(`seam view of a built element lists its flow rows (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, load(prSmallJson), SEAM_PATH['order-service']!)
      expect(await keysWith(ui, 'node-')).toEqual(['node-n1', 'node-n2', 'node-n4'])
      await ui.press({ key: 'toggle-errors' })
      expect(await keysWith(ui, 'node-')).toContain('node-n3')
      if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /⚠ stock available\? → OutOfStockError : no \[added\]/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('desktop Svg is interactive with the Behaviour name and step count as alt', async ($, on) => {
    const ui = await mount($, on, 'desktop', load(prSmallJson), behaviourPath())
    const svg = await ui.find({ type: 'Svg' })
    expect(svg.props.isInteractive).toBe(true)
    expect(svg.props.alt).toBe('Place an order: 6 steps')
    expect(String(svg.props.source).startsWith('<svg')).toBe(true)
    // legend mode numbers the labels in the SVG and in the Button list
    expect((await ui.find({ key: 'node-client' }))?.text).toMatch(/^\d+\. Client/)
    await ui.unmount()
  })

  test('terminal step lines read from → to : label', async ($, on) => {
    const ui = await mount($, on, 'terminal', load(prSmallJson), behaviourPath())
    expect(await ui.find({ type: 'Text', text: 'Client → OrdersController : POST /orders' })).toBeDefined()
    expect((await ui.find({ key: 'edge-s3' }))?.text).toContain('OrderService → InventoryClient : reserve stock [changed]')
    await ui.unmount()
  })

  test('terminal at 40 columns keeps every line within the width', async ($, on) => {
    const ui = await mount($, on, 'terminal', load(prSmallJson), behaviourPath(true), 40)
    const all = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]
    for (const t of all) for (const line of String(t.text).split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(40)
    await ui.unmount()
    const ui2 = await mount($, undefined, 'terminal', load(prSmallJson), SEAM_PATH['seam-inventory']!, 40)
    for (const t of await ui2.findAll({ type: 'Text' })) for (const line of String(t.text).split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(40)
    await ui2.unmount()
  })
})

// The overlay branch of R1, exercised by calling the renderer with the mode given and a tag-name element table.
type VNode = { type: string; props?: Record<string, any>; children?: (VNode | string)[] }
const walk = (n: VNode | string, out: VNode[] = []): VNode[] => {
  if (typeof n === 'string') return out
  out.push(n)
  for (const c of n.children ?? []) walk(c, out)
  return out
}
const parentOf = (root: VNode, target: VNode): VNode | undefined =>
  walk(root).find(n => (n.children ?? []).includes(target))

describe('overlay mode', () => {
  const ui = { Box: 'Box', Text: 'Text', Button: 'Button', Svg: 'Svg' }
  const envFor = (nav: Navigation, applied: Navigation[]) => ({
    ui,
    state: {},
    nav,
    updateNav: async (fn: (n: Navigation) => Navigation) => applied.push(fn(nav)),
    reload: async () => {},
    requestBuild: async () => {},
  })

  test('absolute node and seam-crossing Buttons sit at the layout cells over a Svg of the same size', async () => {
    const nav: Navigation = { ...initialNavigation(), stack: [{ kind: 'map' }, { kind: 'behaviour', behaviourId: 'b-place' }] }
    const applied: Navigation[] = []
    const ref = nav.stack[1] as Extract<ViewRef, { kind: 'behaviour' }>
    const tree = (await renderDiagramView(envFor(nav, applied) as any, ref, load(prSmallJson), nav, 80, 'desktop', 'overlay')) as VNode
    const nodes = walk(tree)
    const svg = nodes.find(n => n.type === 'Svg')!
    const frame = parentOf(tree, svg)!
    expect(frame.props?.width).toBe(svg.props!.width / CELL_PX.width)
    expect(frame.props?.height).toBe(svg.props!.height / CELL_PX.height)
    // The entry point is the first lifeline: its header box starts at cell (0, 0).
    const entry = nodes.find(n => n.type === 'Button' && n.props?.key === 'node-orders-api')!
    const holder = parentOf(tree, entry)!
    expect(holder.props?.position).toBe('absolute')
    expect(holder.props?.left).toBe(0)
    expect(holder.props?.top).toBe(0)
    const client = nodes.find(n => n.type === 'Button' && n.props?.key === 'node-client')!
    expect(parentOf(tree, client)!.props?.left).toBeGreaterThan(0)
    expect(parentOf(tree, holder)).toBe(frame)
    const edge = nodes.find(n => n.type === 'Button' && n.props?.key === 'edge-s3')!
    expect(parentOf(tree, edge)!.props?.position).toBe('absolute')
    await (edge as any).onPress() // h() lifts handlers off props onto the element
    expect(applied[0]!.stack[2]).toEqual({ kind: 'seam', subjectId: 'seam-inventory', behaviourId: 'b-place' })
    // no numbered legend list in overlay mode
    expect(String(svg.props!.source)).not.toMatch(/>1 Client</)
  })
})
