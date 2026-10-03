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
requests using the same key are rejected. There can be four active children per parent and three
levels of nesting. Tool connections are bound to the parent attempt so a stale connection cannot
launch children in a later turn. ACP requires a named configuration selecting its installed
integration.

`subagent_wait` waits up to 20 seconds. If `running` is still true, wait again. A finished result
contains the child's assistant answer and outcome, excluding tool output and raw events. Results
become available after provider execution and checkout finalization finish. The parent reads the
answer and incorporates it in its own response. A child failure is returned to the parent without
failing the parent automatically.

Ending or stopping the parent stops unfinished children and cancels their pending questions.
Interrupted children are not restarted independently after a runtime restart; completed results stay
available. Independent tasks still cannot run simultaneously in the same checkout. Desktop and
mobile show Dovo children in the Agents panel, with links to the child conversation and back to the
parent, so users can inspect results or respond to child questions with context.
