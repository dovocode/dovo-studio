// Isolated production delta cost; excludes SQLite, transport, rendering and network latency.
// Run before committing with --baseline-ref HEAD to compare the checkout against its baseline.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { performance } from 'node:perf_hooks'

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
console.log(
  JSON.stringify(
    {
      scope: 'Isolated snapshotDelta with shared file fields and a streamed text append',
      baselineRef,
      results,
    },
    null,
    2,
  ),
)
