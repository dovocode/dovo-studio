# Mistral Vibe

Mistral Vibe is a built-in harness on desktop, web and mobile. Dovo runs the native
`vibe-app-server` process on the connected runtime computer. This integration was verified with
Mistral Vibe **2.26.1**; it uses Vibe's own sessions, models, tools and configured credentials.

## Setup

On the runtime computer, install Vibe and configure its credentials:

```sh
uv tool install mistral-vibe
vibe --setup
```

Select **Mistral Vibe** in Agents or **Vibe** in the task harness picker. Availability is checked
through the app-server handshake and Vibe's credential status, without sending a model prompt. The
configured model aliases and their reasoning levels come from Vibe's configuration.

The default executable is `vibe-app-server`, which must be on the runtime's PATH. Override it under
runtime settings → Agent commands, or in a saved agent's executable settings. Point this at the
app-server executable, not the interactive `vibe` CLI. Saved agents also support arguments,
environment variables and a configuration directory (`VIBE_HOME`). Credentials remain on the runtime
host; Dovo does not add an account or login service.

## Behavior

- Streams assistant text, reasoning and tool activity, including tool inputs and results.
- Resumes persisted Vibe sessions for follow-up messages, and supports active-turn steering, native
  compaction and cancellation.
- Supplies agent instructions as session context and enabled Dovo MCP servers as session options.
  Model and reasoning changes use Vibe's session override layer, preserving saved host preferences.
- Maps supervised access to Vibe's `ask` profile, auto-accept edits to `accept-edits`, and full
  access to `auto-approve`. Auto falls back to supervised approval. Approval requests and structured
  questions appear in Dovo.
- Read-only access restricts Vibe's tools to file reads, search, skills and questions. It does not
  expose an operating-system filesystem sandbox or Codex's advanced sandbox controls.
- Reports context usage and turn token counts supplied by Vibe.

Dovo starts an owned app-server process for each turn and closes it afterwards. Follow-ups resume
from Vibe's persisted history; native background workers are not retained between turns. Dovo child
tasks can independently select Vibe as their provider.

Vibe is excluded from text-only utility jobs, such as title generation: its unified runtime still
exposes native tools with a deny-all filter, so Dovo does not claim a tool-free session. Choose
another supported provider for those jobs. Provider-native subagent panels and subscription quota
windows are not currently imported.

Protocol reference:
[Mistral Vibe v2.26.1](https://github.com/mistralai/mistral-vibe/tree/v2.26.1/vibe/app_server).
