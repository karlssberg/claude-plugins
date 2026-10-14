#!/usr/bin/env bash
# Runs the how producer on one fixture in a throwaway repo and scores the model it writes.
# Usage: evals/run-fixture.sh <fixture> <run number>   e.g. evals/run-fixture.sh http-orders 1
# Never makes a .git inside this repo: the fixture is copied to $TMPDIR/how-eval-<fixture>-<n>/.
set -euo pipefail

name=$1
n=$2
evals=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(dirname "$evals")
fixture="$evals/fixtures/$name"
work="${TMPDIR:-/tmp}/how-eval-$name-$n"

rm -rf "$work"
mkdir -p "$work"
cp -R "$fixture/repo/." "$work/"
cd "$work"
git init -q
git add -A
git -c user.name=how-eval -c user.email=how-eval@example.invalid commit -qm "base"
git apply "$fixture/pr.patch"
git add -A
git -c user.name=how-eval -c user.email=how-eval@example.invalid commit -qm "$(cat "$fixture/pr-message.txt")"

start=$(date +%s)
# Headless runs answer no permission prompts. The run is confined to the throwaway repo by the caller's sandbox.
claude -p "/how HEAD~1..HEAD" --plugin-dir "$plugin" --max-budget-usd 5 --output-format json \
  --permission-mode bypassPermissions \
  >"$work.out.json" || true
end=$(date +%s)
echo "wall time: $((end - start))s; output: $work.out.json"

model="$(git rev-parse --path-format=absolute --git-common-dir)/how/$(git rev-parse HEAD).json"
mkdir -p "$evals/results"
cp "$model" "$evals/results/$name.model.json"
cp "$work.out.json" "$evals/results/$name.out.json"
echo "model: $model"
node "$evals/score.mjs" "$evals/results/$name.model.json" "$fixture/expected.json" || true
