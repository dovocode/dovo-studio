import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DefaultBrowserStatus } from '@dovo/protocol'
import { requireTrustedRenderer } from './renderer-trust.js'

const execute = promisify(execFile)
const schemes = ['http', 'https'] as const

export async function defaultBrowserStatus(nightly: boolean): Promise<DefaultBrowserStatus> {
  const supported = app.isPackaged && ['darwin', 'win32', 'linux'].includes(process.platform)
  if (!supported) return { supported: false, isDefault: false }
  if (process.platform === 'linux') {
    const desktop = `${nightly ? 'com.dovo.studio.nightly' : 'com.dovo.studio'}.desktop`
    const handlers = await Promise.all(
      schemes.map(async (scheme) => {
        const { stdout } = await execute(
          'xdg-mime',
          ['query', 'default', `x-scheme-handler/${scheme}`],
          { timeout: 10000 },
        )
        return stdout.trim()
      }),
    )
    return { supported, isDefault: handlers.every((handler) => handler === desktop) }
  }
  return { supported, isDefault: schemes.every((scheme) => app.isDefaultProtocolClient(scheme)) }
}

export async function requestDefaultBrowser(nightly: boolean) {
  if (!app.isPackaged) throw new Error('Install Dovo Studio to set it as your default browser.')
  if (process.platform === 'win32') {
    // Windows requires the user's choice. The installer already registers both
    // protocols under RegisteredApplications; never write UserChoice ourselves.
    await shell.openExternal('ms-settings:defaultapps')
  } else if (process.platform === 'darwin') {
    const results = schemes.map((scheme) => app.setAsDefaultProtocolClient(scheme))
    if (results.some((result) => !result))
      await shell.openExternal('x-apple.systempreferences:com.apple.Desktop-Settings.extension')
  } else if (process.platform === 'linux') {
    await execute(
      'xdg-settings',
      [
        'set',
        'default-web-browser',
        `${nightly ? 'com.dovo.studio.nightly' : 'com.dovo.studio'}.desktop`,
      ],
      { timeout: 10000 },
    )
  } else throw new Error('Default browser setup is not supported on this operating system.')
}

export function registerDefaultBrowser(rendererPath: string, nightly: boolean) {
  ipcMain.handle('browser:default-status', (event) => {
    requireTrustedRenderer(event, rendererPath)
    return defaultBrowserStatus(nightly)
  })
  ipcMain.handle('browser:default-request', (event) => {
    requireTrustedRenderer(event, rendererPath)
    return requestDefaultBrowser(nightly)
  })
}
