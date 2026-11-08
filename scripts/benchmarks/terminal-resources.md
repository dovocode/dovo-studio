# Terminal CPU and memory measurements

Measured on 2026-11-02 on an Intel Core i7-13700T (24 logical CPUs), Linux 6.12.105+deb13-amd64,
Node 26.8.1 and Chromium 156.0.8078.4. Graphics use **SwiftShader software rendering**, with
hardware compositing unavailable.

The optimized Ghostty client uses less CPU than the initial Ghostty implementation on both tested
output patterns. With constantly changing content, visible-output CPU fell **34% for Canvas2D** and
**45% for WebGL2**. Repeated content additionally benefits from skipping identical paints: **71% and
89% reductions**, respectively. Output rate, 16 MiB history budget and rendering quality remain
unchanged. These results describe this browser fixture, not hardware GPU or native mobile
performance.

## CPU

Values are medians of three fresh-browser runs; parentheses show minimum–maximum. CPU percentages
refer to one logical core, so 200% means two cores. Whole-browser accounting includes terminal
workers and the GPU process. Before/after comparisons are between the initial and optimized Ghostty
implementations; unchanged xterm controls show run variation.

Repeated-output workload:

| Client                       | Visible CPU % before | Visible CPU % after | Hidden CPU % after | Four-session CPU % after |
| ---------------------------- | -------------------: | ------------------: | -----------------: | -----------------------: |
| xterm, 5,000 rows (control)  |     33.3 (29.5–34.0) |    32.7 (24.4–35.3) |    13.3 (9.1–14.6) |         62.4 (57.3–68.1) |
| xterm, 12,087 rows (control) |     32.7 (31.1–34.6) |    35.3 (34.0–36.6) |   12.4 (12.0–13.0) |         60.9 (57.9–62.5) |
| Ghostty Canvas2D             |     52.7 (49.6–56.9) |    15.3 (14.0–15.6) |      7.2 (6.8–7.2) |         33.8 (33.8–36.0) |
| Ghostty WebGL2, software     |  179.0 (172.7–182.2) |    18.8 (16.9–19.8) |      6.8 (6.5–7.5) |         34.7 (32.5–39.8) |

Constantly changing output uses unique ten-digit row IDs and six changing ANSI colors at exactly the
same byte count and rate. It forces viewport changes rather than relying on identical-frame
suppression. The xterm controls were not rerun for this separate workload.

| Client                   | Visible CPU % before | Visible CPU % after | Four-session CPU % before | Four-session CPU % after |
| ------------------------ | -------------------: | ------------------: | ------------------------: | -----------------------: |
| Ghostty Canvas2D         |     49.5 (36.6–51.4) |    32.8 (24.2–33.8) |          72.5 (64.1–72.5) |         50.7 (50.7–51.7) |
| Ghostty WebGL2, software |  172.0 (155.1–182.4) |   94.9 (93.4–103.6) |       187.8 (164.9–207.8) |      119.1 (118.9–122.2) |

Four-session workloads have one visible session and three hidden sessions, all receiving the same
output rate. Hidden sessions continue parsing and acknowledging output while skipping painting.
Two-second idle windows measured approximately 0–2.5% of one core; their duration and CPU counter
granularity do not establish battery usage. Final repeated-output replay-to-viewport medians were
134 ms for xterm 5,000 rows, 156 ms for xterm 12,087 rows, 102 ms for Canvas2D and 105 ms for
WebGL2. These include a common 40 ms paint-settling allowance.

## Memory

Settled proportional resident memory (PSS), in MiB, after forced garbage collection. Values are
medians above each run's blank-page browser baseline (approximately 146 MiB). They include
worker/WASM/graphics allocations and shared pages proportionally. These are not peak memory or
JavaScript heap measurements.

Repeated-output workload:

| Client                   | One terminal before | One terminal after | Four terminals before | Four terminals after |
| ------------------------ | ------------------: | -----------------: | --------------------: | -------------------: |
| xterm, 5,000 rows        |                50.1 |               49.7 |                 107.4 |                108.0 |
| xterm, 12,087 rows       |                67.9 |               67.1 |                 177.7 |                177.0 |
| Ghostty Canvas2D         |                64.6 |               61.1 |                 143.8 |                140.7 |
| Ghostty WebGL2, software |               124.6 |               98.1 |                 221.6 |                194.5 |

Canvas2D's single-terminal reduction is modest (5%); WebGL2's is 21%. With constantly changing
content, corresponding medians were **64.0 → 63.6 MiB** for Canvas2D and **124.0 → 97.6 MiB** for
WebGL2. Four changing-output terminals used **144.6 → 143.4 MiB** and **222.4 → 197.1 MiB**.

Much of the WebGL2 saving is a fixed/shared browser graphics cost. Each additional background
terminal in the repeated-output fixture added approximately **26.5 MiB for Canvas2D** and **32.2 MiB
for WebGL2**, versus 26.4 and 32.3 MiB before. Do not extrapolate the single-terminal percentage to
every extra session.

Canvas2D still uses more RAM than the old 5,000-row xterm default while retaining substantially more
history. After replay, Ghostty retains 12,087 rows; its byte budget retains approximately
11,928–12,043 rows after the longer streamed lines. Matching xterm to 12,087 rows is therefore an
approximation. Canvas2D uses about 9% less single-terminal and 21% less four-terminal memory than
that matched xterm control in the final repeated-output run.

