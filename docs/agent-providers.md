# Native coding-agent providers

Dovo exposes Hermes, GitHub Copilot, Grok Build, Muse Code and Cursor alongside Codex, Claude,
OpenCode and custom ACP agents. The provider runs on the selected runtime computer; desktop, web and
mobile all use the same runtime adapter. Installing a Dovo SDK dependency does not install or
authenticate the agent CLI.

| Provider       | Integration                                             | Runtime setup                                                                                                         |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hermes         | Native TUI gateway JSON-RPC                             | Install Hermes, configure `hermes model`, select its Python environment; see [Hermes setup](hermes.md).               |
| GitHub Copilot | Official `@github/copilot-sdk` 1.0.16, owned stdio CLI  | Install Copilot CLI and authenticate on the runtime host. Set the Copilot executable when it isn't on PATH.           |
| Grok Build     | Official ACP v1 agent interface                         | Install Grok Build and run `grok login`, or supply `XAI_API_KEY` in the agent environment.                            |
| Cursor         | Official `@cursor/sdk` 1.0.35, isolated local worker    | Set `CURSOR_API_KEY` on the runtime or use Cursor SDK browser login, then choose a catalog model. No CLI is required. |
| Muse Code      | Official `@muse-code/sdk` 1.4.2, native MSP session API | Install and authenticate Muse Code, preferably the matching CLI release. The host must grant `sessionMcp`.            |

Hermes, Copilot, Grok and Muse adapters provide model discovery, session resume, streaming message
boundaries, tool activity, questions, approvals, cancellation and native compaction. Copilot, Hermes
and Muse support steering an active turn. Grok follows the shared ACP queue/interrupt behavior. Each
provider retains its own credentials, configuration and release channel. SDK updates ship with Dovo;
diagnostics report them separately from the host CLI.

Copilot accepts per-session MCP servers and tool filters. Tool-free utilities exclude all builtin,
MCP and custom tools and deny permission requests. Its optional configuration directory selects
`COPILOT_HOME`. Dovo resolves executable names on PATH before supplying them to the SDK. Copilot's
bundled CLI is excluded from Dovo packages; the SDK uses the explicit host installation.

Grok launches `grok --no-auto-update agent --no-leader stdio`. Disabling a shared leader keeps
thread MCP credentials scoped to Dovo's owned process. Authentication chooses an advertised API-key
method when a key exists, otherwise `cached_token`, with headless authentication metadata. Models
and reasoning come from ACP configuration options, with support for older stable model
advertisements. Grok currently has no advertised read-only mode, so Dovo excludes it from restricted
utility-provider choices.

Muse uses the SDK's public connection and `Session` APIs because the convenience session-start
facade does not yet expose per-session MCP overrides. Dovo requests the stable `sessionMcp` grant
before opening a session and supplies only thread-local MCP configuration. The SDK folds messages,
approvals and turn terminals, including transport loss. Model selections retain both model and
provider identity. Resume omits old history and refuses a different workspace. Reasoning and
approval changes use native session commands. Optional arguments replace the default `serve`
arguments.

For Muse, Dovo advertises bounded MCP schemas to fit the model API's ten-level nesting limit. Deeper
parameter shapes stay available as JSON Schema in field descriptions; callers still pass normal JSON
values. The task-tool server validates every call against the complete original schema and keeps its
input-size and access checks. This applies only to Dovo's managed MCP server; custom MCP servers
retain their own schemas.

Muse and Hermes cannot enforce tool-free utilities or read-only execution. Use Codex, Claude,
OpenCode, Copilot or Cursor for titles and dictation. Supervised and auto-edit behavior follows each
provider's native approval policy; none of these adapters adds an operating-system sandbox.

Cursor uses the SDK’s public local agent API, including session resume, model variants, streaming
message boundaries, exposed thinking and tool activity, per-turn usage, steering and cancellation.
Each turn owns a worker process and its descendants; credentials and environment never change the
runtime’s global environment. Ephemeral title/dictation sessions use a temporary store.

Cursor offers only **Read only**, **Auto-review**, and **Full access**. Read only restricts tools to
read/search/list and excludes MCP, SDK subagents and ambient settings. Utility turns exclude all
tools. These are tool restrictions, not a filesystem sandbox. Auto-review uses Cursor’s classifier
when available; the SDK otherwise executes tools automatically. It is not equivalent to supervised
approvals. Normal runs load Cursor settings and receive thread-scoped MCP overrides again on every
resume. Cursor’s built-in question tool is excluded because the SDK has no public answer callback;
Dovo’s MCP question tools remain available. Context summaries are automatic; manual compaction fails
explicitly without sending a fake command to the model.

Regular `dovo_task ask_question` and `todos` tools provide thread-scoped question forms and a shared
checklist independently of Studio Tools. Native question and planning tools remain preferred when
available. Codex plans, successful Claude todo/task changes, Muse todo lists, OpenCode todos,
ACP/Grok plans and successful Mistral Vibe todo results update the same desktop/mobile checklist.
The fallback question tool delivers answers as conversation input without holding an MCP call open.
Cursor can use it in normal sessions; its read-only mode excludes MCP. See
[chat interactions](chat-interactions.md) for tool semantics and lifecycle limits.

Sources: [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript),
[Hermes programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration/),
[Copilot SDK](https://github.com/github/copilot-sdk),
[Grok headless and ACP integration](https://docs.x.ai/build/cli/headless-scripting),
[Muse SDK documentation](https://meta-models.github.io/muse-code-sdk/next/).

## Tool context budgets

Enabled skills advertise their names and descriptions (up to 320 description characters per skill).
Agents call `dovo_task skill_read` for the complete content and supporting-file source path before
applying a skill. Reads use the active run credential and its captured enabled skills; disabled
skills and arbitrary file paths cannot be read through this tool. Explicitly mentioned disabled
skills still apply to that turn. Codex and Claude support scoped skill reads in read-only runs.
Restricted modes that may disable MCP and runs without Dovo task tools retain complete inline skill
instructions.

Tool names, typed argument schemas and server validation remain intact. Detailed native-device
guidance is returned by `devices`, which agents must call before using Device Hub. Tool context
regressions are checked against the actual MCP `tools/list` response, including generated schemas:

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/runtime/src/agent-tools/context-budget.test.ts packages/runtime/src/agents/execution/skill-context.test.ts
```

The core 15 tools decreased from 12,011 to 9,919 serialized characters (17%). All optional features,
including Studio, decreased from 50,079 to 47,590 characters (5%) for the same 41 tools; enabling
skill reads adds one small tool. Tests cap core tools at 10,000 and all tools including skill reads
at 48,500 characters, with a separate description budget. A catalog stays within 9,500 characters
even with 40 distinct skills merged from project and agent scopes; complete skill bodies are
excluded from that budget because they are read on demand. These are reproducible character
measurements, not model-specific token counts. Actual token counts vary by model/tokenizer and
include other user/provider context.
