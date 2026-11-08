// Research export verification with the app's ONNX Runtime and bundled
// Tokenizers.js. Never executes a command or opens an input URL.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { platform, arch } from 'node:os'

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    reference: { type: 'string' },
    output: { type: 'string' },
  },
})
assert.ok(values.directory && values.reference && values.output)
const directory = resolve(values.directory)
const config = JSON.parse(await readFile(join(directory, 'routing.json'), 'utf8'))
const reference = JSON.parse(await readFile(resolve(values.reference), 'utf8'))
// Standalone tokenizer has no ORT dependency, so it cannot load a second native
// ONNX library into the application's process.
const { Tokenizer } = await import(pathToFileURL(join(directory, 'tokenizer.mjs')).href)
const tokenizerConfig = JSON.parse(await readFile(join(directory, 'tokenizer_config.json'), 'utf8'))
assert.equal(tokenizerConfig.tokenizer_class, 'DebertaV2Tokenizer')
const tokenizer = new Tokenizer(
  JSON.parse(await readFile(join(directory, 'tokenizer.json'), 'utf8')),
  tokenizerConfig,
)
const require = createRequire(new URL('../../packages/runtime/package.json', import.meta.url))
const { InferenceSession, Tensor, env: ortEnv } = require('onnxruntime-node')
const model = await InferenceSession.create(join(directory, 'model.onnx'), {
  executionProviders: ['cpu'],
  intraOpNumThreads: 4,
  interOpNumThreads: 1,
  logSeverityLevel: 3,
})
const observations = []
try {
  assert.deepEqual(model.inputNames, ['input_ids', 'attention_mask'])
  assert.deepEqual(model.outputNames, ['logits'])
  for (const row of reference) {
    const started = performance.now()
    const choices =
      row.options ?? config.labels.map((id, i) => ({ id, label: config.labelDescriptions[i] }))
    const instruction = config.tasks?.[row.task ?? 'destination']?.instruction ?? config.instruction
    const prefix =
      choices.map((choice) => `<<LABEL>>${choice.label}`).join('') + '<<SEP>>' + instruction
    const ids = tokenizer.encode(prefix + row.input).ids
    assert.deepEqual(ids, row.ids, `Tokenizer mismatch: ${row.input}`)
    assert.ok(ids.length <= config.maxLength)
    const output = await model.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
    })
    const raw = Array.from(output.logits.data, Number)
    assert.equal(raw.length, config.maxOptions ?? 3)
    const logits = raw.slice(0, choices.length)
    assert.ok(logits.every(Number.isFinite))
    const actual = choices[logits.indexOf(Math.max(...logits))].id
    observations.push({
      input: row.input,
      task: row.task ?? 'destination',
      expected: row.expected,
      python: row.actual,
      actual,
      ms: performance.now() - started,
      maxLogitDifference: Math.max(...logits.map((x, i) => Math.abs(x - row.logits[i]))),
    })
  }
} finally {
  await model.release()
}
const changed = observations.filter((r) => r.python !== r.actual)
const timing = observations
  .slice(3)
  .map((r) => r.ms)
  .sort((a, b) => a - b)
const result = {
  onnxruntime: ortEnv.versions,
  platform: platform(),
  architecture: arch(),
  peakRssKiB: process.resourceUsage().maxRSS,
  cases: observations.length,
  correct: observations.filter((r) => r.actual === r.expected).length,
  tokenizerMismatches: 0,
  changedPredictions: changed,
  medianMs: timing[Math.floor(timing.length / 2)],
  p95Ms: timing[Math.ceil(timing.length * 0.95) - 1],
  observations,
}
await writeFile(resolve(values.output), `${JSON.stringify(result, null, 2)}\n`)
console.log(
  JSON.stringify({
    ...result,
    changedPredictions: changed.length,
    observations: undefined,
  }),
)
assert.equal(changed.length, 0, 'Node export changes Python predictions; inspect the saved report')
