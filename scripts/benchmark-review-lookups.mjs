// Isolated review bookkeeping CPU, not diff highlighting or end-to-end browser latency.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const path = 'packages/protocol/src/scm/review.ts'
const ref = process.argv[2] ?? '4cd3f3b5'
async function load(baseline) {
  const text = baseline
    ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
    : await readFile(root + path, 'utf8')
  const result = await build({
    stdin: {
      contents: text,
      resolveDir: root + 'packages/protocol/src/scm',
      sourcefile: 'review.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
}
const [before, after] = await Promise.all([load(true), load(false)])
const count = 2000
const files = Array.from({ length: count }, (_, i) => ({
  path: `src/new-${i}.ts`,
  ...(i % 3 === 0 ? { previousPath: `src/old-${i}.ts` } : {}),
  status: i % 3 === 0 ? 'renamed' : 'modified',
  additions: 1,
  deletions: 1,
}))
const progress = {
  files: files.map((file, i) => ({
    path: file.path,
    fingerprint: String(i).padStart(64, '0'),
    version: i,
    viewed: i % 2 === 0,
  })),
  groups: [],
}
const comments = Array.from({ length: 10000 }, (_, i) => {
  const file = files[(i * 17) % count]
  return {
    id: String(i),
    kind: i % 11 === 0 ? 'review' : 'inline',
    path: i % 2 ? (file.previousPath ?? file.path) : file.path,
    author: 'reviewer',
    body: 'Review comment',
    date: '',
    url: '',
  }
})
const lookupBefore = () =>
  files.map((file, i) => before.reviewFileState(progress, file.path, String(i).padStart(64, '0')))
const lookupAfter = () => {
  const lookup = after.createReviewFileLookup(progress)
  return files.map((file, i) => lookup(file.path, String(i).padStart(64, '0')))
}
const commentsBefore = () => {
  const byPath = new Map()
  for (const comment of comments) {
    if (comment.kind !== 'inline' || !comment.path) continue
    const rows = byPath.get(comment.path) ?? []
    rows.push(comment)
    byPath.set(comment.path, rows)
  }
  return files.map((file) =>
    file.previousPath
      ? comments.filter(
          (comment) =>
            comment.kind === 'inline' &&
            (comment.path === file.path || comment.path === file.previousPath),
        )
      : (byPath.get(file.path) ?? []),
  )
}
const commentsAfter = () => {
  const grouped = after.pullCommentsByFile(files, comments)
  return files.map((file) => grouped.get(file.path) ?? [])
}
assert.deepEqual(lookupAfter(), lookupBefore())
assert.deepEqual(commentsAfter(), commentsBefore())
function median(run) {
  run()
  const samples = []
  for (let i = 0; i < 11; i++) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  return +samples.sort((a, b) => a - b)[5].toFixed(3)
}
console.log(
  JSON.stringify(
    {
      baseline: ref,
      files: count,
      comments: comments.length,
      reviewState: { beforeMs: median(lookupBefore), afterMs: median(lookupAfter) },
      inlineComments: { beforeMs: median(commentsBefore), afterMs: median(commentsAfter) },
      note: 'Includes index construction on every sample; one third of files are renamed. Exact results/order asserted.',
    },
    null,
    2,
  ),
)
