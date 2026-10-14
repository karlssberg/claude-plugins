// Behaviour map: the top drill-down level. Intent, ranked Behaviours with risk chips and Seams, incidental changes.
import { CELL_PX, type NodeStyle } from '../layout/geometry'
import { layoutGraph } from '../layout/graph-layout'
import { toSvg } from '../layout/svg'
import type { Behaviour, BehaviourModel, Seam } from '../model/behaviour-model'
import { type Navigation, push, showAllBehaviours, toggleGroup } from './navigation'
import { truncate, wrap } from './text'

export const MAP_LIMIT = 7
export const INCIDENTAL_GROUP = 'incidental'
const RISK_ORDER: Behaviour['risks'] = ['contract-change', 'error-handling-change', 'high-fan-in']
// Room taken by the engine's Button decoration ("[ ] " / hotkey) when a label is drawn.
const BUTTON_PAD = 6

const riskRank = (r: Behaviour['risks'][number]) => RISK_ORDER.indexOf(r)
const sortedRisks = (b: Behaviour) => [...b.risks].sort((a, c) => riskRank(a) - riskRank(c))

/** Behaviours ordered by their most serious risk (contract, error handling, fan-in; none last), then rank.score descending. */
export function orderBehaviours(behaviours: Behaviour[]): Behaviour[] {
  const top = (b: Behaviour) => (b.risks.length === 0 ? RISK_ORDER.length : riskRank(sortedRisks(b)[0]!))
  return behaviours
    .map((b, i) => ({ b, i }))
    .sort((x, y) => top(x.b) - top(y.b) || y.b.rank.score - x.b.rank.score || x.i - y.i)
    .map(x => x.b)
}

const seamsOf = (b: Behaviour, model: BehaviourModel): Seam[] =>
  b.seamIds.map(id => model.seams[id]).filter((s): s is Seam => s !== undefined)

const plain: NodeStyle = { diff: 'unchanged', isInferred: false, isGroup: false, isFaded: false }

export const DIAGRAM_NODE_BUDGET = 12
export const SVG_MAX_CHARS = 131_072

/**
 * Seam diagram of the Behaviours in map order, each with its not-yet-drawn Seams, while drawn nodes stay within
 * the node budget; a Behaviour that would exceed it is skipped and later ones are still tried.
 */
async function seamDiagram(ordered: Behaviour[], model: BehaviourModel, maxCols: number) {
  const nodes: { id: string; label: string; style: NodeStyle }[] = []
  const edges: { id: string; from: string; to: string; isError: boolean; isSeamCrossing: boolean }[] = []
  const seamIds = new Set<string>()
  let drawn = 0
  let candidates = 0
  for (const b of ordered) {
    const seams = [...new Map(seamsOf(b, model).map(s => [s.id, s])).values()]
    if (seams.length === 0) continue
    candidates++
    const fresh = seams.filter(s => !seamIds.has(s.id))
    if (nodes.length + 1 + fresh.length > DIAGRAM_NODE_BUDGET) continue
    drawn++
    nodes.push({ id: `b:${b.id}`, label: b.name, style: plain })
    for (const s of seams) {
      if (!seamIds.has(s.id)) {
        seamIds.add(s.id)
        nodes.push({ id: `s:${s.id}`, label: s.name, style: plain })
      }
      edges.push({ id: `e:${b.id}:${s.id}`, from: `b:${b.id}`, to: `s:${s.id}`, isError: false, isSeamCrossing: true })
    }
  }
  if (seamIds.size === 0) return undefined
  const layout = await layoutGraph({ nodes, edges }, { maxCols, direction: 'RIGHT' })
  const source = toSvg(layout, CELL_PX)
  if (source.length > SVG_MAX_CHARS) return undefined
  const alt =
    `Behaviour map: ${drawn} Behaviours, ${seamIds.size} Seams` + (drawn < candidates ? ` (top ${drawn} of ${candidates})` : '')
  return { layout, source, alt }
}

