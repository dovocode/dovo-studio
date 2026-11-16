# Container sandboxes

A sandboxed thread runs its agent harness, every command the harness runs, the thread's terminals
and its agent hooks inside a local container. The Dovo runtime, pairing, storage and the user
interface stay on the host. Git operations that Dovo performs (checkpoints, Changes, review, commits
from the UI) also run on the host, against the same checkout, with the protections in
[Git on the host](#git-on-the-host).

Dovo uses one image, the **Mise sandbox**. It is Debian stable with [mise](https://mise.jdx.dev) and
common build tools. Projects add their own tools with mise.

## Set up

1. Install Docker or Podman on the computer that runs the Dovo runtime.
   - macOS: Docker Desktop.
   - Linux: Docker Engine, rootless Docker or Podman.
2. Make sure the user that runs Dovo can use the container CLI without `sudo`. Check with:

   ```sh
   docker info
   # or
   podman info
   ```

3. In Dovo, open the project settings and set **Container sandbox** to **Mise sandbox**.

Dovo looks for `docker` first, then `podman`. If neither answers, the project settings and the
thread show a setup message.

The first sandboxed thread builds the image locally. This can take several minutes. Later threads
reuse it. Dovo tags the image `dovo-sandbox:<hash>`. The hash covers the image files and the build
arguments, so a changed image definition builds a new tag. Dovo never pushes the image to a
registry.

## Turn a sandbox on or off

- **Project default.** Project settings, **Container sandbox**: Inherit, Off or Mise sandbox. The
  setting follows the normal [settings scopes](scoped-settings.md). Use the "this computer and
  project" scope if other computers do not have Docker.
- **One thread.** Before the first message, the composer shows **Host** or **Sandbox**. Choose
  either one. On mobile, tap the **Host** or **Mise sandbox** row in the thread setup.
- **Started threads.** The first turn records the choice on the thread. A later project change does
  not move a running thread. Start a new thread to change it.

A started sandboxed thread shows a **Sandbox** badge in the composer bar on desktop and web, and in
the thread information sheet on mobile. The badge shows the container state: preparing, running,
stopped or failed. Hover the badge, or open the sheet on mobile, to see build progress or the last
error.

Child agents and side threads use their parent's sandbox setting.

Runtimes without sandbox support hide all of these controls.

## What is in the image

The definition lives in [`packages/runtime/sandbox/`](../packages/runtime/sandbox/).

- Debian stable slim, pinned by digest, with `tini` as the init process.
- mise, pinned with a SHA-256 checksum. Node LTS is the only global default tool.
- bash, git, git-lfs, openssh-client, ca-certificates, curl, wget, gnupg.
- ripgrep, fd (`fd-find`, linked as `fd`), jq, yq (pinned with a checksum).
- tar, gzip, xz-utils, bzip2, zip, unzip, zstd.
- file, less, patch, diffutils, procps, findutils, tree, socat.
- build-essential, pkg-config, libssl-dev, for native add-ons and source builds.
- gh, the GitHub CLI. It has no login: Dovo does not mount a GitHub token.
- locales with `C.UTF-8`, and tzdata.
- A user with the host user's uid and gid, so files in the checkout keep their owner.

Harness CLIs are not in the image. Dovo installs the selected harness with mise the first time a
sandboxed thread uses it. See [harness support](#harness-support).

## Tools with mise

mise data and downloads live in the `dovo-sandbox-mise` volume. All sandboxes share it, so a tool
installs once.

Before the first turn or terminal in a container, Dovo checks the checkout for:

- `mise.toml`, `.mise.toml`, `mise.local.toml`, `.config/mise.toml`, `mise/config.toml`,
  `.mise/config.toml`, `.tool-versions`
- `.nvmrc`, `.node-version`, `.python-version`, `.ruby-version`, `.go-version`,
  `rust-toolchain.toml`

If one exists, Dovo runs `mise trust` for each mise file in the checkout, then `mise install`. Dovo
never trusts a path outside the checkout. Progress appears in the thread. If the install fails, the
badge shows the mise output and the thread still starts, so the agent can fix the configuration.

To add tools to a project, commit a `mise.toml`:

```toml
[tools]
node = "22"
python = "3.12"
go = "1.25"
```

The agent knows it runs in a sandbox. If it needs a tool that is missing, it can run
`mise use <tool>@<version>` itself.

## Harness support

Dovo installs harnesses lazily with mise and matches the host version when the host has the harness
installed. It runs `<harness> --version` on the host and installs that version. If the version is
not published, the host has no harness, or the harness command is a file that a sandbox can change,
Dovo installs the latest version and says so in the thread. Model discovery and availability checks
still run on the host, except for a command that a sandbox can change: Dovo does not run it on the
host to check it, and the agent settings say so.

Python harnesses install with uv and Python 3.13. The interpreter stays in `/mise/python` in the
shared volume after the install container exits. It does not change the project's Python version or
add a global Python default.

| Harness        | Installed in the sandbox                    | Configuration folder                                                                      |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Codex          | `npm:@openai/codex`                         | `CODEX_HOME` or `~/.codex`                                                                |
| Claude Code    | `npm:@anthropic-ai/claude-code`             | `CLAUDE_CONFIG_DIR` or `~/.claude` (also used as `CLAUDE_CONFIG_DIR` inside)              |
| OpenCode       | `npm:opencode-ai`                           | `opencode` folders under `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME`          |
| Pi             | `npm:@mariozechner/pi-coding-agent`         | `PI_CODING_AGENT_DIR` or `~/.pi/agent`                                                    |
| GitHub Copilot | `npm:@github/copilot`                       | `COPILOT_HOME` or `~/.copilot`                                                            |
| Mistral Vibe   | `pipx:mistral-vibe` (with uv)               | `VIBE_HOME` or `~/.vibe`                                                                  |
| Hermes         | `pipx:hermes-agent` (with uv)               | `HERMES_HOME` or `~/.hermes`                                                              |
| Grok Build     | Not installed. Add `grok` with mise.        | `~/.grok`                                                                                 |
| Muse Code      | Not installed. Add `muse` with mise.        | `~/.muse`                                                                                 |
| ACP Registry   | The entry's Linux build at the same version | None. Use agent environment variables.                                                    |
| Custom ACP     | Not installed                               | None. The command must exist in the sandbox, for example `npx …` or a mise tool.          |
| Cursor         | Not supported                               | Cursor runs in a Dovo SDK worker on the host, so its tools would run outside the sandbox. |

A profile's **Config directory** setting replaces the default folder in this table. See
[harness folders](#harness-folders) for what the sandbox can read and write in it.

ACP Registry agents use the same pinned Registry entry as the host install. Dovo installs its Linux
archive (checking the Registry SHA-256), or its npm or Python package, into the shared volume. A
custom ACP agent configured by an absolute path runs only when it is a Linux executable inside the
checkout. Otherwise the harness picker shows that it is not available in the sandbox.

When a thread uses a sandbox, the harness picker hides harnesses that cannot run there and shows the
reason.

Hermes must use the `hermes` executable. A Python interpreter launch is not available in the
sandbox.

### Harness versions on macOS hosts

A macOS host has macOS builds of the harnesses. The sandbox always installs Linux builds through
mise. The version can differ from the host when the host build carries a version that the package
registry never published. Session files stay compatible as long as both versions read them.

## Harness folders

A harness on the host loads settings, hooks, MCP servers, plugins and extensions from its
configuration folder. If a sandboxed agent could write that folder, the next harness that you or
Dovo start on the host would run what the agent put there. So the sandbox never gets your
configuration folder writable:

- At the folder's path, the container sees a private folder for this thread. The harness writes its
  caches, databases, logs and other state there. Dovo keeps it in `sandboxes/homes/` in the runtime
  data folder and deletes it when you archive or delete the thread.
- Configuration from the host appears read-only inside it.
- Only rotating login files and transcripts are shared writable with the host. A shared file that
  does not exist on the host is not created there. The harness writes it into the private folder.

| Harness        | Read-only from the host                                                                                                                                                  | Shared writable                                  | Notes                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Codex          | `config.toml`, `AGENTS.md`, `AGENTS.override.md`, `hooks.json`, `rules/`, `prompts/`, `skills/`, `agents/`, `plugins/`                                                   | `auth.json`, `sessions/`, `archived_sessions/`   | SQLite databases, history and downloaded packages stay private.                           |
| Claude Code    | `settings.json`, `CLAUDE.md`, `agents/`, `commands/`, `skills/`, `plugins/`, `output-styles/`, `rules/`, `hooks/`, `keybindings.json`                                    | `.credentials.json`, `projects/`                 | Dovo copies `.claude.json` once into the private folder. Changes stay with the thread.    |
| OpenCode       | In the config folder: `opencode.json`, `opencode.jsonc`, `config.json`, `AGENTS.md`, `package.json`, and the agent, command, mode, plugin, tool, skill and theme folders | In the data folder: `auth.json`, `mcp-auth.json` | Sessions, snapshots and the state folder stay private.                                    |
| Pi             | `settings.json`, `models.json`, `keybindings.json`, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `extensions/`, `skills/`, `prompts/`, `themes/`, `tools/`, `agents/`   | `auth.json`, `sessions/`                         |                                                                                           |
| GitHub Copilot | `mcp-config.json`, `copilot-instructions.md`, `agents/`, `skills/`, `hooks/`                                                                                             | None                                             | `config.json` holds settings and the login. Set `COPILOT_GITHUB_TOKEN` or sign in inside. |
| Mistral Vibe   | `config.toml`, `.env`, `AGENTS.md`, `instructions.md`, `agents/`, `prompts/`, `tools/`, `skills/`                                                                        | None                                             |                                                                                           |
| Hermes         | `config.yaml`, `.env`, `SOUL.md`, `AGENTS.md`, `skills/`, `plugins/`, `hooks/`, `cron/`                                                                                  | `auth.json`                                      | Hermes cannot save new skills or memories to the host.                                    |
| Grok Build     | None                                                                                                                                                                     | None                                             | Set `XAI_API_KEY`, or sign in from a sandbox terminal.                                    |
| Muse Code      | None                                                                                                                                                                     | None                                             | Sign in from a sandbox terminal.                                                          |

A login that you make inside the sandbox, for example `/login` in Claude Code, stays with that
thread when the host has no login file to share.

A shared login file is a bind mount of that one file. Codex writes `auth.json` in place, so a token
refresh in the sandbox reaches the host. A harness that writes a new file and renames it over the
old one cannot do that through a bind mount, and its refresh fails in the sandbox. Dovo has not yet
run each harness with this split in a real container.

## Credentials

Dovo mounts only the selected harness's folders, as [described above](#harness-folders), at the same
paths as on the host. It never mounts the rest of your home folder, SSH keys, SSH agent sockets,
other harness logins, GitHub tokens or Dovo's own data.

Environment variables reach the harness only when one of these is true:

- You set them in the agent's settings, including secret references.
- Dovo or the harness SDK sets them for this launch.
- They are on the selected harness's own allowlist, for example `OPENAI_API_KEY` for Codex or
  `ANTHROPIC_API_KEY` for Claude. Other harnesses' keys do not cross.

`PATH`, `HOME`, `SSH_AUTH_SOCK`, display and session sockets, Docker settings and Dovo's owner token
never cross. Values travel through the container CLI's own environment, so they do not appear in the
host process list.

### Claude Code on macOS

Claude Code on macOS keeps its login in the Keychain. Dovo never reads the Keychain. Choose one:

- Run `claude setup-token` on the Mac. Save the token as `CLAUDE_CODE_OAUTH_TOKEN` in the Claude
  agent's environment. A secret reference works.
- Open a terminal in a sandboxed thread, run `claude` and sign in with `/login`. Claude writes
  `.credentials.json` into the thread's private Claude folder, so the login stays with that thread.

The harness picker shows this note when no token or credential file exists.

GitHub Copilot keeps its login in the macOS Keychain or in `config.json`, which the sandbox does not
share. Set `COPILOT_GITHUB_TOKEN` in the agent environment, or sign in from a sandbox terminal.

## Dovo tools inside the sandbox

The `dovo_task` MCP server runs inside the container with Node LTS. Each turn's run credential is a
file in the thread's own state folder, which is mounted into its container only. Requests still need
that credential; nothing gets more access than it has on the host. HTTPS is not required.

- **Linux.** The runtime opens a Unix socket in the thread's state folder. It forwards to the
  runtime's loopback listener. This also works with the network turned off.
- **macOS.** Docker Desktop cannot share host Unix sockets. The tools reach the runtime at
  `http://host.docker.internal:<port>`. With the network turned off, Dovo tools are not available.

Attachments are copied into the thread's state folder so that the harness can read them.

## Agent hooks

[Agent hooks](scoped-settings.md) of a sandboxed thread run inside its container, in the checkout,
with `/bin/sh -c <command>`. The hook command must exist in the sandbox. Hooks get the same event
data on stdin as on the host, and the same environment rules as the harness. Before the first turn
of a thread, a hook can start the container without the harness folders. The turn then recreates the
container once.

## Native child history

Dovo shows the full history of a Claude Code native child agent by reading its transcript files. For
Codex it reads through the thread's running container. When the container is stopped, and for
OpenCode, Dovo shows the child's saved prompt and result. It never starts a harness on the host for
a sandboxed thread's history, because the harness would load project settings from the checkout.

## Git inside the sandbox

The checkout is writable, so the agent can edit files, commit and rebase in the sandbox. Git on the
host runs hooks from the repository's hooks folder, or from the folder that `core.hooksPath` names
in the Git config. Dovo mounts these paths read-only in the container:

- The hooks folder: `.git/hooks`, or `hooks` in the common Git folder of a linked worktree
  (`git rev-parse --git-common-dir`).
- The repository config: `.git/config`, or `config` in the common Git folder.
- `config.worktree` in the worktree's Git folder and in the common Git folder, when
  `extensions.worktreeConfig` is on.
- A linked worktree's `.git` file, and the `commondir` and `gitdir` files in its Git folder.
- The `worktrees` folder in the common Git folder. It holds the Git folders of the repository's
  other worktrees, so the agent cannot plant files for them. A linked worktree's own Git folder is
  writable on top of it.

Dovo also mounts the `.git` folder, and a linked worktree's own Git folder, on itself. A mount point
cannot be renamed or replaced, so the agent cannot move `.git` away and put a link or a fake Git
folder in its place.

Dovo does the same for linked checkouts with edit access. Before it creates the container, Dovo
creates a missing hooks folder and `worktrees` folder (empty) and a missing `config.worktree`
(empty, only when `extensions.worktreeConfig` is on), because a bind mount needs an existing source.
It never changes an existing config file.

### Recorded Git layout

The first time a thread's sandbox mounts a checkout, before any agent code runs there, Dovo records
where its Git folders are: the top-level folder, the Git folder and the common Git folder. The
record is in `sandboxes/records/` in the runtime data folder, outside every container. If another
sandboxed thread already recorded the same checkout, the new thread uses that record.

Dovo does not record a checkout whose Git folders look planted. Examples are a Git folder inside the
checkout other than its own `.git`, a `.git` file whose worktree does not point back at it, and a
hooks folder, config file or Git folder that is a symbolic link.

Every later start of the sandbox compares the files on disk with the record. Dovo stops with an
error, and mounts nothing new, when one of these changed:

- `.git` was renamed, removed or replaced by a link, or a `.git` file points somewhere else.
- A `commondir` file appeared in `.git`, or a linked worktree's `commondir` or `gitdir` changed.
- A `commondir` file appeared in the common Git folder.
- A new `.git` appeared between the thread's folder and the checkout's top-level folder.
- The hooks folder, config or `config.worktree` became a link.

The thread badge shows the error. Restore the Git folder and send the message again, or start a new
thread. The record stays until the thread is deleted, so archive, restore and delete keep the same
protection.

### Git on the host

Every Git command that Dovo runs in a checkout that a sandbox can write uses the recorded layout.
This covers checkpoints, Changes, review, branch switches, archive checks, and staging and commits
from the UI. The same protections, except for hooks, apply to every other checkout that shares the
common Git folder of a sandboxed checkout: the repository's main checkout and its other worktrees.
The sandbox can write that common folder, for example a submodule's config under `modules/`, but not
those checkouts' files, hooks or config.

- `GIT_DIR`, `GIT_COMMON_DIR` and `GIT_WORK_TREE` point at the recorded folders. Git does not follow
  `.git`, `commondir` or a planted `.git` in a subfolder.
- Before each command, Dovo checks that the recorded Git folders are still real folders and that
  `commondir` still names the recorded common folder. Git reads `commondir` for refs even when
  `GIT_COMMON_DIR` is set. If the check fails, the command fails.
- Configuration overrides turn off hooks (`core.hooksPath=/dev/null`, only in the sandboxed checkout
  itself) and the file system monitor (`core.fsmonitor=false`). They also stop Git from starting
  processes in nested repositories (`diff.ignoreSubmodules=all`, `submodule.recurse=false`,
  `fetch.recurseSubmodules=false`, `push.recurseSubmodules=no`).
- Status and diff commands get `--ignore-submodules=all`.
- `git add` never includes a gitlink (submodule) path. Dovo passes the paths in a private temporary
  file with `--pathspec-from-file`, so any number of submodules fits.

Without these, a gitlink that the agent adds to the index makes `git status`, `git diff` and
`git add` on the host read the nested repository's config, and run its `core.fsmonitor` program or a
clean filter.

A folder that was not a Git repository when its sandbox started stays outside Git for Dovo, also
after the agent runs `git init` there. Dovo's Git commands in it fail with "not a git repository".

Checkouts that no sandbox has mounted keep Git's normal behavior, including hooks.

### Git features that do not work in sandboxed threads

Commands that save Git settings or hooks fail inside the sandbox. For example:

- `git config` without `--global`, `git remote add` and `git remote set-url`.
- `git branch --set-upstream-to` and `git push -u`. The upstream cannot be saved.
- Creating a branch that tracks a remote branch, such as `git switch <remote branch name>`. The
  tracking setting cannot be saved.
- `git submodule init` and `git submodule update --init`. Submodule config cannot be written.
- `git worktree add`, `git worktree remove` and `git worktree prune`. The `worktrees` folder is
  read-only.
- Hook installers: `git lfs install`, `pre-commit install`, and Husky's `prepare` script, which runs
  `git config core.hooksPath`.

Make these changes on the host instead. `git config --global` still works inside the sandbox. It
writes to the container's home folder, not to the host, and the setting is lost when Dovo recreates
the container.

On the host, in a checkout that a sandbox can write:

- Git hooks do not run for the Git commands that Dovo makes, including commits from the UI. This
  applies to every thread that uses the same checkout. The commit area of a sandboxed thread says
  so. Run the checks yourself when you need them, for example `pre-commit run --all-files`. Hooks
  still run in the repository's main checkout and its other worktrees.
- Checkpoints, Changes and archive checks ignore submodules, also in the main checkout and the other
  worktrees of the same repository. A changed submodule pointer does not appear in a turn's changes,
  and **Commit all** does not stage it. An initialized submodule makes archive cleanup keep the
  worktree.
- Dovo does not fetch or push submodules.

## Network

Sandboxes have full network access by default. Set **Network** to **No network** in the project
settings to start containers with `--network none`.

Without network access, the harness cannot reach its model API unless that API runs inside the
sandbox. Package installs and web requests also fail. Dovo still installs harness CLIs, because it
runs installs in a separate short-lived container with network access.

## Lifecycle

- **Create.** Dovo creates one container per thread on its first turn or terminal. Labels:
  `dev.dovo.sandbox=1`, `dev.dovo.sandbox.runtime=<runtime id>`, `dev.dovo.sandbox.thread=<id>`.
- **Reuse.** Later turns and terminals reuse the container. It keeps files you install outside the
  checkout until it is removed.
- **Recreate.** A new mount (another harness, a new linked checkout) or a changed image or limit
  recreates the container. Open terminals in it close.
- **Idle stop.** Dovo stops a container 10 minutes after its last process ends. Provider processes
  release after 2 idle minutes, so a stopped container is usually not in use. Starting it again
  takes about a second.
- **Runtime restart.** On start, Dovo removes containers whose thread is gone or archived, and stops
  the rest. Their processes belonged to the previous runtime process.
- **Archive and delete.** Archiving or deleting a thread removes its container, state folder and
  private harness folders. Restoring a thread creates a new container on its next turn. The recorded
  Git layout stays until the thread is deleted. Dovo removes the records of deleted threads when the
  runtime starts.

Stop works inside the container. Dovo tags every process with a launch ID and stops all of them,
including processes that started their own session.

## Limits

- **Memory.** 8192 MB by default. Change **Memory limit (MB)** in the project settings.
- **CPU.** No limit by default. Set **CPU limit**, for example `2` or `0.5`.
- **Processes.** 4096 per container.

## What the sandbox does not protect against

- The checkout is writable. Code that the agent writes runs on the host when you or your tools run
  it there: build and test scripts, `package.json` scripts, `Makefile` targets, `.envrc` files,
  editor tasks, and a harness that loads project settings from the checkout, such as
  `.claude/settings.json` or `.codex/config.toml`. Review changes before you run them on the host.
- Hooks in a folder that the repository tracks are ordinary checkout files. If the repository sets
  `core.hooksPath` to a tracked folder, for example `.husky/`, the agent can change those hooks.
  Dovo's own Git commands do not run hooks, but your own `git commit` on the host does.
- Your own Git on the host is not hardened. Before you run Git in a sandboxed checkout, check that
  `.git` has no unexpected `commondir` file and that `git ls-files --stage | grep ^160000` lists
  only the submodules that you expect. A gitlink that the agent added can run the nested
  repository's `core.fsmonitor` program when you run `git status`.
- A linked worktree's common Git folder is mounted writable, so the agent can change other branches
  and refs of the same repository. It can also write files that Git reads for the main checkout: a
  `commondir` file in the common folder, `info/attributes`, or a submodule's config under
  `modules/`. Dovo's own Git commands stop when a `commondir` file appears, and skip submodules.
  Your own Git in the main checkout and in the other worktrees follows those files, for example a
  submodule's `core.fsmonitor` when you run `git status`.
- Shared transcript folders hold files that the agent can write, for example Claude project memory
  under `projects/`. A harness on the host reads them as conversation data.
- The network is open by default. The agent can send data to any address the host can reach.
- On macOS, the container can reach services on the host through `host.docker.internal`.
- The container shares the host kernel. A kernel or container runtime bug can break isolation.
- Environment variables that you configure for the harness are visible to the agent.
- A checkout that a sandbox used before this version gets its record from the files on disk when
  this version first starts its sandbox. Check its `.git` folder once if you did not trust that
  agent.

## Known limits in this version

- Windows runtime hosts are not supported.
- A runtime that itself runs inside Docker or Podman cannot start sandboxes. It would need the host
  socket, and the bind mount paths would be paths inside its own container. Run the runtime on the
  host to use sandboxes.
- Thread server previews do not reach servers inside the container.
- Computer use and MCP App proxies are not available in a sandboxed thread. Other configured MCP
  servers start inside the container, so their commands must exist there.
- Skills with supporting files outside the checkout cannot read those files.
- OpenCode runs its own server in the container. Dovo reaches it through `<cli> exec socat`, without
  publishing a port.
- Codex's own sandbox may fail inside a container. Use Full access for sandboxed Codex threads if
  commands fail with a sandbox error; the container is the boundary.
- Grok Build and Muse Code have no install source that Dovo can verify. Add them with mise.

## Useful commands

```sh
# Containers for this computer's Dovo runtimes
docker ps --all --filter label=dev.dovo.sandbox=1

# Stop or remove one thread's container (Dovo recreates it when needed)
docker stop <name>
docker rm --force <name>

# Rebuild the image on the next turn
docker image rm $(docker image ls --quiet dovo-sandbox)

# Remove the shared tool cache
docker volume rm dovo-sandbox-mise

# Image build logs: sandboxes/logs/ in the runtime data folder.
# The thread badge shows the full path when a build fails.
```

Use `podman` in place of `docker` with Podman. With Podman, Dovo adds `--userns=keep-id` so files
keep the host owner. With rootless Docker, Dovo runs processes as the container's root user, which
maps to your host user.

The runtime keeps sandbox state under its data folder in `sandboxes/`: per-thread state folders and
image build logs.

## Verify a change

```sh
pnpm --filter @dovo/runtime... -r build
pnpm exec vp test packages/runtime/src/sandbox packages/runtime/src/scm/git/hardened-git.test.ts packages/runtime/src/agents/providers/acp/acp-client-tools.test.ts
pnpm --filter @dovo/runtime typecheck

# Real Docker check. No provider login or paid turn is needed.
node scripts/check-container-sandbox.mjs
```

These tests use a fake container CLI. It runs `exec` commands on the host and checks launcher
arguments, mount arguments, the environment allowlist, Stop and container lifecycle. The Git tests
use real Git. They plant a nested repository's `core.fsmonitor` and clean filter, a `commondir`
file, a rewritten `.git` file and a `.git` link. Then they check that Dovo's Git commands do not run
the planted program and that the sandbox refuses a changed layout.

The Docker check uses a temporary checkout and empty harness homes. It builds the image, installs
Codex, Hermes and Vibe through mise. It runs Codex and Hermes with `--version` and the Vibe server
with `--help` through the launcher. It checks file ownership, Git commits, read-only Git files,
private harness settings, network-off access, the Linux runtime socket, Stop, restart and container
removal. It removes the temporary files and container. It keeps the image and installed tools in the
normal shared mise volume for reuse. Set `DOVO_SANDBOX_TEST_CLI=/absolute/path/to/docker` to use
another Docker executable or a test wrapper. This setting affects only this check. Dovo still
requires Docker access without `sudo`.

The Docker check has run on Linux amd64. It does not test a paid provider turn, token refresh, other
harnesses, Podman, Docker Desktop or native mobile controls. Run those checks on the relevant host
before claiming support at those boundaries.
