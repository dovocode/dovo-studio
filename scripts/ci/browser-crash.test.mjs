import assert from 'node:assert/strict'
import { test } from 'node:test'
import { terminateBrowserRenderers } from './browser-crash.mjs'

await test('crash injection only signals live renderer PIDs, never process groups', () => {
  const signals = []
  terminateBrowserRenderers(
    [
      { type: 'browser', id: 100 },
      { type: 'GPU', id: 101 },
      ...[0, -1, -100, 1, 1.5, NaN, Infinity, undefined, '102', 102, 103].map((id) => ({
        type: 'renderer',
        id,
      })),
    ],
    (...args) => signals.push(args),
  )
  assert.deepEqual(signals, [
    [102, 'SIGKILL'],
    [103, 'SIGKILL'],
  ])
})

await test('crash injection fails without a live renderer instead of signaling a process group', () => {
  assert.throws(
    () =>
      terminateBrowserRenderers([{ type: 'renderer', id: 0 }], () => {
        assert.fail('Must not signal an invalid PID')
      }),
    /must have a live renderer/,
  )
})

await test('crash injection tolerates exited spare renderers and propagates other failures', () => {
  const processes = [102, 103].map((id) => ({ type: 'renderer', id }))
  const signals = []
  terminateBrowserRenderers(processes, (id) => {
    signals.push(id)
    if (id === 102) throw Object.assign(new Error('Exited'), { code: 'ESRCH' })
  })
  assert.deepEqual(signals, [102, 103])
  const denied = Object.assign(new Error('Denied'), { code: 'EPERM' })
  assert.throws(
    () =>
      terminateBrowserRenderers(processes, () => {
        throw denied
      }),
    (error) => error === denied,
  )
})
