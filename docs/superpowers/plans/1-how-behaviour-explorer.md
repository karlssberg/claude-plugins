# `how` Behaviour Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `how` Claude Code plugin. `/how` builds an evidence-backed Behaviour model of a PR or codebase, and a mod panel lets the developer drill down from a Behaviour map to Behaviour views, Seam views and Evidence.

**Architecture:**
- The **producer** is the session, driven by the `how` skill. It resolves the target, finds Behaviours and fans out one `how:behaviour-builder` subagent per Behaviour (at most 7). It writes a versioned JSON **Behaviour model** to a commit-keyed cache.
- The **consumer** is a mod (hooks module). It verifies Evidence deterministically, lays diagrams out (its own sequence layout; elkjs for graphs), draws SVG plus clickable nodes in a Pane, and spawns background agents to build levels that aren't built yet.
- The Behaviour model JSON is the only seam between the producer and the consumer.

**Tech Stack:** TypeScript hooks module (JSX via `h`, no DOM/Node), Claude Code plugin API 2.1.295 (early access), elkjs vendored with esbuild, `claude plugin test` / `claude plugin validate`, Node ≥ 20 for build and eval scripts only.

**Spec:** https://github.com/karlssberg/claude-plugins/issues/1

**Context docs:** `CONTEXT.md` (glossary) · `docs/adr/0001-drill-down-lives-in-a-mod-panel.md` · research: `docs/research/behaviour-visualisation-prior-art.md`

## Global Constraints

**Glossary (from `CONTEXT.md`).** Name types, functions, files and tests with these terms. Use none of the *Avoid* words.
- **Behaviour**: an entry point plus the effects it causes. *Avoid:* feature, flow, use case, scenario.
- **Entry point**: the outermost trigger boundary *relative to the focus*. *Avoid:* root, top-level.
- **Critical path**: a highly ranked Behaviour, not a separate kind.
- **Seam**: a boundary where behaviour can vary without editing the caller (interface, module API, network/IPC/message, DI/config/flag binding). *Avoid:* boundary, integration point.
- **Contract**: what a Seam promises (signature, schema, endpoint). *Avoid:* API (generic), spec.
- **Enabling point**: where a Seam's implementation is chosen.
- **Behaviour model**: the evidence-backed description all views are drawn from. *Avoid:* graph, index.
- **Views**: **Behaviour map**, **Behaviour view**, **Seam view** (*avoid:* step view, component view), and the **Error overlay**.
- **Incidental change**: a changed hunk no Behaviour's path passes through. *Avoid:* other changes, noise.
- **Intent mismatch**: the PR's stated intent disagrees with the observed Behaviour change.
- **Evidence**: a `file:line` citation. **Inferred**: not provable, shown distinctly, still cited. *Avoid:* guessed, heuristic.

**ADR 0001 constraints.**
- No DOM, so no Mermaid. Layout runs in the hooks module and emits an SVG string.
- `Svg` is a leaf with no per-node clicks. Clickability comes from Buttons overlaid using our own coordinates, falling back to a clickable legend.
- The terminal has no `Svg`, so it gets a Box/Text fallback. Desktop and VS Code are the primary surfaces.
- Evidence is shown inline. Open-in-editor links are emitted only on `terminal`; remote surfaces allow only `https:`.
- The mod API is early access; keep the panel layer thin.

**Values pinned by the spec.**
- Node budget: 12 per view, hard cap 20; overflow folds into expandable group nodes.
- At most 7 Behaviours built eagerly. Codebase mode shows the top 7 plus "show more".
- Codebase ranking: reach × fan-in/centrality × hotspot (churn × complexity), boosted for external Seams.
- PR risk order: Contract changes, then error-handling changes, then fan-in.
- Every element and edge carries Evidence. The LLM never adds an unevidenced element or edge.

**Platform limits.**
- `Svg.source` ≤ 131,072 chars; tree text ≤ 100,000 chars; `$.fs.read` ≤ 4 MiB.
- `Link.href` ≤ 2,048 chars.
- `Box` `top`/`left` are in character cells, while `Svg` `width`/`height` are in CSS px.

**Other rules.**
- Cache: `<git-common-dir>/how/<head-sha>.json`. It lives inside `.git`, so it is never committed and needs no `.gitignore` edit.
- The test environment has no fs, network or process, so every pure module takes its I/O as injected functions.

