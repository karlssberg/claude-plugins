# Behaviour model (version 1)

The Behaviour model is the JSON document a producer agent writes and the panel reads. Every Element and edge carries Evidence; never add one you cannot point at in the code. Write the document as a single JSON object of this shape.

```ts
type EvidenceStatus = 'verified' | 'inferred' | 'unchecked'
type Evidence = { file: string; startLine: number; endLine: number; symbol: string; hunk?: string; status: EvidenceStatus }
type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged'
type AbstractionLevel = 'system' | 'container' | 'component' | 'code'
type Element = { id: string; name: string; level: AbstractionLevel; parentId?: string; external?: boolean; evidence: Evidence[] }
type Step = { id: string; order: number; from: string; to: string; label: string; kind: 'call' | 'message' | 'return' | 'effect'; seamId?: string; diff: DiffStatus; evidence: Evidence[] }
type Seam = { id: string; name: string; kind: 'interface' | 'module-api' | 'network' | 'message' | 'binding'; contract: { text: string; evidence: Evidence[] }; enablingPoint?: Evidence; isContractChanged: boolean }
type ErrorFlow = { id: string; originStepId: string; transforms: { seamId: string; into: string; evidence: Evidence[] }[]; handler?: { elementId: string; evidence: Evidence[] }; isSwallowed: boolean; isCatchAll: boolean; diff: DiffStatus }
type BuildStatus = 'built' | 'pending' | 'building' | 'failed'
type Behaviour = { id: string; name: string; entryPointId: string; level: AbstractionLevel; status: BuildStatus; rank: { score: number; signals: Record<string, number> }; risks: ('contract-change' | 'error-handling-change' | 'high-fan-in')[]; elementIds: string[]; steps: Step[]; errorFlows: ErrorFlow[]; seamIds: string[] }
type FlowNode = { id: string; label: string; kind: 'step' | 'decision' | 'error' | 'return'; diff: DiffStatus; evidence: Evidence[] }
type SeamView = { subjectId: string; status: BuildStatus; nodes: FlowNode[]; edges: { from: string; to: string; label?: string; isError: boolean }[] }
type BehaviourModel = {
  version: 1
  scope: { mode: 'pr' | 'codebase'; target: string; baseSha?: string; headSha: string; focus?: string }
  intent: { text?: string; sources: string[]; isMissing: boolean }
  intentMismatches: { claim: string; observed: string; evidence: Evidence[] }[]
  behaviours: Behaviour[]; elements: Record<string, Element>; seams: Record<string, Seam>
  seamViews: Record<string, SeamView>
  incidentalChanges: { file: string; hunk: string; reason: 'refactor' | 'test' | 'config' | 'docs' | 'other' }[]
  baseBehaviours?: Behaviour[]
}
```

## Fields

### Evidence
- `file`: repo-relative path.
- `startLine`, `endLine`: 1-based inclusive line range.
- `symbol`: the enclosing function, class or member name.
- `hunk`: the diff hunk text, in PR mode when the Evidence is a changed line.
- `status`: `verified` once checked against the code, `inferred` when reasoned rather than read, `unchecked` before the evidence check runs. Producers write `unchecked` or `inferred`; the evidence check upgrades or downgrades.

### Element
- `id`: unique key; must equal its key in `elements`.
- `name`: the name as it appears in the code.
- `level`: C4-style abstraction level.
- `parentId`: id of the containing Element, which must exist.
- `external`: true for systems outside the repo (clients, third-party services).
- `evidence`: where the Element is defined. An external Element cites the code in the repo that receives or calls it (a route registration, a client call site). An Element without Evidence is dropped.

### Step
- `id`: unique within its Behaviour.
- `order`: 1-based position along the Behaviour.
- `from`, `to`: ids of Elements in `elements`.
- `label`: short description of what happens.
- `kind`: `call`, `message`, `return` or `effect`.
- `seamId`: the Seam this Step crosses, if any (must exist in `seams`).
- `diff`: change status against base (`unchanged` in codebase mode).
- `evidence`: where the Step occurs in the code.

### Seam
- `id`: unique key; must equal its key in `seams`.
- `name`: what the Seam joins.
- `kind`: `interface`, `module-api`, `network`, `message` or `binding`.
- `contract`: the Contract text plus Evidence for it.
- `enablingPoint`: Evidence for where the Seam is wired (the Enabling point).
- `isContractChanged`: true when the Contract differs from base.

### ErrorFlow
- `id`: unique within its Behaviour.
- `originStepId`: id of the Step where the error arises (must exist in the Behaviour).
- `transforms`: each Seam crossing that rewrites the error, with the resulting `into` type.
- `handler`: the Element that finally handles it, with Evidence.
- `isSwallowed`: true when the error is silently dropped.
- `isCatchAll`: true when handled by a catch-all.
- `diff`: change status against base.

### Behaviour
- `id`: unique across `behaviours`.
- `name`: user-facing name.
- `entryPointId`: the Entry point Element; must be in `elementIds`.
- `level`: abstraction level of the Behaviour map.
- `status`: build state; `pending` Behaviours may have empty `steps`.
- `rank`: `score` plus the named `signals` that produced it.
- `risks`: any of `contract-change`, `error-handling-change`, `high-fan-in`.
- `elementIds`: ids of the Elements involved (all must exist).
- `steps`: the Critical path in order.
- `errorFlows`: the Error overlay data.
- `seamIds`: ids of the Seams crossed (all must exist).

### FlowNode and SeamView
- `subjectId`: the Element id or Seam id the Seam view explains.
- `status`: build state of the view.
- `nodes`: `id` unique within the view, `label`, `kind` (`step`, `decision`, `error`, `return`), `diff`, `evidence`.
- `edges`: `from` and `to` name node ids; `isError` marks error paths; `label` is optional.

### BehaviourModel
- `version`: always `1`; other versions are rejected.
- `scope`: `mode` (`pr` or `codebase`), `target` (PR ref or repo), `headSha`, optional `baseSha` and `focus`.
- `intent`: `text` of the stated intent, `sources` it came from, `isMissing` when none was found.
- `intentMismatches`: each Intent mismatch with the `claim`, what was `observed`, and Evidence.
- `behaviours`, `elements`, `seams`, `seamViews`: as above; `seamViews` is keyed by Element id or Seam id.
- `elements`: in PR mode, the union of the head and base Elements, so the Steps of `baseBehaviours` resolve.
- `incidentalChanges`: Incidental changes with `file`, `hunk` and a `reason`.
- `baseBehaviours`: PR mode only; the same Behaviours as at base, matched by entry point Element name, used for the diff.
