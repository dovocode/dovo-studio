// Isolated production delta cost; excludes SQLite, transport, rendering and network latency.
// Run before committing with --baseline-ref HEAD to compare the checkout against its baseline.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { performance } from 'node:perf_hooks'
import { deflateRawSync } from 'node:zlib'

const modulePath = 'packages/protocol/src/runtime/connection/sync.ts'
const root = fileURLToPath(new URL('../', import.meta.url))
const baselineIndex = process.argv.indexOf('--baseline-ref')
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined
if (baselineIndex >= 0 && !baselineRef) throw new Error('--baseline-ref requires a Git reference')
async function compile(source) {
  const bundled = await build({
    stdin: {
      contents: source,
      resolveDir: fileURLToPath(
        new URL('../packages/protocol/src/runtime/connection/', import.meta.url),
      ),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');",
    },
    write: false,
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  )
}
const current = await compile(await readFile(new URL(`../${modulePath}`, import.meta.url), 'utf8'))
const baseline = baselineRef
  ? await compile(
      execFileSync('git', ['show', `${baselineRef}:${modulePath}`], {
        cwd: root,
        encoding: 'utf8',
      }),
    )
  : undefined
function workload(bytes) {
  const task = {
    id: 'thread',
    title: 'Streaming',
    repositoryId: '',
    agentId: '',
    status: 'running',
    createdAt: '2026-10-01T00:00:00Z',
    draft: '',
    example: false,
    files: bytes
      ? [
          {
            path: 'large.txt',
            before: 'a'.repeat(bytes / 2),
            after: 'b'.repeat(bytes / 2),
            viewed: false,
          },
        ]
      : [],
    messages: Array.from({ length: 100 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      text: `Message ${index}`,
    })),
  }
  const previous = {
    revision: 1,
    owner: true,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      automations: [],
      tasks: [task],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  }
  const next = {
    ...previous,
    revision: 2,
    workspace: {
      ...previous.workspace,
      tasks: [
        {
          ...task,
          updatedAt: '2026-10-01T00:00:01Z',
          messages: task.messages.map((message, index) =>
            index === 99 ? { ...message, text: message.text + ' appended' } : message,
          ),
        },
      ],
    },
  }
  return { previous, next }
}
function measure(module, previous, next) {
  for (let index = 0; index < 50; index++) module.snapshotDelta(previous, next, true, true)
  const samples = []
  for (let sample = 0; sample < 25; sample++) {
    const start = performance.now()
    for (let iteration = 0; iteration < 10; iteration++)
      module.snapshotDelta(previous, next, true, true)
    samples.push((performance.now() - start) / 10)
  }
  samples.sort((a, b) => a - b)
  return Number(samples[Math.floor(samples.length / 2)].toFixed(4))
}
const results = []
for (const sharedFileBytes of [0, 1024 * 1024, 4 * 1024 * 1024]) {
  const { previous, next } = workload(sharedFileBytes)
  if (
    baseline &&
    !isDeepStrictEqual(
      baseline.snapshotDelta(previous, next, true, true),
      current.snapshotDelta(previous, next, true, true),
    )
  )
    throw new Error('Baseline and checkout produced different deltas')
  results.push({
    sharedFileBytes,
    currentMedianMs: measure(current, previous, next),
    ...(baseline ? { baselineMedianMs: measure(baseline, previous, next) } : {}),
  })
}
// A scoped navigation previously downloaded the complete workspace again. Compare
// complete JSON and the opt-in handoff, including independent level-3 compression.
const { previous: selectionBefore } = workload(0)
selectionBefore.detailTaskIds = ['thread']
selectionBefore.workspace.tasks.push(
  ...Array.from({ length: 300 }, (_, index) => ({
    ...selectionBefore.workspace.tasks[0],
    id: `background-${index}`,
    title: `Background work ${index}`,
    draft: `Context for background work ${index}. `.repeat(40),
    messages: [],
  })),
)
const selectionAfter = {
  ...selectionBefore,
  detailTaskIds: ['background-1'],
  workspace: {
    ...selectionBefore.workspace,
    tasks: selectionBefore.workspace.tasks.map((task) =>
      task.id === 'thread'
        ? { ...task, messages: [] }
        : task.id === 'background-1'
          ? { ...task, messages: [{ id: 'reply', role: 'assistant', text: 'Other reply' }] }
          : task,
    ),
  },
}
const selectionDelta = current.snapshotDelta(selectionBefore, selectionAfter, true, true)
if (!isDeepStrictEqual(current.applySnapshotDelta(selectionBefore, selectionDelta), selectionAfter))
  throw new Error('Selection handoff did not reconstruct the full snapshot')
const selectionFrame = JSON.stringify({
  type: 'selection',
  previousEpoch: 'previous-view',
  base: 1,
  epoch: 'selected-view',
  sequence: 1,
  tag: 'selected',
  delta: selectionDelta,
})
const fullFrame = JSON.stringify({
  type: 'snapshot',
  epoch: 'selected-view',
  sequence: 1,
  tag: 'selected',
  snapshot: selectionAfter,
})
const selection = {
  tasks: selectionAfter.workspace.tasks.length,
  fullJsonBytes: Buffer.byteLength(fullFrame),
  handoffJsonBytes: Buffer.byteLength(selectionFrame),
  fullDeflatedBytes: deflateRawSync(fullFrame, { level: 3 }).length,
  handoffDeflatedBytes: deflateRawSync(selectionFrame, { level: 3 }).length,
}
console.log(
  JSON.stringify(
    {
      scope: 'Isolated snapshotDelta with shared file fields and a streamed text append',
      baselineRef,
      results,
      selection,
    },
    null,
    2,
  ),
)
