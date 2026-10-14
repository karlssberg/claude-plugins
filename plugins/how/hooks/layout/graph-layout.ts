// Deterministic layered graph layout (vendored dagre) in character-cell coordinates. dagre units are cells.
import dagre from '../vendor/dagre.mjs'
import type { SeamView } from '../model/behaviour-model'
import type { Evidence } from '../model/behaviour-model'
import type { CellRect, Layout, LayoutEdge, LayoutNode, NodeStyle } from './geometry'
import { truncate } from './sequence-layout'

export type GraphInput = {
  nodes: { id: string; label: string; style: NodeStyle }[]
  edges: { id: string; from: string; to: string; label?: string; isError: boolean; isSeamCrossing?: boolean }[]
}

const NODE_ROWS = 3
const PAD = 4 // border + padding cells added around the label
const MIN_WIDTH = 6
const GAP = 2 // minimum cells between nodes in the same layer
const LAYER_GAP = 4

const widthFor = (label: string, cap: number) => Math.max(MIN_WIDTH, Math.min(cap, Array.from(label).length + PAD))

type Pt = { x: number; y: number }
type Run = { nodes: Map<string, { x: number; y: number; width: number }>; edges: Map<string, Pt[]> }

// dagre reports node centres; convert to top-left cell rects here.
function runDagre(input: GraphInput, direction: 'DOWN' | 'RIGHT', cap: number): Run {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: direction === 'DOWN' ? 'TB' : 'LR', nodesep: GAP, ranksep: LAYER_GAP, edgesep: 1, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of input.nodes) g.setNode(n.id, { width: widthFor(n.label, cap), height: NODE_ROWS })
  for (const e of input.edges) g.setEdge(e.from, e.to, {}, e.id)
  dagre.layout(g)
  const nodes = new Map<string, { x: number; y: number; width: number }>()
  for (const n of input.nodes) {
    const d = g.node(n.id)
    nodes.set(n.id, { x: d.x - d.width / 2, y: d.y - d.height / 2, width: d.width })
  }
  const edges = new Map<string, Pt[]>()
  for (const e of input.edges) edges.set(e.id, g.edge(e.from, e.to, e.id).points)
  return { nodes, edges }
}

function extent(r: Run): number {
  let max = 0
  for (const c of r.nodes.values()) max = Math.max(max, Math.round(c.x) + c.width)
  for (const pts of r.edges.values()) for (const p of pts) max = Math.max(max, Math.round(p.x) + 1)
  return max
}

const rowsOverlap = (a: CellRect, b: CellRect) => a.row < b.row + b.rows && b.row < a.row + a.rows

// Makes same-row rects disjoint and inside [0, maxCols). Pass 1 pushes right, pass 2 pulls back left and
// narrows where needed (min width 1). The bound is exact: it holds whenever no more than maxCols rects
// share a row band (each needs at least 1 cell); beyond that, no layout in maxCols cells can exist.
function resolveCollisions(nodes: LayoutNode[], maxCols: number): LayoutNode[] {
  const order = [...nodes].sort((x, y) => x.rect.col - y.rect.col || x.rect.row - y.rect.row)
  order.forEach((n, i) => {
    let col = Math.max(0, n.rect.col)
    for (let j = 0; j < i; j++) {
      const m = order[j]!.rect
      if (rowsOverlap(m, n.rect)) col = Math.max(col, m.col + m.cols)
    }
    n.rect = { ...n.rect, col }
  })
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i]!
    let bound = maxCols
    for (let j = i + 1; j < order.length; j++) {
      const m = order[j]!.rect
      if (rowsOverlap(m, n.rect)) bound = Math.min(bound, m.col)
    }
    if (n.rect.col + n.rect.cols > bound) {
      const col = Math.max(0, bound - n.rect.cols)
      n.rect = { ...n.rect, col, cols: Math.max(1, Math.min(n.rect.cols, bound - col)) }
    }
  }
  return nodes
}

