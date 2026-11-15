# Repository warning audit

Audited on 15 November 2026. The repository check reports zero errors and 33 warnings. I inspected
every warning and its relevant caller. Opus 5.5 also reviewed the browser method captures. This
audit changes no warning source and disables no rule.

The warnings do not establish a battery, connection or release defect. The browser method captures
use the correct receivers. The useful follow-up work is to type six test mocks, narrow six exception
assertions and handle one navigation promise explicitly.

## Findings

Line numbers refer to the audited working tree.

| File and lines                                                         | Count | Finding                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/electron/browser-tab-activity.ts:35,36,38,39,40,41,42`   |     7 | Deliberate captures of native methods and track getters. Each call uses `Reflect.apply` with its promise, stream or track. Capturing the original methods prevents page overrides from hiding device activity. Reading the methods again at call time would weaken this protection. |
| `apps/desktop/electron/browser-video-pip.ts:49,50`                     |     2 | Native enter and exit methods run with the video or document receiver through `Reflect.apply`. Cleanup keeps the original rejection. No detached call found.                                                                                                                        |
| `apps/desktop/electron/browser-document-pip.ts:124,127`                |     2 | Bound EventTarget wrappers take the explicit window, document, child or API receiver. The linter cannot follow this binding.                                                                                                                                                        |
| `scripts/check-ghostty-terminal-browser.mjs:211`                       |     1 | The FontFace wrapper calls the saved method with `.call(this)` and restores it after the check.                                                                                                                                                                                     |
| `scripts/check-terminal-renderers-browser.mjs:100,106`                 |     2 | Test instrumentation calls the captured graphics methods with `.apply(this, args)`.                                                                                                                                                                                                 |
| `packages/runtime/src/http/peer-connections.test.ts:268`               |     1 | The test captures `gatherCandidates` and invokes it with `gather.call(this)`.                                                                                                                                                                                                       |
| `packages/runtime/src/terminal/binary-stream.test.ts:41,82,132`        |     3 | These references pass mock methods to assertions. They do not invoke them without a receiver.                                                                                                                                                                                       |
| `packages/runtime/src/terminal/binary-stream.test.ts:11,51,93,126,127` |     5 | Untyped mocks reduce compile-time checking of mock calls. Add the actual callback types when updating these tests. No runtime failure was reproduced.                                                                                                                               |
| `apps/desktop/electron/browser-visibility.test.ts:22`                  |     1 | Another untyped mock. Use the visibility callback signature.                                                                                                                                                                                                                        |
| `packages/runtime/src/terminal/binary-stream.test.ts:27,118`           |     2 | Broad `toThrow()` assertions can accept an unrelated exception. Assert `Invalid terminal acknowledgement`.                                                                                                                                                                          |
| `packages/protocol/src/terminal-stream.test.ts:12,13,14`               |     3 | Empty and truncated frames should assert `Invalid terminal stream frame`. Invalid JSON should assert `SyntaxError`. Current assertions do not distinguish these causes.                                                                                                             |
| `packages/runtime/src/agents/catalogs/resources.test.ts:512`           |     1 | The invalid-source test accepts any exception. Narrow it to the schema validation failure so an unrelated fetch or programming error cannot pass.                                                                                                                                   |
| `packages/runtime/src/agents/execution/handover.test.ts:248`           |     1 | The conditional selects an asymmetric matcher. Assertions still run for every mode. It does not skip a test assertion.                                                                                                                                                              |
| `packages/runtime/src/studio/tools.test.ts:1460`                       |     1 | Tuple inference widens the two literal path/input pairs to a union. The actual paths are strings. A typed readonly tuple would remove the ambiguity. No object URL was produced.                                                                                                    |
| `packages/studio-shell/src/workbench.tsx:405`                          |     1 | An effect ignores the promise returned by `navigate`. This path moves a hidden section landing to Workspace. It has no entity ID and does not use the settings confirmation path. No normal rejection was reproduced. An unexpected throw would lack a local error handler.         |

The totals are 18 method-reference warnings, six untyped mocks, six broad exception assertions, one
conditional matcher, one tuple inference warning and one floating promise.

Do not replace native method captures with untyped access through `Reflect.get`, or add casts that
hide them. Those changes would remove warnings without improving safety. For navigation,
`void navigate(...)` alone would also hide the warning. A future fix should report the failure
through the existing error state and guard against stale navigation or an unmounted component.

## Verification

The following unmodified suites passed 108 tests:

```sh
pnpm exec vp test --maxWorkers=2 \
  packages/runtime/src/terminal/binary-stream.test.ts \
  packages/protocol/src/terminal-stream.test.ts \
  packages/runtime/src/agents/execution/handover.test.ts \
  apps/desktop/electron/browser-visibility.test.ts \
  packages/runtime/src/agents/catalogs/resources.test.ts \
  packages/runtime/src/http/peer-connections.test.ts \
  packages/runtime/src/studio/tools.test.ts \
  packages/studio-shell/src/activity-bar.test.ts
```

Installed managed Chromium first. These three real Electron checks also passed:

```sh
pnpm exec playwright install chromium
node scripts/check-browser-tab-activity-native.mjs
node scripts/check-browser-video-pip-native.mjs
node scripts/check-browser-document-pip-native.mjs
```

The tab check exercises Chromium media tracks, cloning, stopping and screen sharing. It uses
Chromium's fake camera and microphone device, so it does not test physical capture hardware. The
Picture-in-Picture checks exercise the native APIs and the production wrappers. They confirm the
receivers for the exercised paths. The video check did not use `--native-controls`, so this audit
does not establish the native window buttons. These are local Electron checks. They do not establish
physical iPhone behavior or hosted CI results.

Raw inventory and logs are in the ignored local folder
`work/model-instruction-benchmark/rounds37-41/`. The inventory is `warning-inventory.json`. Test
output is in `warning-regressions.log`. Native check logs use the `warning-browser-` prefix.
