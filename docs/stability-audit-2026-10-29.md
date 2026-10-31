# Stability audit — second discovery round

Follow-up on 2026-10-30: G2 (undo persistence and stale requests), G3 (SCM write admission), G4
(checkpoint symlink removal) and D1 (owned staging sidecars) are addressed in the
[quality follow-up](t3-performance-comparison.md#quality-follow-up-2026-10-30). The findings below
retain their original audit context; other unresolved findings are not marked fixed by that work.

The
[deeper fault-injection follow-up](t3-performance-comparison.md#deeper-fault-injection-follow-up-2026-10-30)
also addresses G1 (retain handoff recovery stashes and pin private recovery refs), B2 (cross-profile
download reservations), A1 (coherent PDF rendering), S1–S3 (supported diagnostic credential formats
and ambient MCP filtering), and further backup/restore failure handling. Its evidence and limits
supersede the corresponding original findings below. Updater transactional recovery, worktree
creation and uncertain mobile uploads remain open; the follow-up distinguishes targeted safeguards
from complete fixes.

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

The
[recovery challenge follow-up](t3-performance-comparison.md#recovery-challenge-follow-up-2026-10-30)
supersedes G1–G3's original evidence with durable handoff refs, intent-before-write undo recovery,
shared edit admission, task/instruction-save protection and family admission regressions. It also
records residual shared-stash and externally missing checkout limits.

1. Implement owned/cancellable worktree creation and partial-failure recovery across all callers.
2. Complete U1 transactional updater rollback; the current startup guard is only a targeted
   safeguard.
3. Address open browser/PDF-adjacent and database retention/degraded-record findings.
4. Implement uncertain-response reconciliation for mobile uploads and verify it on native devices.

Keep seamless relay renewal, old-device transfer receipt recovery, and coordinated log rotation as
explicit design work with end-to-end failure tests. Do not weaken leases, pairing ownership, HTTP
LAN/VPN support or uncertain-mutation protections to make recovery appear successful.

## Deeper implementation pass, 2026-10-30

The following changes supersede the corresponding worktree and degraded-record findings above:

- Worktree creation uses Git 2.33's creation lock with a unique attempt reason and an exclusively
  created folder identity. Hooks, fetches and submodule preparation run as owned process trees with
  cancellation and a five-minute checkout/setup budget. Origin discovery retains its 30-second
  budget, and PR fetches retain their existing command budgets, with noninteractive credentials.
  Confirmed failures clean only the matching owned folder/registration; replacements and unconfirmed
  shutdowns are preserved. Shared configuration admission remains held until an unconfirmed writer's
  exit is positively confirmed. Cancellation of a queued writer cannot admit successors ahead of its
  predecessor.
- Primary, linked and PR preparation no longer prune unrelated missing registrations. Missing
  worktree folders can still have staged data in Git's per-worktree index, and now require explicit
  recovery. Main folders and incompletely created worktrees are excluded from automatic adoption.
  Repeated handoffs out of the main folder create a fresh branch at its current tip while retaining
  prior branches. Setup/submodule completion resets before creation; interrupted fork snapshots
  resume during preparation instead of being lost when a checkout already exists.
- A failed preparation shutdown is preserved as an ownership error rather than wrapped as a setup
  error. A live runtime quarantines its checkout until exit is confirmed, across Git service
  instances and provider admission. Real hook/child cancellation, replacement-folder preservation,
  retained staged indexes, fork recovery and repeated handoff regressions pass. Snapshot
  restoration, submodules and setup also hold an attempt-specific `dovo-preparing` Git lock through
  completion persistence. Checkout inspection permits only that preparation's asynchronous execution
  context while the lock is held. The lock survives runtime death, so a fresh runtime refuses a
  checkout whose detached setup may still be alive. A real POSIX SIGKILL probe verifies this refusal
  while the setup process remains running. Recovery after a hard kill requires confirming those
  commands stopped before explicitly unlocking; the application does not infer their exit from the
  runtime PID. Windows hard-kill process behavior was not exercised by this probe.
- Unreadable v3 metadata rows and their summaries/manifests survive full rewrites. Malformed v2 task
  identities are also reserved during migration, and identifiable orphans from earlier v2 migration
  backups can be recovered without rewriting authoritative conversations. Reusing a reserved ID is
  refused; metadata must be repaired or a backup restored. Conflicting or ambiguous recovery records
  fail closed. Previously overwritten conversation text cannot be reconstructed. Recovery
  bookkeeping clears after the outer transaction commits, preserving rollback retries without
  rewriting the workspace shell on every subsequent streamed update.
- Mobile history cache-read failures no longer prevent live pagination. Cache failures remain
  visible, and unread offline content is protected from overwrite. The managed-browser task-list
  check confirms group/project collapse survives full reloads with the real preference store.

See [performance verification](performance.md#deeper-performance-and-recovery-pass-2026-10-30) for
reproducible include-discovery, Markdown and compaction measurements and their limits. HTTP LAN/VPN,
optional HTTPS, pairing and required device tokens are unchanged.

### Final worktree challenge

The independent read-only worktree review was completed; its failure predictions were source traces,
not executed probes. Parent regressions now cover the strongest additional findings:

- Availability reads precede overlap checks and publication of run directories, closing admission
  between asynchronous Git-lock reads. A forced concurrent-admission regression admits exactly one
  provider and rejects the competing run.
- Refused consumers receive a 409 rather than inheriting another owner's shutdown error. They do not
  reserve a new folder or quarantine their own run/configuration queue. The actual failed command
  retains ownership until confirmation.
- Launcher exit initiates descendant cleanup before pipe EOF. An escaped process retaining output
  causes a bounded shutdown error and retains both live quarantine and the durable preparation lock
  until genuine EOF; a real detached-process regression verifies this boundary.
- Confirmed creation cleanup removes the owned folder before its Git registration, preserving the
  registration if file deletion fails. Empty reserved folders can be removed without pruning
  unrelated registrations. Preparation recovery guidance asks users to confirm command shutdown and
  unlock; it does not suggest deleting a prepared worktree.
- New task branches disable inherited base tracking, and replacement handoff branches are saved as
  `checkoutBranch`. A real local bare-remote regression verifies that a task push leaves the origin
  base unchanged. Existing manually configured upstream behavior is preserved.
- The worktree version gate is Git 2.36, matching the NUL-delimited porcelain feature in use.

The hard-kill and escaped-pipe probes ran on POSIX. Arbitrary daemonization outside the owned
process group with redirected output, and native Windows background-process behavior, are not proven
by these probes. Historical findings below other headings remain historical unless a later
implementation section explicitly supersedes them.

### Source updater recovery

Source updates now save a durable phase record before stopping the previous runtime. The verified
SQLite snapshot and release selection share runtime admission; a foreign runtime holding the
database prevents activation before any stale rollback snapshot is captured. A launched candidate
waits on a parent-owned stdin gate until its PID is durably recorded, so updater death before that
write cannot leave a candidate that opens the database later. Existing healthy foreign runtimes
cannot count as a newly admitted candidate.

Rollback restores through SQLite's transactional backup API while holding runtime admission, then
reselects the previous release. The candidate database is preserved separately. An initially absent
database is restored to absence without leaving a WAL to replay. Interrupted rollback remains
recoverable from the journal and backup; a live or unconfirmed candidate prevents restoration.
Service boot launchers resolve pending source updates before starting, verify interrupted candidates
and preserve the rollback decision across another restart. Completion is durable before journal
cleanup; cleanup failures cannot report a healthy activation as failed. Transaction records use the
shared schema decoder and the updater imports the same typed SQLite binding as the runtime.

The five targeted updater/manager/activation/service suites passed 53 tests after integration,
including actual updater SIGKILL, interrupted SQLite restore, failed migrations, late candidates,
occupied locks and service-manager relaunches. The source-update tests run built Node launchers;
they do not verify signed packages or operating-system service installation.

**Open at the end of that pass (closed in the follow-up below):** archive/Homebrew
`activateServerRelease` now holds admission through snapshot and selection and restores on caught
activation errors, but its callback-based activation has no durable packaged-release journal.
SIGKILL during a packaged migration is not covered by source recovery. Completing this needs
persistent launcher selection and boot recovery for the packaged service; the source update journal
must not be presented as solving that path. The server config already requires the database and
control files in the same data directory; no new cross-directory configuration was introduced.

### Mobile upload recovery integration

Phone uploads persist their immutable ID and complete request in the mutation journal before
dispatch. Device-bound runtime receipts reconcile lost responses across restart; reconnect does not
replay upload requests. Finish and acknowledgement retain the payload until the runtime confirms a
live draft, queued message or conversation reference. Task deletion and stale recovery flags cannot
alone justify retiring the last copy. Explicit discard writes a tombstone before retiring the saved
request.

Ordinary picker, replacement and archive uploads first stage detached bytes, then atomically commit
to the original runtime draft guard while their UI still owns the task/computer/edit session.
Keyboard edits continue within the same mobile draft; sending is blocked while attaching. The server
guard detects changed draft text, attachment IDs, queue IDs and message counts, without invalidating
on streamed text-only history edits. A multi-file batch captures one guard and advances only from
its own successful commit receipt. That post-commit guard is persisted transactionally for restart
replay. An uncertain result stops the remaining batch before further dispatch. Normal success
reaches the composer directly; changed/closed destinations retain an explicit review item.
Queued-edit uploads retain their saved payload until the edit is durably committed, with explicit
recovery into the original task's current draft when the edit cannot be resumed.

The agent's final targeted run passed 95 runtime/protocol tests plus managed-Chromium file-drop,
image-editor and archive checks. The fixtures cover changed destinations between selected files and
lost commit responses; runtime tests include streaming stability, HTTP guard chaining and restart
replay. Native React Native/device behavior was not exercised in this pass. Legacy/old-device
receipt migration remains separate work.

### Final verification for this deeper pass

- The final complete monorepo test run passed **6,112 tests across 715 suites**, with 12 tests and
  four suites skipped. Targeted worktree deadline/ownership, updater and mobile upload regressions
  are included in that run. No new disabled assertions were added to mask failures.
- All workspace typechecks passed. Recursive workspace builds passed on Node 24.11.0; the final
  full-test command rebuilt API dependencies after the runtime/protocol/updater integration. The
  desktop nested build wrapper failure was reproduced on Node 24 and 26 and removed, as recorded in
  `ci-performance.md`. Final workspace formatting/lint passed with zero errors and the ten existing
  warnings; `git diff --check` passed.
- The mobile agent's final managed-browser checks passed for file drops, image editing and archive
  attachment commits. Earlier real-preference reload checks cover mobile group/project collapse;
  native-device and signed-package deployment were not performed in this pass.
- Latest T3 Code was rechecked at `6575ce32508bd7908444241f3719aa33aaf77f90` (2026-10-30 12:44:34
  UTC); it is the same revision used for the comparison. The worktree Opus review finished as
  read-only source analysis. Parent failure probes and integration tests provide the executed
  evidence. The updater child was stopped after implementation and its final integration was
  completed by the parent; it is not counted as an additional completed independent review.

Open follow-ups remain the packaged-service crash journal, coordinated log rotation across
uncoordinated writers, seamless TURN renewal, legacy/old-device receipt migration, and native
platform/release verification. This pass improves the implemented paths without claiming those
separate gaps are closed. No commit, push, PR or deployment was performed.

## Packaged-service recovery follow-up, 2026-10-30

Packaged/Homebrew service activation now uses the durable update journal. Source journals remain
version 1; package journals use version 2, so older source-journal decoders refuse incompatible
metadata. No committed/released source-journal implementation was found in this checkout's Git
history. Use the updated package CLI when resuming an interrupted package update; do not manually
start an older, unrelated package on the pending database.

- The transaction records immutable previous/candidate launchers and both service records. A service
  record is published before the symlink that marks the selection boundary. Recovery uses the pinned
  launcher identity, including when Homebrew uses identical public-path metadata on both sides.
  Subsequent attempts derive the previous version from the actual service selection, rather than a
  public path already advanced by a failed attempt.
- Before Homebrew preparation, the old launcher is pinned and the stopped database is snapshotted
  under runtime admission. A killed updater can leave brew running. Abandoning preparation retains
  the pin even if the public path has not changed yet; later package-manager mutation cannot select
  an unverified candidate. Status/doctor expose retained or missing packages.
- Candidate startup requires the selected launcher and its actual package entrypoint. Boot recovery
  delegates through the restored package launcher instead of accidentally starting the new
  launcher's own runtime after rollback. An archive launcher refuses a pending source update.
- Remote-update version expectations survive restart and are checked through the authenticated
  overview before commit. Failed startup/version verification records rollback before restoring. The
  candidate must stop before restoring the old database; replaced candidate data is preserved. Boot
  recovery prints the preservation path and any warnings. Old-service restart failures are reported
  separately from pending database recovery.
- Successful commit durably records completion before returning the service link to its public
  package-manager path, and does so only when that path still selects the verified package. A
  completed update or rollback remains bootable when optional launcher/record cleanup cannot write
  to disk. The old callback-only production helper was removed; its six failure tests now exercise
  the journal implementation.
- Boot verification observes both child exit and spawn error, so an unspawnable candidate cannot
  leave the service wrapper polling forever. Fault tests cover runtime-lock contention, failed
  candidate stop, a database first created by the candidate, partial SQLite restore failure and
  failure to restart the restored service.

The new crash probes SIGKILL real updater processes during preparation, after migration, after the
rollback decision, and on either side of launcher publication. Separate copied-package fixtures run
the actual packaged service launcher through healthy commit and failed-candidate rollback. A late
public-link mutation after abandoned preparation is also covered. Two injected read-only cleanup
regressions verify continued boot for both committed updates and completed rollbacks. These use
Linux/Node subprocesses and simulated package-manager/service controls; they do not validate native
Homebrew, launchd/systemd registration, power-loss behavior or signed release packages.

A macOS updater killed after service stop can leave the job unregistered until login or an explicit
service restart. The journal preserves safe recovery; it cannot run after SIGKILL. Existing limits
for uncoordinated log writers, TURN renewal, legacy receipt migration and native platform/release
verification remain. Queued-message projection gains and their measurement limits are recorded in
`performance.md`.

### Follow-up verification

- Final complete run: **6,130 tests passed across 716 suites**, with 12 tests and four suites
  skipped. The packaged crash probes and both completed-cleanup failure injections are included.
- All 28 workspace typecheck tasks and all 32 workspace build tasks passed on Node 24.11.0. The
  final API typecheck includes the new failure tests. Workspace formatting/lint has zero errors and
  the same ten existing warnings; the 12 changed implementation/test/benchmark files passed their
  targeted check with no warnings. The adjusted subagent suite passed its separate check.
  `git diff --check` passed.
- The first full run hit an unchanged five-second Git integration deadline during concurrent
  build/check load. Its six-test suite passed in isolation, and the final full run passed with no
  assertion or deadline change. A clean rerun exposed a separate subagent-test synchronization race:
  `review` is persisted before the run releases its reservation. Four test waits now assert both
  `review` and the public `completed` snapshot phase before reading final results; delivery,
  permission, receipt and offline assertions remain in place. Its 22 tests and the final full run
  passed.
- The read-only Opus challenge supplied traced findings. Executed crash/launcher tests and the
  parent/worker benchmark runs provide the verification evidence. No native service installation,
  signed package, device deployment, commit, push or PR was performed in this follow-up.
