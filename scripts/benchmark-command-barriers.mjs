import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Effect } from 'effect'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'packages/studio-core/src/runtime/synchronization.ts'
const refIndex = process.argv.indexOf('--baseline-ref')
const ref = refIndex < 0 ? undefined : process.argv[refIndex + 1]
if (refIndex >= 0 && !ref) throw new Error('--baseline-ref requires a Git reference')
const require = createRequire(root + 'packages/studio-core/package.json')

async function load(version) {
  const source = version
    ? execFileSync('git', ['show', `${version}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(root + path, 'utf8')
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: root + 'packages/studio-core/src/runtime',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    packages: 'external',
    format: 'cjs',
    write: false,
    plugins: [
      {
        name: 'benchmark-dependencies',
        setup(builder) {
          builder.onResolve(
            { filter: /^(?:effect|@dovo\/protocol|@dovo\/client-runtime)$/ },
            ({ path }) => ({
              path: require.resolve(path),
              external: true,
            }),
          )
        },
      },
    ],
  })
  const directory = await mkdtemp(join(tmpdir(), 'dovo-command-benchmark-'))
  try {
    const output = join(directory, 'benchmark.cjs')
    await writeFile(output, result.outputFiles[0].text)
    return (await import(pathToFileURL(output).href)).default.WorkspaceSynchronization
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// The first unrelated edit is already on the wire. Nine other threads have saved edits,
// with the action's own thread last. No shared setting depends on that prefix.
for (const version of [...(ref ? [ref] : []), undefined]) {
  const Synchronization = await load(version)
  let started
  const first = new Promise((resolve) => {
    started = resolve
  })
  let sent = 0
  const sync = new Synchronization(
    () => {},
    async () => {
      sent++
      started()
      await new Promise((resolve) => setTimeout(resolve, 150))
    },
  )
  sync.bind({ address: 'http://benchmark.invalid', token: 'benchmark-only' })
  sync.enqueue(
    Array.from({ length: 10 }, (_, index) => ({
      collection: 'tasks',
      id: `thread-${index}`,
      changes: {},
    })),
  )
  const start = performance.now()
  const all = sync.flush()
  await first
  if (sync.flushTaskEffect) await Effect.runPromise(sync.flushTaskEffect('thread-9'))
  else await all
  console.log(
    JSON.stringify({
      version: version ?? 'checkout',
      simulatedRequestMs: 150,
      actionWaitMs: Math.round(performance.now() - start),
      sentAtRelease: sent,
    }),
  )
  await all
}
