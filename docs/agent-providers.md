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

## Import a terminal Codex session

Choose **Import Codex terminal session** when starting a thread in a selected project on desktop/web
or mobile. Choose the Codex configuration whose home contains the session, preview its conversation,
then import it. Discovery runs on the selected runtime computer and honors the configuration
directory and `CODEX_HOME`. Close the original terminal session first.

Import saves an idle thread with the original checkout, native session identity, model and reasoning
when recorded. It does not run Codex. Historical requests are marked consumed, including an
unfinished final request; send a new message to continue. Repeating the import opens the same
thread, including after a runtime restart. Existing Dovo-owned sessions link to their current
thread. Leaving the import screen prevents a late navigation; a completed import remains available
in the task list. Sessions started in a project subfolder retain that working directory and share
checkout admission with the parent checkout.

Discovery is bounded to 400 transcripts and 6,000 directory entries. Preview/import accepts up to 16
MiB and 10,000 messages per transcript; the preview shows the latest 100 messages. Missing
checkouts, changed previews and active sessions block import. Continuation checks the original path
and native ownership again. Native ownership checks support Linux and macOS; other platforms can
preview but cannot import when ownership cannot be established. Checks describe ownership at that
moment; they do not reserve a session against an external terminal opening it later. Imported
history is a snapshot, not continuous synchronization with terminal activity.

## Secret environment references

Agent editors on desktop/web and mobile support **Secret environment references** with a current
runtime. Save the environment variable name and a reference; Dovo resolves the value on the runtime
computer before provider execution, probing, model discovery or native-thread reads. References also
apply to account usage/reset checks. Local transcript scans resolve only directory variables. A
reference overrides a literal environment entry with the same name. Missing references fail the
operation instead of silently using the host's default credentials.

| Provider         | Reference and runtime setup                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1Password        | `op://vault/item/field`; install and authenticate `op`. An optional account selects a specific account.                                                                      |
| Bitwarden        | Item ID and password, username or TOTP field; install `bw` and unlock its runtime session. TOTP is fetched again for each successive resolution.                             |
| Infisical        | Secret key, project ID, environment and folder path; install/authenticate `infisical`. An optional domain supports a self-hosted instance; omitting it uses the CLI default. |
| Host environment | Name of an environment variable inherited by the runtime process.                                                                                                            |

Authenticate the CLIs as the user running Dovo. A desktop login shell and a background service may
have different PATHs, session variables and provider credentials; configure those on the runtime
host. CLI lookup uses the runtime's own environment, independent of the agent's configured PATH.
Dovo does not install or log into these tools for you.

Values and failures are cached in memory until **Refresh secret references** or runtime restart.
After rotating credentials, refresh references before starting new work. This also invalidates model
catalogs and provider session identities for configurations using references. Already running work
keeps the credentials it started with. Refreshing a host-environment reference rereads the running
process environment; changing a service environment file requires restarting the service.

Workspace documents, presets and client responses retain references, never resolved values. Provider
lookup errors omit CLI output. Resolution runs at most two external commands concurrently, with
bounded output and a 45-second deadline; cancelling the last reader drains its command. Agent
processes necessarily receive the resolved environment, and provider tools can use it. Dovo owner
credentials and Electron's runtime switch cannot be used as reference sources or targets.

Automated tests use synthetic values and injected commands. Live provider authentication and real
secret reads have not been verified as part of this implementation.
