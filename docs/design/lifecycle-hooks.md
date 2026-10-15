# Lifecycle hooks

Configure hooks under **MCP, skills & hooks** on desktop or mobile. Dovo runs the same configuration
around every harness; switching harness does not require translating provider hook files. Global,
computer, project, project-on-computer and named-agent scopes use the existing resource precedence.
A matching name overrides an inherited hook, including disabling it; Reset restores inheritance.

Each hook has a unique name within its scope, event, shell command, enabled flag, optional matcher
and timeout of 1–600 seconds. Commands run on the runtime host in the task checkout using the host
shell. They execute with the user's OS permissions, so read-only agent tasks reject enabled hooks.
Runtime authentication secrets are removed from the command environment. Configure only trusted
commands. Existing before-turn and after-turn configurations continue to work.

| Event                             | When and behavior                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-turn`                     | Before the initial prompt is submitted. Nonzero exit or timeout prevents starting the harness.                                                                                                                               |
| `after-turn`                      | After successful execution and queued observations. Failed checks return their output to the same harness session for up to two repair turns.                                                                                |
| `session-start`                   | The harness attaches or resumes a session during this run. Shown as “Session attached”; includes `resumed`. This is not OS process startup.                                                                                  |
| `tool-start`                      | The harness reports a tool call starting. Observational; cannot prevent the call or rewrite its arguments.                                                                                                                   |
| `tool-complete`                   | The harness reports a successful tool result.                                                                                                                                                                                |
| `tool-error`                      | The harness reports a failed or interrupted tool, including nonzero Codex command exit codes.                                                                                                                                |
| `permission-request`              | Before a Dovo approval request. A nonzero exit or timeout denies the request without opening the approval UI. Only applies when the harness requests approval; it does not create approval requests for auto-approved tools. |
| `permission-response`             | After approval or denial. Context contains the decision.                                                                                                                                                                     |
| `before-compaction`               | Blocks a user-requested manual compaction on failure. Automatic compaction start is observational and only available when reported by the harness.                                                                           |
| `after-compaction`                | After compaction completion. A successful manual compaction also emits this if its adapter has no separate notification.                                                                                                     |
| `subagent-start`, `subagent-stop` | Explicit native child-agent transitions reported during the active parent run. Not every harness exposes native child events.                                                                                                |
| `turn-error`                      | Turn/check failure. Receives the original error; cleanup failure is reported alongside it.                                                                                                                                   |
| `turn-interrupted`                | Cancellation. Runs with a separate shared three-second cleanup deadline after the turn signal aborts.                                                                                                                        |

Native observations are serialized in receipt order and drained before after-turn checks. Repeated
tool progress updates do not rerun start hooks, and each tool gets at most one terminal result.
Parallel tool calls retain separate IDs. Failed observational hooks are reported and fail the turn
after the harness finishes; they do not stop an already-running native operation. These failures do
not trigger automatic repair turns. Session-owned events arriving after the parent run ends are
outside this lifecycle. There is no synthetic session-end event: harness sessions can remain warm
across turns.

Tool normalization covers Codex, Claude, Cursor, OpenCode, Copilot, Hermes, Muse, Vibe and ACP
(including Grok). Availability follows the native events each adapter receives; Dovo never invents
missing events. This shared API deliberately does not import provider-specific hook configurations,
native hook response formats or argument-rewriting semantics.

## Input and output

Commands receive one JSON object followed by a newline on stdin. Ignore unknown fields for forward
compatibility. Exit zero to pass; any other code fails. Stdout and stderr appear in thread activity,
bounded to the final 16 KB. Stdout is not interpreted as a native harness control response.

```json
{
  "version": 1,
  "event": "tool-complete",
  "cwd": "/work/project",
  "taskId": "thread-id",
  "sessionId": "native-session-id",
  "harness": "claude",
  "tool": {
    "id": "call-id",
    "name": "Bash",
    "kind": "command",
    "status": "completed",
    "input": { "command": "pnpm test" },
    "output": "Tests passed"
  }
}
```

`taskId` and `sessionId` are optional. `tool.kind` is one of `command`, `file`, `search`, `web`,
`tool`. Native input/output retain their provider shape (including JSON strings or content blocks).
Other events include `prompt`, `resumed`, `trigger` (`manual` or `auto`), `permission` (`title`,
`detail`, optional `decision`), `subagent`, or `error` as appropriate. Hook input and output may
contain source code and tool data; avoid logging sensitive values unnecessarily.

The optional matcher is a regular expression tested against tool category, native tool name,
subagent name or approval title. Empty or `*` matches all. For example, `^command$` selects shell
tools across harnesses, while `Bash|commandExecution` selects native names. Matchers on events
without these fields do not match; leave the matcher empty for turn/session/compaction events.

For an after-turn project check, set command to `pnpm lint`. For a portable observer, use a
repository script such as `node scripts/on-tool.mjs` that reads JSON from stdin. Hooks are saved
through Dovo resource settings and take effect on the next turn; Dovo does not modify global Codex
or Claude hook files or their trust settings.
