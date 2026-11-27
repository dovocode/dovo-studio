#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

for model in *.lean; do
  printf 'Checking %s\n' "$model"
  lean -DwarningAsError=true "$model"
done

generated=$(mktemp)
trap 'rm -f "$generated"' EXIT
check_cases() {
  local model=$1 fixture=$2
  lean -DwarningAsError=true --run "$model" > "$generated"
  if ! diff -u "$fixture" "$generated"; then
    printf 'Regenerate %s with lean --run %s from verification/.\n' "$fixture" "$model" >&2
    exit 1
  fi
}

check_cases ProviderRecovery.lean provider-recovery-cases.jsonl
check_cases ThreadHandoff.lean thread-handoff-cases.jsonl
check_cases ChatThreads.lean chat-thread-queue-cases.jsonl
check_cases RuntimeRegistry.lean runtime-registry-cases.jsonl
check_cases SendReceipts.lean send-receipt-cases.jsonl
check_cases RemoteMcp.lean remote-mcp-cases.jsonl
check_cases BotInvocation.lean bot-invocation-cases.jsonl
check_cases BotWorkflows.lean bot-workflows-cases.jsonl
