# Third reliability review, 20 November 2026

These findings came from the independent investigation during the fixes to the
[second review](./reliability-followup-2026-11-20.md). All reproductions used disposable data.

Fix the wrong-computer request and backup first. Then bind automation approvals and results to the
specific step the user reviewed or retried. For offline restore, preserve the live WAL until
publication commits. Each of these failures changed a different record than the user intended, or
changed the live workspace after reporting failure.

## Runtime restore and diagnostics

- **A failed offline restore can roll back the live database.** A fixture committed a new value in
  SQLite's write-ahead log and stopped the writer without a checkpoint. A fresh reader saw the new
  value. I injected a failure only at the final rename in the production restore function. Restore
  reported failure, but the live database now returned the old value. The pre-restore backup still
  contained the new value. The restore removes the live WAL before replacing the main file. Publish
  into the live database as a SQLite transaction under the runtime lock, as the release updater
  already does. Verify the live value, its backup and restart after an interrupted commit.
  [Offline restore](../packages/runtime/src/storage/backups.ts) ·
  [Updater restore](../apps/api/src/server-update-recovery.ts)
- **Project deletion can orphan a recoverable thread.** The runtime identified an unreadable task
  row whose metadata named the project. Deleting the project over HTTP returned 200. After restoring
  a readable status and restarting, the thread reappeared and still referenced the deleted project
  ID. Include preserved task rows in deletion preflight and fail without changing the project if
  ownership cannot be resolved.
  [Project deletion](../packages/runtime/src/scm/repositories/project-deletion.ts) ·
  [Durable task IDs](../packages/runtime/src/storage/workspace.ts)
- **Log rotation can drop the error that explains an update failure.** Using the actual rotator and
  an append-only file descriptor, I inserted a diagnostic line after the archive copy and before
  truncation. The active log ended at zero bytes, the archive contained 100 bytes and neither
  contained the line. The 100-byte threshold made the test small. Coordinate rotation with the
  writers, or switch them to a new file before retiring the old one. Check that concurrent rotation
  and writes preserve each line exactly once.
  [Rotator](../packages/runtime/src/storage/log-rotation.ts) ·
  [Update logging](../apps/api/src/server-update.ts)

## Desktop download history

- **Removing an old download can delete a different file.** I loaded a completed download, deleted
  its file and saved a new document at the same path. Removing the original download by ID deleted
  the new document. The store keeps a path, but no file identity. Check identity before removing the
  file and keep removing the history entry a separate action. Cover path reuse after restart,
  including an overwrite by a later download.
  [Download tracker](../apps/desktop/electron/browser-downloads.ts) ·
  [Download actions](../apps/desktop/electron/browser-extension-browser-apis.ts)
- **Looking up one download checks every file on disk.** With 10,000 valid history records,
  requesting one known ID performed 10,000 synchronous existence checks on each of nine runs. The
  median was 32 ms on local Linux storage. Use the existing ID map to narrow the candidates before
  checking disk. Exercise queries that actually filter on file existence as well. This test used the
  production store and a stub Electron session. It did not measure window frame times.
  [Download search](../apps/desktop/electron/browser-downloads.ts)

## Web workspaces and settings

- **One tab can show a different active computer from the one receiving its requests.** Two Chromium
  tabs used the real workspace provider and IndexedDB with stub runtime endpoints. Switching the
  first tab to computer B updated the second tab's active ID to B, but its connection and workspace
  stayed on A. A harmless POST from the second tab went to A. Apply remote selection changes through
  the same connection transition as a local switch, or keep selection local to each tab. Test the
  label, snapshot and actual destination together while requests are in flight. Native Electron uses
  the same subscription path by inspection.
  [Workspace provider](../packages/studio-core/src/workspace/provider.tsx)
- **Reload can save the wrong computer's recovery copy.** In a second two-tab run, holding B's reads
  and choosing Discard and reload in its tab fetched A's workspace and stored it under B's IndexedDB
  backup key. A's key had no backup. Bind the backup key and fetched snapshot to the same verified
  connection before applying either.
  [Workspace recovery](../packages/studio-core/src/workspace/provider.tsx)
