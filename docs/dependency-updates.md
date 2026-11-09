# Dependency update — 2026-11-09

This update includes stable major releases. Workspace manifests, the pnpm lockfile and the iOS
Device Hub Cargo lockfile update together. Host-managed agent CLIs and user credentials stay intact.

| Component                 | Previous | Updated |
| ------------------------- | -------- | ------- |
| Node                      | 24.22.2  | 26.13.0 |
| pnpm                      | 12.16.1  | 12.18.0 |
| Vite+                     | 1.4.0    | 1.5.0   |
| Electron                  | 45.2.1   | 45.2.3  |
| Claude Agent SDK          | 0.3.316  | 0.3.319 |
| Cursor SDK                | 1.2.0    | 1.3.1   |
| Copilot SDK               | 1.0.28   | 1.0.29  |
| ACP SDK                   | 2.2.0    | 2.4.0   |
| Effect and React bindings | 4.1.1    | 4.1.2   |
| Expo                      | 58.0.22  | 58.0.23 |
| Mobile React              | 19.3.0   | 19.3.1  |
| AsyncStorage              | 2.2.0    | 3.1.1   |
| Gesture handler           | 3.3.0    | 3.5.0   |
| Markdown-it               | 14.3.3   | 15.0.3  |
| ONNX Runtime              | 1.23.2   | 1.31.1  |
| Playwright                | 1.64.1   | 1.65.0  |

## Compatibility changes

- Development, CI, Docker images and packaged server runtimes use Node 26. Install the exact
  `.node-version` before running the commands below. Native server modules must be rebuilt for Node
  26; do not copy the old Node 24 modules into a new package.
- Only modern MCP Apps are supported. The old client alias and HTML, URL-list and Remote DOM
  renderers are removed. Old saved cards show an upgrade error; saved history is retained. The
  unrelated HTTP SSE transport fallback remains available. See [MCP Apps](mcp-apps.md).
- Markdown-it 15 supplies its own types. ProseMirror's declaration patch uses those types, and an
  override keeps its tokenizer on the same parser version as the rich composer. Diff parser calls
  use the new options object and keep strict error handling.
- AsyncStorage 3's default export opens the previous store through its legacy adapter. Dovo keeps
  that import so settings, tabs and bookmarks remain available after a native rebuild.
- Mobile packages use the latest stable versions. `expo install --check` reports differences from
  Expo 58's tested baseline for React, AsyncStorage, gesture handler, SVG, view-shot and worklets.
  Those warnings remain visible. A native build is required to verify this set; web mocks do not
  establish native compatibility.
- The autolinking patch moves to 58.0.17 and keeps its bounded 30-second module scan. The Device Hub
  Rust dependencies update within their declared stable ranges. Its `idevice` pin remains at the
  latest stable tag, v0.1.68.
- Storybook's Vite+ peer range and Expo require-utils' TypeScript peer range lag the installed
  versions. Peer checks remain enabled.

