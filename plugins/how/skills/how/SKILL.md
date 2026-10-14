---
name: how
description: Explains what code does as evidence-backed Behaviour diagrams in the how panel. Use when the user asks what a PR or branch does ("explain what this PR does"), how a part of this codebase works ("how does checkout work"), or what its critical paths are. Not for writing, fixing or reviewing individual lines of code.
---

# how

Build a Behaviour model of a PR or of the code in focus, write it to the cache, and open it in the how panel. The reader reviews Behaviours, not files, so the model must be **grounded**: every Element, Step, Seam and Intent mismatch cites Evidence you read in the code. What you cannot cite stays out of the model; reasoned links are marked Inferred.

The model format is [references/behaviour-model.md](references/behaviour-model.md). Read it before step 5 and follow it exactly. Use the glossary words in every name and label: Behaviour, Entry point, Critical path, Seam, Contract, Enabling point, Evidence, Incidental change, Intent mismatch.

## 1. Resolve the target

Run `git rev-parse --path-format=absolute --git-common-dir` and `git rev-parse HEAD`. The model path is `<git-common-dir>/how/<head sha>.json` (full 40-hex sha; create the folder with `mkdir -p`).

Read the arguments (`$ARGUMENTS`; when the skill fired from a plain-language ask, the PR, path or topic the user named):

