# How

The `how` plugin explains what code *does* — as diagrams of behaviours, seams and error flows — so developers can review behaviour rather than read code, for a PR or a whole codebase.

## Language

**Behaviour**:
One externally triggered flow: an entry point and the effects it causes (state changes, outgoing calls, responses).
_Avoid_: feature, flow, use case, scenario

**Entry point**:
The outermost boundary through which a Behaviour is triggered, relative to the focus being analysed — an HTTP route for a whole app, but a library's public function when only that library is in focus.
_Avoid_: root, top-level

**Critical path**:
A Behaviour ranked highly because it is load-bearing, hot or otherwise critical; not a separate kind of thing.
_Avoid_: hot path (as a distinct concept)

**Seam**:
A boundary a Behaviour crosses where what happens can vary without editing the caller — an interface, a module's public API, a network/IPC/message boundary, or a DI/config/flag binding.
_Avoid_: boundary, interface (as the general term), integration point

**Contract**:
What a Seam promises: its signature, schema or endpoint shape.
_Avoid_: API (as the general term), spec

**Enabling point**:
The place where a Seam's concrete implementation is chosen (a DI binding, config value, flag or factory).

**Behaviour model**:
The evidence-backed description of the Behaviours in scope — their elements, Seams, flows and error flows — from which every view is drawn.
_Avoid_: graph, index

## Views

**Behaviour map**:
The top view: which Behaviours are in scope, the Seams they cross, and the suggested review order.

**Behaviour view**:
One Behaviour's happy path as a sequence across elements, drawn at the lowest abstraction level that contains the whole Behaviour.

**Seam view**:
One element's internals or one Seam crossing, with its Contract and error flow.
_Avoid_: step view, component view

**Error overlay**:
A toggle on a view that shows where errors originate, how they are transformed at Seams, and where they are handled or swallowed.

**Incidental change**:
A changed hunk in a PR that no Behaviour's path passes through (a refactor, test, config or docs change); listed apart from Behaviours.
_Avoid_: other changes, noise

**Intent mismatch**:
A place where a PR's stated intent (description, linked issue, commits) disagrees with the observed Behaviour change.

**Evidence**:
A `file:line` citation proving that a node or edge exists in the code.

**Inferred**:
Said of a node or edge the tooling cannot prove from evidence (e.g. DI wiring, reflection, message buses); shown distinctly and still cited to the code that suggests it.
_Avoid_: guessed, heuristic
