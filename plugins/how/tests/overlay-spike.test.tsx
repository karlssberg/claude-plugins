import { test, expect } from 'claude-code/testing'

const PROPS = { title: 'how', isFocused: false, bodyColumns: 80, placement: 'inline' } as any

test('desktop: buttons overlay the Svg and press sets state', async $ => {
  const ui = await $.ui.mount({ plugin: 'how', surface: 'desktop', component: 'Pane', props: PROPS, requestId: 'how' })
  expect(await ui.find({ key: 'node-b' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.press({ key: 'node-b' })
  expect((await ui.find({ key: 'pressed' }))?.text).toContain('node-b')
  await ui.unmount()
})

test('terminal: tree validates without Svg', async $ => {
  const ui = await $.ui.mount({ plugin: 'how', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'how' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ key: 'node-b' })).toBeDefined()
  await ui.unmount()
})
