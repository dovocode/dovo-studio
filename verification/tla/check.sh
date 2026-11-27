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
run_model BrowserPreview BrowserPreview
expect_violation BrowserPreview BrowserPreviewWithOpenerLifetime PromotedTabRemainsOpen
run_model PreviewCleanup PreviewCleanup
expect_violation PreviewCleanup PreviewCleanupWithStaleCandidates RetainedTabStaysOpen
run_model ThreadLifecycle ThreadLifecycle
expect_violation ThreadLifecycle ThreadLifecycleWithStaleAttempt OnlyCurrentAttemptCanFinish
expect_violation ThreadLifecycle ThreadLifecycleWithStaleArchive AutomaticArchiveRequiresCurrentEligibility
expect_violation ThreadLifecycle ThreadLifecycleWithStaleWorktreeOwner WorktreeRemovalRequiresArchivedOrDeletedOwner
expect_violation ThreadLifecycle ThreadLifecycleWithoutWorktreeReservation WorktreeRemovalRequiresArchivedOrDeletedOwner
run_model ThreadStart ThreadStart
expect_violation ThreadStart ThreadStartWithoutAtomicBootstrap RootStartIsAtomic
expect_violation ThreadStart ThreadStartWithStaleSideParent SideCreationRequiresAvailableParent
expect_violation ThreadStart ThreadStartWithStaleDelegation ChildStartsUnderItsOwnParentRun
expect_violation ThreadStart ThreadStartWithoutInputDeduplication FirstInputAcceptedAtMostOnce
expect_violation ThreadStart ThreadStartWithStaleForkSource ForkCreationRequiresAvailableSource
expect_violation ThreadStart ThreadStartWithoutForkTombstone DeletedForkStaysDeleted
expect_violation ThreadStart ThreadStartWithStaleSidePermission SideStartRespectsCurrentPermission
run_model ThreadModelSwitch ThreadModelSwitch
expect_violation ThreadModelSwitch ThreadModelSwitchWithEarlyPromotion ModelChangesAtAdmission
expect_violation ThreadModelSwitch ThreadModelSwitchWithStaleDiscovery DiscoveryRequiresCurrentInputs
expect_violation ThreadModelSwitch ThreadModelSwitchWithoutRetirement SwitchRequiresRetiredWorker
run_model MobileThread MobileThread
expect_violation MobileThread MobileThreadWithActiveComputer DeliveryTargetsOwner
expect_violation MobileThread MobileThreadWithTextOnlyForkClear ForkReplyPreservesEditedDraft
expect_violation MobileThread MobileThreadWithUnscopedHistory CachedHistoryStaysInScope
expect_violation MobileThread MobileThreadWithoutRestoreReceipt RestoreAppendsOnce
expect_violation MobileThread MobileThreadWithStaleAnswerReply AnswerReplyPreservesEditedDraft
run_model RemoteConnection RemoteConnection
expect_violation RemoteConnection RemoteConnectionWithStaleEndpoint OnlyCurrentEndpoint
expect_violation RemoteConnection RemoteConnectionWithUnverifiedAlternate CredentialsUseVerifiedRoutes
expect_violation RemoteConnection RemoteConnectionWithWriteReplay TransportDoesNotReplayWrites
expect_violation RemoteConnection RemoteConnectionWithStaleTunnel OnlyCurrentTunnelPublishes
