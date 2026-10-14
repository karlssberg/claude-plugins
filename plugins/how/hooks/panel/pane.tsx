// The Pane `how`: breadcrumb frame around the current view of the drill-down stack.
import type { BehaviourModel } from '../model/behaviour-model'
import { renderMap } from './behaviour-map'
import { type ModelState, type Navigation, popTo, type ViewRef } from './navigation'
import { truncate } from './text'

const CRUMB_MAX = 24
const BUTTON_PAD = 6

/**
 * What the panel layer gets from the Pane render hook in register.tsx. It carries closures instead of `$`
 * because the engine follows `$` only into functions of the same file, never across an import.
 */
export type PaneEnv = {
  ui: any // the surface's element table ($.ui.resolve(e))
  state: ModelState
  nav: Navigation
  updateNav: (fn: (n: Navigation) => Navigation) => Promise<unknown>
  reload: () => Promise<unknown> // register.tsx's requestReload; a stub until Task 10
}

export function crumbLabel(ref: ViewRef, model: BehaviourModel): string {
  switch (ref.kind) {
    case 'map':
      return 'Map'
    case 'behaviour':
      return model.behaviours.find(b => b.id === ref.behaviourId)?.name ?? ref.behaviourId
    case 'seam':
      return model.seams[ref.subjectId]?.name ?? model.elements[ref.subjectId]?.name ?? ref.subjectId
    case 'evidence':
      return 'Evidence'
  }
}

const PLACEHOLDER: Record<'behaviour' | 'seam' | 'evidence', string> = {
  behaviour: 'Behaviour view — coming in a later task',
  seam: 'Seam view — coming in a later task',
  evidence: 'Evidence — coming in a later task',
}

export async function renderPane(env: PaneEnv, e: unknown) {
  const { ui, nav, updateNav } = env
  const { Box, Text, Button } = ui
  const props = (e as any).props as { bodyColumns: number }
  const surface = String((e as any).surface ?? 'terminal')
  const columns = Math.max(10, props.bodyColumns)
  const { model, error } = env.state

  if (error !== undefined) {
    return (
      <Box flexDirection="column">
        <Box key="model-error">
          <Text color="red">{truncate(error, columns)}</Text>
        </Box>
        <Button key="reload" onPress={() => env.reload()}>
          Reload
        </Button>
      </Box>
    )
  }
  if (model === undefined) {
    return (
      <Box key="empty">
        <Text dimColor>{truncate('No Behaviour model loaded.', columns)}</Text>
      </Box>
    )
  }

  const current = nav.stack[nav.stack.length - 1] ?? { kind: 'map' as const }
  const crumbs = (
    <Box flexDirection="row">
      {nav.stack.map((ref, depth) => (
        <Box key={`crumb-box-${depth}`} flexDirection="row">
          {depth > 0 && <Text dimColor> &gt; </Text>}
          <Button key={`crumb-${depth}`} onPress={() => updateNav(n => popTo(n, depth))}>
            {truncate(crumbLabel(ref, model), Math.max(4, Math.min(CRUMB_MAX, columns - BUTTON_PAD)))}
          </Button>
        </Box>
      ))}
    </Box>
  )

  const body =
    current.kind === 'map' ? (
      await renderMap(ui, updateNav, model, nav, columns, surface)
    ) : (
      <Text dimColor>{truncate(PLACEHOLDER[current.kind], columns)}</Text>
    )

  return (
    <Box flexDirection="column">
      {crumbs}
      <Text> </Text>
      {body}
    </Box>
  )
}
