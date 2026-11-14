import { expect, it } from 'vite-plus/test'
import { WorkerCapacity } from './worker-capacity.js'

it('admits workers in order and reserves a slot before resolving', async () => {
  let active = 1
  const queue = new WorkerCapacity(() => active < 1)
  const granted: string[] = []
  const positions: number[] = []
  const first = queue.acquire(
    new AbortController().signal,
    () => {
      active++
      granted.push('first')
    },
    (p) => positions.push(p),
  )
  const second = queue.acquire(
    new AbortController().signal,
    () => {
      active++
      granted.push('second')
    },
    () => {},
  )
  expect(positions).toEqual([1, 1])
  active--
  queue.drain()
  await first
  expect(granted).toEqual(['first'])
  active--
  queue.drain()
  await second
  expect(granted).toEqual(['first', 'second'])
})

it('removes cancelled requests without consuming capacity', async () => {
  let available = false
  const queue = new WorkerCapacity(() => available)
  const controller = new AbortController()
  let granted = false
  const pending = queue.acquire(
    controller.signal,
    () => {
      granted = true
    },
    () => {},
  )
  const rejection = pending.catch((error: unknown) => error)
  controller.abort(new Error('Stopped'))
  expect(await rejection).toMatchObject({ message: 'Stopped' })
  available = true
  queue.drain()
  expect(granted).toBe(false)
  expect(() =>
    queue.acquire(
      controller.signal,
      () => {},
      () => {},
    ),
  ).toThrow('Stopped')
})
