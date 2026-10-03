# Scoped project and environment settings

Task defaults and agent launch settings, MCP servers, managed skills, hooks and saved prompts
inherit in this order:

1. **Global** — shared with connected paired environments.
2. **Environment** — overrides for one computer/runtime.
3. **Project** — shared for checkouts with the same canonical Git remote identity.
4. **Environment + project** — overrides for one checkout on one environment.

Open task defaults on a computer or project and choose the settings scope. The MCP & skills page
lists these same scopes alongside custom agents. Saved prompts can be edited in task defaults on
desktop and mobile. Unset task fields inherit; an empty setup command disables inherited setup. The
agent configuration is selected as a complete group so models and account settings cannot
accidentally cross providers.

Existing environment defaults stay environment-specific. Existing project defaults, tools and
prompts stay at Environment + project. Existing conversations keep their copied launch defaults.
Resource changes take effect on the next turn; custom-agent resources apply after the four settings
scopes.

MCP servers and skills override earlier definitions by exact name, including disabled entries.
Prompts override by case-insensitive name. Removing an override reveals the inherited definition.
The editors show inherited entries that can be copied into the current scope and changed or
disabled. Hooks override by name across the four scopes; custom-agent hooks still append to the
resolved project hooks.

Project identity uses the existing Git origin identity normalization, including SSH/HTTPS
equivalents. Forks remain separate. If there is no origin, only an unambiguous remote identity is
shared. Folder projects, scratch projects and repositories without a usable remote keep local
scopes; they are never grouped by name or path. A changed remote rejects a project save until the
settings are reloaded.

Shared settings are persisted on runtimes and cached by desktop/mobile clients. Connected clients
reconcile newer shared entries across their paired runtimes. An offline environment receives updates
when a client connects it again; runtimes do not contact each other or use an external relay. Reset
entries keep their revision so an old offline copy cannot resurrect deleted overrides. Concurrent
edits to the same shared scope resolve by revision and change ID; stale saves on a runtime return a
conflict instead of overwriting newer data. Older runtimes do not receive unsupported settings
writes and need an update to expose these editors.

Literal MCP credentials remain private on the environment that stores them. Global and shared
project MCP entries must use host environment-variable references; use environment-specific entries
for literal credentials. Installed ACP agent IDs are environment-specific and cannot be saved in
shared scopes. HTTP LAN/VPN connections and existing pairing/device tokens remain supported.

Catalog skills keep their pinned source revision. Each runtime installs and caches its own
supporting files before using the skill, preserving edited instruction text. Cached bundles can be
used offline after installation. Arbitrary local skill folders remain environment-specific; choose
**Use instructions only** to explicitly share a copy without supporting files. Shared settings never
copy another computer’s skill filesystem path.
