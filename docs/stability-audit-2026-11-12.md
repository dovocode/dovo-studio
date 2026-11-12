# Workspace and composer stability audit — 2026-11-12

Desktop message drafts and ordinary question answers now have local recovery. The rich editor has a
source fallback. Update actions, issue drafts, thumbnails and refresh feedback also have fixes. The
follow-up sections below record behavior and checks. Mobile draft memory and retained Unified views
still need measurements in real use. HTTP LAN/VPN access, optional HTTPS, pairing codes and device
tokens remain supported.

This audit covers desktop/web and mobile drafts, Unified view lifetimes, runtime synchronization,
read caches, connection recovery and runtime backups. It combines source review, isolated probes and
existing regression tests. It does not prove app-wide stability. Earlier findings and fixes remain
recorded in the [October audit](stability-audit-2026-10-29.md) and its linked follow-ups.

## Original audit findings

| Priority | Finding                                                           | Evidence                                                                          | Recommended change                                                         |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1       | Desktop can lose the last unsaved keystrokes when the page closes | Reproduced with the actual draft hook in Chromium and an isolated storage adapter | Write drafts to durable local storage before delayed runtime sync          |
| P2       | Mobile retains inactive draft text in memory                      | Measured with actual draft storage and synthetic drafts after garbage collection  | Evict clean inactive records; retain dirty and pending work                |
| P2       | Unified retains every opened thread/terminal view                 | Source review; total memory growth not measured                                   | Measure long sessions, then suspend inactive views with state preservation |
| P2       | Rich editor import failure has no local recovery                  | Source review; chunk failure not injected                                         | Fall back to source input and preserve the draft                           |

P1 means a confirmed path to loss of unsent text. P2 means a resource or recovery risk. These
findings describe the initial investigation. The recovery follow-up below addresses desktop draft
storage and editor load failure. It does not change mobile draft memory or Unified view lifetimes.

### Desktop draft close window

[`createComposerDraft`](../packages/extension-tasks/src/chat/composer/composer-draft.ts) delays
writes by 300 ms.
[`useComposerDraft`](../packages/extension-tasks/src/chat/composer/use-composer-draft.ts) flushes on
React cleanup, but does not flush on page hide. A browser close does not guarantee React cleanup.
The workspace provider has its own persistence and page-hide path. It cannot save text that the
composer has not yet passed to it.

The probe mounts the real hook. Its workspace adapter writes immediately to an isolated browser
origin. It updates the draft, dispatches page hide and closes the page before the debounce. On
reopen, the stored value is absent. This isolates the composer lifecycle gap. It does not measure
the full application's additional persistence and outbox timing.

Implement a local draft journal scoped to the paired runtime and thread. Save local edits before
runtime sync. Reconcile acknowledged sends against the submitted draft revision so a delayed result
cannot clear new typing. Add lifecycle flush as a supplement. Lifecycle handlers alone cannot
protect against process termination or a crash. Test close, restart, failed storage writes,
remounts, offline edits and delayed send acknowledgements.

### Mobile draft retention

[`createDraftStorage`](../apps/mobile/src/tasks/draft/storage.ts) retains records and published text
in maps after subscribers leave and writes finish. The probe writes 500 synthetic drafts of 48,000
characters each, unsubscribes, waits for each write and forces garbage collection. It retains about
23.33 MiB of JavaScript heap. This is retained text in a Node fixture, not a phone memory-pressure
measurement or a claim that all normal drafts are this large.

Evict only clean, inactive memory records. Preserve disk drafts, pending writes, append/delivery
receipts and active subscribers. Test rehydration after eviction, interrupted writes, concurrent
append/typing, scope changes and acknowledged sends. Never delete unsent disk drafts to reduce
memory.

### Unified view lifetime

