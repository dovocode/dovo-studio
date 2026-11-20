# App reliability review, 20 November 2026

The tables record the failures found in the first review. The implementation and verification
results follow the tables. The [follow-up review](./reliability-followup-2026-11-20.md) tracks new
findings, including permission requests and questions.

## Data loss and unintended changes

| Area                                  | Failure and evidence                                                                                                                                                                                                                                                                                                                                                                                 | Fix to verify                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox cleanup                       | Startup cleanup can delete private sandbox files when the runtime cannot read their task. An isolated test kept the durable task row while the cleanup service removed a real file in a temporary sandbox directory. The test used a controlled container CLI. [Task lookup](../packages/runtime/src/services.ts) · [Sandbox retention](../packages/runtime/src/sandbox/sandboxes.ts)                | Check whether the durable task still exists before removing its container or files. Exercise cleanup again after an explicit deletion.                            |
| Attachment cleanup                    | An isolated SQLite test loaded a task with an unknown status. The runtime preserved its row but left it out of the active workspace. Cleanup then deleted an acknowledged draft attachment. Reading it after restoring a compatible task returned 404. [Attachment cleanup](../packages/runtime/src/storage/attachments.ts) · [Task loading](../packages/runtime/src/storage/workspace-documents.ts) | Protect files owned by preserved tasks until their references can be read or the task is explicitly deleted. Test both draft and queued files.                    |
| Spending limits and other preferences | A test injected a receipt-write failure after a phone saved a limit of 100. A desktop then saved 10. Retrying the original phone request restored 100. The settings write and the mutation receipt commit separately. [Preferences route](../packages/runtime/src/http/routes.ts) · [Mutation receipts](../packages/runtime/src/storage/mutation-receipts.ts)                                        | Record an applied settings revision. Recover the outcome of the old save without writing over a newer revision. Test with two devices and an interrupted receipt. |
| Queue restore                         | An in-memory queue test enabled Plan on an empty draft after another client had prepared a restore. The restore succeeded and cleared Plan. The saved comparison covers text, attachments and model settings, but omits Plan on both the draft and the queued message. [Queue restore](../packages/runtime/src/agents/tasks/task-queue.ts)                                                           | Compare both Plan values before removing the queued message. On conflict, retain the message and the draft.                                                       |
| Mobile editor drafts                  | Source inspection found PR line comments and issue forms stored in an in-memory map. An app process restart discards unsent text. The thread composer already uses durable storage. [Draft store](../apps/mobile/src/runtime/state/detail-drafts.ts) · [PR comments](../apps/mobile/src/scm/pulls/detail/line-comment.tsx)                                                                           | Persist dirty text under the existing computer, account and entity scope. Test OS termination before submit and verify that submitting clears only that draft.    |

## Startup, shutdown and account recovery

| Area             | Failure and evidence                                                                                                                                                                                                                                                                                                                                            | Fix to verify                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox startup  | Startup resumes tasks while sandbox cleanup runs. A test with the actual sandbox service and a controlled container CLI admitted a new lease during cleanup. Cleanup stopped that container, but the service still returned it as current. [Startup](../packages/runtime/src/index.ts) · [Sandbox reconciliation](../packages/runtime/src/sandbox/sandboxes.ts) | Finish startup cleanup before admitting a sandbox lease. Keep unrelated runtime work available. Verify against Docker as well as the controlled CLI. |
| Connect shutdown | A local signaling host connected and received its ready message. Closing the HTTP server waited for the host to disconnect. WebSocket cleanup itself waits for the server's close event. [Server shutdown](../apps/connect-server/src/main.ts) · [Signaling lifecycle](../apps/connect-server/src/peer-signaling.ts)                                            | Stop accepting signaling sessions and close active sockets before waiting for the server to close. Test with a healthy host that stays connected.    |
| Account deletion | With an unavailable Auth service, Connect recorded a deletion and blocked new sign-ins. After the original session expired, a test restored Auth and retried. The retry returned 401 and the account row remained. [Deletion endpoint](../apps/connect-server/src/account-api.ts) · [Session store](../apps/connect-server/src/store.ts)                        | Persist the pending deletion and let Connect finish it after Auth recovers. Test a server restart and session expiry during the outage.              |
| Provider hooks   | A temporary malformed Codex hook file stopped the entire terminal integration installer. Claude and Pi were both absent afterward. The shell still starts, but it misses the integration environment. [Installation](../packages/runtime/src/terminal/recovery-integrations.ts) · [Terminal environment](../packages/runtime/src/terminal/recovery.ts)          | Install each provider independently. Preserve the malformed file and report the error for that provider.                                             |

## Sync, notifications and unattended work

