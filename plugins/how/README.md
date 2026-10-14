# how

Explains what code does, as diagrams, so you can review behaviour instead of reading code. It works on a PR, a branch, or a whole codebase.

It builds a **Behaviour model**: the **Behaviours** in scope (each an Entry point and the effects it causes) and the **Seams** they cross (interfaces, public APIs, network or message boundaries, DI/config/flag bindings, each with its Contract). Every node and edge cites **Evidence**, a `file:line` the plugin re-reads in your checkout. A link the tooling cannot prove, such as DI wiring or reflection, is shown as **Inferred** and still cites the code that suggests it. An **Error overlay** toggle shows where errors originate, how they change at Seams, and where they are handled or swallowed.

For a PR it also lists **Incidental changes** (hunks no Behaviour passes through) and **Intent mismatches** (where the PR's stated intent disagrees with the observed change).

## Install

```
/plugin marketplace add karlssberg/claude-plugins
/plugin install how@karlssberg
```

## Usage

```
/how [PR# | branch | base..head | path | "focus"]
```

| Argument | Meaning |
|---|---|
| none | The current branch's head against its merge-base with the default branch. With no difference, codebase mode. |
| `123` or `#123` | A PR. Needs `gh`, and the PR checked out (`gh pr checkout 123`). |
| `branch` | That branch's head against its merge-base with the default branch. Only the current branch is supported; otherwise switch to it first. Naming the current or the default branch is the same as no argument. |
| `base..head` | A range. The base is the merge-base of the two. |
| `path` | Codebase mode, focused on that path. |
| `"focus"` | Codebase mode, focused on that text (for example `"checkout"`). |

PR mode explains committed changes only, never working-tree edits. The head must be your checkout, because the Evidence check reads your files.

## Drill-down

Open the how panel and go down level by level:

1. **Behaviour map**: the Behaviours in scope, the Seams they cross, and a suggested review order.
2. **Behaviour view**: one Behaviour's happy path as a sequence across elements.
3. **Seam view**: one element's internals, or one Seam crossing, with its Contract and error flow.
4. **Evidence**: the code a node or edge cites, its `file:line` range with 3 lines either side, and the changed hunk in PR mode.

The first 7 Behaviours are built up front. The rest, and every Seam view, are built when you open them. In PR mode, steps show as added, removed or changed against the base.

## Surfaces

- Desktop app and VS Code: SVG diagrams in the panel.
- Terminal: a text/box fallback, since the terminal has no `Svg`.

Nodes are clickable through a numbered legend. A direct overlay of buttons on the diagram is implemented but provisional, switched off (`OVERLAY_MODE` in `hooks/layout/geometry.ts`) until a manual desktop alignment check. See [ADR 0001](../../docs/adr/0001-drill-down-lives-in-a-mod-panel.md).

## Where data goes

- Staging: `/how` writes the model to `$TMPDIR/how/<head sha>.json`.
- Cache: the panel writes it to `<git-common-dir>/how/<head sha>.json` through its own file access. The skill never writes inside `.git`.
- Nothing is committed to your repo. A cached model is reused when its scope matches and there are no tracked changes.

## Requirements and caveats

- **Sandboxed sessions need `sandbox.network.allowLocalBinding: true`.** The plugin registers tools that bind a local port. Without it the panel still draws, but the `mcp__how__*` tools do not exist, so `/how` cannot open the model in it: you see the toast "how: tools unavailable", and the skill reports where the staging file was written.
- **Cost.** A live run costs about $3 for a small PR (see [evals/README.md](../../evals/README.md)). It dispatches one subagent per built Behaviour, and in PR mode one more per Behaviour for the base.
- **Early access.** The mod API this plugin is built on is early access and changes between Claude Code releases.
- Branch mode and the default branch are read from `origin/HEAD`, else `main`, else `master`.

## Development

From the repo root:

```sh
claude plugin validate .
claude plugin test plugins/how      # plugin tests
node --test evals/                  # the evals' scorer
evals/run-fixture.sh http-orders 1  # a live eval run, about $3
```

To type-check, run `npm run typecheck` in `plugins/how`. It needs the mod API's types, which the engine lays into `.claude-plugin/types/` when it loads the mod from a dev folder (`claude --plugin-dir plugins/how`); they are generated, so never commit them.

Evals, fixtures, thresholds and results are described in [evals/README.md](../../evals/README.md).
