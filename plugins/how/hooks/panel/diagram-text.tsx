// Text rendering of a Behaviour or Seam view for surfaces without Svg (the terminal): one Button per node, one
// line per row, Seam crossings pressable.
import type { Diagram } from './diagram-view'
import { BUTTON_PAD, truncate } from './text'

const colorOf = (diff: string, isError: boolean) =>
  isError ? 'red' : diff === 'added' ? 'green' : diff === 'changed' ? 'yellow' : undefined

export function renderDiagramText(ui: any, d: Diagram, width: number) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Box key="nodes" flexDirection="column">
        {d.nodes.map(n =>
          n.onPress ? (
            <Button key={`node-${n.id}`} onPress={n.onPress}>
              {truncate(n.text, width - BUTTON_PAD)}
            </Button>
          ) : (
            <Box key={`node-text-${n.id}`}>
              <Text>{truncate(n.text, width)}</Text>
            </Box>
          ),
        )}
      </Box>
      <Text> </Text>
      <Box key="rows" flexDirection="column">
        {d.rows.map((r, i) => {
          const s = r.edge.style
          const props = { color: colorOf(s.diff, r.isError), dimColor: s.diff === 'removed', strikethrough: s.diff === 'removed' }
          return (
            <Box key={`row-${i}`}>
              {r.onPress ? (
                <Button key={`edge-${r.id}`} onPress={r.onPress}>
                  <Text {...props}>{truncate(r.line, width - BUTTON_PAD)}</Text>
                </Button>
              ) : (
                <Text {...props}>{truncate(r.line, width)}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
