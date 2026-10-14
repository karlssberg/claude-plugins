// Step-level diff of a head Behaviour against its base. Pure; never mutates inputs.
import type { Behaviour, DiffStatus, Element, ErrorFlow, Step } from './behaviour-model'

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
const nameOf = (els: Record<string, Element>, id: string): string => norm(els[id]?.name ?? id)
const symbolsOf = (s: Step): string =>
  s.evidence
    .map(e => e.symbol)
    .sort()
    .join('|')

/**
 * Pairs head Steps with base Steps: same endpoints and label first, then same endpoints, then same source and label
 * (rerouted). Answers each paired head Step's base Step id and diff status.
 */
export function pairSteps(
  base: Behaviour,
  head: Behaviour,
  elements: Record<string, Element>,
): { matchOf: Map<string, string>; diffs: Map<string, DiffStatus> } {
  const pair = (s: Step) => `${nameOf(elements, s.from)}\u0000${nameOf(elements, s.to)}`
  const full = (s: Step) => `${pair(s)}\u0000${norm(s.label)}`
  const fromLabel = (s: Step) => `${nameOf(elements, s.from)}\u0000${norm(s.label)}`

  const diffs = new Map<string, DiffStatus>() // head step id -> diff
  const matchOf = new Map<string, string>() // head step id -> base step id
  const usedBase = new Set<string>()
  const byOrder = (a: Step, b: Step) => a.order - b.order

  const headSorted = [...head.steps].sort(byOrder)
  const baseSorted = [...base.steps].sort(byOrder)
  const claim = (keyOf: (s: Step) => string, status: (h: Step, b: Step) => DiffStatus) => {
    for (const h of headSorted) {
      if (matchOf.has(h.id)) continue
      const b = baseSorted.find(x => !usedBase.has(x.id) && keyOf(x) === keyOf(h))
      if (!b) continue
      usedBase.add(b.id)
      matchOf.set(h.id, b.id)
      diffs.set(h.id, status(h, b))
    }
  }
  claim(full, (h, b) => (symbolsOf(h) === symbolsOf(b) ? 'unchanged' : 'changed'))
  claim(pair, () => 'changed') // same endpoints, new label
  claim(fromLabel, () => 'changed') // rerouted
  return { matchOf, diffs }
}

export function markStepDiffs(
  base: Behaviour | undefined,
  head: Behaviour,
  elements: Record<string, Element>,
): Behaviour {
  if (!base) {
    return {
      ...head,
      steps: head.steps.map(s => ({ ...s, diff: 'added' as DiffStatus })),
      errorFlows: head.errorFlows.map(f => ({ ...f, diff: 'added' as DiffStatus })),
    }
  }

  const { matchOf, diffs } = pairSteps(base, head, elements)
  const usedBase = new Set(matchOf.values())
  const byOrder = (a: Step, b: Step) => a.order - b.order
  const baseSorted = [...base.steps].sort(byOrder)

  const steps: Step[] = head.steps.map(s => ({ ...s, diff: diffs.get(s.id) ?? 'added' }))
  const removed: Step[] = baseSorted
    .filter(b => !usedBase.has(b.id))
    .map(b => ({ ...b, id: `base:${b.id}`, diff: 'removed' as DiffStatus }))
  const sorted = [...steps, ...removed]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.order - b.s.order || a.i - b.i)
    .map(x => x.s)

  // Error flows: key on the base origin Step (via the Step match) and handler name.
  const handlerName = (f: ErrorFlow) => (f.handler ? nameOf(elements, f.handler.elementId) : '')
  const baseOfHeadStep = (id: string) => matchOf.get(id)
  const usedFlows = new Set<string>()
  const flowDiffs = new Map<string, DiffStatus>()
  const matchFlow = (h: ErrorFlow, requireHandler: boolean): ErrorFlow | undefined => {
    const bo = baseOfHeadStep(h.originStepId)
    if (bo === undefined) return undefined
    return base.errorFlows.find(
      b =>
        !usedFlows.has(b.id) &&
        b.originStepId === bo &&
        (!requireHandler || handlerName(b) === handlerName(h)),
    )
  }
  const claimedBy = new Map<string, ErrorFlow>()
  for (const strict of [true, false]) {
    for (const h of head.errorFlows) {
      if (claimedBy.has(h.id)) continue
      const b = matchFlow(h, strict)
      if (!b) continue
      usedFlows.add(b.id)
      claimedBy.set(h.id, b)
      const same = handlerName(b) === handlerName(h) && b.isSwallowed === h.isSwallowed && b.isCatchAll === h.isCatchAll
      flowDiffs.set(h.id, same ? 'unchanged' : 'changed')
    }
  }
  const errorFlows: ErrorFlow[] = head.errorFlows.map(f => ({ ...f, diff: flowDiffs.get(f.id) ?? 'added' }))
  const headIdOfBase = new Map<string, string>()
  for (const [h, b] of matchOf) headIdOfBase.set(b, h)
  for (const b of base.errorFlows) {
    if (usedFlows.has(b.id)) continue
    const origin = headIdOfBase.get(b.originStepId) ?? `base:${b.originStepId}`
    errorFlows.push({ ...b, id: `base:${b.id}`, originStepId: origin, diff: 'removed' })
  }

  return { ...head, steps: sorted, errorFlows }
}
