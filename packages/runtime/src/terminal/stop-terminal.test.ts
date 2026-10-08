/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'

const fixture = vi.hoisted(() => ({
  execute: vi.fn<() => Promise<{ stdout: string; stderr: string }>>(),
}))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: fixture.execute }) }
})
import { stopUnixTerminal } from './stop-terminal'
afterEach(() => {
  vi.restoreAllMocks()
  fixture.execute.mockReset()
})
const row = (pid: number, parent: number, group: number, started: string) =>
  `${pid} ${parent} ${group} S ${started}\n`

it('checks process identity before signalling, leaving a recycled child PID alone', async () => {
  const root = row(101, 1, 101, 'Wed Oct 8 09:00:00 2026')
  const original = row(102, 101, 101, 'Wed Oct 8 09:00:01 2026')
  const recycled = row(102, 1, 102, 'Wed Oct 8 09:05:00 2026')
  let exited = false
  fixture.execute
    .mockResolvedValueOnce({ stdout: root + original, stderr: '' })
    .mockImplementation(async () => ({ stdout: (exited ? '' : root) + recycled, stderr: '' }))
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  await stopUnixTerminal(
    {
      pid: 101,
      kill: () => {
        exited = true
      },
    },
    () => exited,
  )
  expect(kill).not.toHaveBeenCalled()
  expect(exited).toBe(true)
})

it('does not inspect or signal a terminal whose process already exited', async () => {
  const kill = vi.fn<() => void>()
  await stopUnixTerminal({ pid: 101, kill }, () => true)
  expect(kill).not.toHaveBeenCalled()
  expect(fixture.execute).not.toHaveBeenCalled()
})

it('does not signal a shell PID that was recycled during inspection', async () => {
  fixture.execute
    .mockResolvedValueOnce({ stdout: row(101, 1, 101, 'original'), stderr: '' })
    .mockResolvedValue({ stdout: row(101, 1, 101, 'replacement'), stderr: '' })
  const kill = vi.fn<() => void>()
  await stopUnixTerminal({ pid: 101, kill }, () => false)
  expect(kill).not.toHaveBeenCalled()
})

it('reports inspection failures without signalling unknown processes', async () => {
  fixture.execute.mockRejectedValue(new Error('ps unavailable'))
  const kill = vi.fn<() => void>()
  await expect(stopUnixTerminal({ pid: 101, kill }, () => false)).rejects.toThrow('ps unavailable')
  expect(kill).not.toHaveBeenCalled()
})
