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

Sources: [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript),
[Hermes programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration/),
[Copilot SDK](https://github.com/github/copilot-sdk),
[Grok headless and ACP integration](https://docs.x.ai/build/cli/headless-scripting),
[Muse SDK documentation](https://meta-models.github.io/muse-code-sdk/next/).
