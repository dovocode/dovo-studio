# Agent plugins

Install Claude Code and Codex plugins from a GitHub plugin marketplace on a paired computer. Turn a
plugin on for all projects on that computer, for a project organization, or for one project.

## Add a marketplace and install a plugin

1. Open **Studio extensions** and choose the computer. On desktop and web, you can also run **Browse
   agent plugin marketplaces** from the command palette.
2. In **Agent plugins**, enter a GitHub repository as `owner/repo` or
   `https://github.com/owner/repo`. You can add a branch or tag. Select **Add marketplace**. Studio
   shows the marketplace name, the repository and the commit it resolved, for example
   `revision 3f2c1a9`.
3. Select **Browse plugins**. Entries that Studio cannot install show **Unavailable** and the
   reason.
4. Select **Review**. The review shows the revision, the file count and size, and the plugin's
   skills, commands, agents, hooks and MCP servers. Hooks run shell commands and MCP servers start
   processes or connect to services inside the agent.
5. Choose **Claude Code** or **Codex**. Leave **Turn on for all projects on this computer** off to
   install the plugin without turning it on. Select **Install for Claude Code** or **Install for
   Codex**.

The installed plugin shows its harness, revision and where it is on. Use **Turn on for all
projects** or **Turn off for all projects** to change the computer default. Select **Remove** to
uninstall it. **Check for updates** resolves the branch or tag again. After an update, review the
plugin again before you install the new revision. Repeating an install of the same revision changes
nothing. Remove a marketplace's plugins before you remove the marketplace.

Mobile has the same controls in **Settings → Agents & tools → Studio extensions**.

## Turn a plugin on for an organization or a project

Open **Settings → MCP, skills & hooks**. Choose an organization, a project or a project on a
computer. **Agent plugins** lists the Claude Code plugins installed on the selected computer:

- **Inherit** uses the earlier level, then the computer default.
- **On** or **Off** overrides the earlier levels for that plugin.

The levels apply in this order: computer default, all machines and projects, machine, organization,
project, project on machine. To share a plugin with a group of projects, give the projects the same
**Project organization**, open that organization and set the plugin to **On**. Projects outside the
organization do not get it. A project can still set it to **Off**. Setting the project back to
**Inherit** shows the organization's choice again. Removing a project from the organization removes
the organization's plugins, skills and MCP servers from that project.

A choice is stored with the plugin's ID, for example `formatter@gh-1a2b3c4d5e6f:claude`. The ID is
the same on each computer that installs the plugin from the same repository, so shared levels apply
on every computer where it is installed. A choice for a plugin that is not installed on a computer
has no effect there; the editor shows it with **Remove choice**. Removing an installation keeps the
choices, so a later install uses them again.

Changes apply when a thread starts a new Claude Code session.

## What works

| Item                                         | Support                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/marketplace.json`            | Plugin entries with a folder source such as `"./plugins/name"`, or a bare name under `metadata.pluginRoot`.                   |
| `.agents/plugins/marketplace.json` (Codex)   | Plugin entries with `{ "source": "local", "path": "./plugins/name" }`.                                                        |
| Both files in one repository                 | Entries merge by name. If they name different folders, the entry is unavailable.                                              |
| `github`, `url`, `git-subdir`, `npm` sources | Unavailable. Studio installs only folders in the marketplace repository.                                                      |
| Plugin manifests                             | `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`. Codex requires one of these files.                               |
| Plugin files                                 | Regular files only, up to 2,000 files and 32 MB. Symlinks and submodules make a plugin unavailable.                           |
| Claude Code                                  | Dovo passes the plugin folder to each Claude Code launch. Your own Claude Code settings do not change.                        |
| Codex                                        | Dovo installs with the Codex app-server plugin API, in Codex's own settings. Codex CLI sessions on that computer also use it. |

Verified with Claude Code 2.1.331, Claude Agent SDK 0.3.323 and Codex CLI 0.172.0.

### Codex plugins are on or off for the whole computer

Codex 0.172.0 reads plugin activation from its `config.toml`. We tested enabling and disabling an
installed plugin through thread settings and app-server command-line overrides. Its skill appeared
in the model request only when `config.toml` enabled it. A project or organization therefore cannot
turn a Codex plugin on or off. Studio rejects such a choice instead of turning the plugin on for
every Codex session. Use **Turn on for all projects** for a Codex plugin.

### Sandboxed threads

Claude Code plugins do not load in sandboxed threads, because the container cannot read the plugin
folder on the host.

## Review and ownership

Studio treats the repository as data. Adding a marketplace, browsing and reviewing read JSON
manifests and the file list through the GitHub API. They do not download plugin files or run
anything. Installing downloads the reviewed revision into a folder on the computer, then registers
it with Codex when you chose Codex. If the marketplace resolves a new revision after your review,
the install stops and asks for a new review.

Paired people can add marketplaces and manage plugin activation and removal. Installations, the
plugin files and the computer default belong to the paired computer.

## Install with a Bot

Ask a Bot to find and install a plugin from one of the computer's configured marketplaces. The Bot
can browse and preview a plugin with `studio_extensions` using `{"action":"plugins"}` to get its
commands. When it requests an install, Studio makes an approval in the Bot thread with the
repository, revision, harness and plugin contents summary. Approve that request to install the
reviewed revision. The plugin starts with activation off. Turn it on from **Agent plugins** or, for
Claude Code, in the organization or project settings. A marketplace refresh during review requires a
new preview and approval.

## Verify

```sh
pnpm exec vp test packages/runtime/src/agents/plugins packages/protocol/src/shared/plugin-activations.test.ts packages/runtime/src/agents/providers/claude/claude.test.ts
pnpm exec playwright install chromium
pnpm test:agent-plugins:browser
```

The runtime tests install through `/api/agents/plugins` against a fixture GitHub repository at two
revisions. They start real turns for two organization members and one other project and check the
plugin folders, skills and MCP servers each Claude Code launch receives. When the `codex` command is
available, a test installs, turns on, turns off and removes a plugin with the Codex app-server in an
empty `CODEX_HOME`. The browser check renders the desktop/web and mobile views against an in-memory
runtime.
