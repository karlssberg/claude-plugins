#!/usr/bin/env bash
# Runs the how producer on one fixture in a throwaway repo and scores the model it writes.
# Usage: evals/run-fixture.sh <fixture> <run number>   e.g. evals/run-fixture.sh http-orders 1
# Never makes a .git inside this repo: the fixture is copied to $TMPDIR/how-eval-<fixture>-<n>/.
set -euo pipefail

name=$1
n=$2
evals=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(cd "$evals/../plugins/how" && pwd -P)
fixture="$evals/fixtures/$name"
work="${TMPDIR:-/tmp}/how-eval-$name-$n"
out="$evals/results/$name.run$n"

rm -rf "$work"
mkdir -p "$work" "$evals/results"
cp -R "$fixture/repo/." "$work/"
cd "$work"
git init -q
git add -A
git -c user.name=how-eval -c user.email=how-eval@example.invalid commit -qm "base"
git apply "$fixture/pr.patch"
git add -A
git -c user.name=how-eval -c user.email=how-eval@example.invalid commit -qm "$(cat "$fixture/pr-message.txt")"

# Headless runs answer no permission prompts: allow only what the skill and its builders use, and deny the
# rest (dontAsk) rather than wait. The skill's own shell commands are git, mkdir -p and pwd -P (worktree path).
start=$(date +%s)
status=0
claude -p "/how HEAD~1..HEAD" --plugin-dir "$plugin" --max-budget-usd 5 --output-format json \
  --permission-mode dontAsk \
  --allowedTools Skill Read Grep Glob LSP Write Agent \
  "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git blame:*)" "Bash(git rev-parse:*)" \
  "Bash(git merge-base:*)" "Bash(git worktree:*)" "Bash(git status:*)" "Bash(git symbolic-ref:*)" \
  "Bash(git -C:*)" "Bash(mkdir -p:*)" "Bash(pwd:*)" "mcp__how__*" \
  >"$out.out.json" || status=$?
end=$(date +%s)
echo "wall time: $((end - start))s; claude exit $status; output: $out.out.json"

model="$(git rev-parse --path-format=absolute --git-common-dir)/how/$(git rev-parse HEAD).json"
if [ ! -f "$model" ]; then
  echo "no model at $model; the CLI answered:" >&2
  cat "$out.out.json" >&2
  exit 1
fi
cp "$model" "$out.model.json"
echo "model: $model"
node "$evals/score.mjs" "$out.model.json" "$fixture/expected.json"
