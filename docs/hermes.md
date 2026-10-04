# Hermes Agent

Select **Hermes** in Dovo's composer or save a named Hermes agent. Sessions run on the paired
runtime computer, including when you use mobile.

Dovo hosts Hermes'
[native TUI gateway](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration/),
the interface Hermes recommends for custom session UIs. Hermes has no supported TypeScript agent
SDK; its Python `AIAgent` is an in-process interface. The gateway retains native sessions, memory,
skills, tool events, questions, approvals, steering and compression.

Install and authenticate Hermes on the runtime host using its own installer and `hermes model`. Set
**Hermes executable** to the installed `hermes` command, for example
`/home/agentic/.local/bin/hermes`. Dovo searches the runtime's PATH and `~/.local/bin` by default,
then launches `hermes --run-module tui_gateway.entry`. The current Hermes launcher selects and
bootstraps its own Python environment. For older installer shims and Python console scripts, Dovo
resolves the launcher's own interpreter and starts `python -u -P -m tui_gateway.entry` in that
environment instead. It does not use the runtime machine's unrelated system Python.

Explicit Python interpreter paths and `HERMES_PYTHON` overrides remain supported. These use
`python -u -P -m tui_gateway.entry`; that environment must be able to import Hermes' gateway. For
source installations, set `HERMES_PYTHON_SRC_ROOT` to the Hermes checkout when needed. Optional
arguments replace the default gateway arguments; leave them empty for the normal launch.

An agent's configuration directory sets `HERMES_HOME`. Without an override, existing credentials,
memory, skills and the session database stay in their original home. Dovo does not rewrite the
user's config. It supplies thread-scoped MCP servers through a private temporary
[managed configuration overlay](https://hermes-agent.nousresearch.com/docs/user-guide/managed-scope/),
preserves existing managed settings and secrets, and refuses conflicting administrator approval
policy. Overlay files are removed after the owned gateway process tree exits.

Models are discovered from Hermes and selected per session as `provider:model`. Text-only steering
uses `session.steer`; attachment-bearing steering is refused so the input can be sent as a
follow-up. Compression uses `session.compress` and only reports success after its acknowledgement.
Durable session IDs survive a gateway restart. Changes to launch settings, access, model or MCP
bindings restart and resume the session with current credentials.

Hermes approvals are native tool permission checks, not an operating-system sandbox. It does not
expose tool-free or read-only sessions, so Dovo rejects those modes and excludes Hermes from
utility-provider choices. Choose a separate provider for titles and dictation.

Wire-level regression tests exercise the native gateway protocol, model selection, streaming
boundaries, approvals, questions, steering, resume, compression, cancellation, failures and the
private MCP overlay. They do not require an authenticated model provider.