## Verification commands

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm typecheck
pnpm check
pnpm exec vp test --maxWorkers=4
pnpm test:ci:scripts
pnpm test:mcp-apps:browser
node scripts/check-rich-composer-browser.mjs
node scripts/check-diff-resize-browser.mjs
node scripts/check-mobile-metro-modules.mjs
node scripts/check-mobile-preference-storage-browser.mjs
node scripts/check-mobile-clipboard-browser.mjs
node scripts/check-clipboard-browser.mjs
node scripts/check-file-drafts-native.mjs
node scripts/check-workspace-router-model.mjs
cargo check --locked --manifest-path packages/runtime/native/ios-device/Cargo.toml
```

Local checks pass for workspace types and builds, frozen installation, Rust compilation, MCP Apps,
rich editing, diff resizing, mobile preference recovery and terminal clipboard behavior. The
production dependency audit reports no advisories. The full unit run passed 7,353 tests; its seven
failures pass on rerun after clearing the host browser override and using a test-only sandbox
override for this Linux host. Production Chromium sandboxing remains enabled. Thirteen tests were
skipped. The bundled model passes all 100 reference cases and all 32 workspace-selection cases.

On macOS with Xcode and Maestro, run `node scripts/ci/mobile-native-smoke.mjs`. It builds and
installs on its own disposable iPhone simulator. It never uses a physical phone. Android builds and
physical iOS gestures, clipboard and upgrade behavior need separate device checks.

---

# Dependency update — 2026-11-02

This update refreshes workspace dependencies and compatibility patches, then integrates the five
selected agent capabilities below. Existing transport and permission defaults are preserved.

## Agent integrations

| Integration      | Previous | Updated |
| ---------------- | -------- | ------- |
| Claude Agent SDK | 0.3.309  | 0.3.316 |
| Cursor SDK       | 1.0.40   | 1.2.0   |
| Copilot SDK      | 1.0.26   | 1.0.28  |
| ACP SDK          | 2.0.1    | 2.2.0   |
| Muse SDK         | 1.4.12   | 1.4.14  |
| OpenCode SDK     | 1.19.4   | 1.19.5  |
| OpenCode client  | 2.1.3    | 2.2.5   |

The host's Codex CLI 0.166.0 and Claude Code 2.1.316 already matched their latest published versions
at the time of the audit. They remain host-managed installations; the update does not install
additional CLI runtimes or alter authentication.

Desktop updates include Electron 45.2.1, electron-builder 26.18.0 and Vite+ 1.4.0. Mobile moves to
Expo 58.0.22 and React Native 0.88.1 with the corresponding Expo modules. The development Node pin
stays on the Node 24 LTS line, updated to 24.22.2; pnpm moves to 12.16.1.

## Compatibility boundaries

- Expo's supported versions remain authoritative for mobile React/React DOM 19.3.0, AsyncStorage
  2.2.0, gesture-handler ~3.3.0, safe-area-context ~5.10.1, view-shot 6.1.1 and worklets 0.13.0.
  `expo install --check` verifies this set. Upgrading these separately requires native migration
  work.
- The `@mcp-ui/legacy` alias stays on `@mcp-ui/client` 5.17.3. Version 7 removes the remote-DOM
  component APIs used by existing cards. Modern MCP Apps use the updated `ext-apps` dependency.
- Effect and its React bindings update together; the workspace override keeps OpenCode's schemas on
  the same Effect runtime as Dovo.
- Werift 0.26.0 incorporates most of the former lifecycle patch. The port retains concurrent TURN
  alternatives, early trickle signaling and terminal ICE failure handling. Keep the real
  direct/UDP/TCP/TLS connectivity checks when replacing this patch.
- Expo autolinking's patch moves to 58.0.16 and retains the bounded 30-second native module scan.
- Upstream electron-builder and node-forge now include the signing and RSA verification fixes. Their
  old patches are removed; packaging/security regression tests remain.
- Transitive dependency ranges are refreshed as well as direct dependencies. Targeted overrides
  select fixed releases of node-forge, Zod 4, body-parser 2, fast-uri, seroval and modern
  minimatch/glob. Legacy glob APIs remain untouched. `pnpm audit --prod` reports zero advisories,
  down from 22 after the initial direct-dependency update.

## Verification

Workspace typechecks and production builds, Expo's supported-version check, packaging/security
regressions, and CI script tests run against the updated dependency graph. Browser coverage includes
modern and legacy MCP resources, direct and forced UDP/TCP/TLS TURN connectivity, mobile history and
sending, composer/model rendering, diff resizing, and the shared-browser tab layout. Native Electron
extension and media/PiP checks pass. The native iOS Release build is verified for the simulator on
the Mac Studio.

Upstream peer metadata still warns about Storybook with Vite+, Expo's require-utils with TypeScript
7, and the legacy remote-DOM React binding with React 19. The corresponding builds and interaction
checks are retained; no peer checks are suppressed. This update does not verify a new Android build,
a signed physical-iPhone build, or paid live model turns.

## Integrated agent features

- **Cursor context compaction:** the existing compact-context action now calls `agent.summarize()`
  for local sessions. Cancellation and errors do not report completion. The SDK's trimmed-transcript
  fallback is identified explicitly; cloud sessions still cannot be compacted through this API.
- **Claude question outcomes:** capable CLI sessions preserve skipped, dismissed and replied-in-chat
  outcomes as per-question annotations. Desktop and mobile expose the outcomes; stop cancellation
  remains separate. Older CLIs retain their required-question flow.
- **Claude prewarming:** after a successful ordinary turn, one spare can prepare a subsequent new
  session within the existing idle-provider budget (four providers, two-minute expiry and memory
  pressure checks). Session directories, prompts, model and MCP credentials are bound on claim.
  Incompatible or unavailable spares fall back to cold startup before a session is accepted. This
  alpha feature adds a parked process (upstream estimates roughly 230–260 MB); live-model latency
  and memory use have not been measured here. First-ever startup remains cold.
- **Codex network diagnostics:** desktop and mobile diagnostics offer an explicit network test for
  the default executable or a configured Codex profile. The authenticated runtime runs
  `codex doctor --network-only` with bounded time/output and redacts credentials. It never runs
  automatically during startup or version checks.
- **ACP MCP transport:** HTTP MCP servers can opt into MCP-over-ACP when the agent advertises it.
  This requires native MCP 2026-07-28 support, uses the official ACP binding and existing HTTP/SSE
  transport, and keeps credentials on the runtime. Existing HTTP/stdio fallback and ACP protocol 1
  remain; legacy MCP versions are not translated. Disconnects cancel outstanding requests.

Provider, protocol and route tests cover compatibility, cancellation and failure behavior. Browser
checks exercise desktop/mobile question outcomes and whole-tab selection with independent mute,
settle and close controls. Real paid model turns and a live production MCP-over-ACP server have not
been exercised. Claude working-directory write boundaries remain a separate product decision.

## Browser PiP compatibility

The Document PiP shim now exposes the interface inside the PiP window, matching managed Chromium:
the guest's `window` property is null and nested `requestWindow()` calls reject with
`NotAllowedError`. The guest identity is captured before a site changes its window name or document.
Ordinary tabs retaining a login popup's opener keep their normal PiP support.

Teams checks for this interface before registering its return-to-call and close cleanup. Hiding it
caused Chat navigation to leave Teams thinking a closed PiP window was still open. Native Cmd+W and
window-close actions also restore the owner before closing; app cleanup remains silent. Native
regression coverage runs on Linux and MacBook van Dominic, including child cleanup microtasks,
document replacement, repeated returns and nested-window rejection.

The live Teams call on MacBook van Dominic's Nightly 645 also verifies Chat → PiP → call through
both the Close button and Cmd+W, with PiP state cleared after each cycle. That check used a
temporary one-window interface correction; the original parent API was restored and the call
remained connected. It does not represent installation of a new nightly binary.

Sources: [Claude SDK releases](https://github.com/anthropics/claude-agent-sdk-typescript/releases),
[Cursor SDK documentation](https://cursor.com/docs/api/sdk/typescript),
[ACP SDK releases](https://github.com/agentclientprotocol/typescript-sdk/releases), and the
[Codex changelog](https://developers.openai.com/codex/changelog/).
