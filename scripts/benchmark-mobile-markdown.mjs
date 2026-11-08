import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'apps/mobile/src/ui/content/markdown-parts.ts'
const presentation = root + 'packages/protocol/src/conversation/presentation/'
const refIndex = process.argv.indexOf('--baseline-ref')
const ref = refIndex < 0 ? undefined : process.argv[refIndex + 1]
if (refIndex >= 0 && !ref) throw new Error('--baseline-ref requires a Git reference')

// Compare only the native split pipeline; shared rich Markdown uses the current code in both.
async function load(version) {
  const source = version
    ? execFileSync('git', ['show', `${version}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(root + path, 'utf8')
  const built = await build({
    stdin: { contents: source, resolveDir: root + 'apps/mobile/src/ui/content', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'protocol-presentation',
        setup(builder) {
          builder.onResolve({ filter: /^@dovo\/protocol$/ }, () => ({
            path: 'protocol',
            namespace: 'presentation',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'presentation' }, () => ({
            contents: `export * from '${presentation}rich-markdown.ts';export * from '${presentation}markdown-parts-cache.ts';`,
            resolveDir: root,
            loader: 'ts',
          }))
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
  )
}

const implementations = ref
  ? [
      [ref, await load(ref)],
      ['checkout', await load()],
    ]
  : [['checkout', await load()]]
const sections = [
  'Text with **bold**, `code`, and [docs](https://example.com).',
  '```mermaid\ngraph TD; A-->B\n```',
  '~~~MERMAID\r\ngraph LR; B-->C\r\n~~~~',
  '``` mermaid\ngraph TD; A-->B\n```',
  '````tsx\nconst x = `\n```mermaid\nA-->B\n```\n`\n````',
  '- list\n\n  ```mermaid\n  graph TD; A-->B\n  ```',
  '> ```ts\n> const n = 1\n> ```',
  '~~~ts\nconst n = 1\n~~~',
  '```\n![literal](image.png)\n```',
  '[![image](https://example.com/image.png)](https://example.com)',
  '![reference][image]\n\n[image]: https://example.com/image.png',
  ':codex-file-citation{path="src/app.ts" line_range_start="4"}',
  '[Report](reports/q3.pdf)',
  '![![inner](inner.png)][outer]\n\n```ts\nx\n```\n\n[outer]: outer.png',
  '[![image](image.png)][outer]\n\n~~~mermaid\ngraph TD\n~~~\n\n[outer]: /file.ts',
  '[image]: before.png\n\n```mermaid\ngraph TD\n```\n\n![image]',
  '![image]\n\n```ts\nx\n```\n\n[image]: after.png',
  '> [image]: nested.png\n\n```ts\nx\n```\n\n![![inner](inner.png)][image]',
  '![image][ref]\n\n[ref]: first.png\n\n```ts\nx\n```\n\n[ref]: last.png',
  '- list\n\n  ![image](image.png)\n\n```mermaid\ngraph TD\n```\n\n  ![next](next.png)',
  '<div>\n\n```mermaid\ngraph TD\n```\n\n![image](image.png)\n</div>',
  '```mermaid\ngraph TD\n```\n![a](a.png)\n~~~ts\nx\n~~~\n![b](b.png)',
]
if (ref) {
  let comparisons = 0
  for (const first of sections)
    for (const second of sections) {
      const fixture = `${first}\n\n${second}\n\nAfter 👋`
      for (let end = 0; end <= fixture.length; end++)
        for (const localFiles of [true, false]) {
          const text = fixture.slice(0, end)
          assert.deepEqual(
            implementations[1][1].splitMarkdownParts(text, localFiles),
            implementations[0][1].splitMarkdownParts(text, localFiles),
            `${JSON.stringify(text)}, localFiles=${localFiles}`,
          )
          comparisons++
        }
    }
  console.log(`Native Markdown exact-output comparisons: ${comparisons} passed.`)
}

const prose = 'Read [the documentation](https://example.com) for more details.\n\n'
const mixed = `${prose.repeat(20)}\n${sections[1]}\n\n${sections[7]}\n\n${sections[9]}\n\n`
for (const [workload, text] of [
  ['inline prose', prose.repeat(650)],
  ['mixed diagrams, code and images', mixed.repeat(24)],
  ['mixed content with citations', `${mixed}\n\n${sections[11]}\n\n`.repeat(24)],
]) {
  let expected
  for (const [version, impl] of implementations) {
    const parts = impl.splitMarkdownParts(text, true)
    if (expected) assert.deepEqual(parts, expected)
    expected = parts
    const samples = []
    for (let index = 0; index < 16; index++) {
      const start = performance.now()
      // Streaming bypasses the completed-message cache.
      impl.markdownParts(text + index, true, true)
      if (index >= 3) samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        version,
        workload,
        characters: text.length,
        parts: parts.length,
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
      }),
    )
  }
}
