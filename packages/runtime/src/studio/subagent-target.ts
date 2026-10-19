import { createHash } from 'node:crypto'

/** Opaque, bounded reference; ownership is always checked against the parent's saved watches. */
export function targetedChildId(watch: { runtimeId: string; threadId: string }) {
  return `target:${createHash('sha256')
    .update(JSON.stringify([watch.runtimeId, watch.threadId]))
    .digest('hex')}`
}