## Changes and correctness

- Reuse unchanged worker cells, rows and viewport strings; skip identical paints while continuing to
  publish changed history, cursor, wrap and mouse metadata. Accessibility text updates only when
  contents change. RGB string caching is bounded.
- Retain Canvas2D pixels and repaint dirty row bands, including neighboring bands at fractional
  device scales. Merge opaque background runs, skip blank glyphs and cache font state and bounded
  glyph measurements. Preserve clipping wherever ink could cross a cell boundary.
- Reuse typed GPU geometry buffers and bounded atlas canvases/textures. Skip default blank cells,
  merge colored blank runs and avoid blending opaque tiles. Both GPU backends use batched triangles;
  these performed better than tiny instanced quads on the measured software driver.
- Preserve cached-surface correctness across resize, asynchronous font loading, renderer changes and
  context restoration. Emergency bitmap presentation copies the retained render surface before
  transferring a bitmap, keeping source pixels intact.

Verification passed 84 targeted unit tests, terminal/consumer typechecks, desktop and web production
builds, worker integration and renderer browser checks, native-adapter mocks, and terminal layout
checks. Canvas2D matched the previous full-frame renderer **pixel for pixel at zero tolerance**
across 306 frames at six fractional cell/device-scale configurations. Cases include Unicode,
selection, styles, cursor changes, scrolling, erasure, theme changes and context restoration. The
worker suite additionally verifies output arriving during font loading and software recovery.

## Workload and accounting

- A production Vite fixture dynamically loads only the selected engine. Each engine/repetition gets
  a fresh Chromium process, with interleaved variant order. Both clients use monospace at 12 px, 109
  columns × 18 rows and device pixel ratio 1. The xterm control uses the previous DOM renderer and
  options; React and app lifecycle hooks are omitted. The resource fixture does not download
  production font assets; font loading is tested separately in the worker integration suite.
- Replay contains 16,000 Unicode/ANSI lines (692,902 UTF-8 bytes including the completion marker).
  Replay timing observes the final viewport and includes a common 40 ms paint-settling allowance; it
  is not pure parser time.
- Each sustained stream sends 96 chunks of 16,359 bytes every 32 ms: approximately 499 KiB/s for
  3.072 seconds per session. Each phase adds 27,552 lines. Session zero processes approximately
  98,656 lines across replay and streaming, beyond both history capacities.
- All output must be consumed: real BinaryTerminalStream ACKs for Ghostty, xterm write callbacks for
  the legacy text stream. Visible markers are checked; hidden sessions are shown afterward to verify
  final output. Actual backend, geometry, history and browser/worker errors are checked, including
  all four sessions. The real binary-stream server runs outside client CPU accounting.
- CDP SystemInfo process CPU counters are sampled every 100 ms and at phase boundaries, with roughly
  10 ms CPU granularity. A process exiting between samples can lose its final unsampled CPU; no
  renderer or GPU crash was observed. CPU sampling precedes memory collection, excluding forced GC.
  Memory sums `/proc/<pid>/smaps_rollup` PSS for browser-owned processes reported by CDP.
- Raw data includes empty/init, replay, visible, idle, hidden, four-session init/replay,
  four-session stream and post-disposal memory. Final datasets include CPU breakdowns by process
  type. Post-disposal allocator retention is not a leak test; browsers close between variants.

## Limits, data and reproduction

Requested WebGL2 was verified to remain WebGL2. WebGPU rendered in an earlier worker smoke run, but
this host's WebGPU adapter is unstable and the final suite exercised WebGL2 fallback. No WebGPU
performance result or physical GPU speedup is claimed. PTY/runtime CPU, the Electron MessagePort
bridge, full-app React activity, peak RAM, maximum throughput, long-duration idle power and native
iOS/Android remain unmeasured. Device Hub returned no devices: the Mac Studio needs Xcode
first-launch setup and the MacBook SSH tunnel was unavailable.

Raw measurements:

- [Repeated output before optimization](terminal-resources-before-optimization.json), 12 runs.
- [Repeated output after optimization](terminal-resources.json), 12 runs.
- [Changing output before optimization](terminal-resources-varied-before-optimization.json), six
  runs. This used the preserved original production worker; bundle provenance is recorded in JSON.
- [Changing output after optimization](terminal-resources-varied.json), six runs.

Reproduce from the repository root on Linux:

```sh
pnpm exec playwright install chromium
pnpm benchmark:terminal
TERMINAL_BENCH_CONTENT=varied TERMINAL_BENCH_VARIANTS=canvas2d,webgl2 \
  TERMINAL_BENCH_OUTPUT=scripts/benchmarks/terminal-resources-varied.json pnpm benchmark:terminal
```

The benchmark fails on output loss, backend fallback, geometry/history mismatch or browser/worker
errors. `TERMINAL_BENCH_REPEATS` and `TERMINAL_BENCH_OUTPUT` override run count and JSON
destination. Source: [benchmark-terminal-resources.mjs](../benchmark-terminal-resources.mjs). Three
repetitions characterize this local run rather than provide a hardware-independent performance
guarantee.
