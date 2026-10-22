# Queue, steer and agent questions

Running threads keep unread title styling, including while saving changes. Viewing a running chat
does not mark it read; its completed response must be viewed first. A successful completed turn
shows **Done** in the task list until you view its chat. Read status syncs across your connected
devices. A later completion shows Done again; opening a list, keeping the app in the background, or
viewing a different mobile task pane does not clear it. This does not settle the task. Failed tasks
show a failure indicator, and a branch icon identifies task worktrees.

Right-click a desktop task (or press Shift+F10 on its row) for task actions, including rename,
pinning, snooze, settle/reopen, read/unread, project filtering and copying task details. Marking the
open chat unread closes its conversation so it stays unread until you open it again. Task actions
target the computer that owns the thread, including in the unified list.

While an agent runs, write a message to reveal **Queue** and **Steer**. **Stop** stays available.

- **Queue** saves the message for a separate turn after current work finishes. Reorder or remove
  pending messages in the queue. Pausing prevents automatic follow-ups; Stop also pauses the queue.
- **Steer** sends guidance into an active turn using native steering when the provider supports it.
  Harnesses without native steering interrupt and resume with that instruction first. A finished
  turn cannot be steered: send a follow-up instead.
- Message IDs deduplicate retries. When native steering cannot be confirmed, the instruction remains
  queued and paused with an explanation. Check the conversation before explicitly resuming it; a
  lost harness acknowledgement cannot establish whether it received the input.

Steering a queued follow-up keeps its original message ID. Provider acknowledgement moves it into
the conversation atomically; a failed or unconfirmed handoff leaves the original in a paused queue.
Desktop and mobile hide queued messages already present in history, including while a newer queue
snapshot is still in transit.

For Codex 0.161.0 and newer, Dovo enables the experimental `features.instant_interrupt` flag on new
and resumed threads while using native `turn/steer`. Older or unrecognized Codex versions retain
their existing native steering behavior.

Claude steering sends a user message with `priority: "now"` into the existing SDK query, retaining
the process, session and Dovo turn. Running root-owned foreground subagents move to the background
first so they can continue. Backgrounding waits at most five seconds; a refusal, error or timeout
still allows the instruction through. Nested agents stay with their owner. Claude's
`aborted_streaming` and `aborted_tools` results after steering are intermediate segments; their
token usage contributes to the completed turn. Stop still cancels the active query. If the turn
finishes while subagents are moving, the instruction stays queued for an explicit follow-up.

Codex/Astra choice forms include option descriptions, custom answers and secret fields. The
harness's `isBlocking` flag determines whether the composer waits for an answer. Non-blocking
questions remain answerable while the agent works and the composer accepts queueing or steering.
Older harnesses that omit the flag retain blocking behavior. An unanswered form does not imply
approval or an automatic choice. Ordinary questions cleared by the harness or turn completion are
dismissed without invented answers. Astra’s `agentMessage.questions` forms remain available after
completion; answers steer an active turn or become a follow-up when it finishes. Declining sends an
explicit decline. Stop and runtime shutdown dismiss pending forms without sending a response.
Blocking questions take precedence when multiple requests are pending.

The regular `dovo_task ask_question` tool provides structured questions for providers without a
usable native question interface, including normal Cursor sessions. It is independent of Studio
Tools. Supply a stable `key`, `title`, and `questions` with unique IDs, choices and/or custom input.
The tool returns immediately with the question ID and pending status. The user can answer on desktop
or mobile; the answer steers an active turn when supported or becomes a follow-up. If work depends
on the answer, finish the turn and wait for that follow-up instead of polling. Retrying the same key
within a turn reuses the card; a different question needs a new key. Decline is explicit, and Stop
or runtime shutdown cancels pending cards. Answers become conversation messages: do not request
secrets through this tool. Native blocking questions retain their separate secret-input support.

