# Provider, worker and terminal fixes

## Four new fixes

| T3 change                                                                                              | Dovo implementation                                                                                                                                                                                                                                                | Verification limit                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [End work left by a dead provider](https://github.com/pingdotgg/t3code/commit/51cdf232652d)            | End pending provider tool records by session or failed attempt. Read all saved tool pages. Preserve completed and cancelled records, other sessions and app-owned work. Reject late events after closure. Warm ACP process exit now notifies the current owner.    | SQLite and runtime integration tests cover late closure, separate Dovo children, split Claude calls and existing Stop results. A subprocess test kills a reused ACP process after the parent returns.    |
| [Remote tasks report the actual model](https://github.com/pingdotgg/t3code/commit/19b33eca4c45)        | Save requested and provider-reported models separately. Carry the reported model through worker records, nested snapshots, remote completion notices, read/list results and offline results. Desktop and mobile worker rows show the reported model when supplied. | Local and paired-runtime HTTP tests use fixture providers. Missing reports remain unknown. Configured models do not establish which model ran.                                                           |
| [Grok accepts steering during a running turn](https://github.com/pingdotgg/t3code/commit/f82162f0336c) | Send text and images with `_x.ai/interject` for Grok launch identities in ACP v1 and v2. Require the queued response. Preserve the active tool. Clear the control when the turn ends. Block the interrupt/restart fallback while Grok is not ready.                | Subprocess JSON-RPC tests cover accepted, rejected and malformed replies, process exit before reply, text/images, generic ACP exclusion and cleanup. Live Grok execution remains unverified.             |
| [Terminal decorations under the cursor](https://github.com/pingdotgg/t3code/commit/b9bc03869e0f)       | Dovo's current browser terminal uses custom Ghostty renderers. Redraw supported underline and strikethrough decorations in cursor text color after the block fill. The shared scene covers Canvas2D and both GPU renderers. Keep concealed text hidden.            | Unit tests cover blank and wide cells. Browser pixel checks pass on Canvas2D and WebGL2. Chromium could not initialise WebGPU. Native terminals use expo-libghostty and were not changed or tested here. |

The earlier comparison described Dovo's web terminal as xterm. That description was stale. The
current source uses `packages/terminal/src/browser/renderers`. Dovo's browser cell format currently
exports underline and strikethrough. This change does not add overline support.

## Verification of the four fixes

Run from the project root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/runtime/src/agents/providers/acp/acp.test.ts packages/runtime/src/agents/providers/acp/acp-v2.test.ts packages/runtime/src/agents/providers/acp/grok-steering.test.ts packages/runtime/src/agents/providers/acp/acp-v2-updates.test.ts packages/runtime/src/agents/providers/acp/antigravity.test.ts packages/runtime/src/agents/execution/subagents.test.ts packages/runtime/src/storage/activity.test.ts packages/protocol/src/conversation/workflow/subagents.test.ts packages/protocol/src/tasks/thread-watches.test.ts packages/terminal/src/browser/renderers --maxWorkers=4
pnpm exec vp test packages/runtime/src/agents/tasks/tasks.test.ts packages/runtime/src/agents/tasks/delegation.test.ts packages/runtime/src/agents/tasks/delegation-state.test.ts packages/runtime/src/studio/subagents.test.ts packages/runtime/src/agents/execution/native-shutdown.test.ts packages/runtime/src/agents/execution/native-agent-interactions.test.ts packages/extension-tasks/src/list/thread-tree.test.ts --maxWorkers=3
pnpm --filter @dovo/protocol --filter @dovo/runtime --filter @dovo/terminal --filter @dovo/extension-tasks --filter @dovo/mobile typecheck
pnpm --filter @dovo/runtime build
node scripts/check-terminal-renderers-browser.mjs
node scripts/check-subagent-grouping-browser.mjs
```

The isolated release source passes all 332 focused tests across 19 suites, all 31 workspace type
checks and all 29 workspace build tasks. Desktop and mobile worker-row browser checks pass. Canvas2D
and WebGL2 pixel checks pass. The repository check reports zero errors and the existing 33 warnings.

These checks use fixture providers, local SQLite and paired HTTP runtimes. They do not call live
Grok or establish physical-device rendering. Provider cleanup only changes rows with the new
provider-ownership metadata. It does not reclassify older diagnostic history. This change does not
include a nightly release or a new iPhone installation.
