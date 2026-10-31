// Isolated pending-preview projection; excludes rendering, storage, and network.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'

const path = 'packages/protocol/src/conversation/workflow/pending-message.ts'
const root = fileURLToPath(new URL('../', import.meta.url))
const index = process.argv.indexOf('--baseline-ref')
const ref = index < 0 ? undefined : process.argv[index + 1]
if (index >= 0 && !ref) throw new Error('--baseline-ref requires a Git reference')
async function load(source) {
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: `${root}packages/protocol/src/conversation/workflow`,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root + 'package.json')});`,
    },
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
}
const current = await load(await readFile(root + path, 'utf8'))
const baseline = ref
  ? await load(execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' }))
  : undefined
if (baseline) {
  let seed = 123456789
  const random = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed >>> 8) % limit
  }
  for (let sample = 0; sample < 2000; sample++) {
    const message = () => ({ id: `id-${random(8)}`, role: 'user', text: `text-${random(8)}` })
    const task = {
      id: 'task',
      status: random(2) ? 'running' : 'draft',
      messages: Array.from({ length: random(12) }, message),
      queue: Array.from({ length: random(40) }, () => ({
        ...message(),
        createdAt: '',
        steering: random(2) === 0,
      })),
    }
    const pending = Array.from({ length: random(40) }, () => ({
      taskId: random(2) ? 'task' : 'other',
      message: message(),
      state: 'saved',
    }))
    assert.deepStrictEqual(
      current.visiblePendingMessages(task, pending),
      baseline.visiblePendingMessages(task, pending),
    )
  }
  console.error('2,000 deterministic duplicate/steering equivalence cases passed')
}
function measure(run, iterations) {
  for (let iteration = 0; iteration < iterations; iteration++) run()
  const samples = []
  for (let sample = 0; sample < 25; sample++) {
    const start = performance.now()
    for (let iteration = 0; iteration < iterations; iteration++) run()
    samples.push((performance.now() - start) / iterations)
  }
  return Number(samples.sort((a, b) => a - b)[12].toFixed(4))
}
for (const historySize of [100, 20000])
  for (const kind of ['pending', 'foreign', 'steering', 'mixed'])
    for (const count of [1, 2, 3, 4, 5, 10, 20, 50, 100]) {
      const task = {
        id: 'task',
        status: 'running',
        messages: Array.from({ length: historySize }, (_, id) => ({
          id: `history-${id}`,
          role: 'user',
          text: '',
        })),
        queue:
          kind === 'steering' || kind === 'mixed'
            ? Array.from({ length: kind === 'mixed' ? Math.floor(count / 2) : count }, (_, id) => ({
                id: `queue-${id}`,
                role: 'user',
                text: '',
                createdAt: '',
                steering: true,
              }))
            : [],
      }
      const pending = Array.from(
        { length: kind === 'steering' ? 0 : kind === 'mixed' ? Math.ceil(count / 2) : count },
        (_, id) => ({
          taskId:
            (kind === 'foreign' && id !== 0) || (kind === 'mixed' && id % 2 !== 0)
              ? 'other'
              : 'task',
          message: { id: `pending-${id}`, role: 'user', text: '' },
          state: 'saved',
        }),
      )
      const run = (implementation) => () => implementation.visiblePendingMessages(task, pending)
      if (baseline) assert.deepStrictEqual(run(current)(), run(baseline)())
      console.log(
        JSON.stringify({
          messages: task.messages.length,
          kind,
          count,
          baselineMs: baseline && measure(run(baseline), historySize === 100 ? 2000 : 20),
          currentMs: measure(run(current), historySize === 100 ? 2000 : 20),
        }),
      )
    }
