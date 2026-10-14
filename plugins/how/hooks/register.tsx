import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { CELL_PX } from './layout/geometry'

export const PANE_ID = 'how'

// SPIKE: temporary /how-spike command; removed in the next commit.
const pressed = atom({ plugin: 'how', key: 'pressed' } as const, '')

const NODES = [
  { key: 'node-a', col: 2, row: 1 },
  { key: 'node-b', col: 14, row: 4 },
  { key: 'node-c', col: 26, row: 7 },
] as const
const W = 8
const H = 2

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'how-spike', description: 'Overlay spike' })
    return next(e)
  })

  on('command.run', { command: 'how-spike' }, async $ => {
    await $.ui.open({ id: PANE_ID, title: 'how' })
    return { text: 'opened' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const last = await read($, pressed)
    const rects = NODES.map(
      n =>
        `<rect x="${n.col * CELL_PX.width}" y="${n.row * CELL_PX.height}" width="${W * CELL_PX.width}" height="${H * CELL_PX.height}" fill="none" stroke="currentColor"/>`,
    ).join('')
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${40 * CELL_PX.width}" height="${10 * CELL_PX.height}">${rects}</svg>`
    const buttons = NODES.map(n => (
      <Box key={`box-${n.key}`} position="absolute" top={n.row} left={n.col}>
        <Button key={n.key} onPress={() => update($, pressed, () => n.key)}>
          {n.key}
        </Button>
      </Box>
    ))
    return (
      <Box flexDirection="column">
        {e.surface !== 'terminal' && Svg ? (
          <Box>
            <Svg source={source} alt="spike" width={40 * CELL_PX.width} height={10 * CELL_PX.height} />
            {buttons}
          </Box>
        ) : (
          <Box flexDirection="column">{NODES.map(n => (
            <Button key={n.key} onPress={() => update($, pressed, () => n.key)}>{n.key}</Button>
          ))}</Box>
        )}
        <Box key="pressed"><Text>pressed: {last}</Text></Box>
      </Box>
    )
  })
}
