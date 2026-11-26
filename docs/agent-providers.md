# Native coding-agent providers

Dovo exposes Hermes, GitHub Copilot, Grok Build, Muse Code and Cursor alongside Codex, Claude,
OpenCode and custom ACP agents. The provider runs on the selected runtime computer; desktop, web and
mobile all use the same runtime adapter. Installing a Dovo SDK dependency does not install or
authenticate the agent CLI.

After installing a CLI on the runtime computer, use **Check provider** in Settings or refresh
provider or model discovery in the picker. On macOS and Linux, the runtime rereads the login shell's
PATH and checks the usual tool directories. If the shell fails, discovery keeps the last usable
PATH. New provider processes inherit the refreshed path. `DOVO_LOGIN_PATH=off` disables login-shell
PATH discovery.

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

When you stop an ACP compact command, Dovo keeps the current context usage and compaction history.

Copilot accepts per-session MCP servers and tool filters. Tool-free utilities exclude all builtin,
MCP and custom tools and deny permission requests. Its optional configuration directory selects
`COPILOT_HOME`. Dovo resolves executable names on PATH before supplying them to the SDK. Copilot's
bundled CLI is excluded from Dovo packages; the SDK uses the explicit host installation.

Grok launches its ACP host with `--no-auto-update` and `--no-leader`. Disabling a shared leader
keeps thread MCP credentials scoped to Dovo's owned process. Authentication chooses an advertised
API-key method when a key exists, otherwise `cached_token`, with headless authentication metadata.
Models and reasoning come from ACP configuration options, with support for older stable model
advertisements. Discovery still lists available choices if a saved choice disappears. A turn
requires the agent to accept its selected model and reasoning. Grok currently has no advertised
read-only mode, so Dovo excludes it from restricted utility-provider choices.

Grok offers Supervised, Auto, and Full access. The thread's mode controls the launch flags. In Auto,
permission requests Grok still sends go to the user. An existing Auto-accept edits setting runs as
Supervised.

Muse uses the SDK's public connection and `Session` APIs because the convenience session-start
facade does not yet expose per-session MCP overrides. Dovo requests the stable `sessionMcp` grant
before opening a session and supplies only thread-local MCP configuration. The SDK folds messages,
approvals and turn terminals, including transport loss. Model selections retain both model and
provider identity. Resume omits old history and refuses a different workspace. Reasoning and
approval changes use native session commands. Optional arguments replace the default `serve`
arguments.

Muse selects its native permission profile at session start and resume. Full access uses
`:unrestricted`. Other interactive modes use `:ask-me`. Utility sessions keep their restricted
launch settings.

Each Muse approval lists its available choices. Dovo maps `approved` with scope `once` to **Allow
once**, scope `session` to **Allow for session** and scope `localPersistent` to **Always allow**.
Other pairs map to no scope. Dovo sends only the scopes it found and returns the choice that matches
the decision exactly. It never widens **Allow once** to a session or persistent grant. When Full
access approves a request automatically, it uses the single-use choice, then the session choice. It
denies a request that offers only a persistent grant, so Dovo never saves a Muse policy for the
user.

Stop sends a native interrupt to the active Muse turn before Studio closes its host, including on
follow-up turns that reuse that host.

For Muse, Dovo advertises bounded MCP schemas to fit the model API's ten-level nesting limit. Deeper
parameter shapes stay available as JSON Schema in field descriptions; callers still pass normal JSON
values. The task-tool server validates every call against the complete original schema and keeps its
input-size and access checks. This applies only to Dovo's managed MCP server; custom MCP servers
retain their own schemas.

Muse and Hermes cannot enforce tool-free utilities or read-only execution. Use Codex, Claude,
OpenCode, Copilot or Cursor for titles and dictation. Supervised and auto-edit behavior follows each
provider's native approval policy; none of these adapters adds an operating-system sandbox. To
isolate a thread, use a [container sandbox](sandboxes.md).

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

## Claude through a proxy

Dovo uses the Claude Agent SDK and the Claude CLI on the selected runtime computer. Create a
separate Claude agent in Agent settings on desktop, web or mobile. Keep its existing executable path
or select the installed Claude CLI. The executable field is not the model API URL. Choose a separate
configuration directory for each account. Dovo maps it to `CLAUDE_CONFIG_DIR`.

Set these environment entries on that agent:

| Entry                  | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`   | The proxy's Anthropic-compatible base URL, such as `http://proxy.lan:8317`.        |
| `ANTHROPIC_AUTH_TOKEN` | The proxy credential. Prefer a secret reference.                                   |
| `ANTHROPIC_API_KEY`    | An empty value when the proxy uses an auth token. This overrides an inherited key. |

