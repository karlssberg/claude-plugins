import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { orderBehaviours } from '../hooks/panel/behaviour-map'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
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
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

// The engine `$` has no state API and the owner alone writes `how/model`, so the test answers the read of the
// model atom (Task 10 is its writer); `how/nav` stays real.
const seed: { model: object; nav: object | null } = { model: {}, nav: null }
async function mount($: any, on: On, surface: 'terminal' | 'desktop', value: object, columns = 80, nav?: object) {
  seed.model = value
  seed.nav = nav ?? null
  {
    on('state.get', async (_$, e, next) =>
      e.plugin === 'how' && e.key === 'model'
        ? { value: { value: seed.model, version: 1 } }
        : e.plugin === 'how' && e.key === 'nav' && seed.nav !== null
          ? { value: { value: seed.nav, version: 1 } }
          : next(e),
    )
  }
  return $.ui.mount({ plugin: 'how', surface, component: 'Pane', requestId: 'how', props: props(columns) })
}

function manyBehaviours(): BehaviourModel {
  const m = clone(load(prSmallJson))
  const base = m.behaviours[1]!
  for (let i = 0; i < 7; i++) {
    m.behaviours.push({ ...clone(base), id: `x${i}`, name: `Extra ${i}`, risks: [], rank: { score: 0.1 + i / 100, signals: {} } })
  }
  return m
}

