# Bot reliability changes

Reviewed T3 Code, OpenBot and Nod source and release notes on 14 November 2026. The changes below
use Dovo's existing thread, routine and voice paths.

## Automatic backup

Choose a saved agent under Settings > Automatic backup on desktop or mobile. The default is No
backup. A backup can have different provider costs.

Dovo uses the backup for quota errors and provider outages only when the failed request was not
accepted. Text, questions and tool events count as acceptance. Dovo does not replay a request after
work might have started. It leaves that failure visible and keeps the queue paused.

The switch uses the normal thread handover and a fresh provider session. It keeps saved messages,
files, checklist, Bot resources, instructions and access settings. The backup becomes the current
provider and model. An activity entry records the switch. Dovo does not switch back automatically.
If the backup fails, Dovo stops. Missing backup configurations, pending input, active children, open
terminals, failed checkpoints and concurrent settings changes prevent automatic handover. A
supported backup must accept the current access settings.

The runtime advertises `botBackupSupported`. Older computers keep their existing settings editor and
receive no backup field from the new clients.

## Source monitoring

In a routine's Monitoring and limits controls, set a source URL. Optionally set a JSON pointer such
as `/release/version`. Dovo accepts RFC 6901 escapes `~0` and `~1`. Arrays use numeric indexes.
Without a pointer, Dovo compares response bytes. With a pointer, Dovo compares that JSON value and
ignores object key order. Arrays keep their order. Value types remain distinct.

Reads keep the existing 512 KiB limit, redirect limit and timeout. HTTP remains supported for LAN
and VPN sources. A missing value, invalid JSON or failed read fails the run. It does not replace the
last successful baseline.

The agent receives bounded current and previous successful source text, marked as untrusted data.
Source text can be truncated at 24,000 characters. The comparison uses the complete bounded response
or selected value. Manual tests always run. Automatic runs skip unchanged content after a successful
preceding run. Changing the pointer requires a fresh baseline. Older runtimes do not show this
control.

## Worker states and voice noise

A finished worker remains marked Waiting for workers or results while its family has unfinished
work. Draft children show Queued. Both clients use the shared Bot work projection. Scheduled Bot
worker threads and their descendants do not appear as normal overview roots, even when pinned or
archived. Their records stay available through the Bot work history and direct thread navigation.

Bot voice calls ignore transcripts with no Unicode letters or numbers. This filters punctuation-only
noise without rejecting non-Latin speech. Explicit Interrupt stays available. Experimental
continuous listening is described below.

## Verification

Run from the repository root:

```sh
pnpm exec vp test packages/runtime/src/agents/tasks/bot-backup.test.ts packages/runtime/src/jobs/source-monitor.test.ts packages/runtime/src/jobs/jobs.test.ts packages/protocol/src/automation/routine-policy.test.ts packages/protocol/src/tasks/bot-work.test.ts packages/runtime/src/agents/tasks/delegation-state.test.ts packages/client-runtime/src/effects/bot-call.test.ts
```

The integration checks use real HTTP, SQLite and thread handover with scripted agent adapters. They
do not measure live model adherence or physical audio. The desktop and web builds do not use the
React compiler setup implicated in T3's render-scope retention fix. No matching leak was established
here.

Computer-wide admission is described below. Existing per-parent limits and memory protection remain
in place. Image/video workflow nodes are outside this comparison.

## Worker admission and failed tools

Computer preferences expose Background worker slots. The default, 0, chooses a limit between 2 and
16 from total RAM. Scheduled Bot roots wait in a FIFO queue when the threshold is reached. One slot
is reserved for conversation. Direct messages and required children can exceed the threshold to
avoid a parent waiting for a child that cannot start. This is admission control, not a hard process
limit. Active native children count. Waiting workers show their queue position. Stop removes a
waiting request without starting its provider. Restart uses the existing interrupted-run recovery.

Five consecutive identical failed tool outcomes stop the affected turn. Dovo compares tool name,
normalized arguments and error. Success or a changed outcome resets the counter. Replayed terminal
events count once. Providers must report arguments and terminal outcomes for this protection to
apply. The transcript and queued input remain saved. The queue pauses for review. A tool-loop stop
does not trigger backup.

## Provider recovery and next-turn settings

Failures distinguish authentication, configuration, capacity, quota and service availability.
Temporary network errors do not remove credentials. Backup applies only to capacity, quota and
availability before acceptance. A missing saved provider session can recover once when its exact
session identity appears in an explicit missing-session error. Accepted prompts, tools and native
work prevent automatic replay.

During a Bot turn, choose a provider or model in the composer. The pending choice appears as After
this turn, with Cancel. It applies through normal handover before the next prompt. It does not stop
the current turn. It survives restart. A changed Bot revision or current configuration pauses new
input instead of applying a stale selection. History, access limits and pending input stay intact.
Old skill mentions remain quoted history. Only the current input can activate a mentioned skill.

Existing provider steering remains capability-based. Unsupported providers queue input. Context
meters use current-request context where the adapter reports it, separately from billed usage.
Handover transfers text history, not provider tool-call objects or reusable tool IDs.

## Findings, monitoring and late runs

Monitoring and limits has an optional Finding group. Give routines the same group to group their
runs within one Bot. The inbox shows one group with its run count. An active review remains visible
when a newer check finishes. Run history retains all results. Identical successful answer text
suppresses another conversation report. A changed answer, failure or review stays visible. This
comparison is deterministic text comparison. It does not ask a model to judge material changes.

