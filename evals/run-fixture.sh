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

# Headless runs answer no permission prompts: allow only what the skill and its builders use, and deny the rest
# (dontAsk) rather than wait. Shell access is read-only git plus the base worktree, `printenv TMPDIR` and
# `mkdir -p` for the staging folder; `git -C` is allowed per read-only subcommand, and `-c` (git runs a program it
# names) is denied outright. Write is scoped through its Edit rules to the staging folder $TMPDIR/how, spelled as
# given and with symlinks resolved (an absolute path rule starts with //). The session never writes inside .git:
# mcp__how__open writes the cache, <git common dir>/how/<sha>.json, through the plugin's own file access.
tmp="${TMPDIR:-/tmp}"
tmp="${tmp%/}"
tmp_real=$(cd "$tmp" && pwd -P)
start=$(date +%s)
status=0
claude -p "/how HEAD~1..HEAD" --plugin-dir "$plugin" --max-budget-usd 5 --output-format json \
  --permission-mode dontAsk \
  --allowedTools Skill Read Grep Glob LSP Agent "Edit(/$tmp/how/**)" "Edit(/$tmp_real/how/**)" "Bash(printenv TMPDIR)" \
  "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git blame:*)" "Bash(git rev-parse:*)" \
  "Bash(git merge-base:*)" "Bash(git worktree:*)" "Bash(git status:*)" "Bash(git symbolic-ref:*)" \
  "Bash(git -C * rev-parse:*)" "Bash(git -C * log:*)" "Bash(git -C * show:*)" "Bash(git -C * diff:*)" \
  "Bash(git -C * blame:*)" "Bash(mkdir -p:*)" "mcp__how__*" \
  --disallowedTools "Bash(git * -c *)" \
  >"$out.out.json" || status=$?
end=$(date +%s)
echo "wall time: $((end - start))s; claude exit $status; output: $out.out.json"

sha=$(git rev-parse HEAD)
model="$(git rev-parse --path-format=absolute --git-common-dir)/how/$sha.json"
if [ ! -f "$model" ]; then
  # No cache: mcp__how__open never ran. The unverified model, if written, is in the staging folder.
  staged="$tmp/how/$sha.json"
  if [ ! -f "$staged" ]; then
    echo "no model at $model or $staged; the CLI answered:" >&2
    cat "$out.out.json" >&2
    exit 1
  fi
  echo "model not cached (mcp__how__open did not run); staged, unverified: $staged. Run evals/open-fixture.sh $name $n." >&2
  model=$staged
fi
cp "$model" "$out.model.json"
echo "model: $model"
node "$evals/score.mjs" "$out.model.json" "$fixture/expected.json"
