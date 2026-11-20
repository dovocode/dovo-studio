# Reliability and usability follow-up, 20 November 2026

Start with project deletion, file saves and ownership after backup restore. Each failed in an
isolated reproduction and left user data changed. For a smaller improvement that affects daily use,
switch the pairing CLI to the existing overview response. The fixture below transferred more than
99% fewer bytes with the same device list.

For permission dialogs, fix the scope behind "Allow once" first. For questions, require an exact
request ID when opening a notification or deep link. Both problems can turn a deliberate click into
a different decision. The [dialog findings](#permission-requests-and-questions) include the
reproductions and suggested checks.

## Project ownership and recovery

- **A rejected project deletion can still delete other conversations.** An HTTP request to delete a
  project encountered a thread with a pending move and returned 409. After restart the project
  remained, but an earlier thread was gone and an automation had been disabled. Check all threads
  before starting deletion and commit related metadata together. Test a conflict on the second
  thread and a write failure after cleanup begins.
  [Project deletion](../packages/runtime/src/scm/repositories/project-deletion.ts) ·
  [Thread deletion](../packages/runtime/src/http/endpoints/agents-routes.ts)
- **A backup restore can reactivate a moved project on the old computer.** In a two-runtime test, a
  project moved successfully, then the source runtime restored a pre-move backup. Both computers
  accepted independent queue writes. Preserve the latest ownership decision across a workspace
  restore. Verify that a restored source cannot execute work offline or after reconnecting.
  [Backup restore](../packages/runtime/src/storage/backups.ts) ·
  [Project transfers](../packages/runtime/src/scm/repositories/project-transfers.ts)
- **An interrupted move can leave a project locked without a transfer to cancel.** A SQLite fault
  injected between the initial task update and transfer insert left the task marked as preparing.
  After restart, both retry and cancel returned 404. Commit the transfer request and the source lock
  in one transaction before publishing either.
  [Transfer startup](../packages/runtime/src/scm/repositories/project-transfers.ts)
- **Deleting an imported Pi thread leaves its private transcript behind.** A local import, deletion
  and restart removed the thread but retained Dovo's full JSONL copy. Include Dovo-owned transcripts
  in deletion cleanup, preserve the external original, and test a crash between database and file
  cleanup. [Pi import](../packages/runtime/src/agents/providers/pi/session-import.ts) ·
  [Thread deletion](../packages/runtime/src/http/endpoints/agents-routes.ts)

## Editing and finding files

- **A failed save can destroy the original file.** An isolated Git checkout contained a 3,000-byte
  file. A 1,024-byte process file-size limit interrupted a 4,000-byte save through the actual Git
  service. The caller received `EFBIG`. The file contained the first 1,024 new bytes and none of the
  original. Write and validate a sibling temporary file before replacing an ordinary working-tree
  file. Account for permissions and hard links when choosing the replacement strategy. Run the same
  failure test through the task editor. [Git save](../packages/runtime/src/scm/git/git.ts) ·
  [Task editor](../packages/runtime/src/http/endpoints/agents-routes.ts)
- **Large repositories can lose all file suggestions.** A temporary Git index with 120,000 long
  paths made an exact `@file` query fail with `stdout maxBuffer length exceeded`. The runtime
  captures the entire Git listing into a 12 MiB buffer before applying its 200,000-file cap. Stream
  the NUL-delimited listing and report when results are incomplete. Test long paths and an exact
  match near the end of the index.
  [File search](../packages/runtime/src/scm/repositories/project-files.ts) ·
  [Git command](../packages/runtime/src/scm/git/git.ts)

## Desktop browsing

Every recorded navigation rewrites the profile's entire history synchronously on Electron's main
thread. In a temporary Linux fixture with one visit per URL, seven adds had a median of 11 ms at
10,000 URLs and 150 ms at 50,000 URLs. At 50,000 URLs each add rewrote about 13 MB. The fixture used
the actual history store with a temporary Electron data path. These are storage timings, not
measurements of a running desktop window.

Store visits incrementally and keep history clearing and private profiles intact. Compare append
latency and crash recovery on the same fixture before migrating existing profiles.
[Browser history](../apps/desktop/electron/browser-history.ts)

## Daily workflows

- **A submitted comment can reappear if the phone cannot remove its draft.** A Chromium fixture
  rendered the mobile line-comment editor with real draft logic. Its test endpoint acknowledged the
  post, then device storage rejected draft removal. The sheet closed. On reload, the editor restored
  the already submitted text. It did not post again automatically. Show the accepted status while
  local cleanup needs a retry. For recovery across process termination, reconcile a stable
  submission ID with the server before offering to post again.
  [PR line comments](../apps/mobile/src/scm/pulls/detail/line-comment.tsx) ·
  [Mobile draft storage](../apps/mobile/src/runtime/state/detail-drafts.ts)

- **Push delivery to one phone can block another for an hour.** In a two-device SQLite fixture the
  failing destination received eight delivery attempts. The healthy destination received zero before
  both pending notifications expired. The retry delay is global. Apply backoff per destination or
  provider, and continue processing other due messages.
  [Push delivery](../packages/runtime/src/notifications/push.ts)
- **The command palette offers actions inconsistently across views.** Chromium checks found two Open
  Browser entries. The first bypassed the detached-window focus action. Open Bots appeared while
  Bots was hidden in the sidebar. New thread and Search conversations disappeared in the Terminal
  view. Register common actions once and use the same availability and navigation rules as the
  sidebar. [Workbench](../packages/studio-shell/src/workbench.tsx) ·
  [Thread actions](../packages/extension-tasks/src/view.tsx)
- **A mobile project filter can hide every matching message.** A SQLite fixture had 55 matching
  messages in another project and one in the selected project. The global search returned 50, and
  applying the mobile filter removed all 50 snippets. Matching thread rows can still appear because
  the runtime returns their IDs separately. Apply project and archive restrictions before limiting
  results. Test that the selected project's hit survives even when another project has more recent
  matches. [History search](../packages/runtime/src/storage/workspace.ts) ·
  [Mobile results](../apps/mobile/src/screens/tasks.tsx)
- **Listing paired devices downloads conversations.** A loopback test ran the actual CLI against a
  synthetic workspace with 200 threads and 50 messages each. The full snapshot response was
  14,044,983 bytes. The overview response was 37,183 bytes and contained the pairing fields. Request
  the overview and decode only the fields the command displays. Verify older runtime compatibility.
  [Pairing CLI](../apps/api/src/cli.ts) ·
  [Runtime snapshots](../packages/runtime/src/http/support/snapshot-overview.ts)
- **Settings history can disable sync after restart.** One global setting with 300 valid revisions
  was enough. Startup passed all 300 history records and the current value through a 300-entry
  snapshot limit. The local value remained readable, but a subsequent exchange returned 503. Import
  history in pages and advance the import cursor after each committed page.
  [Replication startup](../packages/runtime/src/storage/state-replication.ts)
- **Search refreshes computers whose history did not change.** A Chromium test changed only computer
  A's history revision. The mobile search hook requested fresh results from both A and B. Keep
  results per computer and refresh only the changed one. Skip building the history signature while
  the query is empty. [Mobile search](../apps/mobile/src/tasks/list/use-task-search.ts)
- **The Source control guide opens with Automation setup.** The docs index sends readers to 83 lines
  on automations before the first project section. Give the guide a Source control heading and
  direct links to provider setup. Keep automation instructions in their existing guide.
  [Source control](./source-control.md) · [Automations](./automations.md)

## Permission requests and questions

- **"Allow once" can select a persistent Muse permission.** The shared action list always offers
  "Allow once." I passed the built adapter a harmless request based on the checked-in fixture and
  varied its available choices. With denial and session approval available, choosing "Allow once"
  selected session approval. With denial and local persistent approval, it selected the persistent
  grant. Carry the exact available scopes through the protocol. Offer only those scopes and require
  an exact match when returning the provider choice. Test restricted choice sets as well as the
  fixture that offers all three scopes. This check did not call Muse or grant a real permission.
  [Actions](../packages/protocol/src/runtime/connection/runtime.ts) ·
  [Muse adapter](../packages/runtime/src/agents/providers/muse/muse.ts)
- **Number shortcuts can change a different question.** In Chromium I focused an option in the
  second question and pressed 2. The first question's second option became selected. Bind numbers to
  the focused question and show the hint there, or ignore the shortcut outside the first question.
  Verify the submitted answers as well as the visual selection.
  [Question form](../packages/studio-ui/src/question-form.tsx)
- **Going offline locks an ordinary answer draft.** The desktop form disabled the free-text input as
  soon as I disconnected its fixture. Let the user keep editing recoverable text offline. Keep
  submission disabled until the runtime confirms that the exact request still exists. Keep secret
  values out of persistent draft storage.
  [Question form](../packages/studio-ui/src/question-form.tsx) ·
  [Draft recovery](../packages/studio-core/src/workspace/question-recovery.ts)
- **A notification can open the wrong question or disappear before anyone sees it.** In Chromium the
  mobile foreground banner for the second question opened the thread without its question ID. A
  second push on that thread counted as delivered with no visible request card and no banner. The
  system notification route also drops the local approval ID. Carry the request kind and ID to the
  card. Count delivery from the card's actual visibility, including when another pane is open.
  [Foreground notices](../apps/mobile/src/notifications/in-app-input.tsx) ·
  [System notification route](../apps/mobile/src/notifications/target.ts) ·
  [Visibility check](../apps/mobile/src/notifications/visibility.ts)
- **A withdrawn permission can remain actionable.** A harmless fake Codex provider withdrew its
  command request while the turn stayed active. The real adapter still listed the request for
  approval. Tie it to the provider request's cancellation signal and prevent a withdrawn request
  from saving a rule. Source inspection found a similar gap in Claude during an active turn. The
  adapter checks the request signal before opening the approval, but the pending approval listens
  only to the turn. Claude's background-agent path already combines the session and request signals.
  The Claude finding still needs a provider-level test.
  [Codex adapter](../packages/runtime/src/agents/providers/codex/codex.ts) ·
  [Claude adapter](../packages/runtime/src/agents/providers/claude/claude.ts) ·
  [Active turn](../packages/runtime/src/agents/execution/run-turn.ts)
- **Deleting a thread can leave a question that nobody can answer.** A non-blocking question
  survived turn completion in a local runtime. Archiving its thread succeeded and answering
  returned 409. Deleting the thread then succeeded and answering returned 404. The question still
  appeared as pending. Retire questions on deletion. Define whether archive suspends or cancels
  them, and show that outcome on every client.
  [Thread lifecycle](../packages/runtime/src/http/endpoints/agents-routes.ts) ·
  [Questions](../packages/runtime/src/agents/execution/questions.ts)
- **Opening an expired desktop question can answer a different request.** I opened the actual
  desktop component with a closed request ID and an unrelated question pending. Clicking Decline
  sent the unrelated question's ID and a null answer to the test endpoint. Match explicit IDs
  exactly. If the request is closed, show its status and a separate action to view other requests.
  [Desktop questions](../packages/extension-tasks/src/chat/thread/task-questions.tsx)
- **A lost response looks like an expired permission.** Repeating the same accepted approval
  returned 404 in the runtime. Keep a bounded record of the decision so the client can confirm the
  original outcome after reconnecting. A separate question retry with the same tool key and changed
  wording reported the old answer as accepted. Retain prompt identity with the receipt and reject
  conflicting reuse of the key. [Approvals](../packages/runtime/src/agents/execution/approvals.ts) ·
  [Questions](../packages/runtime/src/agents/execution/questions.ts)
- **A parent thread can lose sight of a saved child answer.** In a Chromium mobile fixture an unsent
  answer written on the parent's child-question card remained in storage after the question closed.
  The recovery action appeared only in the child. Link to the recovered answer from the parent and
  keep reuse bound to the original child.
  [Mobile questions](../apps/mobile/src/tasks/detail/task-questions.tsx)
- **A provider's secret field keeps its value through the background transition.** In the mobile
  component fixture a dummy secret stayed in memory on return to the app. Persistent draft storage
  correctly excluded it. Clear provider-marked secret fields when the app leaves the foreground, as
  the dedicated secure-input card already does. Keep ordinary draft text available.
  [Question form](../apps/mobile/src/tasks/composer/question-form.tsx)
- **An invalid mobile answer leaves keyboard focus on Send answers.** In the mobile Chromium
  fixture, submitting an empty required field displayed "Answer Design" at the footer. Focus stayed
  on Send answers. No field was marked invalid. Label each group, mark the invalid question and
  scroll it into view on explicit submit. Verify the result with VoiceOver and TalkBack.
  [Mobile form](../apps/mobile/src/tasks/composer/question-form.tsx) ·
  [Existing field focus helper](../apps/mobile/src/ui/controls/validation-fields.tsx)

## Verification of the fixes

- Real SQLite and loopback HTTP tests covered deletion while a terminal was closing. A competing
  worker could no longer start and then lose its thread. An injected archive or deletion failure
  left the family's questions, approvals and side chats available. Tests also restored backups from
  before and after a move and checked which computer could start the thread.
- Tests with real sandbox files confirmed that failed archive and delete writes kept their contents.
  I paused sandbox removal after a successful archive and tried to restore the thread over HTTP.
  Restore returned 409 until cleanup finished. The sandbox tests used a simulated container command.
  The related runtime suites passed 312 tests.
- The transfer-start test injected a write failure between the source lock and the transfer request.
  Restart allowed another attempt. The Pi test deleted an imported thread and exercised retry and
  restart during cleanup. It kept the external transcript. The settings test stored 300 revisions,
  restarted the runtime and completed another sync exchange.
- Stable question retries now check the original prompt after restart and after eviction from
  memory. I ran the approval, question and PR comment receipt suites, plus the attachment and native
  agent interaction suites. The attachment cases include cancellation during upload and conflicting
  answers. The PR tests used a real local runtime and a simulated forge.
- A real SQLite approval audit now records `always` for a saved web rule, including requests from
  older clients that send `remember: true`. The provider receives its single approval. A repeat
  confirms the saved decision without applying the rule again. The regression failed with the old
  audit field and passed with the fix. The runtime review passed 384 tests across agent execution,
  provider withdrawal, thread lifecycle, activity and HTTP.
- The built Git file search found an exact match at the end of a 120,000-entry index of long paths.
  It returned all entries without truncation. The desktop and mobile question components also passed
  the Chromium check for an expired request ID and a child's saved answer.
- The built pairing CLI made one overview request to each of two loopback server fixtures. One sent
  only the pairing fields in 133 bytes. The other simulated an older runtime that ignored the scope
  and returned 14,123,157 bytes including synthetic conversations. Both listed the same paired
  phone. The smaller transfer requires a runtime that supports overview responses.
- A Chromium run of the Workbench opened conversation search and New thread from Terminals. The
  palette showed one Open Browser action. It focused the detached window and kept Terminals
  selected. Changing the Bots preference hid and restored its palette action.
- Push backoff now applies per device. The test with one failing and one healthy device failed on
  the comparison commit. All 32 push tests passed with the change.
- A synthetic browser profile with 50,000 URLs took a median of 55.28 ms for one new visit before
  the incremental history change and 5.94 ms afterward. The same seven additions survived reload.
  Both runs used the production history store, a stub Electron data path and local Linux storage.
  The measurement excludes window rendering and browser launch.
- The mobile project panel retrieved a child's approval receipt from its parent thread. It showed
  the saved scope for a decision and a separate message for a withdrawn request. The mobile PR
  editor also passed the Chromium draft recovery check. Native iOS testing verified that checked
  choices and an ordinary text answer survived a process restart and reached the local runtime. The
  native build preceded the final exact-ID notification changes. VoiceOver speech and focus,
  TalkBack and native PR comment receipt recovery remain unverified.

### Recovery and final regression checks

The combined checkout passed all 29 build tasks and all 32 typecheck tasks. `pnpm check` found zero
errors and 74 warnings. Five suites for desktop history, file saves, push delivery and the pairing
CLI passed 72 tests and skipped one. The desktop history check also reopened a profile whose first
journal write had been cut short and retained the next visit after restart.

For mobile search, a Chromium fixture held one computer's reply while another computer's history
changed. Only the changed computer refreshed. A project search skipped an unrelated computer and
sent each supporting runtime its own local project IDs. The legacy runtime received only the query.
When its snippet limit hid a matching message, the app named that computer in an update notice.

- The pre-fix build lost a real Linux `user.dovo_review_tag` on a successful save. The same save now
  retains the tag. A second test preserved all 256 byte values without `getfattr` or `getfacl` on
  the command search path. A real POSIX ACL survived replacement. A missing metadata copier kept the
  original file and returned 409. On a Mac Studio, ordinary saves succeeded and files with a Finder
  tag, explicit ACL or hidden flag retained their data and metadata after refusal. The Windows
  checks used simulated command results. Native Windows verification remains open.
- A loopback HTTP test with a single conversation now excludes the message snippet when the selected
  project or archive filter excludes its thread. The matching thread ID remains available for the
  thread list. The storage regression failed on the comparison commit and passed here.
- In Chromium, leaving and returning to search or clearing and re-entering the query now retries the
  computer that failed. Previously successful results remain visible. The test confirmed that the
  healthy computer received no extra request.

The [third review](./reliability-review-round-three-2026-11-20.md) records the new findings from the
investigation, including failures on other computers, during recovery and between job steps.

Run the client checks from the repository root after building the workspace.

```sh
pnpm build
pnpm exec playwright install chromium
node scripts/check-question-attachments-browser.mjs
node scripts/check-native-project-panels-browser.mjs
node scripts/check-mobile-detail-drafts-browser.mjs
node scripts/check-mobile-task-search-browser.mjs
node scripts/check-command-palette-browser.mjs
```
