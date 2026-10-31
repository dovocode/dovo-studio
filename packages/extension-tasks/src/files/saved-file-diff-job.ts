import type { FileDiffMetadata } from '@pierre/diffs'

type Input = { path: string; before: string; after: string }
type Job = { input: Input; finish: (diff: FileDiffMetadata | null) => void; cancelled: boolean }

const queue: Job[] = []
let active: { job: Job; stop: () => void } | undefined
const MAX_PENDING = 8

function runNext() {
  if (active) return
  const next = queue.shift()
  if (!next) return
  const job: Job = next
  let worker: Worker
  try {
    worker = new Worker(new URL('./saved-file-diff.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    job.finish(null)
    runNext()
    return
  }
  let completed = false
  const timer = setTimeout(() => complete(null), 2000)
  function complete(diff: FileDiffMetadata | null) {
    if (completed) return
    completed = true
    clearTimeout(timer)
    worker.terminate()
    active = undefined
    if (!job.cancelled) job.finish(diff)
    runNext()
  }
  active = { job, stop: () => complete(null) }
  worker.onmessage = (event: MessageEvent<{ diff?: FileDiffMetadata }>) =>
    complete(event.data.diff ?? null)
  worker.onerror = () => complete(null)
  worker.onmessageerror = () => complete(null)
  try {
    worker.postMessage(job.input)
  } catch {
    complete(null)
  }
}

export function parseSavedFileDiff(input: Input, finish: Job['finish']): () => void {
  if (queue.length >= MAX_PENDING) {
    finish(null)
    return () => {}
  }
  const job: Job = { input, finish, cancelled: false }
  queue.push(job)
  runNext()
  return () => {
    job.cancelled = true
    if (active?.job === job) active.stop()
    else {
      const index = queue.indexOf(job)
      if (index !== -1) queue.splice(index, 1)
    }
  }
}