[`openWorkspaceTab`](../packages/extension-tasks/src/unified/workspace-tabs.ts) keeps references
until explicit close or confirmed removal.
[`WorkspaceContent`](../packages/extension-tasks/src/unified/workspace-view.tsx) mounts non-browser
views under React `Activity`. Hidden effects pause, but component state remains. Each visited thread
can therefore retain editor and conversation state for the window's lifetime. This retention
preserves useful state; a blind tab limit could lose work.

Measure heap and mounted views over a realistic long session before setting a budget. Separate
recoverable view state from live resources. Keep drafts, pending sends, selection, scroll position
and terminal identity safe before suspending inactive views. Do not terminate remote shells when
suspending their UI. Test repeated navigation, offline recovery and reopen behavior.

### Rich editor load recovery

[`composer-mode.tsx`](../packages/extension-tasks/src/chat/composer/composer-mode.tsx) preloads the
editor without a rejection handler. The editor is also loaded through React lazy loading. A failed
chunk can reach a wider error boundary; retrying the same rejected lazy import is not a complete
recovery strategy. This path is source-confirmed. It was not fault-injected in this audit.

Use a composer-local load error state with the source input available. Keep draft text and focus
available. Report the error and provide a deliberate retry. Test an unavailable chunk, a stale
client build, restored connectivity and a non-empty draft.

## Safeguards reviewed

- Runtime synchronization checks revisions and keeps pending edits scoped to their computer and
  credential identity. Existing tests cover stale responses and connection changes.
- Live sync has bounded reconnect delay with jitter, resume handling and heartbeat recovery.
  Temporary network loss must remain distinct from confirmed authentication failure.
- Snapshot retention uses count/size bounds and weak references. Conversation read caches also have
  explicit bounds. These controls do not bound component state or mobile draft maps.
- Runtime backup tests cover damaged and missing storage paths. Existing error boundaries limit
  screen failures. They do not establish recovery from every crash or disk failure.

The focused stability suite passed 154 tests in 11 files. It covers workspace updates/registry, live
sync, read cache, mobile draft storage, backups, socket heartbeats, desktop draft controllers and
Unified tab lifecycle. Tests use controlled fixtures. They do not establish real network, OS
termination or physical-device behavior.

## Changes verified in this work

Unified now uses shared prompt/page activity ordering on desktop and mobile. Stream output does not
move threads. Desktop also follows the saved section order. Composer chips preserve the saved
Markdown source. The rich editor's source-position mapping also fixes caret offsets after emoji. See
[composer references](composer-references.md) for native checks and their limits.

