# Chat and terminal durability verification

These Lean models describe one thread identity and one terminal launch or tracked input request.
They use the same pinned toolchain as the [A2UI state model](a2ui-verification.md).

## Chat threads

[ChatThreads.lean](../verification/ChatThreads.lean) models draft creation, atomic admission, retry,
dequeue, deletion, and restart. It checks that a message ID is admitted at most once, a retry with
the same fingerprint leaves the thread unchanged, and a changed fingerprint cannot reuse the
recorded receipt. Dequeue leaves the receipt available. Deletion removes the live receipts and
queue, and the tombstone prevents a later start from restoring the thread. Replaying an
acknowledgement leaves the thread unchanged.

The model treats message fingerprints as opaque values and assumes that each queue admission and its
receipt commit together. In the runtime, queue admission checks the existing submission receipt, and
the SQLite workspace transaction saves both. Combined first-message creation also checks the
thread's creation fingerprint. Outer request receipt handling and provider execution remain separate
from this model. The admission guarantee is per message ID.
[Queue admission](../packages/runtime/src/agents/tasks/task-queue.ts) ·
[SQLite workspace transaction](../packages/runtime/src/storage/workspace.ts) ·
[Thread creation](../packages/runtime/src/http/endpoints/thread-start.ts)

Lean generates 32 cases with two submission orders, four queue changes, and four restart points
around the change and retries. The HTTP tests replay the original sends and try a conflicting
payload after a queue entry was kept, edited, removed, or moved. They check that each retry leaves
the newer draft, paused queue, and conversation intact.
[Queue receipt tests](../packages/runtime/src/http/endpoints/thread-start.test.ts)

## Turn completion

[ThreadLifecycle.lean](../verification/ThreadLifecycle.lean) follows an admitted input from its
queue through provider output, completion, saving and restart. The model uses a runtime and thread
address plus an attempt ID. A wrong address or a stale attempt leaves the destination unchanged.
Once the provider outcome is recorded, later callbacks cannot revise the reply or outcome.

Saving after a provider exit preserves queued input and recorded results. A failed save or restart
holds the recorded result for retry. A turn which needs no checkpoint can finish as soon as the
result can be saved. Once a save succeeds, an unpaused queue can start its next input. Retrying the
save keeps a paused queue held. The model covers FIFO starts and explicit recovery of an interrupted
turn. Send now, provider availability and automatic restart policy have separate implementation
checks.

A pending save blocks both a harness change and a move to another computer, even after restart. The
runtime checks this after stopping the current worker and before recording the handoff.

The runtime tests inject Git and SQLite failures. They exercise the retry action used by desktop,
web and mobile, and verify that a later turn writes its own reply even if the first provider emits
late output. [HTTP retry tests](../packages/runtime/src/http/endpoints/message-resume.test.ts) ·
[Runtime turn tests](../packages/runtime/src/agents/tasks/tasks.test.ts)

### Bend thread outcomes

The [Bend laws](../verification/thread/LAWS.bend) follow a first-message send with a lost reply and
a completed turn A with one eligible follow-up B. The send model assumes retries use the same
thread, message ID and payload. A matching receipt, a matching cached thread and a successful local
journal removal let the client clear its pending send and the server compact its receipt. Replaying
the send after compaction still produces one admission. The first-message HTTP tests exercise all
eight combinations of a lost reply, failed journal removal and lost compaction request across
restart.

| What happens after A's provider finishes                                                     | What the user can expect                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The worker can continue and the final diff read succeeds, immediately or on its single retry | A finishes saving. B starts once. Only the read is retried.                                                                                                                            |
| Both reads fail                                                                              | A's reply stays recorded and B stays queued. Retry saving keeps B paused. Resume queue starts B once the save succeeds. Another failed save keeps B paused.                            |
| The runtime stops after saving A, before claiming B                                          | Restart releases the previous worker's active-run ID and parks B, including when auto-continue is enabled. Replaying the original send keeps B parked. Explicit resume starts it once. |
| The runtime stops after dispatching B, before the provider acknowledges it                   | The journal records uncertain delivery. A stays saved, B remains in the transcript, and automatic recovery cannot send B a second time.                                                |