| Area                       | Failure and evidence                                                                                                                                                                                                                                                                                                                                                                                   | Fix to verify                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings on older runtimes | A real sync controller received a changed settings snapshot after its first exchange. With no local edits, it made no second request over seven poll intervals. Desktop or mobile can keep stale settings. [Shared sync](../packages/protocol/src/runtime/connection/shared-state-sync.ts)                                                                                                             | Fetch when the remote revision changes. Mark it received only after applying the response.                                                               |
| iOS interruptions          | Source inspection found that entering the inactive state stops the selected computer's live sync. Returning to active starts a new overview poll for every other paired computer when automatic refresh is enabled, including on reduced cellular refresh. A Face ID prompt or Control Center can cause this transition. [Connection provider](../apps/mobile/src/runtime/connection/provider.tsx)     | Distinguish inactive from background when managing connections. Keep draft flushing independent. Measure requests on a device with two paired computers. |
| Automation history         | Source inspection found that unchanged-source detection requires a previous successful run. Cleanup removes run history after 30 days. A monitor that next runs after cleanup can invoke its agent again with the same input. [Monitor and retention](../packages/runtime/src/jobs/jobs.ts)                                                                                                            | Keep the last monitor outcome with its source fingerprint. Test an unchanged source after retention expires and a changed source after a failed run.     |
| GitHub PR readiness        | Source inspection found that the watcher accepts missing review decisions and missing thread resolution. Its feedback request omits those fields. Green CI can therefore produce a readiness notification while changes are requested. Merge stays manual. [Readiness check](../packages/runtime/src/scm/tasks/pull-request-watch.ts) · [Feedback request](../packages/runtime/src/scm/pulls/pulls.ts) | Require known review state for a readiness notification. Test requested changes, an unresolved thread, and unavailable review data.                      |

## Implementation and verification

- The runtime keeps attachments and sandbox files owned by unreadable tasks. For older workspaces,
  it recovers affected task IDs from the version 1 migration backup. Startup finishes sandbox
  reconciliation before granting a new lease. Shutdown waits for cleanup to finish. A local Docker
  and SQLite test recovered two attachment payloads through migration and restart, kept private
  files until explicit deletion, and left a separate runtime's container running.
- Preference saves record the mutation identity with the settings revision. A retry after a lost
  receipt preserves a newer spending limit. An ambiguous legacy receipt fails safely. On updated
  runtimes, queue restore compares Plan on both the queued message and the current draft. An older
  runtime still needs an update for this protection. The regressions cover desktop, web and mobile
  callers, including a restore without a preparation ID.
- The mobile app saves ordinary PR, issue, commit, file, side chat, Bot and action card drafts in
  device storage. On startup, a default host, destination or pipeline yields to the saved draft. An
  edit to one field preserves the other saved fields. A failed write keeps the text in memory and
  offers Retry. Secret fields stay out of storage. A temporary iOS inactive transition keeps sync
  running. The desktop and mobile sync controller fetches a newer settings revision from an older
  runtime without waiting for a local edit.
- Connect closes live signaling sockets before waiting for its HTTP server. A loopback test sent
  SIGTERM to the built server with a healthy signaling host connected. The server exited with code
  zero in 87 ms. Connect also persists incomplete account deletions and retries after Auth recovers,
  including after restart and session expiry. An upgraded Connect also recovers pending work
  recorded during a rollback. Clients require an explicit durable-deletion response before telling
  the user that deletion will finish without another request.
- Monitors retain the last outcome with the source fingerprint after run history expires. The PR
  watcher withholds a readiness notification when review data is missing or threads are unresolved.
  Provider hook setup reports a malformed configuration and continues installing the other hooks.

The provider and GitHub regression checks used fixtures. The account checks used local Connect
servers and simulated Auth outages. The mobile browser check rendered the editor with test storage.
A later Release build on a disposable iPhone 17 simulator verified the native draft store. After
entering text in New Bot's First task field, terminating the app and opening New Bot in a new
process, the field contained the exact saved text. The test did not create a Bot. Native PR comment
recovery, physical-device interruption traffic and production services remain unverified.

The queue Plan, monitor, PR readiness and hook regression cases failed on the comparison commit and
passed with the fixes. Some Connect and mobile tests depend on packages or helpers absent from that
commit. For those cases, verification used a separately built base, isolated reversions, or a
browser check against the older source. Ten pull-cache cases timed out both with and without the PR
watcher changes.

Run these browser checks from the repository root.

```sh
pnpm exec playwright install chromium
pnpm test:stability-recovery:browser
pnpm test:prompt-queue:browser
pnpm test:mobile-queue-restore:browser
```
