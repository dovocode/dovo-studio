#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f $1 ]]; then
  printf 'Usage: %s <path to tla2tools.jar>\n' "$0" >&2
  exit 1
fi
jar="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

run_model() {
  local model=$1 config=$2
  java -XX:+UseParallelGC -Xmx512m -jar "$jar" -workers 1 \
    -metadir "$scratch/$config" -config "$config.cfg" "$model"
}

expect_violation() {
  local model=$1 config=$2 invariant=$3 status=0
  local log="$scratch/$config.log"
  run_model "$model" "$config" > "$log" 2>&1 || status=$?
  # TLC uses exit code 12 for a safety violation.
  if [[ $status -ne 12 ]] || ! grep -Fq "Invariant $invariant is violated." "$log"; then
    printf 'Expected %s to violate %s (TLC exit %s).\n' "$config" "$invariant" "$status" >&2
    cat "$log" >&2
    exit 1
  fi
  printf '%s counterexample:\n' "$config"
  cat "$log"
}

run_model Handoff Handoff
expect_violation Handoff HandoffWithoutTransferCheck OneExecutor
run_model RepairReplay RepairReplay
expect_violation RepairReplay RepairReplayWithOldCursor SoundReceipt
