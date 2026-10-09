# Dovo child agents across harnesses

Dovo's task MCP server exposes `subagent_spawn`, `subagent_list`, `subagent_read`, `subagent_wait`
and `subagent_cancel` to Codex, Claude, OpenCode and ACP integrations. Agents delegate only when the
user's instructions permit it. These tools supplement each harness's native subagent support.

A parent can launch a child on another harness or choose a named configuration resolved for its
project. The child has its own persisted thread, provider session, approvals, questions and usage,
and runs in the parent's exact checkout (including worktrees, local folders and scratch projects).
Its prompt must contain the goal, relevant context and constraints. Avoid overlapping writes in the
shared checkout. Children cannot receive broader access than their parent, including through a saved
configuration or subsequent editor changes. Read-only parents can delegate read-only investigation.

`subagent_list` returns available configurations and this parent's children. `subagent_spawn` takes
`key`, `name`, `prompt`, either `provider` or `agentId`, and optional model, reasoning and
permission. A stable key reuses the child for retries within the same parent attempt; different
requests using the same key are rejected. There can be four active children per parent thread across
attempts and three levels of nesting. Warm tool connections are bound to their provider session.
Child launches still require an active parent attempt and are attributed to that attempt; retired
session bindings are rejected. ACP requires a named configuration selecting its installed
integration.

Follow-up turns reuse their warm provider and MCP connections, preserving native children. Session
configuration changes require live native children to finish or stop first. Dovo child controls use
Dovo's ownership and access checks, so read-only parents can launch and receive read-only children
without a Codex approval prompt.

`subagent_wait` waits up to 20 seconds. If `running` is still true, the child keeps working; wait
again or finish your turn and receive its completion asynchronously. A finished result contains the
child's assistant answer and outcome, excluding tool output and raw events. Results become available
after provider execution and checkout finalization finish. The parent incorporates the answer in its
own response. Use a fresh child/key and full context for each new review round. A child failure is
returned to the parent without failing the parent automatically.

Normal parent replies leave children working. Their completed answer or failure is queued durably in
the parent thread and starts a new turn when idle. A running parent receives it on its next queued
turn. Reading/waiting for a finished result removes any unconsumed automatic notification. Generated
results are labelled **Dovo child result** and do not count as new user activity. Nested children
must finish and their results be handled before their owner's result is delivered upwards. A paused
queue stays paused.

Explicit Stop cancels descendants across parent attempts, drains their writes before the
cancellation checkpoint, and suppresses queued completion notifications. The Agents panel offers
individual **Stop child** controls; **Stop agents** also works while the parent is idle, with a
guard against stopping newer runs from a stale panel. Interrupted children are not restarted
independently after a runtime restart; their interruption is returned as a result. Pending
completions are recovered into the queue exactly once and held for manual continuation after
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
outcomes and results. Late native results enter the same durable completion queue, with paused
queues and duplicate notifications handled as for Dovo children. Native work interrupted by a
runtime restart is recorded as stopped and returned for manual continuation; it is not relaunched.

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