## Review Focus

1. **Missing, corrupt or wrong-version model file.** The panel shows a readable error state and stays open, rather than throwing or closing. Tested in Task 2 and Task 10.
2. **Evidence pointing at a deleted file, a line past EOF, or a file over 4 MiB.** That element is dropped or marked Inferred, and verification of the rest completes. Tested in Task 3.
3. **Labels containing `<`, `&`, quotes, emoji or 200+ characters.** SVG stays well-formed and labels truncate with an ellipsis. Tested in Task 5.
4. **A Behaviour with one element, or with zero Steps.** It draws a single-lifeline diagram, not an empty or broken one. Tested in Task 5.
5. **A lazy build whose agent is denied, fails or never reports.** The node shows "failed" with a Retry button, never a permanent "building…". Tested in Task 10.

---

## File Structure

```
plugins/how/
  .claude-plugin/plugin.json        manifest (name "how")
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                wiring only: session.start, tools, agent type, render hooks
  hooks/model/behaviour-model.ts    types + parseBehaviourModel()
  hooks/model/evidence-check.ts     verifyEvidence()
  hooks/model/behaviour-diff.ts     markStepDiffs()
  hooks/model/budget.ts             foldToBudget()
  hooks/layout/geometry.ts          shared Layout types, cell grid constants
  hooks/layout/sequence-layout.ts   layoutBehaviourView()
  hooks/layout/graph-layout.ts      layoutGraph() via vendored elk
  hooks/layout/svg.ts               toSvg()
  hooks/panel/navigation.ts         Navigation state + reducers
  hooks/panel/pane.tsx              renderPane(): dispatches to the view renderers
  hooks/panel/behaviour-map.tsx
  hooks/panel/diagram-view.tsx      Behaviour view + Seam view (SVG + overlay/legend; terminal fallback)
  hooks/panel/evidence-view.tsx
  hooks/drill-down.ts               lazy build via $.agent.spawn
  hooks/vendor/elk.mjs              generated by scripts/vendor-elk.mjs (committed)
  scripts/vendor-elk.mjs            esbuild bundle of elkjs → ESM
  skills/how/SKILL.md               producer pipeline instructions
  skills/how/references/behaviour-model.md   schema for agents (mirrors behaviour-model.ts)
  commands/how.md                   /how [target]
  agents/behaviour-builder.md       subagent: builds one Behaviour (or one Seam view)
  tests/*.test.ts(x)                claude plugin test
  evals/fixtures/<name>/            sample repos + expected.json
  evals/score.mjs                   scores a produced model against expected.json
  package.json, tsconfig.json       dev-only: typescript, esbuild, elkjs
```

---

### Task 1: Scaffold plugin and the overlay spike

Resolves the riskiest unknown (ADR 0001): can Buttons be lined up over SVG nodes on desktop?

**Files:**
- Create: `plugins/how/.claude-plugin/plugin.json`, `plugins/how/hooks/hooks.json`, `plugins/how/hooks/register.tsx`, `plugins/how/hooks/layout/geometry.ts`, `plugins/how/package.json`, `plugins/how/tsconfig.json`, `plugins/how/tests/overlay-spike.test.tsx`
- Modify: `.claude-plugin/marketplace.json` (add `{ "name": "how", "source": "./plugins/how", "description": "Diagram-first explorer of Behaviours, Seams and error flows for PRs and codebases" }`)
- Modify: `docs/adr/0001-drill-down-lives-in-a-mod-panel.md` (append "Spike result")

**Interfaces:**
- Produces:
  - `PANE_ID = 'how'`.
  - `CELL_PX: { width: number; height: number }` exported from `hooks/layout/geometry.ts`: the measured desktop cell size, or the fallback decision.
  - `OVERLAY_MODE: 'overlay' | 'legend'` exported from the same file.

