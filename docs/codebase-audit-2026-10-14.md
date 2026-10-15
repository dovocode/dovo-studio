# Codebase audit — 14 October 2026

Audit base: `2c9f3a70`. Finding locations refer to that revision.

Reviewed by three GPT-6.1 Sol agents and three Claude Opus 5.5 agents, all with high reasoning, plus
parent review and Fallow 3.31.0. Two requested Muse Wonder reviewers could not run because Muse
rejected the saved API key. Audit findings were checked against source, callers and existing tests;
full application/native reproduction was not performed. The GitHub handoff implementation requested
during the audit is a separate, tested change; the findings below remain follow-up work.

## Fixes to prioritize

| Priority | Finding and evidence                                                                                                                                                                                                                                                                                                            | Smallest useful fix / verification                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Claude MCP configuration includes the runtime owner token in process arguments. `packages/runtime/src/index.ts:165`, `agent-tools/config.ts:42`, `agents/configuration/mcp-settings.ts:63` and the pinned Claude SDK's `--mcp-config` serialization establish the path.                                                         | Keep secrets out of serialized argv; verify environment inheritance or supported variable expansion, then test that spawned arguments contain no tokens.                                                                |
| High     | All harnesses receive the owner credential, including third-party ACP implementations. Task restrictions in the MCP process do not constrain raw owner-authenticated HTTP calls.                                                                                                                                                | Introduce expiring run credentials bound to task/run and permissions; reject pairing/device-trust operations and access to another task. This is a deliberate authorization change, separate from the smaller argv fix. |
| P2       | A rejected mobile preferences read still sets `loaded = true`, allowing the next edit to overwrite unread settings with defaults. `apps/mobile/src/runtime/preferences/app-preferences.ts:122`. Mocked storage reproduction confirmed data loss.                                                                                | Separate failed hydration from successful hydration; retain pending edits until a successful read. Test read failure, edit, successful retry and preservation of unrelated settings.                                    |
| P2       | Electron can publish an old HTTP snapshot after a new runtime instance has already streamed a snapshot and disconnected again. `apps/desktop/electron/runtime-connections.ts:225`. Mocked transport reproduction confirmed publication order new → old.                                                                         | Invalidate pending HTTP results when newer stream state supersedes them. Test delayed success and failure across runtime restart and disconnect.                                                                        |
| P2       | Concurrent calls to `Browser.launch()` both pass the initial check before `executable()` finishes, launch two browsers and retain only one. `packages/runtime/src/previews/browser.ts:100`. Parent independently reproduced two launches from the actual method with mocked Chromium.                                           | Assign the complete startup promise before the first await; clear only the current promise. Test shared concurrent launch, failure recovery and disposal.                                                               |
| P2       | Restart recovery initially honors project settings but its final admission callback only checks the global setting. `packages/runtime/src/agents/tasks/tasks.ts:2237,2263`.                                                                                                                                                     | Use the same explicit choice → project → global precedence in both checks. Test both override directions.                                                                                                               |
| P2       | Managed API services set saved `NODE_EXTRA_CA_CERTS` after Node has started. `apps/api/src/server-service.ts:198` and `index.ts:79`. Node consumes this setting at process startup.                                                                                                                                             | Load allowlisted saved environment before spawning Node. Verify a managed runtime against a private-CA HTTPS fixture. Keep HTTP runtime connectivity supported.                                                         |
| P2       | Successful desktop preset sync never deletes its earlier failure entry, so stale `syncError` can disable job controls. Mobile instead clears the error after any success, hiding failures on other runtimes. `packages/studio-core/src/workspace/provider.tsx:1924` and `apps/mobile/src/runtime/connection/provider.tsx:1258`. | Clear the successful runtime's failure and derive the error from remaining failures; also clear resolved no-op entries. Test two runtimes and fail → change → success.                                                  |
| P2       | An async existing-worktree lookup spreads a captured linked-project value, overwriting an access change made while the lookup is pending. `packages/studio-ui/src/linked-checkouts.tsx:121`.                                                                                                                                    | Merge the result into the latest value or disable affected inputs during lookup. Test delayed choices and a concurrent access change.                                                                                   |
| P2       | Remove inside the browser-profile rename form defaults to submit; cancelling removal can save an unsaved rename. `packages/studio-shell/src/app-settings/browser.tsx:54`.                                                                                                                                                       | Add `type="button"`. Test cancelled removal with an edited name.                                                                                                                                                        |
| P2       | Creating drafts from an automation drops configured linked checkouts. `packages/extension-jobs/src/use-automation.ts:29` and `packages/studio-core/src/workspace/actions.ts:13`. Runtime execution copies them.                                                                                                                 | Accept/copy `linkedCheckouts` in the helper and caller; test reference and editable links.                                                                                                                              |
| P2       | iOS file-drop completion returns when the retained view is detached before resetting `receiving`, permanently blocking later drops after reattachment. `apps/mobile/modules/dovo-file-drop/ios/DovoFileDropModule.swift:105`.                                                                                                   | Reset `receiving` before the window check. Native verification must delay item loading and detach/reattach the same view.                                                                                               |

