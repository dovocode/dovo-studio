# Workspace and composer stability audit — 2026-11-12

The first priority is durable desktop draft storage. Next, bound mobile draft memory and measure
retained Unified views. Keep HTTP LAN/VPN access, optional HTTPS, pairing codes and device tokens.
No account service or connection policy change is needed.

This audit covers desktop/web and mobile drafts, Unified view lifetimes, runtime synchronization,
read caches, connection recovery and runtime backups. It combines source review, isolated probes and
existing regression tests. It does not prove app-wide stability. Earlier findings and fixes remain
recorded in the [October audit](stability-audit-2026-10-29.md) and its linked follow-ups.

## Open findings

| Priority | Finding                                                           | Evidence                                                                          | Recommended change                                                         |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P1       | Desktop can lose the last unsaved keystrokes when the page closes | Reproduced with the actual draft hook in Chromium and an isolated storage adapter | Write drafts to durable local storage before delayed runtime sync          |
| P2       | Mobile retains inactive draft text in memory                      | Measured with actual draft storage and synthetic drafts after garbage collection  | Evict clean inactive records; retain dirty and pending work                |
| P2       | Unified retains every opened thread/terminal view                 | Source review; total memory growth not measured                                   | Measure long sessions, then suspend inactive views with state preservation |
| P2       | Rich editor import failure has no local recovery                  | Source review; chunk failure not injected                                         | Fall back to source input and preserve the draft                           |

P1 means a confirmed path to loss of unsent text. P2 means a resource or recovery risk. These open
findings are investigation results. This change does not implement the proposed storage or view
lifetime changes.

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
run was performed. The next useful implementation is the draft journal with failure tests, then safe
mobile cache eviction. Measure Unified retention before changing its lifetime model.
