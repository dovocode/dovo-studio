# Stability audit — second discovery round

Started: 2026-10-29; consolidated: 2026-10-30 (Europe/Amsterdam). Baseline: `f4cca6d1`, reviewed
alongside the uncommitted first-round fixes.

This round examines additional areas: Git/checkpoints/worktrees, browser isolation and downloads,
artifacts and previews, mobile persistence and uploads, secrets and diagnostics, search and database
lifecycle, GitHub integration, and distribution/updates. The team consists of three Sol 6.1, three
Terra 6.1, and two Claude Fable 5.1 reviewers, with parent review and selected independent probes.

New findings below are research, not implemented changes. Previously authorized first-round fixes
are tracked separately at the end. No production database, account, project, or updater was used for
fault injection. HTTP LAN/VPN connections, pairing codes, and device tokens remain requirements.

Priority: P1 means potential loss of recovery state or conflicting filesystem mutations; P2 means a
bounded reliability or presentation defect. Evidence is stated per finding; source review alone is
not a device reproduction or proof of exploitation.

## Highest-priority new findings

### G1 — Handoff can remove another operation's stash entry

- Priority: P1. Evidence: reproduced with a disposable Git repository.
- Source: [task-handoff.ts](../packages/runtime/src/scm/tasks/task-handoff.ts), `applyStash`.
- Sequence: apply the intended stash by commit ID; list stash hashes to resolve its numeric index;
  another operation inserts a stash; drop the now-stale `stash@{index}`. The handoff succeeds while
  removing the unrelated entry from the stash list.
- The lost entry is confirmed; permanent loss of the underlying Git object is not established.
- Direction: coordinate stash-list mutation across the repository and avoid deleting an entry whose
  identity cannot be guaranteed at deletion. Preserve recoverable data when another Git process
  changes the list. Regression: insert a competing stash between lookup and deletion.

### G2 — Failed undo persistence can destroy redo recovery on retry

- Priority: P1. Evidence: injected storage failure in a disposable fixture.
- Source: [tasks.ts](../packages/runtime/src/agents/tasks/tasks.ts), checkpoint undo/redo.
- Filesystem restoration is inside the rollback catch; the later `updateTaskHistory` is outside it.
  If that write fails, files have been undone but the durable undo marker was not saved. Repeating
  undo can overwrite the redo backup with the already-undone contents. The probe then failed to
  recover later user edits through redo.
- Direction: include durable bookkeeping in the recovery boundary, retain immutable backup identity
  for an uncertain operation, and make retry reconcile rather than replace that backup. Test
  metadata failure after restoration, retry, restart, and redo across primary/linked checkouts.

### G3 — SCM writes bypass exclusive checkout mutation locks

- Priority: P1. Evidence: `/api/scm/apply` returned 200 and changed a file while the fixture held
  the checkout mutation lock; stage/commit share the unguarded route pattern by source review.
- Source: [scm-routes.ts](../packages/runtime/src/http/endpoints/scm-routes.ts), apply/stage/commit.
- These requests can overlap operations that rely on exclusive ownership, such as checkpoint
  restoration or branch changes. This is distinct from deciding whether normal editing should be
  allowed during an agent run.
- Direction: admit SCM writes through the authoritative checkout-mutation boundary. Preserve
  expected-content conflict checks. Test apply/stage/commit against rollback and branch mutations.

## Additional reproduced findings

### G4 — Undo cannot remove a newly created external symlink

- Priority: P2. Evidence: disposable Git fixture with a link to `/etc/hosts`.
- Source: [git.ts](../packages/runtime/src/scm/git/git.ts), `restoreSnapshot` deletion loop.
- Snapshotting the new link works. Undo calls `safeFile` before deletion; it follows the link and
  rejects the outside target, preventing removal of the link itself.
- Direction: validate the parent and unlink the repository entry without following its final
  symlink. Keep traversal protections for writes and link parents. File/directory replacement was
  also investigated and worked; it is not an additional finding.

### B1 — Thread preview discards a successful popup POST response

