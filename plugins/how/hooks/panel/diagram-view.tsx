// Behaviour view (sequence diagram of one Behaviour) and Seam view (flowchart of one Seam or element), with
// pressable nodes, Seam crossings and Evidence, the Error overlay toggle, and a text rendering for the terminal.
import { CELL_PX, type Layout, type LayoutEdge, type LayoutNode, OVERLAY_MODE } from '../layout/geometry'
import { layoutSeamView } from '../layout/graph-layout'
import { layoutBehaviourView } from '../layout/sequence-layout'
import { toSvg } from '../layout/svg'
import type { Behaviour, BehaviourModel, BuildStatus, DiffStatus, Evidence } from '../model/behaviour-model'
import { SVG_MAX_CHARS } from './behaviour-map'
import { renderDiagramText } from './diagram-text'
import { type Navigation, push, toggleErrors, toggleGroup, type ViewRef } from './navigation'
import type { PaneEnv } from './pane'
import { truncate, wrap } from './text'

export type DiagramRef = Extract<ViewRef, { kind: 'behaviour' | 'seam' }>
export type DiagramNode = { id: string; text: string; layout: LayoutNode; onPress: () => unknown }
export type DiagramRow = { id: string; line: string; isError: boolean; edge: LayoutEdge; onPress?: () => unknown }
export type Diagram = { layout: Layout; nodes: DiagramNode[]; rows: DiagramRow[]; alt: string }

// Room taken by the engine's Button decoration ("[ ] " / hotkey) when a label is drawn.
export const BUTTON_PAD = 6

const diffTag = (d: DiffStatus) => (d === 'unchanged' ? '' : ` [${d}]`)

/** One text line of a diagram row: `from → to : label [diff]`, error rows prefixed ⚠. */
export function rowLine(r: { from: string; to: string; label: string; edge: LayoutEdge }): string {
  const s = r.edge.style
  const label = r.label === '' ? '' : ` : ${r.label}`
  return (
    `${s.isError ? '⚠ ' : ''}${r.from} → ${r.to}${label}${diffTag(s.diff)}` +
    `${s.isSwallowed ? ' (swallowed)' : ''}${s.isInferred ? ' (inferred)' : ''}`
  )
}

const evidenceRef = (e: Evidence) => `${e.file}:${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ''}`

function groupName(id: string, model: BehaviourModel, fallback: string): string {
  if (id.startsWith('group:other')) return 'Other'
  return model.elements[id.slice('group:'.length)]?.name ?? fallback
}

