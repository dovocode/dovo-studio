import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

// Run from the checkout. Fresh processes separate backend initialization and grammar caches.
const corpus = [
  ['packages/protocol/src/runtime/connection/live-sync.ts', 'typescript'],
  ['packages/extension-scm/src/pulls/detail/detail.tsx', 'tsx'],
  ['packages/studio-ui/src/styles.css', 'css'],
  ['package.json', 'json'],
].map(([path, lang]) => ({ path, lang, code: readFileSync(path, 'utf8') }))
const median = (times) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
if (process.argv[2] === '--backend') {
  const backend = process.argv[3]
  const { createHighlighter } = await import(
    pathToFileURL(resolve('packages/studio-ui/node_modules/@pierre/diffs/dist/index.js'))
  )
  const start = performance.now()
  const highlighter = await createHighlighter(backend)
  await highlighter.loadLanguages(corpus.map(({ lang }) => lang))
  await highlighter.themeResolver.resolveThemes(['pierre-dark'])
  const initializationMs = performance.now() - start
  const rounds = []
  for (let round = 0; round < 7; round++) {
    const start = performance.now()
    for (const { code, lang } of corpus) {
      const result = highlighter.codeToTokens(code, { lang, theme: 'pierre-dark' })
      assert.equal(
        result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n'),
        code,
      )
    }
    rounds.push(performance.now() - start)
  }
  highlighter.dispose()
  console.log(
    JSON.stringify({
      backend,
      initializationMs,
      firstPassMs: rounds[0],
      warmMedianMs: median(rounds.slice(1)),
    }),
  )
} else {
  console.log(
    JSON.stringify({
      node: process.version,
      corpus: corpus.map(({ path, code }) => ({ path, characters: code.length })),
    }),
  )
  for (const backend of ['shiki-js', 'shiki-wasm', 'highlights']) {
    const result = spawnSync(process.execPath, [process.argv[1], '--backend', backend], {
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
    process.stdout.write(result.stdout)
  }
  const folder = mkdtempSync(join(tmpdir(), 'dovo-syntax-benchmark-'))
  try {
    const bundle = await build({
      stdin: {
        resolveDir: resolve('apps/mobile'),
        contents: `
        import {createSyntaxHighlighter} from './src/ui/content/syntax-highlighter';
        import {createOnigurumaEngine} from '@shikijs/engine-oniguruma';
        export const prepare = createSyntaxHighlighter(()=>createOnigurumaEngine(import('@shikijs/engine-oniguruma/wasm-inlined')));
      `,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
    })
    const file = join(folder, 'syntax.mjs')
    writeFileSync(file, bundle.outputFiles[0].contents)
    const { prepare } = await import(pathToFileURL(file))
    const tokenize = await prepare(['typescript'], {
      name: 'benchmark',
      type: 'dark',
      fg: '#ffffff',
      bg: '#000000',
      tokenColors: [],
    })
    const code = corpus[0].code
    const start = performance.now()
    const first = tokenize(code, 'typescript')
    const coldMs = performance.now() - start
    const times = []
    for (let round = 0; round < 20; round++) {
      const start = performance.now()
      assert.equal(tokenize(code, 'typescript'), first)
      times.push(performance.now() - start)
    }
    console.log(
      JSON.stringify({
        mobileAlgorithmUsingNodeOniguruma: true,
        firstPassMs: coldMs,
        cachedMedianMs: median(times),
        note: 'Not a native-device latency measurement.',
      }),
    )
  } finally {
    rmSync(folder, { recursive: true })
  }
}
