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

[Thread handoff and restore behavior](thread-handoffs.md)

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
an executable model, regenerate its cases and run the related implementation test:

```sh
(cd verification && lean -DwarningAsError=true --run ProviderRecovery.lean > provider-recovery-cases.jsonl)
pnpm exec vp test packages/runtime/src/storage/provider-recovery-model.test.ts
(cd verification && lean -DwarningAsError=true --run RuntimeRegistry.lean > runtime-registry-cases.jsonl)
pnpm exec vp test packages/studio-core/src/workspace/runtime-registry.test.ts
(cd verification && lean -DwarningAsError=true --run SendReceipts.lean > send-receipt-cases.jsonl)
pnpm exec vp test packages/runtime/src/http/endpoints/thread-start.test.ts
```

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
