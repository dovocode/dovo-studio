import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { posix, win32 } from 'node:path'
import { detectInstalledOpeners } from './installed-openers'
import { exec } from '../../process'
const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  denied: new Set<string>(),
  links: new Map<string, string>(),
  home: '/home/user',
}))
const api = (path: string) => (/^[A-Za-z]:/.test(path) ? win32 : posix)
const normalized = (path: string) => api(path).normalize(path)
function file(path: string, content = '') {
  fs.files.set(normalized(path), content)
  let parent = api(path).dirname(path)
  while (!fs.dirs.has(parent)) {
    fs.dirs.add(parent)
    const next = api(parent).dirname(parent)
    if (next === parent) break
    parent = next
  }
}
vi.mock('node:os', () => ({ homedir: () => fs.home }))
vi.mock('node:fs/promises', () => ({
  realpath: async (path: string) => fs.links.get(path) ?? normalized(path),
  stat: async (path: string) => {
    const name = normalized(path)
    if (!fs.files.has(name) && !fs.dirs.has(name))
      throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    return { isFile: () => fs.files.has(name), isDirectory: () => fs.dirs.has(name) }
  },
  access: async (path: string) => {
    if (fs.denied.has(normalized(path)))
      throw Object.assign(new Error('Denied'), { code: 'EACCES' })
  },
  readFile: async (path: string) => {
    const value = fs.files.get(normalized(path))
    if (value === undefined) throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    return value
  },
  readdir: async (path: string, options?: { withFileTypes?: boolean }) => {
    const root = normalized(path)
    if (!fs.dirs.has(root)) throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    const names = [
      ...new Set(
        [...fs.files.keys(), ...fs.dirs]
          .filter((child) => child !== root && api(child).dirname(child) === root)
          .map((child) => api(child).basename(child)),
      ),
    ]
    return options?.withFileTypes
      ? names.map((name) => ({
          name,
          isDirectory: () => fs.dirs.has(api(root).join(root, name)),
          isSymbolicLink: () => false,
        }))
      : names
  },
}))
vi.mock('../../process', async (original) => ({
  ...(await original<typeof import('../../process')>()),
  exec: vi.fn<typeof exec>(),
}))
beforeEach(() => {
  fs.files.clear()
  fs.dirs.clear()
  fs.denied.clear()
  fs.links.clear()
  fs.home = '/home/user'
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('PATH', '/usr/bin')
  vi.stubEnv('WSL_DISTRO_NAME', '')
  vi.stubEnv('XDG_DATA_HOME', '/home/user/.local/share')
  vi.stubEnv('XDG_DATA_DIRS', '/usr/share')
  vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\User\\AppData\\Local')
  vi.stubEnv('ProgramFiles', 'C:\\Program Files')
  vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)')
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  vi.mocked(exec).mockReset().mockResolvedValue({ stdout: '', stderr: '' })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const ids = async () => (await detectInstalledOpeners()).map((app) => app.target)
function product(root: string, code: string, os = 'Linux', binary = 'bin/ide.sh') {
  file(
    api(root).join(root, 'product-info.json'),
    JSON.stringify({ productCode: code, launch: [{ os, arch: 'amd64', launcherPath: binary }] }),
  )
  file(api(root).join(root, binary))
}
const windowsInfo = (
  changes: Partial<{ roots: string[]; binaries: string[]; commands: string[] }> = {},
) =>
  JSON.stringify({
    local: 'C:\\Users\\User\\AppData\\Local',
    home: 'C:\\Users\\User',
    programs: 'C:\\Program Files',
    programsX86: '',
    root: 'C:\\Windows',
    roots: [],
    binaries: [],
    commands: [],
    ...changes,
  })
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

it('shows only executable Linux commands, including local and Snap launchers', async () => {
  file('/usr/bin/xdg-open')
  file('/usr/bin/nautilus')
  file('/usr/bin/code')
  file('/home/user/.local/bin/zeditor')
  file('/snap/bin/webstorm')
  file('/usr/bin/cursor')
  fs.denied.add('/usr/bin/cursor')
  expect(await ids()).toEqual(['file-manager', 'vscode', 'zed', 'webstorm'])
})
it('detects old and current Toolbox layouts, custom locations and actual product launcher metadata', async () => {
  product('/home/user/.local/share/JetBrains/Toolbox/apps/webstorm/ch-0/261.123', 'WS')
  file(
    '/home/user/.local/share/JetBrains/Toolbox/.settings.json',
    JSON.stringify({ install_location: '/custom IDEs' }),
  )
  product('/custom IDEs/idea/2026', 'IC')
  product('/opt/rider-2026', 'RD')
  const found = await detectInstalledOpeners()
  expect(found.map((app) => app.target).sort()).toEqual(['idea', 'rider', 'webstorm'])
  expect(found.find((app) => app.target === 'webstorm')?.executable).toBe(
    '/home/user/.local/share/JetBrains/Toolbox/apps/webstorm/ch-0/261.123/bin/ide.sh',
  )
})
it('does not show stale Toolbox scripts or product entries whose executable was removed', async () => {
  file('/home/user/.local/share/JetBrains/Toolbox/scripts/webstorm')
  file(
    '/home/user/.local/share/JetBrains/Toolbox/apps/webstorm/product-info.json',
    JSON.stringify({
      productCode: 'WS',
      launch: [{ os: 'Linux', launcherPath: 'bin/webstorm.sh' }],
    }),
  )
  expect(await ids()).toEqual([])
})
it('detects installed Flatpak applications without advertising uninstalled IDs', async () => {
  file('/usr/bin/flatpak')
  vi.mocked(exec).mockResolvedValue({
    stdout: 'dev.zed.Zed\ncom.jetbrains.PyCharm-Community\n',
    stderr: '',
  })
  const found = await detectInstalledOpeners()
  expect(found.map((app) => app.target)).toEqual(['zed', 'pycharm'])
  expect(found[1]?.prefix).toEqual(['run', 'com.jetbrains.PyCharm-Community'])
})
it('handles quoted AppImage desktop entries and omits stale or hidden shortcuts', async () => {
  file('/usr/bin/gio')
  file('/home/user/Apps/Cursor AppImage')
  file(
    '/home/user/.local/share/applications/cursor.desktop',
    '[Desktop Entry]\nType=Application\nName=Cursor\nExec="/home/user/Apps/Cursor AppImage" %U\n',
  )
  file(
    '/usr/share/applications/zed.desktop',
    '[Desktop Entry]\nType=Application\nName=Zed\nExec=/removed/zed %U\n',
  )
  file(
    '/usr/share/applications/code.desktop',
    '[Desktop Entry]\nType=Application\nName=Visual Studio Code\nHidden=true\nExec=/home/user/Apps/Cursor AppImage %U\n',
  )
  const found = await detectInstalledOpeners()
  expect(found.map((app) => app.target)).toEqual(['cursor'])
  expect(found[0]?.prefix).toEqual([
    'launch',
    '/home/user/.local/share/applications/cursor.desktop',
  ])
})
it('honors desktop TryExec and reads refreshed installations on the next scan', async () => {
  file('/usr/bin/gio')
  file('/usr/bin/code')
  file(
    '/usr/share/applications/cursor.desktop',
    '[Desktop Entry]\nType=Application\nName=Cursor\nTryExec=/missing/cursor\nExec=/usr/bin/code %U\n',
  )
  expect(await ids()).toEqual(['vscode'])
  fs.files.delete('/usr/bin/code')
  file('/usr/bin/zed')
  expect(await ids()).toEqual(['zed'])
})
it('does not mistake generic desktop helpers or the ZFS daemon for installed applications', async () => {
  file('/usr/bin/gio')
  file('/usr/bin/xdg-open')
  file('/sbin/zed')
  vi.stubEnv('PATH', '/usr/bin:/sbin')
  expect(await ids()).toEqual([])
})
it('validates the default directory handler and honors user entries masking system shortcuts', async () => {
  file('/usr/bin/xdg-mime')
  file('/usr/bin/gio')
  file('/custom/File Browser')
  const desktop = '/usr/share/applications/browser.desktop'
  file(desktop, '[Desktop Entry]\nType=Application\nExec="/custom/File Browser" %U\n')
  vi.mocked(exec).mockResolvedValue({ stdout: 'browser.desktop\n', stderr: '' })
  expect(await detectInstalledOpeners()).toEqual([
    {
      target: 'file-manager',
      executable: '/usr/bin/gio',
      kind: 'native',
      prefix: ['launch', desktop],
    },
  ])
  file(
    '/home/user/.local/share/applications/browser.desktop',
    '[Desktop Entry]\nType=Application\nHidden=true\nExec="/custom/File Browser" %U\n',
  )
  expect(await ids()).toEqual([])
  fs.files.delete('/home/user/.local/share/applications/browser.desktop')
  fs.files.delete('/custom/File Browser')
  expect(await ids()).toEqual([])
})
it('discovers Windows apps from WSL and converts each drive once, retaining native Linux editors', async () => {
  vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')
  file('/usr/bin/powershell.exe')
  file('/usr/bin/zeditor')
  file('/mnt/c/Windows/explorer.exe')
  file('/mnt/c/Apps/Code.exe')
  product('/mnt/d/Custom WebStorm', 'WS', 'Windows', 'bin/webstorm64.exe')
  vi.mocked(exec).mockImplementation(async (command, args) => {
    if (command === 'wslpath')
      return { stdout: args?.[1] === 'C:\\' ? '/mnt/c/\n' : '/mnt/d/\n', stderr: '' }
    return {
      stdout: windowsInfo({ binaries: ['C:\\Apps\\Code.exe'], roots: ['D:\\Custom WebStorm'] }),
      stderr: '',
    }
  })
  const found = await detectInstalledOpeners()
  expect(found.map((app) => app.target).sort()).toEqual(['explorer', 'vscode', 'webstorm', 'zed'])
  expect(found.find((app) => app.target === 'webstorm')).toMatchObject({
    executable: '/mnt/d/Custom WebStorm/bin/webstorm64.exe',
    kind: 'wsl-windows',
  })
  expect(found.find((app) => app.target === 'zed')?.kind).toBe('native')
  expect(vi.mocked(exec).mock.calls.filter(([command]) => command === 'wslpath')).toHaveLength(2)
})
it('checks per-user and all-user Windows installations even without a PATH command', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  fs.home = 'C:\\Users\\User'
  file('C:\\Windows\\explorer.exe')
  file('C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')
  file('C:\\Program Files\\Zed\\Zed.exe')
  expect(await ids()).toEqual(['explorer', 'vscode', 'zed'])
})
it('resolves Unicode/custom registered apps and .cmd launchers to GUI executables without executing a shell shim', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  fs.home = 'C:\\Users\\User'
  file(powershell)
  file('D:\\Apps 日本語\\Code.exe')
  file('D:\\Zed Custom\\Zed.exe')
  vi.mocked(exec).mockResolvedValue({
    stdout: windowsInfo({
      commands: ['D:\\Apps 日本語\\bin\\code.cmd'],
      binaries: ['D:\\Zed Custom\\Zed.exe'],
    }),
    stderr: '',
  })
  const found = await detectInstalledOpeners()
  expect(found.map((app) => app.target)).toEqual(['vscode', 'zed'])
  expect(found[0]?.executable).toBe('D:\\Apps 日本語\\Code.exe')
  expect(vi.mocked(exec).mock.calls[0]?.[1]?.at(-1)).toContain('[Console]::OutputEncoding')
})
it('detects JetBrains all-user, Toolbox and registry installations from product-info.json', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  fs.home = 'C:\\Users\\User'
  product('C:\\Program Files\\JetBrains\\WebStorm 2026.2', 'WS', 'Windows', 'bin/webstorm64.exe')
  product(
    'C:\\Users\\User\\AppData\\Local\\JetBrains\\Toolbox\\apps\\idea\\ch-0\\261',
    'IU',
    'Windows',
    'bin/idea64.exe',
  )
  file(powershell)
  product('D:\\Custom PyCharm', 'PY', 'Windows', 'bin/pycharm64.exe')
  vi.mocked(exec).mockResolvedValue({
    stdout: windowsInfo({ roots: ['D:\\Custom PyCharm'] }),
    stderr: '',
  })
  expect((await ids()).sort()).toEqual(['idea', 'pycharm', 'webstorm'])
})
it('detects valid macOS app bundles and ignores uninstalled app folders and stale Spotlight results', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  file('/usr/bin/open')
  file('/Applications/Zed.app/Contents/MacOS/zed')
  file('/home/user/Applications/WebStorm.app/Contents/MacOS/webstorm')
  fs.dirs.add('/Applications/Cursor.app')
  file('/usr/bin/mdfind')
  vi.mocked(exec).mockImplementation(async (_command, args) => ({
    stdout: args?.[0]?.includes('== "com.microsoft.VSCode"')
      ? '/External/VS Code.app\n/removed/Code.app\n'
      : '',
    stderr: '',
  }))
  file('/External/VS Code.app/Contents/MacOS/Electron')
  expect((await ids()).sort()).toEqual(['finder', 'vscode', 'webstorm', 'zed'])
})
it('detects VS Code Insiders and VSCodium independently from stable VS Code', async () => {
  file('/usr/bin/code-insiders')
  file('/usr/bin/codium')
  expect(await ids()).toEqual(['vscode-insiders', 'vscodium'])
  file('/usr/bin/code')
  expect(await ids()).toEqual(['vscode', 'vscode-insiders', 'vscodium'])
})
it('finds the requested editor families in standard Windows installs', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  fs.home = 'C:\\Users\\User'
  const base = 'C:\\Users\\User\\AppData\\Local\\Programs'
  for (const [directory, binary] of [
    ['Microsoft VS Code Insiders', 'Code - Insiders.exe'],
    ['VSCodium', 'VSCodium.exe'],
    ['Cursor', 'Cursor.exe'],
    ['Devin', 'Devin.exe'],
    ['Windsurf', 'Windsurf.exe'],
    ['Antigravity IDE', 'Antigravity.exe'],
  ])
    file(win32.join(base, directory, binary))
  file(
    win32.join(base, 'Antigravity IDE/resources/app/product.json'),
    JSON.stringify({ nameShort: 'Antigravity IDE' }),
  )
  file(win32.join(base, 'Devin/resources/app/product.json'), JSON.stringify({ nameShort: 'Devin' }))
  expect((await ids()).sort()).toEqual([
    'antigravity',
    'cursor',
    'devin',
    'vscode-insiders',
    'vscodium',
    'windsurf',
  ])
})
it('finds the requested macOS apps without requiring terminal launchers', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  for (const name of [
    'Visual Studio Code - Insiders',
    'VSCodium',
    'Cursor',
    'Devin',
    'Windsurf',
    'Antigravity IDE',
  ])
    file(`/Applications/${name}.app/Contents/MacOS/Electron`)
  file(
    '/Applications/Antigravity IDE.app/Contents/Resources/app/product.json',
    JSON.stringify({ nameShort: 'Antigravity IDE' }),
  )
  file(
    '/Applications/Devin.app/Contents/Resources/app/product.json',
    JSON.stringify({ nameShort: 'Devin' }),
  )
  expect((await ids()).sort()).toEqual([
    'antigravity',
    'cursor',
    'devin',
    'vscode-insiders',
    'vscodium',
    'windsurf',
  ])
})
it('resolves rebranded Windsurf launchers to one Devin Desktop choice and excludes standalone agent CLIs', async () => {
  file('/usr/bin/devin-desktop')
  file('/usr/bin/windsurf')
  fs.links.set('/usr/bin/devin-desktop', '/usr/share/devin/bin/devin-desktop')
  fs.links.set('/usr/bin/windsurf', '/usr/share/devin/bin/devin-desktop')
  file(
    '/usr/share/devin/resources/app/product.json',
    JSON.stringify({ nameShort: 'Devin', applicationName: 'devin-desktop' }),
  )
  file('/usr/bin/devin')
  file('/usr/bin/antigravity')
  expect(await ids()).toEqual(['devin'])
  fs.files.delete('/usr/bin/devin-desktop')
  expect(await ids()).toEqual(['devin'])
  fs.files.delete('/usr/bin/windsurf')
  expect(await ids()).toEqual([])
})
it('detects an Antigravity IDE desktop entry from its real binary and installed editor metadata', async () => {
  file('/usr/bin/gio')
  file('/opt/google IDE/antigravity')
  file(
    '/opt/google IDE/resources/app/product.json',
    JSON.stringify({ nameShort: 'Antigravity IDE' }),
  )
  file(
    '/usr/share/applications/antigravity.desktop',
    '[Desktop Entry]\nType=Application\nName=Antigravity IDE\nExec="/opt/google IDE/antigravity" %U\n',
  )
  expect(await detectInstalledOpeners()).toEqual([
    {
      target: 'antigravity',
      executable: '/usr/bin/gio',
      kind: 'native',
      prefix: ['launch', '/usr/share/applications/antigravity.desktop'],
    },
  ])
})
it('continues past an unrelated Antigravity CLI to a valid IDE launcher', async () => {
  file('/usr/bin/antigravity')
  file('/usr/bin/antigravity-ide')
  fs.links.set('/usr/bin/antigravity-ide', '/opt/antigravity-ide/bin/antigravity')
  file(
    '/opt/antigravity-ide/resources/app/product.json',
    JSON.stringify({ nameShort: 'Antigravity IDE' }),
  )
  expect(await ids()).toEqual(['antigravity'])
})
it('does not mistake a registered Windows Devin CLI for the desktop editor', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  file(powershell)
  file('C:\\Users\\User\\AppData\\Local\\devin\\bin\\devin.exe')
  vi.mocked(exec).mockResolvedValue({
    stdout: windowsInfo({ roots: ['C:\\Users\\User\\AppData\\Local\\devin\\bin'] }),
    stderr: '',
  })
  expect(await ids()).toEqual([])
})
it('finds Homebrew/custom macOS editor launchers even without Spotlight', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  file('/opt/homebrew/bin/codium')
  expect(await ids()).toEqual(['vscodium'])
})
it('propagates failed discovery sources instead of misreporting everything as uninstalled', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  file(powershell)
  vi.mocked(exec).mockRejectedValue(new Error('Registry query failed'))
  await expect(detectInstalledOpeners()).rejects.toThrow('Registry query failed')
})
