// Research inference only. Suggestions never execute commands or open pages.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export async function loadWorkspaceDecisionModel(directory) {
  const config = JSON.parse(await readFile(join(directory, 'routing.json'), 'utf8'))
  const { Tokenizer } = await import(pathToFileURL(join(directory, 'tokenizer.mjs')).href)
  const tokenizer = new Tokenizer(
    JSON.parse(await readFile(join(directory, 'tokenizer.json'), 'utf8')),
    JSON.parse(await readFile(join(directory, 'tokenizer_config.json'), 'utf8')),
  )
  const require = createRequire(new URL('../../packages/runtime/package.json', import.meta.url))
  const { InferenceSession, Tensor } = require('onnxruntime-node')
  const session = await InferenceSession.create(join(directory, 'model.onnx'), {
    executionProviders: ['cpu'],
    intraOpNumThreads: 4,
    interOpNumThreads: 1,
    logSeverityLevel: 3,
  })
  const routeChoices = config.labels.map((id, i) => ({ id, label: config.labelDescriptions[i] }))
  return {
    async choose(task, input, choices) {
      assert.ok(typeof input === 'string' && input.trim(), 'Input is required')
      assert.ok(config.tasks[task], `Unsupported classification task: ${task}`)
      assert.ok(
        Array.isArray(choices) && choices.length >= 2 && choices.length <= config.maxOptions,
      )
      assert.ok(
        choices.every(
          (choice) => typeof choice.id === 'string' && typeof choice.label === 'string',
        ),
      )
      assert.equal(
        new Set(choices.map((choice) => choice.id)).size,
        choices.length,
        'Duplicate choice IDs',
      )
      const prefix =
        choices.map((choice) => `<<LABEL>>${choice.label}`).join('') +
        '<<SEP>>' +
        config.tasks[task].instruction
      const ids = tokenizer.encode(prefix + input).ids
      assert.ok(
        ids.length <= config.maxLength,
        'Classifier token limit exceeded; do not truncate choices or input',
      )
      const output = await session.run({
        input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [
          1,
          ids.length,
        ]),
      })
      assert.equal(output.logits.data.length, config.maxOptions)
      const logits = Array.from(output.logits.data, Number).slice(0, choices.length)
      assert.ok(logits.every(Number.isFinite))
      return { id: choices[logits.indexOf(Math.max(...logits))].id, logits }
    },
    async propose(input, catalogs) {
      const { id: mode } = await this.choose('destination', input, routeChoices)
      const fields =
        mode === 'browser'
          ? ['runtime', 'profile']
          : mode === 'terminal'
            ? ['runtime', 'project']
            : ['runtime', 'model', 'project']
      const selections = {}
      for (const field of fields) {
        assert.ok(catalogs[field], `Supply available ${field} choices`)
        selections[field] = (await this.choose(field, input, catalogs[field])).id
      }
      return { mode, selections }
    },
    async dispose() {
      await session.release()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      cases: { type: 'string' },
      text: { type: 'string' },
      output: { type: 'string' },
    },
  })
  assert.ok(values.directory && values.cases, '--directory and --cases required')
  const corpus = JSON.parse(await readFile(resolve(values.cases), 'utf8'))
  const model = await loadWorkspaceDecisionModel(resolve(values.directory))
  try {
    if (values.text) {
      console.log(JSON.stringify(await model.propose(values.text, corpus.catalogs), null, 2))
    } else {
      const results = []
      for (const row of corpus.cases) {
        const started = performance.now()
        const actual = await model.propose(row.text, corpus.catalogs)
        const expected = row.expected
        const correct =
          actual.mode === expected.destination &&
          Object.entries(expected).every(
            ([task, id]) => task === 'destination' || actual.selections[task] === id,
          )
        results.push({ text: row.text, expected, actual, correct, ms: performance.now() - started })
      }
      const report = {
        correct: results.filter((r) => r.correct).length,
        total: results.length,
        results,
      }
      if (values.output)
        await writeFile(resolve(values.output), `${JSON.stringify(report, null, 2)}\n`)
      console.log(
        JSON.stringify(
          {
            correct: report.correct,
            total: report.total,
            mistakes: results.filter((r) => !r.correct),
          },
          null,
          2,
        ),
      )
    }
  } finally {
    await model.dispose()
  }
}
