# @dovo/terminal

The app's Ghostty integration. App code supplies runtime tickets, preferences and UI actions; engine
dependencies, byte streaming, rendering and native compatibility patches live here.

- `@dovo/terminal`: `BrowserTerminal` DOM/input adapter. One dedicated worker owns Ghostty WASM
  parsing, the socket or Electron MessagePort, selection and OffscreenCanvas rendering.
- `@dovo/terminal/native`: `NativeTerminalSession` for iOS/Android using `expo-libghostty`. The
  mobile app keeps its existing WebView fallback for binaries without that native module.
- `@dovo/terminal/styles.css`: browser surface and accessibility styles.

Browser rendering tries WebGPU, then WebGL2, then Canvas2D. GPU loss replaces the canvas without
resetting the terminal; Canvas2D restoration redraws the retained engine state. GPU backends batch
cells using reusable geometry buffers and a bounded persistent atlas; default blank cells need no
glyph geometry. Canvas2D retains its surface and repaints only changed row bands. The worker reuses
unchanged cells and skips identical paints while keeping history/viewport metadata current. Hidden
sessions parse output but skip painting. The emergency path presents worker-produced bitmaps on a
software-backed DOM canvas after GPU failure, or when transferring the HTML canvas is unavailable.
WebGPU availability depends on the browser/security context; HTTP runtime connections remain
supported through the fallback backends.

Font cells and baselines use whole device pixels, and the CSS canvas size matches its backing
bitmap. Display-density changes refresh metrics and rendering without reconnecting the PTY. Mouse
tracking is forwarded to terminal applications; Shift-drag selects text instead. Desktop file drops
insert existing paths quoted for the terminal's launch shell (POSIX, PowerShell or CMD), without
submitting the input line. Files stay on their original computer; a remote terminal must already be
able to access those paths. Browser-created files without native paths report an error.

PTYs stay in the runtime's existing `node-pty` service, including local/background and WSL sessions.
Desktop MessagePorts bridge the authenticated WebSocket to the worker. Web/mobile connect directly.
`stream=binary-v1` supplies UTF-8 output with replay boundaries, consumption acknowledgements and
bounded server credit. Controls remain JSON. Older text-stream runtimes remain compatible. Runtime
replay retains its existing bounded output suffix; browser history uses a separate 16 MiB Ghostty
budget (`scrollbackBytes`, measured in bytes, not rows).

The native renderer accepts output sequentially before acknowledging it. On iOS the library queues
accepted bytes to its IO thread, so acknowledgement does not assert painting or parser completion.
Font-size changes that rebuild an iOS surface reconnect/replay without restarting the PTY. Native
font assets are under `src/native`; the font-family compatibility patch is registered at
`patches/expo-libghostty@0.8.1.patch` in the workspace root. Native input stays disabled with a
replay status until the emulator answers a parse barrier (or its 1.5-second timeout). Replies and
keys share one native callback, so keys from an already-visible keyboard during reconnect replay are
discarded rather than forwarding stale terminal responses to the shell.

On iOS the native terminal is constrained to `UIKeyboardLayoutGuide`, so its grid resizes above the
software keyboard and terminal accessory row. Keep keyboard avoidance out of the host's React Native
layout for this renderer; a second inset would shrink the terminal twice. The WebView fallback owns
its own keyboard avoidance.

## WASM provenance

`src/browser/assets/ghostty-vt.wasm` is built from Ghostty revision
`5714ed07a1012573261b7b7e3ed2add9c1504496` with the vendored ghostty-web terminal API patch and
`vendor/history-wrap.patch`. The latter lets negative row indexes query history wrap metadata
(`-1` = oldest history row), preserving logical lines when copying wrapped scrollback. It does not
change positive active-screen indexes. The worker bundles the WASM as a data URL so packaged
Electron builds do not need file-scheme fetches or an external WASM server.

`vendor/wasm-zero-pages.patch` clears newly allocated terminal pages on WASM. Unlike native
anonymous mappings, its allocator can reuse nonzero memory from a previous terminal. Explicit
initialization prevents stale cells from appearing after replay and column reflow.

Rebuild with Zig 0.15.2, curl and tar installed:

```sh
pnpm --filter @dovo/terminal build:wasm
```

`ZIG=/path/to/zig` can select the compiler. Normal app builds consume the checked-in binary. The
build script verifies the pinned source archive's SHA-256. Ghostty's license is under
`vendor/GHOSTTY-LICENSE`. `vendor/ghostty-wasm-api.patch` comes from coder/ghostty-web (MIT),
matching the dependency's WASM ABI. The workspace pnpm patch for `ghostty-web@0.4.0` exports its
already-defined keyboard enums, which upstream declares in types but omits from ESM exports.

## Verification

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/terminal typecheck
pnpm exec vp test packages/terminal/src
node scripts/check-ghostty-terminal-browser.mjs
node scripts/check-terminal-renderers-browser.mjs
node scripts/check-terminal-interactions-browser.mjs
xvfb-run -a node scripts/check-terminal-file-drop-native.mjs # Linux; omit xvfb-run on macOS
node scripts/check-canvas2d-retained-browser.mjs
node scripts/check-terminal-layout-browser.mjs
node scripts/check-mobile-native-terminal-browser.mjs
```

The worker test compares a 16,000-line Unicode replay with the previous xterm DOM renderer, reports
both replay duration and UI timer gaps, and checks input, scrolling, wrapped selection and canvas
replacement. Timing is a local smoke benchmark, not a hardware-independent speedup claim. Renderer
checks verify pixels, fractional device scales and context loss; unavailable WebGPU hardware is
reported explicitly. Native component tests use a mock native surface; a simulator/device build is
still required to validate native rendering and platform keyboard UX.

Resource measurements use a separate production fixture (Linux `/proc` required):

```sh
pnpm exec playwright install chromium
pnpm benchmark:terminal
```

This runs three fresh-browser repetitions of xterm's previous 5,000-row default, xterm with matched
history, Ghostty Canvas2D and Ghostty WebGL2. It measures whole-browser CPU (including workers and
GPU processes) and proportional resident memory (PSS), with forced GC outside timed phases.
Workloads cover replay, visible/hidden output, idle and four sessions. Output is saved under
`scripts/benchmarks/terminal-resources.json`; `TERMINAL_BENCH_REPEATS` and `TERMINAL_BENCH_OUTPUT`
can override repetitions and destination. `TERMINAL_BENCH_CONTENT=varied` switches to unique line
IDs and changing ANSI colors at the same byte rate; `TERMINAL_BENCH_VARIANTS=canvas2d,webgl2`
selects a subset of engines. This isolates the terminal client; it does not measure React,
PTY/server costs, physical GPU performance or native mobile terminals. See the accompanying
[terminal-resources.md](../../scripts/benchmarks/terminal-resources.md) for the measured trade-offs
and methodology.
