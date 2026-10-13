# Dovo Studio GPUI

A parallel Rust desktop client for the existing Dovo runtime. The workbench uses GPUI; HTML/SVG
artifacts, remote browser viewing and MCP app resources use isolated Wry child windows. Electron
remains available while parity is completed.

The native workbench follows Electron's navigation with a compact editor-style shell: an icon
activity rail, grouped task sidebar, task tabs, centered conversations and a framed composer. Agent,
integration and resource configuration live in the Settings navigation panel. System, Light and Dark
appearance preferences remain available. Inter 4.1 is embedded for consistent typography; its SIL
Open Font License is included in `assets/fonts/LICENSE.txt` and packaged under `licenses/Inter.txt`.

## Run

Install the repository's locked pnpm dependencies and a current stable Rust toolchain, then:

```sh
pnpm dev:gpui
# Attach directly to a running local runtime:
pnpm dev:gpui --connection-file /path/to/runtime-connection.json
```

Use **Computers → Connect local runtime** to discover an existing desktop/server runtime or start
one through its server manager. It authenticates discovered connections, preserves the configured
database and rejects an explicit database mismatch. Fresh source builds default to
`~/.dovo-dev/desktop`; set `DOVO_DATA_ROOT` to select another data directory, or pass a connection
file to attach without starting a process. `DOVO_DATABASE_PATH` takes precedence over
`DOVO_DATA_ROOT`. The server manager preserves databases and listening configuration and refuses to
start a second process over a live, unreachable runtime. The runtime continues when this UI exits.

Remote computers use the existing pairing code, host approval and device-token flow. HTTP LAN/VPN
origins stay HTTP. HTTPS is optional; no account is required. Device tokens live in the OS keychain
under a separate GPUI identity. Saved drafts and uncertain message receipts are private files scoped
to the runtime credential. Retrying a send retains its original message ID; uncertain mutations are
never retried automatically.

Linux currently uses X11/XWayland. Wry requires GTK 3 and WebKitGTK 4.1; GPUI requires Vulkan,
fontconfig, a usable system font and the usual X11 development libraries. On Ubuntu, the build
packages include:

```sh
sudo apt-get install build-essential pkg-config cmake clang libssl-dev libzstd-dev \
  libvulkan-dev mesa-vulkan-drivers libwayland-dev libfontconfig1-dev libfreetype-dev \
  libxcb1-dev libxcb-xfixes0-dev libxcb-shape0-dev libxcb-randr0-dev libxcb-render0-dev \
  libxcb-xinput-dev libxkbcommon-dev libxkbcommon-x11-dev libasound2-dev libdbus-1-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev fonts-dejavu-core
```

A desktop keychain/Secret Service is needed to persist paired credentials on Linux. The
`--connection-file` route also supports isolated development runtimes without writing their owner
token to the GPUI keychain.

## Verify

```sh
pnpm test:gpui
pnpm --filter @dovo/runtime exec playwright install chromium
pnpm test:gpui:integration
# Linux/X11 with Xvfb and xdotool:
pnpm test:gpui:composer
# Requires Chromium on the runtime host (or Playwright’s installed Chromium):
pnpm test:gpui:browser
cargo fmt --manifest-path apps/desktop-gpui/Cargo.toml --check
cargo clippy --manifest-path apps/desktop-gpui/Cargo.toml --all-targets -- -D warnings
pnpm build:gpui
```

The integration test creates a temporary Node runtime, database and project. It checks snapshot
decoding, authenticated live sync, compare-and-swap conflicts, preferences, file edits, artifact
reads, attachment transfers, scoped resources, scheduled follow-ups, side-chat drafts, PTY output,
lifecycle and non-owner pairing. Native review checks verify independent read-only sessions, stable
start requests, current approval, stale approval rejection and saved diffs. Native child checks
verify session-fenced transcript paging, approval scopes, matching task-family stop tokens and stale
stop rejection. Device host checks verify revision conflicts, token redaction, rename preservation
and requiring pairing again when a destination changes. ACP checks exercise a deterministic local
process for browser callbacks, terminal sign-in, cancellation, model discovery, session paging and
removal guards. Additional isolated-runtime tests cover SCM account revisions, forge binding,
issue/pipeline pagination and mutations, PR reviews/edit/merge conflicts, scoped agent inheritance,
frozen task harnesses and imported skill supporting files. Local-startup tests check HTTP listen
preservation, process reuse and explicit database mismatch rejection. It stops only its own runtime
on exit. It does not invoke an agent provider or use a personal runtime.

For an embedded-content smoke check:

```sh
pnpm dev:gpui --preview-html /path/to/local-preview.html
```