describe('Behaviour map', () => {
  for (const surface of SURFACES) {
    test(`shows behaviours in risk order (${surface})`, async ($, on) => {
      const m = clone(load(prSmallJson))
      m.behaviours[0]!.risks = ['high-fan-in']
      m.behaviours[1]!.risks = ['contract-change']
      const ui = await mount($, on, surface, { model: m })
      const buttons = await ui.findAll({ type: 'Button' })
      const keys = buttons.map((b: { key?: string }) => b.key).filter((k: string | undefined) => k?.startsWith('behaviour-'))
      expect(keys).toEqual(['behaviour-b-cancel', 'behaviour-b-place'])
      const first = await ui.find({ key: 'behaviour-b-cancel' })
      expect(first.text).toContain('Cancel an order')
      expect(first.text).toContain('contract-change')
      await ui.unmount()
    })

    test(`risk chips then score order (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      const place = await ui.find({ key: 'behaviour-b-place' })
      expect(place.text.indexOf('contract-change')).toBeLessThan(place.text.indexOf('error-handling-change'))
      const row = await ui.find({ key: 'seams-b-place' })
      expect(row.text).toContain('Seams: ')
      expect(row.text).toContain('Inventory reservation')
      await ui.unmount()
    })

    test(`press behaviour-b-place pushes behaviour view (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      expect(await ui.findAll({ key: 'crumb-0' })).toHaveLength(1)
      expect(await ui.find({ key: 'crumb-1' })).toBeUndefined()
      await ui.press({ key: 'behaviour-b-place' })
      expect((await ui.find({ key: 'crumb-0' }))?.text).toContain('Map')
      expect((await ui.find({ key: 'crumb-1' }))?.text).toContain('Place an order')
      expect(await ui.find({ key: 'crumb-2' })).toBeUndefined()
      expect(await ui.find({ key: 'behaviour-b-place' })).toBeUndefined()
      await ui.press({ key: 'crumb-0' })
      expect(await ui.find({ key: 'behaviour-b-place' })).toBeDefined()
      await ui.unmount()
    })

    test(`intent shown with sources (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      const intent = await ui.find({ key: 'intent' })
      expect(intent.text).toContain('Reject an order with 409')
      expect(intent.text).toContain('pr-description')
      await ui.unmount()
    })

    test(`intent missing is stated (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(codebaseSmallJson) })
      expect((await ui.find({ key: 'intent' }))?.text).toContain('Intent missing')
      await ui.unmount()
    })

    test(`intent mismatch shown (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      const mm = await ui.find({ key: 'mismatch-0' })
      expect(mm.text).toContain('Intent mismatch')
      expect(mm.text).toContain('cancelling is unchanged')
      expect(mm.text).toContain('releases the inventory reservation')
      await ui.unmount()
    })

    test(`incidental changes listed (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      const toggle = await ui.find({ key: 'incidental-toggle' })
      expect(toggle.text).toContain('Incidental changes (1)')
      expect(await ui.find({ key: 'incidental-0' })).toBeUndefined()
      await ui.press({ key: 'incidental-toggle' })
      expect((await ui.find({ key: 'incidental-0' }))?.text).toContain('src/orders/OrderService.ts')
      await ui.press({ key: 'incidental-toggle' })
      expect(await ui.find({ key: 'incidental-0' })).toBeUndefined()
      await ui.unmount()
    })

    test(`no incidental section when none (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(codebaseSmallJson) })
      expect(await ui.find({ key: 'incidental-toggle' })).toBeUndefined()
      await ui.unmount()
    })

    test(`show-more appears with 9 behaviours (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: manyBehaviours() })
      const shown = (await ui.findAll({ type: 'Button' })).filter((b: { key?: string }) => b.key?.startsWith('behaviour-'))
      expect(shown).toHaveLength(7)
      expect(await ui.find({ key: 'show-more' })).toBeDefined()
      await ui.press({ key: 'show-more' })
      const all = (await ui.findAll({ type: 'Button' })).filter((b: { key?: string }) => b.key?.startsWith('behaviour-'))
      expect(all).toHaveLength(9)
      expect(await ui.find({ key: 'show-more' })).toBeUndefined()
      await ui.unmount()
    })

    test(`no show-more with 2 behaviours (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { model: load(prSmallJson) })
      expect(await ui.find({ key: 'show-more' })).toBeUndefined()
      await ui.unmount()
    })

    test(`model error shows message and reload button (${surface})`, async ($, on) => {
      const ui = await mount($, on, surface, { error: 'Behaviour model is not valid JSON: boom' })
      expect((await ui.find({ key: 'model-error' }))?.text).toContain('boom')
      expect(await ui.find({ key: 'reload' })).toBeDefined()
      await ui.press({ key: 'reload' })
      expect(await ui.find({ key: 'reload' })).toBeDefined()
      await ui.unmount()
    })
  }

  test('terminal lists Seams as text and draws no Svg', async ($, on) => {
    const ui = await mount($, on, 'terminal', { model: load(prSmallJson) })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ key: 'seams-b-cancel' }))?.text).toBe('Seams: Order persistence')
    await ui.unmount()
  })

  test('desktop draws the Seam diagram with alt text', async ($, on) => {
    const ui = await mount($, on, 'desktop', { model: load(prSmallJson) })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg.props.alt).toBe('Behaviour map: 2 Behaviours, 3 Seams')
    expect(String(svg.props.source).startsWith('<svg')).toBe(true)
    await ui.unmount()
  })

  test('desktop skips the Svg when there are no Seams', async ($, on) => {
    const m = clone(load(prSmallJson))
    for (const b of m.behaviours) b.seamIds = []
    const ui = await mount($, on, 'desktop', { model: m })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })

  test('bodyColumns 40 draws without exceeding width', async ($, on) => {
    const m = clone(load(prSmallJson))
    m.intent.text = 'A very long intent statement that certainly runs past forty columns of terminal width, and then some more.'
    m.behaviours[0]!.name = 'A behaviour with an extremely long name that overflows'
    const ui = await mount($, on, 'terminal', { model: m }, 40)
    const texts = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))]
    expect(texts.length).toBeGreaterThan(5)
    for (const t of texts) {
      for (const line of String(t.text).split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(40)
    }
    await ui.unmount()
  })

  test('non-map views render a placeholder inside the breadcrumb frame', async ($, on) => {
    const ui = await mount($, on, 'terminal', { model: load(prSmallJson) })
    await ui.press({ key: 'behaviour-b-place' })
    expect(await ui.find({ key: 'crumb-0' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /coming in a later task/ })).toBeDefined()
    await ui.unmount()
  })

  test('navigation starts at the map', async ($, on) => {
    const ui = await mount($, on, 'terminal', { model: load(prSmallJson) })
    expect(await ui.find({ key: 'crumb-0' })).toBeDefined()
    await ui.unmount()
  })

  test('diagram stays within the node budget with 9+ Behaviours x 3 Seams, regardless of showAll', async ($, on) => {
    const m = clone(load(prSmallJson))
    const seamNames = ['seam-inventory', 'seam-payments', 'seam-repo']
    m.behaviours = []
    for (let i = 0; i < 10; i++) {
      const b = clone(load(prSmallJson).behaviours[0]!)
      b.id = `n${i}`
      b.name = `Behaviour ${i}`
      b.risks = []
      b.seamIds = seamNames
      m.behaviours.push(b)
    }
    for (let i = 0; i < 10; i++) {
      // distinct Seams per Behaviour so each costs 4 nodes
      for (let k = 0; k < 3; k++) m.seams[`u${i}${k}`] = { ...clone(m.seams['seam-repo']!), id: `u${i}${k}`, name: `Seam ${i}.${k}` }
      m.behaviours[i]!.seamIds = [0, 1, 2].map(k => `u${i}${k}`)
    }
    const nav = { stack: [{ kind: 'map' }], showErrors: false, expandedGroups: [], showAll: true }
    const ui = await mount($, on, 'desktop', { model: m }, 80, nav)
    const svg = await ui.find({ type: 'Svg' })
    expect(svg.props.alt).toBe('Behaviour map: 3 Behaviours, 9 Seams (top 3 of 10)')
    const shown = (await ui.findAll({ type: 'Button' })).filter((b: { key?: string }) => b.key?.startsWith('behaviour-'))
    expect(shown).toHaveLength(10)
    await ui.unmount()
  })

  test('alt text counts drawn nodes and duplicate seamIds add nothing', async ($, on) => {
    const m = clone(load(prSmallJson))
    m.behaviours[1]!.seamIds = ['seam-repo', 'seam-repo']
    const ui = await mount($, on, 'desktop', { model: m })
    expect((await ui.find({ type: 'Svg' })).props.alt).toBe('Behaviour map: 2 Behaviours, 3 Seams')
    await ui.unmount()
  })

  test('breadcrumb row of a 4-deep stack fits 40 columns, collapsing the middle', async ($, on) => {
    const nav = {
      stack: [
        { kind: 'map' },
        { kind: 'behaviour', behaviourId: 'b-place' },
        { kind: 'seam', subjectId: 'seam-inventory', behaviourId: 'b-place' },
        { kind: 'evidence', ownerId: 'seam-inventory', index: 0 },
      ],
      showErrors: false,
      expandedGroups: [],
      showAll: false,
    }
    const ui = await mount($, on, 'terminal', { model: load(prSmallJson) }, 40, nav)
    expect(await ui.find({ key: 'crumb-0' })).toBeDefined()
    expect(await ui.find({ key: 'crumb-3' })).toBeDefined()
    expect(await ui.find({ key: 'crumb-1' })).toBeUndefined()
    const crumbs = await ui.findAll({ type: 'Button', text: /./ })
    const row = (await ui.findAll({ type: 'Button' }))
      .filter((b: { key?: string }) => b.key?.startsWith('crumb-'))
      .reduce((n: number, b: { text: string }) => n + Array.from(b.text).length + 6, 0)
    expect(row + 7).toBeLessThanOrEqual(40)
    expect(crumbs.length).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('long model error is wrapped to the width', async ($, on) => {
    const ui = await mount($, on, 'terminal', { error: 'Behaviour model is not valid JSON: ' + 'x'.repeat(30) + ' and more words here' }, 30)
    for (const t of await ui.findAll({ type: 'Text' })) {
      for (const line of String(t.text).split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(30)
    }
    await ui.unmount()
  })
})

describe('orderBehaviours', () => {
  const b = (id: string, score: number, risks: string[]) => ({ id, rank: { score }, risks }) as any
  test('equal risk orders by score; no-risk sorts after risk', () => {
    const out = orderBehaviours([b('none-hi', 0.99, []), b('fan-lo', 0.1, ['high-fan-in']), b('fan-hi', 0.5, ['high-fan-in']), b('err', 0.2, ['error-handling-change'])])
    expect(out.map(x => x.id)).toEqual(['err', 'fan-hi', 'fan-lo', 'none-hi'])
  })
})
