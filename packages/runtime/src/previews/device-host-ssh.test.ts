import { afterEach, expect, it, vi } from 'vite-plus/test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeviceHost } from '@dovo/protocol'
const commands = vi.hoisted(() => ({
  run: vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: commands.run }),
}))
import { copyArtifact, deviceArtifactDestination, sshArgs } from './device-host-ssh'
const host: DeviceHost = {
  id: 'host',
  name: 'Host',
  agentAccess: false,
  sshHost: '2001:db8::1',
  sshPort: 2222,
  sshUser: 'builder',
  runtimeAddress: 'http://localhost:4545',
  identityFile: '~/.ssh/build',
  token: 'secret',
}
afterEach(() => commands.run.mockReset())
it('uses noninteractive key authentication without connection sharing or agent forwarding', () => {
  const args = sshArgs(host)
  for (const value of [
    'BatchMode=yes',
    'ForwardAgent=no',
    'ControlMaster=no',
    'ControlPath=none',
    'StrictHostKeyChecking=yes',
    'IdentitiesOnly=yes',
  ])
    expect(args).toContain(value)
  expect(args.slice(-2)).toEqual(['-i', join(homedir(), '.ssh/build')])
})
it('copies with SFTP, IPv6 brackets and uppercase SCP port flag', async () => {
  commands.run.mockResolvedValue({ stdout: '', stderr: '' })
  const destination = '/Users/用户/~build/dovo-device-host-abc/artifact.app'
  await copyArtifact(host, '/tmp/local app', destination, true)
  const args = commands.run.mock.calls[0]?.[1]
  expect(args).toEqual(
    expect.arrayContaining([
      '-s',
      '-P',
      '2222',
      '-r',
      '--',
      '/tmp/local app',
      `builder@[2001:db8::1]:${destination}`,
    ]),
  )
  expect(args).not.toContain('-p')
  expect(args).not.toContain('-l')
  expect(commands.run.mock.calls[0]?.[2]).toMatchObject({ timeout: 120000 })
})
it('accepts Unicode and tilde in absolute staging paths but rejects escapes and invalid suffixes', () => {
  expect(deviceArtifactDestination('C:\\Users\\用户~\\dovo-device-host-a\\artifact.apk')).toBe(
    'C:/Users/用户~/dovo-device-host-a/artifact.apk',
  )
  for (const path of [
    '~/dovo-device-host-a/artifact.apk',
    '/tmp/../dovo-device-host-a/artifact.apk',
    '/tmp/./dovo-device-host-a/artifact.apk',
    '/tmp/dovo-device-host-a/other.apk',
    '/tmp/\n/dovo-device-host-a/artifact.apk',
  ])
    expect(() => deviceArtifactDestination(path)).toThrow('unsafe artifact staging path')
})
it('explains unsupported old scp SFTP flags and reports transfer timeouts explicitly', async () => {
  commands.run.mockRejectedValueOnce({ stderr: 'scp: unknown option -- s\nusage: scp' })
  await expect(
    copyArtifact(host, '/tmp/a.apk', '/tmp/dovo-device-host-a/artifact.apk', false),
  ).rejects.toThrow('requires OpenSSH 8.7')
  commands.run.mockRejectedValueOnce({ killed: true })
  await expect(
    copyArtifact(host, '/tmp/a.apk', '/tmp/dovo-device-host-a/artifact.apk', false),
  ).rejects.toThrow('timed out after 120 seconds')
})