The queue model starts with A's reply recorded and its checkpoint captured. It treats read results
as inputs and successful finalization as atomic. A provider start in the history means dispatch. The
restart laws cover an unclaimed queue head and a dispatch awaiting acknowledgement. They hold
through any finite sequence of worker checks and restarts. Queue pause and resume are foreground
commands. Reissuing resume after a later pause expresses a new resume. Recovery of an acknowledged
provider session has its own runtime tests.

Git records the end of a turn in a dedicated ref for each primary or linked checkout. The first
successful publication fixes that checkout's tree for the turn. If the write reports a failure, the
runtime checks the ref before reporting a capture error. If SQLite still needs the tree after
restart, recovery uses the published ref even when the user has since edited the working directory.
The [checkpoint model](../verification/thread/Checkpoint.bend) covers the interval between Git
publication and the SQLite save.

The [HTTP tests](../packages/runtime/src/http/endpoints/message-resume.test.ts) hold the first
provider call open until the second message is queued, inject read failures and inspect A's saved
reply and checkpoint when the second provider call starts. The
[restart tests](../packages/runtime/src/agents/tasks/restart-recovery.test.ts) kill a separate
runtime process before claim and after dispatch, reopen the same SQLite database, and replay the
original send through HTTP. They use real Git and a test provider. The SIGKILL checks run on Linux
and macOS.

The restart suite also rejects the final SQLite write, edits a file while the runtime is stopped,
and verifies that Retry saving records the original Git tree. The linked-checkout suite interrupts
the diff read after publication and checks that a later edit stays out of the completed turn.

Run the model with Bend 2.0.40 and Lean 4.34.0 on PATH for Bend's proof kernel. The existing Lean
models use their own pin in `verification/lean-toolchain`.

```sh
bend verification/thread/PROOF.bend --verdict
pnpm exec vp test run packages/runtime/src/http/endpoints/{thread-start,message-resume}.test.ts packages/runtime/src/agents/tasks/restart-recovery.test.ts
pnpm exec vp test run packages/runtime/src/scm/tasks/linked-checkouts.test.ts
```

## File pages and quote drafts

The [file page laws](../verification/thread/FilePages.bend) check that a stale cursor or a changed
read requires refresh, that a page advances by consumed bytes, and that the last page has no next
cursor. The HTTP test reads a newline-free span across a UTF-8 boundary and then replaces the file
with another of the same size. It also checks formatted RTF and the original source.

The [quote draft laws](../verification/thread/QuoteDraft.bend) check cancellation followed by a late
transcript, and confirmation followed by repeated confirmation. The Chromium fixture opens the quote
dialog during main-composer dictation and checks cancellation. It also dictates a comment and adds
it to the saved selection.

```sh
bend verification/thread/PROOF.bend --verdict
pnpm prove -- packages/runtime/src/http/bounded-file-preview.test.ts
pnpm exec playwright install chromium
node scripts/check-project-file-preview-browser.mjs
node scripts/check-mobile-thread-files-browser.mjs
node scripts/check-dictation-browser.mjs
```

## Thread MCP sign-in

The [Bend sign-in model](../verification/thread/McpSignIn.bend) checks that a stale warning or a
connected server cannot start consent. A session that used an earlier connection cannot mark a newer
credential as expired. The [paired HTTP test](../packages/runtime/src/mcp-oauth/oauth.test.ts)
changes the server URL before clicking the warning, signs in with a real local provider, then checks
that an old session cannot reopen the warning after a new sign-in.

## Linked thread reads

The model checks the reader pairing, peer pairing, exact thread identity, and saved link generation
when the response arrives. The HTTP tests hold a successful peer response while one of those
conditions changes. They check that a fresh read succeeds after relinking while the old reply is
still held, and that reading works again after reconnecting. They also reject inconsistent thread
IDs and references. [Bend laws](../verification/thread/LinkedRead.bend) ·
[Paired HTTP tests](../packages/runtime/src/studio/subagents.test.ts)

