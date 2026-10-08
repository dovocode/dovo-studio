import { ChildProcess, spawn } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { folderOpenCommand, launchDesktop, runtimeFolderOpener } from './open-folder'
import { detectInstalledOpeners, type InstalledOpener } from './installed-openers'
import { exec } from '../../process'
vi.mock('./installed-openers', () => ({
  detectInstalledOpeners: vi.fn<typeof detectInstalledOpeners>(),
}))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof spawn>(),
}))
vi.mock('../../process', async (original) => ({
  ...(await original<typeof import('../../process')>()),
  exec: vi.fn<typeof exec>(),
}))
beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.stubEnv('WSL_DISTRO_NAME', '')
  vi.mocked(detectInstalledOpeners).mockReset().mockResolvedValue([])
  vi.mocked(exec).mockReset()
  vi.mocked(spawn).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const opener = (
  target: InstalledOpener['target'],
  executable: string,
  kind: InstalledOpener['kind'] = 'native',
  prefix: string[] = [],
): InstalledOpener => ({ target, executable, kind, prefix })

it('passes the exact Windows folder to Explorer, including for legacy Finder clients', async () => {
  vi.mocked(detectInstalledOpeners).mockResolvedValue([
    opener('explorer', 'C:\\Windows\\explorer.exe'),
  ])
  const cwd = 'C:\\Projects\\Dovo & Studio (test) %work%'
  for (const target of ['explorer', 'finder', 'file-manager'] as const)
    expect(await folderOpenCommand(cwd, target)).toEqual({
      executable: 'C:\\Windows\\explorer.exe',
      args: [cwd],
      detached: true,
    })
  expect(runtimeFolderOpener()).toBe('explorer')
})
it('uses each installed editor’s actual executable and appropriate arguments', async () => {
  const installed = [
    opener('vscode', 'C:\\Apps\\Code.exe'),
    opener('zed', 'C:\\Apps\\Zed.exe'),
    opener('webstorm', 'C:\\Apps\\WebStorm\\bin\\webstorm64.exe'),
  ]
  expect((await folderOpenCommand('C:\\Project', 'vscode', installed)).args).toEqual([
    '--reuse-window',
    'C:\\Project',
  ])
  expect((await folderOpenCommand('C:\\Project', 'zed', installed)).args).toEqual(['C:\\Project'])
  expect((await folderOpenCommand('C:\\Project', 'webstorm', installed)).executable).toBe(
    'C:\\Apps\\WebStorm\\bin\\webstorm64.exe',
  )
  await expect(folderOpenCommand('C:\\Project', 'pycharm', installed)).rejects.toThrow(
    'application was not found',
  )
})
it('keeps macOS app paths literal and opens Finder normally', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  const installed = [
    opener('finder', '/usr/bin/open'),
    opener('zed', '/Applications/Zed.app', 'app'),
  ]
  expect(await folderOpenCommand('/work tree', 'finder', installed)).toEqual({
    executable: '/usr/bin/open',
    args: ['/work tree'],
    detached: false,
  })
  expect((await folderOpenCommand('/work tree', 'zed', installed)).args).toEqual([
    '-a',
    '/Applications/Zed.app',
    '/work tree',
  ])
})
it('launches all VS Code editor variants with literal folder paths and WSL remote integration', async () => {
  for (const target of [
    'vscode-insiders',
    'vscodium',
    'cursor',
    'antigravity',
    'devin',
    'windsurf',
  ] as const) {
    const installed = [opener(target, `C:\\Apps\\${target}.exe`)]
    expect((await folderOpenCommand('C:\\work & space', target, installed)).args).toEqual([
      '--reuse-window',
      'C:\\work & space',
    ])
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')
    expect(
      (
        await folderOpenCommand('/home/work & space', target, [
          opener(target, `/mnt/c/Apps/${target}.exe`, 'wsl-windows'),
        ])
      ).args,
    ).toEqual(['--reuse-window', '--remote', 'wsl+Ubuntu', '/home/work & space'])
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  }
  expect(exec).not.toHaveBeenCalled()
})
it('supports Linux file managers, Flatpak editors and desktop entries without treating flags as file paths', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  const installed = [
    opener('file-manager', '/usr/bin/gio', 'native', ['open']),
    opener('vscode', '/usr/bin/flatpak', 'native', ['run', 'com.visualstudio.code']),
    opener('cursor', '/usr/bin/gio', 'native', ['launch', '/home/user/Cursor.desktop']),
  ]
  expect(runtimeFolderOpener()).toBe('file-manager')
  expect((await folderOpenCommand('/work tree', 'file-manager', installed)).args).toEqual([
    'open',
    '/work tree',
  ])
  expect((await folderOpenCommand('/work tree', 'vscode', installed)).args).toEqual([
    'run',
    'com.visualstudio.code',
    '--reuse-window',
    '/work tree',
  ])
  expect((await folderOpenCommand('/work tree', 'cursor', installed)).args).toEqual([
    'launch',
    '/home/user/Cursor.desktop',
    '/work tree',
  ])
})
it('converts WSL folders for Windows apps, while using VS Code’s WSL remote integration', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu Work')
  vi.mocked(exec).mockResolvedValue({
    stdout: '\\\\wsl.localhost\\Ubuntu Work\\home\\project\n',
    stderr: '',
  })
  const installed = [
    opener('explorer', '/mnt/c/Windows/explorer.exe', 'wsl-windows'),
    opener('vscode', '/mnt/c/Apps/Code.exe', 'wsl-windows'),
    opener('webstorm', '/mnt/c/Apps/webstorm64.exe', 'wsl-windows'),
  ]
  expect((await folderOpenCommand('/home/project', 'explorer', installed)).args).toEqual([
    '\\\\wsl.localhost\\Ubuntu Work\\home\\project',
  ])
  expect((await folderOpenCommand('/home/project', 'webstorm', installed)).args).toEqual([
    '\\\\wsl.localhost\\Ubuntu Work\\home\\project',
  ])
  expect((await folderOpenCommand('/home/project', 'vscode', installed)).args).toEqual([
    '--reuse-window',
    '--remote',
    'wsl+Ubuntu Work',
    '/home/project',
  ])
})

it('detaches GUI apps, keeps paths literal and removes Electron’s Node mode', async () => {
  const child = new ChildProcess()
  const unref = vi.spyOn(child, 'unref').mockImplementation(() => {})
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  vi.stubEnv('DOVO_OWNER_TOKEN', 'secret')
  const cwd = 'C:\\Projects\\Space & percent %PATH%'
  await launchDesktop('C:\\Apps\\Code.exe', ['--reuse-window', cwd], cwd)
  expect(spawn).toHaveBeenCalledWith(
    'C:\\Apps\\Code.exe',
    ['--reuse-window', cwd],
    expect.objectContaining({
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    }),
  )
  expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env).not.toHaveProperty('DOVO_OWNER_TOKEN')
  expect(unref).toHaveBeenCalledOnce()
})

it('reports a failed GUI launch without reporting success or waiting for the app to exit', async () => {
  const child = new ChildProcess()
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() =>
      child.emit('error', Object.assign(new Error('Cannot launch'), { code: 'ENOENT' })),
    )
    return child
  })
  await expect(launchDesktop('missing.exe', [], 'C:\\Project')).rejects.toThrow('Cannot launch')
})
