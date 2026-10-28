import { BrowserWindow, dialog } from 'electron'
import { browserPermissions } from './browser-permissions.js'

const labels = {
  'clipboard-read': 'read your clipboard',
  'clipboard-sanitized-write': 'write to your clipboard',
  'speaker-selection': 'select an audio output device',
  'screen-wake-lock': 'keep your screen awake',
  'persistent-storage': 'keep website data from automatic storage cleanup',
} as const
export const commonBrowserPermission = (permission: string): permission is keyof typeof labels =>
  Object.hasOwn(labels, permission)

const pending = new WeakMap<
  Electron.WebContents,
  { permission: string; promise: Promise<boolean> }
>()

/** One native prompt per tab; repeated requests share its answer. */
export function requestCommonBrowserPermission(
  contents: Electron.WebContents,
  profileId: string,
  origin: string,
  permission: keyof typeof labels,
  windowId?: number,
): Promise<boolean> {
  const current = pending.get(contents)
  if (current) return current.permission === permission ? current.promise : Promise.resolve(false)
  const promise = request(contents, profileId, origin, permission, windowId).finally(() =>
    pending.delete(contents),
  )
  pending.set(contents, { permission, promise })
  return promise
}

/** Native Chromium APIs retain their own secure-context, focus and activation requirements. */
async function request(
  contents: Electron.WebContents,
  profileId: string,
  origin: string,
  permission: keyof typeof labels,
  windowId?: number,
) {
  const permissions = browserPermissions(profileId)
  const setting = permissions.site(origin).permissions[permission]
  if (setting !== 'ask') return setting === 'allow'
  const frame = contents.mainFrame
  let navigated = false
  const onNavigate = () => {
    navigated = true
  }
  contents.on('did-navigate', onNavigate)
  try {
    const owner =
      windowId === undefined
        ? BrowserWindow.fromWebContents(contents)
        : BrowserWindow.fromId(windowId)
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Website permission',
      message: `${origin} wants to ${labels[permission]}.`,
      buttons: ['Allow once', 'Always allow', 'Block'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }
    const { response } = await (owner
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options))
    if (
      navigated ||
      contents.isDestroyed() ||
      contents.mainFrame !== frame ||
      new URL(frame.url).origin !== origin
    )
      return false
    // A permission changed through website controls while the dialog was open takes precedence.
    const latest = permissions.site(origin).permissions[permission]
    if (latest !== 'ask') return latest === 'allow'
    if (response === 1 || response === 2)
      permissions.setSite(origin, permission, response === 1 ? 'allow' : 'block')
    return response === 0 || response === 1
  } finally {
    contents.removeListener('did-navigate', onNavigate)
  }
}
