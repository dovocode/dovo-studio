import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Retained-heap measurements need explicit collection.
if (typeof globalThis.gc !== 'function') {
  execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
  })
  process.exit(0)
}

const root = fileURLToPath(new URL('../', import.meta.url))
const presentation = root + 'packages/protocol/src/conversation/presentation/'
const result = await build({
  stdin: {
    contents: [
      `export { richMarkdown } from ${JSON.stringify(presentation + 'rich-markdown.ts')}`,
      `export { cachedMarkdownParts } from ${JSON.stringify(presentation + 'markdown-parts-cache.ts')}`,
      `export { splitMarkdownParts } from ${JSON.stringify(root + 'apps/mobile/src/ui/content/markdown-parts.ts')}`,
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      // Only the two pure presentation modules are needed, not the full protocol barrel.
      name: 'protocol-presentation',
      setup(context) {
        context.onResolve({ filter: /^@dovo\/protocol$/ }, () => ({
          path: 'protocol',
          namespace: 'protocol-presentation',
        }))
        context.onLoad({ filter: /.*/, namespace: 'protocol-presentation' }, () => ({
          contents: [
            `export * from ${JSON.stringify(presentation + 'rich-markdown.ts')}`,
            `export * from ${JSON.stringify(presentation + 'markdown-parts-cache.ts')}`,
          ].join('\n'),
          resolveDir: root,
          loader: 'ts',
        }))
      },
    },
  ],
})
const { richMarkdown, cachedMarkdownParts, splitMarkdownParts } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
)

const citation = ':codex-file-citation{path="src/app.ts" line_range_start="4"}'
function message(index) {
  const sections = [
    `## Step ${index}\n\nUpdated the **renderer** and checked [docs](https://example.com/${index}) and ${citation}.`,
    `[Report ${index}](reports/report-${index}.pdf)`,
    '```ts\n' + `export const value${index} = ${index}\n`.repeat(4 + (index % 12)) + '```',
    '- item one with `code`\n- item two with [link](src/file-' + index + '.ts)\n- [x] done',
    index % 7 === 0 ? '```mermaid\ngraph TD; A-->B; B-->C\n```' : '',
    index % 5 === 0 ? `![Screenshot ${index}](https://example.com/shot-${index}.png)` : '',
    'Some longer prose explaining the change in detail. '.repeat(4 + (index % 30)),
  ]
  return sections.filter(Boolean).join('\n\n')
}
const thread = Array.from({ length: 120 }, (_, index) => message(index))
const characters = thread.reduce((sum, text) => sum + text.length, 0)
const passes = 20

function heap() {
  for (let index = 0; index < 4; index++) globalThis.gc()
  return process.memoryUsage().heapUsed
}
/** Heap held only by the returned cache: measured with it, then again after dropping it. */
function retainedKiB(fill) {
  const caches = [fill()]
  const withCache = heap()
  caches.length = 0
  return Math.round((withCache - heap()) / 1024)
}
function time(run) {
  const start = performance.now()
  run()
  return performance.now() - start
}

for (const [name, split] of [
  ['desktop richMarkdown', richMarkdown],
  ['native split parts', splitMarkdownParts],
]) {
  const localFiles = true
  for (const text of thread)
    assert.deepEqual(cachedMarkdownParts(split)(text, localFiles), split(text, localFiles))

  // Remount workload: every pass re-renders each completed message from a fresh mount.
  let sink = 0
  const firstPassMs = time(() => {
    for (const text of thread) sink += split(text, localFiles).length
  })
  const uncachedMs = time(() => {
    for (let pass = 0; pass < passes; pass++)
      for (const text of thread) sink += split(text, localFiles).length
  })
  const parts = cachedMarkdownParts(split)
  const cachedMs = time(() => {
    for (let pass = 0; pass < passes; pass++)
      for (const text of thread) sink += parts(text, localFiles).length
  })
  for (const text of thread) assert.deepEqual(parts(text, localFiles), split(text, localFiles))
  const counted = { calls: 0 }
  const counting = cachedMarkdownParts((text, files) => (counted.calls++, split(text, files)))
  for (let pass = 0; pass < passes; pass++) for (const text of thread) counting(text, localFiles)

  console.log(
    JSON.stringify({
      workload: name,
      messages: thread.length,
      characters,
      passes,
      firstPassMs: Number(firstPassMs.toFixed(1)),
      uncachedMs: Number(uncachedMs.toFixed(1)),
      cachedMs: Number(cachedMs.toFixed(1)),
      splitCallsCached: counted.calls,
      splitCallsUncached: passes * thread.length,
      // Message state already owns the texts; the cache adds only parts and entries.
      retainedKiBWithLiveMessages: retainedKiB(() => {
        const cache = cachedMarkdownParts(split)
        for (const text of thread) cache(text, localFiles)
        return cache
      }),
      // Worst case: the cache is the only owner of every source text.
      retainedKiBSoleOwner: retainedKiB(() => {
        const cache = cachedMarkdownParts(split)
        for (let index = 0; index < thread.length; index++) cache(message(index) + ' ', localFiles)
        return cache
      }),
      // 1,500 messages (~2.3M characters) through the default 2 MiB estimated budget.
      retainedKiBLargeThreadSoleOwner: retainedKiB(() => {
        const cache = cachedMarkdownParts(split)
        for (let index = 0; index < 1500; index++) cache(message(index + 1000), localFiles)
        return cache
      }),
      // Streaming prefixes of ten messages, every 64 characters: split but never retained.
      retainedKiBStreamingPrefixes: retainedKiB(() => {
        const cache = cachedMarkdownParts(split)
        const streamed = thread.slice(0, 10).join('\n\n')
        for (let end = 64; end <= streamed.length; end += 64)
          cache(streamed.slice(0, end), localFiles, true)
        return cache
      }),
      sink: sink > 0,
    }),
  )
}
