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
Typed secret answers stay in the mounted form. On mobile, the form also clears them when Dovo leaves
the foreground, the same as the secure input card. Ordinary answers stay. The store excludes secret
answers and secret attachments. Secret references keep their existing send path. Mobile notification
answers restore only when there are no newer ordinary edits.

Answer fields stay editable while the computer is offline, so the text stays in recovery. **Send
answers**, **Decline** and **Dismiss** wait until the computer reconnects and still lists the same
request. On mobile, an explicit **Send answers** with a missing or invalid answer marks that
question, scrolls to it and moves focus to its text field or its label. Each question is one
labelled group for screen readers.

A link or notification that names a request opens only that request. If it is already answered or
closed, the thread shows that status instead of another pending question. Select **Show pending
questions** to see the others.

Navigation does not remove ordinary answers. A confirmed answer clears its unchanged record.
Declining, cancelling or expiring a request leaves edited answers available under **Saved answers**
in its thread. Select and copy the content to use it elsewhere. **Discard saved answers** removes
that record. Recovery does not append text to a message draft or change its order. Child-thread
answers remain available in the child thread. On mobile, the parent thread shows a card with **Open
saved answers** for them. **Use in draft** in the child adds them to the child's draft, never to the
parent's.

Saved attachment recovery records contain metadata and IDs, not another copy of the file. Existing
upload receipts and retention of referenced files still apply. Unreferenced queued uploads can
expire after a day. Before sending or editing a message, or answering with files, clients check
availability on runtimes that advertise `attachmentPreparationSupported`. This check renews pending
uploads for another day. It does not add files to the current draft.

A thread that the runtime keeps but cannot read, for example one with a status from a newer version,
keeps every attachment it owns. This includes threads that an old release saved in the first storage
format, which the runtime keeps only in its migration backup. Draft, queued and pending edit files
stay until the thread loads again or you delete it.

Desktop can restore missing bytes while the mounted composer still holds the source `File`. It uses
the same upload ID and keeps the current draft unchanged. It releases those source files when the
attachments leave the composer. A reload loses this in-memory source. Mobile keeps its existing
upload-receipt recovery flow. If the file is unavailable, it asks the user to recover the upload in
connection status or choose the file again. Neither client sends changed text from a pending
preparation step. Both keep changed drafts and question answers available for review.

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

## Sent message history

Desktop Up-arrow recall and mobile Message history request the latest 50 sent user messages from
`/api/tasks/composer-history` when browsing starts. The request runs even when the transcript has
not loaded those messages. It does not load the full thread, assistant messages or turns. Each new
browsing session refreshes this snapshot. Editing, cancelling or switching computers cancels the
request and prevents a late reply from replacing the draft. Connection failures keep the draft and
show an error. Bot agent history lookup is separate and keeps its existing search behavior.

Browse past the oldest loaded message to fetch the next 50 user messages. Older pages load only when
needed. The history control does not show a total count. The API accepts the previous page's
`before` cursor and does not query a total or load the full conversation. An older runtime that does
not return a cursor supports only the first page.

Send cancels pending older-page requests and keeps the recalled preview active until the native text
snapshot completes. A failed send keeps the recalled text for retry. A real draft change during that
read still blocks the send.

## Mobile editor drafts

The phone keeps unsent text from these editors after the app closes or the OS stops it:

- PR line comments, PR comments, replies, reviews and PR edits
- New pull requests
- Issue, comment, transition and pipeline run forms
- Commit messages
- Thread side chat questions and thread file edits
- Bot settings, new Bots and Bot memory notes
- Restored automation definitions
- Response, automation and new-thread action cards

Each draft is a separate record in app storage. Its key has the computer's profile ID and runtime ID
and the edited item. PR and issue drafts also include the repository account. Renewed pairing of the
same computer keeps its drafts. Another computer paired at the same address does not see them. A new
Bot draft belongs to the phone, so it follows a change of computer. Submitting removes only that
draft.

At startup, Dovo reads the saved drafts before it saves anything. A field typed before that read
finishes is newer, so it replaces that field of the saved draft. The other saved fields of the item
still load. Discarding or submitting a draft before the read deletes the saved copy, so it does not
come back. Defaults that an editor fills in by itself are not edits. Examples are the computer for a
new Bot, the destination of a new pull request and the first pipeline of a run form. A saved draft
that loads later replaces them, and a default never replaces a value that is already set. Slow or
failed storage at startup therefore cannot remove saved text.

Some data stays in memory only:

- Send receipts for requests with an unknown outcome. A restart drops the receipt and keeps the
  text.
- Any draft with a typed MCP credential, such as an environment or header value in Bot tools or an
  agent harness. Credentials saved on the computer arrive as references, so those drafts are saved.
- Drafts larger than 512,000 characters, for example a large file edit.
- List filters, selected tabs and other navigation state.

Secret prompts use secure input and never enter these drafts.

The editor shows a notice when the phone does not hold the latest copy:

- The saved drafts could not be read. Dovo saves nothing until a read works, so it writes nothing
  over them. **Retry saving drafts** reads them again. Opening the editor again also retries. After
  a successful read, fields typed during the failure replace those fields of the saved copy.
- A save failed. The text stays in memory. **Retry saving drafts** saves it again. The next edit
  also retries.
- The draft holds a credential or is too large. Dovo removes the older saved copy, so it cannot
  replace the newer text later.
- A saved draft from another app version could not be opened. Dovo keeps it until you edit that
  item.

Verify the store and a real editor:

```sh
pnpm exec vp test run apps/mobile/src/runtime/state/detail-drafts.test.ts
pnpm exec playwright install chromium
node scripts/check-mobile-detail-drafts-browser.mjs
```

The browser check renders the PR line comment, Create Bot, Create pull request and pipeline run
editors in Chromium. It uses browser storage in place of AsyncStorage and a page reload in place of
an OS stop. It covers a failed save, a failed read, retry, restore and submit. For the other
editors, it holds or fails the startup read while each editor fills its default. It also holds the
pipeline list until after the read. It checks that saved text comes back, that nothing is written
before the read and that a field typed during startup stays next to the saved fields. It does not
run on a phone.

## A rejected send and a newer draft

When the runtime rejects a message because an attached file is missing or belongs to a different
thread, it checks for any prior admission before classifying the rejection. A fresh rejection leaves
Scope, the draft and the queue intact. Dovo removes the rejected attempt from pending actions, so
you can fix the attachment and send again. An interrupted send with an unknown outcome keeps its
message ID and follows the existing reconnect recovery.

Current clients send a fingerprint of the draft they observed. If the runtime already has a
different draft, attachment set, turn settings or Plan setting, it accepts the message and keeps the
newer draft intact. Older runtimes and clients keep their existing send behavior.