On a headless Linux host, install `xvfb`, `xauth` and `xdotool`; use `xvfb-run` and a private
`XDG_DATA_HOME`. WebKit may need `WEBKIT_DISABLE_COMPOSITING_MODE=1` under Xvfb. This is a
headless-test setting, not a default for desktop users.

## Portable package

```sh
pnpm package:gpui
```

Package on the target OS/architecture with Node 24. The archive includes the native executable, Node
and the existing production runtime (including its native dependencies). Local startup resolves the
adjacent `libexec/server` and bundled Node before considering source paths. GPUI assets are compiled
into the binary. Linux uses system GTK/WebKit/Vulkan libraries. GPU drivers belong to the host;
copying another distribution's driver or glibc into the archive would create ABI conflicts.

For Fedora, prefer the RPM and install it with `sudo dnf install ./Dovo-GPUI*.rpm`; dnf resolves the
required libraries, fonts and Vulkan loader/driver. Ubuntu 24.04 and compatible newer Debian systems
use `sudo apt install ./Dovo-GPUI*.deb`. Linux release builds use Ubuntu 24.04 and reject a native
binary requiring glibc newer than 2.39. Source-built archives inherit the build host's ABI; the
earlier Ubuntu 26.04 archive required glibc 2.43 and is unsuitable for older Fedora versions.

An extracted Linux archive includes `./check-linux.sh` for linked libraries, dynamically loaded
Vulkan/fontconfig and system fonts. Fedora archive dependencies can also be installed explicitly:

```sh
sudo dnf install gtk3 webkit2gtk4.1 javascriptcoregtk4.1 libsoup3 dbus-libs \
  libxcb libxkbcommon libxkbcommon-x11 fontconfig vulkan-loader mesa-vulkan-drivers \
  dejavu-sans-fonts xorg-x11-server-Xwayland xdg-utils
./check-linux.sh
```

