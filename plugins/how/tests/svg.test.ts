import { describe, expect, test } from 'claude-code/testing'
import { CELL_PX, type Layout } from '../hooks/layout/geometry'
import { layoutBehaviourView } from '../hooks/layout/sequence-layout'
import { toSvg } from '../hooks/layout/svg'
import { type BehaviourModel, parseBehaviourModel } from '../hooks/model/behaviour-model'
import { prSmallJson } from './fixtures/models'

const load = (): BehaviourModel => {
  const r = parseBehaviourModel(prSmallJson)
  if ('error' in r) throw new Error(r.error)
  return r.model
}

function wellFormed(svg: string) {
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(svg)).toBe(false)
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m
    if (self) continue
    if (close) expect(stack.pop()).toBe(name)
    else stack.push(name!)
  }
  expect(stack).toEqual([])
}

describe('toSvg', () => {
  test('labels with < & " and emoji produce well-formed svg', () => {
    const m = load()
    const b = JSON.parse(JSON.stringify((m.behaviours[0]!))) as typeof m.behaviours[0]
    b.steps[0]!.label = `🚀<b & "c" 'd'>`
    const els = { ...m.elements, 'orders-api': { ...m.elements['orders-api']!, name: 'A&B <x>' } }
    const svg = toSvg(layoutBehaviourView(b, { ...m, elements: els }, { maxCols: 120, showErrors: true }), CELL_PX)
    wellFormed(svg)
    expect(svg).toContain('&lt;')
    expect(svg).toContain('&amp;')
    expect(svg).toContain('🚀')
    expect(svg).not.toContain('A&B')
  })

  test('is safe: no script, handlers or external references; has dark mode and data-ids', () => {
    const m = load()
    const b = JSON.parse(JSON.stringify((m.behaviours[0]!))) as typeof m.behaviours[0]
    b.errorFlows[0]!.isSwallowed = true
    const svg = toSvg(layoutBehaviourView(b, m, { maxCols: 120, showErrors: true }), CELL_PX)
    expect(/<script/i.test(svg)).toBe(false)
    expect(/\son\w+=/i.test(svg)).toBe(false)
    expect(/href=|url\((?!#)|@import|<image|<foreignObject/i.test(svg)).toBe(false)
    expect(svg).toContain('prefers-color-scheme: dark')
    expect(svg).toContain('data-id="orders-api"')
    expect(svg).toContain('<title>')
    expect(svg).toContain('swallowed')
    expect(svg).toContain('diff-changed')
  })

  test('svg for 20 nodes is under 131072 chars', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      label: `Element${i}`,
      rect: { col: i * 6, row: 0, cols: 5, rows: 3 },
      style: { diff: 'unchanged' as const, isInferred: i % 2 === 0, isGroup: false, isFaded: false },
    }))
    const edges = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      from: `n${i % 20}`,
      to: `n${(i + 3) % 20}`,
      label: 'call something()',
      points: [{ col: (i % 20) * 6 + 2, row: 5 + i * 3 }, { col: ((i + 3) % 20) * 6 + 2, row: 5 + i * 3 }],
      style: { diff: 'added' as const, isInferred: false, isGroup: false, isFaded: false, isSeamCrossing: true },
    }))
    const layout: Layout = { cols: 120, rows: 190, nodes, edges }
    const svg = toSvg(layout, CELL_PX)
    wellFormed(svg)
    expect(svg.length).toBeLessThan(131072)
  })
})