Select the exact model ID accepted by the proxy. Do not put the URL in the executable field. Claude
settings can override environment entries. Check user, project and local settings if Claude uses
another endpoint or credential. These settings sources remain enabled for normal sessions. Start a
new turn after changing the agent configuration. Remove the entries or select the original agent to
return to the previous connection. Existing pairings stay unchanged.

The proxy handles model traffic. Dovo supplies its local, thread-scoped MCP connection separately.
Claude can call `dovo_task code`, direct MCP tools and its native file and shell tools under the
current access policy. The code runner keeps per-call approval and access checks. A proxy does not
need to implement UTCP. It must support Claude's model request and tool-call formats.

Leave `ENABLE_TOOL_SEARCH` unset to use Claude's default. If a proxy cannot handle tool search, set
it to `false` on that agent. Dovo preserves an explicit value, including `auto:15`.

Adapter tests verify separate proxy environments, exact model selection, local MCP configuration,
cleanup and retained native tool checks. They mock the Agent SDK. A live Claude CLI and an
Anthropic-compatible proxy are still required to verify a complete model reply and code-mode call.
See [code mode](code-mode.md) for discovery, chained calls and limits.

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

The current catalog uses 9,948 serialized characters for the core 15 tools. All optional features,
including Studio and skill reads, use 48,471 characters for 42 tools. Tests cap core tools at 10,000
and all tools at 48,500 characters, with a separate description budget. A skill catalog stays within
9,500 characters even with 40 distinct skills merged from project and agent scopes; complete skill
bodies are excluded from that budget because they are read on demand. These are reproducible
character measurements, not model-specific token counts. Actual token counts vary by model/tokenizer
and include other user/provider context.

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

## Codex service tiers

Studio offers fast service tiers when Codex advertises them and its configuration policy permits
fast mode. If policy changes after you save a fast tier, Studio stops before starting the turn.
Select **Standard** to run under the current policy.

## ACP v2 rollout

ACP v1 shows modes from the agent's configuration options or its legacy mode list. The mode picker
also reads choices saved by older clients. Read-only turns use a mode that the agent advertises for
planning or read-only work. Dovo reads the configuration again after an agent announces a change. If
the agent does not confirm a requested configuration setting, Dovo stops before sending the prompt.

Antigravity uses native Auto when available. Otherwise it uses the protocol's default mode and Dovo
applies the thread policy to permission requests. Saved ACP mode choices cannot widen Antigravity
permissions. Kiro v3 enables Autopilot only for unrestricted Full access. Older saved Auto and
Auto-accept edits settings run as Supervised.

ACP v1 stays enabled by default. Dovo also supports the draft ACP v2 baseline through the existing
SDK 2.4.0. To try it, add `DOVO_ACP_V2=1` to an ACP agent's environment in Agent settings. The flag
applies to model discovery, sign-in, session management and conversations on that runtime. You can
set it on the runtime host instead. An agent value of `DOVO_ACP_V2=0` overrides the host. Start a
new turn after changing the agent environment. Restart the runtime after changing its host
environment.

Dovo requests protocol 2. If the agent selects v1, or reports that it supports only v1, Dovo closes
that process and starts a fresh v1 connection before creating or resuming a session. Authentication
failures, invalid v2 responses and lost connections do not trigger fallback. A v1 agent that rejects
v2 without a supported-version response can use the default v1 path by setting the flag to zero.
Switching protocol versions does not convert stored provider sessions. If the agent cannot resume a
session through the other protocol, start a new session explicitly.

V2 prompt responses acknowledge insertion. Dovo waits for the foreground idle update to finish a
turn. It retains partial output when the agent reports a later failure. Message IDs support
interleaved chunks, whole-message replacement and clearing. Tool updates retain omitted fields,
clear null fields and patch metadata by key. Exposed thoughts and item plans use the existing
reasoning and checklist UI. Agent terminal output appears as a display receipt, with no local input
or process controls. Live receipts show up to 1024 characters of recent tool or terminal text. At
completion or turn end the receipt contains the collected tool output or the last 262144 terminal
characters. If you stop a turn, its interrupted receipt includes output accepted before Stop. Later
chunks cannot change the receipt. Full v2 payloads remain in provider events, including unknown
update variants.

