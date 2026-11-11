// Production sync functions with synthetic review files. Excludes storage, transport and UI.
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'

const baselineIndex = process.argv.indexOf('--baseline-ref')
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined
if (baselineIndex >= 0 && !baselineRef) throw new Error('--baseline-ref requires a Git reference')
async function compile(path) {
  const url = new URL(`../${path}`, import.meta.url)
  const output = await build({
    stdin: {
      contents: baselineRef
        ? execFileSync('git', ['show', `${baselineRef}:${path}`], { encoding: 'utf8' })
        : await readFile(url, 'utf8'),
      resolveDir: new URL('.', url).pathname,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');",
    },
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
  )
}
const { snapshotDelta, applySnapshotDelta } = await compile(
  'packages/protocol/src/runtime/connection/sync.ts',
)
const { snapshotTag } = await compile('packages/runtime/src/http/support/body.ts')
const { changedFileFingerprint } = await compile('packages/protocol/src/scm/review.ts')
const text = Array.from(
  { length: 400 },
  (_, i) => `export const item${i} = 'source line ${i}: preserve file bytes and review state';`,
).join('\n')
const files = Array.from({ length: 50 }, (_, i) => ({
  path: `src/file-${i}.ts`,
  before: text,
  after: text + '\n// changed\n',
  diskContents: text + '\n// changed\n',
  viewed: false,
}))
const task = {
  id: 'thread',
  title: 'Review',
  repositoryId: 'project',
  agentId: '',
  status: 'running',
  createdAt: '2026-11-11T00:00:00Z',
  draft: '',
  example: false,
  files,
  messages: [{ id: 'm1', role: 'assistant', text: 'Answer' }],
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
        files: files.map((file, index) => (index === 25 ? { ...file, viewed: true } : file)),
      },
    ],
  },
}
const delta = snapshotDelta(previous, next, true, true, true, true)
if (!isDeepStrictEqual(applySnapshotDelta(previous, delta), next))
  throw new Error('Delta reconstruction failed')
function measure(run, count = 25) {
  const samples = []
  for (let i = 0; i < count; i++) {
    const start = performance.now()
    run(i)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[Math.floor(count / 2)], p95Ms: samples[Math.floor(count * 0.95)] }
}
for (let i = 0; i < 10; i++) snapshotDelta(previous, next, true, true, true, true)
const coldTags = [
  { name: 'review-files', value: previous },
  {
    name: 'many-messages',
    value: {
      ...previous,
      workspace: {
        ...previous.workspace,
        tasks: Array.from({ length: 25 }, (_, taskIndex) => ({
          ...task,
          id: `thread-${taskIndex}`,
          files: [],
          messages: Array.from({ length: 100 }, (_, index) => ({
            id: `m-${index}`,
            role: 'assistant',
            text: `Reply ${index} ` + 'text '.repeat(40),
          })),
        })),
      },
    },
  },
].map(({ name, value }) => ({
  name,
  jsonBytes: Buffer.byteLength(JSON.stringify(value)),
  ...measureCold(value),
}))
function measureCold(value, run = snapshotTag) {
  const samples = []
  for (let index = 0; index < 25; index++) {
    const fresh = structuredClone(value)
    // Exclude fixture cloning from the cold hash timing.
    const start = performance.now()
    run(fresh)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[12], p95Ms: samples[23] }
}
console.log(
  JSON.stringify(
    {
      source: baselineRef ?? 'working tree',
      reviewFingerprints: measure(() => files.map(changedFileFingerprint)),
      coldReviewFingerprints: measureCold(files, (fresh) => fresh.map(changedFileFingerprint)),
      coldTags,
      viewedFlag: {
        files: files.length,
        fileCharacters: text.length,
        filesJsonBytes: Buffer.byteLength(JSON.stringify(files)),
        deltaJsonBytes: Buffer.byteLength(JSON.stringify(delta)),
        apply: measure(() => applySnapshotDelta(previous, delta)),
        ...measure(() => snapshotDelta(previous, next, true, true, true, true)),
      },
      tag: [false, true].map((withFiles) => ({
        withFiles,
        ...measure((index) =>
          snapshotTag({
            ...previous,
            revision: index + 1,
            workspace: {
              ...previous.workspace,
              tasks: [
                {
                  ...task,
                  files: withFiles ? files : [],
                  messages: [{ id: 'm1', role: 'assistant', text: `Answer ${index}` }],
                },
              ],
            },
          }),
        ),
      })),
    },
    null,
    2,
  ),
)
