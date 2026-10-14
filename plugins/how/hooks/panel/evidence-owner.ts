// Qualified Evidence owner ids: what an Evidence ViewRef's `ownerId` names, resolvable from the model alone. Pure.
//   element:<elementId>   step:<behaviourId>:<stepId>   seam:<seamId>
//   flow:<subjectId>:<nodeId>   error:<behaviourId>:<errorFlowId>
// Two-part ids split at the first ":" after the prefix, so Behaviour and Seam-view subject ids hold no ":".
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

const pair = (rest: string): [string, string] | undefined => {
  const cut = rest.indexOf(':')
  return cut <= 0 || cut === rest.length - 1 ? undefined : [rest.slice(0, cut), rest.slice(cut + 1)]
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
      const p = pair(rest)
      const s = p && model.behaviours.find(b => b.id === p[0])?.steps.find(st => st.id === p[1])
      return s ? { label: s.label, evidence: s.evidence } : undefined
    }
    case 'flow': {
      const p = pair(rest)
      const n = p && model.seamViews[p[0]]?.nodes.find(nd => nd.id === p[1])
      return n ? { label: n.label, evidence: n.evidence } : undefined
    }
    case 'error': {
      const p = pair(rest)
      const f = p && model.behaviours.find(b => b.id === p[0])?.errorFlows.find(ef => ef.id === p[1])
      if (!f) return undefined
      const into = f.transforms.map(t => t.into).join(' → ')
      return { label: `Error flow ${f.id}${into ? `: ${into}` : ''}`, evidence: errorFlowEvidence(f) }
    }
    default:
      return undefined
  }
}
