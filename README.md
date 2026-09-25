<img src="apps/desktop/build/icon.png" alt="Dovo Studio icon" width="80" height="80" />

# Dovo Studio

Dovo Studio is a personal workspace for coding agents, repositories, tasks, and automations. The
desktop and web apps provide the main workbench; the native iPhone app connects to the same runtime.
The runtime runs on your computer or server and keeps agent credentials, projects, and workspace
data there.

## Install

- [Download the latest desktop release](https://github.com/dovocode/dovo-studio/releases/latest).
- To run a standalone background runtime, see the [server setup guide](docs/server-setup.md). It
  covers release archives, source installs, pairing, network access, and keeping an existing desktop
  workspace.
- For iPhone, use the
  [local iPhone install guide](docs/releases-and-updates.md#local-iphone-updates).

Dovo connects directly to its runtime over your LAN, Tailscale, NetBird, or an optional HTTPS
endpoint. Pairing codes and device credentials are required. There is no Dovo account or cloud
relay; HTTP remains supported for private LAN and VPN connections.

## Develop

Requires Node 24.11+ and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm dev:desktop
```

For web, run the runtime and web app in separate terminals:

```sh
pnpm dev:api
pnpm dev:web
```

For native mobile development, keep a runtime running and use a development build (Expo Go does not
include the app's native modules):

```sh
pnpm dev:mobile
```

See the [development and operations guide](docs/server-setup.md) for setup details and the
[product guide](docs/product-guide.md) for walkthroughs and the full feature manual.

## What you can do

- Run Codex, OpenCode, Claude, or ACP agents against registered projects, with streamed sessions,
  approvals, questions, cancellation, and resumable tasks.
- Review Git changes, manage branches and worktrees, and browse pull requests, issues, and pipelines
  across supported source-control providers.
- Use real host terminals, reusable agent profiles, and project or agent MCP servers and skills.
- Build automations with schedules, webhooks, task runs, and durable human-review steps.
- Pair desktop, web, and mobile clients to one host workspace, with device revocation and host-side
  data storage.

## Documentation

The [documentation index](docs/README.md) groups setup and feature guides with historical design
notes. See the [product guide](docs/product-guide.md) for the detailed desktop/mobile walkthroughs,
provider setup, workflows, and current behavior.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks, feature organization, and review
conventions. The [architecture guide](docs/architecture.md) explains package ownership;
[Effect patterns](docs/effect-patterns.md) covers typed failures and resource lifetimes.

## Verify changes

```sh
pnpm verify
```

This runs typechecking, tests, lint, and builds. See [the full product guide](docs/product-guide.md)
for focused checks and platform smoke-test commands.