- **Digits** (`123`, `#123`): a PR. Run `gh pr view <n> --json baseRefOid,headRefOid,body,title,closingIssuesReferences` and `gh pr diff <n>`. Mode `pr`, target `#<n>`, `baseSha` = `baseRefOid`, `headSha` = `headRefOid`.
- **`a..b`**: a range. Mode `pr`, target `a..b`, `baseSha` = `git merge-base a b`, `headSha` = `git rev-parse b`.
- **A branch name** (`git rev-parse --verify --quiet <name>` succeeds, and it is no path): the head to explain, against the merge-base with the default branch. When it is the current branch or the default branch, treat it as empty. Any other branch is not checked out: stop and tell the user to `git switch <name>` and run `/how` again.
- **An existing path**: mode `codebase`, `focus` = that path.
- **Other text**: mode `codebase`, `focus` = the text.
- **Empty**: the current branch against the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`, else `master`). Mode `pr`, target `<default>..HEAD`, `baseSha` = `git merge-base <default> HEAD`. When `git diff <baseSha> HEAD` is empty, use mode `codebase` with no focus.

In PR mode the diff is always `git diff <baseSha> HEAD` (or `gh pr diff <n>`): committed changes only, never working-tree edits.

Codebase mode: target is the repo's folder name and `headSha` is HEAD; there is no `baseSha`.

The Evidence check reads the files in this checkout, so the head being explained must be the checkout: when `headSha` differs from HEAD, stop and tell the user to check it out first (for a PR, `gh pr checkout <n>`), then run `/how` again.

**Done when** `scope` is fully known: `mode`, `target`, `headSha`, and `baseSha` or `focus` where they apply.

### The base worktree (PR mode)

As soon as `baseSha` is known, create the one base worktree this run uses. LSP works on it as on any checkout, and every base read in later steps goes through it; the user's checkout keeps its branch, staged changes and files exactly as they are.

```
W="$TMPDIR/how-base-<baseSha first 12>"
git worktree remove --force "$W" 2>/dev/null; git worktree prune
git worktree add --detach "$W" <baseSha> && cd "$W" && pwd -P
```

Note the absolute path `pwd -P` prints: builders need it. **Every exit removes it** with `git worktree remove --force <path>`: the cache hit in step 2, any other early stop, an error at any step, and the end of step 9.

## 2. Check the cache

When the model file exists, its `scope` equals the resolved one (`mode`, `target`, `baseSha`, `focus`), and `git status --porcelain --untracked-files=no` prints nothing, call `mcp__how__open` with `{ "modelPath": <model path> }`, report as in step 9, and stop. The panel settles any Behaviour left `building`.

Otherwise build a new model; it replaces the file.

## 3. Intent (PR mode)

Gather the stated intent and set `intent` as [references/intent.md](references/intent.md) says: the authors' own words from the PR body, linked issues, commit messages and ADRs touched, with `isMissing: true` when none states a purpose. In codebase mode set `intent: { "sources": [], "isMissing": true }` and `incidentalChanges: []`.

## 4. Find the Behaviours

- **PR mode**: walk every changed hunk out to its Entry points and group the hunks by Entry point, as in [references/pr-behaviours.md](references/pr-behaviours.md). Hunks that reach no Entry point go to `incidentalChanges`, each with its reason. **Done when** every hunk is in a Behaviour or in `incidentalChanges`.
- **Codebase mode**: list the Entry points within the focus and score each one, as in [references/ranking.md](references/ranking.md). Keep the scores in `rank.signals`.

When every PR hunk is Incidental, carry on with `behaviours: []`: the model is still written and opened, so the reader sees the Incidental changes.

When codebase mode finds no Entry point, reply in one line — `how: codebase mode, no Entry points found` plus the focus if there is one — and stop without writing a model. Never make one up to fill the panel.

For every Entry point, add its Element now with Evidence on its registration or definition line.

## 5. Order and status

Order the Behaviours: PR mode by risk (Contract change, then error-handling change, then fan-in), codebase mode by score. The first 7 get `status: "built"` and are built in step 6.

Every later Behaviour gets `status: "pending"`, its `id`, `name`, `entryPointId`, `rank` and `risks`, `level: "component"`, `elementIds: [<its Entry point>]`, and empty `steps`, `errorFlows` and `seamIds`. Its only Evidence is the Entry point Element's. The panel builds it when the reader opens it. A pending PR Behaviour built that way has no base, so all its Steps show as added.

`seamViews` starts as `{}`: every Seam view is built when the reader opens it.

## 6. Build the Behaviours

Dispatch one `how:behaviour-builder` subagent per Behaviour to build, all in a single message so they run in parallel (at most 7). Each returns its Behaviour in its final message; it writes no file. A builder runs in its own process and cannot see your `$TMPDIR`, scratchpad or shell variables, so write every value into its task itself, with absolute paths. Fill in this task for each:

```
Mode: initial build
Build the Behaviour <name> (id <id>) at the Entry point <entry point Element JSON>.
Behaviour model format (read it first and follow it exactly): <absolute path of references/behaviour-model.md>
Scope: <scope JSON>
Code to trace: <absolute repo path>
Behaviour skeleton (keep id, name, entryPointId, rank and risks): <Behaviour JSON>
Known Elements and Seams (reuse these ids): <[{ "id", "name" }, …] of the Elements and Seams found so far>
Changed hunks on this Behaviour (PR mode; put each in the `hunk` of the Evidence it changes): <hunks>
Reply with only the JSON object { "behaviour", "elements"?, "seams"? }.
```

Assemble the replies, as the only writer of the model:

- Each `behaviour` replaces its skeleton, with `status: "built"`.
- New `elements` and `seams` are added. Builders prefix the ids they mint with `<behaviourId>.`, yet two builders can still describe the same code: a newcomer is the same as a present one only when their Evidence `file` and `symbol` match, and then it takes the present id. Otherwise a newcomer whose id is taken gets a fresh id, and you rewrite every reference to it in its Behaviour (`entryPointId`, `elementIds`, Step `from`/`to`, `seamId`, `seamIds`, handler `elementId`, `parentId`).
- A builder whose reply is not that JSON object leaves its Behaviour with `status: "failed"`, its skeleton and Entry point Evidence; the reader can retry it from the panel.

**External Elements need Evidence too.** A caller, third-party service or datastore cites the code in the repo that receives or calls it: the route registration, the client call site, the query. An Element without Evidence is dropped by the Evidence check, and every Step touching it goes with it.

## 7. Base comparison (PR mode)

`baseBehaviours` holds each built Behaviour as it is at base, so the panel can show added, removed and changed Steps.

1. When `<git-common-dir>/how/<baseSha>.json` exists, take from it the Behaviours whose Entry point Element has the same `name`, and their Elements and Seams. Drop their Steps and error flows whose `diff` is `removed`, and set every other `diff` to `unchanged`.
2. Dispatch one `how:behaviour-builder` per remaining built Behaviour, in a single message, with the step 6 task plus:
   ```
   Base build: trace the code in <base worktree absolute path>, at commit <baseSha>. Evidence file paths stay repo-relative.
   Head Behaviour (re-trace only the Steps whose Evidence overlaps a hunk; copy every other Step verbatim): <head Behaviour JSON>
   ```
   The changed hunks line of the step 6 task carries that Behaviour's hunks. Skip Behaviours whose Entry point the PR adds; they have no base.
3. Once the base builders have replied, remove the base worktree (`git worktree remove --force <path>`), whether they succeeded or not.

Put the base Behaviours in `baseBehaviours` and their Elements and Seams into `elements` and `seams`: in PR mode `elements` is the union of the head and base Elements, so the removed Steps in `baseBehaviours` resolve. Leave every Step's `diff` as `"unchanged"`; `mcp__how__open` computes the diffs. Set each Seam's `isContractChanged` from whether a hunk changes its Contract.

## 8. Intent mismatches (PR mode)

Set the stated claims against the observed Behaviour changes and record each Intent mismatch with Evidence, as [references/intent.md](references/intent.md) says. In codebase mode, and when intent is missing, `intentMismatches` is `[]`.

## 9. Write, open and report

Write the whole model as one JSON object to the model path, with `version: 1` and every Evidence `status: "unchecked"` (or `"inferred"` for a link you reasoned rather than read). Call `mcp__how__open` with `{ "modelPath": <absolute model path> }`. When it answers an error, fix the file and call it again, at most twice; if it still fails, set the Behaviour the error names to `status: "failed"` with its skeleton and Entry point Evidence, and open once more.

The tool answers `<n> Behaviours, <d> elements dropped: …`. Reply to the user in at most 3 lines: the mode (and target), the Behaviour count, the dropped-element summary as the tool gave it, and that the how panel is open.
