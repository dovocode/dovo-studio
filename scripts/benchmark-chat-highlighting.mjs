// Measures the production chat adapter, not rendering or native-device latency.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'packages/studio-ui/src/pierre-code-plugin.ts'
const index = process.argv.indexOf('--baseline-ref')
const baseline = index >= 0 ? process.argv[index + 1] : undefined
if (index >= 0 && !baseline) throw new Error('--baseline-ref requires a Git reference')
const corpus = await readFile(root + 'packages/protocol/src/tasks/task-priority.ts', 'utf8')
const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
async function load(ref) {
  const source = ref
    ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(root + path, 'utf8')
  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `export {createPierreCodePlugin} from './${path}';
        export {studioSyntaxTheme} from './packages/studio-core/src/themes.ts';`,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'chat-adapter-version',
        setup(builder) {
          builder.onLoad({ filter: /pierre-code-plugin\.ts$/ }, () => ({
            contents: source,
            loader: 'ts',
          }))
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  )
}
const implementations = baseline ? [baseline, undefined] : [undefined]
for (const ref of implementations) {
  const { createPierreCodePlugin, studioSyntaxTheme } = await load(ref)
  const themes = [studioSyntaxTheme('dovo', 'light'), studioSyntaxTheme('dovo', 'dark')]
  const highlight = (plugin, code) =>
    new Promise((resolve) => {
      const result = plugin.highlight({ code, language: 'typescript', themes }, resolve)
      if (result) resolve(result)
    })
  const plugin = createPierreCodePlugin(themes)
  // Warm WASM and the lexer before measuring either implementation.
  await highlight(plugin, corpus)
  const repeated = [],
    unique = [],
    reopened = []
  for (let round = 0; round < 60; round++) {
    for (const [samples, instance, code] of [
      [repeated, plugin, corpus],
      [unique, plugin, corpus + `\n// unique ${round}`],
      [reopened, createPierreCodePlugin(themes), corpus],
    ]) {
      const start = performance.now()
      const result = await highlight(instance, code)
      samples.push(performance.now() - start)
      assert.equal(
        result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n'),
        code,
      )
    }
  }
  console.log(
    JSON.stringify({
      version: ref ?? 'checkout',
      node: process.version,
      sourceCharacters: corpus.length,
      repeatedMedianMs: median(repeated),
      reopenedMedianMs: median(reopened),
      uniqueMedianMs: median(unique),
      note: 'Warm Node production adapter; excludes React, transport and cold initialization.',
    }),
  )
}
