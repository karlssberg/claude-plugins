// Minimal typings for the vendored dagre bundle (see scripts/vendor-dagre.mjs).
export type DagrePoint = { x: number; y: number }
export type DagreGraph = {
  setGraph(label: Record<string, unknown>): DagreGraph
  setDefaultEdgeLabel(fn: () => Record<string, unknown>): DagreGraph
  setNode(id: string, label: { width: number; height: number }): DagreGraph
  setEdge(from: string, to: string, label?: Record<string, unknown>, name?: string): DagreGraph
  node(id: string): { x: number; y: number; width: number; height: number }
  edge(from: string, to: string, name?: string): { points: DagrePoint[] }
  nodes(): string[]
}
declare const dagre: {
  graphlib: { Graph: new (opts?: { multigraph?: boolean; compound?: boolean; directed?: boolean }) => DagreGraph }
  layout(g: DagreGraph, opts?: Record<string, unknown>): void
}
export default dagre