export async function layoutGraph(
  input: GraphInput,
  opts: { maxCols: number; direction: 'DOWN' | 'RIGHT' },
): Promise<Layout> {
  const known = new Set(input.nodes.map(n => n.id))
  const clean: GraphInput = {
    nodes: input.nodes,
    edges: input.edges.filter(e => known.has(e.from) && known.has(e.to)),
  }
  if (clean.nodes.length === 0) return { cols: 0, rows: 0, nodes: [], edges: [] }

  // Shrink the node width cap until the routed graph fits; dagre is deterministic so this is too.
  let cap = Math.max(MIN_WIDTH, opts.maxCols)
  let g = runDagre(clean, opts.direction, cap)
  while (extent(g) > opts.maxCols && cap > MIN_WIDTH) {
    cap = Math.max(MIN_WIDTH, Math.floor(cap * 0.75))
    g = runDagre(clean, opts.direction, cap)
  }

  const byId = new Map(clean.nodes.map(n => [n.id, n]))
  const placed = new Map<string, LayoutNode>()
  for (const [id, c] of g.nodes) {
    const src = byId.get(id)!
    const cols = c.width
    placed.set(id, {
      id,
      label: truncate(src.label, Math.max(1, cols - PAD)),
      rect: { col: Math.round(c.x), row: Math.round(c.y), cols, rows: NODE_ROWS },
      style: src.style,
    })
  }
  // Still too wide (many nodes in one layer even at minimum width): compress columns proportionally, then
  // resolve collisions. Rounding and compression can leave same-row rects touching, so the resolve passes always run.
  let width = extent(g)
  let scale = 1
  if (width > opts.maxCols) {
    scale = opts.maxCols / width
    for (const n of placed.values()) {
      n.rect = { ...n.rect, col: Math.floor(n.rect.col * scale), cols: Math.max(1, Math.floor(n.rect.cols * scale)) }
    }
    width = opts.maxCols
  }
  const nodes = resolveCollisions([...placed.values()], opts.maxCols)
  for (const n of nodes) n.label = truncate(byId.get(n.id)!.label, Math.max(1, n.rect.cols - PAD))

  const edges: LayoutEdge[] = []
  for (const src of clean.edges) {
    const raw = g.edges.get(src.id) ?? []
    const a = placed.get(src.from)!.rect
    const b = placed.get(src.to)!.rect
    const within = (col: number, r: CellRect) => Math.min(r.col + r.cols - 1, Math.max(r.col, col))
    let points = raw.map(p => ({
      col: Math.min(opts.maxCols - 1, Math.max(0, Math.floor(Math.round(p.x) * scale))),
      row: Math.max(0, Math.round(p.y)),
    }))
    if (points.length < 2) {
      points = [
        { col: a.col + Math.floor(a.cols / 2), row: a.row + a.rows },
        { col: b.col + Math.floor(b.cols / 2), row: b.row },
      ]
    } else {
      // Endpoints stay attached to the final (possibly shifted) rects.
      points[0] = { ...points[0]!, col: within(points[0]!.col, a) }
      points[points.length - 1] = { ...points[points.length - 1]!, col: within(points[points.length - 1]!.col, b) }
    }
    const from = byId.get(src.from)!.style
    const to = byId.get(src.to)!.style
    edges.push({
      id: src.id,
      from: src.from,
      to: src.to,
      label: src.label ?? '',
      points,
      style: {
        diff: to.diff,
        isInferred: to.isInferred,
        isGroup: false,
        isFaded: from.isFaded && to.isFaded,
        isError: src.isError,
        isSeamCrossing: src.isSeamCrossing ?? false,
      },
    })
  }

  const rows = nodes.reduce((m, n) => Math.max(m, n.rect.row + n.rect.rows), 0)
  const edgeRows = edges.reduce((m, e) => e.points.reduce((mm, p) => Math.max(mm, p.row + 1), m), 0)
  return { cols: Math.min(opts.maxCols, width), rows: Math.max(rows, edgeRows), nodes, edges }
}

/** No Evidence at all counts as Inferred: nothing unevidenced is drawn as proven. */
const allInferred = (evidence: Evidence[]) => evidence.every(e => e.status === 'inferred')

export async function layoutSeamView(view: SeamView, opts: { maxCols: number; showErrors: boolean }): Promise<Layout> {
  let edges = view.edges.map((e, i) => ({ ...e, id: `e${i}` }))
  let nodes = view.nodes
  if (!opts.showErrors) {
    // Keep only nodes reachable from the sources through non-error edges.
    edges = edges.filter(e => !e.isError)
    const hasIncoming = new Set(view.edges.map(e => e.to))
    const visible = new Set(view.nodes.filter(n => !hasIncoming.has(n.id) && n.kind !== 'error').map(n => n.id))
    if (visible.size === 0 && view.nodes[0] && view.nodes[0].kind !== 'error') visible.add(view.nodes[0].id)
    for (let changed = true; changed; ) {
      changed = false
      for (const e of edges) if (visible.has(e.from) && !visible.has(e.to)) (visible.add(e.to), (changed = true))
    }
    nodes = view.nodes.filter(n => visible.has(n.id) && n.kind !== 'error')
    const keep = new Set(nodes.map(n => n.id))
    edges = edges.filter(e => keep.has(e.from) && keep.has(e.to))
  }
  return layoutGraph(
    {
      nodes: nodes.map(n => ({
        id: n.id,
        label: n.label,
        style: {
          diff: n.diff,
          isInferred: allInferred(n.evidence),
          isGroup: false,
          isFaded: false,
          isError: n.kind === 'error',
        },
      })),
      edges,
    },
    { maxCols: opts.maxCols, direction: 'DOWN' },
  )
}
