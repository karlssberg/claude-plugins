import { describe, expect, test } from 'claude-code/testing'
import { initialNavigation, popTo, push, toggleErrors, toggleGroup } from '../hooks/panel/navigation'

describe('navigation', () => {
  test('push then popTo(0) returns to map', () => {
    const a = push(initialNavigation(), { kind: 'behaviour', behaviourId: 'b1' })
    const b = push(a, { kind: 'seam', subjectId: 's1', behaviourId: 'b1' })
    expect(b.stack.length).toBe(3)
    expect(popTo(b, 1).stack).toEqual([{ kind: 'map' }, { kind: 'behaviour', behaviourId: 'b1' }])
    expect(popTo(b, 0).stack).toEqual([{ kind: 'map' }])
    expect(a.stack.length).toBe(2)
  })

  test('toggleErrors flips', () => {
    const a = initialNavigation()
    expect(a.showErrors).toBe(false)
    expect(toggleErrors(a).showErrors).toBe(true)
    expect(toggleErrors(toggleErrors(a)).showErrors).toBe(false)
  })

  test('toggleGroup adds and removes', () => {
    const a = toggleGroup(initialNavigation(), 'g1')
    expect(a.expandedGroups).toEqual(['g1'])
    expect(toggleGroup(a, 'g2').expandedGroups).toEqual(['g1', 'g2'])
    expect(toggleGroup(a, 'g1').expandedGroups).toEqual([])
  })
})
