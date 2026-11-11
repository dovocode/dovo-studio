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
const fixtures = await compile(`
export {decode} from '../../shared/schema.js';
export {runtimeDefaultsSchema} from './runtime-setup.js';
export {snapshotSchema} from './runtime.js';
`)
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
// Remote navigation changes a small selection field; token updates change one turn.
// Keep realistic, unchanged settings and checkpoint source in both comparisons.
const remoteBefore = fixtures.decode(fixtures.snapshotSchema, workload(0).previous)
remoteBefore.detailTaskIds = ['thread']
const source = Array.from(
  { length: 700 },
  (_, index) => `export const item${index} = { id: ${index}, label: "Workspace item ${index}" };\n`,
).join('')
remoteBefore.defaults = fixtures.decode(fixtures.runtimeDefaultsSchema, {
  setupCommand: source.slice(0, 16000),
})
remoteBefore.workspace.tasks[0].turns = Array.from({ length: 6 }, (_, index) => ({
  id: `turn-${index}`,
  assistantId: `m${index}`,
  agentId: '',
  provider: 'codex',
  model: 'fixture',
  startedAt: '2026-10-01',
  status: index === 5 ? 'running' : 'completed',
  checkpoint: {
    before: `commit-${index}`,
    files: [
      { path: `source-${index}.ts`, before: source, after: source + '// edited\n', viewed: false },
    ],
    omitted: [],
  },
}))
const remoteAfter = {
  ...remoteBefore,
  revision: 2,
  workspace: {
    ...remoteBefore.workspace,
    tasks: remoteBefore.workspace.tasks.map((task) => ({
      ...task,
      turns: task.turns.map((turn, index) => (index === 5 ? { ...turn, tokens: 123 } : turn)),
    })),
  },
}
const remote = [
  { scenario: 'turn-token-update', next: remoteAfter },
  { scenario: 'thread-selection', next: { ...remoteBefore, detailTaskIds: [] } },
].map(({ scenario, next }) => {
  const legacy = current.snapshotDelta(remoteBefore, next, true, true)
  const incremental = current.snapshotDelta(remoteBefore, next, true, true, true)
  if (!isDeepStrictEqual(current.applySnapshotDelta(remoteBefore, incremental), next))
    throw new Error(`${scenario} did not reconstruct the full snapshot`)
  const beforeWire = JSON.stringify(legacy)
  const afterWire = JSON.stringify(incremental)
  return {
    scenario,
    legacyJsonBytes: Buffer.byteLength(beforeWire),
    incrementalJsonBytes: Buffer.byteLength(afterWire),
    legacyDeflatedBytes: deflateRawSync(beforeWire, { level: 3 }).length,
    incrementalDeflatedBytes: deflateRawSync(afterWire, { level: 3 }).length,
  }
})
// Measure the actual navigation microtask, including selection-cache admission.
// Transport is simulated here; the separate browser check uses real HTTP/WS.
const liveSource = await readFile(
  new URL('../packages/protocol/src/runtime/connection/live-sync.ts', import.meta.url),
  'utf8',
)
const sizingVariants = [
  {
    sizing: 'json',
    module: await compile(
      liveSource.replace(
        'const bytes = retainedBytes(snapshot)',
        'const bytes = JSON.stringify(snapshot).length * 2',
      ),
    ),
  },
  { sizing: 'bounded', module: await compile(liveSource) },
]
const navigationWorkspace = {
  ...remoteBefore,
  workspace: {
    ...remoteBefore.workspace,
    tasks: [
      {
        ...remoteBefore.workspace.tasks[0],
        turns: undefined,
        messages: Array.from({ length: 1000 }, (_, i) => ({
          id: `m${i}`,
          role: 'assistant',
          text: `Message ${i} ` + 'text '.repeat(120),
        })),
      },
      ...Array.from({ length: 300 }, (_, i) => ({
        ...remoteBefore.workspace.tasks[0],
        id: `summary-${i}`,
        draft: 'draft '.repeat(20),
        turns: undefined,
        messages: [],
      })),
    ],
  },
}
const originalFetch = globalThis.fetch
const originalSocket = globalThis.WebSocket
const navigation = []
try {
  globalThis.fetch = async () => Response.json({ ticket: 'benchmark', format: 6 })
  for (const { sizing, module: live } of sizingVariants) {
    for (const scenario of [
      'checkpoints',
      'padding-1MiB',
      'oversized-8MiB',
      '300-summaries-1000-messages',
    ]) {
      const paddingBytes =
        scenario === 'padding-1MiB'
          ? 1024 * 1024
          : scenario === 'oversized-8MiB'
            ? 8 * 1024 * 1024
            : 0
      const samples = []
      const afterDelta = []
      const snapshot = {
        ...(scenario === '300-summaries-1000-messages' ? navigationWorkspace : remoteBefore),
        detailTaskIds: ['thread'],
        runtimeHost: 'x'.repeat(paddingBytes),
      }
      const changed = {
        ...snapshot,
        revision: 2,
        workspace: {
          ...snapshot.workspace,
          tasks: snapshot.workspace.tasks.map((task, index) =>
            index ? task : { ...task, title: 'Updated title' },
          ),
        },
      }
      const deltaWire = JSON.stringify({
        type: 'delta',
        epoch: 'benchmark',
        base: 1,
        sequence: 2,
        tag: 'updated',
        delta: current.snapshotDelta(snapshot, changed, true, true, true),
      })
      let admitted = false
      const frame = JSON.stringify({
        type: 'snapshot',
        epoch: 'benchmark',
        sequence: 1,
        tag: 'benchmark',
        snapshot,
      })
      for (let index = 0; index < 15; index++) {
        const created = Promise.withResolvers()
        globalThis.WebSocket = class {
          readyState = 0
          sent = []
          constructor() {
            created.resolve(this)
          }
          send(wire) {
            this.sent.push(JSON.parse(wire))
          }
          close() {
            this.readyState = 3
          }
        }
        const connection = {
          address: `http://navigation-${sizing}-${scenario}-${index}.invalid`,
          token: 'benchmark-paired-token',
        }
        const release = live.watchRuntimeTask(connection, 'thread')
        const stream = live.startRuntimeSync(connection, { onSnapshot() {} })
        let next
        try {
          const socket = await created.promise
          socket.readyState = 1
          socket.onopen()
          socket.onmessage({ data: frame })
          const started = performance.now()
          release()
          next = live.watchRuntimeTask(connection, 'other')
          await Promise.resolve()
          samples.push(performance.now() - started)
          if (socket.sent.at(-1)?.tasks?.[0] !== 'other')
            throw new Error('Navigation was not sent immediately')
          socket.onmessage({ data: deltaWire })
          const updatedAt = performance.now()
          next()
          next = live.watchRuntimeTask(connection, 'thread')
          await Promise.resolve()
          afterDelta.push(performance.now() - updatedAt)
          admitted = socket.sent.at(-1)?.resume?.sequence === 2
        } finally {
          stream.stop()
          release()
          next?.()
        }
      }
      samples.sort((a, b) => a - b)
      afterDelta.sort((a, b) => a - b)
      navigation.push({
        sizing,
        scenario,
        snapshotJsonBytes: Buffer.byteLength(JSON.stringify(snapshot)),
        admitted,
        medianMs: Number(samples[7].toFixed(3)),
        p95Ms: Number(samples[14].toFixed(3)),
        afterDeltaMedianMs: Number(afterDelta[7].toFixed(3)),
      })
    }
  }
} finally {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalSocket
}
// Field-only updates must not scale with retained conversation length. Workspace
// metadata updates must not build a task lookup when no tasks changed.
const reconciliation = []
for (const scenario of ['thread-field', 'workspace-metadata']) {
  for (const count of [100, 1000, 10000]) {
    const { previous } = workload(0)
    previous.workspace.tasks[0].messages = Array.from({ length: count }, (_, index) => ({
      id: `history-${index}`,
      role: 'assistant',
      text: `Message ${index}`,
    }))
    const next = {
      ...previous,
      revision: 2,
      workspace: {
        ...previous.workspace,
        tasks: [{ ...previous.workspace.tasks[0], draft: 'New draft' }],
      },
    }
    if (scenario === 'workspace-metadata') {
      previous.workspace.tasks = Array.from({ length: count }, (_, index) => ({
        ...previous.workspace.tasks[0],
        id: `thread-${index}`,
        messages: [],
      }))
      next.workspace = { ...previous.workspace, runtimeAddress: 'http://paired.lan:8787' }
    }
    const delta = current.snapshotDelta(previous, next, true, true, true)
    function measureApply(module) {
      if (!isDeepStrictEqual(module.applySnapshotDelta(previous, delta), next))
        throw Error('Field-only reconciliation changed snapshot contents')
      for (let index = 0; index < 30; index++) module.applySnapshotDelta(previous, delta)
      const samples = []
      for (let sample = 0; sample < 25; sample++) {
        const start = performance.now()
        for (let iteration = 0; iteration < 30; iteration++)
          module.applySnapshotDelta(previous, delta)
        samples.push((performance.now() - start) / 30)
      }
      return Number(samples.sort((a, b) => a - b)[12].toFixed(4))
    }
    reconciliation.push({
      scenario,
      entities: count,
      currentMedianMs: measureApply(current),
      ...(baseline ? { baselineMedianMs: measureApply(baseline) } : {}),
    })
  }
}
console.log(
  JSON.stringify(
    {
      scope: 'Isolated snapshotDelta with shared file fields and a streamed text append',
      baselineRef,
      results,
      selection,
      remote,
      navigation,
      reconciliation,
    },
    null,
    2,
  ),
)
