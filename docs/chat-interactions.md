# Queue, steer and agent questions

A successful completed turn shows **Done** in the task list until you view its chat. Read status
syncs across your connected devices. A later completion shows Done again; opening a list, keeping
the app in the background, or viewing a different mobile task pane does not clear it. This does not
settle the task. Failed tasks show a failure indicator, and a branch icon identifies task worktrees.

Right-click a desktop task (or press Shift+F10 on its row) for task actions, including rename,
pinning, snooze, settle/reopen, read/unread, project filtering and copying task details. Marking the
open chat unread closes its conversation so it stays unread until you open it again. Task actions
target the computer that owns the thread, including in the unified list.

While an agent runs, write a message to reveal **Queue** and **Steer**. **Stop** stays available.

- **Queue** saves the message for a separate turn after current work finishes. Reorder or remove
  pending messages in the queue. Pausing prevents automatic follow-ups; Stop also pauses the queue.
- **Steer** sends guidance into an active Codex turn, preserving its tools, session and checkpoint.
  Other harnesses interrupt and resume with that instruction first. A finished turn cannot be
  steered: send a follow-up instead.
- Message IDs deduplicate retries. When native steering cannot be confirmed, the instruction remains
  queued and paused with an explanation. Check the conversation before explicitly resuming it; a
  lost harness acknowledgement cannot establish whether it received the input.

Codex/Astra choice forms include option descriptions, custom answers and secret fields. The
harness's `isBlocking` flag determines whether the composer waits for an answer. Non-blocking
questions remain answerable while the agent works and the composer accepts queueing or steering.
Older harnesses that omit the flag retain blocking behavior. An unanswered form does not imply
approval or an automatic choice. Ordinary questions cleared by the harness or turn completion are
dismissed without invented answers. Astra’s `agentMessage.questions` forms remain available after
completion; answers steer an active turn or become a follow-up when it finishes. Declining sends an
explicit decline. Stop and runtime shutdown dismiss pending forms without sending a response.
Blocking questions take precedence when multiple requests are pending.

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

Tasks opened from a PR also start as unsent drafts, with the description and review feedback ready
in the composer. Choose the agent and edit the message before sending; the linked PR still
determines the task's worktree and commit.

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
