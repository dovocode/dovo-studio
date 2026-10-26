# Dovo child agents across harnesses

Dovo's task MCP server exposes `subagent_spawn`, `subagent_list`, `subagent_read`, `subagent_wait`,
`subagent_send`, `subagent_answer` and `subagent_cancel` to Codex, Claude, OpenCode and ACP
integrations. Agents delegate only when the user's instructions permit it. These tools supplement
each harness's native subagent support.

A parent can launch a child on another harness or choose a named configuration resolved for its
project. The child has its own persisted thread, provider session, approvals, questions and usage,
and runs in the parent's exact checkout (including worktrees, local folders and scratch projects).
Its prompt must contain the goal, relevant context and constraints. Avoid overlapping writes in the
shared checkout. Children cannot receive broader access than their parent, including through a saved
configuration or subsequent editor changes. Read-only parents can delegate read-only investigation.

`subagent_list` returns available configurations and this parent's children. `subagent_spawn` takes
`key`, `name`, `prompt`, either `provider` or `agentId`, and optional model, reasoning and
permission. A stable key reuses the child for retries within the same parent attempt; different
requests using the same key are rejected. The active-child limit defaults to four per parent thread
across attempts. Configure it per computer in **Settings → Computers → Running tasks → Maximum
concurrent child agents** (or the computer's settings on mobile). Lowering it prevents new launches
without stopping existing children. Each active direct child counts once even when its descendants
are working. The nesting limit remains three levels. Warm tool connections are bound to their
provider session. Child launches still require an active parent attempt and are attributed to that
attempt; retired session bindings are rejected. ACP requires a named configuration selecting its
installed integration. Provider-only children inherit connection/account settings from a matching
parent harness or project default. Unsupported restricted access is refused before creating a child;
child access never expands to accommodate a provider.

Interactive turns reuse available warm provider and MCP connections, preserving native children.
Idle transports across Codex, Claude, ACP (including Grok), Hermes and Muse share a four-process
budget and expire after two minutes; memory pressure can release them earlier. Completed Dovo
children release their idle transport immediately. A transport with working native children stays
alive until those children finish. Saved conversations remain resumable after releasing their
process. Archive and delete also release idle task transports.

Read-only Dovo children retain their answers and usage without capturing Git checkpoints or
refreshing checkout diffs. Writable children and independent threads retain normal change capture.
Session configuration changes require live native children to finish or stop first. Dovo child
controls use Dovo's ownership and access checks, so read-only parents can launch and receive
read-only children without a Codex approval prompt.

`subagent_wait` waits up to 20 seconds. If `running` is still true, the child keeps working; wait
again or finish your turn and receive its completion asynchronously. A finished result contains the
child's assistant answer and outcome, excluding tool output and raw events. Results become available
after provider execution and checkout finalization finish. The parent incorporates the answer in its
own response. Use a fresh child/key and full context for each new review round. A child failure is
returned to the parent without failing the parent automatically.

Normal parent replies leave children working. Completed answers and failures go to a durable
**subagent inbox**, separate from the editable prompt queue and conversation messages. They do not
clear drafts, update the latest user prompt, or consume user queue space. `subagent_list` returns
unread inbox references; `subagent_read` and `subagent_wait` consume a finished child's pending
notification and return its answer directly. Native late-result references can also be read this
way. The Agents panel continues to expose saved child conversations and results.

Ordinary child questions enter the parent inbox before being shown to the user. Read/list returns
the pending question IDs and fields. Use `subagent_answer` with the child ID, `questionId` and
`answers` keyed by field ID when the answer follows from known instructions or context. Omit
`answers` when human input is required or wanted; this exposes the original form in the parent
conversation without creating a duplicate. Answer validation and idempotent receipts remain owned by
the child. Secret fields and permission requests always require a human. Local approval cards show
the child's name in ancestor conversations; remote requests link to the owning thread for review.
Full access is inherited like other parent permissions unless explicitly narrowed.

Use `subagent_send` with the child ID, a stable key and a prompt to follow up in the same Dovo
conversation. A running child receives it after its current turn; a finished child resumes.
Identical retries do not duplicate work, while conflicting prompts for the same key are rejected.
Stopped children require a fresh spawn. Native harness agents retain their provider's own follow-up
controls.

An idle parent continues automatically with inbox results as internal, explicitly labelled delegated
input. A running parent can read/wait immediately; otherwise unread results are delivered at the
next turn boundary. Multiple available results are admitted together. No synthetic user bubble is
added. The global queue pause also holds automatic inbox continuation; reading a result still works
while paused. A paused individual user prompt stays paused and does not block inbox collection.
Nested children must finish and their results be handled before their owner's result is delivered
upwards. Individual cancellation suppresses that child's automatic notification. Existing
undelivered child messages are migrated out of the user queue without reordering user prompts.

Explicit Stop cancels descendants across parent attempts, drains their writes before the
cancellation checkpoint, and suppresses queued completion notifications. The Agents panel offers
individual **Stop child** controls; **Stop agents** also works while the parent is idle, with a
guard against stopping newer runs from a stale panel. Interrupted children are not restarted
independently after a runtime restart; their interruption is returned as a result. Pending
completions are recovered into the inbox exactly once and held for manual continuation after
restart. Completed results stay available. Independent tasks still cannot run simultaneously in the
same checkout.

Desktop and mobile thread lists show active subagents as pills under their main thread, including
nested children. Child threads remain navigable through those pills and the Agents panel rather than
appearing as separate list rows. Exited agents disappear from the pills; their saved results remain
in Agents, with links to the child conversation and back to the parent. Native child work also keeps
its checkout owned after a parent reply and blocks independent work, settings changes and archive.

Claude, Codex, Muse and ACP retain their native event and request handlers between parent turns.
Live native sessions are excluded from memory-pressure eviction. Child approvals and questions use
the owning session while retired parent requests remain disabled. Known child events update saved
outcomes and results. Late native results enter the same durable subagent inbox, with pause and
duplicate notifications handled as for Dovo children. Native work interrupted by a runtime restart
is recorded as stopped and returned for manual continuation; it is not relaunched.

Stop agents and individual Stop child controls include these native agents on desktop and mobile.
Stops use provider cancellation and wait for confirmation before releasing checkout ownership. ACP
child cancellation requires the child's advertised capability; a whole idle ACP session can be
closed when child cancellation is unavailable. Client-owned ACP terminals and writes drain during
cleanup.

OpenCode v1/v2 child sessions execute in the server. Dovo drains their native work before releasing
its event subscription and managed MCP connections; the parent text remains visible while it waits.
Copilot's `session.idle` already guarantees no background agents or attached shells remain. Cursor
waits for both the run outcome and stream completion and only sends cancellation on failure or Stop.
Hermes' gateway exposes root turn completion, without a separate background-child lifecycle
contract; use Dovo delegation for durable asynchronous children there.

The Agents panel hides finished agents by default on desktop and mobile. Turn off **Hide finished**
to view completed, failed and stopped agents and open their saved results. Each device remembers
this choice. The footer keeps the full agent count and shows how many are hidden; agents with an
unknown status or last-seen working state stay visible unless they have a finish timestamp.

Settling/reopening, snoozing/unsnoozing, archiving/restoring and deleting a thread apply recursively
to its children across attempts. Active child work and live terminals block archive/delete, and
active child work blocks settling/reopening. Deleting a child removes its descendants while keeping
its parent and siblings.

Automation steps and chained tasks wait for delegated work and result handling before advancing.

## Cross-computer thread monitoring

`studio_threads` automatically monitors threads created on a paired computer. Set `watch: false`
when creating an independent conversation. To follow an existing conversation, use `watch` with its
`id` and owning `runtimeId`; this records a **linked** relationship, not spawned ancestry. `watches`
lists the current conversation's monitors; `unwatch` removes a selected monitor.

Monitors persist the computer/thread reference, last observed state, and notification receipts in
SQLite. They use the existing paired runtime transport and private pairing registry for background
read-only snapshots, including after Studio closes. No pairing tokens enter thread metadata or
notifications. Other Studio control actions still require their normal live connection and policy.
Removing or revoking the pairing prevents further reads. An unavailable or older runtime retains its
last known state marked offline; reconnecting resumes monitoring. Both runtimes need this version
for snapshots. Disabling Studio Threads or narrowing the parent's permissions pauses monitoring;
settling/archiving the parent stops its monitors.

Completion and input requests enqueue one parent update per observed event, atomically with their
receipts. Paused parent queues stay paused. A parent can inspect the remote conversation and steer
it through Studio Tools; question/approval answers remain on the owning computer. Monitoring does
not automatically approve requests or stop remote work when the parent stops watching.

Spawned local children can own PR and pipeline watches. Those watchers still deliver to their own
child, while active-watch counts and failures roll up through local parents and monitored remote
references. Child thread summaries appear in the desktop and mobile overview; the Waiting panel
lists watch counts and remote thread dependencies and supports stopping an individual monitor. These
summaries do not transfer ownership of a PR/pipeline watch or create a second forge poller on the
parent.

Snapshots aggregate questions, approvals and watch counts on their owning runtime. Flat per-thread
provenance keeps shared descendants and cyclic links from multiplying counts; snapshots are bounded
to 1,000 contributing threads and mark partial results. Older peers without provenance retain their
single-summary fallback. A failed delivery (including a full parent queue) cannot prevent other
monitors from checking; unadmitted updates retry on the next tick without consuming their receipt.

Each parent may have 40 active monitors plus at most 40 stopped history records. Reactivating a
stopped record consumes an active slot. Archiving also prunes history. Child entries open on their
paired owning computer, resolving its stable identity when client address/profile IDs differ, with
an explicit return-to-parent action on desktop and mobile. Missing pairings still require the normal
connection/pairing flow.

## General threads as coordinators

`subagent_spawn` also accepts `repositoryId`, `runtimeId` and `execution`. This allows a General
conversation to delegate project work without granting the coordinator new filesystem roots:

- Omit targets to share the current checkout. `checkoutId` still selects an already linked checkout.
- Set `repositoryId` to select a project with its own checkout on this computer.
- Add `runtimeId` from `studio_discover` to select an already paired computer. Omit `repositoryId`
  for a separate General conversation there. Project/configuration IDs belong to the destination.
- `execution` selects main/worktree for a project target; omission uses that project's defaults. A
  target cannot be combined with `checkoutId`.

Use `subagent_list` with optional `runtimeId`/`repositoryId` to discover projects and
configurations. The list also includes inherited links and all targeted children. Named
configurations and provider credentials resolve on the destination; no parent endpoint, environment
or account token is copied. Targeted children require Studio Threads on both computers and the
originating run. Existing in-checkout delegation continues to work without Studio Tools. Accounts
and HTTPS are not required.

Targeted launches inherit the parent's permission ceiling, including read-only investigation and
native sandbox/approval limits. Their keys are durable across parent turns; retry exactly the same
key and arguments after an uncertain response. Different work needs a new key. Both computers retain
creation receipts, so an acknowledgement lost before monitor registration can be retried without
creating a duplicate. A failed start returns its saved thread ID and `startError`; inspect/resume
that thread rather than launching another. Update older destination runtimes before using this path.

Progress uses the existing nested thread monitors. `subagent_read`/`wait` accepts the returned
opaque child ID and returns a bounded final answer; reading a completed result consumes its
automatic notification. Otherwise the final answer is delivered once to the coordinator. Long
answers are marked truncated and remain readable on the owning thread. Offline states retain their
last known facts and do not imply completion. Active local and targeted children share the
configured child limit; logical nesting remains limited to three levels across project/computer
boundaries.

`subagent_cancel` and explicit parent Stop persist targeted cancellation requests. A disconnected
computer receives the request when its authorized pairing returns. The overview shows **Stopping…**
until a snapshot confirms execution ended. Normal replies and runtime shutdown do not cancel remote
work. Stopping a monitor through the Waiting panel still only stops monitoring. Narrowing the
coordinator’s permissions also requests cancellation of its targeted children; only that retirement
operation can use their original recorded ceiling. It grants no new read/write authority. Disabled
features and revoked pairings still block dispatch until restored.

### Thread overview and Subagents panels

Desktop and mobile build the same tree from explicit local delegation and saved spawned-thread
monitors. General threads use these same rules. An orphan stays visible as a root; linked work stays
independent. Each child shows its computer, project (General for scratch workspaces), outcome, and
saved offline/monitor-stopped state. Older remote runtimes may omit project names.

Collapsed summaries retain running, waiting, input-request, failed-thread and offline counts.
PR/check-watch counts stay in the Waiting panel rather than the sidebar. Opening a child preserves
its immediate parent as a return destination, including across paired computers.

Subagents panels include monitored remote children alongside local/native agents without duplicate
local child rows. Hide finished removes completed/stopped remote branches while retaining any live
or failed descendants. Native status-unavailable states are not presented as working.

Project and computer filters promote matching children whose parent falls outside the scope. Remote
snapshots include at most 200 renderable thread facts, with explicit parent/computer identities and
own attention/outcome fields. This presentation is separate from deduplicated watch counts. Stopped
or offline branches keep their last known hierarchy; stopped monitors suppress active attention even
when that computer also has a live UI connection. Truncated/legacy snapshots show that some child
details are unavailable.

Targeted children persist a navigation-only parent reference before starting. Direct links and
notifications can therefore return to their parent without relying on the originating overview.
Existing pairing and permission checks still apply.

With **Hide finished**, failures remain visible until **Acknowledge failure** is selected in the
Subagents panel. Acknowledgements persist on the viewing parent and apply to that specific failed
execution, for both native agents and monitored threads. A new failed attempt becomes visible again.
Acknowledging never stops work or hides live/input-request descendants. Turning Hide finished off
reveals acknowledged failures too.

Background-only children retain their real parent as context under computer/project filters; no
partial remote thread is fabricated as a local task. Project matching uses repository IDs and Git
identities rather than names. Successful Review children follow the same Hide finished behavior as
completed background snapshots, while input requests and unacknowledged failures remain visible.

Snapshots include up to 40 provider-native agent summaries per thread, prioritizing failures and
live work. They carry a name, status and execution key, without prompts, results or provider
credentials. Remote native failures appear under their owning thread and can be acknowledged from
the parent. New failed executions become visible again; truncated snapshots are marked partial.

Opening a descendant on an unsaved computer offers contextual pairing and preserves the selected
thread and its parent. Both clients resume only when the saved pairing matches the target's stable
computer identity. Pairing another computer does not open the thread. Older links without a stable
identity require an explicit choice of the owning saved computer. Pairing codes/device tokens are
still required, and reachable HTTP LAN/VPN addresses remain supported.

Remote rows use stable computer identities, resolved to a saved local profile when available. A
host's private profile ID is never used as the identity of an unpaired grandchild. Live workspace
facts win; otherwise a direct observer wins over a propagated copy, then the newest successful
observation wins. Presentation, attention and provider-watch counts use that same selection rule.

Spawned monitors retire as **completed** only after their final update is durably admitted (or
read). They stop polling and no longer count against the 40 active-monitor slots. Explicit watch,
send or resume can reactivate them; ordinary linked watches continue observing later activity.
Startup upgrades legacy delivered completions without another remote read. Completed rows retain
their outcome rather than showing “Monitor stopped.” History keeps the latest 40 discardable
completed records and 40 stopped records per parent; unread delegated results and unacknowledged
failures are retained in addition to that history. Older discarded handles cannot launch duplicate
work through receipt retries.

Native summaries beyond the 40 detailed rows include bounded totals for working agents and failures.
Both clients offer a link to open all agents on the owning thread. Additional failures stay visible
under Hide finished and can be explicitly acknowledged as a group. The group key covers the omitted
failed executions; a changed group is visible again. No prompts, results or credentials are
included.