- Priority: P2. Evidence: actual `RemoteBrowsers` implementation in managed Chromium and a local
  HTTP form fixture.
- Source: [browser.ts](../packages/runtime/src/previews/browser.ts), non-workspace popup handler.
- A `target="_blank"` POST succeeds in the popup. The handler closes it and navigates the original
  page to its URL, issuing GET. Observed traffic: `GET /form`, `POST /submit`, `GET /submit`; the
  original page displays the GET 405 instead of the successful receipt.
- No duplicate POST was observed. Shared Browser workspace tabs are outside this reproduction.
- Direction: retain/adopt the popup response or explicitly reject unsupported popup navigation; do
  not recreate a completed navigation from its URL alone. Test POST bodies and redirect chains.

### B2 — Different profiles can reserve the same download destination

- Priority: P2. Evidence: source loaded into an in-memory Electron/filesystem fixture.
- Source: [browser-downloads.ts](../apps/desktop/electron/browser-downloads.ts), `willDownload`.
- All profiles share the Downloads directory, but each tracks reservations independently. While the
  first final path is absent, two profiles select `report.csv`; two downloads in one profile
  correctly select `report.csv` and `report (1).csv`.
- Conflicting path reservation is proven. Native overwrite or corruption is not verified. Ordinary
  website downloads using native save UI are outside the demonstrated programmatic API path.
- Direction: coordinate pending destination reservations across sessions sharing a filesystem,
  release reservations on all terminal paths, and verify simultaneous native downloads.

### A1 — PDF navigation can label an old page as the new page

- Priority: P2. Evidence: reviewer and parent independently executed the generated script in a VM
  with deferred page lookup/rendering.
- Source: [pdf-preview.ts](../packages/runtime/src/http/endpoints/pdf-preview.ts), `pdfPreviewHTML`.
- `getPage(page)` captures page 1 before awaiting. A Next click mutates `page`; the resumed render
  paints page 1 while setting the status to `Page 2 of 3`. A later queued render may correct it.
- Direction: capture a page/zoom generation, label the page actually rendered, and prevent stale
  work from committing canvas/status together. Test fast navigation, zoom, and render errors.

## Credentials and diagnostics

### S1 — Configured MCP subprocesses inherit runtime authority credentials

- Priority: P2. Evidence: production `McpApps.connect` with an in-memory database, a read-only
  scope, an inline stdio server, and a synthetic owner token.
- Source: [bridge.ts](../packages/runtime/src/mcp-apps/bridge.ts), stdio transport environment.
- The bridge copies raw `process.env`, bypassing the existing
  [processEnvironment](../packages/runtime/src/process.ts) filter. The child confirmed receipt of
  the synthetic owner token without an explicit mapping. Owned desktop runtime startup populates
  that variable; other launch paths may not.
- A configured same-user stdio process already executes locally. This is unnecessary authority
  propagation, not proof of an OS sandbox escape or exploitation by an unconfigured server.
- Direction: use the same sanitized environment boundary as other tools, then apply explicit
  supported mappings. Test owner/META credentials, Electron mode, and Git-routing variables.

### S2 — Embedded credentials survive activity and browser-log redaction

- Priority: P2. Evidence: actual redactor and Activity SQLite persistence with synthetic strings.
- Source: [activity.ts](../packages/runtime/src/storage/activity.ts), `redact` and `Activity.add`.
- `X-API-Key: ...`, Basic Authorization, and JSON credentials embedded inside a string retain the
  marker. All three reached persisted activity rows in the probe. Structured API-key objects and
  `access_token` URL parameters were redacted correctly; they are not findings.
- Terminal command presentation and browser logs are real callers of this redactor. No real
  credential or live page was used for the probe.
- Direction: cover the supported string formats at the shared boundary, with tests preventing
  regression in structured redaction. Do not present a regex redactor as arbitrary secret detection.

### S3 — Crash diagnostics retain unsanitized error text

