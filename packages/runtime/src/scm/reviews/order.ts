import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decode, reviewProgressSchema, type ReviewGroup } from '@dovo/protocol'
import { processEnvironment } from '../../process.js'
import {
  folderFileGroups,
  reviewAnalysisMaxBytes,
  reviewAnalysisSize,
  type ReviewSource,
  type ReviewModule,
} from './order-input.js'

export type { ReviewSource, ReviewModule } from './order-input.js'

export function runReviewWorker(
  files: ReviewSource[],
  modules: ReviewModule[],
  options: { entry?: URL; timeoutMs?: number } = {},
): Promise<ReviewGroup[]> {
  const entry =
    options.entry ??
    new URL(
      import.meta.url.endsWith('.ts') ? './order-worker.ts' : './order-worker.js',
      import.meta.url,
    )
  const loader = entry.pathname.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      // Swift's generated lexer exhausts native memory in V8's optimizing Wasm compiler.
      // Baseline compilation preserves syntax-based grouping without that compiler path.
      ['--liftoff-only', '--max-old-space-size=128', ...loader, fileURLToPath(entry)],
      {
        env: { ...processEnvironment(), NODE_OPTIONS: '' },
        windowsHide: true,
        timeout: options.timeoutMs ?? 15_000,
        killSignal: 'SIGKILL',
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              'Review parser exited (' + (error.signal ?? error.code ?? 'spawn error') + ')',
            ),
          )
          return
        }
        try {
          const groups = decode(reviewProgressSchema.fields.groups, JSON.parse(stdout))
          const remaining = new Set(files.map((file) => file.path))
          for (const group of groups)
            for (const path of group.paths)
              if (!remaining.delete(path)) throw new Error('Invalid review parser file groups')
          if (remaining.size) throw new Error('Incomplete review parser file groups')
          resolve(groups)
        } catch {
          reject(new Error('Invalid review parser response'))
        }
      },
    )
    // Early exit or OOM can close stdin before its input is written. execFile reports
    // the final process outcome; an unhandled EPIPE must not crash the runtime either.
    child.stdin?.on('error', () => child.kill('SIGKILL'))
    child.stdin?.end(JSON.stringify({ files, modules }))
  })
}

/** One parser at a time across all paired clients; no long-lived grammar heap. */
export class ReviewAnalyzer {
  private tail = Promise.resolve()
  private queued = 0
  constructor(private readonly run = runReviewWorker) {}

  async analyze(files: ReviewSource[], modules: ReviewModule[] = []): Promise<ReviewGroup[]> {
    if (
      !files.length ||
      this.queued >= 8 ||
      files.length + modules.length > 1000 ||
      reviewAnalysisSize(files, modules) > reviewAnalysisMaxBytes
    )
      return folderFileGroups(files)

    this.queued++
    const deadline = Date.now() + 15_000
    const result = this.tail.then(() => {
      const timeoutMs = deadline - Date.now()
      if (timeoutMs <= 0) throw new Error('Review parser queue deadline exceeded')
      return this.run(files, modules, { timeoutMs })
    })
    // Keep the queue alive after a rejected request; its caller handles the failure below.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    try {
      return await result
    } catch (error) {
      console.warn(
        'Review dependency analysis unavailable; using folder groups:',
        error instanceof Error ? error.message : 'parser failed',
      )
      return folderFileGroups(files)
    } finally {
      this.queued--
    }
  }
}

const analyzer = new ReviewAnalyzer()
export const relatedFileGroups = (files: ReviewSource[], modules: ReviewModule[] = []) =>
  analyzer.analyze(files, modules)
