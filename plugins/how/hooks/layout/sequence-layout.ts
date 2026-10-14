// Deterministic sequence-diagram layout for one Behaviour, in character-cell coordinates. Pure.
import { foldToBudget } from '../model/budget'
import type { Behaviour, BehaviourModel, DiffStatus, Evidence } from '../model/behaviour-model'
import { HEADER, type Layout, type LayoutEdge, type LayoutNode, type NodeStyle } from './geometry'

const BUDGET = 12
const CAP = 20
const MAX_COL_WIDTH = 28

export type LayoutOpts = { maxCols: number; showErrors: boolean; expandedGroups?: string[] }

export function truncate(text: string, width: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' '))
  if (chars.length <= width) return chars.join('')
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…'
}

const isInferred = (evidence: Evidence[]) => evidence.length > 0 && evidence.every(e => e.status === 'inferred')

type Row =
  | { kind: 'step'; id: string; from: string; to: string; label: string; diff: DiffStatus; inferred: boolean; seam: boolean; stepIds: string[] }
  | { kind: 'error'; id: string; from: string; to: string; label: string; diff: DiffStatus; swallowed: boolean; seam: boolean }

export function layoutBehaviourView(b: Behaviour, model: BehaviourModel, opts: LayoutOpts): Layout {
  // 1. Lifeline candidates in order of first appearance: entry point, Step endpoints, elementIds, error handlers.
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id)
      candidates.push(id)
    }
  }
  add(b.entryPointId)
  for (const s of b.steps) {
    add(s.from)
    add(s.to)
  }
  b.elementIds.forEach(add)
  if (opts.showErrors) for (const f of b.errorFlows) add(f.handler?.elementId)
  const own = new Set(b.elementIds)

  // 2. Fold to budget; expanded groups pin their members and the fold is redone.
  const pinned = new Set<string>([b.entryPointId])
  for (const s of b.steps) {
    if (s.diff !== 'unchanged' || s.seamId) {
      pinned.add(s.from)
      pinned.add(s.to)
    }
  }
  // Lifelines need about 6 cells each; never fold to a budget wider than the width allows.
  const limit = Math.max(1, Math.floor(opts.maxCols / 6))
  // Expanded group ids are resolved against the first fold, so they stay stable between toggles: the
  // expanded groups are simply dropped from that fold (their members become visible lifelines).
  const first = foldToBudget(candidates, model.elements, {
    budget: Math.min(BUDGET, limit),
    cap: Math.min(CAP, limit),
    pinned: [...pinned],
  })
  const expanded = new Set(opts.expandedGroups ?? [])
  const folded = { ...first, groups: first.groups.filter(g => !expanded.has(g.id)) }
  const groupOf = new Map<string, string>()
  for (const g of folded.groups) for (const m of g.memberIds) groupOf.set(m, g.id)
  const groupIds = new Set(folded.groups.map(g => g.id))
  const lane = (id: string) => groupOf.get(id) ?? id

  const laneOrder: string[] = []
  for (const id of candidates) {
    const l = lane(id)
    if (!laneOrder.includes(l)) laneOrder.push(l)
  }

  // 3. Rows: one per Step (internal group Steps merged), error rows after their origin.
  const rows: Row[] = []
  const rowOfStep = new Map<string, number>()
  const n = laneOrder.length
  // If pinned lifelines alone exceed what fits, columns shrink below minColWidth so cols never exceeds
  // maxCols; header and message labels degrade (down to "…") there.
  const colWidth = Math.min(MAX_COL_WIDTH, Math.max(2, Math.floor(opts.maxCols / Math.max(1, n))))
  const total = n * colWidth
  const centerOf = new Map<string, number>()
  laneOrder.forEach((id, i) => centerOf.set(id, i * colWidth + Math.floor((colWidth - HEADER.gap) / 2)))
  const span = (a: string, c: string) => Math.abs(centerOf.get(a)! - centerOf.get(c)!)
  const labelWidth = (from: string, to: string) =>
    from === to ? Math.max(1, total - centerOf.get(from)! - 4) : Math.max(1, span(from, to) - 2)

  for (const s of b.steps) {
    const from = lane(s.from)
    const to = lane(s.to)
    const prev = rows[rows.length - 1]
    if (from === to && groupIds.has(from)) {
      if (prev && prev.kind === 'step' && prev.from === from && prev.to === to) {
        prev.stepIds.push(s.id)
        prev.label = `${prev.stepIds.length} internal steps`
        rowOfStep.set(s.id, rows.length - 1)
        continue
      }
      rowOfStep.set(s.id, rows.length)
      rows.push({ kind: 'step', id: s.id, from, to, label: '1 internal step', diff: 'unchanged', inferred: false, seam: false, stepIds: [s.id] })
      continue
    }
    rowOfStep.set(s.id, rows.length)
    rows.push({
      kind: 'step',
      id: s.id,
      from,
      to,
      label: truncate(s.label, labelWidth(from, to)),
      diff: s.diff,
      inferred: isInferred(s.evidence),
      seam: Boolean(s.seamId),
      stepIds: [s.id],
    })
  }
  if (opts.showErrors) {
    const after = new Map<number, Row[]>()
    for (const f of b.errorFlows) {
      const origin = b.steps.find(s => s.id === f.originStepId)
      const at = rowOfStep.get(f.originStepId)
      if (!origin || at === undefined) continue
      const out: Row[] = []
      let cur = lane(origin.to)
      const push = (to: string, label: string, seam: boolean, swallowed: boolean) =>
        out.push({ kind: 'error', id: `error:${f.id}:${out.length}`, from: cur, to, label: truncate(label, labelWidth(cur, to)), diff: f.diff, swallowed, seam })
      for (const t of f.transforms) {
        const crossing = b.steps.filter(s => s.seamId === t.seamId)
        const step = crossing.filter(s => s.order <= origin.order).pop() ?? crossing[crossing.length - 1]
        if (step) {
          const to = lane(step.from)
          push(to, t.into, true, false)
          cur = to
        } else push(cur, t.into, false, false)
      }
      if (f.handler) push(lane(f.handler.elementId), 'handled', false, f.isSwallowed)
      else push(cur, 'unhandled', false, f.isSwallowed)
      after.set(at, [...(after.get(at) ?? []), ...out])
    }
    const merged: Row[] = []
    rows.forEach((r, i) => merged.push(r, ...(after.get(i) ?? [])))
    rows.length = 0
    rows.push(...merged)
  }

  // 4. Nodes (lifeline headers).
  const touching = (id: string) => b.steps.filter(s => lane(s.from) === id || lane(s.to) === id)
  const nodeDiff = (id: string): DiffStatus => {
    const diffs = new Set(touching(id).map(s => s.diff).filter(d => d !== 'unchanged'))
    return diffs.size === 0 ? 'unchanged' : diffs.size === 1 ? [...diffs][0]! : 'changed'
  }
  const nodes: LayoutNode[] = laneOrder.map((id, i) => {
    const group = folded.groups.find(g => g.id === id)
    const members = group ? group.memberIds : [id]
    const style: NodeStyle = {
      diff: nodeDiff(id),
      isInferred: members.every(m => isInferred(model.elements[m]?.evidence ?? [])),
      isGroup: Boolean(group),
      isFaded: members.every(m => !own.has(m)),
    }
    const full = group ? group.label : (model.elements[id]?.name ?? id)
    return {
      id,
      label: truncate(full, colWidth - HEADER.gap <= 4 ? colWidth - HEADER.gap : colWidth - HEADER.gap - 2),
      rect: { col: i * colWidth, row: HEADER.top, cols: colWidth - HEADER.gap, rows: HEADER.rows },
      style,
    }
  })

  // 5. Edges.
  const edges: LayoutEdge[] = rows.map((r, i) => {
    const row = HEADER.firstMessageRow + i * HEADER.rowStep
    const x1 = centerOf.get(r.from)!
    const x2 = centerOf.get(r.to)!
    const points =
      r.from === r.to
        ? (() => {
            const w = Math.max(1, Math.min(3, total - 1 - x1))
            return [{ col: x1, row }, { col: x1 + w, row }, { col: x1 + w, row: row + 1 }, { col: x1, row: row + 1 }]
          })()
        : [{ col: x1, row }, { col: x2, row }]
    const base = { diff: r.diff, isGroup: false, isFaded: nodes.find(nd => nd.id === r.from)!.style.isFaded || nodes.find(nd => nd.id === r.to)!.style.isFaded }
    return r.kind === 'step'
      ? { id: r.id, from: r.from, to: r.to, label: r.label, points, style: { ...base, isInferred: r.inferred, isSeamCrossing: r.seam } }
      : { id: r.id, from: r.from, to: r.to, label: r.label, points, style: { ...base, isInferred: false, isError: true, isSwallowed: r.swallowed, isSeamCrossing: r.seam } }
  })

  return { cols: total, rows: HEADER.firstMessageRow + rows.length * HEADER.rowStep, nodes, edges }
}
