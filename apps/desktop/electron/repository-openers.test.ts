import { expect, it, vi } from 'vite-plus/test'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn<(...args: unknown[]) => void>() } }))
import { clientOpenCommand } from './repository-openers'
import type { InstalledOpener } from '@dovo/api/desktop-openers'
const editors = [
  'vscode',
  'vscode-insiders',
  'vscodium',
  'cursor',
  'windsurf',
  'antigravity',
  'devin',
  'zed',
] as const
const installed: InstalledOpener[] = editors.map((target) => ({
  target,
  executable: `/bin/${target}`,
  prefix: [],
  kind: 'native',
}))
const remote = {
  path: '/home/me/project with spaces',
  runtimeId: 'remote',
  sshAddress: 'ssh://dominic@buildbox:2222',
  kind: 'folder' as const,
}
it('launches each supported client editor with an SSH destination, keeping paths a single argument', async () => {
  for (const target of editors) {
    const command = await clientOpenCommand({ ...remote, target }, 'local', installed)
    expect(command.executable).toBe(`/bin/${target}`)
    expect(command.args).toEqual(
      target === 'zed'
        ? ['ssh://dominic@buildbox:2222/home/me/project%20with%20spaces']
        : [
            '--reuse-window',
            '--folder-uri',
            'vscode-remote://ssh-remote+dominic@buildbox:2222/home/me/project%20with%20spaces',
          ],
    )
  }
})
it('uses the local path only for an exact local runtime identity', async () => {
  expect(
    (
      await clientOpenCommand(
        { ...remote, target: 'vscode', runtimeId: 'local' },
        'local',
        installed,
      )
    ).args,
  ).toEqual(['--reuse-window', remote.path])
  await expect(
    clientOpenCommand({ ...remote, target: 'vscode', sshAddress: '' }, null, installed),
  ).rejects.toThrow('SSH address')
  await expect(
    clientOpenCommand({ ...remote, target: 'finder' }, 'local', installed),
  ).rejects.toThrow('SSH')
})
it('rejects invalid destinations, missing client editors and nonabsolute SSH paths', async () => {
  await expect(clientOpenCommand({ ...remote, target: 'cursor' }, 'local', [])).rejects.toThrow(
    'not installed on your computer',
  )
  for (const sshAddress of [
    'ssh://user:secret@host',
    'ssh://user@host?command=bad',
    'ssh://user@host/path',
  ])
    await expect(
      clientOpenCommand({ ...remote, sshAddress, target: 'vscode' }, 'local', installed),
    ).rejects.toThrow(Error)
  for (const path of ['--command=bad', '/path\n--bad', '/path\0bad'])
    await expect(
      clientOpenCommand({ ...remote, path, target: 'vscode' }, 'local', installed),
    ).rejects.toThrow(Error)
})
it('encodes Zed file URIs and passes IPv6 and special characters without a shell', async () => {
  const command = await clientOpenCommand(
    {
      ...remote,
      target: 'zed',
      kind: 'file',
      path: '/tmp/a#b?.ts',
      sshAddress: 'ssh://dominic@[fd00::1]:2222',
    },
    'local',
    installed,
  )
  expect(command.args).toEqual(['ssh://dominic@[fd00::1]:2222/tmp/a%23b%3F.ts'])
})