function behaviourDiagram(env: PaneEnv, b: Behaviour, model: BehaviourModel, nav: Navigation, width: number): Diagram {
  const layout = layoutBehaviourView(b, model, { maxCols: width, showErrors: nav.showErrors, expandedGroups: nav.expandedGroups })
  const go = (to: ViewRef) => env.updateNav(n => push(n, to))
  const byId = new Map(layout.nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => {
    const n = byId.get(id)
    const base = n?.style.isGroup ? groupName(id, model, n.label) : (model.elements[id]?.name ?? n?.label ?? id)
    return n?.style.isInferred ? `${base} (inferred)` : base
  }
  const nodes = layout.nodes.map(n => ({
    id: n.id,
    text: n.style.isGroup ? `+ ${nameOf(n.id)} (group)` : `${nameOf(n.id)}${diffTag(n.style.diff)}`,
    layout: n,
    onPress: n.style.isGroup
      ? () => env.updateNav(nv => toggleGroup(nv, n.id))
      : () => go({ kind: 'seam', subjectId: n.id, behaviourId: b.id }),
  }))
  const rows = layout.edges.map(edge => {
    const step = b.steps.find(s => s.id === edge.id)
    let label = edge.label
    let seamId = edge.style.isSeamCrossing ? step?.seamId : undefined
    if (step && !(edge.from === edge.to && byId.get(edge.from)?.style.isGroup)) label = step.label
    if (edge.id.startsWith('error:')) {
      // Error rows are `error:<flow id>:<hop>`: one hop per transform, then the handler hop.
      const cut = edge.id.lastIndexOf(':')
      const flow = b.errorFlows.find(f => f.id === edge.id.slice('error:'.length, cut))
      const hop = Number(edge.id.slice(cut + 1))
      const t = flow?.transforms[hop]
      if (t) {
        label = t.into
        if (edge.style.isSeamCrossing) seamId = t.seamId
      } else if (flow) label = flow.handler ? 'handled' : 'unhandled'
    }
    return {
      id: edge.id,
      line: rowLine({ from: nameOf(edge.from), to: nameOf(edge.to), label, edge }),
      isError: edge.style.isError === true,
      edge,
      onPress: seamId === undefined ? undefined : () => go({ kind: 'seam', subjectId: seamId, behaviourId: b.id }),
    }
  })
  return { layout, nodes, rows, alt: `${b.name}: ${b.steps.length} steps` }
}

async function seamDiagram(env: PaneEnv, ref: Extract<ViewRef, { kind: 'seam' }>, model: BehaviourModel, nav: Navigation, width: number): Promise<Diagram> {
  const view = model.seamViews[ref.subjectId]!
  const layout = await layoutSeamView(view, { maxCols: width, showErrors: nav.showErrors })
  const flow = new Map(view.nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => {
    const n = flow.get(id)
    return `${n?.label ?? id}${layout.nodes.find(l => l.id === id)?.style.isInferred ? ' (inferred)' : ''}`
  }
  const nodes = layout.nodes.map(n => ({
    id: n.id,
    text: `${nameOf(n.id)}${diffTag(n.style.diff)}`,
    layout: n,
    // A flow node is no element: it opens its own Evidence.
    onPress: () =>
      (flow.get(n.id)?.evidence.length ?? 0) > 0 ? env.updateNav(nv => push(nv, { kind: 'evidence', ownerId: n.id, index: 0 })) : undefined,
  }))
  const rows = layout.edges.map(edge => ({
    id: edge.id,
    line: rowLine({ from: nameOf(edge.from), to: nameOf(edge.to), label: edge.label, edge }),
    isError: edge.style.isError === true,
    edge,
  }))
  const subject = model.seams[ref.subjectId]?.name ?? model.elements[ref.subjectId]?.name ?? ref.subjectId
  return { layout, nodes, rows, alt: `${subject}: ${layout.nodes.length} nodes` }
}

/** The Behaviour or Seam view body (without breadcrumb). Takes no `$` (see register.tsx). */
export async function renderDiagramView(
  env: PaneEnv,
  ref: DiagramRef,
  model: BehaviourModel,
  nav: Navigation,
  columns: number,
  surface: string,
  mode: 'overlay' | 'legend' = OVERLAY_MODE,
) {
  const { Box, Text, Button, Svg } = env.ui
  const width = Math.max(10, columns)
  const hasSvg = (surface === 'desktop' || surface === 'vscode') && Svg !== undefined
  const lines = (text: string, color?: string, bold?: boolean) =>
    wrap(text, width).map((l: string) => (
      <Text color={color} bold={bold}>
        {l}
      </Text>
    ))

  // Header, build status and the Evidence of the subject.
  const behaviour = model.behaviours.find(b => b.id === ref.behaviourId)
  let header: unknown = null
  let status: BuildStatus | 'missing'
  let evidence: { ownerId: string; label: string; items: Evidence[] }[]
  if (ref.kind === 'seam') {
    const seam = model.seams[ref.subjectId]
    const element = model.elements[ref.subjectId]
    header = (
      <Box key="seam-header" flexDirection="column">
        {seam
          ? [
              ...lines(`Contract: ${seam.contract.text}`),
              ...(seam.enablingPoint ? lines(`Enabling point: ${seam.enablingPoint.file}:${seam.enablingPoint.startLine}`) : []),
              ...(seam.isContractChanged ? lines('Contract changed', 'yellow', true) : []),
            ]
          : lines(element ? `${element.name} (${element.level})` : `Unknown subject ${ref.subjectId}`)}
      </Box>
    )
    const items = seam ? seam.contract.evidence : (element?.evidence ?? [])
    evidence = [{ ownerId: ref.subjectId, label: '', items }]
    status = model.seamViews[ref.subjectId]?.status ?? (seam || element ? 'pending' : 'missing')
  } else {
    status = behaviour ? behaviour.status : 'missing'
    evidence = (behaviour?.steps ?? []).map(s => ({ ownerId: s.id, label: `${s.label}: `, items: s.evidence }))
  }

  const evidenceList = (
    <Box key="evidence" flexDirection="column">
      {evidence.flatMap(o =>
        o.items.map((e, i) => (
          <Button key={`evidence-${o.ownerId}-${i}`} onPress={() => env.updateNav(n => push(n, { kind: 'evidence', ownerId: o.ownerId, index: i }))}>
            {truncate(`${o.label}${evidenceRef(e)}`, width - BUTTON_PAD)}
          </Button>
        )),
      )}
    </Box>
  )

  if (status !== 'built') {
    const build = () => env.requestBuild(ref)
    const state =
      status === 'missing' ? (
        <Box key="build-state">{lines('Not found in the Behaviour model.')}</Box>
      ) : status === 'building' ? (
        <Box key="build-state">{lines('Building…', 'yellow')}</Box>
      ) : status === 'failed' ? (
        <Box key="build-state" flexDirection="column">
          {lines('Build failed', 'red')}
          <Button key="retry" onPress={build}>
            Retry
          </Button>
        </Box>
      ) : (
        <Box key="build-state" flexDirection="column">
          {lines('Not built yet')}
          <Button key="build" onPress={build}>
            Build
          </Button>
        </Box>
      )
    return (
      <Box flexDirection="column">
        {header}
        {state}
        {evidenceList}
      </Box>
    )
  }

  const diagram =
    ref.kind === 'seam' ? await seamDiagram(env, ref, model, nav, width) : behaviourDiagram(env, behaviour!, model, nav, width)

  // Groups this Behaviour folded that the reader has expanded: one Button each to fold them again.
  const collapsible =
    ref.kind === 'behaviour' && nav.expandedGroups.length > 0
      ? layoutBehaviourView(behaviour!, model, { maxCols: width, showErrors: nav.showErrors, expandedGroups: [] })
          .nodes.filter(n => n.style.isGroup && nav.expandedGroups.includes(n.id))
      : []

  const controls = (
    <Box flexDirection="column">
      <Button key="toggle-errors" onPress={() => env.updateNav(toggleErrors)}>
        {nav.showErrors ? 'Hide errors' : 'Show errors'}
      </Button>
      <Box key="legend" flexDirection="row" flexWrap="wrap">
        <Text color="green">added </Text>
        <Text dimColor strikethrough>
          removed
        </Text>
        <Text color="yellow"> changed </Text>
        <Text dimColor>· dashed = Inferred</Text>
      </Box>
      {collapsible.map(g => (
        <Button key={`collapse-${g.id}`} onPress={() => env.updateNav(n => toggleGroup(n, g.id))}>
          {truncate(`- ${groupName(g.id, model, g.label)} (group)`, width - BUTTON_PAD)}
        </Button>
      ))}
    </Box>
  )

  const svg = hasSvg ? drawSvg(diagram, mode) : undefined
  const body = svg === undefined ? renderDiagramText(env.ui, diagram, width) : renderDesktop(env.ui, diagram, svg, mode, width)
  return (
    <Box flexDirection="column">
      {header}
      {controls}
      {body}
      {evidenceList}
    </Box>
  )
}

/** The SVG source: in legend mode nodes and Seam crossings carry their legend numbers. Undefined when too large. */
function drawSvg(d: Diagram, mode: 'overlay' | 'legend'): string | undefined {
  let layout = d.layout
  if (mode === 'legend') {
    const numbered = (n: number, label: string, room: number) => truncate(`${n} ${label}`, Math.max(Array.from(label).length, room))
    const crossings = d.rows.filter(r => r.onPress)
    layout = {
      ...layout,
      nodes: layout.nodes.map((n, i) => ({ ...n, label: numbered(i + 1, n.label, n.rect.cols - 4) })),
      edges: layout.edges.map(e => {
        const k = crossings.findIndex(r => r.id === e.id)
        return k < 0 ? e : { ...e, label: numbered(layout.nodes.length + k + 1, e.label, 3) }
      }),
    }
  }
  const source = toSvg(layout, CELL_PX)
  return source.length > SVG_MAX_CHARS ? undefined : source
}

function renderDesktop(ui: any, d: Diagram, source: string, mode: 'overlay' | 'legend', width: number) {
  const { Box, Text, Button, Svg } = ui
  const { cols, rows } = d.layout
  const svg = <Svg source={source} alt={d.alt} isInteractive width={cols * CELL_PX.width} height={rows * CELL_PX.height} />
  const crossings = d.rows.filter(r => r.onPress)
  const errors = d.rows.filter(r => r.isError)
  const errorList = (
    <Box flexDirection="column">
      {errors.map((r, i) => (
        <Box key={`error-row-${i}`}>
          <Text color="red">{truncate(r.line, width)}</Text>
        </Box>
      ))}
    </Box>
  )
  if (mode === 'overlay') {
    return (
      <Box flexDirection="column">
        <Box key="diagram" position="relative" width={cols} height={rows}>
          {svg}
          {d.nodes.map(n => (
            <Box key={`at-node-${n.id}`} position="absolute" left={n.layout.rect.col} top={n.layout.rect.row}>
              <Button key={`node-${n.id}`} onPress={n.onPress}>
                {truncate(n.layout.label, Math.max(1, n.layout.rect.cols))}
              </Button>
            </Box>
          ))}
          {crossings.map(r => {
            const pts = r.edge.points
            const left = Math.round((pts[0]!.col + pts[pts.length - 1]!.col) / 2)
            return (
              <Box key={`at-edge-${r.id}`} position="absolute" left={left} top={Math.max(0, pts[0]!.row - 1)}>
                <Button key={`edge-${r.id}`} onPress={r.onPress}>
                  {truncate(r.edge.label || '↔', 12)}
                </Button>
              </Box>
            )
          })}
        </Box>
        {errorList}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {svg}
      {d.nodes.map((n, i) => (
        <Button key={`node-${n.id}`} onPress={n.onPress}>
          {truncate(`${i + 1}. ${n.text}`, width - BUTTON_PAD)}
        </Button>
      ))}
      {crossings.map((r, k) => (
        <Button key={`edge-${r.id}`} onPress={r.onPress}>
          {truncate(`${d.nodes.length + k + 1}. ${r.line}`, width - BUTTON_PAD)}
        </Button>
      ))}
      {errorList}
    </Box>
  )
}
