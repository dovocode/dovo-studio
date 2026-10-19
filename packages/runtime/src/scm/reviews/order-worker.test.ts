/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ReviewGroup } from '@dovo/protocol'
import { ReviewAnalyzer, runReviewWorker } from './order'
import { reviewAnalysisMaxBytes } from './order-input'

const directories: string[] = []
async function fixture(source: string, extension = 'mjs') {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-review-parser-'))
  directories.push(directory)
  const path = join(directory, `worker.${extension}`)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(path, source)
  return pathToFileURL(path)
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

const files = [
  { path: 'src/a.ts', after: "import {b} from './b'; b()" },
  { path: 'src/b.ts', after: 'export function b() {}' },
]
const fallback: ReviewGroup[] = [{ label: 'src', paths: ['src/a.ts', 'src/b.ts'], basis: 'folder' }]
const grouped: ReviewGroup[] = [
  { label: 'src/b.ts', paths: ['src/b.ts', 'src/a.ts'], basis: 'ast' },
]

it('contains a native parser crash, serves folder groups and continues the next queued review', async () => {
  const entry = await fixture("process.kill(process.pid, 'SIGKILL')")
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let calls = 0
  const analyzer = new ReviewAnalyzer((sources, modules, options) =>
    runReviewWorker(sources, modules, ++calls === 1 ? { ...options, entry } : options),
  )
  expect(await Promise.all([analyzer.analyze(files), analyzer.analyze(files)])).toEqual([
    fallback,
    grouped,
  ])
  expect(warning).toHaveBeenCalledOnce()
})

it('kills a stalled parser at its deadline and keeps the runtime available', async () => {
  const entry = await fixture('process.stdin.resume(); setInterval(() => {}, 1000)')
  await expect(runReviewWorker(files, [], { entry, timeoutMs: 200 })).rejects.toThrow(
    'Review parser exited',
  )
  expect(await runReviewWorker(files, [])).toEqual(grouped)
})

it('handles early parser exit while a large stdin write is still pending', async () => {
  const entry = await fixture('process.exit(1)')
  await expect(
    runReviewWorker([{ path: 'a.ts', after: 'x'.repeat(2 * 1024 * 1024) }], [], { entry }),
  ).rejects.toThrow('Review parser exited')
})

it.each([
  'process.stdout.write("invalid json")',
  'process.stdout.write(JSON.stringify([{label:"wrong", paths:["other.ts"], basis:"ast"}]))',
  'process.stdout.write("[]")',
  'process.stdout.write("x".repeat(3 * 1024 * 1024))',
])(
  'rejects invalid, incomplete or excessive parser output without losing files (%s)',
  async (source) => {
    const entry = await fixture(source)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const analyzer = new ReviewAnalyzer((sources, modules) =>
      runReviewWorker(sources, modules, { entry }),
    )
    expect(await analyzer.analyze(files)).toEqual(fallback)
  },
)

it('bounds concurrent reviews and falls back immediately when the queue is full', async () => {
  let release: (groups: ReviewGroup[]) => void = () => {}
  const first = new Promise<ReviewGroup[]>((resolve) => {
    release = resolve
  })
  const run = vi
    .fn<typeof runReviewWorker>()
    .mockImplementationOnce(() => first)
    .mockResolvedValue(grouped)
  const analyzer = new ReviewAnalyzer(run)
  const pending = Array.from({ length: 8 }, () => analyzer.analyze(files))
  await Promise.resolve()
  expect(run).toHaveBeenCalledOnce()
  expect(await analyzer.analyze(files)).toEqual(fallback)
  release(grouped)
  expect(await Promise.all(pending)).toEqual(Array.from({ length: 8 }, () => grouped))
  expect(run).toHaveBeenCalledTimes(8)
  expect(await analyzer.analyze(files)).toEqual(grouped)
})

it('includes queue time in the review deadline instead of accumulating parser timeouts', async () => {
  const now = Date.now()
  let release: (groups: ReviewGroup[]) => void = () => {}
  const first = new Promise<ReviewGroup[]>((resolve) => {
    release = resolve
  })
  const run = vi.fn<typeof runReviewWorker>().mockReturnValue(first)
  const analyzer = new ReviewAnalyzer(run)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const pending = [analyzer.analyze(files), analyzer.analyze(files)]
  await Promise.resolve()
  clock.mockReturnValue(now + 16_000)
  release(grouped)
  expect(await Promise.all(pending)).toEqual([grouped, fallback])
  expect(run).toHaveBeenCalledOnce()
})

it('bounds review input before starting a worker and keeps every file in the fallback', async () => {
  const run = vi.fn<typeof runReviewWorker>().mockResolvedValue(grouped)
  const analyzer = new ReviewAnalyzer(run)
  expect(
    await analyzer.analyze([{ path: 'large.ts', after: 'x'.repeat(reviewAnalysisMaxBytes) }]),
  ).toEqual([{ label: 'Root files', paths: ['large.ts'], basis: 'folder' }])
  const many = Array.from({ length: 1001 }, (_, index) => ({ path: `src/${index}.ts` }))
  expect((await analyzer.analyze(many)).flatMap((group) => group.paths)).toHaveLength(1001)
  expect(run).not.toHaveBeenCalled()
})

it('groups repeated Swift sources in an isolated process without runaway compiler memory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-review-swift-'))
  directories.push(directory)
  const usage = join(directory, 'usage.json')
  const worker = new URL('./order-worker.ts', import.meta.url)
  const entry = await fixture(
    `
    import { writeFileSync } from 'node:fs'
    process.on('exit', () => writeFileSync(${JSON.stringify(usage)}, JSON.stringify(process.resourceUsage())))
    await import(${JSON.stringify(worker.href)})
  `,
    'ts',
  )
  const sources = [
    { path: 'Sources/App/User.swift', after: 'import Foundation\nstruct User { let id: Int }' },
    ...Array.from({ length: 40 }, (_, index) => ({
      path: `Sources/App/View${index}.swift`,
      after: `struct View${index} { let user: User }`,
    })),
  ]
  const result = await runReviewWorker(sources, [], { entry })
  expect(result).toHaveLength(1)
  expect(result[0].basis).toBe('ast')
  expect(result[0].paths[0]).toBe('Sources/App/User.swift')
  expect(result[0].paths).toHaveLength(sources.length)
  const stats: unknown = JSON.parse(await readFile(usage, 'utf8'))
  expect(stats).toMatchObject({ maxRSS: expect.any(Number) })
  if (
    !stats ||
    typeof stats !== 'object' ||
    !('maxRSS' in stats) ||
    typeof stats.maxRSS !== 'number'
  )
    throw new Error('Missing parser memory measurement')
  // V8's optimizing Swift compilation exceeded 768 MiB almost immediately.
  expect(stats.maxRSS * 1024).toBeLessThan(384 * 1024 * 1024)
}, 15_000)