The regular `dovo_task todos` tool reads (`action: "list"`) or replaces (`action: "set", items`) the
thread's shared checklist. Items have `text` and `status`: `pending`, `in-progress` or `completed`.
An empty list clears it. It supports up to 100 entries and does not mark the thread complete. Codex
native plan updates, successful Claude `TodoWrite` and task-tool updates, Muse native todos,
OpenCode todo snapshots, ACP/Grok plans and successful Mistral Vibe todo results feed the same
checklist. Prefer the provider's native tools where available; do not maintain a parallel list with
the fallback tool. Parent checklists exclude native child progress. Desktop and mobile attach the
checklist to the composer. When queued messages and a checklist both exist, **Queue** and
**Checklist** tabs share that bar. Switching tabs preserves unsaved queue edits. Lists scroll within
a bounded area so the composer stays reachable. The bar can be collapsed while its counts and
progress remain visible. New questions or approval requests for the thread collapse both panels
automatically; selecting a tab or expanding the bar reopens them without losing queue edits.

When the thread stops with work left, both clients label the list **Unfinished** and stop its
running indicator without marking items complete. Unfinished lists survive provider-session
replacement and are included as progress context on the next turn. The agent reconciles that list
with the latest request; the list itself never authorizes more work. A new user message clears a
fully completed list, while pending items remain until the agent explicitly updates the checklist.

Codex native image generation and image viewing appear as tool activity with image previews on
desktop and mobile. Previews stay visible when work is folded. Generated raster data stays on the
runtime; clients receive task/event references and request thumbnails or larger previews from that
computer. Native file-backed images authorize only the path recorded by the completed event,
including outputs outside the checkout. Pairing and thread ownership are required; clients cannot
substitute a path.

Both regular tools are restricted to their own active thread/run. Runtime authorization permits them
for read-only agents because they affect conversation and progress, not project access. Provider
restrictions still apply: for example, Cursor's read-only mode excludes all MCP tools.

Answer validation happens before delivery; secrets are redacted in question history. An identical
answer retry is acknowledged for the most recent 256 answers within the running runtime. Conflicting
answers and replies to cancelled questions are rejected. Pending forms and retry acknowledgements
are not restored after a runtime restart.

The desktop composer groups reasoning, service tier and Daybreak in one picker. Fast is indicated
with a bolt and only enabled when advertised by the current Codex harness/model. Access has a
separate menu with descriptions of each supported permission mode.

New tasks start with an explicit project and host device choice, even when only one device is
connected. Desktop lists projects under their host; mobile chooses the device, then its project.
Offline devices cannot start tasks. The chat opens as an unsent draft, where you choose the agent
and checkout before submitting the first message.

Choose a built-in provider or a saved custom agent from the composer's **Agent and model** picker
(**Agent & model** on mobile). Custom agents bring their instructions, connection, skills and MCP
servers. Changing the model, reasoning or access keeps the custom agent selected and applies to this
task only. On desktop, **Use [provider] directly** switches back to a fresh built-in configuration;
on mobile, select the built-in agent in the same picker. Reselecting the current custom agent keeps
its task-specific settings.

Tasks opened from a PR also start as unsent drafts, with “I want to work on this PR.” and the PR
link in the composer. Choose the agent and edit the message before sending; the linked PR still
determines the task's worktree and commit. In the **New task** dropdown (mobile: **PR actions**),
choose **New branch from PR** (the default) for a separate Dovo branch, or **Use PR branch** to
check out the actual PR branch in a new worktree and push updates to its source repository,
including fork PRs. Direct checkout refuses branches checked out elsewhere, divergent local tips and
incompatible upstreams. Both choices start at the PR's recorded head commit, even when **Start from
origin** is enabled. Draft checkout controls show that source branch; older drafts without a
recorded branch name show the PR number.

Before the first message, a draft can switch providers freely. Sending or queueing that first
message fixes the conversation's provider, including if the queued message is later removed. Between
turns, you can still change models, reasoning, speed, permissions and custom agents within that
provider. Start a new task to use another provider. Shared custom agents referenced by sent
conversations also keep their provider; create another agent to use a different one. The runtime
enforces these rules for desktop, mobile and API clients.

Implementation follows the installed Codex app-server schema and the
[app-server protocol](https://learn.chatgpt.com/docs/app-server). Verification uses isolated runtime
and JSON-RPC harness fixtures, including native steering, completion races, queue pause/stop, lost
acknowledgements and asynchronous question cancellation. A live GPT-6-Astra check also verified
steering, receiving a message form, delivering its answer and completing the turn. These checks do
not guarantee every provider or network condition.
