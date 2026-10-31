import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'packages/protocol/src/conversation/presentation/rich-markdown.ts'
const refIndex = process.argv.indexOf('--baseline-ref')
const ref = refIndex < 0 ? undefined : process.argv[refIndex + 1]
if (refIndex >= 0 && !ref) throw new Error('--baseline-ref requires a Git reference')

async function load(version) {
  const source = version
    ? execFileSync('git', ['show', `${version}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(root + path, 'utf8')
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: root + 'packages/protocol/src/conversation/presentation',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${version ?? 'checkout'}`
  )
}

const citation = ':codex-file-citation{path="src/app.ts" line_range_start="4"}'
const chunk = `Text with [external link](https://example.com/a) and ${citation}.\n\n[local file](src/app.ts)\n\n`
const workloads = [
  ['links and citations', chunk.repeat(300)],
  ['single long line of links', '[link](https://example.com/a) '.repeat(3000)],
  ['many citations', `${citation} `.repeat(1500)],
  [
    'incomplete streamed markdown',
    (chunk.repeat(60) + '```\n' + citation + '\n[unfinished](https://example.com/').repeat(3),
  ],
]
const implementations = ref
  ? [
      [ref, await load(ref)],
      ['checkout', await load()],
    ]
  : [['checkout', await load()]]
if (implementations.length === 2) {
  const baseline = implementations[0][1]
  const current = implementations[1][1]
  const fixtures = [
    `Before ${citation} after\n\n[file](src/a.ts)\n\n\`\`\`\n${citation}\n\`\`\``,
    `[${citation}](https://example.com)\n\n[ref][image]\n\n[image]: image.png`,
    `[one](a.png) [two](b.png)\r\n[three](c.png)\n\n${citation}`,
    `:codex-file-citation[${citation}]{path="outer.ts"}`,
    `\uE200visualize\uE202{"path":"/tmp/demo.html"}\uE201\n\n${citation}`,
    '::artifact-template{artifact_kind="site" display_name="Site" skill_name="artifact-template-site" skill_directory="/tmp/site"}',
  ]
  for (const fixture of fixtures)
    for (let length = 0; length <= fixture.length; length++) {
      const text = fixture.slice(0, length)
      for (const localFiles of [true, false])
        assert.deepEqual(
          current.richMarkdown(text, localFiles),
          baseline.richMarkdown(text, localFiles),
        )
      assert.equal(current.renderFileCitations(text), baseline.renderFileCitations(text))
    }
  console.log('Streaming-prefix equivalence passed for links, code, citations and directives.')
}
for (const [name, text] of workloads) {
  let expected
  for (const [version, impl] of implementations) {
    const output = impl.richMarkdown(text)
    if (expected) assert.deepEqual(output, expected)
    else expected = output
    const samples = []
    for (let index = 0; index < 8; index++) {
      const start = performance.now()
      impl.richMarkdown(text)
      if (index > 0) samples.push(performance.now() - start)
    }
    samples.sort((left, right) => left - right)
    console.log(
      JSON.stringify({
        version,
        workload: name,
        characters: text.length,
        parts: output.length,
        medianMs: Number(samples[3].toFixed(2)),
      }),
    )
  }
}