## Dead code and obsolete checks

- `Conversations.hydrate()` in `packages/runtime/src/storage/conversations.ts:153` has no repository
  callers. Remove its exclusive schema and imports together.
- `useDetailChrome` in `apps/mobile/src/shell/navigation.tsx:24` and `useScrollViewScroll` plus
  `restoreView` in `apps/mobile/src/ui/layout/use-list-scroll.ts` have no callers.
- Protocol declarations with no consumers: `composerPlanLimit`, `PLAN_MODE_INSTRUCTION`,
  `runtimeRestartSchema`, `lengthValue`, `acpRegistryInstallSchema`, `acpRegistryRemoveSchema`.
  Check exported API expectations before removal.
- `FileIcon` in `packages/extension-tasks/src/files/presentation.tsx:35` is unused. `DiffText` is
  used internally: remove only its redundant export.
- `TaskActions`, mobile `Setup`, and mobile `ProjectMachinePicker` have no production callers but
  are still mounted by browser fixtures. Move coverage to the shipped context
  menu/settings/task-creation flows before deleting these components.
- `clearFailedBackgroundRuntime` is only called by tests after its production caller was removed.
  `TaskReviews.isApproved` is retained only by a test asserting it is not called. Update those tests
  when removing the obsolete helpers.
- `packages/studio-core/src/workspace/scope.browser.mjs` is an unregistered regression test, not
  evidence of an obsolete feature. Register it with the browser runner.
- Nineteen Electron/packaged-app scripts wait for removed UI text, `Workspace synced`. This includes
  documented pairing and packaged-app checks. Replace the readiness condition and run those checks
  before treating them as verification.

## Fallow results and limitations

The configured semantic dead-code scan reports 70 issues: five unused-file candidates, eleven unused
exports, five unused class members, dependency findings, 38 unresolved imports and five cycles.
These counts are candidates, not a safe deletion list. Semantic evidence is incomplete for some
declarations.

False positives checked manually:

- `pdfjs-dist` and `tree-sitter-wasms` are dynamically resolved.
- `ForgePullRequests.forDestination` has callers through an optional typed interface.
- `scripts/retry-browser.mjs` is executed by the browser-suite runner.
- `scripts/capture-site-screenshots.mjs` is documented tooling.
- `scripts/generate-project-icon-choices.mjs` generates tracked assets.
- Many unresolved imports target generated `dist` or Next.js output absent before builds.
- The `fflate` browser fixture deliberately uses `createRequire` from studio-core's package, where
  that dependency is declared.

`fallow.toml` marks every app source file and Electron file as an entry, hiding unused files and
exports. Narrow to real framework/application/process roots, confirm Metro platform resolution, and
inspect entry exports and production-only reachability. Fallow is not run in CI. Fix
configuration/false positives before adding its CI gate.

