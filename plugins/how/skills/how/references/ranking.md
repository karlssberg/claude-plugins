# Finding and ranking Entry points (codebase mode)

Codebase mode explains the Critical paths of the code in focus. Find every Entry point, score each one, and keep the scores.

## 1. List the Entry points

An Entry point is the outermost place, within the focus, through which something outside triggers the code. Look for each kind with Grep and LSP:

- **Routes**: HTTP or RPC handler registrations (`app.get(`, `router.post(`, `@app.route`, `@GetMapping`, `[HttpPost]`, `http.HandleFunc`, gRPC service implementations).
- **CLI commands**: `bin` entries in a package manifest, `main` functions, argparse/commander/cobra/clap command definitions.
- **Consumers**: message, queue, event and webhook subscribers (`subscribe(`, `@KafkaListener`, `consume`, event `on(` registrations, framework hook registrations, registered tool handlers).
- **Jobs**: cron, scheduler and worker registrations.
- **Exported library functions**: the public functions of a library (`exports`/`main` in `package.json`, `__init__.py`, `pub` items in `lib.rs`). Count these only when the focus is that library, or when the code in focus has none of the kinds above.

Within a focus, the Entry point is relative to it: when the focus is one module, its public functions called from outside the module are its Entry points.

A **free-text focus** ("checkout", "how retries work"): Grep for its words in symbol names, file names and comments, then follow `incomingCalls` from the matches out to the Entry points that reach them. Those Entry points are the candidates.

Every Entry point you keep has Evidence: the registration or definition line. Code you cannot cite is not an Entry point.

## 2. Score each one

Compute four signals per Entry point. Floor each of the first three at 1 so one zero cannot erase the rest.

- `reach`: the number of distinct repo Elements (functions, classes, modules) reachable from the Entry point through LSP `outgoingCalls`, to depth 4. Each external system it calls counts once.
- `fanIn`: the number of distinct referencing locations (LSP `findReferences`) of the Elements it reaches. High `fanIn` means it runs through load-bearing code.
- `hotspot`: for each file holding a reached Element, its churn times its line count, summed. Churn is the added plus deleted lines from `git log --since=12.months --format= --numstat -- <file>`; line count is `wc -l <file>`.
- `seamBoost`: `1.5` when the Behaviour crosses a `network` or `message` Seam (an HTTP client call, a queue publish, a database driver call), otherwise `1`.

`score = reach × fanIn × hotspot × seamBoost`. Store `rank: { score, signals: { reach, fanIn, hotspot, seamBoost } }`.

With more than 30 Entry points, compute `hotspot` for all of them first and score only the 30 highest; the rest get `pending` with `rank.score: 0` and the signals you have.

## 3. Order

Sort by `score`, highest first. Ties go to the higher `fanIn`. The order of `behaviours` is the suggested review order on the Behaviour map, so it must be the score order: never alphabetical or by file.

Name each Behaviour for what it does, in the code's own domain words ("Cancel an order", "Sync the plugin catalogue"), so its name carries information scent. A class or file name alone ("OrderController") is the Entry point Element's name, not the Behaviour's.