- **Saving one service URL can erase another tab's change.** Tab A edited the Connect URL, then tab
  B saved the Artifacts URL. Tab A received the updated storage value but saved its old blank
  Artifacts field alongside its own edit. Track which fields the user edited and merge untouched
  fields from the latest stored record. Exercise a conflict on the same field separately.
  [Service URL form](../packages/extension-runtime/src/service-url-settings.tsx)

- **Losing a connection discards an unsaved setup command.** In Chromium, with All computers and All
  projects selected, I edited the Mac's setup command and disconnected the Mac. The form switched to
  an online Linux computer and mounted a fresh editor. Reconnecting the Mac did not restore the
  edit. There was no save or discard prompt. The same result occurred with the mobile components.
  Keep a dirty draft bound to its owner through disconnect and reconnect.
  [Owner selection](../packages/protocol/src/runtime/connection/scoped-settings.ts) ·
  [Desktop settings](../packages/studio-ui/src/settings-scope-page.tsx) ·
  [Mobile settings](../apps/mobile/src/runtime/preferences/settings-target.tsx)

- **A removed computer's settings page can send a change to a different computer.** The Chromium
  test opened Device previews with the Mac explicitly selected, then removed that saved computer.
  Enable Device Hub remained available and sent the mutation to the active replacement computer.
  When an explicitly requested owner disappears, show it as unavailable until the user selects
  another. [Computer settings](../packages/studio-ui/src/host-settings-page.tsx)
- **A disconnect discards a Device Hub SSH host draft.** In the desktop/web editor, entering a host
  name and reconnecting the same computer discarded the draft. The page had promised to retain
  unsaved edits. Refresh saved hosts independently of dirty fields. The mobile implementation
  preserves that draft on a refresh by inspection.
  [Desktop/web host editor](../packages/extension-runtime/src/device-hosts-view.tsx)

## Mobile task actions

- **A short iOS interruption clears an unread in-app notice.** A Chromium fixture rendered the
  mobile component with an approval pending on another computer. Its banner appeared. Sending the
  native state sequence `active → inactive → active` cleared the banner while the exact approval
  remained pending. The handler resets its queue and previous snapshot on `inactive`. Preserve the
  queue during the interruption and check whether its request is still pending on return.
  [In-app input notices](../apps/mobile/src/notifications/in-app-input.tsx)
- **Settle leaves a pending question that cannot be answered.** In a loopback runtime, settling a
  thread kept its nonblocking question pending. Answering returned 409 until Undo reopened the
  thread. Show the question as suspended while the thread is settled, or retire it when Settle
  commits. Test both the settled state and Undo with an outstanding question.
  [Task list actions](../packages/runtime/src/http/endpoints/task-list-action.ts)

On a disposable iPhone 17 simulator running iOS 27.0, the Release app paired with a local runtime.
Deny reached the runtime. Radio, checkbox and custom text answers survived backgrounding and a full
app restart. Submit sent the selected values and exact text, then removed the question. The native
accessibility tree exposed button roles, the text field label and the checked states. That build
preceded the final notification routing changes. VoiceOver speech and focus, Android TalkBack and
native PR line-comment recovery still need device tests. Device Hub had no Android target.

## Mobile sharing

- **Freeing storage does not recover an incoming share that exceeded its copy budget.** A harness
  using the real inbox code made the first file copy fail and then made storage available. After
  three more handoffs of that same item, there had been one copy attempt, zero acknowledgments and
  zero files in the draft. Offer a retry while the native inbox owns the original. Distinguish a
  temporary storage failure from a permanently invalid share.
  [Share intake](../apps/mobile/src/shell/shared-inbox.ts) ·
  [Task creation](../apps/mobile/src/tasks/creation/new-task.tsx)
- **A second damaged inbox entry can disappear from recovery.** The first unreadable entry was
  backed up and the readable entries survived. When another unreadable entry arrived later, the
  production recovery function rewrote the active inbox but kept only the first recovery copy. The
  second entry was absent from both copies. Archive each distinct damaged input before rewriting it.
  Both mobile checks used simulated storage and native handoffs.
  [Inbox recovery](../apps/mobile/src/shell/shared-inbox.ts)

## Server notifications