## Reproduce

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node scripts/investigate-workspace-stability.mjs
pnpm exec vp test packages/studio-core/src/workspace/runtime-updates.test.ts packages/studio-core/src/workspace/runtime-registry.test.ts packages/protocol/src/runtime/connection/live-sync.test.ts packages/protocol/src/runtime/cache/read-cache.test.ts apps/mobile/src/tasks/draft/storage.test.ts packages/runtime/src/storage/backups.test.ts packages/runtime/src/storage/backup.test.ts packages/client-runtime/src/effects/socket-heartbeat.test.ts packages/extension-tasks/src/chat/composer/composer-draft.test.ts packages/extension-tasks/src/chat/composer/use-composer-draft.test.ts packages/extension-tasks/src/unified/workspace-tabs.test.ts
```

The probe uses synthetic drafts and temporary files. It does not open user runtime storage. Its
output reports observations; successful exit does not mean that the findings are fixed. Heap numbers
vary by runtime. The original close probe reported `stored: null` and `restored: null`. The current
probe preserves both values after the recovery changes.

No full-app soak test, physical phone test, production fault injection, disk-full test or hosted CI
run was performed. The draft journal follow-up is described below. Measure mobile and Unified
retention in realistic sessions before changing their memory or lifetime model.

## Recovery changes

The follow-up implementation adds local message draft records, ordinary question answer recovery,
and a source-editor fallback with deliberate reload retry. See
[Composer and question recovery](composer-recovery.md) for behavior, retention limits and exact
verification commands. The original observations above remain the audit evidence. The follow-up
browser check injects an actual editor chunk HTTP 404.

## Runtime identity, forms and refresh follow-up

Computer update actions now capture the exact target, address, device token and runtime ID. Changing
or removing that binding clears its selection, progress and automatic restart intent. Pending reads
and commands cannot attach their results to the replacement connection. A temporary disconnect with
the same binding keeps update progress. A command already sent to the old computer can still finish
there; changing the connection does not cancel a remote installer.

Issue forms retain all edited fields for this app session. The former 200-field limit could discard
unsent text. Fields that match their initial value no longer need a cache entry. Successful
submission still clears the form draft. This change does not add form recovery after app
termination.

Desktop image attachment rows request a 128-pixel preview from the existing task image route.
Opening or downloading the attachment still reads the original. The preview uses the MIME type
returned by the runtime. Connection changes invalidate pending thumbnail results. The HTTP
regression checks verify a 2048 × 1024 source produces a 128 × 64 preview and preserves the original
and task ownership. This verifies request and image size bounds; it does not measure full-app frame
time or network load.

Changes, Git status and watching refresh failures share one compact thread notice. Expand it for
source details. Retry reads the failed sources again. Successful refreshes remove their own errors.
A failed Stop watching action remains visible through later background reads. Send, Save and Stop
agent errors keep their existing feedback. Standalone panels show a local compact notice.

Run these checks from the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/protocol/src/runtime/connection/runtime-upgrades.test.ts packages/extension-tasks/src/detail/live-refresh.test.ts packages/runtime/src/http/task-images.test.ts --maxWorkers=1
pnpm test:stability-recovery:browser
pnpm test:attachment-media:browser
```

The browser checks mount the real hooks and attachment component with controlled requests. They
verify more than 200 edited form fields, form reset, combined refresh details, successful and failed
Retry, persistent action errors, bounded image requests, original reads and stale thumbnail replies.
They do not run an installed desktop updater or a signed release package.

Local release validation passed the production build, full typecheck and formatting/lint check. The
full unit and integration run passed 7,731 tests, skipped 14 and failed six sandboxed runtime
browser tests. Those six fail because this host blocks Chromium user namespaces. A separate run
confirmed the sandbox failure. Hosted CI enables those namespaces through its existing browser
setup. No production sandbox setting was changed. Focused managed Chromium checks passed for the new
behavior, computer updates and desktop/mobile watching lifecycles. The refresh notice also passed a
visual check with the built desktop CSS at a 360-pixel viewport. Signed installer and
physical-device checks remain outside this local verification.

## Hosted browser gate follow-up

The first nightly check stopped at stale browser fixtures. Startup and manual-model fixtures now
export the real composer recovery helpers, use a storage-capable HTTP origin and load the real
refresh hook. The shared mobile search fixture now uses the runtime's Effect read API. The side-chat
fixture also uses the current recovery and refresh contracts. The checkpoint fixture verifies the
128-pixel thumbnail request. The watching-panel fixture verifies the compact refresh notice, error
details and Retry while keeping the mobile alert check.

Artifact sharing and PDF export canaries use a unique localhost hostname. This separates browser
requests from the host runtime's automatic port probes. Each check also sends a deliberate browser
request to prove that the canary detects egress. Production sandbox rules remain unchanged.

The hosted unit job also found a Chromium startup race. The real desktop CDP test now waits for
`DevToolsActivePort` to contain a valid port. It also closes Chromium if endpoint discovery fails.
All three tests in that file pass locally. The failed browser suites and their remaining shard
checks pass locally in sequential segments. One workspace check timed out on the first local run;
two later runs passed without changes. This does not prove that the check cannot be intermittent.

These are test fixes. Signed package checks and nightly publication still depend on hosted CI for
the replacement tag.

The recovery browser fixture now subscribes directly to preference snapshots and selects the source
textarea explicitly. It waits for the replacement controller after each remount and for a new saved
workspace snapshot after retyping. This prevents it from editing an old editor or checking a send
acknowledgement before the new draft has saved. The complete recovery browser check passes locally.

