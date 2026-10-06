import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

type DesktopId = 'com.dovo.studio' | 'com.dovo.studio.nightly'
const owner = 'X-Dovo-AppImage=true'
const desktopString = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
const executableArgument = (value: string) =>
  desktopString(`"${value.replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&')}"`)

function writeAtomic(path: string, value: string | Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, value, { mode: 0o644 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** AppImages are portable: their embedded launcher is not installed on the host. */
export function installAppImageDesktop({
  id,
  title,
  executable,
  icon,
  dataDirectory,
}: {
  id: DesktopId
  title: string
  executable: string
  icon: string
  dataDirectory: string
}) {
  if (!isAbsolute(executable) || !existsSync(executable))
    throw new Error('AppImage executable must be an existing absolute path')
  const applications = join(dataDirectory, 'applications')
  const desktop = join(applications, `${id}.desktop`)
  const previous = existsSync(desktop) ? readFileSync(desktop, 'utf8') : ''
  // Preserve launchers provided by the user or another desktop integration tool.
  if (previous && !previous.split('\n').includes(owner)) return
  const icons = join(dataDirectory, 'dovo-studio', 'icons')
  const installedIcon = join(icons, `${id}.png`)
  // GLib checks the first executable before expanding %% in filenames.
  // env keeps that check valid while passing the literal AppImage path through.
  const entry = `[Desktop Entry]
Type=Application
Name=${desktopString(title)}
Comment=Personal agent workspace
Exec=/usr/bin/env ${executableArgument(executable)} %U
Icon=${desktopString(installedIcon)}
Terminal=false
Categories=Development;
StartupWMClass=${id}
${owner}
`
  mkdirSync(applications, { recursive: true })
  mkdirSync(icons, { recursive: true })
  writeAtomic(installedIcon, readFileSync(icon))
  if (previous !== entry) writeAtomic(desktop, entry)
}

export function registerLinuxDesktop(nightly: boolean, title: string, rendererPath: string) {
  if (process.platform !== 'linux') return
  const id: DesktopId = nightly ? 'com.dovo.studio.nightly' : 'com.dovo.studio'
  app.setDesktopName(`${id}.desktop`)
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(dirname(rendererPath), '../build/icon.png')
  // Apply to the main window, quick task launcher and other secondary windows.
  app.on('browser-window-created', (_event, window) => window.setIcon(icon))
  if (!app.isPackaged || !process.env.APPIMAGE) return
  const dataDirectory =
    process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
      ? process.env.XDG_DATA_HOME
      : join(homedir(), '.local', 'share')
  try {
    installAppImageDesktop({ id, title, executable: process.env.APPIMAGE, icon, dataDirectory })
  } catch (error) {
    // Desktop integration is optional; a read-only home must not prevent launching the app.
    console.warn('Could not register the AppImage desktop launcher:', error)
  }
}
