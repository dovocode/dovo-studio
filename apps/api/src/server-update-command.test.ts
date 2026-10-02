import { afterEach, expect, it, vi } from 'vite-plus/test'
import { runServerUpdateCommand } from './server-update-command'
afterEach(() => vi.restoreAllMocks())
it('streams more than the old stderr limit without killing a successful command', async () => {
  const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  await runServerUpdateCommand(
    process.execPath,
    ['-e', "process.stderr.write('warning\\n'.repeat(300000))"],
    10000,
  )
  expect(output.mock.calls.reduce((size, [chunk]) => size + Buffer.byteLength(chunk), 0)).toBe(
    2400000,
  )
})
it('keeps failure diagnostics bounded while preserving the exit code and final error', async () => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const error = await runServerUpdateCommand(
    process.execPath,
    [
      '-e',
      "process.stderr.write('warning\\n'.repeat(300000)+'Corrupt archive',()=>process.exit(2))",
    ],
    10000,
  ).catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw new Error('Expected command failure')
  expect(error.message).toContain('exit 2')
  expect(error.message).toContain('Corrupt archive')
  expect(error.message.length).toBeLessThan(17000)
})
it('terminates a hung update command on timeout', async () => {
  await expect(
    runServerUpdateCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 250),
  ).rejects.toThrow('SIGKILL')
})
