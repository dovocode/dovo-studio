# Harness instruction files

Open **Settings → Agents** on desktop or mobile. Select **All projects** and the computer that runs
the harness. Open **Harness instruction files**. This editor changes native files on that computer.
The project instruction editor stays separate. These files do not sync to other computers.

The list includes native defaults and saved computer agent profiles. Profiles that use the same file
share one entry. The editor shows the exact path and profile names. Save profile changes first if
you need to change a configuration directory.

| Harness            | Default file                         | Directory override                                |
| ------------------ | ------------------------------------ | ------------------------------------------------- |
| Codex              | `~/.codex/AGENTS.md`                 | `CODEX_HOME` or profile Config directory          |
| Claude Code        | `~/.claude/CLAUDE.md`                | `CLAUDE_CONFIG_DIR` or profile Config directory   |
| Pi                 | `~/.pi/agent/AGENTS.md`              | `PI_CODING_AGENT_DIR` or profile Config directory |
| OpenCode           | `~/.config/opencode/AGENTS.md`       | `XDG_CONFIG_HOME` changes the `.config` root      |
| GitHub Copilot CLI | `~/.copilot/copilot-instructions.md` | `COPILOT_HOME`                                    |
| Hermes             | `~/.hermes/SOUL.md`                  | `HERMES_HOME` or profile Config directory         |

Profile environment variables and the runtime environment apply on the selected computer. A profile
Config directory takes precedence for harnesses that support it. Relative directories cannot be
edited here. Other harnesses and extra OpenCode rule files are outside this editor's scope.

Existing Codex `AGENTS.override.md` files also appear. Codex reads that file before `AGENTS.md`.
Existing Pi override and fallback files appear too. Pi reads the first file in this order:
`AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`. Creating a primary
instruction file can replace a fallback in the harness's instruction lookup.

Edit the text, select **Review diff**, then **Save instruction file**. Editing after review requires
another review. Opening or reviewing a missing file creates nothing. Save creates the file and any
missing configuration directories. New files use mode `0600`; new directories use `0700` where the
operating system supports these modes.

The editor keeps a separate draft for each file and computer while the settings page stays mounted.
It keeps drafts when the connection drops or a profile changes. It does not persist drafts across
app restarts. Navigation uses the existing unsaved-settings guard.

Save rejects external changes. **Reload disk version** updates the base and keeps your dirty draft.
Review the new diff before saving. **Discard draft** asks for confirmation. Existing symlinks stay
intact; the editor replaces their resolved target and keeps its permission mode. Broken or changed
links require a reload. Files must be regular UTF-8 text and at most 200,000 bytes.

Start a new harness session to read saved changes. Existing sessions may keep instructions in their
own context. Only paired human clients can use the file endpoints; agent-scoped requests cannot.
HTTP remains supported for LAN and VPN connections.

## Verification

```sh
pnpm exec vp test packages/runtime/src/agents/configuration/harness-instructions.test.ts
pnpm exec playwright install chromium
pnpm test:harness-instructions:browser
pnpm test:scoped-agents:browser
pnpm --filter @dovo/runtime --filter @dovo/studio-core --filter @dovo/extension-agents --filter @dovo/mobile typecheck
```

The runtime suite uses real temporary files, symlinks, SQLite and authenticated HTTP. The browser
suite runs the shared editor logic and desktop controls in managed Chromium. Mobile checks mock the
native control boundary; they do not establish behavior on a physical phone.