- Priority: P2. Evidence: source-confirmed conditional disclosure; no fatal crash was induced.
- Sources: [last-crash.ts](../packages/runtime/src/storage/last-crash.ts),
  [runtime-snapshot.ts](../packages/runtime/src/http/support/runtime-snapshot.ts), and mobile
  [crash-log.ts](../apps/mobile/src/runtime/diagnostics/crash-log.ts).
- Credential-bearing SDK/error messages or stacks are stored without redaction. Runtime crash
  messages later reach authenticated snapshots/UI; mobile retains them in AsyncStorage.
- Runtime files are mode 0600. No unauthenticated access or external crash-service disclosure was
  established. Text length limits do not redact secrets.
- Direction: sanitize once before persistence and before exposing legacy stored records, retaining
  useful error identity and stack locations. Test with synthetic credential-bearing errors.

## Source-confirmed risks requiring additional fault/device verification

### M1 — Dismissing the context picker does not cancel an in-flight attachment mutation

- Priority: P2. Evidence: complete caller trace; no physical-device fault reproduction.
- Sources: [thread-context-picker.tsx](../apps/mobile/src/tasks/composer/thread-context-picker.tsx)
  and [attachment-picker.tsx](../apps/mobile/src/tasks/composer/attachment-picker.tsx).
- Dismissal aborts a controller. Upload checks its signal before dispatch but does not pass it into
  `callEffect`; once dispatched, the attachment can still be committed after dismissal.
- Direction: distinguish cancellation before dispatch from an uncertain/committed upload. Use stable
  operation identity and reconcile the result; blindly aborting a request cannot undo a server
  commit. Verify dismissal and thread switching while the upload response is held.

### M2 — Reselecting after a lost upload response can duplicate an attachment

- Priority: P2. Evidence: source trace, not a completed device reproduction.
- Source: [attachment-picker.tsx](../apps/mobile/src/tasks/composer/attachment-picker.tsx).
- Each selection allocates a fresh UUID. If the server commits an upload but its response is lost,
  manual reselection creates a new operation instead of reconciling the previous attachment.
- Direction: retain the original ID across uncertain results and reconcile it against the draft.
  Verify committed-response loss without automatically replaying arbitrary mutations.

### M3 — Mobile preference write failures appear saved until restart

- Priority: P2. Evidence: source review of the serialized persistence queue.
- Source: [app-preferences.ts](../apps/mobile/src/runtime/preferences/app-preferences.ts).
- In-memory state publishes normally; rejected AsyncStorage writes only log a warning. The UI can
  appear to have saved a setting that disappears on the next launch.
- Direction: expose a dirty/save-failed state and an explicit retry while preserving serialized
  writes and pending edits during initial loading. Verify write rejection followed by reload.

### A2 — Generated artifact download size is checked after materialization

- Priority: lower than the issues above; source-level memory-bound concern.
- Source: [artifact-download.ts](../packages/protocol/src/conversation/artifact-download.ts).
- The 20 MB check follows `response.blob()`. It bounds the accepted file, not the allocation needed
  to read it. The reproduction does not establish an OS-level memory failure; blob implementations
  may reuse storage, and generated blob URLs already have backing data.
- Direction: validate declared size when available and bound streamed consumption where supported,
  retaining the final size check and existing message/nonce isolation.

## Database and search recovery

### D1 — Backup verification leaves WAL sidecars outside retention

- Priority: P2. Evidence: reviewer and parent independently reproduced with the installed SQLite
  binding and a disposable WAL database; `quick_check` succeeded.
- Sources: [backup.ts](../packages/runtime/src/storage/backup.ts) and
  [backups.ts](../packages/runtime/src/storage/backups.ts), verification and snapshot cleanup.
- Opening the copied WAL-header database read-only for verification creates `.sqlite.partial-wal`
  and `.sqlite.partial-shm`. Closing verification leaves them behind. The snapshot is renamed, but
  cleanup removes only the main partial file; list/prune exclude sidecars.
- The parent probe confirmed the leftover filenames. Cumulative disk growth is a retention defect,
  not demonstrated corruption of the verified backup.