- [ ] **Step 1:** Write `plugin.json` (`name: "how"`, `version: "0.1.0"`, author karlssberg) and `hooks.json`. Write a `register.tsx` that opens a Pane `how` from a temporary `/how-spike` command. The Pane draws a 3-node SVG (rects at known cell multiples) inside a `Box` with absolute `Button`s, keyed `node-a|b|c`, at the matching `top`/`left` cells. Use `tsconfig.json` from the d.ts header. Add devDeps `typescript`, `esbuild`, `elkjs` (exact versions pinned in `package.json`).
- [ ] **Step 2:** Run `claude plugin validate plugins/how`. Expected: no refusals.
- [ ] **Step 3:** Write `overlay-spike.test.tsx`. For `desktop`, mount the Pane and assert `ui.find({ key: 'node-b' })` exists and `ui.press({ key: 'node-b' })` sets the pressed-node state. For `terminal`, assert the tree validates without `Svg`.
- [ ] **Step 4:** Run `claude plugin test plugins/how`. Expected: PASS.
- [ ] **Step 5 (manual, with the user):** Load via `CLAUDE_CODE_PLUGIN_DIRS`, run `/how-spike` in the desktop app and screenshot. Check whether the Buttons visually sit on the rects at two pane widths. Record the cell px size, or "misaligned", in the ADR under "Spike result". Set `OVERLAY_MODE` accordingly.
- [ ] **Step 6:** Remove the spike command and Pane drawing; keep the scaffold, constants and marketplace entry. Commit `feat(how): scaffold plugin; record overlay spike result`.

### Task 2: Behaviour model schema and parsing

**Files:**
- Create: `hooks/model/behaviour-model.ts`, `skills/how/references/behaviour-model.md`, `tests/behaviour-model.test.ts`, `tests/fixtures/models/{pr-small,codebase-small}.json`

**Interfaces:**
- Produces the types below, plus `parseBehaviourModel(json: string): { model: BehaviourModel } | { error: string }`.

The decision-rich type shape:

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
  seamViews: Record<string, SeamView>   // keyed by element id or seam id
  incidentalChanges: { file: string; hunk: string; reason: 'refactor' | 'test' | 'config' | 'docs' | 'other' }[]
  baseBehaviours?: Behaviour[]          // PR mode: the same Behaviours at base, matched by entry point element name
}
```

- [ ] **Step 1:** Write the tests:
  - `parses pr-small fixture`: has 2 Behaviours and 1 Incidental change.
  - `rejects version 2 with "unsupported Behaviour model version 2"`.
  - `rejects invalid JSON with an error, never throws`.
  - `rejects a step whose from/to names no element`, with an error naming the step id.
  - `rejects a Behaviour without entryPointId in elementIds`.
- [ ] **Step 2:** Run `claude plugin test plugins/how`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the types and `parseBehaviourModel` with hand-written structural validation; there is no schema library in the hooks environment. Write `references/behaviour-model.md` as the same shape, plus one sentence per field, for producer agents.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(how): Behaviour model schema`.

### Task 3: Evidence check

**Files:**
- Create: `hooks/model/evidence-check.ts`, `tests/evidence-check.test.ts`

**Interfaces:**
- Consumes: `BehaviourModel`, `Evidence` (Task 2).
- Produces `verifyEvidence(model: BehaviourModel, readFile: (path: string) => Promise<string | undefined>): Promise<{ model: BehaviourModel; dropped: { id: string; reason: string }[] }>`.

**Rules:**
- An Evidence item is `verified` when the file reads and `symbol` appears within `startLine..endLine`, with ±3 lines tolerance.
- It becomes `inferred` when the file exists and the symbol appears anywhere in the file.
- Otherwise it is invalid.
- An element or Step with no valid Evidence is dropped. Steps referencing a dropped element are dropped too.
- `readFile` returning `undefined` (missing, or over 4 MiB) counts as invalid.

