# Studio scan follow-up

This list keeps both scans in one place. It covers the recommendations from OpenBot, Nod and T3
Code. Append later scans below this list.

| Scan       | Item                          | Implementation                                                                                                                                     |
| ---------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| First      | Claude lifecycle              | Bound machine control calls to 15 seconds. Match result prompt IDs when the CLI supplies them. Keep human questions open.                          |
| First      | Settings links in chat        | Open a known settings page and reveal a field. Links change no values.                                                                             |
| First      | Older-thread references       | Search titles with `@thread:` in both composers. Include archived threads and retain computer identity.                                            |
| First      | Task-first Bot creation       | Add a first-task field. Keep it as the new Bot's draft for review and Send. Instruct the Bot to produce a useful result before proposing routines. |
| First      | Live evaluation               | Add worker-isolation checks and an evidence report. Run the suite. The local Codex launch failed before any model request.                         |
| First      | Generated file dragging       | Prepare a file card and drag its staged copy through the desktop bridge. Remote files use the existing file-share endpoint.                        |
| Second     | Large code-mode MCP output    | Retain bounded results and expose a scoped page reader. Completed actions do not need to run again.                                                |
| Second     | Restore automation definition | Edit and compare a retained run definition. Detect conflicts, keep current credential fields and pause automatic triggers.                         |
| Second     | Voice silence pause           | Save a device preference with 1.1, 1.5, 2, 3 or 5 seconds. Both call clients use it.                                                               |
| Second     | Reuse inspected elements      | Send the captured selector, URL, comment and optional crop through the existing thread picker.                                                     |
| Second     | PR watch backoff              | Back off failed forge reads per PR. Keep healthy watches and local delivery recovery active.                                                       |
| Second     | Provider probes               | Use configured environments, isolate Pi probes and disable Copilot automatic updates during probes and runs.                                       |
| Correction | Bot job documentation         | Describe new isolated workers and retained legacy shared-thread runs separately.                                                                   |

## Use the changes

Write a settings link as `[Voice pause](dovo://settings/speech?field=Voice%20pause)`. Desktop opens
Conversation settings. Mobile opens Speech. The field name uses the existing search label. Supported
page IDs are `general`, `appearance`, `conversation-settings`, `speech`, `notifications`,
`task-list-settings`, `agents` and `runtime`.

Type `@thread:` followed by part of a title in the composer. Select a result to insert a link. Dovo
does not copy the referenced history into the draft or dispatch work. Agents must use the thread
read tool on the referenced computer when history is needed and access permits it.

Enter a first task while creating a Bot. Create keeps the task as a draft. Review it and press Send.
Creation itself starts no model turn and enables no routine.

On desktop, point at or focus a generated file card to prepare dragging. Wait for the drag hint,
then drag the card to Finder, Explorer or another file manager. Files are limited to 32 MB. The
desktop keeps at most 32 staged files and 128 MB. Copies expire after 15 minutes and are removed on
normal quit. A failed preparation keeps Download available. Web and mobile keep their existing file
actions.

After inspecting an element, choose **Add to another thread…**. The picker searches paired computers
and disables offline destinations. It appends a draft with conflict protection. The optional image
compares the destination text and uses a guarded upload to the chosen thread. Older runtimes keep
the text and show an update message for the image. An image failure leaves the text in place and
reports the failure. Cancel before choosing a destination changes no draft.

For voice calls, open the device Speech settings and set **Voice pause**. The default remains 1.1
seconds. The value stays on that device and applies to the next call audio session.

