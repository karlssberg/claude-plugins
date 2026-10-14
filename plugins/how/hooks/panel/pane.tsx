// The Pane `how`: breadcrumb frame around the current view of the drill-down stack.
import type { BehaviourModel } from '../model/behaviour-model'
import { renderMap } from './behaviour-map'
import { renderDiagramView } from './diagram-view'
import { type ModelState, type Navigation, popTo, type ViewRef } from './navigation'
import { BUTTON_PAD, truncate, wrap } from './text'

const CRUMB_MAX = 24

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
  /** Builds a pending or failed Behaviour or Seam view: register.tsx's requestBuild; a stub until Task 10. */
  requestBuild: (subject: Extract<ViewRef, { kind: 'behaviour' | 'seam' }>) => Promise<unknown>
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

const EVIDENCE_PLACEHOLDER = 'Evidence — coming in a later task'

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
        <Box key="model-error" flexDirection="column">
          {wrap(error, columns).map((l: string) => (
            <Text color="red">{l}</Text>
          ))}
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
  const SEP = 3 // " > "
  const n = nav.stack.length
  const perFull = Math.floor((columns - SEP * (n - 1)) / n) - BUTTON_PAD
  // Too narrow for every crumb: keep the first and last pressable, collapse the middle into one "…".
  const collapsed = n > 2 && perFull < 4
  const shownDepths = collapsed ? [0, n - 1] : nav.stack.map((_, d) => d)
  const room = collapsed ? Math.floor((columns - SEP * 2 - 1) / 2) - BUTTON_PAD : perFull
  const labelWidth = Math.max(1, Math.min(CRUMB_MAX, room))
  const crumbs = (
    <Box flexDirection="row">
      {shownDepths.map((depth, i) => (
        <Box key={`crumb-box-${depth}`} flexDirection="row">
          {i > 0 && collapsed && i === 1 && <Text dimColor> &gt; … &gt; </Text>}
          {i > 0 && !collapsed && <Text dimColor> &gt; </Text>}
          <Button key={`crumb-${depth}`} onPress={() => updateNav(nv => popTo(nv, depth))}>
            {truncate(crumbLabel(nav.stack[depth]!, model), labelWidth)}
          </Button>
        </Box>
      ))}
    </Box>
  )

  const body =
    current.kind === 'map' ? (
      await renderMap(ui, updateNav, model, nav, columns, surface)
    ) : current.kind === 'evidence' ? (
      <Text dimColor>{truncate(EVIDENCE_PLACEHOLDER, columns)}</Text>
    ) : (
      await renderDiagramView(env, current, model, nav, columns, surface)
    )

  return (
    <Box flexDirection="column">
      {crumbs}
      <Text> </Text>
      {body}
    </Box>
  )
}
