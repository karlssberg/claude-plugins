# how evals

Evals for the `how` plugin (`plugins/how`). They live at the repo root, outside the shipped plugin. Two small fixture repos, each with a PR patch. The producer (`/how`) runs on each one, and its Behaviour model is scored against `expected.json`.

| Fixture | Code | Entry points | Seam (two implementations) | Swallowed error | PR (`pr.patch`) |
|---|---|---|---|---|---|
| `http-orders` | TypeScript (Express, never installed) | `POST /orders`, `GET /orders/:id` | `OrderRepository` interface: in-memory or Postgres, chosen by `ORDER_STORE` | `sendReceipt` ignores mailer failures | Contract: `findById(tenantId, id)` and `Order.tenantId`. Error branch: 401 without `X-Tenant-Id`. |
| `py-cli` | Python (argparse) | `notes export`, `notes sync` | `Exporter` Protocol plus the `EXPORTERS` registry: JSON or CSV, chosen by `--format` / `NOTES_FORMAT` | `sync` ignores a failed `push` | Contract: `Exporter.export` returns `int`. Error branch: `UnknownFormatError`, which makes the CLI exit with status 2. |

Each fixture keeps its base code in `repo/`, the change in `pr.patch`, the commit message (the stated intent) in `pr-message.txt`, and what the scorer looks for in `expected.json`. Only `repo/` is copied into the repo under test, so the producer never sees `expected.json`.

## How to run

From the repo root:

```sh
node --test evals/                      # unit checks for the scorer
evals/run-fixture.sh http-orders 1      # copy to $TMPDIR/how-eval-http-orders-1, git init, commit base, apply pr.patch, commit pr, run /how
evals/open-fixture.sh http-orders 1     # only when the run could not call mcp__how__open itself (see Gaps)
node evals/score.mjs evals/results/http-orders.run1.model.json evals/fixtures/http-orders/expected.json
```

- `run-fixture.sh` never creates a `.git` inside this repo.
- The producer runs as `claude -p "/how HEAD~1..HEAD" --plugin-dir plugins/how --max-budget-usd 5 --output-format json --permission-mode dontAsk --allowedTools …`.
  - Headless runs cannot answer permission prompts, so the allowlist names only what the skill and its builders use:
    - Skill, Read, Grep, Glob, LSP, Agent and `mcp__how__*`;
    - `Edit(./.git/how/**)` for writes. The Write tool is checked against Edit path rules, and a `Write(path)` rule is never consulted, so this one rule scopes Write to the model folder;
    - `Bash` limited to read-only git: `log`, `show`, `diff`, `blame`, `rev-parse`, `merge-base`, `status` and `symbolic-ref`. `worktree` is allowed for the base worktree, and `mkdir -p` for the cache folder;
    - `git -C <path>` only as `Bash(git -C * rev-parse|log|show|diff|blame:*)`. The docs allow a `*` mid-pattern; `:*` is recognised only at the end.
  - `--disallowedTools "Bash(git * -c *)"` denies git's `-c`, which can make git run a program.
  - Residual risk: a mid-pattern `*` stands for any text, so `git -C . push origin log` still matches `Bash(git -C * log:*)`. The rules narrow the commands allowed but do not make them read-only.
  - `dontAsk` denies anything off the list instead of waiting for an answer.
  - **Known blocker, from the docs and not yet observed in a run:** `.git` is a protected path, and in `dontAsk` mode protected-path writes are denied whatever the allow rules say (permission-modes, Protected paths). So under this allowlist the skill cannot write `.git/how/<sha>.json`, and `mkdir -p .git/how` is likely denied too. The run is expected to end with "no model", and the script then exits 1. The three runs below used `--permission-mode bypassPermissions` inside a sandbox, which does allow protected-path writes. A working headless run needs `bypassPermissions` in an isolated environment, `auto` mode (the classifier decides), or a cache path outside `.git`. That choice is for the controller.
  - **This allowlist has not been run live** (ruling R31). `open-fixture.sh` used `--allowedTools mcp__how__open`.
- The model lands at `$(git rev-parse --git-common-dir)/how/<head sha>.json` in the temp repo. It is copied to `results/<name>.run<n>.model.json`, and the CLI's JSON output to `results/<name>.run<n>.out.json`, so a rerun never overwrites an earlier one.
- When no model was written, the script prints the CLI's JSON answer and exits 1.
- `score.mjs` prints `{ behaviourRecall, evidenceVerifiedRate, seamRecall, incidentalAccuracy, maxNodesPerView, contractChangedRecall, swallowedRecall, pass }` and exits 1 when `pass` is false.

## Thresholds

| Metric | Gate | How it is measured |
|---|---|---|
| `behaviourRecall` | ≥ 0.8 | Fraction of expected Entry points found as a Behaviour's Entry point Element name (case-insensitive substring). |
| `evidenceVerifiedRate` | ≥ 0.9 | Evidence items with `status: "verified"` divided by all Evidence items on head content. It excludes `baseBehaviours`, removed Steps and error flows, and Elements that only those touch. |
| `seamRecall` | ≥ 0.7 | Fraction of expected Seams found by name (substring) and exact `kind`. |
| `incidentalAccuracy` | ≥ 0.8 | Fraction of expected Incidental change files present in `incidentalChanges`. |
| `maxNodesPerView` | ≤ 20 | Largest number of distinct Elements touched by one built Behaviour's Steps. |
| `contractChangedRecall` | informational | Expected Seams that have `isContractChanged: true`. |
| `swallowedRecall` | informational | Expected names found on a swallowed error flow: its origin Step's label, its Elements, its handler, and their Evidence symbols. |