The loader check does not prove a working GPU driver. On NVIDIA systems retain the distribution's
matching NVIDIA Vulkan driver. A desktop Secret Service is required for saved paired credentials.
GPUI uses `libvulkan.so.1` dynamically; it is absent from the binary's direct `ldd` dependencies.
See [Zed's Linux requirements](https://zed.dev/docs/linux) and the
[upstream Fedora GPU initialization reports](https://github.com/zed-industries/zed/issues/14126).

On Linux, run `./install-linux.sh` from the extracted archive to register its icon and
application-menu launcher for your user. Keep the directory in place; run the script again after
moving it. `./install-linux.sh --uninstall` removes that registration while retaining runtime and
client data. macOS packages contain **Dovo Studio GPUI.app**, with Node/runtime inside its Resources
directory. Local packages receive an ad-hoc signature; release packages require the existing Apple
Developer ID and notarization credentials. Windows archives keep the executable beside `libexec`.

## Release pipeline

The separate **Build GPUI packages** workflow builds macOS, Windows and Linux on native x64/ARM64
runners. Pushes to `dovo/gpui-signed-builds` build Windows and macOS. Manual runs can select all
platforms or Linux alone, with an empty version for a nightly or one matching `package.json`. Signed
downloads and checksums stay in the run's **Artifacts** section for 30 days. The workflow does not
create releases, release tags or update feeds.

macOS reuses `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `MAC_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Native Node modules and PTY helpers are signed
before sealing, notarizing and stapling the app bundle. Windows reuses the `windows-signing`
environment and Azure OIDC configuration described in
[Windows signing](../../docs/windows-signing.md). Both Windows architectures transfer to x64 for
signing; native runner smoke tests then exercise the signed app, SQLite and PTY. An environment
restricting branch deployment must allow the branch/tag used for this workflow, just as for the
existing desktop workflow.

Linux creates RPM, DEB and tar archives; clean Fedora 43/44 and Ubuntu 24.04 containers install the
packages and open the native window with software Vulkan. There is no existing Linux GPG
package-signing key, so RPM/DEB files remain unsigned. All final assets have SHA-256 checksums and
GitHub-signed build provenance: `gh attestation verify <file> --repo dovocode/dovo-studio`. After
verification, an unsigned RPM may need `--nogpgcheck` under strict local dnf policy.

To build distro packages locally on Ubuntu 24.04, install `rpm`, Ruby development tools and `fpm`,
then run `pnpm build:gpui && node scripts/packaging/package-gpui.mjs --linux-packages`. Windows
installers and automatic GPUI updates remain outstanding. macOS/Windows release signing is
configured here but cannot be exercised from this Linux checkout without the CI credentials.

## Parity status

This is **not yet a finished full desktop clone**. Current native flows include task creation and
search, Markdown conversations, tool activity, approvals and questions, send/steer/stop, durable
draft and receipt recovery, file attachments, queue controls, scheduled follow-ups, side chats, turn
usage/fork/retry controls, pin/archive/restore, project creation and cloning, agent forms with model
discovery, native automation graph editing, runtime preferences, trusted devices, artifact browsing,
syntax-aware code editing and diff views, change application/staging/commit, and a VT100 terminal
with colors, scrollback, keyboard/IME input and resize, drag selection and copy. Mouse reporting
follows application modes (SGR/UTF-8, with Shift for selection); reconnect refreshes its ticket and
replays output into a fresh screen while retaining dimensions. Disconnected input is rejected.
Legacy mouse reporting uses negotiated byte input and supports its full 223-cell coordinate range
without UTF-8 corruption. Older runtimes receive lossless text where possible and an explicit
unsupported-input notice otherwise; SGR and UTF-8 mouse modes retain their larger coordinate ranges.
Native device previews render JPEG frames and send touch/text input; usage history includes model
totals and price overrides. Pull request lists use provider-aware pagination and state filters.
Details expose checks, discussion, native diffs and supported review, reviewer, inline/range
comment, reply/resolve, edit, close/reopen and merge controls. PR creation uses provider draft
capabilities. Stack details show parent-first membership, dependencies and native navigation;
stack-update tasks are editable drafts with runtime-generated branch safety instructions. PR tasks
can use scoped configurations or task defaults and choose a separate branch or the provider source
branch. Inline discussion shows saved diff context, line positions and outdated revisions. Issue
views include native Markdown, discussion, comments, creation, provider-supported filters and
revision-checked editing; issue and Jira lists preserve pagination/cached-result warnings. Pipeline
views include jobs/steps/errors, log links, workflow definition pagination, dispatch inputs,
enable/disable and provider-supported rerun/cancel actions. Source-account forms configure forge
credentials, CLI profiles and Jira sources. Project settings bind accounts, manage branches and edit
checkout defaults. Both create source-linked draft tasks. Task settings include budgets, model
overrides and draft dependencies. Native task defaults use the shared provider editor for model
discovery, managed ACP installations and launch settings; saved prompts can be added, edited and
removed per scope. The Computers page shows live fleet health and per-computer
project/task/approval/question counts, with isolated failures and bounded reads. Local appearance
supports System, Light and Dark and persists independently of runtime preferences. Chaining
compare-and-swap saves the local request before setting its dependency, retaining local drafts on
failure. Global/computer/project resource editors cover skills, MCP servers, environment/header
mappings and before/after-turn hooks, with inherited resource names and compare-and-swap saves.
Catalog browsing covers MCP variants and skills, with pagination and a native review step before
saving imports. Local skill imports retain supporting-file paths in computer scopes; shared local
imports contain instructions only. Resource drafts remain scoped when navigating and edits made
during saves are preserved. Native agents and task-defaults forms cover all four scopes, inherited
configurations, overrides, launch arguments, model discovery, installation/login probes and
lifecycle policies. New tasks resolve scoped defaults and freeze their selected harness, including
launch settings and provider-compatible permissions. Source views reject stale responses and edits
after a detected account/project change, and require an explicit reload to discard the affected
drafts.

Additional native workflows include checkpoint previews, linked-project undo/redo, per-file restore,
session reset and provider compaction, checkout handoff and independent/reused worktree forks.
Project settings edit saved prompts, task templates and terminal actions; templates retain frozen
harness metadata. Workflow editors configure scheduled/GitHub/webhook triggers, credential rotation,
frozen harnesses, permissions, environment/ACP fields, execution and linked checkout access. Run
history retains its original workflow/step labels and supports review, cancel and retry; manual
start requests retain their IDs for explicit recovery. Task and new-task editors configure linked
checkouts. Device Hub settings configure SSH hosts, preferred host and agent access using paired
credentials; its device UI offers installed apps, launch/relaunch, URL opening, runtime-path
installation, appearance, screenshots and port forwarding. Scoped agent forms include environment
and ACP fields; resource editors target either all agents or an individual configuration, preserving
other settings.

Native ACP management browses and filters the registry, installs/repairs/updates agents, follows
browser authentication, forwards remote localhost callbacks, and hosts terminal sign-in in the
native terminal. Saved sessions support paging and confirmed deletion. Installation selection clears
incompatible model/mode choices; model discovery exposes named model, reasoning, tier and ACP
mode/configuration choices. Discovery results are bound to their launch configuration, so late
responses do not populate a changed form. Registry downloads and live provider accounts still
require verification.

The native composer suggests files and MCP servers for `@`, skills for `$` and leading `/`, and
scoped saved prompts for `#`. Arrow keys select; Tab/Enter accept and Escape dismisses. Searches are
debounced and task/query scoped. Insertions retain Unicode and text after the caret. Built-in
commands use the existing guarded session operations; review messages retain a durable delivery ID.

Conversation plans display the provider's native todos. Approval buttons offer only the runtime's
supported scopes, including session and remembered project policies. Descendant input appears on
parent threads. The Agents tab shows task-family children, saved results, links to delegated tasks
and paged native transcripts. Stops retain execution/session guards. Family stop tokens match the
protocol for runtime-created canonical UUIDs; stopping imported families with other ID forms is
currently disabled because Rust does not reproduce JavaScript locale collation for those IDs.
Independent code reviews display findings, resolutions, reviewer threads, command evidence, changes
since the review and approval of the current snapshot. Review starts and author-fix requests retain
durable IDs for explicit retry; late reads cannot overwrite an action result. Enable the runtime's
experimental code-review setting to use this view.

Browser sessions reuse the runtime's Chromium viewer and ticket transport. The native picker selects
a profile for each independent tab, with show/reconnect and close controls. Reconnects retain the
tab/profile identity and current navigation. Closing waits for an in-flight open to settle. Settings
add, rename and remove runtime profiles; removal retains saved website data. GTK child views are
released and their Xlib requests flushed before GPUI destroys their parent windows. The native
computer overview searches task summaries across authenticated computers and opens a task on its own
computer, preserving drafts and rejecting stale source responses. Artifacts have a sandbox without
runtime access or network access. MCP apps reuse the existing bundled host. Native WebKit uses one
opaque guest frame with the same CSP and permissions, avoiding a nested-frame rendering failure;
Rust handles scoped RPC, native confirmations, save dialogs and agent-callable app-tool sockets.
Their content stays outside the native workbench.

The remaining parity work includes:

- Remaining conversation presentation, dependent messages and provider-specific task controls.
- Remaining SCM presentation and provider-specific review details.
- Preferred-computer defaults and remaining provider-specific configuration.
- Remaining Device Hub presentation and physical-device verification, launcher, popouts and desktop
  integration.
- Remaining installer formats, desktop OS integration and updates.

Linux native Markdown rendering, keyboard/IME input into a real terminal, ANSI colors, interactive
artifact clicks, native diff rendering, terminal selection, SGR mouse press/release to a real PTY,
and controlled device frame/input transport have been exercised under Xvfb. Runtime Chromium
rendering and browser clicks are verified. A relocated Linux archive started and authenticated its
bundled runtime. Both MCP host arrangements pass browser handshake, cancellation, isolation and CSP
checks; native MCP rendering and a real server tool call through native approval have also been
exercised. Issue comments and pipeline actions, issue creation and native PR review have been
exercised against controlled runtime fixtures. Native scoped-agent and checkout/lifecycle saves have
also been exercised. Live forge/Jira accounts and catalog downloads have not been exercised. The
native composer-to-dependency flow has been exercised. Dependency draft saving/conflicts/removal and
cycle rejection pass real-runtime checks; reconnect ticket renewal, retained dimensions and replay
pass controlled socket tests. A real raw-mode PTY verifies high-byte mouse reports; strict input
schemas reject malformed and oversized frames. Native browser profile creation, renaming and
removal, Chromium cookie persistence and repeated viewer close/workbench survival pass the automated
Linux check. The real-runtime browser test covers profile isolation, reconnect navigation,
sibling-tab survival and saved data after profile removal. Native task selection from the computer
overview reaches the composer. Linux launcher tests use real GIO launches with spaces, quotes, shell
metacharacters and percent signs in package paths, and preserve unknown registrations and
application data. Two-runtime connection checks use colliding task IDs and verify task intents
follow their source; recovered drafts load before the initial snapshot. Native stack
navigation/update drafts and saved-prompt creation/removal have been exercised. Two-runtime fleet
checks cover revoked credentials and archived-task exclusion. Native provider plans, scoped
descendant approvals, transcript pagination and child stopping have been exercised against an
isolated provider-session fixture. Native composer file/skill/MCP/prompt completions, keyboard
selection, insertion in the middle of text and review dispatch pass the automated Linux GUI check.
ACP browser callback submission, session paging/deletion and real PTY sign-in have been exercised
natively against a deterministic fixture. Device Hub enable/disable and host-draft recovery have
been exercised. A schedule-preset workflow save and agent-only skill save have been exercised
without changing shared resources. Independent review start, finding dismissal with a resolution,
and current-snapshot approval have also been exercised in GPUI. Physical devices and real remote SSH
device hosts have not been verified. macOS/Windows builds and native dialogs have not been verified
here. GPUI Kit/Wry are pinned together because their published versions differ from the latest
upstream documentation.
