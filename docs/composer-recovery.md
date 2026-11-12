# Composer and question recovery

Desktop and web message drafts use a local write-ahead record on each edit. Runtime sync still uses
the workspace outbox and its existing reconciliation. The local record covers the 300 ms composer
delay and page teardown. Page hide and visibility changes also flush the composer.

Records use the runtime ID, credential identity and thread ID. Legacy connections without a runtime
ID use the runtime origin. Known runtime IDs keep recovery records stable across LAN and VPN address
changes. Keys hash the credential; they do not contain the token. A runtime acknowledgement retires
the pending text and keeps a revision marker plus a synced backup. If the workspace cache differs
after reload, **Saved local draft** lets the user select and copy that backup. It does not replace
the workspace draft. An old send result cannot clear a newer record, including identical text typed
in a remounted composer. Offline records remain until sync succeeds. Storage errors keep the text in
memory and show an error. Keep the window open if local storage fails.

Ordinary question answers use one shared recovery store on both clients. Web uses local storage.
Mobile uses AsyncStorage with ordered writes. Each record includes the runtime credential scope,
thread ID, request ID, selected choices, exact custom text and supported attachment references.
Typed secret answers stay in the mounted form. The store excludes secret answers and secret
attachments. Secret references keep their existing send path. Mobile notification answers restore
only when there are no newer ordinary edits.

Navigation does not remove ordinary answers. A confirmed answer clears its unchanged record.
Declining, cancelling or expiring a request leaves edited answers available under **Saved answers**
in its thread. Select and copy the content to use it elsewhere. **Discard saved answers** removes
that record. Recovery does not append text to a message draft or change its order. Child-thread
answers remain available in the child thread.

Attachment recovery stores metadata and IDs, not another copy of the file. Existing upload receipts
and runtime retention rules still apply. Unreferenced queued uploads can expire after a day. A saved
reference does not guarantee that its file is still available. Reattach a missing file before
sending the answer. Recovery does not extend upload lifetimes.

If the rich editor chunk fails, the composer keeps the Markdown source input available. Startup
preload errors are handled. **Retry rich editor** saves the draft and caret, then reloads the page.
This loads the current build and clears the browser's rejected module graph. Retry does not reload
if saving fails. Switching editor modes does not wait on an unhandled import promise.

## Verification