Nightly .824 also had an interrupted npm grammar download before shard 0 started its browser tests.
The pinned archive downloads in full on a fresh request. All 14 asset-repair tests and all 45 shard
0 browser suites pass locally through the CI runner. Hosted reruns and package checks remain
required.

## Desktop and mobile performance and visual follow-up

Unified thread rows now keep stable commands and reuse unchanged row props. Commands resolve the
latest committed task and computer. The host API also keeps its identity across browser-tab updates.
Selection updates only the previous and next root, including their retained Home copies.

The Chromium fixture streams 30 updates into a thread in the closed Working section. Its 99
unchanged mounted rows produced 2,970 `TaskRow` execution-icon renders before the fix and zero after
it. Changing one visible title produces one render. Thirty browser-title updates keep one host API
identity. These are render counts in a controlled fixture, not app frame-time measurements.

Desktop and mobile now separate loading, offline, cache-read failure, failed recovery and confirmed
pairing rejection. Retry reads the cache again and refreshes the selected computer. Busy recovery
keeps a disabled action visible. Mobile recovery state belongs to the exact computer, connection,
thread and connection state, so old errors cannot return after reconnecting. Desktop main, split and
browser thread panels expose recovery. The read-only share view keeps its existing behavior.

Mobile keeps the two-line, 44-point title area, Back action, runtime subtitle and toolbar positions
while history loads. Saved file edits keep Changes available in the header. Pending controls stay
disabled, including the title menu. Unified Thread, Browser and Terminal titles use inline 14-pixel
type icons with a 6-pixel gap. Mobile resource rows use the normal menu icon and a browser favicon
when the tab supplies one.

Mobile working-tree review refresh now requests `includeFiles: false` and decodes
`responses.changesRefresh`. Live sync still supplies the authoritative files. Branch and linked
checkout reads retain file bodies. The real mobile review action passes checks with both lightweight
and old-runtime file replies.

Clean inactive mobile draft records now leave memory after the final subscriber and serialized
operation finish. Disk drafts stay intact. Dirty text, pending writes, queued operations and
recovery journals stay in memory. Published typing also stays if reading the prior disk record
failed. The 44 storage tests cover rehydration, write failure, concurrent append/typing and receipt
deduplication. The current 500-draft Node probe retained about 0.39 MiB after collection. The
original audit recorded 23.33 MiB for the same synthetic workload; that baseline was not rerun in
this follow-up. This does not measure native phone memory.

Opus and Fable 5.2 completed a second source review and checked the corrections. Their findings led
to the scoped recovery action, stable host identity, selection scope, failed-read draft guard and
pending-header fixes. They found no further concrete defects in their final source pass. The parent
ran the checks; the reviewers did not run native tests.

