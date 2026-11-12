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
vary by runtime. The close probe currently reports `stored: null` and `restored: null`.

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
