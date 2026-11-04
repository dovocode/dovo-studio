import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { prepareWorkspaceRouterModel } from './packaging/workspace-router-model.mjs'

const directory = fileURLToPath(
  new URL('../packages/runtime/dist/models/workspace-router/', import.meta.url),
)
await prepareWorkspaceRouterModel(directory)
// Preparation is the only network step. Both native inference and the strict tokenizer stay offline.
globalThis.fetch = () => {
  throw new Error('Model inference must never access the network')
}
const { loadGliclassRouter } =
  await import('../packages/runtime/dist/agents/tasks/gliclass-router-inference.js')
const { WorkspaceRouter } =
  await import('../packages/runtime/dist/agents/tasks/workspace-router.js')
const started = performance.now()
const model = await loadGliclassRouter(directory)
try {
  const cases = JSON.parse(
    await readFile(new URL('./fixtures/workspace-router-reference.json', import.meta.url), 'utf8'),
  )
  let maxDifference = 0
  for (const entry of cases) {
    const prediction = await model.predict(entry.task, entry.input, entry.options)
    assert.equal(prediction.id, entry.expected, `Export parity: ${entry.task}: ${entry.input}`)
    maxDifference = Math.max(
      maxDifference,
      ...prediction.logits.map((value, index) => Math.abs(value - entry.logits[index])),
    )
  }
  assert.equal(cases.length, 100)
  assert.ok(maxDifference < 0.005, 'Bundled inference must retain numeric parity')
  console.log(
    `GLiClass run-09 reference parity: ${cases.length}/${cases.length}; max logit difference ${maxDifference}`,
  )
  const corpus = JSON.parse(
    await readFile(new URL('./benchmarks/workspace-selection-cases.json', import.meta.url), 'utf8'),
  )
  for (const entry of corpus.cases) {
    const result = await model.route({ text: entry.text, catalogs: corpus.catalogs })
    const actual = { destination: result.mode, ...result.selections }
    for (const [field, expected] of Object.entries(entry.expected))
      assert.equal(actual[field], expected, `Workspace selection: ${field}: ${entry.text}`)
  }
  console.log(
    `Workspace acceptance: ${corpus.cases.length}/${corpus.cases.length} complete suggestions`,
  )
  // Compare more than 16 supplied options using model-selected finalists, not truncated catalogs.
  const projects = Array.from({ length: 35 }, (_, i) => ({
    id: `project-${i}`,
    label: `project: Example App ${i}`,
  }))
  const expanded = await model.route({
    text: 'Use project Example App 34 to fix the build',
    mode: 'thread',
    catalogs: {
      project: [
        {
          id: 'keep',
          label: 'Keep the currently selected project; no available project requested',
        },
        ...projects,
      ],
    },
  })
  assert.equal(expanded.selections.project, 'project-34')
} finally {
  await model.dispose()
}
// Verify the production worker transport too, without provider settings or credentials.
const router = new WorkspaceRouter()
try {
  for (const [input, expected] of [
    ['https://example.com', 'browser'],
    ['pnpm test', 'terminal'],
    ['fix the login bug', 'thread'],
  ]) {
    const result = await router.route(input)
    assert.equal(result.mode, expected)
    assert.ok(result.reason.startsWith(`GLiClass suggests ${expected}.`))
  }
  const policy = JSON.parse(
    await readFile(
      new URL('./benchmarks/workspace-selection-capability-cases.json', import.meta.url),
      'utf8',
    ),
  )
  for (const text of ['Could Opus handle this bug fix?', 'Could you use Opus to fix this bug?']) {
    const entry = policy.cases.find((entry) => entry.text === text)
    assert.ok(entry, `Missing policy reference: ${text}`)
    const result = await router.route(text, { catalogs: policy.catalogs })
    assert.equal(result.mode, 'thread')
    assert.equal(result.selections.model, entry.expected.model)
  }
} finally {
  await router.dispose()
}
const missing = new WorkspaceRouter(
  () =>
    new Worker(
      new URL('../packages/runtime/dist/agents/tasks/workspace-router-worker.js', import.meta.url),
      { workerData: { directory: `${directory}/missing` } },
    ),
)
try {
  const result = await missing.route('pnpm test')
  assert.equal(result.mode, 'thread')
  assert.match(result.reason, /review/)
} finally {
  await missing.dispose()
}
console.log(
  `Bundled model and offline worker verified in ${Math.round(performance.now() - started)}ms`,
)
