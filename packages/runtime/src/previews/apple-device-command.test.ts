import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse } from 'shell-quote'
import { appleDeviceCommand } from './apple-device-command'

const command = vi.hoisted(() =>
  vi.fn<
    (file: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>
  >(),
)
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: command }),
}))
afterEach(() => {
  vi.restoreAllMocks()
  command.mockReset()
})
function scriptDirectory(args: string[]) {
  const script = parse(args.at(-1)!).at(-1)
  if (typeof script !== 'string') throw new Error('Expected a script path')
  return dirname(script)
}
const options = { timeout: 1000, maxBuffer: 10000 }

it('uses argv in a login shell without evaluating device IDs or artifact paths as shell code', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  command.mockResolvedValue({ stdout: 'installed', stderr: '' })
  const args = ['devicectl', 'device', 'install', 'app', '/tmp/$(touch bad); app.app']
  expect(await appleDeviceCommand('xcrun', args, options)).toEqual({
    stdout: 'installed',
    stderr: '',
  })
  expect(command).toHaveBeenCalledWith(
    '/bin/zsh',
    ['-l', '-c', 'exec "$@"', 'dovo-device', 'xcrun', ...args],
    options,
  )
})

it('retries CoreDevice session failures in the same logged-in user’s GUI Terminal and cleans its files', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  let directory = ''
  command.mockImplementation(async (file, args) => {
    if (file === '/bin/zsh') throw new Error('com.apple.dt.CoreDeviceError error 4016')
    if (file === '/usr/bin/stat') return { stdout: String(process.getuid?.()), stderr: '' }
    directory = scriptDirectory(args)
    const script = await readFile(join(directory, 'command.zsh'), 'utf8')
    expect(script).toContain('#!/bin/zsh -l')
    expect(parse(script.split('\n')[2]).slice(0, 3)).toEqual(['xcrun', 'install', 'a;$(bad).app'])
    await writeFile(join(directory, 'stdout'), 'installed')
    await writeFile(join(directory, 'stderr'), '')
    await writeFile(join(directory, 'exit'), '0')
    return { stdout: '', stderr: '' }
  })
  expect(await appleDeviceCommand('xcrun', ['install', 'a;$(bad).app'], options)).toEqual({
    stdout: 'installed',
    stderr: '',
  })
  await expect(readdir(directory)).rejects.toThrow('ENOENT')
})

it('keeps signing and authorization failures visible and refuses another desktop user', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  command.mockRejectedValueOnce(new Error('Signing certificate missing'))
  await expect(appleDeviceCommand('codesign', [], options)).rejects.toThrow('Signing certificate')
  expect(command).toHaveBeenCalledTimes(1)
  command.mockRejectedValueOnce(new Error('CoreDeviceError error 4000: device is disconnected'))
  await expect(appleDeviceCommand('xcrun', [], options)).rejects.toThrow('device is disconnected')
  expect(command).toHaveBeenCalledTimes(2)
  command
    .mockRejectedValueOnce(new Error('CoreDeviceError error 4016'))
    .mockResolvedValueOnce({ stdout: '-1', stderr: '' })
  await expect(appleDeviceCommand('xcrun', [], options)).rejects.toThrow(
    'Sign in to the Mac desktop',
  )
})

it.each(['abort', 'timeout'] as const)(
  'cleans the GUI command and terminates its child on %s',
  async (mode) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const controller = new AbortController()
    let directory = ''
    command.mockImplementation(async (file, args) => {
      if (file === '/bin/zsh') throw new Error('CoreDeviceError error 4016')
      if (file === '/usr/bin/stat') return { stdout: String(process.getuid?.()), stderr: '' }
      directory = scriptDirectory(args)
      await writeFile(join(directory, 'pid'), '12345')
      if (mode === 'abort') controller.abort()
      return { stdout: '', stderr: '' }
    })
    await expect(
      appleDeviceCommand('xcrun', [], { ...options, timeout: 1, signal: controller.signal }),
    ).rejects.toThrow(mode === 'abort' ? /abort/i : /timed out/)
    expect(kill).toHaveBeenCalledWith(12345, 'SIGTERM')
    await expect(readdir(directory)).rejects.toThrow('ENOENT')
  },
)