## Agent tool replies

The Code mode tests hold an MCP tool reply while a run credential rotates, another run starts, the
thread is archived, or access is narrowed. A valid run receives the retained output reference. An
invalidated run receives an authorization error without the output or reference.
[Code mode tests](../packages/runtime/src/agent-tools/code-mode.test.ts)

The dispatcher tests a failed script with three calls already in flight. They release the replies in
all six possible orders. The result waits for all three outcomes and reports the two confirmed calls
and the call whose response was lost. Further cases let a pending call settle after the script fails
and check that its continuation cannot dispatch a follow-up.
[Dispatcher tests](../packages/runtime/src/agent-tools/code-dispatch.test.ts)

## First visible thread frame

`pnpm test:web-workbench-history:browser` runs the production web build against two loopback
runtimes that use the same thread ID. It records the time from the navigation key press to the first
animation frame where the owning computer's reply is visible, then confirms a frame has elapsed. It
prints a first switch and eight warm switches. The measurements are from headless Chromium and
include runtime selection, data delivery, and the conversation render.

## Automation admission

The [Bend admission laws](../verification/automation/LAWS.bend) model one occupied slot and the
first queued run. Cancellation holds the slot across scheduler ticks and restarts until the current
worker's exit has been confirmed. Observing the exit and dispatching starts the queued run once. The
model assumes one confirmed exit for the current worker and treats saving the admission as atomic.
The [HTTP regression](../packages/runtime/src/jobs/jobs.test.ts) checks a shared pool with limits of
two and one, FIFO selection, queued cancellation and retry receipts through a runtime restart backed
by SQLite.

The step pool model has one slot and a saved queue in step-arrival order. A paused request stays in
place while the next eligible step reserves the slot. After that step finishes, resuming the paused
request lets it dispatch once. A reservation can dispatch once after restart. A step that had
already begun dispatch enters interrupted recovery.
[Step pool laws](../verification/automation/StepPool.bend)

The runtime test reverses run creation and step arrival across two workflows. It checks that a
cancelling worker holds its slot until exit and that a request paused through HTTP stays queued
across SQLite restart, then creates one task when resumed.
[Automation runtime test](../packages/runtime/src/jobs/jobs.test.ts)

[Run control laws](../verification/automation/RunControl.bend) model a pause at a completed step,
clearing a pause request before that step ends, and fencing an old CI result across pause and
resume. They also model withdrawal of a pending question by its owning run. Runtime tests use the
HTTP controls, reopen the database, and hold a forge read open while pausing. A question test
cancels an automation at a review gate and tries to answer the withdrawn form. A form created by an
independent turn in the same thread remains available.

The [Bend review laws](../verification/automation/Review.bend) cover a required but missing reason,
a response for an older step attempt, and a changed decision after a result was saved. The HTTP test
exercises these cases, including replay of the saved decision after a restart.

```sh
BEND_NO_TELEMETRY=1 bend verification/automation/PROOF.bend --verdict
```

## Queue restore, offline sends, and model changes

[ChatRecovery.lean](../verification/ChatRecovery.lean) checks three related boundaries.

- A recorded restore leaves the current queue and composer unchanged when retried. A fresh restore
  checks the queued message and observed draft settings. A populated composer keeps its model
  settings. A client that omits either Plan value cannot change the composer's Plan mode. A
  successful restore appends the text, removes the queued item, and bounds the merged attachments.
- A combined thread start can leave the local outbox after the matching message is cached. A missing
  thread requires a cached snapshot from the acknowledged runtime instance at or beyond its
  revision, with enough paging information to establish absence. The mobile runtime writes the
  snapshot to its cache before asking the outbox to settle it.
