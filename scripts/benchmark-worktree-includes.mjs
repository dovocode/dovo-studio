import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'packages/runtime/src/scm/git/worktree-include.ts'
const refIndex = process.argv.indexOf('--baseline-ref')
const ref = refIndex < 0 ? undefined : process.argv[refIndex + 1]
if (refIndex >= 0 && !ref) throw new Error('--baseline-ref requires a Git reference')
async function load(version) {
  const source = version
    ? execFileSync('git', ['show', `${version}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(join(root, path), 'utf8')
  const result = await build({
    stdin: { contents: source, resolveDir: dirname(join(root, path)), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(join(root, 'package.json'))});`,
    },
    write: false,
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${version ?? 'checkout'}`
  )
}
const implementations = ref
  ? [
      [ref, await load(ref)],
      ['checkout', await load()],
    ]
  : [['checkout', await load()]]
const directory = await mkdtemp(join(tmpdir(), 'dovo-includes-benchmark-'))
try {
  let nested = directory
  const expected = []
  for (let depth = 0; depth < 24; depth++) {
    nested = join(nested, 'nested')
    await mkdir(nested)
    for (let index = 0; index < 8; index++) {
      const file = join(nested, `file-${index}`)
      await writeFile(file, 'local configuration')
      expected.push(file.slice(directory.length + 1))
    }
  }
  await writeFile(join(directory, '.worktreeinclude'), '**/*\nnested/\nnested/**/*\n')
  for (const [version, implementation] of implementations) {
    const samples = []
    for (let iteration = 0; iteration < 5; iteration++) {
      const start = performance.now()
      const files = await implementation.includedWorktreeFiles(directory)
      samples.push(performance.now() - start)
      assert.deepEqual(files.sort(), [...expected].sort())
    }
    samples.sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        version,
        directories: 24,
        files: expected.length,
        medianMs: Number(samples[2].toFixed(2)),
      }),
    )
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