- [ ] **Step 1:** Write the tests, using an in-memory `readFile`:
  - `marks evidence verified when symbol is on the cited lines`
  - `marks inferred when symbol is elsewhere in the file`
  - `drops a Step whose only evidence is in a missing file and reports why`
  - `drops Steps touching a dropped element`
  - `keeps verifying after a file read returns undefined (oversized)`
  - `line range past EOF is invalid, not a throw`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. It is pure apart from `readFile`; cache reads per file.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(how): deterministic Evidence check`.

### Task 4: Step diff marking and node budget

**Files:**
- Create: `hooks/model/behaviour-diff.ts`, `hooks/model/budget.ts`, `tests/behaviour-diff.test.ts`, `tests/budget.test.ts`

**Interfaces:**
- Produces:
  - `markStepDiffs(base: Behaviour | undefined, head: Behaviour): Behaviour`. It returns head with each Step's and ErrorFlow's `diff` set, plus `removed` Steps from base re-inserted at their base order. `mcp__how__open` (Task 10) calls it for each head Behaviour, finding `base` in `model.baseBehaviours` by entry point element name. ErrorFlows match on (origin Step identity, handler element name).
  - `foldToBudget(elementIds: string[], steps: Step[], opts: { budget: number; cap: number; pinned: string[] }): { visibleIds: string[]; groups: { id: string; label: string; memberIds: string[] }[] }`. Callers pass 12 and 20.

**Diff matching:** a Step's identity is `(fromName, toName, label)` after normalising whitespace and case.
- Same identity, same evidence symbol: `unchanged`.
- Same `(from, to)`, different label or symbol: `changed`.
- A head Step with no match: `added`. A base Step with no match: `removed`.
- A Step whose `to` changed but `from`/label match counts as `changed` (rerouted).
- `base` undefined means everything is `added`.

**Folding:**
- At or under 12 elements, nothing folds.
- Otherwise keep `pinned` (the entry point, elements on changed Steps, Seam endpoints).
- Fold the rest by shared `parentId` into groups labelled `<parent name> (n)` until visible ≤ 12, or ≤ 20 if the pinned set alone exceeds 12.
- If no parentId, use one group labelled `Other (n)`.

- [ ] **Step 1:** Write the diff tests:
  - `identical Behaviours are all unchanged`
  - `new step is added`
  - `missing step is removed and kept in order`
  - `same endpoints new label is changed`
  - `rerouted call is changed`
  - `no base marks all added`
  - `error flow with new handler is changed`
- [ ] **Step 2:** Write the budget tests:
  - `11 elements fold nothing`
  - `30 elements fold to ≤12 visible`
  - `pinned elements are never folded`
  - `15 pinned elements yields ≤20 visible`
  - `group label counts members`
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement both.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(how): step-level Behaviour diff and node budget`.

### Task 5: Sequence layout and SVG

**Files:**
- Create: `hooks/layout/geometry.ts` (extend Task 1), `hooks/layout/sequence-layout.ts`, `hooks/layout/svg.ts`, `tests/sequence-layout.test.ts`, `tests/svg.test.ts`

**Interfaces:**
- Consumes: `Behaviour`, `Element`, `foldToBudget` (Task 4).
- Produces:
  - `type CellRect = { col: number; row: number; cols: number; rows: number }`
  - `type LayoutNode = { id: string; label: string; rect: CellRect; style: NodeStyle }` and `type NodeStyle = { diff: DiffStatus; isInferred: boolean; isGroup: boolean; isFaded: boolean; isError?: boolean }`
  - `type LayoutEdge = { id: string; from: string; to: string; label: string; points: { col: number; row: number }[]; style: NodeStyle & { isSeamCrossing: boolean } }`
  - `type Layout = { cols: number; rows: number; nodes: LayoutNode[]; edges: LayoutEdge[] }`
  - `layoutBehaviourView(b: Behaviour, model: BehaviourModel, opts: { maxCols: number; showErrors: boolean }): Layout`
  - `toSvg(layout: Layout, cell: { width: number; height: number }): string`

**Rules:**
- Lifelines go left to right in order of first appearance, entry point first, columns evenly spread within `maxCols`.
- Each Step is one row. Error overlay rows (`showErrors`) are inserted after their origin Step: dashed lines, red-family stroke, a `swallowed` badge.
- Labels are truncated to the column width with `…`. All text is XML-escaped.
- Diff styles: `added` green, `removed` struck and grey, `changed` amber. Inferred elements get a dashed border.
- Colours come from CSS `prefers-color-scheme` within the SVG `<style>`, so the diagram works in both themes.

