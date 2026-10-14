// Qualified Evidence owner ids: what an Evidence ViewRef's `ownerId` names, resolvable from the model alone. Pure.
//   element:<elementId>   step:<behaviourId>:<stepId>   seam:<seamId>
//   flow:<subjectId>:<nodeId>   error:<behaviourId>:<errorFlowId>
// Two-part ids may hold ":" in either part (an Element id like `src/a.ts:Foo`): every colon split is tried and the
// first one that resolves wins.
import type { BehaviourModel, ErrorFlow, Evidence } from '../model/behaviour-model'

export type EvidenceOwner = { label: string; evidence: Evidence[] }

export const ownerId = {
  element: (elementId: string) => `element:${elementId}`,
  step: (behaviourId: string, stepId: string) => `step:${behaviourId}:${stepId}`,
  seam: (seamId: string) => `seam:${seamId}`,
  flow: (subjectId: string, nodeId: string) => `flow:${subjectId}:${nodeId}`,
  error: (behaviourId: string, errorFlowId: string) => `error:${behaviourId}:${errorFlowId}`,
}

/** An ErrorFlow's Evidence in one list: each transform's, in order, then the handler's. */
export const errorFlowEvidence = (f: ErrorFlow): Evidence[] => [
  ...f.transforms.flatMap(t => t.evidence),
  ...(f.handler?.evidence ?? []),
]

/** Every way to cut `rest` into two non-empty parts at a ":". */
const splits = (rest: string): [string, string][] => {
  const out: [string, string][] = []
  for (let i = rest.indexOf(':'); i >= 0; i = rest.indexOf(':', i + 1))
    if (i > 0 && i < rest.length - 1) out.push([rest.slice(0, i), rest.slice(i + 1)])
  return out
}
const firstOf = <T,>(rest: string, f: (a: string, b: string) => T | undefined): T | undefined => {
  for (const [a, b] of splits(rest)) {
    const r = f(a, b)
    if (r !== undefined) return r
  }
  return undefined
}

export function resolveEvidenceOwner(model: BehaviourModel, id: string): EvidenceOwner | undefined {
  const colon = id.indexOf(':')
  if (colon < 0) return undefined
  const kind = id.slice(0, colon)
  const rest = id.slice(colon + 1)
  switch (kind) {
    case 'element': {
      const e = model.elements[rest]
      return e && { label: e.name, evidence: e.evidence }
    }
    case 'seam': {
      const s = model.seams[rest]
      return s && { label: s.name, evidence: s.contract.evidence }
    }
    case 'step': {
      const s = firstOf(rest, (bid, sid) => model.behaviours.find(b => b.id === bid)?.steps.find(st => st.id === sid))
      return s ? { label: s.label, evidence: s.evidence } : undefined
    }
    case 'flow': {
      const n = firstOf(rest, (sid, nid) => model.seamViews[sid]?.nodes.find(nd => nd.id === nid))
      return n ? { label: n.label, evidence: n.evidence } : undefined
    }
    case 'error': {
      const f = firstOf(rest, (bid, fid) => model.behaviours.find(b => b.id === bid)?.errorFlows.find(ef => ef.id === fid))
      if (!f) return undefined
      const into = f.transforms.map(t => t.into).join(' → ')
      return { label: `Error flow ${f.id}${into ? `: ${into}` : ''}`, evidence: errorFlowEvidence(f) }
    }
    default:
      return undefined
  }
}
