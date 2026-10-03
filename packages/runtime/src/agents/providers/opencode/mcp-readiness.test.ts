import { expect, it, vi } from 'vitest'
import { waitForMcpConnection } from './mcp-readiness.js'

it('waits for pending registration to finish without registering again', async () => {
  const read = vi
    .fn<Parameters<typeof waitForMcpConnection>[1]>()
    .mockResolvedValueOnce({ status: 'pending' })
    .mockResolvedValue({ status: 'connected' })
  await waitForMcpConnection('dovo_task', read, new AbortController().signal)
  expect(read).toHaveBeenCalledTimes(2)
})

it('reports the actual connection error without retrying failed servers', async () => {
  const read = vi
    .fn<Parameters<typeof waitForMcpConnection>[1]>()
    .mockResolvedValue({ status: 'failed', error: 'Executable not found' })
  await expect(
    waitForMcpConnection('dovo_task', read, new AbortController().signal),
  ).rejects.toThrow('Executable not found')
  expect(read).toHaveBeenCalledTimes(1)
})

it('cancels during pending startup', async () => {
  const controller = new AbortController()
  const read = vi.fn<Parameters<typeof waitForMcpConnection>[1]>(async () => {
    controller.abort(new Error('Run stopped'))
    return { status: 'pending' }
  })
  await expect(waitForMcpConnection('dovo_task', read, controller.signal)).rejects.toThrow(
    'Run stopped',
  )
  expect(read).toHaveBeenCalledTimes(1)
})

it('does not treat missing or authentication-required servers as ready', async () => {
  for (const status of [undefined, { status: 'needs_auth', error: 'Sign in required' }])
    await expect(
      waitForMcpConnection('external', async () => status, new AbortController().signal),
    ).rejects.toThrow('could not connect')
})
