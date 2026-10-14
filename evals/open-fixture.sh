#!/usr/bin/env bash
# Loads the model a run wrote through mcp__how__open (Evidence check, write-back), then scores the verified model.
# Usage: evals/open-fixture.sh <fixture> <run number>
# Needed only where the producer's own session could not register the plugin's tools: $.tool.register binds a
# local port, so a sandbox without sandbox.network.allowLocalBinding refuses it and mcp__how__open never exists.
set -euo pipefail

name=$1
n=$2
evals=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(cd "$evals/../plugins/how" && pwd -P)
work="${TMPDIR:-/tmp}/how-eval-$name-$n"
out="$evals/results/$name.run$n"
cd "$work"
model="$(git rev-parse --path-format=absolute --git-common-dir)/how/$(git rev-parse HEAD).json"

claude -p "Call the tool mcp__how__open with {\"modelPath\": \"$model\"}. Then reply with only its result text, verbatim, or the exact error it returned." \
  --plugin-dir "$plugin" --model haiku --max-budget-usd 0.5 --output-format json \
  --permission-mode dontAsk --allowedTools mcp__how__open \
  >"$out.open.out.json"
node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("mcp__how__open:", o.result)' \
  "$out.open.out.json"
cp "$model" "$out.model.json"
node "$evals/score.mjs" "$out.model.json" "$evals/fixtures/$name/expected.json"