- Direction: give each staged snapshot ownership of its sidecars, including interrupted staging and
  verification failures. Test repeated backups and pruning against actual directory contents.

### D2 — One unreadable stored record can fail otherwise healthy collections

- Priority: P2. Evidence: parent reproduced failed peer listing and replacement with an in-memory
  database and malformed synthetic registration; other collection boundaries were source-reviewed.
- Sources: [peers.ts](../packages/runtime/src/retrieval/peers.ts),
  [usage-history.ts](../packages/runtime/src/storage/usage-history.ts),
  [usage-hubs.ts](../packages/runtime/src/storage/usage-hubs.ts), and
  [artifacts.ts](../packages/runtime/src/artifacts/artifacts.ts).
- These collections decode rows without isolating a bad record. A malformed persisted JSON value
  fails the whole list/read; peer registration also reads the existing collection before replacing a
  registration, obstructing ordinary repair through that operation.
- Separately, [jobs.ts](../packages/runtime/src/jobs/jobs.ts) skips unreadable runs at startup, but
  retention visits only decoded in-memory runs. Those unreadable rows survive every retention pass.
- Direction: preserve/quarantine raw invalid records and report degraded state while serving valid
  independent entries. Keep authoritative credentials and mutations fail-closed. Do not silently
  discard unreadable records or describe arbitrary schema evolution as guaranteed corruption.

### D3 — An expired search cursor is reported as a server failure

- Priority: P2. Evidence: parent reproduced the ordinary Error with an in-memory conversation store;
  HTTP error mapping was verified by source review.
- Sources: [conversations.ts](../packages/runtime/src/storage/conversations.ts), `search`, and
  [server.ts](../packages/runtime/src/http/server.ts), error response mapping.
- A message used as the pagination cursor can disappear between pages. The lookup accepts missing
  rows, then throws an ordinary Error; HTTP maps it to 500. History pagination already distinguishes
  stale cursors with a recoverable conflict response.
- Direction: return a consistent stale-cursor outcome and let the caller restart search explicitly.
  Do not retry a failed mutation as part of pagination recovery.

## Distribution and update recovery

### U1 — Source-update rollback copies directly over the live database path

- Priority: P1 recovery risk. Evidence: source-confirmed interruption boundary; no interrupted-copy
  or power-loss reproduction was performed.
- Source: [server-update.ts](../apps/api/src/server-update.ts), rollback in `updateServer`.
- After a failed source release, rollback copies the backup directly over `initial.databasePath`,
  then removes WAL/SHM. If copying fails or the process exits during it, that path can contain an
  incomplete replacement. The old selected release cannot make a partial database safe.
- The archive updater's [server-activation.ts](../apps/api/src/server-activation.ts) already stages
  and renames its restoration, but neither update path calls `verifyRuntimeBackup`. The separate
  [backup restore command](../packages/runtime/src/storage/backups.ts) verifies and stages.
- Direction: share the verified, staged restoration boundary while retaining the requirement that
  the candidate process is stopped before touching database files. Test copy/verification failure
  and restart at each boundary. A source review is not proof of observed user data loss.

### U2 — Corrupt selected-release metadata blocks automatic server startup

- Priority: P2. Evidence: source-confirmed failure/recovery path; no host service was changed.
- Sources: [server-update.ts](../apps/api/src/server-update.ts), `selectedEntrypoint`, and
  [private-json.ts](../apps/api/src/private-json.ts), `writePrivateJson`.
- Invalid JSON, including an empty metadata file, throws before selection completes. The previous
  entrypoint is held in the same unreadable document, so automatic startup cannot recover it. Writes
  use atomic rename but do not fsync; this does not prove that a power loss produces an empty file,
  nor does it negate protection against ordinary partial writes.
- Direction: retain an independently validated previous selection and surface a recoverable
  diagnostic. Never blindly select an unvalidated build or silently reinterpret corrupt metadata.

### U3 — Release directories and abandoned update stages have no bounded retention

- Priority: P2. Evidence: source review of source and Linux archive install paths.
- Sources: [server-update.ts](../apps/api/src/server-update.ts) and
  [server-remote-update.ts](../apps/api/src/server-remote-update.ts).