`evidenceVerifiedRate` is meaningful only after `mcp__how__open` has run, because the Evidence check writes the verified statuses back to the file. Before that, every item is `unchecked`, so the rate is 0. Items the check drops are no longer in the file. `0 elements dropped` in the open result shows nothing was dropped in these runs.

## Results

Runs were made on 2026-10-14 with Claude Code 2.1.296. The session model was the default `claude-fable-5-1`, and the builders ran on `claude-sonnet-5-5`, as `behaviour-builder.md` sets.

| Fixture, run | Instructions | behaviour recall | evidence verified | seam recall | incidental | max nodes | contract changed | swallowed | pass | cost | wall time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| http-orders #1 | before 819af3f | 1.0 | **0.60** | 1.0 | 1.0 | 8 | 1.0 | 1.0 | **no** | $3.10 + $0.01 open | 209 s |
| http-orders #2 | after 819af3f | 1.0 | 1.0 | 1.0 | 1.0 | 7 | 1.0 | 1.0 | yes | $3.18 + $0.01 open | 247 s |
| py-cli #1 | after 819af3f | 1.0 | 1.0 | 1.0 | 1.0 | 7 | 1.0 | 0.0 | yes | $3.18 + $0.01 open | 267 s |

Cost is the `total_cost_usd` in each run's JSON output, plus the separate open call (see Gaps). Wall time is the producer run alone. The evidence files are in `results/`:

- `*.out.json`: the CLI result.
- `*.open.out.json`: the open call.
- `*.model.json`: the model after the Evidence check.
- `http-orders.run1.*` is the failed first run.

`mcp__how__open` answered `2 Behaviours, 0 elements dropped` on all three models. It reported no parse error, no dropped Element and no path rejection.

### Iteration

- **What failed.** http-orders run 1 cited `symbol: "ordersRouter"` for every Step inside the anonymous `router.post` and `router.get` handlers. The Evidence check finds a symbol only within 3 lines of the cited range, so it marked 19 correct head citations `inferred` instead of `verified`.
- **The fix.** Commit 819af3f changes `behaviour-builder.md`, `SKILL.md` and `references/behaviour-model.md`. Each now says `symbol` must be a name written on the cited lines or beside them, such as the call the line makes, not a function declared further up.
- **The result.** Both later runs scored 1.0 on `evidenceVerifiedRate`. The thresholds were not changed.

### Tools used

The producer runs kept no transcript. The sandbox they ran in cannot write `~/.claude/projects`, and the JSON output does not list tool calls. What the output does show:

- the Skill, git through Bash, and Write (the model file);
- one `how:behaviour-builder` per built Behaviour, plus one per base Behaviour (`subagent_stats`: 2 in run 1, 4 in each later run);
- in run 1, the base Behaviours were traced by the main agent itself "to stay within budget", not by base builders.

Whether the builders used LSP or fell back to Grep/Read is not recorded. The session loaded a TypeScript LSP plugin but no Python one, so py-cli was traced with Grep and Read.

## Gaps

- **`/how` → `mcp__how__open` in one session needs `sandbox.network.allowLocalBinding: true`** (ruling R32). `$.tool.register` binds a local port to serve the plugin's tools. These evals proved the chain across two processes instead: the producer, then `open-fixture.sh`.
- **The producer could not open its own model in these runs.** Plugin tools are served on a local port. The sandbox around these runs forbids binding one, so `$.tool.register` failed with "Failed to start server. Is port 0 in use?" and `mcp__how__open` never existed in the producer's session. `register.tsx` swallowed that error silently at the time, and the skill reported "panel could not be opened". It now logs the reason and raises the toast "how: tools unavailable — <reason>". The skill also tells the user the likely cause and where the model was written.
  - `open-fixture.sh` then called `mcp__how__open` on the written model from a separate headless session. That session ran outside the sandbox and was allowed no tool but `mcp__how__open`, from the same temp repo, so the Evidence check read the same files.
  - The whole chain (`/how`, then the written model, then `mcp__how__open`) therefore ran across two processes, not one. Running the producer itself outside the sandbox was refused by the permission classifier.
- **`swallowedRecall` is 0 on py-cli, but the swallowed flow is in the model.** Its origin Step is labelled "PUT the exported file to the sync server", cites `urlopen`, and has `isSwallowed: true`. It does not name `push`, the function that wraps that call, so the name match misses it.
- **The fixtures are small.** Each has two Entry points, which the producer finds easily. Behaviour recall, Seam recall and the 12/20 node budget are barely exercised. Larger fixtures, and codebase-mode fixtures, are still to come.
- **One run per fixture is noisy.** The scores come from a single sample each.
