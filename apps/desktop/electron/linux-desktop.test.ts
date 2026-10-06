import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installAppImageDesktop, registerLinuxDesktop } from './linux-desktop'

const electron = vi.hoisted(() => ({
  packaged: true,
  desktopName: vi.fn<(name: string) => void>(),
  on: vi.fn<
    (
      event: string,
      listener: (event: unknown, window: { setIcon: (path: string) => void }) => void,
    ) => void
  >(),
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged
    },
    setDesktopName: electron.desktopName,
    on: electron.on,
  },
}))
const directories: string[] = []
const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  electron.packaged = true
  if (resources) Object.defineProperty(process, 'resourcesPath', resources)
  else Reflect.deleteProperty(process, 'resourcesPath')
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-linux-icon-'))
  directories.push(directory)
  const executable = join(directory, 'Dovo $`% preview.AppImage')
  const icon = join(directory, 'icon.png')
  writeFileSync(executable, 'fixture')
  writeFileSync(icon, 'Dovo icon')
  return {
    id: 'com.dovo.studio' as const,
    title: 'Dovo Studio',
    executable,
    icon,
    dataDirectory: join(directory, 'data'),
  }
}
it('installs a persistent icon and correctly escaped launcher that can follow AppImage updates', () => {
  const input = fixture()
  installAppImageDesktop(input)
  const desktop = join(input.dataDirectory, 'applications', `${input.id}.desktop`)
  const icon = join(input.dataDirectory, 'dovo-studio', 'icons', `${input.id}.png`)
  const entry = readFileSync(desktop, 'utf8')
  expect(entry).toContain('StartupWMClass=com.dovo.studio\n')
  expect(entry).toContain(`Icon=${icon}\n`)
  expect(entry).toContain('Dovo \\\\$\\\\`%% preview.AppImage" %U\n')
  expect(readFileSync(icon, 'utf8')).toBe('Dovo icon')
  const next = join(input.dataDirectory, 'Next version.AppImage')
  writeFileSync(next, 'updated')
  installAppImageDesktop({ ...input, executable: next })
  expect(readFileSync(desktop, 'utf8')).toContain(`Exec=/usr/bin/env "${next}" %U\n`)
  expect(readFileSync(desktop, 'utf8')).not.toContain('preview.AppImage')
  expect(readdirSync(join(input.dataDirectory, 'applications'))).toEqual([`${input.id}.desktop`])
})
it('keeps stable and nightly launchers separate and preserves user-owned launchers', () => {
  const input = fixture()
  const applications = join(input.dataDirectory, 'applications')
  mkdirSync(applications, { recursive: true })
  const desktop = join(applications, `${input.id}.desktop`)
  writeFileSync(desktop, '[Desktop Entry]\nName=My launcher\n')
  installAppImageDesktop(input)
  expect(readFileSync(desktop, 'utf8')).toBe('[Desktop Entry]\nName=My launcher\n')
  installAppImageDesktop({
    ...input,
    id: 'com.dovo.studio.nightly',
    title: 'Dovo Studio (Nightly)',
  })
  const entry = readFileSync(join(applications, 'com.dovo.studio.nightly.desktop'), 'utf8')
  expect(entry).toContain('Name=Dovo Studio (Nightly)\n')
  expect(entry).toContain('StartupWMClass=com.dovo.studio.nightly\n')
})
it('registers Linux window icons and desktop identity before creating any window', () => {
  const input = fixture()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  Object.defineProperty(process, 'resourcesPath', {
    value: join(input.icon, '..'),
    configurable: true,
  })
  vi.stubEnv('APPIMAGE', input.executable)
  vi.stubEnv('XDG_DATA_HOME', input.dataDirectory)
  registerLinuxDesktop(true, 'Dovo Studio (Nightly)', '/app/dist/index.html')
  expect(electron.desktopName).toHaveBeenCalledWith('com.dovo.studio.nightly.desktop')
  const listener = electron.on.mock.calls.find(([event]) => event === 'browser-window-created')?.[1]
  expect(listener).toBeDefined()
  const setIcon = vi.fn<(path: string) => void>()
  listener?.({}, { setIcon })
  expect(setIcon).toHaveBeenCalledWith(input.icon)
  expect(
    readFileSync(
      join(input.dataDirectory, 'applications', 'com.dovo.studio.nightly.desktop'),
      'utf8',
    ),
  ).toContain(
    input.executable.replaceAll('%', '%%').replaceAll('$', '\\\\$').replaceAll('`', '\\\\`'),
  )
})
it('uses the source icon during development without installing a launcher', () => {
  electron.packaged = false
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('APPIMAGE', '')
  registerLinuxDesktop(false, 'Dovo Studio (Dev)', '/source/apps/desktop/dist/index.html')
  const setIcon = vi.fn<(path: string) => void>()
  electron.on.mock.calls[0]?.[1]({}, { setIcon })
  expect(setIcon).toHaveBeenCalledWith('/source/apps/desktop/build/icon.png')
})
it('preserves startup when desktop integration cannot write and leaves other platforms alone', () => {
  const input = fixture()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  Object.defineProperty(process, 'resourcesPath', {
    value: join(input.icon, '..'),
    configurable: true,
  })
  vi.stubEnv('APPIMAGE', input.executable)
  vi.stubEnv('XDG_DATA_HOME', input.icon)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(() => registerLinuxDesktop(false, 'Dovo Studio', '/app/dist/index.html')).not.toThrow()
  expect(warning).toHaveBeenCalledWith(
    'Could not register the AppImage desktop launcher:',
    expect.any(Error),
  )
  electron.desktopName.mockClear()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  registerLinuxDesktop(false, 'Dovo Studio', '/app/dist/index.html')
  expect(electron.desktopName).not.toHaveBeenCalled()
})
