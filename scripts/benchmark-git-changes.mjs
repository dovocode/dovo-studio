// Production GitService.changes on a real checkout. Excludes HTTP, sync, hashing and UI.
// Usage: node scripts/benchmark-git-changes.mjs [checkout] [--runs 30] [--baseline-ref HEAD]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const path = join(root, 'packages/runtime/src/scm/git/git.ts')
const baselineIndex = process.argv.indexOf('--baseline-ref')
const baselineRef = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1]
if (baselineIndex >= 0 && !baselineRef) throw new Error('--baseline-ref requires a Git reference')
const runsIndex = process.argv.indexOf('--runs')
const runs = runsIndex < 0 ? 30 : Number(process.argv[runsIndex + 1])
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs requires a positive integer')
const checkout = resolve(
  process.argv
    .slice(2)
    .find(
      (arg, index, args) =>
        !arg.startsWith('--') && !['--runs', '--baseline-ref'].includes(args[index - 1]),
    ) ?? root,
)
const output = await build({
  stdin: {
    contents: baselineRef
      ? execFileSync('git', ['show', `${baselineRef}:packages/runtime/src/scm/git/git.ts`], {
          encoding: 'utf8',
        })
      : await readFile(path, 'utf8'),
    resolveDir: dirname(path),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  external: ['sharp'],
  logLevel: 'error',
  banner: {
    js: `import { createRequire as benchmarkRequire } from 'node:module'; const require = benchmarkRequire(${JSON.stringify(join(root, 'packages/runtime/package.json'))});`,
  },
})
// A file inside the repository lets the external sharp import resolve as in production.
const bundle = join(root, 'packages/runtime/node_modules/.cache/benchmark-git-changes.mjs')
await mkdir(dirname(bundle), { recursive: true })
await writeFile(bundle, output.outputFiles[0].text)
const { GitService } = await import(pathToFileURL(bundle).href)
// The audit hook reports each started Git command once without a result.
let commands = []
const git = new GitService(undefined, (_cwd, args, result) => {
  if (!result) commands.push(args.slice(1).find((arg) => !arg.startsWith('-')) ?? args[0])
})
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
for (let i = 0; i < 5; i++) await git.changes(checkout)
const times = []
let files
for (let i = 0; i < runs; i++) {
  commands = []
  const started = performance.now()
  files = await git.changes(checkout)
  times.push(performance.now() - started)
}
times.sort((a, b) => a - b)
const json = JSON.stringify(files)
const audited = {}
for (const command of commands) audited[command] = (audited[command] ?? 0) + 1
console.log(
  JSON.stringify(
    {
      source: baselineRef ?? 'working tree',
      checkout,
      runs,
      files: files.length,
      embedded: files.filter((file) => !file.preview).length,
      withOldBlob: files.filter((file) => !file.preview && file.before).length,
      responseBytes: Buffer.byteLength(json),
      // Compare this digest across implementations on an unchanged checkout.
      sha256: createHash('sha256').update(json).digest('hex'),
      ms: {
        min: +times[0].toFixed(1),
        median: +quantile(times, 0.5).toFixed(1),
        p95: +quantile(times, 0.95).toFixed(1),
      },
      auditedCommands: audited,
    },
    null,
    2,
  ),
)
