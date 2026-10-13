import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const applicationId = 'dev.dovo.studio.gpui'
const marker = 'X-Dovo-GPUI=true'
function value(text) {
  if (/[\r\n\0]/.test(text))
    throw new Error('Desktop launcher paths cannot contain line breaks or NUL.')
  return text.replaceAll('\\', '\\\\')
}
export function desktopEntry(executable) {
  // Exec has its own quoting rules after desktop-entry string escaping.
  // GIO resolves argv[0] before expanding %%: use env so percent signs in
  // the executable's literal pathname remain an argument during that check.
  const quoted = executable.replace(/([\\"`$])/g, '\\$1').replaceAll('%', '%%')
  return `[Desktop Entry]\nType=Application\nName=Dovo Studio GPUI\nComment=Native Dovo desktop workbench\nExec=/usr/bin/env "${value(quoted)}"\nTryExec=${value(executable)}\nIcon=${applicationId}\nTerminal=false\nCategories=Development;IDE;\nStartupWMClass=${applicationId}\n${marker}\n`
}
export async function registerLinux({ packageDirectory, dataHome, uninstall = false }) {
  if (!isAbsolute(dataHome)) throw new Error('The launcher data directory must be absolute.')
  const desktop = join(dataHome, 'applications', `${applicationId}.desktop`)
  const icon = join(dataHome, 'icons/hicolor/1024x1024/apps', `${applicationId}.png`)
  let existing
  try {
    existing = await readFile(desktop, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (existing !== undefined && !existing.split('\n').includes(marker))
    throw new Error('An unrecognized launcher exists; it has been preserved.')
  if (uninstall) {
    if (existing !== undefined) {
      await rm(desktop)
      await rm(icon, { force: true })
    }
    return desktop
  }
  const directory = await realpath(packageDirectory)
  const executable = join(directory, 'dovo-desktop-gpui')
  await access(executable, constants.X_OK)
  const entry = desktopEntry(executable)
  if (existing === undefined) {
    try {
      await access(icon)
      throw new Error('An unrecognized launcher icon exists; it has been preserved.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await mkdir(dirname(desktop), { recursive: true })
  await mkdir(dirname(icon), { recursive: true })
  await copyFile(join(directory, 'dovo-gpui.png'), icon)
  const temporary = `${desktop}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, entry, { flag: 'wx', mode: 0o644 })
    await rename(temporary, desktop)
  } finally {
    await rm(temporary, { force: true })
  }
  return desktop
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) {
      console.log(
        'Usage: ./install-linux.sh [--uninstall]\nRegisters this extracted package in your application menu. Keep it in its current location.\nUninstall removes only the launcher and icon; application data and runtimes remain.',
      )
    } else {
      if (process.platform !== 'linux') throw new Error('This launcher registration is for Linux.')
      if (process.argv.slice(2).some((arg) => arg !== '--uninstall'))
        throw new Error('Usage: ./install-linux.sh [--uninstall]')
      const uninstall = process.argv.includes('--uninstall')
      const dataHome =
        process.env.XDG_DATA_HOME && isAbsolute(process.env.XDG_DATA_HOME)
          ? process.env.XDG_DATA_HOME
          : join(homedir(), '.local/share')
      const path = await registerLinux({
        packageDirectory: dirname(fileURLToPath(import.meta.url)),
        dataHome,
        uninstall,
      })
      console.log(`${uninstall ? 'Removed' : 'Registered'} launcher: ${path}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