- **A short task can finish without a completion notification.** In a real workspace store with
  SQLite and a fake relay, a task went from draft to running to review between consecutive push
  flushes. It produced no completion send. Record the completion at the transition and use polling
  to deliver the recorded event. [Push capture](../packages/runtime/src/notifications/push.ts)
- **One unreadable registration can prevent delivery to a healthy device.** With two trusted
  devices, each flush rejected while decoding the damaged registration, before sending to the
  healthy one. Isolate decode errors per device and retain the original row for recovery.
  [Registration loading](../packages/runtime/src/notifications/push.ts)
- **An old test notification can unregister a renewed device.** A notification test began with token
  A. The device registered token B. When the relay rejected A, the test path removed B. Use the same
  conditional removal that normal outbox delivery already applies.
  [Notification test and delivery](../packages/runtime/src/notifications/push.ts)

## Automation recovery

- **A delayed approval can approve the next review step.** In an automation with two consecutive
  reviews, sending the same positive response twice advanced both. The request names the run but
  does not name the review step or its attempt. Bind the decision and its receipt to the displayed
  step and attempt. Test a delayed answer from another computer after the first step completes.
  [Review route](../packages/runtime/src/http/endpoints/jobs-routes.ts) ·
  [Review transitions](../packages/runtime/src/jobs/jobs.ts)
- **A terminal write failure can strand a fully completed job.** A temporary SQLite trigger refused
  the final status write after the steps and review had committed. After removing the fault, two
  scheduler ticks left the run marked running with no worker. Retry was unavailable and another run
  was blocked. Restart classified the completed run as failed. Recover finalization from its saved
  steps and record the outcome without rerunning them.
  [Run finalization](../packages/runtime/src/jobs/jobs.ts)
- **A scheduled one-time job can promise a retry it will never start.** A fake provider returned a
  pre-acceptance 529. The run showed a queued retry, but its one-time schedule had been consumed and
  disabled. The scheduler skipped the retry when due. Treat consumption of a schedule separately
  from cancellation of an accepted run. Test the due time and explicit cancellation.
  [Scheduling and retries](../packages/runtime/src/jobs/jobs.ts)
- **A maintenance lease can consume a one-time schedule.** A temporary SQLite runtime with a dummy
  task adapter ticked a due job while holding a maintenance lease. The scheduler recorded delivery,
  disabled the one-time trigger and failed the run with "Runtime is restarting." After release and
  another tick, the adapter still had zero starts. Defer admission until the lease ends.
  [Scheduler](../packages/runtime/src/jobs/jobs.ts) ·
  [Task admission](../packages/runtime/src/agents/tasks/tasks.ts)
- **Retry can pass an unrelated chat reply into an automation.** The original worker accepted its
  objective and failed. A human then asked another question in the same thread and received a
  successful reply. The job still showed failed. Retrying over HTTP marked its original step
  complete and passed the unrelated reply to the downstream step. Bind a step result to its original
  turn or execution ID. The test used a real local HTTP runtime, SQLite and a temporary Git
  repository with a fake agent. [Run recovery](../packages/runtime/src/jobs/run-state.ts)

## Verification

The focused regression run passed 324 tests. It used local runtimes, SQLite fault injection, and
provider fixtures. Chromium covered workspace recovery in two tabs, settings, and mobile picker and
notification controls. The runtime, desktop and web builds passed.

Expo exported Hermes bundles for iOS and Android from this checkout. The build hosts' DNS names
originally failed strict SSH verification. The names now use host keys obtained over their already
trusted NetBird connections.

Xcode 27.2 built the checkout in Release mode for an iOS 27.0 iPhone 17 Pro simulator. The installed
JavaScript bundle matched the build's SHA-256 hash. Dovo launched from Device Hub and displayed the
Threads screen with the first-run computer connection prompt. The test used a new simulator.

The Android `arm64-v8a` Release APK built on the MacBook. The copied APK matched the build's SHA-256
hash. Device Hub installed and launched it on a new Android 16 Pixel 7 emulator. Dovo displayed the
Threads screen and the same first-run connection prompt.

To repeat the bundle check, run these commands from the repository root.

```sh
pnpm --filter @dovo/mobile run prestart
pnpm --filter @dovo/mobile exec expo export --platform ios --platform android --max-workers 2 --output-dir /tmp/dovo-mobile-export
```