- [ ] **Step 1:** Write the tests:
  - `entry point is the first lifeline`
  - `one row per step in order`
  - `single-element behaviour with zero steps yields one lifeline and no edges` (Review Focus 4)
  - `labels with < & " and emoji produce well-formed svg` (parse-check with a regex balance of tags; no `&` not followed by an entity)
  - `250-char label is truncated with …` (Review Focus 3)
  - `showErrors adds dashed error rows after origin step`
  - `svg for 20 nodes is under 131072 chars`
  - `fits within maxCols`
  - `elements outside the Behaviour's elementIds that its Steps touch are drawn isFaded`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Coordinates are in cells; `toSvg` multiplies by `cell` px.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(how): sequence layout and SVG rendering`.

### Task 6: Graph layout via vendored elkjs

For the Behaviour map (Behaviours ↔ Seams) and Seam view flowcharts.

**Files:**
- Create: `scripts/vendor-elk.mjs`, `hooks/vendor/elk.mjs` (generated, committed), `hooks/layout/graph-layout.ts`, `tests/graph-layout.test.ts`

**Interfaces:**
- Consumes: `Layout`, `CellRect`, `NodeStyle` (Task 5), `SeamView` (Task 2).
- Produces:
  - `layoutGraph(input: { nodes: { id: string; label: string; style: NodeStyle }[]; edges: { id: string; from: string; to: string; label?: string; isError: boolean }[] }, opts: { maxCols: number; direction: 'DOWN' | 'RIGHT' }): Promise<Layout>`
  - `layoutSeamView(view: SeamView, opts: { maxCols: number; showErrors: boolean }): Promise<Layout>`

- [ ] **Step 1:** Write `vendor-elk.mjs`. It bundles `elkjs/lib/elk.bundled.js` with esbuild to a single ESM `hooks/vendor/elk.mjs` (`format: 'esm'`, `platform: 'neutral'`, no worker). Run `node plugins/how/scripts/vendor-elk.mjs`. Expected: the file exists and `claude plugin validate plugins/how` passes, with no `import()` and no `require`.
- [ ] **Step 2:** Write the tests:
  - `lays out 3 nodes with non-overlapping cell rects`
  - `edges have ≥2 points`
  - `fits maxCols` (scaling down to cells, labels truncated)
  - `seam view hides isError edges when showErrors is false`
  - `layout of 20 nodes completes` (within the test default timeout)
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement: elk `layered` algorithm, node sizes from label length in cells, px→cell conversion with `CELL_PX`.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(how): elk graph layout for map and Seam views`.

### Task 7: Panel navigation state and Behaviour map

**Files:**
- Create: `hooks/panel/navigation.ts`, `hooks/panel/pane.tsx`, `hooks/panel/behaviour-map.tsx`, `tests/navigation.test.ts`, `tests/behaviour-map.test.tsx`
- Modify: `hooks/register.tsx` (Pane render hook; state atoms), `types/index.d.ts` (PluginState)

**Interfaces:**
- Consumes: `BehaviourModel` (Task 2), `layoutGraph` (Task 6).
- Produces:
  - `type ViewRef = { kind: 'map' } | { kind: 'behaviour'; behaviourId: string } | { kind: 'seam'; subjectId: string; behaviourId: string } | { kind: 'evidence'; ownerId: string; index: number }`
  - `type Navigation = { stack: ViewRef[]; showErrors: boolean; expandedGroups: string[] }`
  - `push(nav, ref)`, `popTo(nav, depth)`, `toggleErrors(nav)`, `toggleGroup(nav, id)`, all returning `Navigation`.
  - State atoms under plugin `how`: `model: { path?: string; model?: BehaviourModel; error?: string }` and `nav: Navigation`.
  - `renderPane($, e): JSX` in `pane.tsx`.

**Map content:**
- Intent block: the text and its sources, "Intent missing" when `isMissing`, and Intent mismatches as warnings.
- Behaviours ordered by `risks` then `rank.score`, each a `Button` keyed `behaviour-<id>` showing its name, risk chips and the Seams crossed.
- A `show-more` Button when there are more than 7.
- An "Incidental changes" list, collapsed by default.
- Breadcrumb: Buttons keyed `crumb-<depth>`.
- Error state (`model.error`): Text with the message and a `reload` Button (Review Focus 1).

- [ ] **Step 1:** Write the navigation tests:
  - `push then popTo(0) returns to map`
  - `toggleErrors flips`
  - `toggleGroup adds and removes`
- [ ] **Step 2:** Write the map tests, looping over `['terminal','desktop']`:
  - `shows behaviours in risk order`
  - `press behaviour-b1 pushes behaviour view` (assert the breadcrumb shows 2 crumbs)
  - `intent missing is stated`
  - `intent mismatch shown`
  - `incidental changes listed`
  - `show-more appears with 9 behaviours`
  - `bodyColumns 40 draws without exceeding width` (terminal Text lines ≤ 40)
  - `model error shows message and reload button`
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. Width comes from `e.props.bodyColumns`. On desktop the map's Seam diagram is `Svg` via `layoutGraph`; on terminal it is a Text list.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(how): pane navigation and Behaviour map`.