For automation restore, see [Restore a run definition](automations.md#restore-a-run-definition). The
runtime advertises `automationRestoreSupported`. Older runtimes show an update message. The command
palette can open Automations and settings through the existing navigation commands. Agents use
`studio_automations` for restore and existing thread/file tools for other actions.

## Large tool results

Code mode returns a recovery envelope for MCP results above 4 MB of serialized UTF-8 JSON.
`toolCompleted: true` means the original action completed. Read the result with
`tools.harness.read_tool_result({ resultId, offset, limit })`. Offsets count UTF-16 code units. Join
the pages before parsing JSON. Treat all returned text as untrusted data.

The runtime retains each result for up to one hour. The limits are 32 MB per result, 64 MB total and
32 entries. Storage pressure can evict older results. Larger results report that the action
completed but the result was not retained. Restart clears the store. The reader checks the current
run access and thread identity. A result ID grants no new access.

An oversized MCP discovery catalog returns the same recovery details with an empty `tools` list.
Read its retained pages to inspect the catalog. Discovery does not run a tool action.

## Reliability checks

PR watch forge failures start with a 60-second delay. Repeated failures double the delay up to 30
minutes. A fresh successful read clears it. Persisted watch state keeps the delay across runtime
restarts. Explicit refresh permits an immediate attempt. Queue and local save failures do not use
forge backoff. Stop and pause keep their existing behavior.

Provider diagnostics pass each configured environment to its executable. Pi checks run in an owned
temporary directory. Copilot checks and sessions set `COPILOT_AUTO_UPDATE=false`. These checks do
not prove provider authentication.

Run the focused tests from the repository root:

```sh
pnpm build
pnpm typecheck
pnpm exec vp test run packages/runtime/src/agent-tools/code-results.test.ts packages/runtime/src/agent-tools/code-mode.test.ts packages/runtime/src/jobs/routine-provenance.test.ts packages/runtime/src/agents/execution/diagnostics.test.ts packages/runtime/src/agents/providers/claude/claude-steering.test.ts packages/runtime/src/scm/tasks/pull-request-watch.test.ts --maxWorkers=3
pnpm exec playwright install chromium
node scripts/check-browser-element-feedback.mjs
node scripts/check-automation-restore-browser.mjs
node scripts/check-bot-call-audio-browser.mjs
node scripts/check-bots-browser.mjs
node scripts/check-mobile-bots-browser.mjs
```

The regression proof uses:

```sh
pnpm prove -- packages/runtime/src/agents/execution/diagnostics.test.ts packages/runtime/src/agents/providers/claude/claude-steering.test.ts packages/runtime/src/scm/tasks/pull-request-watch.test.ts
```

## Live evaluation evidence

On 16 November 2026, the local run with `codex` and `gpt-6.1-sol` failed with `spawn codex ENOENT`.
No Codex executable was available to the test process. The report recorded one attempted adapter
call, zero reported tokens and zero estimated cost. No live behavior passed. This is an executable
setup failure. It is not evidence of an authentication failure.

Run with an installed executable and existing provider credentials:

```sh
DOVO_LIVE_BOT_EVAL=1 DOVO_BOT_EVAL_HARNESS='{"provider":"codex","model":"gpt-6.1-sol","reasoning":"medium","instructions":"","permission":"read-only","endpoint":""}' pnpm exec vp test run packages/runtime/src/agents/tasks/bot-live-evaluation.test.ts --maxWorkers=1
```

Set `executablePath` in the harness JSON if the executable is outside PATH. Never put credentials in
that JSON. The suite uses an isolated database, denies approvals and caps time, calls, reported
tokens and estimated cost. The backup outage is injected. Actual backup output requires the real
adapter. Browser tests use managed Chromium and native component stubs. Native Finder delivery,
physical microphone timing and live model adherence require separate verification.

Restore keeps the current provider identity for a matching step. If that provider changed since the
run, restore also keeps its current model and reasoning. It does not pass one provider's connection
credentials to another provider. Historical connection and environment fields are removed for steps
that have no matching current step.

## Appended scans, November 17

The following changes extend the earlier scans. The earlier list remains above.

| Item                      | Result                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stalled MCP responses     | Stop aborts the POST response body. The shared client and its notification stream remain available.                                                                |
| Slow Pi preparation       | Prompt preparation uses the 30-minute turn deadline. Other RPC commands keep their usual timeout.                                                                  |
| Browser download errors   | Agent observations include the last five download errors with times. Viewer errors remain visible.                                                                 |
| Queue and work time       | Automation steps record worker admission and show queue time separately from work time.                                                                            |
| Large GitLab diffs        | Review shows known file counts, counts returned patch lines, marks omitted patches and loads a selected patch on request. Revision and account checks still apply. |
| Sparse worktrees          | A project `.worktreesparse` file selects files for new worktrees. Main checkouts keep their full files.                                                            |
| Usage history             | Settings shows the stored record count, date range, retention and paged export. Keep all is the default.                                                           |
| GitHub file pages         | File-change requests use pages of 30 files. Pagination still retrieves later pages.                                                                                |
| Automation inputs         | Each task can select preceding task results and opt in to copying their files. Review gates preserve the saved result.                                             |
| Provider startup retry    | Scheduled runs can opt in to retry a temporary capacity or availability failure before prompt acceptance. Accepted work never replays automatically.               |
| Dictation navigation      | Desktop and web keep the recording bound to its original thread and computer. A global panel provides Stop, Cancel and Return.                                     |
| Browser time zone         | Remote profiles accept an IANA time zone. Desktop settings and mobile browser options can change it or restore the computer default. Open tabs update.             |
| Empty workers             | An automation worker must produce an answer, a tool step or a question. An empty successful provider return becomes a visible failure.                             |
| Secure input cancellation | Explicit user cancellation has its own result. Agents receive instructions to wait for the user.                                                                   |
| Claude capacity           | HTTP 529 errors use the capacity failure class.                                                                                                                    |

### Automation inputs and retry

Open a task step and select its preceding task results under Inputs. Select Include files to copy
files into the new worker. Each copy belongs to the receiving thread. No inputs are selected by
default. The runtime saves the result when the source step finishes. Later edits in that thread do
not replace the saved result. Results contain at most 32,768 characters per step, with a notice when
truncated. Existing attachment count and byte limits apply. Missing saved outputs or deleted files
stop delivery with an error. Older runs without saved outputs need review. Studio does not silently
substitute a later thread reply.

Enable Retry provider startup in Monitoring and limits to retry scheduled runs. The default is off.
Retries wait 5, 15 and 30 minutes. They retain the run, worker and delivery identity. The runtime
requires a failed turn with explicit evidence that the provider did not accept its input. A queue,
active work, changed task, disabled automation or changed retry setting stops the retry. Time and
spend budgets still apply while waiting. Turn the setting off to stop future retries. Manual Retry
remains available after a failed run.

Queue time begins when the worker asks for a slot. Work time begins when it gets a slot. Work time
includes preparation and execution. The overall run duration and time budget include both periods.

### Sparse worktrees

Create `.worktreesparse` in the project root. Use Git non-cone patterns, one per line. For example:

```text
/packages/protocol/
/packages/runtime/
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/.worktreesparse
```

New worktrees use these patterns before setup runs. Blank lines and comments are ignored. The file
is limited to 32 KiB and 256 patterns. Existing `.worktreeinclude` copying still runs after
checkout. All worktree entry points use the common Git creation path, including mobile and agent
requests. Older runtimes ignore the new file and create full worktrees. Remove the file to make
later worktrees full. To restore all tracked files in an existing sparse worktree, run:

```sh
git sparse-checkout disable
```

### Usage storage

Open Settings, Usage & limits, Stored usage history. The date range describes locally stored
records. The chart still covers at most 90 days. Export reads stored records without rescanning
provider transcripts. Each page contains at most 256 records and a continuation cursor. Desktop and
web download JSON pages. Mobile copies each JSON page to the clipboard. Builds without clipboard
support open the share sheet and keep that page available. Select Continue to next export page only
after you save it. Continue until Studio reports the last page. Record IDs and the source ID allow
exports to be combined without counting a record twice.

Retention is off by default. Enter a day count and select Save retention and clean up to delete
older usage records and keep later writes within that period. Cleanup also runs at startup when a
limit is set. It does not delete threads, credentials or provider transcripts. Expired transcript
records do not re-enter stored history while the limit is active. Export before cleanup if you need
a copy. Clear the day count and save to keep all later records. This does not restore deleted rows.
Older runtimes show an update message instead of the controls.

### Dictation and browser profiles

A recording remains active through desktop and web navigation. Stop finishes it on the original
speech computer. Cancel stops capture and requests cancellation there. Return opens the original
thread on its computer. If the thread unmounted or its draft changed, Studio retains the transcript
for review. Only the original thread offers Insert transcript. Studio does not insert it into the
newly opened thread. Reloading or closing the app still ends local capture. Native background
microphone rules remain unchanged.

For a remote browser profile, set Time zone in desktop Browser settings or Profile time zone in
mobile Browser options. Use a name such as `Europe/Amsterdam`. Blank restores the runtime computer
time zone. The override applies to browser date APIs. It does not change the host clock or the
automation schedule time zone. Profiles and saved website logins remain on their original computer.
Older runtimes show an update message. GitLab omitted-patch controls have the same runtime fallback.

### Verification of the appended work

Run the focused checks from the repository root:

```sh
pnpm --filter @dovo/protocol build
pnpm --filter @dovo/runtime --filter @dovo/studio-core --filter @dovo/studio-shell --filter @dovo/extension-jobs --filter @dovo/extension-tasks --filter @dovo/extension-scm --filter @dovo/mobile typecheck
pnpm exec vp test run packages/runtime/src/jobs/jobs.test.ts packages/runtime/src/storage/usage-history.test.ts packages/runtime/src/scm/git/worktrees.test.ts packages/runtime/src/scm/forges/providers/forge-gitlab.test.ts packages/studio-core/src/dictation-session.test.ts --maxWorkers=3
pnpm exec playwright install chromium
pnpm exec vp test run packages/runtime/src/previews/browser-scan.test.ts --maxWorkers=1
node scripts/check-dictation-browser.mjs
```

The Chromium integration fixture disables the sandbox only in its test launcher because this Linux
host cannot create Chromium's sandbox. Production browser launch settings stay unchanged. This is a
local browser check, not a physical-device check.

The live Bot evaluation can now launch the installed Codex executable when its installation `bin`
directory is included in `PATH`. A capped run confirmed a real delegated child returned `42`. The
suite then stopped at its 20,000-token limit after 37,083 reported tokens across three adapter
calls. The in-flight request can exceed the cap. The full live suite has not passed. No model price
was available to the evaluation counter, so its reported zero estimated cost is not evidence of free
usage. Finder or Explorer delivery and physical microphone timing still need native hardware.

### Final local check results

The desktop, API, runtime and dependency builds passed. Typechecks passed for runtime, studio-core,
studio-shell, extension-jobs, extension-tasks, extension-scm, mobile and desktop. The changed source
files passed lint. Formatting, `git diff --check` and changelog validation passed.

The final changed-test run passed 454 tests across 32 files. It excludes live model evaluation. It
covers automation result and file delivery, provider startup retry, empty worker results, usage
storage and paired HTTP access, sparse worktrees, GitLab patches and counts, browser profile
validation, dictation sessions and MCP transport. The MCP bridge suite passed all 43 tests. The real
Chromium check passed for time zones in open and new tabs, restoring the computer default, and
recording a failed download in the agent result.

The following browser checks passed. Provider, forge, native UI and clipboard boundaries use mocks
where the script requires them. These checks do not establish physical-device behavior.

```sh
node scripts/check-dictation-browser.mjs
node scripts/check-usage-overview-browser.mjs
node scripts/check-mobile-usage-browser.mjs
node scripts/check-browser-profile-settings-browser.mjs
node scripts/check-pr-code-review-browser.mjs
```

Usage checks cover retention validation, cleanup settings, turning cleanup off and paged JSON
export. Desktop checks read the downloaded files. Mobile checks cover clipboard delivery and keeping
the current page after opening a share sheet. Profile settings checks cover invalid time zones,
saving and clearing an override, and disabling the control for an older selected runtime.

Regression proofs passed against the current committed version with `--base HEAD`. The default merge
base is too old for some added modules. The proofs compare these uncommitted fixes with the
committed implementation. Run the additional proofs with:

```sh
pnpm prove -- --base HEAD packages/runtime/src/scm/forges/providers/forge-gitlab.test.ts
pnpm prove -- --base HEAD packages/runtime/src/mcp-apps/bridge.test.ts
```

The new bridge cancellation test failed on the base and passed here. Six existing stdio proxy tests
also reported `Connection closed` in that base worktree. Those six failures are not regression
evidence. All 43 bridge tests passed in this checkout.

The broader local test run passed 163 tests. Three existing agent-browser tests could not launch
Chromium because this host disallows its sandbox. Their production launch setting remains intact.
The separate Chromium integration fixture uses a test-only sandbox override. The full live Bot
suite, Finder or Explorer file delivery, and physical microphone timing remain open as stated above.

### Release check follow-up

The full local test run completed with 8,583 passing tests and 15 skipped tests. It found two
failures in the scan changes. The mobile copy check found missing translation entries. The tool
catalog exceeded its description and schema limits. Both checks now pass. The follow-up adds 52
messages in all 29 interface languages. It also keeps `Europe/Amsterdam` unchanged as an IANA
identifier in every language.

The automation command now references one complete definition schema for creation and restore.
Generated tool schemas omit the redundant `additionalProperties: true` default. Schema-valued
constraints stay in place. An advertised-schema test checks valid and invalid restore definitions.
The existing catalog size limits remain unchanged.

Six tests in `agent-browser.test.ts`, `browser-do-not-track.test.ts` and
`browser-session-cookies.test.ts` could not start Chromium because this host does not support its
sandbox. The full local suite is therefore not green. Production sandbox settings remain enabled.
The separate browser fixtures passed for usage retention, paged export, share-sheet page retention,
time-zone save and reset, and older-runtime fallbacks. These fixtures adapt native boundaries.

The runtime build and the mobile, protocol and runtime typechecks passed. The repository check
passed with zero errors and 34 existing warnings. Targeted tests passed for copy coverage,
translations, advertised schemas, provider schema compatibility and automation restore. Regression
proofs passed against `136c185fd0` for the copy check, tool catalog and IANA identifier. Run them
with:

```sh
pnpm prove -- --base 136c185fd0 apps/mobile/src/interface-copy.test.ts
pnpm prove -- --base 136c185fd0 --build packages/runtime/src/agent-tools/context-budget.test.ts
pnpm prove -- --base 136c185fd0 packages/studio-core/src/interface-language.test.ts
```

The full live Bot evaluation and the physical-device checks remain open. This release check did not
resume them.

### Hosted CI follow-up

Check run `44044794839` passed the full unit suite, builds, typechecks, and macOS and Windows jobs.
The six local sandbox failures did not occur on the hosted runner. Two browser shards failed because
their fixtures did not include new component inputs. The follow-up supplies runtime registries,
automation definitions and the mobile runtime adapter. It also tests the provider startup retry
control with and without runtime support.

The affected checks passed locally with Playwright's managed Chromium:

```sh
pnpm exec playwright install chromium
pnpm test:browser-tabs:browser
pnpm test:bots:browser
node scripts/check-bot-learning-browser.mjs
node scripts/check-inline-previews-browser.mjs
node scripts/check-mobile-automations-browser.mjs
pnpm check
```

The browser fixtures still use scripted transport and native controls where stated by each check.
They do not complete the open live Bot evaluation or physical-device checks.

## Latest scan implementation

The next scan changes add named PR and issue views, device shortcut overrides, browser modifier
keys, saved-answer draft reuse, automatic-pause run links and reviewed client action timelines.
Automation cost checks distinguish unknown prices from explicit free prices. MCP startup errors
include bounded, redacted stderr. Linear is excluded from this change. A future connection must use
a suitable CLI or existing integration, as requested.

**Use in draft** appends ordinary saved answers and available files. It preserves existing draft
text and files. Missing or foreign files stop the action. Saved answers remain until the draft save
succeeds. Secret questions stay excluded. File reuse needs `questionDraftReuseSupported`. Older
runtimes can still reuse text and show an update message for files. Local storage failures keep
recovery data available for retry.

MCP connection tests and bridge startup continuously drain stderr. They retain a bounded tail,
redact known credentials and terminal control sequences, and show at most 2,000 output characters on
failure. Successful startup does not add stderr to the conversation. Cleanup still closes the client
and transport.

Desktop Browser `key` commands accept chords such as `Control+a` and `Meta+Shift+z`. The command
focuses the selected element before dispatch. It preserves access checks and returns fresh element
references after input.

### UTCP code-mode review

Reviewed [UTCP code-mode](https://github.com/universal-tool-calling-protocol/code-mode) at
`e5fdc319bfae1ceec57e7bce37048337635ffb51`. The TypeScript client exposes generated tool interfaces,
manual namespaces, chained calls and captured logs. Its current source uses `isolated-vm` and a host
timeout. Tests cover hung tool calls, memory exhaustion and use after failures. The repository has
an MPL-2.0 license. No source or dependency was copied.

Dovo already has schema discovery, namespaces, parallel calls and filtered results. Keep its QuickJS
worker, bounded output, cancellation and per-call access checks. Prefer code mode for batching and
large results. Allow direct tools and native file or shell tools when available. See
[Code mode](code-mode.md), [saved views](issues-pipelines-jira.md#saved-views),
[shortcut settings](general-settings.md#application-shortcuts) and
[cost limits](automations.md#cost-limits-and-automatic-pauses).

### Claude proxy follow-up

The existing Claude Agent SDK adapter already keeps per-agent model proxy settings separate from
Dovo's local MCP connection. This matches the reviewed T3 arrangement. The follow-up documents
[Claude proxy setup](agent-providers.md#claude-through-a-proxy) and tests separate endpoints,
credentials, configuration directories and exact model IDs. Native tools and Dovo code mode remain
available under the same access checks. Explicit tool-search settings stay unchanged.

UTCP does not need to run at the proxy. Dovo's current runner already handles discovery, composed
calls and failure recovery. The new checks verify these boundaries without adding another runner.
The Claude checks mock the SDK. No Claude executable is available on this host, so a live model
reply through a proxy remains unverified.

### Verification of the latest scan changes

The full local suite reported 8,610 passing tests, 15 skipped tests and seven failures. Six failures
came from this host's Chromium sandbox in the managed-browser unit tests. The remaining failure used
an unpriced Bot fixture. It now sets an explicit model price, and all 20 tests in that file pass.
The pricing, MCP transport and saved-view follow-up batch passed 38 tests. Regression proofs passed
for resource diagnostics, desktop browser input and automation pricing.

Claude proxy and access checks passed 88 tests. Code-mode checks passed 37 tests. They cover real
stdio tool calls, contained file access, approval, cancellation, tool failures and later executions.
Browser checks use Playwright's managed Chromium and mocked app transport or native controls where
stated by each script. They verify desktop and mobile layouts, saved-view changes and source
switching, draft preservation, exact pause-run navigation, report controls, shortcut changes and
older-runtime fallbacks. They do not establish native device behavior or live model-provider
compatibility.

Run the focused checks from the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/runtime/src/agents/providers/claude/claude.test.ts packages/runtime/src/agents/providers/shared/access.test.ts packages/runtime/src/agents/configuration/claude-settings.test.ts packages/runtime/src/agents/configuration/registry.test.ts
pnpm exec vp test packages/runtime/src/agent-tools/code-runtime.test.ts packages/runtime/src/agent-tools/code-dispatch.test.ts packages/runtime/src/agent-tools/code-mode.test.ts packages/runtime/src/agents/execution/model-tool-instructions.test.ts packages/runtime/src/agents/configuration/resources.test.ts
node scripts/check-scan-follow-up-browser.mjs
node scripts/check-composer-recovery-browser.mjs
node scripts/check-question-attachments-browser.mjs
node scripts/check-routine-provenance-browser.mjs
node scripts/check-pipeline-list-browser.mjs
node scripts/check-report-problem-browser.mjs
pnpm prove -- packages/runtime/src/agents/configuration/resources.test.ts packages/runtime/src/previews/desktop-browser.test.ts packages/runtime/src/jobs/jobs.test.ts
pnpm --filter @dovo/runtime typecheck
pnpm --filter @dovo/extension-tasks typecheck
pnpm --filter @dovo/desktop build
pnpm check
```

The older full live Bot evaluation, physical file delivery and microphone timing checks remain open.
The release follow-up below tracks the later nightly fix.

### Nightly shortcut contrast correction

Hosted Check `44092919320` found insufficient contrast in the title-bar command shortcut hint. All
four design-system shards reported the same issue. The hint applied 70% opacity over the normal
muted text color. Removing that opacity keeps the existing theme color and gives the hint the same
contrast as the other title-bar controls. Accessibility checks remain unchanged.

Verify the catalog with Playwright's managed Chromium:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/design-system build
node scripts/check-design-system-browser.mjs 0 4
node scripts/check-design-system-browser.mjs 1 4
node scripts/check-design-system-browser.mjs 2 4
node scripts/check-design-system-browser.mjs 3 4
pnpm changelog:check
pnpm check
```

All four local shards passed after the fix. They covered 1,144 story/theme/viewport cases and 168
hosted-page checks with accessibility checks enabled. The catalog build, repository check and
changelog validation also passed. Hosted checks and nightly publication still need to pass for the
fix commit.

### Saved-view browser fixture timing

Hosted browser shard 0 in Check `44096226338` called the saved-view handler before React rendered a
newly added source. The handler still used the previous source list. The fixture now waits for the
handler's rendered source list to include the new source before applying its view. The check keeps
its existing timeout and still verifies source-specific drafts and account isolation. No application
behavior changed.

Run the affected browser suite with `pnpm test:ui-visuals:browser`. The narrower reproduction is
`node scripts/check-pipeline-list-browser.mjs`.

The focused check reproduced the failure before the fix and passed after it. All six browser checks
in the affected suite then passed locally. The repository check passed with zero errors. These
checks use browser fixtures for native controls and transport. They do not verify physical devices.

### Mac signing file limit

Release `44096244096` failed with `EMFILE` while the Mac signer scanned bundled runtime files. The
signer already limited code signing to four concurrent tasks. Its binary scan still opened files
without a limit. The dependency patch now limits binary probes to 32 across the full scan, including
nested directories. Signing order, signature checks and notarization stay the same.

Run the scanner regression and signing checks:

```sh
node --test scripts/packaging/mac-parallel-signing.test.mjs scripts/packaging/mac-signing.test.mjs scripts/packaging/mac-notarization.test.mjs
pnpm prove -- --base be152ecc scripts/packaging/mac-parallel-signing.test.mjs
pnpm install --frozen-lockfile
pnpm test:ci:scripts
pnpm check
pnpm changelog:check
```

The regression scans 1,024 text files and eight binaries under a 64-file process limit. It fails
with `EMFILE` before the patch and returns all eight binaries after the patch. Local checks run on
Linux. Real macOS signing and notarization need the hosted Mac release job.

### Build cache path diagnostics

Browser shard 1 in Check `44099032003` stopped before dependency installation. Cache restore
received no pnpm store path. The setup step used `echo` around command substitution, which can hide
a failed pnpm command. The command also used `--silent`, so the log does not show why pnpm returned
no path.

Setup now captures the path in a separate assignment. A failed pnpm command stops setup with its
diagnostic output. An empty path also stops setup with a clear error before cache restore. Valid
paths, including paths with spaces, pass through unchanged. No retry or cache bypass is added.

Run `node --test scripts/ci/build-cache.test.mjs` and
`pnpm prove -- --base 0f916044 scripts/ci/build-cache.test.mjs`. The tests execute the action's Bash
step with controlled pnpm results. They verify successful output, command failure and empty output.
The original runner's pnpm failure cause still needs hosted evidence if it occurs again.

### Extension catalog test setup

Check `44101272876` passed all browser, design-system, Windows and Mac runtime jobs. Its main suite
passed 8,617 tests, but the shipped-extension catalog test exceeded five seconds. That test imported
six extension modules inside its timed body. The runtime extension also imports shared UI code
through its Windows gate export.

The test now imports those modules during module setup. Its assertions still register every shipped
extension and check the contributed views. The five-second test limit stays unchanged. This changes
test setup only. It does not change application loading.

Run `pnpm exec vp test run packages/studio-shell/src/extension-catalog.test.ts --maxWorkers=1`, then
`pnpm exec vp test --maxWorkers=4` to match the hosted suite. The focused test passed locally before
and after the change. Before the change, test bodies used about three seconds of a 4.73-second run.
After the change, imports account for most of the run and test bodies account for less than one
percent. The local host did not reproduce the hosted timeout.

`pnpm prove -- --base e4034d1c packages/studio-shell/src/extension-catalog.test.ts` could not load
the temporary base because its generated `@dovo/web-ui/button` output was absent. This result does
not establish a regression proof.

The full local run passed 8,612 tests and skipped 15. The catalog test passed in that run. Six
browser integration tests failed because Chromium reported `No usable sandbox!` on this host. These
failures were in `agent-browser.test.ts`, `browser-do-not-track.test.ts` and
`browser-session-cookies.test.ts`. Playwright's managed Chromium was installed. The repository check
passed with zero errors and 36 existing warnings. Hosted checks must confirm the fix.

### Glass release checks and browser popup layering

Release `44106824441` could not acquire a hosted macOS ARM runner. Its Mac job ran no steps. GitHub
reported capacity constraints. Its Check and Mobile integration runs were cancelled when the later
glass commit `f77026b1` reached main. That commit already had Release `44109386221`. The redundant
retry of the older release was cancelled, and its watch was stopped.

The newer Check found missing exports in the settings and mobile PR browser fixtures. The settings
fixture now uses the real glass controller. The mobile fixture now adapts Platform, GlassView and
nested style arrays, and supplies its existing theme to the glass layout. The catalog composer check
permits the neutral glass shadow while rejecting any added focus glow. Its keyboard focus and
accessibility checks stay enabled.

The glass header also created a stacking context below the browser page. Address suggestions looked
open, but hit testing reached the page. The native view therefore stayed visible. The header now has
a local stacking level above its page. The popup remains below global overlays. The shared-browser
integration check now verifies that suggestions receive pointer input.

Run the focused regression, then the affected browser checks:

```sh
pnpm exec playwright install chromium
node --test scripts/browser/native-header-layer.test.mjs
pnpm prove -- --base f77026b1 scripts/browser/native-header-layer.test.mjs
pnpm --filter @dovo/desktop build
node scripts/check-general-settings-browser.mjs
node scripts/check-mobile-pull-attributes-browser.mjs
node scripts/check-native-browser-layout-browser.mjs
node scripts/check-shared-browser-browser.mjs
pnpm --filter @dovo/design-system build
node scripts/check-design-system-browser.mjs 0 4
node scripts/check-design-system-browser.mjs 2 4
pnpm check
pnpm changelog:check
```

The focused regression fails on `f77026b1` and passes with the fix. Both affected catalog shards
passed 572 story/theme/viewport cases and 84 hosted-page checks with accessibility checks enabled.
The settings and mobile PR fixtures passed after their build failures reproduced locally. The full
shared-browser check passed with rebuilt desktop styles. The native layout check retained zero scans
during its streaming fixture. Desktop and catalog builds, browser-shard scheduling tests, repository
checks and changelog validation passed. Native browser calls in these checks use a scripted bridge.
Physical native-browser rendering still needs device verification.

### Shared composer radius check

Check `44114947719` failed because the composer browser fixture still required a 28px corner radius.
The shared glass design token sets the composer radius to 22px. The same failure reproduced locally
against the current desktop build. The assertion now reads `designTokens.radius.composer` and still
compares the computed radius exactly. Production styles stay unchanged. Stop-button motion,
reduced-motion, focus, contrast and layout checks remain enabled.

Run the affected browser suite against a current desktop build:

```sh
pnpm exec playwright install chromium
pnpm test:composer-unification:browser
pnpm check
```

Both browser scripts passed locally against the existing current desktop build. They covered shared
composer behavior and desktop, phone and 320px layouts. The repository check passed. This change
corrects the test expectation and does not establish a production regression proof.

### Thread tools and project menu material checks

Check `44116995035` failed because the thread tools browser fixture still required a transparent
selected tool with no shadow. The glass design uses a tinted fill, a sheen and a neutral rim. The
fixture now compares those computed values with the shared material variables. It waits for the
selected tool's CSS transitions to finish before reading them. Disabling glow must retain only the
neutral rim. Disabling gradients must remove the sheen. The selection marker checks stay enabled.

The same fixture also expected a gradient on each menu choice and a colored menu shadow. Menu
choices now use a flat highlight inside the glass menu. The check requires focus and the shared
highlight fill. The menu must keep exactly its neutral rim and depth shadow with glow enabled or
disabled. This change updates test expectations and does not change production styles.

Rebuild web assets before running this fixture. The first local run used stale assets and passed.
The rebuilt assets reproduced the hosted failure.

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/web build
node scripts/check-task-project-panel-browser.mjs
pnpm check
```

The rebuilt web app, desktop and compact panel checks passed locally. The panel checks include
archive settings, editor actions, branch reuse, related links and watcher removal. The repository
check passed with zero errors and 36 existing warnings. This is a test correction, so it does not
establish a production regression proof.