- Editing a queued choice leaves the active model and the thread's default model unchanged. A
  compatible queued model becomes the default when its turn starts. Compatibility is an input to the
  model. The runtime checks the provider and installation configuration.

The restore proof models one queued item and one restore request, with normalized text blocks and
opaque settings and fingerprints. It assumes the queue, draft and receipt commit together. The
outbox proof treats paging completeness and the cache write result as explicit inputs. The model
switching proof covers queued model selection. The runtime tests cover the separate harness handoff
path and its check for new input after pausing the old worker.

[Queue restore and model adoption](../packages/runtime/src/agents/tasks/task-queue.ts) ·
[Outbox settlement](../packages/protocol/src/runtime/connection/mutations.ts) ·
[Mobile cache write](../apps/mobile/src/runtime/connection/provider.tsx) ·
[Harness handoff tests](../packages/runtime/src/http/thread-handoff.test.ts)

Run the mobile draft storage checks and browser fixtures from the repository root:

```sh
pnpm exec vp test apps/mobile/src/tasks/draft/storage.test.ts packages/protocol/src/runtime/connection/mutations.test.ts
pnpm exec playwright install chromium
pnpm test:mobile-queue-restore:browser
pnpm test:mobile-models:browser
node scripts/check-mobile-thread-start-browser.mjs
```

These browser fixtures exercise the mobile React components with mocked native controls and
transport. The storage tests inject native write failures. A current installed build and a paired
test runtime are needed to exercise this recovery path on a simulator or phone.

## Notification taps

If the app opens a thread and Expo fails to clear that notification tap, the app saves the pending
clear on the device. It retries when the tap is delivered again, navigation becomes ready, or the
app comes to the foreground. A saved pending clear retries after relaunch without opening the thread
again. If Expo holds a newer tap, the retry leaves it intact.

## Mobile offline cache

[OfflineCache.lean](../verification/OfflineCache.lean) models staging a file, retaining the last
committed copy, publishing the replacement and removing the backup. A crash before publication
leaves the previous value readable. A crash after publication leaves the new value readable even
when the old backup is still present. Deletion removes the backup first so it cannot reappear after
the published file is removed. An incomplete replacement also falls back to the last committed
value. The model starts with a readable committed file or backup and treats each complete value as
opaque.

The storage test injects an Expo move failure during publication and creates a new cache instance to
check offline recovery. It also checks replacement after recovery and forgetting the computer while
a backup exists. [Mobile cache tests](../apps/mobile/src/runtime/connection/read-cache.test.ts)

## Handoff and backup restore

[ThreadHandoff.lean](../verification/ThreadHandoff.lean) checks that the source and destination
cannot both execute for one transfer ID. It also checks that a discarded destination stays
discarded. The model assumes same-runtime restore preserves the durable ownership decisions and that
a retry must block the source again before staging after cancellation. An older backup may omit a
thread. A present thread still needs ownership to execute.

The restore model checks how current records are applied to the restored task rows. A current source
fence replaces even a different, older transfer ID. A stale moved projection clears after ownership
has returned. A destination can activate a restored staged thread only when the activation record
matches both the transfer ID and the task ID. A discard takes precedence over the backup receipt.

The SQLite conformance test applies the 17 generated cases to the runtime's backup merge and startup
reconciliation. It checks the saved fence or receipt and the resulting thread state on two
successive startups.
[SQLite conformance test](../packages/runtime/src/scm/repositories/project-transfer-ownership-model.test.ts)

TLC checks at most one executable copy for one source thread and two transfer IDs. The model
separates saving a source fence, sending activation, and applying activation on the destination. A
discard receipt can be applied repeatedly. Startup uses the source fence to reconcile the saved
thread state. Disabling the transfer ID check when clearing the fence lets an old discard clear a
newer move. TLC traces how both copies can execute after restart.
[Handoff.tla](../verification/tla/Handoff.tla)

The HTTP regression repeats Cancel for the first move after the second move completes, restarts the
source, and checks that the source still rejects thread execution.
[HTTP regression](../packages/runtime/src/scm/repositories/project-transfers.test.ts)