### Task 8: Behaviour view and Seam view (clickable diagrams)

**Files:**
- Create: `hooks/panel/diagram-view.tsx`, `tests/diagram-view.test.tsx`

**Interfaces:**
- Consumes: `layoutBehaviourView` (Task 5), `layoutSeamView` (Task 6), `foldToBudget`, `markStepDiffs` (Task 4), `Navigation` (Task 7), `OVERLAY_MODE` and `CELL_PX` (Task 1).
- Produces `renderDiagramView($, e, ref: Extract<ViewRef, { kind: 'behaviour' | 'seam' }>, model, nav): JSX`.

**Rendering:**
- **Desktop and VS Code:** `Svg` (`isInteractive: true`, `alt` = the Behaviour name plus step count). Clickable nodes depend on `OVERLAY_MODE`:
  - `overlay`: absolute `Button`s keyed `node-<id>` at each `LayoutNode.rect`, plus `edge-<id>` Buttons at edge label midpoints for Seam crossings.
  - `legend`: numbered labels in the SVG and a Button list keyed the same way.
- **Terminal:** a Box/Text rendering, one line per Step (`from → to : label [diff]`), with the same `node-`/`edge-` Buttons.
- **Press targets:**
  - an element opens a Seam view for that element;
  - a Seam crossing opens a Seam view for the Seam;
  - a group toggles `expandedGroups`;
  - an `evidence` Button opens the Evidence view.
- **Controls:**
  - `toggle-errors` Button, labelled "Show errors" / "Hide errors".
  - A legend line for diff colours and Inferred.
  - Seam view header: Contract text, Enabling point, and "Contract changed" when `isContractChanged`.
- A `pending` or `building` subject renders a "Building…" state (Task 10 triggers the build). `failed` renders a `retry` Button.

- [ ] **Step 1:** Write the tests, looping over `['terminal','desktop']`:
  - `behaviour view renders a node button per visible element`
  - `pressing a seam crossing opens seam view showing its contract`
  - `toggle-errors shows error rows and swallowed badge` (find Text `swallowed`)
  - `contract-changed seam is flagged`
  - `30-element behaviour shows ≤12 node buttons plus group buttons; pressing a group expands it`
  - `inferred element is marked` (desktop: SVG source contains the dashed class; terminal: Text contains `(inferred)`)
  - `removed step shown`
  - `changed error flow is marked in the overlay`
  - `failed seam view shows retry`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(how): clickable Behaviour and Seam views with Error overlay`.

### Task 9: Evidence view

**Files:**
- Create: `hooks/panel/evidence-view.tsx`, `tests/evidence-view.test.tsx`

**Interfaces:**
- Consumes: `Evidence`, `ViewRef` (Tasks 2, 7).
- Produces:
  - `renderEvidenceView($, e, ref: Extract<ViewRef, { kind: 'evidence' }>, model, snippets: Record<string, string>): JSX`.
  - Snippet text is loaded into a state atom `snippets` keyed `file:start-end` by the press handler via `$.fs.read`, before pushing the view.

**Content:**
- A `Code` element (`path`, `startLine`, `source` = the cited lines ±3).
- When `hunk` is present, a second `Code` with `format: 'diff'`.
- The status chip: verified or inferred.
- On `terminal` only, a `Link` with `href: vscode://file/<abs>:<line>`.