From a fresh checkout, run:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/design --filter @dovo/protocol... --filter @dovo/client-runtime --filter @dovo/web-ui -r build
pnpm exec playwright install chromium
pnpm exec vp test packages/protocol/src/conversation/workflow/question-recovery.test.ts packages/studio-core/src/workspace/composer-recovery.test.ts packages/extension-tasks/src/chat/composer/composer-draft.test.ts packages/extension-tasks/src/chat/composer/use-composer-draft.test.ts packages/studio-core/src/runtime/synchronization.test.ts packages/extension-tasks/src/chat/composer/draft-reconciliation.test.ts apps/mobile/src/notifications/answers.test.ts
node scripts/check-composer-recovery-browser.mjs
node scripts/check-rich-composer-browser.mjs
node scripts/check-composer-send-browser.mjs
node scripts/check-desktop-stage-first-browser.mjs
node scripts/check-desktop-background-start-browser.mjs
node scripts/check-desktop-thread-start-browser.mjs
node scripts/check-composer-command-recovery-browser.mjs
node scripts/check-plan-mode-browser.mjs
node scripts/check-section-thread-browser.mjs
node scripts/check-shared-browser-browser.mjs
node scripts/check-question-attachments-browser.mjs
node scripts/check-composer-typing-browser.mjs
pnpm --filter @dovo/protocol --filter @dovo/studio-core --filter @dovo/studio-ui --filter @dovo/extension-tasks --filter @dovo/mobile typecheck
```

The recovery browser check binds an available non-loopback IPv4 interface and uses its HTTP origin
in managed Chromium. It asserts `isSecureContext === false` and that `crypto.randomUUID` is absent,
without changing either API. The real draft hook and protocol UUID helper preserve an edit across
reload in that context. The check requires a non-loopback interface; it does not fall back to
localhost. It also uses real local storage, React remounts and an HTTP 404 for the real editor
chunk. Its runtime transport is a fixture that can reject requests as offline or acknowledge a draft
before its workspace cache is saved. It does not prove sync against a running runtime. Unit tests
cover ordered asynchronous storage as used by mobile. They do not run native AsyncStorage,
notification extensions or a physical device. Existing rich editor checks cover editor behavior
after a successful load.

The review checks also cover pending edits during credential, address and runtime ID changes. The
browser fixture uses the production mount-key fields and a connection guard for stale workspace
writers. A source assertion checks those production fields. Known runtime IDs preserve the local
record across address changes; different runtime IDs and credentials use separate records. The Retry
test clicks the real button while local protection still throws. A page marker and the unchanged
text confirm that the page did not reload. Retry then succeeds when storage and chunk loading
return.

The browser script reports synchronous controller update and local protection times for 30 edits at
each of four draft sizes. On this workstation, two runs measured p95 times of 0.1 ms at 10,000
characters, 0.5–1.1 ms at 100,000 and 4.3–7.1 ms at one million. These are local measurements, not
performance limits. They exclude React commits, editor rendering and native devices.

Question storage errors expose **Retry saved answers** on desktop/web and mobile. A failed read
releases its pending load promise. Edits stay in memory, and the store does not write over unread
data. Retry reads and merges that data before saving. New edits win only for fields changed while
loading; untouched saved fields and attachment references remain. Removal markers prevent answers or
discards made during a pending read from returning after that read completes. Retry also saves
retained memory after a write failure.

## Final verification result

The seven test files in the command above passed: 87 tests. The recovery and rich editor Chromium
scripts passed. The eight send, startup, command, plan mode, section navigation and shared browser
scripts listed above also passed. Their workspace fixtures export the real recovery helpers and use
a browser origin with local storage. `node scripts/investigate-workspace-stability.mjs` also ran
with the real helpers and preserved its page-hide draft across page close. The five package type
checks passed. `git diff --check` passed. Targeted lint passed with no warnings for the recovery
implementation and browser scripts. The lockfile is unchanged.

These checks do not run hosted CI, the packaged Electron app, a simulator or a physical device. The
browser fixtures do not run the full application against a live runtime. Native notification
restoration has unit coverage with a native-module fixture. Native AsyncStorage and binary
attachment retention across real device restarts remain unverified. Independent request edits in
separate browser pages have regression coverage. Concurrent edits to the same request use the last
persisted write; they do not merge text across windows. Attachment recovery retains references
within existing runtime retention rules.

Question persistence stores one v2 record per runtime credential scope, thread and request. Only
requests edited or removed by that store instance are written. A new window does not resave the
requests it loaded. A per-request tombstone records an answer or discard, so unrelated writes from
an older window cannot restore that request. Existing v1 scope snapshots remain read-only recovery
sources. V2 records and tombstones take precedence; the old snapshot is kept intact.

The storage adapter uses existing key enumeration: `Object.keys(localStorage)` on web and
`AsyncStorage.getAllKeys()` on mobile. No new database or dependency is required. The two-store
regressions cover initially empty stores, stale loaded snapshots, asynchronous writes and legacy
snapshots. The non-loopback HTTP Chromium suite also opens independent pages before concurrent
writes, reloads a third page to verify both requests, and checks discard/answer persistence while
another page continues to edit its own request.

Confirmed answers consume only the submitted question-draft revision. Both clients pass the saved
record captured by the submit callback. Each edit has a new UUID revision, so identical text typed
again remains a different revision. A separate persisted answer marker names only the consumed
revision. It never overwrites the current request record. This avoids a cross-window read/delete
race and preserves a newer persisted edit even when an older acknowledgement or storage write
finishes later. A callback with no submitted local record cannot remove another window's record.
Explicit **Discard saved answers** remains a deliberate request removal.

Unit tests cover different and identical newer text, legacy revisions, an answer with no local
record and a delayed asynchronous answer-marker write. The real multi-page Chromium test reloads a
third page after stale callbacks and confirms that newer persisted text remains.

The question attachment Chromium script also passed both desktop and mobile form cases. It uses the
real question recovery store and platform hooks. Desktop uses browser local storage; mobile uses an
asynchronous Map storage fixture. Both cases verify saved attachment references and restoration
after a form remount before failed admission and retry. This is not native-device verification.

The typing fixture exports the real `composerCaretRecoveryKey` helper and uses a browser origin with
local storage. Its Chromium check passed with 237 typed characters, two composer parent renders and
12.4 ms input-to-frame p95 on this workstation. Recall, delayed history, edit preservation and
submit key checks also passed. This editor fixture does not measure per-edit draft storage; the
separate controller protection timing probe above covers that path.
