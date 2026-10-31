import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// Studio editors share admission even when they reach the same file through different routes.
// External editors retain their own ownership; callers compare again inside the action.
const pendingWrites = new Map<string, Promise<void>>()

export async function withFileWrite<A>(filename: string, action: () => Promise<A>): Promise<A> {
  const key = await realpath(filename).catch(async (error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return join(await realpath(dirname(filename)), basename(filename))
  })
  const previous = pendingWrites.get(key)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingWrites.set(key, pending)
  try {
    await previous
    return await action()
  } finally {
    release()
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key)
  }
}
