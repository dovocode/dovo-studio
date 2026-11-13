# Agent workflows

Workflows show a phased plan inside a thread. Open the thread's **Agents** view to see phases,
member status, and links to member threads. Completed members stay in the workflow when **Hide
finished** is on. The normal agent list keeps the existing stop and failure controls.

Workflows use the regular `dovo_task` MCP bridge. They do not need Studio Tools enabled. They have
no schedule. Scheduled jobs remain in Automations.

## Use a workflow with any agent

Ask the coordinator to use a Dovo workflow. The coordinator can use any supported harness. It can
select different harnesses or named configurations for its children.

1. Create a plan with a stable ID and ordered phases:

   ```json
   {
     "action": "create",
     "id": "change-review-1",
     "name": "Review the change",
     "phases": [
       { "id": "inspect", "title": "Inspect the change" },
       { "id": "verify", "title": "Verify the result" }
     ]
   }
   ```

2. Start each child with `subagent_spawn`. Supply its goal, context, and constraints.
3. Call `workflow` with the returned child ID:

   ```json
   {
     "action": "attach",
     "id": "change-review-1",
     "phaseId": "inspect",
     "childId": "<id returned by subagent_spawn>"
   }
   ```

4. Read child results with `subagent_read` or `subagent_wait`. Pass the needed results to children
   in the next phase. The coordinator decides when to start the next phase.
5. Use `workflow` with `{"action":"read","id":"change-review-1"}` for current phase status. Use
   `{"action":"list"}` for a short list of the thread's workflows.

The plan stores child references. Child tasks and native provider events remain the source of
status. Workflow reads do not consume the child result inbox. Full Dovo child results stay in their
threads and are available through the existing child tools.

Retry the same create or attach command after an uncertain response. A changed plan needs a new
workflow ID. A child can belong to one phase per workflow. Each thread can hold 50 Dovo workflows.
Each workflow can hold 50 phases and 200 members. Empty phases remain queued.

Only the thread's active agent can create or attach through the tool. It can attach only its own
children, including children launched in a separate project or on a paired computer. Remote
execution still needs Studio Threads on the target. Offline or missing members show an unknown
status. Workflow metadata is available in read-only runs; child execution keeps the parent's
permission limits. A workflow does not grant permission to delegate.

Plans survive runtime restarts. They stay with their source thread when the conversation moves to
another computer. There is no separate scheduler or script executor. Existing child recovery,
questions, approvals, result delivery, and stop behavior still apply.

## Native Claude workflows

Claude's native `Workflow` tool feeds the same workflow view. Dovo reads `local_workflow` task
events and `workflow_progress` snapshots. It keeps queued members separate from running members. It
rejects older run and attempt events so they cannot replace current progress.

Open a native member to read its thinking, tool calls, and answers. Claude does not stream those
member messages through the SDK. Dovo reads the member's JSONL transcript within the selected Claude
configuration's `projects` directory. Symlinks cannot escape that directory.

The open member view refreshes when provider progress changes. Use **Refresh thread** for a reply
that reaches disk after the last progress event. Reads use complete lines from the most recent 2
MiB. The view states when it omits earlier history. Without a transcript handle, it shows the saved
prompt and result preview. Individual native workflow members have no stop control; stop the
coordinator or the whole agent group.

## T3 investigation

This implementation adapts behavior from T3 Code at
[`eb7e63a82201171a905cbfe97b499b3d333286a2`](https://github.com/pingdotgg/t3code/tree/eb7e63a82201171a905cbfe97b499b3d333286a2):

- Julius's [member transcript work, #20856](https://github.com/pingdotgg/t3code/pull/20856) explains
  why native workflow members need a transcript reader.
- His [phase and member view, #20857](https://github.com/pingdotgg/t3code/pull/20857) replaces the
  raw script opening with a readable plan.
- His [queued-member fix, #25325](https://github.com/pingdotgg/t3code/pull/25325) distinguishes
  scheduled members from agents that have started.

Dovo shares the workflow contract and presentation across harnesses. It uses its existing delegation
system for mixed-agent work. It does not execute Claude workflow scripts for other providers.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/protocol/src/conversation/workflow/workflows.test.ts packages/runtime/src/agents/providers/claude/claude-workflows.test.ts packages/runtime/src/agents/providers/claude/claude-workflow-thread.test.ts packages/runtime/src/agent-tools/server.test.ts packages/runtime/src/agent-tools/context-budget.test.ts --maxWorkers=2
pnpm --filter @dovo/extension-tasks typecheck
pnpm --filter @dovo/mobile typecheck
pnpm exec playwright install chromium
node scripts/check-subagent-grouping-browser.mjs
```

The MCP tests use a real bridge, HTTP runtime, and database with mocked model adapters. Transcript
tests use local files. The browser check tests desktop components and mobile components with browser
substitutes for native controls. These checks do not establish live Claude compatibility, physical
mobile behavior, or execution on a paired computer.