/** The Behaviour map body (without breadcrumb). `ui` is the surface's element table; takes no `$` (see register.tsx). */
export async function renderMap(
  ui: any,
  updateNav: (fn: (n: Navigation) => Navigation) => Promise<unknown>,
  model: BehaviourModel,
  nav: Navigation,
  columns: number,
  surface: string,
) {
  const { Box, Text, Button, Svg } = ui
  const width = Math.max(10, columns)
  const ordered = orderBehaviours(model.behaviours)
  const shown = nav.showAll ? ordered : ordered.slice(0, MAP_LIMIT)
  const hidden = ordered.length - shown.length
  const hasSvg = (surface === 'desktop' || surface === 'vscode') && Svg !== undefined

  const intentLines: string[] = model.intent.isMissing
    ? ['Intent missing']
    : wrap(model.intent.text ?? '', width)
  const sources = model.intent.sources.length > 0 ? wrap(`Sources: ${model.intent.sources.join(', ')}`, width) : []

  const diagram = hasSvg ? await seamDiagram(ordered, model, width) : undefined

  return (
    <Box flexDirection="column">
      <Box key="intent" flexDirection="column">
        {intentLines.map((l: string) => (
          <Text bold={model.intent.isMissing} color={model.intent.isMissing ? 'yellow' : undefined}>
            {l}
          </Text>
        ))}
        {sources.map((l: string) => (
          <Text dimColor>{l}</Text>
        ))}
      </Box>
      {model.intentMismatches.map((m, i) => (
        <Box key={`mismatch-${i}`} flexDirection="column">
          {wrap(`Intent mismatch: claimed "${m.claim}" but observed "${m.observed}"`, width).map((l: string) => (
            <Text color="yellow">{l}</Text>
          ))}
        </Box>
      ))}
      <Text> </Text>
      {shown.map(b => {
        const chips = sortedRisks(b).map(r => `[${r}]`).join(' ')
        const label = truncate(chips === '' ? b.name : `${b.name} ${chips}`, width - BUTTON_PAD)
        const seams = seamsOf(b, model).map(s => s.name)
        return (
          <Box key={`row-${b.id}`} flexDirection="column">
            <Button
              key={`behaviour-${b.id}`}
              onPress={() => updateNav(n => push(n, { kind: 'behaviour', behaviourId: b.id }))}
            >
              {label}
            </Button>
            {seams.length > 0 && (
              <Box key={`seams-${b.id}`}>
                <Text dimColor>{truncate(`Seams: ${seams.join(', ')}`, width)}</Text>
              </Box>
            )}
          </Box>
        )
      })}
      {hidden > 0 && (
        <Button key="show-more" onPress={() => updateNav(showAllBehaviours)}>
          {truncate(`Show ${hidden} more`, width - BUTTON_PAD)}
        </Button>
      )}
      {diagram && (
        <Svg
          source={diagram.source}
          alt={diagram.alt}
          width={diagram.layout.cols * CELL_PX.width}
          height={diagram.layout.rows * CELL_PX.height}
        />
      )}
      {model.incidentalChanges.length > 0 && (
        <Box flexDirection="column">
          <Text> </Text>
          <Button key="incidental-toggle" onPress={() => updateNav(n => toggleGroup(n, INCIDENTAL_GROUP))}>
            {truncate(
              `${nav.expandedGroups.includes(INCIDENTAL_GROUP) ? '-' : '+'} Incidental changes (${model.incidentalChanges.length})`,
              width - BUTTON_PAD,
            )}
          </Button>
          {nav.expandedGroups.includes(INCIDENTAL_GROUP) &&
            model.incidentalChanges.map((c, i) => (
              <Box key={`incidental-${i}`}>
                <Text dimColor>{truncate(`${c.file} (${c.reason})`, width)}</Text>
              </Box>
            ))}
        </Box>
      )}
    </Box>
  )
}