The parent duplication scan used at least 25 lines / 150 tokens across directories: 15 clone groups
in 26 files, representing 1,301 duplicated lines (0.50% of scanned lines). A broader reviewer scan
found 99 blocks / 4,789 lines. Thresholds differ; neither count justifies wholesale abstraction.

Useful local sharing opportunities: preset synchronization (already divergent), the identical
mobile/shared `useApplicationState` implementation, usage-data orchestration, and the untrusted MCP
App message dispatcher. Preserve platform-specific UI and lifecycle behavior. Resolve the five
import cycles locally when touching those modules.

## GitHub handoff reference

Inspected T3 Code's
[`pullRequestRouting.ts`](https://github.com/pingdotgg/t3code/blob/main/packages/client-runtime/src/state/pullRequestRouting.ts)
and
[`githubRoutingPermissions.ts`](https://github.com/pingdotgg/t3code/blob/main/packages/client-runtime/src/connection/githubRoutingPermissions.ts).
It separates origin from request transport, probes matching host/account identities and guards
routed operations. Dovo's changes reuse its existing verified-reader selection, retain original
destinations and credentials, and address mobile PR handoff plus desktop offline identity
restoration. No mandatory accounts or HTTPS are introduced.

Implementation verification passed: mobile and extension-scm typechecks, targeted formatting/lint,
the source-selection and mobile reader unit tests, and managed-Chromium checks for desktop source
readers, desktop integration continuity, destination guards, Jira recovery, mobile PR handoff
(including pagination), and mobile integration continuity. The new mobile handoff suite is
registered in the browser runner. The final Fallow scan retains the same 70 baseline findings with
no new finding IDs; it still exits nonzero for those existing findings. Live GitHub accounts and
native devices were not exercised. Automatic handoff requires a matching registered repository and a
retained verified origin identity; cached PR content alone never authorizes another account.

## Second review — current working tree

The original audit above is retained. This round reviews the working-tree GitHub handoff changes as
well as the audit base. Two GPT-6 Astra high reviewers and two Claude Fable 5.1 medium reviewers
completed this round. Findings below are follow-up work, not applied fixes.

### GitHub handoff corrections

The earlier passing checks do **not** establish complete origin-bound action ownership or protection
against repository rebinding. The second review found these gaps; the earlier implementation
description must be read with these qualifications. No cross-account bypass was confirmed.

| Priority | Finding and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Smallest useful fix / verification                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2       | Mobile retains an origin by source key without checking its current remote. After A→B handoff for repository X, rebinding A to Y can produce an invalid origin-Y/reader-X pair. X PRs receive Y's destination and cache key. `apps/mobile/src/scm/pulls/list/use-pulls.ts:132`. Astra reproduced the invalid pairing in memory; parent inspected the pairing and mapping.                                                                                                     | Require matching remote identities when resolving retained origins; invalidate changed associations and prevent duplicate origin keys. Test handoff followed by X→Y rebind, including cache and navigation ownership.                                  |
| P2       | Read guards pass the discovered account but omit the discovered destination. Rebinding an alternate from X to Y under the same account between discovery and dispatch therefore passes the account guard. `apps/mobile/src/scm/source-reader.ts:40`, `packages/extension-scm/src/connections/source-readers.ts:153`; runtime `scm/forges/integration/source-context.ts:18` already supports both guards. Astra reproduced acceptance using actual guard/read implementations. | Forward the freshly discovered **reader** destination as `expectedDestination`, including pagination. Preserve origin destination only when mapping results. Delay dispatch, rebind, and require rejection before provider reads or cache publication. |
| P2       | Desktop PR lists store the selected reader as `page.source`; opening its row navigates and mounts detail under that reader's runtime. Thus opening a new row after handoff transfers comments, merges and task ownership to B. `packages/extension-scm/src/pulls/list/use-pulls.ts:75`, `view.tsx:128,684`. Parent confirmed callers; cold-recovery fixture currently expects B as page source.                                                                               | Retain separate origin and reader fields throughout desktop lists. Use origin for navigation, destinations, caches and actions. Test opening rows after warm/cold handoff and require writes to remain unavailable while origin A is offline.          |

### Additional runtime and desktop findings

| Priority | Finding and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Smallest useful fix / verification                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Startup artifact cleanup equates absence from hydrated tasks with deletion. Invalid task metadata is intentionally omitted and preserved for recovery, but its artifacts are permanently deleted. `packages/runtime/src/artifacts/artifacts.ts:60`, `storage/workspace.ts:133`. Astra reproduced artifact count 1→0 with actual classes/in-memory SQLite despite forever retention; metadata recovery records survived. Parent confirmed the cleanup and omission paths. | Preserve artifacts belonging to quarantined/unreadable tasks; distinguish failed hydration from explicit deletion. Test artifact revisions surviving recovery and metadata repair, alongside explicit deletion.       |
| P2       | Desktop registry writes bypass the browser's conflict-aware merge and change notification. A stale main/thread window can overwrite another window's updated connections. `packages/studio-core/src/workspace/runtime-registry.ts:108`. Astra reproduced stale overwrite and zero notifications using actual registry functions with mocked Electron storage.                                                                                                            | Merge atomically in the main process with each writer's prior registry and notify other renderers. Test independent window edits, conflicting changes and disconnect after another window changes connection details. |
| P2       | Encrypted registry IPC writes all use `runtime-connections.enc.tmp`. Concurrent saves can overwrite the shared temporary file, acknowledge the wrong payload and fail the other rename with ENOENT. `apps/desktop/electron/connection-storage.ts:77`. Astra reproduced the interleaving with the actual handler and controlled filesystem promises; parent confirmed shared filename and absent serialization.                                                           | Serialize main-process persistence and use unique temporary files with cleanup. Test delayed concurrent writes and that acknowledgements match committed payloads.                                                    |
| P2       | Discovery PID liveness blocks startup before the process lock can reject pre-boot metadata. An unrelated same-user process reusing the saved PID after reboot can prevent runtime startup. `apps/desktop/electron/local-runtime.ts:116`; compare the boot-age check in `packages/runtime/src/storage/process-lock.ts:38`. Confirmed control flow, not a reboot reproduction.                                                                                             | Reject pre-boot discovery metadata before PID liveness checks. Test old discovery with a live unrelated PID while preserving protection for a genuine current-boot runtime.                                           |

### Lower-priority runtime findings

Fable's runtime review added four source-supported findings; parent inspected each path:

| Priority | Finding                                                                                                                                                                                                                                                                                                                          | Smallest useful fix / verification                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3       | Repeated SIGINT/SIGTERM only abort an already-aborted controller. A stuck shutdown finalizer therefore ignores a second Ctrl-C. `apps/api/src/shutdown-signal.ts:7`; HTTP shutdown waits for accepted work. Control flow confirmed, no live hung-child reproduction.                                                             | Define a deliberate second-signal forced-exit policy and test first graceful/second forced shutdown with a fake emitter and a hanging child.                                      |
| P3       | A failed external-listener rebind leaves `current.error`; reapplying the still-active original host/port returns early without clearing it. `packages/runtime/src/http/external-listener.ts:57,84`.                                                                                                                              | Clear the obsolete error on a successful no-op. Test active A, failed bind B, then reapply A and check healthy status.                                                            |
| P4       | Effect finalizers execute last-in-first-out. The registration list in `packages/runtime/src/index.ts:70` therefore stops housekeeping and watchers after downstream services, contrary to the dependency-order comment. Fable checked Effect's ordering with a scratch program; production shutdown ordering was not reproduced. | Establish the intended shutdown order and register accordingly, preserving flush/dispose dependencies. Add a shutdown test that records order and in-flight scheduler completion. |
| P4       | Connection-file release calls the throwing parser without handling malformed/replaced discovery content. Shutdown can become a failed scope rather than simply leaving a file it no longer owns. `apps/api/src/connection.ts:53`.                                                                                                | Treat an unreadable/replaced discovery file as unowned during cleanup; only remove matching parsed ownership. Test malformed and other-process files.                             |

Two additional runtime hypotheses remain unmeasured/unreproduced: same-boot PID reuse can trip the
legacy process-lock liveness check even after SQLite admission, and synchronous backup
`PRAGMA quick_check` may block the event loop on large databases. Preserve older-runtime lock
compatibility when investigating the first; benchmark the second before introducing worker code.
These do not establish a need for either suggested architectural change.

### Dead-code refinements and verification

Fable's tooling review reconfirmed the first-round removal candidates and added:

- `TaskHistories.clear` (`packages/runtime/src/storage/task-histories.ts:108`) and
  `RuntimeMutations.acknowledgeWorkspaceEffect`
  (`packages/protocol/src/runtime/connection/mutations.ts:460`) have no repository callers. Parent
  also checked references.
- Removing `useDetailChrome` should remove its exclusive `setDetail` navigation context field, the
  workbench provider value and the now-unused effect import together.
- Several Fallow findings are redundant exports rather than unused implementations: `jiraRemoteKey`,
  `discoverSourceIdentity`, `overviewWorkspace`, `agentBrowserCommandSchema`, `remoteOpenSchema`,
  `remoteDeviceId`, `preparedRuntime`; also an unused `worktreesRoot` re-export. Preserve internal
  callers. Test-facing app exports remain intentional.
- The broad entry patterns certainly hide unused exports. Fable did not find an additional
  unimported app file in its scan; Metro platform variants remain valid. The first report's
  file-level warning is a configuration limitation, not proof of unused files.
- The application-state hooks have a small platform-specific difference: studio-core re-exports
  `ApplicationStateProvider`. Sharing this small hook does not justify a package change by itself.
- `@dovo/protocol` is private, so no published-package API migration was identified for the six
  unused declarations. Still inspect serialized/configuration consumers before deleting schemas.
- `@xterm/headless` is used by `packages/runtime/src/terminal/terminal-shell.test.ts`; its
  unused-dev-dependency finding is another confirmed Fallow false positive.
- The PATCH `/api/workspace` rejection handling in `MutationReceipts.execute` is bypassed by
  production route dispatch to `executeWorkspace` and is exercised directly by tests. Treat it as a
  defensive-code review candidate, not an automatic deletion: decide whether that method's contract
  intentionally rejects accidental use, then update the related tests consistently.

Fable reported these successful checks: 38 tests across the source-reader, verified-reader,
local-runtime and task-commit files; `scripts/check-mobile-pull-handoff-browser.mjs`; and direct
execution of `packages/studio-core/src/workspace/scope.browser.mjs`. The scope suite is functional
but remains outside the runner's `scripts/check-*-browser.mjs` discovery. Move/register it before
counting it as routine regression coverage. Existing tests do not cover Astra's repository-rebind
and desktop navigation findings, so their passing results do not invalidate those findings.

Two lower-confidence mobile follow-ups need dedicated reproduction: removing the origin profile
while a verified replica remains connected may retain an unusable origin association; explicit
source selection may reset a different selection key from the unfiltered collection's key. These are
hypotheses, not confirmed bugs. An explicit removal should have a deliberate ownership policy; do
not silently transfer action ownership to implement a suggested read recovery.

Verification in this round uses source/caller inspection and reviewers' in-memory reproductions.
These are not live GitHub, multi-window Electron or native-device end-to-end checks. Parent
reconfirmed the unused mobile navigation/scroll helpers and obsolete readiness strings. No
application code was changed as part of this audit round.

## Implementation follow-up — 15 October 2026

The two audit rounds above are preserved as historical findings. This section records the subsequent
implementation and supersedes their statements that confirmed findings remain unfixed. Unmeasured
hypotheses and optional architectural suggestions are not treated as established defects.

Implemented changes:

- GitHub read recovery retains separate origin and reader identities on desktop and mobile. Reads
  and pagination verify the reader's current account and destination; navigation, caches and
  mutation ownership remain with the origin. Automatic discovery rejects a changed destination under
  an unchanged source scope, including a rebind that precedes discovery. Explicit source selection
  can accept a new binding. An offline origin does not silently transfer write ownership.
- Desktop registry persistence merges each writer's changes atomically, serializes encrypted writes,
  uses unique temporary files and notifies other windows. Old HTTP responses cannot supersede a
  newer streamed runtime instance. Pre-boot discovery metadata no longer blocks startup through PID
  reuse.
- Artifact recovery uses durable explicit-deletion markers rather than treating failed task
  hydration as deletion. Browser startup shares its entire pending startup operation. Restart
  recovery uses consistent explicit, project and global policy precedence.
- Managed API startup loads allowlisted saved environment before spawning Node. Discovery cleanup
  preserves malformed or replaced files. Shutdown uses deliberate dependency ordering, flushes live
  activity before disposal and allows a second termination signal to force exit. A successful
  external-listener no-op clears a stale bind error.
- Mobile preference hydration preserves pending edits after failed storage reads. Desktop and mobile
  preset/settings sync track failures per runtime, so unrelated successes cannot hide failures and
  recovered runtimes no longer leave stale errors.
- Linked-checkout selection merges delayed lookup results into current input. Automation task
  creation preserves linked checkouts. Browser-profile removal cannot submit an unsaved rename. iOS
  file-drop reception resets before checking whether a window is still attached.
- Proven unused declarations, exports, navigation/scroll helpers and fixture-only components were
  removed. Coverage for removed UI fixtures was migrated to shipped controls. Cold-scope and preset
  synchronization browser suites are registered with the repository runner.
- Nineteen verification scripts now use the current titlebar connectivity predicate. Packaged
  verification uses the current Effect API. Fallow roots distinguish actual entry points from
  ordinary application modules while preserving Metro and native platform variants.

Audit correction: `overviewWorkspace` had no callers, rather than merely an unused export. Its
exclusive caches were removed; the active scoped workspace snapshot path remains. Test-facing and
platform exports were evaluated through callers, not deleted solely from scan output. Defensive
workspace PATCH rejection branches remain intentionally untouched pending a contract decision.

Verification evidence and remaining scope are recorded below. Native iOS compilation and device
interaction, live GitHub accounts, and native packaged-release behavior need platform/integration
environments. Electron pairing reached the app but this Linux session lacks an unlocked system
keychain. These are limitations of verification, not passing end-to-end results.

Credential and lifecycle hardening completed during implementation:

- Claude MCP environment/header configuration is stored in private temporary JSON files and passed
  by filename, keeping secrets out of the pinned SDK's generated process arguments. Files are
  removed on startup failure and session disposal.
- Coding harnesses receive rotating task/run credentials with a 12-hour expiry, rather than the
  runtime owner credential. HTTP authorization checks the endpoint allowlist, task/resource
  ownership, feature flags, memory scopes, read-only policy and sandbox restrictions. Owner and
  paired-device authentication remain separate. Retained MCP transports read the current grant
  through a private file; old copied tokens cannot authorize a later run.
- Live native child agents can retain their originating grant while their native session is still
  working. Idle warm sessions retain no grant. Replacement, explicit revocation, expiry and run
  cancellation abort active device operations. Delayed checkout/tunnel work rechecks authorization
  before dispatch. Cancellation checks before grant setup and binding preserve the existing
  `Cancelled` outcome rather than reporting a credential error.
- Pull-watcher disposal now drains all active refresh promises, including direct concurrent calls,
  instead of only interrupting the polling fiber. HTTP admission closes concurrently with scheduler
  draining; task services remain available until schedulers finish. Regression tests cover delayed
  provider responses, rejected responses and runtime shutdown.

The final Fallow scan reports **9 findings, down from the original 70**, with zero unused files,
unused dependencies or unresolved imports. The remaining findings are five existing import cycles,
two mobile verification-tool imports supplied by root-declared tooling, the test-used
`loadMobilePreferences` export, and the dynamically reached `ForgePullRequests.forDestination`
method. The scan still exits nonzero; no suppressions were added to pretend these issues
disappeared. Counts also reflect corrected entry roots and confirmed dynamic-dependency
configuration, so the reduction is not a count of removed defects. Optional duplication refactors,
same-boot PID-reuse compatibility investigation and large-database backup benchmarking remain
follow-ups.

Additional implementation-review corrections:

- The issue/pipeline list hook now separates its origin from its verified reader, just like PR
  lists. Opening a row first returned after handoff retains the origin runtime, destination and
  cache. Task creation and provider mutations remain unavailable while that origin is offline;
  reconnect enables operations against the same origin. Browser regressions exercise newly returned
  rows, pagination races, repository rebinding and reconnect requests.
- Stop and permission tightening revoke retained native-child grants synchronously before waiting
  for provider shutdown. A native child marked disposed cannot extend grant lifetime merely because
  its provider still reports working. Normal live native children continue to use their scoped
  grant. Delayed local device discovery and remote SSH acquisition now recheck authorization before
  dispatching device actions, and remote simulator preparation receives the same checks.

- Local simulator and physical-device constructors also check authorization/cancellation after
  asynchronous preparation, before spawning helpers or accessing devices. Startup failure closes RPC
  connections, signing resources and helper processes and removes temporary directories and
  cancellation listeners. Regressions hold directory creation, readiness, signing and ADB discovery
  while cancelling or revoking access. The final caller wiring passes both checks to all four
  constructors. Device hardware behavior remains unverified here.

Paired-destination cancellation requires the updated paired runtime. Cancelling a source request
cannot provide the new server-side checkpoints on an older destination runtime.

### Verification method and limits

The full test run uses the repository's Vite+ runner with two workers and unchanged test timeouts:
`pnpm exec env -u NPM_CONFIG_ALLOW_SCRIPTS -u npm_config_allow_scripts vp test --maxWorkers=2`. The
environment launcher injects `NPM_CONFIG_ALLOW_SCRIPTS=@opencode/cli`; current npm rejects that
command/environment option for the ACP fixture's project-prefix installation. Removing it from this
test process isolates the fixture without changing host configuration or production policy.
Concurrent broad test/build runs also hit resource-sensitive existing tests; their targeted reruns
passed. No tests or checks were disabled to resolve those failures.

Workspace typechecks use `pnpm -r --workspace-concurrency=2 typecheck`. The cached Vite+ task
wrapper failed to spawn TypeScript with `EINVAL`, while direct execution of the same package checks
passed. The managed API environment regression verifies the environment supplied to the Node child
before spawn; a deployed service/private-CA HTTPS handshake was not exercised.

Managed Chromium was installed through Playwright before browser verification. Browser coverage
includes desktop source readers and work navigation, desktop/mobile integration continuity,
destination guards, mobile PR handoff/pagination, Jira recovery, shared storage, runtime/workspace
recovery, preset sync, linked-checkout races, browser-profile cancellation, cold scope, thread
popouts, permission controls, mobile folder selection, diff scrolling and Git primary actions.
Transports and some presentation components are mocked in these fixture suites; live GitHub
accounts, actual multi-window native keychain persistence and device hardware were not exercised.

This implementation used Sol/Astra coding subagents with separate file ownership and independent
read-only review rounds. The original Sol/Opus and Fable/Astra audit sections remain above,
including the unsuccessful Muse configuration attempts. No commits or pull requests were requested
or created.

Final full-suite result: **3,666 tests passed, 11 existing tests skipped; 519 files passed and 3
files skipped; no failures**. This run includes the last constructor guards and caller wiring.

Final workspace typechecks passed. Scoped lint passed on all 153 changed/new code files, with one
pre-existing conditional-expect warning in `restart-recovery.test.ts`. The final Fallow scan
completed against the stable source tree and retains exactly the nine findings detailed above; it
exits nonzero for those findings. API and its recursive dependency builds passed.

Desktop and web production builds also passed. Formatting checks passed for all 156 changed/new
formattable files. The final combined diff was inspected and `git diff --check` passed. Remaining
work is the explicitly listed hypotheses/design recommendations, existing scan findings, and
platform/live-integration verification; no reproduced finding from the implementation review is left
awaiting a code fix.

## iPhone/iPad rendering follow-up — 2026-10-15

The mobile rendering follow-up preserves the audit changes above. The app supplies a resolved code
palette even for the default app theme, so its normal iOS diff path is the shared interactive
renderer. That renderer now uses Menlo on iOS and reserves horizontal space for tabs, wide glyphs,
Dynamic Type and car mode, including the line-number gutter. Source text and review coordinates
remain unchanged.

Markdown code blocks now honor the selected code theme and explicitly color token categories that
otherwise retained native library defaults. Inline artifact source previews now use the same fenced
Markdown path as expanded previews instead of rendering code as plain text. The native C++
highlighter ignored Tree-sitter text predicates, so uppercase-only TypeScript type rules matched
every identifier and overwrote function and variable colors. The dependency patch now evaluates the
pinned subset’s text predicates; a host regression compiles the actual highlighter and verifies
token categories, aliases and UTF-16 offsets. Native highlighting preparation validates the
completion marker, queries (including inherited queries), headers and scanners, rather than
accepting parser files from an incomplete download. Incomplete assets trigger a forced vendor repair
and a final validation; this does not establish that Dominic's installed app had incomplete assets.

Verification: 15 focused Vite+ tests and 14 native-asset preparation tests passed. The mobile review
Chromium fixture passed, including default-theme routing, syntax colors, accessibility sizing, line
comments and annotations. Mobile TypeScript, scoped formatting, and the iOS Metro/Hermes export
passed. The installed native highlighting assets passed preparation validation. Browser fixtures
mock React Native/native views; no iOS simulator or physical device was available in this Linux
checkout, so native visual behavior remains unverified. Native asset repairs require rebuilding an
app whose installed binary lacks highlighting support.

Reproduce the native engine check with `node scripts/check-mobile-markdown-highlighting.mjs`
(requires Clang), and the asset recovery tests with
`node --test scripts/prepare-mobile-markdown.test.mjs`.

## Mobile connection reliability follow-up — 2026-10-15

The HTTP fallback polling error callback duplicated state publication already owned by
`refreshProfileEffect`. The inner path rejects stale results using the per-runtime sequence, but the
outer callback could still mark a runtime disconnected after a newer streamed snapshot arrived.
Removed the duplicate publication; current request failures retain their existing error and
unauthorized handling and polling backoff.

The managed Chromium registry-recovery fixture reproduced the false-offline state before this fix
and passes afterward. It additionally checks network wakeups, a streamed restart with a lower
revision, genuine current-request failure, recovery by stream, background/foreground restart, and
rejection of late callbacks from a stopped stream. The fixture uses the actual provider and polling
worker with simulated network/AppState boundaries; this is not physical Wi-Fi/cellular/VPN testing.
Eleven polling/overview unit tests, mobile TypeScript and scoped lint passed.

## UI audit follow-up — 2026-10-15

The spacing/styling audit is recorded separately in
[ui-audit-2026-10-15.md](ui-audit-2026-10-15.md). It contains 17 actionable findings and one polish
observation, with affected screens, source locations, priorities, browser evidence and native-device
verification limits. The subsequent authorized fix pass implements all 17 findings and the polish
item; its resolution mapping and verification evidence are preserved in that report. The mobile
connection reliability fix above is also implemented.
