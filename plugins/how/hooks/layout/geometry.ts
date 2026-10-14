// Provisional pending the manual desktop alignment check (ADR 0001).
export const CELL_PX = { width: 8, height: 17 } as const

// Provisional pending the manual desktop alignment check (ADR 0001).
export const OVERLAY_MODE: 'overlay' | 'legend' = 'legend'

import type { DiffStatus } from '../model/behaviour-model'

// Shared Layout types. Coordinates are character cells; toSvg scales by CELL_PX.
export type CellRect = { col: number; row: number; cols: number; rows: number }
export type NodeStyle = {
  diff: DiffStatus
  isInferred: boolean
  isGroup: boolean
  isFaded: boolean
  isError?: boolean
  isSwallowed?: boolean
}
export type LayoutNode = { id: string; label: string; rect: CellRect; style: NodeStyle }
export type LayoutEdge = {
  id: string
  from: string
  to: string
  label: string
  points: { col: number; row: number }[]
  style: NodeStyle & { isSeamCrossing: boolean }
}
export type Layout = { cols: number; rows: number; nodes: LayoutNode[]; edges: LayoutEdge[] }

// Lifeline header boxes sit at rect.row = HEADER.top, rect.rows = HEADER.rows; each lifeline column is
// `colWidth` cells wide with a `gap` between boxes (rect.cols = colWidth - gap). The first message line is at
// row HEADER.firstMessageRow and later rows follow every HEADER.rowStep. Task 8 overlays Buttons at node rects.
export const HEADER = { top: 0, rows: 3, gap: 1, minColWidth: 4, firstMessageRow: 5, rowStep: 3 } as const
