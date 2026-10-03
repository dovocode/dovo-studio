# Scoped project and environment settings

Task defaults and agent launch settings, MCP servers, managed skills, hooks and saved prompts
inherit in this order:

1. **Global** — shared with connected paired environments.
2. **Environment** — overrides for one computer/runtime.
3. **Project** — shared for checkouts with the same canonical Git remote identity.
4. **Environment + project** — overrides for one checkout on one environment.

The **Task defaults**, **Agents** and **MCP & skills** settings pages share a project/environment
target header on desktop and mobile. Choose **All projects** or a project, then **Shared across
environments** or one computer. These two choices select one of the four levels above; shared
settings are synced defaults, not a bulk edit of each computer’s overrides. The target stays
selected when switching between these pages. A project missing from the selected computer cannot be
edited until another target is chosen. Local folders are offered only with a specific environment.

Task defaults show **Inheritance & overrides**, with the effective source for each setting and an
individual reset control. Resets are saved using **Save defaults**. Unset task fields inherit; an
empty setup command disables inherited setup. The agent configuration is selected and reset as a
complete group so models and account settings cannot accidentally cross providers. Saved prompts can
be edited here on both platforms. Computer and project detail panels retain their local scope
picker. App-only preferences and host installation settings remain outside the shared target.

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

## Named agent configurations

The **Agents** screen uses the same target header as task defaults and project tools. Reusable
configurations inherit by stable ID through Global → Environment → Project → Environment + project.
Choose **Override** on an inherited row to customize it at the selected target, or **Reset** to
remove the override. Duplicate creates a separate ID. Removing a configuration preserves copies
already used by threads. Existing environment configurations and older global presets remain
available until their corresponding scope is edited; an explicit empty configuration list prevents
legacy entries from returning.

Each configuration includes its harness, model, access, instructions, connection and optional tools.
MCP & skills lists configurations owned by the selected scope alongside its project tools. Shared
configurations follow the same credential and local-file restrictions as shared project tools;
installed ACP configurations require an environment target. Launchers on both platforms resolve the
selected project's effective configurations and copy the chosen launch settings into the thread.
Favorites and provider checks belong to the connected environment. Installations, titles and
dictation are shown when editing that environment for all projects.

Named configurations and default/tool settings compare and save independently, preserving concurrent
changes to the other category. Conflicting edits to configurations still require a reload. Older
runtimes display an update notice instead of accepting unsupported named configuration writes.