An enabled Bot MCP server can supply a text resource instead of an HTTP URL. Set the MCP server and
resource URI. Optional JSON pointers can select a record version or a batch of records. Dovo reads
the resource before invoking the model. It does not invoke an MCP tool for monitoring. The Bot's
current resource permissions still apply. This supports versioned snapshots, not a destructive or
consumptive cursor API. The captured batch stays with a failed run for Retry. Only completion moves
the successful baseline. A newer source version can start after that batch completes.

Scheduled workers receive due time, preparation time, time zone and current-turn start time. They
must recheck time-sensitive facts. Run details show the due time and enqueue delay. The audit shows
actual worker turn times, including time spent waiting for capacity. No expiry rule is invented.
Internal GitHub polling gets a stable computer-specific offset. User cron and one-time schedules
retain their exact times.

## Memory recall, versions and language

`bot_history` searches only the current coordinator's conversation. Results have at most 20 text
snippets. Reset exclusions remain excluded. Worker, project and other Bot histories are not
searched. History is evidence, not a new instruction.

Notes retain ten previous dated versions. Desktop and mobile can load a version into the editor.
Save is still required. The editor retains the current revision for conflict detection. Optional UTC
expiry removes a note from agent recall and learning context after that time. Human editors can
still inspect it. Omit expiry to keep it; clear the field to remove it. Deleting a note deletes its
versions. Forgetting all memory also forgets expired notes. Learning instructions preserve the
language of supporting owner messages, names, code and quotes. Scripted prompt checks cannot prove
that a live model follows the language instruction.

## Run audit

Open a run and select Load audit. Both clients show worker turns, provider/model choices, reported
tokens and estimated cost. Usage can be incomplete. Estimates are not subscription bills. The audit
includes only isolated workers and their descendants. It excludes the shared Bot conversation.

Events load in pages of 100. Output loads only when requested. Known credentials are redacted before
activity retention. The audit applies redaction again on read. Each output is limited to 32,768
characters and marks truncation. Retention can remove older events. Copy the selected JSON page to
export it. The export contains the selected computer and run, not a workspace-wide log. Agent run
credentials cannot use the human audit endpoint.

## Installed help and freeze evidence

`dovo_help` searches the docs bundled with the runtime build. Search first, then read a returned
section ID. Results include build version, revision and source. Search returns at most five
excerpts; a read returns at most 8,000 characters with an offset. It cannot read arbitrary files,
account data or private memory. Use live tools for current settings and connection state.

Freeze profiles are off by default. Enable them in computer activity settings. After two busy
event-loop stalls within a minute, Dovo can collect a two-second CPU profile. It captures at most
once per ten minutes and keeps three summaries in runtime memory. It discards raw profiles, source
URLs, paths and user function names. Summaries contain runtime function sample counts. Diagnostics
can include those summaries through the existing diagnostics flow. Turning the setting off prevents
new captures and discards the result of an in-flight capture. Restart clears saved summaries.

A local Linux synthetic numeric-loop measurement gave 17.84 ms without profiling and 18.37 ms with
profiling, a ratio of 1.03. Disabled sampling cost about 17 ns per call in that measurement. These
numbers are not app latency guarantees. Reproduce with:

```sh
pnpm --filter @dovo/runtime... -r build
node scripts/benchmark-freeze-profiles.mjs
```

## Experimental continuous calls

Continuous listening is off when a new call opens. Enable it in the call controls to let speech
interrupt playback. Web capture requests echo cancellation and noise suppression. iOS recognition
uses voice processing and the shared application audio session. The call queues speech recorded
while an earlier message is being sent. Stable message IDs prevent repeat delivery after an
uncertain response. Muting, End and approval waits keep their existing controls.

Use headphones if playback causes false interruption. Recognition finalization and platform audio
restarts can leave capture gaps. This is not a full-duplex streaming speech model. Physical iPhone
echo, route changes, Bluetooth and interruption timing still require device verification. The
explicit Interrupt control remains available.

## Opt-in live-model evaluation

The live suite uses an isolated runtime database and Bot directories. It checks delegation,
preparation without execution, duplicate message identity, private memory separation, late scheduled
work and configured backup. The initial outage is injected; backup uses the real configured adapter.
It denies approval requests. It can use the selected provider's existing credentials and incur cost.

Supply a complete TaskHarness JSON configuration through `DOVO_BOT_EVAL_HARNESS`, then run:

```sh
DOVO_LIVE_BOT_EVAL=1 pnpm exec vp test packages/runtime/src/agents/tasks/bot-live-evaluation.test.ts --maxWorkers=1
```

The suite stops at 12 provider calls, four minutes, 20,000 reported tokens or USD 1 of known model
price estimates. One turn has a 60-second limit. Usage limits are soft because providers can report
usage late. Unknown pricing has no dollar estimate. Use a provider account spending cap when a hard
money limit is required. The suite stays skipped in normal CI. A skipped test is not evidence of
live-model adherence.

## List measurements

The existing summary/history separation remains. A synthetic local workspace with 400 threads,
100,000 messages and 50,000 turns opened in 115.71 ms with 2.21 MiB idle heap. A metadata edit took
5.77 ms and selected-history access took 1.94 ms. Summary open and edit did not hydrate histories.
These measurements did not justify replacing the list design. Reproduce with
`node scripts/benchmark-workspace-memory.mjs` and `node scripts/benchmark-history-queries.mjs`.
