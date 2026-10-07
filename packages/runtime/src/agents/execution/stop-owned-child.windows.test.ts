import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { stopOwnedChild } from './stop-owned-child'

const mocked = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        file: string,
        args: string[],
        options: { timeout: number; windowsHide: boolean },
        callback: (error: Error | null) => void,
      ) => void
    >(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: mocked.execFile,
}))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  mocked.execFile.mockReset()
})
function launcher() {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.useFakeTimers()
  const child = new ChildProcess()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(child, { pid: 123, stdout, stderr })
  return { child, stdout, stderr }
}
it('awaits tree termination and inherited pipes after the launcher exits', async () => {
  const { child, stdout, stderr } = launcher()
  let finished = false
  const stopping = stopOwnedChild(child).then(() => {
    finished = true
  })
  expect(mocked.execFile.mock.calls[0]?.slice(0, 3)).toEqual([
    'C:\\Windows\\System32\\taskkill.exe',
    ['/PID', '123', '/T', '/F'],
    { timeout: 2000, windowsHide: true },
  ])
  Object.assign(child, { exitCode: 0 })
  await vi.advanceTimersByTimeAsync(100)
  expect(finished).toBe(false)
  mocked.execFile.mock.calls[0]![3](null)
  await vi.advanceTimersByTimeAsync(100)
  expect(finished).toBe(false)
  stdout.destroy()
  stderr.destroy()
  await vi.advanceTimersByTimeAsync(25)
  await stopping
  expect(finished).toBe(true)
})
it('reports failed tree termination instead of accepting only a shell exit', async () => {
  const { child } = launcher()
  const failed = stopOwnedChild(child).catch((error: unknown) => error)
  mocked.execFile.mock.calls[0]![3](new Error('Access denied'))
  expect(await failed).toMatchObject({ message: expect.stringContaining('Access denied') })
})
it('drains an already exited launcher without terminating its old PID', async () => {
  const { child, stdout, stderr } = launcher()
  Object.assign(child, { exitCode: 1 })
  const stopping = stopOwnedChild(child)
  expect(mocked.execFile).not.toHaveBeenCalled()
  stdout.destroy()
  stderr.destroy()
  await vi.advanceTimersByTimeAsync(25)
  await stopping
})
it('drains a launcher that exits while taskkill reports a failure', async () => {
  const { child, stdout, stderr } = launcher()
  const stopping = stopOwnedChild(child)
  Object.assign(child, { exitCode: 1 })
  mocked.execFile.mock.calls[0]![3](new Error('Process not found'))
  stdout.destroy()
  stderr.destroy()
  await vi.advanceTimersByTimeAsync(25)
  await expect(stopping).resolves.toBeUndefined()
})
it('bounds waiting for inherited pipes after a successful taskkill', async () => {
  const { child } = launcher()
  const failed = stopOwnedChild(child).catch((error: unknown) => error)
  Object.assign(child, { exitCode: 0 })
  mocked.execFile.mock.calls[0]![3](null)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await failed).toMatchObject({
    message: expect.stringContaining('process tree did not drain'),
  })
})