- Completed source releases and versioned Linux archive installations accumulate. Normal `finally`
  cleanup removes a current archive stage, but a killed updater can leave `.dovo-update-*` stages
  without later cleanup. Existing database backup retention does not cover these paths.
- A pre-existing version launcher also skips download/hash/smoke validation on reuse. Post-start
  version verification and rollback still run; this is not evidence of unsigned remote execution.
- Direction: retain the active and previous verified releases, bound older installations, and clean
  orphan stages only under the update lock. Verify cached candidates before activation.

Other update observations remain design questions rather than confirmed data-loss findings: explicit
newer-schema refusal during downgrade, cross-volume service migration ordering, and stale desktop
proxy records identified only by PID. They should not displace the concrete findings above.

## Areas where no additional defect was confirmed

- GitHub: watcher cancellation, cursor handling, freshness, merge readiness, and credential-account
  routing were reviewed locally. No new confirmed issue beyond the previous credential work.
- Browser: profile partitions, private permissions, renderer trust, permission-answer generations,
  and PiP authorization were inspected. No additional boundary escape or profile data crossover was
  established. This is a bounded review, not comprehensive security certification.
- Mobile drafts: the suspected generic keyboard/draft-loss race was not substantiated; existing
  serialization and journals account for the inspected paths.
- Worktree deletion: ownership is rechecked and Git removal does not use `--force`.
- Credential storage: desktop encrypted storage rejects unavailable encryption and Linux
  `basic_text`; mobile connection/account secrets use SecureStore. Private temporary credential
  files and MCP HTTP redirect handling had no additional confirmed defect. Actual keychain backend
  behavior was not tested on a device in this round.

## Previously authorized fixes implemented separately

- Graceful peer-pipe draining through ACK completion, including a real TCP regression.
- Independent account authorization renewal, no-TURN identity admission, and signaling-socket
  ownership; bounded handling of correctly bound late ICE after cancellation.
- Authoritative steering mutation guards; cancellation and shutdown despite storage failure;
  recovery admission independent of run lifetime; draining scheduled submissions before storage
  disposal; confirmed OpenCode root cancellation before releasing ownership.
- Interrupted mobile pairing finalization and bootstrap cleanup; native TCP write half-close and
  JavaScript buffered-data/EOF ordering.
- Missing shared-window baselines, failed resume sends, and obsolete route metadata.
- Requester-specific transfer routes, incomplete-transfer retry reconciliation, and explicit
  transport capability presentation on desktop/mobile.
- Bounded desktop replacement-runtime supervision, pop-out recovery, and owned-child diagnostics.
- Mandatory forced TURN UDP/TCP/TLS CI coverage; Effect and matching React atom bindings 4.1.0.

These changes do not implement the new findings above. Unresolved first-round design boundaries:
seamless TURN credential rotation, recovery of receipts owned by a previously paired device, and
lossless log rotation across uncoordinated writers. Removing expiry/ownership safeguards or adding
arbitrary retries would not solve those safely. Full native Android/RN bridge verification remains
distinct from socket harness and JavaScript tests. Publication and physical iPhone deployment are
not implied by local verification.

The rejected log-rotation catch-up loop was removed. The production rotation implementation is
unchanged; a standalone audit probe at `work/stability-round2/log-rotation-loss-probe.mjs` still
reproduces a line lost immediately before truncation. The ordinary test checks the bounded archive
and descriptor behavior; no expected-failure marker turns the unresolved loss into a passing gate.
Desktop log shutdown now awaits actual descriptor closure, including failures while opening.

## Effect 4.1 upgrade and verification