- [ ] **Step 1:** Write the tests:
  - `shows cited lines with startLine gutter`
  - `shows diff hunk when present`
  - `terminal has editor link, desktop has none`
  - `unreadable file shows "source unavailable" not a throw`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(how): inline Evidence view`.

### Task 10: Mod tools, model loading and lazy drill-down

**Files:**
- Create: `hooks/drill-down.ts`, `agents/behaviour-builder.md`, `tests/tools.test.ts`, `tests/drill-down.test.ts`
- Modify: `hooks/register.tsx`

**Interfaces:**
- Consumes: `parseBehaviourModel`, `verifyEvidence` (Tasks 2–3), state atoms (Task 7).
- Produces:
  - Tool `mcp__how__open`, `isDeferred: false`, input `{ modelPath: string }`. It reads the file and parses it. It runs `markStepDiffs` against `baseBehaviours`. It verifies with `readFile = p => $.fs.read(p).catch(() => undefined)`, writes the verified model back to `modelPath`, sets state and opens the Pane `how`. It returns `{ result: "<n> Behaviours, <d> elements dropped: …" }` so the session can report what was dropped.
  - Tool `mcp__how__refresh`, input `{ modelPath: string }`: the same, but leaves the navigation stack as it is.
  - Agent type `how:behaviour-builder`, from `agents/behaviour-builder.md`.
  - `requestBuild($, subject: { kind: 'behaviour'; behaviourId: string } | { kind: 'seam'; subjectId: string; behaviourId: string }): Promise<void>`. It sets the subject's status to `building`, then calls `$.agent.spawn({ subagentType: 'how:behaviour-builder', description: 'how: build <name>', prompt })`. The prompt holds the model path, the subject, and the instruction to update only that subject in the model file and then call `mcp__how__refresh`.
  - A `deny`, a spawned agent's `turn.complete` without a refresh, or 10 minutes with no refresh marks the subject `failed` (Review Focus 5).

- [ ] **Step 1:** Write the tool tests, with a `mock`/test hook answering `fs.read` and `fs.write`:
  - `open loads, verifies, opens pane and reports dropped count`
  - `open with corrupt file sets model.error and still opens pane`
  - `refresh keeps navigation stack`
- [ ] **Step 2:** Write the drill-down tests, with the test `on('agent.spawn')` answering:
  - `pressing a pending behaviour spawns how:behaviour-builder once and shows Building…`
  - `deny marks failed and retry spawns again`
  - `turn.complete without refresh marks failed`
  - `refresh after build flips status to built`
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Write `behaviour-builder.md`:
  - tools: Read, Grep, Glob, LSP, Bash (git only), Write;
  - prompt: build one Behaviour or one Seam view per `skills/how/references/behaviour-model.md`, every element and Step with Evidence, never invent;
  - mark DI/reflection/bus edges Evidence `inferred`;
  - respect the 12-node budget by choosing the abstraction level.
- [ ] **Step 5:** Implement the tools and `requestBuild` in `drill-down.ts`; wire them in `register.tsx` at `session.start`.
- [ ] **Step 6:** Run. Expected: PASS. Run `claude plugin validate plugins/how`. Expected: clean.
- [ ] **Step 7:** Commit `feat(how): open/refresh tools and lazy drill-down`.

### Task 11: Producer: `/how` command and skill

**Files:**
- Create: `commands/how.md`, `skills/how/SKILL.md`

**Interfaces:**
- Consumes: `references/behaviour-model.md` (Task 2), `how:behaviour-builder` and `mcp__how__open` (Task 10).
- Produces: a model file at `<git-common-dir>/how/<head-sha>.json`, opened in the panel.

**`commands/how.md`:** `argument-hint: [PR# | branch | base..head | path | "focus"]`. The body invokes the `how` skill with `$ARGUMENTS`.

**`SKILL.md`:** frontmatter description triggers on plain-language asks ("explain what this PR does", "how does X work"). The body gives these steps, each a short instruction; use the mattpocock-skills:writing-for-agents style.

1. **Resolve the target.**
   - Digits mean a PR: `gh pr view <n> --json baseRefOid,headRefOid,body,title,closingIssuesReferences` plus `gh pr diff`.
   - `a..b` means a range.
   - An existing path means focus on that path.
   - Other text means a free-text focus.
   - Empty means the current branch vs the merge-base with the default branch. If there is no diff, use codebase mode.
2. **Check the cache.** If `<git-common-dir>/how/<head-sha>.json` exists and its `scope` matches, call `mcp__how__open` and stop.
3. **Intent (PR mode).** Gather the PR body, linked issues, commit messages and ADRs touched. Set `isMissing` when there are none. Never paraphrase intent that isn't stated.
4. **Find Behaviours.**
   - PR mode: for each changed hunk, use LSP `incomingCalls` up to the outermost Entry point within the focus. Group hunks by Entry point. Hunks that reach no Entry point become Incidental changes, with a reason.
   - Codebase mode: list entry points (routes, CLI commands, consumers, jobs, exported API within the focus). Score each one:
     - `reach`: distinct elements reachable through `outgoingCalls`, depth ≤ 4;
     - `fanIn`: references to the touched elements;
     - `hotspot`: `git log --since=12.months --format= --numstat` churn × file line count as a complexity proxy;
     - multiply the three, and multiply by ×1.5 if the Behaviour crosses a network or message Seam.
   - Keep the scores in `rank.signals`.
5. **Order and status.** Order PR Behaviours by risk (Contract change, then error-handling change, then fan-in). The first 7 get `status: 'built'`; the rest get `'pending'` with entry-point Evidence only.
6. **Build.** Dispatch one `how:behaviour-builder` per Behaviour to build, in parallel, each returning its Behaviour JSON fragment.
7. **Base comparison (PR mode).** For each built Behaviour, build the same Entry point at base and store it in `baseBehaviours`. Reuse `<git-common-dir>/how/<base-sha>.json` when present; otherwise `git worktree add` the base so LSP works on it. Leave `diff` as `unchanged`; `mcp__how__open` computes the diffs.
8. **Intent mismatches.** Compare the PR's claims with the observed Behaviour changes; record each mismatch with Evidence.
9. **Write and open.** Write the model and call `mcp__how__open`. Report the tool's dropped-element summary in one line.

- [ ] **Step 1:** Write `commands/how.md` and `SKILL.md`.
- [ ] **Step 2:** Run `claude plugin validate plugins/how`. Expected: the command, skill and agent are listed.
- [ ] **Step 3:** Smoke-run in this repo, which has no code Behaviours: `claude -p "/how" --plugin-dir plugins/how`. Expected: it reports codebase mode with no entry points found and exits cleanly, without crashing or inventing.
- [ ] **Step 4:** Commit `feat(how): /how command and producer skill`.

### Task 12: Evals on sample repos

**Files:**
- Create: `evals/fixtures/http-orders/` (small TS Express app: 2 routes, a repository interface with 2 implementations chosen by config, one swallowed error), `evals/fixtures/http-orders/expected.json`, `evals/fixtures/http-orders/pr.patch` (changes a Contract and adds an error branch), `evals/fixtures/py-cli/` (Python CLI: 2 commands, a plugin registry Seam, `expected.json`), `evals/score.mjs`, `evals/README.md`

**Interfaces:**
- Consumes: the model file written by Task 11.
- Produces `node evals/score.mjs <model.json> <expected.json>`, which prints JSON `{ behaviourRecall, evidenceVerifiedRate, seamRecall, incidentalAccuracy, maxNodesPerView, pass }` and exits 1 when `pass` is false.

**Thresholds** (provisional, tune after the first runs):
- `behaviourRecall ≥ 0.8`
- `evidenceVerifiedRate ≥ 0.9`
- `seamRecall ≥ 0.7`
- `incidentalAccuracy ≥ 0.8`
- `maxNodesPerView ≤ 20`

**`expected.json` shape:**

```json
{ "behaviours": [{ "entryPoint": "POST /orders" }], "seams": [{ "name": "OrderRepository", "kind": "interface" }], "incidental": ["README.md"], "contractChanged": ["OrderRepository"], "swallowed": ["sendReceipt"] }
```

- [ ] **Step 1:** Write the fixtures and `expected.json`. Write `score.mjs`, matching by case-insensitive substring on names.
- [ ] **Step 2:** Write unit checks for `score.mjs` against a hand-made perfect model and an empty model. Run `node --test evals/`. Expected: perfect passes, empty fails.
- [ ] **Step 3:** Run the producer on each fixture: `cd evals/fixtures/http-orders && git init -q && git add -A && git commit -qm base && git apply pr.patch && git commit -qam pr && claude -p "/how HEAD~1..HEAD" --plugin-dir ../../..`. Then score the produced model. Record the scores in `evals/README.md`.
- [ ] **Step 4:** If a threshold fails, iterate on `SKILL.md` and `behaviour-builder.md`, not the thresholds, until the scores pass or a gap is documented in the README.
- [ ] **Step 5:** Commit `test(how): fixture evals and scorer`.

### Task 13: Docs and finish

**Files:**
- Modify: `README.md` (add `how` under the plugins list with install line `/plugin install how@karlssberg`)
- Create: `plugins/how/README.md`: usage, surfaces, the cache location, and the early-access API caveat

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run `claude plugin validate .` and `claude plugin test plugins/how`. Expected: clean and all PASS.
- [ ] **Step 3:** Commit `docs(how): README and install`. The PR body says `Closes #1`.