[Thread handoff and restore behavior](thread-handoffs.md)

## Replication repair replay

The TLA+ model replays a repaired record in a three-page journal that the receiver already
acknowledged. It covers peers with and without repair generation receipts and allows up to two
connection interruptions. TLC checks that the receiver has the repair before certifying the replay
or reporting completion, and that the exchange settles when delivery, replies, and reconnection can
progress. Resuming replay from the old acknowledgement skips the repaired page and violates the
receipt invariant. [RepairReplay.tla](../verification/tla/RepairReplay.tla)

The runtime suite exercises repair delivery to a caught-up peer through the replication protocol.
[Replication tests](../packages/durable-connections/src/state.test.ts)

## Provider actions after restart

[ProviderRecovery.lean](../verification/ProviderRecovery.lean) checks that journal recovery is
idempotent, preserves local checkpoint states, and turns a dispatched provider action into durable
uncertainty. A matching uncertain action blocks automatic recovery regardless of the queue state.
With an active attempt ID, the check stays scoped to that attempt. An interrupted legacy thread
without an attempt ID checks every action for the thread.

The model emits 30 cases, including all combinations of action kind and journal status. The
[SQLite conformance test](../packages/runtime/src/storage/provider-recovery-model.test.ts) loads
those cases through workspace startup and checks the recovered journal, the automatic-recovery flag,
and preservation of queued work. The flag is eligibility for automatic recovery. Preferences and
provider availability are checked later. The separate process-kill test exercises dispatch.

## Concurrent computer and pairing edits

[RuntimeRegistry.lean](../verification/RuntimeRegistry.lean) checks the three-way merge used by
desktop and web. It compares the saved registry, the old value the window read, and the intended
update. Disjoint profile edits survive together. A conflicting profile or pairing edit rejects the
whole update. Repeating an accepted edit preserves its result, and a saved active selection always
references an existing computer.

The model checks two computer identities and treats each profile and the pending-pairing list as
opaque values. It generates 61 cases, including every combination of a missing value and two
versions for a profile and for a pending pairing. The TypeScript test uses the generated results
against the production merge. Address normalization, uniqueness, IndexedDB transaction behavior and
encrypted Electron writes have separate tests. The shared-storage browser test also checks that an
IndexedDB conflict in one tab cannot commit part of a registry edit from the other tab.
[Registry tests](../packages/studio-core/src/workspace/runtime-registry.test.ts) ·
[Electron storage tests](../apps/desktop/electron/connection-storage.test.ts)

## Connection changes and PR overview pages

[ConnectionBoundaries.lean](../verification/ConnectionBoundaries.lean) checks that changing a
pairing invalidates reads, writes, and deletion requests made with its old cache generation. A
closed handle cannot clear a renewed pairing, even when the two pairings use the same credential.
The native storage fixtures hold an old deletion open while a new pairing queues its first cache
write. The new write waits for deletion and survives it. Browser storage also checks the saved
generation and allowed credential in its IndexedDB transaction.

The same model checks the order used to merge pages from one PR source. An earlier matching row
takes precedence. If it is absent, lookup continues on the later page. The overview regression test
gives duplicate rows different titles and check states and verifies the earlier row wins.

## Lost send replies and receipt cleanup

[SendReceipts.lean](../verification/SendReceipts.lean) models a committed thread start and its
receipt. The client keeps the saved send until it has the accepted result, a cached thread, and a
successful journal removal. The server can then compact the result while keeping the action ID.
Replaying either the full receipt or the compact record cannot admit the message again.

Eight generated cases exercise the normal client send queue and the server's authenticated HTTP
endpoints against a disposable SQLite database. They vary a lost reply, a failed client journal
removal, and a lost compaction request across a server restart. The client storage uses a fixture
and the server uses a test provider.

## Terminal durability