- All 20 direct manifest references to `effect` and `@effect/atom-react` are pinned to `4.1.0`. The
  workspace override and lockfile agree; frozen-lockfile installation passed. The upstream
  [4.1.0 changelog](https://github.com/Effect-TS/effect/blob/effect%404.1.0/packages/effect/CHANGELOG.md)
  was reviewed against the APIs used here; no additional source API migration was needed.
- All 28 workspace typecheck tasks and all 32 build tasks passed. After the final desktop logger and
  test corrections, desktop typecheck and build passed again.
- An integrated focused pass completed 812 tests in 67 files. Later peer/auth disposal coverage
  passed all 50 tests; the final desktop supervisor/pop-out/log run passed all 40 tests.
- The full monorepo pass recorded 5,866 passed, 7 failed, and 12 skipped. Five failures were from
  tests loading an in-progress pairing edit and two fixture defects (an inherited data-root
  environment variable and a Linux-specific staging-race injection); focused corrected reruns
  passed. That pass also reproduced two pre-existing failures: read-only Git diff index-byte
  stability and Vibe disconnect under `kill EPERM`. Both were subsequently fixed and the full suite
  rerun, as recorded below.
- Workspace formatting/lint passes with zero errors and ten existing warnings. `git diff --check`
  passes. No disabled assertions or expected-failure tests were added to hide these findings.
- Managed-Chromium checks passed for desktop/mobile appearance, startup/composer behavior,
  project-transfer capability presentation, runtime synchronization, and mobile Metro modules. The
  local forced-TURN matrix passed UDP, TCP and TLS, including ten relay scenarios.
- Native socket harnesses exercised actual patched iOS/CocoaAsyncSocket code in the simulator and
  actual Android socket-client code on the host JVM with 2 MiB payloads and both EOF orders.
  JavaScript wrapper tests verify paused-data delivery before EOF/close. These do not replace a full
  React Native bridge test or a physical Android/iPhone network-switching run.

### Integrated release verification, 2026-10-30

- The final monorepo run passed **5,904 tests across 707 suites**, with 12 tests and three suites
  skipped. All 32 build tasks and 28 typecheck tasks passed. Workspace formatting/lint passed with
  zero errors and the ten existing warnings. Packaging/CI script tests passed 62 tests, with eight
  platform-specific tests skipped.
- Read-only Git status now disables optional index writes. macOS can return `EPERM` between pipe EOF
  and reaping the last process in a group; owned-child shutdown now keeps its bounded exit
  observation active through that state. Persistent permission failures still reject shutdown and
  retain ownership until exit is confirmed. The Vibe disconnect and real EOF-order regressions pass,
  and an injected persistent-denial regression verifies the ownership boundary.
- The Jira hook fixture now includes the source-refresh callback introduced by the PR recovery
  changes. No application behavior was changed to accommodate the fixture.
- Managed-Chromium checks passed for desktop/mobile appearance, PR routing and list layout, scoped
  settings, project presentation at 320/390/1280px, thread project panels and project copies. The
  runtime sync check, mobile Metro module check and Expo configuration check passed. Forced TURN
  UDP/TCP/TLS passed all ten relay scenarios. The Android socket-client host-JVM harness passed both
  EOF orders with 2 MiB payloads.
- Full React Native bridge/device testing and signed release artifact verification remain separate
  gates. The read-only discoveries above remain unfixed unless explicitly listed as implemented;
  this verification does not claim otherwise.

Two final Claude Fable follow-ups hit provider rate limits before completion. Earlier reports were
retained; the parent completed the desktop cleanup and independently checked the strongest database
claims with disposable SQLite and in-memory production-module probes. The unfinished extra challenge
is not represented as an additional completed independent review.

No commit, push, nightly publication or physical iPhone update was performed in this pass.

## Recommended next implementation order

1. Fix G1–G3: stash identity, undo bookkeeping/redo recovery, and SCM mutation admission.
2. Harden U1 rollback, then S1–S3 credential propagation and redaction boundaries.
3. Address browser/PDF correctness and database retention/degraded-record recovery.
4. Verify mobile upload cancellation and uncertain-response reconciliation on native devices.

Keep seamless relay renewal, old-device transfer receipt recovery, and coordinated log rotation as
explicit design work with end-to-end failure tests. Do not weaken leases, pairing ownership, HTTP
LAN/VPN support or uncertain-mutation protections to make recovery appear successful.
