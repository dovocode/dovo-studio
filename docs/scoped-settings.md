# Scoped project and computer settings

Task defaults, lifecycle policies and agent launch settings, MCP servers, managed skills, hooks and
saved prompts inherit in this order:

1. **Global** — shared with connected paired environments.
2. **Computer** — overrides for one computer/runtime.
3. **Project** — shared for checkouts with the same canonical Git remote identity.
4. **Project on computer** — overrides for one checkout on one environment.

The **Task defaults**, **Agents** and **MCP, skills & hooks** pages share a project/computer target
selector on desktop and mobile. The four levels are visible in order and can be selected directly.
Choose **All projects** or a project, then **All computers · shared** or one computer. These choices
select one of the four levels above; shared settings synchronize defaults rather than bulk-editing
each computer’s overrides. The target stays selected between these pages. A project missing from the
selected computer cannot be edited until another target is chosen. Local folders are offered only
with a specific computer.

Each task setting shows its effective source beside the control. **Set here** identifies an override
at the selected level; **Inherited** identifies the earlier level or Dovo default. Individual Reset
controls use the earlier value, and changes are saved using **Save defaults**. Unset task fields
inherit; an empty setup command disables inherited setup. Agent launch settings are selected and
reset as a complete group so models and account settings cannot cross providers. Choosing an agent
profile copies its launch settings and access into the defaults. Saved prompts can be edited here on
both platforms. Computer and project detail panels retain their local scope picker. Device
preferences save automatically outside the shared target; computer installations and text generation
remain specific to their computer.

Existing environment defaults stay environment-specific. Existing project defaults, tools and
prompts stay at Project on computer. Existing conversations keep their copied launch defaults.
Resource changes take effect on the next turn; custom-agent resources apply after the four settings
scopes.

Lifecycle policies are resolved when tasks run or housekeeping checks them, rather than copied at
creation. See [General settings](general-settings.md) for quota continuation, settling and legacy
per-computer fallbacks.

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

## Agent profiles

The **Agents** screen includes built-in Codex, Claude Code, OpenCode, Cursor, GitHub Copilot,
Hermes, Grok Build and Muse profiles before any configuration is saved. They use the provider’s
normal model defaults and the installation and login on the selected computer. A profile does not
install a CLI or log in automatically. ACP agents are added from the registry or configured
manually.

Profiles inherit by stable ID through Global → Computer → Project → Project on computer. Saving an
inherited profile creates an override at the selected level; Reset reveals the earlier profile,
including the built-in baseline. Only overrides are stored. Duplicate creates a separate ID.
Removing a configuration preserves copies already used by threads. Existing computer configurations
and older global presets remain available until their corresponding scope is edited; an explicit
empty configuration list prevents legacy entries from returning.

Models, access and instructions appear first. Connection paths, arguments, environment variables and
account settings are in **Connection & account**. Provider diagnostics and installations are
separate from the common editing flow. Narrow web layouts use a searchable profile picker; native
mobile rows put secondary actions behind More actions.

Each configuration includes its harness, model, access, instructions, connection and optional tools.
MCP, skills & hooks lists configurations owned by the selected scope alongside its project tools.
Shared configurations follow the same credential and local-file restrictions as shared project
tools; installed ACP configurations require an environment target. Launchers on both platforms
resolve the selected project's effective configurations and copy the chosen launch settings into the
thread. Favorites and provider checks belong to the connected environment. Installations are shown
when editing a computer for all projects. Titles & dictation has a dedicated computer-specific page.

Named configurations and default/tool settings compare and save independently, preserving concurrent
changes to the other category. Conflicting edits to configurations still require a reload. Older
runtimes display an update notice instead of accepting unsupported named configuration writes.