Run the focused checks from the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test apps/mobile/src/tasks/draft/storage.test.ts packages/runtime/src/http/scm-mutations.test.ts packages/protocol/src/runtime/connection/runtime-fleet.test.ts --maxWorkers=1
DOVO_WORKSPACE_SCREENSHOTS=1 node scripts/check-unified-workspace-browser.mjs
pnpm test:thread-scroll:browser
node scripts/check-mobile-draft-transition-browser.mjs
node scripts/check-mobile-workspace-overview-browser.mjs
pnpm test:mobile-task-list-rendering:browser
node scripts/investigate-workspace-stability.mjs
pnpm --filter @dovo/studio-core --filter @dovo/extension-tasks -r typecheck
pnpm --filter @dovo/mobile typecheck
pnpm exec vp check
git diff --check
```

The focused unit checks pass 70 tests. Browser fixtures mount production components with isolated
runtime, storage and native-control adapters. They cover failed cache reads, recovery busy/error
states, automatic reconnect, pairing guidance, saved file edits and old-runtime refresh replies. The
runtime boundary test distinguishes HTTP 401 from 503 and preserves last-known data. It does not
inject a provider-level 401 or live-sync fault through the complete desktop UI.

The current changes have no hosted CI or full native-app verification. Device Hub found simulators,
but no current full-app install was tested. Native header geometry, gestures, physical-phone resume,
long-session Unified view retention and end-to-end frame times still need measurements. No lifetime
cap or transport redesign was added without that evidence.

## Third review: fixes and verification

The third Opus and Fable 5.2 review led to these fixes:

| Finding                                                                                                            | Change                                                                                                                                       | Local evidence                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The mobile empty-workspace starter lost typed commands or skipped terminal navigation when the first item arrived. | Keep the starter mounted while it has text, focus, options, an error or pending work.                                                        | A real overview/starter fixture retains the command after an external terminal arrives. Its own terminal refresh also completes navigation once.                                                                   |
| Learning alternate network routes hid mobile instructions and invalidated starter ownership.                       | Key those drafts and receipts by computer ID, primary address and token. Desktop instructions use the same rule.                             | Both instruction editors retain the visible draft. A delayed starter send retains its model, sends once and opens its thread after route learning.                                                                 |
| Mobile Unified rows rendered on every streamed update.                                                             | Retain tree nodes, stable row commands and stable row projections. Pass child attention separately.                                          | For 100 unchanged mounted rows and 30 hidden-thread updates, row-menu renders fall from 3,000 to zero. One renamed row renders once and opens the correct thread. Remote-child attention still updates its parent. |
| Decoded desktop registries reset scoped transport effects.                                                         | Retain equal profiles and connections. A computer rename keeps its request callback. A replacement connection gets a separate request owner. | The real workspace provider keeps the scoped effect mounted after an unrelated registry write and a rename. A retained old callback rejects requests after credential replacement.                                 |
| Mobile terminal routes reported unavailable or closed before loading finished.                                     | Use runtime reachability and snapshot readiness. Show pairing rejection separately.                                                          | Connecting and online-without-snapshot states show Loading. Only a loaded snapshot confirms absence.                                                                                                               |
| Desktop fallback history stopped loading when its revision changed.                                                | Read the aggregate cache again when the summary history revision changes.                                                                    | The cache fixture loads revision 1 automatically. This helps only when the cache contains the matching history.                                                                                                    |

The mobile render counts come from Chromium adapters that mount all rows. They do not measure native
FlatList frame times. The desktop transport check measures effect identity, not a live PTY or
terminal replay. Native phone behavior and hosted CI remain unverified for these changes.

Antigravity now has a built-in agent profile, `dovo:antigravity`. Its configuration calls the
installed `agy` CLI with `acp`. Dovo ships the configuration; installation, updates and Google login
remain on the runtime host. Existing profile overrides still apply. Model discovery and execution
also accept an ACP model option with ID `model` when its optional category is absent, as in T3's
Antigravity support tests.

The Antigravity subprocess test uses a temporary executable named `agy` on PATH. It verifies the
actual ACP transport, model discovery/selection, streamed text and session cleanup. It does not
contact Google. This POSIX fixture skips Windows; a real Windows CLI was not tested. No real `agy`
installation is available in this checkout, so real sign-in and model access remain unverified. See
[Antigravity setup](server-setup.md#antigravity-through-the-installed-cli).

Run these checks from the repository root:

```sh
pnpm exec playwright install chromium
node scripts/check-mobile-workspace-browser.mjs
node scripts/check-mobile-workspace-overview-browser.mjs
node scripts/check-mobile-task-list-rendering-browser.mjs
node scripts/check-harness-instructions-browser.mjs
node scripts/check-conversation-readiness-browser.mjs
node scripts/check-workspace-recovery-browser.mjs
node scripts/check-unified-workspace-browser.mjs
node scripts/check-scoped-agents-browser.mjs
pnpm exec vp test packages/protocol/src/tasks/agent-presets.test.ts packages/protocol/src/runtime/connection/scoped-settings.test.ts packages/protocol/src/tasks/model-catalog-cache.test.ts packages/runtime/src/agents/providers/acp packages/runtime/src/agents/catalogs/acp.test.ts packages/runtime/src/agents/configuration/registry.test.ts packages/runtime/src/http/endpoints/agents-routes.test.ts packages/studio-core/src/workspace/runtime-registry.test.ts
pnpm --filter @dovo/protocol --filter @dovo/runtime --filter @dovo/studio-core --filter @dovo/extension-agents -r typecheck
pnpm --filter @dovo/mobile typecheck
pnpm exec vp check
git diff --check
```

The focused unit run passes 96 tests. The 49 ACP tests also pass after adding support for model
options without a category. The listed browser checks and five package type checks pass. Repository
checks report zero errors and 31 existing warnings. The compiled protocol package contains the
Antigravity profile with `agy` / `acp` and needs no separate configuration file.

## Fourth review: Changes drafts and hidden thread rendering

Opus reviewed visual and interaction behavior. Fable 5.2 reviewed performance paths. Both reviews
used source at `136af8c9`. The parent checked the cited callers and ran the render probe below.
These are follow-up findings. This round implements sent-message chips; it does not change these
draft or view-lifetime paths.

| Priority | Finding                                                                                           | Evidence                                                                 | Smallest next change                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| P1       | Changes can discard unsent commit messages, file feedback and line comments when controls unmount | Source-confirmed on desktop and mobile                                   | Store drafts by runtime, checkout/thread and file/range; clear only the submitted revision after success       |
| P2       | Hidden Unified thread bodies render during updates to another thread                              | Measured in a Chromium fixture; production propagation checked in source | First memoize cached history reconstruction, then measure view subscriptions before changing hidden-view state |
| P2       | Closing thread search removes the focused control without restoring focus                         | Source-confirmed; no keyboard interaction test in this round             | Return focus to its opener or the composer                                                                     |

### Preserve Changes drafts first

Desktop `review/commit-bar.tsx` keeps its message in component state. Closing the action tray
removes it in `review/review-pane.tsx`. Switching away from Changes removes the pane in `view.tsx`.
`ReviewFeedback` also keeps local text and remounts for each `file.path`. `pierre-editor.tsx` mounts
`LineCommentForm` by range without passing its supported external draft props. On mobile,
`tasks/detail/commit-section.tsx` keeps the message in a component-local application-state atom.
Closing the Change actions sheet in `task-review.tsx` removes the component. That hook creates a new
atom on each mount; it is not a durable keyed draft store.

Reuse the existing Changes/detail draft stores. Keep runtime and checkout boundaries. Verify close
and reopen, file/range changes, offline use, app restart and delayed submit acknowledgements before
claiming recovery. This is the recommended next implementation slice because it protects user work.

### Hidden thread render probe

The production Unified workspace retains visited thread bodies under React `Activity`. Hidden
effects stop, but broad workspace context reads still allow background rendering. `TasksView` reads
that context. `use-cached-task.ts` also rebuilds `cachedThread(summary, history)` without
memoization. That call can allocate new task, file and turn projections for unchanged history.

The probe reuses the real `TasksView` fixture with zero or eight hidden thread bodies. It sends 30
updates to the visible parent thread. Panels and `ChatThread` remain test adapters. One measured
pair returned:

| Hidden threads | Visible chat calls | Hidden chat calls | Total chat calls |
| -------------- | ------------------ | ----------------- | ---------------- |
| 0              | 30                 | 0                 | 30               |
| 8              | 30                 | 140               | 170              |

Counts vary with React background scheduling. The fixture confirms extra renders, not a measured
frame-rate or memory regression. Its snapshots omit `detailTaskIds`, so it does not measure the
additional cached-history reconstruction cost. The scope provider is also an adapter. Do not infer
an end-to-end speedup from these counts or freeze workspace contexts without checking updates,
drafts, reconnects and pending work on reactivation.

Reproduce from the repository root:

```sh
pnpm exec playwright install chromium
HIDDEN=0 node scripts/investigate-hidden-thread-rendering.mjs | node --input-type=module
HIDDEN=8 node scripts/investigate-hidden-thread-rendering.mjs | node --input-type=module
```

The inline `onUseTemplate` callback in `detail/task-conversation.tsx` is a separate render-cost
lead. It reaches memoized messages, but this round does not isolate its cost. The branch-plus-local
Changes source also reloads full diff bodies through `useLiveRefresh` every 15 seconds while active.
Its payload and runtime cost remain unmeasured. Neither lead justifies a redesign yet.

## Fourth review fixes and mobile Send

The three follow-up findings are now fixed locally. These changes are not part of nightly `.829`.

Changes retains desktop commit messages, file feedback and line comments in the existing draft
store. Line comments retain the comment, replacement text and suggestion toggle together. Mobile
commit messages use the existing detail draft cache. Keys include the computer pairing, thread,
checkout and file/range where needed. A successful request clears only the draft entry it submitted.
A new edit with the same text has a different entry identity and survives an older acknowledgement.
Generated commit messages cannot replace text entered after a panel reopened.

This retention lasts while the app process stays open. It does not add disk storage or app-restart
recovery for Changes drafts. Mobile retains its existing capacity limit and reports when all
retained drafts are dirty. Desktop never evicts unsaved text.

Send now reads the rich native input before it creates a message attempt. The native view commits
IME composition and returns full source text, its event count and draft revision. The adapter
rejects reads that cross a draft/view change. It acknowledges the snapshot count and ignores older
queued keyboard events. Read failures keep the draft and report an error. The existing action
semaphore blocks repeat taps. Delayed delivery keeps text entered after the snapshot. Older
installed native modules use the standard input until the app binary includes the new snapshot
method.

Hidden Unified threads retain their last workspace context until activation. The scope stays outside
React Activity so host ownership checks stay current. Token replacement bypasses the retained
context. Old optimistic callbacks fail after host switches, token replacement or removal. Cached
history reconstruction and the template callback now keep stable identities for unchanged inputs.

The updated Chromium probe uses the real scope and memoized thread view. Eight hidden threads
received zero ChatThread calls during 30 updates to the visible thread; the visible thread
received 30. The earlier fixture counted 140 hidden calls. These are adapted render counts, not
frame rate or memory measurements. Broad context consumers can still render in React's hidden
background work; the focused cache check confirms that this does not reconstruct unchanged history.
Activation checks preserve input and scroll state and show the latest workspace.

Thread search now focuses its input. Escape and Close return focus to its opener, or the composer if
the opener no longer exists. An explicit message reveal keeps its own navigation behavior.

Verification commands:

```sh
pnpm exec playwright install chromium
pnpm test:stability-recovery:browser
node scripts/check-diff-resize-browser.mjs
node scripts/check-thread-streaming-browser.mjs
node scripts/check-mobile-settled-send-browser.mjs
node scripts/check-native-composer-bridge-browser.mjs
node scripts/check-workspace-recovery-browser.mjs
node scripts/check-mobile-draft-transition-browser.mjs
node scripts/check-unified-workspace-browser.mjs
HIDDEN=8 node scripts/investigate-hidden-thread-rendering.mjs | node --input-type=module
pnpm --filter @dovo/extension-scm --filter @dovo/studio-core --filter @dovo/extension-tasks --filter @dovo/mobile -r typecheck
```

On the authorized Mac, the UIKit simulator harness passed 57 checks, including source text behind
chips, pending native edits, IME commit and acknowledged clear. The Android emulator passed seven
instrumentation tests. Those tests stub the absent JS runtime at the event boundary. Both real Expo
module builds passed. JS adapter and conversation-action browser checks cover full payloads, late
events, duplicate taps, read failures, scope changes, retries and new edits during delivery. A full
Expo app send on physical hardware and hosted CI for this local diff remain unverified.