[TerminalDurability.lean](../verification/TerminalDurability.lean) checks that recovery of a single
launch issues at most one create request. After a lost reply, recovery can attach to the held
process with the same identity or find it missing. For a single tracked input invocation, it checks
at most one dispatch and that uncertainty survives reconnect. A lost reply leaves delivery unknown.
The model permits that the holder already received the input.

The raw output model checks that a retained cursor resumes at the requested offset. A cursor outside
the window starts at the first retained offset, and the replay length stays within that window's
bound. This is the holder's raw UTF-16 offset calculation. Screen rendering, holder survival,
operating-system persistence, and explicit new sends after an uncertain outcome have their own
runtime behavior. [Holder client](../packages/runtime/src/terminal/holder-client.ts) ·
[Raw replay buffer](../packages/runtime/src/terminal/holder-protocol.ts)

When the first read's end cursor is still retained, the next read starts there and the two segment
lengths add up to the full range. The theorem applies to raw replay offsets across reconnect.

## Run the checks

With Elan on PATH, run the models and check the generated cases from the repository root:

```sh
bash verification/check.sh
```

The `lean` job in the Check workflow runs the same command with the pinned toolchain. When changing
an executable model, regenerate its cases and run the related implementation test.

```sh
(cd verification && lean -DwarningAsError=true --run ChatThreads.lean > chat-thread-queue-cases.jsonl)
pnpm exec vp test packages/runtime/src/http/endpoints/thread-start.test.ts
(cd verification && lean -DwarningAsError=true --run ProviderRecovery.lean > provider-recovery-cases.jsonl)
pnpm exec vp test packages/runtime/src/storage/provider-recovery-model.test.ts
(cd verification && lean -DwarningAsError=true --run ThreadHandoff.lean > thread-handoff-cases.jsonl)
pnpm exec vp test packages/runtime/src/scm/repositories/project-transfer-ownership-model.test.ts
(cd verification && lean -DwarningAsError=true --run RuntimeRegistry.lean > runtime-registry-cases.jsonl)
pnpm exec vp test packages/studio-core/src/workspace/runtime-registry.test.ts
(cd verification && lean -DwarningAsError=true --run SendReceipts.lean > send-receipt-cases.jsonl)
pnpm exec vp test packages/runtime/src/http/endpoints/thread-start.test.ts
```

With Java 21 on PATH, run TLC with the same TLA+ tools v1.7.4 used by the `tla` job.

```sh
curl -fsSL -o /tmp/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
bash verification/tla/check.sh /tmp/tla2tools.jar
```

The script runs each bounded model and prints a counterexample from its intentionally weakened
configuration. It fails if a normal configuration reports an error or a weakened configuration fails
to violate the expected invariant.

Exercise the implementation from the repository root:

```sh
pnpm exec vp test packages/runtime/src/http/endpoints/thread-start.test.ts packages/runtime/src/http/endpoints/message-resume.test.ts packages/runtime/src/terminal/holder.test.ts packages/runtime/src/terminal/terminal-holder.test.ts
pnpm exec vp test apps/mobile/src/notifications/response-consumer.test.ts packages/runtime/src/storage/attachments.test.ts packages/runtime/src/scm/repositories/project-transfers.test.ts packages/runtime/src/agents/tasks/restart-recovery.test.ts
pnpm test:terminal-restart
```

The chat tests use SQLite and a mocked agent provider. The terminal restart script uses a real PTY
and sends SIGTERM and SIGKILL to the test runtime while the holder stays alive. The holder tests
also cover missing holders and lost input replies. The Lean proofs apply to the stated models. The
steer recovery test sends an authenticated HTTP request to a separate runtime process and kills it
inside the provider callback before acknowledgement. It checks that the restarted runtime keeps the
instruction queued and records the dispatch as uncertain.

The attachment test commits a detached upload, restarts the server, and retries the commit with its
original draft guard. The retry returns the saved receipt and leaves one copy in the draft. After
the attachment is removed, the same retry refuses to add it to the edited draft. The mobile
attachment browser fixture exercises recovery controls with mocked native storage and transport.
