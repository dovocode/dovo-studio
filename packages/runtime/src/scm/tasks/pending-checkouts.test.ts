import { expect, it, vi } from 'vite-plus/test'
import { PendingCheckouts } from './pending-checkouts'

function barrier<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

it('cancels one sibling without aborting shared preparation for another', async () => {
  const pending = new PendingCheckouts<string>()
  const work = barrier<string>()
  const first = new AbortController()
  const second = new AbortController()
  let sharedSignal: AbortSignal | undefined
  const prepare = vi.fn<(signal: AbortSignal) => Promise<string>>(async (signal) => {
    sharedSignal = signal
    return work.promise
  })
  const a = pending.run('parent', prepare, first.signal)
  const b = pending.run('parent', prepare, second.signal)
  const rejected = a.catch((error: unknown) => error)
  await Promise.resolve()
  first.abort(new Error('First cancelled'))
  expect(await rejected).toMatchObject({ message: 'First cancelled' })
  expect(sharedSignal?.aborted).toBe(false)
  work.resolve('/checkout')
  expect(await b).toBe('/checkout')
  expect(prepare).toHaveBeenCalledTimes(1)
})

it('lets a run stop promptly while a terminal still owns shared preparation', async () => {
  const pending = new PendingCheckouts<string>()
  const work = barrier<string>()
  const controller = new AbortController()
  let sharedSignal: AbortSignal | undefined
  const prepare = async (signal: AbortSignal) => {
    sharedSignal = signal
    return work.promise
  }
  const terminal = pending.run('task', prepare)
  const run = pending.run('task', prepare, controller.signal)
  const rejected = run.catch((error: unknown) => error)
  await Promise.resolve()
  controller.abort(new Error('Run stopped'))
  expect(await rejected).toMatchObject({ message: 'Run stopped' })
  expect(sharedSignal?.aborted).toBe(false)
  work.resolve('/checkout')
  expect(await terminal).toBe('/checkout')
})

it('waits for last-caller cleanup before releasing cancelled preparation', async () => {
  const pending = new PendingCheckouts<string>()
  const work = barrier<string>()
  const controller = new AbortController()
  let sharedSignal: AbortSignal | undefined
  const prepare = vi.fn<(signal: AbortSignal) => Promise<string>>(async (signal) => {
    sharedSignal = signal
    await work.promise
    signal.throwIfAborted()
    return '/checkout'
  })
  let settled = false
  const run = pending.run('task', prepare, controller.signal).finally(() => (settled = true))
  const rejected = run.catch((error: unknown) => error)
  await Promise.resolve()
  controller.abort(new Error('Stopped'))
  await Promise.resolve()
  expect(sharedSignal?.aborted).toBe(true)
  expect(settled).toBe(false)
  const joined = pending.run('task', prepare).catch((error: unknown) => error)
  expect(prepare).toHaveBeenCalledTimes(1)
  work.resolve('cleanup complete')
  for (const error of await Promise.all([rejected, joined]))
    expect(error).toMatchObject({ message: 'Stopped' })
  expect(await pending.run('task', async () => '/retry')).toBe('/retry')
})

it('does not start preparation for an already cancelled caller', () => {
  const pending = new PendingCheckouts<string>()
  const controller = new AbortController()
  controller.abort(new Error('Already stopped'))
  const prepare = vi.fn<() => Promise<string>>(async () => '/checkout')
  expect(() => pending.run('task', prepare, controller.signal)).toThrow('Already stopped')
  expect(prepare).not.toHaveBeenCalled()
})