Session resume omits replay because Dovo already stores the transcript. Dovo saves live assistant,
tool and terminal output after the current state update. Output from resumed foreground work belongs
to the earlier turn. Dovo waits for idle before applying configuration or sending another prompt,
and routes permission requests and forms under the current thread policy during the wait. When a v1
load or resume announces a child, Dovo restores its identity and controls even if session setup has
yet to finish.

Stop sends foreground cancellation and waits for confirmation. ACP v2 background work listed by the
agent continues after confirmation. Use Stop agents to stop all work in that session. If the agent
does not confirm cancellation within 1.5 seconds, Dovo closes its owned process tree. Temporary
sessions require deletion support.

V2 model, mode, reasoning and boolean options use typed configuration IDs. Read-only turns require
an advertised read-only or plan mode. Permission subjects use Dovo's current access policy. Native
session forms use the existing question flow. URL forms and request-scoped forms are declined. The
v1 client file and terminal APIs are absent in v2. Client tools must use an MCP transport the agent
advertises. Dovo does not advertise additional unstable v2 features such as native subagent control
or MCP-over-ACP.

Run the focused checks with:

```sh
pnpm exec vp test --maxWorkers=2 packages/runtime/src/agents/providers/acp packages/runtime/src/agents/catalogs/acp.test.ts packages/runtime/src/agents/execution/reasoning-event.test.ts
pnpm --filter @dovo/runtime typecheck
```

These tests use real owned Node processes and stdio JSON-RPC. They cover both protocols, fallback,
completion after acknowledgment, later errors, cancellation, resume, permission decisions, forms,
configuration, message patches and terminal byte decoding. They do not establish compatibility with
a live model provider. ACP v2 remains draft and disabled by default.

A live check on Mac Studio with `agy acp` 1.5.6 confirmed that it selects v1 when Dovo requests v2.
Dovo opened a fresh v1 connection, created a session and sent the prompt. The model request returned
`503 auth_not_found`, so this check did not verify a model reply or live v2 execution. The test left
credentials unchanged. This agy version does not advertise session deletion.

On Linux, Antigravity 1.5.14 selected ACP v1 when asked for v2. Discovery offered eight models with
either the default settings or an obsolete saved model and mode. Selecting Gemini 4 Neon returned
four reasoning levels. A fresh process resumed the same session and applied a different model
through the v1 configuration code. The live tool-free prompt checks reached their deadlines without
a reply and confirmed cancellation. A cancellation receipt alone does not establish prompt
acceptance. The direct `agy --print` command also reported a timeout for `gemini-3.1-pro` with a
50-second limit. `gemini-4-neon` also timed out in the direct CLI with a 35-second limit.

On Mac Studio, the 1.5.9 direct CLI timed out. On the MacBook, 1.5.12 opened an ACP v1 session and
accepted the `gemini-4-neon` selection. It streamed `503 auth_not_found` during the prompt. It also
sent a usage update. The prompt reached its deadline without a completion receipt or the requested
reply. Retesting through Dovo's built ACP adapter returned the same provider error and reached the
45-second deadline.

For ACP v1 prompts, Dovo checks Antigravity's local session log for a terminal error recorded during
that prompt. This catches an error even if Antigravity returns `end_turn`. If Antigravity streams an
authentication error and usage without ending the prompt, a matching terminal authentication error
in the log lets Dovo report the failure promptly. If the log is unavailable, Dovo uses the ACP
response and the normal deadline. Subprocess tests cover both response paths and verify that an
older error row and quoted error text do not end a new turn.

Open a known Antigravity child in the thread's **Agents** panel to read its recent messages,
reasoning and tool output. Dovo reads the transcript when the parent's profile records that child.
The saved prompt and result remain available if the transcript or ownership record is missing.

An idle Antigravity ACP v1 session can apply an advertised model and its reasoning level in the same
process. Reuse requires the same thread, session, checkout, launch settings and permissions. The
agent must have no working native children when the selection changes. It applies the model before
reasoning because a model change can reset the reasoning options. A subprocess fixture checks the
request order, verifies that the session stays open and confirms that a profile change starts a new
process.

On Linux with `agy` 1.5.14, process launch, ACP initialize, resume and model selection took a median
425 ms across three samples. Selecting a model in an open session took a median 11 ms. The samples
verified ACP configuration receipts. Model reply latency remains unverified.

On Linux, OpenCode 2.3.2 offered 25 models through ACP with an obsolete saved model and mode. Dovo
received the expected reply with `opencode/tidepool-alpha-free`, then resumed the same session,
selected `opencode/beam-free`, and received a second reply. Both requests used a temporary project
directory and sent no MCP tools.

Protocol reference: [ACP v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration).
