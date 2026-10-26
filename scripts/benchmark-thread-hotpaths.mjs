// Isolated CPU benchmarks, not end-to-end navigation or VPN latency.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../', import.meta.url))
const paths = [
  'packages/protocol/src/tasks/task-priority.ts',
  'packages/protocol/src/tasks/settled-page.ts',
  'packages/protocol/src/tasks/task-pull-links.ts',
  'packages/runtime/src/http/support/body.ts',
]
const index = process.argv.indexOf('--baseline-ref')
const baseline = index >= 0 ? process.argv[index + 1] : undefined
if (index >= 0 && !baseline) throw new Error('--baseline-ref requires a Git reference')
async function load(ref) {
  const sources = new Map(
    await Promise.all(
      paths.map(async (path) => [
        root + path,
        ref
          ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
          : await readFile(root + path, 'utf8'),
      ]),
    ),
  )
  const result = await build({
    stdin: {
      contents: paths.map((path) => `export * from './${path}'`).join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root + 'package.json')});`,
    },
    plugins: [
      {
        name: 'comparison-sources',
        setup(builder) {
          builder.onLoad({ filter: /\.ts$/ }, (args) =>
            sources.has(args.path) ? { contents: sources.get(args.path), loader: 'ts' } : undefined,
          )
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${ref ?? 'checkout'}`
  ).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
function task(i, count) {
  return {
    id: `thread-${i}`,
    title: `Thread ${count - i}`,
    repositoryId: `repo-${i % 40}`,
    agentId: '',
    status: 'review',
    archived: true,
    createdAt: new Date(1700000000000 + ((i * 7919) % count) * 1000).toISOString(),
    draft: '',
    example: false,
    messages: [],
    files: [],
  }
}
function measure(run, repetitions = 12) {
  run()
  const samples = []
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now()
    run(i)
    samples.push(performance.now() - start)
  }
  return Number(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3))
}
const implementations = []
if (baseline) implementations.push([baseline, await load(baseline)])
implementations.push(['checkout', await load()])
const output = []
const associated = Array.from({ length: 10000 }, (_, index) => ({
  id: String(index),
  example: false,
  linkedPullRequests: Array.from({ length: 5 }, (_, offset) => ({
    number: offset + 1,
    title: 'PR',
    url: `https://github.com/team/repo/pull/${(index % 200) + offset + 1}`,
  })),
}))
let expectedLinks
for (const [version, impl] of implementations) {
  const matches = impl
    .pullLinkedTasks(associated, 'https://github.com/team/repo/pull/7')
    .map((task) => task.id)
  if (expectedLinks) assert.deepEqual(matches, expectedLinks)
  else expectedLinks = matches
  output.push({
    version,
    workload: '10000 threads: reverse PR links after streaming',
    milliseconds: measure(() =>
      impl.pullLinkedTasks(
        associated.map((task) => ({ ...task, draft: 'streamed' })),
        'https://github.com/team/repo/pull/7',
      ),
    ),
  })
}

for (const count of [1000, 10000]) {
  const tasks = Array.from({ length: count }, (_, i) => task(i, count))
  const projects = new Map(Array.from({ length: 40 }, (_, i) => [`repo-${i}`, `Project ${40 - i}`]))
  const input = new Set()
  let expected
  const sorted = new Map()
  for (const [version, impl] of implementations) {
    const page = impl.settledSummaryPage(tasks, 25)
    const ids = page.tasks.map((entry) => entry.id)
    if (expected) assert.deepEqual(ids, expected)
    else expected = ids
    output.push({
      version,
      workload: `${count} settled: select 25`,
      milliseconds: measure(() => impl.settledSummaryPage(tasks, 25)),
    })
    for (const sort of ['priority', 'title', 'project']) {
      const compare = (a, b) => impl.compareTasks(a, b, sort, input, projects)
      const ordered = [...tasks].sort(compare).map((entry) => entry.id)
      if (sorted.has(sort)) assert.deepEqual(ordered, sorted.get(sort))
      else sorted.set(sort, ordered)
      output.push({
        version,
        workload: `${count} summaries: ${sort}`,
        milliseconds: measure(() => [...tasks].sort(compare)),
      })
    }
  }
}
// 250 retained thread windows; one assistant streams, unchanged file text stays shared.
const tasks = Array.from({ length: 250 }, (_, i) => ({
  ...task(i, 250),
  files: [{ path: 'large.ts', before: 'a'.repeat(4096), after: 'b'.repeat(4096) }],
  messages: Array.from({ length: 20 }, (_, j) => ({
    id: `m${j}`,
    role: 'assistant',
    text: 'x'.repeat(100),
  })),
}))
const original = {
  revision: 1,
  owner: true,
  workspace: { version: 1, tasks, agents: [], repositories: [] },
}
const frames = Array.from({ length: 15 }, (_, i) => ({
  ...original,
  revision: i + 2,
  workspace: {
    ...original.workspace,
    tasks: tasks.map((entry, index) =>
      index
        ? entry
        : {
            ...entry,
            messages: [
              ...entry.messages,
              { id: 'stream', role: 'assistant', text: 'new'.repeat(i + 1) },
            ],
          },
    ),
  },
}))
const coldSnapshots = Array.from({ length: 13 }, () => structuredClone(original))
for (const [version, impl] of implementations) {
  output.push({
    version,
    workload: '250 windows: cold hash',
    milliseconds: measure((i = 0) => impl.snapshotTag(coldSnapshots[i])),
  })
  assert.equal(impl.snapshotTag(original), impl.snapshotTag(structuredClone(original)))
  assert.notEqual(impl.snapshotTag(original), impl.snapshotTag({ ...original, owner: false }))
  output.push({
    version,
    workload: '250 windows: hash changed workspace',
    milliseconds: measure((i = 0) => impl.snapshotTag(frames[i]), 12),
  })
}
console.log(JSON.stringify(output, null, 2))
