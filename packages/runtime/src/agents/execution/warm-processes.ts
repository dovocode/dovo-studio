import { freemem, totalmem } from 'node:os'

/** Idle provider processes are kept until shutdown unless memory is constrained. */
export function releaseIdleProvider() {
  const total = totalmem()
  return (
    process.memoryUsage().rss > Math.min(1024 * 1024 * 1024, total / 4) ||
    freemem() < Math.min(512 * 1024 * 1024, total / 10)
  )
}
